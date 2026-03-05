/**
 * Travel mode picker — horizontal row of transport mode buttons.
 *
 * Each mode has a distinctive color. The active mode gets a colored
 * bottom border. Fires `mode-change` with the mode string on click.
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
      display: flex;
      gap: var(--wa-space-3xs);
      align-items: center;
    }

    .active::part(base) {
      border-bottom: 3px solid var(--mode-color, currentColor);
      color: var(--mode-color, currentColor);
    }
  `;

  render() {
    return MODES.map(
      ({ icon, mode, color }) => html`
        <wa-button
          appearance="plain"
          size="small"
          class=${this.value === mode ? 'active' : ''}
          style="--mode-color: ${color}"
          title=${mode}
          ?disabled=${this.disabled}
          @click=${() => this._select(mode)}
        >
          <wa-icon name=${icon}></wa-icon>
        </wa-button>
      `,
    );
  }

  private _select(mode: string) {
    this.value = mode;
    this.dispatchEvent(
      new CustomEvent('mode-change', {
        detail: mode,
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
