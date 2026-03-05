import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchPlaces } from './geocoding.js';
import { apiGet, ApiError } from './api-client.js';

vi.mock('./api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api-client.js')>();
  return { ...actual, apiGet: vi.fn() };
});

const mockApiGet = vi.mocked(apiGet);

// ── Helpers ──────────────────────────────────────────────────────────────────

function photonFeature(overrides?: {
  name?: string | null;
  city?: string;
  state?: string;
  country?: string;
  lon?: number;
  lat?: number;
  coordinates?: number[];
}) {
  const {
    name = 'Berlin',
    city,
    state,
    country,
    lon = 13.405,
    lat = 52.52,
    coordinates,
  } = overrides ?? {};
  return {
    type: 'Feature',
    properties: {
      ...(name !== null ? { name } : {}),
      ...(city !== undefined && { city }),
      ...(state !== undefined && { state }),
      ...(country !== undefined && { country }),
    },
    geometry: {
      type: 'Point',
      coordinates: coordinates ?? [lon, lat],
    },
  };
}

function photonResponse(features: unknown[] = []) {
  return { type: 'FeatureCollection', features };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockApiGet.mockReset();
});

describe('searchPlaces', () => {
  describe('happy path', () => {
    it('returns mapped results from valid Photon response', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([photonFeature({ name: 'Berlin', city: 'Berlin', state: 'Berlin', country: 'Germany' })])
      );

      const results = await searchPlaces('Berlin');

      expect(results).toEqual([
        {
          name: 'Berlin',
          city: 'Berlin',
          state: 'Berlin',
          country: 'Germany',
          latitude: 52.52,
          longitude: 13.405,
        },
      ]);
    });

    it('maps lon/lat correctly from coordinates [lon, lat]', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([photonFeature({ lon: -73.9857, lat: 40.7484 })])
      );

      const [result] = await searchPlaces('New York');

      expect(result.longitude).toBe(-73.9857);
      expect(result.latitude).toBe(40.7484);
    });

    it('includes optional fields when present', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([photonFeature({ name: 'Munich', city: 'Munich', state: 'Bavaria', country: 'Germany' })])
      );

      const [result] = await searchPlaces('Munich');

      expect(result.city).toBe('Munich');
      expect(result.state).toBe('Bavaria');
      expect(result.country).toBe('Germany');
    });

    it('omits optional fields when absent', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([photonFeature({ name: 'Nowhere' })])
      );

      const [result] = await searchPlaces('Nowhere');

      expect(result.city).toBeUndefined();
      expect(result.state).toBeUndefined();
      expect(result.country).toBeUndefined();
    });

    it('builds correct query params', async () => {
      mockApiGet.mockResolvedValue(photonResponse());

      await searchPlaces('Berlin', 'de', 3);

      const path = mockApiGet.mock.calls[0][0];
      expect(path).toContain('/api/geocode?');
      expect(path).toContain('q=Berlin');
      expect(path).toContain('lang=de');
      expect(path).toContain('limit=3');
    });

    it('uses defaults: lang=en, limit=5', async () => {
      mockApiGet.mockResolvedValue(photonResponse());

      await searchPlaces('Paris');

      const path = mockApiGet.mock.calls[0][0];
      expect(path).toContain('lang=en');
      expect(path).toContain('limit=5');
    });

    it('returns multiple results', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([
          photonFeature({ name: 'Berlin', lon: 13.4, lat: 52.5 }),
          photonFeature({ name: 'Bern', lon: 7.45, lat: 46.95 }),
        ])
      );

      const results = await searchPlaces('Ber');

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('Berlin');
      expect(results[1].name).toBe('Bern');
    });
  });

  describe('error handling', () => {
    it('returns [] on ApiError (non-ok response)', async () => {
      mockApiGet.mockRejectedValue(new ApiError(500, 'Server Error'));

      const results = await searchPlaces('Berlin');

      expect(results).toEqual([]);
    });

    it('rethrows non-ApiError errors (network error)', async () => {
      mockApiGet.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(searchPlaces('Berlin')).rejects.toThrow('Failed to fetch');
    });

    it('returns [] when response has no features property', async () => {
      mockApiGet.mockResolvedValue({ type: 'FeatureCollection' });

      const results = await searchPlaces('Berlin');

      expect(results).toEqual([]);
    });

    it('returns [] when features is empty', async () => {
      mockApiGet.mockResolvedValue(photonResponse([]));

      const results = await searchPlaces('Berlin');

      expect(results).toEqual([]);
    });
  });

  describe('filtering', () => {
    it('filters out features without name', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([
          photonFeature({ name: null }),
          photonFeature({ name: 'Berlin' }),
        ])
      );

      const results = await searchPlaces('test');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Berlin');
    });

    it('filters out features with fewer than 2 coordinates', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([
          { type: 'Feature', properties: { name: 'Bad' }, geometry: { type: 'Point', coordinates: [13.4] } },
          photonFeature({ name: 'Good' }),
        ])
      );

      const results = await searchPlaces('test');

      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Good');
    });

    it('returns [] when all features are filtered out', async () => {
      mockApiGet.mockResolvedValue(
        photonResponse([
          photonFeature({ name: null }),
          { type: 'Feature', properties: { name: 'X' }, geometry: { type: 'Point', coordinates: [] } },
        ])
      );

      const results = await searchPlaces('test');

      expect(results).toEqual([]);
    });
  });
});
