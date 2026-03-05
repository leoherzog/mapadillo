/**
 * Route card — editable card for an A→B route with travel mode.
 *
 * Shows start/end locations (with inline location search when unset),
 * travel mode picker, and distance display. Start uses the item's
 * lat/lng, end uses dest_lat/dest_lng.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Stop } from '../services/maps.js';
import type { GeocodingResult } from '../services/geocoding.js';
import './location-search.js';
import './travel-mode-picker.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord, formatDistance } from '../utils/geo.js';
import { TRAVEL_MODES } from '../config/travel-modes.js';

const MODE_COLORS: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.map((m) => [m.mode, m.cssColor]),
);

@customElement('route-card')
export class RouteCard extends LitElement {
  @property({ type: Object }) item!: Stop;
  @property({ type: Boolean }) readonly = false;
  @property({ type: Number }) distance = 0;
  @property() units = 'km';

  @state() private _editingStart = false;
  @state() private _editingEnd = false;

  static styles = [waUtilities, cardSharedStyles, css`
    :host {
      display: block;
    }

    wa-card::part(base) {
      border-left: 4px solid var(--border-color, var(--wa-color-neutral-300));
    }

    .endpoint {
      font-size: var(--wa-font-size-s);
      padding: var(--wa-space-3xs) 0;
    }

    .endpoint-label {
      font-size: var(--wa-font-size-xs);
      font-weight: 700;
      color: var(--wa-color-neutral-500);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .endpoint-name {
      font-weight: 600;
      font-size: var(--wa-font-size-s);
    }

    .endpoint-coords {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-neutral-400);
    }

    .mode-row {
      padding: var(--wa-space-3xs) 0;
    }

    .distance {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-neutral-500);
      margin-top: var(--wa-space-3xs);
    }

    .distance wa-icon {
      font-size: var(--wa-font-size-xs);
    }

    .change-btn {
      font-size: var(--wa-font-size-xs);
    }
  `];

  private get _hasStart(): boolean {
    return !isDraftCoord(this.item.latitude, this.item.longitude);
  }

  private get _hasEnd(): boolean {
    return this.item.dest_latitude != null && this.item.dest_longitude != null &&
      !isDraftCoord(this.item.dest_latitude, this.item.dest_longitude);
  }

  render() {
    const borderColor = MODE_COLORS[this.item.travel_mode ?? ''] ?? 'var(--wa-color-neutral-300)';

    if (this.readonly) {
      return html`
        <wa-card style="--border-color: ${borderColor}">
          ${this._renderEndpointDisplay('Start', this.item.name, this.item.latitude, this.item.longitude)}
          <div class="mode-row wa-cluster wa-justify-content-center">
            <travel-mode-picker .value=${this.item.travel_mode ?? ''} ?disabled=${true}></travel-mode-picker>
          </div>
          ${this._hasEnd
            ? this._renderEndpointDisplay('End', this.item.dest_name ?? '', this.item.dest_latitude!, this.item.dest_longitude!)
            : nothing}
          ${this.distance > 0 ? html`
            <div class="distance wa-cluster wa-gap-xs wa-align-items-center">
              ${formatDistance(this.distance, this.units)}
            </div>
          ` : nothing}
        </wa-card>
      `;
    }

    return html`
      <wa-card style="--border-color: ${borderColor}">
        <div class="wa-cluster wa-align-items-center wa-gap-xs" style="margin-bottom: var(--wa-space-3xs);">
          <wa-icon class="drag-handle" name="bars"></wa-icon>
          <wa-icon name="compass" style="color: ${borderColor}; font-size: 1rem;"></wa-icon>
          <span style="font-weight: 600; font-size: var(--wa-font-size-s); flex: 1;">Route</span>
          <wa-button class="delete-btn" appearance="plain" size="small" @click=${this._onDelete}>
            <wa-icon name="xmark" label="Delete route"></wa-icon>
          </wa-button>
        </div>

        <!-- Start -->
        <div class="endpoint">
          <span class="endpoint-label">Start</span>
          ${this._hasStart && !this._editingStart
            ? html`
              <div class="wa-cluster wa-align-items-center wa-gap-xs">
                <span class="endpoint-name">${this.item.name}</span>
                <wa-button class="change-btn" appearance="plain" size="small" @click=${() => { this._editingStart = true; }}>
                  <wa-icon name="pencil" label="Change start"></wa-icon>
                </wa-button>
              </div>
              <div class="endpoint-coords">${this.item.latitude.toFixed(5)}, ${this.item.longitude.toFixed(5)}</div>
            `
            : html`
              <location-search
                search-type="city"
                placeholder="Search start location..."
                @location-selected=${this._onStartSelected}
              ></location-search>
            `}
        </div>

        <!-- Travel mode -->
        <div class="mode-row wa-cluster wa-justify-content-center">
          <travel-mode-picker
            .value=${this.item.travel_mode ?? 'drive'}
            @mode-change=${this._onModeChange}
          ></travel-mode-picker>
        </div>

        <!-- End -->
        <div class="endpoint">
          <span class="endpoint-label">End</span>
          ${this._hasEnd && !this._editingEnd
            ? html`
              <div class="wa-cluster wa-align-items-center wa-gap-xs">
                <span class="endpoint-name">${this.item.dest_name ?? ''}</span>
                <wa-button class="change-btn" appearance="plain" size="small" @click=${() => { this._editingEnd = true; }}>
                  <wa-icon name="pencil" label="Change end"></wa-icon>
                </wa-button>
              </div>
              <div class="endpoint-coords">${this.item.dest_latitude!.toFixed(5)}, ${this.item.dest_longitude!.toFixed(5)}</div>
            `
            : html`
              <location-search
                search-type="city"
                placeholder="Search destination..."
                @location-selected=${this._onEndSelected}
              ></location-search>
            `}
        </div>

        ${this.distance > 0 ? html`
          <div class="distance wa-cluster wa-gap-xs wa-align-items-center">
            ${formatDistance(this.distance, this.units)}
          </div>
        ` : nothing}
      </wa-card>
    `;
  }

  private _renderEndpointDisplay(label: string, name: string, lat: number, lng: number) {
    return html`
      <div class="endpoint">
        <span class="endpoint-label">${label}</span>
        <div class="endpoint-name">${name}</div>
        <div class="endpoint-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
      </div>
    `;
  }

  private _onStartSelected(e: CustomEvent<GeocodingResult>) {
    e.stopPropagation();
    const { longitude, latitude, name } = e.detail;
    this._editingStart = false;
    // Fire individual field updates
    this._fireMultiple({ name, lat: latitude, lng: longitude });
  }

  private _onEndSelected(e: CustomEvent<GeocodingResult>) {
    e.stopPropagation();
    const { longitude, latitude, name } = e.detail;
    this._editingEnd = false;
    this._fireMultiple({ dest_name: name, dest_lat: latitude, dest_lng: longitude });
  }

  private _onModeChange(e: CustomEvent) {
    this._fire('travel_mode', e.detail);
  }

  private _fire(field: string, value: unknown) {
    this.dispatchEvent(
      new CustomEvent('item-update', {
        detail: { itemId: this.item.id, field, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Fire a batch of field updates for coordinate changes. */
  private _fireMultiple(fields: Record<string, unknown>) {
    this.dispatchEvent(
      new CustomEvent('item-update-batch', {
        detail: { itemId: this.item.id, fields },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onDelete() {
    this.dispatchEvent(
      new CustomEvent('item-delete', {
        detail: { itemId: this.item.id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'route-card': RouteCard;
  }
}
