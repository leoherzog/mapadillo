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
import type { Stop } from '../services/maps.js';
import './point-card.js';
import './route-card.js';
import '@web.awesome.me/webawesome-pro/dist/components/animation/animation.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('item-list')
export class ItemList extends LitElement {
  @property({ type: Array }) items: Stop[] = [];
  @property({ type: Boolean }) readonly = false;
  @property({ type: Object }) distances: Map<string, number> = new Map();
  @property() units = 'km';

  @state() private _highlightedItemId = '';
  @state() private _draggedIndex = -1;
  @state() private _dropTargetIndex = -1;

  // Pointer-based drag state (not reactive — no re-render needed)
  private _pointerId = -1;
  private _dragClone: HTMLElement | null = null;
  private _dragStartY = 0;
  private _dragOriginalY = 0;

  // Window-level handlers bound once so we can add/remove consistently.
  private _onMoveBound = (e: PointerEvent) => this._onWindowMove(e);
  private _onUpBound = (e: PointerEvent) => this._onWindowUp(e);

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
      height: var(--wa-border-width-l);
      background: var(--wa-color-brand-50);
      border-radius: var(--wa-border-radius-s);
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
          <wa-icon slot="icon" name="map"></wa-icon>
          Add points or routes to build your map!
        </wa-callout>
      `;
    }

    return html`
      <div class="wa-stack wa-gap-3xs" @pointerdown=${this._onHostPointerDown}>
        ${this.items.map((item, i) => html`
          ${this._dropTargetIndex === i && this._draggedIndex !== i && this._draggedIndex !== i - 1
            ? html`<div class="drop-indicator"></div>`
            : nothing}
          <div
            class="card-wrapper ${this._draggedIndex === i ? 'dragging' : ''}"
            data-item-id=${item.id}
          >
            <wa-animation
              name="pulse"
              duration="600"
              iterations="2"
              ?play=${this._highlightedItemId === item.id}
              @wa-finish=${this._onHighlightFinish}
            >
              ${item.type === 'route'
                ? html`<route-card
                    .item=${item}
                    .allItems=${this.items}
                    ?readonly=${this.readonly}
                    ?highlighted=${this._highlightedItemId === item.id}
                    .distance=${this.distances.get(item.id) ?? 0}
                    .units=${this.units}
                  ></route-card>`
                : html`<point-card
                    .item=${item}
                    .allItems=${this.items}
                    ?readonly=${this.readonly}
                    ?highlighted=${this._highlightedItemId === item.id}
                  ></point-card>`}
            </wa-animation>
          </div>
          ${this._dropTargetIndex === this.items.length && i === this.items.length - 1
            ? html`<div class="drop-indicator"></div>`
            : nothing}
        `)}
      </div>
    `;
  }

  /** Scroll the card for the given item into view and briefly highlight it. */
  scrollToItem(itemId: string): void {
    this._highlightedItemId = itemId;

    // After Lit renders the play attribute, scroll the wrapper into view
    this.updateComplete.then(() => {
      const wrapper = this.shadowRoot?.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement | null;
      wrapper?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  private _onHighlightFinish() {
    this._highlightedItemId = '';
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._cleanupDrag();
  }

  /**
   * Event-delegated pointerdown handler at the host's rendered root.
   * Walks the composed path to find a `.drag-handle` (inside a card's shadow DOM)
   * and its owning `.card-wrapper`, then starts a drag.
   */
  private _onHostPointerDown(e: PointerEvent) {
    if (this.readonly) return;
    if (e.button !== 0) return;

    // composedPath() crosses shadow boundaries — so we can see the
    // `.drag-handle` inside point-card/route-card shadow DOMs.
    const path = e.composedPath();
    let handle: HTMLElement | null = null;
    for (const node of path) {
      if (node instanceof HTMLElement && node.classList?.contains('drag-handle')) {
        handle = node;
        break;
      }
    }
    if (!handle) return;

    // Find the wrapper in *our* shadow root that owns this handle.
    const wrappers = [...this.shadowRoot!.querySelectorAll('.card-wrapper')] as HTMLElement[];
    let wrapper: HTMLElement | null = null;
    let index = -1;
    for (const p of path) {
      if (p instanceof HTMLElement && p.classList?.contains('card-wrapper') && wrappers.includes(p)) {
        wrapper = p;
        index = wrappers.indexOf(p);
        break;
      }
    }
    if (!wrapper || index < 0) return;

    e.preventDefault();
    this._startDrag(e, index, wrapper);
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

    // Listen on window so we keep receiving moves/ups even if `items` re-renders
    // and the original wrapper is replaced mid-drag.
    window.addEventListener('pointermove', this._onMoveBound);
    window.addEventListener('pointerup', this._onUpBound);
    window.addEventListener('pointercancel', this._onUpBound);
  }

  private _onWindowMove(e: PointerEvent) {
    if (e.pointerId !== this._pointerId) return;
    this._onDragMove(e);
  }

  private _onWindowUp(e: PointerEvent) {
    if (e.pointerId !== this._pointerId) return;
    this._endDrag();
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
    window.removeEventListener('pointermove', this._onMoveBound);
    window.removeEventListener('pointerup', this._onUpBound);
    window.removeEventListener('pointercancel', this._onUpBound);

    // Remove clone
    this._dragClone?.remove();
    this._dragClone = null;

    if (this._draggedIndex >= 0 && this._dropTargetIndex >= 0) {
      let targetIndex = this._dropTargetIndex;
      if (targetIndex > this._draggedIndex) targetIndex--;
      if (targetIndex !== this._draggedIndex && targetIndex < this.items.length) {
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
    window.removeEventListener('pointermove', this._onMoveBound);
    window.removeEventListener('pointerup', this._onUpBound);
    window.removeEventListener('pointercancel', this._onUpBound);
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
