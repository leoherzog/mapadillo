/** Shared geo/map utilities. */

/** Check if coordinates are draft/placeholder (0,0). */
export function isDraftCoord(lat: number, lng: number): boolean {
  return lat === 0 && lng === 0;
}

/** Format a distance in meters to a human-readable string with units. */
export function formatDistance(meters: number, units: string): string {
  if (units === 'mi') {
    const miles = meters / 1609.344;
    return miles < 1 ? `${miles.toFixed(1)} mi` : `${Math.round(miles).toLocaleString()} mi`;
  }
  const km = meters / 1000;
  return km < 1 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`;
}

/** Convert degrees to radians. */
export function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Convert radians to degrees. */
export function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Haversine angular distance in radians between two [lon, lat] points. */
export function haversineAngle(
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
