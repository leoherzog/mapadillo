/**
 * Geocoding service — calls the Worker proxy at /api/geocode.
 *
 * The Worker proxies Photon (photon.komoot.io) with KV caching.
 * Requires an authenticated session (cookie sent automatically).
 *
 * Callers receive a tagged-union {@link ServiceResult} so UI code can
 * distinguish rate-limit / unauthorized / upstream errors from an empty list
 * and surface appropriate messaging instead of silently showing "no results".
 */

import { apiGet, ApiError } from './api-client.js';

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

export type ServiceFailureReason =
  | 'rate-limit'
  | 'unauthorized'
  | 'network'
  | 'upstream-error';

export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: ServiceFailureReason; status?: number };

/**
 * Search for places by name. Returns up to `limit` results.
 * Debouncing is the caller's responsibility.
 *
 * Historical shape (`Promise<GeocodingResult[]>`) is retained as a thin wrapper
 * via {@link searchPlaces} so existing callers don't break; new code should
 * prefer {@link searchPlacesResult} to surface rate-limit / auth failures.
 */
export async function searchPlacesResult(
  query: string,
  lang = 'en',
  limit = 5,
  bias?: { lat: number; lon: number } | null,
): Promise<ServiceResult<GeocodingResult[]>> {
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
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return { ok: false, reason: 'rate-limit', status: 429 };
      if (e.status === 401 || e.status === 403) return { ok: false, reason: 'unauthorized', status: e.status };
      return { ok: false, reason: 'upstream-error', status: e.status };
    }
    if (e instanceof Error && e.name === 'AbortError') throw e;
    return { ok: false, reason: 'network' };
  }
  if (!data.features) return { ok: true, data: [] };

  const results = data.features
    .filter((f) => f.properties?.name && f.geometry?.coordinates?.length >= 2)
    .map((f) => ({
      name: f.properties.name,
      city: f.properties.city,
      state: f.properties.state,
      country: f.properties.country,
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
    }));

  return { ok: true, data: results };
}

/**
 * Legacy-shape wrapper that returns an empty array on any failure. Prefer
 * {@link searchPlacesResult} in new code so the UI can distinguish "nothing
 * matches" from "rate limited" or "session expired".
 */
export async function searchPlaces(
  query: string,
  lang = 'en',
  limit = 5,
  bias?: { lat: number; lon: number } | null,
): Promise<GeocodingResult[]> {
  const result = await searchPlacesResult(query, lang, limit, bias);
  return result.ok ? result.data : [];
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
