/**
 * Point card — editable card for a standalone map marker.
 *
 * Shows icon picker, name input, and coordinates.
 * No travel mode (points are standalone, not part of a route).
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Stop } from '../services/maps.js';
import type { GeocodingResult } from '../services/geocoding.js';
import './icon-picker.js';
import './location-search.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord, formatCoords } from '../utils/geo.js';

@customElement('point-card')
export class PointCard extends LitElement {
  @property({ type: Object }) item!: Stop;
  @property({ type: Boolean }) readonly = false;

  @state() private _editingLocation = false;

  private get _hasLocation(): boolean {
    return !isDraftCoord(this.item.latitude, this.item.longitude);
  }

  static styles = [waUtilities, cardSharedStyles, css`
    :host {
      display: block;
    }

    wa-card::part(base) {
      border-left: 4px solid var(--wa-color-brand-50);
    }

    .name-input {
      flex: 1;
      min-width: 0;
    }

    .coords {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
      margin-top: var(--wa-space-3xs);
    }

    .point-icon {
      color: var(--wa-color-brand-60);
    }

    .point-name {
      font-weight: var(--wa-font-weight-semibold);
      font-size: var(--wa-font-size-s);
    }

    .card-header {
      margin-bottom: var(--wa-space-3xs);
    }
  `];

  render() {
    if (this.readonly) {
      return html`
        <wa-card>
          <div class="wa-cluster wa-align-items-center wa-gap-xs">
            <wa-icon class="point-icon" name=${this.item.icon ?? 'location-dot'}></wa-icon>
            <span class="name-input point-name">${this.item.name}</span>
          </div>
          ${!isDraftCoord(this.item.latitude, this.item.longitude) ? html`
            <div class="coords">
              ${formatCoords(this.item.latitude, this.item.longitude)}
            </div>
          ` : nothing}
        </wa-card>
      `;
    }

    return html`
      <wa-card>
        <div class="wa-cluster wa-align-items-center wa-gap-xs card-header">
          <wa-icon class="drag-handle" name="bars"></wa-icon>
          <span class="name-input point-name">${this._hasLocation ? this.item.name : 'New Point'}</span>
          <wa-button class="delete-btn" appearance="plain" size="small" @click=${this._onDelete}>
            <wa-icon name="xmark" label="Delete point"></wa-icon>
          </wa-button>
        </div>

        ${this._hasLocation && !this._editingLocation ? html`
          <div class="wa-cluster wa-align-items-center wa-gap-xs">
            <icon-picker
              .value=${this.item.icon ?? 'circle-plus'}
              @icon-change=${this._onIconChange}
            ></icon-picker>
            <wa-input
              class="name-input"
              size="small"
              .value=${this.item.name}
              placeholder="Point name"
              @input=${this._onNameInput}
            ></wa-input>
          </div>
          <div class="coords wa-cluster wa-align-items-center wa-gap-xs">
            <span>${formatCoords(this.item.latitude, this.item.longitude)}</span>
            <wa-button class="change-btn" appearance="plain" size="small" @click=${() => { this._editingLocation = true; }}>
              <wa-icon name="pencil" label="Change location"></wa-icon>
            </wa-button>
          </div>
        ` : html`
          <location-search
            placeholder="Search for a place to mark..."
            @location-selected=${this._onLocationSelected}
          ></location-search>
        `}
      </wa-card>
    `;
  }

  private _fire(field: string, value: string) {
    this.dispatchEvent(
      new CustomEvent('item-update', {
        detail: { itemId: this.item.id, field, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onNameInput(e: Event) {
    this._fire('name', (e.target as HTMLInputElement).value);
  }

  private _onIconChange(e: CustomEvent) {
    this._fire('icon', e.detail);
  }

  private _onLocationSelected(e: CustomEvent<GeocodingResult>) {
    e.stopPropagation();
    const { longitude, latitude, name } = e.detail;
    this._editingLocation = false;
    this.dispatchEvent(
      new CustomEvent('item-update-batch', {
        detail: { itemId: this.item.id, fields: { name, lat: latitude, lng: longitude } },
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
    'point-card': PointCard;
  }
}
