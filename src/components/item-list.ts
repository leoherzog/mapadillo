/**
 * Item list — renders an ordered list of point-cards and route-cards
 * with pointer-based drag-and-drop reordering (works on both mouse and touch)
 * and arrow-key reordering from a focused drag handle.
 *
 * Fires `items-reorder` with the new order of item IDs after a reorder.
 * Bubbles `item-update`, `item-update-batch`, and `item-delete` events
 * from child cards.
 */
import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { Stop } from '../services/maps.js';
import type { Units } from '../../shared/units.js';
import './point-card.js';
import './route-card.js';
import type { PointCard } from './point-card.js';
import type { RouteCard } from './route-card.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('item-list')
export class ItemList extends LitElement {
  @property({ type: Array }) items: Stop[] = [];
  @property({ type: Boolean }) readonly = false;
  @property({ type: Object }) distances: Map<string, number> = new Map();
  @property() units: Units = 'km';

  @state() private _highlightedItemId = '';
  @state() private _draggedIndex = -1;
  @state() private _dropTargetIndex = -1;

  // Pointer-based drag state (not reactive — no re-render needed)
  private _pointerId = -1;
  private _dragClone: HTMLElement | null = null;
  private _dragStartY = 0;
  private _dragOriginalY = 0;

  /** prefers-reduced-motion, sampled in scrollToItem; skips the pulse and smooth scroll. */
  private _reduceMotion = false;
  private _highlightTimer?: ReturnType<typeof setTimeout>;
  /** Item whose drag handle regains focus once a keyboard reorder re-renders the list. */
  private _pendingFocusId = '';

  // Window-level handlers keep receiving events if `items` re-renders mid-drag.
  private _onWindowMove = (e: PointerEvent) => { if (e.pointerId === this._pointerId) this._onDragMove(e); };
  private _onWindowUp = (e: PointerEvent) => { if (e.pointerId === this._pointerId) this._endDrag(); };
  private _onWindowCancel = (e: PointerEvent) => { if (e.pointerId === this._pointerId) this._cleanupDrag(); };

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
      <div class="wa-stack wa-gap-3xs" @pointerdown=${this._onHostPointerDown} @keydown=${this._onHostKeyDown}>
        ${repeat(this.items, (item) => item.id, (item, i) => html`
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
              ?play=${!this._reduceMotion && this._highlightedItemId === item.id}
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

  protected updated(changed: PropertyValues<this>): void {
    if (!changed.has('items') || !this._pendingFocusId) return;
    const id = this._pendingFocusId;
    this._pendingFocusId = '';
    const card = this.shadowRoot
      ?.querySelector(`[data-item-id="${id}"]`)
      ?.querySelector<PointCard | RouteCard>('point-card, route-card');
    void card?.updateComplete.then(() => {
      card.shadowRoot?.querySelector<HTMLElement>('.drag-handle')?.focus();
    });
  }

  /** Scroll the card for the given item into view and briefly highlight it. */
  scrollToItem(itemId: string): void {
    this._reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (this._reduceMotion) {
      // wa-finish never fires when the pulse does not play; 1200ms matches 2 × 600ms.
      clearTimeout(this._highlightTimer);
      this._highlightTimer = setTimeout(() => { this._highlightedItemId = ''; }, 1200);
    }
    this._highlightedItemId = itemId;

    // After Lit renders the play attribute, scroll the wrapper into view
    this.updateComplete.then(() => {
      const wrapper = this.shadowRoot?.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement | null;
      wrapper?.scrollIntoView({ behavior: this._reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    });
  }

  private _onHighlightFinish() {
    this._highlightedItemId = '';
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._highlightTimer);
    this._cleanupDrag();
  }

  /**
   * Find the `.drag-handle` in an event's composed path and the `.card-wrapper` in our shadow root that owns it.
   * @param e - an event dispatched from inside a card
   * @returns the wrapper and its item index, or null when the event did not come from a handle
   */
  private _findHandle(e: Event): { wrapper: HTMLElement; index: number } | null {
    // composedPath() crosses shadow boundaries, so it reaches the handle inside a card's shadow DOM.
    const path = e.composedPath();
    if (!path.some((node) => node instanceof HTMLElement && node.classList.contains('drag-handle'))) return null;

    const wrappers = [...this.shadowRoot!.querySelectorAll<HTMLElement>('.card-wrapper')];
    for (const node of path) {
      if (!(node instanceof HTMLElement)) continue;
      const index = wrappers.indexOf(node);
      if (index >= 0) return { wrapper: node, index };
    }
    return null;
  }

  private _onHostPointerDown(e: PointerEvent) {
    if (this.readonly) return;
    if (this._pointerId !== -1) return;
    if (e.button !== 0) return;

    const hit = this._findHandle(e);
    if (!hit) return;

    e.preventDefault();
    this._startDrag(e, hit.index, hit.wrapper);
  }

  /** ArrowUp / ArrowDown on a focused drag handle moves its item one place. */
  private _onHostKeyDown(e: KeyboardEvent) {
    if (this.readonly) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

    const hit = this._findHandle(e);
    if (!hit) return;
    const to = hit.index + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= this.items.length) return;

    e.preventDefault();
    const order = this.items.map((s) => s.id);
    [order[hit.index], order[to]] = [order[to], order[hit.index]];
    // Focus is restored in updated(): the list re-renders only after the page applies the new order.
    this._pendingFocusId = this.items[hit.index].id;
    this._dispatchReorder(order);
  }

  private _startDrag(e: PointerEvent, index: number, wrapper: HTMLElement) {
    this._draggedIndex = index;
    this._pointerId = e.pointerId;
    this._dragStartY = e.clientY;

    // Clone the wrapper for the floating visual
    const rect = wrapper.getBoundingClientRect();
    this._dragOriginalY = rect.top;

    const clone = wrapper.cloneNode(true) as HTMLElement;
    clone.classList.replace('card-wrapper', 'drag-clone');
    // Cloned cards are upgraded but carry no properties; set them before the first render.
    const src = wrapper.querySelector<PointCard | RouteCard>('point-card, route-card');
    const copy = clone.querySelector<PointCard | RouteCard>('point-card, route-card');
    if (src && copy) {
      Object.assign(copy, { item: src.item, readonly: true });
      if (src.localName === 'route-card') {
        Object.assign(copy, { distance: (src as RouteCard).distance, units: (src as RouteCard).units });
      }
    }
    clone.style.width = `${rect.width}px`;
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    this.shadowRoot!.appendChild(clone);
    this._dragClone = clone;

    window.addEventListener('pointermove', this._onWindowMove);
    window.addEventListener('pointerup', this._onWindowUp);
    window.addEventListener('pointercancel', this._onWindowCancel);
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
    const from = this._draggedIndex;
    let to = this._dropTargetIndex;
    this._cleanupDrag();
    if (from < 0 || to < 0) return;
    if (to > from) to--;
    if (to === from) return;

    const order = this.items.map((s) => s.id);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    this._dispatchReorder(order);
  }

  private _dispatchReorder(order: string[]) {
    this.dispatchEvent(
      new CustomEvent('items-reorder', {
        detail: { order },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _cleanupDrag() {
    window.removeEventListener('pointermove', this._onWindowMove);
    window.removeEventListener('pointerup', this._onWindowUp);
    window.removeEventListener('pointercancel', this._onWindowCancel);
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
