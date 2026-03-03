/**
 * Dashboard page — shows user's trips (empty state for now).
 * Full map list implementation in Milestone 4.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { User } from '../auth/auth-state.js';
import { navClick } from '../nav.js';

@customElement('dashboard-page')
export class DashboardPage extends LitElement {
  @property({ type: Object }) user: User | null = null;

  static styles = css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: 1000px;
      margin: 0 auto;
    }

    .greeting {
      font-size: 1.15rem;
      color: var(--wa-color-neutral-600);
      margin: 0 0 var(--wa-space-l);
      font-weight: 500;
    }

    h1 {
      font-size: 2rem;
      font-weight: 900;
      color: var(--wa-color-brand-600, #e05e00);
      margin: 0 0 var(--wa-space-xs);
    }

    h2 {
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--wa-color-brand-600, #e05e00);
      margin: var(--wa-space-2xl) 0 var(--wa-space-xs);
    }

    h2 wa-icon {
      font-size: 1.2rem;
      vertical-align: -0.1em;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--wa-space-m);
      padding: var(--wa-space-2xl);
      text-align: center;
      border: 2px dashed var(--wa-color-neutral-300);
      border-radius: var(--wa-border-radius-xl);
      color: var(--wa-color-neutral-600);
    }

    .empty-state wa-icon {
      font-size: 3rem;
    }
  `;

  render() {
    const firstName = this.user?.name?.split(' ')[0] ?? '';

    return html`
      ${firstName
        ? html`<p class="greeting">Hey ${firstName}!</p>`
        : ''}

      <h1>
        <wa-icon name="map" family="jelly"></wa-icon>
        My Trips
      </h1>

      <div class="empty-state">
        <wa-icon name="map" family="jelly" style="color: var(--wa-color-neutral-400);"></wa-icon>
        <p>No trips yet! Create your first adventure to get started.</p>
        <wa-button variant="brand" href="/map/new" @click=${navClick('/map/new')}>
          <wa-icon slot="start" name="plus"></wa-icon>
          Create New Trip
        </wa-button>
      </div>

      <h2>
        <wa-icon name="share-nodes" family="jelly"></wa-icon>
        Shared with Me
      </h2>

      <div class="empty-state">
        <wa-icon name="share-nodes" family="jelly" style="color: var(--wa-color-neutral-400);"></wa-icon>
        <p>No shared trips yet. When someone shares a trip with you, it will appear here.</p>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dashboard-page': DashboardPage;
  }
}
