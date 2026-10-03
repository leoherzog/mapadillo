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
import { html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { RouteStop } from '../services/maps.js';
import './travel-mode-picker.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord, placedDest, formatDistance } from '../utils/geo.js';
import { fieldValue } from '../utils/form.js';
import { TRAVEL_MODES } from '../../shared/travel-modes.js';
import type { Units } from '../../shared/units.js';
import { ItemCardBase } from './item-card-base.js';
import {
  renderEndpointEditor,
  renderEndpointDisplay,
  locationFields,
  type LocationSelectedEvent,
} from './endpoint-editor.js';

@customElement('route-card')
export class RouteCard extends ItemCardBase<RouteStop> {
  @property({ type: Number }) distance = 0;
  @property() units: Units = 'km';

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

    .mode-row {
      padding: var(--wa-space-3xs) 0;
    }

    .distance {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
      margin-top: var(--wa-space-3xs);
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
    return placedDest(this.item) !== null;
  }

  render() {
    const borderColor = TRAVEL_MODES.find((m) => m.mode === this.item.travel_mode)?.cssColor ?? 'var(--wa-color-surface-border)';

    if (this.readonly) {
      return html`
        <wa-card appearance=${this.highlighted ? 'accent' : 'outlined'} style="--border-color: ${borderColor}">
          ${this._hasStart
            ? html`<div class="endpoint">${renderEndpointDisplay(this.item.icon, this.item.name)}</div>`
            : nothing}
          <div class="mode-row wa-cluster wa-justify-content-center">
            <travel-mode-picker .value=${this.item.travel_mode ?? ''} ?disabled=${true}></travel-mode-picker>
          </div>
          ${this._hasEnd
            ? html`<div class="endpoint">${renderEndpointDisplay(this.item.dest_icon, this.item.dest_name ?? '')}</div>`
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
        ${this._renderHeader(this._title, 'Delete route')}

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
            onCancel: this._hasStart ? () => { this._editingStart = false; } : undefined,
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
            onCancel: this._hasEnd ? () => { this._editingEnd = false; } : undefined,
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

  private _onStartSelected(e: LocationSelectedEvent) {
    e.stopPropagation();
    this._editingStart = false;
    this._fireBatch(locationFields(e.detail));
  }

  private _onEndSelected(e: LocationSelectedEvent) {
    e.stopPropagation();
    this._editingEnd = false;
    this._fireBatch(locationFields(e.detail, 'dest_'));
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
    const v = fieldValue(e);
    if (v.trim()) this._fire('name', v);
  }

  private _onEndNameInput(e: Event) {
    this._fire('dest_name', fieldValue(e));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'route-card': RouteCard;
  }
}
