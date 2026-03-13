/**
 * Shared types used by both frontend and worker.
 */

export interface MapData {
  id: string;
  owner_id: string;
  name: string;
  family_name: string | null;
  visibility: 'public' | 'private';
  export_settings: string;
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
  dest_icon: string | null;
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
  role: 'viewer' | 'editor';
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

export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export type OrderStatus = 'pending_payment' | 'paid' | 'pending_render' | 'submitted' | 'in_production' | 'shipped' | 'completed' | 'cancelled' | 'failed';

export interface Order {
  id: string;
  map_id: string;
  user_id: string;
  product_type: string;
  product_sku: string;
  poster_size: string;
  status: OrderStatus;
  stripe_session_id: string | null;
  prodigi_order_id: string | null;
  image_url: string | null;
  shipping_address: string | null;
  subtotal: number | null;
  shipping_cost: number | null;
  currency: string;
  tracking_url: string | null;
  discord_notified: number;
  created_at: string;
  updated_at: string;
}
