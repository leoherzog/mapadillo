/**
 * Trip builder page — sidebar with item management + full-screen map.
 *
 * Map items are points (standalone markers) and routes (A→B pairs).
 */
import { html, css, nothing } from 'lit';
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
} from '../services/maps.js';
import { isAuthenticated } from '../auth/auth-state.js';
import { navigateTo, signInUrl } from '../nav.js';
import { errorCallout, roleBadge } from '../components/ui.js';
import { canEditRole, GEOMETRY_INVALIDATING_FIELDS, type MapRole, type Visibility } from '../../shared/types.js';
import { MAX_NAME_LENGTH } from '../../shared/limits.js';
import { formatDistance, isDraftCoord } from '../utils/geo.js';
import { resolveMapStyle } from '../config/map.js';
import { MapPageBase } from './map-page-base.js';
import { getUnits, onUnitsChange } from '../units.js';
import { StoreController } from '../utils/store-controller.js';
import { fieldValue } from '../utils/form.js';
import '../components/map-view.js';
import '../components/item-list.js';
import type { ItemList } from '../components/item-list.js';
import '../components/share-dialog.js';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Text for the visually hidden save-status live region. */
const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'All changes saved',
  error: 'Some changes could not be saved',
};

/** Maps API field names to model field names for optimistic updates. */
const API_TO_MODEL: Record<string, string> = {
  lat: 'latitude', lng: 'longitude',
  dest_lat: 'dest_latitude', dest_lng: 'dest_longitude',
};

/** Item fields saved after a typing pause; every other edit saves immediately. */
const DEBOUNCED_ITEM_FIELDS = new Set(['name', 'dest_name']);

@customElement('trip-builder-page')
export class TripBuilderPage extends MapPageBase {
  @state() private _saveStatus: SaveStatus = 'idle';
  @state() private _routeLoading = false;
  @state() private _duplicating = false;
  @state() private _duplicateError = '';
  @state() private _isMobile = false;
  @state() private _drawerOpen = false;
  private _units = new StoreController(this, getUnits, onUnitsChange);

  private _saveTimer?: ReturnType<typeof setTimeout>;
  /** Save requests sent and not yet settled. */
  private _inFlightSaves = new Set<Promise<unknown>>();
  /** Set when a tracked save fails; reported once no save is queued or in flight. */
  private _saveFailed = false;
  /** Debounced item edits keyed `${itemId}:${field}`; `flush` sends one early. */
  private _itemUpdateTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; flush: (keepalive?: boolean) => Promise<void> }>();
  private _routeDebounceTimer?: ReturnType<typeof setTimeout>;
  /** Identifies the latest _syncMap run; a superseded run leaves shared state alone. */
  private _syncGeneration = 0;
  private _mediaQuery?: MediaQueryList;
  private _boundMediaHandler = (e: MediaQueryListEvent) => {
    this._isMobile = e.matches;
    if (!e.matches) this._drawerOpen = false;
  };
  private _onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this._saveTimer !== undefined || this._itemUpdateTimers.size > 0 || this._inFlightSaves.size > 0) {
      e.preventDefault();
    }
  };
  /** iOS never fires beforeunload, so queued saves go out whenever the page is hidden or unloaded. */
  private _onPageHide = (e: Event) => {
    if (e.type === 'pagehide' || document.visibilityState === 'hidden') void this._flushPendingSaves(true);
  };

  private get _role(): MapRole {
    return this._map?.role ?? 'public';
  }

  static styles = [waUtilities, headingStyles, pageLayoutStyles, css`
    h1 {
      flex: 1;
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

    .callout-action {
      margin-top: var(--wa-space-xs);
    }

    .header-icon--saved {
      color: var(--wa-color-success-60);
    }

    .header-icon--error {
      color: var(--wa-color-danger-60);
    }

    .header-spinner {
      font-size: var(--wa-font-size-xl);
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

    .map-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--wa-color-surface-default) 80%, transparent);
      z-index: 1;
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    // map-view mounts only once the map has loaded, so start its style fetch alongside getMap.
    void resolveMapStyle().catch(() => {});
    this._mediaQuery = window.matchMedia('(max-width: 700px)');
    this._isMobile = this._mediaQuery.matches;
    this._mediaQuery.addEventListener('change', this._boundMediaHandler);
    window.addEventListener('beforeunload', this._onBeforeUnload);
    document.addEventListener('visibilitychange', this._onPageHide);
    window.addEventListener('pagehide', this._onPageHide);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mediaQuery?.removeEventListener('change', this._boundMediaHandler);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    document.removeEventListener('visibilitychange', this._onPageHide);
    window.removeEventListener('pagehide', this._onPageHide);
    void this._flushPendingSaves();
    clearTimeout(this._statusTimer);
    clearTimeout(this._routeDebounceTimer);
  }

  protected async _loadMap() {
    if (this.mapId) {
      // /map/:id reuses this element across ids; queued saves must read _map before getMap replaces it.
      void this._flushPendingSaves();
      return super._loadMap();
    }
    // Leaving /map/new renders a fresh element for /map/:id, which loads the new map.
    try {
      const newMap = await createMap({ name: 'Untitled Trip' });
      if (!this.isConnected) return;
      navigateTo(`/map/${newMap.id}`, { replace: true });
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Failed to create map';
      this._loading = false;
    }
  }

  private _renderStatusIcon() {
    return this._saveStatus === 'saving'
      ? html`<wa-spinner class="header-spinner" aria-hidden="true"></wa-spinner>`
      : html`<wa-icon name=${this._saveStatus === 'saved' ? 'check' : this._saveStatus === 'error' ? 'circle-xmark' : 'map'} class="header-icon ${this._saveStatus !== 'idle' ? `header-icon--${this._saveStatus}` : ''}"></wa-icon>`;
  }

  /** Share (owners only) and Preview & Export items for an actions dropdown. */
  private _renderActionItems(isOwner: boolean) {
    return html`
      ${isOwner ? html`
        <wa-dropdown-item value="share">
          <wa-icon slot="icon" name="share-nodes"></wa-icon>
          Share
        </wa-dropdown-item>
      ` : nothing}
      <wa-dropdown-item value="preview" href="/preview/${this._map!.id}">
        <wa-icon slot="icon" name="eye"></wa-icon>
        Preview &amp; Export
      </wa-dropdown-item>
    `;
  }

  private _renderSidebarContent(canEdit: boolean, isOwner: boolean, isReadOnly: boolean, withHeader = true) {
    return html`
      ${withHeader ? html`
        <div class="wa-split wa-gap-xs">
          <h1>
            ${this._renderStatusIcon()}
            Trip Builder
          </h1>
          <div class="wa-cluster wa-gap-xs wa-align-items-center">
            ${!isOwner ? roleBadge(this._role) : nothing}
            ${this._map?.id ? html`
              <wa-dropdown placement="bottom-end" @wa-select=${this._onActionSelect}>
                <wa-button id="more-actions-btn" slot="trigger" appearance="outlined" size="s" variant="neutral">
                  <wa-icon name="ellipsis" label="More actions"></wa-icon>
                </wa-button>
                ${this._renderActionItems(isOwner)}
              </wa-dropdown>
              <wa-tooltip for="more-actions-btn">More actions</wa-tooltip>
            ` : nothing}
          </div>
        </div>
      ` : nothing}

      ${isReadOnly ? html`
        <wa-callout variant="neutral">
          <wa-icon slot="icon" name="eye"></wa-icon>
          You are viewing this trip as ${this._role === 'public' ? 'a public visitor' : 'a viewer'}.
          ${isAuthenticated() ? html`
            <wa-button
              size="s"
              variant="brand"
              ?loading=${this._duplicating}
              @click=${this._onDuplicate}
              class="callout-action"
            >
              <wa-icon slot="start" name="clone"></wa-icon>
              Duplicate this trip
            </wa-button>
          ` : html`
            <wa-button
              size="s"
              variant="brand"
              href=${signInUrl(`/map/${this.mapId}`)}
              class="callout-action"
            >
              <wa-icon slot="start" name="arrow-right-to-bracket"></wa-icon>
              Sign in to duplicate this trip
            </wa-button>
          `}
        </wa-callout>
      ` : nothing}

      ${this._duplicateError ? errorCallout(this._duplicateError) : nothing}

      <div class="wa-stack wa-gap-xs">
        ${canEdit ? html`
          <wa-input
            placeholder="Trip name"
            maxlength=${MAX_NAME_LENGTH}
            .value=${this._map?.name ?? ''}
            @input=${this._onNameInput}
          ></wa-input>
          <wa-input
            placeholder="Family name (optional)"
            maxlength=${MAX_NAME_LENGTH}
            .value=${this._map?.family_name ?? ''}
            @input=${this._onFamilyInput}
          ></wa-input>
        ` : html`
          <h2 class="section-heading">${this._map?.name ?? 'Untitled Trip'}</h2>
          ${this._map?.family_name ? html`<p class="section-subtitle">${this._map.family_name}</p>` : nothing}
        `}
      </div>

      ${canEdit ? html`
        <wa-dropdown @wa-select=${this._onAddSelect}>
          <wa-button slot="trigger" variant="brand" size="s" with-caret class="add-trigger">
            <wa-icon slot="start" name="plus"></wa-icon>
            Add
          </wa-button>
          <wa-dropdown-item value="point">
            <wa-icon slot="icon" name="location-dot"></wa-icon>
            Point
          </wa-dropdown-item>
          <wa-dropdown-item value="route">
            <wa-icon slot="icon" name="location-arrow"></wa-icon>
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
            .units=${this._units.value}
            @item-update=${this._onItemUpdate}
            @item-update-batch=${this._onItemUpdateBatch}
            @item-delete=${this._onItemDelete}
            @items-reorder=${this._onItemsReorder}
          ></item-list>

          ${this._totalDistance ? html`
            <div class="stat-row wa-cluster wa-gap-xs wa-align-items-center">
              <span class="stat-label">Total distance:</span>
              <span class="stat-value">${formatDistance(this._totalDistance, this._units.value)}</span>
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
          <wa-button slot="trigger" appearance="plain" size="s">
            <wa-icon name="ellipsis" label="More actions"></wa-icon>
          </wa-button>
          ${this._renderActionItems(isOwner)}
        </wa-dropdown>
      ` : nothing}
      ${!isOwner ? roleBadge(this._role, 'header-actions') : nothing}
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
            <div class="map-overlay"><wa-spinner></wa-spinner></div>
          </div>
        </wa-split-panel>
      `;
    }

    if (this._error) {
      return html`
        <wa-split-panel primary="start" position-in-pixels="380">
          <div slot="start" class="sidebar" aria-hidden="true">
            ${errorCallout(this._error)}
          </div>
          <div slot="end" class="map-panel">
            <div class="map-overlay">
              ${errorCallout(this._error)}
            </div>
          </div>
        </wa-split-panel>
      `;
    }

    const canEdit = canEditRole(this._role);
    const isOwner = this._role === 'owner';
    const isReadOnly = !canEdit;

    return html`
      <wa-split-panel primary="start" position-in-pixels="380">
        <div slot="start" class="sidebar">
          ${this._isMobile ? nothing : this._renderSidebarContent(canEdit, isOwner, isReadOnly)}
        </div>
        <div slot="end" class="map-panel">
          <map-view @map-ready=${this._onMapReady}></map-view>
          ${this._isMobile ? html`
            <wa-button
              id="edit-trip-fab"
              class="map-fab"
              variant="brand"
              size="l"
              pill
              @click=${() => { this._drawerOpen = true; }}
            >
              <wa-icon name="pencil" label="Edit trip"></wa-icon>
            </wa-button>
            <wa-tooltip for="edit-trip-fab">Edit trip</wa-tooltip>
          ` : nothing}
        </div>
      </wa-split-panel>
      <span class="wa-visually-hidden" role="status">${SAVE_STATUS_TEXT[this._saveStatus]}</span>

      ${this._isMobile ? html`
        <wa-drawer
          placement="start"
          ?open=${this._drawerOpen}
          light-dismiss
          @wa-after-hide=${this._onDrawerHide}
        >
          <span slot="label">
            ${this._renderStatusIcon()}
            Trip Builder
          </span>
          ${this._renderDrawerHeaderActions(isOwner)}
          <div class="wa-stack wa-gap-m">
            ${this._renderSidebarContent(canEdit, isOwner, isReadOnly, false)}
          </div>
        </wa-drawer>
      ` : nothing}

      ${isOwner ? html`
        <share-dialog
          .mapId=${this._map?.id ?? ''}
          .visibility=${this._map?.visibility ?? 'private'}
          @visibility-changed=${this._onVisibilityChanged}
        ></share-dialog>
      ` : nothing}
    `;
  }

  private _statusTimer?: ReturnType<typeof setTimeout>;

  private _setSaveStatus(status: SaveStatus) {
    clearTimeout(this._statusTimer);
    this._saveStatus = status;
    // An error stays visible until the next save starts.
    if (status === 'saved') {
      this._statusTimer = setTimeout(() => { this._saveStatus = 'idle'; }, 3000);
    }
  }

  /**
   * Shows the outcome once no save is queued or in flight.
   * @param done - status to show when nothing failed
   */
  private _settleSaveStatus(done: SaveStatus = 'saved') {
    if (this._inFlightSaves.size > 0 || this._saveTimer !== undefined || this._itemUpdateTimers.size > 0) return;
    this._setSaveStatus(this._saveFailed ? 'error' : done);
    this._saveFailed = false;
  }

  /**
   * Runs a save request through the status indicator. Never rejects.
   * @returns the response, or undefined when the request failed
   */
  private async _trackSave<T>(request: Promise<T>): Promise<T | undefined> {
    this._inFlightSaves.add(request);
    this._setSaveStatus('saving');
    try {
      return await request;
    } catch {
      this._saveFailed = true;
      return undefined;
    } finally {
      this._inFlightSaves.delete(request);
      this._settleSaveStatus();
    }
  }

  /**
   * Sends every debounced metadata and item save now. Never rejects.
   * @param keepalive - lets the saves finish after the page unloads
   */
  private _flushPendingSaves(keepalive = false): Promise<unknown> {
    const saves: Promise<unknown>[] = [];
    if (this._saveTimer !== undefined) {
      clearTimeout(this._saveTimer);
      this._saveTimer = undefined;
      saves.push(this._saveMetadata(keepalive));
    }
    for (const { timer, flush } of [...this._itemUpdateTimers.values()]) {
      clearTimeout(timer);
      saves.push(flush(keepalive));
    }
    this._itemUpdateTimers.clear();
    return Promise.all(saves);
  }

  // ── Metadata auto-save (debounced) ──────────────────────────────────────

  private _onNameInput(e: Event) {
    const value = fieldValue(e);
    if (this._map) this._map = { ...this._map, name: value };
    this._debounceSave();
  }

  private _onFamilyInput(e: Event) {
    const value = fieldValue(e);
    if (this._map) this._map = { ...this._map, family_name: value || null };
    this._debounceSave();
  }

  private _debounceSave() {
    clearTimeout(this._saveTimer);
    this._setSaveStatus('saving');
    this._saveTimer = setTimeout(() => {
      this._saveTimer = undefined;
      void this._saveMetadata();
    }, 2500);
  }

  private async _saveMetadata(keepalive = false) {
    if (!this._map) return;
    // The server rejects a blank name; family_name goes out with the next non-blank save.
    if (!this._map.name.trim()) {
      this._settleSaveStatus('idle');
      return;
    }
    await this._trackSave(updateMap(this._map.id, {
      name: this._map.name,
      family_name: this._map.family_name,
    }, keepalive));
  }

  // ── Add item flows ─────────────────────────────────────────────────────

  private _onAddSelect(e: CustomEvent<{ item: { value: string } }>) {
    const type = e.detail.item.value;
    if (type === 'point' || type === 'route') void this._addItem(type);
  }

  /** Creates an item at the draft origin, then scrolls its card into view. */
  private async _addItem(type: 'point' | 'route') {
    if (!this._map) return;
    const item = await this._trackSave(addStop(this._map.id, {
      type,
      name: type === 'point' ? 'New Point' : 'New Route',
      lat: 0,
      lng: 0,
    }));
    if (!item) return;
    this._items = [...this._items, item];
    await this.updateComplete;
    this.shadowRoot?.querySelector<ItemList>('item-list')?.scrollToItem(item.id);
  }

  // ── Item events ───────────────────────────────────────────────────────

  private _onItemUpdate(e: CustomEvent<{ itemId: string; field: string; value: unknown }>) {
    this._applyItemUpdate(e.detail.itemId, { [e.detail.field]: e.detail.value });
  }

  /** Handle batch field updates (e.g., coordinate changes from route-card). */
  private _onItemUpdateBatch(e: CustomEvent<{ itemId: string; fields: Record<string, unknown> }>) {
    this._applyItemUpdate(e.detail.itemId, e.detail.fields);
  }

  /**
   * Applies an item edit locally, then saves it: a lone name edit after a typing pause, anything else at once.
   * @param fields - stop PATCH fields, using API names
   */
  private _applyItemUpdate(itemId: string, fields: Record<string, unknown>) {
    if (!this._map) return;
    const mapId = this._map.id;

    const modelFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      modelFields[API_TO_MODEL[k] ?? k] = v;
    }

    // Mirror the server's cache invalidation; a stale route_geometry keeps drawing the old line.
    const invalidatesGeometry = GEOMETRY_INVALIDATING_FIELDS.some((f) => f in fields);
    this._items = this._items.map((s) => {
      if (s.id !== itemId) return s;
      return s.type === 'route' && invalidatesGeometry
        ? { ...s, ...modelFields, route_geometry: null }
        : { ...s, ...modelFields };
    });

    // Runs after the merge so a picked location's new coordinates are matched.
    for (const iconField of ['icon', 'dest_icon'] as const) {
      const icon = fields[iconField];
      if (typeof icon === 'string') this._propagateIconToColocated(itemId, iconField, icon);
    }

    const keys = Object.keys(fields);
    if (keys.length === 1 && DEBOUNCED_ITEM_FIELDS.has(keys[0])) {
      const timerKey = `${itemId}:${keys[0]}`;
      clearTimeout(this._itemUpdateTimers.get(timerKey)?.timer);
      const flush = (keepalive?: boolean) => {
        this._itemUpdateTimers.delete(timerKey);
        return this._flushItemUpdate(mapId, itemId, fields, keepalive);
      };
      this._itemUpdateTimers.set(timerKey, { timer: setTimeout(flush, 1500), flush });
    } else {
      // A queued name edit would otherwise land after, and overwrite, a picked location's name.
      this._cancelItemTimers(itemId, keys);
      void this._flushItemUpdate(mapId, itemId, fields);
    }
    // Always sync map so labels/icons update visually
    this._debounceSyncMap();
  }

  private async _flushItemUpdate(mapId: string, itemId: string, fields: Record<string, unknown>, keepalive?: boolean) {
    await this._trackSave(updateStop(mapId, itemId, fields, keepalive));
  }

  /**
   * Drops an item's debounced edits without sending them.
   * @param fields - only these fields; all when omitted
   */
  private _cancelItemTimers(itemId: string, fields?: string[]) {
    for (const [key, { timer }] of this._itemUpdateTimers) {
      const [id, field] = key.split(':');
      if (id === itemId && (!fields || fields.includes(field))) {
        clearTimeout(timer);
        this._itemUpdateTimers.delete(key);
      }
    }
  }

  private async _onItemDelete(e: CustomEvent<{ itemId: string }>) {
    if (!this._map) return;
    const { itemId } = e.detail;
    this._cancelItemTimers(itemId);

    // Optimistic remove — positions may have gaps but ordering is preserved
    this._items = this._items.filter((s) => s.id !== itemId);
    this._debounceSyncMap();

    await this._trackSave(deleteStop(this._map.id, itemId));
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

    await this._trackSave(reorderStops(this._map.id, order));
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
      if (source.type !== 'route') return;
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
        item.type === 'route' &&
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
    if (value === 'share') {
      this._onShareClick();
    } else if (
      value === 'preview' &&
      (this._saveTimer !== undefined || this._itemUpdateTimers.size > 0 || this._inFlightSaves.size > 0)
    ) {
      // The preview page reads the map from the server, so queued and in-flight edits must land before the link navigates.
      e.preventDefault();
      (e.currentTarget as HTMLElement & { open: boolean }).open = false;
      const id = this._map!.id;
      void Promise.allSettled([this._flushPendingSaves(), ...this._inFlightSaves])
        .then(() => navigateTo(`/preview/${id}`));
    }
  }

  /** Nested dropdowns, comboboxes, tooltips and dialogs also bubble wa-after-hide; only the drawer's own closes it. */
  private _onDrawerHide(e: Event) {
    if (e.target !== e.currentTarget) return;
    this._drawerOpen = false;
  }

  private _onShareClick() {
    void this.shadowRoot?.querySelector('share-dialog')?.show();
  }

  private _onVisibilityChanged(e: CustomEvent<{ visibility: Visibility }>) {
    if (this._map) {
      this._map = { ...this._map, visibility: e.detail.visibility };
    }
  }

  private async _onDuplicate() {
    if (!this._map) return;
    this._duplicating = true;
    this._duplicateError = '';
    try {
      const newMap = await duplicateMap(this._map.id);
      navigateTo(`/map/${newMap.id}`);
    } catch {
      this._duplicateError = 'Could not duplicate this trip. Please try again.';
    } finally {
      this._duplicating = false;
    }
  }

  // ── Map → sidebar interactivity ──────────────────────────────────────

  protected override async _onMapItemClick(itemId: string) {
    // On mobile, open the drawer first so the item-list is visible
    if (this._isMobile) {
      this._drawerOpen = true;
      await this.updateComplete;
      // Wait for drawer show animation to start so item-list is in the DOM
      await new Promise((r) => requestAnimationFrame(r));
    }

    const itemList = this.shadowRoot?.querySelector('item-list') as ItemList | null;
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

    const gen = ++this._syncGeneration;
    const drawn = this._items;
    const drawnSet = new Set(drawn);
    this._routeLoading = true;
    try {
      this._routeDistances = new Map();
      const result = await this._mapController.drawItems(drawn, {
        animate: this._animateFit,
        fitPadding: this._fitPadding(),
      });
      if (gen !== this._syncGeneration) return;
      this._routeDistances = result.distances;

      // Fire-and-forget: cache route geometry to D1 for dashboard map cards
      if (this._map && canEditRole(this._role) && result.geometries.size > 0) {
        let updated = false;
        const next = this._items.map(s => {
          if (s.type !== 'route') return s;
          // Every edit replaces the item object, so an item edited mid-draw is skipped.
          if (s.route_geometry || !drawnSet.has(s)) return s;
          const geometry = result.geometries.get(s.id);
          // A straight line standing in for a transient routing failure is drawn but not cached.
          if (!geometry || geometry.fallback) return s;
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
      if (gen === this._syncGeneration) this._routeLoading = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'trip-builder-page': TripBuilderPage;
  }
}
