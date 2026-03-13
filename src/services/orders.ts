/**
 * Typed API wrappers for order operations.
 */

import { apiGet, apiPost, apiPostForm } from './api-client.js';
import type { Order, ShippingAddress } from '../../shared/types.js';

export type { Order } from '../../shared/types.js';

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

export function createCheckout(data: {
  map_id: string;
  product_sku: string;
  size: string;
  shipping_address: ShippingAddress;
  image_key: string;
  shipping_cost_cents?: number;
}): Promise<CheckoutResult> {
  return apiPost<CheckoutResult>('/api/checkout', data);
}

export function getOrder(id: string): Promise<Order> {
  return apiGet<Order>(`/api/orders/${id}`);
}

export function listOrders(): Promise<Order[]> {
  return apiGet<Order[]>('/api/orders');
}

export function getPrintQuote(data: {
  product_sku: string;
  size: string;
  country: string;
}): Promise<PrintQuoteResult> {
  return apiPost<PrintQuoteResult>('/api/print-quote', data);
}
