import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import app from '../index.js';
import { applyTestSchema, request, createTestSession, grantShare, insertMapRow, insertOrder, TEST_ADDRESS } from '../test-helpers.js';

beforeAll(applyTestSchema);
afterEach(() => {
  vi.restoreAllMocks();
});

const ADMIN_SECRET = env.ADMIN_SECRET;

const QUOTES_URL = 'https://api.sandbox.prodigi.com/v4.0/quotes';
const ORDERS_URL = 'https://api.sandbox.prodigi.com/v4.0/orders';
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_1';

type FetchHandler = (init?: RequestInit) => Response | Promise<Response>;

/** Stub global fetch, answering each call from the first route whose key the URL contains. */
function stubFetch(routes: Record<string, FetchHandler>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) throw new Error(`Unexpected fetch: ${url}`);
    return match[1](init);
  });
}

/** A Prodigi quote response with the given USD shipping amount. */
function quoteResponse(amount: string): Response {
  return Response.json({
    outcome: 'Created',
    quotes: [{ costSummary: { shipping: { amount, currency: 'USD' } }, shipments: [] }],
  });
}

/** POST init for the image upload route with a raw body and explicit Content-Length. */
function pngUpload(cookie: string | undefined, data = 'PNG data', type = 'image/png'): RequestInit {
  const headers: Record<string, string> = {
    'content-type': type,
    'content-length': String(new TextEncoder().encode(data).byteLength),
  };
  if (cookie) headers.cookie = cookie;
  return { method: 'POST', headers, body: data };
}

// ── Image upload tests ────────────────────────────────────────────────────────

describe('Image upload & serving', () => {
  it('requires auth for upload', async () => {
    const res = await request('/api/images/some-map-id', pngUpload(undefined));
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent map', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/images/nonexistent', pngUpload(cookie));
    expect(res.status).toBe(404);
  });

  it('returns 403 for viewer uploading image', async () => {
    const { userId: ownerId } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await insertMapRow(ownerId);
    await grantShare(mapId, viewerId, 'viewer');

    const res = await request(`/api/images/${mapId}`, pngUpload(viewerCookie));
    expect(res.status).toBe(403);
  });

  it('returns 400 when the body is missing', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);

    const res = await request(`/api/images/${mapId}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png' },
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('image body is required');
  });

  it('returns 415 for a non-PNG body', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);

    const res = await request(`/api/images/${mapId}`, pngUpload(cookie, 'hello', 'text/plain'));
    expect(res.status).toBe(415);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Body must be a PNG image');
  });

  it('returns 413 when Content-Length exceeds 100MB', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);

    const res = await request(`/api/images/${mapId}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'image/png', 'content-length': String(100 * 1024 * 1024 + 1) },
      body: new ReadableStream({ start(controller) { controller.close(); } }),
      duplex: 'half',
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  it('uploads image successfully and returns key', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);

    const res = await request(`/api/images/${mapId}`, pngUpload(cookie));
    expect(res.status).toBe(201);
    const data = await res.json() as { key: string; url: string };
    expect(data.key).toContain(`${mapId}/`);
    expect(data.key).toMatch(/\.png$/);
    expect(data.url).toBe(`/api/images/${data.key}`);
  });

  it('serves an uploaded image publicly', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const upload = await request(`/api/images/${mapId}`, pngUpload(cookie));
    const { url } = await upload.json() as { url: string };

    const res = await request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('PNG data');
  });

  it('editor can upload image', async () => {
    const { userId: ownerId } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await insertMapRow(ownerId);

    await grantShare(mapId, editorId, 'editor');

    const res = await request(`/api/images/${mapId}`, pngUpload(editorCookie));
    expect(res.status).toBe(201);
  });

  it('returns 404 for non-existent image key', async () => {
    const res = await request('/api/images/some-map/some-uuid.png');
    expect(res.status).toBe(404);
  });
});

// ── Checkout tests ───────────────────────────────────────────────────────────

describe('Checkout', () => {
  /** An owned map with an uploaded print image and a valid checkout body for it. */
  async function checkoutFixture() {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const imageKey = `${mapId}/${crypto.randomUUID()}.png`;
    await env.ROADTRIP_PRINTS.put(imageKey, 'PNG data');
    const body = {
      map_id: mapId,
      product_sku: 'GLOBAL-BLP',
      size: '18x24',
      shipping_address: TEST_ADDRESS,
      image_key: imageKey,
    };
    return { cookie, mapId, imageKey, body };
  }

  function postCheckout(cookie: string, body: unknown) {
    return request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function countOrders(mapId: string): Promise<number> {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE map_id = ?').bind(mapId).first<{ n: number }>();
    return row?.n ?? 0;
  }

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

  it('returns 400 for a shipping address without line1', async () => {
    const { cookie, body } = await checkoutFixture();
    const { line1: _line1, ...address } = body.shipping_address;

    const res = await postCheckout(cookie, { ...body, shipping_address: address });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Invalid shipping_address');
  });

  it('returns 400 for a shipping address with a blank postalCode', async () => {
    const { cookie, body } = await checkoutFixture();

    const res = await postCheckout(cookie, { ...body, shipping_address: { ...body.shipping_address, postalCode: '   ' } });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Invalid shipping_address');
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
        shipping_address: TEST_ADDRESS,
      }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 for viewer trying to checkout', async () => {
    const { userId: ownerId } = await createTestSession();
    const { cookie: viewerCookie, userId: viewerId } = await createTestSession();
    const mapId = await insertMapRow(ownerId);
    await grantShare(mapId, viewerId, 'viewer');

    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie: viewerCookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        map_id: mapId,
        product_sku: 'GLOBAL-BLP',
        size: '18x24',
        shipping_address: TEST_ADDRESS,
      }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid product SKU', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);

    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        map_id: mapId,
        product_sku: 'INVALID-SKU',
        size: '18x24',
        shipping_address: TEST_ADDRESS,
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });

  it('returns 400 for invalid size', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);

    const res = await request('/api/checkout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        map_id: mapId,
        product_sku: 'GLOBAL-BLP',
        size: '99x99',
        shipping_address: TEST_ADDRESS,
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });

  it('returns 400 for a missing, foreign or unknown image_key', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { cookie, mapId, body } = await checkoutFixture();
    const other = await checkoutFixture();
    const { image_key: _imageKey, ...withoutKey } = body;

    for (const payload of [
      withoutKey,
      { ...body, image_key: other.imageKey },
      { ...body, image_key: `${mapId}/${crypto.randomUUID()}.png` },
    ]) {
      const res = await postCheckout(cookie, payload);
      expect(res.status).toBe(400);
      const data = await res.json() as { error: string };
      expect(data.error).toBe('Invalid image_key');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creates a pending order priced with the server-side shipping quote', async () => {
    let quoteBody: { currencyCode?: string; destinationCountryCode?: string } = {};
    let stripeBody = '';
    const fetchSpy = stubFetch({
      [QUOTES_URL]: (init) => { quoteBody = JSON.parse(String(init!.body)); return quoteResponse('43.15'); },
      '/v1/checkout/sessions': (init) => {
        stripeBody = String(init!.body);
        return Response.json({ id: 'cs_test_1', object: 'checkout.session', url: CHECKOUT_URL });
      },
    });
    const { cookie, mapId, imageKey, body } = await checkoutFixture();

    // A client-sent shipping cost is ignored.
    const res = await postCheckout(cookie, { ...body, shipping_cost_cents: 0 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkout_url: CHECKOUT_URL });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(quoteBody).toMatchObject({ currencyCode: 'USD', destinationCountryCode: 'US' });

    const rows = await env.DB.prepare('SELECT * FROM orders WHERE map_id = ?').bind(mapId).all<{
      id: string; status: string; stripe_session_id: string; subtotal: number;
      shipping_cost: number; image_url: string; product_type: string;
    }>();
    expect(rows.results).toHaveLength(1);
    const row = rows.results[0];
    expect(row).toMatchObject({
      status: 'pending_payment',
      stripe_session_id: 'cs_test_1',
      subtotal: 2999,
      shipping_cost: 4315,
      image_url: `/api/images/${imageKey}`,
      product_type: 'poster',
    });

    const params = new URLSearchParams(stripeBody);
    expect(params.get('line_items[0][price_data][product_data][name]')).toBe('Budget Poster — 18" × 24"');
    expect(params.get('line_items[1][price_data][unit_amount]')).toBe('4315');
    expect(params.get('metadata[order_id]')).toBe(row.id);
    expect(params.get('success_url')).toBe(`http://localhost/order-confirmation/${row.id}`);
    expect(params.get('cancel_url')).toBe(`http://localhost/order/${mapId}`);
    expect(Number(params.get('expires_at'))).toBeGreaterThan(Date.now() / 1000 + 30 * 60);
  });

  it('returns 502 and creates no session when the shipping quote fails', async () => {
    const fetchSpy = stubFetch({ [QUOTES_URL]: () => new Response('Unauthorized', { status: 401 }) });
    const { cookie, mapId, body } = await checkoutFixture();

    const res = await postCheckout(cookie, body);

    expect(res.status).toBe(502);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Unable to get shipping quote');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await countOrders(mapId)).toBe(0);
  });

  it('returns 422 when the print cannot ship to the address', async () => {
    stubFetch({ [QUOTES_URL]: () => Response.json({ outcome: 'NotAvailable', issues: null, quotes: [] }) });
    const { cookie, mapId, body } = await checkoutFixture();

    const res = await postCheckout(cookie, body);

    expect(res.status).toBe(422);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('This print cannot ship to that country');
    expect(await countOrders(mapId)).toBe(0);
  });

  it('leaves no order row when Stripe rejects the session', async () => {
    stubFetch({
      [QUOTES_URL]: () => quoteResponse('9.95'),
      '/v1/checkout/sessions': () =>
        Response.json({ error: { message: 'x', type: 'invalid_request_error' } }, { status: 400 }),
    });
    const { cookie, mapId, body } = await checkoutFixture();

    const res = await postCheckout(cookie, body);

    expect(res.status).toBe(500);
    expect(await countOrders(mapId)).toBe(0);
  });

  it('expires the session and adds no order when the map is deleted during checkout', async () => {
    const { cookie, mapId, body } = await checkoutFixture();
    const fetchSpy = stubFetch({
      [QUOTES_URL]: () => quoteResponse('9.95'),
      '/v1/checkout/sessions/cs_test_1/expire': () =>
        Response.json({ id: 'cs_test_1', object: 'checkout.session', status: 'expired' }),
      '/v1/checkout/sessions': async () => {
        await env.DB.prepare('DELETE FROM maps WHERE id = ?').bind(mapId).run();
        return Response.json({ id: 'cs_test_1', object: 'checkout.session', url: CHECKOUT_URL });
      },
    });

    const res = await postCheckout(cookie, body);

    expect(res.status).toBe(404);
    expect(await countOrders(mapId)).toBe(0);
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/v1/checkout/sessions/cs_test_1/expire'))).toBe(true);
  });
});

// ── Print quote tests ────────────────────────────────────────────────────────

describe('Print quote', () => {
  function postQuote(cookie: string, body: unknown) {
    return request('/api/print-quote', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

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
    const res = await postQuote(cookie, { product_sku: 'GLOBAL-BLP' });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Missing required fields');
  });

  it('returns 400 for invalid product SKU', async () => {
    const { cookie } = await createTestSession();
    const res = await postQuote(cookie, { product_sku: 'NOPE', size: '18x24', country: 'US' });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });

  it('returns 400 for invalid size', async () => {
    const { cookie } = await createTestSession();
    const res = await postQuote(cookie, { product_sku: 'GLOBAL-BLP', size: '1x1', country: 'US' });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid product or size');
  });

  it('returns the Prodigi shipping quote', async () => {
    stubFetch({ [QUOTES_URL]: () => quoteResponse('9.95') });
    const { cookie } = await createTestSession();

    const res = await postQuote(cookie, { product_sku: 'GLOBAL-BLP', size: '18x24', country: 'US' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shipping_cost_cents: 995 });
  });

  it('returns 502 when Prodigi API fails', async () => {
    const fetchSpy = stubFetch({ [QUOTES_URL]: () => new Response('Unauthorized', { status: 401 }) });
    const { cookie } = await createTestSession();

    const res = await postQuote(cookie, { product_sku: 'GLOBAL-BLP', size: '18x24', country: 'US' });

    expect(res.status).toBe(502);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Unable to get shipping quote');
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('returns 422 when the print cannot ship to that country', async () => {
    stubFetch({ [QUOTES_URL]: () => Response.json({ outcome: 'NotAvailable', issues: null, quotes: [] }) });
    const { cookie } = await createTestSession();

    const res = await postQuote(cookie, { product_sku: 'GLOBAL-BLP', size: '18x24', country: 'AU' });

    expect(res.status).toBe(422);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('This print cannot ship to that country');
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
    const mapId = await insertMapRow(userId);
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
    const mapId = await insertMapRow(userId);
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
    const mapId = await insertMapRow(ownerUserId);
    const orderId = await insertOrder({ mapId, userId: ownerUserId });

    const res = await request(`/api/orders/${orderId}`, { headers: { cookie: otherCookie } });
    expect(res.status).toBe(404);
  });

  it('does not leak orders across users in listing', async () => {
    const { cookie: cookieA, userId: userA } = await createTestSession();
    const { cookie: cookieB, userId: userB } = await createTestSession();
    const mapA = await insertMapRow(userA);
    const mapB = await insertMapRow(userB);
    const orderA = await insertOrder({ mapId: mapA, userId: userA, status: 'paid' });
    const orderB = await insertOrder({ mapId: mapB, userId: userB, status: 'paid' });

    const resA = await request('/api/orders', { headers: { cookie: cookieA } });
    const dataA = await resA.json() as Array<{ id: string }>;
    expect(dataA.some((o) => o.id === orderA)).toBe(true);
    expect(dataA.some((o) => o.id === orderB)).toBe(false);

    const resB = await request('/api/orders', { headers: { cookie: cookieB } });
    const dataB = await resB.json() as Array<{ id: string }>;
    expect(dataB.some((o) => o.id === orderB)).toBe(true);
    expect(dataB.some((o) => o.id === orderA)).toBe(false);
  });

  it('omits orders still awaiting payment from the listing', async () => {
    const { cookie, userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    await insertOrder({ mapId, userId, status: 'pending_payment' });
    const paidId = await insertOrder({ mapId, userId, status: 'paid' });

    const res = await request('/api/orders', { headers: { cookie } });
    expect(res.status).toBe(200);
    const data = await res.json() as Array<{ id: string }>;
    expect(data.map((o) => o.id)).toEqual([paidId]);
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

  it('rejects every request when ADMIN_SECRET is unset', async () => {
    const res = await app.request(
      '/api/admin/orders',
      { headers: { authorization: 'Bearer undefined' } },
      { ...env, ADMIN_SECRET: undefined },
    );
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
    const mapId = await insertMapRow(userId);
    const paidId = await insertOrder({ mapId, userId, status: 'paid' });
    const shippedId = await insertOrder({ mapId, userId, status: 'shipped' });

    const resPaid = await request('/api/admin/orders?status=paid', {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    expect(resPaid.status).toBe(200);
    const paidOrders = await resPaid.json() as Array<{ id: string; status: string }>;
    expect(paidOrders.every((o) => o.status === 'paid')).toBe(true);
    expect(paidOrders.map((o) => o.id)).toContain(paidId);
    expect(paidOrders.map((o) => o.id)).not.toContain(shippedId);
  });

  it('includes user email in admin listing', async () => {
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const orderId = await insertOrder({ mapId, userId });

    const res = await request('/api/admin/orders', {
      headers: { authorization: `Bearer ${ADMIN_SECRET}` },
    });
    const data = await res.json() as Array<{ id: string; user_email: string }>;
    expect(data.find((o) => o.id === orderId)?.user_email).toBe(`test-${userId.slice(0, 8)}@example.com`);
  });

  it('gets single order by ID', async () => {
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
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
  function submitToProdigi(orderId: string) {
    return request(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'submit_to_prodigi' }),
    });
  }

  async function getStatus(orderId: string) {
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first<{ status: string }>();
    return row?.status;
  }

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
    const mapId = await insertMapRow(userId);
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
    const mapId = await insertMapRow(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'pending_payment', imageUrl: '/api/images/test.png' });

    const res = await submitToProdigi(orderId);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('Cannot submit order in status');
  });

  it('rejects submit_to_prodigi when no image', async () => {
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid', imageUrl: null });

    const res = await submitToProdigi(orderId);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Order has no image URL');
  });

  it('rejects submit_to_prodigi when no shipping address', async () => {
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid', imageUrl: '/api/images/test.png', shippingAddress: null });

    const res = await submitToProdigi(orderId);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Order has no (or malformed) shipping address');
  });

  it('returns 502 and keeps a paid order when Prodigi rejects it', async () => {
    const fetchSpy = stubFetch({ [ORDERS_URL]: () => new Response('Unauthorized', { status: 401 }) });
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid', imageUrl: '/api/images/test.png' });

    const res = await submitToProdigi(orderId);

    expect(res.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toBe(ORDERS_URL);
    expect(await getStatus(orderId)).toBe('paid');
  });

  it('returns 502 and keeps a pending_render order when Prodigi rejects it', async () => {
    const fetchSpy = stubFetch({ [ORDERS_URL]: () => new Response('Unauthorized', { status: 401 }) });
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'pending_render', imageUrl: '/api/images/test.png' });

    const res = await submitToProdigi(orderId);

    expect(res.status).toBe(502);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await getStatus(orderId)).toBe('pending_render');
  });

  it('submits to Prodigi with the buyer email and marks the order submitted', async () => {
    let prodigiBody: { recipient?: { email?: string } } = {};
    const fetchSpy = stubFetch({
      [ORDERS_URL]: (init) => {
        prodigiBody = JSON.parse(String(init!.body));
        return Response.json({ outcome: 'Created', order: { id: 'ord_admin_1' } });
      },
    });
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const orderId = await insertOrder({ mapId, userId, status: 'paid', imageUrl: '/api/images/test.png' });
    await env.DB.prepare('UPDATE orders SET customer_email = ? WHERE id = ?').bind('buyer@example.com', orderId).run();

    const res = await submitToProdigi(orderId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, prodigi_order_id: 'ord_admin_1' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(prodigiBody.recipient?.email).toBe('buyer@example.com');
    expect(await getStatus(orderId)).toBe('submitted');
  });
});
