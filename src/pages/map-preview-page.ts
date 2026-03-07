/**
 * Map preview & export page — full-screen map with floating overlay for
 * trip info, stats, and export controls.
 */
import { html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { familyNameStyles } from '../styles/page-layout.js';
import { navigateTo } from '../nav.js';
import { isAuthenticated } from '../auth/auth-state.js';
import { formatDistance } from '../utils/geo.js';
import { exportMap, PAPER_SIZES, type ExportFormat, type PaperSize, type Orientation } from '../map/map-export.js';
import { MapPageBase } from './map-page-base.js';
import type { MapView } from '../components/map-view.js';
import '../components/map-view.js';

const PAPER_SIZE_LABELS: Record<PaperSize, string> = {
  auto: 'Current view',
  letter: 'Letter (8.5 \u00d7 11\u2033)',
  a4: 'A4 (210 \u00d7 297 mm)',
  a3: 'A3 (297 \u00d7 420 mm)',
  tabloid: 'Tabloid (11 \u00d7 17\u2033)',
};

@customElement('map-preview-page')
export class MapPreviewPage extends MapPageBase {
  @state() private _format: ExportFormat = 'pdf';
  @state() private _paperSize: PaperSize = 'auto';
  @state() private _orientation: Orientation = 'landscape';
  @state() private _exporting = false;
  @state() private _exportError = '';

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

    .overlay h2 {
      margin: 0;
      font-size: var(--wa-font-size-m);
      font-weight: var(--wa-font-weight-bold);
      color: var(--wa-color-text-normal);
    }

    .stat-label {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-xs);
    }

    .stat-value {
      font-size: var(--wa-font-size-xs);
      font-weight: var(--wa-font-weight-semibold);
    }

    wa-details::part(summary) {
      font-weight: var(--wa-font-weight-semibold);
    }

    .format-description {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }

    .download-btn {
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
      border: 2px dashed rgba(255, 255, 255, 0.8);
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
    const [w, h] = PAPER_SIZES[this._paperSize] ?? [1, 1];
    const pw = this._orientation === 'landscape' ? h : w;
    const ph = this._orientation === 'landscape' ? w : h;
    return `--pw: ${pw}; --ph: ${ph}`;
  }

  private static _formatDescriptions: Record<ExportFormat, string> = {
    pdf: 'Print-ready PDF with trip details',
    png: 'High-resolution image',
    jpeg: 'Compressed image',
  };

  render() {
    const units = this._map?.units ?? 'km';

    return html`
      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>

        ${this._paperSize !== 'auto' ? html`
          <div class="paper-frame-container">
            <div class="paper-frame" style="${this._paperFrameStyle}"></div>
          </div>
        ` : nothing}

        ${this._loading ? html`
          <div class="loading-container">
            <wa-spinner></wa-spinner>
          </div>
        ` : this._error ? html`
          <div class="overlay error-overlay">
            <wa-callout variant="danger">
              <wa-icon slot="icon" name="circle-xmark"></wa-icon>
              ${this._error}
            </wa-callout>
          </div>
        ` : html`
          <div class="overlay wa-stack wa-gap-s">
            <h2>${this._map?.name ?? 'Untitled Trip'}</h2>

            ${this._map?.family_name
              ? html`<p class="family-name">${this._map.family_name}</p>`
              : nothing}

            ${this._items.length > 0 ? html`
              <div class="wa-cluster wa-gap-m">
                <span class="stat-label">Items: <span class="stat-value">${this._items.length}</span></span>
                ${this._totalDistance ? html`
                  <span class="stat-label">Distance: <span class="stat-value">${formatDistance(this._totalDistance, units)}</span></span>
                ` : nothing}
              </div>
            ` : nothing}

            <wa-divider></wa-divider>

            <wa-details summary="Export">
              <div class="wa-stack wa-gap-s">
                <wa-radio-group
                  .value=${this._format}
                  @change=${this._onFormatChange}
                >
                  <wa-radio appearance="button" value="pdf">PDF</wa-radio>
                  <wa-radio appearance="button" value="png">PNG</wa-radio>
                  <wa-radio appearance="button" value="jpeg">JPEG</wa-radio>
                </wa-radio-group>

                <div class="format-description">
                  ${MapPreviewPage._formatDescriptions[this._format]}
                </div>

                <wa-select
                  label="Paper size"
                  .value=${this._paperSize}
                  @change=${this._onPaperSizeChange}
                >
                  ${Object.entries(PAPER_SIZE_LABELS).map(
                    ([value, label]) => html`<wa-option value=${value}>${label}</wa-option>`,
                  )}
                </wa-select>

                ${this._paperSize !== 'auto' ? html`
                  <wa-radio-group
                    .value=${this._orientation}
                    @change=${this._onOrientationChange}
                  >
                    <wa-radio appearance="button" value="landscape">
                      <wa-icon slot="start" name="rectangle-wide"></wa-icon>
                      Landscape
                    </wa-radio>
                    <wa-radio appearance="button" value="portrait">
                      <wa-icon slot="start" name="rectangle-vertical"></wa-icon>
                      Portrait
                    </wa-radio>
                  </wa-radio-group>
                ` : nothing}

                ${this._exportError ? html`
                  <wa-callout variant="danger">
                    <wa-icon slot="icon" name="circle-info" library="default"></wa-icon>
                    ${this._exportError}
                  </wa-callout>
                ` : nothing}

                <wa-button
                  variant="brand"
                  class="download-btn"
                  ?loading=${this._exporting}
                  ?disabled=${this._exporting}
                  @click=${this._onDownload}
                >
                  <wa-icon slot="start" name="arrow-down-to-line" library="default"></wa-icon>
                  Download
                </wa-button>
              </div>
            </wa-details>

            <wa-divider></wa-divider>

            <wa-button
              size="small"
              variant="neutral"
              appearance="outlined"
              @click=${this._onBackToEditor}
            >
              <wa-icon slot="start" name="arrow-left"></wa-icon>
              Back to editor
            </wa-button>
          </div>
        `}
      </div>
    `;
  }

  // ── Event handlers ────────────────────────────────────────────────────

  private _onFormatChange(e: Event) {
    this._format = (e.target as HTMLInputElement).value as ExportFormat;
  }

  private _onPaperSizeChange(e: Event) {
    this._paperSize = (e.target as HTMLSelectElement).value as PaperSize;
  }

  private _onOrientationChange(e: Event) {
    this._orientation = (e.target as HTMLInputElement).value as Orientation;
  }

  private async _onDownload() {
    if (!isAuthenticated()) {
      navigateTo(`/sign-in?returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    if (!this._map || !this._mapController) return;

    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map) return;

    this._exporting = true;
    this._exportError = '';

    try {
      await exportMap(
        mapView.map,
        this._format,
        this._map,
        this._items,
        this._mapController.markerFeatures,
        this._map.units ?? 'km',
        this._paperSize,
        this._orientation,
        this._routeDistances,
      );
    } catch (err) {
      this._exportError = err instanceof Error ? err.message : 'Export failed';
    } finally {
      this._exporting = false;
    }
  }

  private _onBackToEditor() {
    navigateTo(`/map/${this.mapId}`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-preview-page': MapPreviewPage;
  }
}
