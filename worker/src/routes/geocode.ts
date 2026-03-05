/**
 * Geocoding proxy — proxies Photon (photon.komoot.io) with KV caching.
 *
 * GET /api/geocode?q=Berlin&lang=en&limit=5
 *
 * Requires authentication. Rate-limited at 30 req/min per user
 * via RATE_LIMITER_PROXY binding (applied in index.ts).
 */
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { sha256Hex } from '../lib/hash.js';

export async function geocodeHandler(c: Context<AppEnv>) {
  const q = c.req.query('q')?.trim();
  if (!q || q.length < 2 || q.length > 200) {
    return c.json(
      { error: 'Query parameter "q" is required (2–200 characters)' },
      400,
    );
  }

  const ALLOWED_LANGS = ['en', 'de', 'fr', 'it'] as const;
  const rawLang = c.req.query('lang') || 'en';
  const lang = ALLOWED_LANGS.includes(rawLang as (typeof ALLOWED_LANGS)[number])
    ? rawLang
    : 'en';
  const limit = Math.min(
    Math.max(parseInt(c.req.query('limit') || '5', 10) || 5, 1),
    10,
  );

  const ALLOWED_LAYERS = ['house', 'street', 'locality', 'district', 'city', 'county', 'state', 'country', 'other'] as const;
  const rawLayer = c.req.query('layer') || '';
  const layer = rawLayer
    ? rawLayer.split(',').filter((l) => ALLOWED_LAYERS.includes(l.trim() as (typeof ALLOWED_LAYERS)[number])).join(',')
    : '';

  // KV cache lookup
  const cacheKey = `geocode:${await sha256Hex(`${q.toLowerCase()}:${lang}:${limit}:${layer}`)}`;
  const cached = await c.env.API_CACHE.get(cacheKey);
  if (cached) {
    try {
      return c.json(JSON.parse(cached));
    } catch {
      // Corrupted cache entry — delete and fall through to re-fetch
      try { await c.env.API_CACHE.delete(cacheKey); } catch { /* best-effort */ }
    }
  }

  // Proxy to Photon
  const url = new URL('https://photon.komoot.io/api');
  url.searchParams.set('q', q);
  url.searchParams.set('lang', lang);
  url.searchParams.set('limit', String(limit));
  if (layer) {
    for (const l of layer.split(',')) {
      url.searchParams.append('layer', l);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(url.toString());
  } catch {
    return c.json({ error: 'Geocoding service unavailable' }, 502);
  }

  if (!upstream.ok) {
    return c.json({ error: 'Geocoding service unavailable' }, 502);
  }

  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > 1_048_576) {
    return c.json({ error: 'Upstream response too large' }, 502);
  }

  const body = await upstream.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.json({ error: 'Geocoding service returned invalid response' }, 502);
  }

  // Cache for 7 days (604 800 seconds). KV write is best-effort — a
  // failure must never prevent serving the response.
  try {
    await c.env.API_CACHE.put(cacheKey, body, { expirationTtl: 604_800 });
  } catch {
    // KV write can fail in test environments (Miniflare isolated storage).
    // Non-critical: the next identical request will simply re-fetch.
  }

  return c.json(parsed);
}

