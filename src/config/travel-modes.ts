/**
 * Frontend-side re-export of the shared travel-modes source of truth plus a
 * couple of pre-built lookup tables used by components and the map renderer.
 *
 * The authoritative definition lives in `shared/travel-modes.ts` so the worker
 * and the frontend agree on the set of modes.
 */

import { TRAVEL_MODES } from '../../shared/travel-modes.js';

export { TRAVEL_MODES } from '../../shared/travel-modes.js';
export type { TravelModeConfig } from '../../shared/travel-modes.js';

/** Pre-built lookup: mode → CSS custom property color (for component styles). */
export const CSS_COLOR_BY_MODE: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.map((m) => [m.mode, m.cssColor]),
);

/** Pre-built lookup: mode → hex color (for canvas/MapLibre rendering). */
export const HEX_COLOR_BY_MODE: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.map((m) => [m.mode, m.hexColor]),
);
