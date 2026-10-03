/**
 * Point card — editable card for a standalone map marker.
 *
 * Shows an icon picker and name input once placed, or a location search while unplaced.
 * No travel mode (points are standalone, not part of a route).
 */
import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { PointStop } from '../services/maps.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { cardSharedStyles } from '../styles/card-shared.js';
import { isDraftCoord } from '../utils/geo.js';
import { fieldValue } from '../utils/form.js';
import { ItemCardBase } from './item-card-base.js';
import {
  renderEndpointEditor,
  renderEndpointDisplay,
  locationFields,
  type LocationSelectedEvent,
} from './endpoint-editor.js';

@customElement('point-card')
export class PointCard extends ItemCardBase<PointStop> {
  @state() private _editingLocation = false;

  private get _hasLocation(): boolean {
    return !isDraftCoord(this.item.latitude, this.item.longitude);
  }

  static styles = [waUtilities, cardSharedStyles, css`
    :host {
      display: block;
    }

    /* wa-card's outer element is the host, so style the element directly. */
    wa-card {
      border-left: var(--wa-border-width-l) solid var(--wa-color-brand-50);
    }
  `];

  render() {
    if (this.readonly) {
      return html`
        <wa-card appearance=${this.highlighted ? 'accent' : 'outlined'}>
          ${renderEndpointDisplay(this.item.icon, this.item.name)}
        </wa-card>
      `;
    }

    return html`
      <wa-card appearance=${this.highlighted ? 'accent' : 'outlined'}>
        ${this._renderHeader(this._hasLocation ? this.item.name : 'New Point', 'Delete point')}

        ${renderEndpointEditor({
          placed: this._hasLocation && !this._editingLocation,
          icon: this.item.icon,
          name: this.item.name,
          namePlaceholder: 'Point name',
          changeLabel: 'Change location',
          searchPlaceholder: 'Search for a place to mark...',
          allItems: this.allItems,
          onIconChange: this._onIconChange,
          onNameInput: this._onNameInput,
          onChangeRequest: () => { this._editingLocation = true; },
          onCancel: this._hasLocation ? () => { this._editingLocation = false; } : undefined,
          onLocationSelected: this._onLocationSelected,
        })}
      </wa-card>
    `;
  }

  private _onNameInput(e: Event) {
    const v = fieldValue(e);
    if (v.trim()) this._fire('name', v);
  }

  private _onIconChange(e: CustomEvent<string>) {
    this._fire('icon', e.detail);
  }

  private _onLocationSelected(e: LocationSelectedEvent) {
    e.stopPropagation();
    this._editingLocation = false;
    this._fireBatch(locationFields(e.detail));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'point-card': PointCard;
  }
}
