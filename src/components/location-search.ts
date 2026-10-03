/**
 * Location search — debounced autocomplete powered by the geocoding proxy.
 *
 * Uses wa-combobox (Pro) with a pass-through `filter`, so the geocoder and
 * `_filterExisting` decide which options appear.
 *
 * Fires `location-selected` with a GeocodingResult when the user picks a place.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type WaCombobox from '@web.awesome.me/webawesome-pro/dist/components/combobox/combobox.js';
import { searchPlaces, type GeocodingResult } from '../services/geocoding.js';
import { getActiveMapCenter } from '../map/map-controller.js';
import { fieldValue } from '../utils/form.js';
import { waUtilities } from '../styles/wa-utilities.js';

/** Accepts every option: Photon and `_filterExisting` already decide what is listed. */
const acceptAll = (): boolean => true;

export interface ExistingLocation {
  name: string;
  latitude: number;
  longitude: number;
  icon?: string | null;
}

@customElement('location-search')
export class LocationSearch extends LitElement {
  @property() placeholder = 'Search for a place...';
  @property({ type: Array }) existingLocations: ExistingLocation[] = [];

  @state() private _results: GeocodingResult[] = [];
  @state() private _existingMatches: ExistingLocation[] = [];
  @state() private _loading = false;
  @state() private _searched = false;

  /** Cached: render() always outputs the same combobox. */
  @query('wa-combobox', true) private _combobox!: WaCombobox;

  private _debounceTimer?: ReturnType<typeof setTimeout>;
  private _searchGeneration = 0;

  static styles = [waUtilities, css`
    :host {
      display: block;
    }

    wa-option wa-icon[slot="start"] {
      color: var(--wa-color-brand-50);
    }

    wa-option wa-icon[name="star"][slot="start"] {
      color: var(--wa-color-warning-50);
    }

    wa-divider {
      --spacing: var(--wa-space-3xs);
    }

    .option-detail {
      display: block;
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-text-quiet);
    }
  `];

  protected firstUpdated(): void {
    // wa-combobox internally calls stopPropagation() on the native input
    // event from typing, so @input on the host only fires on selection.
    // We capture the native event before it's stopped, using composedPath()
    // to read the typed value from the internal <input>.
    this._combobox.addEventListener(
      'input',
      (e: Event) => {
        const origin = e.composedPath()[0];
        if (origin instanceof HTMLInputElement) {
          this._onTyping(origin.value);
        }
      },
      true, // capture phase — fires before combobox's stopPropagation
    );
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._debounceTimer);
  }

  render() {
    return html`
      <wa-combobox
        placeholder=${this.placeholder}
        with-clear
        .filter=${acceptAll}
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
    const hasExisting = this._existingMatches.length > 0;
    const hasResults = this._results.length > 0;

    if (!hasExisting && !hasResults) {
      if (this._searched && !this._loading) {
        return html`
          <wa-option value="" disabled>No places found</wa-option>
        `;
      }
      return nothing;
    }

    return html`
      ${hasExisting ? repeat(
        this._existingMatches,
        (r) => `existing:${r.latitude},${r.longitude}`,
        (r, i) => html`
          <wa-option value=${'e' + String(i)} label=${r.name}>
            <wa-icon
              slot="start"
              name="star"
            ></wa-icon>
            ${r.name}
          </wa-option>
        `,
      ) : nothing}
      ${hasExisting && hasResults ? html`<wa-divider></wa-divider>` : nothing}
      ${hasResults ? repeat(
        this._results,
        (r) => `${r.latitude},${r.longitude}`,
        (r, i) => html`
          <wa-option value=${String(i)} label=${r.name}>
            <wa-icon
              slot="start"
              name="location-dot"
            ></wa-icon>
            ${r.name}
            <span class="option-detail wa-text-truncate">
              ${this._formatDetail(r)}
            </span>
          </wa-option>
        `,
      ) : nothing}
    `;
  }

  private _onTyping(raw: string) {
    const value = raw.trim();
    clearTimeout(this._debounceTimer);

    if (!value || value.length < 2) {
      this._searchGeneration++;
      this._results = [];
      this._existingMatches = [];
      this._searched = false;
      this._loading = false;
      return;
    }

    // Filter existing locations instantly (no debounce)
    this._filterExisting(value);
    // Set `open` after render: show() would find no options yet and return early.
    void this.updateComplete.then(() => {
      if (this._existingMatches.length) this._combobox.open = true;
    });

    this._debounceTimer = setTimeout(() => void this._search(value), 300);
  }

  /** Filter existing locations by partial case-insensitive name match. */
  private _filterExisting(query: string) {
    const q = query.toLowerCase();
    this._existingMatches = this.existingLocations.filter(
      (loc) => loc.name.toLowerCase().includes(q),
    );
  }

  private async _search(query: string) {
    const gen = ++this._searchGeneration;
    this._loading = true;
    try {
      let results = await searchPlaces(query, 'en', 5, getActiveMapCenter());
      if (gen !== this._searchGeneration) return; // stale response
      // Deduplicate against existing location matches
      if (this._existingMatches.length) {
        const existingKeys = new Set(
          this._existingMatches.map((l) => `${l.latitude.toFixed(5)},${l.longitude.toFixed(5)}`),
        );
        results = results.filter(
          (r) => !existingKeys.has(`${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}`),
        );
      }
      this._results = results;
      this._searched = true;
      await this.updateComplete;
      // show() checks visible options before the combobox has processed the new options, so it would return early.
      if (results.length || this._existingMatches.length) this._combobox.open = true;
    } catch {
      if (gen !== this._searchGeneration) return;
      this._results = [];
      if (this._existingMatches.length) this._combobox.open = true;
    } finally {
      if (gen === this._searchGeneration) this._loading = false;
    }
  }

  private _onClear() {
    this._searchGeneration++;
    clearTimeout(this._debounceTimer);
    this._results = [];
    this._existingMatches = [];
    this._searched = false;
    this._loading = false;
  }

  private _onSelect(e: Event) {
    const val = fieldValue(e);

    let result: GeocodingResult | undefined;
    let icon: string | null | undefined;
    if (val.startsWith('e')) {
      // Existing location
      const loc = this._existingMatches[parseInt(val.slice(1), 10)];
      if (loc) {
        result = { name: loc.name, latitude: loc.latitude, longitude: loc.longitude };
        icon = loc.icon;
      }
    } else {
      result = this._results[parseInt(val, 10)];
    }
    if (!result) return;

    this.dispatchEvent(
      new CustomEvent('location-selected', {
        detail: { ...result, icon },
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
