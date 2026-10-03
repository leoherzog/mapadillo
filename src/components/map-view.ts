/**
 * Map view — Lit wrapper around MapLibre GL JS.
 *
 * Uses OpenFreeMap Bright style with kid-drawn transform (free OSM vector tiles, no API key).
 * Renders inside shadow DOM with MapLibre's CSS adopted into the shadow root.
 * Fires 'map-ready' once the map loads, or 'map-error' if the style or WebGL fails.
 */
import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import * as maplibregl from 'maplibre-gl';
import '../map/maplibre-worker.js';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import { resolveMapStyle } from '../config/map.js';

@customElement('map-view')
export class MapView extends LitElement {
  private _map?: maplibregl.Map;

  @state() private _styleError = false;

  static styles = [
    unsafeCSS(maplibreCss),
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 200px;
        overflow: hidden;
        position: relative;
      }

      .map-container {
        width: 100%;
        height: 100%;
      }

      wa-callout {
        position: absolute;
        inset: var(--wa-space-m) var(--wa-space-m) auto;
      }
    `,
  ];

  protected firstUpdated(): void {
    void this._initMap();
  }

  private async _initMap(): Promise<void> {
    const container = this.shadowRoot!.querySelector(
      '.map-container',
    ) as HTMLElement;

    let style;
    try {
      style = await resolveMapStyle();
    } catch (err) {
      this._fail('Map style failed to load:', err);
      return;
    }
    // The element may have been removed while the style was loading.
    if (!this.isConnected) return;

    try {
      this._map = new maplibregl.Map({
        container,
        style,
        center: [0, 20],
        zoom: 2,
        attributionControl: { compact: true },
      });
    } catch (err) {
      this._fail('Map failed to initialize:', err);
      return;
    }

    this._map.addControl(new maplibregl.NavigationControl(), 'top-right');

    this._map.on('load', () => {
      this.dispatchEvent(new CustomEvent('map-ready', { bubbles: true, composed: true }));
    });
  }

  /** Show the error callout and fire 'map-error'; the map stays undefined. */
  private _fail(message: string, err: unknown): void {
    console.error(message, err);
    this._styleError = true;
    this.dispatchEvent(new CustomEvent('map-error', { bubbles: true, composed: true }));
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._map?.remove();
    this._map = undefined;
  }

  /** The underlying MapLibre map, created once the style resolves; wait for 'map-ready' before drawing. */
  get map(): maplibregl.Map | undefined {
    return this._map;
  }

  render() {
    return html`
      <div class="map-container"></div>
      ${this._styleError
        ? html`<wa-callout variant="danger">The map could not be loaded.</wa-callout>`
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-view': MapView;
  }
}
