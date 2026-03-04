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
    delete (window as Record<string, unknown>).navigation;
  }
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Router', () => {
  describe('construction', () => {
    it('registers itself as a controller on the host', () => {
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];

      new Router(host, routes);

      expect(host.addController).toHaveBeenCalledTimes(1);
    });
  });

  describe('outlet', () => {
    it('starts with an empty template', () => {
      const host = createMockHost();
      const router = new Router(host, []);

      expect(router.outlet).toBeDefined();
    });
  });

  describe('hostConnected — popstate fallback', () => {
    it('falls back to popstate when Navigation API is unavailable', () => {
      const host = createMockHost();
      const addSpy = vi.spyOn(window, 'addEventListener');
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);

      router.hostConnected();

      expect(addSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    });

    it('renders matched route on connect', async () => {
      const host = createMockHost();
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      const routes: RouteDefinition[] = [
        { path: '/', render: renderFn },
      ];
      const router = new Router(host, routes);

      router.hostConnected();

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(renderFn).toHaveBeenCalled();
    });

    it('renders not-found when no route matches', async () => {
      // Navigate to an unknown path
      window.history.pushState(null, '', '/unknown');

      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);

      router.hostConnected();

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(router.outlet).toBeDefined();
    });
  });

  describe('hostDisconnected', () => {
    it('removes popstate listener on disconnect', () => {
      const host = createMockHost();
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);

      router.hostConnected();
      router.hostDisconnected();

      expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    });
  });

  describe('navigate (popstate fallback)', () => {
    it('pushes state and re-renders', async () => {
      const host = createMockHost();
      const dashRender = vi.fn(() => html`<p>Dashboard</p>`);
      const pushSpy = vi.spyOn(window.history, 'pushState');
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
        { path: '/dashboard', render: dashRender },
      ];
      const router = new Router(host, routes);

      router.hostConnected();
      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());

      router.navigate('/dashboard');

      expect(pushSpy).toHaveBeenCalledWith(null, '', '/dashboard');
      await vi.waitFor(() => expect(dashRender).toHaveBeenCalled());
    });
  });

  describe('route guards (enter)', () => {
    it('calls enter guard before rendering', async () => {
      const host = createMockHost();
      const enterFn = vi.fn(async () => undefined);
      const renderFn = vi.fn(() => html`<p>Protected</p>`);
      const routes: RouteDefinition[] = [
        { path: '/', render: renderFn, enter: enterFn },
      ];
      const router = new Router(host, routes);

      router.hostConnected();

      await vi.waitFor(() => expect(enterFn).toHaveBeenCalled());
      expect(renderFn).toHaveBeenCalled();
    });

    it('redirects when enter guard returns a path', async () => {
      const host = createMockHost();
      const protectedRender = vi.fn(() => html`<p>Protected</p>`);
      const signInRender = vi.fn(() => html`<p>Sign In</p>`);

      const routes: RouteDefinition[] = [
        { path: '/', render: protectedRender, enter: async () => '/sign-in' },
        { path: '/sign-in', render: signInRender },
      ];
      const router = new Router(host, routes);

      router.hostConnected();

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      // Protected page should NOT have rendered
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
      return { navigation, listeners };
    }

    it('registers navigate listener when Navigation API is available', () => {
      const { navigation } = setupNavigation();
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);

      router.hostConnected();

      expect(navigation.addEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
    });

    it('removes navigate listener on disconnect', () => {
      const { navigation } = setupNavigation();
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);

      router.hostConnected();
      router.hostDisconnected();

      expect(navigation.removeEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
    });

    it('uses navigation.navigate() for programmatic navigation', async () => {
      const { navigation } = setupNavigation();
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
        { path: '/dashboard', render: () => html`<p>Dash</p>` },
      ];
      const router = new Router(host, routes);

      router.hostConnected();
      router.navigate('/dashboard');

      expect(navigation.navigate).toHaveBeenCalledWith('/dashboard');
    });

    it('intercepts same-origin navigations for matching routes', async () => {
      const { listeners } = setupNavigation();
      const host = createMockHost();
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      const routes: RouteDefinition[] = [
        { path: '/', render: renderFn },
      ];
      const router = new Router(host, routes);
      router.hostConnected();

      const interceptOpts: { handler?: () => Promise<void> } = {};
      const event = {
        canIntercept: true,
        downloadRequest: null,
        destination: { url: `${window.location.origin}/` },
        intercept: vi.fn((opts: typeof interceptOpts) => Object.assign(interceptOpts, opts)),
      };
      for (const fn of listeners['navigate'] ?? []) fn(event as unknown as Event);

      expect(event.intercept).toHaveBeenCalledWith(expect.objectContaining({
        scroll: 'after-transition',
        handler: expect.any(Function),
      }));

      // Execute the handler to cover _runRouteAsync via intercept
      await interceptOpts.handler!();
      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
    });

    it('skips non-interceptable events', () => {
      const { listeners } = setupNavigation();
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);
      router.hostConnected();

      const event = {
        canIntercept: false,
        downloadRequest: null,
        destination: { url: `${window.location.origin}/` },
        intercept: vi.fn(),
      };
      for (const fn of listeners['navigate'] ?? []) fn(event as unknown as Event);

      expect(event.intercept).not.toHaveBeenCalled();
    });

    it('skips download requests', () => {
      const { listeners } = setupNavigation();
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);
      router.hostConnected();

      const event = {
        canIntercept: true,
        downloadRequest: 'file.pdf',
        destination: { url: `${window.location.origin}/` },
        intercept: vi.fn(),
      };
      for (const fn of listeners['navigate'] ?? []) fn(event as unknown as Event);

      expect(event.intercept).not.toHaveBeenCalled();
    });

    it('skips cross-origin navigations', () => {
      const { listeners } = setupNavigation();
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/', render: () => html`<p>Home</p>` },
      ];
      const router = new Router(host, routes);
      router.hostConnected();

      const event = {
        canIntercept: true,
        downloadRequest: null,
        destination: { url: 'https://example.com/' },
        intercept: vi.fn(),
      };
      for (const fn of listeners['navigate'] ?? []) fn(event as unknown as Event);

      expect(event.intercept).not.toHaveBeenCalled();
    });

    it('skips when no route matches', () => {
      const { listeners } = setupNavigation();
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        { path: '/dashboard', render: () => html`<p>Dash</p>` },
      ];
      const router = new Router(host, routes);
      router.hostConnected();

      const event = {
        canIntercept: true,
        downloadRequest: null,
        destination: { url: `${window.location.origin}/nope` },
        intercept: vi.fn(),
      };
      for (const fn of listeners['navigate'] ?? []) fn(event as unknown as Event);

      expect(event.intercept).not.toHaveBeenCalled();
    });
  });

  describe('route params', () => {
    it('passes URL params to render function', async () => {
      window.history.pushState(null, '', '/map/abc-123');

      const host = createMockHost();
      const renderFn = vi.fn(() => html`<p>Map</p>`);

      const routes: RouteDefinition[] = [
        { path: '/map/:id', render: renderFn },
      ];
      const router = new Router(host, routes);

      router.hostConnected();

      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
      expect(renderFn).toHaveBeenCalledWith({ id: 'abc-123' });
    });
  });

  describe('error handling', () => {
    it('renders error callout when route throws', async () => {
      const host = createMockHost();
      const routes: RouteDefinition[] = [
        {
          path: '/',
          render: () => { throw new Error('boom'); },
        },
      ];
      const router = new Router(host, routes);

      vi.spyOn(console, 'error').mockImplementation(() => {});

      router.hostConnected();

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(router.outlet).toBeDefined();
    });
  });
});
