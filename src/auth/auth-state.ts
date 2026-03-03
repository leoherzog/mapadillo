/**
 * Reactive auth state — M1 stub.
 * Replaced with real Better Auth session in Milestone 2.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  image?: string;
}

// Simple signal-like reactive state (no framework dependency)
let _user: User | null = null;
const _listeners = new Set<() => void>();

export function getUser(): User | null {
  return _user;
}

export function setUser(user: User | null): void {
  _user = user;
  _listeners.forEach((fn) => fn());
}

export function onAuthChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function isAuthenticated(): boolean {
  return _user !== null;
}
