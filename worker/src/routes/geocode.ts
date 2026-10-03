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
import { proxyWithCache } from '../lib/cached-proxy.js';

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

  // Location bias (optional)
  const rawLat = c.req.query('lat');
  const rawLon = c.req.query('lon');
  const biasLat = rawLat ? parseFloat(rawLat) : NaN;
  const biasLon = rawLon ? parseFloat(rawLon) : NaN;
  const hasBias = !Number.isNaN(biasLat) && !Number.isNaN(biasLon)
    && Math.abs(biasLat) <= 90 && Math.abs(biasLon) <= 180;

  // Bias is rounded to ~11 km in the cache key to limit cache cardinality.
  const biasKey = hasBias ? `:${biasLat.toFixed(1)}:${biasLon.toFixed(1)}` : '';
  const cacheKey = `geocode:${await sha256Hex(`${q.toLowerCase()}:${lang}:${limit}${biasKey}`)}`;

  const url = new URL('https://photon.komoot.io/api');
  url.searchParams.set('q', q);
  url.searchParams.set('lang', lang);
  url.searchParams.set('limit', String(limit));
  if (hasBias) {
    url.searchParams.set('lat', String(biasLat));
    url.searchParams.set('lon', String(biasLon));
  }

  return proxyWithCache(c, {
    cacheKey,
    fetchUpstream: (signal) => fetch(url, { signal }),
    unavailableError: 'Geocoding service unavailable',
    invalidResponseError: 'Geocoding service returned invalid response',
  });
}
