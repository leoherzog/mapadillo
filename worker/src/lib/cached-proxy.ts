/**
 * KV-cached JSON proxy shared by the geocoding and routing handlers.
 * Owns the cache read, upstream fetch, size cap, JSON parse and best-effort cache write.
 */
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';

const CACHE_TTL_SECONDS = 604_800;
const MAX_UPSTREAM_BYTES = 1_048_576;

export interface CachedProxyOptions {
  cacheKey: string;
  fetchUpstream: () => Promise<Response>;
  /** Error message when the upstream cannot be reached or returns a non-ok status. */
  unavailableError: string;
  /** Error message when the upstream body is not valid JSON. */
  invalidResponseError: string;
  /** Builds the client response for a non-ok upstream. Defaults to 502 with `unavailableError`. */
  mapUpstreamError?: (c: Context<AppEnv>, upstream: Response) => Response;
}

/**
 * Serve a JSON response from API_CACHE, or fetch it upstream and cache it.
 * @returns the JSON response, or a JSON error response
 */
export async function proxyWithCache(c: Context<AppEnv>, opts: CachedProxyOptions): Promise<Response> {
  const { cacheKey } = opts;
  const cached = await c.env.API_CACHE.get(cacheKey);
  if (cached) {
    try {
      return c.json(JSON.parse(cached));
    } catch {
      // Corrupted cache entry: delete and fall through to re-fetch.
      try { await c.env.API_CACHE.delete(cacheKey); } catch { /* best-effort */ }
    }
  }

  let upstream: Response;
  try {
    upstream = await opts.fetchUpstream();
  } catch {
    return c.json({ error: opts.unavailableError }, 502);
  }

  if (!upstream.ok) {
    return opts.mapUpstreamError
      ? opts.mapUpstreamError(c, upstream)
      : c.json({ error: opts.unavailableError }, 502);
  }

  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_UPSTREAM_BYTES) {
    return c.json({ error: 'Upstream response too large' }, 502);
  }

  const body = await upstream.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.json({ error: opts.invalidResponseError }, 502);
  }

  // A failed KV write must never prevent serving the response.
  try {
    await c.env.API_CACHE.put(cacheKey, body, { expirationTtl: CACHE_TTL_SECONDS });
  } catch { /* best-effort */ }

  return c.json(parsed);
}
