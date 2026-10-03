/**
 * Extracts unique named locations from all stops for use as
 * autocomplete suggestions in location-search.
 */
import type { Stop } from '../../shared/types.js';
import type { ExistingLocation } from '../components/location-search.js';
import { isDraftCoord, placedDest } from './geo.js';

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
    const dest = placedDest(item);
    if (dest && item.type === 'route' && item.dest_name) {
      const [lng, lat] = dest;
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push({
          name: item.dest_name,
          latitude: lat,
          longitude: lng,
          icon: item.dest_icon,
        });
      }
    }
  }

  return locations;
}
