/**
 * Map view — Lit wrapper around MapLibre GL JS.
 *
 * Uses OpenFreeMap Bright style (free OSM vector tiles, no API key).
 * Renders inside shadow DOM with MapLibre's CSS adopted into the shadow root.
 */
import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement } from 'lit/decorators.js';
import maplibregl from 'maplibre-gl';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline';

@customElement('map-view')
export class MapView extends LitElement {
  private _map?: maplibregl.Map;
  private _markers: maplibregl.Marker[] = [];
  private _resizeObserver?: ResizeObserver;

  static styles = [
    unsafeCSS(maplibreCss),
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 200px;
        overflow: hidden;
      }

      .map-container {
        width: 100%;
        height: 100%;
      }
    `,
  ];

  protected firstUpdated(): void {
    const container = this.shadowRoot!.querySelector(
      '.map-container',
    ) as HTMLElement;

    this._map = new maplibregl.Map({
      container,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [0, 20],
      zoom: 2,
    });

    this._map.addControl(new maplibregl.NavigationControl(), 'top-right');

    this._map.on('load', () => {
      this.dispatchEvent(new CustomEvent('map-ready', { bubbles: true, composed: true }));
    });

    // Resize map when container dimensions change
    this._resizeObserver = new ResizeObserver(() => this._map?.resize());
    this._resizeObserver.observe(container);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._map?.remove();
    this._map = undefined;
  }

  /** Fly the camera to a position. */
  flyTo(lng: number, lat: number, zoom = 12): void {
    this._map?.flyTo({ center: [lng, lat], zoom });
  }

  /** Drop a marker. Returns the Marker instance, or undefined if the map is not ready. */
  addMarker(lng: number, lat: number, label?: string): maplibregl.Marker | undefined {
    if (!this._map) return undefined;

    const marker = new maplibregl.Marker({ color: '#ff6b00' }).setLngLat([
      lng,
      lat,
    ]);

    if (label) {
      marker.setPopup(
        new maplibregl.Popup({ offset: 25, closeButton: false }).setText(label),
      );
    }

    marker.addTo(this._map);
    this._markers.push(marker);

    if (label) marker.togglePopup();

    return marker;
  }

  /** Remove all markers from the map. */
  clearMarkers(): void {
    for (const m of this._markers) m.remove();
    this._markers = [];
  }

  /** Access the underlying MapLibre map (for advanced use in later milestones). */
  get map(): maplibregl.Map | undefined {
    return this._map;
  }

  render() {
    return html`<div class="map-container"></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-view': MapView;
  }
}
