/**
 * Webhook handlers — Stripe + Prodigi.
 *
 * Mounted at /api/webhooks — CSRF is skipped for this path prefix.
 *
 * - POST /api/webhooks/stripe          — Stripe Checkout webhook
 * - POST /api/webhooks/prodigi/:secret — Prodigi order status webhook
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { getStripe } from '../lib/stripe.js';
import { notifyDiscord } from '../lib/discord.js';
import { createOrder as createProdigiOrder } from '../lib/prodigi.js';
import type { ShippingAddress } from '../../../shared/types.js';

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

    // Update order status
    const order = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE id = ?',
    ).bind(orderId).first<{ id: string; status: string; image_url: string | null; stripe_session_id: string | null; product_sku: string; shipping_address: string | null }>();

    if (!order) {
      // Order row may not be committed yet — return 500 so Stripe retries
      console.error(`Stripe webhook: order ${orderId} not found`);
      return c.json({ error: 'Order not found' }, 500);
    }

    // Determine next status based on whether image is already uploaded
    let nextStatus: string;

    if (order.image_url) {
      // Image ready — auto-submit to Prodigi
      try {
        const address: ShippingAddress = JSON.parse(order.shipping_address!);
        const baseUrl = c.env.BETTER_AUTH_URL;
        const imageUrl = order.image_url.startsWith('/')
          ? `${baseUrl}${order.image_url}`
          : order.image_url;

        const prodigiResult = await createProdigiOrder(c.env.PRODIGI_API_KEY, {
          orderId: order.id,
          sku: order.product_sku,
          imageUrl,
          shippingAddress: address,
        }, c.env.PRODIGI_SANDBOX === 'true');

        nextStatus = 'submitted';

        try {
          await c.env.DB.prepare(
            'UPDATE orders SET status = ?, prodigi_order_id = ?, updated_at = ? WHERE id = ?',
          ).bind(nextStatus, prodigiResult.prodigiOrderId, now, orderId).run();
        } catch (dbErr: unknown) {
          if (dbErr instanceof Error && dbErr.message.includes('UNIQUE constraint')) {
            return c.json({ received: true });
          }
          throw dbErr;
        }
      } catch (err) {
        console.error('Prodigi auto-submit failed:', err);
        // Fall back to pending_render so admin can manually submit
        nextStatus = 'pending_render';
        try {
          await c.env.DB.prepare(
            'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?',
          ).bind(nextStatus, now, orderId).run();
        } catch (dbErr: unknown) {
          if (dbErr instanceof Error && dbErr.message.includes('UNIQUE constraint')) {
            return c.json({ received: true });
          }
          throw dbErr;
        }
      }
    } else {
      // No image yet — wait for upload
      nextStatus = 'pending_render';

      try {
        await c.env.DB.prepare(
          'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?',
        ).bind(nextStatus, now, orderId).run();
      } catch (dbErr: unknown) {
        if (dbErr instanceof Error && dbErr.message.includes('UNIQUE constraint')) {
          return c.json({ received: true });
        }
        throw dbErr;
      }
    }

    // Notify Discord (only mark as notified if it actually succeeds)
    const notified = await notifyDiscord(
      c.env.DISCORD_WEBHOOK_URL,
      `New print order ${nextStatus === 'submitted' ? 'submitted to Prodigi' : 'ready for review'}: ${orderId.slice(0, 8).toUpperCase()} (${order.image_url ? 'image uploaded' : 'awaiting image'})`,
    );

    if (notified) {
      await c.env.DB.prepare(
        'UPDATE orders SET discord_notified = 1 WHERE id = ?',
      ).bind(orderId).run();
    }
  }

  return c.json({ received: true });
});

// ── Prodigi webhook ───────────────────────────────────────────────────────────

/** Map Prodigi status → our internal status. */
const PRODIGI_STATUS_MAP: Record<string, string> = {
  InProgress: 'in_production',
  Shipped: 'shipped',
  Complete: 'completed',
  Cancelled: 'cancelled',
};

webhooks.post('/prodigi/:secret', async (c) => {
  const secret = c.req.param('secret');
  if (!secret || secret !== c.env.PRODIGI_WEBHOOK_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  let body: {
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
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

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
