/**
 * Webhook handlers — Stripe + Prodigi.
 *
 * Mounted at /api/webhooks — CSRF is skipped for this path prefix.
 *
 * - POST /api/webhooks/stripe  — Stripe Checkout webhook (signature verified)
 * - POST /api/webhooks/prodigi — Prodigi order status webhook
 *                                (shared secret via X-Prodigi-Webhook-Secret)
 */

import { Hono } from 'hono';
import type { AppEnv, Env } from '../types.js';
import { getStripe } from '../lib/stripe.js';
import { notifyDiscord } from '../lib/discord.js';
import { secretsEqual } from '../lib/hash.js';
import { readJsonBody } from '../lib/json-body.js';
import { submitOrderToProdigi } from '../lib/orders.js';
import { parseShippingAddress, type ShippingAddress } from '../../../shared/types.js';

const webhooks = new Hono<AppEnv>();

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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata?.order_id;
    if (!orderId) {
      console.error('Stripe webhook: no order_id in metadata');
      return c.json({ received: true });
    }

    const now = new Date().toISOString();

    // Check for duplicate processing — skip if already past pending_payment
    const existing = await c.env.DB.prepare(
      'SELECT id, status FROM orders WHERE id = ? AND status != ?',
    ).bind(orderId, 'pending_payment').first();

    if (existing) {
      // Already processed — idempotent success
      return c.json({ received: true });
    }

    const order = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE id = ?',
    ).bind(orderId).first<{ id: string; status: string; image_url: string | null; stripe_session_id: string | null; product_sku: string; shipping_address: string | null }>();

    if (!order) {
      // Order row may not be committed yet — return 500 so Stripe retries
      console.error(`Stripe webhook: order ${orderId} not found`);
      return c.json({ error: 'Order not found' }, 500);
    }

    // Atomically claim this order for processing by flipping out of pending_payment.
    // If two webhook deliveries race, only one UPDATE will match and proceed.
    const address = parseShippingAddress(order.shipping_address);
    const provisionalStatus = order.image_url && address ? 'paid' : 'pending_render';
    const claim = await c.env.DB.prepare(
      'UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?',
    ).bind(provisionalStatus, now, orderId, 'pending_payment').run();

    if (!claim.meta.changes) {
      return c.json({ received: true });
    }

    // Return 200 ASAP — slow external calls (Prodigi + Discord) run in the
    // background so Stripe doesn't time out and retry.
    c.executionCtx.waitUntil(
      finalizeOrderAfterPayment(c.env, order, address).catch((err) => {
        console.error('Post-payment finalization failed:', err);
      }),
    );
  }

  return c.json({ received: true });
});

/**
 * Background work after a Stripe checkout completes: submit to Prodigi (if
 * image is ready) and notify Discord. Runs inside ctx.waitUntil so the
 * webhook response is not blocked on external APIs.
 */
async function finalizeOrderAfterPayment(
  env: Env,
  order: { id: string; image_url: string | null; product_sku: string; shipping_address: string | null },
  address: ShippingAddress | null,
): Promise<void> {
  const now = new Date().toISOString();
  let finalStatus: 'submitted' | 'pending_render' = 'pending_render';

  if (order.image_url && address) {
    try {
      await submitOrderToProdigi(env, {
        id: order.id,
        product_sku: order.product_sku,
        image_url: order.image_url,
        shippingAddress: address,
      }, now);
      finalStatus = 'submitted';
    } catch (err) {
      // The claim wrote 'paid'; demote so an admin can resubmit.
      console.error('Prodigi auto-submit failed:', err);
      await env.DB.prepare(
        'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?',
      ).bind('pending_render', now, order.id).run();
    }
  } else if (order.image_url && order.shipping_address) {
    // The claim already left the order at pending_render for admin review.
    console.error(`Order ${order.id} has unparseable shipping_address JSON`);
  }

  const notified = await notifyDiscord(
    env.DISCORD_WEBHOOK_URL,
    `New print order ${finalStatus === 'submitted' ? 'submitted to Prodigi' : 'ready for review'}: ${order.id.slice(0, 8).toUpperCase()} (${order.image_url ? 'image uploaded' : 'awaiting image'})`,
  );

  if (notified) {
    await env.DB.prepare(
      'UPDATE orders SET discord_notified = 1 WHERE id = ?',
    ).bind(order.id).run();
  }
}

// ── Prodigi webhook ───────────────────────────────────────────────────────────

/** Map Prodigi status → our internal status. */
const PRODIGI_STATUS_MAP: Record<string, string> = {
  InProgress: 'in_production',
  Shipped: 'shipped',
  Complete: 'completed',
  Cancelled: 'cancelled',
};

webhooks.post('/prodigi', async (c) => {
  // Secret comes from a header rather than the URL so it doesn't leak via
  // access logs, proxy logs, or browser history.
  const headerSecret = c.req.header('x-prodigi-webhook-secret') ?? '';
  const expected = c.env.PRODIGI_WEBHOOK_SECRET ?? '';
  if (!expected || !headerSecret || !(await secretsEqual(headerSecret, expected))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const body = await readJsonBody<{
    specversion?: string;
    type?: string;
    data?: {
      order?: {
        id?: string;
        status?: { stage?: string };
        shipments?: Array<{
          carrier?: { name?: string; service?: string };
          tracking?: { url?: string; number?: string };
        }>;
      };
    };
  }>(c);
  if (!body) return c.res;

  const prodigiOrderId = body.data?.order?.id;
  const prodigiStatus = body.data?.order?.status?.stage;

  if (!prodigiOrderId || !prodigiStatus) {
    return c.json({ received: true });
  }

  const ourStatus = PRODIGI_STATUS_MAP[prodigiStatus];
  if (!ourStatus) {
    // Unknown status — log and acknowledge
    console.warn(`Unknown Prodigi status: ${prodigiStatus}`);
    return c.json({ received: true });
  }

  const now = new Date().toISOString();

  // Extract tracking URL if available
  const trackingUrl = body.data?.order?.shipments?.[0]?.tracking?.url ?? null;

  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const values: (string | null)[] = [ourStatus, now];

  if (trackingUrl) {
    updates.push('tracking_url = ?');
    values.push(trackingUrl);
  }

  values.push(prodigiOrderId); // WHERE clause

  await c.env.DB.prepare(
    `UPDATE orders SET ${updates.join(', ')} WHERE prodigi_order_id = ?`,
  ).bind(...values).run();

  return c.json({ received: true });
});

export default webhooks;
