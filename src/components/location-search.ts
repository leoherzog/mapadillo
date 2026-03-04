/**
 * Location search — debounced autocomplete powered by the geocoding proxy.
 *
 * Uses wa-combobox (Pro) with autocomplete="none" so the server controls
 * filtering. Options are dynamically rendered from async search results.
 *
 * Fires `location-selected` with a GeocodingResult when the user picks a place.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { searchPlaces, type GeocodingResult } from '../services/geocoding.js';

@customElement('location-search')
export class LocationSearch extends LitElement {
  @state() private _results: GeocodingResult[] = [];
  @state() private _loading = false;
  @state() private _searched = false;

  private _debounceTimer?: ReturnType<typeof setTimeout>;
  private _searchGeneration = 0;

  static styles = css`
    :host {
      display: block;
    }

    .option-detail {
      display: block;
      font-size: 0.85em;
      color: var(--wa-color-neutral-500);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `;

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._debounceTimer);
  }

  render() {
    return html`
      <wa-combobox
        label="Search for a place"
        autocomplete="none"
        placeholder="Search for a place..."
        with-clear
        @input=${this._onInput}
        @wa-clear=${this._onClear}
        @change=${this._onSelect}
      >
        <wa-icon slot="start" name="magnifying-glass"></wa-icon>
        ${this._loading
          ? html`<wa-spinner slot="end"></wa-spinner>`
          : nothing}
        ${this._renderOptions()}
      </wa-combobox>
    `;
  }

  private _renderOptions() {
    if (this._results.length === 0) {
      if (this._searched && !this._loading) {
        return html`
          <wa-option value="" disabled>No places found</wa-option>
        `;
      }
      return nothing;
    }

    return this._results.map(
      (r, i) => html`
        <wa-option value=${String(i)} label=${r.name}>
          <wa-icon
            slot="start"
            name="location-dot"
            family="jelly"
            style="color: var(--wa-color-brand-500, #ff6b00)"
          ></wa-icon>
          ${r.name}
          <span class="option-detail">
            ${this._formatDetail(r)}
          </span>
        </wa-option>
      `,
    );
  }

  private _onInput(e: Event) {
    const combobox = e.target as HTMLInputElement;
    const value = combobox.value?.trim();
    clearTimeout(this._debounceTimer);

    if (!value || value.length < 2) {
      this._results = [];
      this._searched = false;
      this._loading = false;
      return;
    }

    this._debounceTimer = setTimeout(() => void this._search(value), 300);
  }

  private async _search(query: string) {
    const gen = ++this._searchGeneration;
    this._loading = true;
    try {
      const results = await searchPlaces(query);
      if (gen !== this._searchGeneration) return; // stale response
      this._results = results;
      this._searched = true;
    } catch {
      if (gen !== this._searchGeneration) return;
      this._results = [];
    } finally {
      if (gen === this._searchGeneration) this._loading = false;
    }
  }

  private _onClear() {
    clearTimeout(this._debounceTimer);
    this._results = [];
    this._searched = false;
    this._loading = false;
  }

  private _onSelect(e: Event) {
    const combobox = e.target as HTMLInputElement;
    const index = parseInt(combobox.value, 10);
    const result = this._results[index];
    if (!result) return;

    this.dispatchEvent(
      new CustomEvent('location-selected', {
        detail: result,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _formatDetail(r: GeocodingResult): string {
    return [r.city, r.state, r.country].filter(Boolean).join(', ');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'location-search': LocationSearch;
  }
}
