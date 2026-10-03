/** Shared geo/map utilities. */

import type { Stop } from '../../shared/types.js';
import type { Units } from '../../shared/units.js';

/** Check if coordinates are draft/placeholder (0,0). */
export function isDraftCoord(lat: number, lng: number): boolean {
  return lat === 0 && lng === 0;
}

/** A route's destination as [lng, lat], or null for points and unplaced destinations. */
export function placedDest(item: Stop): [number, number] | null {
  if (item.type !== 'route' || item.dest_latitude == null || item.dest_longitude == null) return null;
  return isDraftCoord(item.dest_latitude, item.dest_longitude) ? null : [item.dest_longitude, item.dest_latitude];
}

/** Format meters in the viewer's locale: one decimal below 1 unit, whole numbers otherwise. */
export function formatDistance(meters: number, units: Units): string {
  const value = units === 'mi' ? meters / 1609.344 : meters / 1000;
  const digits = value < 1 ? 1 : 0;
  return `${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units}`;
}

/** Convert degrees to radians. */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Haversine angular distance in radians between two [lon, lat] points. */
function haversineAngle(
  a: [number, number],
  b: [number, number],
): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);

  const h =
    Math.pow(Math.sin(dLat / 2), 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.pow(Math.sin(dLon / 2), 2);

  return 2 * Math.asin(Math.sqrt(h));
}

/** Haversine distance in meters between two [lon, lat] points. */
export function haversineDistance(
  a: [number, number],
  b: [number, number],
): number {
  const R = 6_371_000; // Earth radius in meters
  return R * haversineAngle(a, b);
}

/** Sanitize a string for use as a filename. */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 80) || 'mapadillo-map';
}
