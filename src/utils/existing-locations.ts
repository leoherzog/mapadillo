/**
 * Extracts unique named locations from all stops for use as
 * autocomplete suggestions in location-search.
 */
import type { Stop } from '../../shared/types.js';
import type { ExistingLocation } from '../components/location-search.js';
import { isDraftCoord } from './geo.js';

export function extractExistingLocations(items: Stop[]): ExistingLocation[] {
  const seen = new Set<string>();
  const locations: ExistingLocation[] = [];

  for (const item of items) {
    // Start/point endpoint
    if (!isDraftCoord(item.latitude, item.longitude)) {
      const key = `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push({
          name: item.name,
          latitude: item.latitude,
          longitude: item.longitude,
          icon: item.icon,
        });
      }
    }

    // Destination endpoint (routes only)
    if (
      item.dest_name &&
      item.dest_latitude != null && item.dest_longitude != null &&
      !isDraftCoord(item.dest_latitude, item.dest_longitude)
    ) {
      const key = `${item.dest_latitude.toFixed(5)},${item.dest_longitude.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push({
          name: item.dest_name,
          latitude: item.dest_latitude,
          longitude: item.dest_longitude,
          icon: item.dest_icon,
        });
      }
    }
  }

  return locations;
}
