/**
 * Geocoding service — calls the Worker proxy at /api/geocode.
 *
 * The Worker proxies Photon (photon.komoot.io) with KV caching.
 * Requires an authenticated session (cookie sent automatically).
 */

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
 * Search for places by name. Returns up to `limit` results.
 * Debouncing is the caller's responsibility.
 */
export async function searchPlaces(
  query: string,
  lang = 'en',
  limit = 5,
  layer?: string,
): Promise<GeocodingResult[]> {
  const params = new URLSearchParams({
    q: query,
    lang,
    limit: String(limit),
  });
  if (layer) params.set('layer', layer);

  const res = await fetch(`/api/geocode?${params}`);
  if (!res.ok) return [];

  const data = (await res.json()) as PhotonResponse;
  if (!data.features) return [];

  return data.features
    .filter((f) => f.properties?.name && f.geometry?.coordinates?.length >= 2)
    .map((f) => ({
      name: f.properties.name,
      city: f.properties.city,
      state: f.properties.state,
      country: f.properties.country,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    }));
}

/** Photon GeoJSON response shape (subset we care about). */
interface PhotonResponse {
  type: 'FeatureCollection';
  features?: PhotonFeature[];
}

interface PhotonFeature {
  type: 'Feature';
  properties: {
    name: string;
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
