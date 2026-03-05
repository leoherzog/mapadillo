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
import { haversineDistance, toRad, toDeg } from '../utils/geo.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SegmentGeometry {
  /** GeoJSON coordinates: [[lon, lat], ...] */
  coordinates: [number, number][];
  /** Distance in meters */
  distance: number;
}

/** ORS travel mode → ORS profile mapping */
const MODE_TO_PROFILE: Record<string, string> = {
  drive: 'driving-car',
  walk: 'foot-walking',
  bike: 'cycling-regular',
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get route geometry for a single segment between two points.
 *
 * @param mode Travel mode: drive, walk, bike, plane, boat
 * @param start [longitude, latitude]
 * @param end [longitude, latitude]
 * @returns GeoJSON coordinates + distance in meters
 */
export async function getSegmentRoute(
  mode: string,
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal,
): Promise<SegmentGeometry> {
  if (mode === 'plane') {
    return greatCircleArc(start, end);
  }
  if (mode === 'boat') {
    return straightLine(start, end);
  }

  const profile = MODE_TO_PROFILE[mode];
  if (!profile) {
    // Fallback to straight line for unknown modes
    return straightLine(start, end);
  }

  return fetchORSRoute(profile, start, end, signal);
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

async function fetchORSRoute(
  profile: string,
  start: [number, number],
  end: [number, number],
  signal?: AbortSignal,
): Promise<SegmentGeometry> {
  let data: ORSResponse;
  try {
    data = await apiPost<ORSResponse>('/api/route', { profile, start, end }, signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return straightLine(start, end);
  }

  const feature = data.features?.[0];
  if (!feature?.geometry?.coordinates || !feature.properties?.summary) {
    return straightLine(start, end);
  }

  return {
    coordinates: feature.geometry.coordinates,
    distance: feature.properties.summary.distance,
  };
}

// ── Client-side geometry ─────────────────────────────────────────────────────

/**
 * Great-circle arc between two points, interpolated into ~64 segments.
 * Uses spherical interpolation (slerp on unit sphere).
 */
function greatCircleArc(
  start: [number, number],
  end: [number, number],
): SegmentGeometry {
  const NUM_POINTS = 64;
  const coords: [number, number][] = [];

  const lon1 = toRad(start[0]);
  const lat1 = toRad(start[1]);
  const lon2 = toRad(end[0]);
  const lat2 = toRad(end[1]);

  // Haversine distance (angular)
  const d = 2 * Math.asin(
    Math.sqrt(
      Math.pow(Math.sin((lat2 - lat1) / 2), 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin((lon2 - lon1) / 2), 2),
    ),
  );

  if (d < 1e-10) {
    // Points are essentially the same
    return { coordinates: [start, end], distance: 0 };
  }

  for (let i = 0; i <= NUM_POINTS; i++) {
    const f = i / NUM_POINTS;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);

    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);

    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    const lon = Math.atan2(y, x);

    coords.push([toDeg(lon), toDeg(lat)]);
  }

  // Distance in meters (Earth radius ≈ 6371 km)
  const distance = d * 6_371_000;

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

