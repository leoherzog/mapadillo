/**
 * Travel mode picker — horizontal row of transport mode radio buttons.
 *
 * Each mode has a distinctive color. The active mode gets a colored
 * bottom indicator. Fires `mode-change` with the mode string on selection.
 *
 * Uses `<wa-radio-group>` with `<wa-radio appearance="button">` for
 * built-in ARIA semantics, keyboard navigation, and selection state.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { TRAVEL_MODES } from '../config/travel-modes.js';

const MODES = TRAVEL_MODES.map((m) => ({
  icon: m.icon,
  mode: m.mode,
  color: m.cssColor,
}));

@customElement('travel-mode-picker')
export class TravelModePicker extends LitElement {
  @property() value = '';
  @property({ type: Boolean }) disabled = false;

  static styles = css`
    :host {
      display: block;
    }

    wa-radio-group::part(form-control-label) {
      display: none;
    }

    wa-radio {
      position: relative;
    }

    wa-radio:state(checked)::part(label) {
      color: var(--mode-color, currentColor);
    }

    wa-radio:state(checked)::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 50%;
      transform: translateX(-50%);
      width: 10px;
      height: 8px;
      z-index: 1;
      background: var(--mode-color, currentColor);
      clip-path: polygon(
        35% 0%, 65% 0%,
        65% 45%, 100% 45%,
        50% 100%,
        0% 45%, 35% 45%
      );
    }
  `;

  render() {
    return html`
      <wa-radio-group
        size="small"
        orientation="horizontal"
        .value=${this.value}
        ?disabled=${this.disabled}
        @change=${this._onChange}
      >
        ${MODES.map(
          ({ icon, mode, color }) => html`
            <wa-radio
              appearance="button"
              value=${mode}
              style="--mode-color: ${color}"
            >
              <wa-icon name=${icon}></wa-icon>
            </wa-radio>
          `,
        )}
      </wa-radio-group>
    `;
  }

  private _onChange(e: Event) {
    const group = e.currentTarget as HTMLElement & { value: string };
    this.value = group.value;
    this.dispatchEvent(
      new CustomEvent('mode-change', {
        detail: this.value,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'travel-mode-picker': TravelModePicker;
  }
}
