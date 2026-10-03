/**
 * App shell — layout wrapper with header, main, and footer.
 * Owns the router and renders the current page into `<main>`.
 *
 * Header shows "Sign In" when unauthenticated, user-menu when authenticated.
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Router, type RouteDefinition } from '../router.js';
import { requireAuth } from '../auth/auth-guard.js';
import { AuthController } from '../auth/auth-controller.js';
import { signInUrl } from '../nav.js';
import { waUtilities } from '../styles/wa-utilities.js';

// Pages that never load MapLibre are bundled with the shell; the rest load on entry.
import '../pages/landing-page.js';
import '../pages/sign-in-page.js';
import '../pages/claim-page.js';
import './user-menu.js';

/** Route `enter` hook: runs `guard` first, then loads the page module before render. */
function lazy(load: () => Promise<unknown>, guard?: RouteDefinition['enter']): RouteDefinition['enter'] {
  return async (params) => {
    const redirect = await guard?.(params);
    if (redirect) return redirect;
    await load();
  };
}

@customElement('app-shell')
export class AppShell extends LitElement {
  @property({ type: Boolean, reflect: true, attribute: 'no-footer' }) noFooter = false;
  private _auth = new AuthController(this);

  // Router is a reactive controller — it calls requestUpdate() when the route changes
  private router = new Router(this, [
    {
      path: '/',
      render: () => html`<landing-page></landing-page>`,
    },
    {
      path: '/sign-in',
      title: 'Sign In',
      render: () => html`<sign-in-page></sign-in-page>`,
    },
    {
      path: '/dashboard',
      title: 'My Trips',
      enter: lazy(() => import('../pages/dashboard-page.js'), requireAuth),
      render: () => html`<dashboard-page></dashboard-page>`,
    },
    {
      path: '/map/new',
      title: 'New Trip',
      enter: lazy(() => import('../pages/trip-builder-page.js'), requireAuth),
      fullHeight: true,
      render: () => html`<trip-builder-page .mapId=${''}></trip-builder-page>`,
    },
    {
      path: '/map/:id',
      title: 'Trip',
      enter: lazy(() => import('../pages/trip-builder-page.js')),
      fullHeight: true,
      render: ({ id }) => html`<trip-builder-page .mapId=${id ?? ''}></trip-builder-page>`,
    },
    {
      path: '/preview/:id',
      title: 'Preview',
      enter: lazy(() => import('../pages/map-preview-page.js')),
      fullHeight: true,
      render: ({ id }) => html`<map-preview-page .mapId=${id ?? ''}></map-preview-page>`,
    },
    {
      path: '/export/:id',
      title: 'Export',
      enter: lazy(() => import('../pages/export-page.js')),
      render: ({ id }) => html`<export-page .mapId=${id ?? ''}></export-page>`,
    },
    {
      path: '/claim/:token',
      title: 'Accept Invite',
      enter: requireAuth,
      render: ({ token }) => html`<claim-page .token=${token ?? ''}></claim-page>`,
    },
    {
      path: '/order/:id',
      title: 'Order a Print',
      enter: lazy(() => import('../pages/order-page.js'), requireAuth),
      render: ({ id }) => html`<order-page .mapId=${id ?? ''}></order-page>`,
    },
    {
      path: '/order-confirmation/:orderId',
      title: 'Order Confirmed',
      enter: lazy(() => import('../pages/order-confirmation-page.js'), requireAuth),
      render: ({ orderId }) => html`<order-confirmation-page .orderId=${orderId ?? ''}></order-confirmation-page>`,
    },
    {
      path: '/admin',
      title: 'Admin',
      enter: lazy(() => import('../pages/admin-page.js'), requireAuth),
      render: () => html`<admin-page></admin-page>`,
    },
  ]);

  static styles = [waUtilities, css`
    :host {
      display: block;
    }

    .header-inner {
      padding: var(--wa-space-s) var(--wa-space-l);
    }

    .logo {
      text-decoration: none;
      color: var(--wa-color-brand-60);
      font-weight: var(--wa-font-weight-bold);
      font-size: var(--wa-font-size-l);
      cursor: pointer;
    }

    .logo wa-icon {
      font-size: var(--wa-font-size-xl);
    }

    /* Keeps pages direct flex items of main-content and drops wa-page's padding on slotted <main>. */
    .app-main {
      display: contents;
    }

    .footer-inner {
      display: block;
      padding: var(--wa-space-m) var(--wa-space-l);
      text-align: center;
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-text-quiet);
    }

    /* Hide wa-page's empty fallback <nav> so it is not exposed as an unlabeled navigation landmark. */
    wa-page::part(navigation) {
      display: none;
    }

    /*
     * Full-screen viewport lock for the map editor page.
     * wa-page has no built-in attribute for this — its footer always pushes
     * content below the viewport by design. These ::part() overrides constrain
     * the internal grid chain so trip-builder-page fills exactly 100dvh.
     * Toggled via the [no-footer] host attribute, reflected from the route's fullHeight flag.
     */

    /* Cap the outermost grid at viewport height (internal: min-height: 100dvh) */
    :host([no-footer]) wa-page::part(page) {
      height: 100dvh;
    }

    /*
     * Internal default is align-items: flex-start, which makes the main element
     * content-sized (as tall as sidebar cards) instead of stretching to fill the
     * constrained 1fr body row. Override to stretch + min-height: 0 (from 100%).
     */
    :host([no-footer]) wa-page::part(body) {
      min-height: 0;
      align-items: stretch;
    }

    /* Prevent expansion beyond grid track (internal: min-height: 100%) */
    :host([no-footer]) wa-page::part(main) {
      min-height: 0;
    }

    /* Flex column so trip-builder-page's flex: 1 fills remaining space */
    :host([no-footer]) wa-page::part(main-content) {
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    @media (max-width: 700px) {
      .header-inner {
        padding: var(--wa-space-xs) var(--wa-space-s);
      }

      .logo {
        font-size: var(--wa-font-size-m);
      }

      .logo wa-icon {
        font-size: var(--wa-font-size-l);
      }
    }
  `];

  willUpdate(changed: PropertyValues<this>) {
    super.willUpdate(changed);
    // From the target route so the layout is set while an enter guard such as requireAuth is pending.
    this.noFooter = this.router.target?.fullHeight ?? false;
  }

  render() {
    const route = this.router.target?.path;
    const signInHref = !route || route === '/' || route === '/sign-in' ? '/sign-in' : signInUrl();

    return html`
      <wa-page disable-sticky="header" @click=${this._onSkipToContent}>
        <header slot="header" class="header-inner wa-split wa-align-items-center wa-gap-m">
          <a class="logo wa-cluster wa-align-items-center wa-gap-xs" href="/">
            <wa-icon name="map"></wa-icon>
            Mapadillo
          </a>

          <nav class="wa-cluster wa-align-items-center wa-gap-s" aria-label="Site navigation">
            ${this._auth.user
              ? html`<user-menu .user=${this._auth.user}></user-menu>`
              : html`
                  <wa-button
                    size="s"
                    variant="brand"
                    appearance="outlined"
                    href=${signInHref}
                  >
                    Sign In
                  </wa-button>
                `}
          </nav>
        </header>

        <main class="app-main">${this.router.outlet}</main>

        ${this.noFooter ? nothing : html`
          <footer slot="footer" class="footer-inner">
            &copy; ${new Date().getFullYear()} Mapadillo
          </footer>
        `}
      </wa-page>
    `;
  }

  /** wa-page's skip link targets #main-content, which fragment lookup cannot find inside this shadow root. */
  private _onSkipToContent(e: MouseEvent) {
    const link = e.composedPath().find((n): n is HTMLAnchorElement =>
      n instanceof HTMLAnchorElement && n.part.contains('skip-to-content'));
    if (!link) return;
    e.preventDefault();
    const page = this.renderRoot.querySelector<HTMLElement>('main.app-main > :not(style)');
    if (!page) return;
    page.tabIndex = -1;
    page.focus();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
