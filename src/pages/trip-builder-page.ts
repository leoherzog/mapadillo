/**
 * Trip builder page — sidebar with item management + full-screen map.
 *
 * M7: Unified map items — points (standalone markers) and routes (A→B pairs).
 */
import { html, css, nothing, type PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { pageLayoutStyles } from '../styles/page-layout.js';
import { headingStyles } from '../styles/heading-shared.js';
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
import { formatDistance, isDraftCoord } from '../utils/geo.js';
import { MapPageBase } from './map-page-base.js';
import type { MapControllerOptions } from '../config/map-themes.js';
import { getUnits, type Units } from '../units.js';
import '../components/map-view.js';
import '../components/item-list.js';
import type { ItemList } from '../components/item-list.js';
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
  @state() private _isMobile = false;
  @state() private _drawerOpen = false;
  @state() private _units: Units = getUnits();

  private _saveTimer?: ReturnType<typeof setTimeout>;
  private _pendingSaves = 0;
  private _itemUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _creatingMap = false;
  private _routeDebounceTimer?: ReturnType<typeof setTimeout>;
  private _mediaQuery?: MediaQueryList;
  private _boundMediaHandler = (e: MediaQueryListEvent) => {
    this._isMobile = e.matches;
    if (!e.matches) this._drawerOpen = false;
  };

  static styles = [waUtilities, headingStyles, pageLayoutStyles, css`
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

    .section-heading {
      margin: 0;
      font-size: var(--wa-font-size-l);
      font-weight: var(--wa-font-weight-bold);
    }

    .section-subtitle {
      margin: 0;
      color: var(--wa-color-text-quiet);
    }

    wa-dropdown {
      display: block;
    }

    .add-trigger {
      width: 100%;
    }

    .header-icon--saving {
      animation: spin 1s linear infinite;
    }

    .header-icon--saved {
      color: var(--wa-color-success-60);
    }

    .header-icon--error {
      color: var(--wa-color-danger-60);
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .route-loading {
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-text-quiet);
    }

    .map-fab {
      position: absolute;
      bottom: var(--wa-space-l);
      left: var(--wa-space-l);
      z-index: 1;
    }


    wa-drawer {
      --size: min(85vw, 380px);
    }

    wa-drawer h1 {
      display: none;
    }

    wa-drawer .wa-split {
      display: none;
    }

    .map-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--wa-color-surface-default) 80%, transparent);
      z-index: 1;
    }

    @media (max-width: 700px) {
      h1 {
        font-size: var(--wa-font-size-m);
      }
    }
  `];

  private _onUnitsChange = () => { this._units = getUnits(); };

  connectedCallback(): void {
    super.connectedCallback();
    this._mediaQuery = window.matchMedia('(max-width: 700px)');
    this._isMobile = this._mediaQuery.matches;
    this._mediaQuery.addEventListener('change', this._boundMediaHandler);
    document.addEventListener('units-change', this._onUnitsChange);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mediaQuery?.removeEventListener('change', this._boundMediaHandler);
    document.removeEventListener('units-change', this._onUnitsChange);
    clearTimeout(this._saveTimer);
    clearTimeout(this._statusTimer);
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
        navigateTo(`/map/${newMap.id}`, { replace: true });
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

  private _renderSidebarContent(canEdit: boolean, isOwner: boolean, isReadOnly: boolean) {
    return html`
      <div class="wa-split wa-gap-xs">
        <h1>
          <wa-icon name=${this._saveStatus === 'saving' ? 'arrow-rotate-right' : this._saveStatus === 'saved' ? 'check' : this._saveStatus === 'error' ? 'circle-xmark' : 'compass'} class="header-icon ${this._saveStatus !== 'idle' ? `header-icon--${this._saveStatus}` : ''}"></wa-icon>
          Trip Builder
        </h1>
        <div class="wa-cluster wa-gap-xs wa-align-items-center">
          ${!isOwner ? html`<wa-badge variant=${this._role === 'editor' ? 'brand' : 'neutral'}>${this._role}</wa-badge>` : nothing}
          ${this._map?.id ? html`
            <wa-dropdown placement="bottom-end" @wa-select=${this._onActionSelect}>
              <wa-button slot="trigger" appearance="outlined" size="small" variant="neutral">
                <wa-icon name="ellipsis" label="More actions"></wa-icon>
              </wa-button>
              ${isOwner ? html`
                <wa-dropdown-item value="share">
                  <wa-icon slot="icon" name="share-nodes"></wa-icon>
                  Share
                </wa-dropdown-item>
              ` : nothing}
              <wa-dropdown-item value="preview">
                <wa-icon slot="icon" name="eye"></wa-icon>
                Preview &amp; Export
              </wa-dropdown-item>
            </wa-dropdown>
          ` : nothing}
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
          <h2 class="section-heading">${this._map?.name ?? 'Untitled Trip'}</h2>
          ${this._map?.family_name ? html`<p class="section-subtitle">${this._map.family_name}</p>` : nothing}
        `}
      </div>

      ${canEdit ? html`
        <wa-dropdown>
          <wa-button slot="trigger" variant="brand" size="small" with-caret class="add-trigger">
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
      ` : nothing}

      <div class="sidebar-scroll">
        <div class="wa-stack wa-gap-s">
          <item-list
            .items=${this._items}
            .readonly=${isReadOnly}
            .distances=${this._routeDistances}
            .units=${this._units}
            @item-update=${this._onItemUpdate}
            @item-update-batch=${this._onItemUpdateBatch}
            @item-delete=${this._onItemDelete}
            @items-reorder=${this._onItemsReorder}
          ></item-list>

          ${this._totalDistance ? html`
            <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
              <span class="stat-label">Total distance:</span>
              <span class="stat-value">${formatDistance(this._totalDistance, this._units)}</span>
            </div>
          ` : nothing}

          ${this._routeLoading ? html`
            <div class="route-loading wa-cluster wa-gap-xs wa-align-items-center">
              <wa-spinner></wa-spinner>
              Calculating routes...
            </div>
          ` : nothing}
        </div>
      </div>

    `;
  }

  private _renderDrawerHeaderActions(isOwner: boolean) {
    return html`
      ${this._map?.id ? html`
        <wa-dropdown slot="header-actions" placement="bottom-end" @wa-select=${this._onActionSelect}>
          <wa-button slot="trigger" appearance="plain" size="small">
            <wa-icon name="ellipsis" label="More actions"></wa-icon>
          </wa-button>
          ${isOwner ? html`
            <wa-dropdown-item value="share">
              <wa-icon slot="icon" name="share-nodes"></wa-icon> Share
            </wa-dropdown-item>
          ` : nothing}
          <wa-dropdown-item value="preview">
            <wa-icon slot="icon" name="eye"></wa-icon> Preview &amp; Export
          </wa-dropdown-item>
        </wa-dropdown>
      ` : nothing}
      ${!isOwner ? html`
        <wa-badge slot="header-actions" variant=${this._role === 'editor' ? 'brand' : 'neutral'}>${this._role}</wa-badge>
      ` : nothing}
    `;
  }

  render() {
    if (this._loading) {
      return html`
        <wa-split-panel primary="start" position-in-pixels="380">
          <div slot="start" class="sidebar">
            <div class="loading-center wa-cluster wa-justify-content-center"><wa-spinner></wa-spinner></div>
          </div>
          <div slot="end" class="map-panel">
            <map-view></map-view>
            <div class="map-overlay"><wa-spinner></wa-spinner></div>
          </div>
        </wa-split-panel>
      `;
    }

    if (this._error) {
      return html`
        <wa-split-panel primary="start" position-in-pixels="380">
          <div slot="start" class="sidebar">
            <wa-callout variant="danger">
              <wa-icon slot="icon" name="circle-xmark"></wa-icon>
              ${this._error}
            </wa-callout>
          </div>
          <div slot="end" class="map-panel">
            <map-view></map-view>
            <div class="map-overlay">
              <wa-callout variant="danger">
                <wa-icon slot="icon" name="circle-xmark"></wa-icon>
                ${this._error}
              </wa-callout>
            </div>
          </div>
        </wa-split-panel>
      `;
    }

    const canEdit = this._role === 'owner' || this._role === 'editor';
    const isOwner = this._role === 'owner';
    const isReadOnly = !canEdit;

    return html`
      <wa-split-panel primary="start" position-in-pixels="380">
        <div slot="start" class="sidebar">
          ${this._renderSidebarContent(canEdit, isOwner, isReadOnly)}
        </div>
        <div slot="end" class="map-panel">
          <map-view @map-ready=${this._onMapReady}></map-view>
          ${this._isMobile ? html`
            <wa-button
              class="map-fab"
              variant="brand"
              size="large"
              pill
              @click=${() => { this._drawerOpen = true; }}
            >
              <wa-icon name="pencil" label="Edit trip"></wa-icon>
            </wa-button>
          ` : nothing}
        </div>
      </wa-split-panel>

      ${this._isMobile ? html`
        <wa-drawer
          placement="start"
          ?open=${this._drawerOpen}
          light-dismiss
          @wa-after-hide=${this._onDrawerHide}
        >
          <span slot="label">
            <wa-icon name=${this._saveStatus === 'saving' ? 'arrow-rotate-right' : this._saveStatus === 'saved' ? 'check' : this._saveStatus === 'error' ? 'circle-xmark' : 'compass'} class="header-icon ${this._saveStatus !== 'idle' ? `header-icon--${this._saveStatus}` : ''}"></wa-icon>
            Trip Builder
          </span>
          ${this._renderDrawerHeaderActions(isOwner)}
          <div class="wa-stack wa-gap-m">
            ${this._renderSidebarContent(canEdit, isOwner, isReadOnly)}
          </div>
        </wa-drawer>
      ` : nothing}

      ${isOwner ? html`
        <share-dialog
          .mapId=${this._map?.id ?? ''}
          .visibility=${(this._map?.visibility ?? 'private') as 'public' | 'private'}
          @visibility-changed=${this._onVisibilityChanged}
        ></share-dialog>
      ` : nothing}
    `;
  }

  private _statusTimer?: ReturnType<typeof setTimeout>;

  private _setSaveStatus(status: SaveStatus) {
    clearTimeout(this._statusTimer);
    this._saveStatus = status;
    if (status === 'saved' || status === 'error') {
      this._statusTimer = setTimeout(() => { this._saveStatus = 'idle'; }, 3000);
    }
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
    this._setSaveStatus('saving');
    this._saveTimer = setTimeout(() => this._saveMetadata(), 2500);
  }

  private async _saveMetadata() {
    if (!this._map) return;
    try {
      this._setSaveStatus('saving');
      await updateMap(this._map.id, {
        name: this._map.name,
        family_name: this._map.family_name,
      });
      this._setSaveStatus('saved');
    } catch {
      this._setSaveStatus('error');
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
      this._setSaveStatus('error');
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
      this._setSaveStatus('error');
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

    // Propagate icon changes to all other items sharing the same coordinates
    if ((field === 'icon' || field === 'dest_icon') && typeof value === 'string') {
      this._propagateIconToColocated(itemId, field, value);
    }

    // Icon and travel_mode save immediately; text fields debounce
    const immediateSaveFields = new Set(['icon', 'dest_icon', 'travel_mode']);
    if (immediateSaveFields.has(field)) {
      this._flushItemUpdate(this._map.id, itemId, { [field]: value });
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
    // Always sync map so labels/icons update visually
    this._debounceSyncMap();
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

    // Propagate icon changes to co-located items
    for (const iconField of ['icon', 'dest_icon'] as const) {
      if (typeof modelFields[iconField] === 'string') {
        this._propagateIconToColocated(itemId, iconField, modelFields[iconField] as string);
      }
    }

    // Save immediately and sync map (coordinates changed)
    this._flushItemUpdate(this._map.id, itemId, fields);
    this._debounceSyncMap();
  }

  private async _flushItemUpdate(mapId: string, itemId: string, fields: Record<string, unknown>) {
    this._pendingSaves++;
    this._setSaveStatus('saving');
    try {
      await updateStop(mapId, itemId, fields);
      if (--this._pendingSaves === 0) this._setSaveStatus('saved');
    } catch {
      --this._pendingSaves;
      this._setSaveStatus('error');
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
      this._setSaveStatus('error');
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
      this._setSaveStatus('error');
    }
  }

  // ── Icon propagation ──────────────────────────────────────────────────

  /**
   * When an icon changes on a point or route endpoint, propagate the new icon
   * to every other item that shares the exact same coordinates.
   */
  private _propagateIconToColocated(itemId: string, field: 'icon' | 'dest_icon', newIcon: string) {
    const source = this._items.find((s) => s.id === itemId);
    if (!source) return;

    // Resolve the coordinates of the changed endpoint
    let lat: number, lng: number;
    if (field === 'dest_icon') {
      if (source.dest_latitude == null || source.dest_longitude == null) return;
      lat = source.dest_latitude;
      lng = source.dest_longitude;
    } else {
      lat = source.latitude;
      lng = source.longitude;
    }
    if (isDraftCoord(lat, lng)) return;

    const eq = (a: number, b: number) => Math.abs(a - b) < 1e-5;

    // Collect field updates per item
    const updates = new Map<string, Record<string, string>>();
    for (const item of this._items) {
      if (item.id === itemId) continue;

      // Match start endpoint (point or route start)
      if (eq(item.latitude, lat) && eq(item.longitude, lng) && item.icon !== newIcon) {
        const u = updates.get(item.id) ?? {};
        u.icon = newIcon;
        updates.set(item.id, u);
      }

      // Match dest endpoint (route end)
      if (
        item.dest_latitude != null && item.dest_longitude != null &&
        eq(item.dest_latitude, lat) && eq(item.dest_longitude, lng) &&
        item.dest_icon !== newIcon
      ) {
        const u = updates.get(item.id) ?? {};
        u.dest_icon = newIcon;
        updates.set(item.id, u);
      }
    }

    if (updates.size === 0) return;

    // Optimistic local update
    this._items = this._items.map((s) => {
      const fields = updates.get(s.id);
      return fields ? { ...s, ...fields } : s;
    });

    // Persist each co-located update to the server
    const mapId = this._map!.id;
    for (const [id, fields] of updates) {
      this._flushItemUpdate(mapId, id, fields);
    }
  }

  // ── Sharing ────────────────────────────────────────────────────────────

  private _onActionSelect(e: CustomEvent<{ item: { value: string } }>) {
    const value = e.detail.item.value;
    if (value === 'share') this._onShareClick();
    else if (value === 'preview') navigateTo(`/preview/${this._map!.id}`);
  }

  private _onDrawerHide() {
    this._drawerOpen = false;
  }

  private _onShareClick() {
    const dialog = this.shadowRoot?.querySelector('share-dialog') as HTMLElement & { show(): void } | null;
    dialog?.show();
  }

  private _onVisibilityChanged(e: CustomEvent<{ visibility: 'public' | 'private' }>) {
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
      this._setSaveStatus('error');
    } finally {
      this._duplicating = false;
    }
  }

  // ── Map → sidebar interactivity ──────────────────────────────────────

  protected override _getExtraControllerOptions(): Partial<MapControllerOptions> {
    return {
      onItemClick: (itemId: string) => this._onMapItemClick(itemId),
    };
  }

  private async _onMapItemClick(itemId: string) {
    // On mobile, open the drawer first so the item-list is visible
    if (this._isMobile) {
      this._drawerOpen = true;
      await this.updateComplete;
      // Wait for drawer show animation to start so item-list is in the DOM
      await new Promise((r) => requestAnimationFrame(r));
    }

    const selector = this._isMobile ? 'wa-drawer item-list' : '.sidebar item-list';
    const itemList = this.shadowRoot?.querySelector(selector) as ItemList | null;
    itemList?.scrollToItem(itemId);
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
