/**
 * Single source of truth for travel mode definitions.
 *
 * Each consumer derives its own lookup structure from this array.
 * Hex colors match the resolved CSS custom property values from the
 * rudimentary palette + theme.css overrides.
 */

interface TravelModeConfig {
  mode: string;
  icon: string;
  cssColor: string;
  hexColor: string;
  orsProfile?: string;
}

export const TRAVEL_MODES: TravelModeConfig[] = [
  { mode: 'drive', icon: 'car',            cssColor: 'var(--wa-color-brand-50)',  hexColor: '#ff6b00', orsProfile: 'driving-car' },
  { mode: 'plane', icon: 'plane',          cssColor: 'var(--wa-color-blue-50)',   hexColor: '#146bff' },
  { mode: 'boat',  icon: 'ship',           cssColor: 'var(--wa-color-indigo-70)', hexColor: '#a2a7ff' },
  { mode: 'bike',  icon: 'person-biking',  cssColor: 'var(--wa-color-cyan-50)',   hexColor: '#008098', orsProfile: 'cycling-regular' },
  { mode: 'walk',  icon: 'compass',        cssColor: 'var(--wa-color-green-50)',  hexColor: '#0f881d', orsProfile: 'foot-walking' },
];

/** Pre-built lookup: mode → CSS custom property color (for component styles). */
export const CSS_COLOR_BY_MODE: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.map((m) => [m.mode, m.cssColor]),
);

/** Pre-built lookup: mode → hex color (for canvas/MapLibre rendering). */
export const HEX_COLOR_BY_MODE: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.map((m) => [m.mode, m.hexColor]),
);
