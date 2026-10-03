/**
 * Endpoint editor — shared template for a card's location endpoint.
 *
 * Renders an icon picker, name input and change-location pencil for a placed
 * endpoint, or a location search while unplaced or editing. The calling card
 * owns the editing state and maps the events onto its item fields; styles
 * come from cardSharedStyles.
 */
import { html, type TemplateResult } from 'lit';
import type { Stop } from '../services/maps.js';
import { DEFAULT_ICON } from '../../shared/icons.js';
import type { GeocodingResult } from '../services/geocoding.js';
import { extractExistingLocations } from '../utils/existing-locations.js';
import './icon-picker.js';
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
  onLocationSelected: (e: LocationSelectedEvent) => void;
}

/**
 * Render one endpoint editor. Lit invokes the handlers with the rendering card as `this`.
 * @param o - endpoint values, labels and handlers
 * @returns the editor or search template
 */
export function renderEndpointEditor(o: EndpointEditorOptions): TemplateResult {
  if (!o.placed) {
    return html`
      <location-search
        placeholder=${o.searchPlaceholder}
        .existingLocations=${extractExistingLocations(o.allItems)}
        @location-selected=${o.onLocationSelected}
      ></location-search>
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
        size="small"
        .value=${o.name}
        placeholder=${o.namePlaceholder}
        @input=${o.onNameInput}
      >
        <wa-icon class="change-btn" name="pencil" slot="end" label=${o.changeLabel} @click=${o.onChangeRequest}></wa-icon>
      </wa-input>
    </div>
  `;
}
