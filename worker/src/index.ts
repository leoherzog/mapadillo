/**
 * Kids Roadtrip Map — Cloudflare Worker
 *
 * Hono router serving:
 * - /api/*  → API routes (auth, maps, stops, sharing, proxy, print)
 * - Everything else → Static assets (Vite-built SPA) via the ASSETS binding,
 *   with SPA fallback to index.html for client-side routes.
 *   (Handled automatically by wrangler.toml: run_worker_first = ["/api/*"])
 *
 * Milestone 1: scaffold only — health check route + 501 stubs.
 * Full routes added in Milestones 2–8.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';

// ── Env bindings (generated via `wrangler types`) ─────────────────────────
// Until `wrangler types` is run after provisioning real resources, we declare
// the interface manually. Run `npm run types` in /worker after provisioning.
interface Env {
  // Static assets (Workers Static Assets)
  ASSETS: Fetcher;
  // D1 relational database
  DB: D1Database;
  // KV cache for geocoding + routing
  API_CACHE: KVNamespace;
  // R2 bucket for print images
  ROADTRIP_PRINTS: R2Bucket;
  // Rate limiters
  RATE_LIMITER_PUBLIC: RateLimit;
  RATE_LIMITER_PROXY: RateLimit;
  RATE_LIMITER_AUTH: RateLimit;
  // Secrets (set via `wrangler secret put`)
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FACEBOOK_CLIENT_ID: string;
  FACEBOOK_CLIENT_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  PRODIGI_API_KEY: string;
  ORS_API_KEY: string;
  ADMIN_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use('*', logger());

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', milestone: 1 });
});

// ── Auth routes (Milestone 2) ──────────────────────────────────────────────
app.all('/api/auth/*', (c) => {
  return c.json({ error: 'Auth not implemented yet (Milestone 2)' }, 501);
});

// ── Map routes (Milestone 4) ───────────────────────────────────────────────
app.get('/api/maps', (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

app.post('/api/maps', (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

app.get('/api/maps/:id', (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

app.put('/api/maps/:id', (c) => {
  return c.json({ error: 'Maps not implemented yet (Milestone 4)' }, 501);
});

app.delete('/api/maps/:id', (c) => {
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
