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
import { contentPageStyles } from '../styles/content-page.js';
import { hiddenMapStyles } from '../styles/hidden-map.js';
import { navigateTo, signInUrl } from '../nav.js';
import { errorCallout } from '../components/ui.js';
import { isAuthenticated } from '../auth/auth-state.js';
import {
  renderMapCanvas,
  exportMap,
  paperFramePadding,
  type ExportFormat,
} from '../map/map-export.js';
import type { PaperSize, Orientation } from '../../shared/paper.js';
import { renderMockup } from '../map/mockup-renderer.js';
import { MapPageBase } from './map-page-base.js';
import { getUnits, onUnitsChange } from '../units.js';
import { StoreController } from '../utils/store-controller.js';
import { fieldChecked, fieldValue } from '../utils/form.js';
import { formatDistance } from '../utils/geo.js';
import { canEditRole, parseExportSettings, type ExportSettings } from '../../shared/types.js';
import '../components/map-view.js';

const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  pdf: 'Print-ready PDF',
  png: 'High-resolution image',
  jpeg: 'Compressed image',
};

@customElement('export-page')
export class ExportPage extends MapPageBase {
  @state() private _rendering = true;
  @state() private _renderError = '';
  @state() private _format: ExportFormat = 'png';
  @state() private _paperSize: PaperSize = 'letter';
  @state() private _orientation: Orientation = 'landscape';
  @state() private _includeTripDetails = true;
  @state() private _exporting = false;
  @state() private _exportError = '';

  /** Print render reused by every download; it must stay free of attribution and overlays. */
  private _mapCanvas: HTMLCanvasElement | null = null;
  private _mockupCanvas: HTMLCanvasElement | null = null;
  private _units = new StoreController(this, getUnits, onUnitsChange);

  static styles = [waUtilities, headingStyles, familyNameStyles, contentPageStyles('1100px'), hiddenMapStyles, css`
    h1 {
      margin-top: var(--wa-space-s);
      font-size: var(--wa-font-size-2xl);
    }

    .mockup-container {
      border-radius: var(--wa-border-radius-l);
      overflow: hidden;
      box-shadow: var(--wa-shadow-m);
    }

    .mockup-container canvas {
      display: block;
      width: 100%;
      height: auto;
    }

    .rendering-status {
      padding: var(--wa-space-3xl) 0;
    }

    .rendering-status wa-spinner {
      font-size: var(--wa-font-size-2xl);
    }
  `];

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** The map is a hidden render source, so its auto-fit jumps instead of animating. */
  protected override _animateFit = false;

  protected override _fitPadding() {
    const el = this._mapView?.map?.getContainer();
    return el ? paperFramePadding(el.clientWidth, el.clientHeight, this._paperSize, this._orientation) : 60;
  }

  protected override async _syncMap() {
    // Before the map data arrives there is nothing to render; _loadMap syncs again once it lands.
    if (this._loading || !this._map) return;
    // The auto-fit pads to the paper frame, so restore the saved paper before drawing.
    const settings: ExportSettings = parseExportSettings(this._map.export_settings) ?? {};
    if (settings.paperSize) this._paperSize = settings.paperSize;
    if (settings.orientation) this._orientation = settings.orientation;
    await super._syncMap();
    // Wait for the saved viewport to settle so the render captures it, not the auto-fit view.
    await this._applyRestoredViewport(settings);
    await this._renderPreview();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mapCanvas = null;
    this._mockupCanvas = null;
  }

  // ── Render preview ────────────────────────────────────────────────────

  private async _renderPreview() {
    const map = this._mapView?.map;
    if (!map || !this._mapController) return;

    this._rendering = true;
    this._renderError = '';

    try {
      const canvas = await renderMapCanvas(
        map,
        this._paperSize,
        this._orientation,
        this._mapController.markerFeatures,
        parseExportSettings(this._map?.export_settings)?.viewSize,
      );

      const mockupCanvas = document.createElement('canvas');
      mockupCanvas.setAttribute('role', 'img');
      mockupCanvas.setAttribute('aria-label', 'Map preview as a rolled poster');
      mockupCanvas.width = 1200;
      // Small headroom for the curl above the poster
      mockupCanvas.height = Math.round(1200 * canvas.height / canvas.width * 1.08);

      renderMockup(canvas, mockupCanvas);
      this._mapCanvas = canvas;
      this._mockupCanvas = mockupCanvas;
    } catch (err) {
      this._renderError = err instanceof Error ? err.message : 'Failed to render map preview';
    } finally {
      this._rendering = false;
    }
  }

  private _onMapError() {
    this._rendering = false;
    this._renderError = 'The map could not be loaded. Please try again.';
  }

  // ── Render ────────────────────────────────────────────────────────────

  render() {
    return html`
      <!-- Hidden map for rendering (always mounted so initialization starts early) -->
      <div class="hidden-map">
        <map-view @map-ready=${this._onMapReady} @map-error=${this._onMapError}></map-view>
      </div>

      ${this._loading ? html`
        <div class="rendering-status wa-stack wa-align-items-center wa-gap-m">
          <wa-spinner></wa-spinner>
          <p>Loading map...</p>
        </div>
      ` : this._error ? errorCallout(this._error) : html`
      <div>
        <wa-button
          size="s"
          variant="neutral"
          appearance="outlined"
          href="/preview/${this.mapId}"
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
        <div class="rendering-status wa-stack wa-align-items-center wa-gap-m">
          <wa-spinner></wa-spinner>
          <p class="wa-caption-xs">Rendering your map at print resolution...</p>
        </div>
      `;
    }

    if (this._renderError) {
      return errorCallout(this._renderError);
    }

    return html`
      <!-- Desktop: controls left, mockup right. Mobile: stacks, mockup first. -->
      <div class="wa-flank wa-align-items-start wa-gap-l" style="--flank-size: 280px; --content-percentage: 55%;">

        <!-- Controls panel (flanks on the left) -->
        <div class="wa-stack wa-gap-m">
          <!-- Stats -->
          ${this._items.length > 0 ? html`
            <div class="wa-cluster wa-gap-m">
              <span class="wa-caption-xs">Items: <span class="wa-font-weight-semibold">${this._items.length}</span></span>
              ${this._totalDistance ? html`
                <span class="wa-caption-xs">Distance: <span class="wa-font-weight-semibold">${formatDistance(this._totalDistance, this._units.value)}</span></span>
              ` : nothing}
            </div>
          ` : nothing}

          <!-- Format + Download -->
          <wa-radio-group
            label="Export format"
            hint=${FORMAT_DESCRIPTIONS[this._format]}
            .value=${this._format}
            @change=${this._onFormatChange}
          >
            <wa-radio appearance="button" value="pdf">PDF</wa-radio>
            <wa-radio appearance="button" value="png">PNG</wa-radio>
            <wa-radio appearance="button" value="jpeg">JPEG</wa-radio>
          </wa-radio-group>

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
            <wa-icon slot="start" name="arrow-down-to-line"></wa-icon>
            Download
          </wa-button>

          ${this._exportError ? errorCallout(this._exportError) : nothing}

          <!-- Order a Print -->
          ${this._canOrder ? html`
            <wa-divider></wa-divider>
            <wa-button variant="neutral" href="/order/${this.mapId}">
              <wa-icon slot="start" name="print"></wa-icon>
              Order a Print
            </wa-button>
            <span class="wa-caption-xs wa-text-center">Printed and shipped worldwide by Prodigi</span>
          ` : nothing}
        </div>

        <!-- Mockup preview (main content, stretches) -->
        <div class="mockup-container">${this._mockupCanvas}</div>

      </div>
    `;
  }

  // ── Event handlers ────────────────────────────────────────────────────

  private _onFormatChange(e: Event) {
    this._format = fieldValue(e) as ExportFormat;
  }

  private _onTripDetailsChange(e: Event) {
    this._includeTripDetails = fieldChecked(e);
  }

  private async _onDownload() {
    if (!isAuthenticated()) {
      navigateTo(signInUrl());
      return;
    }

    this._exporting = true;
    this._exportError = '';

    try {
      if (!this._mapCanvas || !this._map) throw new Error('Map not ready for export');
      await exportMap(
        this._mapCanvas,
        this._format,
        this._map,
        this._items,
        this._units.value,
        this._paperSize,
        this._orientation,
        this._routeDistances,
        this._includeTripDetails,
      );
    } catch (err) {
      this._exportError = err instanceof Error ? err.message : 'Export failed';
    } finally {
      this._exporting = false;
    }
  }

  /** Owners and editors can order; the order page picks a printable size. */
  private get _canOrder(): boolean {
    return !!this._map && isAuthenticated() && canEditRole(this._map.role);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'export-page': ExportPage;
  }
}
