/**
 * Export page — shows rendered map preview as a rolled-poster mockup,
 * with download (PDF/PNG/JPEG) and "Order a Print" options.
 *
 * Route: /export/:id
 */
import { html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { familyNameStyles } from '../styles/page-layout.js';
import { navigateTo, navClick } from '../nav.js';
import { isAuthenticated } from '../auth/auth-state.js';
import {
  renderToBlob,
  exportMap,
  triggerDownload,
  canvasToBlob,
  type ExportFormat,
  type PaperSize,
  type Orientation,
} from '../map/map-export.js';
import { renderMockup } from '../map/mockup-renderer.js';
import { PRINTABLE_SIZES } from '../../shared/products.js';
import { MapPageBase } from './map-page-base.js';
import type { MapView } from '../components/map-view.js';
import { getUnits, type Units } from '../units.js';
import { formatDistance, sanitizeFilename } from '../utils/geo.js';
import '../components/map-view.js';

interface ExportSettings {
  paperSize?: PaperSize;
  orientation?: Orientation;
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
}

const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  pdf: 'Print-ready PDF with trip details',
  png: 'High-resolution image',
  jpeg: 'Compressed image',
};

@customElement('export-page')
export class ExportPage extends MapPageBase {
  @state() private _rendering = true;
  @state() private _renderError = '';
  @state() private _mockupUrl = '';
  @state() private _format: ExportFormat = 'png';
  @state() private _paperSize: PaperSize = 'letter';
  @state() private _orientation: Orientation = 'landscape';
  @state() private _includeTripDetails = true;
  @state() private _exporting = false;
  @state() private _exportError = '';

  private _previewBlob: Blob | null = null;
  private _previewCanvas: HTMLCanvasElement | null = null;
  private _units: Units = getUnits();
  private _onUnitsChange = () => { this._units = getUnits(); };

  static styles = [waUtilities, headingStyles, familyNameStyles, css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: 1100px;
      margin: 0 auto;
      overflow-y: auto;
    }

    h1 {
      margin-top: var(--wa-space-s);
      font-size: var(--wa-font-size-2xl);
    }

    .mockup-container {
      border-radius: var(--wa-border-radius-l);
      overflow: hidden;
      box-shadow: var(--wa-shadow-m);
    }

    .mockup-container img {
      display: block;
      width: 100%;
      height: auto;
    }

    .rendering-status wa-spinner {
      font-size: 2rem;
    }

    .hint {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
    }

    .hint-center {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
      text-align: center;
    }

    .stat-value {
      font-size: var(--wa-font-size-xs);
      font-weight: var(--wa-font-weight-semibold);
    }

    .hidden-map {
      position: fixed;
      left: -99999px;
      top: -99999px;
      width: 1400px;
      height: 900px;
      visibility: hidden;
    }

    @media (max-width: 700px) {
      :host {
        padding: var(--wa-space-m) var(--wa-space-s);
      }
    }
  `];

  // ── Lifecycle ────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('units-change', this._onUnitsChange);
  }

  protected override async _syncMap() {
    await super._syncMap();
    this._restoreSettings();
    await this._waitForIdle();
    await this._renderPreview();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('units-change', this._onUnitsChange);
    if (this._mockupUrl) URL.revokeObjectURL(this._mockupUrl);
    this._previewBlob = null;
    this._previewCanvas = null;
  }

  // ── Settings restore ──────────────────────────────────────────────────

  private _restoreSettings() {
    if (!this._map) return;

    let settings: ExportSettings = {};
    try {
      const raw = this._map.export_settings;
      if (raw && raw !== '{}') settings = JSON.parse(raw);
    } catch { /* use defaults */ }

    if (settings.paperSize) this._paperSize = settings.paperSize;
    if (settings.orientation) this._orientation = settings.orientation;

    // Restore saved viewport (overrides the auto-fit from drawItems)
    this._restoreViewport(settings);
  }

  private _waitForIdle(): Promise<void> {
    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map) return Promise.resolve();

    return new Promise((resolve) => {
      const map = mapView.map!;
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };

      map.once('idle', done);
      // Timeout fallback — if the map is already idle, 'idle' won't fire again
      setTimeout(done, 3000);
    });
  }

  // ── Render preview ────────────────────────────────────────────────────

  private async _renderPreview() {
    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map || !this._mapController) return;

    this._rendering = true;
    this._renderError = '';

    try {
      // Render map at 300 DPI
      const blob = await renderToBlob(
        mapView.map,
        this._mapController.markerFeatures,
        this._paperSize,
        this._orientation,
      );
      this._previewBlob = blob;

      // Load as image for the mockup renderer
      const img = new Image();
      const blobUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load rendered image'));
        img.src = blobUrl;
      });

      // Generate the rolled-poster mockup
      const mockupCanvas = document.createElement('canvas');
      // Size mockup canvas based on image aspect ratio
      const mockupW = 1200;
      const imgAspect = img.naturalWidth / img.naturalHeight;
      // Small headroom for the curl above the poster
      const mockupH = Math.round(mockupW / imgAspect * 1.08);
      mockupCanvas.width = mockupW;
      mockupCanvas.height = mockupH;

      renderMockup(img, mockupCanvas);
      this._previewCanvas = document.createElement('canvas');
      this._previewCanvas.width = img.naturalWidth;
      this._previewCanvas.height = img.naturalHeight;
      const pctx = this._previewCanvas.getContext('2d')!;
      pctx.drawImage(img, 0, 0);

      URL.revokeObjectURL(blobUrl);

      // Convert mockup to blob URL for display
      const mockupBlob = await new Promise<Blob>((resolve, reject) => {
        mockupCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Mockup render failed'))),
          'image/png',
        );
      });

      if (this._mockupUrl) URL.revokeObjectURL(this._mockupUrl);
      this._mockupUrl = URL.createObjectURL(mockupBlob);
    } catch (err) {
      this._renderError = err instanceof Error ? err.message : 'Failed to render map preview';
    } finally {
      this._rendering = false;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    return html`
      <!-- Hidden map for rendering (always mounted so initialization starts early) -->
      <div class="hidden-map">
        <map-view @map-ready=${this._onMapReady}></map-view>
      </div>

      ${this._loading ? html`
        <div class="rendering-status">
          <wa-spinner></wa-spinner>
          <p>Loading map...</p>
        </div>
      ` : this._error ? html`
        <wa-callout variant="danger">
          <wa-icon slot="icon" name="circle-xmark"></wa-icon>
          ${this._error}
        </wa-callout>
      ` : html`
      <div class="header">
        <wa-button
          size="small"
          variant="neutral"
          appearance="outlined"
          href="/preview/${this.mapId}"
          @click=${navClick(`/preview/${this.mapId}`)}
        >
          <wa-icon slot="start" name="arrow-left"></wa-icon>
          Back to preview
        </wa-button>

        <h1>${this._map?.name ?? 'Untitled Trip'}</h1>
        ${this._map?.family_name
          ? html`<p class="family-name">${this._map.family_name}</p>`
          : nothing}
      </div>

      ${this._renderBody()}
    `}
    `;
  }

  private _renderBody() {
    if (this._rendering) {
      return html`
        <div class="rendering-status wa-stack wa-align-items-center wa-gap-m" style="padding: var(--wa-space-3xl) 0;">
          <wa-spinner></wa-spinner>
          <p class="hint">Rendering your map at print resolution...</p>
        </div>
      `;
    }

    if (this._renderError) {
      return html`
        <wa-callout variant="danger">
          <wa-icon slot="icon" name="circle-xmark"></wa-icon>
          ${this._renderError}
        </wa-callout>
      `;
    }

    return html`
      <!-- Desktop: controls left, mockup right. Mobile: stacks, mockup first. -->
      <div class="wa-flank wa-align-items-start wa-gap-l" style="--flank-size: 280px; --content-percentage: 55%;">

        <!-- Controls panel (flanks on the left) -->
        <div class="wa-stack wa-gap-m">
          <!-- Stats -->
          ${this._items.length > 0 ? html`
            <div class="wa-cluster wa-gap-m">
              <span class="hint">Items: <span class="stat-value">${this._items.length}</span></span>
              ${this._totalDistance ? html`
                <span class="hint">Distance: <span class="stat-value">${formatDistance(this._totalDistance, this._units)}</span></span>
              ` : nothing}
            </div>
          ` : nothing}

          <!-- Format + Download -->
          <wa-radio-group
            .value=${this._format}
            @change=${this._onFormatChange}
          >
            <wa-radio appearance="button" value="pdf">PDF</wa-radio>
            <wa-radio appearance="button" value="png">PNG</wa-radio>
            <wa-radio appearance="button" value="jpeg">JPEG</wa-radio>
          </wa-radio-group>

          <span class="hint">${FORMAT_DESCRIPTIONS[this._format]}</span>

          <wa-checkbox
            ?checked=${this._includeTripDetails}
            @change=${this._onTripDetailsChange}
          >Include trip details</wa-checkbox>

          <wa-button
            variant="brand"
            ?loading=${this._exporting}
            ?disabled=${this._exporting}
            @click=${this._onDownload}
          >
            <wa-icon slot="start" name="arrow-down-to-line" library="default"></wa-icon>
            Download
          </wa-button>

          ${this._exportError ? html`
            <wa-callout variant="danger">
              <wa-icon slot="icon" name="circle-xmark" library="default"></wa-icon>
              ${this._exportError}
            </wa-callout>
          ` : nothing}

          <!-- Order a Print -->
          ${this._canOrder ? html`
            <wa-divider></wa-divider>
            <wa-button variant="neutral" @click=${this._onOrderPrint}>
              <wa-icon slot="start" name="print"></wa-icon>
              Order a Print
            </wa-button>
            <span class="hint-center">Printed and shipped worldwide by Prodigi</span>
          ` : nothing}
        </div>

        <!-- Mockup preview (main content, stretches) -->
        <div class="mockup-container">
          <img
            src=${this._mockupUrl}
            alt="Map preview as a rolled poster"
          />
        </div>

      </div>
    `;
  }

  // ── Event handlers ────────────────────────────────────────────────────

  private _onFormatChange(e: Event) {
    this._format = (e.target as HTMLInputElement).value as ExportFormat;
  }

  private _onTripDetailsChange(e: Event) {
    this._includeTripDetails = (e.target as HTMLInputElement).checked;
  }

  private async _onDownload() {
    if (!isAuthenticated()) {
      navigateTo(`/sign-in?returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    this._exporting = true;
    this._exportError = '';

    try {
      // Fast path: direct download of the already-rendered blob (no trip details, no re-render)
      if (!this._includeTripDetails && this._format === 'png' && this._previewBlob) {
        triggerDownload(this._previewBlob, `${sanitizeFilename(this._map?.name ?? 'map')}.png`);
      } else if (!this._includeTripDetails && this._format === 'jpeg' && this._previewCanvas) {
        const blob = await canvasToBlob(this._previewCanvas, 'image/jpeg', 0.92);
        triggerDownload(blob, `${sanitizeFilename(this._map?.name ?? 'map')}.jpg`);
      } else {
        // Full export pipeline (handles all formats + trip details overlay)
        const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
        if (!mapView?.map || !this._mapController || !this._map) {
          throw new Error('Map not ready for export');
        }
        await exportMap(
          mapView.map,
          this._format,
          this._map,
          this._items,
          this._mapController.markerFeatures,
          this._units,
          this._paperSize,
          this._orientation,
          this._routeDistances,
          this._includeTripDetails,
        );
      }
    } catch (err) {
      this._exportError = err instanceof Error ? err.message : 'Export failed';
    } finally {
      this._exporting = false;
    }
  }

  private get _canOrder(): boolean {
    if (!this._map || !isAuthenticated()) return false;
    const role = this._map.role;
    if (role !== 'owner' && role !== 'editor') return false;
    return PRINTABLE_SIZES.has(this._paperSize);
  }

  private _onOrderPrint() {
    navigateTo(`/order/${this.mapId}`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'export-page': ExportPage;
  }
}
