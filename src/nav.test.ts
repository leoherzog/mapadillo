// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { navigateTo } from './nav.js';

const onPopState = vi.fn();

beforeEach(() => {
  vi.stubGlobal('navigation', undefined);
  window.history.pushState(null, '', '/');
  window.addEventListener('popstate', onPopState);
});

afterEach(() => {
  window.removeEventListener('popstate', onPopState);
});

describe('navigateTo', () => {
  describe('with Navigation API', () => {
    function stubNavigation() {
      const navigation = { navigate: vi.fn() };
      vi.stubGlobal('navigation', navigation);
      return navigation;
    }

    it('pushes through navigation.navigate()', () => {
      const navigation = stubNavigation();
      const pushSpy = vi.spyOn(window.history, 'pushState');

      navigateTo('/dashboard');

      expect(navigation.navigate).toHaveBeenCalledWith('/dashboard', undefined);
      expect(pushSpy).not.toHaveBeenCalled();
      expect(onPopState).not.toHaveBeenCalled();
    });

    it('replaces through navigation.navigate()', () => {
      const navigation = stubNavigation();
      const replaceSpy = vi.spyOn(window.history, 'replaceState');

      navigateTo('/dashboard', { replace: true });

      expect(navigation.navigate).toHaveBeenCalledWith('/dashboard', { history: 'replace' });
      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it('ignores the current URL', () => {
      const navigation = stubNavigation();

      navigateTo('/');

      expect(navigation.navigate).not.toHaveBeenCalled();
    });
  });

  describe('without Navigation API', () => {
    it('pushes a history entry and dispatches popstate', () => {
      const length = window.history.length;

      navigateTo('/map/1');

      expect(window.location.pathname).toBe('/map/1');
      expect(window.history.length).toBe(length + 1);
      expect(onPopState).toHaveBeenCalledTimes(1);
    });

    it('replaces the current entry and dispatches popstate', () => {
      const length = window.history.length;

      navigateTo('/sign-in', { replace: true });

      expect(window.location.pathname).toBe('/sign-in');
      expect(window.history.length).toBe(length);
      expect(onPopState).toHaveBeenCalledTimes(1);
    });

    it('ignores the current URL', () => {
      const length = window.history.length;

      navigateTo('/');

      expect(window.history.length).toBe(length);
      expect(onPopState).not.toHaveBeenCalled();
    });
  });
});
