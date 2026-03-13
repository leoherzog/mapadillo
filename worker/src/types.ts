/**
 * Shared types for the Cloudflare Worker app.
 */

import type { SessionUser } from '../../shared/types.js';

// ── Env bindings (generated via `wrangler types`) ─────────────────────────
// Until `wrangler types` is run after provisioning real resources, we declare
// the interface manually. Run `npm run types` in /worker after provisioning.
export interface Env {
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
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  FACEBOOK_CLIENT_ID: string;
  FACEBOOK_CLIENT_SECRET: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  PRODIGI_API_KEY: string;
  PRODIGI_SANDBOX: string;
  ORS_API_KEY: string;
  ADMIN_SECRET: string;
  DISCORD_WEBHOOK_URL: string;
  PRODIGI_WEBHOOK_SECRET: string;
}

export type { SessionUser } from '../../shared/types.js';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user?: SessionUser;
  };
};
