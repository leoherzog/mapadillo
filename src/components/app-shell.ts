/**
 * App shell — layout wrapper with header, main, and footer.
 * Owns the router and renders the current page into `<main>`.
 *
 * Header shows "Sign In" when unauthenticated, user-menu when authenticated.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Router } from '../router.js';
import { requireAuth } from '../auth/auth-guard.js';
import { getUser, onAuthChange, type User } from '../auth/auth-state.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { navClick } from '../nav.js';

// Page imports
import '../pages/landing-page.js';
import '../pages/sign-in-page.js';
import '../pages/dashboard-page.js';
import '../pages/trip-builder-page.js';
import '../pages/claim-page.js';
import '../pages/map-preview-page.js';
import '../pages/export-page.js';
import '../pages/order-page.js';
import '../pages/order-confirmation-page.js';
import '../pages/admin-page.js';
import './user-menu.js';

@customElement('app-shell')
export class AppShell extends LitElement {
  @state() private _user: User | null = null;
  private _unsubAuth?: () => void;

  // Router is a reactive controller — it calls requestUpdate() when the route changes
  private router = new Router(this, [
    {
      path: '/',
      render: () => html`<landing-page></landing-page>`,
    },
    {
      path: '/sign-in',
      render: () => html`<sign-in-page></sign-in-page>`,
    },
    {
      path: '/dashboard',
      enter: requireAuth,
      render: () => html`<dashboard-page></dashboard-page>`,
    },
    {
      path: '/map/new',
      enter: requireAuth,
      render: () => html`<trip-builder-page .mapId=${''}></trip-builder-page>`,
    },
    {
      path: '/map/:id',
      render: ({ id }) => html`<trip-builder-page .mapId=${id ?? ''}></trip-builder-page>`,
    },
    {
      path: '/preview/:id',
      render: ({ id }) => html`<map-preview-page .mapId=${id ?? ''}></map-preview-page>`,
    },
    {
      path: '/export/:id',
      render: ({ id }) => html`<export-page .mapId=${id ?? ''}></export-page>`,
    },
    {
      path: '/claim/:token',
      enter: requireAuth,
      render: ({ token }) => html`<claim-page .token=${token ?? ''}></claim-page>`,
    },
    {
      path: '/order/:id',
      enter: requireAuth,
      render: ({ id }) => html`<order-page .mapId=${id ?? ''}></order-page>`,
    },
    {
      path: '/order-confirmation/:orderId',
      enter: requireAuth,
      render: ({ orderId }) => html`<order-confirmation-page .orderId=${orderId ?? ''}></order-confirmation-page>`,
    },
    {
      path: '/admin',
      enter: requireAuth,
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


    .footer-inner {
      display: block;
      padding: var(--wa-space-m) var(--wa-space-l);
      text-align: center;
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-text-quiet);
    }

    wa-page::part(navigation-toggle),
    wa-page::part(navigation) {
      display: none;
    }

    /*
     * Full-screen viewport lock for the map editor page.
     * wa-page has no built-in attribute for this — its footer always pushes
     * content below the viewport by design. These ::part() overrides constrain
     * the internal grid chain so trip-builder-page fills exactly 100dvh.
     * Toggled via [no-footer] host attribute set in render().
     * See PLAN.md M8 Implementation Notes for rationale.
     */

    /* Cap the outermost grid at viewport height (internal: min-height: 100dvh) */
    :host([no-footer]) wa-page::part(base) {
      height: 100dvh;
    }

    :host([no-footer]) wa-page::part(footer) {
      display: none;
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

  connectedCallback() {
    super.connectedCallback();
    this._user = getUser();
    this._unsubAuth = onAuthChange(() => {
      this._user = getUser();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubAuth?.();
  }

  private get _isFullHeight() {
    const p = location.pathname;
    return p.startsWith('/map/') || p === '/map/new' || p.startsWith('/preview/');
  }

  render() {
    const fullHeight = this._isFullHeight;
    this.toggleAttribute('no-footer', fullHeight);

    return html`
      <wa-page disable-sticky="header">
        <div slot="header" class="header-inner wa-split wa-align-items-center wa-gap-m">
          <a class="logo wa-cluster wa-align-items-center wa-gap-xs" href="/" @click=${navClick('/')}>
            <wa-icon name="map"></wa-icon>
            Mapadillo
          </a>

          <nav class="wa-cluster wa-align-items-center wa-gap-s" aria-label="Site navigation">
            ${this._user
              ? html`<user-menu .user=${this._user}></user-menu>`
              : html`
                  <wa-button
                    size="small"
                    variant="brand"
                    appearance="outlined"
                    href="/sign-in"
                    @click=${navClick('/sign-in')}
                  >
                    Sign In
                  </wa-button>
                `}
          </nav>
        </div>

        ${this.router.outlet}

        ${fullHeight ? nothing : html`
          <div slot="footer" class="footer-inner">
            &copy; ${new Date().getFullYear()} Mapadillo
          </div>
        `}
      </wa-page>
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
