import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyTestSchema, request, createTestSession } from '../test-helpers.js';
// env is used directly in test bodies for insertOrder and other DB operations

beforeAll(applyTestSchema);

const ADMIN_SECRET = (env as unknown as Record<string, string>).ADMIN_SECRET;
const PRODIGI_WEBHOOK_SECRET = (env as unknown as Record<string, string>).PRODIGI_WEBHOOK_SECRET;

async function createTestMap(userId: string): Promise<string> {
  const mapId = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO maps (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, datetime(\'now\'), datetime(\'now\'))',
  ).bind(mapId, userId, 'Test Trip').run();
  return mapId;
}

const TEST_ADDRESS = JSON.stringify({
  name: 'Test User',
  line1: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
});

async function insertOrder(opts: {
  orderId?: string;
  mapId: string;
  userId: string;
  status?: string;
  prodigiOrderId?: string | null;
  imageUrl?: string | null;
  stripeSessionId?: string | null;
  shippingAddress?: string | null;
}): Promise<string> {
  const orderId = opts.orderId ?? crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO orders (id, map_id, user_id, product_type, product_sku, poster_size, status, prodigi_order_id, image_url, stripe_session_id, shipping_address, subtotal, shipping_cost, created_at, updated_at)
     VALUES (?, ?, ?, 'poster', 'GLOBAL-BLP-18X24', '18x24', ?, ?, ?, ?, ?, 2999, 999, datetime('now'), datetime('now'))`,
  ).bind(
    orderId, opts.mapId, opts.userId,
    opts.status ?? 'pending_payment',
    opts.prodigiOrderId ?? null,
    opts.imageUrl ?? null,
    opts.stripeSessionId ?? null,
    'shippingAddress' in opts ? opts.shippingAddress : TEST_ADDRESS,
  ).run();
  return orderId;
}

// ── Image upload tests ────────────────────────────────────────────────────────

describe('Image upload & serving', () => {
  it('requires auth for upload', async () => {
    const res = await request('/api/images/some-map-id', {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent map', async () => {
    const { cookie } = await createTestSession();
    const formData = new FormData();
    formData.append('image', new File(['x'], 'test.png', { type: 'image/png' }));

    const res = await request('/api/images/nonexistent', {
      method: 'POST',
      headers: { cookie },
      body: formData,
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 for viewer uploading image', async () => {
    const { cookie: ownerCookie, userId: ownerId } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createTestMap(ownerId);

    // Share as viewer
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, \'viewer\')',
    ).bind(crypto.randomUUID(), mapId, viewerId).run();

    const formData = new FormData();
    formData.append('image', new File(['x'], 'test.png', { type: 'image/png' }));

    const res = await request(`/api/images/${mapId}`, {
      method: 'POST',
      headers: { cookie: viewerCookie },
      body: formData,
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 when image field is missing', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createTestMap(userId);

    const res = await request(`/api/images/${mapId}`, {
      method: 'POST',
      headers: { cookie },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('image file is required');
  });

  it('returns 400 for non-image file type', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createTestMap(userId);

    const formData = new FormData();
    formData.append('image', new File(['hello'], 'test.txt', { type: 'text/plain' }));

    const res = await request(`/api/images/${mapId}`, {
      method: 'POST',
      headers: { cookie },
      body: formData,
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('File must be an image');
  });

  it('uploads image successfully and returns key', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createTestMap(userId);

    const formData = new FormData();
    formData.append('image', new File(['PNG data'], 'map.png', { type: 'image/png' }));

    const res = await request(`/api/images/${mapId}`, {
      method: 'POST',
      headers: { cookie },
      body: formData,
    });
    expect(res.status).toBe(201);
    const data = await res.json() as { key: string; url: string };
    expect(data.key).toContain(`${mapId}/`);
    expect(data.key).toMatch(/\.png$/);
    expect(data.url).toBe(`/api/images/${data.key}`);
  });

  it('editor can upload image', async () => {
    const { userId: ownerId } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createTestMap(ownerId);

    // Share as editor
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, \'editor\')',
    ).bind(crypto.randomUUID(), mapId, editorId).run();

    const formData = new FormData();
    formData.append('image', new File(['PNG data'], 'map.png', { type: 'image/png' }));

    const res = await request(`/api/images/${mapId}`, {
      method: 'POST',
      headers: { cookie: editorCookie },
      body: formData,
    });
    expect(res.status).toBe(201);
  });

  it('returns 404 for non-existent image key', async () => {
    const res = await request('/api/images/some-map/some-uuid.png');
    expect(res.status).toBe(404);
  });
});

// ── Checkout tests ───────────────────────────────────────────────────────────

describe('Checkout', () => {
  it('requires auth', async () => {
    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid JSON body');
  });

  it('returns 400 for missing required fields', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ map_id: 'x' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Missing required fields');
  });

  it('returns 404 for non-existent map', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        map_id: 'nonexistent',
        product_sku: 'GLOBAL-BLP',
        size: '18x24',
        shipping_address: { name: 'Test', line1: '123 St', city: 'X', state: 'IL', postalCode: '62701', country: 'US' },
      }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 for viewer trying to checkout', async () => {
    const { userId: ownerId } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await createTestMap(ownerId);

    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, \'viewer\')',
    ).bind(crypto.randomUUID(), mapId, viewerId).run();

    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie: viewerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        map_id: mapId,
        product_sku: 'GLOBAL-BLP',
        size: '18x24',
        shipping_address: { name: 'Test', line1: '123 St', city: 'X', state: 'IL', postalCode: '62701', country: 'US' },
      }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid product SKU', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createTestMap(userId);

    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        map_id: mapId,
        product_sku: 'INVALID-SKU',
        size: '18x24',
        shipping_address: { name: 'Test', line1: '123 St', city: 'X', state: 'IL', postalCode: '62701', country: 'US' },
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });

  it('returns 400 for invalid size', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createTestMap(userId);

    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        map_id: mapId,
        product_sku: 'GLOBAL-BLP',
        size: '99x99',
        shipping_address: { name: 'Test', line1: '123 St', city: 'X', state: 'IL', postalCode: '62701', country: 'US' },
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });
});

// ── Print quote tests ────────────────────────────────────────────────────────

describe('Print quote', () => {
  it('requires auth', async () => {
    const res = await request('/api/print-quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/print-quote', {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid JSON body');
  });

  it('returns 400 for missing required fields', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/print-quote', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ product_sku: 'GLOBAL-BLP' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Missing required fields');
  });

  it('returns 400 for invalid product SKU', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/print-quote', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ product_sku: 'NOPE', size: '18x24', country: 'US' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });

  it('returns 400 for invalid size', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/print-quote', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ product_sku: 'GLOBAL-BLP', size: '1x1', country: 'US' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });

  // Note: success path calls external Prodigi API, cannot test without mocking
  it('returns 502 when Prodigi API fails', async () => {
    // The test env has a fake PRODIGI_API_KEY, so the real API call will fail
    const { cookie } = await createTestSession();
    const res = await request('/api/print-quote', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ product_sku: 'GLOBAL-BLP', size: '18x24', country: 'US' }),
    });
    expect(res.status).toBe(502);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Unable to get shipping quote');
  });
});

// ── User order tests ─────────────────────────────────────────────────────────

describe('User orders', () => {
  it('requires auth for listing orders', async () => {
    const res = await request('/api/orders');
    expect(res.status).toBe(401);
  });

  it('requires auth for single order', async () => {
    const res = await request('/api/orders/some-id');
    expect(res.status).toBe(401);
  });

  it('returns empty array for user with no orders', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/orders', { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it('lists orders for authenticated user', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid' });

    const res = await request('/api/orders', { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = await res.json() as Array<{ id: string; map_name: string; status: string }>;
    expect(data.length).toBeGreaterThanOrEqual(1);
    const order = data.find((o) => o.id === orderId);
    expect(order).toBeDefined();
    expect(order!.map_name).toBe('Test Trip');
    expect(order!.status).toBe('paid');
  });

  it('returns single order by ID', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'submitted' });

    const res = await request(`/api/orders/${orderId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = await res.json() as { id: string; map_name: string; product_type: string };
    expect(data.id).toBe(orderId);
    expect(data.map_name).toBe('Test Trip');
    expect(data.product_type).toBe('poster');
  });

  it('returns 404 for non-existent order', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/orders/nonexistent', { headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('cannot see another user\'s order', async () => {
    const { userId: ownerUserId } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createTestMap(ownerUserId);
    const orderId = await insertOrder({ mapId, userId: ownerUserId });

    const res = await request(`/api/orders/${orderId}`, { headers: { cookie: otherCookie } });
    expect(res.status).toBe(404);
  });

  it('does not leak orders across users in listing', async () => {
    const { cookie: cookieA, userId: userA } = await createTestSession();
    const { cookie: cookieB, userId: userB } = await createTestSession();
    const mapA = await createTestMap(userA);
    const mapB = await createTestMap(userB);
    const orderA = await insertOrder({ mapId: mapA, userId: userA });
    const orderB = await insertOrder({ mapId: mapB, userId: userB });

    const resA = await request('/api/orders', { headers: { cookie: cookieA } });
    const dataA = await resA.json() as Array<{ id: string }>;
    expect(dataA.some((o) => o.id === orderA)).toBe(true);
    expect(dataA.some((o) => o.id === orderB)).toBe(false);

    const resB = await request('/api/orders', { headers: { cookie: cookieB } });
    const dataB = await resB.json() as Array<{ id: string }>;
    expect(dataB.some((o) => o.id === orderB)).toBe(true);
    expect(dataB.some((o) => o.id === orderA)).toBe(false);
  });
});

// ── Admin order tests ────────────────────────────────────────────────────────

describe('Admin orders', () => {
  it('rejects unauthenticated admin requests', async () => {
    const res = await request('/api/admin/orders');
    expect(res.status).toBe(401);
  });

  it('rejects wrong admin secret', async () => {
    const res = await request('/api/admin/orders', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    expect(res.status).toBe(401);
  });

  it('lists orders with correct admin secret', async () => {
    const res = await request('/api/admin/orders', {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('filters orders by status', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    await insertOrder({ mapId, userId, status: 'paid' });
    await insertOrder({ mapId, userId, status: 'shipped' });

    const resPaid = await request('/api/admin/orders?status=paid', {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(resPaid.status).toBe(200);
    const paidOrders = await resPaid.json() as Array<{ status: string }>;
    expect(paidOrders.every((o) => o.status === 'paid')).toBe(true);
  });

  it('includes user email in admin listing', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    await insertOrder({ mapId, userId });

    const res = await request('/api/admin/orders', {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    const data = await res.json() as Array<{ user_email: string }>;
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].user_email).toMatch(/@example\.com$/);
  });

  it('gets single order by ID', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId });

    const res = await request(`/api/admin/orders/${orderId}`, {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { id: string; user_email: string; map_name: string };
    expect(data.id).toBe(orderId);
    expect(data.user_email).toBeDefined();
    expect(data.map_name).toBe('Test Trip');
  });

  it('returns 404 for non-existent admin order', async () => {
    const res = await request('/api/admin/orders/nonexistent', {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(res.status).toBe(404);
  });

  it('rejects admin single order without auth', async () => {
    const res = await request('/api/admin/orders/some-id');
    expect(res.status).toBe(401);
  });
});

// ── Admin PATCH tests ────────────────────────────────────────────────────────

describe('Admin PATCH orders', () => {
  it('rejects unauthenticated PATCH', async () => {
    const res = await request('/api/admin/orders/some-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await request('/api/admin/orders/some-id', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'text/plain' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent order', async () => {
    const res = await request('/api/admin/orders/nonexistent', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ image_url: '/api/images/test.png' }),
    });
    expect(res.status).toBe(404);
  });

  it('updates image_url on order', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'pending_render' });

    const res = await request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ image_url: '/api/images/new-key.png' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { success: boolean };
    expect(data.success).toBe(true);

    // Verify DB update
    const order = await env.DB.prepare('SELECT image_url FROM orders WHERE id = ?').bind(orderId).first<{ image_url: string }>();
    expect(order?.image_url).toBe('/api/images/new-key.png');
  });

  it('rejects submit_to_prodigi for wrong status', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'pending_payment', imageUrl: '/api/images/test.png' });

    const res = await request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit_to_prodigi' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Cannot submit order in status');
  });

  it('rejects submit_to_prodigi when no image', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid', imageUrl: null });

    const res = await request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit_to_prodigi' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Order has no image URL');
  });

  it('rejects submit_to_prodigi when no shipping address', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid', imageUrl: '/api/images/test.png', shippingAddress: null });

    const res = await request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit_to_prodigi' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Order has no (or malformed) shipping address');
  });

  it('allows submit_to_prodigi for paid status', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid', imageUrl: '/api/images/test.png' });

    // This will fail because the Prodigi API key is fake, but it should get
    // past all validation and hit the external API call (500 not 400)
    const res = await request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit_to_prodigi' }),
    });
    // Prodigi call fails with fake key -> 502 (explicit error response)
    expect(res.status).toBe(502);
  });

  it('allows submit_to_prodigi for pending_render status', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'pending_render', imageUrl: '/api/images/test.png' });

    const res = await request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit_to_prodigi' }),
    });
    // Prodigi call fails with fake key -> 502 (explicit error response)
    expect(res.status).toBe(502);
  });
});

// ── Stripe webhook tests ─────────────────────────────────────────────────────

describe('Stripe webhook', () => {
  it('returns 400 without stripe-signature header', async () => {
    const res = await request('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Missing signature');
  });

  it('returns 400 for invalid signature', async () => {
    const res = await request('/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'invalid-sig',
      },
      body: JSON.stringify({ type: 'checkout.session.completed' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid signature');
  });
});

// ── Prodigi webhook tests ────────────────────────────────────────────────────

describe('Prodigi webhook', () => {
  const prodigiHeaders = {
    'content-type': 'application/json',
    'x-prodigi-webhook-secret': PRODIGI_WEBHOOK_SECRET,
  };

  it('rejects missing secret header', async () => {
    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid secret header', async () => {
    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-prodigi-webhook-secret': 'wrong-secret',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects wrong-length secret without leaking timing', async () => {
    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-prodigi-webhook-secret': 'x',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-prodigi-webhook-secret': PRODIGI_WEBHOOK_SECRET,
      },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('acknowledges event with missing order data', async () => {
    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {},
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { received: boolean };
    expect(data.received).toBe(true);
  });

  it('acknowledges event with unknown status stage', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const prodigiId = `ord_unknown_${crypto.randomUUID().slice(0, 8)}`;
    await insertOrder({ mapId, userId, status: 'submitted', prodigiOrderId: prodigiId });

    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {
          order: {
            id: prodigiId,
            status: { stage: 'SomeNewUnknownStage' },
            shipments: [],
          },
        },
      }),
    });
    expect(res.status).toBe(200);
  });

  it('processes InProgress status update', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = crypto.randomUUID();
    const prodigiId = `ord_ip_${orderId.slice(0, 8)}`;
    await insertOrder({ orderId, mapId, userId, status: 'submitted', prodigiOrderId: prodigiId });

    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {
          order: {
            id: prodigiId,
            status: { stage: 'InProgress' },
            shipments: [],
          },
        },
      }),
    });
    expect(res.status).toBe(200);

    const order = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first<{ status: string }>();
    expect(order?.status).toBe('in_production');
  });

  it('processes Shipped status and extracts tracking URL', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = crypto.randomUUID();
    const prodigiId = `ord_sh_${orderId.slice(0, 8)}`;
    await insertOrder({ orderId, mapId, userId, status: 'in_production', prodigiOrderId: prodigiId });

    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {
          order: {
            id: prodigiId,
            status: { stage: 'Shipped' },
            shipments: [{
              carrier: { name: 'USPS', service: 'Priority' },
              tracking: { url: 'https://tracking.example.com/abc', number: 'abc' },
            }],
          },
        },
      }),
    });
    expect(res.status).toBe(200);

    const order = await env.DB.prepare('SELECT status, tracking_url FROM orders WHERE id = ?').bind(orderId).first<{ status: string; tracking_url: string }>();
    expect(order?.status).toBe('shipped');
    expect(order?.tracking_url).toBe('https://tracking.example.com/abc');
  });

  it('processes Complete status', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = crypto.randomUUID();
    const prodigiId = `ord_co_${orderId.slice(0, 8)}`;
    await insertOrder({ orderId, mapId, userId, status: 'shipped', prodigiOrderId: prodigiId });

    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {
          order: {
            id: prodigiId,
            status: { stage: 'Complete' },
            shipments: [],
          },
        },
      }),
    });
    expect(res.status).toBe(200);

    const order = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first<{ status: string }>();
    expect(order?.status).toBe('completed');
  });

  it('processes Cancelled status', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = crypto.randomUUID();
    const prodigiId = `ord_ca_${orderId.slice(0, 8)}`;
    await insertOrder({ orderId, mapId, userId, status: 'submitted', prodigiOrderId: prodigiId });

    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {
          order: {
            id: prodigiId,
            status: { stage: 'Cancelled' },
            shipments: [],
          },
        },
      }),
    });
    expect(res.status).toBe(200);

    const order = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first<{ status: string }>();
    expect(order?.status).toBe('cancelled');
  });

  it('handles Shipped without tracking info gracefully', async () => {
    const { userId } = await createTestSession();
    const mapId = await createTestMap(userId);
    const orderId = crypto.randomUUID();
    const prodigiId = `ord_nt_${orderId.slice(0, 8)}`;
    await insertOrder({ orderId, mapId, userId, status: 'in_production', prodigiOrderId: prodigiId });

    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {
          order: {
            id: prodigiId,
            status: { stage: 'Shipped' },
            shipments: [],
          },
        },
      }),
    });
    expect(res.status).toBe(200);

    const order = await env.DB.prepare('SELECT status, tracking_url FROM orders WHERE id = ?').bind(orderId).first<{ status: string; tracking_url: string | null }>();
    expect(order?.status).toBe('shipped');
    expect(order?.tracking_url).toBeNull();
  });

  it('handles non-existent prodigi order gracefully', async () => {
    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: prodigiHeaders,
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed',
        data: {
          order: {
            id: 'ord_does_not_exist',
            status: { stage: 'InProgress' },
            shipments: [],
          },
        },
      }),
    });
    // Should acknowledge even if no matching order (idempotent)
    expect(res.status).toBe(200);
  });
});
