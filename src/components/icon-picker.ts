/**
 * Icon picker — dialog with categorized grid of icons.
 *
 * Trigger button shows the currently selected icon. Clicking it opens a
 * wa-dialog with icons grouped by category. Selecting an icon fires
 * `icon-change` with the icon name string.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';

const CATEGORIES: Record<string, string[]> = {
  Outdoors: ['tree', 'leaf', 'flower', 'compass', 'fire', 'snowflake', 'sun', 'umbrella'],
  'Food & Drink': ['utensils', 'mug-hot', 'cake-candles', 'martini-glass', 'fish'],
  Sightseeing: ['camera', 'landmark', 'globe', 'ticket', 'crown'],
  Accommodation: ['house', 'bed'],
  Fun: ['star', 'trophy', 'gift', 'shop', 'paw', 'sparkles'],
  Transport: ['plane', 'ship', 'train', 'bus', 'car', 'suitcase'],
  People: ['heart', 'anchor'],
  Checklist: ['circle', 'square', 'circle-check', 'circle-plus', 'circle-info', 'circle-xmark'],
};

@customElement('icon-picker')
export class IconPicker extends LitElement {
  @property() value = 'circle-plus';
  @state() private _open = false;

  static styles = [waUtilities, css`
    :host {
      display: inline-block;
    }

    .trigger {
      font-size: var(--wa-font-size-l);
    }

    .category-label {
      font-size: var(--wa-font-size-xs);
      font-weight: var(--wa-font-weight-semibold);
      color: var(--wa-color-text-quiet);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: var(--wa-space-s) 0 var(--wa-space-3xs);
    }

    .category-label:first-child {
      margin-top: 0;
    }

    .icon-btn {
      padding: var(--wa-space-2xs) var(--wa-space-3xs);
      background: none;
      border: var(--wa-border-width-m) solid transparent;
      border-radius: var(--wa-border-radius-m);
      cursor: pointer;
      font-size: var(--wa-font-size-l);
    }

    .icon-btn:hover {
      background: var(--wa-color-surface-lowered);
    }

    .icon-btn.selected {
      border-color: var(--wa-color-brand-50);
    }

    .icon-btn .label {
      font-size: var(--wa-font-size-2xs);
      color: var(--wa-color-text-quiet);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
  `];

  render() {
    return html`
      <wa-button class="trigger" appearance="outlined" size="small" @click=${this._openDialog}>
        <wa-icon name=${this.value} label="Pick icon"></wa-icon>
      </wa-button>
      <wa-dialog label="Pick an icon" ?open=${this._open} @wa-after-hide=${this._closeDialog}>
        ${Object.entries(CATEGORIES).map(
          ([cat, icons]) => html`
            <div class="category-label">${cat}</div>
            <div class="wa-grid wa-gap-3xs" style="--min-column-size: 4rem">
              ${icons.map(
                (icon) => html`
                  <button
                    class="icon-btn wa-stack wa-align-items-center wa-gap-0 ${icon === this.value ? 'selected' : ''}"
                    aria-label=${icon}
                    @click=${() => this._select(icon)}
                  >
                    <wa-icon name=${icon}></wa-icon>
                    <span class="label">${icon}</span>
                  </button>
                `,
              )}
            </div>
          `,
        )}
      </wa-dialog>
    `;
  }

  private _openDialog() {
    this._open = true;
  }

  private _closeDialog() {
    this._open = false;
  }

  private _select(icon: string) {
    this.value = icon;
    this._open = false;
    this.dispatchEvent(
      new CustomEvent('icon-change', {
        detail: icon,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'icon-picker': IconPicker;
  }
}
