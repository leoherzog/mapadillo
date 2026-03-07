/**
 * Export page — map preview + export controls sidebar.
 *
 * Left panel: read-only map view showing all stops and route lines.
 * Right panel: sidebar with trip info, export format options, and download actions.
 */
import { html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { pageLayoutStyles, familyNameStyles } from '../styles/page-layout.js';
import { headingStyles } from '../styles/heading-shared.js';
import { exportMap, type ExportFormat, type PaperSize, type Orientation } from '../map/map-export.js';
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

  static styles = [waUtilities, headingStyles, pageLayoutStyles, familyNameStyles, css`
    .trip-info h2 {
      margin: 0;
      font-size: var(--wa-font-size-l);
      font-weight: var(--wa-font-weight-bold);
      color: var(--wa-color-text-normal);
    }

    /* On narrow viewports, show sidebar above the map */
    @media (max-width: 700px) {
      .sidebar {
        order: -1;
      }
    }
  `];

  render() {
    const units = this._map?.units ?? 'km';

    return html`
      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>
      </div>

      <div class="sidebar sidebar-right wa-stack wa-gap-m">
        ${this._loading ? html`
          <div class="loading-center"><wa-spinner></wa-spinner></div>
        ` : this._error ? html`
          <wa-callout variant="danger">
            <wa-icon slot="icon" name="circle-xmark"></wa-icon>
            ${this._error}
          </wa-callout>
        ` : html`
          <h1>
            <wa-icon name="print"></wa-icon>
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
                  <wa-icon name="location-arrow"></wa-icon>
                  <span class="stat-label">Total distance:</span>
                  <span class="stat-value">${formatDistance(this._totalDistance, units)}</span>
                </div>
              ` : nothing}
            </div>
          ` : html`
            <wa-callout variant="warning">
              <wa-icon slot="icon" name="circle-info"></wa-icon>
              This trip has no stops or routes yet. Go back to the trip builder to add some!
            </wa-callout>
          `}

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
        ` : nothing}
      </div>
    `;
  }

  private async _onExportRequest(e: CustomEvent<{ format: ExportFormat; paperSize: PaperSize; orientation: Orientation }>) {
    if (!this._map || !this._mapController) return;

    const { format, paperSize, orientation } = e.detail;
    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map) return;

    this._exporting = true;
    this._exportError = '';

    try {
      await exportMap(mapView.map, format, this._map, this._items, this._mapController!.markerFeatures, this._map.units ?? 'km', paperSize, orientation, this._routeDistances);
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
