/**
 * Map card — clickable card showing a mini map preview with trip metadata.
 *
 * Renders a non-interactive MapLibre map with markers for each stop,
 * fitted to bounds. Below the map: trip name, family name, stop count,
 * and relative update time. Click navigates to the map detail view.
 */
import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import maplibregl from 'maplibre-gl';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import type { MapWithStops } from '../services/maps.js';
import { navigateTo } from '../nav.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord } from '../utils/geo.js';
import { MAP_STYLE_URL } from '../config/map.js';
import { TRAVEL_MODES } from '../config/travel-modes.js';

@customElement('map-card')
export class MapCard extends LitElement {
  @property({ type: Object }) map!: MapWithStops;
  @property() roleBadge: string | null = null;

  private _mapInstance?: maplibregl.Map;
  private _resizeObserver?: ResizeObserver;

  static styles = [
    waUtilities,
    cardSharedStyles,
    unsafeCSS(maplibreCss),
    css`
      :host {
        display: block;
        cursor: pointer;
      }

      wa-card {
        --spacing: var(--wa-space-s);
      }

      wa-card::part(base):hover {
        box-shadow: var(--wa-shadow-m);
      }

      [slot='media'] {
        position: relative;
      }

      .map-container {
        position: absolute;
        inset: 0;
      }

      h3 {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: 600;
      }

      .family {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-neutral-500);
        margin-top: var(--wa-space-3xs);
      }

      .meta {
        margin-top: 0.35rem;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-neutral-400);
      }
    `,
  ];

  protected firstUpdated(): void {
    const container = this.shadowRoot!.querySelector('.map-container') as HTMLElement;
    if (!container) return;

    this._mapInstance = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      center: [0, 20],
      zoom: 2,
      interactive: false,
      attributionControl: false,
    });

    this._mapInstance.on('load', () => {
      this._addMarkers();
    });

    this._resizeObserver = new ResizeObserver(() => {
      this._mapInstance?.resize();
    });
    this._resizeObserver.observe(container);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._mapInstance?.remove();
    this._mapInstance = undefined;
  }

  private _addMarkers() {
    if (!this._mapInstance || !this.map.stops?.length) return;

    const bounds = new maplibregl.LngLatBounds();
    const color = getComputedStyle(this).getPropertyValue('--wa-color-brand-50').trim() || '#ff6b00';

    // Build mode → hex color lookup
    const modeColors: Record<string, string> = Object.fromEntries(
      TRAVEL_MODES.map((m) => [m.mode, m.hexColor]),
    );

    // Render cached route geometry lines
    for (const stop of this.map.stops) {
      if (stop.type !== 'route' || !stop.route_geometry) continue;
      try {
        const geometry = JSON.parse(stop.route_geometry) as { coordinates: [number, number][] };
        if (!geometry.coordinates?.length) continue;

        const sourceId = `card-route-${stop.id}`;
        this._mapInstance.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: geometry.coordinates },
          },
        });
        this._mapInstance.addLayer({
          id: sourceId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': modeColors[stop.travel_mode ?? 'drive'] ?? color,
            'line-width': 3,
            'line-opacity': 0.7,
          },
          layout: { 'line-join': 'round', 'line-cap': 'round' },
        });

        for (const coord of geometry.coordinates) {
          bounds.extend(coord);
        }
      } catch {
        // Skip malformed geometry
      }
    }

    for (const stop of this.map.stops) {
      if (isDraftCoord(stop.latitude, stop.longitude)) continue;

      new maplibregl.Marker({ color })
        .setLngLat([stop.longitude, stop.latitude])
        .addTo(this._mapInstance);
      bounds.extend([stop.longitude, stop.latitude]);

      // For routes, also add a marker at the destination
      if (stop.type === 'route' && stop.dest_latitude != null && stop.dest_longitude != null
        && !isDraftCoord(stop.dest_latitude, stop.dest_longitude)) {
        new maplibregl.Marker({ color })
          .setLngLat([stop.dest_longitude, stop.dest_latitude])
          .addTo(this._mapInstance);
        bounds.extend([stop.dest_longitude, stop.dest_latitude]);
      }
    }

    if (!bounds.isEmpty()) {
      this._mapInstance.fitBounds(bounds, { padding: 30, maxZoom: 12 });
    }
  }

  render() {
    const itemCount = this.map.stops?.length ?? 0;

    return html`
      <wa-card
        tabindex="0"
        role="button"
        aria-label=${this.map.name}
        @click=${this._onClick}
        @keydown=${this._onKeyDown}
      >
        <div slot="media" class="wa-frame:landscape">
          <div class="map-container"></div>
        </div>
        <div class="wa-cluster wa-align-items-center wa-gap-xs">
          <h3>${this.map.name}</h3>
          ${this.roleBadge ? html`<wa-badge variant=${this.roleBadge === 'editor' ? 'brand' : 'neutral'}>${this.roleBadge}</wa-badge>` : nothing}
        </div>
        ${this.map.family_name
          ? html`<div class="family">${this.map.family_name}</div>`
          : nothing}
        <div class="meta wa-split wa-align-items-center">
          <span>${itemCount} item${itemCount !== 1 ? 's' : ''} · Updated <wa-relative-time date=${this.map.updated_at} sync></wa-relative-time></span>
          ${!this.roleBadge ? html`
            <wa-button class="delete-btn" appearance="plain" size="small" @click=${this._onDelete}>
              <wa-icon name="trash" label="Delete map"></wa-icon>
            </wa-button>
          ` : nothing}
        </div>
      </wa-card>
    `;
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._onClick(e);
    }
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
