/** OpenFreeMap Bright style — free OSM vector tiles, no API key required. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

import type { StyleSpecification } from 'maplibre-gl';
import type { MapThemeId } from './map-themes.js';
import { transformToKidDrawn } from '../map/styles/kid-drawn.js';

/** Cached Bright style JSON (fetched once per session). */
let _brightStyleCache: StyleSpecification | null = null;

/**
 * Resolve a full MapLibre style object for the given theme.
 * Fetches the Bright style JSON once and caches it; applies the
 * kid-drawn transform if that theme is requested.
 */
export async function resolveMapStyle(themeId: MapThemeId): Promise<StyleSpecification> {
  if (!_brightStyleCache) {
    const res = await fetch(MAP_STYLE_URL);
    _brightStyleCache = (await res.json()) as StyleSpecification;
  }

  if (themeId === 'kid-drawn') {
    return transformToKidDrawn(_brightStyleCache);
  }

  // Return a deep clone so callers can't mutate the cache
  return JSON.parse(JSON.stringify(_brightStyleCache)) as StyleSpecification;
}
