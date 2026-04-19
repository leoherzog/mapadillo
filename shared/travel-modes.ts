/**
 * Single source of truth for travel mode definitions.
 *
 * Used by both the frontend (for styling, icons, ORS profile derivation) and
 * the worker (for server-side validation via VALID_TRAVEL_MODES).
 *
 * Hex colors match the resolved CSS custom property values from the rudimentary
 * palette + theme.css overrides. The CSS custom property names are only
 * meaningful to the frontend but declared here to keep the definition complete
 * in one place.
 */

/** Valid travel mode identifiers — single source of truth. */
export type TravelMode = 'drive' | 'plane' | 'boat' | 'bike' | 'walk';

export interface TravelModeConfig {
  mode: TravelMode;
  /** Font Awesome icon name shown in the UI (frontend-only). */
  icon: string;
  /** CSS custom-property-based color for use in component styles. */
  cssColor: string;
  /** Resolved hex color for canvas / MapLibre rendering. */
  hexColor: string;
  /** ORS profile name. Absent for modes computed client-side (plane, boat). */
  orsProfile?: string;
}

export const TRAVEL_MODES: readonly TravelModeConfig[] = [
  { mode: 'drive', icon: 'car',            cssColor: 'var(--wa-color-brand-50)',  hexColor: '#ff6b00', orsProfile: 'driving-car' },
  { mode: 'plane', icon: 'plane',          cssColor: 'var(--wa-color-blue-50)',   hexColor: '#146bff' },
  { mode: 'boat',  icon: 'ship',           cssColor: 'var(--wa-color-indigo-70)', hexColor: '#a2a7ff' },
  { mode: 'bike',  icon: 'person-biking',  cssColor: 'var(--wa-color-cyan-50)',   hexColor: '#008098', orsProfile: 'cycling-regular' },
  { mode: 'walk',  icon: 'compass',        cssColor: 'var(--wa-color-green-50)',  hexColor: '#0f881d', orsProfile: 'foot-walking' },
];

/** Set of valid travel mode names — derived from TRAVEL_MODES to avoid drift. */
export const VALID_TRAVEL_MODES: ReadonlySet<string> = new Set<string>(
  TRAVEL_MODES.map((m) => m.mode),
);
