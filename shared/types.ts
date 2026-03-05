/**
 * Shared types used by both frontend and worker.
 */

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
  route_geometry: string | null;
  created_at: string;
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

export interface ShareRow {
  id: string;
  map_id: string;
  user_id: string | null;
  role: string;
  claim_token: string | null;
  created_at: string;
}

export type MapRole = 'owner' | 'editor' | 'viewer' | 'public';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}
