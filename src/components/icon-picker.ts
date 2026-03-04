/**
 * Icon picker — dialog with categorized grid of icons.
 *
 * Trigger button shows the currently selected icon. Clicking it opens a
 * wa-dialog with icons grouped by category. Selecting an icon fires
 * `icon-change` with the icon name string.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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

  static styles = css`
    :host {
      display: inline-block;
    }

    .trigger {
      font-size: 1.2rem;
    }

    .category-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--wa-color-neutral-500);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin: 0.75rem 0 0.25rem;
    }

    .category-label:first-child {
      margin-top: 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(4rem, 1fr));
      gap: 0.25rem;
    }

    .icon-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      padding: 0.4rem 0.2rem;
      background: none;
      border: 2px solid transparent;
      border-radius: var(--wa-border-radius-m, 0.25rem);
      cursor: pointer;
      font-size: 1.2rem;
    }

    .icon-btn:hover {
      background: var(--wa-color-neutral-100);
    }

    .icon-btn.selected {
      border-color: var(--wa-color-brand-500, #ff6b00);
    }

    .icon-btn .label {
      font-size: 0.55rem;
      color: var(--wa-color-neutral-500);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
  `;

  render() {
    return html`
      <wa-button class="trigger" appearance="outlined" size="small" @click=${this._openDialog}>
        <wa-icon name=${this.value} label="Pick icon"></wa-icon>
      </wa-button>
      <wa-dialog label="Pick an icon" .open=${this._open} @wa-after-hide=${this._closeDialog}>
        ${Object.entries(CATEGORIES).map(
          ([cat, icons]) => html`
            <div class="category-label">${cat}</div>
            <div class="grid">
              ${icons.map(
                (icon) => html`
                  <button
                    class="icon-btn ${icon === this.value ? 'selected' : ''}"
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
