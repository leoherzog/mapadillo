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
 * Milestone 7: export (PDF / image).
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getAuth } from './auth.js';
import { requireAuth } from './middleware/require-auth.js';
import { optionalAuth } from './middleware/optional-auth.js';
import { rateLimit } from './middleware/rate-limit.js';
import { geocodeHandler } from './routes/geocode.js';
import { routeHandler } from './routes/route.js';
import maps from './routes/maps.js';
import sharing, { claimShareHandler } from './routes/sharing.js';
import type { AppEnv } from './types.js';
import type { Context } from 'hono';

/** Extract client IP from request headers. */
function getClientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
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
  return c.json({ status: 'ok', milestone: 7 });
});

// ── Rate limiter for auth routes ──────────────────────────────────────────
app.use('/api/auth/*', rateLimit('RATE_LIMITER_AUTH', getClientIp));

// ── Auth routes (Better Auth handler) ─────────────────────────────────────
// Use app.all so PUT/DELETE/OPTIONS (passkey plugin, sign-out) are handled.
app.all('/api/auth/*', async (c) => {
  const auth = getAuth(c.env);
  return auth!.handler(c.req.raw);
});

// ── CSRF protection (Origin header check) ────────────────────────────────
// Validate Origin header on state-changing requests to prevent cross-site
// request forgery. Skips webhooks (external services). Auth routes are
// handled before CSRF runs, so no skip is needed for them.
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

// ── Claim share route (requires auth, outside /api/maps) ─────────────────
app.post('/api/shares/claim/:token', requireAuth, claimShareHandler);

// ── Map routes (Milestone 4+6) ──────────────────────────────────────────
// GET /api/maps/:id uses optional auth (allows public map viewing).
// All other /api/maps routes require auth.
app.use('/api/maps/*', async (c, next) => {
  // Allow unauthenticated access for GET /api/maps/:id (public maps)
  const path = c.req.path;
  const method = c.req.method;
  // Match GET /api/maps/<uuid> but not /api/maps/<uuid>/stops etc.
  if (method === 'GET' && /^\/api\/maps\/[^/]+$/.test(path)) {
    // Rate limit unauthenticated public map access: 60 req/min per IP
    const { success } = await c.env.RATE_LIMITER_PUBLIC.limit({ key: `public-map:${getClientIp(c)}` });
    if (!success) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    return optionalAuth(c, next);
  }
  return requireAuth(c, next);
});
app.use('/api/maps', async (c, next) => {
  // Only apply requireAuth to the exact /api/maps path (list + create).
  // Sub-routes like /api/maps/:id are already handled by the /api/maps/* middleware above.
  if (c.req.path === '/api/maps') return requireAuth(c, next);
  return next();
});
app.route('/api/maps', maps);
app.route('/api/maps', sharing);

// ── Geocoding proxy (Milestone 3) ─────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
const proxyRateLimit = rateLimit('RATE_LIMITER_PROXY', (c) => c.get('user')!.id);
app.get('/api/geocode', requireAuth, proxyRateLimit, geocodeHandler);

// ── Routing proxy (Milestone 5) ───────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
app.post('/api/route', requireAuth, proxyRateLimit, routeHandler);

export default app;
