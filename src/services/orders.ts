/**
 * Typed API wrappers for order operations.
 */

import { apiGet, apiPost, apiPostForm } from './api-client.js';
import type { Order, CheckoutBody, PrintQuoteBody } from '../../shared/types.js';

export type { Order } from '../../shared/types.js';

/** Order row joined with its map's name. */
export interface OrderWithMap extends Order {
  map_name: string;
}

/** Admin order row, additionally joined with the buyer's email. */
export interface AdminOrder extends OrderWithMap {
  user_email: string;
}

export interface UploadResult {
  key: string;
  url: string;
}

export interface CheckoutResult {
  checkout_url: string;
}

export interface PrintQuoteResult {
  shipping_cost_cents: number;
  estimated_days: number;
}

export function uploadPrintImage(mapId: string, blob: Blob): Promise<UploadResult> {
  const form = new FormData();
  form.append('image', blob, 'map.png');
  return apiPostForm<UploadResult>(`/api/images/${mapId}`, form);
}

export function createCheckout(data: CheckoutBody): Promise<CheckoutResult> {
  return apiPost<CheckoutResult>('/api/checkout', data);
}

export function getOrder(id: string): Promise<OrderWithMap> {
  return apiGet<OrderWithMap>(`/api/orders/${id}`);
}

export function listOrders(): Promise<OrderWithMap[]> {
  return apiGet<OrderWithMap[]>('/api/orders');
}

export function getPrintQuote(data: PrintQuoteBody): Promise<PrintQuoteResult> {
  return apiPost<PrintQuoteResult>('/api/print-quote', data);
}
