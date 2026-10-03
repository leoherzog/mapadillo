/**
 * Shared worker test helpers: schema setup, requests, sessions and D1 fixtures.
 * The schema comes from the real migrations in src/db/migrations via the TEST_MIGRATIONS binding.
 */
import { env, applyD1Migrations } from 'cloudflare:test';
import app from './index.js';

// ── Schema setup ────────────────────────────────────────────────────────────

/** Apply the D1 migrations. Idempotent; call in beforeAll(). */
export async function applyTestSchema(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
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

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Create a map via the API. @returns the map id */
export async function createMap(cookie: string, name = 'Test Map'): Promise<string> {
  const res = await jsonRequest('/api/maps', 'POST', { name }, cookie);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Create a stop via the API. @returns the stop id */
export async function createStop(
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

/** Insert a claimed share with no claim token directly into D1. @returns the share id */
export async function grantShare(mapId: string, userId: string, role: 'viewer' | 'editor'): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, ?)',
  ).bind(id, mapId, userId, role).run();
  return id;
}
