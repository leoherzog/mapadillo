/**
 * Order API routes — image upload, checkout, quotes, order management.
 *
 * Mounted at /api — provides:
 * - POST /api/images/:mapId       — upload print image to R2
 * - GET  /api/images/*            — serve R2 images (public, unguessable UUID)
 * - POST /api/checkout            — create Stripe Checkout session
 * - POST /api/print-quote         — get Prodigi shipping quote
 * - GET  /api/orders              — list current user's orders
 * - GET  /api/orders/:id          — get single order for current user
 * - GET  /api/admin/orders        — list all orders (admin)
 * - GET  /api/admin/orders/:id    — get single order (admin)
 * - PATCH /api/admin/orders/:id   — admin actions (submit to Prodigi)
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { getMapWithRole } from './maps.js';
import { getStripe } from '../lib/stripe.js';
import { getShippingQuote, createOrder as createProdigiOrder } from '../lib/prodigi.js';
import { getProductSize, buildFullSku } from '../../../shared/products.js';
import type { ShippingAddress } from '../../../shared/types.js';

const orders = new Hono<AppEnv>();

// ── Image upload ──────────────────────────────────────────────────────────────

orders.post('/images/:mapId', async (c) => {
  const userId = c.get('user')!.id;
  const mapId = c.req.param('mapId');

  const result = await getMapWithRole(c.env.DB, mapId, userId);
  if (!result) return c.json({ error: 'Map not found' }, 404);
  if (result.role !== 'owner' && result.role !== 'editor') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const formData = await c.req.parseBody();
  const file = formData['image'];
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'image file is required' }, 400);
  }

  // Validate file type and size (max 100MB)
  if (!file.type.startsWith('image/')) {
    return c.json({ error: 'File must be an image' }, 400);
  }
  if (file.size > 100 * 1024 * 1024) {
    return c.json({ error: 'File too large (max 100MB)' }, 400);
  }

  const uuid = crypto.randomUUID();
  const key = `${mapId}/${uuid}.png`;

  await c.env.ROADTRIP_PRINTS.put(key, file.stream(), {
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

  return new Response(object.body, { headers });
});

// ── Stripe Checkout ───────────────────────────────────────────────────────────

orders.post('/checkout', async (c) => {
  const userId = c.get('user')!.id;

  let body: {
    map_id: string;
    product_sku: string;
    size: string;
    shipping_address: ShippingAddress;
    image_key: string;
    shipping_cost_cents?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.map_id || !body.product_sku || !body.size || !body.shipping_address) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  // Validate map access
  const mapResult = await getMapWithRole(c.env.DB, body.map_id, userId);
  if (!mapResult) return c.json({ error: 'Map not found' }, 404);
  if (mapResult.role !== 'owner' && mapResult.role !== 'editor') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Look up product + size
  const product = getProductSize(body.product_sku, body.size);
  if (!product) return c.json({ error: 'Invalid product or size' }, 400);

  const orderId = crypto.randomUUID();
  const fullSku = buildFullSku(body.product_sku, body.size);
  // TODO: derive from product catalog if more products are added
  const productType = body.product_sku === 'GLOBAL-BLP' ? 'poster' : 'canvas';
  const shippingCostCents = body.shipping_cost_cents ?? product.shippingPlaceholderCents;
  const imageUrl = body.image_key ? `/api/images/${body.image_key}` : null;

  // Create Stripe Checkout session FIRST — if this fails, no orphaned DB row is left behind
  const stripe = getStripe(c.env.STRIPE_SECRET_KEY);
  const baseUrl = c.env.BETTER_AUTH_URL;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: `${productType === 'poster' ? 'Poster' : 'Canvas'} Print — ${body.size}` },
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
    success_url: `${baseUrl}/order-confirmation/${orderId}`,
    cancel_url: `${baseUrl}/order/${body.map_id}`,
  });

  // Insert order row only after Stripe succeeds, with the session ID included
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO orders (id, map_id, user_id, product_type, product_sku, poster_size, status, image_url, shipping_address, subtotal, shipping_cost, currency, stripe_session_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, 'usd', ?, ?, ?)`,
  ).bind(
    orderId, body.map_id, userId, productType, fullSku, body.size,
    imageUrl, JSON.stringify(body.shipping_address),
    product.priceCents, shippingCostCents, session.id, now, now,
  ).run();

  return c.json({ checkout_url: session.url });
});

// ── Print quote ───────────────────────────────────────────────────────────────

orders.post('/print-quote', async (c) => {
  let body: { product_sku: string; size: string; country: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

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
    }, c.env.PRODIGI_SANDBOX === 'true');
    return c.json({
      shipping_cost_cents: quote.shippingCostCents,
      estimated_days: quote.estimatedDays,
    });
  } catch (err) {
    console.error('Prodigi quote error:', err);
    return c.json({ error: 'Unable to get shipping quote' }, 502);
  }
});

// ── User orders ───────────────────────────────────────────────────────────────

orders.get('/orders', async (c) => {
  const userId = c.get('user')!.id;

  const result = await c.env.DB.prepare(
    `SELECT o.*, m.name as map_name
     FROM orders o
     JOIN maps m ON o.map_id = m.id
     WHERE o.user_id = ?
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

async function requireAdmin(c: { req: { header: (name: string) => string | undefined }; env: { ADMIN_SECRET: string }; json: (data: unknown, status: number) => Response }): Promise<Response | null> {
  const auth = c.req.header('authorization');
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  const expected = `Bearer ${c.env.ADMIN_SECRET}`;
  const encoder = new TextEncoder();
  const a = encoder.encode(auth);
  const b = encoder.encode(expected);
  if (a.byteLength !== b.byteLength) return c.json({ error: 'Unauthorized' }, 401);

  const isEqual = await crypto.subtle.timingSafeEqual(a, b);
  if (!isEqual) return c.json({ error: 'Unauthorized' }, 401);
  return null;
}

orders.get('/admin/orders', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const status = c.req.query('status');
  let query: string;
  const binds: string[] = [];

  if (status) {
    query = `SELECT o.*, m.name as map_name, u.email as user_email
             FROM orders o
             JOIN maps m ON o.map_id = m.id
             JOIN "user" u ON o.user_id = u.id
             WHERE o.status = ?
             ORDER BY o.created_at DESC LIMIT 200`;
    binds.push(status);
  } else {
    query = `SELECT o.*, m.name as map_name, u.email as user_email
             FROM orders o
             JOIN maps m ON o.map_id = m.id
             JOIN "user" u ON o.user_id = u.id
             ORDER BY o.created_at DESC LIMIT 200`;
  }

  const stmt = binds.length
    ? c.env.DB.prepare(query).bind(...binds)
    : c.env.DB.prepare(query);
  const result = await stmt.all();
  return c.json(result.results);
});

orders.get('/admin/orders/:id', async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

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
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const orderId = c.req.param('id');
  let body: { image_url?: string; action?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?')
    .bind(orderId).first<{
      id: string; status: string; image_url: string | null;
      product_sku: string; poster_size: string; shipping_address: string | null;
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
    if (!order.shipping_address) {
      return c.json({ error: 'Order has no shipping address' }, 400);
    }

    const address: ShippingAddress = JSON.parse(order.shipping_address);
    const baseUrl = c.env.BETTER_AUTH_URL;
    const imageUrl = order.image_url.startsWith('/')
      ? `${baseUrl}${order.image_url}`
      : order.image_url;

    try {
      const prodigiResult = await createProdigiOrder(c.env.PRODIGI_API_KEY, {
        orderId: order.id,
        sku: order.product_sku,
        imageUrl,
        shippingAddress: address,
      }, c.env.PRODIGI_SANDBOX === 'true');

      await c.env.DB.prepare(
        'UPDATE orders SET prodigi_order_id = ?, status = ?, updated_at = ? WHERE id = ?',
      ).bind(prodigiResult.prodigiOrderId, 'submitted', now, orderId).run();

      return c.json({ success: true, prodigi_order_id: prodigiResult.prodigiOrderId });
    } catch (err) {
      console.error('Admin Prodigi submission failed:', err);
      return c.json({ error: `Prodigi submission failed: ${err instanceof Error ? err.message : 'Unknown error'}` }, 502);
    }
  }

  return c.json({ success: true });
});

export default orders;
