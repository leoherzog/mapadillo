/**
 * App shell — layout wrapper with header, main, and footer.
 * Owns the router and renders the current page into `<main>`.
 */
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { Router } from '../router.js';
import { requireAuth } from '../auth/auth-guard.js';

// Page imports (lazy loading would happen in enter() hooks in prod)
import '../pages/landing-page.js';
import '../pages/sign-in-page.js';
import '../pages/dashboard-page.js';
import '../pages/trip-builder-page.js';

@customElement('app-shell')
export class AppShell extends LitElement {
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
      enter: requireAuth,
      render: ({ id }) => html`<trip-builder-page .mapId=${id ?? ''}></trip-builder-page>`,
    },
  ]);

  static styles = css`
    :host {
      display: block;
    }

    .header-inner {
      display: flex;
      align-items: center;
      gap: var(--wa-space-m);
      padding: var(--wa-space-s) var(--wa-space-l);
    }

    .logo {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      text-decoration: none;
      color: var(--wa-color-brand-600, #e05e00);
      font-weight: 900;
      font-size: 1.15rem;
    }

    .logo wa-icon {
      font-size: 1.5rem;
    }

    .header-nav {
      display: flex;
      gap: var(--wa-space-s);
      align-items: center;
      margin-left: auto;
    }

    .footer-inner {
      padding: var(--wa-space-m) var(--wa-space-l);
      text-align: center;
      font-size: 0.8rem;
      color: var(--wa-color-neutral-500);
    }

    .footer-inner a {
      color: inherit;
    }
  `;

  render() {
    return html`
      <wa-page disable-sticky="header">
        <div slot="header" class="header-inner">
          <a class="logo" href="/" @click=${this._navClick('/')}>
            <wa-icon name="map" family="jelly"></wa-icon>
            Kids Roadtrip Map
          </a>

          <div class="header-nav">
            <wa-button
              appearance="plain"
              variant="neutral"
              size="small"
              href="/dashboard"
              @click=${this._navClick('/dashboard')}
            >My Trips</wa-button>
            <wa-button
              size="small"
              variant="brand"
              href="/sign-in"
              @click=${this._navClick('/sign-in')}
            >
              Sign In
            </wa-button>
          </div>
        </div>

        ${this.router.outlet}

        <div slot="footer" class="footer-inner">
          &copy; ${new Date().getFullYear()} Kids Roadtrip Map &mdash;
          Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>
        </div>
      </wa-page>
    `;
  }

  private _navClick(path: string) {
    return (e: Event) => {
      e.preventDefault();
      this.router.navigate(path);
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'app-shell': AppShell;
  }
}
