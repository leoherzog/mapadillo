/**
 * Order API routes — image upload, checkout, quotes, order management.
 *
 * Mounted at /api — provides:
 * - POST /api/images/:mapId       — stream a raw PNG body (≤100MB) to R2
 * - GET  /api/images/*            — serve R2 images (public, unguessable UUID)
 * - POST /api/checkout            — quote shipping and create a Stripe Checkout session
 * - POST /api/print-quote         — get Prodigi shipping quote
 * - GET  /api/orders              — list current user's orders, excluding unpaid checkouts
 * - GET  /api/orders/:id          — get single order for current user
 * - GET  /api/admin/orders        — list all orders (admin)
 * - GET  /api/admin/orders/:id    — get single order (admin)
 * - PATCH /api/admin/orders/:id   — admin actions (submit to Prodigi)
 */

import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types.js';
import { getMapWithRole, requireMapRole } from './maps.js';
import { readJsonBody } from '../lib/json-body.js';
import { getStripe } from '../lib/stripe.js';
import { getShippingQuote, isSandbox, ProdigiNotAvailableError } from '../lib/prodigi.js';
import { secretsEqual } from '../lib/hash.js';
import { submitOrderToProdigi } from '../lib/orders.js';
import { getProductBySku, getProductSize, buildFullSku } from '../../../shared/products.js';
import { canEditRole, toShippingAddress, parseShippingAddress, type CheckoutBody, type PrintQuoteBody } from '../../../shared/types.js';

const orders = new Hono<AppEnv>();

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** 422 when Prodigi cannot ship the item to that country, otherwise 502. */
function quoteErrorResponse(c: Context<AppEnv>, err: unknown): Response {
  if (err instanceof ProdigiNotAvailableError) {
    return c.json({ error: 'This print cannot ship to that country' }, 422);
  }
  console.error('Prodigi quote error:', err);
  return c.json({ error: 'Unable to get shipping quote' }, 502);
}

// ── Image upload ──────────────────────────────────────────────────────────────

orders.post('/images/:mapId', async (c) => {
  const result = await requireMapRole(c, 'editor', { param: 'mapId' });
  if (!result) return c.res;
  const mapId = result.map.id;

  if (c.req.header('content-type') !== 'image/png') {
    return c.json({ error: 'Body must be a PNG image' }, 415);
  }
  // R2 only accepts a stream of known length, so Content-Length is required.
  const length = Number(c.req.header('content-length'));
  const body = c.req.raw.body;
  if (!body || !Number.isInteger(length) || length <= 0) {
    return c.json({ error: 'image body is required' }, 400);
  }
  if (length > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'File too large (max 100MB)' }, 413);
  }

  const key = `${mapId}/${crypto.randomUUID()}.png`;
  await c.env.ROADTRIP_PRINTS.put(key, body, {
    httpMetadata: { contentType: 'image/png' },
  });

  return c.json({ key, url: `/api/images/${key}` }, 201);
});

// ── Image serving ─────────────────────────────────────────────────────────────

orders.get('/images/*', async (c) => {
  const key = c.req.path.replace('/api/images/', '');
  if (!key) return c.json({ error: 'Key required' }, 400);

  const object = await c.env.ROADTRIP_PRINTS.get(key);
  if (!object) return c.json({ error: 'Not found' }, 404);

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(object.body, { headers });
});

// ── Stripe Checkout ───────────────────────────────────────────────────────────

orders.post('/checkout', async (c) => {
  const userId = c.get('user')!.id;

  const body = await readJsonBody<CheckoutBody>(c);
  if (!body) return c.res;

  if (!body.map_id || !body.product_sku || !body.size || !body.shipping_address) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const validatedAddress = toShippingAddress(body.shipping_address);
  if (!validatedAddress) {
    return c.json({ error: 'Invalid shipping_address: name, line1, city, postalCode and a two-letter country code are required' }, 400);
  }
  body.shipping_address = validatedAddress;

  // Validate map access
  const mapResult = await getMapWithRole(c.env.DB, body.map_id, userId);
  if (!mapResult) return c.json({ error: 'Map not found' }, 404);
  if (!canEditRole(mapResult.role)) return c.json({ error: 'Forbidden' }, 403);

  // Look up product + size
  const catalog = getProductBySku(body.product_sku);
  const product = catalog?.sizes.find((s) => s.size === body.size);
  if (!catalog || !product) return c.json({ error: 'Invalid product or size' }, 400);

  // R2 keys are literal and uploads use `${mapId}/${uuid}.png`, so an existing key under this map is its upload.
  const imageKey = body.image_key;
  if (
    typeof imageKey !== 'string'
    || !imageKey.startsWith(`${mapResult.map.id}/`)
    || !(await c.env.ROADTRIP_PRINTS.head(imageKey))
  ) {
    return c.json({ error: 'Invalid image_key' }, 400);
  }

  const fullSku = buildFullSku(body.product_sku, body.size);
  let shippingCostCents: number;
  try {
    ({ shippingCostCents } = await getShippingQuote(c.env.PRODIGI_API_KEY, {
      sku: fullSku,
      destinationCountry: body.shipping_address.country,
    }, isSandbox(c.env.PRODIGI_SANDBOX)));
  } catch (err) {
    return quoteErrorResponse(c, err);
  }

  const orderId = crypto.randomUUID();

  // Create Stripe Checkout session FIRST — if this fails, no orphaned DB row is left behind
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const baseUrl = c.env.BETTER_AUTH_URL;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${catalog.name} — ${product.label}` },
          unit_amount: product.priceCents,
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'Shipping' },
          unit_amount: shippingCostCents,
        },
        quantity: 1,
      },
    ],
    metadata: { order_id: orderId },
    // Stripe requires at least 30 minutes; checkout.session.expired then deletes the unpaid order.
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    success_url: new URL(`/order-confirmation/${orderId}`, baseUrl).href,
    cancel_url: new URL(`/order/${body.map_id}`, baseUrl).href,
  });

  // The guarded INSERT adds nothing if the map was deleted after the access check.
  const now = new Date().toISOString();
  const inserted = await c.env.DB.prepare(
    `INSERT INTO orders (id, map_id, user_id, product_type, product_sku, poster_size, status, image_url, shipping_address, subtotal, shipping_cost, currency, stripe_session_id, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, 'usd', ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM maps WHERE id = ?)`,
  ).bind(
    orderId, body.map_id, userId, catalog.type, fullSku, body.size,
    `/api/images/${imageKey}`, JSON.stringify(body.shipping_address),
    product.priceCents, shippingCostCents, session.id, now, now,
    body.map_id,
  ).run();
  if (!inserted.meta.changes) {
    await stripe.checkout.sessions.expire(session.id);
    return c.json({ error: 'Map not found' }, 404);
  }

  return c.json({ checkout_url: session.url });
});

// ── Print quote ───────────────────────────────────────────────────────────────

orders.post('/print-quote', async (c) => {
  const body = await readJsonBody<PrintQuoteBody>(c);
  if (!body) return c.res;

  if (!body.product_sku || !body.size || !body.country) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const product = getProductSize(body.product_sku, body.size);
  if (!product) return c.json({ error: 'Invalid product or size' }, 400);

  const fullSku = buildFullSku(body.product_sku, body.size);

  try {
    const quote = await getShippingQuote(c.env.PRODIGI_API_KEY, {
      sku: fullSku,
      destinationCountry: body.country,
    }, isSandbox(c.env.PRODIGI_SANDBOX));
    return c.json({ shipping_cost_cents: quote.shippingCostCents });
  } catch (err) {
    return quoteErrorResponse(c, err);
  }
});

// ── User orders ───────────────────────────────────────────────────────────────

orders.get('/orders', async (c) => {
  const userId = c.get('user')!.id;

  const result = await c.env.DB.prepare(
    `SELECT o.*, m.name as map_name
     FROM orders o
     JOIN maps m ON o.map_id = m.id
     WHERE o.user_id = ? AND o.status != 'pending_payment'
     ORDER BY o.created_at DESC
     LIMIT 100`,
  ).bind(userId).all();

  return c.json(result.results);
});

orders.get('/orders/:id', async (c) => {
  const userId = c.get('user')!.id;
  const orderId = c.req.param('id');

  const order = await c.env.DB.prepare(
    `SELECT o.*, m.name as map_name
     FROM orders o
     JOIN maps m ON o.map_id = m.id
     WHERE o.id = ? AND o.user_id = ?`,
  ).bind(orderId, userId).first();

  if (!order) return c.json({ error: 'Order not found' }, 404);
  return c.json(order);
});

// ── Admin orders ──────────────────────────────────────────────────────────────

/** Rejects /admin/* requests that lack `Bearer <ADMIN_SECRET>`, and all of them when the secret is unset. */
orders.use('/admin/*', createMiddleware<AppEnv>(async (c, next) => {
  const secret = c.env.ADMIN_SECRET;
  const auth = c.req.header('authorization');
  if (!secret || !auth || !(await secretsEqual(auth, `Bearer ${secret}`))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
}));

orders.get('/admin/orders', async (c) => {
  const status = c.req.query('status');
  const binds = status ? [status] : [];

  const result = await c.env.DB.prepare(
    `SELECT o.*, m.name as map_name, u.email as user_email
     FROM orders o
     JOIN maps m ON o.map_id = m.id
     JOIN "user" u ON o.user_id = u.id
     ${status ? 'WHERE o.status = ?' : ''}
     ORDER BY o.created_at DESC LIMIT 200`,
  ).bind(...binds).all();
  return c.json(result.results);
});

orders.get('/admin/orders/:id', async (c) => {
  const orderId = c.req.param('id');
  const order = await c.env.DB.prepare(
    `SELECT o.*, m.name as map_name, u.email as user_email
     FROM orders o
     JOIN maps m ON o.map_id = m.id
     JOIN "user" u ON o.user_id = u.id
     WHERE o.id = ?`,
  ).bind(orderId).first();

  if (!order) return c.json({ error: 'Order not found' }, 404);
  return c.json(order);
});

orders.patch('/admin/orders/:id', async (c) => {
  const orderId = c.req.param('id');
  const body = await readJsonBody<{ image_url?: string; action?: string }>(c);
  if (!body) return c.res;

  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(orderId).first<{
      id: string; status: string; image_url: string | null;
      product_sku: string; poster_size: string; shipping_address: string | null;
      customer_email: string | null;
    }>();
  if (!order) return c.json({ error: 'Order not found' }, 404);

  const now = new Date().toISOString();

  // Update image URL if provided
  if (body.image_url) {
    await c.env.DB.prepare(
      'UPDATE orders SET image_url = ?, updated_at = ? WHERE id = ?',
    ).bind(body.image_url, now, orderId).run();
    order.image_url = body.image_url;
  }

  // Submit to Prodigi
  if (body.action === 'submit_to_prodigi') {
    if (order.status !== 'pending_render' && order.status !== 'paid') {
      return c.json({ error: `Cannot submit order in status: ${order.status}` }, 400);
    }
    if (!order.image_url) {
      return c.json({ error: 'Order has no image URL' }, 400);
    }
    const address = parseShippingAddress(order.shipping_address);
    if (!address) {
      return c.json({ error: 'Order has no (or malformed) shipping address' }, 400);
    }

    try {
      const prodigiOrderId = await submitOrderToProdigi(c.env, {
        id: order.id,
        product_sku: order.product_sku,
        image_url: order.image_url,
        shippingAddress: address,
        email: order.customer_email,
      }, now);

      return c.json({ success: true, prodigi_order_id: prodigiOrderId });
    } catch (err) {
      console.error('Admin Prodigi submission failed:', err);
      return c.json({ error: `Prodigi submission failed: ${err instanceof Error ? err.message : 'Unknown error'}` }, 502);
    }
  }

  return c.json({ success: true });
});

export default orders;
