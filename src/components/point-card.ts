/**
 * Point card — editable card for a standalone map marker.
 *
 * Shows icon picker, name input, label input, and coordinates.
 * No travel mode (points are standalone, not part of a route).
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Stop } from '../services/maps.js';
import type { GeocodingResult } from '../services/geocoding.js';
import './icon-picker.js';
import './location-search.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord } from '../utils/geo.js';

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

    wa-card {
      --spacing: var(--wa-space-xs) var(--wa-space-s);
    }

    wa-card::part(base) {
      border-left: 4px solid var(--wa-color-brand-50, #ff6b00);
    }

    .name-input {
      flex: 1;
      min-width: 0;
    }

    .label-row {
      margin-top: var(--wa-space-3xs);
    }

    .coords {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-neutral-400);
      margin-top: var(--wa-space-3xs);
    }

    .change-btn {
      font-size: var(--wa-font-size-xs);
    }
  `];

  render() {
    if (this.readonly) {
      return html`
        <wa-card>
          <div class="wa-cluster wa-align-items-center wa-gap-xs">
            <wa-icon name=${this.item.icon ?? 'location-dot'} style="color: var(--wa-color-brand-60);"></wa-icon>
            <span class="name-input" style="font-weight: 600; font-size: var(--wa-font-size-s);">${this.item.name}</span>
          </div>
          ${this.item.label ? html`<div class="label-row" style="font-size: var(--wa-font-size-s); color: var(--wa-color-neutral-600);">${this.item.label}</div>` : ''}
          <div class="coords">
            ${this.item.latitude.toFixed(5)}, ${this.item.longitude.toFixed(5)}
          </div>
        </wa-card>
      `;
    }

    return html`
      <wa-card>
        <div class="wa-cluster wa-align-items-center wa-gap-xs">
          <wa-icon class="drag-handle" name="bars"></wa-icon>
          <icon-picker
            .value=${this.item.icon ?? 'circle-plus'}
            @icon-change=${this._onIconChange}
          ></icon-picker>
          ${this._hasLocation ? html`
            <wa-input
              class="name-input"
              size="small"
              .value=${this.item.name}
              placeholder="Point name"
              @input=${this._onNameInput}
            ></wa-input>
          ` : html`
            <span class="name-input" style="font-weight: 600; font-size: var(--wa-font-size-s); color: var(--wa-color-neutral-400);">New Point</span>
          `}
          <wa-button class="delete-btn" appearance="plain" size="small" @click=${this._onDelete}>
            <wa-icon name="xmark" label="Delete point"></wa-icon>
          </wa-button>
        </div>
        ${this._hasLocation && !this._editingLocation ? html`
          <div class="label-row">
            <wa-input
              size="small"
              .value=${this.item.label ?? ''}
              placeholder="Add a label..."
              @input=${this._onLabelInput}
            ></wa-input>
          </div>
          <div class="coords wa-cluster wa-align-items-center wa-gap-xs">
            <span>${this.item.latitude.toFixed(5)}, ${this.item.longitude.toFixed(5)}</span>
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

  private _onLabelInput(e: Event) {
    this._fire('label', (e.target as HTMLInputElement).value);
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
