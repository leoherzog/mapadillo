/**
 * Passkey-first registration and the disabled email+password routes.
 * The WebAuthn ceremony cannot run here, so afterVerification is called directly with a stub verification.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { getAuth, passkeyRegistration } from './auth.js';
import { applyTestSchema, request, createTestSession } from './test-helpers.js';

beforeAll(applyTestSchema);

const registration = passkeyRegistration(env.DB);
type VerificationArgs = Parameters<typeof registration.afterVerification>[0];

/** Send an auth request from a fresh client IP so RATE_LIMITER_AUTH never trips. */
function authRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', crypto.randomUUID());
  return request(path, { ...init, headers });
}

/** Request passkey registration options, sending `context` as the sign-up form does. */
function registerOptions(context?: unknown, cookie?: string): Promise<Response> {
  const raw = typeof context === 'string' ? context : JSON.stringify(context);
  const query = context === undefined ? '' : `?context=${encodeURIComponent(raw)}`;
  return authRequest(`/api/auth/passkey/generate-register-options${query}`, cookie ? { headers: { cookie } } : {});
}

function uniqueEmail(): string {
  return `new-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

async function userCount(email: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM "user" WHERE email = ?').bind(email).first<{ n: number }>();
  return row?.n ?? 0;
}

async function emailOf(userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId).first<{ email: string }>();
  return row!.email;
}

/**
 * Insert a user with no passkey, account or session, as a registration that failed after creating it leaves.
 * Dates are ISO text, as Better Auth writes them to D1.
 */
async function insertBareUser(ageMs: number): Promise<{ userId: string; email: string }> {
  const userId = crypto.randomUUID();
  const email = uniqueEmail();
  const createdAt = new Date(Date.now() - ageMs).toISOString();
  await env.DB.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)')
    .bind(userId, 'Orphan', email, createdAt, createdAt).run();
  return { userId, email };
}

async function userExists(userId: string): Promise<boolean> {
  return (await env.DB.prepare('SELECT id FROM "user" WHERE id = ?').bind(userId).first()) !== null;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Call afterVerification as the plugin does after a verified ceremony.
 * `session` stands in for the caller's session; null means signed out.
 */
async function afterVerification({ userId, context, session = null, credentialID = crypto.randomUUID() }: {
  userId: string;
  context?: unknown;
  session?: { session: { createdAt: Date }; user: { id: string } } | null;
  credentialID?: string;
}) {
  const authContext = await getAuth(env).$context;
  return registration.afterVerification({
    ctx: { context: { ...authContext, session }, headers: new Headers() },
    user: { id: userId, name: 'unused' },
    context: context === undefined ? null : JSON.stringify(context),
    verification: { verified: true, registrationInfo: { credential: { id: credentialID } } },
    clientData: {},
  } as unknown as VerificationArgs);
}

describe('Email and password routes', () => {
  it('refuses POST /api/auth/sign-up/email and creates no user', async () => {
    const email = uniqueEmail();
    const res = await authRequest('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: 'Ada', password: crypto.randomUUID() }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
    expect(await userCount(email)).toBe(0);
  });

  it('refuses POST /api/auth/sign-in/email', async () => {
    const res = await authRequest('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail(), password: crypto.randomUUID() }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'EMAIL_PASSWORD_DISABLED' });
  });
});

describe('GET /api/auth/passkey/generate-register-options without a session', () => {
  it('rejects a missing context', async () => {
    const res = await registerOptions();
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('rejects a context that is not JSON', async () => {
    const res = await registerOptions('not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('rejects an invalid email with a message for the form', async () => {
    const res = await registerOptions({ email: 'not-an-email', name: 'Ada' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_EMAIL', message: 'Enter a valid email address.' });
  });

  it('rejects an email with an invisible character', async () => {
    const res = await registerOptions({ email: 'vic\u200btim@example.com', name: 'Ada' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('rejects a blank or overlong name', async () => {
    for (const name of ['   ', 'x'.repeat(101)]) {
      const res = await registerOptions({ email: uniqueEmail(), name });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_NAME' });
    }
  });

  it('rejects an email that already has an account, ignoring case', async () => {
    const { userId } = await createTestSession();
    const email = await emailOf(userId);
    const res = await registerOptions({ email: ` ${email.toUpperCase()} `, name: 'Ada' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      code: 'USER_ALREADY_EXISTS',
      message: expect.stringContaining('already exists'),
    });
  });

  it('returns discoverable-credential options for a new email and creates no user', async () => {
    const email = uniqueEmail();
    const res = await registerOptions({ email: email.toUpperCase(), name: '  Ada Lovelace ' });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      user: { name: string; displayName: string };
      authenticatorSelection: { residentKey: string; requireResidentKey: boolean };
    };
    expect(body.user).toMatchObject({ name: email, displayName: 'Ada Lovelace' });
    expect(body.authenticatorSelection).toMatchObject({ residentKey: 'required', requireResidentKey: true });
    expect(res.headers.get('set-cookie')).toContain('better-auth-passkey');
    expect(await userCount(email)).toBe(0);
  });

  it('reclaims the email of an old user that nothing can sign in as', async () => {
    const { userId, email } = await insertBareUser(TEN_MINUTES_MS);
    const res = await registerOptions({ email, name: 'Ada' });
    expect(res.status).toBe(200);
    expect(await userExists(userId)).toBe(false);
  });

  it('keeps a bare user whose registration may still be in flight', async () => {
    const { userId, email } = await insertBareUser(0);
    const res = await registerOptions({ email, name: 'Ada' });
    expect(res.status).toBe(422);
    expect(await userExists(userId)).toBe(true);
  });

  it('keeps an old user that has a passkey or a map', async () => {
    const withPasskey = await insertBareUser(TEN_MINUTES_MS);
    await env.DB.prepare(
      'INSERT INTO passkey (id, publicKey, userId, counter, deviceType, backedUp, credentialID) VALUES (?, ?, ?, 0, ?, 0, ?)',
    ).bind(crypto.randomUUID(), 'key', withPasskey.userId, 'singleDevice', crypto.randomUUID()).run();
    const withMap = await insertBareUser(TEN_MINUTES_MS);
    await env.DB.prepare('INSERT INTO maps (id, owner_id, name) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), withMap.userId, 'Trip').run();

    for (const { userId, email } of [withPasskey, withMap]) {
      const res = await registerOptions({ email, name: 'Ada' });
      expect(res.status).toBe(422);
      expect(await userExists(userId)).toBe(true);
    }
  });
});

describe('GET /api/auth/passkey/generate-register-options with a session', () => {
  it('refuses a sign-up context and creates no user', async () => {
    const { cookie } = await createTestSession();
    const other = uniqueEmail();
    const res = await registerOptions({ email: other, name: 'Someone Else' }, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'SIGNED_IN' });
    expect(res.headers.get('set-cookie') ?? '').not.toContain('better-auth-passkey');
    expect(await userCount(other)).toBe(0);
  });

  it('targets the signed-in account when no context is sent', async () => {
    const { cookie, userId } = await createTestSession();
    const res = await registerOptions(undefined, cookie);
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { name: string } };
    expect(body.user.name).toBe(await emailOf(userId));
  });
});

describe('passkeyRegistration.afterVerification', () => {
  it('creates the account with the id issued by resolveUser', async () => {
    const userId = crypto.randomUUID();
    const email = uniqueEmail();
    const result = await afterVerification({ userId, context: { email: email.toUpperCase(), name: ' Ada ' } });
    expect(result).toEqual({ userId });
    const row = await env.DB.prepare('SELECT email, name, emailVerified FROM "user" WHERE id = ?')
      .bind(userId).first();
    expect(row).toEqual({ email, name: 'Ada', emailVerified: 0 });
  });

  it('rejects an email registered since the options were issued', async () => {
    const { userId: existingId } = await createTestSession();
    const userId = crypto.randomUUID();
    await expect(afterVerification({ userId, context: { email: await emailOf(existingId), name: 'Ada' } }))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(await env.DB.prepare('SELECT id FROM "user" WHERE id = ?').bind(userId).first()).toBeNull();
  });

  it('creates the account once an old orphan user holding the email is reclaimed', async () => {
    const { userId: orphanId, email } = await insertBareUser(TEN_MINUTES_MS);
    const userId = crypto.randomUUID();
    expect(await afterVerification({ userId, context: { email, name: 'Ada' } })).toEqual({ userId });
    expect(await userExists(orphanId)).toBe(false);
    expect(await userExists(userId)).toBe(true);
  });

  it('rejects a credential that is already registered and creates no user', async () => {
    const { userId: ownerId } = await createTestSession();
    const credentialID = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO passkey (id, publicKey, userId, counter, deviceType, backedUp, credentialID) VALUES (?, ?, ?, 0, ?, 0, ?)',
    ).bind(crypto.randomUUID(), 'key', ownerId, 'singleDevice', credentialID).run();
    const email = uniqueEmail();
    await expect(afterVerification({ userId: crypto.randomUUID(), context: { email, name: 'Ada' }, credentialID }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(await userCount(email)).toBe(0);
  });

  it('refuses options issued to a session that has since ended', async () => {
    const { userId } = await createTestSession();
    const email = uniqueEmail();
    await expect(afterVerification({ userId, context: { email, name: 'Ada' } }))
      .rejects.toMatchObject({ statusCode: 401 });
    expect(await userCount(email)).toBe(0);
  });

  it('attaches a signed-in caller\'s passkey to their own account', async () => {
    const { userId } = await createTestSession();
    const result = await afterVerification({
      userId,
      session: { session: { createdAt: new Date() }, user: { id: userId } },
    });
    expect(result).toEqual({ userId });
  });

  it('refuses a sign-up context from a signed-in caller and creates no user', async () => {
    const { userId } = await createTestSession();
    const email = uniqueEmail();
    await expect(afterVerification({
      userId,
      context: { email, name: 'Someone Else' },
      session: { session: { createdAt: new Date() }, user: { id: userId } },
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(await userCount(email)).toBe(0);
  });

  it('refuses a signed-in caller whose session is not fresh', async () => {
    const { userId } = await createTestSession();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await expect(afterVerification({
      userId,
      session: { session: { createdAt: twoDaysAgo }, user: { id: userId } },
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});
