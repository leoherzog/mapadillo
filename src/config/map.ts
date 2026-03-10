/** OpenFreeMap Bright style — free OSM vector tiles, no API key required. */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

import type { StyleSpecification } from 'maplibre-gl';
import { transformToKidDrawn } from '../map/styles/kid-drawn.js';

/** Cached kid-drawn style (fetched + transformed once per session). */
let _styleCache: StyleSpecification | null = null;

/**
 * Resolve the kid-drawn MapLibre style.
 * Fetches the Bright base style once, applies the kid-drawn transform, and caches.
 */
export async function resolveMapStyle(): Promise<StyleSpecification> {
  if (!_styleCache) {
    const res = await fetch(MAP_STYLE_URL);
    const bright = (await res.json()) as StyleSpecification;
    _styleCache = transformToKidDrawn(bright);
  }
  // Return a deep clone so callers can't mutate the cache
  return JSON.parse(JSON.stringify(_styleCache)) as StyleSpecification;
}
