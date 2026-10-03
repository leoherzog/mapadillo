import { describe, it, expect, afterEach, vi } from 'vitest';
import { createOrder, getOrder, getShippingQuote, isSandbox, ProdigiNotAvailableError } from './prodigi.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isSandbox', () => {
  it('returns false for undefined / empty string', () => {
    expect(isSandbox(undefined)).toBe(false);
    expect(isSandbox('')).toBe(false);
  });

  it('returns true for common truthy spellings', () => {
    for (const v of ['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on']) {
      expect(isSandbox(v)).toBe(true);
    }
  });

  it('trims whitespace before matching', () => {
    expect(isSandbox('  true  ')).toBe(true);
    expect(isSandbox('\ttrue\n')).toBe(true);
  });

  it('returns false for anything else', () => {
    for (const v of ['false', 'no', '0', 'off', 'sandbox', 'live']) {
      expect(isSandbox(v)).toBe(false);
    }
  });
});

function quoteResponse(amount: string, currency = 'USD') {
  return Response.json({
    outcome: 'Created',
    quotes: [{ costSummary: { shipping: { amount, currency } }, shipments: [] }],
  });
}

const QUOTE_REQUEST = { sku: 'GLOBAL-BLP-40X60', destinationCountry: 'AU' };

describe('getShippingQuote', () => {
  it('requests a USD quote and returns the shipping cost in cents', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => quoteResponse('7.10'));

    const quote = await getShippingQuote('k', QUOTE_REQUEST, true);

    expect(quote).toEqual({ shippingCostCents: 710 });
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.sandbox.prodigi.com/v4.0/quotes');
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as { currencyCode: string; destinationCountryCode: string };
    expect(body.currencyCode).toBe('USD');
    expect(body.destinationCountryCode).toBe('AU');
  });

  it('rejects a quote in another currency', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => quoteResponse('7.10', 'GBP'));

    const err = await getShippingQuote('k', QUOTE_REQUEST, true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProdigiNotAvailableError);
  });

  it.each(['free', '', '  ', '-1.00'])('rejects the shipping amount %j', async (amount) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => quoteResponse(amount));

    await expect(getShippingQuote('k', QUOTE_REQUEST, true)).rejects.toThrow('Invalid Prodigi shipping amount');
  });

  it('throws ProdigiNotAvailableError for a NotAvailable outcome', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ outcome: 'NotAvailable', issues: null, quotes: [] }));

    await expect(getShippingQuote('k', QUOTE_REQUEST, true)).rejects.toBeInstanceOf(ProdigiNotAvailableError);
  });

  it('throws ProdigiNotAvailableError when no quote is returned', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ outcome: 'Created', quotes: [] }));

    await expect(getShippingQuote('k', QUOTE_REQUEST, true)).rejects.toBeInstanceOf(ProdigiNotAvailableError);
  });

  it('throws a generic error for a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('Unauthorized', { status: 401 }));

    const err = await getShippingQuote('k', QUOTE_REQUEST, false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProdigiNotAvailableError);
  });
});

describe('createOrder', () => {
  const address = { name: 'Test User', line1: '1 Main St', city: 'Springfield', state: 'IL', postalCode: '62701', country: 'US' };

  it('sends the merchant reference, recipient email and callback URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ order: { id: 'ord_1' } }));

    const result = await createOrder('k', {
      orderId: 'order-1',
      sku: 'GLOBAL-BLP-18X24',
      imageUrl: 'https://example.com/print.png',
      shippingAddress: address,
      email: 'buyer@example.com',
      callbackUrl: 'https://example.com/api/webhooks/prodigi',
    }, true);

    expect(result).toEqual({ prodigiOrderId: 'ord_1' });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as {
      idempotencyKey: string; merchantReference: string; callbackUrl: string; recipient: { email: string };
    };
    expect(body.idempotencyKey).toBe('order-1');
    expect(body.merchantReference).toBe('order-1');
    expect(body.callbackUrl).toBe('https://example.com/api/webhooks/prodigi');
    expect(body.recipient.email).toBe('buyer@example.com');
  });

  it('omits the email and callback URL when not given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ order: { id: 'ord_2' } }));

    await createOrder('k', { orderId: 'order-2', sku: 'GLOBAL-BLP-18X24', imageUrl: 'https://example.com/p.png', shippingAddress: address }, true);

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string) as Record<string, unknown> & { recipient: Record<string, unknown> };
    expect(body).not.toHaveProperty('callbackUrl');
    expect(body.recipient).not.toHaveProperty('email');
  });
});

describe('getOrder', () => {
  it('fetches the order by id with the API key', async () => {
    const order = { id: 'ord_9', status: { stage: 'InProgress' }, shipments: [] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ outcome: 'Ok', order }));

    await expect(getOrder('k', 'ord_9', true)).resolves.toEqual(order);
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.sandbox.prodigi.com/v4.0/orders/ord_9');
    expect(new Headers(fetchSpy.mock.calls[0][1]!.headers).get('x-api-key')).toBe('k');
  });

  it('throws for a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('missing', { status: 404 }));

    await expect(getOrder('k', 'ord_9', false)).rejects.toThrow('Prodigi get order failed (404)');
  });
});
