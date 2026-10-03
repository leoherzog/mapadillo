import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import {
  applyTestSchema, request, createTestSession, jsonRequest, createMap, createStop, grantShare, createShare,
} from './test-helpers.js';
import { getClientIp } from './index.js';
import type { Context } from 'hono';
import type { AppEnv } from './types.js';

/** Build a minimal Context stub that only exposes req.header (enough for getClientIp). */
function ctxWithHeaders(headers: Record<string, string>): Context<AppEnv> {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    req: { header: (name: string) => lower[name.toLowerCase()] },
  } as unknown as Context<AppEnv>;
}

beforeAll(applyTestSchema);
afterEach(() => {
  vi.restoreAllMocks();
});

const FEATURE_COLLECTION = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [13.4, 52.5] }, properties: { name: 'Berlin' } }],
};

/** Stub the upstream fetch with a canned FeatureCollection. */
function stubUpstreamFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(FEATURE_COLLECTION));
}

/** @returns every API_CACHE value whose key starts with `prefix` */
async function cachedValues(prefix: string): Promise<string[]> {
  const { keys } = await env.API_CACHE.list({ prefix });
  return Promise.all(keys.map(async (k) => (await env.API_CACHE.get(k.name)) ?? ''));
}

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 JSON { status: ok }', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

// ── Auth routes (Better Auth handler) ───────────────────────────────────────

describe('Auth routes - Better Auth handler', () => {
  it('GET /api/auth/ok returns 200 (Better Auth health)', async () => {
    const res = await request('/api/auth/ok');
    expect(res.status).toBe(200);
  });

  it('GET /api/auth/get-session returns 200 with a null body when unauthenticated', async () => {
    const res = await request('/api/auth/get-session');
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('GET /api/auth/get-session is not counted by the auth rate limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await request('/api/auth/get-session')).status);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});

// ── Protected map routes — 401 without auth ──────────────────────────────────

describe('Map routes - require auth', () => {
  it('GET /api/maps returns 401 without session', async () => {
    const res = await request('/api/maps');
    expect(res.status).toBe(401);
  });

  it('POST /api/maps returns 401 without session', async () => {
    const res = await request('/api/maps', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /api/maps/:id returns 404 without session (optional auth — public maps viewable unauthenticated)', async () => {
    // GET /:id uses optional auth so unauthenticated users can view public maps.
    // A nonexistent / private map returns 404, not 401.
    const res = await request('/api/maps/abc-123');
    expect(res.status).toBe(404);
  });

  it('PUT /api/maps/:id returns 401 without session', async () => {
    const res = await request('/api/maps/abc-123', { method: 'PUT' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/maps/:id returns 401 without session', async () => {
    const res = await request('/api/maps/abc-123', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('POST /api/maps/:id/stops returns 401 without session', async () => {
    const res = await request('/api/maps/abc-123/stops', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('PUT /api/maps/:id/stops/reorder returns 401 without session', async () => {
    const res = await request('/api/maps/abc-123/stops/reorder', { method: 'PUT' });
    expect(res.status).toBe(401);
  });

  it('401 response body has error message', async () => {
    const res = await request('/api/maps');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });
});

// ── Map CRUD ─────────────────────────────────────────────────────────────────

describe('Map CRUD', () => {
  it('POST /api/maps creates a map and returns 201', async () => {
    const { cookie, userId } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', { name: 'Road Trip' }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; owner_id: string };
    expect(body.name).toBe('Road Trip');
    expect(body.owner_id).toBe(userId);
    expect(body.id).toBeTruthy();
  });

  it('POST /api/maps with family_name', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', { name: 'Vacation', family_name: 'Smith' }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { family_name: string };
    expect(body.family_name).toBe('Smith');
  });

  it('POST /api/maps returns 400 without name', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', {}, cookie);
    expect(res.status).toBe(400);
  });

  it('POST /api/maps returns 400 with empty name', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', { name: '  ' }, cookie);
    expect(res.status).toBe(400);
  });

  it('GET /api/maps lists maps for current user', async () => {
    const { cookie } = await createTestSession();
    // Create maps first
    await jsonRequest('/api/maps', 'POST', { name: 'Map A' }, cookie);
    await jsonRequest('/api/maps', 'POST', { name: 'Map B' }, cookie);

    const res = await request('/api/maps', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; stops: unknown[] }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(2);
    // Each map has a stops array
    expect(body[0].stops).toBeDefined();
  });

  it('GET /api/maps/:id returns a single map with stops', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'Get Test');

    const res = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; stops: unknown[] };
    expect(body.id).toBe(mapId);
    expect(body.name).toBe('Get Test');
    expect(Array.isArray(body.stops)).toBe(true);
  });

  it('GET /api/maps/:id returns 404 for nonexistent map', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/maps/nonexistent-id', { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('PUT /api/maps/:id updates a map', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'Before Update');

    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: 'After Update' }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('After Update');
  });

  it('PUT /api/maps/:id returns 400 with empty name', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: '' }, cookie);
    expect(res.status).toBe(400);
  });

  it('PUT /api/maps/:id returns 400 with no valid fields', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { bogus: 'value' }, cookie);
    expect(res.status).toBe(400);
  });

  it('DELETE /api/maps/:id deletes a map', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'To Delete');

    const res = await request(`/api/maps/${mapId}`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(200);

    // Verify deleted
    const getRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    expect(getRes.status).toBe(404);
  });

  it('DELETE /api/maps/:id returns 404 for nonexistent map', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/maps/nonexistent-id', { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(404);
  });
});

// ── Ownership / authorization ────────────────────────────────────────────────

describe('Map ownership', () => {
  it('GET /api/maps/:id returns 404 for non-owner accessing private map (no info leak)', async () => {
    // Private maps return 404 (not 403) to unauthorized users — prevents map ID enumeration.
    const { cookie: cookie1 } = await createTestSession();
    const { cookie: cookie2 } = await createTestSession();
    const mapId = await createMap(cookie1, 'Owner Map');

    const res = await request(`/api/maps/${mapId}`, { headers: { cookie: cookie2 } });
    expect(res.status).toBe(404);
  });

  it('PUT /api/maps/:id returns 404 for non-owner on private map', async () => {
    // Non-owner + private map → getMapWithRole returns null → 404.
    const { cookie: cookie1 } = await createTestSession();
    const { cookie: cookie2 } = await createTestSession();
    const mapId = await createMap(cookie1);

    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: 'Stolen' }, cookie2);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/maps/:id returns 404 for non-owner on private map', async () => {
    // Non-owner + private map → getMapWithRole returns null → 404.
    const { cookie: cookie1 } = await createTestSession();
    const { cookie: cookie2 } = await createTestSession();
    const mapId = await createMap(cookie1);

    const res = await request(`/api/maps/${mapId}`, { method: 'DELETE', headers: { cookie: cookie2 } });
    expect(res.status).toBe(404);
  });

  it('editor can PUT but cannot DELETE a map', async () => {
    // An editor can see the map but cannot delete it — 403.
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie, 'Shared Map');
    await grantShare(mapId, editorId, 'editor');

    // Editor can edit — 200
    const putRes = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: 'Editor Edit' }, editorCookie);
    expect(putRes.status).toBe(200);

    // Editor cannot delete — 403
    const delRes = await request(`/api/maps/${mapId}`, { method: 'DELETE', headers: { cookie: editorCookie } });
    expect(delRes.status).toBe(403);
  });

  it('GET /api/maps only lists own maps and shared maps', async () => {
    const { cookie: cookie1 } = await createTestSession();
    const { cookie: cookie2 } = await createTestSession();
    const mapId = await createMap(cookie1, 'User1 Only');

    const res = await request('/api/maps', { headers: { cookie: cookie2 } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    const ids = body.map((m) => m.id);
    expect(ids).not.toContain(mapId);
  });
});

// ── Stop CRUD ────────────────────────────────────────────────────────────────

describe('Stop CRUD', () => {
  it('POST /:id/stops adds a stop at position 0', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Berlin', lat: 52.52, lng: 13.405, icon: 'landmark',
    }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string; position: number; type: string; travel_mode?: string | null };
    expect(body.name).toBe('Berlin');
    expect(body.position).toBe(0);
    // Points don't carry a travel_mode field (discriminated union: PointStop)
    expect(body.type).toBe('point');
    expect(body.travel_mode).toBeUndefined();
  });

  it('POST /:id/stops auto-increments position', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    // Add first stop
    await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Berlin', lat: 52.52, lng: 13.405,
    }, cookie);

    // Add second stop (route type to allow travel_mode)
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Munich', lat: 48.14, lng: 11.58, travel_mode: 'drive', type: 'route',
    }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { position: number; travel_mode: string };
    expect(body.position).toBe(1);
    expect(body.travel_mode).toBe('drive');
  });

  it('POST /:id/stops returns 400 without name', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      lat: 50.0, lng: 10.0,
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('POST /:id/stops returns 400 without lat/lng', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'No coords',
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('POST /:id/stops returns 400 with invalid icon', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Bad Icon', lat: 50.0, lng: 10.0, icon: 'invalid-icon',
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('POST /:id/stops returns 400 with invalid travel_mode', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Bad Mode', lat: 50.0, lng: 10.0, travel_mode: 'teleport',
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('PUT /:id/stops/:stopId updates a stop', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'Berlin', lat: 52.52, lng: 13.405 });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', {
      name: 'Berlin Updated', icon: 'star',
    }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; icon: string };
    expect(body.name).toBe('Berlin Updated');
    expect(body.icon).toBe('star');
  });

  it('PUT /:id/stops/:stopId returns 404 for nonexistent stop', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops/nonexistent`, 'PUT', {
      name: 'Ghost',
    }, cookie);
    expect(res.status).toBe(404);
  });

  it('DELETE /:id/stops/:stopId deletes a stop and re-compacts', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    // Add 3 stops
    await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });
    const middleId = await createStop(cookie, mapId, { name: 'B', lat: 51, lng: 11, travel_mode: 'drive', type: 'route' });
    await createStop(cookie, mapId, { name: 'C', lat: 52, lng: 12, travel_mode: 'walk', type: 'route' });

    // Verify 3 stops
    const beforeRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const before = (await beforeRes.json()) as { stops: Array<{ position: number }> };
    expect(before.stops.length).toBe(3);

    // Delete middle stop
    const res = await request(`/api/maps/${mapId}/stops/${middleId}`, {
      method: 'DELETE', headers: { cookie },
    });
    expect(res.status).toBe(200);

    // Verify re-compaction
    const afterRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const after = (await afterRes.json()) as { stops: Array<{ position: number; name: string }> };
    expect(after.stops.length).toBe(2);
    expect(after.stops[0].position).toBe(0);
    expect(after.stops[1].position).toBe(1);
  });

  it('DELETE /:id/stops/:stopId returns 404 for nonexistent stop', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await request(`/api/maps/${mapId}/stops/nonexistent`, {
      method: 'DELETE', headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});

// ── Stop reorder ─────────────────────────────────────────────────────────────

describe('Stop reorder', () => {
  it('reorder preserves travel_mode for route at position 0', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const id1 = await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });
    const id2 = await createStop(cookie, mapId, { name: 'B', lat: 51, lng: 11, travel_mode: 'drive', type: 'route' });

    // Reverse: B becomes first
    await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [id2, id1],
    }, cookie);

    const res = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const map = (await res.json()) as { stops: Array<{ position: number; travel_mode: string | null; id: string }> };
    const firstStop = map.stops.find((s) => s.position === 0)!;
    expect(firstStop.id).toBe(id2);
    expect(firstStop.travel_mode).toBe('drive');
  });

  it('PUT /:id/stops/reorder returns 400 with missing order', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {}, cookie);
    expect(res.status).toBe(400);
  });

  it('PUT /:id/stops/reorder returns 400 with invalid stop ID', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: ['nonexistent'],
    }, cookie);
    expect(res.status).toBe(400);
  });
});

// ── First stop travel_mode edge cases ────────────────────────────────────────

describe('Route travel_mode at position 0', () => {
  it('preserves travel_mode when deleting first stop promotes route', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const s1Id = await createStop(cookie, mapId, { name: 'First', lat: 50, lng: 10 });
    await createStop(cookie, mapId, { name: 'Second', lat: 51, lng: 11, travel_mode: 'drive', type: 'route' });

    // Delete first stop — route is promoted to position 0
    await request(`/api/maps/${mapId}/stops/${s1Id}`, { method: 'DELETE', headers: { cookie } });

    // Route at position 0 keeps its travel_mode
    const mapRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const mapData = (await mapRes.json()) as { stops: Array<{ position: number; travel_mode: string | null }> };
    expect(mapData.stops[0].position).toBe(0);
    expect(mapData.stops[0].travel_mode).toBe('drive');
  });
});

// ── Geocoding proxy ─────────────────────────────────────────────────────────

describe('Geocoding - /api/geocode', () => {
  it('returns 401 without session', async () => {
    const res = await request('/api/geocode?q=Berlin');
    expect(res.status).toBe(401);
  });

  describe('with auth', () => {
    let cookie: string;

    beforeAll(async () => {
      ({ cookie } = await createTestSession());
    });

    it('returns 400 when q param is missing', async () => {
      const res = await request('/api/geocode', {
        headers: { cookie },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('"q"');
    });

    it('returns 400 when q is too short', async () => {
      const res = await request('/api/geocode?q=B', {
        headers: { cookie },
      });
      expect(res.status).toBe(400);
    });

    it('proxies a valid query to Photon, caches the result and serves repeats from cache', async () => {
      const fetchSpy = stubUpstreamFetch();
      // A unique query keeps the cache key fresh across watch-mode reruns.
      const path = `/api/geocode?q=${encodeURIComponent(`Berlin ${crypto.randomUUID()}`)}&lang=en&limit=3`;

      const res = await request(path, { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(FEATURE_COLLECTION);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(String(fetchSpy.mock.calls[0][0])).toContain('https://photon.komoot.io/api');
      expect(await cachedValues('geocode:')).toContain(JSON.stringify(FEATURE_COLLECTION));

      const cachedRes = await request(path, { headers: { cookie } });
      expect(cachedRes.status).toBe(200);
      expect(await cachedRes.json()).toEqual(FEATURE_COLLECTION);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });
});

// ── Routing proxy ───────────────────────────────────────────────────────────

describe('Routing proxy - POST /api/route', () => {
  it('returns 401 without session', async () => {
    const res = await request('/api/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'driving-car', start: [13.4, 52.5], end: [11.6, 48.1] }),
    });
    expect(res.status).toBe(401);
  });

  describe('with auth', () => {
    let cookie: string;

    beforeAll(async () => {
      ({ cookie } = await createTestSession());
    });

    it('returns 400 with invalid JSON', async () => {
      const res = await request('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: 'not json',
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid JSON');
    });

    it('returns 400 with missing profile', async () => {
      const res = await jsonRequest('/api/route', 'POST', {
        start: [13.4, 52.5],
        end: [11.6, 48.1],
      }, cookie);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('profile');
    });

    it('returns 400 with invalid profile', async () => {
      const res = await jsonRequest('/api/route', 'POST', {
        profile: 'teleportation',
        start: [13.4, 52.5],
        end: [11.6, 48.1],
      }, cookie);
      expect(res.status).toBe(400);
    });

    it('returns 400 with missing start', async () => {
      const res = await jsonRequest('/api/route', 'POST', {
        profile: 'driving-car',
        end: [11.6, 48.1],
      }, cookie);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('start');
    });

    it('returns 400 with invalid coordinates (out of range)', async () => {
      const res = await jsonRequest('/api/route', 'POST', {
        profile: 'driving-car',
        start: [200, 100],
        end: [11.6, 48.1],
      }, cookie);
      expect(res.status).toBe(400);
    });

    it('returns 400 with invalid coordinate types', async () => {
      const res = await jsonRequest('/api/route', 'POST', {
        profile: 'driving-car',
        start: ['a', 'b'],
        end: [11.6, 48.1],
      }, cookie);
      expect(res.status).toBe(400);
    });

    it('proxies a valid request to ORS, caches the result and serves repeats from cache', async () => {
      const fetchSpy = stubUpstreamFetch();
      // A random end point keeps the cache key fresh across watch-mode reruns.
      const payload = {
        profile: 'driving-car',
        start: [13.388860, 52.517037],
        end: [11.575382, 48 + Math.random()],
      };

      const res = await jsonRequest('/api/route', 'POST', payload, cookie);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(FEATURE_COLLECTION);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(String(fetchSpy.mock.calls[0][0]))
        .toBe('https://api.openrouteservice.org/v2/directions/driving-car/geojson');
      expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)))
        .toMatchObject({ instructions: false, geometry_simplify: true });
      expect(await cachedValues('route:driving-car:')).toContain(JSON.stringify(FEATURE_COLLECTION));

      const cachedRes = await jsonRequest('/api/route', 'POST', payload, cookie);
      expect(cachedRes.status).toBe(200);
      expect(await cachedRes.json()).toEqual(FEATURE_COLLECTION);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it.each([
      [404, 422],
      [429, 429],
      [500, 502],
    ])('maps an ORS %i to %i', async (upstreamStatus, expected) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
        Response.json({ error: 'upstream' }, { status: upstreamStatus }));
      const res = await jsonRequest('/api/route', 'POST', {
        profile: 'driving-car',
        start: [13.4, 52.5],
        end: [11.6, 48 + Math.random()],
      }, cookie);
      expect(res.status).toBe(expected);
    });
  });
});

// ── Sharing routes ──────────────────────────────────────────────────────────

describe('Sharing - GET/POST /:id/shares', () => {
  it('GET /:id/shares returns 401 without session', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await request(`/api/maps/${mapId}/shares`);
    expect(res.status).toBe(401);
  });

  it('GET /:id/shares returns shares list (empty by default)', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await request(`/api/maps/${mapId}/shares`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shares: unknown[] };
    expect(Array.isArray(body.shares)).toBe(true);
    expect(body.shares.length).toBe(0);
  });

  it('GET /:id/shares returns 404 for non-owner', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const res = await request(`/api/maps/${mapId}/shares`, { headers: { cookie: otherCookie } });
    expect(res.status).toBe(404);
  });

  it('POST /:id/shares returns 400 with invalid role', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'owner' }, cookie);
    expect(res.status).toBe(400);
  });

  it('POST /:id/shares returns 404 for non-owner', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const res = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'viewer' }, otherCookie);
    expect(res.status).toBe(404);
  });
});

describe('Sharing - PUT/DELETE /:id/shares/:shareId', () => {
  it('PUT /:id/shares/:shareId updates a share role', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const { id: shareId } = await createShare(mapId, cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/shares/${shareId}`, 'PUT', { role: 'editor' }, cookie);
    expect(res.status).toBe(200);
  });

  it('PUT /:id/shares/:shareId returns 400 with invalid role', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const { id: shareId } = await createShare(mapId, cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/shares/${shareId}`, 'PUT', { role: 'owner' }, cookie);
    expect(res.status).toBe(400);
  });

  it('PUT /:id/shares/:shareId returns 404 for nonexistent share', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/shares/nonexistent`, 'PUT', { role: 'editor' }, cookie);
    expect(res.status).toBe(404);
  });

  it('DELETE /:id/shares/:shareId removes a share', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const { id: shareId } = await createShare(mapId, cookie);

    const res = await request(`/api/maps/${mapId}/shares/${shareId}`, {
      method: 'DELETE', headers: { cookie },
    });
    expect(res.status).toBe(200);
  });

  it('DELETE /:id/shares/:shareId returns 404 for nonexistent share', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await request(`/api/maps/${mapId}/shares/nonexistent`, {
      method: 'DELETE', headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});

// ── Claim share token ───────────────────────────────────────────────────────

describe('Sharing - POST /api/shares/claim/:token', () => {
  it('returns 401 without session', async () => {
    const res = await request('/api/shares/claim/some-token', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown token', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/shares/claim/nonexistent-token', 'POST', {}, cookie);
    expect(res.status).toBe(404);
  });

  it('claims a valid invite token and returns map_id', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    const mapId = await createMap(ownerCookie, 'Shared Trip');

    // Owner creates invite
    const { claim_token } = await createShare(mapId, ownerCookie);

    // Claimee claims it
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, claimeeCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map_id: string };
    expect(body.map_id).toBe(mapId);

    // Verify user_id set on share
    const share = await env.DB.prepare(
      'SELECT user_id FROM map_shares WHERE map_id = ? AND user_id = ?',
    ).bind(mapId, claimeeId).first<{ user_id: string }>();
    expect(share?.user_id).toBe(claimeeId);
  });

  it('owner claiming their own invite returns success without error', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    const { claim_token } = await createShare(mapId, ownerCookie);

    // Owner claims their own invite — should succeed (idempotent)
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map_id: string };
    expect(body.map_id).toBe(mapId);
  });
});

// ── Visibility toggle ───────────────────────────────────────────────────────

describe('Sharing - PUT /:id/visibility', () => {
  it('returns 401 without session', async () => {
    const res = await request('/api/maps/abc/visibility', { method: 'PUT' });
    expect(res.status).toBe(401);
  });

  it('sets map to public', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'public' }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; visibility: string };
    expect(body.visibility).toBe('public');
  });

  it('sets map back to private', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'public' }, cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'private' }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { visibility: string };
    expect(body.visibility).toBe('private');
  });

  it('returns 400 with invalid visibility value', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'shared' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-owner', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    const res = await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'public' }, otherCookie);
    expect(res.status).toBe(404);
  });
});

// ── Duplicate map ───────────────────────────────────────────────────────────

describe('Sharing - POST /:id/duplicate', () => {
  it('returns 401 without session', async () => {
    const res = await request('/api/maps/abc/duplicate', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('duplicates an owned map', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createMap(cookie, 'Original Trip');
    await createStop(cookie, mapId, { name: 'Stop A', lat: 50, lng: 10 });

    const res = await jsonRequest(`/api/maps/${mapId}/duplicate`, 'POST', {}, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string; owner_id: string };
    expect(body.id).not.toBe(mapId);
    expect(body.name).toBe('Original Trip (copy)');
    expect(body.owner_id).toBe(userId);

    const copy = await request(`/api/maps/${body.id}`, { headers: { cookie } });
    const copied = (await copy.json()) as { stops: unknown[] };
    expect(copied.stops.length).toBe(1);
  });

  it('duplicates a public map as a different user', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie, userId: otherUserId } = await createTestSession();
    const mapId = await createMap(ownerCookie, 'Public Trip');

    // Make it public
    await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'public' }, ownerCookie);

    const res = await jsonRequest(`/api/maps/${mapId}/duplicate`, 'POST', {}, otherCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { owner_id: string; visibility: string };
    expect(body.owner_id).toBe(otherUserId);
    // Duplicate is always private
    expect(body.visibility).toBe('private');
  });

  it('returns 404 for private map owned by another user', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie, 'Private Trip');

    const res = await jsonRequest(`/api/maps/${mapId}/duplicate`, 'POST', {}, otherCookie);
    expect(res.status).toBe(404);
  });
});

// ── Unknown API routes ────────────────────────────────────────────────────────

describe('Unknown API routes - 404', () => {
  it('GET /api/nonexistent returns 404', async () => {
    const res = await request('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('POST /api/does-not-exist returns 404', async () => {
    const res = await request('/api/does-not-exist', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

// ── Request body limit ────────────────────────────────────────────────────────

describe('Request body limit', () => {
  it('rejects a JSON body over 2MB with 413', async () => {
    const res = await request('/api/maps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(2 * 1024 * 1024 + 1) }),
    });
    expect(res.status).toBe(413);
  });
});

// ── Prodigi webhook rate limit ────────────────────────────────────────────────

describe('Prodigi webhook rate limit', () => {
  /** POST a callback without an order id, which is acknowledged without calling Prodigi. */
  function postCallback(ip: string) {
    return request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
      body: JSON.stringify({ specversion: '1.0' }),
    }, { origin: false });
  }

  it('answers 429 once one IP exhausts its budget, leaving other IPs unaffected', async () => {
    const ip = crypto.randomUUID();
    // The limiter counts in fixed windows, so a burst that straddles a boundary can need twice the limit.
    let status = 200;
    for (let i = 0; i < 121 && status === 200; i++) status = (await postCallback(ip)).status;
    expect(status).toBe(429);
    expect((await postCallback(crypto.randomUUID())).status).toBe(200);
  });
});

// ── getClientIp header parsing ────────────────────────────────────────────────

describe('getClientIp', () => {
  it('prefers cf-connecting-ip when set', () => {
    const c = ctxWithHeaders({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' });
    expect(getClientIp(c)).toBe('1.2.3.4');
  });

  it('falls back to "unknown" with no headers', () => {
    const c = ctxWithHeaders({});
    expect(getClientIp(c)).toBe('unknown');
  });
});
