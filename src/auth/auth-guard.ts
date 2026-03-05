/**
 * Auth guard — route `enter()` hook.
 * Returns '/sign-in' redirect string when user has no valid session.
 *
 * Awaits `initAuth()` if the session hasn't been checked yet, so the
 * first guarded navigation waits for the server round-trip.
 */

import { isAuthenticated, initAuth } from './auth-state.js';
import type { RouteParams } from '../router.js';

export async function requireAuth(_params: RouteParams): Promise<string | void> {
  await initAuth();
  if (!isAuthenticated()) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    return `/sign-in?returnTo=${returnTo}`;
  }
}
