/**
 * Dashboard page — shows user's trips as map cards.
 *
 * M4: Fetches owned maps from the API and displays them as thumbnail cards
 * with mini MapLibre previews.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { User } from '../auth/auth-state.js';
import type { MapWithRole } from '../services/maps.js';
import { listMaps, deleteMap } from '../services/maps.js';
import { navClick } from '../nav.js';
import '../components/map-card.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('dashboard-page')
export class DashboardPage extends LitElement {
  @property({ type: Object }) user: User | null = null;

  @state() private _maps: MapWithRole[] = [];
  @state() private _loading = true;
  @state() private _fetchError = false;
  @state() private _deleteMapId: string | null = null;

  private get _myMaps(): MapWithRole[] {
    return this._maps.filter(m => m.role === 'owner');
  }

  private get _sharedMaps(): MapWithRole[] {
    return this._maps.filter(m => m.role !== 'owner');
  }

  @state() private _deleteError = '';
  private _deleteErrorTimer?: ReturnType<typeof setTimeout>;

  @state() private _dialogOpen = false;

  static styles = [waUtilities, css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: 1000px;
      margin: 0 auto;
      overflow-y: auto;
    }

    h1 {
      font-size: var(--wa-font-size-3xl);
      font-weight: var(--wa-font-weight-bold);
      color: var(--wa-color-brand-60);
      margin: 0 0 var(--wa-space-xs);
    }

    h2 {
      font-size: var(--wa-font-size-xl);
      font-weight: 800;
      color: var(--wa-color-brand-60);
      margin: var(--wa-space-2xl) 0 var(--wa-space-xs);
    }

    h1 wa-icon {
      font-size: var(--wa-font-size-2xl);
      vertical-align: -0.1em;
    }

    h2 wa-icon {
      font-size: var(--wa-font-size-l);
      vertical-align: -0.1em;
    }

    .empty-state {
      padding: var(--wa-space-2xl);
      text-align: center;
      border: var(--wa-border-width-m) dashed var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-l);
      color: var(--wa-color-text-quiet);
    }

    .empty-state p {
      margin: 0;
    }

    .map-grid {
      --min-column-size: 280px;
      margin-top: var(--wa-space-l);
    }

    .loading-center {
      padding: var(--wa-space-2xl);
    }

    .delete-callout {
      margin-bottom: var(--wa-space-m);
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    this._fetchMaps();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._deleteErrorTimer);
  }

  private async _fetchMaps() {
    this._loading = true;
    this._fetchError = false;
    try {
      this._maps = await listMaps();
    } catch {
      this._maps = [];
      this._fetchError = true;
    } finally {
      this._loading = false;
    }
  }

  render() {
    return html`
      <h1>
        <wa-icon name="map"></wa-icon>
        My Trips
      </h1>

      ${this._deleteError ? html`
        <wa-callout variant="danger" class="delete-callout">
          <wa-icon slot="icon" name="circle-xmark"></wa-icon>
          ${this._deleteError}
        </wa-callout>
      ` : nothing}

      ${this._loading
        ? html`<div class="loading-center wa-cluster wa-justify-content-center"><wa-spinner></wa-spinner></div>`
        : this._fetchError
          ? html`
              <wa-callout variant="danger">
                <wa-icon slot="icon" name="circle-xmark"></wa-icon>
                Failed to load your trips. Please try refreshing the page.
              </wa-callout>
            `
          : this._myMaps.length === 0
          ? html`
              <div class="empty-state wa-stack wa-gap-m wa-align-items-center">
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
              <div class="map-grid wa-grid wa-gap-l" @map-delete=${this._onMapDelete}>
                ${this._myMaps.map(
                  (m) => html`<map-card .map=${m}></map-card>`,
                )}
              </div>
            `}

      <h2>
        <wa-icon name="share-nodes"></wa-icon>
        Shared with Me
      </h2>

      ${this._loading
        ? html`<div class="loading-center wa-cluster wa-justify-content-center"><wa-spinner></wa-spinner></div>`
        : this._sharedMaps.length === 0
          ? html`
              <div class="empty-state wa-stack wa-gap-m wa-align-items-center">
                <p>No shared trips yet. When someone shares a trip with you, it will appear here.</p>
              </div>
            `
          : html`
              <div class="map-grid wa-grid wa-gap-l">
                ${this._sharedMaps.map(
                  (m) => html`<map-card .map=${m} .roleBadge=${m.role}></map-card>`,
                )}
              </div>
            `}

      <wa-dialog label="Delete Trip?" ?open=${this._dialogOpen} @wa-after-hide=${this._onDialogCancel}>
        <p>This cannot be undone.</p>
        <wa-button slot="footer" variant="danger" @click=${this._onDialogConfirm}>Delete</wa-button>
        <wa-button slot="footer" appearance="outlined" variant="neutral" @click=${this._onDialogCancel}>Cancel</wa-button>
      </wa-dialog>
    `;
  }

  private _onMapDelete(e: CustomEvent<{ mapId: string }>) {
    this._deleteMapId = e.detail.mapId;
    this._dialogOpen = true;
  }

  private _onDialogCancel() {
    this._deleteMapId = null;
    this._dialogOpen = false;
  }

  private async _onDialogConfirm() {
    const mapId = this._deleteMapId;
    this._deleteMapId = null;
    this._dialogOpen = false;
    if (!mapId) return;

    try {
      await deleteMap(mapId);
      this._maps = this._maps.filter((m) => m.id !== mapId);
    } catch {
      this._deleteError = 'Failed to delete trip. Please try again.';
      clearTimeout(this._deleteErrorTimer);
      this._deleteErrorTimer = setTimeout(() => { this._deleteError = ''; }, 5000);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dashboard-page': DashboardPage;
  }
}
