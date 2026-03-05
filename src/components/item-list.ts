/**
 * Item list — renders an ordered list of point-cards and route-cards
 * with pointer-based drag-and-drop reordering (works on both mouse and touch).
 *
 * Fires `items-reorder` with the new order of item IDs after a reorder.
 * Bubbles `item-update`, `item-update-batch`, and `item-delete` events
 * from child cards.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { PropertyValues } from 'lit';
import type { Stop } from '../services/maps.js';
import './point-card.js';
import './route-card.js';
import { waUtilities } from '../styles/wa-utilities.js';

const _dragBound = new WeakSet<HTMLElement>();

@customElement('item-list')
export class ItemList extends LitElement {
  @property({ type: Array }) items: Stop[] = [];
  @property({ type: Boolean }) readonly = false;
  @property({ type: Object }) distances: Map<string, number> = new Map();
  @property() units = 'km';

  @state() private _draggedIndex = -1;
  @state() private _dropTargetIndex = -1;

  // Pointer-based drag state (not reactive — no re-render needed)
  private _pointerId = -1;
  private _dragClone: HTMLElement | null = null;
  private _dragStartY = 0;
  private _dragOriginalY = 0;

  static styles = [waUtilities, css`
    :host {
      display: block;
    }

    .card-wrapper {
      position: relative;
    }

    .card-wrapper.dragging {
      opacity: 0.3;
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

    .drag-clone {
      position: fixed;
      z-index: 9999;
      pointer-events: none;
      opacity: 0.85;
      box-shadow: var(--wa-shadow-l);
      border-radius: var(--wa-border-radius-m);
      transform: rotate(1deg);
    }
  `];

  render() {
    if (this.items.length === 0) {
      return html`
        <wa-callout class="empty">
          Add points or routes to build your map!
        </wa-callout>
      `;
    }

    return html`
      <div class="wa-stack wa-gap-3xs">
        ${this.items.map((item, i) => html`
          ${this._dropTargetIndex === i && this._draggedIndex !== i && this._draggedIndex !== i - 1
            ? html`<div class="drop-indicator"></div>`
            : nothing}
          <div
            class="card-wrapper ${this._draggedIndex === i ? 'dragging' : ''}"
          >
            ${item.type === 'route'
              ? html`<route-card
                  .item=${item}
                  ?readonly=${this.readonly}
                  .distance=${this.distances.get(item.id) ?? 0}
                  .units=${this.units}
                ></route-card>`
              : html`<point-card
                  .item=${item}
                  ?readonly=${this.readonly}
                ></point-card>`}
          </div>
          ${this._dropTargetIndex === this.items.length && i === this.items.length - 1
            ? html`<div class="drop-indicator"></div>`
            : nothing}
        `)}
      </div>
    `;
  }

  protected firstUpdated(): void {
    this._setupPointerDrag();
  }

  protected updated(changed: PropertyValues): void {
    // Only re-attach drag listeners when items or readonly change (new DOM nodes)
    if (changed.has('items') || changed.has('readonly')) {
      this._setupPointerDrag();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanupDrag();
  }

  private _setupPointerDrag() {
    if (this.readonly) return;

    const handles = this.shadowRoot!.querySelectorAll('.card-wrapper');
    handles.forEach((wrapper, index) => {
      // Find the drag handle (bars icon) inside the card's shadow DOM
      const card = wrapper.querySelector('point-card, route-card');
      if (!card?.shadowRoot) return;

      const handle = card.shadowRoot.querySelector('.drag-handle') as HTMLElement | null;
      if (!handle) return;

      // Avoid duplicate listeners by marking
      if (_dragBound.has(handle)) return;
      _dragBound.add(handle);

      handle.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return; // left/primary button only
        e.preventDefault();
        this._startDrag(e, index, wrapper as HTMLElement);
      });
    });
  }

  private _startDrag(e: PointerEvent, index: number, wrapper: HTMLElement) {
    this._draggedIndex = index;
    this._pointerId = e.pointerId;
    this._dragStartY = e.clientY;

    // Clone the wrapper for the floating visual
    const rect = wrapper.getBoundingClientRect();
    this._dragOriginalY = rect.top;

    const clone = wrapper.cloneNode(true) as HTMLElement;
    clone.classList.add('drag-clone');
    clone.style.width = `${rect.width}px`;
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    this.shadowRoot!.appendChild(clone);
    this._dragClone = clone;

    // Capture pointer for move/up events
    wrapper.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== this._pointerId) return;
      this._onDragMove(ev);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== this._pointerId) return;
      wrapper.removeEventListener('pointermove', onMove);
      wrapper.removeEventListener('pointerup', onUp);
      wrapper.removeEventListener('pointercancel', onUp);
      this._endDrag();
    };

    wrapper.addEventListener('pointermove', onMove);
    wrapper.addEventListener('pointerup', onUp);
    wrapper.addEventListener('pointercancel', onUp);
  }

  private _onDragMove(e: PointerEvent) {
    // Move the clone
    if (this._dragClone) {
      const deltaY = e.clientY - this._dragStartY;
      this._dragClone.style.top = `${this._dragOriginalY + deltaY}px`;
    }

    // Calculate drop target based on pointer Y vs sibling bounding rects
    const wrappers = this.shadowRoot!.querySelectorAll('.card-wrapper');
    let target = this.items.length; // default: end of list
    for (let i = 0; i < wrappers.length; i++) {
      const rect = wrappers[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        target = i;
        break;
      }
    }
    this._dropTargetIndex = target;
  }

  private _endDrag() {
    // Remove clone
    this._dragClone?.remove();
    this._dragClone = null;

    if (this._draggedIndex >= 0 && this._dropTargetIndex >= 0) {
      let targetIndex = this._dropTargetIndex;
      if (targetIndex > this._draggedIndex) targetIndex--;
      if (targetIndex !== this._draggedIndex) {
        const order = this.items.map((s) => s.id);
        const [moved] = order.splice(this._draggedIndex, 1);
        order.splice(targetIndex, 0, moved);

        this.dispatchEvent(
          new CustomEvent('items-reorder', {
            detail: { order },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }

    this._draggedIndex = -1;
    this._dropTargetIndex = -1;
    this._pointerId = -1;
  }

  private _cleanupDrag() {
    this._dragClone?.remove();
    this._dragClone = null;
    this._draggedIndex = -1;
    this._dropTargetIndex = -1;
    this._pointerId = -1;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'item-list': ItemList;
  }
}
