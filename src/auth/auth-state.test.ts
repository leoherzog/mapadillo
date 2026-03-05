import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock setup (vi.hoisted runs before vi.mock hoisting) ─────────────────────

const { mockGetSession, mockSignOut } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('./auth-client.js', () => ({
  authClient: {
    getSession: mockGetSession,
    signOut: mockSignOut,
  },
}));

// ── Dynamic import types ─────────────────────────────────────────────────────

type AuthStateModule = typeof import('./auth-state.js');
let mod: AuthStateModule;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sessionWith(user: { id: string; email: string; name: string; image?: string | null }) {
  return { data: { user, session: { id: 'sess-1' } } };
}

const testUser = { id: 'u1', email: 'a@b.com', name: 'Alice', image: null };

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.resetModules();
  mockGetSession.mockReset();
  mockSignOut.mockReset();
  mod = await import('./auth-state.js');
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('auth-state', () => {
  describe('initial state', () => {
    it('getUser() returns null', () => {
      expect(mod.getUser()).toBeNull();
    });

    it('isAuthenticated() returns false', () => {
      expect(mod.isAuthenticated()).toBe(false);
    });

  });

  describe('initAuth()', () => {
    it('sets user from session response', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));

      await mod.initAuth();

      expect(mod.getUser()).toEqual(testUser);
    });

    it('maps user fields correctly', async () => {
      mockGetSession.mockResolvedValue(
        sessionWith({ id: 'x', email: 'x@y.com', name: 'Xavier', image: 'https://img.test/x.png' })
      );

      await mod.initAuth();
      const user = mod.getUser()!;

      expect(user.id).toBe('x');
      expect(user.email).toBe('x@y.com');
      expect(user.name).toBe('Xavier');
      expect(user.image).toBe('https://img.test/x.png');
    });

    it('sets image to null when absent', async () => {
      mockGetSession.mockResolvedValue(
        sessionWith({ id: 'u1', email: 'a@b.com', name: 'A' })
      );

      await mod.initAuth();

      expect(mod.getUser()!.image).toBeNull();
    });

    it('sets isAuthenticated to true when session has user', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));

      await mod.initAuth();

      expect(mod.isAuthenticated()).toBe(true);
    });

    it('sets user to null when session has no user data', async () => {
      mockGetSession.mockResolvedValue({ data: null });

      await mod.initAuth();

      expect(mod.getUser()).toBeNull();
      expect(mod.isAuthenticated()).toBe(false);
    });

    it('sets user to null when data.user is missing', async () => {
      mockGetSession.mockResolvedValue({ data: { session: {} } });

      await mod.initAuth();

      expect(mod.getUser()).toBeNull();
    });

    it('sets user to null on getSession error', async () => {
      mockGetSession.mockRejectedValue(new Error('network'));

      await mod.initAuth();

      expect(mod.getUser()).toBeNull();
    });
  });

  describe('initAuth() deduplication', () => {
    it('returns same promise on concurrent calls', () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));

      const p1 = mod.initAuth();
      const p2 = mod.initAuth();

      expect(p1).toBe(p2);
    });

    it('only calls getSession once for concurrent calls', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));

      await Promise.all([mod.initAuth(), mod.initAuth(), mod.initAuth()]);

      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });

    it('reuses promise on subsequent calls (cached)', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));

      await mod.initAuth();
      await mod.initAuth();

      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshAuth()', () => {
    it('makes a fresh getSession call', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));

      await mod.initAuth();
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      mockGetSession.mockResolvedValue(
        sessionWith({ ...testUser, name: 'Alice Updated' })
      );
      await mod.refreshAuth();

      expect(mockGetSession).toHaveBeenCalledTimes(2);
    });

    it('returns the new user', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      const newUser = { ...testUser, name: 'Alice V2' };
      mockGetSession.mockResolvedValue(sessionWith(newUser));
      const result = await mod.refreshAuth();

      expect(result).toEqual(newUser);
      expect(mod.getUser()).toEqual(newUser);
    });
  });

  describe('signOut()', () => {
    it('calls authClient.signOut()', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      mockSignOut.mockResolvedValue(undefined);
      await mod.signOut();

      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });

    it('clears user to null', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();
      expect(mod.isAuthenticated()).toBe(true);

      mockSignOut.mockResolvedValue(undefined);
      await mod.signOut();

      expect(mod.getUser()).toBeNull();
      expect(mod.isAuthenticated()).toBe(false);
    });

    it('clears initPromise so next initAuth re-fetches', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();
      expect(mockGetSession).toHaveBeenCalledTimes(1);

      mockSignOut.mockResolvedValue(undefined);
      await mod.signOut();

      mockGetSession.mockResolvedValue({ data: null });
      await mod.initAuth();
      expect(mockGetSession).toHaveBeenCalledTimes(2);
    });

    it('clears local state even when signOut throws', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      mockSignOut.mockRejectedValue(new Error('network'));
      await mod.signOut();

      expect(mod.getUser()).toBeNull();
      expect(mod.isAuthenticated()).toBe(false);
    });

    it('notifies listeners when user is cleared', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      const listener = vi.fn();
      mod.onAuthChange(listener);
      listener.mockClear();

      mockSignOut.mockResolvedValue(undefined);
      await mod.signOut();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('onAuthChange()', () => {
    it('calls listener when user changes via initAuth', async () => {
      const listener = vi.fn();
      mod.onAuthChange(listener);

      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      expect(listener).toHaveBeenCalled();
    });

    it('calls listener when user changes via signOut', async () => {
      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      const listener = vi.fn();
      mod.onAuthChange(listener);

      mockSignOut.mockResolvedValue(undefined);
      await mod.signOut();

      expect(listener).toHaveBeenCalled();
    });

    it('does not call listener after unsubscribe', async () => {
      const listener = vi.fn();
      const unsub = mod.onAuthChange(listener);

      unsub();

      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple independent listeners', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      mod.onAuthChange(listener1);
      const unsub2 = mod.onAuthChange(listener2);

      mockGetSession.mockResolvedValue(sessionWith(testUser));
      await mod.initAuth();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();

      listener1.mockClear();
      listener2.mockClear();
      unsub2();

      mockSignOut.mockResolvedValue(undefined);
      await mod.signOut();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });
});
