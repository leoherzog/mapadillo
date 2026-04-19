/**
 * Routing service — fetches route geometry per segment.
 *
 * - Drive/Walk/Bike: calls POST /api/route (Worker proxy → ORS)
 * - Plane: great-circle arc computed client-side (no API call)
 * - Boat: straight line computed client-side (no API call)
 *
 * Returns GeoJSON LineString coordinates + distance in meters.
 *
 * For callers that need to surface "rate limited" or "session expired"
 * feedback (instead of silently falling back to a straight line),
 * {@link getSegmentRouteResult} returns a tagged union. The legacy
 * {@link getSegmentRoute} entry point preserves the existing "always returns
 * geometry" contract by falling back to a straight line on error.
 */

import { apiPost, ApiError } from './api-client.js';
import { haversineDistance } from '../utils/geo.js';
import { TRAVEL_MODES } from '../config/travel-modes.js';
import type { ServiceResult } from './geocoding.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SegmentGeometry {
  /** GeoJSON coordinates: [[lon, lat], ...] */
  coordinates: [number, number][];
  /** Distance in meters */
  distance: number;
}

export type { ServiceResult, ServiceFailureReason } from './geocoding.js';

/** ORS travel mode -> ORS profile mapping (derived from shared config) */
const MODE_TO_PROFILE: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.filter((m) => m.orsProfile).map((m) => [m.mode, m.orsProfile!]),
);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get route geometry for a single segment, falling back to a straight line on
 * any API failure. Existing behavior used widely by the map controller.
 */
export async function getSegmentRoute(
  mode: string,
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal,
): Promise<SegmentGeometry> {
  if (mode === 'plane') return greatCircleArc(start, end);
  if (mode === 'boat') return straightLine(start, end);

  const profile = MODE_TO_PROFILE[mode];
  if (!profile) return straightLine(start, end);

  const result = await fetchORSRouteResult(profile, start, end, signal);
  return result.ok ? result.data : straightLine(start, end);
}

/**
 * Get route geometry with tagged failure reasons so UI code can distinguish
 * rate-limit / auth / network errors from a successful result. Plane and boat
 * modes always succeed (computed client-side).
 */
export async function getSegmentRouteResult(
  mode: string,
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal,
): Promise<ServiceResult<SegmentGeometry>> {
  if (mode === 'plane') return { ok: true, data: greatCircleArc(start, end) };
  if (mode === 'boat') return { ok: true, data: straightLine(start, end) };

  const profile = MODE_TO_PROFILE[mode];
  if (!profile) return { ok: true, data: straightLine(start, end) };

  return fetchORSRouteResult(profile, start, end, signal);
}

// ── ORS proxy call ───────────────────────────────────────────────────────────

interface ORSResponse {
  type: string;
  features: Array<{
    geometry: {
      type: string;
      coordinates: [number, number][];
    };
    properties: {
      summary: {
        distance: number; // meters
        duration: number; // seconds
      };
    };
  }>;
}

async function fetchORSRouteResult(
  profile: string,
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal,
): Promise<ServiceResult<SegmentGeometry>> {
  let data: ORSResponse;
  try {
    data = await apiPost<ORSResponse>('/api/route', { profile, start, end }, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    if (error instanceof ApiError) {
      if (error.status === 429) return { ok: false, reason: 'rate-limit', status: 429 };
      if (error.status === 401 || error.status === 403) {
        return { ok: false, reason: 'unauthorized', status: error.status };
      }
      return { ok: false, reason: 'upstream-error', status: error.status };
    }
    return { ok: false, reason: 'network' };
  }

  const feature = data.features?.[0];
  if (!feature?.geometry?.coordinates || !feature.properties?.summary) {
    // Upstream returned a malformed/empty response — treat as upstream error so
    // callers using the tagged variant can surface it; the legacy variant
    // converts this to a straight-line fallback.
    return { ok: false, reason: 'upstream-error' };
  }

  return {
    ok: true,
    data: {
      coordinates: feature.geometry.coordinates,
      distance: feature.properties.summary.distance,
    },
  };
}

// ── Client-side geometry ─────────────────────────────────────────────────────

/**
 * Flight arc between two points — a quadratic Bézier curve that arcs
 * perpendicular to the straight line, giving the classic airline-route-map look.
 * Distance is still the haversine (great-circle) distance.
 */
function greatCircleArc(
  start: [number, number],
  end: [number, number],
): SegmentGeometry {
  const NUM_POINTS = 64;
  const distance = haversineDistance(start, end);

  if (distance < 1) {
    return { coordinates: [start, end], distance: 0 };
  }

  // Correct for longitude compression at the mid-latitude
  const midLatRad = ((start[1] + end[1]) / 2) * (Math.PI / 180);
  const cosLat = Math.max(Math.cos(midLatRad), 0.01); // avoid division by zero at poles

  // Direction vector in approximately equidistant space
  const dLon = (end[0] - start[0]) * cosLat;
  const dLat = end[1] - start[1];
  const len = Math.sqrt(dLon * dLon + dLat * dLat);

  // Perpendicular unit vector (90° CCW), converted back to degree offsets
  const perpLon = -dLat / (len * cosLat);
  const perpLat = dLon / len;

  // Arc height scales with angular separation (20% of corrected span)
  const arcHeight = len * 0.2;

  // Quadratic Bézier control point: midpoint offset along the perpendicular
  const ctrlLon = (start[0] + end[0]) / 2 + perpLon * arcHeight;
  const ctrlLat = (start[1] + end[1]) / 2 + perpLat * arcHeight;

  // Interpolate quadratic Bézier
  const coords: [number, number][] = [];
  for (let i = 0; i <= NUM_POINTS; i++) {
    const t = i / NUM_POINTS;
    const u = 1 - t;
    coords.push([
      u * u * start[0] + 2 * u * t * ctrlLon + t * t * end[0],
      u * u * start[1] + 2 * u * t * ctrlLat + t * t * end[1],
    ]);
  }

  return { coordinates: coords, distance };
}

/**
 * Straight line between two points. Distance via Haversine formula.
 */
function straightLine(
  start: [number, number],
  end: [number, number],
): SegmentGeometry {
  return {
    coordinates: [start, end],
    distance: haversineDistance(start, end),
  };
}
