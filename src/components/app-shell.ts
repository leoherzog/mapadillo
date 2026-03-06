/**
 * App shell — layout wrapper with header, main, and footer.
 * Owns the router and renders the current page into `<main>`.
 *
 * Header shows "Sign In" when unauthenticated, user-menu when authenticated.
 */
import { LitElement, html, css } from 'lit';
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
      render: () => html`<dashboard-page .user=${this._user}></dashboard-page>`,
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
      enter: requireAuth,
      render: ({ id }) => html`<export-page .mapId=${id ?? ''}></export-page>`,
    },
    {
      path: '/claim/:token',
      enter: requireAuth,
      render: ({ token }) => html`<claim-page .token=${token ?? ''}></claim-page>`,
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
      color: var(--wa-color-brand-60, #e05e00);
      font-weight: 900;
      font-size: var(--wa-font-size-l);
      cursor: pointer;
    }

    .logo wa-icon {
      font-size: var(--wa-font-size-xl);
    }

    .header-nav {
      margin-left: auto;
    }

    .footer-inner {
      display: block;
      padding: var(--wa-space-m) var(--wa-space-l);
      text-align: center;
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-neutral-500);
    }

    wa-page::part(navigation-toggle),
    wa-page::part(navigation) {
      display: none;
    }

    /* Pin layout to viewport height so map pages don't overflow */
    wa-page::part(base) {
      height: 100dvh;
    }

    wa-page::part(body) {
      align-items: stretch;
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

  render() {
    return html`
      <wa-page disable-sticky="header">
        <div slot="header" class="header-inner wa-cluster wa-align-items-center wa-gap-m">
          <a class="logo wa-cluster wa-align-items-center wa-gap-xs" href="/" @click=${navClick('/')}>
            <wa-icon name="map"></wa-icon>
            Mapadillo
          </a>

          <nav class="header-nav wa-cluster wa-align-items-center wa-gap-s" aria-label="Site navigation">
            ${this._user
              ? html`
                  <wa-button
                    appearance="plain"
                    variant="neutral"
                    size="small"
                    href="/dashboard"
                    @click=${navClick('/dashboard')}
                  >My Trips</wa-button>
                  <user-menu .user=${this._user}></user-menu>
                `
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

        <div slot="footer" class="footer-inner">
          &copy; ${new Date().getFullYear()} Mapadillo
        </div>
      </wa-page>
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
