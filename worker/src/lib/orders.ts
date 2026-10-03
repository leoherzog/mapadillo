/** Order workflow helpers shared by the admin order routes and the Stripe webhook. */
import type { Env } from '../types.js';
import type { ShippingAddress } from '../../../shared/types.js';
import { createOrder, isSandbox } from './prodigi.js';

export interface SubmittableOrder {
  id: string;
  product_sku: string;
  image_url: string;
  shippingAddress: ShippingAddress;
}

/**
 * Submit an order to Prodigi and mark it `submitted` in D1.
 * A relative image_url is resolved against BETTER_AUTH_URL so Prodigi can fetch it.
 * @returns the Prodigi order id
 */
export async function submitOrderToProdigi(env: Env, order: SubmittableOrder, now: string): Promise<string> {
  const imageUrl = order.image_url.startsWith('/')
    ? `${env.BETTER_AUTH_URL}${order.image_url}`
    : order.image_url;

  const { prodigiOrderId } = await createOrder(env.PRODIGI_API_KEY, {
    orderId: order.id,
    sku: order.product_sku,
    imageUrl,
    shippingAddress: order.shippingAddress,
  }, isSandbox(env.PRODIGI_SANDBOX));

  await env.DB.prepare(
    'UPDATE orders SET status = ?, prodigi_order_id = ?, updated_at = ? WHERE id = ?',
  ).bind('submitted', prodigiOrderId, now, order.id).run();

  return prodigiOrderId;
}
