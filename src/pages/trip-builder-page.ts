/**
 * Trip builder page — sidebar with search + full-screen map.
 *
 * M3: Map display + geocoding autocomplete. Selecting a place flies to it
 * and drops a marker. Stop management and route drawing arrive in M4–M5.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GeocodingResult } from '../services/geocoding.js';
import '../components/map-view.js';
import '../components/location-search.js';

@customElement('trip-builder-page')
export class TripBuilderPage extends LitElement {
  @property() mapId: string = '';

  static styles = css`
    :host {
      display: flex;
      flex: 1;
      min-height: 0;
    }

    .sidebar {
      width: 380px;
      min-width: 300px;
      flex-shrink: 0;
      padding: var(--wa-space-l);
      overflow-y: auto;
      border-right: 1px solid var(--wa-color-neutral-200);
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
      background: var(--wa-color-surface-default);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-600, #e05e00);
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
    }

    h1 wa-icon {
      font-size: 1.3rem;
    }

    .search-section {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-xs);
    }

    .search-label {
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--wa-color-neutral-700);
    }

    .map-panel {
      flex: 1;
      min-width: 0;
      position: relative;
    }

    /* Responsive: stack on narrow viewports */
    @media (max-width: 700px) {
      :host {
        flex-direction: column;
      }

      .sidebar {
        width: 100%;
        min-width: 0;
        border-right: none;
        border-bottom: 1px solid var(--wa-color-neutral-200);
        max-height: 40vh;
      }

      .map-panel {
        min-height: 300px;
      }
    }
  `;

  render() {
    return html`
      <div class="sidebar">
        <h1>
          <wa-icon name="compass" family="jelly"></wa-icon>
          Trip Builder
        </h1>

        <div class="search-section">
          <span class="search-label">Add a stop</span>
          <location-search
            @location-selected=${this._onLocationSelected}
          ></location-search>
        </div>

        <wa-callout variant="neutral">
          <wa-icon slot="icon" name="circle-info"></wa-icon>
          Search for places to add stops to your trip.
          Full stop management coming in Milestone 4.
        </wa-callout>
      </div>

      <div class="map-panel">
        <map-view></map-view>
      </div>
    `;
  }

  private _onLocationSelected(e: CustomEvent<GeocodingResult>) {
    const { longitude, latitude, name } = e.detail;
    const mapView = this.shadowRoot?.querySelector('map-view');
    if (!mapView) return;

    mapView.clearMarkers();
    mapView.addMarker(longitude, latitude, name);
    mapView.flyTo(longitude, latitude);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'trip-builder-page': TripBuilderPage;
  }
}
