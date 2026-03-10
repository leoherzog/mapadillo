import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import app from '../index.js';

// Apply D1 migrations before any tests that touch the database.
beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, units TEXT NOT NULL DEFAULT \'km\')'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "session" (id TEXT PRIMARY KEY NOT NULL, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "account" (id TEXT PRIMARY KEY NOT NULL, accountId TEXT NOT NULL, providerId TEXT NOT NULL, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER, refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "verification" (id TEXT PRIMARY KEY NOT NULL, identifier TEXT NOT NULL, value TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER, updatedAt INTEGER)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "passkey" (id TEXT PRIMARY KEY NOT NULL, name TEXT, publicKey TEXT NOT NULL, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, counter INTEGER NOT NULL DEFAULT 0, deviceType TEXT, backedUp INTEGER NOT NULL DEFAULT 0, transports TEXT, credentialID TEXT NOT NULL UNIQUE, createdAt INTEGER, aaguid TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS maps (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, name TEXT NOT NULL, family_name TEXT, visibility TEXT NOT NULL DEFAULT \'private\', export_settings TEXT DEFAULT \'{}\', created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS stops (id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT NOT NULL, label TEXT, latitude REAL NOT NULL, longitude REAL NOT NULL, icon TEXT, travel_mode TEXT, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), type TEXT NOT NULL DEFAULT \'point\', dest_name TEXT, dest_latitude REAL, dest_longitude REAL, dest_icon TEXT, show_start_label INTEGER NOT NULL DEFAULT 1, show_dest_label INTEGER NOT NULL DEFAULT 1, route_geometry TEXT)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS map_shares (id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE, user_id TEXT REFERENCES "user"(id), role TEXT NOT NULL DEFAULT \'viewer\', claim_token TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), UNIQUE(map_id, user_id))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_stops_map_id ON stops(map_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_maps_owner_id ON maps(owner_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_map_shares_user_id ON map_shares(user_id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE RESTRICT, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT, stripe_session_id TEXT, prodigi_order_id TEXT, poster_size TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', image_url TEXT, shipping_address TEXT, tracking_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_map_id ON orders(map_id)'),
  ]);
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function request(path: string, init?: RequestInit) {
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
    const headers = new Headers(init.headers);
    if (!headers.has('origin')) headers.set('origin', 'http://localhost');
    init = { ...init, headers };
  }
  return app.request(path, init, env);
}

async function createTestSession(): Promise<{ cookie: string; userId: string }> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const rawToken = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)',
    ).bind(userId, 'Test User', `test-${userId}@example.com`, now, now),
    env.DB.prepare(
      'INSERT INTO "session" (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(sessionId, rawToken, userId, expiresAt, now, now),
  ]);

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

function jsonRequest(path: string, method: string, body: unknown, cookie: string) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

function rawRequest(path: string, method: string, rawBody: string, cookie: string) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: rawBody,
  });
}

async function createMap(cookie: string, name = 'Test Map'): Promise<string> {
  const res = await jsonRequest('/api/maps', 'POST', { name }, cookie);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function createStop(
  cookie: string,
  mapId: string,
  data: {
    name: string; lat: number; lng: number;
    travel_mode?: string; icon?: string; type?: string;
    label?: string; dest_name?: string; dest_lat?: number; dest_lng?: number; dest_icon?: string;
  },
): Promise<string> {
  const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', data, cookie);
  const body = (await res.json()) as { id: string };
  return body.id;
}

// ── Map creation — validation edge cases ─────────────────────────────────────

describe('POST /api/maps — validation edge cases', () => {
  it('returns 400 for malformed JSON body', async () => {
    const { cookie } = await createTestSession();
    const res = await rawRequest('/api/maps', 'POST', '{not valid json}', cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns 400 when name is a number instead of string', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', { name: 12345 }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is null', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', { name: null }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when name exceeds 200 characters', async () => {
    const { cookie } = await createTestSession();
    const longName = 'A'.repeat(201);
    const res = await jsonRequest('/api/maps', 'POST', { name: longName }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('200');
  });

  it('accepts name at exactly 200 characters', async () => {
    const { cookie } = await createTestSession();
    const name = 'B'.repeat(200);
    const res = await jsonRequest('/api/maps', 'POST', { name }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe(name);
  });

  it('trims whitespace from name', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', { name: '  Padded Name  ' }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('Padded Name');
  });

  it('returns 400 when family_name exceeds 200 characters', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', {
      name: 'Trip',
      family_name: 'X'.repeat(201),
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('family_name');
  });

  it('sets family_name to null when not provided', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps', 'POST', { name: 'Solo Trip' }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { family_name: string | null };
    expect(body.family_name).toBeNull();
  });
});

// ── Map update — validation edge cases ───────────────────────────────────────

describe('PUT /api/maps/:id — validation edge cases', () => {
  it('returns 400 for malformed JSON body', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await rawRequest(`/api/maps/${mapId}`, 'PUT', 'not json', cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns 400 when name exceeds 200 characters', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: 'C'.repeat(201) }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('200');
  });

  it('returns 400 when name is whitespace-only', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: '   ' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when family_name exceeds 200 characters on update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { family_name: 'Y'.repeat(201) }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('family_name');
  });

  it('returns 400 when export_settings string is too large', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', {
      export_settings: 'x'.repeat(10_001),
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('too large');
  });

  it('accepts export_settings as object and serializes to JSON', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const settings = { theme: 'dark', zoom: 5 };
    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', {
      export_settings: settings,
    }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { export_settings: string };
    expect(body.export_settings).toBe(JSON.stringify(settings));
  });

  it('ignores unknown fields and updates only allowed fields', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'Original');
    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', {
      name: 'Updated',
      owner_id: 'hacker',
      visibility: 'public',
    }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; owner_id: string; visibility: string };
    expect(body.name).toBe('Updated');
    // owner_id and visibility should not be changed via PUT /maps/:id
    expect(body.visibility).toBe('private');
  });

  it('returns updated map with stops array', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    await createStop(cookie, mapId, { name: 'Berlin', lat: 52.52, lng: 13.405 });

    const res = await jsonRequest(`/api/maps/${mapId}`, 'PUT', { name: 'Renamed' }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; stops: unknown[] };
    expect(body.name).toBe('Renamed');
    expect(Array.isArray(body.stops)).toBe(true);
    expect(body.stops.length).toBe(1);
  });
});

// ── Map delete — role-based access ───────────────────────────────────────────

describe('DELETE /api/maps/:id — role-based access', () => {
  it('viewer cannot delete a map (returns 403)', async () => {
    const { cookie: ownerCookie, userId: _ownerId } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Give viewer access
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, viewerId, 'viewer', crypto.randomUUID()).run();

    const res = await request(`/api/maps/${mapId}`, { method: 'DELETE', headers: { cookie: viewerCookie } });
    expect(res.status).toBe(403);
  });

  it('editor cannot delete a map (returns 403)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, editorId, 'editor', crypto.randomUUID()).run();

    const res = await request(`/api/maps/${mapId}`, { method: 'DELETE', headers: { cookie: editorCookie } });
    expect(res.status).toBe(403);
  });
});

// ── Stop creation — validation edge cases ────────────────────────────────────

describe('POST /:id/stops — validation edge cases', () => {
  it('returns 400 for malformed JSON body', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await rawRequest(`/api/maps/${mapId}/stops`, 'POST', '<<not json>>', cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns 400 with invalid type', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Bad', lat: 50, lng: 10, type: 'waypoint',
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid type');
  });

  it('returns 400 when name exceeds 200 characters', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Z'.repeat(201), lat: 50, lng: 10,
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('200');
  });

  it('returns 400 when label exceeds 500 characters', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Labeled', lat: 50, lng: 10, label: 'L'.repeat(501),
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('label');
  });

  it('returns 400 when dest_name exceeds 200 characters', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Route', lat: 50, lng: 10, type: 'route',
      dest_name: 'D'.repeat(201), dest_lat: 51, dest_lng: 11,
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('dest_name');
  });

  it('returns 400 when lat is out of range (> 90)', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Out', lat: 91, lng: 10,
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('lat');
  });

  it('returns 400 when lat is out of range (< -90)', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Out', lat: -91, lng: 10,
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when lng is out of range (> 180)', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Out', lat: 50, lng: 181,
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('lng');
  });

  it('returns 400 when lng is out of range (< -180)', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Out', lat: 50, lng: -181,
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('accepts boundary lat/lng values (-90, 90, -180, 180)', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res1 = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'South Pole', lat: -90, lng: 0,
    }, cookie);
    expect(res1.status).toBe(201);

    const res2 = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'North Pole', lat: 90, lng: 0,
    }, cookie);
    expect(res2.status).toBe(201);

    const res3 = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Date Line West', lat: 0, lng: -180,
    }, cookie);
    expect(res3.status).toBe(201);

    const res4 = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Date Line East', lat: 0, lng: 180,
    }, cookie);
    expect(res4.status).toBe(201);
  });

  it('returns 400 when lat is NaN', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    // JSON.stringify turns NaN to null, so send lat as string to test type check
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'NaN', lat: 'not-a-number', lng: 10,
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when lat is Infinity (via non-finite check)', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    // JSON doesn't support Infinity, so we can't send it directly.
    // But we can test the boundary: a number just outside range.
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Inf', lat: 90.0001, lng: 10,
    }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when point has travel_mode', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Bad Point', lat: 50, lng: 10, type: 'point', travel_mode: 'drive',
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Points cannot have a travel_mode');
  });

  it('returns 400 when point has destination fields', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Bad Point', lat: 50, lng: 10, type: 'point',
      dest_lat: 51, dest_lng: 11,
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('destination fields');
  });

  it('returns 400 when dest_lat is out of range on route', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Route', lat: 50, lng: 10, type: 'route',
      dest_lat: 95, dest_lng: 11,
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('dest_lat');
  });

  it('returns 400 when dest_lng is out of range on route', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Route', lat: 50, lng: 10, type: 'route',
      dest_lat: 51, dest_lng: 200,
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('dest_lng');
  });

  it('returns 400 with invalid dest_icon', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Route', lat: 50, lng: 10, type: 'route',
      dest_icon: 'fake-icon',
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('dest_icon');
  });

  it('defaults type to point when not specified', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Default', lat: 50, lng: 10,
    }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe('point');
  });

  it('defaults travel_mode to drive for route type', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Route', lat: 50, lng: 10, type: 'route',
    }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { travel_mode: string };
    expect(body.travel_mode).toBe('drive');
  });

  it('trims stop name and label', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: '  Berlin  ', lat: 52.52, lng: 13.405, label: '  Capital of Germany  ',
    }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { name: string; label: string };
    expect(body.name).toBe('Berlin');
    expect(body.label).toBe('Capital of Germany');
  });

  it('returns 404 when adding stop to nonexistent map', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps/nonexistent/stops', 'POST', {
      name: 'Ghost', lat: 50, lng: 10,
    }, cookie);
    expect(res.status).toBe(404);
  });

  it('returns 404 when adding stop to map owned by another user', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Intruder', lat: 50, lng: 10,
    }, otherCookie);
    expect(res.status).toBe(404);
  });
});

// ── Stop creation — RBAC ─────────────────────────────────────────────────────

describe('POST /:id/stops — role-based access', () => {
  it('viewer cannot add stops (returns 403)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, viewerId, 'viewer', crypto.randomUUID()).run();

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Forbidden', lat: 50, lng: 10,
    }, viewerCookie);
    expect(res.status).toBe(403);
  });

  it('editor can add stops (returns 201)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, editorId, 'editor', crypto.randomUUID()).run();

    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Editor Stop', lat: 50, lng: 10,
    }, editorCookie);
    expect(res.status).toBe(201);
  });
});

// ── Stop update — validation edge cases ──────────────────────────────────────

describe('PUT /:id/stops/:stopId — validation edge cases', () => {
  it('returns 400 for malformed JSON', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await rawRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', '<<<', cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is empty string', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { name: '' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when name exceeds 200 characters', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { name: 'Z'.repeat(201) }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when label exceeds 500 characters', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { label: 'L'.repeat(501) }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when label is non-string, non-null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { label: 42 }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('label must be a string or null');
  });

  it('allows setting label to null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10, label: 'something' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { label: null }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { label: string | null };
    expect(body.label).toBeNull();
  });

  it('returns 400 when lat is out of range', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { lat: 100 }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when lng is not a number', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { lng: 'abc' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when trying to change type', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { type: 'route' }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('type cannot be changed');
  });

  it('returns 400 with invalid icon on update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { icon: 'bogus' }, cookie);
    expect(res.status).toBe(400);
  });

  it('allows setting icon to null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10, icon: 'star' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { icon: null }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { icon: string | null };
    expect(body.icon).toBeNull();
  });

  it('returns 400 with invalid dest_icon on update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { dest_icon: 'fake' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 with invalid travel_mode on update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { travel_mode: 'teleport' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 setting travel_mode on a point', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'P', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { travel_mode: 'walk' }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Points cannot have a travel_mode');
  });

  it('allows setting travel_mode to null on a route', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route', travel_mode: 'drive' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { travel_mode: null }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { travel_mode: string | null };
    expect(body.travel_mode).toBeNull();
  });

  it('returns 400 when dest_name is non-string, non-null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { dest_name: 123 }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when dest_name exceeds 200 chars on update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { dest_name: 'D'.repeat(201) }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when dest_lat is non-number, non-null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { dest_lat: 'abc' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when dest_lat is out of range on update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { dest_lat: -91 }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when dest_lng is non-number, non-null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { dest_lng: true }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when dest_lng is out of range on update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { dest_lng: 181 }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 with no valid fields to update', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'S', lat: 50, lng: 10 });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { unknown_field: 'x' }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('No valid fields');
  });

  it('returns 400 when route_geometry is non-string, non-null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { route_geometry: 42 }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when route_geometry exceeds 1MB', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', {
      route_geometry: 'x'.repeat(1_048_577),
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('too large');
  });

  it('allows setting route_geometry to null', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });
    // First set geometry
    await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { route_geometry: 'encoded-line' }, cookie);
    // Then clear it
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { route_geometry: null }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { route_geometry: string | null };
    expect(body.route_geometry).toBeNull();
  });
});

// ── Stop update — auto-invalidate geometry ───────────────────────────────────

describe('PUT /:id/stops/:stopId — geometry auto-invalidation', () => {
  it('clears route_geometry when lat changes', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });

    // Set geometry
    await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { route_geometry: 'encoded' }, cookie);

    // Change lat — should auto-clear geometry
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { lat: 51 }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { route_geometry: string | null; latitude: number };
    expect(body.latitude).toBe(51);
    expect(body.route_geometry).toBeNull();
  });

  it('clears route_geometry when travel_mode changes', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route', travel_mode: 'drive' });

    // Set geometry
    await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { route_geometry: 'encoded' }, cookie);

    // Change travel_mode — should auto-clear geometry
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { travel_mode: 'walk' }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { route_geometry: string | null; travel_mode: string };
    expect(body.travel_mode).toBe('walk');
    expect(body.route_geometry).toBeNull();
  });

  it('preserves route_geometry when only name changes', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });

    // Set geometry
    await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { route_geometry: 'encoded' }, cookie);

    // Change name only — should keep geometry
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { name: 'Renamed' }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { route_geometry: string | null; name: string };
    expect(body.name).toBe('Renamed');
    expect(body.route_geometry).toBe('encoded');
  });

  it('does not auto-clear geometry when route_geometry is explicitly set alongside lat', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'R', lat: 50, lng: 10, type: 'route' });

    // Set both lat and route_geometry — explicit geometry takes precedence
    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', {
      lat: 55, route_geometry: 'new-encoded',
    }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { route_geometry: string | null; latitude: number };
    expect(body.latitude).toBe(55);
    expect(body.route_geometry).toBe('new-encoded');
  });
});

// ── Stop update — RBAC ──────────────────────────────────────────────────────

describe('PUT /:id/stops/:stopId — role-based access', () => {
  it('viewer cannot update stops (returns 403)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const stopId = await createStop(ownerCookie, mapId, { name: 'S', lat: 50, lng: 10 });

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, viewerId, 'viewer', crypto.randomUUID()).run();

    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { name: 'Hacked' }, viewerCookie);
    expect(res.status).toBe(403);
  });

  it('editor can update stops (returns 200)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const stopId = await createStop(ownerCookie, mapId, { name: 'S', lat: 50, lng: 10 });

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, editorId, 'editor', crypto.randomUUID()).run();

    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', { name: 'Editor Edit' }, editorCookie);
    expect(res.status).toBe(200);
  });

  it('returns 404 for stop from a different map', async () => {
    const { cookie } = await createTestSession();
    const mapId1 = await createMap(cookie, 'Map 1');
    const mapId2 = await createMap(cookie, 'Map 2');
    const stopId = await createStop(cookie, mapId1, { name: 'S1', lat: 50, lng: 10 });

    // Try to update stop from map1 using map2's route
    const res = await jsonRequest(`/api/maps/${mapId2}/stops/${stopId}`, 'PUT', { name: 'Cross-map' }, cookie);
    expect(res.status).toBe(404);
  });
});

// ── Stop delete — RBAC ──────────────────────────────────────────────────────

describe('DELETE /:id/stops/:stopId — role-based access', () => {
  it('viewer cannot delete stops (returns 403)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const stopId = await createStop(ownerCookie, mapId, { name: 'S', lat: 50, lng: 10 });

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, viewerId, 'viewer', crypto.randomUUID()).run();

    const res = await request(`/api/maps/${mapId}/stops/${stopId}`, {
      method: 'DELETE', headers: { cookie: viewerCookie },
    });
    expect(res.status).toBe(403);
  });

  it('editor can delete stops (returns 200)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const stopId = await createStop(ownerCookie, mapId, { name: 'S', lat: 50, lng: 10 });

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, editorId, 'editor', crypto.randomUUID()).run();

    const res = await request(`/api/maps/${mapId}/stops/${stopId}`, {
      method: 'DELETE', headers: { cookie: editorCookie },
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 for stop from a different map', async () => {
    const { cookie } = await createTestSession();
    const mapId1 = await createMap(cookie, 'Map 1');
    const mapId2 = await createMap(cookie, 'Map 2');
    const stopId = await createStop(cookie, mapId1, { name: 'S1', lat: 50, lng: 10 });

    const res = await request(`/api/maps/${mapId2}/stops/${stopId}`, {
      method: 'DELETE', headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});

// ── Stop delete — position re-compaction edge cases ─────────────────────────

describe('DELETE /:id/stops/:stopId — re-compaction edge cases', () => {
  it('deleting the last stop leaves no gaps', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const s1 = await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });
    const s2 = await createStop(cookie, mapId, { name: 'B', lat: 51, lng: 11, type: 'route', travel_mode: 'drive' });
    await createStop(cookie, mapId, { name: 'C', lat: 52, lng: 12, type: 'route', travel_mode: 'walk' });

    // Delete last stop (position 2)
    const lastStopRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const mapData = (await lastStopRes.json()) as { stops: Array<{ id: string; position: number }> };
    const lastStop = mapData.stops.find(s => s.position === 2)!;

    await request(`/api/maps/${mapId}/stops/${lastStop.id}`, { method: 'DELETE', headers: { cookie } });

    const afterRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const after = (await afterRes.json()) as { stops: Array<{ position: number }> };
    expect(after.stops.length).toBe(2);
    expect(after.stops[0].position).toBe(0);
    expect(after.stops[1].position).toBe(1);
  });

  it('deleting the first stop re-compacts correctly', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const s1 = await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });
    await createStop(cookie, mapId, { name: 'B', lat: 51, lng: 11, type: 'route', travel_mode: 'drive' });
    await createStop(cookie, mapId, { name: 'C', lat: 52, lng: 12, type: 'route', travel_mode: 'walk' });

    await request(`/api/maps/${mapId}/stops/${s1}`, { method: 'DELETE', headers: { cookie } });

    const afterRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const after = (await afterRes.json()) as { stops: Array<{ position: number; name: string }> };
    expect(after.stops.length).toBe(2);
    expect(after.stops[0].position).toBe(0);
    expect(after.stops[0].name).toBe('B');
    expect(after.stops[1].position).toBe(1);
    expect(after.stops[1].name).toBe('C');
  });

  it('deleting the only stop leaves map with empty stops', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, { name: 'Only', lat: 50, lng: 10 });

    await request(`/api/maps/${mapId}/stops/${stopId}`, { method: 'DELETE', headers: { cookie } });

    const afterRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const after = (await afterRes.json()) as { stops: unknown[] };
    expect(after.stops.length).toBe(0);
  });

  it('nullifies travel_mode on point promoted to position 0', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    // Create a route as first stop, then a point
    const r1 = await createStop(cookie, mapId, { name: 'Route', lat: 50, lng: 10, type: 'route', travel_mode: 'drive' });

    // Manually insert a point at position 1 with a travel_mode (shouldn't normally happen,
    // but tests the safety guard in the DELETE handler)
    const pointId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO stops (id, map_id, position, type, name, latitude, longitude, travel_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(pointId, mapId, 1, 'point', 'P', 51, 11, 'walk', new Date().toISOString()).run();

    // Delete the route at position 0 — point gets promoted, travel_mode should be nulled
    await request(`/api/maps/${mapId}/stops/${r1}`, { method: 'DELETE', headers: { cookie } });

    const afterRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const after = (await afterRes.json()) as { stops: Array<{ id: string; position: number; travel_mode: string | null; type: string }> };
    const promoted = after.stops.find(s => s.id === pointId)!;
    expect(promoted.position).toBe(0);
    expect(promoted.travel_mode).toBeNull();
  });
});

// ── Reorder — edge cases ────────────────────────────────────────────────────

describe('PUT /:id/stops/reorder — edge cases', () => {
  it('returns 400 for malformed JSON', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await rawRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', 'nope', cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 when order is not an array', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', { order: 'abc' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 with duplicate stop IDs', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const s1 = await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [s1, s1],
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('duplicate');
  });

  it('returns 400 when order contains extra IDs not in map', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const s1 = await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [s1, 'fake-id'],
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not found');
  });

  it('returns 400 when order is missing some stops', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const s1 = await createStop(cookie, mapId, { name: 'A', lat: 50, lng: 10 });
    await createStop(cookie, mapId, { name: 'B', lat: 51, lng: 11, type: 'route', travel_mode: 'drive' });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [s1],
    }, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('all stop IDs');
  });

  it('viewer cannot reorder (returns 403)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const s1 = await createStop(ownerCookie, mapId, { name: 'A', lat: 50, lng: 10 });

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, viewerId, 'viewer', crypto.randomUUID()).run();

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [s1],
    }, viewerCookie);
    expect(res.status).toBe(403);
  });

  it('reorder with single stop is a no-op that succeeds', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const s1 = await createStop(cookie, mapId, { name: 'Only', lat: 50, lng: 10 });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [s1],
    }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; position: number }>;
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(s1);
    expect(body[0].position).toBe(0);
  });

  it('nullifies travel_mode on point moved to position 0', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    // Route first, then a point with no travel_mode
    const r1 = await createStop(cookie, mapId, { name: 'Route', lat: 50, lng: 10, type: 'route', travel_mode: 'drive' });

    // Manually insert point at position 1 with erroneous travel_mode
    const pointId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO stops (id, map_id, position, type, name, latitude, longitude, travel_mode, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(pointId, mapId, 1, 'point', 'P', 51, 11, 'walk', new Date().toISOString()).run();

    // Reorder: point first, route second
    const res = await jsonRequest(`/api/maps/${mapId}/stops/reorder`, 'PUT', {
      order: [pointId, r1],
    }, cookie);
    expect(res.status).toBe(200);

    const mapRes = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    const mapData = (await mapRes.json()) as { stops: Array<{ id: string; travel_mode: string | null; position: number }> };
    const first = mapData.stops.find(s => s.position === 0)!;
    expect(first.id).toBe(pointId);
    expect(first.travel_mode).toBeNull();
  });
});

// ── GET /api/maps — listing edge cases ──────────────────────────────────────

describe('GET /api/maps — listing edge cases', () => {
  it('returns empty array when user has no maps', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/maps', { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('includes shared maps with correct role', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createMap(ownerCookie, 'Shared to Viewer');

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, viewerId, 'viewer', crypto.randomUUID()).run();

    const res = await request('/api/maps', { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; role: string }>;
    const shared = body.find(m => m.id === mapId);
    expect(shared).toBeDefined();
    expect(shared!.role).toBe('viewer');
  });

  it('maps include stops in listing', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    await createStop(cookie, mapId, { name: 'S1', lat: 50, lng: 10 });
    await createStop(cookie, mapId, { name: 'S2', lat: 51, lng: 11, type: 'route', travel_mode: 'drive' });

    const res = await request('/api/maps', { headers: { cookie } });
    const body = (await res.json()) as Array<{ id: string; stops: unknown[] }>;
    const map = body.find(m => m.id === mapId);
    expect(map).toBeDefined();
    expect(map!.stops.length).toBe(2);
  });
});

// ── GET /api/maps/:id — access edge cases ───────────────────────────────────

describe('GET /api/maps/:id — access edge cases', () => {
  it('owner sees role=owner', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await request(`/api/maps/${mapId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe('owner');
  });

  it('editor sees role=editor', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, editorId, 'editor', crypto.randomUUID()).run();

    const res = await request(`/api/maps/${mapId}`, { headers: { cookie: editorCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe('editor');
  });

  it('viewer sees role=viewer', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, viewerId, 'viewer', crypto.randomUUID()).run();

    const res = await request(`/api/maps/${mapId}`, { headers: { cookie: viewerCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe('viewer');
  });

  it('unauthenticated user sees role=public for public map', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'Public');
    await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', { visibility: 'public' }, cookie);

    const res = await request(`/api/maps/${mapId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe('public');
  });

  it('unauthenticated user gets 404 for private map', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie, 'Private');

    const res = await request(`/api/maps/${mapId}`);
    expect(res.status).toBe(404);
  });
});

// ── Route stop with full destination fields ──────────────────────────────────

describe('Route stop — destination fields', () => {
  it('creates route with all destination fields', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const res = await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      name: 'Start', lat: 52.52, lng: 13.405,
      type: 'route', travel_mode: 'drive',
      dest_name: 'End Point', dest_lat: 48.14, dest_lng: 11.58, dest_icon: 'star',
    }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      type: string; travel_mode: string;
      dest_name: string; dest_latitude: number; dest_longitude: number; dest_icon: string;
    };
    expect(body.type).toBe('route');
    expect(body.travel_mode).toBe('drive');
    expect(body.dest_name).toBe('End Point');
    expect(body.dest_latitude).toBe(48.14);
    expect(body.dest_longitude).toBe(11.58);
    expect(body.dest_icon).toBe('star');
  });

  it('updates destination fields on route stop', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const stopId = await createStop(cookie, mapId, {
      name: 'Start', lat: 52, lng: 13, type: 'route', travel_mode: 'drive',
    });

    const res = await jsonRequest(`/api/maps/${mapId}/stops/${stopId}`, 'PUT', {
      dest_name: 'Munich', dest_lat: 48.14, dest_lng: 11.58,
    }, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dest_name: string; dest_latitude: number; dest_longitude: number };
    expect(body.dest_name).toBe('Munich');
    expect(body.dest_latitude).toBe(48.14);
    expect(body.dest_longitude).toBe(11.58);
  });
});
