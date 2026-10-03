/**
 * Passkey ceremonies for the sign-in page.
 * Registration is passkey-first: the server creates the account only once the passkey verifies,
 * so a cancelled prompt leaves nothing behind and the user can retry.
 */

import { authClient } from './auth-client.js';
import { refreshAuth, signOut } from './auth-state.js';

/**
 * Codes the passkey client returns for a dismissed, timed-out or superseded prompt.
 * AUTH_CANCELLED also covers a sign-in that failed before the server answered.
 */
const CANCEL_CODES = new Set(['AUTH_CANCELLED', 'ERROR_CEREMONY_ABORTED', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY']);

/** Error shape the Better Auth client returns instead of throwing. */
interface ClientError {
  code?: string;
  message?: string;
}

function errorMessage(error: ClientError, cancelled: string, fallback: string): string {
  if (CANCEL_CODES.has(error.code ?? '')) return cancelled;
  if (error.code === 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT') {
    return 'This device cannot save a passkey for sign-in. Try another device, or sign up with Google or Facebook.';
  }
  return error.message || fallback;
}

/**
 * Create an account for `email` and `name` and register its passkey in one ceremony, then refresh auth state.
 * @returns a message to show, or null once the new account is signed in
 */
export async function registerWithPasskey(email: string, name: string): Promise<string | null> {
  // The server refuses a sign-up sent with a session, and cached auth state can miss one, so always sign out first.
  if (!(await signOut())) return 'Passkey registration could not start. Please try again in a minute.';
  const { error } = await authClient.passkey.addPasskey({
    context: JSON.stringify({ email, name }),
    createSession: true,
  });
  if (error) {
    return errorMessage(
      error,
      'Passkey setup was cancelled. Nothing was saved, so you can try again.',
      'Passkey registration failed. Please try again.',
    );
  }
  await refreshAuth();
  return null;
}

/**
 * Sign in with a discoverable passkey, then refresh auth state.
 * @returns a message to show, or null once signed in
 */
export async function signInWithPasskey(): Promise<string | null> {
  const { error } = await authClient.signIn.passkey();
  if (error) return errorMessage(error, 'Passkey sign-in was cancelled.', 'Passkey sign-in failed.');
  await refreshAuth();
  return null;
}
