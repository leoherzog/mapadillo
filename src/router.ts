/**
 * DIY Lit reactive controller router
 *
 * Uses the Navigation API (Baseline cross-browser early 2026) and URLPattern
 * (Baseline cross-browser Sept 2025). No polyfills needed for evergreen browsers.
 *
 * Features:
 * - URLPattern route matching with named params
 * - Optional async `enter()` guard (auth redirects, lazy loading)
 * - Built-in scroll restoration, focus management, View Transitions via Navigation API
 * - Single `navigation.addEventListener('navigate', ...)` handles all nav types
 */

import { type ReactiveController, type ReactiveControllerHost } from 'lit';
import { html, type TemplateResult } from 'lit';
import { navigateTo } from './nav.js';

// ── Navigation API + URLPattern type shims ────────────────────────────────
// These APIs are Baseline cross-browser but not yet in all TS DOM lib versions.

declare class URLPattern {
  constructor(init?: { pathname?: string } | string, baseURL?: string);
  exec(input: string | URL): URLPatternResult | null;
}

interface URLPatternResult {
  pathname: { groups: Record<string, string | undefined> };
}

interface NavigationInterface extends EventTarget {
  navigate(url: string, options?: { history?: 'push' | 'replace' | 'auto'; state?: unknown }): void;
}

interface NavigateEvent extends Event {
  readonly destination: { readonly url: string };
  readonly canIntercept: boolean;
  readonly downloadRequest: string | null;
  intercept(options?: {
    handler?: () => Promise<void>;
    scroll?: 'after-transition' | 'manual';
    focusReset?: 'after-transition' | 'manual';
  }): void;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface RouteParams {
  [key: string]: string | undefined;
}

export interface RouteDefinition {
  /** URL pattern, e.g. '/map/:id' */
  path: string;
  /** Return the Lit template to render for this route */
  render: (params: RouteParams) => TemplateResult;
  /**
   * Optional async guard called before the route renders.
   * Return a redirect path string to redirect, or void/undefined to allow.
   */
  enter?: (params: RouteParams) => Promise<string | void> | string | void;
}

interface CompiledRoute {
  pattern: URLPattern;
  definition: RouteDefinition;
}

export class Router implements ReactiveController {
  private host: ReactiveControllerHost & EventTarget;
  private routes: CompiledRoute[] = [];
  private _currentTemplate: TemplateResult = html``;
  private _popstateHandler: (() => void) | null = null;
  private _redirectDepth = 0;

  get outlet(): TemplateResult {
    return this._currentTemplate;
  }

  constructor(
    host: ReactiveControllerHost & EventTarget,
    routes: RouteDefinition[]
  ) {
    this.host = host;
    host.addController(this);
    this.routes = routes.map((def) => ({
      pattern: new URLPattern({ pathname: def.path }),
      definition: def,
    }));
  }

  hostConnected(): void {
    if (!('navigation' in window)) {
      console.warn('[Router] Navigation API not available, using popstate fallback.');
      this._popstateHandler = () => void this._renderForUrl(window.location.href);
      window.addEventListener('popstate', this._popstateHandler);
      void this._renderForUrl(window.location.href);
      return;
    }

    (window as unknown as { navigation: NavigationInterface }).navigation
      .addEventListener('navigate', this._onNavigate as EventListener);

    void this._renderForUrl(window.location.href);
  }

  hostDisconnected(): void {
    if (this._popstateHandler) {
      window.removeEventListener('popstate', this._popstateHandler);
      this._popstateHandler = null;
    }
    if ('navigation' in window) {
      (window as unknown as { navigation: NavigationInterface }).navigation
        .removeEventListener('navigate', this._onNavigate as EventListener);
    }
  }

  private _onNavigate = (rawEvent: Event): void => {
    const event = rawEvent as NavigateEvent;

    if (!event.canIntercept) return;
    if (event.downloadRequest !== null) return;

    const url = new URL(event.destination.url);
    if (url.origin !== window.location.origin) return;

    const matched = this._matchRoute(url.href);
    if (!matched) return;

    event.intercept({
      scroll: 'after-transition',
      handler: async () => {
        await this._runRouteAsync(matched.definition, matched.params);
      },
    });
  };

  private async _runRouteAsync(
    definition: RouteDefinition,
    params: RouteParams,
  ): Promise<void> {
    const MAX_REDIRECTS = 5;
    try {
      if (definition.enter) {
        const redirect = await definition.enter(params);
        if (typeof redirect === 'string') {
          if (this._redirectDepth >= MAX_REDIRECTS) {
            console.error('[Router] Redirect loop detected — stopping navigation after', MAX_REDIRECTS, 'redirects.');
            this._redirectDepth = 0;
            return;
          }
          this._redirectDepth++;
          navigateTo(redirect);
          return;
        }
      }
      this._currentTemplate = definition.render(params);
      this._redirectDepth = 0;
    } catch (err) {
      console.error('[Router] Route error:', err);
      this._currentTemplate = html`
        <wa-callout variant="danger" style="max-width: 600px; margin: var(--wa-space-2xl) auto;">
          <wa-icon slot="icon" name="circle-info"></wa-icon>
          <strong>Something went wrong</strong><br />
          <a href="/">Go home</a>
        </wa-callout>
      `;
    }
    this.host.requestUpdate();
  }

  private async _renderForUrl(href: string): Promise<void> {
    const matched = this._matchRoute(href);
    if (!matched) {
      this._currentTemplate = this._notFoundTemplate();
      this.host.requestUpdate();
      return;
    }
    await this._runRouteAsync(matched.definition, matched.params);
  }

  private _matchRoute(
    href: string
  ): { definition: RouteDefinition; params: RouteParams } | null {
    for (const { pattern, definition } of this.routes) {
      const result = pattern.exec(href);
      if (result) {
        const params: RouteParams = Object.fromEntries(
          Object.entries(result.pathname.groups).filter(([, v]) => v !== undefined)
        ) as RouteParams;
        return { definition, params };
      }
    }
    return null;
  }

  private _notFoundTemplate(): TemplateResult {
    return html`
      <wa-callout variant="warning" style="max-width: 600px; margin: var(--wa-space-2xl) auto;">
        <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
        <strong>404 — Page not found</strong><br />
        <a href="/">Go home</a>
      </wa-callout>
    `;
  }
}
