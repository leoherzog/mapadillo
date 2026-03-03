/**
 * Dashboard page — M1 stub.
 * Full implementation in Milestone 4 (map list, shared maps).
 */
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('dashboard-page')
export class DashboardPage extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: 1000px;
      margin: 0 auto;
    }

    h1 {
      font-size: 2rem;
      font-weight: 900;
      color: var(--wa-color-brand-600, #e05e00);
      margin: 0 0 var(--wa-space-l);
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
    return html`
      <h1>
        <wa-icon name="map" family="jelly"></wa-icon>
        My Trips
      </h1>

      <div class="empty-state">
        <wa-icon name="map" family="jelly" style="color: var(--wa-color-neutral-400);"></wa-icon>
        <p>No trips yet! Create your first road trip to get started.</p>
        <wa-button variant="brand">
          <wa-icon slot="start" name="plus"></wa-icon>
          Create New Trip
        </wa-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dashboard-page': DashboardPage;
  }
}
