/**
 * Trip builder page — sidebar with stop management + full-screen map.
 *
 * M5: Route drawing — colored, mode-specific route segments connect stops.
 * Numbered markers with Jelly icons. Total distance with km/miles toggle.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
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
import { MapController } from '../map/map-controller.js';
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
  @state() private _totalDistance = 0; // meters
  @state() private _routeLoading = false;

  private _saveTimer?: ReturnType<typeof setTimeout>;
  private _stopUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _pendingSync = false;
  private _mapController?: MapController;
  private _routeDebounceTimer?: ReturnType<typeof setTimeout>;

  static styles = [waUtilities, css`
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
      background: var(--wa-color-surface-default);
    }

    h1 {
      flex: 1;
      font-size: var(--wa-font-size-xl);
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-60, #e05e00);
    }

    h1 wa-icon {
      font-size: 1.3rem;
    }


    wa-details::part(base) {
      border-radius: var(--wa-border-radius-m);
    }

    wa-details::part(content) {
      padding-top: var(--wa-space-s);
    }

    .section-summary {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      font-weight: 700;
      font-size: 0.9rem;
    }

    .section-summary wa-icon {
      font-size: 1rem;
      color: var(--wa-color-brand-60, #e05e00);
    }

    .section-summary wa-badge {
      margin-left: auto;
    }

    .stat-row {
      font-size: 0.9rem;
    }

    .stat-row wa-icon {
      color: var(--wa-color-brand-60, #e05e00);
      font-size: 1rem;
    }

    .stat-value {
      font-weight: 700;
      color: var(--wa-color-neutral-900);
    }

    .stat-label {
      color: var(--wa-color-neutral-500);
    }

    .route-loading {
      font-size: 0.85rem;
      color: var(--wa-color-neutral-500);
    }

    .setting-row label {
      display: block;
      font-weight: 600;
      font-size: 0.85rem;
      color: var(--wa-color-neutral-700);
      margin-bottom: var(--wa-space-2xs);
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
  `];

  connectedCallback(): void {
    super.connectedCallback();
    this._loadMap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._saveTimer);
    clearTimeout(this._routeDebounceTimer);
    for (const t of this._stopUpdateTimers.values()) clearTimeout(t);
    this._stopUpdateTimers.clear();
    this._mapController?.destroy();
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('mapId') && changed.get('mapId') !== undefined) {
      this._loadMap();
    }
  }

  private async _loadMap() {
    // Task #5: Destroy the old controller before loading a new map to prevent
    // leaking layers, markers, and abort controllers.
    this._mapController?.destroy();
    this._mapController = undefined;
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
      if (this._mapReady) {
        // Task #8: Guard against _syncMap running after the component is removed.
        this.updateComplete.then(() => { if (this.isConnected) this._syncMap(); });
      } else {
        this._pendingSync = true;
      }
    }
  }

  render() {
    if (this._loading) {
      return html`
        <div class="sidebar">
          <div class="wa-cluster wa-align-items-center wa-justify-content-center" style="padding: var(--wa-space-2xl)"><wa-spinner></wa-spinner></div>
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

    const units = this._map?.units ?? 'km';

    return html`
      <div class="sidebar wa-stack wa-gap-m">
        <div class="wa-flank wa-gap-xs">
          <h1>
            <wa-icon name="compass"></wa-icon>
            Trip Builder
          </h1>
          <save-indicator .status=${this._saveStatus} @status-idle=${this._onStatusIdle}></save-indicator>
        </div>

        <div class="wa-stack wa-gap-xs">
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

        <div class="wa-stack wa-gap-xs">
          <wa-details open>
            <span slot="summary" class="section-summary">
              <wa-icon name="location-dot"></wa-icon>
              Points
              ${this._stops.length > 0
                ? html`<wa-badge variant="brand">${this._stops.length}</wa-badge>`
                : ''}
            </span>
            <div class="wa-stack wa-gap-s">
              <location-search
                @location-selected=${this._onLocationSelected}
              ></location-search>
              <stop-list
                .stops=${this._stops}
                @stop-update=${this._onStopUpdate}
                @stop-delete=${this._onStopDelete}
                @stops-reorder=${this._onStopsReorder}
              ></stop-list>
            </div>
          </wa-details>

          <wa-details open>
            <span slot="summary" class="section-summary">
              <wa-icon name="route"></wa-icon>
              Routes
              ${this._totalDistance > 0
                ? html`<wa-badge variant="brand">${this._formatDistance(this._totalDistance, units)}</wa-badge>`
                : ''}
            </span>
            ${this._renderRouteStats(units)}
          </wa-details>

          <wa-details>
            <span slot="summary" class="section-summary">
              <wa-icon name="gear"></wa-icon>
              Settings
            </span>
            <div class="wa-stack wa-gap-m">
              <div class="setting-row">
                <label>Units</label>
                <wa-radio-group
                  .value=${units}
                  @wa-change=${this._onUnitsChange}
                >
                  <wa-radio appearance="button" value="km">Kilometers</wa-radio>
                  <wa-radio appearance="button" value="miles">Miles</wa-radio>
                </wa-radio-group>
              </div>
              <div class="setting-row">
                <label>Map theme</label>
                <wa-callout>
                  <wa-icon slot="icon" name="circle-info"></wa-icon>
                  Custom map themes coming soon.
                </wa-callout>
              </div>
            </div>
          </wa-details>
        </div>
      </div>

      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>
      </div>
    `;
  }

  private _renderRouteStats(units: string) {
    if (this._stops.length < 2) {
      return html`
        <wa-callout>
          <wa-icon slot="icon" name="circle-info"></wa-icon>
          Add at least 2 stops to see route information.
        </wa-callout>
      `;
    }

    if (this._routeLoading) {
      return html`
        <div class="route-loading wa-cluster wa-gap-xs wa-align-items-center">
          <wa-spinner></wa-spinner>
          Calculating routes...
        </div>
      `;
    }

    const segments = this._mapController?.segments ?? [];
    if (segments.length === 0) {
      return html`
        <wa-callout>
          <wa-icon slot="icon" name="circle-info"></wa-icon>
          No routes calculated yet.
        </wa-callout>
      `;
    }

    return html`
      <div class="wa-stack wa-gap-s">
        <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
          <wa-icon name="ruler"></wa-icon>
          <span class="stat-label">Total distance:</span>
          <span class="stat-value">${this._formatDistance(this._totalDistance, units)}</span>
        </div>
        <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
          <wa-icon name="location-dot"></wa-icon>
          <span class="stat-label">Stops:</span>
          <span class="stat-value">${this._stops.length}</span>
        </div>
        <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
          <wa-icon name="route"></wa-icon>
          <span class="stat-label">Segments:</span>
          <span class="stat-value">${segments.length}</span>
        </div>
      </div>
    `;
  }

  private _formatDistance(meters: number, units: string): string {
    if (units === 'miles') {
      const miles = meters / 1609.344;
      return miles < 1 ? `${miles.toFixed(1)} mi` : `${Math.round(miles).toLocaleString()} mi`;
    }
    const km = meters / 1000;
    return km < 1 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
  }

  private _onMapReady() {
    this._mapReady = true;

    // Initialize map controller with the MapLibre instance
    const mapView = this.shadowRoot?.querySelector('map-view');
    if (mapView?.map) {
      this._mapController = new MapController(mapView.map);
    }

    if (this._pendingSync) {
      this._pendingSync = false;
      this._syncMap();
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

  private _onUnitsChange(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    if (this._map) this._map = { ...this._map, units: value };
    this._debounceSave();
    // Distance display updates reactively (re-render)
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
        units: this._map.units,
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
      this._syncMap();
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
      // Travel mode changes affect route drawing
      if (field === 'travel_mode') {
        this._debounceSyncMap();
      }
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
    this._syncMap();

    try {
      await deleteStop(this._map.id, stopId);
      // Reload to get re-compacted positions
      const data = await getMap(this._map.id);
      this._stops = data.stops;
      this._syncMap();
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

    // Immediately redraw with optimistic order
    this._syncMap();

    try {
      await reorderStops(this._map.id, order);
      // Reload for server-authoritative positions
      const data = await getMap(this._map.id);
      this._stops = data.stops;
      this._syncMap();
    } catch {
      this._saveStatus = 'error';
    }
  }

  // ── Map sync (routes + markers) ────────────────────────────────────────

  /**
   * Debounce map sync to avoid excessive route fetches during rapid changes
   * (e.g., travel mode clicks in quick succession).
   */
  private _debounceSyncMap() {
    clearTimeout(this._routeDebounceTimer);
    this._routeDebounceTimer = setTimeout(() => this._syncMap(), 300);
  }

  /**
   * Draw route segments and stop markers on the map.
   * Replaces the old _syncMarkers() — now uses MapController.
   */
  private async _syncMap() {
    if (!this._mapReady || !this._mapController) return;

    this._routeLoading = true;
    try {
      // Task #7: Reset stale distance before fetching new routes so a failed
      // fetch leaves the display at 0 rather than showing an outdated value.
      this._totalDistance = 0;
      const segments = await this._mapController.drawRoutes(this._stops);
      this._totalDistance = segments.reduce((sum, s) => sum + s.distance, 0);
    } catch (err) {
      console.warn('Route drawing failed:', err);
    } finally {
      this._routeLoading = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'trip-builder-page': TripBuilderPage;
  }
}
