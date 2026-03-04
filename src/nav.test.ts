import { describe, it, expect, beforeEach, vi } from 'vitest';
import { navigateTo, navClick } from './nav.js';

beforeEach(() => {
  // PopStateEvent isn't available in Node — stub it.
  vi.stubGlobal('PopStateEvent', class PopStateEvent extends Event {
    constructor(type: string) { super(type); }
  });
  vi.stubGlobal('window', {
    history: { pushState: vi.fn() },
    dispatchEvent: vi.fn(),
  });
});

describe('navigateTo', () => {
  describe('with Navigation API', () => {
    it('calls navigation.navigate()', () => {
      const mockNavigate = vi.fn();
      vi.stubGlobal('window', {
        ...window,
        navigation: { navigate: mockNavigate },
      });

      navigateTo('/dashboard');

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });
  });

  describe('without Navigation API (fallback)', () => {
    it('calls history.pushState', () => {
      navigateTo('/dashboard');

      expect(window.history.pushState).toHaveBeenCalledWith(null, '', '/dashboard');
    });

    it('dispatches popstate event', () => {
      navigateTo('/map/1');

      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'popstate' }),
      );
    });
  });
});

describe('navClick', () => {
  it('returns a function', () => {
    expect(typeof navClick('/home')).toBe('function');
  });

  it('prevents default event behavior', () => {
    const handler = navClick('/home');
    const event = { preventDefault: vi.fn() } as unknown as Event;

    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('navigates to the given path', () => {
    const mockNavigate = vi.fn();
    vi.stubGlobal('window', {
      ...window,
      navigation: { navigate: mockNavigate },
    });

    const handler = navClick('/trip/123');
    handler({ preventDefault: vi.fn() } as unknown as Event);

    expect(mockNavigate).toHaveBeenCalledWith('/trip/123');
  });

  it('uses history fallback when Navigation API is absent', () => {
    const handler = navClick('/about');
    handler({ preventDefault: vi.fn() } as unknown as Event);

    expect(window.history.pushState).toHaveBeenCalledWith(null, '', '/about');
  });
});
