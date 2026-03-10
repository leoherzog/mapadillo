import { describe, it, expect } from 'vitest';

import {
  isDraftCoord,
  formatDistance,
  haversineDistance,
  sanitizeFilename,
} from './geo.js';

// ── isDraftCoord ────────────────────────────────────────────────────────────

describe('isDraftCoord', () => {
  it('returns true for (0, 0)', () => {
    expect(isDraftCoord(0, 0)).toBe(true);
  });

  it('returns false when only lat is 0', () => {
    expect(isDraftCoord(0, 13.4)).toBe(false);
  });

  it('returns false when only lng is 0', () => {
    expect(isDraftCoord(52.5, 0)).toBe(false);
  });

  it('returns false for non-zero coords', () => {
    expect(isDraftCoord(52.52, 13.405)).toBe(false);
  });

  it('returns false for negative coords', () => {
    expect(isDraftCoord(-33.87, 151.21)).toBe(false);
  });

  it('returns true for -0, -0 (negative zero equals zero)', () => {
    expect(isDraftCoord(-0, -0)).toBe(true);
  });
});

// ── formatDistance ──────────────────────────────────────────────────────────

describe('formatDistance', () => {
  describe('metric (km)', () => {
    it('formats sub-kilometer distances with one decimal', () => {
      expect(formatDistance(500, 'km')).toBe('0.5 km');
    });

    it('formats very small distances', () => {
      expect(formatDistance(50, 'km')).toBe('0.1 km');
    });

    it('formats exactly 1 km as rounded integer', () => {
      expect(formatDistance(1000, 'km')).toBe('1 km');
    });

    it('rounds distances >= 1 km to nearest integer', () => {
      expect(formatDistance(1500, 'km')).toBe('2 km');
    });

    it('formats large distances with locale-aware separators', () => {
      // 1,234 km — toLocaleString may insert commas or other separators
      const result = formatDistance(1_234_000, 'km');
      expect(result).toContain('km');
      expect(result).toContain('1');
      expect(result).toContain('234');
    });

    it('handles zero meters', () => {
      expect(formatDistance(0, 'km')).toBe('0.0 km');
    });
  });

  describe('imperial (mi)', () => {
    it('formats sub-mile distances with one decimal', () => {
      // 800 meters ≈ 0.5 mi
      expect(formatDistance(800, 'mi')).toBe('0.5 mi');
    });

    it('formats exactly 1 mile as rounded integer', () => {
      // 1609.344 meters = 1 mile
      expect(formatDistance(1609.344, 'mi')).toBe('1 mi');
    });

    it('rounds distances >= 1 mile to nearest integer', () => {
      expect(formatDistance(5000, 'mi')).toBe('3 mi');
    });

    it('handles zero meters', () => {
      expect(formatDistance(0, 'mi')).toBe('0.0 mi');
    });

    it('formats large distances', () => {
      // ~100 miles
      const result = formatDistance(160_934.4, 'mi');
      expect(result).toBe('100 mi');
    });
  });

  describe('defaults to km for unrecognized units', () => {
    it('falls through to km branch for unknown unit string', () => {
      expect(formatDistance(5000, 'furlongs')).toBe('5 km');
    });
  });
});

// ── haversineDistance ───────────────────────────────────────────────────────

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance([13.405, 52.52], [13.405, 52.52])).toBe(0);
  });

  it('calculates distance between Berlin and Munich (~504 km)', () => {
    // Berlin [lon, lat] and Munich [lon, lat]
    const berlin: [number, number] = [13.405, 52.52];
    const munich: [number, number] = [11.582, 48.135];
    const distance = haversineDistance(berlin, munich);

    // Should be approximately 504 km
    expect(distance).toBeGreaterThan(500_000);
    expect(distance).toBeLessThan(510_000);
  });

  it('calculates distance between New York and London (~5,570 km)', () => {
    const nyc: [number, number] = [-74.006, 40.7128];
    const london: [number, number] = [-0.1276, 51.5074];
    const distance = haversineDistance(nyc, london);

    expect(distance).toBeGreaterThan(5_500_000);
    expect(distance).toBeLessThan(5_600_000);
  });

  it('is symmetric (a→b equals b→a)', () => {
    const a: [number, number] = [-122.4194, 37.7749]; // San Francisco
    const b: [number, number] = [139.6917, 35.6895];  // Tokyo
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
  });

  it('handles antipodal points (~20,000 km / half circumference)', () => {
    const north: [number, number] = [0, 90];
    const south: [number, number] = [0, -90];
    const distance = haversineDistance(north, south);

    // Half the circumference ≈ π × R ≈ 20,015 km
    expect(distance).toBeGreaterThan(20_000_000);
    expect(distance).toBeLessThan(20_050_000);
  });

  it('handles crossing the date line', () => {
    const a: [number, number] = [179, 0];
    const b: [number, number] = [-179, 0];
    const distance = haversineDistance(a, b);

    // ~222 km, not ~40,000 km
    expect(distance).toBeLessThan(300_000);
  });

  it('handles equatorial points', () => {
    // 1 degree of longitude at equator ≈ 111.32 km
    const a: [number, number] = [0, 0];
    const b: [number, number] = [1, 0];
    const distance = haversineDistance(a, b);

    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('handles points along same meridian', () => {
    // 1 degree of latitude ≈ 111.19 km
    const a: [number, number] = [0, 0];
    const b: [number, number] = [0, 1];
    const distance = haversineDistance(a, b);

    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });
});

// ── sanitizeFilename ───────────────────────────────────────────────────────

describe('sanitizeFilename', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(sanitizeFilename('My Road Trip')).toBe('my-road-trip');
  });

  it('strips special characters', () => {
    expect(sanitizeFilename('Trip #1: NYC → LA!')).toBe('trip-1-nyc-la');
  });

  it('preserves hyphens and underscores', () => {
    expect(sanitizeFilename('trip-2024_summer')).toBe('trip-2024_summer');
  });

  it('collapses multiple spaces into one hyphen', () => {
    expect(sanitizeFilename('a   b')).toBe('a-b');
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeFilename(long)).toHaveLength(80);
  });

  it('returns fallback for empty string', () => {
    expect(sanitizeFilename('')).toBe('mapadillo-map');
  });

  it('returns fallback when all characters are stripped', () => {
    expect(sanitizeFilename('!@#$%^&*()')).toBe('mapadillo-map');
  });

  it('handles unicode characters by stripping them', () => {
    expect(sanitizeFilename('Ünser Reise')).toBe('nser-reise');
  });

  it('handles string that becomes empty after truncation edge', () => {
    // 80 valid chars followed by more
    const input = 'a'.repeat(80) + 'bbb';
    expect(sanitizeFilename(input)).toBe('a'.repeat(80));
  });

  it('strips tabs and newlines (not matched by \\s+ after char strip)', () => {
    // \t and \n are removed by the [^a-zA-Z0-9 _-] regex, not converted to hyphens
    expect(sanitizeFilename("hello\tworld\nfoo")).toBe('helloworldfoo');
  });
});
