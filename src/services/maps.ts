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
  name: string;
  label: string | null;
  latitude: number;
  longitude: number;
  icon: string | null;
  travel_mode: string | null;
  created_at: string;
}

export interface MapWithStops extends MapData {
  stops: Stop[];
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

export function listMaps(): Promise<MapWithStops[]> {
  return apiGet<MapWithStops[]>(BASE);
}

export function getMap(id: string): Promise<MapWithStops> {
  return apiGet<MapWithStops>(`${BASE}/${id}`);
}

export function updateMap(
  id: string,
  data: Partial<Pick<MapData, 'name' | 'family_name' | 'visibility' | 'style_preferences' | 'units'>>,
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
    name: string;
    lat: number;
    lng: number;
    label?: string;
    icon?: string;
    travel_mode?: string;
  },
): Promise<Stop> {
  return apiPost<Stop>(`${BASE}/${mapId}/stops`, data);
}

export function updateStop(
  mapId: string,
  stopId: string,
  data: Partial<Pick<Stop, 'name' | 'label' | 'icon' | 'travel_mode'>> & { lat?: number; lng?: number },
): Promise<Stop> {
  return apiPut<Stop>(`${BASE}/${mapId}/stops/${stopId}`, data);
}

export function deleteStop(mapId: string, stopId: string): Promise<void> {
  return apiDelete<void>(`${BASE}/${mapId}/stops/${stopId}`);
}

export function reorderStops(mapId: string, order: string[]): Promise<void> {
  return apiPut<void>(`${BASE}/${mapId}/stops/reorder`, { order });
}
