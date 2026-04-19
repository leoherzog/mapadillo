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

// Track when the tab was last hidden so we can decide whether to re-check
// the session on visibility change. Null means the tab is currently visible
// (or we haven't seen a hide event yet).
let _hiddenAt: number | null = null;
let _visibilityListener: (() => void) | null = null;

// Only re-check the session if the tab was hidden for longer than this.
// Short hides (tab switches, alt-tabs) are the common case and don't
// warrant a network round trip.
const VISIBILITY_REFRESH_THRESHOLD_MS = 60_000;

function _setUser(user: User | null): void {
  _user = user;
  _listeners.forEach((fn) => fn());
}

function _installVisibilityListener(): void {
  if (_visibilityListener) return;
  if (typeof document === 'undefined') return;

  _visibilityListener = () => {
    if (document.visibilityState === 'hidden') {
      _hiddenAt = Date.now();
      return;
    }
    if (document.visibilityState === 'visible') {
      const hiddenAt = _hiddenAt;
      _hiddenAt = null;
      if (hiddenAt !== null && Date.now() - hiddenAt > VISIBILITY_REFRESH_THRESHOLD_MS) {
        // Fire and forget — session may have expired server-side while hidden.
        refreshAuth();
      }
    }
  };

  document.addEventListener('visibilitychange', _visibilityListener);
}

function _removeVisibilityListener(): void {
  if (!_visibilityListener) return;
  if (typeof document === 'undefined') return;
  document.removeEventListener('visibilitychange', _visibilityListener);
  _visibilityListener = null;
  _hiddenAt = null;
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
  _installVisibilityListener();
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
  _removeVisibilityListener();
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
