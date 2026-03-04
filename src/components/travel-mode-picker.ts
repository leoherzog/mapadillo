/**
 * Travel mode picker — horizontal row of transport mode buttons.
 *
 * Each mode has a distinctive color. The active mode gets a colored
 * bottom border. Fires `mode-change` with the mode string on click.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

interface ModeInfo {
  icon: string;
  mode: string;
  color: string;
}

const MODES: ModeInfo[] = [
  { icon: 'car', mode: 'drive', color: '#e05e00' },
  { icon: 'compass', mode: 'walk', color: '#16a34a' },
  { icon: 'person-biking', mode: 'bike', color: '#0d9488' },
  { icon: 'plane', mode: 'plane', color: '#2563eb' },
  { icon: 'ship', mode: 'boat', color: '#1e3a5f' },
];

@customElement('travel-mode-picker')
export class TravelModePicker extends LitElement {
  @property() value = '';

  static styles = css`
    :host {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }

    .mode-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      border-bottom: 3px solid transparent;
      padding: 0.3rem 0.5rem;
      cursor: pointer;
      font-size: 1rem;
      color: var(--wa-color-neutral-500);
      border-radius: 0;
    }

    .mode-btn:hover {
      color: var(--wa-color-neutral-700);
    }
  `;

  render() {
    return MODES.map(
      ({ icon, mode, color }) => html`
        <button
          class="mode-btn"
          style=${this.value === mode ? `border-bottom-color: ${color}; color: ${color};` : ''}
          title=${mode}
          @click=${() => this._select(mode)}
        >
          <wa-icon name=${icon}></wa-icon>
        </button>
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
