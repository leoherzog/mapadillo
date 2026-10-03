/**
 * Endpoint editor — shared templates for a card's location endpoint.
 *
 * Renders an icon picker, name input and change-location pencil for a placed
 * endpoint, or a location search while unplaced or editing. The calling card
 * owns the editing state and maps the events onto its item fields; styles
 * come from cardSharedStyles.
 */
import { html, type TemplateResult } from 'lit';
import type WaInput from '@web.awesome.me/webawesome-pro/dist/components/input/input.js';
import type { Stop } from '../services/maps.js';
import { DEFAULT_ICON } from '../../shared/icons.js';
import { MAX_NAME_LENGTH } from '../../shared/limits.js';
import type { GeocodingResult } from '../services/geocoding.js';
import { extractExistingLocations } from '../utils/existing-locations.js';
import { displayIcon } from './icon-picker.js';
import './location-search.js';

export type LocationSelectedEvent = CustomEvent<GeocodingResult & { icon?: string | null }>;

export interface EndpointEditorOptions {
  /** Show the icon and name editor; otherwise show the location search. */
  placed: boolean;
  icon: string | null;
  name: string;
  namePlaceholder: string;
  changeLabel: string;
  searchPlaceholder: string;
  /** Items offered as existing-location suggestions in the search. */
  allItems: Stop[];
  onIconChange: (e: CustomEvent<string>) => void;
  onNameInput: (e: Event) => void;
  onChangeRequest: () => void;
  /** Return to the placed editor without picking a place; omit while the endpoint is unplaced. */
  onCancel?: () => void;
  onLocationSelected: (e: LocationSelectedEvent) => void;
}

/**
 * Render one endpoint editor. Lit invokes the handlers with the rendering card as `this`.
 * @param o - endpoint values, labels and handlers
 * @returns the editor or search template
 */
export function renderEndpointEditor(o: EndpointEditorOptions): TemplateResult {
  if (!o.placed) {
    const search = html`
      <location-search
        class="name-input"
        placeholder=${o.searchPlaceholder}
        .existingLocations=${extractExistingLocations(o.allItems)}
        @location-selected=${o.onLocationSelected}
      ></location-search>
    `;
    if (!o.onCancel) return search;
    return html`
      <div class="wa-cluster wa-align-items-center wa-gap-xs">
        ${search}
        <wa-button size="s" appearance="plain" @click=${o.onCancel}>Cancel</wa-button>
      </div>
    `;
  }
  return html`
    <div class="wa-cluster wa-align-items-center wa-gap-xs">
      <icon-picker
        .value=${o.icon ?? DEFAULT_ICON}
        @icon-change=${o.onIconChange}
      ></icon-picker>
      <wa-input
        class="name-input"
        size="s"
        maxlength=${MAX_NAME_LENGTH}
        .value=${o.name}
        placeholder=${o.namePlaceholder}
        @input=${o.onNameInput}
        @focus=${(e: Event) => { (e.currentTarget as WaInput).dataset.committed = o.name; }}
        @change=${(e: Event) => {
          // A blank commit the card refused restores the name held at focus; re-firing
          // input replaces the partial name the card queued while it was deleted.
          const input = e.currentTarget as WaInput;
          if (input.value?.trim() || !o.name) return;
          input.value = input.dataset.committed ?? o.name;
          if (input.value !== o.name) input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }}
      >
        <wa-button class="change-btn" slot="end" appearance="plain" size="s" @click=${o.onChangeRequest}>
          <wa-icon name="pencil" label=${o.changeLabel}></wa-icon>
        </wa-button>
      </wa-input>
    </div>
  `;
}

/**
 * Read-only icon and name for a placed endpoint.
 * @param icon - stored icon value, or null for the default
 * @param name - endpoint name
 * @returns the display template
 */
export function renderEndpointDisplay(icon: string | null, name: string): TemplateResult {
  return html`
    <div class="wa-cluster wa-align-items-center wa-gap-xs">
      <wa-icon class="endpoint-icon" name=${displayIcon(icon ?? DEFAULT_ICON)}></wa-icon>
      <span class="endpoint-name">${name}</span>
    </div>
  `;
}

/**
 * Item fields for a picked location; the icon is included only when the pick carries one.
 * @param d - the `location-selected` detail
 * @param prefix - `'dest_'` for a route's end, `''` for a point or route start
 * @returns fields for `item-update-batch`
 */
export function locationFields(
  d: LocationSelectedEvent['detail'],
  prefix: '' | 'dest_' = '',
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    [`${prefix}name`]: d.name,
    [`${prefix}lat`]: d.latitude,
    [`${prefix}lng`]: d.longitude,
  };
  if (d.icon) fields[`${prefix}icon`] = d.icon;
  return fields;
}
