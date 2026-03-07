/**
 * Reactive auth state — backed by Better Auth session.
 *
 * Call `initAuth()` on app load to check the current session.
 * Components subscribe via `onAuthChange()` to re-render on sign-in/out.
 */

import { authClient } from './auth-client.js';

import type { SessionUser as User } from '../../shared/types.js';
export type { SessionUser as User } from '../../shared/types.js';

// ── Internal state ────────────────────────────────────────────────────────

let _user: User | null = null;
let _initPromise: Promise<User | null> | null = null;
const _listeners = new Set<() => void>();

function _setUser(user: User | null): void {
  _user = user;
  _listeners.forEach((fn) => fn());
}

// ── Public API ────────────────────────────────────────────────────────────

export function getUser(): User | null {
  return _user;
}

export function onAuthChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function isAuthenticated(): boolean {
  return _user !== null;
}

/**
 * Check the current session with the server.
 * Safe to call multiple times — deduplicates concurrent calls.
 */
export function initAuth(): Promise<User | null> {
  if (_initPromise) return _initPromise;
  _initPromise = _doInit();
  return _initPromise;
}

/**
 * Re-check the session (e.g. after passkey sign-in completes).
 * Unlike `initAuth`, always makes a fresh server call.
 */
export async function refreshAuth(): Promise<User | null> {
  _initPromise = _doInit();
  return _initPromise;
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // Server sign-out failed — clear local state anyway
    // so the UI doesn't show a stale session
  }
  _setUser(null);
  _initPromise = null;
}

// ── Private ───────────────────────────────────────────────────────────────

async function _doInit(): Promise<User | null> {
  try {
    const { data } = await authClient.getSession();
    if (data?.user) {
      _setUser({
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        image: data.user.image ?? null,
      });
    } else {
      _setUser(null);
    }
  } catch {
    _setUser(null);
  }
  return _user;
}
