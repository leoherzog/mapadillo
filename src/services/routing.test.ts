import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockApiPost } = vi.hoisted(() => ({
  mockApiPost: vi.fn(),
}));

vi.mock('./api-client.js', () => ({
  apiPost: mockApiPost,
}));

import { getSegmentRoute } from './routing.js';

beforeEach(() => {
  mockApiPost.mockReset();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a valid ORS-style GeoJSON response. */
function orsResponse(
  coordinates: [number, number][],
  distance: number,
  duration = 0,
) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        geometry: { type: 'LineString', coordinates },
        properties: { summary: { distance, duration } },
      },
    ],
  };
}

const berlin: [number, number] = [13.405, 52.52];
const munich: [number, number] = [11.582, 48.135];
const newYork: [number, number] = [-73.9857, 40.7484];
const london: [number, number] = [-0.1276, 51.5074];

// ── Drive / Walk / Bike (ORS-backed modes) ───────────────────────────────────

describe('getSegmentRoute — ORS-backed modes', () => {
  it('calls /api/route with driving-car profile for "drive"', async () => {
    const coords: [number, number][] = [berlin, [12.5, 50.3], munich];
    mockApiPost.mockResolvedValue(orsResponse(coords, 585_000));

    const result = await getSegmentRoute('drive', berlin, munich);

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/route',
      { profile: 'driving-car', start: berlin, end: munich },
      undefined,
    );
    expect(result.coordinates).toEqual(coords);
    expect(result.distance).toBe(585_000);
  });

  it('calls /api/route with foot-walking profile for "walk"', async () => {
    mockApiPost.mockResolvedValue(orsResponse([berlin, munich], 600_000));

    await getSegmentRoute('walk', berlin, munich);

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/route',
      { profile: 'foot-walking', start: berlin, end: munich },
      undefined,
    );
  });

  it('calls /api/route with cycling-regular profile for "bike"', async () => {
    mockApiPost.mockResolvedValue(orsResponse([berlin, munich], 590_000));

    await getSegmentRoute('bike', berlin, munich);

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/route',
      { profile: 'cycling-regular', start: berlin, end: munich },
      undefined,
    );
  });

  it('passes AbortSignal to apiPost', async () => {
    const controller = new AbortController();
    mockApiPost.mockResolvedValue(orsResponse([berlin, munich], 585_000));

    await getSegmentRoute('drive', berlin, munich, controller.signal);

    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/route',
      { profile: 'driving-car', start: berlin, end: munich },
      controller.signal,
    );
  });
});

// ── ORS error / fallback handling ────────────────────────────────────────────

describe('getSegmentRoute — ORS error handling', () => {
  it('falls back to straight line on API error', async () => {
    mockApiPost.mockRejectedValue(new Error('Network failure'));

    const result = await getSegmentRoute('drive', berlin, munich);

    expect(result.coordinates).toEqual([berlin, munich]);
    expect(result.distance).toBeGreaterThan(0);
  });

  it('re-throws AbortError', async () => {
    const abortErr = new DOMException('The operation was aborted.', 'AbortError');
    mockApiPost.mockRejectedValue(abortErr);

    await expect(getSegmentRoute('drive', berlin, munich)).rejects.toThrow('The operation was aborted.');
  });

  it('falls back when response has no features', async () => {
    mockApiPost.mockResolvedValue({ type: 'FeatureCollection', features: [] });

    const result = await getSegmentRoute('drive', berlin, munich);

    expect(result.coordinates).toEqual([berlin, munich]);
    expect(result.distance).toBeGreaterThan(0);
  });

  it('falls back when feature has no coordinates', async () => {
    mockApiPost.mockResolvedValue({
      type: 'FeatureCollection',
      features: [{ geometry: {}, properties: { summary: { distance: 100, duration: 10 } } }],
    });

    const result = await getSegmentRoute('drive', berlin, munich);

    expect(result.coordinates).toEqual([berlin, munich]);
  });

  it('falls back when feature has no summary', async () => {
    mockApiPost.mockResolvedValue({
      type: 'FeatureCollection',
      features: [
        { geometry: { type: 'LineString', coordinates: [berlin, munich] }, properties: {} },
      ],
    });

    const result = await getSegmentRoute('drive', berlin, munich);

    expect(result.coordinates).toEqual([berlin, munich]);
  });
});

// ── Plane (great-circle arc) ─────────────────────────────────────────────────

describe('getSegmentRoute — plane mode', () => {
  it('does not call the API', async () => {
    await getSegmentRoute('plane', berlin, munich);

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('returns 65 points (64 segments + 1)', async () => {
    const result = await getSegmentRoute('plane', newYork, london);

    expect(result.coordinates).toHaveLength(65);
  });

  it('starts at the start point and ends at the end point', async () => {
    const result = await getSegmentRoute('plane', newYork, london);

    expect(result.coordinates[0][0]).toBeCloseTo(newYork[0], 5);
    expect(result.coordinates[0][1]).toBeCloseTo(newYork[1], 5);
    expect(result.coordinates[64][0]).toBeCloseTo(london[0], 5);
    expect(result.coordinates[64][1]).toBeCloseTo(london[1], 5);
  });

  it('returns haversine distance for the segment', async () => {
    const result = await getSegmentRoute('plane', newYork, london);

    // NY to London is ~5,570 km
    expect(result.distance).toBeGreaterThan(5_500_000);
    expect(result.distance).toBeLessThan(5_650_000);
  });

  it('creates an arc that deviates from the straight midpoint', async () => {
    const result = await getSegmentRoute('plane', newYork, london);

    const midIdx = 32;
    const straightMidLon = (newYork[0] + london[0]) / 2;
    const straightMidLat = (newYork[1] + london[1]) / 2;

    const lonDiff = Math.abs(result.coordinates[midIdx][0] - straightMidLon);
    const latDiff = Math.abs(result.coordinates[midIdx][1] - straightMidLat);

    // The arc should deviate from the straight-line midpoint
    expect(lonDiff + latDiff).toBeGreaterThan(0.01);
  });

  it('returns straight line with distance 0 for very close points', async () => {
    const almostSame: [number, number] = [13.405, 52.52];
    const veryClose: [number, number] = [13.405, 52.52];

    const result = await getSegmentRoute('plane', almostSame, veryClose);

    expect(result.coordinates).toEqual([almostSame, veryClose]);
    expect(result.distance).toBe(0);
  });
});

// ── Boat (straight line) ────────────────────────────────────────────────────

describe('getSegmentRoute — boat mode', () => {
  it('does not call the API', async () => {
    await getSegmentRoute('boat', berlin, munich);

    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('returns a straight line with exactly 2 points', async () => {
    const result = await getSegmentRoute('boat', berlin, munich);

    expect(result.coordinates).toEqual([berlin, munich]);
  });

  it('returns haversine distance', async () => {
    const result = await getSegmentRoute('boat', berlin, munich);

    // Berlin to Munich is ~504 km
    expect(result.distance).toBeGreaterThan(450_000);
    expect(result.distance).toBeLessThan(550_000);
  });
});

// ── Unknown mode ─────────────────────────────────────────────────────────────

describe('getSegmentRoute — unknown mode', () => {
  it('falls back to straight line for unrecognized mode', async () => {
    const result = await getSegmentRoute('teleport', berlin, munich);

    expect(mockApiPost).not.toHaveBeenCalled();
    expect(result.coordinates).toEqual([berlin, munich]);
    expect(result.distance).toBeGreaterThan(0);
  });
});
