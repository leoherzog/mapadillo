/**
 * Better Auth server configuration for Cloudflare Workers.
 *
 * The betterAuth() instance is cached at module level because
 * constructing it is expensive (router, plugins, DB adapter). In Workers,
 * module-level state persists within an isolate for the lifetime of that
 * isolate, so subsequent requests reuse the same instance.
 *
 * All URL-derived config (baseURL, trustedOrigins, passkey rpID/origin)
 * comes from env.BETTER_AUTH_URL — a fixed operator secret — instead of
 * the incoming request.url. This prevents OAuth redirect-URI mismatches,
 * trustedOrigins accepting attacker-influenced Host headers, and passkey
 * rpID drift between workers.dev and production domains.
 *
 * The D1 binding is passed directly; Better Auth's Kysely adapter detects it
 * and uses its bundled D1 dialect.
 */

import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { passkey, type PasskeyOptions } from '@better-auth/passkey';
import type { Env } from './types.js';

type PasskeyRegistration = NonNullable<PasskeyOptions['registration']>;
type RegistrationContext = Parameters<NonNullable<PasskeyRegistration['resolveUser']>>[0]['ctx'];

/** ASCII-only, so an invisible or lookalike character cannot imitate an existing email (port of zod v4 `email`). */
const EMAIL_PATTERN = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 100;
/** Older than any registration still between creating its user and inserting its passkey. */
const ORPHAN_MIN_AGE_MS = 5 * 60 * 1000;

/** Refusal for a sign-up form sent with a session, which the plugin would add to the signed-in account. */
function signedInError(): APIError {
  return new APIError('CONFLICT', {
    code: 'SIGNED_IN',
    message: 'You are signed in. Sign out, then create the new account.',
  });
}

/**
 * Delete `user` when it is past ORPHAN_MIN_AGE_MS, nothing can sign in as it and nothing references it.
 * D1 has no transactions, so a passkey insert that fails after afterVerification leaves such a user holding its email.
 * @returns whether the user was deleted
 */
async function reclaimOrphanUser(db: Env['DB'], user: { id: string; createdAt: Date }): Promise<boolean> {
  const age = Date.now() - new Date(user.createdAt).getTime();
  // Written so an unparseable createdAt (NaN) keeps the user.
  if (!(age >= ORPHAN_MIN_AGE_MS)) return false;
  // One statement, so a reference added after the lookup keeps the user.
  // Every table that references a user is checked, so the delete never hits an FK error or cascade.
  const { meta } = await db.prepare(`DELETE FROM "user" WHERE id = ?1
    AND NOT EXISTS (SELECT 1 FROM passkey WHERE userId = ?1)
    AND NOT EXISTS (SELECT 1 FROM account WHERE userId = ?1)
    AND NOT EXISTS (SELECT 1 FROM session WHERE userId = ?1)
    AND NOT EXISTS (SELECT 1 FROM maps WHERE owner_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM map_shares WHERE user_id = ?1)
    AND NOT EXISTS (SELECT 1 FROM orders WHERE user_id = ?1)`).bind(user.id).run();
  return meta.changes > 0;
}

/**
 * Validate the sign-up form's registration context, a JSON `{ email, name }`, and require an unused email.
 * An orphan user left by a failed registration does not count as using its email.
 * @returns the lowercased email and trimmed name
 * @throws APIError 400 for invalid input, 422 when an account already has the email
 */
async function requireNewAccount(
  db: Env['DB'],
  ctx: RegistrationContext,
  raw: string | null | undefined,
): Promise<{ email: string; name: string }> {
  let fields: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '');
    if (typeof parsed === 'object' && parsed !== null) fields = parsed as Record<string, unknown>;
  } catch {
    // Treated as empty fields below.
  }
  const email = typeof fields.email === 'string' ? fields.email.trim().toLowerCase() : '';
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new APIError('BAD_REQUEST', { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
  }
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new APIError('BAD_REQUEST', {
      code: 'INVALID_NAME',
      message: `Enter a name of up to ${MAX_NAME_LENGTH} characters.`,
    });
  }
  const existing = await ctx.context.internalAdapter.findUserByEmail(email);
  if (existing && !(await reclaimOrphanUser(db, existing.user))) {
    throw new APIError('UNPROCESSABLE_ENTITY', {
      code: 'USER_ALREADY_EXISTS',
      message: 'An account with this email already exists. Sign in the way you first signed up.',
    });
  }
  return { email, name };
}

/**
 * Passkey-first registration against `db`: a signed-out caller's account is created only after its passkey verifies.
 * A signed-in caller can only add a passkey to their own account, and is refused when it sends a sign-up context.
 */
export function passkeyRegistration(db: Env['DB']) {
  return {
    requireSession: false,
    resolveUser: async ({ ctx, context }) => {
      const { email, name } = await requireNewAccount(db, ctx, context);
      // afterVerification creates the user with this id.
      return { id: crypto.randomUUID(), name: email, displayName: name };
    },
    afterVerification: async ({ ctx, user, context, verification }) => {
      const session = await getSessionFromCtx(ctx);
      if (session) {
        // Backstop for the before hook in createAuth.
        if (context != null) throw signedInError();
        // requireSession: false drops the plugin's fresh-session check, so apply it here.
        const { freshAge } = ctx.context.sessionConfig;
        if (freshAge !== 0 && Date.now() - new Date(session.session.createdAt).getTime() >= freshAge * 1000) {
          throw new APIError('FORBIDDEN', { code: 'SESSION_NOT_FRESH', message: 'Sign in again to add a passkey.' });
        }
        return { userId: session.user.id };
      }
      // Options issued to a session that has since ended carry that account's id.
      if (await ctx.context.internalAdapter.findUserById(user.id)) {
        throw new APIError('UNAUTHORIZED', { code: 'SESSION_REQUIRED', message: 'Sign in again to add a passkey.' });
      }
      const { email, name } = await requireNewAccount(db, ctx, context);
      // D1 has no transactions, so a duplicate credential must fail before the user row exists.
      const credentialID = verification.registrationInfo?.credential.id;
      const existing = credentialID && await ctx.context.adapter.findOne({
        model: 'passkey',
        where: [{ field: 'credentialID', value: credentialID }],
      });
      if (existing) {
        throw new APIError('BAD_REQUEST', {
          code: 'PREVIOUSLY_REGISTERED',
          message: 'This passkey is already registered. Sign in with it instead.',
        });
      }
      const created = await ctx.context.internalAdapter.createUser(
        { id: user.id, email, name, emailVerified: false },
        { method: 'passkey' },
      );
      return { userId: created.id };
    },
  } satisfies PasskeyRegistration;
}

/** Build the Better Auth instance for `url`, the parsed BETTER_AUTH_URL. */
function createAuth(env: Env, url: URL) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: url.origin,
    basePath: '/api/auth',
    trustedOrigins: [url.origin],
    // RATE_LIMITER_AUTH in index.ts limits /api/auth/*.
    rateLimit: { enabled: false },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    // Better Auth appends ?error=<code>; the sign-in page shows it.
    onAPIError: { errorURL: `${url.origin}/sign-in` },
    // Accounts are created passkey-first or through OAuth; there is no password login.
    // A passkey account's email is unproven, so it keeps emailVerified false and OAuth never links into it.
    emailAndPassword: { enabled: false },
    hooks: {
      // With a session the plugin targets the signed-in account and never reads the context, so refuse a sign-up form.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/passkey/generate-register-options' && ctx.query?.context != null && await getSessionFromCtx(ctx)) {
          throw signedInError();
        }
      }),
    },
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
        // Sign-in is usernameless, so only a discoverable credential can be used later.
        authenticatorSelection: { residentKey: 'required' },
        registration: passkeyRegistration(env.DB),
      }),
    ],
  });
}

let _auth: ReturnType<typeof createAuth> | null = null;
// Rebuild when the D1 binding object changes (tests pass fresh envs).
let _cachedDB: Env['DB'] | null = null;

export function getAuth(env: Env) {
  if (!_auth || _cachedDB !== env.DB) {
    if (!env.BETTER_AUTH_URL) {
      throw new Error('BETTER_AUTH_URL secret is not set. Run: wrangler secret put BETTER_AUTH_URL');
    }
    if (!env.BETTER_AUTH_SECRET) {
      throw new Error('BETTER_AUTH_SECRET secret is not set. Run: wrangler secret put BETTER_AUTH_SECRET');
    }
    _cachedDB = env.DB;
    _auth = createAuth(env, new URL(env.BETTER_AUTH_URL));
  }
  return _auth;
}
