/**
 * Trip builder page — sidebar with item management + full-screen map.
 *
 * M7: Unified map items — points (standalone markers) and routes (A→B pairs).
 */
import { html, css, nothing, type PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { pageLayoutStyles } from '../styles/page-layout.js';
import {
  createMap,
  updateMap,
  addStop,
  updateStop,
  deleteStop,
  reorderStops,
  duplicateMap,
  type MapWithRole,
} from '../services/maps.js';
import { isAuthenticated } from '../auth/auth-state.js';
import { navigateTo } from '../nav.js';
import { formatDistance } from '../utils/geo.js';
import { MapPageBase } from './map-page-base.js';
import '../components/map-view.js';
import '../components/item-list.js';
import '../components/save-indicator.js';
import '../components/share-dialog.js';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Maps API field names to model field names for optimistic updates. */
const API_TO_MODEL: Record<string, string> = {
  lat: 'latitude', lng: 'longitude',
  dest_lat: 'dest_latitude', dest_lng: 'dest_longitude',
};

@customElement('trip-builder-page')
export class TripBuilderPage extends MapPageBase {
  @state() private _saveStatus: SaveStatus = 'idle';
  @state() private _routeLoading = false;
  @state() private _role: 'owner' | 'editor' | 'viewer' | 'public' = 'owner';
  @state() private _duplicating = false;

  private _saveTimer?: ReturnType<typeof setTimeout>;
  private _pendingSaves = 0;
  private _itemUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _creatingMap = false;
  private _routeDebounceTimer?: ReturnType<typeof setTimeout>;

  static styles = [waUtilities, pageLayoutStyles, css`
    h1 {
      flex: 1;
    }

    /* Desktop: pin header/footer, scroll items */
    @media (min-width: 701px) {
      .sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
        overflow-y: hidden;
      }

      .sidebar-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
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
  `];

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._saveTimer);
    clearTimeout(this._routeDebounceTimer);
    for (const t of this._itemUpdateTimers.values()) clearTimeout(t);
    this._itemUpdateTimers.clear();
  }

  willUpdate(changed: PropertyValues): void {
    if (changed.has('mapId') && changed.get('mapId') !== undefined && !this._creatingMap) {
      this._loadMap();
    }
  }

  protected async _loadMap() {
    if (!this.mapId) {
      // New trip — create on server, then update URL.
      // Set flag to prevent willUpdate from triggering a redundant _loadMap
      // when mapId is assigned below.
      this._mapController?.destroy();
      this._mapController = undefined;
      this._loading = true;
      this._error = '';
      this._creatingMap = true;
      try {
        const newMap = await createMap({ name: 'Untitled Trip' });
        this._map = newMap;
        this._items = [];
        this._role = 'owner';
        this.mapId = newMap.id;
        if ('navigation' in window) {
          (window as unknown as { navigation: { navigate: (url: string, opts?: { history?: string }) => void } }).navigation.navigate(`/map/${newMap.id}`, { history: 'replace' });
        } else {
          window.history.replaceState(null, '', `/map/${newMap.id}`);
        }
      } catch (err) {
        this._error = err instanceof Error ? err.message : 'Failed to create map';
      } finally {
        this._creatingMap = false;
        this._loading = false;
        if (this._mapReady) {
          this.updateComplete.then(() => { if (this.isConnected) this._syncMap(); });
        } else {
          this._pendingSync = true;
        }
      }
      return;
    }

    // Existing map — delegate to base class
    await super._loadMap();
    // Extract role from the loaded data (getMap returns MapWithRole)
    if (this._map) {
      this._role = (this._map as MapWithRole).role ?? 'owner';
    }
  }

  render() {
    if (this._loading) {
      return html`
        <div class="sidebar sidebar-left">
          <div class="wa-cluster wa-align-items-center wa-justify-content-center" style="padding: var(--wa-space-2xl)"><wa-spinner></wa-spinner></div>
        </div>
        <div class="map-panel"><map-view></map-view></div>
      `;
    }

    if (this._error) {
      return html`
        <div class="sidebar sidebar-left">
          <wa-callout variant="danger">
            <wa-icon slot="icon" name="circle-xmark"></wa-icon>
            ${this._error}
          </wa-callout>
        </div>
        <div class="map-panel"><map-view></map-view></div>
      `;
    }

    const units = this._map?.units ?? 'km';
    const canEdit = this._role === 'owner' || this._role === 'editor';
    const isOwner = this._role === 'owner';
    const isReadOnly = !canEdit;

    return html`
      <div class="sidebar sidebar-left">
        <!-- Fixed top: header + inputs -->
        <div class="wa-split wa-gap-xs">
          <h1>
            <wa-icon name="compass"></wa-icon>
            Trip Builder
          </h1>
          <div class="wa-cluster wa-gap-xs wa-align-items-center">
            ${!isOwner ? html`<wa-badge variant=${this._role === 'editor' ? 'brand' : 'neutral'}>${this._role}</wa-badge>` : nothing}
            ${isOwner ? html`
              <wa-button
                appearance="outlined"
                size="small"
                variant="neutral"
                @click=${this._onShareClick}
              >
                <wa-icon slot="start" name="share-nodes"></wa-icon>
                Share
              </wa-button>
            ` : ''}
            ${canEdit ? html`<save-indicator .status=${this._saveStatus} @status-idle=${this._onStatusIdle}></save-indicator>` : ''}
          </div>
        </div>

        ${isReadOnly ? html`
          <wa-callout variant="neutral">
            <wa-icon slot="icon" name="eye"></wa-icon>
            You are viewing this trip as ${this._role === 'public' ? 'a public visitor' : 'a viewer'}.
            ${isAuthenticated() ? html`
              <wa-button
                size="small"
                variant="brand"
                ?loading=${this._duplicating}
                @click=${this._onDuplicate}
                style="margin-top: var(--wa-space-xs);"
              >
                <wa-icon slot="start" name="clone" library="fa-jelly"></wa-icon>
                Duplicate this trip
              </wa-button>
            ` : html`
              <wa-button
                size="small"
                variant="brand"
                href="/sign-in?returnTo=${encodeURIComponent(`/map/${this.mapId}`)}"
                style="margin-top: var(--wa-space-xs);"
              >
                <wa-icon slot="start" name="arrow-right-to-bracket" library="fa-jelly"></wa-icon>
                Sign in to duplicate this trip
              </wa-button>
            `}
          </wa-callout>
        ` : nothing}

        <div class="wa-stack wa-gap-xs">
          ${canEdit ? html`
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
          ` : html`
            <h2 style="margin: 0; font-size: var(--wa-font-size-l); font-weight: 700;">${this._map?.name ?? 'Untitled Trip'}</h2>
            ${this._map?.family_name ? html`<p style="margin: 0; color: var(--wa-color-neutral-500);">${this._map.family_name}</p>` : ''}
          `}
        </div>

        <!-- Scrollable: map items -->
        <div class="sidebar-scroll">
          <wa-details open>
            <span slot="summary" class="section-summary">
              <wa-icon name="map"></wa-icon>
              Map Items
              ${this._items.length > 0
                ? html`<wa-badge variant="brand">${this._items.length}</wa-badge>`
                : nothing}
            </span>
            <div class="wa-stack wa-gap-s">
              <item-list
                .items=${this._items}
                .readonly=${isReadOnly}
                .distances=${this._routeDistances}
                .units=${this._map?.units ?? 'km'}
                @item-update=${this._onItemUpdate}
                @item-update-batch=${this._onItemUpdateBatch}
                @item-delete=${this._onItemDelete}
                @items-reorder=${this._onItemsReorder}
              ></item-list>

              ${canEdit ? html`
                <div class="wa-cluster wa-gap-xs wa-justify-content-center">
                  <wa-dropdown>
                    <wa-button slot="trigger" variant="brand" size="small" with-caret>
                      <wa-icon slot="start" name="plus"></wa-icon>
                      Add
                    </wa-button>
                    <wa-dropdown-item @click=${this._onAddPoint}>
                      <wa-icon slot="icon" name="location-dot"></wa-icon>
                      Point
                    </wa-dropdown-item>
                    <wa-dropdown-item @click=${this._onAddRoute}>
                      <wa-icon slot="icon" name="compass"></wa-icon>
                      Route
                    </wa-dropdown-item>
                  </wa-dropdown>
                </div>
              ` : nothing}

              ${this._totalDistance ? html`
                <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
                  <span class="stat-label">Total distance:</span>
                  <span class="stat-value">${formatDistance(this._totalDistance, units)}</span>
                </div>
              ` : ''}

              ${this._routeLoading ? html`
                <div class="route-loading wa-cluster wa-gap-xs wa-align-items-center">
                  <wa-spinner></wa-spinner>
                  Calculating routes...
                </div>
              ` : ''}
            </div>
          </wa-details>
        </div>

        <!-- Fixed bottom: actions + settings -->
        <div class="wa-stack wa-gap-xs">
          ${this._map?.id ? html`
            <div class="wa-cluster wa-gap-xs wa-justify-content-center">
              <wa-button
                variant="brand"
                appearance="outlined"
                size="small"
                @click=${() => navigateTo(`/preview/${this._map!.id}`)}
              >
                <wa-icon slot="start" name="eye"></wa-icon>
                Preview
              </wa-button>
              <wa-button
                variant="brand"
                size="small"
                @click=${() => navigateTo(`/export/${this._map!.id}`)}
              >
                <wa-icon slot="start" name="print"></wa-icon>
                Print
              </wa-button>
            </div>
          ` : ''}

          ${canEdit ? html`
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
                    @change=${this._onUnitsChange}
                  >
                    <wa-radio appearance="button" value="km">Kilometers</wa-radio>
                    <wa-radio appearance="button" value="mi">Miles</wa-radio>
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
          ` : ''}
        </div>
      </div>

      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>
      </div>

      ${isOwner ? html`
        <share-dialog
          .mapId=${this._map?.id ?? ''}
          .visibility=${(this._map?.visibility ?? 'private') as 'public' | 'private'}
          @visibility-changed=${this._onVisibilityChanged}
        ></share-dialog>
      ` : ''}
    `;
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

  // ── Add item flows ─────────────────────────────────────────────────────

  private async _onAddPoint() {
    if (!this._map) return;
    try {
      const item = await addStop(this._map.id, {
        type: 'point',
        name: 'New Point',
        lat: 0,
        lng: 0,
      });
      this._items = [...this._items, item];
    } catch {
      this._saveStatus = 'error';
    }
  }

  private async _onAddRoute() {
    if (!this._map) return;
    try {
      const item = await addStop(this._map.id, {
        type: 'route',
        name: 'New Route',
        lat: 0,
        lng: 0,
        travel_mode: 'drive',
      });
      this._items = [...this._items, item];
    } catch {
      this._saveStatus = 'error';
    }
  }

  // ── Item events ───────────────────────────────────────────────────────

  private async _onItemUpdate(e: CustomEvent<{ itemId: string; field: string; value: unknown }>) {
    if (!this._map) return;
    const { itemId, field, value } = e.detail;

    // Update local state immediately (optimistic)
    // Clear cached route_geometry when travel_mode changes (server invalidates it too)
    const extra = field === 'travel_mode' ? { route_geometry: null } : {};
    this._items = this._items.map((s) =>
      s.id === itemId ? { ...s, [field]: value, ...extra } : s,
    );

    // Icon and travel_mode save immediately; text fields debounce
    if (field === 'icon' || field === 'travel_mode') {
      this._flushItemUpdate(this._map.id, itemId, { [field]: value });
      this._debounceSyncMap();
    } else {
      const mapId = this._map.id;
      const timerKey = `${itemId}:${field}`;
      clearTimeout(this._itemUpdateTimers.get(timerKey));
      this._itemUpdateTimers.set(
        timerKey,
        setTimeout(() => {
          this._itemUpdateTimers.delete(timerKey);
          this._flushItemUpdate(mapId, itemId, { [field]: value });
        }, 1500),
      );
    }
  }

  /** Handle batch field updates (e.g., coordinate changes from route-card). */
  private async _onItemUpdateBatch(e: CustomEvent<{ itemId: string; fields: Record<string, unknown> }>) {
    if (!this._map) return;
    const { itemId, fields } = e.detail;

    const modelFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      modelFields[API_TO_MODEL[k] ?? k] = v;
    }

    // Optimistic update
    this._items = this._items.map((s) =>
      s.id === itemId ? { ...s, ...modelFields } : s,
    );

    // Save immediately and sync map (coordinates changed)
    this._flushItemUpdate(this._map.id, itemId, fields);
    this._debounceSyncMap();
  }

  private async _flushItemUpdate(mapId: string, itemId: string, fields: Record<string, unknown>) {
    this._pendingSaves++;
    this._saveStatus = 'saving';
    try {
      await updateStop(mapId, itemId, fields);
      if (--this._pendingSaves === 0) this._saveStatus = 'saved';
    } catch {
      this._pendingSaves--;
      this._saveStatus = 'error';
    }
  }

  private async _onItemDelete(e: CustomEvent<{ itemId: string }>) {
    if (!this._map) return;
    const { itemId } = e.detail;

    // Optimistic remove — positions may have gaps but ordering is preserved
    this._items = this._items.filter((s) => s.id !== itemId);
    this._debounceSyncMap();

    try {
      await deleteStop(this._map.id, itemId);
    } catch {
      this._saveStatus = 'error';
    }
  }

  private async _onItemsReorder(e: CustomEvent<{ order: string[] }>) {
    if (!this._map) return;
    const { order } = e.detail;

    // Optimistic reorder
    const itemMap = new Map(this._items.map((s) => [s.id, s]));
    this._items = order
      .map((id) => itemMap.get(id)!)
      .filter(Boolean)
      .map((s, i) => ({ ...s, position: i }));

    this._debounceSyncMap();

    try {
      await reorderStops(this._map.id, order);
    } catch {
      this._saveStatus = 'error';
    }
  }

  // ── Sharing ────────────────────────────────────────────────────────────

  private _onShareClick() {
    const dialog = this.shadowRoot?.querySelector('share-dialog') as HTMLElement & { show(): void } | null;
    dialog?.show();
  }

  private _onVisibilityChanged(e: CustomEvent<{ visibility: string }>) {
    if (this._map) {
      this._map = { ...this._map, visibility: e.detail.visibility };
    }
  }

  private async _onDuplicate() {
    if (!this._map) return;
    this._duplicating = true;
    try {
      const newMap = await duplicateMap(this._map.id);
      navigateTo(`/map/${newMap.id}`);
    } catch {
      this._saveStatus = 'error';
    } finally {
      this._duplicating = false;
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
   * Draw points and routes on the map, with loading indicator.
   */
  protected async _syncMap() {
    if (!this._mapReady || !this._mapController) return;

    this._routeLoading = true;
    try {
      this._routeDistances = new Map();
      const result = await this._mapController.drawItems(this._items);
      this._routeDistances = result.distances;

      // Fire-and-forget: cache route geometry to D1 for dashboard map cards
      if (this._map && result.geometries.size > 0) {
        let updated = false;
        const next = this._items.map(s => {
          if (s.route_geometry) return s;
          const geometry = result.geometries.get(s.id);
          if (!geometry) return s;
          const encoded = JSON.stringify(geometry);
          updated = true;
          updateStop(this._map!.id, s.id, { route_geometry: encoded }).catch(() => {});
          return { ...s, route_geometry: encoded };
        });
        if (updated) this._items = next;
      }
    } catch (err) {
      console.warn('Map drawing failed:', err);
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
