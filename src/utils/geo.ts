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
