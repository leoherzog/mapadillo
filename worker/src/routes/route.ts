/**
 * Routing proxy — proxies OpenRouteService Directions API with KV caching.
 *
 * POST /api/route
 * Body: { profile: "driving-car"|"foot-walking"|"cycling-regular", start: [lon,lat], end: [lon,lat] }
 *
 * Returns the ORS GeoJSON response (FeatureCollection with LineString geometry).
 * KV-cached per {profile, start, end} with 24-hour TTL.
 *
 * Requires authentication. Rate-limited at 30 req/min per user
 * via RATE_LIMITER_PROXY binding (applied in index.ts).
 */
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';

const VALID_PROFILES = new Set([
  'driving-car',
  'foot-walking',
  'cycling-regular',
]);

export async function routeHandler(c: Context<AppEnv>) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { profile, start, end } = body as {
    profile?: string;
    start?: [number, number];
    end?: [number, number];
  };

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

  // KV cache lookup
  const cacheKey = `route:${profile}:${await hashCoords(start!, end!)}`;
  const cached = await c.env.API_CACHE.get(cacheKey);
  if (cached) {
    try {
      return c.json(JSON.parse(cached));
    } catch {
      // Corrupted cache entry — delete and fall through
      try { await c.env.API_CACHE.delete(cacheKey); } catch { /* best-effort */ }
    }
  }

  // Proxy to OpenRouteService
  const orsUrl = `https://api.openrouteservice.org/v2/directions/${profile}/geojson`;

  let upstream: Response;
  try {
    upstream = await fetch(orsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.env.ORS_API_KEY}`,
      },
      body: JSON.stringify({
        coordinates: [start, end],
      }),
    });
  } catch {
    return c.json({ error: 'Routing service unavailable' }, 502);
  }

  if (!upstream.ok) {
    // Forward meaningful error status from ORS
    if (upstream.status === 429) {
      return c.json({ error: 'Routing service rate limit exceeded' }, 429);
    }
    return c.json({ error: 'Routing service error' }, 502);
  }

  const responseBody = await upstream.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return c.json({ error: 'Routing service returned invalid response' }, 502);
  }

  // Cache for 24 hours (86 400 seconds). Best-effort — failures don't block response.
  try {
    await c.env.API_CACHE.put(cacheKey, responseBody, { expirationTtl: 86_400 });
  } catch {
    // KV write can fail in test environments. Non-critical.
  }

  return c.json(parsed);
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

/** SHA-256 hash of coordinates, truncated to 32 hex chars. */
async function hashCoords(
  start: [number, number],
  end: [number, number],
): Promise<string> {
  const input = `${start[0]},${start[1]},${end[0]},${end[1]}`;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
