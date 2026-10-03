/**
 * Icon picker — dialog with categorized grid of icons.
 *
 * Trigger button shows the currently selected icon. Clicking it opens a
 * wa-dialog with icons grouped by category. Selecting an icon fires
 * `icon-change` with the icon name string.
 *
 * The special value `'none'` hides the marker on the map entirely.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { DEFAULT_ICON, ICON_CATEGORIES } from '../../shared/icons.js';

/** Font Awesome glyph for an icon value; 'none' has no glyph, so it shows eye-slash. */
export const displayIcon = (icon: string) => (icon === 'none' ? 'eye-slash' : icon);

@customElement('icon-picker')
export class IconPicker extends LitElement {
  @property() value: string = DEFAULT_ICON;
  @state() private _open = false;
  /** Grid content mounts on first open so closed pickers stay light. */
  @state() private _everOpened = false;

  static styles = [waUtilities, css`
    :host {
      display: inline-block;
    }

    .trigger {
      font-size: var(--wa-font-size-m);
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
      font-size: var(--wa-font-size-l);
    }

    .icon-btn::part(button) {
      height: auto;
      padding: var(--wa-space-2xs) var(--wa-space-3xs);
    }

    .icon-btn::part(label) {
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 0;
      max-width: 100%;
    }

    .icon-btn.selected {
      outline: var(--wa-border-width-m) solid var(--wa-color-brand-50);
      outline-offset: -1px;
    }

    .icon-btn .label {
      display: block;
      font-size: var(--wa-font-size-2xs);
      color: var(--wa-color-text-quiet);
      max-width: 100%;
    }
  `];

  render() {
    return html`
      <wa-button class="trigger" appearance="outlined" size="s" @click=${this._openDialog}>
        <wa-icon name=${displayIcon(this.value)} label="Change icon: ${this.value}"></wa-icon>
      </wa-button>
      <wa-dialog label="Pick an icon" ?open=${this._open} @wa-after-hide=${this._closeDialog}>
        ${this._everOpened
          ? Object.entries(ICON_CATEGORIES).map(
            ([cat, icons]) => html`
              <div class="category-label">${cat}</div>
              <div class="wa-grid wa-gap-3xs" style="--min-column-size: 4rem">
                ${icons.map(
                  (icon) => html`
                    <wa-button
                      class="icon-btn ${icon === this.value ? 'selected' : ''}"
                      appearance="plain"
                      size="s"
                      @click=${() => this._select(icon)}
                    >
                      <wa-icon name=${displayIcon(icon)}></wa-icon>
                      <span class="label wa-text-truncate">${icon}</span>
                    </wa-button>
                  `,
                )}
              </div>
            `,
          )
          : nothing}
      </wa-dialog>
    `;
  }

  private _openDialog() {
    this._everOpened = true;
    this._open = true;
  }

  private _closeDialog(e: Event) {
    if (e.target !== e.currentTarget) return;
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
