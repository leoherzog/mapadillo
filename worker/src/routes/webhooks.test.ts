/** Stripe and Prodigi webhooks: signature checks, post-payment finalization, Prodigi auto-submit, unpaid-order cleanup and status callbacks. */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import app from '../index.js';
import { getStripe } from '../lib/stripe.js';
import { submitOrderToProdigi } from '../lib/orders.js';
import { applyTestSchema, createTestSession, insertMapRow, insertOrder, request, TEST_ADDRESS } from '../test-helpers.js';
import type { Env } from '../types.js';

beforeAll(applyTestSchema);
afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_ADDRESS = JSON.stringify(TEST_ADDRESS);

const ORDERS_URL = 'https://api.sandbox.prodigi.com/v4.0/orders';

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

const PAID_SESSION = { payment_status: 'paid', customer_details: { email: 'buyer@example.com' } };

/** Insert an order for a fresh user and map. @returns the order id and its R2 image key */
async function insertPendingOrder(
  shippingAddress: string | null,
  opts: { status?: string; imageKey?: string } = {},
): Promise<{ orderId: string; imageKey: string }> {
  const { userId } = await createTestSession();
  const mapId = await insertMapRow(userId);
  const imageKey = opts.imageKey ?? `${mapId}/print.png`;
  const orderId = await insertOrder({
    mapId, userId, status: opts.status ?? 'pending_payment', imageUrl: `/api/images/${imageKey}`, shippingAddress,
  });
  return { orderId, imageKey };
}

/** Deliver a signed checkout.session event and wait for background work. */
async function deliverEvent(
  orderId: string,
  type = 'checkout.session.completed',
  session: Record<string, unknown> = PAID_SESSION,
  envOverrides: Partial<Env> = {},
): Promise<Response> {
  const payload = JSON.stringify({
    id: `evt_${orderId}`,
    object: 'event',
    type,
    data: { object: { id: `cs_${orderId}`, object: 'checkout.session', metadata: { order_id: orderId }, ...session } },
  });
  const signature = await getStripe(env.STRIPE_SECRET_KEY).webhooks.generateTestHeaderStringAsync({
    payload,
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    body: payload,
  }), { ...env, ...envOverrides }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function getOrder(orderId: string) {
  return env.DB.prepare('SELECT status, prodigi_order_id FROM orders WHERE id = ?')
    .bind(orderId).first<{ status: string; prodigi_order_id: string | null }>();
}

describe('Stripe checkout.session.completed', () => {
  it('submits to Prodigi and marks the order submitted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ order: { id: 'ord_prodigi_1' } }));
    const { orderId } = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverEvent(orderId);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as {
      merchantReference: string;
      callbackUrl?: string;
      recipient: { email?: string };
      items: Array<{ assets: Array<{ url: string }> }>;
    };
    expect(body.items[0].assets[0].url).toMatch(/^http:\/\/localhost\/api\/images\//);
    expect(body.merchantReference).toBe(orderId);
    expect(body.recipient.email).toBe('buyer@example.com');
    // BETTER_AUTH_URL is http in tests, and Prodigi only calls https URLs.
    expect(body.callbackUrl).toBeUndefined();
    expect(await getOrder(orderId)).toEqual({ status: 'submitted', prodigi_order_id: 'ord_prodigi_1' });
    const stored = await env.DB.prepare('SELECT customer_email FROM orders WHERE id = ?')
      .bind(orderId).first<{ customer_email: string | null }>();
    expect(stored?.customer_email).toBe('buyer@example.com');
  });

  it('falls back to pending_render when Prodigi submission fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('boom', { status: 500 }));
    const { orderId } = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverEvent(orderId);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await getOrder(orderId)).toEqual({ status: 'pending_render', prodigi_order_id: null });
  });

  it('leaves an order with an unparseable address at pending_render without calling Prodigi', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { orderId } = await insertPendingOrder('not json');

    const res = await deliverEvent(orderId);

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getOrder(orderId)).toEqual({ status: 'pending_render', prodigi_order_id: null });
  });

  it('processes a duplicate delivery once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ order: { id: 'ord_dup_1' } }));
    const { orderId } = await insertPendingOrder(VALID_ADDRESS);

    expect((await deliverEvent(orderId)).status).toBe(200);
    expect((await deliverEvent(orderId)).status).toBe(200);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await getOrder(orderId)).toEqual({ status: 'submitted', prodigi_order_id: 'ord_dup_1' });
  });

  it('acknowledges an unknown order without calling Prodigi', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await deliverEvent(crypto.randomUUID());

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves an unpaid completed session at pending_payment', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { orderId } = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverEvent(orderId, 'checkout.session.completed', { payment_status: 'unpaid' });

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await getOrder(orderId)).toEqual({ status: 'pending_payment', prodigi_order_id: null });
  });

  it('does not submit a Stripe test payment to live Prodigi', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 204 }));
    const { orderId } = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverEvent(orderId, 'checkout.session.completed', PAID_SESSION, {
      STRIPE_SECRET_KEY: 'sk_test_x',
      PRODIGI_SANDBOX: '',
      DISCORD_WEBHOOK_URL: 'https://discord.test/hook',
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://discord.test/hook');
    expect(await getOrder(orderId)).toEqual({ status: 'paid', prodigi_order_id: null });
  });
});

describe('Stripe delayed payment events', () => {
  it('submits the order on async_payment_succeeded', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ order: { id: 'ord_async_1' } }));
    const { orderId } = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverEvent(orderId, 'checkout.session.async_payment_succeeded');

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(await getOrder(orderId)).toEqual({ status: 'submitted', prodigi_order_id: 'ord_async_1' });
  });

  it('deletes the order on async_payment_failed', async () => {
    const { orderId } = await insertPendingOrder(VALID_ADDRESS);

    const res = await deliverEvent(orderId, 'checkout.session.async_payment_failed', { payment_status: 'unpaid' });

    expect(res.status).toBe(200);
    expect(await getOrder(orderId)).toBeNull();
  });
});

describe('Stripe checkout.session.expired', () => {
  it('deletes the unpaid order and its print image', async () => {
    const { orderId, imageKey } = await insertPendingOrder(VALID_ADDRESS);
    await env.ROADTRIP_PRINTS.put(imageKey, 'PNG data');

    const res = await deliverEvent(orderId, 'checkout.session.expired', { payment_status: 'unpaid' });

    expect(res.status).toBe(200);
    expect(await getOrder(orderId)).toBeNull();
    expect(await env.ROADTRIP_PRINTS.head(imageKey)).toBeNull();
  });

  it('keeps a print image another order still uses', async () => {
    const { orderId, imageKey } = await insertPendingOrder(VALID_ADDRESS);
    const { orderId: otherId } = await insertPendingOrder(VALID_ADDRESS, { imageKey });
    await env.ROADTRIP_PRINTS.put(imageKey, 'PNG data');

    await deliverEvent(orderId, 'checkout.session.expired', { payment_status: 'unpaid' });

    expect(await getOrder(orderId)).toBeNull();
    expect(await getOrder(otherId)).toEqual({ status: 'pending_payment', prodigi_order_id: null });
    expect(await env.ROADTRIP_PRINTS.head(imageKey)).not.toBeNull();
  });

  it('leaves a paid order untouched', async () => {
    const { orderId, imageKey } = await insertPendingOrder(VALID_ADDRESS, { status: 'paid' });
    await env.ROADTRIP_PRINTS.put(imageKey, 'PNG data');

    await deliverEvent(orderId, 'checkout.session.expired', { payment_status: 'unpaid' });

    expect(await getOrder(orderId)).toEqual({ status: 'paid', prodigi_order_id: null });
    expect(await env.ROADTRIP_PRINTS.head(imageKey)).not.toBeNull();
  });
});

describe('submitOrderToProdigi', () => {
  it('sends a callbackUrl on an https origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ order: { id: 'ord_cb' } }));
    const { orderId } = await insertPendingOrder(VALID_ADDRESS, { status: 'paid' });

    await submitOrderToProdigi(
      { ...env, BETTER_AUTH_URL: 'https://mapadillo.test' },
      { id: orderId, product_sku: 'GLOBAL-BLP-18X24', image_url: '/api/images/x/print.png', shippingAddress: JSON.parse(VALID_ADDRESS), email: null },
      new Date().toISOString(),
    );

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as {
      callbackUrl?: string; items: Array<{ assets: Array<{ url: string }> }>;
    };
    expect(body.callbackUrl).toBe('https://mapadillo.test/api/webhooks/prodigi');
    expect(body.items[0].assets[0].url).toBe('https://mapadillo.test/api/images/x/print.png');
    expect(await getOrder(orderId)).toEqual({ status: 'submitted', prodigi_order_id: 'ord_cb' });
  });
});

// ── Stripe webhook tests ─────────────────────────────────────────────────────

describe('Stripe webhook', () => {
  it('returns 400 without stripe-signature header', async () => {
    const res = await request('/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }, { origin: false });
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
    }, { origin: false });
    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('Invalid signature');
  });
});

// ── Prodigi webhook tests ────────────────────────────────────────────────────

describe('Prodigi webhook', () => {
  /** POST a Prodigi CloudEvents callback naming the order in data.order.id. */
  function postCallback(prodigiId?: string, envOverrides: Record<string, unknown> = {}) {
    return app.request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specversion: '1.0',
        type: 'com.prodigi.order.status.stage.changed#InProgress',
        data: prodigiId ? { order: { id: prodigiId } } : {},
      }),
    }, { ...env, ...envOverrides });
  }

  /** Stub the Prodigi GET /orders/{id} lookup. */
  function stubProdigiOrder(prodigiId: string, stage: string, shipments: unknown[] = []) {
    return stubFetch({
      [`${ORDERS_URL}/${prodigiId}`]: () =>
        Response.json({ outcome: 'Ok', order: { id: prodigiId, status: { stage }, shipments } }),
      'discord.test': () => new Response(null, { status: 204 }),
    });
  }

  /** Insert an order already submitted to Prodigi. @returns its id and Prodigi id */
  async function insertSubmitted(status = 'submitted') {
    const { userId } = await createTestSession();
    const mapId = await insertMapRow(userId);
    const orderId = crypto.randomUUID();
    const prodigiId = `ord_${orderId.slice(0, 8)}`;
    await insertOrder({ orderId, mapId, userId, status, prodigiOrderId: prodigiId });
    return { orderId, prodigiId };
  }

  async function getRow(orderId: string) {
    return env.DB.prepare('SELECT status, tracking_url FROM orders WHERE id = ?')
      .bind(orderId).first<{ status: string; tracking_url: string | null }>();
  }

  it('returns 400 for invalid JSON', async () => {
    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'not json',
    }, { origin: false });
    expect(res.status).toBe(400);
  });

  it('acknowledges event with missing order data without calling Prodigi', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await postCallback();

    expect(res.status).toBe(200);
    const data = await res.json() as { received: boolean };
    expect(data.received).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('acknowledges a non-existent prodigi order without calling Prodigi', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await postCallback('ord_does_not_exist');

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads the order id from the CloudEvents subject', async () => {
    const { orderId, prodigiId } = await insertSubmitted();
    stubProdigiOrder(prodigiId, 'InProgress');

    const res = await request('/api/webhooks/prodigi', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ specversion: '1.0', subject: prodigiId }),
    }, { origin: false });

    expect(res.status).toBe(200);
    expect((await getRow(orderId))?.status).toBe('in_production');
  });

  it('acknowledges an unknown stage and leaves the order unchanged', async () => {
    const { orderId, prodigiId } = await insertSubmitted();
    stubProdigiOrder(prodigiId, 'SomeNewUnknownStage');

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(200);
    expect((await getRow(orderId))?.status).toBe('submitted');
  });

  it('re-reads the order from Prodigi and applies InProgress', async () => {
    const { orderId, prodigiId } = await insertSubmitted();
    const fetchSpy = stubProdigiOrder(prodigiId, 'InProgress');

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0][0])).toBe(`${ORDERS_URL}/${prodigiId}`);
    expect((await getRow(orderId))?.status).toBe('in_production');
  });

  it('marks the order shipped and stores tracking once a shipment has shipped', async () => {
    const { orderId, prodigiId } = await insertSubmitted('in_production');
    stubProdigiOrder(prodigiId, 'InProgress', [{
      status: 'Shipped',
      carrier: { name: 'USPS', service: 'Priority' },
      tracking: { url: 'https://tracking.example.com/abc', number: 'abc' },
    }]);

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(200);
    expect(await getRow(orderId)).toEqual({ status: 'shipped', tracking_url: 'https://tracking.example.com/abc' });
  });

  it('handles a shipment without tracking info gracefully', async () => {
    const { orderId, prodigiId } = await insertSubmitted('in_production');
    stubProdigiOrder(prodigiId, 'InProgress', [{ status: 'Shipped' }]);

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(200);
    expect(await getRow(orderId)).toEqual({ status: 'shipped', tracking_url: null });
  });

  it('does not store a non-http tracking URL', async () => {
    const { orderId, prodigiId } = await insertSubmitted('in_production');
    stubProdigiOrder(prodigiId, 'InProgress', [{ status: 'Shipped', tracking: { url: 'javascript:alert(1)' } }]);

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(200);
    expect(await getRow(orderId)).toEqual({ status: 'shipped', tracking_url: null });
  });

  it('processes Complete status', async () => {
    const { orderId, prodigiId } = await insertSubmitted('shipped');
    stubProdigiOrder(prodigiId, 'Complete');

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(200);
    expect((await getRow(orderId))?.status).toBe('completed');
  });

  it('never moves a completed order back to production', async () => {
    const { orderId, prodigiId } = await insertSubmitted('completed');
    stubProdigiOrder(prodigiId, 'InProgress');

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(200);
    expect((await getRow(orderId))?.status).toBe('completed');
  });

  it('processes Cancelled status and alerts Discord', async () => {
    const { orderId, prodigiId } = await insertSubmitted();
    const fetchSpy = stubProdigiOrder(prodigiId, 'Cancelled');

    const res = await postCallback(prodigiId, { DISCORD_WEBHOOK_URL: 'https://discord.test/hook' });

    expect(res.status).toBe(200);
    expect((await getRow(orderId))?.status).toBe('cancelled');
    const discordCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('discord.test'));
    expect(String(discordCall?.[1]?.body)).toContain('refund needed; reprint via the Prodigi dashboard');
  });

  it('returns 502 and leaves the order unchanged when the Prodigi lookup fails', async () => {
    const { orderId, prodigiId } = await insertSubmitted();
    stubFetch({ [ORDERS_URL]: () => new Response('boom', { status: 500 }) });

    const res = await postCallback(prodigiId);

    expect(res.status).toBe(502);
    expect(await getRow(orderId)).toEqual({ status: 'submitted', tracking_url: null });
  });
});
