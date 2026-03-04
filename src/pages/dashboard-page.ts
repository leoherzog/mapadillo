/**
 * Dashboard page — shows user's trips as map cards.
 *
 * M4: Fetches owned maps from the API and displays them as thumbnail cards
 * with mini MapLibre previews.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { User } from '../auth/auth-state.js';
import type { MapWithStops } from '../services/maps.js';
import { listMaps, deleteMap } from '../services/maps.js';
import { navClick } from '../nav.js';
import '../components/map-card.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('dashboard-page')
export class DashboardPage extends LitElement {
  @property({ type: Object }) user: User | null = null;

  @state() private _maps: MapWithStops[] = [];
  @state() private _loading = true;
  @state() private _deleteMapId: string | null = null;

  @query('wa-dialog') private _dialog!: HTMLElement & { open: boolean; hide(): void; show(): void };

  static styles = [waUtilities, css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: 1000px;
      margin: 0 auto;
    }

    .greeting {
      font-size: var(--wa-font-size-l);
      color: var(--wa-color-neutral-600);
      margin: 0 0 var(--wa-space-l);
      font-weight: 500;
    }

    h1 {
      font-size: var(--wa-font-size-3xl);
      font-weight: 900;
      color: var(--wa-color-brand-60, #e05e00);
      margin: 0 0 var(--wa-space-xs);
    }

    h2 {
      font-size: var(--wa-font-size-xl);
      font-weight: 800;
      color: var(--wa-color-brand-60, #e05e00);
      margin: var(--wa-space-2xl) 0 var(--wa-space-xs);
    }

    h1 wa-icon {
      font-size: 1.7rem;
      vertical-align: -0.1em;
    }

    h2 wa-icon {
      font-size: 1.2rem;
      vertical-align: -0.1em;
    }

    .empty-state {
      padding: var(--wa-space-2xl);
      text-align: center;
      border: 2px dashed var(--wa-color-neutral-300);
      border-radius: var(--wa-border-radius-xl);
      color: var(--wa-color-neutral-600);
    }

    .empty-state wa-icon {
      font-size: 3rem;
    }

    .empty-state p {
      margin: 0;
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    this._fetchMaps();
  }

  private async _fetchMaps() {
    this._loading = true;
    try {
      this._maps = await listMaps();
    } catch {
      // Silent fail — show empty state
      this._maps = [];
    } finally {
      this._loading = false;
    }
  }

  render() {
    const firstName = this.user?.name?.split(' ')[0] ?? '';

    return html`
      ${firstName
        ? html`<p class="greeting">Hey ${firstName}!</p>`
        : ''}

      <h1>
        <wa-icon name="map"></wa-icon>
        My Trips
      </h1>

      ${this._loading
        ? html`<div class="wa-cluster wa-justify-content-center" style="padding: var(--wa-space-2xl)"><wa-spinner></wa-spinner></div>`
        : this._maps.length === 0
          ? html`
              <div class="empty-state wa-stack wa-gap-m wa-align-items-center">
                <wa-icon name="map" style="color: var(--wa-color-neutral-400);"></wa-icon>
                <p>No trips yet! Create your first adventure to get started.</p>
                <wa-button variant="brand" href="/map/new" @click=${navClick('/map/new')}>
                  <wa-icon slot="start" name="plus"></wa-icon>
                  Create New Trip
                </wa-button>
              </div>
            `
          : html`
              <wa-button variant="brand" href="/map/new" @click=${navClick('/map/new')}>
                <wa-icon slot="start" name="plus"></wa-icon>
                Create New Trip
              </wa-button>
              <div class="wa-grid wa-gap-l" style="--min-column-size: 280px; margin-top: var(--wa-space-l)" @map-delete=${this._onMapDelete}>
                ${this._maps.map(
                  (m) => html`<map-card .map=${m}></map-card>`,
                )}
              </div>
            `}

      <h2>
        <wa-icon name="share-nodes"></wa-icon>
        Shared with Me
      </h2>

      <div class="empty-state wa-stack wa-gap-m wa-align-items-center">
        <wa-icon name="share-nodes" style="color: var(--wa-color-neutral-400);"></wa-icon>
        <p>No shared trips yet. When someone shares a trip with you, it will appear here.</p>
      </div>

      <wa-dialog label="Delete Trip?">
        <p>This cannot be undone.</p>
        <wa-button slot="footer" variant="danger" @click=${this._onDialogConfirm}>Delete</wa-button>
        <wa-button slot="footer" appearance="outlined" variant="neutral" @click=${this._onDialogCancel}>Cancel</wa-button>
      </wa-dialog>
    `;
  }

  private _onMapDelete(e: CustomEvent<{ mapId: string }>) {
    this._deleteMapId = e.detail.mapId;
    this._dialog.show();
  }

  private _onDialogCancel() {
    this._deleteMapId = null;
    this._dialog.hide();
  }

  private async _onDialogConfirm() {
    const mapId = this._deleteMapId;
    this._deleteMapId = null;
    this._dialog.hide();
    if (!mapId) return;

    try {
      await deleteMap(mapId);
      this._maps = this._maps.filter((m) => m.id !== mapId);
    } catch {
      // Could show error toast, but for now silent
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dashboard-page': DashboardPage;
  }
}
