/**
 * Lit reactive-controller router: RegExp matching of paths such as '/map/:id' and optional
 * async `enter()` guards that may return a redirect path. With the Navigation API, a
 * `navigate` handler intercepts link clicks and Back/Forward and handles scroll and focus.
 * Without it, a popstate listener routes `navigateTo` and Back/Forward, and link clicks are
 * full page loads that the SPA fallback serves.
 */

import { type ReactiveController, type ReactiveControllerHost } from 'lit';
import { html, type TemplateResult } from 'lit';
import { navigateTo } from './nav.js';

// ── Public API ─────────────────────────────────────────────────────────────

export interface RouteParams {
  [key: string]: string | undefined;
}

export interface RouteDefinition {
  /** Path to match, e.g. '/map/:id'; each `:name` matches one non-empty segment. */
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
  /** Page name shown before ' · Mapadillo' in the tab title. */
  title?: string;
}

interface CompiledRoute {
  pattern: RegExp;
  definition: RouteDefinition;
}

/** Compile a route path into an anchored RegExp with a named group per `:param` segment. */
function compilePath(path: string): RegExp {
  const source = path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, '(?<$1>[^/]+)');
  return new RegExp(`^${source}$`);
}

export class Router implements ReactiveController {
  private host: ReactiveControllerHost;
  private routes: CompiledRoute[] = [];
  private _currentTemplate: TemplateResult = html``;
  private _target: RouteDefinition | null = null;
  private _redirectDepth = 0;
  /** Bumped on every navigation so a superseded `enter()` guard drops its result. */
  private _navSeq = 0;

  get outlet(): TemplateResult {
    return this._currentTemplate;
  }

  /** The route the latest navigation matched, set before its `enter` guard runs; null when nothing matched or entry threw. */
  get target(): RouteDefinition | null {
    return this._target;
  }

  constructor(
    host: ReactiveControllerHost,
    routes: RouteDefinition[]
  ) {
    this.host = host;
    host.addController(this);
    this.routes = routes.map((def) => ({
      pattern: compilePath(def.path),
      definition: def,
    }));
  }

  private get _nav(): Navigation | undefined {
    return window.navigation;
  }

  hostConnected(): void {
    const nav = this._nav;
    if (nav) nav.addEventListener('navigate', this._onNavigate);
    else window.addEventListener('popstate', this._onPopState);
    void this._renderForUrl(window.location.href);
  }

  hostDisconnected(): void {
    this._nav?.removeEventListener('navigate', this._onNavigate);
    window.removeEventListener('popstate', this._onPopState);
  }

  /** Fallback listener: fires on Back/Forward and on the synthetic popstate `navigateTo` dispatches. */
  private _onPopState = (): void => {
    void this._renderForUrl(window.location.href);
  };

  private _onNavigate = (event: NavigateEvent): void => {
    if (!event.canIntercept) return;
    if (event.downloadRequest !== null) return;
    if (event.hashChange) return;

    const url = new URL(event.destination.url);
    if (url.origin !== window.location.origin) return;

    // A same-document traversal never reloads, so an entry with no route must render not-found here.
    if (!this._matchRoute(url.href) && event.navigationType !== 'traverse') return;

    event.intercept({
      scroll: 'after-transition',
      handler: () => this._renderForUrl(url.href),
    });
  };

  private async _runRouteAsync(
    definition: RouteDefinition,
    params: RouteParams,
  ): Promise<void> {
    const seq = ++this._navSeq;
    const MAX_REDIRECTS = 5;
    if (this._target !== definition) {
      this._target = definition;
      this.host.requestUpdate();
    }
    try {
      if (definition.enter) {
        const redirect = await definition.enter(params);
        if (seq !== this._navSeq) return;
        if (typeof redirect === 'string') {
          if (this._redirectDepth >= MAX_REDIRECTS) {
            this._redirectDepth = 0;
            throw new Error(`Redirect loop after ${MAX_REDIRECTS} redirects`);
          }
          this._redirectDepth++;
          // Replace so Back skips the guarded URL instead of re-triggering the redirect.
          navigateTo(redirect, { replace: true });
          return;
        }
      }
      this._currentTemplate = definition.render(params);
      document.title = definition.title ? `${definition.title} · Mapadillo` : 'Mapadillo';
      this._redirectDepth = 0;
    } catch (err) {
      if (seq !== this._navSeq) return;
      console.error('[Router] Route error:', err);
      this._target = null;
      this._currentTemplate = this._callout('danger', 'circle-xmark', 'Something went wrong');
      document.title = 'Something went wrong · Mapadillo';
    }
    this.host.requestUpdate();
  }

  private async _renderForUrl(href: string): Promise<void> {
    const matched = this._matchRoute(href);
    if (!matched) {
      this._navSeq++;
      this._target = null;
      this._currentTemplate = this._callout('warning', 'triangle-exclamation', '404 — Page not found');
      document.title = 'Page not found · Mapadillo';
      this.host.requestUpdate();
      return;
    }
    await this._runRouteAsync(matched.definition, matched.params);
  }

  /** The first route whose path matches `href`'s pathname; the query and fragment are ignored. */
  private _matchRoute(
    href: string
  ): { definition: RouteDefinition; params: RouteParams } | null {
    const { pathname } = new URL(href, window.location.origin);
    for (const { pattern, definition } of this.routes) {
      const match = pattern.exec(pathname);
      if (match) return { definition, params: { ...match.groups } };
    }
    return null;
  }

  /** The not-found and error outlet: a callout with a link home. */
  private _callout(variant: 'danger' | 'warning', icon: string, message: string): TemplateResult {
    return html`
      <style>.router-callout { max-width: 600px; margin: var(--wa-space-2xl) auto; } .router-callout wa-button { margin-top: var(--wa-space-xs); }</style>
      <wa-callout class="router-callout" variant=${variant}>
        <wa-icon slot="icon" name=${icon}></wa-icon>
        <strong>${message}</strong><br />
        <wa-button href="/" size="s" variant="brand" appearance="outlined">Go home</wa-button>
      </wa-callout>
    `;
  }
}
