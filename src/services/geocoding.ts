/**
 * Geocoding service — calls the Worker proxy at /api/geocode.
 *
 * The Worker proxies Photon (photon.komoot.io) with KV caching.
 * Requires an authenticated session (cookie sent automatically).
 */

import { apiGet } from './api-client.js';

export interface GeocodingResult {
  /** Place name (e.g. "Berlin") */
  name: string;
  /** City/town (may be the same as name for cities) */
  city?: string;
  /** State / province / region */
  state?: string;
  /** Country name */
  country?: string;
  /** Latitude (WGS 84) */
  latitude: number;
  /** Longitude (WGS 84) */
  longitude: number;
}

/**
 * Search for places by name. Returns up to `limit` results, or `[]` on any
 * failure. Debouncing is the caller's responsibility.
 */
export async function searchPlaces(
  query: string,
  lang = 'en',
  limit = 5,
  bias?: { lat: number; lon: number } | null,
): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({
    q: query,
    lang,
    limit: String(limit),
  });
  if (bias) {
    params.set('lat', String(bias.lat));
    params.set('lon', String(bias.lon));
  }

  let data: PhotonResponse;
  try {
    data = await apiGet<PhotonResponse>(`/api/geocode?${params}`);
  } catch {
    return [];
  }
  if (!data.features) return [];

  return data.features.flatMap((f) => {
    const name = placeLabel(f.properties);
    if (!name || !(f.geometry?.coordinates?.length >= 2)) return [];
    return [{
      name,
      city: f.properties.city,
      state: f.properties.state,
      country: f.properties.country,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    }];
  });
}

/** Display label: the place name, or "<housenumber> <street>" for unnamed address points. */
function placeLabel(p: PhotonFeature['properties'] | undefined): string | undefined {
  if (!p) return undefined;
  if (p.name) return p.name;
  return p.street ? [p.housenumber, p.street].filter(Boolean).join(' ') : undefined;
}

/** Photon GeoJSON response shape (subset we care about). */
interface PhotonResponse {
  type: 'FeatureCollection';
  features?: PhotonFeature[];
}

interface PhotonFeature {
  type: 'Feature';
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    state?: string;
    country?: string;
    [key: string]: unknown;
  };
  geometry: {
    type: 'Point';
    coordinates: [longitude: number, latitude: number];
  };
}
