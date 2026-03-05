/**
 * Typed API wrappers for map and stop operations.
 */

import { apiDelete, apiGet, apiPost, apiPut } from './api-client';

// ---------------------------------------------------------------------------
// Types — base types from shared module, composite types local
// ---------------------------------------------------------------------------

export type { MapData, Stop, ShareData, MapRole } from '../../shared/types.js';
import type { MapData, Stop, ShareData, MapRole } from '../../shared/types.js';

export interface MapWithStops extends MapData {
  stops: Stop[];
}

export interface MapWithRole extends MapWithStops {
  role: MapRole;
}

// ---------------------------------------------------------------------------
// Map operations
// ---------------------------------------------------------------------------

const BASE = '/api/maps';

export function createMap(data: {
  name: string;
  family_name?: string;
}): Promise<MapData> {
  return apiPost<MapData>(BASE, data);
}

export function listMaps(): Promise<MapWithRole[]> {
  return apiGet<MapWithRole[]>(BASE);
}

export function getMap(id: string): Promise<MapWithRole> {
  return apiGet<MapWithRole>(`${BASE}/${id}`);
}

export function updateMap(
  id: string,
  data: Partial<Pick<MapData, 'name' | 'family_name' | 'style_preferences' | 'units'>>,
): Promise<MapData> {
  return apiPut<MapData>(`${BASE}/${id}`, data);
}

export function deleteMap(id: string): Promise<void> {
  return apiDelete<void>(`${BASE}/${id}`);
}

// ---------------------------------------------------------------------------
// Stop operations
// ---------------------------------------------------------------------------

export function addStop(
  mapId: string,
  data: {
    type?: 'point' | 'route';
    name: string;
    lat: number;
    lng: number;
    label?: string;
    icon?: string;
    travel_mode?: string;
    dest_name?: string;
    dest_lat?: number;
    dest_lng?: number;
  },
): Promise<Stop> {
  return apiPost<Stop>(`${BASE}/${mapId}/stops`, data);
}

export function updateStop(
  mapId: string,
  stopId: string,
  data: Partial<Pick<Stop, 'name' | 'label' | 'icon' | 'travel_mode'>> & {
    lat?: number;
    lng?: number;
    dest_name?: string;
    dest_lat?: number;
    dest_lng?: number;
    route_geometry?: string | null;
  },
): Promise<Stop> {
  return apiPut<Stop>(`${BASE}/${mapId}/stops/${stopId}`, data);
}

export function deleteStop(mapId: string, stopId: string): Promise<void> {
  return apiDelete<void>(`${BASE}/${mapId}/stops/${stopId}`);
}

export function reorderStops(mapId: string, order: string[]): Promise<Stop[]> {
  return apiPut<Stop[]>(`${BASE}/${mapId}/stops/reorder`, { order });
}

// ---------------------------------------------------------------------------
// Sharing operations
// ---------------------------------------------------------------------------

export function getMapShares(mapId: string): Promise<ShareData[]> {
  return apiGet<{ shares: ShareData[] }>(`${BASE}/${mapId}/shares`).then(r => r.shares);
}

export function generateShareLink(mapId: string, role: 'viewer' | 'editor'): Promise<{ claim_token: string; url: string }> {
  return apiPost<{ claim_token: string; url: string }>(`${BASE}/${mapId}/shares`, { role });
}

export function updateShare(mapId: string, shareId: string, role: 'viewer' | 'editor'): Promise<void> {
  return apiPut<void>(`${BASE}/${mapId}/shares/${shareId}`, { role });
}

export function deleteShare(mapId: string, shareId: string): Promise<void> {
  return apiDelete<void>(`${BASE}/${mapId}/shares/${shareId}`);
}

export function updateVisibility(mapId: string, visibility: 'public' | 'private'): Promise<void> {
  return apiPut<void>(`${BASE}/${mapId}/visibility`, { visibility });
}

export function claimShareToken(token: string): Promise<{ map_id: string }> {
  return apiPost<{ map_id: string }>(`/api/shares/claim/${token}`, {});
}

export function duplicateMap(mapId: string): Promise<MapData> {
  return apiPost<MapData>(`${BASE}/${mapId}/duplicate`, {});
}
