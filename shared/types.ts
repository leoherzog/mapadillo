/**
 * Shared types used by both frontend and worker.
 */

import type { TravelMode } from './travel-modes.js';

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

/**
 * Fields shared by every stop, regardless of type.
 * Use `PointStop` or `RouteStop` via the `Stop` discriminated union.
 */
interface StopBase {
  id: string;
  map_id: string;
  position: number;
  name: string;
  label: string | null;
  latitude: number;
  longitude: number;
  icon: string | null;
  created_at: string;
}

/** Standalone map marker — no destination, no travel mode. */
export interface PointStop extends StopBase {
  type: 'point';
}

/**
 * A→B segment. `travel_mode` may be null only when this route sits at
 * position 0 of a map (the app nulls it there via DB triggers on reorder
 * + delete); otherwise it is one of the valid `TravelMode` values. The
 * `route_geometry` field caches the ORS/great-circle polyline as GeoJSON.
 */
export interface RouteStop extends StopBase {
  type: 'route';
  travel_mode: TravelMode | null;
  dest_name: string | null;
  dest_latitude: number | null;
  dest_longitude: number | null;
  dest_icon: string | null;
  route_geometry: string | null;
}

export type Stop = PointStop | RouteStop;

/**
 * Raw row shape returned by D1 when selecting from `stops`. All discriminator-
 * specific fields are nullable here because the column shape does not vary
 * with `type`. Use `rowToStop()` to lift a row into the `Stop` discriminated
 * union before passing it to application code.
 */
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
  dest_icon: string | null;
  route_geometry: string | null;
  created_at: string;
}

/** Build a `Stop` union member from a raw D1 row based on the `type` column. */
export function rowToStop(row: StopRow): Stop {
  const base = {
    id: row.id,
    map_id: row.map_id,
    position: row.position,
    name: row.name,
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    icon: row.icon,
    created_at: row.created_at,
  };
  if (row.type === 'route') {
    return {
      ...base,
      type: 'route',
      travel_mode: row.travel_mode as TravelMode | null,
      dest_name: row.dest_name,
      dest_latitude: row.dest_latitude,
      dest_longitude: row.dest_longitude,
      dest_icon: row.dest_icon,
      route_geometry: row.route_geometry,
    };
  }
  return { ...base, type: 'point' };
}

export interface ShareData {
  id: string;
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  role: 'viewer' | 'editor';
  claim_token: string | null;
  /** ISO timestamp. NULL on legacy rows (pre-migration 0011). Omitted in API responses once claimed. */
  claim_token_expires_at?: string | null;
  claimed: boolean;
  created_at: string;
}

export interface ShareRow {
  id: string;
  map_id: string;
  user_id: string | null;
  role: 'viewer' | 'editor';
  claim_token: string | null;
  claim_token_expires_at?: string | null;
  created_at: string;
}

export type MapRole = 'owner' | 'editor' | 'viewer' | 'public';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/**
 * Persisted export/print preferences + saved map viewport per map.
 * Serialized as JSON into maps.export_settings. All fields optional so
 * partial objects from older writes are safe to parse. Kept structural
 * (paperSize/orientation are plain strings) so this file doesn't need
 * to import frontend-only union types.
 */
export interface ExportSettings {
  format?: 'pdf' | 'png' | 'jpeg';
  paperSize?: string;
  orientation?: 'landscape' | 'portrait';
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
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

/**
 * Parse a JSON string from the `maps.export_settings` column into an
 * `ExportSettings` object. Returns `null` for null/empty/invalid input so
 * callers can fall back to defaults instead of throwing.
 */
export function parseExportSettings(raw: string | null | undefined): ExportSettings | null {
  if (!raw || raw === '{}') return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ExportSettings;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a JSON string from the `orders.shipping_address` column into a
 * `ShippingAddress`. Returns `null` for null/empty/invalid input — the webhook
 * path can short-circuit instead of throwing 500s that trigger unbounded
 * Stripe retries. Validates the minimum required fields.
 */
export function parseShippingAddress(raw: string | null | undefined): ShippingAddress | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof (parsed as { name?: unknown }).name === 'string'
      && typeof (parsed as { line1?: unknown }).line1 === 'string'
      && typeof (parsed as { city?: unknown }).city === 'string'
      && typeof (parsed as { country?: unknown }).country === 'string'
    ) {
      return parsed as ShippingAddress;
    }
    return null;
  } catch {
    return null;
  }
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
