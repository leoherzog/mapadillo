/**
 * Map preview page — full-screen map with floating overlay for
 * paper size/orientation selection. User positions the map here,
 * then continues to /export/:id for download and print ordering.
 */
import { html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { familyNameStyles } from '../styles/page-layout.js';
import { navigateTo } from '../nav.js';
import { errorCallout } from '../components/ui.js';
import { isAuthenticated } from '../auth/auth-state.js';
import { formatDistance } from '../utils/geo.js';
import { pageMm, paperFramePadding } from '../map/map-export.js';
import type { PaperSize, Orientation } from '../../shared/paper.js';
import { updateMap } from '../services/maps.js';
import { MapPageBase } from './map-page-base.js';
import { getUnits, onUnitsChange } from '../units.js';
import { StoreController } from '../utils/store-controller.js';
import { fieldValue } from '../utils/form.js';
import { canEditRole, parseExportSettings, type ExportSettings } from '../../shared/types.js';
import '../components/map-view.js';

const PAPER_SIZE_LABELS: Record<PaperSize, string> = {
  letter: 'Letter (8.5 \u00d7 11\u2033)',
  a4: 'A4 (210 \u00d7 297 mm)',
  a3: 'A3 (297 \u00d7 420 mm)',
  tabloid: 'Tabloid (11 \u00d7 17\u2033)',
  '18x24': 'Poster (18 \u00d7 24\u2033)',
  '24x36': 'Poster (24 \u00d7 36\u2033)',
  '40x60': 'Poster (40 \u00d7 60\u2033)',
  a2: 'A2 (420 \u00d7 594 mm)',
  a1: 'A1 (594 \u00d7 841 mm)',
};

@customElement('map-preview-page')
export class MapPreviewPage extends MapPageBase {
  @state() private _paperSize: PaperSize = 'letter';
  @state() private _orientation: Orientation = 'landscape';
  @state() private _continuing = false;

  private _units = new StoreController(this, getUnits, onUnitsChange);
  private readonly _detailsOpen = !matchMedia('(max-width: 700px)').matches;
  private _settingsLoaded = false;
  private _moveListenerAdded = false;
  private _saveTimer?: ReturnType<typeof setTimeout>;
  /** Last nonzero map container size, for saves made after the container detaches. */
  private _viewSize?: [number, number];
  /** Tail of the export-settings PUT chain; never rejects. */
  private _savePromise: Promise<void> = Promise.resolve();

  static styles = [waUtilities, familyNameStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      position: relative;
    }

    .map-panel {
      flex: 1;
      min-width: 0;
      min-height: 0;
      position: relative;
    }

    /* ── Floating overlay ─────────────────────────────────── */

    .overlay {
      position: absolute;
      top: var(--wa-space-m);
      left: var(--wa-space-m);
      z-index: 10;
      background: var(--wa-color-surface-default);
      border-radius: var(--wa-border-radius-m);
      padding: var(--wa-space-s) var(--wa-space-m);
      box-shadow: var(--wa-shadow-m);
      max-width: 340px;
      max-height: calc(100% - var(--wa-space-l) * 2);
      overflow-y: auto;
    }

    .overlay.error-overlay {
      padding: var(--wa-space-l);
    }

    .overlay .trip-name {
      margin: 0;
      font-size: var(--wa-font-size-m);
      font-weight: var(--wa-font-weight-bold);
      color: var(--wa-color-text-normal);
    }

    wa-details {
      --spacing: 0;
    }

    wa-details::part(header) {
      padding: 0;
    }

    wa-details::part(content) {
      padding-top: var(--wa-space-s);
    }

    .overlay-summary .trip-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .continue-btn {
      width: 100%;
    }

    /* ── Paper frame overlay ──────────────────────────────── */

    .paper-frame-container {
      position: absolute;
      inset: 0;
      z-index: 5;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
      container-type: size;
    }

    .paper-frame {
      /* --pw / --ph are set via inline style (paper width/height in mm).
         Use min() to "contain-fit" the frame: pick the largest rectangle
         of the given aspect ratio that fits within 85% of the container. */
      width: min(85cqw, 85cqh * var(--pw) / var(--ph));
      aspect-ratio: var(--pw) / var(--ph);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
      border: var(--wa-border-width-m) dashed rgba(255, 255, 255, 0.8);
    }

    /* ── Loading ──────────────────────────────────────────── */

    .loading-container {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10;
    }

    /* ── Mobile ───────────────────────────────────────────── */

    @media (max-width: 700px) {
      .overlay {
        top: var(--wa-space-xs);
        left: var(--wa-space-xs);
        right: var(--wa-space-xs);
        max-width: none;
        max-height: 70vh;
        padding: var(--wa-space-xs) var(--wa-space-s);
      }
    }
  `];

  /** Returns inline style setting --pw and --ph for the paper frame CSS. */
  private get _paperFrameStyle(): string {
    const [pw, ph] = pageMm(this._paperSize, this._orientation);
    return `--pw: ${pw}; --ph: ${ph}`;
  }

  /** iOS never fires beforeunload and Safari 18 link clicks are full page loads, so a pending save goes out when the page is hidden. */
  private _onPageHide = (e: Event) => {
    if (e.type === 'pagehide' || document.visibilityState === 'hidden') void this._flushSave(true);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('visibilitychange', this._onPageHide);
    window.addEventListener('pagehide', this._onPageHide);
  }

  override disconnectedCallback(): void {
    document.removeEventListener('visibilitychange', this._onPageHide);
    window.removeEventListener('pagehide', this._onPageHide);
    // Must run before map-view's disconnectedCallback removes its map, so the flush captures the live viewport.
    void this._flushSave();
    super.disconnectedCallback();
  }

  protected override async _loadMap() {
    await super._loadMap();
    // The auto-fit pads to the paper frame, so the saved paper must be set before the first _syncMap.
    const saved = parseExportSettings(this._map?.export_settings);
    if (saved?.paperSize) this._paperSize = saved.paperSize;
    if (saved?.orientation) this._orientation = saved.orientation;
  }

  protected override _onMapReady() {
    if (!this._moveListenerAdded) {
      const map = this._mapView?.map;
      if (map) {
        this._moveListenerAdded = true;
        // Only user gestures carry originalEvent; fitBounds, jumpTo and resize do not.
        map.on('moveend', (e) => {
          if (e.originalEvent && this._settingsLoaded) this._scheduleSave();
        });
        // A resize changes the framed area, so the saved viewSize must follow it.
        map.on('resize', () => {
          if (this._settingsLoaded) this._scheduleSave();
        });
      }
    }
    super._onMapReady();
  }

  protected override _fitPadding() {
    const el = this._mapView?.map?.getContainer();
    return el ? paperFramePadding(el.clientWidth, el.clientHeight, this._paperSize, this._orientation) : 60;
  }

  protected override async _syncMap() {
    await super._syncMap();
    // Restore after drawItems() so the saved viewport overrides the auto-fit.
    await this._restoreSettings();
  }

  private async _restoreSettings() {
    if (this._settingsLoaded || !this._map) return;
    this._settingsLoaded = true;
    await this._applyRestoredViewport(parseExportSettings(this._map.export_settings) ?? {});
  }

  private _scheduleSave() {
    if (!isAuthenticated() || !this._map || !canEditRole(this._map.role)) return;
    const c = this._mapView?.map?.getContainer();
    if (c && c.clientWidth > 0 && c.clientHeight > 0) this._viewSize = [c.clientWidth, c.clientHeight];
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => void this._flushSave(), 1000);
  }

  /** Settings to persist: the live viewport once restored, otherwise the saved one. */
  private _currentSettings(): ExportSettings {
    const settings: ExportSettings = {
      paperSize: this._paperSize,
      orientation: this._orientation,
    };

    const saved = parseExportSettings(this._map?.export_settings);
    const map = this._mapView?.map;
    if (map && this._settingsLoaded) {
      const center = map.getCenter();
      settings.center = [center.lng, center.lat];
      settings.zoom = map.getZoom();
      settings.bearing = map.getBearing();
      settings.pitch = map.getPitch();
      const c = map.getContainer();
      // A detached container measures 0, as during the disconnect flush.
      const viewSize: [number, number] | undefined = c.clientWidth > 0 && c.clientHeight > 0
        ? [c.clientWidth, c.clientHeight]
        : this._viewSize ?? saved?.viewSize;
      if (viewSize) settings.viewSize = viewSize;
    } else {
      if (saved?.center) settings.center = saved.center;
      if (saved?.zoom != null) settings.zoom = saved.zoom;
      if (saved?.bearing != null) settings.bearing = saved.bearing;
      if (saved?.pitch != null) settings.pitch = saved.pitch;
      if (saved?.viewSize) settings.viewSize = saved.viewSize;
    }
    return settings;
  }

  private async _putSettings(mapId: string, settings: ExportSettings, keepalive: boolean) {
    try {
      await updateMap(mapId, { export_settings: JSON.stringify(settings) }, keepalive);
    } catch { /* user may not have edit permission */ }
  }

  /**
   * Runs any pending debounced save now; resolves once every save started so far has settled.
   * @param keepalive - lets the save finish after the page unloads
   */
  private _flushSave(keepalive = false): Promise<void> {
    if (this._saveTimer !== undefined) {
      clearTimeout(this._saveTimer);
      this._saveTimer = undefined;
      if (this._map) {
        const mapId = this.mapId;
        const settings = this._currentSettings();
        const put = () => this._putSettings(mapId, settings, keepalive);
        // Chained so an older PUT cannot land after a newer one; on unload it must start now or it never sends.
        this._savePromise = keepalive ? put() : this._savePromise.then(put);
      }
    }
    return this._savePromise;
  }

  render() {
    const units = this._units.value;

    return html`
      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>

        <div class="paper-frame-container">
          <div class="paper-frame" style="${this._paperFrameStyle}"></div>
        </div>

        ${this._loading ? html`
          <div class="loading-container">
            <wa-spinner></wa-spinner>
          </div>
        ` : this._error ? html`
          <div class="overlay error-overlay">
            ${errorCallout(this._error)}
          </div>
        ` : html`
          <div class="overlay">
            <!-- wa-details renders its summary inside role="button", which hides headings from assistive tech. -->
            <h1 class="wa-visually-hidden">${this._map?.name ?? 'Untitled Trip'}</h1>
            <wa-details appearance="plain" ?open=${this._detailsOpen}>
              <div slot="summary" class="overlay-summary">
                <p class="trip-name">${this._map?.name ?? 'Untitled Trip'}</p>
                ${this._map?.family_name
                  ? html`<p class="family-name">${this._map.family_name}</p>`
                  : nothing}
              </div>

              <div class="wa-stack wa-gap-s">
                ${this._items.length > 0 ? html`
                  <div class="wa-cluster wa-gap-m">
                    <span class="wa-caption-xs">Items: <span class="wa-font-weight-semibold">${this._items.length}</span></span>
                    ${this._totalDistance ? html`
                      <span class="wa-caption-xs">Distance: <span class="wa-font-weight-semibold">${formatDistance(this._totalDistance, units)}</span></span>
                    ` : nothing}
                  </div>
                ` : nothing}

                <wa-divider></wa-divider>

                <wa-select
                  label="Paper size"
                  .value=${this._paperSize}
                  @change=${this._onPaperSizeChange}
                >
                  ${Object.entries(PAPER_SIZE_LABELS).map(
                    ([value, label]) => html`<wa-option value=${value}>${label}</wa-option>`,
                  )}
                </wa-select>

                <wa-radio-group
                  label="Orientation"
                  .value=${this._orientation}
                  @change=${this._onOrientationChange}
                >
                  <wa-radio appearance="button" value="landscape">
                    <wa-icon name="rectangle-wide"></wa-icon>
                    Landscape
                  </wa-radio>
                  <wa-radio appearance="button" value="portrait">
                    <wa-icon name="rectangle-vertical"></wa-icon>
                    Portrait
                  </wa-radio>
                </wa-radio-group>

                <wa-button
                  variant="brand"
                  class="continue-btn"
                  ?loading=${this._continuing}
                  ?disabled=${this._continuing}
                  @click=${this._onContinue}
                >
                  Continue
                  <wa-icon slot="end" name="arrow-right"></wa-icon>
                </wa-button>

                <wa-divider></wa-divider>

                <wa-button
                  size="s"
                  variant="neutral"
                  appearance="outlined"
                  href="/map/${this.mapId}"
                >
                  <wa-icon slot="start" name="arrow-left"></wa-icon>
                  Back to editor
                </wa-button>
              </div>
            </wa-details>
          </div>
        `}
      </div>
    `;
  }

  // ── Event handlers ────────────────────────────────────────────────────

  private _onPaperSizeChange(e: Event) {
    this._paperSize = fieldValue(e) as PaperSize;
    this._scheduleSave();
  }

  private _onOrientationChange(e: Event) {
    this._orientation = fieldValue(e) as Orientation;
    this._scheduleSave();
  }

  private async _onContinue() {
    this._continuing = true;
    try {
      await this._flushSave();
    } finally {
      this._continuing = false;
    }
    // The user may have left the page while the save was in flight.
    if (this.isConnected) navigateTo(`/export/${this.mapId}`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-preview-page': MapPreviewPage;
  }
}
