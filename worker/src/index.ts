/**
 * Mapadillo — Cloudflare Worker
 *
 * Hono router serving:
 * - /api/auth/*  → Better Auth (OAuth, Passkey, sessions)
 * - /api/*       → API routes (maps, stops, sharing, proxy, print)
 * - Everything else → Static assets (Vite-built SPA) via the ASSETS binding,
 *   with SPA fallback to index.html for client-side routes.
 *   (Handled automatically by wrangler.toml: run_worker_first = ["/api/*"])
 *
 * Milestone 5: route drawing.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getAuth } from './auth.js';
import { requireAuth } from './middleware/require-auth.js';
import { geocodeHandler } from './routes/geocode.js';
import { routeHandler } from './routes/route.js';
import maps from './routes/maps.js';
import type { AppEnv } from './types.js';

const app = new Hono<AppEnv>();

// ── Global error handler ──────────────────────────────────────────────────
app.onError((err, c) => {
  console.error(JSON.stringify({
    message: 'Unhandled error',
    error: err.message,
    path: c.req.path,
  }));
  return c.json({ error: 'Internal server error' }, 500);
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use('*', logger());

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', milestone: 5 });
});

// ── Rate limiter for auth routes ──────────────────────────────────────────
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
app.use('/api/maps/*', requireAuth);
app.use('/api/maps', requireAuth);
app.route('/api/maps', maps);

// ── Geocoding proxy (Milestone 3) ─────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
app.get(
  '/api/geocode',
  requireAuth,
  async (c, next) => {
    const { success } = await c.env.RATE_LIMITER_PROXY.limit({
      key: c.get('user').id,
    });
    if (!success) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
  },
  geocodeHandler,
);

// ── Routing proxy (Milestone 5) ───────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
app.post(
  '/api/route',
  requireAuth,
  async (c, next) => {
    const { success } = await c.env.RATE_LIMITER_PROXY.limit({
      key: c.get('user').id,
    });
    if (!success) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
  },
  routeHandler,
);

export default app;
