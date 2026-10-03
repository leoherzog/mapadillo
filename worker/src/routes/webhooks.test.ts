/** Stripe checkout webhook: post-payment finalization and Prodigi auto-submit. */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import app from '../index.js';
import { getStripe } from '../lib/stripe.js';
import { applyTestSchema, createTestSession } from '../test-helpers.js';
import type { Env } from '../types.js';

const testEnv = env as unknown as Env;

beforeAll(applyTestSchema);
afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_ADDRESS = JSON.stringify({
  name: 'Test User',
  line1: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'US',
});

async function insertPendingOrder(shippingAddress: string | null): Promise<string> {
  const { userId } = await createTestSession();
  const mapId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO maps (id, owner_id, name) VALUES (?, ?, ?)').bind(mapId, userId, 'Test Trip'),
    testEnv.DB.prepare(
      `INSERT INTO orders (id, map_id, user_id, product_type, product_sku, poster_size, status, image_url, shipping_address, subtotal, shipping_cost)
       VALUES (?, ?, ?, 'poster', 'GLOBAL-BLP-18X24', '18x24', 'pending_payment', ?, ?, 2999, 999)`,
    ).bind(orderId, mapId, userId, `/api/images/${mapId}/print.png`, shippingAddress),
  ]);
  return orderId;
}

/** Deliver a signed checkout.session.completed event and wait for background work. */
async function deliverCheckoutCompleted(orderId: string): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_${orderId}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: `cs_${orderId}`, object: 'checkout.session', metadata: { order_id: orderId } } },
  });
  const signature = await getStripe(testEnv.STRIPE_SECRET_KEY).webhooks.generateTestHeaderStringAsync({
    payload,
    secret: testEnv.STRIPE_WEBHOOK_SECRET,
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  }), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function getOrder(orderId: string) {
  return testEnv.DB.prepare('SELECT status, prodigi_order_id FROM orders WHERE id = ?')
    .bind(orderId).first<{ status: string; prodigi_order_id: string | null }>();
}

describe('Stripe checkout.session.completed', () => {
  it('submits to Prodigi and marks the order submitted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ order: { id: 'ord_prodigi_1' } }));
    const orderId = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverCheckoutCompleted(orderId);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as {
      items: Array<{ assets: Array<{ url: string }> }>;
    };
    expect(body.items[0].assets[0].url).toMatch(/^http:\/\/localhost\/api\/images\//);
    expect(await getOrder(orderId)).toEqual({ status: 'submitted', prodigi_order_id: 'ord_prodigi_1' });
  });

  it('falls back to pending_render when Prodigi submission fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('boom', { status: 500 }));
    const orderId = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverCheckoutCompleted(orderId);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await getOrder(orderId)).toEqual({ status: 'pending_render', prodigi_order_id: null });
  });

  it('leaves an order with an unparseable address at pending_render without calling Prodigi', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const orderId = await insertPendingOrder('not json');

    const res = await deliverCheckoutCompleted(orderId);

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getOrder(orderId)).toEqual({ status: 'pending_render', prodigi_order_id: null });
  });
});
