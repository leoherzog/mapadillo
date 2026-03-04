import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockIsAuthenticated, mockIsInitialized, mockInitAuth } = vi.hoisted(() => ({
  mockIsAuthenticated: vi.fn(),
  mockIsInitialized: vi.fn(),
  mockInitAuth: vi.fn(),
}));

vi.mock('./auth-state.js', () => ({
  isAuthenticated: mockIsAuthenticated,
  isInitialized: mockIsInitialized,
  initAuth: mockInitAuth,
}));

import { requireAuth } from './auth-guard.js';

beforeEach(() => {
  mockIsAuthenticated.mockReset();
  mockIsInitialized.mockReset();
  mockInitAuth.mockReset();
  vi.stubGlobal('window', {
    location: { pathname: '/dashboard', search: '' },
  });
});

describe('requireAuth', () => {
  describe('when initialized and authenticated', () => {
    it('returns undefined (allows route)', async () => {
      mockIsInitialized.mockReturnValue(true);
      mockIsAuthenticated.mockReturnValue(true);

      const result = await requireAuth({});

      expect(result).toBeUndefined();
    });
  });

  describe('when initialized and NOT authenticated', () => {
    it('returns sign-in redirect with returnTo', async () => {
      mockIsInitialized.mockReturnValue(true);
      mockIsAuthenticated.mockReturnValue(false);

      const result = await requireAuth({});

      expect(result).toBe('/sign-in?returnTo=%2Fdashboard');
    });

    it('includes search params in returnTo', async () => {
      mockIsInitialized.mockReturnValue(true);
      mockIsAuthenticated.mockReturnValue(false);
      vi.stubGlobal('window', {
        location: { pathname: '/trip/123', search: '?edit=true' },
      });

      const result = await requireAuth({});

      expect(result).toBe(
        '/sign-in?returnTo=' + encodeURIComponent('/trip/123?edit=true')
      );
    });

    it('encodes special characters in returnTo', async () => {
      mockIsInitialized.mockReturnValue(true);
      mockIsAuthenticated.mockReturnValue(false);
      vi.stubGlobal('window', {
        location: { pathname: '/map/a b', search: '?q=hello world' },
      });

      const result = await requireAuth({});

      expect(result).toBe(
        '/sign-in?returnTo=' + encodeURIComponent('/map/a b?q=hello world')
      );
    });
  });

  describe('when not yet initialized', () => {
    it('calls initAuth() before checking', async () => {
      mockIsInitialized.mockReturnValue(false);
      mockInitAuth.mockResolvedValue(null);
      mockIsAuthenticated.mockReturnValue(false);

      await requireAuth({});

      expect(mockInitAuth).toHaveBeenCalledTimes(1);
    });

    it('allows route if user becomes authenticated after init', async () => {
      mockIsInitialized.mockReturnValue(false);
      mockInitAuth.mockResolvedValue(null);
      mockIsAuthenticated.mockReturnValue(true);

      const result = await requireAuth({});

      expect(result).toBeUndefined();
    });

    it('redirects if user still unauthenticated after init', async () => {
      mockIsInitialized.mockReturnValue(false);
      mockInitAuth.mockResolvedValue(null);
      mockIsAuthenticated.mockReturnValue(false);

      const result = await requireAuth({});

      expect(result).toBe('/sign-in?returnTo=%2Fdashboard');
    });

    it('does not call initAuth when already initialized', async () => {
      mockIsInitialized.mockReturnValue(true);
      mockIsAuthenticated.mockReturnValue(true);

      await requireAuth({});

      expect(mockInitAuth).not.toHaveBeenCalled();
    });
  });
});
