/**
 * Shared test helpers — schema setup and session creation.
 *
 * Single source of truth for the D1 schema used by all worker test files.
 * Eliminates drift between test suites when migrations are updated.
 */
import { env } from 'cloudflare:test';
import app from './index.js';

// ── Schema setup ────────────────────────────────────────────────────────────

/** Apply all D1 table and index definitions. Call in beforeAll(). */
export async function applyTestSchema(): Promise<void> {
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
    env.DB.prepare('CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE RESTRICT, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT, product_type TEXT NOT NULL, product_sku TEXT NOT NULL, poster_size TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending_payment\', stripe_session_id TEXT UNIQUE, prodigi_order_id TEXT, image_url TEXT, shipping_address TEXT, subtotal INTEGER, shipping_cost INTEGER, currency TEXT NOT NULL DEFAULT \'usd\', tracking_url TEXT, discord_notified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_orders_map_id ON orders(map_id)'),
  ]);
}

// ── Request helper ──────────────────────────────────────────────────────────

/** Send a request to the Hono app with CSRF Origin header auto-injected. */
export function request(path: string, init?: RequestInit) {
  if (init?.method && init.method !== 'GET' && init.method !== 'HEAD') {
    const headers = new Headers(init.headers);
    if (!headers.has('origin')) headers.set('origin', 'http://localhost');
    init = { ...init, headers };
  }
  return app.request(path, init, env);
}

// ── Session helper ──────────────────────────────────────────────────────────

/**
 * Create a test user + session directly in D1 and return the signed session
 * cookie string and the userId. Mirrors what Better Auth does internally.
 */
export async function createTestSession(): Promise<{ cookie: string; userId: string }> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const rawToken = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)',
    ).bind(userId, 'Test User', `test-${userId.slice(0, 8)}@example.com`, now, now),
    env.DB.prepare(
      'INSERT INTO "session" (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(sessionId, expiresAt, rawToken, now, now, userId),
  ]);

  const secret = (env as unknown as Record<string, string>).BETTER_AUTH_SECRET;
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

  return { cookie: `better-auth.session_token=${encodeURIComponent(signedValue)}`, userId };
}

// ── JSON request helper ─────────────────────────────────────────────────────

/** JSON POST/PUT/PATCH helper with cookie auth. */
export function jsonRequest(path: string, method: string, body: unknown, cookie: string) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}
