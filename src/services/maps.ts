/**
 * Typed API wrappers for map and stop operations.
 */

import { apiDelete, apiGet, apiPost, apiPut } from './api-client.js';

// ---------------------------------------------------------------------------
// Types — base types from shared module, composite types local
// ---------------------------------------------------------------------------

export type { MapData, Stop, PointStop, RouteStop, ShareData, ShareRole, Visibility } from '../../shared/types.js';
import type { MapData, Stop, ShareData, MapRole, ShareRole, Visibility } from '../../shared/types.js';
import type { TravelMode } from '../../shared/travel-modes.js';

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

/** @param keepalive - see apiPut */
export function updateMap(
  id: string,
  data: Partial<Pick<MapData, 'name' | 'family_name' | 'export_settings'>>,
  keepalive?: boolean,
): Promise<MapData> {
  return apiPut<MapData>(`${BASE}/${id}`, data, keepalive);
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
    travel_mode?: TravelMode;
    dest_name?: string;
    dest_lat?: number;
    dest_lng?: number;
    dest_icon?: string;
  },
): Promise<Stop> {
  return apiPost<Stop>(`${BASE}/${mapId}/stops`, data);
}

/** @param keepalive - see apiPut; never with route_geometry, which can pass the keepalive body limit */
export function updateStop(
  mapId: string,
  stopId: string,
  data: {
    name?: string;
    label?: string | null;
    icon?: string | null;
    lat?: number;
    lng?: number;
    travel_mode?: TravelMode | null;
    dest_name?: string | null;
    dest_lat?: number | null;
    dest_lng?: number | null;
    dest_icon?: string | null;
    route_geometry?: string | null;
  },
  keepalive?: boolean,
): Promise<Stop> {
  return apiPut<Stop>(`${BASE}/${mapId}/stops/${stopId}`, data, keepalive);
}

export function deleteStop(mapId: string, stopId: string): Promise<void> {
  return apiDelete<void>(`${BASE}/${mapId}/stops/${stopId}`);
}

export function reorderStops(mapId: string, order: string[]): Promise<void> {
  return apiPut<void>(`${BASE}/${mapId}/stops/reorder`, { order });
}

// ---------------------------------------------------------------------------
// Sharing operations
// ---------------------------------------------------------------------------

export function getMapShares(mapId: string): Promise<ShareData[]> {
  return apiGet<{ shares: ShareData[] }>(`${BASE}/${mapId}/shares`).then(r => r.shares);
}

export function generateShareLink(mapId: string, role: ShareRole): Promise<{ claim_token: string }> {
  return apiPost<{ claim_token: string }>(`${BASE}/${mapId}/shares`, { role });
}

export function updateShare(mapId: string, shareId: string, role: ShareRole): Promise<void> {
  return apiPut<void>(`${BASE}/${mapId}/shares/${shareId}`, { role });
}

export function deleteShare(mapId: string, shareId: string): Promise<void> {
  return apiDelete<void>(`${BASE}/${mapId}/shares/${shareId}`);
}

export function updateVisibility(mapId: string, visibility: Visibility): Promise<void> {
  return apiPut<void>(`${BASE}/${mapId}/visibility`, { visibility });
}

export function claimShareToken(token: string): Promise<{ map_id: string }> {
  return apiPost<{ map_id: string }>(`/api/shares/claim/${token}`, {});
}

export function duplicateMap(mapId: string): Promise<MapData> {
  return apiPost<MapData>(`${BASE}/${mapId}/duplicate`, {});
}
