/**
 * Export options — lets users pick an export format and trigger a download.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import type { ExportFormat, PaperSize, Orientation } from '../map/map-export.js';

const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  pdf: 'Print-ready PDF with trip details',
  png: 'High-resolution image',
  jpeg: 'Compressed image',
};

const PAPER_SIZE_LABELS: Record<PaperSize, string> = {
  auto: 'Current view',
  letter: 'Letter (8.5 × 11")',
  a4: 'A4 (210 × 297 mm)',
  a3: 'A3 (297 × 420 mm)',
  tabloid: 'Tabloid (11 × 17")',
};

@customElement('export-options')
export class ExportOptions extends LitElement {
  @property() format: ExportFormat = 'pdf';
  @property() paperSize: PaperSize = 'auto';
  @property() orientation: Orientation = 'landscape';
  @property({ type: Boolean }) exporting = false;
  @property() error: string = '';

  static styles = [waUtilities, css`
    wa-card {
      max-width: 360px;
    }

    .heading {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      font-weight: 700;
      font-size: 1.1rem;
    }

    .format-description {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-neutral-500);
      margin-top: var(--wa-space-2xs);
    }

    wa-button[variant="brand"][size="large"] {
      width: 100%;
    }
  `];

  render() {
    return html`
      <wa-card>
        <div class="wa-stack wa-gap-m">
          <div class="heading">
            <wa-icon name="arrow-down-to-line" library="default"></wa-icon>
            Export Map
          </div>

          ${this.error ? html`
            <wa-callout variant="danger">
              <wa-icon slot="icon" name="circle-info" library="default"></wa-icon>
              ${this.error}
            </wa-callout>
          ` : nothing}

          <div class="wa-stack wa-gap-xs">
            <wa-radio-group
              .value=${this.format}
              @change=${this._onFormatChange}
            >
              <wa-radio appearance="button" value="pdf">PDF</wa-radio>
              <wa-radio appearance="button" value="png">PNG</wa-radio>
              <wa-radio appearance="button" value="jpeg">JPEG</wa-radio>
            </wa-radio-group>

            <div class="format-description">${FORMAT_DESCRIPTIONS[this.format]}</div>
          </div>

          <div class="wa-stack wa-gap-xs">
            <wa-select
              label="Paper size"
              .value=${this.paperSize}
              @wa-change=${this._onPaperSizeChange}
            >
              ${Object.entries(PAPER_SIZE_LABELS).map(
                ([value, label]) => html`<wa-option value=${value}>${label}</wa-option>`,
              )}
            </wa-select>

            ${this.paperSize !== 'auto' ? html`
              <wa-radio-group
                .value=${this.orientation}
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
          </div>

          <wa-button
            variant="brand"
            size="large"
            ?loading=${this.exporting}
            ?disabled=${this.exporting}
            @click=${this._onDownload}
          >
            <wa-icon slot="start" name="arrow-down-to-line" library="default"></wa-icon>
            Download
          </wa-button>
        </div>
      </wa-card>
    `;
  }

  private _onFormatChange(e: Event) {
    this.format = (e.target as HTMLInputElement).value as ExportFormat;
  }

  private _onPaperSizeChange(e: Event) {
    this.paperSize = (e.target as HTMLSelectElement).value as PaperSize;
  }

  private _onOrientationChange(e: Event) {
    this.orientation = (e.target as HTMLInputElement).value as Orientation;
  }

  private _onDownload() {
    this.dispatchEvent(new CustomEvent('export-request', {
      detail: {
        format: this.format,
        paperSize: this.paperSize,
        orientation: this.orientation,
      },
      bubbles: true,
      composed: true,
    }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'export-options': ExportOptions;
  }
}
