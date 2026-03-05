/**
 * Export page — map preview + export controls sidebar.
 *
 * Left panel: read-only map view showing all stops and route lines.
 * Right panel: sidebar with trip info, export format options, and download actions.
 */
import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { exportMap, type ExportFormat } from '../map/map-export.js';
import { navigateTo } from '../nav.js';
import { formatDistance } from '../utils/geo.js';
import { MapPageBase } from './map-page-base.js';
import type { MapView } from '../components/map-view.js';
import '../components/map-view.js';
import '../components/export-options.js';

@customElement('export-page')
export class ExportPage extends MapPageBase {
  @state() private _exporting = false;
  @state() private _exportError = '';
  @state() private _routeDistances = new Map<string, number>();

  private get _totalDistance(): number {
    let sum = 0;
    for (const d of this._routeDistances.values()) sum += d;
    return sum;
  }

  static styles = [waUtilities, css`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    .map-panel {
      flex: 1;
      min-width: 0;
      position: relative;
    }

    .sidebar {
      width: 380px;
      min-width: 300px;
      flex-shrink: 0;
      padding: var(--wa-space-l);
      overflow-y: auto;
      border-left: 1px solid var(--wa-color-neutral-200);
      background: var(--wa-color-surface-default);
    }

    h1 {
      font-size: var(--wa-font-size-xl);
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-60, #e05e00);
    }

    h1 wa-icon {
      font-size: 1.3rem;
    }

    .trip-info h2 {
      margin: 0;
      font-size: var(--wa-font-size-l);
      font-weight: 700;
      color: var(--wa-color-neutral-900);
    }

    .trip-info .family-name {
      margin: 0;
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-neutral-500);
    }

    .stat-row {
      font-size: 0.9rem;
    }

    .stat-row wa-icon {
      color: var(--wa-color-brand-60, #e05e00);
      font-size: 1rem;
    }

    .stat-value {
      font-weight: 700;
      color: var(--wa-color-neutral-900);
    }

    .stat-label {
      color: var(--wa-color-neutral-500);
    }

    .loading-container {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--wa-space-2xl);
    }

    /* Responsive: stack on narrow viewports */
    @media (max-width: 700px) {
      :host {
        flex-direction: column;
      }

      .sidebar {
        width: 100%;
        min-width: 0;
        border-left: none;
        border-bottom: 1px solid var(--wa-color-neutral-200);
        max-height: 40vh;
        order: -1;
      }

      .map-panel {
        min-height: 300px;
      }
    }
  `];

  protected async _syncMap() {
    if (!this._mapReady || !this._mapController) return;

    try {
      const result = await this._mapController.drawItems(this._items);
      this._routeDistances = result.distances;
    } catch (err) {
      console.warn('Map drawing failed:', err);
    }
  }

  render() {
    const units = this._map?.units ?? 'km';

    return html`
      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>
      </div>

      <div class="sidebar wa-stack wa-gap-m">
        ${this._loading ? html`
          <div class="loading-container"><wa-spinner></wa-spinner></div>
        ` : this._error ? html`
          <wa-callout variant="danger">
            <wa-icon slot="icon" name="circle-xmark"></wa-icon>
            ${this._error}
          </wa-callout>
        ` : html`
          <h1>
            <wa-icon name="file-export"></wa-icon>
            Export
          </h1>

          <wa-divider></wa-divider>

          <div class="trip-info wa-stack wa-gap-2xs">
            <h2>${this._map?.name ?? 'Untitled Trip'}</h2>
            ${this._map?.family_name
              ? html`<p class="family-name">${this._map.family_name}</p>`
              : ''}
          </div>

          ${this._items.length > 0 ? html`
            <div class="wa-stack wa-gap-xs">
              <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
                <wa-icon name="map"></wa-icon>
                <span class="stat-label">Items:</span>
                <span class="stat-value">${this._items.length}</span>
              </div>
              ${this._totalDistance ? html`
                <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
                  <wa-icon name="route"></wa-icon>
                  <span class="stat-label">Total distance:</span>
                  <span class="stat-value">${formatDistance(this._totalDistance, units)}</span>
                </div>
              ` : ''}
            </div>
          ` : ''}

          <wa-divider></wa-divider>

          <export-options
            ?exporting=${this._exporting}
            .error=${this._exportError}
            @export-request=${this._onExportRequest}
          ></export-options>

          <wa-divider></wa-divider>
        `}

        ${!this._loading && !this._error ? html`
          <wa-button
            variant="neutral"
            appearance="outlined"
            @click=${this._onBackToBuilder}
          >
            <wa-icon slot="start" name="arrow-left"></wa-icon>
            Back to trip builder
          </wa-button>
        ` : ''}
      </div>
    `;
  }

  private async _onExportRequest(e: CustomEvent<{ format: ExportFormat }>) {
    if (!this._map || !this._mapController) return;

    const { format } = e.detail;
    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map) return;

    this._exporting = true;
    this._exportError = '';

    try {
      await exportMap(mapView.map, format, this._map, this._items, this._map.units ?? 'km', this._routeDistances);
    } catch (err) {
      this._exportError = err instanceof Error ? err.message : 'Export failed';
    } finally {
      this._exporting = false;
    }
  }

  private _onBackToBuilder() {
    navigateTo(`/map/${this.mapId}`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'export-page': ExportPage;
  }
}
