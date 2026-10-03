/** Order workflow helpers shared by the admin order routes and the Stripe webhook. */
import type { Env } from '../types.js';
import type { ShippingAddress } from '../../../shared/types.js';
import { createOrder, isSandbox } from './prodigi.js';

export interface SubmittableOrder {
  id: string;
  product_sku: string;
  image_url: string;
  shippingAddress: ShippingAddress;
  /** Buyer email collected by Stripe Checkout, or null when none was recorded. */
  email: string | null;
}

/**
 * Submit an order to Prodigi and mark it `submitted` in D1.
 * A relative image_url is resolved against BETTER_AUTH_URL so Prodigi can fetch it.
 * @returns the Prodigi order id
 */
export async function submitOrderToProdigi(env: Env, order: SubmittableOrder, now: string): Promise<string> {
  const { prodigiOrderId } = await createOrder(env.PRODIGI_API_KEY, {
    orderId: order.id,
    sku: order.product_sku,
    imageUrl: new URL(order.image_url, env.BETTER_AUTH_URL).href,
    shippingAddress: order.shippingAddress,
    email: order.email ?? undefined,
    // Prodigi only calls back to a public https URL.
    callbackUrl: env.BETTER_AUTH_URL.startsWith('https://')
      ? new URL('/api/webhooks/prodigi', env.BETTER_AUTH_URL).href
      : undefined,
  }, isSandbox(env.PRODIGI_SANDBOX));

  await env.DB.prepare(
    'UPDATE orders SET status = ?, prodigi_order_id = ?, updated_at = ? WHERE id = ?',
  ).bind('submitted', prodigiOrderId, now, order.id).run();

  return prodigiOrderId;
}
