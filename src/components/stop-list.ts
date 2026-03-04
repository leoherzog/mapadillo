/**
 * Stop list — renders an ordered list of stop-cards with drag-and-drop reordering.
 *
 * Fires `stops-reorder` with the new order of stop IDs after a drag-and-drop.
 * Bubbles `stop-update` and `stop-delete` events from child stop-cards.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Stop } from '../services/maps.js';
import './stop-card.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('stop-list')
export class StopList extends LitElement {
  @property({ type: Array }) stops: Stop[] = [];
  @state() private _draggedIndex = -1;
  @state() private _dropTargetIndex = -1;

  static styles = [waUtilities, css`
    :host {
      display: block;
    }

    .card-wrapper {
      position: relative;
    }

    .card-wrapper.dragging {
      opacity: 0.4;
    }

    .drop-indicator {
      height: 3px;
      background: var(--wa-color-brand-50, #ff6b00);
      border-radius: 2px;
      margin: -2px 0;
      pointer-events: none;
    }

    .empty {
      margin-top: var(--wa-space-m);
    }
  `];

  render() {
    if (this.stops.length === 0) {
      return html`
        <wa-callout class="empty">
          Search for places above to add your first stop!
        </wa-callout>
      `;
    }

    return html`
      <div class="wa-stack wa-gap-3xs">
        ${this.stops.map((stop, i) => html`
          ${this._dropTargetIndex === i && this._draggedIndex !== i && this._draggedIndex !== i - 1
            ? html`<div class="drop-indicator"></div>`
            : ''}
          <div
            class="card-wrapper ${this._draggedIndex === i ? 'dragging' : ''}"
            @dragstart=${(e: DragEvent) => this._onDragStart(e, i)}
            @dragover=${(e: DragEvent) => this._onDragOver(e, i)}
            @drop=${(e: DragEvent) => this._onDrop(e)}
            @dragend=${() => this._onDragEnd()}
          >
            <stop-card
              .stop=${stop}
              .index=${i}
              ?first=${i === 0}
            ></stop-card>
          </div>
          ${this._dropTargetIndex === this.stops.length && i === this.stops.length - 1
            ? html`<div class="drop-indicator"></div>`
            : ''}
        `)}
      </div>
    `;
  }

  private _onDragStart(e: DragEvent, index: number) {
    this._draggedIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    }
  }

  private _onDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    this._dropTargetIndex = e.clientY < midY ? index : index + 1;
  }

  private _onDrop(e: DragEvent) {
    e.preventDefault();
    if (this._draggedIndex < 0 || this._dropTargetIndex < 0) return;

    let targetIndex = this._dropTargetIndex;
    if (targetIndex > this._draggedIndex) targetIndex--;
    if (targetIndex === this._draggedIndex) {
      this._onDragEnd();
      return;
    }

    const order = this.stops.map((s) => s.id);
    const [moved] = order.splice(this._draggedIndex, 1);
    order.splice(targetIndex, 0, moved);

    this.dispatchEvent(
      new CustomEvent('stops-reorder', {
        detail: { order },
        bubbles: true,
        composed: true,
      }),
    );

    this._onDragEnd();
  }

  private _onDragEnd() {
    this._draggedIndex = -1;
    this._dropTargetIndex = -1;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stop-list': StopList;
  }
}
