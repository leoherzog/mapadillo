/**
 * Dashboard page — shows user's trips as map cards.
 *
 * M4: Fetches owned maps from the API and displays them as thumbnail cards
 * with mini MapLibre previews.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { MapWithRole } from '../services/maps.js';
import { listMaps, deleteMap } from '../services/maps.js';
import { listOrders, type Order } from '../services/orders.js';
import { navClick } from '../nav.js';
import '../components/map-card.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { contentPageStyles } from '../styles/content-page.js';
import { STATUS_VARIANTS } from '../../shared/products.js';

@customElement('dashboard-page')
export class DashboardPage extends LitElement {
  @state() private _maps: MapWithRole[] = [];
  @state() private _orders: (Order & { map_name?: string })[] = [];
  @state() private _loading = true;
  @state() private _fetchError = false;
  @state() private _deleteMapId: string | null = null;

  private get _myMaps(): MapWithRole[] {
    return this._maps.filter(m => m.role === 'owner');
  }

  private get _sharedMaps(): MapWithRole[] {
    return this._maps.filter(m => m.role !== 'owner');
  }

  @state() private _dialogOpen = false;

  static styles = [waUtilities, headingStyles, contentPageStyles('1000px'), css`
    h1 {
      font-size: var(--wa-font-size-3xl);
      margin-bottom: var(--wa-space-xs);
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

    .map-grid {
      --min-column-size: 280px;
      margin-top: var(--wa-space-l);
    }

    .loading-center {
      padding: var(--wa-space-2xl);
    }

    .orders-list {
      margin-top: var(--wa-space-m);
    }

    .order-row {
      padding: var(--wa-space-xs) 0;
      border-bottom: 1px solid var(--wa-color-border-normal);
    }

    .order-map-name {
      font-weight: var(--wa-font-weight-semibold);
    }

    .order-detail {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }

    .order-track {
      font-size: var(--wa-font-size-xs);
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    this._fetchMaps();
  }

  private async _fetchMaps() {
    this._loading = true;
    this._fetchError = false;
    try {
      const [maps, orders] = await Promise.all([listMaps(), listOrders().catch(() => [])]);
      this._maps = maps;
      this._orders = orders as (Order & { map_name?: string })[];
    } catch {
      this._maps = [];
      this._orders = [];
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
              <wa-callout variant="neutral">
                <wa-icon slot="icon" name="map"></wa-icon>
                <p>No trips yet! Create your first adventure to get started.</p>
                <wa-button variant="brand" href="/map/new" @click=${navClick('/map/new')}>
                  <wa-icon slot="start" name="plus"></wa-icon>
                  Create New Trip
                </wa-button>
              </wa-callout>
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
              <wa-callout variant="neutral">
                <wa-icon slot="icon" name="share-nodes"></wa-icon>
                <p>No shared trips yet. When someone shares a trip with you, it will appear here.</p>
              </wa-callout>
            `
          : html`
              <div class="map-grid wa-grid wa-gap-l">
                ${this._sharedMaps.map(
                  (m) => html`<map-card .map=${m} .roleBadge=${m.role}></map-card>`,
                )}
              </div>
            `}

      ${this._orders.length > 0 ? html`
        <h2>
          <wa-icon name="print"></wa-icon>
          Print Orders
        </h2>
        <div class="wa-stack wa-gap-s orders-list">
          ${this._orders.map(o => html`
            <div class="wa-cluster wa-gap-m wa-align-items-center order-row">
              <span class="order-map-name">${o.map_name ?? 'Unknown Map'}</span>
              <span class="order-detail">${o.product_type} ${o.poster_size}</span>
              <wa-badge variant=${STATUS_VARIANTS[o.status] ?? 'neutral'}>
                ${o.status.replace(/_/g, ' ')}
              </wa-badge>
              <wa-relative-time .date=${new Date(o.created_at)} class="order-detail"></wa-relative-time>
              ${o.tracking_url ? html`<a href=${o.tracking_url} target="_blank" rel="noopener" class="order-track">Track</a>` : nothing}
            </div>
          `)}
        </div>
      ` : nothing}

      <wa-dialog label="Delete Trip?" ?open=${this._dialogOpen} @wa-after-hide=${this._onDialogCancel}>
        <p>This cannot be undone.</p>
        <wa-button slot="footer" variant="danger" @click=${this._onDialogConfirm}>Delete</wa-button>
        <wa-button slot="footer" appearance="outlined" variant="neutral" @click=${this._onDialogCancel}>Cancel</wa-button>
      </wa-dialog>

      <wa-toast></wa-toast>
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
      const toast = this.renderRoot.querySelector('wa-toast');
      toast?.create('Failed to delete trip. Please try again.', {
        variant: 'danger',
        icon: 'circle-xmark',
        duration: 5000,
      });
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dashboard-page': DashboardPage;
  }
}
