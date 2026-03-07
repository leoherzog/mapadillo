/**
 * Kid-Drawn style transformer — takes the OpenFreeMap Bright style JSON
 * and rewrites colors, line widths, dash arrays, and fonts to create
 * a crayon-like, hand-drawn map aesthetic.
 *
 * Reuses the same vector tile sources and sprites from Bright.
 */
import type { StyleSpecification, LayerSpecification } from 'maplibre-gl';

// ── Color palette ─────────────────────────────────────────────────────────

const CREAM = '#FFF8E7';
const WATER_BLUE = '#4DB6E8';
const GRASS_GREEN = '#7BC67E';
const PEACH = '#FFE0B2';
const BUILDING_FILL = '#D4B5E0';
const BUILDING_OUTLINE = '#9C6ADE';
const ROAD_MOTORWAY = '#FF6B4A';
const ROAD_PRIMARY = '#FFD54F';
const ROAD_SECONDARY = '#AED581';
const ROAD_MINOR = '#FFCCBC';
const BOUNDARY_PURPLE = '#9C6ADE';
const LABEL_BROWN = '#4E342E';
const SAND_YELLOW = '#FFE4A0';
const GLACIER_WHITE = '#E8F4FD';
const FOREST_GREEN = '#5DAA68';

// ── Helpers ───────────────────────────────────────────────────────────────

function idStartsWith(id: string, ...prefixes: string[]): boolean {
  return prefixes.some((p) => id.startsWith(p));
}

/** Multiply a numeric value or the first stop value of an interpolation expression. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function widenWidth(value: any, factor: number): any {
  if (typeof value === 'number') return value * factor;
  // For interpolation/step expressions, return scaled — keep expression structure
  if (Array.isArray(value)) {
    return value.map((v: unknown, i: number) => {
      // Scale numeric stop outputs (every other value after the first few expression args)
      if (typeof v === 'number' && i > 1) return v * factor;
      return v;
    });
  }
  return value;
}

// ── Transformer ───────────────────────────────────────────────────────────

export function transformToKidDrawn(bright: StyleSpecification): StyleSpecification {
  const style: StyleSpecification = JSON.parse(JSON.stringify(bright));

  // Keep the original glyphs URL from Bright (OpenFreeMap's glyph server).
  // Caveat PBFs can be added later; for now the kid-drawn look comes from colors/widths.

  for (const layer of style.layers) {
    transformLayer(layer);
  }

  return style;
}

function transformLayer(layer: LayerSpecification): void {
  const { id } = layer;

  // ── Background ────────────────────────────────────────────────────────
  if (layer.type === 'background') {
    layer.paint = { ...layer.paint, 'background-color': CREAM };
    return;
  }

  // ── Fill layers ───────────────────────────────────────────────────────
  if (layer.type === 'fill') {
    const paint = { ...layer.paint };

    // Water
    if (id === 'water' || id === 'water-intermittent') {
      paint['fill-color'] = WATER_BLUE;
      if (id === 'water-intermittent') paint['fill-opacity'] = 0.7;
    }

    // Parks and grass
    else if (idStartsWith(id, 'park', 'landcover-grass')) {
      paint['fill-color'] = GRASS_GREEN;
      paint['fill-opacity'] = 0.5;
    }

    // Forest / wood
    else if (id === 'landcover-wood') {
      paint['fill-color'] = FOREST_GREEN;
      paint['fill-opacity'] = 0.45;
    }

    // Residential landuse
    else if (id === 'landuse-residential' || id === 'landuse-suburb') {
      paint['fill-color'] = PEACH;
      paint['fill-opacity'] = 0.35;
    }

    // Commercial / industrial
    else if (id === 'landuse-commercial' || id === 'landuse-industrial') {
      paint['fill-color'] = PEACH;
      paint['fill-opacity'] = 0.25;
    }

    // Buildings
    else if (idStartsWith(id, 'building')) {
      paint['fill-color'] = BUILDING_FILL;
      paint['fill-opacity'] = 0.6;
      if (id === 'building') {
        paint['fill-outline-color'] = BUILDING_OUTLINE;
      }
    }

    // Glacier / ice
    else if (idStartsWith(id, 'landcover-glacier', 'landcover-ice')) {
      paint['fill-color'] = GLACIER_WHITE;
    }

    // Sand
    else if (id === 'landcover-sand') {
      paint['fill-color'] = SAND_YELLOW;
    }

    // Schools, hospitals, cemeteries — soft tints
    else if (id === 'landuse-school') {
      paint['fill-color'] = '#FFE0B2';
      paint['fill-opacity'] = 0.4;
    } else if (id === 'landuse-hospital') {
      paint['fill-color'] = '#FFCDD2';
      paint['fill-opacity'] = 0.4;
    } else if (id === 'landuse-cemetery') {
      paint['fill-color'] = '#C8E6C9';
      paint['fill-opacity'] = 0.4;
    }

    layer.paint = paint;
    return;
  }

  // ── Line layers ───────────────────────────────────────────────────────
  if (layer.type === 'line') {
    const paint = { ...layer.paint };
    const layout = { ...layer.layout };

    // Waterways
    if (idStartsWith(id, 'waterway')) {
      paint['line-color'] = WATER_BLUE;
      paint['line-width'] = widenWidth(paint['line-width'], 1.3);
      layer.paint = paint;
      return;
    }

    // Boundaries
    if (idStartsWith(id, 'boundary')) {
      paint['line-color'] = BOUNDARY_PURPLE;
      paint['line-dasharray'] = [4, 3];
      paint['line-opacity'] = 0.6;
      layer.paint = paint;
      return;
    }

    // Ferry
    if (id === 'ferry') {
      paint['line-color'] = WATER_BLUE;
      paint['line-dasharray'] = [3, 3];
      layer.paint = paint;
      return;
    }

    // Railway
    if (idStartsWith(id, 'railway', 'tunnel-railway', 'bridge-railway')) {
      paint['line-color'] = '#9E9E9E';
      layer.paint = paint;
      return;
    }

    // Cablecar
    if (idStartsWith(id, 'cablecar')) {
      paint['line-color'] = '#9E9E9E';
      layer.paint = paint;
      return;
    }

    // Roads — categorize by type
    const isCasing = id.includes('-casing');

    // Motorway
    if (idStartsWith(id, 'highway-motorway', 'tunnel-motorway', 'bridge-motorway')) {
      if (isCasing) {
        paint['line-color'] = '#E55A3A';
        paint['line-width'] = widenWidth(paint['line-width'], 1.2);
        paint['line-dasharray'] = [6, 3];
      } else {
        paint['line-color'] = ROAD_MOTORWAY;
        paint['line-width'] = widenWidth(paint['line-width'], 1.3);
      }
      layout['line-cap'] = 'round';
      layout['line-join'] = 'round';
    }

    // Trunk
    else if (idStartsWith(id, 'highway-trunk', 'tunnel-trunk', 'bridge-trunk')) {
      if (isCasing) {
        paint['line-color'] = '#E55A3A';
        paint['line-width'] = widenWidth(paint['line-width'], 1.1);
      } else {
        paint['line-color'] = ROAD_MOTORWAY;
        paint['line-width'] = widenWidth(paint['line-width'], 1.2);
      }
      layout['line-cap'] = 'round';
      layout['line-join'] = 'round';
    }

    // Primary
    else if (idStartsWith(id, 'highway-primary', 'tunnel-trunk-primary', 'bridge-trunk-primary')) {
      if (isCasing) {
        paint['line-color'] = '#F5C342';
      } else {
        paint['line-color'] = ROAD_PRIMARY;
        paint['line-width'] = widenWidth(paint['line-width'], 1.2);
      }
      layout['line-cap'] = 'round';
      layout['line-join'] = 'round';
    }

    // Secondary / tertiary
    else if (idStartsWith(id, 'highway-secondary', 'tunnel-secondary', 'bridge-secondary')) {
      if (isCasing) {
        paint['line-color'] = '#8BC34A';
      } else {
        paint['line-color'] = ROAD_SECONDARY;
        paint['line-width'] = widenWidth(paint['line-width'], 1.1);
      }
      layout['line-cap'] = 'round';
      layout['line-join'] = 'round';
    }

    // Minor roads / service / track
    else if (idStartsWith(id, 'highway-minor', 'highway-link', 'tunnel-minor', 'tunnel-link',
      'tunnel-service', 'bridge-minor', 'bridge-link', 'road_pier', 'road_area_pier',
      'highway-area')) {
      if (isCasing) {
        paint['line-color'] = '#FFAB91';
      } else {
        paint['line-color'] = ROAD_MINOR;
      }
      layout['line-cap'] = 'round';
      layout['line-join'] = 'round';
    }

    // Paths
    else if (idStartsWith(id, 'highway-path', 'tunnel-path', 'bridge-path')) {
      if (!isCasing) {
        paint['line-color'] = ROAD_MINOR;
        paint['line-dasharray'] = [2, 2];
      } else {
        paint['line-color'] = '#FFAB91';
      }
      layout['line-cap'] = 'round';
      layout['line-join'] = 'round';
    }

    // Motorway link
    else if (idStartsWith(id, 'highway-motorway-link', 'tunnel-motorway-link', 'bridge-motorway-link')) {
      if (isCasing) {
        paint['line-color'] = '#E55A3A';
      } else {
        paint['line-color'] = ROAD_MOTORWAY;
      }
      layout['line-cap'] = 'round';
      layout['line-join'] = 'round';
    }

    // Aeroway
    else if (idStartsWith(id, 'aeroway')) {
      paint['line-color'] = '#BDBDBD';
    }

    layer.paint = paint;
    layer.layout = layout;
    return;
  }

  // ── Symbol layers (labels) ────────────────────────────────────────────
  if (layer.type === 'symbol') {
    const layout = { ...layer.layout };
    const paint = { ...layer.paint };

    // Keep existing Noto Sans fonts (Caveat PBFs not yet available).
    // Bump text size slightly for a looser, more playful feel.
    if (layout['text-size'] != null) {
      layout['text-size'] = widenWidth(layout['text-size'], 1.15);
    }

    // Label colors — dark brown with cream halo
    if (paint['text-color'] != null) {
      // Water labels stay blue-ish
      if (idStartsWith(id, 'water_name', 'waterway_line_label')) {
        paint['text-color'] = '#2980B9';
        paint['text-halo-color'] = 'rgba(255, 248, 231, 0.85)';
      } else {
        paint['text-color'] = LABEL_BROWN;
        paint['text-halo-color'] = 'rgba(255, 248, 231, 0.85)';
      }
      paint['text-halo-width'] = 2;
    }

    layer.layout = layout;
    layer.paint = paint;
    return;
  }
}
