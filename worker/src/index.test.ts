import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from './index.js';

// Apply D1 migrations before any tests that touch the database.
// Miniflare creates an empty D1 database; it does not auto-apply migrations.
beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "session" (id TEXT PRIMARY KEY NOT NULL, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "account" (id TEXT PRIMARY KEY NOT NULL, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "verification" (id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "passkey" (id TEXT PRIMARY KEY NOT NULL, name TEXT, publicKey TEXT NOT NULL, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, counter INTEGER NOT NULL DEFAULT 0, deviceType TEXT, backedUp INTEGER NOT NULL DEFAULT 0, transports TEXT, credentialID TEXT NOT NULL UNIQUE, createdAt INTEGER, aaguid TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS maps (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, name TEXT NOT NULL, family_name TEXT, visibility TEXT NOT NULL DEFAULT \'private\', style_preferences TEXT DEFAULT \'{}\', units TEXT NOT NULL DEFAULT \'km\', created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS stops (id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT NOT NULL, label TEXT, latitude REAL NOT NULL, longitude REAL NOT NULL, icon TEXT, travel_mode TEXT, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), type TEXT NOT NULL DEFAULT \'point\', dest_name TEXT, dest_latitude REAL, dest_longitude REAL, route_geometry TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS map_shares (id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE, user_id TEXT REFERENCES "user"(id), role TEXT NOT NULL DEFAULT \'viewer\', claim_token TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), UNIQUE(map_id, user_id))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_stops_map_id ON stops(map_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_maps_owner_id ON maps(owner_id)'),
  ]);
});

/**
 * Helper: call a route on the Hono app with the Workers env injected.
 * Returns the Hono Response directly (no real HTTP round-trip).
 */
function request(path: string, init?: RequestInit) {
  // Inject Origin header for state-changing requests (CSRF protection)
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
    const headers = new Headers(init.headers);
    if (!headers.has('origin')) headers.set('origin', 'http://localhost');
    init = { ...init, headers };
  }
  return app.request(path, init, env);
}

/**
 * Create a test user + session directly in D1 and return the signed session
 * cookie string and the userId. Mirrors what Better Auth does internally.
 */
async function createTestSession(): Promise<{ cookie: string; userId: string }> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const rawToken = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

  // Insert user + session rows
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)'
    ).bind(userId, 'Test User', `test-${userId}@example.com`, now, now),
    env.DB.prepare(
      'INSERT INTO "session" (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(sessionId, rawToken, userId, expiresAt, now, now),
  ]);

  // Sign the token the same way Better Auth does (HMAC-SHA256)
  const secret = env.BETTER_AUTH_SECRET as string;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(rawToken),
  );
  const b64Sig = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const signedValue = `${rawToken}.${b64Sig}`;

  const cookie = `better-auth.session_token=${encodeURIComponent(signedValue)}`;
  return { cookie, userId };
}

/** JSON POST/PUT helper */
function jsonRequest(path: string, method: string, body: unknown, cookie: string) {
  return request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify(body),
  });
}

/** Create a map via the API and return its id */
async function createMap(cookie: string, name = 'Test Map'): Promise<string> {
  const res = await jsonRequest('/api/maps', 'POST', { name }, cookie);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Create a stop via the API and return its id */
async function createStop(
  cookie: string, mapId: string,
  data: { name: string; lat: number; lng: number; travel_mode?: string; icon?: string; type?: string },
): Promise<string> {
  const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', data, cookie);
  const body = (await res.json()) as { id: string };
  return body.id;
}

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
  });

  it('returns JSON content type', async () => {
    const res = await request('/api/health');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('returns status ok with milestone 7', async () => {
    const res = await request('/api/health');
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', milestone: 7 });
  });
});

// ── Auth routes (Milestone 2 — Better Auth handler) ──────────────────────────

describe('Auth routes - Better Auth handler', () => {
  it('GET /api/auth/ok returns 200 (Better Auth health)', async () => {
    const res = await request('/api/auth/ok');
    expect(res.status).toBe(200);
  });

  it('GET /api/auth/get-session returns 200 (no active session)', async () => {
    const res = await request('/api/auth/get-session');
    expect(res.status).toBe(200);
  });

  it('GET /api/auth/get-session returns null session when unauthenticated', async () => {
    const res = await request('/api/auth/get-session');
    const body = await res.json();
    expect(body).toBeNull();
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
    // M6: GET /:id uses optional auth so unauthenticated users can view public maps.
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

  it('PUT /api/maps/:id can update units', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { units: 'mi' }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { units: string };
    expect(body.units).toBe('mi');
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
    // M6: Private maps return 404 (not 403) to unauthorized users — prevents map ID enumeration.
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

  it('PUT /api/maps/:id returns 403 for editor trying to delete (owner-only)', async () => {
    // An editor can see the map but cannot delete it — 403.
    const { cookie: ownerCookie, userId: ownerId } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie, 'Shared Map');

    // Give editor access via map_shares
    const shareId = crypto.randomUUID();
    const token = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(shareId, mapId, editorId, 'editor', token).run();

    // Editor can edit — 200
    const putRes = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: 'Editor Edit' }, editorCookie);
    expect(putRes.status).toBe(200);

    // Editor cannot delete — 403
    const delRes = await request(`/api/maps/${mapId}`, { method: 'DELETE', headers: { cookie: editorCookie } });
    expect(delRes.status).toBe(403);
    void ownerId; // used in setup
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
    const body = (await res.json()) as { name: string; position: number; travel_mode: string | null };
    expect(body.name).toBe('Berlin');
    expect(body.position).toBe(0);
    expect(body.travel_mode).toBeNull(); // first stop has no travel_mode
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

  it('PUT /:id/stops/:stopId returns 400 for travel_mode on first stop', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'First', lat: 52.52, lng: 13.405 });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', {
      travel_mode: 'drive',
    }, cookie);
    expect(res.status).toBe(400);
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
  it('PUT /:id/stops/reorder reorders stops', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const ids: string[] = [];
    for (const [i, city] of ['A', 'B', 'C'].entries()) {
      const sid = await createStop(cookie, mapId, {
        name: city, lat: 50 + i, lng: 10 + i,
        ...(i > 0 ? { travel_mode: 'drive', type: 'route' } : {}),
      });
      ids.push(sid);
    }

    const reversed = [...ids].reverse();
    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: reversed,
    }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; position: number }>;
    expect(body[0].id).toBe(reversed[0]);
    expect(body[0].position).toBe(0);
    expect(body[2].position).toBe(2);
  });

  it('reorder nulls travel_mode for new first stop', async () => {
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
    expect(firstStop.travel_mode).toBeNull();
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

  it('PUT /:id/stops/reorder returns 400 with incomplete order', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const id1 = await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });
    await createStop(cookie, mapId, { name: 'B', lat: 51, lng: 11, travel_mode: 'drive', type: 'route' });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [id1],
    }, cookie);
    expect(res.status).toBe(400);
  });
});

// ── Cascade delete ───────────────────────────────────────────────────────────

describe('Cascade delete', () => {
  it('deleting a map cascades to its stops', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'Cascade Map');
    await createStop(cookie, mapId, { name: 'Stop 1', lat: 50, lng: 10 });

    // Delete map
    const delRes = await request(`/api/maps/${mapId}`, { method: 'DELETE', headers: { cookie } });
    expect(delRes.status).toBe(200);

    // Verify stops are gone (direct DB check)
    const stops = await env.DB.prepare('SELECT * FROM stops WHERE map_id = ?').bind(mapId).all();
    expect(stops.results.length).toBe(0);
  });
});

// ── First stop travel_mode edge cases ────────────────────────────────────────

describe('First stop travel_mode nulling', () => {
  it('forces travel_mode null on first stop creation even if provided', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'First', lat: 50, lng: 10, travel_mode: 'drive', type: 'route',
    }, cookie);
    expect(res.status).toBe(201);
    const stop = (await res.json()) as { travel_mode: string | null };
    expect(stop.travel_mode).toBeNull();
  });

  it('nulls travel_mode when deleting first stop promotes second', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const s1Id = await createStop(cookie, mapId, { name: 'First', lat: 50, lng: 10 });
    await createStop(cookie, mapId, { name: 'Second', lat: 51, lng: 11, travel_mode: 'drive', type: 'route' });

    // Delete first stop
    await request(`/api/maps/${mapId}/stops/${s1Id}`, { method: 'DELETE', headers: { cookie } });

    // Check promoted first stop
    const mapRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const mapData = (await mapRes.json()) as { stops: Array<{ position: number; travel_mode: string | null }> };
    expect(mapData.stops[0].position).toBe(0);
    expect(mapData.stops[0].travel_mode).toBeNull();
  });
});

// ── Geocoding proxy (Milestone 3) ────────────────────────────────────────────

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

    it('proxies to Photon and returns GeoJSON for valid query', async () => {
      const res = await request('/api/geocode?q=Berlin&lang=en&limit=3', {
        headers: { cookie },
      });
      // In test environments outbound fetch or KV may fail — skip gracefully
      if (res.status !== 200) {
        expect([502, 500]).toContain(res.status);
        return;
      }

      const body = (await res.json()) as { type: string; features: unknown[] };
      expect(body.type).toBe('FeatureCollection');
      expect(Array.isArray(body.features)).toBe(true);
    });
  });
});

// ── Routing proxy (Milestone 5) ───────────────────────────────────────────────

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

    it('proxies to ORS for valid request', async () => {
      const res = await jsonRequest('/api/route', 'POST', {
        profile: 'driving-car',
        start: [13.388860, 52.517037],
        end: [11.575382, 48.137154],
      }, cookie);
      // In test environments outbound fetch may fail — skip gracefully
      if (res.status !== 200) {
        expect([502, 500, 429]).toContain(res.status);
        return;
      }
      const body = (await res.json()) as { type: string; features: unknown[] };
      expect(body.type).toBe('FeatureCollection');
      expect(Array.isArray(body.features)).toBe(true);
    });
  });
});

// ── Sharing routes (Milestone 6) ──────────────────────────────────────────────

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

  it('POST /:id/shares creates a share invite link', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'viewer' }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; claim_token: string; role: string; url: string };
    expect(body.role).toBe('viewer');
    expect(body.claim_token).toBeTruthy();
    expect(body.url).toContain('/claim/');
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
    const createRes = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'viewer' }, cookie);
    const { id: shareId } = (await createRes.json()) as { id: string };

    const res = await jsonRequest(`/api/maps/${mapId}/shares/${shareId}`, 'PUT', { role: 'editor' }, cookie);
    expect(res.status).toBe(200);
  });

  it('PUT /:id/shares/:shareId returns 400 with invalid role', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const createRes = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'viewer' }, cookie);
    const { id: shareId } = (await createRes.json()) as { id: string };

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
    const createRes = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'viewer' }, cookie);
    const { id: shareId } = (await createRes.json()) as { id: string };

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

// ── Claim share token (Milestone 6) ──────────────────────────────────────────

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
    const inviteRes = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'viewer' }, ownerCookie);
    const { claim_token } = (await inviteRes.json()) as { claim_token: string };

    // Claimee claims it
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, claimeeCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map_id: string };
    expect(body.map_id).toBe(mapId);

    // Verify user_id set on share — query by map_id+user_id since claim_token is nullified after claim
    const share = await env.DB.prepare(
      'SELECT user_id FROM map_shares WHERE map_id = ? AND user_id = ?',
    ).bind(mapId, claimeeId).first<{ user_id: string }>();
    expect(share?.user_id).toBe(claimeeId);
  });

  it('returns 403 for already-claimed token', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: cookie2 } = await createTestSession();
    const { cookie: cookie3 } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    const inviteRes = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'editor' }, ownerCookie);
    const { claim_token } = (await inviteRes.json()) as { claim_token: string };

    // First claim succeeds
    await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, cookie2);
    // Second claim by different user fails — token is nullified after first claim so link is invalid
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, cookie3);
    expect(res.status).toBe(404);
  });

  it('owner claiming their own invite returns success without error', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    const inviteRes = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'viewer' }, ownerCookie);
    const { claim_token } = (await inviteRes.json()) as { claim_token: string };

    // Owner claims their own invite — should succeed (idempotent)
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map_id: string };
    expect(body.map_id).toBe(mapId);
  });
});

// ── Visibility toggle (Milestone 6) ──────────────────────────────────────────

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

  it('public map is viewable without auth', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'Public Map');

    // Make it public
    await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'public' }, cookie);

    // Access without auth — should return 200
    const res = await request(`/api/maps/${mapId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; role: string };
    expect(body.id).toBe(mapId);
    expect(body.role).toBe('public');
  });
});

// ── Duplicate map (Milestone 6) ───────────────────────────────────────────────

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
    const body = (await res.json()) as { id: string; name: string; owner_id: string; stops: unknown[] };
    expect(body.id).not.toBe(mapId);
    expect(body.name).toBe('Original Trip (copy)');
    expect(body.owner_id).toBe(userId);
    expect(body.stops.length).toBe(1);
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
  });

  it('POST /api/does-not-exist returns 404', async () => {
    const res = await request('/api/does-not-exist', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
