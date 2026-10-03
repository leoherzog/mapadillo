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
  /** The page fills the viewport and the shell hides its footer. */
  fullHeight?: boolean;
}

interface CompiledRoute {
  pattern: URLPattern;
  definition: RouteDefinition;
}

export class Router implements ReactiveController {
  private host: ReactiveControllerHost & EventTarget;
  private routes: CompiledRoute[] = [];
  private _currentTemplate: TemplateResult = html``;
  private _current: RouteDefinition | null = null;
  private _target: RouteDefinition | null = null;
  private _popstateHandler: (() => void) | null = null;
  private _redirectDepth = 0;

  get outlet(): TemplateResult {
    return this._currentTemplate;
  }

  /** The route whose template is in `outlet`, or null for the not-found and error templates. */
  get current(): RouteDefinition | null {
    return this._current;
  }

  /** The route the latest navigation matched, set before its `enter` guard runs; null when nothing matched or entry threw. */
  get target(): RouteDefinition | null {
    return this._target;
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

  private get _nav(): Navigation | undefined {
    return window.navigation;
  }

  hostConnected(): void {
    const nav = this._nav;
    if (!nav) {
      console.warn('[Router] Navigation API not available, using popstate fallback.');
      this._popstateHandler = () => void this._renderForUrl(window.location.href);
      window.addEventListener('popstate', this._popstateHandler);
      void this._renderForUrl(window.location.href);
      return;
    }

    nav.addEventListener('navigate', this._onNavigate);

    void this._renderForUrl(window.location.href);
  }

  hostDisconnected(): void {
    if (this._popstateHandler) {
      window.removeEventListener('popstate', this._popstateHandler);
      this._popstateHandler = null;
    }
    this._nav?.removeEventListener('navigate', this._onNavigate);
  }

  private _onNavigate = (event: NavigateEvent): void => {
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
    if (this._target !== definition) {
      this._target = definition;
      this.host.requestUpdate();
    }
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
      this._current = definition;
      this._redirectDepth = 0;
    } catch (err) {
      console.error('[Router] Route error:', err);
      this._current = null;
      this._target = null;
      this._currentTemplate = html`
        <style>.router-callout { max-width: 600px; margin: var(--wa-space-2xl) auto; } .router-callout wa-button { margin-top: var(--wa-space-xs); }</style>
        <wa-callout class="router-callout" variant="danger">
          <wa-icon slot="icon" name="circle-exclamation"></wa-icon>
          <strong>Something went wrong</strong><br />
          <wa-button href="/" size="small" variant="brand" appearance="outlined">Go home</wa-button>
        </wa-callout>
      `;
    }
    this.host.requestUpdate();
  }

  private async _renderForUrl(href: string): Promise<void> {
    const matched = this._matchRoute(href);
    if (!matched) {
      this._current = null;
      this._target = null;
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
      <style>.router-callout { max-width: 600px; margin: var(--wa-space-2xl) auto; } .router-callout wa-button { margin-top: var(--wa-space-xs); }</style>
      <wa-callout class="router-callout" variant="warning">
        <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
        <strong>404 — Page not found</strong><br />
        <wa-button href="/" size="small" variant="brand" appearance="outlined">Go home</wa-button>
      </wa-callout>
    `;
  }
}
