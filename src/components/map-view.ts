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
import { MAP_STYLE_URL } from '../config/map.js';

@customElement('map-view')
export class MapView extends LitElement {
  private _map?: maplibregl.Map;
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
      style: MAP_STYLE_URL,
      center: [0, 20],
      zoom: 2,
      attributionControl: false,
    });

    this._map.addControl(new maplibregl.AttributionControl({ compact: true }));

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
