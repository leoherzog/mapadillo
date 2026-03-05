import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockIsAuthenticated, mockInitAuth } = vi.hoisted(() => ({
  mockIsAuthenticated: vi.fn(),
  mockInitAuth: vi.fn(),
}));

vi.mock('./auth-state.js', () => ({
  isAuthenticated: mockIsAuthenticated,
  initAuth: mockInitAuth,
}));

import { requireAuth } from './auth-guard.js';

beforeEach(() => {
  mockIsAuthenticated.mockReset();
  mockInitAuth.mockReset().mockResolvedValue(null);
  vi.stubGlobal('window', {
    location: { pathname: '/dashboard', search: '' },
  });
});

describe('requireAuth', () => {
  describe('when authenticated', () => {
    it('returns undefined (allows route)', async () => {
      mockIsAuthenticated.mockReturnValue(true);

      const result = await requireAuth({});

      expect(result).toBeUndefined();
    });

    it('always calls initAuth()', async () => {
      mockIsAuthenticated.mockReturnValue(true);

      await requireAuth({});

      expect(mockInitAuth).toHaveBeenCalledTimes(1);
    });
  });

  describe('when NOT authenticated', () => {
    it('returns sign-in redirect with returnTo', async () => {
      mockIsAuthenticated.mockReturnValue(false);

      const result = await requireAuth({});

      expect(result).toBe('/sign-in?returnTo=%2Fdashboard');
    });

    it('includes search params in returnTo', async () => {
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
      mockIsAuthenticated.mockReturnValue(false);
      vi.stubGlobal('window', {
        location: { pathname: '/map/a b', search: '?q=hello world' },
      });

      const result = await requireAuth({});

      expect(result).toBe(
        '/sign-in?returnTo=' + encodeURIComponent('/map/a b?q=hello world')
      );
    });

    it('allows route if user becomes authenticated after init', async () => {
      mockIsAuthenticated.mockReturnValue(true);

      const result = await requireAuth({});

      expect(result).toBeUndefined();
    });
  });
});
