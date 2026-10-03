/**
 * Routing service — fetches route geometry per segment.
 *
 * - Drive/Walk/Bike: calls POST /api/route (Worker proxy → ORS)
 * - Plane: great-circle arc computed client-side (no API call)
 * - Boat: straight line computed client-side (no API call)
 *
 * Returns GeoJSON LineString coordinates + distance in meters.
 */

import { apiPost } from './api-client.js';
import { haversineDistance } from '../utils/geo.js';
import { TRAVEL_MODES } from '../config/travel-modes.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SegmentGeometry {
  /** GeoJSON coordinates: [[lon, lat], ...] */
  coordinates: [number, number][];
  /** Distance in meters */
  distance: number;
}

/** ORS travel mode -> ORS profile mapping (derived from shared config) */
const MODE_TO_PROFILE: Record<string, string> = Object.fromEntries(
  TRAVEL_MODES.filter((m) => m.orsProfile).map((m) => [m.mode, m.orsProfile!]),
);

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get route geometry for a single segment, falling back to a straight line on
 * any failure except abort.
 * @throws AbortError when the request is cancelled
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

  return (await fetchORSRoute(profile, start, end, signal)) ?? straightLine(start, end);
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

/** Fetch an ORS route; resolves to null on any failure except abort. */
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
