/**
 * Webhook handlers — Stripe + Prodigi.
 *
 * Mounted at /api/webhooks — CSRF is skipped for this path prefix.
 *
 * - POST /api/webhooks/stripe  — Stripe Checkout events (signature verified). The Dashboard endpoint must
 *                                subscribe to checkout.session.completed, .async_payment_succeeded,
 *                                .async_payment_failed and .expired, or delayed payments never settle and
 *                                unpaid orders are never deleted.
 * - POST /api/webhooks/prodigi — Prodigi order callbacks. They are unauthenticated, so the
 *                                payload is only a hint and order state is re-read from the Prodigi API.
 */

import { Hono, type Context } from 'hono';
import type Stripe from 'stripe';
import type { AppEnv, Env } from '../types.js';
import { getStripe } from '../lib/stripe.js';
import { notifyDiscord } from '../lib/discord.js';
import { readJsonBody } from '../lib/json-body.js';
import { submitOrderToProdigi } from '../lib/orders.js';
import { getOrder, isSandbox, type ProdigiOrder } from '../lib/prodigi.js';
import { ORDER_STATUSES, orderRef } from '../../../shared/products.js';
import { parseShippingAddress, type Order, type OrderStatus, type ShippingAddress } from '../../../shared/types.js';

const webhooks = new Hono<AppEnv>();

/** Path prefix of print images stored in R2; the rest of the URL is the object key. */
const IMAGE_PATH = '/api/images/';

/** Stripe secret and restricted keys in test mode. */
const STRIPE_TEST_KEY = /^[sr]k_test_/;

// ── Stripe webhook ────────────────────────────────────────────────────────────

webhooks.post('/stripe', async (c) => {
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const sig = c.req.header('stripe-signature');
  if (!sig) return c.json({ error: 'Missing signature' }, 400);

  const body = await c.req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      c.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('Stripe signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      // Delayed payment methods complete as 'unpaid' and settle via async_payment_succeeded.
      if (event.data.object.payment_status !== 'paid') break;
      return claimPaidOrder(c, event.data.object);
    case 'checkout.session.async_payment_succeeded':
      return claimPaidOrder(c, event.data.object);
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      await deleteUnpaidOrder(c.env, event.data.object.metadata?.order_id);
      break;
  }

  return c.json({ received: true });
});

/** Move a paid order out of pending_payment exactly once, then submit and notify in the background. */
async function claimPaidOrder(c: Context<AppEnv>, session: Stripe.Checkout.Session): Promise<Response> {
  const orderId = session.metadata?.order_id;
  if (!orderId) {
    console.error('Stripe webhook: no order_id in metadata');
    return c.json({ received: true });
  }

  const order = await c.env.DB.prepare(
    'SELECT * FROM orders WHERE id = ?',
  ).bind(orderId).first<Order>();

  if (!order) {
    // Another environment sharing the Stripe account, or a deleted row; retrying cannot help.
    console.warn(`Stripe webhook: order ${orderId} not found`);
    return c.json({ received: true });
  }
  if (order.status !== 'pending_payment') return c.json({ received: true });

  // If two deliveries race, only one UPDATE matches pending_payment and proceeds.
  const address = parseShippingAddress(order.shipping_address);
  const email = session.customer_details?.email ?? null;
  const provisionalStatus = order.image_url && address ? 'paid' : 'pending_render';
  const claim = await c.env.DB.prepare(
    'UPDATE orders SET status = ?, customer_email = ?, updated_at = ? WHERE id = ? AND status = ?',
  ).bind(provisionalStatus, email, new Date().toISOString(), orderId, 'pending_payment').run();

  if (!claim.meta.changes) {
    return c.json({ received: true });
  }

  // Return 200 ASAP — slow external calls (Prodigi + Discord) run in the
  // background so Stripe doesn't time out and retry.
  c.executionCtx.waitUntil(
    finalizeOrderAfterPayment(c.env, order, address, email).catch((err) => {
      console.error('Post-payment finalization failed:', err);
    }),
  );
  return c.json({ received: true });
}

/** Delete an order whose checkout took no payment, and its print image unless another order uses it. */
async function deleteUnpaidOrder(env: Env, orderId: string | undefined): Promise<void> {
  if (!orderId) return;

  const removed = await env.DB.prepare(
    'DELETE FROM orders WHERE id = ? AND status = ? RETURNING image_url',
  ).bind(orderId, 'pending_payment').first<{ image_url: string | null }>();

  const imageUrl = removed?.image_url;
  if (!imageUrl?.startsWith(IMAGE_PATH)) return;

  const stillUsed = await env.DB.prepare(
    'SELECT 1 FROM orders WHERE image_url = ? LIMIT 1',
  ).bind(imageUrl).first();
  if (!stillUsed) await env.ROADTRIP_PRINTS.delete(imageUrl.slice(IMAGE_PATH.length));
}

/**
 * Background work after a Stripe payment: submit to Prodigi (if the image and
 * address are ready) and notify Discord. Runs inside ctx.waitUntil so the
 * webhook response is not blocked on external APIs.
 */
async function finalizeOrderAfterPayment(
  env: Env,
  order: Pick<Order, 'id' | 'image_url' | 'product_sku' | 'shipping_address'>,
  address: ShippingAddress | null,
  email: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  let outcome = 'ready for review';

  if (order.image_url && address) {
    if (STRIPE_TEST_KEY.test(env.STRIPE_SECRET_KEY) && !isSandbox(env.PRODIGI_SANDBOX)) {
      // A test payment must never place a billed live print; the order stays paid for an admin.
      console.warn(`Order ${order.id} paid with a Stripe test key; not submitted to live Prodigi`);
      outcome = 'paid in Stripe test mode, not submitted to live Prodigi';
    } else {
      try {
        await submitOrderToProdigi(env, {
          id: order.id,
          product_sku: order.product_sku,
          image_url: order.image_url,
          shippingAddress: address,
          email,
        }, now);
        outcome = 'submitted to Prodigi';
      } catch (err) {
        // The claim wrote 'paid'; demote so an admin can resubmit, unless one already has.
        console.error('Prodigi auto-submit failed:', err);
        await env.DB.prepare(
          'UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
        ).bind('pending_render', now, order.id, 'paid').run();
      }
    }
  } else if (order.image_url && order.shipping_address) {
    // The claim already left the order at pending_render for admin review.
    console.error(`Order ${order.id} has an invalid shipping_address`);
  }

  const notified = await notifyDiscord(
    env.DISCORD_WEBHOOK_URL,
    `New print order ${outcome}: ${orderRef(order.id)} (${order.image_url ? 'image uploaded' : 'awaiting image'})`,
  );

  if (notified) {
    await env.DB.prepare(
      'UPDATE orders SET discord_notified = 1 WHERE id = ?',
    ).bind(order.id).run();
  }
}

// ── Prodigi webhook ───────────────────────────────────────────────────────────

/** Map a Prodigi order to our status, or null for an unknown stage. Shipped is a shipment status, not a stage. */
function mapProdigiStatus(order: ProdigiOrder): OrderStatus | null {
  switch (order.status?.stage) {
    case 'Cancelled': return 'cancelled';
    case 'Complete': return 'completed';
    case 'InProgress': return order.shipments?.some((s) => s.status === 'Shipped') ? 'shipped' : 'in_production';
    default: return null;
  }
}

webhooks.post('/prodigi', async (c) => {
  const body = await readJsonBody<{ subject?: string; data?: { order?: { id?: string } } }>(c);
  if (!body) return c.res;

  const prodigiOrderId = body.subject ?? body.data?.order?.id;
  if (!prodigiOrderId) return c.json({ received: true });

  // Unknown ids are acknowledged without calling Prodigi.
  const row = await c.env.DB.prepare(
    'SELECT id, status FROM orders WHERE prodigi_order_id = ?',
  ).bind(prodigiOrderId).first<{ id: string; status: OrderStatus }>();
  if (!row) return c.json({ received: true });

  let order: ProdigiOrder;
  try {
    order = await getOrder(c.env.PRODIGI_API_KEY, prodigiOrderId, isSandbox(c.env.PRODIGI_SANDBOX));
  } catch (err) {
    console.error('Prodigi order lookup failed:', err);
    return c.json({ error: 'Prodigi lookup failed' }, 502);
  }

  const next = mapProdigiStatus(order);
  if (!next) {
    console.warn(`Unknown Prodigi stage: ${order.status?.stage}`);
    return c.json({ received: true });
  }

  // Callbacks can arrive late; never move an order backwards. An equal status may still add tracking.
  if (ORDER_STATUSES.indexOf(next) < ORDER_STATUSES.indexOf(row.status)) {
    return c.json({ received: true });
  }

  // tracking_url is rendered as a link href, so only http(s) URLs are stored.
  const url = order.shipments?.find((s) => s.tracking?.url)?.tracking?.url;
  const trackingUrl = url && /^https?:\/\//i.test(url) ? url : null;

  // Compare-and-swap on the status read above; a concurrent callback that already moved the row wins.
  const result = await c.env.DB.prepare(
    'UPDATE orders SET status = ?, updated_at = ?, tracking_url = COALESCE(?, tracking_url) WHERE id = ? AND status = ?',
  ).bind(next, new Date().toISOString(), trackingUrl, row.id, row.status).run();

  if (next === 'cancelled' && row.status !== 'cancelled' && result.meta.changes) {
    await notifyDiscord(
      c.env.DISCORD_WEBHOOK_URL,
      `Prodigi cancelled print order ${orderRef(row.id)} (${prodigiOrderId}): refund needed; reprint via the Prodigi dashboard`,
    );
  }

  return c.json({ received: true });
});

export default webhooks;
