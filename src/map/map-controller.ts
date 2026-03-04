/**
 * Map controller — draws route segments and numbered stop markers on a MapLibre map.
 *
 * Each segment is its own MapLibre source + layer with mode-specific line style.
 * Stop markers show a numbered badge + the chosen Jelly icon.
 */
import maplibregl from 'maplibre-gl';
import type { Stop } from '../services/maps.js';
import { getSegmentRoute, type SegmentGeometry } from '../services/routing.js';

// ── Mode-specific line styles ────────────────────────────────────────────────

interface LineStyle {
  color: string;
  width: number;
  dasharray?: number[];
  lineCap?: CanvasLineCap;
}

const LINE_STYLES: Record<string, LineStyle> = {
  drive: { color: '#e05e00', width: 5, lineCap: 'round' },
  walk: { color: '#16a34a', width: 4, dasharray: [0, 2], lineCap: 'round' },
  bike: { color: '#0d9488', width: 4, dasharray: [3, 2], lineCap: 'round' },
  plane: { color: '#7c3aed', width: 3, dasharray: [1, 2], lineCap: 'round' },
  boat: { color: '#1e3a5f', width: 3, dasharray: [5, 3], lineCap: 'round' },
};

const DEFAULT_STYLE: LineStyle = { color: '#999', width: 3 };

// ── Segment result (stored for distance tracking) ────────────────────────────

export interface RenderedSegment {
  /** Index of the destination stop */
  index: number;
  mode: string;
  distance: number; // meters
  geometry: SegmentGeometry;
}

// ── Map Controller ───────────────────────────────────────────────────────────

export class MapController {
  private _map: maplibregl.Map;
  private _segmentIds: string[] = [];
  private _markers: maplibregl.Marker[] = [];
  private _segments: RenderedSegment[] = [];
  private _abortController?: AbortController;

  constructor(map: maplibregl.Map) {
    this._map = map;
  }

  /** Currently rendered segments (for distance summation). */
  get segments(): RenderedSegment[] {
    return this._segments;
  }

  /** Total distance in meters across all rendered segments. */
  get totalDistance(): number {
    return this._segments.reduce((sum, s) => sum + s.distance, 0);
  }

  /**
   * Draw all route segments and stop markers for the given stops.
   * Cancels any in-progress route fetching from a prior call.
   */
  async drawRoutes(stops: Stop[]): Promise<RenderedSegment[]> {
    // Cancel any in-progress fetches
    this._abortController?.abort();
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    // Clear previous layers and markers
    this.clear();

    if (stops.length === 0) return [];

    // Fetch all segment geometries in parallel
    const segmentPromises: Promise<RenderedSegment | null>[] = [];

    for (let i = 1; i < stops.length; i++) {
      const prev = stops[i - 1];
      const curr = stops[i];
      const mode = curr.travel_mode ?? 'drive'; // default to drive if unset

      segmentPromises.push(
        this._fetchSegment(i, mode, prev, curr, signal),
      );
    }

    const results = await Promise.all(segmentPromises);
    if (signal.aborted) return [];

    this._segments = results.filter((r): r is RenderedSegment => r !== null);

    // Render each segment on the map
    for (const seg of this._segments) {
      this._renderSegmentLayer(seg);
    }

    // Add numbered stop markers
    this._renderStopMarkers(stops);

    // Fit bounds to all stop coordinates + route geometries
    this._fitBounds(stops);

    return this._segments;
  }

  /** Remove all route layers, sources, and markers. */
  clear(): void {
    for (const id of this._segmentIds) {
      if (this._map.getLayer(id)) this._map.removeLayer(id);
      if (this._map.getSource(id)) this._map.removeSource(id);
    }
    this._segmentIds = [];

    for (const m of this._markers) m.remove();
    this._markers = [];

    this._segments = [];
  }

  /** Clean up resources. */
  destroy(): void {
    this._abortController?.abort();
    this.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async _fetchSegment(
    index: number,
    mode: string,
    from: Stop,
    to: Stop,
    signal: AbortSignal,
  ): Promise<RenderedSegment | null> {
    try {
      const geometry = await getSegmentRoute(
        mode,
        [from.longitude, from.latitude],
        [to.longitude, to.latitude],
        signal,
      );
      if (signal.aborted) return null;
      return { index, mode, distance: geometry.distance, geometry };
    } catch (err) {
      console.warn(`Route fetch failed for segment ${index} (${mode}):`, err);
      return null;
    }
  }

  private _renderSegmentLayer(seg: RenderedSegment): void {
    const id = `route-segment-${seg.index}-${Date.now()}`;
    const style = LINE_STYLES[seg.mode] ?? DEFAULT_STYLE;

    this._map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: seg.geometry.coordinates,
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

    this._segmentIds.push(id);
  }

  private _renderStopMarkers(stops: Stop[]): void {
    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      const marker = this._createNumberedMarker(i + 1, stop);
      marker.addTo(this._map);
      this._markers.push(marker);
    }
  }

  private _createNumberedMarker(
    number: number,
    stop: Stop,
  ): maplibregl.Marker {
    const el = document.createElement('div');
    el.className = 'mapadillo-stop-marker';
    el.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
    `;

    // Badge with number
    const badge = document.createElement('div');
    badge.style.cssText = `
      background: #ff6b00;
      color: white;
      font-size: 1.4rem;
      font-weight: 900;
      width: 1.4rem;
      height: 1.4rem;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid white;
      line-height: 1;
    `;
    badge.textContent = String(number);

    // Icon pin below the badge
    const pin = document.createElement('div');
    pin.style.cssText = `
      background: white;
      border-radius: 50%;
      width: 1.6rem;
      height: 1.6rem;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-top: -2px;
      border: 2px solid #ff6b00;
      font-size: 0.8rem;
      color: #ff6b00;
    `;

    // Use a wa-icon element for the Jelly icon
    const icon = document.createElement('wa-icon');
    icon.setAttribute('name', stop.icon ?? 'location-dot');
    icon.style.fontSize = '0.8rem';
    pin.appendChild(icon);

    el.appendChild(badge);
    el.appendChild(pin);

    // Popup with stop name + label (DOM-constructed to prevent XSS)
    const popupEl = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = stop.name;
    popupEl.appendChild(strong);
    if (stop.label) {
      popupEl.appendChild(document.createElement('br'));
      const em = document.createElement('em');
      em.textContent = stop.label;
      popupEl.appendChild(em);
    }

    const popup = new maplibregl.Popup({ offset: 25, closeButton: false })
      .setDOMContent(popupEl);

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([stop.longitude, stop.latitude])
      .setPopup(popup);

    // Hover to show/hide popup (spec: "hover/click")
    el.addEventListener('mouseenter', () => popup.addTo(this._map));
    el.addEventListener('mouseleave', () => popup.remove());

    return marker;
  }

  private _fitBounds(stops: Stop[]): void {
    if (stops.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    // Include all stop positions
    for (const stop of stops) {
      bounds.extend([stop.longitude, stop.latitude]);
    }

    // Include all route geometry points for more accurate bounds
    for (const seg of this._segments) {
      for (const coord of seg.geometry.coordinates) {
        bounds.extend(coord);
      }
    }

    if (stops.length >= 2) {
      this._map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    } else {
      this._map.flyTo({
        center: [stops[0].longitude, stops[0].latitude],
        zoom: 12,
      });
    }
  }
}
