/**
 * Auth guard — route `enter()` hook.
 * Returns '/sign-in' redirect string when user is not authenticated.
 *
 * M1: uses stub auth state. Replaced with real session check in Milestone 2.
 */

import { isAuthenticated } from './auth-state.js';
import type { RouteParams } from '../router.js';

export function requireAuth(_params: RouteParams): string | void {
  if (!isAuthenticated()) {
    return '/sign-in';
  }
}
