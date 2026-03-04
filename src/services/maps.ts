/**
 * Typed API wrappers for map and stop operations.
 */

import { apiDelete, apiGet, apiPost, apiPut } from './api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MapData {
  id: string;
  owner_id: string;
  name: string;
  family_name: string | null;
  visibility: string;
  style_preferences: string;
  units: string;
  created_at: string;
  updated_at: string;
}

export interface Stop {
  id: string;
  map_id: string;
  position: number;
  type: 'point' | 'route';
  name: string;
  label: string | null;
  latitude: number;
  longitude: number;
  icon: string | null;
  travel_mode: string | null;
  dest_name: string | null;
  dest_latitude: number | null;
  dest_longitude: number | null;
  created_at: string;
}

export interface MapWithStops extends MapData {
  stops: Stop[];
}

export interface MapWithRole extends MapWithStops {
  role: 'owner' | 'editor' | 'viewer' | 'public';
}

export interface ShareData {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  role: 'viewer' | 'editor';
  claim_token: string | null;
  claimed: boolean;
  created_at: string;
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
