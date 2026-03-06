/**
 * Map controller — draws route lines and item markers on a MapLibre map.
 *
 * Items are either **points** (single marker) or **routes** (A→B line + two markers).
 * Each route segment is its own MapLibre source + layer with mode-specific line style.
 */
import maplibregl from 'maplibre-gl';
import type { Stop } from '../services/maps.js';
import { getSegmentRoute, type SegmentGeometry } from '../services/routing.js';
import { isDraftCoord } from '../utils/geo.js';

import { TRAVEL_MODES } from '../config/travel-modes.js';

// ── Mode-specific line styles ────────────────────────────────────────────────

interface LineStyle {
  color: string;
  width: number;
  dasharray?: number[];
  lineCap?: CanvasLineCap;
}

const LINE_STYLE_OVERRIDES: Record<string, Omit<LineStyle, 'color'>> = {
  drive: { width: 5, lineCap: 'round' },
  walk:  { width: 4, dasharray: [0, 2], lineCap: 'round' },
  bike:  { width: 4, dasharray: [3, 2], lineCap: 'round' },
  plane: { width: 3, dasharray: [1, 2], lineCap: 'round' },
  boat:  { width: 3, dasharray: [5, 3], lineCap: 'round' },
};

const LINE_STYLES: Record<string, LineStyle> = Object.fromEntries(
  TRAVEL_MODES.map((m) => [m.mode, { color: m.hexColor, ...LINE_STYLE_OVERRIDES[m.mode] }]),
);

const DEFAULT_STYLE: LineStyle = { color: '#999', width: 3 };

// ── Marker image rendering ──────────────────────────────────────────────────

/** Pixel size of composite marker images registered with the map. */
const MARKER_IMG_SIZE = 48;

/**
 * Extract the resolved SVG element from a wa-icon's shadow DOM.
 * Creates a temporary wa-icon, waits for the icon to load, then clones the SVG.
 */
const _svgCache = new Map<string, SVGSVGElement | null>();

async function extractIconSvg(iconName: string): Promise<SVGSVGElement | null> {
  if (_svgCache.has(iconName)) return _svgCache.get(iconName)!;

  const el = document.createElement('wa-icon') as HTMLElement & { updateComplete: Promise<boolean> };
  el.setAttribute('name', iconName);
  el.style.cssText = 'position:fixed;left:-9999px;visibility:hidden';

  try {
    // Listen before appending so we never miss the event
    const loaded = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
      el.addEventListener('wa-load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      el.addEventListener('wa-error', () => { clearTimeout(timeout); reject(new Error('error')); }, { once: true });
    });

    document.body.appendChild(el);
    await loaded;

    // wa-load fires before Lit re-renders — wait for the real SVG to land in the DOM
    await el.updateComplete;

    const svg = el.shadowRoot?.querySelector('svg');
    const result = svg?.querySelector('path') ? svg.cloneNode(true) as SVGSVGElement : null;
    _svgCache.set(iconName, result);
    return result;
  } catch {
    _svgCache.set(iconName, null);
    return null;
  } finally {
    el.remove();
  }
}

/**
 * Render a composite marker image (white circle + orange border + icon SVG)
 * onto an offscreen canvas and return it. Used by both the map symbol layer
 * registration and the export canvas drawing.
 */
export async function renderMarkerCanvas(iconName: string, size: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const center = size / 2;
  const radius = size / 2 - 3 * (size / MARKER_IMG_SIZE);
  const borderWidth = 3 * (size / MARKER_IMG_SIZE);

  // White circle with orange stroke
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = '#ff6b00';
  ctx.stroke();

  const svgEl = await extractIconSvg(iconName);
  if (svgEl) {
    const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
    svgClone.querySelectorAll('[fill]').forEach((el) => el.setAttribute('fill', '#ff6b00'));
    svgClone.querySelectorAll('path:not([fill])').forEach((el) => el.setAttribute('fill', '#ff6b00'));

    const vb = svgClone.getAttribute('viewBox')?.split(/\s+/).map(Number);
    const svgW = vb?.[2] ?? size;
    const svgH = vb?.[3] ?? size;
    const maxIconSize = size * 0.52;
    const scale = Math.min(maxIconSize / svgW, maxIconSize / svgH);
    const drawW = svgW * scale;
    const drawH = svgH * scale;

    svgClone.setAttribute('width', String(drawW));
    svgClone.setAttribute('height', String(drawH));

    const svgStr = new XMLSerializer().serializeToString(svgClone);
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;

    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataUrl;
      });
      ctx.drawImage(img, (size - drawW) / 2, (size - drawH) / 2, drawW, drawH);
    } catch {
      _drawFallbackDot(ctx, center, center, radius);
    }
  } else {
    _drawFallbackDot(ctx, center, center, radius);
  }

  return canvas;
}

function _drawFallbackDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.3, 0, Math.PI * 2);
  ctx.fillStyle = '#ff6b00';
  ctx.fill();
}

// ── Result type ──────────────────────────────────────────────────────────────

interface DrawItemsResult {
  /** Per-route distances keyed by item id */
  distances: Map<string, number>;
  /** Sum of all route distances in meters */
  totalDistance: number;
  /** Per-route geometries keyed by item id (for caching to D1) */
  geometries: Map<string, SegmentGeometry>;
}

// ── Map Controller ───────────────────────────────────────────────────────────

export class MapController {
  private _map: maplibregl.Map;
  private _layerIds: string[] = [];
  private _sourceIds: string[] = [];
  private _abortController?: AbortController;
  private _markerFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];

  /** Offset marker coordinates used for rendering. Used by export to match live map positions. */
  get markerFeatures(): GeoJSON.Feature<GeoJSON.Point>[] {
    return this._markerFeatures;
  }

  constructor(map: maplibregl.Map) {
    this._map = map;
  }

  /**
   * Draw all items (points + routes) on the map.
   * Cancels any in-progress route fetching from a prior call.
   */
  async drawItems(items: Stop[]): Promise<DrawItemsResult> {
    this._abortController?.abort();
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    this.clear();

    const distances = new Map<string, number>();
    const geometries = new Map<string, SegmentGeometry>();
    if (items.length === 0) return { distances, totalDistance: 0, geometries };

    // Identify renderable routes and fetch geometries in parallel
    const routeGeometries = new Map<string, { mode: string; geometry: SegmentGeometry }>();
    const routeItems = items.filter(
      (i) =>
        i.type === 'route' &&
        !isDraftCoord(i.latitude, i.longitude) &&
        i.dest_latitude != null &&
        i.dest_longitude != null &&
        !isDraftCoord(i.dest_latitude, i.dest_longitude),
    );
    await Promise.all(
      routeItems.map(async (route) => {
        const mode = route.travel_mode ?? 'drive';
        try {
          // Use cached geometry from D1 if available
          if (route.route_geometry) {
            try {
              const cached = JSON.parse(route.route_geometry) as SegmentGeometry;
              if (cached.coordinates?.length) {
                routeGeometries.set(route.id, { mode, geometry: cached });
                return;
              }
            } catch { /* invalid cache — fall through to fetch */ }
          }
          const geometry = await getSegmentRoute(
            mode,
            [route.longitude, route.latitude],
            [route.dest_longitude!, route.dest_latitude!],
            signal,
          );
          if (!signal.aborted) routeGeometries.set(route.id, { mode, geometry });
        } catch (err) {
          console.warn(`Route fetch failed for item ${route.id} (${mode}):`, err);
        }
      }),
    );
    if (signal.aborted) return { distances, totalDistance: 0, geometries };

    // Render items in list order so later items layer on top.
    // Route line layers are added first (all of them), then markers,
    // because MapLibre markers (DOM) always sit above tile layers.
    // Within each group the list order is preserved.
    let totalDistance = 0;
    for (const item of items) {
      if (item.type === 'route') {
        const result = routeGeometries.get(item.id);
        if (!result) continue;
        this._renderSegmentLayer(item.id, result.mode, result.geometry);
        distances.set(item.id, result.geometry.distance);
        geometries.set(item.id, result.geometry);
        totalDistance += result.geometry.distance;
      }
    }

    // Collect marker positions as GeoJSON features for a native symbol layer.
    // Using map-native layers avoids the zoom-dependent drift that DOM markers cause.
    const placedCoords = new Set<string>();
    const coordKey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
    const markerFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
    const usedIcons = new Set<string>();
    const addFeature = (icon: string, name: string, lngLat: [number, number], sortKey: number) => {
      const key = coordKey(lngLat[0], lngLat[1]);
      if (placedCoords.has(key)) return;
      placedCoords.add(key);
      const imageId = `marker-${icon}`;
      usedIcons.add(icon);
      markerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: lngLat },
        properties: { name, icon: imageId, sortKey },
      });
    };

    for (const item of items) {
      if (item.type === 'point' && !isDraftCoord(item.latitude, item.longitude)) {
        addFeature(item.icon ?? 'location-dot', item.name, [item.longitude, item.latitude], 1);
      } else if (item.type === 'route') {
        if (!routeGeometries.has(item.id)) continue;
        addFeature(item.icon ?? 'location-dot', item.name, [item.longitude, item.latitude], 0);
        addFeature(item.icon ?? 'location-dot', item.dest_name ?? item.name, [item.dest_longitude!, item.dest_latitude!], 0);
      }
    }

    if (markerFeatures.length > 0) {
      // Compute the target zoom before placing markers so we can offset overlapping ones
      const bounds = this._computeBounds(items, routeGeometries);
      let offsetFeatures = markerFeatures;

      if (bounds && markerFeatures.length >= 2) {
        const camera = this._map.cameraForBounds(bounds, { padding: 60, maxZoom: 14 });
        if (camera?.zoom != null && camera.center) {
          const centerLat = camera.center instanceof maplibregl.LngLat
            ? camera.center.lat
            : (camera.center as [number, number])[1];
          offsetFeatures = this._offsetOverlappingFeatures(markerFeatures, camera.zoom, centerLat);
        }
      }

      this._markerFeatures = offsetFeatures;
      await this._registerMarkerImages(usedIcons);
      this._addMarkerLayers(offsetFeatures);
    } else {
      this._markerFeatures = [];
    }

    // Fit bounds to all visible coordinates
    const routeResults = [...routeGeometries.entries()].map(([id, r]) => ({
      route: items.find((i) => i.id === id)!,
      geometry: r.geometry,
    }));
    this._fitBounds(items, routeResults);

    return { distances, totalDistance, geometries };
  }

  /** Remove all layers and sources. */
  clear(): void {
    for (const id of this._layerIds) {
      if (this._map.getLayer(id)) this._map.removeLayer(id);
    }
    for (const id of this._sourceIds) {
      if (this._map.getSource(id)) this._map.removeSource(id);
    }
    this._layerIds = [];
    this._sourceIds = [];
    this._markerFeatures = [];
  }

  /** Clean up resources. */
  destroy(): void {
    this._abortController?.abort();
    this.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private _renderSegmentLayer(itemId: string, mode: string, geometry: SegmentGeometry): void {
    const id = `route-${itemId}`;
    const style = LINE_STYLES[mode] ?? DEFAULT_STYLE;

    this._map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: geometry.coordinates,
        },
      },
    });

    const paint: Record<string, unknown> = {
      'line-color': style.color,
      'line-width': style.width,
      'line-opacity': 0.85,
    };

    const layout: Record<string, unknown> = {
      'line-join': 'round',
      'line-cap': style.lineCap ?? 'round',
    };

    this._map.addLayer({
      id,
      type: 'line',
      source: id,
      layout,
      paint: style.dasharray
        ? { ...paint, 'line-dasharray': style.dasharray }
        : paint,
    });

    this._layerIds.push(id);
    this._sourceIds.push(id);
  }

  private _addMarkerLayers(features: GeoJSON.Feature<GeoJSON.Point>[]): void {
    const sourceId = 'item-markers';

    this._map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Single symbol layer: composite icon image + name label
    const layerId = 'item-markers-symbol';
    this._map.addLayer({
      id: layerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': 0.5,
        'icon-allow-overlap': true,
        'symbol-sort-key': ['get', 'sortKey'],
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 1.4,
        'text-justify': 'auto',
        'text-max-width': 10,
        'text-allow-overlap': false,
        'text-optional': true,
      },
      paint: {
        'text-color': '#333333',
        'text-halo-color': 'rgba(255, 255, 255, 0.85)',
        'text-halo-width': 2,
      },
    });

    this._layerIds.push(layerId);
    this._sourceIds.push(sourceId);
  }

  // ── Marker image registration ─────────────────────────────────────────

  private async _registerMarkerImages(icons: Set<string>): Promise<void> {
    await Promise.all([...icons].map((name) => this._registerMarkerImage(name)));
  }

  private async _registerMarkerImage(iconName: string): Promise<void> {
    const imageId = `marker-${iconName}`;
    if (this._map.hasImage(imageId)) return;

    const canvas = await renderMarkerCanvas(iconName, MARKER_IMG_SIZE);
    const ctx = canvas.getContext('2d')!;
    this._map.addImage(imageId, ctx.getImageData(0, 0, MARKER_IMG_SIZE, MARKER_IMG_SIZE));
  }

  /** Compute LngLatBounds for all items + route geometries, or null if no coords. */
  private _computeBounds(
    items: Stop[],
    routeGeometries: Map<string, { mode: string; geometry: SegmentGeometry }>,
  ): maplibregl.LngLatBounds | null {
    const bounds = new maplibregl.LngLatBounds();
    let coordCount = 0;
    for (const item of items) {
      if (isDraftCoord(item.latitude, item.longitude)) continue;
      bounds.extend([item.longitude, item.latitude]);
      coordCount++;
      if (item.dest_latitude != null && item.dest_longitude != null && !isDraftCoord(item.dest_latitude, item.dest_longitude)) {
        bounds.extend([item.dest_longitude, item.dest_latitude]);
        coordCount++;
      }
    }
    for (const [, r] of routeGeometries) {
      for (const coord of r.geometry.coordinates) bounds.extend(coord);
    }
    return coordCount >= 2 ? bounds : null;
  }

  /**
   * Offset features that overlap at the given zoom so all icons are visible.
   * Groups nearby features into clusters and distributes them in a ring.
   */
  private _offsetOverlappingFeatures(
    features: GeoJSON.Feature<GeoJSON.Point>[],
    zoom: number,
    centerLat: number,
  ): GeoJSON.Feature<GeoJSON.Point>[] {
    if (features.length < 2) return features;

    // Meters per pixel at this zoom (Web Mercator formula)
    const metersPerPixel = (40075016.686 * Math.cos((centerLat * Math.PI) / 180)) / (512 * Math.pow(2, zoom));
    // 24px threshold (48px icon at 0.5 scale)
    const thresholdMeters = 24 * metersPerPixel;
    const thresholdLat = thresholdMeters / 111_320;
    const thresholdLng = thresholdMeters / (111_320 * Math.cos((centerLat * Math.PI) / 180));

    // Union-find to group overlapping features
    const parent = features.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a: number, b: number) => { parent[find(a)] = find(b); };

    for (let i = 0; i < features.length; i++) {
      const [lngA, latA] = features[i].geometry.coordinates;
      for (let j = i + 1; j < features.length; j++) {
        const [lngB, latB] = features[j].geometry.coordinates;
        if (Math.abs(lngA - lngB) < thresholdLng && Math.abs(latA - latB) < thresholdLat) {
          union(i, j);
        }
      }
    }

    // Group by cluster root
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < features.length; i++) {
      const root = find(i);
      let group = clusters.get(root);
      if (!group) { group = []; clusters.set(root, group); }
      group.push(i);
    }

    // Deep-copy features and offset clusters with size > 1
    const result = features.map((f) => ({
      ...f,
      geometry: { ...f.geometry, coordinates: [...f.geometry.coordinates] as [number, number] },
    }));

    const ringRadius = thresholdLat * 0.7;
    const ringRadiusLng = thresholdLng * 0.7;
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      // Compute centroid
      let cLng = 0, cLat = 0;
      for (const idx of members) {
        cLng += features[idx].geometry.coordinates[0];
        cLat += features[idx].geometry.coordinates[1];
      }
      cLng /= members.length;
      cLat /= members.length;
      // Distribute in ring
      for (let k = 0; k < members.length; k++) {
        const angle = (2 * Math.PI * k) / members.length;
        result[members[k]].geometry.coordinates = [
          cLng + ringRadiusLng * Math.cos(angle),
          cLat + ringRadius * Math.sin(angle),
        ];
      }
    }

    return result;
  }

  private _fitBounds(
    items: Stop[],
    routeResults: Array<{ route: Stop; geometry: SegmentGeometry }>,
  ): void {
    const bounds = new maplibregl.LngLatBounds();
    let coordCount = 0;

    // Include all non-draft item positions
    for (const item of items) {
      if (isDraftCoord(item.latitude, item.longitude)) continue;
      bounds.extend([item.longitude, item.latitude]);
      coordCount++;
      // Include route destinations
      if (item.dest_latitude != null && item.dest_longitude != null && !isDraftCoord(item.dest_latitude, item.dest_longitude)) {
        bounds.extend([item.dest_longitude, item.dest_latitude]);
        coordCount++;
      }
    }

    // Include route geometry points for accurate bounds
    for (const result of routeResults) {
      for (const coord of result.geometry.coordinates) {
        bounds.extend(coord);
      }
    }

    if (coordCount === 0) return;

    if (coordCount >= 2) {
      this._map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    } else {
      const first = items.find((i) => !isDraftCoord(i.latitude, i.longitude))!;
      this._map.flyTo({
        center: [first.longitude, first.latitude],
        zoom: 12,
      });
    }
  }
}
