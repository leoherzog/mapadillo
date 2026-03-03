/**
 * kids-map — Cloudflare Worker
 *
 * Hono router serving:
 * - /api/auth/*  → Better Auth (OAuth, Passkey, sessions)
 * - /api/*       → API routes (maps, stops, sharing, proxy, print)
 * - Everything else → Static assets (Vite-built SPA) via the ASSETS binding,
 *   with SPA fallback to index.html for client-side routes.
 *   (Handled automatically by wrangler.toml: run_worker_first = ["/api/*"])
 *
 * Milestone 2: authentication via Better Auth + stub routes for M3–8.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getAuth } from './auth.js';
import { requireAuth } from './middleware/require-auth.js';
import type { AppEnv } from './types.js';

const app = new Hono<AppEnv>();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use('*', logger());

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', milestone: 2 });
});

// ── Rate limiter for auth routes (M6) ────────────────────────────────────
app.use('/api/auth/*', async (c, next) => {
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for') ??
    'unknown';
  const { success } = await c.env.RATE_LIMITER_AUTH.limit({ key: ip });
  if (!success) {
    return c.json({ error: 'Too many requests' }, 429);
  }
  await next();
});

// ── Auth routes (Better Auth handler) ─────────────────────────────────────
// Use app.all so PUT/DELETE/OPTIONS (passkey plugin, sign-out) are handled.
app.all('/api/auth/*', async (c) => {
  const auth = getAuth(c.env);
  return auth.handler(c.req.raw);
});

// ── Map routes (Milestone 4) ───────────────────────────────────────────────
// Protected by requireAuth — returns 401 without valid session.
app.get('/api/maps', requireAuth, (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

app.post('/api/maps', requireAuth, (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

// TODO(M6): Replace requireAuth with optional auth — public maps should be
// served without a session; private maps require one. See PLAN.md "Sharing".
app.get('/api/maps/:id', requireAuth, (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

app.put('/api/maps/:id', requireAuth, (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

app.delete('/api/maps/:id', requireAuth, (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

// ── Geocoding proxy (Milestone 3) ─────────────────────────────────────────
app.get('/api/geocode', (c) => {
  return c.json({ error: 'Geocoding not implemented yet (Milestone 3)' }, 501);
});

// ── Routing proxy (Milestone 5) ───────────────────────────────────────────
app.post('/api/route', (c) => {
  return c.json({ error: 'Routing not implemented yet (Milestone 5)' }, 501);
});

export default app;
