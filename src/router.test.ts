// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { html } from 'lit';
import { Router, type RouteDefinition } from './router.js';
import { navigateTo } from './nav.js';

// ── Minimal host stub ────────────────────────────────────────────────────────

function createMockHost() {
  const host = {
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  };
  return host;
}

const home: RouteDefinition = { path: '/', render: () => html`<p>Home</p>` };

const mounted: Router[] = [];

/** Construct a Router on a mock host and connect it. */
function mountRouter(routes: RouteDefinition[] = [home]) {
  const host = createMockHost();
  const router = new Router(host, routes);
  router.hostConnected();
  mounted.push(router);
  return { host, router };
}

/** The outlet's static markup plus its interpolated values, for text assertions. */
function outletText(router: Router): string {
  return [...router.outlet.strings, ...router.outlet.values].join('');
}

// ── Navigation API stub ──────────────────────────────────────────────────────

/** Fake same-origin, interceptable push navigate event targeting `/`. */
function navEvent(overrides: Record<string, unknown> = {}) {
  return {
    canIntercept: true,
    navigationType: 'push',
    downloadRequest: null,
    destination: { url: `${window.location.origin}/` },
    intercept: vi.fn(),
    ...overrides,
  };
}

/**
 * Stub `window.navigation` with a fake. Its `navigate()` dispatches a navigate event and,
 * when a listener intercepts it, commits the URL through the History API and runs the handler.
 */
function setupNavigation() {
  const listeners: Record<string, EventListener[]> = {};
  const dispatch = (event: object) => {
    for (const fn of listeners['navigate'] ?? []) fn(event as unknown as Event);
  };
  const navigation = {
    addEventListener: vi.fn((type: string, fn: EventListener) => {
      (listeners[type] ??= []).push(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: EventListener) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    }),
    navigate: vi.fn((url: string, options?: { history?: 'push' | 'replace' }) => {
      const intercepted: { handler?: () => Promise<void> } = {};
      dispatch(navEvent({
        destination: { url: new URL(url, window.location.href).href },
        intercept: (opts: typeof intercepted) => Object.assign(intercepted, opts),
      }));
      // Without an intercept a browser would load the page, which this fake does not model.
      if (!intercepted.handler) return;
      if (options?.history === 'replace') window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
      void intercepted.handler();
    }),
  };
  vi.stubGlobal('navigation', navigation);
  return { navigation, dispatch };
}

/** Remove `window.navigation` so the router and navigateTo take the popstate fallback. */
function removeNavigation() {
  vi.stubGlobal('navigation', undefined);
}

beforeEach(() => {
  removeNavigation();
  window.history.pushState(null, '', '/');
});

afterEach(() => {
  mounted.splice(0).forEach((r) => r.hostDisconnected());
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

  describe.each([
    ['Navigation API', setupNavigation],
    ['popstate fallback', removeNavigation],
  ])('routing with %s', (_, setup) => {
    beforeEach(() => {
      setup();
    });

    it('renders the matched route on connect', async () => {
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      const routes: RouteDefinition[] = [{ path: '/', render: renderFn }];

      const { router } = mountRouter(routes);

      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
      expect(router.target).toBe(routes[0]);
    });

    it('passes path params to enter and render', async () => {
      window.history.pushState(null, '', '/map/abc-123');
      const enterFn = vi.fn();
      const renderFn = vi.fn(() => html`<p>Map</p>`);

      mountRouter([{ path: '/map/:id', enter: enterFn, render: renderFn }]);

      await vi.waitFor(() => expect(renderFn).toHaveBeenCalledWith({ id: 'abc-123' }));
      expect(enterFn).toHaveBeenCalledWith({ id: 'abc-123' });
    });

    it('routes navigateTo in place with a pushed entry', async () => {
      const mapRender = vi.fn(() => html`<p>Map</p>`);
      const { host } = mountRouter([home, { path: '/map/:id', render: mapRender }]);
      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      const length = window.history.length;

      navigateTo('/map/xyz');

      await vi.waitFor(() => expect(mapRender).toHaveBeenCalledWith({ id: 'xyz' }));
      expect(window.location.pathname).toBe('/map/xyz');
      expect(window.history.length).toBe(length + 1);
    });

    it('redirects with a replaced entry when enter returns a path', async () => {
      const protectedRender = vi.fn(() => html`<p>Protected</p>`);
      const signInRender = vi.fn(() => html`<p>Sign In</p>`);
      const length = window.history.length;

      mountRouter([
        { path: '/', render: protectedRender, enter: async () => '/sign-in' },
        { path: '/sign-in', render: signInRender },
      ]);

      await vi.waitFor(() => expect(signInRender).toHaveBeenCalled());
      expect(window.location.pathname).toBe('/sign-in');
      expect(window.history.length).toBe(length);
      expect(protectedRender).not.toHaveBeenCalled();
    });

    it('renders the error callout after too many redirects', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { router } = mountRouter([
        { path: '/', render: () => html`<p>Home</p>`, enter: () => '/a' },
        { path: '/a', render: () => html`<p>A</p>`, enter: () => '/' },
      ]);

      await vi.waitFor(() => expect(outletText(router)).toContain('Something went wrong'));
      expect(router.target).toBeNull();
    });

    it.each([
      ['renders', undefined],
      ['redirects', '/sign-in'],
    ])('drops a superseded enter guard that later %s', async (_, redirect) => {
      let release!: (redirect?: string) => void;
      const slowRender = vi.fn(() => html`<p>Slow</p>`);
      const otherRender = vi.fn(() => html`<p>Other</p>`);
      const routes: RouteDefinition[] = [
        { path: '/', enter: () => new Promise<string | void>((resolve) => { release = resolve; }), render: slowRender },
        { path: '/other', render: otherRender },
      ];
      const { router } = mountRouter(routes);

      navigateTo('/other');
      await vi.waitFor(() => expect(otherRender).toHaveBeenCalled());
      release(redirect);
      await new Promise((r) => setTimeout(r, 0));

      expect(slowRender).not.toHaveBeenCalled();
      expect(router.target).toBe(routes[1]);
      expect(window.location.pathname).toBe('/other');
    });

    it('renders not-found when no route matches', async () => {
      window.history.pushState(null, '', '/unknown');

      const { host, router } = mountRouter();

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(outletText(router)).toContain('404');
      expect(router.target).toBeNull();
    });
  });

  describe('Navigation API', () => {
    it('listens for navigate instead of popstate', () => {
      const { navigation } = setupNavigation();
      const addSpy = vi.spyOn(window, 'addEventListener');

      mountRouter();

      expect(navigation.addEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
      expect(addSpy).not.toHaveBeenCalledWith('popstate', expect.any(Function));
    });

    it('removes navigate listener on disconnect', () => {
      const { navigation } = setupNavigation();
      const { router } = mountRouter();

      router.hostDisconnected();

      expect(navigation.removeEventListener).toHaveBeenCalledWith('navigate', expect.any(Function));
    });

    it('redirects through navigation.navigate() with history: replace', async () => {
      const { navigation } = setupNavigation();
      const signInRender = vi.fn(() => html`<p>Sign In</p>`);

      mountRouter([
        { path: '/', render: () => html`<p>Protected</p>`, enter: async () => '/sign-in' },
        { path: '/sign-in', render: signInRender },
      ]);

      await vi.waitFor(() => expect(signInRender).toHaveBeenCalled());
      expect(navigation.navigate).toHaveBeenCalledWith('/sign-in', { history: 'replace' });
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

    it('skips fragment navigations', () => {
      const { dispatch } = setupNavigation();
      mountRouter();

      const event = navEvent({ hashChange: true });
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

    it('renders not-found in place on Back/Forward to an entry with no route', async () => {
      const { dispatch } = setupNavigation();
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      const { router } = mountRouter([{ path: '/', render: renderFn }]);
      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());

      const interceptOpts: { handler?: () => Promise<void> } = {};
      const event = navEvent({
        navigationType: 'traverse',
        destination: { url: `${window.location.origin}/nope` },
        intercept: vi.fn((opts: typeof interceptOpts) => Object.assign(interceptOpts, opts)),
      });
      dispatch(event);

      expect(event.intercept).toHaveBeenCalled();
      await interceptOpts.handler!();
      expect(outletText(router)).toContain('404');
      expect(router.target).toBeNull();
    });
  });

  describe('popstate fallback', () => {
    it('listens for popstate', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');

      mountRouter();

      expect(addSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    });

    it('removes popstate listener on disconnect', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const { router } = mountRouter();

      router.hostDisconnected();

      expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    });

    it('renders the current URL on Back/Forward', async () => {
      const mapRender = vi.fn(() => html`<p>Map</p>`);
      const { host } = mountRouter([home, { path: '/map/:id', render: mapRender }]);
      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());

      window.history.pushState(null, '', '/map/back');
      window.dispatchEvent(new PopStateEvent('popstate'));

      await vi.waitFor(() => expect(mapRender).toHaveBeenCalledWith({ id: 'back' }));
    });

    it('renders not-found in place when navigateTo finds no route', async () => {
      const { router } = mountRouter();

      navigateTo('/nope');

      await vi.waitFor(() => expect(outletText(router)).toContain('404'));
      expect(router.target).toBeNull();
    });
  });

  describe('path matching', () => {
    it('ignores the query and fragment', async () => {
      window.history.pushState(null, '', '/map/abc?tab=stops#top');
      const renderFn = vi.fn(() => html`<p>Map</p>`);

      mountRouter([{ path: '/map/:id', render: renderFn }]);

      await vi.waitFor(() => expect(renderFn).toHaveBeenCalledWith({ id: 'abc' }));
    });

    it.each(['/map/abc/extra', '/map/', '/x/map/abc'])('does not match %s against /map/:id', async (url) => {
      window.history.pushState(null, '', url);
      const renderFn = vi.fn(() => html`<p>Map</p>`);

      const { router } = mountRouter([{ path: '/map/:id', render: renderFn }]);

      await vi.waitFor(() => expect(outletText(router)).toContain('404'));
      expect(renderFn).not.toHaveBeenCalled();
    });

    it('takes the first route that matches', async () => {
      window.history.pushState(null, '', '/map/new');
      const newRender = vi.fn(() => html`<p>New</p>`);
      const idRender = vi.fn(() => html`<p>Map</p>`);

      mountRouter([
        { path: '/map/new', render: newRender },
        { path: '/map/:id', render: idRender },
      ]);

      await vi.waitFor(() => expect(newRender).toHaveBeenCalledWith({}));
      expect(idRender).not.toHaveBeenCalled();
    });

    it('treats regex characters in a path literally', async () => {
      window.history.pushState(null, '', '/robotsxtxt');

      const { router } = mountRouter([{ path: '/robots.txt', render: () => html`<p>Robots</p>` }]);

      await vi.waitFor(() => expect(outletText(router)).toContain('404'));
    });
  });

  describe('route guards (enter)', () => {
    it('sets target before the enter guard resolves', async () => {
      let release!: () => void;
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      const routes: RouteDefinition[] = [{
        path: '/',
        fullHeight: true,
        enter: () => new Promise<void>((resolve) => { release = resolve; }),
        render: renderFn,
      }];

      const { host, router } = mountRouter(routes);

      expect(router.target).toBe(routes[0]);
      expect(renderFn).not.toHaveBeenCalled();
      expect(host.requestUpdate).toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
    });

    it('calls enter guard before rendering', async () => {
      const enterFn = vi.fn(async () => undefined);
      const renderFn = vi.fn(() => html`<p>Protected</p>`);

      mountRouter([{ path: '/', render: renderFn, enter: enterFn }]);

      await vi.waitFor(() => expect(enterFn).toHaveBeenCalled());
      expect(renderFn).toHaveBeenCalled();
    });
  });

  describe('document title', () => {
    it('shows the route title before the app name', async () => {
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      mountRouter([{ path: '/', title: 'Home', render: renderFn }]);

      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
      expect(document.title).toBe('Home · Mapadillo');
    });

    it('shows only the app name for an untitled route', async () => {
      document.title = 'Stale';
      const renderFn = vi.fn(() => html`<p>Home</p>`);
      mountRouter([{ path: '/', render: renderFn }]);

      await vi.waitFor(() => expect(renderFn).toHaveBeenCalled());
      expect(document.title).toBe('Mapadillo');
    });

    it('names the not-found page', async () => {
      window.history.pushState(null, '', '/unknown');

      const { host } = mountRouter();

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(document.title).toBe('Page not found · Mapadillo');
    });
  });

  describe('error handling', () => {
    it('renders error callout when route throws', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      document.title = 'Stale';

      const { host, router } = mountRouter([
        { path: '/', render: () => { throw new Error('boom'); } },
      ]);

      await vi.waitFor(() => expect(host.requestUpdate).toHaveBeenCalled());
      expect(outletText(router)).toContain('Something went wrong');
      expect(router.target).toBeNull();
      expect(document.title).toBe('Something went wrong · Mapadillo');
    });
  });
});
