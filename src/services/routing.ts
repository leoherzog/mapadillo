/**
 * Routing service — fetches route geometry per segment.
 *
 * - Drive/Walk/Bike: calls POST /api/route (Worker proxy → ORS)
 * - Plane: curved flight arc computed client-side (no API call)
 * - Boat: straight line computed client-side (no API call)
 *
 * Returns GeoJSON LineString coordinates + distance in meters.
 */

import { apiPost, ApiError } from './api-client.js';
import { haversineDistance } from '../utils/geo.js';
import { TRAVEL_MODES } from '../../shared/travel-modes.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SegmentGeometry {
  /** GeoJSON coordinates: [[lon, lat], ...] */
  coordinates: [number, number][];
  /** Distance in meters */
  distance: number;
  /** True when this straight line stands in for a route that could not be computed; callers should not cache it. */
  fallback?: true;
}

/** ORS travel mode -> ORS profile mapping (derived from shared config) */
const MODE_TO_PROFILE: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.filter((m) => m.orsProfile).map((m) => [m.mode, m.orsProfile!]),
);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get route geometry for a single segment. On failure, except abort, returns a
 * straight line, flagged `fallback` unless ORS reported no route.
 * @throws AbortError when the request is cancelled
 */
export async function getSegmentRoute(
  mode: string,
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal,
): Promise<SegmentGeometry> {
  if (mode === 'plane') return flightArc(start, end);
  if (mode === 'boat') return straightLine(start, end);

  const profile = MODE_TO_PROFILE[mode];
  if (!profile) return { ...straightLine(start, end), fallback: true };

  return (await fetchORSRoute(profile, start, end, signal)) ?? { ...straightLine(start, end), fallback: true };
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

/** Fetch an ORS route; a straight line when ORS finds no route, null on any other failure except abort. */
async function fetchORSRoute(
  profile: string,
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal,
): Promise<SegmentGeometry | null> {
  let data: ORSResponse;
  try {
    data = await apiPost<ORSResponse>('/api/route', { profile, start, end }, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    // 422: ORS found no route between these points, a stable answer whose straight line may be cached.
    if (error instanceof ApiError && error.status === 422) return straightLine(start, end);
    return null;
  }

  const feature = data.features?.[0];
  if (!feature?.geometry?.coordinates || !feature.properties?.summary) return null;

  return {
    coordinates: feature.geometry.coordinates,
    distance: feature.properties.summary.distance,
  };
}

// ── Client-side geometry ─────────────────────────────────────────────────────

/** Shift `end` by ±360° longitude so the segment takes the short way across the antimeridian. */
function unwrapEnd(start: [number, number], end: [number, number]): [number, number] {
  const d = end[0] - start[0];
  if (d > 180) return [end[0] - 360, end[1]];
  if (d < -180) return [end[0] + 360, end[1]];
  return end;
}

/**
 * Flight arc between two points — a quadratic Bézier curve that arcs
 * perpendicular to the straight line, giving the classic airline-route-map look.
 * Distance is still the haversine (great-circle) distance.
 */
function flightArc(
  start: [number, number],
  end: [number, number],
): SegmentGeometry {
  const NUM_POINTS = 64;
  const distance = haversineDistance(start, end);

  if (distance < 1) {
    return { coordinates: [start, end], distance: 0 };
  }

  const e = unwrapEnd(start, end);

  // Correct for longitude compression at the mid-latitude
  const midLatRad = ((start[1] + e[1]) / 2) * (Math.PI / 180);
  const cosLat = Math.max(Math.cos(midLatRad), 0.01); // avoid division by zero at poles

  // Direction vector in approximately equidistant space
  const dLon = (e[0] - start[0]) * cosLat;
  const dLat = e[1] - start[1];
  const len = Math.sqrt(dLon * dLon + dLat * dLat);

  // Perpendicular unit vector (90° CCW), converted back to degree offsets
  const perpLon = -dLat / (len * cosLat);
  const perpLat = dLon / len;

  // Arc height scales with angular separation (20% of corrected span)
  const arcHeight = len * 0.2;

  // Quadratic Bézier control point: midpoint offset along the perpendicular
  const ctrlLon = (start[0] + e[0]) / 2 + perpLon * arcHeight;
  const ctrlLat = (start[1] + e[1]) / 2 + perpLat * arcHeight;

  // Interpolate quadratic Bézier
  const coords: [number, number][] = [];
  for (let i = 0; i <= NUM_POINTS; i++) {
    const t = i / NUM_POINTS;
    const u = 1 - t;
    coords.push([
      u * u * start[0] + 2 * u * t * ctrlLon + t * t * e[0],
      u * u * start[1] + 2 * u * t * ctrlLat + t * t * e[1],
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
    coordinates: [start, unwrapEnd(start, end)],
    distance: haversineDistance(start, end),
  };
}
