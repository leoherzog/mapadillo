/**
 * Route card — editable card for an A→B route with travel mode.
 *
 * Shows start/end locations (with inline location search when unset),
 * travel mode picker, and distance display. Start uses the item's
 * lat/lng, end uses dest_lat/dest_lng.
 *
 * Each endpoint has an icon picker (like points). Selecting the
 * "none" icon removes the marker and label from the map.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { RouteStop, Stop } from '../services/maps.js';
import { DEFAULT_ICON } from '../../shared/icons.js';
import './travel-mode-picker.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord, formatDistance } from '../utils/geo.js';
import { fieldValue } from '../utils/form.js';
import { CSS_COLOR_BY_MODE } from '../config/travel-modes.js';
import { renderEndpointEditor, type LocationSelectedEvent } from './endpoint-editor.js';

@customElement('route-card')
export class RouteCard extends LitElement {
  @property({ type: Object }) item!: RouteStop;
  @property({ type: Array }) allItems: Stop[] = [];
  @property({ type: Boolean }) readonly = false;
  @property({ type: Boolean }) highlighted = false;
  @property({ type: Number }) distance = 0;
  @property() units = 'km';

  @state() private _editingStart = false;
  @state() private _editingEnd = false;

  static styles = [waUtilities, cardSharedStyles, css`
    :host {
      display: block;
    }

    /* wa-card's outer element is the host, so style the element directly. */
    wa-card {
      border-left: var(--wa-border-width-l) solid var(--border-color, var(--wa-color-surface-border));
    }

    .endpoint {
      font-size: var(--wa-font-size-s);
      padding: var(--wa-space-3xs) 0;
    }

    .endpoint-name {
      font-weight: var(--wa-font-weight-semibold);
      font-size: var(--wa-font-size-s);
    }

    .mode-row {
      padding: var(--wa-space-3xs) 0;
    }

    .distance {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
      margin-top: var(--wa-space-3xs);
    }

    .header-row {
      margin-bottom: var(--wa-space-3xs);
    }

    .route-title {
      font-weight: var(--wa-font-weight-semibold);
      font-size: var(--wa-font-size-s);
      flex: 1;
    }

    .endpoint-icon {
      color: var(--wa-color-brand-60);
    }
  `];

  private get _title(): string {
    const start = this._hasStart ? this.item.name : '…';
    const end = this._hasEnd ? (this.item.dest_name ?? '…') : '…';
    return `${start} to ${end}`;
  }

  private get _hasStart(): boolean {
    return !isDraftCoord(this.item.latitude, this.item.longitude);
  }

  private get _hasEnd(): boolean {
    return this.item.dest_latitude != null && this.item.dest_longitude != null &&
      !isDraftCoord(this.item.dest_latitude, this.item.dest_longitude);
  }

  render() {
    const borderColor = CSS_COLOR_BY_MODE[this.item.travel_mode ?? ''] ?? 'var(--wa-color-surface-border)';

    if (this.readonly) {
      return html`
        <wa-card appearance=${this.highlighted ? 'accent' : 'outlined'} style="--border-color: ${borderColor}">
          ${this._hasStart
            ? this._renderEndpointDisplay(this.item.icon, this.item.name)
            : nothing}
          <div class="mode-row wa-cluster wa-justify-content-center">
            <travel-mode-picker .value=${this.item.travel_mode ?? ''} ?disabled=${true}></travel-mode-picker>
          </div>
          ${this._hasEnd
            ? this._renderEndpointDisplay(this.item.dest_icon, this.item.dest_name ?? '')
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
      <wa-card appearance=${this.highlighted ? 'accent' : 'outlined'} style="--border-color: ${borderColor}">
        <div class="header-row wa-cluster wa-align-items-center wa-gap-xs">
          <wa-icon class="drag-handle" name="bars"></wa-icon>
          <span class="route-title">${this._title}</span>
          <wa-button id="delete-route" class="delete-btn" appearance="plain" size="small" @click=${this._onDelete}>
            <wa-icon name="xmark" label="Delete route"></wa-icon>
          </wa-button>
          <wa-tooltip for="delete-route">Delete route</wa-tooltip>
        </div>

        <!-- Start -->
        <div class="endpoint">
          ${renderEndpointEditor({
            placed: this._hasStart && !this._editingStart,
            icon: this.item.icon,
            name: this.item.name,
            namePlaceholder: 'Start name',
            changeLabel: 'Change start',
            searchPlaceholder: 'Search start location...',
            allItems: this.allItems,
            onIconChange: this._onStartIconChange,
            onNameInput: this._onStartNameInput,
            onChangeRequest: () => { this._editingStart = true; },
            onLocationSelected: this._onStartSelected,
          })}
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
          ${renderEndpointEditor({
            placed: this._hasEnd && !this._editingEnd,
            icon: this.item.dest_icon,
            name: this.item.dest_name ?? '',
            namePlaceholder: 'End name',
            changeLabel: 'Change end',
            searchPlaceholder: 'Search destination...',
            allItems: this.allItems,
            onIconChange: this._onEndIconChange,
            onNameInput: this._onEndNameInput,
            onChangeRequest: () => { this._editingEnd = true; },
            onLocationSelected: this._onEndSelected,
          })}
        </div>

        ${this.distance > 0 ? html`
          <div class="distance wa-cluster wa-gap-xs wa-align-items-center">
            ${formatDistance(this.distance, this.units)}
          </div>
        ` : nothing}
      </wa-card>
    `;
  }

  private _renderEndpointDisplay(icon: string | null, name: string) {
    return html`
      <div class="endpoint">
        <div class="wa-cluster wa-align-items-center wa-gap-xs">
          <wa-icon class="endpoint-icon" name=${icon ?? DEFAULT_ICON}></wa-icon>
          <span class="endpoint-name">${name}</span>
        </div>
      </div>
    `;
  }

  private _onStartSelected(e: LocationSelectedEvent) {
    e.stopPropagation();
    const { longitude, latitude, name, icon } = e.detail;
    this._editingStart = false;
    const fields: Record<string, unknown> = { name, lat: latitude, lng: longitude };
    if (icon) fields.icon = icon;
    this._fireMultiple(fields);
  }

  private _onEndSelected(e: LocationSelectedEvent) {
    e.stopPropagation();
    const { longitude, latitude, name, icon } = e.detail;
    this._editingEnd = false;
    const fields: Record<string, unknown> = { dest_name: name, dest_lat: latitude, dest_lng: longitude };
    if (icon) fields.dest_icon = icon;
    this._fireMultiple(fields);
  }

  private _onModeChange(e: CustomEvent) {
    this._fire('travel_mode', e.detail);
  }

  private _onStartIconChange(e: CustomEvent<string>) {
    this._fire('icon', e.detail);
  }

  private _onEndIconChange(e: CustomEvent<string>) {
    this._fire('dest_icon', e.detail);
  }

  private _onStartNameInput(e: Event) {
    this._fire('name', fieldValue(e));
  }

  private _onEndNameInput(e: Event) {
    this._fire('dest_name', fieldValue(e));
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
