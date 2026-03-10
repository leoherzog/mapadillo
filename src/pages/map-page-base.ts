/**
 * Shared base class for pages that display a read-only map with stops.
 *
 * Extracts the common map-loading, MapController lifecycle, and sync logic
 * used by map-preview-page (and any future read-only map pages).
 */
import { LitElement, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { MapData, Stop } from '../services/maps.js';
import { getMap } from '../services/maps.js';
import { ApiError } from '../services/api-client.js';
import { isAuthenticated } from '../auth/auth-state.js';
import { MapController } from '../map/map-controller.js';
import { navigateTo } from '../nav.js';
import type { MapView } from '../components/map-view.js';
import { MAP_CONTROLLER_OPTIONS, type MapControllerOptions } from '../config/map-themes.js';

export class MapPageBase extends LitElement {
  @property() mapId = '';

  private _loadGeneration = 0;

  @state() protected _map: MapData | null = null;
  @state() protected _items: Stop[] = [];
  @state() protected _loading = true;
  @state() protected _error = '';
  @state() protected _mapReady = false;
  @state() protected _routeDistances = new Map<string, number>();

  protected get _totalDistance(): number {
    let sum = 0;
    for (const d of this._routeDistances.values()) sum += d;
    return sum;
  }

  protected _pendingSync = false;
  protected _mapController?: MapController;

  connectedCallback(): void {
    super.connectedCallback();
    this._loadMap();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has('mapId') && changed.get('mapId') !== undefined) {
      this._loadMap();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mapController?.destroy();
  }

  protected async _loadMap() {
    if (!this.mapId) return;
    this._mapController?.destroy();
    this._mapController = undefined;
    this._mapReady = false;
    this._loading = true;
    this._error = '';

    const gen = ++this._loadGeneration;

    try {
      const data = await getMap(this.mapId);
      if (gen !== this._loadGeneration) return; // stale — discard
      this._map = data;
      this._items = data.stops;
    } catch (err) {
      if (gen !== this._loadGeneration) return;
      if (err instanceof ApiError && err.status === 401 && !isAuthenticated()) {
        const returnTo = encodeURIComponent(window.location.pathname);
        navigateTo(`/sign-in?returnTo=${returnTo}`);
        return;
      }
      this._error = err instanceof Error ? err.message : 'Failed to load map';
    } finally {
      if (gen !== this._loadGeneration) return;
      this._loading = false;
      if (this._mapReady) {
        this.updateComplete.then(() => { if (this.isConnected) this._syncMap(); });
      } else {
        this._pendingSync = true;
      }
    }
  }

  protected _onMapReady() {
    this._mapReady = true;

    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map) return;

    // Destroy previous controller before creating a new one
    this._mapController?.destroy();
    this._mapController = new MapController(mapView.map, {
      ...MAP_CONTROLLER_OPTIONS,
      ...this._getExtraControllerOptions(),
    });

    this._pendingSync = false;
    this._syncMap();
  }

  /** Override in subclasses to provide additional MapController options (e.g., onItemClick). */
  protected _getExtraControllerOptions(): Partial<MapControllerOptions> {
    return {};
  }

  protected async _syncMap() {
    if (!this._mapReady || !this._mapController) return;

    try {
      const result = await this._mapController.drawItems(this._items);
      this._routeDistances = result.distances;
    } catch (err) {
      console.warn('Map drawing failed:', err);
    }
  }
}
