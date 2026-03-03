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
    env.DB.prepare('CREATE TABLE IF NOT EXISTS "passkey" (id TEXT PRIMARY KEY NOT NULL, name TEXT, publicKey TEXT NOT NULL, userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, webauthnUserID TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, deviceType TEXT, backedUp INTEGER NOT NULL DEFAULT 0, transports TEXT, credentialID TEXT NOT NULL UNIQUE, createdAt INTEGER)'),
  ]);
});

/**
 * Helper: call a route on the Hono app with the Workers env injected.
 * Returns the Hono Response directly (no real HTTP round-trip).
 */
function request(path: string, init?: RequestInit) {
  return app.request(path, init, env);
}

/**
 * Create a test user + session directly in D1 and return the signed session
 * cookie string. Mirrors what Better Auth does internally: the cookie value
 * is `rawToken.base64(HMAC-SHA256(rawToken, secret))`, URL-encoded.
 *
 * This avoids calling any email/password auth endpoint — the app only
 * supports OAuth and Passkey auth.
 */
async function createTestSession(): Promise<string> {
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

  return `better-auth.session_token=${encodeURIComponent(signedValue)}`;
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

  it('returns status ok with milestone 2', async () => {
    const res = await request('/api/health');
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', milestone: 2 });
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

// ── Protected map routes — 401 without auth (Milestone 4 stubs) ──────────────

describe('Map routes - require auth', () => {
  it('GET /api/maps returns 401 without session', async () => {
    const res = await request('/api/maps');
    expect(res.status).toBe(401);
  });

  it('POST /api/maps returns 401 without session', async () => {
    const res = await request('/api/maps', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('GET /api/maps/:id returns 401 without session', async () => {
    const res = await request('/api/maps/abc-123');
    expect(res.status).toBe(401);
  });

  it('PUT /api/maps/:id returns 401 without session', async () => {
    const res = await request('/api/maps/abc-123', { method: 'PUT' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/maps/:id returns 401 without session', async () => {
    const res = await request('/api/maps/abc-123', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('401 response body has error message', async () => {
    const res = await request('/api/maps');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });
});

// ── Protected map routes — 501 with valid session (Milestone 4 stubs) ─────────

describe('Map routes - authenticated returns 501 stub', () => {
  let sessionCookie: string;

  beforeAll(async () => {
    sessionCookie = await createTestSession();
  });

  it('GET /api/maps returns 501 with valid session', async () => {
    const res = await request('/api/maps', {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Milestone 4');
  });

  it('POST /api/maps returns 501 with valid session', async () => {
    const res = await request('/api/maps', {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(501);
  });

  it('GET /api/maps/:id returns 501 with valid session', async () => {
    const res = await request('/api/maps/abc-123', {
      headers: { cookie: sessionCookie },
    });
    expect(res.status).toBe(501);
  });
});

// ── Geocoding stub (Milestone 3) ──────────────────────────────────────────────

describe('Geocoding stub - 501', () => {
  it('GET /api/geocode returns 501', async () => {
    const res = await request('/api/geocode');
    expect(res.status).toBe(501);
  });

  it('error body mentions Milestone 3', async () => {
    const res = await request('/api/geocode');
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Milestone 3');
  });
});

// ── Routing stub (Milestone 5) ────────────────────────────────────────────────

describe('Routing stub - 501', () => {
  it('POST /api/route returns 501', async () => {
    const res = await request('/api/route', { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('error body mentions Milestone 5', async () => {
    const res = await request('/api/route', { method: 'POST' });
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Milestone 5');
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
