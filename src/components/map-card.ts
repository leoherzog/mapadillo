/**
 * Map card — clickable card showing a mini map preview with trip metadata.
 *
 * Renders a non-interactive MapLibre map with markers for each stop,
 * fitted to bounds. Below the map: trip name, family name, stop count,
 * and relative update time. Click navigates to the map detail view.
 */
import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import maplibregl from 'maplibre-gl';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import type { MapWithStops } from '../services/maps.js';
import { navigateTo } from '../nav.js';

@customElement('map-card')
export class MapCard extends LitElement {
  @property({ type: Object }) map!: MapWithStops;

  private _mapInstance?: maplibregl.Map;

  static styles = [
    unsafeCSS(maplibreCss),
    css`
      :host {
        display: block;
        cursor: pointer;
      }

      wa-card {
        --spacing: 0.75rem;
      }

      wa-card::part(base):hover {
        box-shadow: var(--wa-shadow-m);
      }

      .map-container {
        width: 100%;
        height: 200px;
      }

      h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
      }

      .family {
        font-size: 0.85rem;
        color: var(--wa-color-neutral-500);
        margin-top: 0.15rem;
      }

      .meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 0.35rem;
        font-size: 0.8rem;
        color: var(--wa-color-neutral-400);
      }

      .meta wa-button::part(base) {
        color: var(--wa-color-neutral-400);
      }

      .meta wa-button::part(base):hover {
        color: var(--wa-color-danger-600);
      }
    `,
  ];

  protected firstUpdated(): void {
    const container = this.shadowRoot!.querySelector('.map-container') as HTMLElement;
    if (!container) return;

    this._mapInstance = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [0, 20],
      zoom: 2,
      interactive: false,
      attributionControl: false,
    });

    this._mapInstance.on('load', () => {
      this._addMarkers();
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mapInstance?.remove();
    this._mapInstance = undefined;
  }

  private _addMarkers() {
    if (!this._mapInstance || !this.map.stops?.length) return;

    const bounds = new maplibregl.LngLatBounds();

    for (const stop of this.map.stops) {
      new maplibregl.Marker({ color: '#ff6b00' })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(this._mapInstance);
      bounds.extend([stop.longitude, stop.latitude]);
    }

    this._mapInstance.fitBounds(bounds, { padding: 30, maxZoom: 12 });
  }

  render() {
    const stopCount = this.map.stops?.length ?? 0;

    return html`
      <wa-card @click=${this._onClick}>
        <div slot="media" class="map-container"></div>
        <h3>${this.map.name}</h3>
        ${this.map.family_name
          ? html`<div class="family">${this.map.family_name}</div>`
          : ''}
        <div class="meta">
          <span>${stopCount} stop${stopCount !== 1 ? 's' : ''} · Updated <wa-relative-time date=${this.map.updated_at} sync></wa-relative-time></span>
          <wa-button appearance="plain" size="small" @click=${this._onDelete}>
            <wa-icon name="trash" label="Delete map"></wa-icon>
          </wa-button>
        </div>
      </wa-card>
    `;
  }

  private _onClick(e: Event) {
    // Don't navigate if the delete button was clicked
    const target = e.target as HTMLElement;
    if (target.closest('wa-button')) return;
    navigateTo(`/map/${this.map.id}`);
  }

  private _onDelete(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('map-delete', {
        detail: { mapId: this.map.id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-card': MapCard;
  }
}
