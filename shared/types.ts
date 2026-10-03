/**
 * Shared types used by both frontend and worker.
 */

import type { TravelMode } from './travel-modes.js';
import type { PaperSize, Orientation } from './paper.js';
import { isPaperSize } from './paper.js';

export type Visibility = 'public' | 'private';
export type ShareRole = 'viewer' | 'editor';

export interface MapData {
  id: string;
  owner_id: string;
  name: string;
  family_name: string | null;
  visibility: Visibility;
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
 * A→B segment. New routes default `travel_mode` to 'drive'; it is null only
 * if a client explicitly clears it. `route_geometry` caches the
 * ORS or client-computed polyline as GeoJSON.
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

/** Stop PATCH fields that invalidate a route's cached geometry. */
export const GEOMETRY_INVALIDATING_FIELDS = ['lat', 'lng', 'dest_lat', 'dest_lng', 'travel_mode'] as const;

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
  travel_mode: TravelMode | null;
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
      travel_mode: row.travel_mode,
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
  role: ShareRole;
  claim_token: string | null;
  /** ISO timestamp, or null when the invite has no expiry. Null in API responses once claimed. */
  claim_token_expires_at: string | null;
  claimed: boolean;
  created_at: string;
}

export interface ShareRow {
  id: string;
  map_id: string;
  user_id: string | null;
  role: ShareRole;
  claim_token: string | null;
  claim_token_expires_at: string | null;
  created_at: string;
}

export type MapRole = 'owner' | ShareRole | 'public';

/** True for roles allowed to modify a map and order prints of it. */
export function canEditRole(role: MapRole): boolean {
  return role === 'owner' || role === 'editor';
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

/**
 * Persisted export/print preferences + saved map viewport per map.
 * Serialized as JSON into maps.export_settings. All fields optional so
 * partial objects from older writes are safe to parse.
 */
export interface ExportSettings {
  paperSize?: PaperSize;
  orientation?: Orientation;
  center?: [number, number];
  zoom?: number;
  bearing?: number;
  pitch?: number;
  /** CSS [width, height] of the preview map container when the viewport was saved. */
  viewSize?: [number, number];
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
 * callers can fall back to defaults; unknown or malformed fields are dropped.
 */
export function parseExportSettings(raw: string | null | undefined): ExportSettings | null {
  if (!raw || raw === '{}') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const out: ExportSettings = {};
  if (isPaperSize(o.paperSize)) out.paperSize = o.paperSize;
  if (o.orientation === 'landscape' || o.orientation === 'portrait') out.orientation = o.orientation;
  const c = o.center;
  if (Array.isArray(c) && c.length === 2 && finite(c[0]) && finite(c[1]) && Math.abs(c[1]) <= 90) {
    out.center = [c[0], c[1]];
  }
  if (finite(o.zoom)) out.zoom = o.zoom;
  if (finite(o.bearing)) out.bearing = o.bearing;
  if (finite(o.pitch)) out.pitch = o.pitch;
  const v = o.viewSize;
  if (Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) && v[0] > 0 && v[1] > 0) {
    out.viewSize = [v[0], v[1]];
  }
  return out;
}

const MAX_ADDRESS_FIELD = 200;

/**
 * Validate an untrusted value as a `ShippingAddress` and return a trimmed copy holding only known fields.
 * Prodigi requires line1, townOrCity, postalOrZipCode and a two-letter countryCode.
 * @returns the clean address, or `null` when a required field is missing, blank, mistyped or over-long.
 */
export function toShippingAddress(value: unknown): ShippingAddress | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  // '' for an absent field, null for a non-string or over-long one.
  const field = (k: keyof ShippingAddress): string | null => {
    const v = o[k];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length <= MAX_ADDRESS_FIELD ? t : null;
  };
  const name = field('name');
  const line1 = field('line1');
  const line2 = field('line2');
  const city = field('city');
  const state = field('state');
  const postalCode = field('postalCode');
  const country = field('country')?.toUpperCase() ?? null;
  if (!name || !line1 || !city || !postalCode || line2 === null || state === null) return null;
  if (!country || !/^[A-Z]{2}$/.test(country)) return null;
  const address: ShippingAddress = { name, line1, city, state, postalCode, country };
  if (line2) address.line2 = line2;
  return address;
}

/**
 * Parse a JSON string from the `orders.shipping_address` column into a
 * `ShippingAddress`. Returns `null` for null/empty/invalid input so the webhook
 * path can short-circuit instead of throwing 500s that trigger unbounded
 * Stripe retries. Applies the same checks as `toShippingAddress`.
 */
export function parseShippingAddress(raw: string | null | undefined): ShippingAddress | null {
  if (!raw) return null;
  try {
    return toShippingAddress(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Request body for POST /api/checkout. */
export interface CheckoutBody {
  map_id: string;
  product_sku: string;
  size: string;
  shipping_address: ShippingAddress;
  image_key: string;
}

/** Request body for POST /api/print-quote. */
export interface PrintQuoteBody {
  product_sku: string;
  size: string;
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
  customer_email: string | null;
  discord_notified: number;
  created_at: string;
  updated_at: string;
}
