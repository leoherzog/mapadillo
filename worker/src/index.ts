/**
 * Mapadillo — Cloudflare Worker
 *
 * Hono router serving:
 * - /api/auth/*  → Better Auth (OAuth, Passkey, sessions)
 * - /api/*       → API routes (maps, stops, sharing, proxy, print)
 * - Everything else → Static assets (Vite-built SPA) via the ASSETS binding,
 *   with SPA fallback to index.html for client-side routes.
 *   (Handled automatically by wrangler.toml: run_worker_first = ["/api/*"])
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getAuth } from './auth.js';
import { requireAuth, optionalAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { geocodeHandler } from './routes/geocode.js';
import { routeHandler } from './routes/route.js';
import maps from './routes/maps.js';
import sharing, { claimShareHandler } from './routes/sharing.js';
import userPreferences from './routes/user-preferences.js';
import orderRoutes from './routes/orders.js';
import webhookRoutes from './routes/webhooks.js';
import type { AppEnv } from './types.js';
import type { Context } from 'hono';

/** Extract client IP from request headers.
 *
 * x-forwarded-for is a comma-separated list "client, proxy1, proxy2, ...".
 * Only the first entry is the original client; anything else is an intermediate
 * proxy and must not be used as the rate-limit key (attackers could inject
 * entries to bypass per-IP limits). Prefer cf-connecting-ip when Cloudflare
 * sets it — it's the ground truth. */
export function getClientIp(c: Context<AppEnv>): string {
  const cf = c.req.header('cf-connecting-ip');
  if (cf) return cf;
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

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
  return c.json({ status: 'ok' });
});

// ── Rate limiter for auth routes ──────────────────────────────────────────
app.use('/api/auth/*', rateLimit('RATE_LIMITER_AUTH', getClientIp));

// ── Auth routes (Better Auth handler) ─────────────────────────────────────
// Use app.all so PUT/DELETE/OPTIONS (passkey plugin, sign-out) are handled.
app.all('/api/auth/*', async (c) => {
  const auth = getAuth(c.env);
  return auth.handler(c.req.raw);
});

// ── CSRF protection (Origin header check) ────────────────────────────────
// Validate Origin header on state-changing requests to prevent cross-site
// request forgery. Skips webhooks (external services — they prove identity
// via signature / secret). Auth routes are handled before CSRF runs, so no
// skip is needed for them. Admin routes are NOT skipped — they still get
// called from our own origin and should carry a valid Origin header.
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  if (c.req.path.startsWith('/api/webhooks/')) {
    return next();
  }

  const expectedOrigin = new URL(c.env.BETTER_AUTH_URL).origin;
  const origin = c.req.header('origin');
  if (origin) {
    if (origin !== expectedOrigin) return c.json({ error: 'Forbidden' }, 403);
    return next();
  }
  const referer = c.req.header('referer');
  if (referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) return c.json({ error: 'Forbidden' }, 403);
      return next();
    } catch {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }
  return c.json({ error: 'Forbidden' }, 403);
});

// ── User preferences ─────────────────────────────────────────────────────
app.use('/api/user/*', requireAuth);
app.route('/api/user', userPreferences);

// ── Claim share route (requires auth, outside /api/maps) ─────────────────
app.post(
  '/api/shares/claim/:token',
  requireAuth,
  rateLimit('RATE_LIMITER_PUBLIC', (c) => `claim:${c.get('user')!.id}`),
  claimShareHandler,
);

// ── Map routes ──────────────────────────────────────────────────────────
// GET /api/maps/:id uses optional auth (allows public map viewing).
// Every other path under /api/maps, including the bare /api/maps, requires auth.
const publicMapRateLimit = rateLimit('RATE_LIMITER_PUBLIC', (c) => `public-map:${getClientIp(c)}`);
app.use('/api/maps/*', async (c, next) => {
  // Match GET /api/maps/<uuid> but not /api/maps/<uuid>/stops etc.
  if (c.req.method === 'GET' && /^\/api\/maps\/[^/]+$/.test(c.req.path)) {
    return publicMapRateLimit(c, async () => { await optionalAuth(c, next); });
  }
  return requireAuth(c, next);
});
app.route('/api/maps', maps);
app.route('/api/maps', sharing);

// ── Order + image routes ────────────────────────────────────────────────
// Image URLs are /api/images/<mapId>/<uuid>.png, so two-segment GETs stay public
// (unguessable keys, served from R2). The single-segment guard below covers the
// POST upload and also rejects single-segment GETs.
// Checkout, print-quote, and orders require auth.
// Admin order routes use Bearer token auth internally.
app.use('/api/images/:mapId', requireAuth);
app.use('/api/checkout', requireAuth);
app.use('/api/print-quote', requireAuth);
app.use('/api/orders', requireAuth);
app.use('/api/orders/*', requireAuth);
app.route('/api', orderRoutes);

// ── Webhook routes ──────────────────────────────────────────────────────
// No auth middleware — webhooks verify signatures/secrets internally.
app.route('/api/webhooks', webhookRoutes);

// ── Geocoding proxy ─────────────────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
const proxyRateLimit = rateLimit('RATE_LIMITER_PROXY', (c) => c.get('user')!.id);
app.get('/api/geocode', requireAuth, proxyRateLimit, geocodeHandler);

// ── Routing proxy ───────────────────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
app.post('/api/route', requireAuth, proxyRateLimit, routeHandler);

export default app;
