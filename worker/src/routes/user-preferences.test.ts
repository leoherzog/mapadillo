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
  ]);
});

/**
 * Helper: call a route on the Hono app with the Workers env injected.
 */
function request(path: string, init?: RequestInit) {
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
    const headers = new Headers(init.headers);
    if (!headers.has('origin')) headers.set('origin', 'http://localhost');
    init = { ...init, headers };
  }
  return app.request(path, init, env);
}

/**
 * Create a test user + session directly in D1 and return the signed session
 * cookie string and the userId.
 */
async function createTestSession(): Promise<{ cookie: string; userId: string }> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const rawToken = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)'
    ).bind(userId, 'Test User', `test-${userId}@example.com`, now, now),
    env.DB.prepare(
      'INSERT INTO "session" (id, token, userId, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
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

/** JSON PUT helper */
function jsonPut(path: string, body: unknown, cookie: string) {
  return request(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      cookie,
    },
    body: JSON.stringify(body),
  });
}

// ── GET /api/user/preferences ─────────────────────────────────────────────────

describe('GET /api/user/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request('/api/user/preferences');
    expect(res.status).toBe(401);
  });

  it('returns default units "km" for a new user', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/user/preferences', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'km' });
  });

  it('returns stored units after they have been changed', async () => {
    const { cookie } = await createTestSession();

    // Change to miles
    await jsonPut('/api/user/preferences', { units: 'mi' }, cookie);

    // Verify GET returns the updated value
    const res = await request('/api/user/preferences', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });
  });
});

// ── PUT /api/user/preferences ─────────────────────────────────────────────────

describe('PUT /api/user/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request('/api/user/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units: 'mi' }),
    });
    expect(res.status).toBe(401);
  });

  it('updates units to "mi" and returns the new value', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonPut('/api/user/preferences', { units: 'mi' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });
  });

  it('updates units to "km" and returns the new value', async () => {
    const { cookie } = await createTestSession();

    // First set to mi, then back to km
    await jsonPut('/api/user/preferences', { units: 'mi' }, cookie);
    const res = await jsonPut('/api/user/preferences', { units: 'km' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'km' });
  });

  it('returns 400 for invalid units value', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonPut('/api/user/preferences', { units: 'meters' }, cookie);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid units');
  });

  it('returns 400 for empty string units', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonPut('/api/user/preferences', { units: '' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/user/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost',
        cookie,
      },
      body: 'not valid json{{{',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns current preferences when body has no units field', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonPut('/api/user/preferences', {}, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'km' });
  });

  it('ignores unknown fields and still processes units', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonPut('/api/user/preferences', { units: 'mi', theme: 'dark' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });
  });

  it('persists changes across separate GET requests', async () => {
    const { cookie } = await createTestSession();

    // Update
    await jsonPut('/api/user/preferences', { units: 'mi' }, cookie);

    // Verify with GET
    const res = await request('/api/user/preferences', {
      headers: { cookie },
    });
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });

    // Update again
    await jsonPut('/api/user/preferences', { units: 'km' }, cookie);

    // Verify again
    const res2 = await request('/api/user/preferences', {
      headers: { cookie },
    });
    const body2 = await res2.json();
    expect(body2).toEqual({ units: 'km' });
  });

  it('does not affect other users preferences', async () => {
    const session1 = await createTestSession();
    const session2 = await createTestSession();

    // User 1 sets miles
    await jsonPut('/api/user/preferences', { units: 'mi' }, session1.cookie);

    // User 2 should still have default km
    const res = await request('/api/user/preferences', {
      headers: { cookie: session2.cookie },
    });
    const body = await res.json();
    expect(body).toEqual({ units: 'km' });
  });
});

// ── CSRF protection ───────────────────────────────────────────────────────────

describe('CSRF protection on PUT /api/user/preferences', () => {
  it('returns 403 when Origin header is missing on PUT', async () => {
    const { cookie } = await createTestSession();
    // Manually construct request without origin header
    const res = await app.request('/api/user/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ units: 'mi' }),
    }, env);
    expect(res.status).toBe(403);
  });

  it('returns 403 when Origin header does not match', async () => {
    const { cookie } = await createTestSession();
    const res = await app.request('/api/user/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://evil.com',
        cookie,
      },
      body: JSON.stringify({ units: 'mi' }),
    }, env);
    expect(res.status).toBe(403);
  });
});
