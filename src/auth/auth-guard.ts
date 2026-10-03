/**
 * Auth guard — route `enter()` hook.
 * Returns `signInUrl()` when the user has no valid session.
 *
 * Awaits `initAuth()` if the session hasn't been checked yet, so the
 * first guarded navigation waits for the server round-trip.
 */

import { isAuthenticated, initAuth } from './auth-state.js';
import { signInUrl } from '../nav.js';
import type { RouteParams } from '../router.js';

export async function requireAuth(_params: RouteParams): Promise<string | void> {
  await initAuth();
  if (!isAuthenticated()) return signInUrl();
}
