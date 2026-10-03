import type { StyleSpecification } from 'maplibre-gl';
import { transformToKidDrawn } from '../map/styles/kid-drawn.js';

/** OpenFreeMap Bright style — free OSM vector tiles, no API key required. */
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

/** In-flight or settled kid-drawn style; cleared on failure so a later call retries. */
let _stylePromise: Promise<StyleSpecification> | null = null;

/** Resolve the kid-drawn MapLibre style, fetching and transforming Bright once per session. */
export async function resolveMapStyle(): Promise<StyleSpecification> {
  _stylePromise ??= fetch(MAP_STYLE_URL)
    .then(async (res) => {
      if (!res.ok) throw new Error(`Map style fetch failed: ${res.status}`);
      return transformToKidDrawn((await res.json()) as StyleSpecification);
    })
    .catch((err: unknown) => {
      _stylePromise = null;
      throw err;
    });
  // Each caller gets its own copy so MapLibre cannot mutate the cache.
  return structuredClone(await _stylePromise);
}
