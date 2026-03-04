/**
 * Shared D1 row types used across multiple route files.
 */

export interface MapRow {
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

export interface StopRow {
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

export interface ShareRow {
  id: string;
  map_id: string;
  user_id: string | null;
  role: string;
  claim_token: string | null;
  created_at: string;
}
