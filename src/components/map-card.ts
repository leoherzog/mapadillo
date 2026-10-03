/**
 * Map card — clickable card showing a mini map preview with trip metadata.
 *
 * When the card nears the viewport it renders a non-interactive MapLibre map
 * fitted to the trip, snapshots it to an image and releases the WebGL context.
 * Below the map: trip name, family name, stop count, and relative update time.
 * The title link is stretched over the whole card.
 */
import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import * as maplibregl from 'maplibre-gl';
import '../map/maplibre-worker.js';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import type { MapWithRole } from '../services/maps.js';
import { roleBadge } from './ui.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord, placedDest } from '../utils/geo.js';
import { resolveMapStyle } from '../config/map.js';
import { TRAVEL_MODES } from '../../shared/travel-modes.js';

@customElement('map-card')
export class MapCard extends LitElement {
  @property({ type: Object }) map!: MapWithRole;

  private _mapInstance?: maplibregl.Map;
  private _io?: IntersectionObserver;

  @state() private _styleError = false;
  /** Data URL of the rendered preview; the live map is removed once it is set. */
  @state() private _thumb: string | null = null;

  static styles = [
    waUtilities,
    cardSharedStyles,
    unsafeCSS(maplibreCss),
    css`
      :host {
        display: block;
      }

      wa-card {
        position: relative;
      }

      /* wa-card's outer element is the host, so style the element directly. */
      wa-card:hover {
        box-shadow: var(--wa-shadow-m);
      }

      .card-link {
        color: inherit;
        text-decoration: none;
      }

      .card-link::after {
        content: '';
        position: absolute;
        inset: 0;
      }

      .card-link:focus-visible {
        outline: none;
      }

      wa-card:has(.card-link:focus-visible) {
        outline: var(--wa-focus-ring);
        outline-offset: var(--wa-focus-ring-offset);
      }

      /* Sits above the stretched link overlay. */
      .delete-btn {
        position: relative;
        z-index: 1;
      }

      [slot='media'] {
        position: relative;
      }

      .map-container {
        position: absolute;
        inset: 0;
      }

      .map-error {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      h3 {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-semibold);
      }

      .family {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        margin-top: var(--wa-space-3xs);
      }

      .meta {
        margin-top: var(--wa-space-2xs);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated && !this._thumb && !this._mapInstance) this._observe();
  }

  protected firstUpdated(): void {
    this._observe();
  }

  /** Render the preview once the card comes within 200px of the viewport. */
  private _observe(): void {
    this._io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      this._io?.disconnect();
      this._io = undefined;
      void this._initMap();
    }, { rootMargin: '200px' });
    this._io.observe(this);
  }

  private async _initMap(): Promise<void> {
    const container = this.shadowRoot!.querySelector('.map-container') as HTMLElement;
    if (!container) return;

    let style;
    try {
      style = await resolveMapStyle();
    } catch (err) {
      console.error('Map style failed to load:', err);
      this._styleError = true;
      return;
    }
    // The element may have been removed, or another load may have won, while the style was loading.
    if (!this.isConnected || this._mapInstance || this._thumb) return;

    const map = new maplibregl.Map({
      container,
      style,
      center: [0, 20],
      zoom: 2,
      interactive: false,
      attributionControl: false,
      // The canvas is read back after the frame is presented.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    this._mapInstance = map;

    map.once('load', async () => {
      this._addMarkers();
      await map.once('idle');
      if (this._mapInstance !== map) return;
      // Safari encodes no WebP and would return a PNG; the map canvas is opaque, so JPEG loses nothing.
      this._thumb = map.getCanvas().toDataURL('image/jpeg', 0.85);
      map.remove();
      this._mapInstance = undefined;
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._io?.disconnect();
    this._io = undefined;
    this._mapInstance?.remove();
    this._mapInstance = undefined;
  }

  private _addMarkers() {
    if (!this._mapInstance || !this.map.stops?.length) return;

    const bounds = new maplibregl.LngLatBounds();
    const color = getComputedStyle(this).getPropertyValue('--wa-color-brand-50').trim() || '#ff6b00';

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
            'line-color': TRAVEL_MODES.find((m) => m.mode === (stop.travel_mode ?? 'drive'))?.hexColor ?? color,
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

    // Endpoints with icon 'none' get no pin but still count toward the bounds, as on the full map.
    const points: GeoJSON.Feature<GeoJSON.Point>[] = [];
    const pin = (lng: number, lat: number): GeoJSON.Feature<GeoJSON.Point> =>
      ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } });

    for (const stop of this.map.stops) {
      if (isDraftCoord(stop.latitude, stop.longitude)) continue;

      if (stop.icon !== 'none') points.push(pin(stop.longitude, stop.latitude));
      bounds.extend([stop.longitude, stop.latitude]);

      const dest = placedDest(stop);
      if (dest && stop.type === 'route') {
        if (stop.dest_icon !== 'none') points.push(pin(...dest));
        bounds.extend(dest);
      }
    }

    this._mapInstance.addSource('card-markers', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: points },
    });
    this._mapInstance.addLayer({
      id: 'card-markers',
      type: 'circle',
      source: 'card-markers',
      paint: {
        'circle-color': color,
        'circle-radius': 5,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    });

    if (!bounds.isEmpty()) {
      this._mapInstance.fitBounds(bounds, { padding: 30, maxZoom: 12, animate: false });
    }
  }

  render() {
    const itemCount = this.map.stops?.length ?? 0;
    const shared = this.map.role !== 'owner';

    return html`
      <wa-card>
        <div slot="media" class="wa-frame:landscape">
          ${this._thumb
            ? html`<img class="map-container" src=${this._thumb} alt="">`
            : html`<div class="map-container"></div>`}
          ${this._styleError ? html`<div class="map-error">Map preview unavailable</div>` : nothing}
        </div>
        <div class="wa-cluster wa-align-items-center wa-gap-xs">
          <h3><a class="card-link" href="/map/${this.map.id}">${this.map.name}</a></h3>
          ${shared ? roleBadge(this.map.role) : nothing}
        </div>
        ${this.map.family_name
          ? html`<div class="family">${this.map.family_name}</div>`
          : nothing}
        <div class="meta wa-split wa-align-items-center">
          <span>${itemCount} item${itemCount !== 1 ? 's' : ''} · Updated <wa-relative-time date=${this.map.updated_at} sync></wa-relative-time></span>
          ${!shared ? html`
            <wa-button id="delete-map" class="delete-btn" appearance="plain" size="s" @click=${this._onDelete}>
              <wa-icon name="trash" label="Delete map"></wa-icon>
            </wa-button>
            <wa-tooltip for="delete-map">Delete map</wa-tooltip>
          ` : nothing}
        </div>
      </wa-card>
    `;
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
