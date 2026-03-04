/**
 * Stop card — editable card for a single stop in a trip.
 *
 * Shows icon picker, name input, label input, coordinates,
 * and a travel mode picker (for non-first stops). Left border
 * color reflects the travel mode.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Stop } from '../services/maps.js';
import './icon-picker.js';
import './travel-mode-picker.js';
import { waUtilities } from '../styles/wa-utilities.js';

const MODE_COLORS: Record<string, string> = {
  drive: '#e05e00',
  walk: '#16a34a',
  bike: '#0d9488',
  plane: '#2563eb',
  boat: '#1e3a5f',
};

@customElement('stop-card')
export class StopCard extends LitElement {
  @property({ type: Object }) stop!: Stop;
  @property({ type: Number }) index = 0;
  @property({ type: Boolean }) first = false;

  static styles = [waUtilities, css`
    :host {
      display: block;
    }

    .travel-mode-row {
      padding: var(--wa-space-3xs) 0;
    }

    wa-card {
      --spacing: var(--wa-space-xs) var(--wa-space-s);
    }

    wa-card::part(base) {
      border-left: 4px solid var(--border-color, var(--wa-color-neutral-300));
    }

    .drag-handle {
      cursor: grab;
      color: var(--wa-color-neutral-400);
      flex-shrink: 0;
    }

    .name-input {
      flex: 1;
      min-width: 0;
    }

    .delete-btn::part(base) {
      color: var(--wa-color-neutral-400);
    }

    .delete-btn::part(base):hover {
      color: var(--wa-color-danger-600);
    }

    .label-row {
      margin-top: var(--wa-space-3xs);
    }

    .coords {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-neutral-400);
      margin-top: var(--wa-space-3xs);
    }
  `];

  render() {
    const borderColor = MODE_COLORS[this.stop.travel_mode ?? ''] ?? 'var(--wa-color-neutral-300)';

    return html`
      ${!this.first
        ? html`
            <div class="travel-mode-row wa-cluster wa-justify-content-center">
              <travel-mode-picker
                .value=${this.stop.travel_mode ?? ''}
                @mode-change=${this._onModeChange}
              ></travel-mode-picker>
            </div>
          `
        : nothing}
      <wa-card style="--border-color: ${borderColor}" draggable="true">
        <div class="top-row wa-cluster wa-align-items-center wa-gap-xs">
          <wa-icon class="drag-handle" name="grip-vertical"></wa-icon>
          <icon-picker
            .value=${this.stop.icon ?? 'circle-plus'}
            @icon-change=${this._onIconChange}
          ></icon-picker>
          <wa-input
            class="name-input"
            size="small"
            .value=${this.stop.name}
            placeholder="Stop name"
            @input=${this._onNameInput}
          ></wa-input>
          <wa-button class="delete-btn" appearance="plain" size="small" @click=${this._onDelete}>
            <wa-icon name="xmark" label="Delete stop"></wa-icon>
          </wa-button>
        </div>
        <div class="label-row">
          <wa-input
            size="small"
            .value=${this.stop.label ?? ''}
            placeholder="Add a label..."
            @input=${this._onLabelInput}
          ></wa-input>
        </div>
        <div class="coords">
          ${this.stop.latitude.toFixed(5)}, ${this.stop.longitude.toFixed(5)}
        </div>
      </wa-card>
    `;
  }

  private _fire(field: string, value: string) {
    this.dispatchEvent(
      new CustomEvent('stop-update', {
        detail: { stopId: this.stop.id, field, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onNameInput(e: Event) {
    this._fire('name', (e.target as HTMLInputElement).value);
  }

  private _onLabelInput(e: Event) {
    this._fire('label', (e.target as HTMLInputElement).value);
  }

  private _onIconChange(e: CustomEvent) {
    this._fire('icon', e.detail);
  }

  private _onModeChange(e: CustomEvent) {
    this._fire('travel_mode', e.detail);
  }

  private _onDelete() {
    this.dispatchEvent(
      new CustomEvent('stop-delete', {
        detail: { stopId: this.stop.id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stop-card': StopCard;
  }
}
