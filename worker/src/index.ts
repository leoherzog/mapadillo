/**
 * Mapadillo — Cloudflare Worker
 *
 * Hono router serving:
 * - /api/auth/*  → Better Auth (OAuth, Passkey, sessions)
 * - /api/*       → API routes (maps, stops, sharing, proxy, print)
 * - Everything else → served from ../dist by Workers Static Assets with SPA fallback;
 *   run_worker_first = ["/api/*"] keeps those requests out of this Worker.
 */

import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
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

/** Client IP from Cloudflare's cf-connecting-ip header; "unknown" when absent. */
export function getClientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown';
}

const payloadTooLarge = (c: Context) => c.json({ error: 'Payload too large' }, 413);

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
app.notFound((c) => c.json({ error: 'Not found' }, 404));

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

// ── Rate limiter for auth routes ──────────────────────────────────────────
// The session probe runs on every load and refocus; only credential routes need the brute-force limit.
const authRateLimit = rateLimit('RATE_LIMITER_AUTH', getClientIp);
app.use('/api/auth/*', (c, next) =>
  c.req.method === 'GET' && c.req.path === '/api/auth/get-session' ? next() : authRateLimit(c, next));
// Registered before the handler: auth paths never reach the /api/* middleware below.
app.use('/api/auth/*', bodyLimit({ maxSize: 64 * 1024, onError: payloadTooLarge }));

// ── Auth routes (Better Auth handler) ─────────────────────────────────────
// Use app.all so PUT/DELETE/OPTIONS (passkey plugin, sign-out) are handled.
app.all('/api/auth/*', async (c) => {
  const auth = getAuth(c.env);
  return auth.handler(c.req.raw);
});

// ── CSRF protection (Origin header check) ────────────────────────────────
// Validate Origin header on state-changing requests to prevent cross-site
// request forgery. Skips webhooks: Stripe proves identity by signature, and
// Prodigi callbacks are unauthenticated and only trigger a re-read from the Prodigi API.
// Auth routes are handled before CSRF runs, so no skip is needed for them.
// Admin routes are not skipped — they still get called from our own origin
// and should carry a valid Origin header.
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
  if (referer) return URL.parse(referer)?.origin === expectedOrigin ? next() : c.json({ error: 'Forbidden' }, 403);
  return c.json({ error: 'Forbidden' }, 403);
});

// Image uploads are capped in their handler; JSON bodies stay well under 2MB (route_geometry is capped at 1MB).
const jsonBodyLimit = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: payloadTooLarge });
app.use('/api/*', (c, next) => (c.req.path.startsWith('/api/images/') ? next() : jsonBodyLimit(c, next)));

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
// Checkout, print-quote and orders require auth; checkout and print-quote share a 30/min per-user budget.
// Image uploads get their own 30/min per-user budget.
// Admin order routes use Bearer token auth internally.
const orderRateLimit = rateLimit('RATE_LIMITER_PROXY', (c) => `orders:${c.get('user')!.id}`);
app.use('/api/images/:mapId', requireAuth, rateLimit('RATE_LIMITER_PROXY', (c) => `upload:${c.get('user')!.id}`));
app.use('/api/checkout', requireAuth, orderRateLimit);
app.use('/api/print-quote', requireAuth, orderRateLimit);
app.use('/api/orders/*', requireAuth);
app.route('/api', orderRoutes);

// ── Webhook routes ──────────────────────────────────────────────────────
// No auth middleware: Stripe events are signature-verified; Prodigi callbacks only trigger a re-read from the Prodigi API.
// Prodigi callbacks are rate-limited per IP because each one costs a Prodigi API call.
app.use('/api/webhooks/prodigi', rateLimit('RATE_LIMITER_PUBLIC', (c) => `prodigi-cb:${getClientIp(c)}`));
app.route('/api/webhooks', webhookRoutes);

// ── Geocoding proxy ─────────────────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
const proxyRateLimit = rateLimit('RATE_LIMITER_PROXY', (c) => c.get('user')!.id);
app.get('/api/geocode', requireAuth, proxyRateLimit, geocodeHandler);

// ── Routing proxy ───────────────────────────────────────────────────────
// Auth required + 30 req/min per user via RATE_LIMITER_PROXY.
app.post('/api/route', requireAuth, proxyRateLimit, routeHandler);

export default app;
