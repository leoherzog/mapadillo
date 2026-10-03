/**
 * KV-cached JSON proxy shared by the geocoding and routing handlers.
 * Owns the cache read, upstream fetch, size cap, JSON check and best-effort cache write.
 */
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';

const CACHE_TTL_SECONDS = 604_800;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_BYTES = 1_048_576;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export interface CachedProxyOptions {
  cacheKey: string;
  /** Fetches the upstream; must pass `signal` to fetch so the timeout applies. */
  fetchUpstream: (signal: AbortSignal) => Promise<Response>;
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
  // Only bodies that parsed as JSON are written, so a hit is served verbatim.
  const cached = await c.env.API_CACHE.get(cacheKey);
  if (cached !== null) return c.body(cached, 200, JSON_HEADERS);

  let upstream: Response;
  try {
    upstream = await opts.fetchUpstream(AbortSignal.timeout(UPSTREAM_TIMEOUT_MS));
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

  // The timeout can also fire while the body is read.
  let body: string | null;
  try {
    body = await readTextCapped(upstream, MAX_UPSTREAM_BYTES);
  } catch {
    return c.json({ error: opts.unavailableError }, 502);
  }
  if (body === null) return c.json({ error: 'Upstream response too large' }, 502);

  try {
    JSON.parse(body);
  } catch {
    return c.json({ error: opts.invalidResponseError }, 502);
  }

  // A failed KV write must never prevent serving the response.
  c.executionCtx.waitUntil(
    c.env.API_CACHE.put(cacheKey, body, { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {}),
  );

  return c.body(body, 200, JSON_HEADERS);
}

/**
 * Read a response body as UTF-8 text, counting bytes as they arrive.
 * @returns the text, or null once the body exceeds `maxBytes`
 */
async function readTextCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
