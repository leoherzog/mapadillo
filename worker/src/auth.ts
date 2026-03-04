/**
 * Better Auth server configuration for Cloudflare Workers.
 *
 * The betterAuth() instance is cached at module level (M8) because
 * constructing it is expensive (router, plugins, DB adapter). In Workers,
 * module-level state persists within an isolate for the lifetime of that
 * isolate, so subsequent requests reuse the same instance.
 *
 * All URL-derived config (baseURL, trustedOrigins, passkey rpID/origin)
 * comes from env.BETTER_AUTH_URL — a fixed operator secret — instead of
 * the incoming request.url. This prevents OAuth redirect-URI mismatches,
 * trustedOrigins accepting attacker-influenced Host headers, and passkey
 * rpID drift between workers.dev and production domains (M2, M3).
 *
 * NOTE: The project plan calls for Better Auth's native D1 support, but
 * we use kysely-d1 here because Better Auth's Kysely adapter is the
 * documented approach for D1 in production. Better Auth's D1
 * auto-detection may not handle the Kysely dialect internally, so
 * kysely-d1 stays for now.
 */

import { betterAuth } from 'better-auth';
import { passkey } from '@better-auth/passkey';
import { D1Dialect } from 'kysely-d1';
import type { Env } from './types.js';

type AuthInstance = ReturnType<typeof betterAuth>;
let _auth: AuthInstance | null = null;
// Tracks the DB binding reference used to create _auth. In a normal Workers
// isolate, env.DB is a stable binding object: the same reference is passed to
// every request within a single isolate lifetime, so _cachedDB === env.DB will
// always be true after the first call. The staleness check below is a defensive
// guard for non-standard environments (tests using fake envs, future isolate
// recycling, etc.) where the binding reference might differ between calls.
let _cachedDB: Env['DB'] | null = null;

export function getAuth(env: Env) {
  if (!_auth || _cachedDB !== env.DB) {
    if (!env.BETTER_AUTH_URL) {
      throw new Error('BETTER_AUTH_URL secret is not set. Run: wrangler secret put BETTER_AUTH_URL');
    }
    const url = new URL(env.BETTER_AUTH_URL);

    _cachedDB = env.DB;
    _auth = betterAuth({
      database: {
        dialect: new D1Dialect({ database: env.DB }),
        type: 'sqlite',
      },
      secret: env.BETTER_AUTH_SECRET,
      baseURL: url.origin,
      basePath: '/api/auth',
      trustedOrigins: [url.origin],
      /**
       * Email + password is enabled to support the passkey registration
       * flow: signUp.email creates the account, then passkey.addPasskey
       * binds a WebAuthn credential to it.
       *
       * No email verification is required — accepted risk for MVP.
       * TODO: Consider adding requireEmailVerification in a future
       * milestone to prevent account-enumeration and reduce spam.
       */
      emailAndPassword: { enabled: true },
      socialProviders: {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
        facebook: {
          clientId: env.FACEBOOK_CLIENT_ID,
          clientSecret: env.FACEBOOK_CLIENT_SECRET,
        },
      },
      plugins: [
        passkey({
          rpID: url.hostname,
          rpName: 'Mapadillo',
          origin: url.origin,
        }),
      ],
    });
  }
  return _auth;
}
