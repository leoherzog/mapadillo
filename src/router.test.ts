// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { html } from 'lit';
import { Router, type RouteDefinition } from './router.js';

// ── Minimal host stub ────────────────────────────────────────────────────────

function createMockHost() {
  const host = {
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  return host;
}

const home: RouteDefinition = { path: '/', render: () => html`<p>Home</p>` };

/** Construct a Router on a mock host and connect it. */
function mountRouter(routes: RouteDefinition[] = [home]) {
  const host = createMockHost();
  const router = new Router(host, routes);
  router.hostConnected();
  return { host, router };
}

// ── URLPattern stub ──────────────────────────────────────────────────────────
// happy-dom doesn't provide URLPattern; stub it for route matching.

class FakeURLPattern {
  private pathRegex: RegExp;
  private paramNames: string[];

  constructor(init: { pathname: string }) {
    const paramNames: string[] = [];
    const regexStr = init.pathname.replace(/:(\w+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    this.pathRegex = new RegExp(`^${regexStr}$`);
    this.paramNames = paramNames;
  }

  exec(input: string | URL): { pathname: { groups: Record<string, string> } } | null {
    const url = typeof input === 'string' ? new URL(input, 'http://localhost') : input;
    const match = url.pathname.match(this.pathRegex);
    if (!match) return null;
    const groups: Record<string, string> = {};
    this.paramNames.forEach((name, i) => {
      groups[name] = match[i + 1];
    });
    return { pathname: { groups } };
  }
}

beforeEach(() => {
  vi.stubGlobal('URLPattern', FakeURLPattern);
  // Reset URL to root between tests
  window.history.pushState(null, '', '/');
  // Ensure no Navigation API so popstate fallback is used
  if ('navigation' in window) {
    delete (window as unknown as Record<string, unknown>).navigation;
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Router', () => {
  describe('construction', () => {
    it('registers itself as a controller on the host', () => {
      const host = createMockHost();

      new Router(host, [home]);

      expect(host.addController).toHaveBeenCalledTimes(1);
    });
  });

  describe('outlet', () => {
    it('starts with an empty template', () => {
      const router = new Router(createMockHost(), []);

      expect(router.outlet.strings.join('')).toBe('');
    });
  });

  describe('hostConnected — popstate fallback', () => {
    it('falls back to popstate when Navigation API is unavailable', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');

      mountRouter();

      expect(addSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    });

    it('renders matched route on connect', async () => {
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      const routes: RouteDefinition[] = [{ path: '/', render: renderFn }];

      const { host, router } = mountRouter(routes);

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(renderFn).toHaveBeenCalled();
      expect(router.current).toBe(routes[0]);
    });

    it('sets target before the enter guard resolves', async () => {
      let release!: () => void;
      const routes: RouteDefinition[] = [{
        path: '/',
        fullHeight: true,
        enter: () => new Promise<void>((resolve) => { release = resolve; }),
        render: () => html`<p>Home</p>`,
      }];

      const { host, router } = mountRouter(routes);

      expect(router.target).toBe(routes[0]);
      expect(router.current).toBeNull();
      expect(host.requestUpdate).toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(router.current).toBe(routes[0]));
    });

    it('renders not-found when no route matches', async () => {
      window.history.pushState(null, '', '/unknown');

      const { host, router } = mountRouter();

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(router.outlet.strings.join('')).toContain('404');
      expect(router.current).toBeNull();
    });
  });

  describe('hostDisconnected', () => {
    it('removes popstate listener on disconnect', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { router } = mountRouter();

      router.hostDisconnected();

      expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    });
  });

  describe('navigateTo (popstate fallback)', () => {
    it('pushes state and re-renders', async () => {
      const { navigateTo } = await import('./nav.js');
      const dashRender = vi.fn(() => html`<p>Dashboard</p>`);
      const pushSpy = vi.spyOn(window.history, 'pushState');

      const { host } = mountRouter([home, { path: '/dashboard', render: dashRender }]);
      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());

      navigateTo('/dashboard');

      expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard');
      await vi.waitFor(() => expect(dashRender).toHaveBeenCalled());
    });
  });

  describe('route guards (enter)', () => {
    it('calls enter guard before rendering', async () => {
      const enterFn = vi.fn(async () => undefined);
      const renderFn = vi.fn(() => html`<p>Protected</p>`);

      mountRouter([{ path: '/', render: renderFn, enter: enterFn }]);

      await vi.waitFor(() => expect(enterFn).toHaveBeenCalled());
      expect(renderFn).toHaveBeenCalled();
    });

    it('redirects when enter guard returns a path', async () => {
      const protectedRender = vi.fn(() => html`<p>Protected</p>`);

      const { host } = mountRouter([
        { path: '/', render: protectedRender, enter: async () => '/sign-in' },
        { path: '/sign-in', render: () => html`<p>Sign In</p>` },
      ]);

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(protectedRender).not.toHaveBeenCalled();
    });
  });

  describe('hostConnected — Navigation API', () => {
    function setupNavigation() {
      const listeners: Record<string, EventListener[]> = {};
      const navigation = {
        addEventListener: vi.fn((type: string, fn: EventListener) => {
          (listeners[type] ??= []).push(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: EventListener) => {
          listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
        }),
        navigate: vi.fn(),
      };
      vi.stubGlobal('navigation', navigation);
      const dispatch = (event: object) => {
        for (const fn of listeners['navigate'] ?? []) fn(event as unknown as Event);
      };
      return { navigation, dispatch };
    }

    /** Fake same-origin, interceptable navigate event targeting `/`. */
    function navEvent(overrides: Record<string, unknown> = {}) {
      return {
        canIntercept: true,
        downloadRequest: null,
        destination: { url: `${window.location.origin}/` },
        intercept: vi.fn(),
        ...overrides,
      };
    }

    it('registers navigate listener when Navigation API is available', () => {
      const { navigation } = setupNavigation();

      mountRouter();

      expect(navigation.addEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
    });

    it('removes navigate listener on disconnect', () => {
      const { navigation } = setupNavigation();
      const { router } = mountRouter();

      router.hostDisconnected();

      expect(navigation.removeEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
    });

    it('uses navigation.navigate() for programmatic navigation', async () => {
      const { navigateTo } = await import('./nav.js');
      const { navigation } = setupNavigation();
      mountRouter([home, { path: '/dashboard', render: () => html`<p>Dash</p>` }]);

      navigateTo('/dashboard');

      expect(navigation.navigate).toHaveBeenCalledWith('/dashboard', undefined);
    });

    it('intercepts same-origin navigations for matching routes', async () => {
      const { dispatch } = setupNavigation();
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      mountRouter([{ path: '/', render: renderFn }]);

      const interceptOpts: { handler?: () => Promise<void> } = {};
      const event = navEvent({
        intercept: vi.fn((opts: typeof interceptOpts) => Object.assign(interceptOpts, opts)),
      });
      dispatch(event);

      expect(event.intercept).toHaveBeenCalledWith(expect.objectContaining({
        scroll: 'after-transition',
        handler: expect.any(Function),
      }));

      await interceptOpts.handler!();
      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
    });

    it('skips non-interceptable events', () => {
      const { dispatch } = setupNavigation();
      mountRouter();

      const event = navEvent({ canIntercept: false });
      dispatch(event);

      expect(event.intercept).not.toHaveBeenCalled();
    });

    it('skips download requests', () => {
      const { dispatch } = setupNavigation();
      mountRouter();

      const event = navEvent({ downloadRequest: 'file.pdf' });
      dispatch(event);

      expect(event.intercept).not.toHaveBeenCalled();
    });

    it('skips cross-origin navigations', () => {
      const { dispatch } = setupNavigation();
      mountRouter();

      const event = navEvent({ destination: { url: 'https://example.com/' } });
      dispatch(event);

      expect(event.intercept).not.toHaveBeenCalled();
    });

    it('skips when no route matches', () => {
      const { dispatch } = setupNavigation();
      mountRouter([{ path: '/dashboard', render: () => html`<p>Dash</p>` }]);

      const event = navEvent({ destination: { url: `${window.location.origin}/nope` } });
      dispatch(event);

      expect(event.intercept).not.toHaveBeenCalled();
    });
  });

  describe('route params', () => {
    it('passes URL params to render function', async () => {
      window.history.pushState(null, '', '/map/abc-123');
      const renderFn = vi.fn(() => html`<p>Map</p>`);

      mountRouter([{ path: '/map/:id', render: renderFn }]);

      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
      expect(renderFn).toHaveBeenCalledWith({ id: 'abc-123' });
    });
  });

  describe('error handling', () => {
    it('renders error callout when route throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { host, router } = mountRouter([
        { path: '/', render: () => { throw new Error('boom'); } },
      ]);

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(router.outlet.strings.join('')).toContain('Something went wrong');
      expect(router.current).toBeNull();
    });
  });
});
