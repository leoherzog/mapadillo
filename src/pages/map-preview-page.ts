/**
 * Map preview page — full-screen read-only map view with all stops and route lines.
 */
import { html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { navigateTo } from '../nav.js';
import { MapPageBase } from './map-page-base.js';
import '../components/map-view.js';

@customElement('map-preview-page')
export class MapPreviewPage extends MapPageBase {
  static styles = [waUtilities, css`
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

    .overlay {
      position: absolute;
      top: var(--wa-space-m);
      left: var(--wa-space-m);
      z-index: 10;
      background: var(--wa-color-surface-default);
      border-radius: var(--wa-border-radius-m);
      padding: var(--wa-space-s) var(--wa-space-m);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      max-width: 320px;
    }

    .overlay h2 {
      margin: 0;
      font-size: var(--wa-font-size-m);
      font-weight: 700;
      color: var(--wa-color-neutral-900);
    }

    .overlay .family-name {
      margin: 0;
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-neutral-500);
    }

    .overlay .actions {
      display: flex;
      gap: var(--wa-space-xs);
      margin-top: var(--wa-space-xs);
    }

    .loading-container {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10;
    }
  `];

  render() {
    return html`
      <div class="map-panel">
        <map-view @map-ready=${this._onMapReady}></map-view>

        ${this._loading ? html`
          <div class="overlay loading-container">
            <wa-spinner></wa-spinner>
          </div>
        ` : this._error ? html`
          <div class="overlay" style="padding: var(--wa-space-l);">
            <wa-callout variant="danger">
              <wa-icon slot="icon" name="circle-xmark"></wa-icon>
              ${this._error}
            </wa-callout>
          </div>
        ` : html`
          <div class="overlay">
            <h2>${this._map?.name ?? 'Untitled Trip'}</h2>
            ${this._map?.family_name
              ? html`<p class="family-name">${this._map.family_name}</p>`
              : ''}
            <div class="actions">
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                @click=${this._onBackToEditor}
              >
                <wa-icon slot="start" name="arrow-left"></wa-icon>
                Back to editor
              </wa-button>
              <wa-button
                size="small"
                variant="brand"
                @click=${this._onExport}
              >
                <wa-icon slot="start" name="file-export"></wa-icon>
                Export
              </wa-button>
            </div>
          </div>
        `}
      </div>
    `;
  }

  private _onBackToEditor() {
    navigateTo(`/map/${this.mapId}`);
  }

  private _onExport() {
    navigateTo(`/export/${this.mapId}`);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'map-preview-page': MapPreviewPage;
  }
}
