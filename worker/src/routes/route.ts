/**
 * Routing proxy — proxies OpenRouteService Directions API with KV caching.
 *
 * POST /api/route
 * Body: { profile: <an orsProfile from shared/travel-modes.ts>, start: [lon,lat], end: [lon,lat] }
 *
 * Returns the ORS GeoJSON response (FeatureCollection with LineString geometry).
 * KV-cached per {profile, start, end} with 7-day TTL.
 *
 * Requires authentication. Rate-limited at 30 req/min per user
 * via RATE_LIMITER_PROXY binding (applied in index.ts).
 */
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { sha256Hex } from '../lib/hash.js';
import { proxyWithCache } from '../lib/cached-proxy.js';
import { readJsonBody } from '../lib/json-body.js';
import { TRAVEL_MODES } from '../../../shared/travel-modes.js';

const VALID_PROFILES = new Set(
  TRAVEL_MODES.flatMap((m) => (m.orsProfile ? [m.orsProfile] : [])),
);

export async function routeHandler(c: Context<AppEnv>) {
  const body = await readJsonBody<{
    profile?: string;
    start?: [number, number];
    end?: [number, number];
  }>(c);
  if (!body) return c.res;
  const { profile, start, end } = body;

  // Validate profile
  if (!profile || !VALID_PROFILES.has(profile)) {
    return c.json(
      { error: `Invalid profile. Must be one of: ${[...VALID_PROFILES].join(', ')}` },
      400,
    );
  }

  // Validate start/end coordinates
  if (!isValidCoord(start) || !isValidCoord(end)) {
    return c.json(
      { error: 'start and end must be [longitude, latitude] arrays' },
      400,
    );
  }

  const cacheKey = `route:${profile}:${await sha256Hex(`${start[0]},${start[1]},${end[0]},${end[1]}`)}`;

  return proxyWithCache(c, {
    cacheKey,
    fetchUpstream: () => fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.ORS_API_KEY}`,
      },
      body: JSON.stringify({ coordinates: [start, end] }),
    }),
    unavailableError: 'Routing service unavailable',
    invalidResponseError: 'Routing service returned invalid response',
    // Forward ORS rate limiting so the client can back off.
    mapUpstreamError: (ctx, upstream) => upstream.status === 429
      ? ctx.json({ error: 'Routing service rate limit exceeded' }, 429)
      : ctx.json({ error: 'Routing service error' }, 502),
  });
}

function isValidCoord(coord: unknown): coord is [number, number] {
  return (
    Array.isArray(coord) &&
    coord.length === 2 &&
    typeof coord[0] === 'number' &&
    typeof coord[1] === 'number' &&
    isFinite(coord[0]) &&
    isFinite(coord[1]) &&
    coord[0] >= -180 &&
    coord[0] <= 180 &&
    coord[1] >= -90 &&
    coord[1] <= 90
  );
}
