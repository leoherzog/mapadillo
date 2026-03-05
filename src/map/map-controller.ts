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
  private _markers: maplibregl.Marker[] = [];
  private _abortController?: AbortController;

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

    // Separate points and complete routes (filter out drafts with 0/null coords)
    const points = items.filter((i) => i.type === 'point' && !isDraftCoord(i.latitude, i.longitude));
    const routes = items.filter(
      (i) =>
        i.type === 'route' &&
        !isDraftCoord(i.latitude, i.longitude) &&
        i.dest_latitude != null &&
        i.dest_longitude != null &&
        !isDraftCoord(i.dest_latitude, i.dest_longitude),
    );

    // Fetch route geometries in parallel
    const routeResults = await Promise.all(
      routes.map(async (route) => {
        const mode = route.travel_mode ?? 'drive';
        try {
          const geometry = await getSegmentRoute(
            mode,
            [route.longitude, route.latitude],
            [route.dest_longitude!, route.dest_latitude!],
            signal,
          );
          if (signal.aborted) return null;
          return { route, mode, geometry };
        } catch (err) {
          console.warn(`Route fetch failed for item ${route.id} (${mode}):`, err);
          return null;
        }
      }),
    );
    if (signal.aborted) return { distances, totalDistance: 0, geometries };

    // Render route line layers + collect distances
    let totalDistance = 0;
    for (const result of routeResults) {
      if (!result) continue;
      this._renderSegmentLayer(result.route.id, result.mode, result.geometry);
      distances.set(result.route.id, result.geometry.distance);
      geometries.set(result.route.id, result.geometry);
      totalDistance += result.geometry.distance;
    }

    // Render point markers
    for (const point of points) {
      const marker = this._createMarker(point.icon, point.name, point.label, [point.longitude, point.latitude]);
      marker.addTo(this._map);
      this._markers.push(marker);
    }

    // Render route endpoint markers (start + end)
    for (const result of routeResults) {
      if (!result) continue;
      const { route } = result;
      const startMarker = this._createMarker(route.icon, route.name, 'Start', [route.longitude, route.latitude]);
      startMarker.addTo(this._map);
      this._markers.push(startMarker);

      const endMarker = this._createMarker(route.icon, route.dest_name ?? route.name, 'End', [route.dest_longitude!, route.dest_latitude!]);
      endMarker.addTo(this._map);
      this._markers.push(endMarker);
    }

    // Fit bounds to all visible coordinates
    this._fitBounds(items, routeResults.filter((r) => r != null));

    return { distances, totalDistance, geometries };
  }

  /** Remove all layers, sources, and markers. */
  clear(): void {
    for (const id of this._layerIds) {
      if (this._map.getLayer(id)) this._map.removeLayer(id);
      if (this._map.getSource(id)) this._map.removeSource(id);
    }
    this._layerIds = [];

    for (const m of this._markers) {
      m.getPopup()?.remove();
      m.remove();
    }
    this._markers = [];
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
  }

  private _createMarker(
    icon: string | null,
    name: string,
    label: string | null,
    lngLat: [number, number],
  ): maplibregl.Marker {
    const el = document.createElement('div');
    el.className = 'mapadillo-item-marker';
    el.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    `;

    // Icon pin
    const pin = document.createElement('div');
    pin.style.cssText = `
      background: white;
      border-radius: 50%;
      width: 1.8rem;
      height: 1.8rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2.5px solid #ff6b00;
      font-size: 0.9rem;
      color: #ff6b00;
    `;

    const iconEl = document.createElement('wa-icon');
    iconEl.setAttribute('name', icon ?? 'location-dot');
    iconEl.style.fontSize = '0.9rem';
    pin.appendChild(iconEl);

    el.appendChild(pin);

    // Popup with name + label
    const popupEl = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = name;
    popupEl.appendChild(strong);
    if (label) {
      popupEl.appendChild(document.createElement('br'));
      const em = document.createElement('em');
      em.textContent = label;
      popupEl.appendChild(em);
    }

    const popup = new maplibregl.Popup({ offset: 20, closeButton: false })
      .setDOMContent(popupEl);

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(lngLat)
      .setPopup(popup);

    el.addEventListener('mouseenter', () => popup.addTo(this._map));
    el.addEventListener('mouseleave', () => popup.remove());

    return marker;
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
