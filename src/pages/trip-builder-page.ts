/**
 * Trip builder page — sidebar with stop management + full-screen map.
 *
 * M4: Full CRUD — create trips, add/reorder/edit stops, auto-save to D1.
 * Map markers sync with stops; camera fits bounds automatically.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import maplibregl from 'maplibre-gl';
import type { GeocodingResult } from '../services/geocoding.js';
import type { MapData, Stop, MapWithStops } from '../services/maps.js';
import {
  createMap,
  getMap,
  updateMap,
  addStop,
  updateStop,
  deleteStop,
  reorderStops,
} from '../services/maps.js';
import '../components/map-view.js';
import '../components/location-search.js';
import '../components/stop-list.js';
import '../components/save-indicator.js';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

@customElement('trip-builder-page')
export class TripBuilderPage extends LitElement {
  @property() mapId = '';

  @state() private _map: MapData | null = null;
  @state() private _stops: Stop[] = [];
  @state() private _loading = true;
  @state() private _saveStatus: SaveStatus = 'idle';
  @state() private _error = '';
  @state() private _mapReady = false;

  private _saveTimer?: ReturnType<typeof setTimeout>;
  private _stopUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _pendingSync = false;

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

    .header-row {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
    }

    .header-row h1 {
      flex: 1;
      font-size: 1.5rem;
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-600, #e05e00);
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
    }

    .header-row h1 wa-icon {
      font-size: 1.3rem;
    }

    .name-inputs {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-xs);
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

    .loading {
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
        border-right: none;
        border-bottom: 1px solid var(--wa-color-neutral-200);
        max-height: 40vh;
      }

      .map-panel {
        min-height: 300px;
      }
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this._loadMap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._saveTimer);
    for (const t of this._stopUpdateTimers.values()) clearTimeout(t);
    this._stopUpdateTimers.clear();
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('mapId') && changed.get('mapId') !== undefined) {
      this._loadMap();
    }
  }

  private async _loadMap() {
    this._loading = true;
    this._error = '';

    try {
      if (!this.mapId) {
        // New trip — create on server, then update URL
        const newMap = await createMap({ name: 'Untitled Trip' });
        this._map = newMap;
        this._stops = [];
        this.mapId = newMap.id;
        window.history.replaceState(null, '', `/map/${newMap.id}`);
      } else {
        const data: MapWithStops = await getMap(this.mapId);
        this._map = data;
        this._stops = data.stops;
      }
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to load map';
    } finally {
      this._loading = false;
      // Markers will sync when map fires 'map-ready' (see _onMapReady)
      if (this._mapReady) {
        this.updateComplete.then(() => this._syncMarkers());
      } else {
        this._pendingSync = true;
      }
    }
  }

  render() {
    if (this._loading) {
      return html`
        <div class="sidebar">
          <div class="loading"><wa-spinner></wa-spinner></div>
        </div>
        <div class="map-panel"><map-view></map-view></div>
      `;
    }

    if (this._error) {
      return html`
        <div class="sidebar">
          <wa-callout variant="danger">
            <wa-icon slot="icon" name="circle-xmark"></wa-icon>
            ${this._error}
          </wa-callout>
        </div>
        <div class="map-panel"><map-view></map-view></div>
      `;
    }

    return html`
      <div class="sidebar">
        <div class="header-row">
          <h1>
            <wa-icon name="compass"></wa-icon>
            Trip Builder
          </h1>
          <save-indicator .status=${this._saveStatus} @status-idle=${this._onStatusIdle}></save-indicator>
        </div>

        <div class="name-inputs">
          <wa-input
            placeholder="Trip name"
            .value=${this._map?.name ?? ''}
            @input=${this._onNameInput}
          ></wa-input>
          <wa-input
            placeholder="Family name (optional)"
            .value=${this._map?.family_name ?? ''}
            @input=${this._onFamilyInput}
          ></wa-input>
        </div>

        <div class="search-section">
          <span class="search-label">Add a stop</span>
          <location-search
            @location-selected=${this._onLocationSelected}
          ></location-search>
        </div>

        <stop-list
          .stops=${this._stops}
          @stop-update=${this._onStopUpdate}
          @stop-delete=${this._onStopDelete}
          @stops-reorder=${this._onStopsReorder}
        ></stop-list>
      </div>

      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>
      </div>
    `;
  }

  private _onMapReady() {
    this._mapReady = true;
    if (this._pendingSync) {
      this._pendingSync = false;
      this._syncMarkers();
    }
  }

  private _onStatusIdle() {
    this._saveStatus = 'idle';
  }

  // ── Metadata auto-save (debounced) ──────────────────────────────────────

  private _onNameInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (this._map) this._map = { ...this._map, name: value };
    this._debounceSave();
  }

  private _onFamilyInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (this._map) this._map = { ...this._map, family_name: value || null };
    this._debounceSave();
  }

  private _debounceSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._saveMetadata(), 2500);
  }

  private async _saveMetadata() {
    if (!this._map) return;
    try {
      this._saveStatus = 'saving';
      await updateMap(this._map.id, {
        name: this._map.name,
        family_name: this._map.family_name,
      });
      this._saveStatus = 'saved';
    } catch {
      this._saveStatus = 'error';
    }
  }

  // ── Location search → add stop ──────────────────────────────────────────

  private async _onLocationSelected(e: CustomEvent<GeocodingResult>) {
    if (!this._map) return;
    const { longitude, latitude, name } = e.detail;

    try {
      const stop = await addStop(this._map.id, {
        name,
        lat: latitude,
        lng: longitude,
      });
      this._stops = [...this._stops, stop];
      this._syncMarkers();
    } catch {
      this._saveStatus = 'error';
    }
  }

  // ── Stop events ─────────────────────────────────────────────────────────

  private async _onStopUpdate(e: CustomEvent<{ stopId: string; field: string; value: string }>) {
    if (!this._map) return;
    const { stopId, field, value } = e.detail;

    // Update local state immediately (optimistic)
    this._stops = this._stops.map((s) =>
      s.id === stopId ? { ...s, [field]: value } : s,
    );

    // Icon and travel_mode save immediately; text fields debounce
    if (field === 'icon' || field === 'travel_mode') {
      this._flushStopUpdate(this._map.id, stopId, { [field]: value });
    } else {
      const mapId = this._map.id;
      const timerKey = `${stopId}:${field}`;
      clearTimeout(this._stopUpdateTimers.get(timerKey));
      this._stopUpdateTimers.set(
        timerKey,
        setTimeout(() => {
          this._stopUpdateTimers.delete(timerKey);
          this._flushStopUpdate(mapId, stopId, { [field]: value });
        }, 1500),
      );
    }
  }

  private async _flushStopUpdate(mapId: string, stopId: string, fields: Record<string, unknown>) {
    try {
      this._saveStatus = 'saving';
      await updateStop(mapId, stopId, fields);
      this._saveStatus = 'saved';
    } catch {
      this._saveStatus = 'error';
    }
  }

  private async _onStopDelete(e: CustomEvent<{ stopId: string }>) {
    if (!this._map) return;
    const { stopId } = e.detail;

    // Optimistic remove
    this._stops = this._stops.filter((s) => s.id !== stopId);
    this._syncMarkers();

    try {
      await deleteStop(this._map.id, stopId);
      // Reload to get re-compacted positions
      const data = await getMap(this._map.id);
      this._stops = data.stops;
      this._syncMarkers();
    } catch {
      this._saveStatus = 'error';
    }
  }

  private async _onStopsReorder(e: CustomEvent<{ order: string[] }>) {
    if (!this._map) return;
    const { order } = e.detail;

    // Optimistic reorder
    const stopMap = new Map(this._stops.map((s) => [s.id, s]));
    this._stops = order
      .map((id) => stopMap.get(id)!)
      .filter(Boolean)
      .map((s, i) => ({ ...s, position: i, travel_mode: i === 0 ? null : s.travel_mode }));

    try {
      await reorderStops(this._map.id, order);
      // Reload for server-authoritative positions
      const data = await getMap(this._map.id);
      this._stops = data.stops;
      this._syncMarkers();
    } catch {
      this._saveStatus = 'error';
    }
  }

  // ── Map markers sync ────────────────────────────────────────────────────

  private _syncMarkers() {
    if (!this._mapReady) return;
    const mapView = this.shadowRoot?.querySelector('map-view');
    if (!mapView) return;

    mapView.clearMarkers();

    for (const stop of this._stops) {
      mapView.addMarker(stop.longitude, stop.latitude, stop.name);
    }

    if (this._stops.length >= 2) {
      const bounds = new maplibregl.LngLatBounds();
      for (const stop of this._stops) {
        bounds.extend([stop.longitude, stop.latitude]);
      }
      mapView.map?.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    } else if (this._stops.length === 1) {
      mapView.flyTo(this._stops[0].longitude, this._stops[0].latitude);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'trip-builder-page': TripBuilderPage;
  }
}
