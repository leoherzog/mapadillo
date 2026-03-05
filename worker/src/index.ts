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
import { geocodeHandler } from './routes/geocode.js';
import { routeHandler } from './routes/route.js';
import maps from './routes/maps.js';
import sharing from './routes/sharing.js';
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
  return c.json({ status: 'ok', milestone: 7 });
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
  return auth!.handler(c.req.raw);
});

// ── CSRF protection (Origin header check) ────────────────────────────────
// Validate Origin header on state-changing requests to prevent cross-site
// request forgery. Skips webhooks (external services) and auth routes
// (Better Auth handles its own CSRF).
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  if (c.req.path.startsWith('/api/webhooks/') || c.req.path.startsWith('/api/auth/')) {
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
app.post('/api/shares/claim/:token', requireAuth, async (c) => {
  const userId = c.get('user')!.id;

  // Rate limit: 20 claim attempts per minute per user
  const { success: claimAllowed } = await c.env.RATE_LIMITER_PUBLIC.limit({ key: `claim:${userId}` });
  if (!claimAllowed) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT * FROM map_shares WHERE claim_token = ?',
  ).bind(token).first<{ id: string; map_id: string; user_id: string | null; role: string; claim_token: string | null }>();

  if (!share) {
    return c.json({ error: 'Invalid or expired invite link' }, 404);
  }

  // Already claimed by this user — treat as success
  if (share.user_id === userId) {
    return c.json({ map_id: share.map_id });
  }

  // Owner clicking their own invite — just redirect, don't create a redundant share
  const map = await c.env.DB.prepare('SELECT owner_id FROM maps WHERE id = ?')
    .bind(share.map_id).first<{ owner_id: string }>();
  if (map && map.owner_id === userId) {
    return c.json({ map_id: share.map_id });
  }

  // Already claimed by another user
  if (share.user_id !== null) {
    return c.json({ error: 'This invite has already been claimed' }, 403);
  }

  // Check if the user already has a different share for the same map.
  // If so, keep the higher-privilege role (editor > viewer), delete the other,
  // and return success without creating a duplicate (UNIQUE(map_id, user_id)).
  const existingShare = await c.env.DB.prepare(
    'SELECT id, role FROM map_shares WHERE map_id = ? AND user_id = ?',
  ).bind(share.map_id, userId).first<{ id: string; role: string }>();

  if (existingShare) {
    const roleRank: Record<string, number> = { editor: 2, viewer: 1 };
    const existingRank = roleRank[existingShare.role] ?? 1;
    const incomingRank = roleRank[share.role] ?? 1;

    if (incomingRank > existingRank) {
      // Incoming share has higher privilege — replace the existing one
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM map_shares WHERE id = ?').bind(existingShare.id),
        c.env.DB.prepare(
          'UPDATE map_shares SET user_id = ?, claim_token = NULL WHERE id = ?',
        ).bind(userId, share.id),
      ]);
    } else {
      // Existing share has equal or higher privilege — just nullify the incoming token
      await c.env.DB.prepare(
        'UPDATE map_shares SET claim_token = NULL WHERE id = ?',
      ).bind(share.id).run();
    }
    return c.json({ map_id: share.map_id });
  }

  // Claim it and nullify the token so it cannot be reused.
  // Include user_id IS NULL and claim_token = ? in the WHERE clause to guard
  // against a race condition where two requests try to claim the same token.
  const claimResult = await c.env.DB.prepare(
    'UPDATE map_shares SET user_id = ?, claim_token = NULL WHERE id = ? AND user_id IS NULL AND claim_token = ?',
  ).bind(userId, share.id, share.claim_token).run();

  if (claimResult.meta.changes === 0) {
    return c.json({ error: 'This invite has already been claimed' }, 409);
  }

  return c.json({ map_id: share.map_id });
});

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
    const ip =
      c.req.header('cf-connecting-ip') ??
      c.req.header('x-forwarded-for') ??
      'unknown';
    const { success } = await c.env.RATE_LIMITER_PUBLIC.limit({ key: `public-map:${ip}` });
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
app.get(
  '/api/geocode',
  requireAuth,
  async (c, next) => {
    const { success } = await c.env.RATE_LIMITER_PROXY.limit({
      key: c.get('user')!.id,
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
      key: c.get('user')!.id,
    });
    if (!success) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
  },
  routeHandler,
);

export default app;
