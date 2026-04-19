/**
 * Map controller — draws route lines and item markers on a MapLibre map.
 *
 * Items are either **points** (single marker) or **routes** (A→B line + two markers).
 * Each route segment is its own MapLibre source + layer with mode-specific line style.
 */
import maplibregl from 'maplibre-gl';
import type { RouteStop, Stop } from '../services/maps.js';
import { getSegmentRoute, type SegmentGeometry } from '../services/routing.js';
import { isDraftCoord } from '../utils/geo.js';

import { TRAVEL_MODES } from '../config/travel-modes.js';
import type { MapControllerOptions } from '../config/map-themes.js';

// ── Active map center (singleton for location bias) ─────────────────────────

let _activeMap: maplibregl.Map | null = null;

/** Returns the current center of the active map, or null if no map is active. */
export function getActiveMapCenter(): { lat: number; lon: number } | null {
  if (!_activeMap) return null;
  const c = _activeMap.getCenter();
  return { lat: c.lat, lon: c.lng };
}

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
  /** Original (true lat/lng) features before any overlap offset. */
  private _originalFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
  private _zoomHandler?: () => void;
  private _labelFont: string[];
  private _labelColor: string;
  private _labelHaloColor: string;
  private _onItemClick?: (itemId: string) => void;
  private _clickHandler?: (e: maplibregl.MapMouseEvent) => void;
  private _pointerEnterHandler?: () => void;
  private _pointerLeaveHandler?: () => void;

  /** Offset marker coordinates used for rendering. Used by export to match live map positions. */
  get markerFeatures(): GeoJSON.Feature<GeoJSON.Point>[] {
    return this._markerFeatures;
  }

  constructor(map: maplibregl.Map, options?: MapControllerOptions) {
    this._map = map;
    this._labelFont = options?.labelFont ?? ['Noto Sans Bold'];
    this._labelColor = options?.labelColor ?? '#333333';
    this._labelHaloColor = options?.labelHaloColor ?? 'rgba(255, 255, 255, 0.85)';
    this._onItemClick = options?.onItemClick;
    _activeMap = map;
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
      (i): i is RouteStop =>
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
    //
    // Dedup strategy: features at the same coord are merged into a single
    // feature that combines their names (with a bullet separator). This
    // prevents stacked labels while preserving every label's text — in
    // particular, a point that happens to share coords with a route endpoint
    // won't cause the route-dest label to disappear. Because points render on
    // top (separate layer) and have higher placement priority (sortKey=0),
    // if any member of the cluster is a point we keep the point's icon and
    // sortKey so the visible marker matches the point.
    const coordKey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
    const featuresByCoord = new Map<string, GeoJSON.Feature<GeoJSON.Point>>();
    const markerFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
    const usedIcons = new Set<string>();
    const addFeature = (icon: string, name: string, lngLat: [number, number], sortKey: number, itemId: string) => {
      const key = coordKey(lngLat[0], lngLat[1]);
      const existing = featuresByCoord.get(key);
      const imageId = `marker-${icon}`;
      usedIcons.add(icon);
      if (existing) {
        // Merge label text (avoid duplicates)
        const existingName = String(existing.properties!.name);
        if (existingName !== name && !existingName.includes(name)) {
          existing.properties!.name = `${existingName} \u00B7 ${name}`;
        }
        // If this feature has higher priority (lower sortKey, i.e. a point),
        // take over icon + sortKey + itemId so it renders on the top layer.
        if (sortKey < (existing.properties!.sortKey as number)) {
          existing.properties!.icon = imageId;
          existing.properties!.sortKey = sortKey;
          existing.properties!.itemId = itemId;
        }
        return;
      }
      const feature: GeoJSON.Feature<GeoJSON.Point> = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: lngLat },
        properties: { name, icon: imageId, sortKey, itemId },
      };
      featuresByCoord.set(key, feature);
      markerFeatures.push(feature);
    };

    for (const item of items) {
      if (item.type === 'point' && !isDraftCoord(item.latitude, item.longitude)) {
        const icon = item.icon ?? 'location-dot';
        if (icon !== 'none') addFeature(icon, item.name, [item.longitude, item.latitude], 0, item.id);
      }
    }

    for (const item of items) {
      if (item.type === 'route') {
        if (!routeGeometries.has(item.id)) continue;
        const startIcon = item.icon ?? 'location-dot';
        const endIcon = item.dest_icon ?? item.icon ?? 'location-dot';
        if (startIcon !== 'none') addFeature(startIcon, item.name, [item.longitude, item.latitude], 1, item.id);
        if (endIcon !== 'none') addFeature(endIcon, item.dest_name ?? item.name, [item.dest_longitude!, item.dest_latitude!], 1, item.id);
      }
    }

    // Sort features so that lower sortKeys (points) render last (on top).
    // Point markers and route-endpoint markers go to separate layers
    // (see _addMarkerLayers), so this sort only affects order within each layer.
    markerFeatures.sort((a, b) => (b.properties!.sortKey as number) - (a.properties!.sortKey as number));

    // Compute bounds once — used for initial offset calculation and camera fitting
    const bounds = this._computeBounds(items, routeGeometries);

    if (markerFeatures.length > 0) {
      this._originalFeatures = markerFeatures;

      // Calculate initial offsets using the camera zoom that fitBounds will target
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

      // Recalculate offsets on every zoom change so markers converge to
      // true positions as the user zooms in, and spread apart when zoomed out.
      this._zoomHandler = () => this._recalculateOffsets();
      this._map.on('zoomend', this._zoomHandler);

      // Set up click handlers for map→sidebar interactivity
      this._setupClickHandlers();
    } else {
      this._originalFeatures = [];
      this._markerFeatures = [];
    }

    // Fit bounds to all visible coordinates (reuse pre-computed bounds)
    this._fitBounds(items, bounds);

    return { distances, totalDistance, geometries };
  }

  /** Remove all layers and sources. */
  clear(): void {
    this._teardownClickHandlers();
    if (this._zoomHandler) {
      this._map.off('zoomend', this._zoomHandler);
      this._zoomHandler = undefined;
    }
    for (const id of this._layerIds) {
      if (this._map.getLayer(id)) this._map.removeLayer(id);
    }
    for (const id of this._sourceIds) {
      if (this._map.getSource(id)) this._map.removeSource(id);
    }
    this._layerIds = [];
    this._sourceIds = [];
    this._originalFeatures = [];
    this._markerFeatures = [];
  }

  /** Clean up resources. */
  destroy(): void {
    this._abortController?.abort();
    this.clear();
    if (_activeMap === this._map) _activeMap = null;
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
    // Split into two layers so points always render above route endpoints.
    // MapLibre renders later layers on top.
    const routeFeatures = features.filter((f) => f.properties!.sortKey === 1);
    const pointFeatures = features.filter((f) => f.properties!.sortKey === 0);

    // Route endpoint markers (rendered first = below)
    if (routeFeatures.length > 0) {
      this._addSymbolLayer('route-markers', routeFeatures);
    }

    // Point markers (rendered second = on top)
    if (pointFeatures.length > 0) {
      this._addSymbolLayer('point-markers', pointFeatures);
    }
  }

  private _addSymbolLayer(id: string, features: GeoJSON.Feature<GeoJSON.Point>[]): void {
    const sourceId = id;
    const layerId = `${id}-symbol`;

    this._map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    this._map.addLayer({
      id: layerId,
      type: 'symbol',
      source: sourceId,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': 0.5,
        'icon-allow-overlap': true,
        'icon-padding': 2,
        'text-field': ['get', 'name'],
        'text-font': this._labelFont,
        'text-size': 11,
        'text-variable-anchor': [
          'top', 'bottom', 'left', 'right',
          'top-left', 'top-right', 'bottom-left', 'bottom-right',
        ],
        'text-radial-offset': 1.6,
        'text-justify': 'auto',
        'text-max-width': 10,
        'text-overlap': 'always',
        'text-padding': 4,
      },
      paint: {
        'text-color': this._labelColor,
        'text-halo-color': this._labelHaloColor,
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
      if (
        item.type === 'route' &&
        item.dest_latitude != null && item.dest_longitude != null &&
        !isDraftCoord(item.dest_latitude, item.dest_longitude)
      ) {
        bounds.extend([item.dest_longitude, item.dest_latitude]);
        coordCount++;
      }
    }
    for (const [, r] of routeGeometries) {
      for (const coord of r.geometry.coordinates) bounds.extend(coord);
    }
    return coordCount >= 2 ? bounds : null;
  }

  /** Recalculate marker offsets for the current zoom and update GeoJSON sources. */
  private _recalculateOffsets(): void {
    if (this._originalFeatures.length < 2) return;

    const zoom = this._map.getZoom();
    const centerLat = this._map.getCenter().lat;
    const offsetFeatures = this._offsetOverlappingFeatures(this._originalFeatures, zoom, centerLat);
    this._markerFeatures = offsetFeatures;

    // Update existing GeoJSON sources in-place
    const routeFeatures = offsetFeatures.filter((f) => f.properties!.sortKey === 1);
    const pointFeatures = offsetFeatures.filter((f) => f.properties!.sortKey === 0);

    const routeSrc = this._map.getSource('route-markers') as maplibregl.GeoJSONSource | undefined;
    if (routeSrc) routeSrc.setData({ type: 'FeatureCollection', features: routeFeatures });

    const pointSrc = this._map.getSource('point-markers') as maplibregl.GeoJSONSource | undefined;
    if (pointSrc) pointSrc.setData({ type: 'FeatureCollection', features: pointFeatures });
  }

  /**
   * Offset features that overlap at the given zoom so all icons are visible.
   * Groups nearby features into clusters and distributes them in a ring.
   * At high zoom levels the pixel threshold maps to negligible geographic
   * distance, so markers converge to their true lat/lng positions.
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

    // Check if any cluster has >1 member — if not, skip the copy
    let hasOverlap = false;
    for (const members of clusters.values()) {
      if (members.length > 1) { hasOverlap = true; break; }
    }
    if (!hasOverlap) return features;

    // Deep-copy features and offset clusters with size > 1
    const result = features.map((f) => ({
      ...f,
      geometry: { ...f.geometry, coordinates: [...f.geometry.coordinates] as [number, number] },
    }));

    const ringRadius = thresholdLat;
    const ringRadiusLng = thresholdLng;
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

      const n = members.length;
      const minGap = (2 * Math.PI) / n;

      // Compute each member's bearing from centroid, sorted to preserve
      // relative angular order when we need to redistribute.
      const memberAngles: { idx: number; angle: number }[] = members.map((idx) => {
        const [lng, lat] = features[idx].geometry.coordinates;
        return { idx, angle: Math.atan2(lat - cLat, lng - cLng) };
      });

      // Detect degenerate case: all members at the exact same spot
      const allSameSpot = memberAngles.every(({ idx }) => {
        const [lng, lat] = features[idx].geometry.coordinates;
        return Math.abs(lng - cLng) < 1e-10 && Math.abs(lat - cLat) < 1e-10;
      });

      if (allSameSpot) {
        // Evenly-spaced ring for coincident points
        for (let k = 0; k < n; k++) {
          const angle = minGap * k;
          result[members[k]].geometry.coordinates = [
            cLng + ringRadiusLng * Math.cos(angle),
            cLat + ringRadius * Math.sin(angle),
          ];
        }
        continue;
      }

      // Sort by bearing so we can check/enforce angular gaps
      memberAngles.sort((a, b) => a.angle - b.angle);

      // Check if any adjacent pair (including wrap-around) is too close
      let needsRedistribute = false;
      for (let k = 0; k < n; k++) {
        const next = (k + 1) % n;
        let gap = memberAngles[next].angle - memberAngles[k].angle;
        if (next === 0) gap += 2 * Math.PI;
        if (gap < minGap * 0.8) {
          needsRedistribute = true;
          break;
        }
      }

      if (needsRedistribute) {
        // Bearings are bunched — redistribute evenly, preserving angular
        // order, centered on the circular mean direction.
        let sinSum = 0, cosSum = 0;
        for (const { angle } of memberAngles) {
          sinSum += Math.sin(angle);
          cosSum += Math.cos(angle);
        }
        const circularMean = Math.atan2(sinSum, cosSum);

        for (let k = 0; k < n; k++) {
          const angle = circularMean + minGap * (k - (n - 1) / 2);
          result[memberAngles[k].idx].geometry.coordinates = [
            cLng + ringRadiusLng * Math.cos(angle),
            cLat + ringRadius * Math.sin(angle),
          ];
        }
      } else {
        // Natural bearings are well-separated — use them directly
        for (const { idx, angle } of memberAngles) {
          result[idx].geometry.coordinates = [
            cLng + ringRadiusLng * Math.cos(angle),
            cLat + ringRadius * Math.sin(angle),
          ];
        }
      }
    }

    return result;
  }

  private _fitBounds(items: Stop[], bounds: maplibregl.LngLatBounds | null): void {
    if (bounds) {
      this._map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    } else {
      // Single coordinate — fly to it
      const first = items.find((i) => !isDraftCoord(i.latitude, i.longitude));
      if (first) {
        this._map.flyTo({
          center: [first.longitude, first.latitude],
          zoom: 12,
        });
      }
    }
  }

  // ── Click handlers for map→sidebar interactivity ───────────────────────

  private _setupClickHandlers(): void {
    if (!this._onItemClick) return;

    // All clickable layer IDs: symbol layers + route line layers
    const clickableLayers = this._layerIds.filter(
      (id) => id.endsWith('-symbol') || id.startsWith('route-'),
    );
    if (clickableLayers.length === 0) return;

    this._clickHandler = (e: maplibregl.MapMouseEvent) => {
      // Query all clickable layers at the click point
      const features = this._map.queryRenderedFeatures(e.point, { layers: clickableLayers });
      if (!features.length) return;

      const feature = features[0];
      let itemId: string | undefined;

      // Symbol layers carry itemId in properties
      if (feature.properties?.itemId) {
        itemId = feature.properties.itemId;
      }
      // Route line layers are named "route-{itemId}"
      else if (feature.layer?.id?.startsWith('route-')) {
        itemId = feature.layer.id.slice('route-'.length);
      }

      if (itemId) this._onItemClick!(itemId);
    };

    this._pointerEnterHandler = () => {
      this._map.getCanvas().style.cursor = 'pointer';
    };
    this._pointerLeaveHandler = () => {
      this._map.getCanvas().style.cursor = '';
    };

    for (const layerId of clickableLayers) {
      this._map.on('click', layerId, this._clickHandler);
      this._map.on('mouseenter', layerId, this._pointerEnterHandler);
      this._map.on('mouseleave', layerId, this._pointerLeaveHandler);
    }
  }

  private _teardownClickHandlers(): void {
    if (!this._clickHandler) return;

    const clickableLayers = this._layerIds.filter(
      (id) => id.endsWith('-symbol') || id.startsWith('route-'),
    );

    for (const layerId of clickableLayers) {
      this._map.off('click', layerId, this._clickHandler);
      if (this._pointerEnterHandler) this._map.off('mouseenter', layerId, this._pointerEnterHandler);
      if (this._pointerLeaveHandler) this._map.off('mouseleave', layerId, this._pointerLeaveHandler);
    }

    this._clickHandler = undefined;
    this._pointerEnterHandler = undefined;
    this._pointerLeaveHandler = undefined;
  }
}
