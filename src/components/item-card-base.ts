/**
 * Item card base — shared properties, item events and header for point-card
 * and route-card. Subclasses register their own element and styles.
 */
import { LitElement, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import type { Stop } from '../services/maps.js';

export class ItemCardBase<T extends Stop> extends LitElement {
  @property({ type: Object }) item!: T;
  @property({ type: Array }) allItems: Stop[] = [];
  @property({ type: Boolean }) readonly = false;
  @property({ type: Boolean }) highlighted = false;

  /** Dispatch `item-update` for one field of this item. */
  protected _fire(field: string, value: unknown) {
    this.dispatchEvent(
      new CustomEvent('item-update', {
        detail: { itemId: this.item.id, field, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Dispatch `item-update-batch` for fields that must be saved together. */
  protected _fireBatch(fields: Record<string, unknown>) {
    this.dispatchEvent(
      new CustomEvent('item-update-batch', {
        detail: { itemId: this.item.id, fields },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected _onDelete() {
    this.dispatchEvent(
      new CustomEvent('item-delete', {
        detail: { itemId: this.item.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Render the editable card header. item-list finds `.drag-handle` in the composed path.
   * @param title - text shown beside the drag handle
   * @param deleteLabel - accessible name and tooltip for the delete button
   * @returns the header template
   */
  protected _renderHeader(title: string, deleteLabel: string): TemplateResult {
    return html`
      <div class="card-header wa-cluster wa-align-items-center wa-gap-xs">
        <wa-button class="drag-handle" appearance="plain" size="s">
          <wa-icon name="bars" label="Reorder (drag or use arrow keys)"></wa-icon>
        </wa-button>
        <span class="item-title">${title}</span>
        <wa-button id="delete" class="delete-btn" appearance="plain" size="s" @click=${this._onDelete}>
          <wa-icon name="xmark" label=${deleteLabel}></wa-icon>
        </wa-button>
        <wa-tooltip for="delete">${deleteLabel}</wa-tooltip>
      </div>
    `;
  }
}
