import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockApiGet, mockApiPost, mockApiPut, mockApiDelete } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPut: vi.fn(),
  mockApiDelete: vi.fn(),
}));

vi.mock('./api-client.js', () => ({
  apiGet: mockApiGet,
  apiPost: mockApiPost,
  apiPut: mockApiPut,
  apiDelete: mockApiDelete,
}));

import {
  createMap, listMaps, getMap, updateMap, deleteMap,
  addStop, updateStop, deleteStop, reorderStops,
  getMapShares, generateShareLink, updateShare, deleteShare,
  updateVisibility, claimShareToken, duplicateMap,
} from './maps.js';

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPost.mockReset();
  mockApiPut.mockReset();
  mockApiDelete.mockReset();
});

// ── Map operations ───────────────────────────────────────────────────────────

describe('createMap', () => {
  it('POSTs to /api/maps with data', async () => {
    mockApiPost.mockResolvedValue({ id: '1', name: 'Trip' });

    const result = await createMap({ name: 'Trip' });

    expect(mockApiPost).toHaveBeenCalledWith('/api/maps', { name: 'Trip' });
    expect(result.id).toBe('1');
  });

  it('passes family_name when provided', async () => {
    mockApiPost.mockResolvedValue({ id: '1' });

    await createMap({ name: 'Trip', family_name: 'Smith' });

    expect(mockApiPost).toHaveBeenCalledWith('/api/maps', { name: 'Trip', family_name: 'Smith' });
  });
});

describe('listMaps', () => {
  it('GETs /api/maps', async () => {
    mockApiGet.mockResolvedValue([{ id: '1' }, { id: '2' }]);

    const result = await listMaps();

    expect(mockApiGet).toHaveBeenCalledWith('/api/maps');
    expect(result).toHaveLength(2);
  });
});

describe('getMap', () => {
  it('GETs /api/maps/:id', async () => {
    mockApiGet.mockResolvedValue({ id: 'abc', stops: [] });

    const result = await getMap('abc');

    expect(mockApiGet).toHaveBeenCalledWith('/api/maps/abc');
    expect(result.id).toBe('abc');
  });
});

describe('updateMap', () => {
  it('PUTs to /api/maps/:id with partial data', async () => {
    mockApiPut.mockResolvedValue({ id: '1', name: 'Updated' });

    const result = await updateMap('1', { name: 'Updated' });

    expect(mockApiPut).toHaveBeenCalledWith('/api/maps/1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });

  it('sends only provided fields', async () => {
    mockApiPut.mockResolvedValue({ id: '1', units: 'mi' });

    await updateMap('1', { units: 'mi' });

    expect(mockApiPut).toHaveBeenCalledWith('/api/maps/1', { units: 'mi' });
  });
});

describe('deleteMap', () => {
  it('DELETEs /api/maps/:id', async () => {
    mockApiDelete.mockResolvedValue(undefined);

    await deleteMap('abc');

    expect(mockApiDelete).toHaveBeenCalledWith('/api/maps/abc');
  });
});

// ── Stop operations ──────────────────────────────────────────────────────────

describe('addStop', () => {
  it('POSTs to /api/maps/:mapId/stops', async () => {
    mockApiPost.mockResolvedValue({ id: 's1', name: 'Berlin' });

    const result = await addStop('m1', { name: 'Berlin', lat: 52.52, lng: 13.405 });

    expect(mockApiPost).toHaveBeenCalledWith('/api/maps/m1/stops', {
      name: 'Berlin', lat: 52.52, lng: 13.405,
    });
    expect(result.name).toBe('Berlin');
  });

  it('passes optional fields', async () => {
    mockApiPost.mockResolvedValue({ id: 's1' });

    await addStop('m1', {
      name: 'Berlin', lat: 52.52, lng: 13.405,
      label: 'Start', icon: 'star', travel_mode: 'drive',
    });

    expect(mockApiPost).toHaveBeenCalledWith('/api/maps/m1/stops', {
      name: 'Berlin', lat: 52.52, lng: 13.405,
      label: 'Start', icon: 'star', travel_mode: 'drive',
    });
  });
});

describe('updateStop', () => {
  it('PUTs to /api/maps/:mapId/stops/:stopId', async () => {
    mockApiPut.mockResolvedValue({ id: 's1', name: 'Updated' });

    const result = await updateStop('m1', 's1', { name: 'Updated' });

    expect(mockApiPut).toHaveBeenCalledWith('/api/maps/m1/stops/s1', { name: 'Updated' });
    expect(result.name).toBe('Updated');
  });
});

describe('deleteStop', () => {
  it('DELETEs /api/maps/:mapId/stops/:stopId', async () => {
    mockApiDelete.mockResolvedValue(undefined);

    await deleteStop('m1', 's1');

    expect(mockApiDelete).toHaveBeenCalledWith('/api/maps/m1/stops/s1');
  });
});

describe('reorderStops', () => {
  it('PUTs to /api/maps/:mapId/stops/reorder with order', async () => {
    mockApiPut.mockResolvedValue(undefined);

    await reorderStops('m1', ['s3', 's1', 's2']);

    expect(mockApiPut).toHaveBeenCalledWith('/api/maps/m1/stops/reorder', {
      order: ['s3', 's1', 's2'],
    });
  });
});

// ── Sharing operations ────────────────────────────────────────────────────────

describe('getMapShares', () => {
  it('GETs /api/maps/:mapId/shares and unwraps shares array', async () => {
    mockApiGet.mockResolvedValue({ shares: [{ id: 's1' }, { id: 's2' }] });

    const result = await getMapShares('m1');

    expect(mockApiGet).toHaveBeenCalledWith('/api/maps/m1/shares');
    expect(result).toEqual([{ id: 's1' }, { id: 's2' }]);
  });
});

describe('generateShareLink', () => {
  it('POSTs to /api/maps/:mapId/shares with role', async () => {
    mockApiPost.mockResolvedValue({ claim_token: 'tok', url: '/claim/tok' });

    const result = await generateShareLink('m1', 'viewer');

    expect(mockApiPost).toHaveBeenCalledWith('/api/maps/m1/shares', { role: 'viewer' });
    expect(result.claim_token).toBe('tok');
  });
});

describe('updateShare', () => {
  it('PUTs to /api/maps/:mapId/shares/:shareId with role', async () => {
    mockApiPut.mockResolvedValue(undefined);

    await updateShare('m1', 's1', 'editor');

    expect(mockApiPut).toHaveBeenCalledWith('/api/maps/m1/shares/s1', { role: 'editor' });
  });
});

describe('deleteShare', () => {
  it('DELETEs /api/maps/:mapId/shares/:shareId', async () => {
    mockApiDelete.mockResolvedValue(undefined);

    await deleteShare('m1', 's1');

    expect(mockApiDelete).toHaveBeenCalledWith('/api/maps/m1/shares/s1');
  });
});

describe('updateVisibility', () => {
  it('PUTs to /api/maps/:mapId/visibility with visibility', async () => {
    mockApiPut.mockResolvedValue(undefined);

    await updateVisibility('m1', 'public');

    expect(mockApiPut).toHaveBeenCalledWith('/api/maps/m1/visibility', { visibility: 'public' });
  });
});

describe('claimShareToken', () => {
  it('POSTs to /api/shares/claim/:token', async () => {
    mockApiPost.mockResolvedValue({ map_id: 'm1' });

    const result = await claimShareToken('abc123');

    expect(mockApiPost).toHaveBeenCalledWith('/api/shares/claim/abc123', {});
    expect(result.map_id).toBe('m1');
  });
});

describe('duplicateMap', () => {
  it('POSTs to /api/maps/:mapId/duplicate', async () => {
    mockApiPost.mockResolvedValue({ id: 'm2', name: 'Trip (copy)' });

    const result = await duplicateMap('m1');

    expect(mockApiPost).toHaveBeenCalledWith('/api/maps/m1/duplicate', {});
    expect(result.id).toBe('m2');
  });
});
