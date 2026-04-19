import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockApiGet, mockApiPost, mockApiPostForm } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
  mockApiPostForm: vi.fn(),
}));

vi.mock('./api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api-client.js')>();
  return {
    ...actual,
    apiGet: mockApiGet,
    apiPost: mockApiPost,
    apiPostForm: mockApiPostForm,
  };
});

import {
  uploadPrintImage,
  createCheckout,
  getOrder,
  listOrders,
  getPrintQuote,
} from './orders.js';
import { ApiError } from './api-client.js';
import type { ShippingAddress } from '../../shared/types.js';

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPost.mockReset();
  mockApiPostForm.mockReset();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const sampleAddress: ShippingAddress = {
  name: 'Jane Doe',
  line1: '123 Main St',
  city: 'Portland',
  state: 'OR',
  postalCode: '97201',
  country: 'US',
};

function sampleOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ord_1',
    map_id: 'm1',
    user_id: 'u1',
    product_type: 'poster',
    product_sku: 'POSTER_18X24',
    poster_size: '18x24',
    status: 'paid',
    stripe_session_id: 'cs_123',
    prodigi_order_id: null,
    image_url: 'https://example.com/img.png',
    shipping_address: null,
    subtotal: 2999,
    shipping_cost: 500,
    currency: 'usd',
    tracking_url: null,
    discord_notified: 0,
    created_at: '2026-04-19T00:00:00Z',
    updated_at: '2026-04-19T00:00:00Z',
    ...overrides,
  };
}

// ── uploadPrintImage ─────────────────────────────────────────────────────────

describe('uploadPrintImage', () => {
  it('POSTs multipart form to /api/images/:mapId with blob', async () => {
    mockApiPostForm.mockResolvedValue({ key: 'maps/m1/abc.png', url: 'https://r2/abc.png' });
    const blob = new Blob(['fake-png-bytes'], { type: 'image/png' });

    const result = await uploadPrintImage('m1', blob);

    expect(mockApiPostForm).toHaveBeenCalledTimes(1);
    const [path, form] = mockApiPostForm.mock.calls[0];
    expect(path).toBe('/api/images/m1');
    expect(form).toBeInstanceOf(FormData);
    const file = (form as FormData).get('image');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name ?? 'map.png').toBe('map.png');
    expect(result).toEqual({ key: 'maps/m1/abc.png', url: 'https://r2/abc.png' });
  });

  it('propagates 401 ApiError (unauthorized)', async () => {
    mockApiPostForm.mockRejectedValue(new ApiError(401, 'Unauthorized'));
    const blob = new Blob(['x'], { type: 'image/png' });

    const err = await uploadPrintImage('m1', blob).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('propagates 403 ApiError (forbidden)', async () => {
    mockApiPostForm.mockRejectedValue(new ApiError(403, 'Forbidden'));
    const blob = new Blob(['x'], { type: 'image/png' });

    const err = await uploadPrintImage('m1', blob).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
  });

  it('propagates 404 ApiError (map not found)', async () => {
    mockApiPostForm.mockRejectedValue(new ApiError(404, 'Not found'));
    const blob = new Blob(['x'], { type: 'image/png' });

    await expect(uploadPrintImage('missing', blob)).rejects.toBeInstanceOf(ApiError);
  });

  it('propagates 429 ApiError when rate limiting exhausts retry', async () => {
    mockApiPostForm.mockRejectedValue(new ApiError(429, 'Too many requests'));
    const blob = new Blob(['x'], { type: 'image/png' });

    const err = await uploadPrintImage('m1', blob).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
  });

  it('propagates network TypeError when fetch fails', async () => {
    mockApiPostForm.mockRejectedValue(new TypeError('Failed to fetch'));
    const blob = new Blob(['x'], { type: 'image/png' });

    await expect(uploadPrintImage('m1', blob)).rejects.toBeInstanceOf(TypeError);
  });
});

// ── createCheckout ───────────────────────────────────────────────────────────

describe('createCheckout', () => {
  it('POSTs to /api/checkout with the provided payload', async () => {
    mockApiPost.mockResolvedValue({ checkout_url: 'https://checkout.stripe.com/c/abc' });

    const result = await createCheckout({
      map_id: 'm1',
      product_sku: 'POSTER_18X24',
      size: '18x24',
      shipping_address: sampleAddress,
      image_key: 'maps/m1/abc.png',
      shipping_cost_cents: 500,
    });

    expect(mockApiPost).toHaveBeenCalledWith('/api/checkout', {
      map_id: 'm1',
      product_sku: 'POSTER_18X24',
      size: '18x24',
      shipping_address: sampleAddress,
      image_key: 'maps/m1/abc.png',
      shipping_cost_cents: 500,
    });
    expect(result.checkout_url).toBe('https://checkout.stripe.com/c/abc');
  });

  it('omits optional shipping_cost_cents when not provided', async () => {
    mockApiPost.mockResolvedValue({ checkout_url: 'https://checkout.stripe.com/c/xyz' });

    await createCheckout({
      map_id: 'm1',
      product_sku: 'POSTER_18X24',
      size: '18x24',
      shipping_address: sampleAddress,
      image_key: 'maps/m1/abc.png',
    });

    const [, body] = mockApiPost.mock.calls[0];
    expect((body as Record<string, unknown>).shipping_cost_cents).toBeUndefined();
  });

  it('propagates 401 ApiError (unauthorized)', async () => {
    mockApiPost.mockRejectedValue(new ApiError(401, 'Unauthorized'));

    const err = await createCheckout({
      map_id: 'm1', product_sku: 'sku', size: '18x24',
      shipping_address: sampleAddress, image_key: 'k',
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('propagates 403 ApiError (forbidden)', async () => {
    mockApiPost.mockRejectedValue(new ApiError(403, 'Forbidden'));

    await expect(createCheckout({
      map_id: 'm1', product_sku: 'sku', size: '18x24',
      shipping_address: sampleAddress, image_key: 'k',
    })).rejects.toBeInstanceOf(ApiError);
  });

  it('propagates 404 ApiError (map not found)', async () => {
    mockApiPost.mockRejectedValue(new ApiError(404, 'Not found'));

    const err = await createCheckout({
      map_id: 'missing', product_sku: 'sku', size: '18x24',
      shipping_address: sampleAddress, image_key: 'k',
    }).catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(404);
  });

  it('propagates 429 ApiError when rate-limited', async () => {
    mockApiPost.mockRejectedValue(new ApiError(429, 'Too many requests'));

    const err = await createCheckout({
      map_id: 'm1', product_sku: 'sku', size: '18x24',
      shipping_address: sampleAddress, image_key: 'k',
    }).catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(429);
  });

  it('propagates network TypeError', async () => {
    mockApiPost.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(createCheckout({
      map_id: 'm1', product_sku: 'sku', size: '18x24',
      shipping_address: sampleAddress, image_key: 'k',
    })).rejects.toBeInstanceOf(TypeError);
  });

  it('propagates SyntaxError on malformed JSON body', async () => {
    mockApiPost.mockRejectedValue(new SyntaxError('Unexpected token < in JSON'));

    await expect(createCheckout({
      map_id: 'm1', product_sku: 'sku', size: '18x24',
      shipping_address: sampleAddress, image_key: 'k',
    })).rejects.toBeInstanceOf(SyntaxError);
  });
});

// ── getOrder ─────────────────────────────────────────────────────────────────

describe('getOrder', () => {
  it('GETs /api/orders/:id and returns the order', async () => {
    const order = sampleOrder({ id: 'ord_42' });
    mockApiGet.mockResolvedValue(order);

    const result = await getOrder('ord_42');

    expect(mockApiGet).toHaveBeenCalledWith('/api/orders/ord_42');
    expect(result.id).toBe('ord_42');
    expect(result.status).toBe('paid');
  });

  it('propagates 401 ApiError', async () => {
    mockApiGet.mockRejectedValue(new ApiError(401, 'Unauthorized'));

    const err = await getOrder('x').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('propagates 403 ApiError', async () => {
    mockApiGet.mockRejectedValue(new ApiError(403, 'Forbidden'));

    await expect(getOrder('x')).rejects.toBeInstanceOf(ApiError);
  });

  it('propagates 404 ApiError for missing order', async () => {
    mockApiGet.mockRejectedValue(new ApiError(404, 'Order not found'));

    const err = await getOrder('missing').catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(404);
  });

  it('propagates 429 ApiError after retry exhaustion', async () => {
    mockApiGet.mockRejectedValue(new ApiError(429, 'Too many requests'));

    const err = await getOrder('x').catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(429);
  });

  it('propagates network TypeError', async () => {
    mockApiGet.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getOrder('x')).rejects.toBeInstanceOf(TypeError);
  });

  it('propagates SyntaxError on malformed JSON body', async () => {
    mockApiGet.mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));

    await expect(getOrder('x')).rejects.toBeInstanceOf(SyntaxError);
  });
});

// ── listOrders ───────────────────────────────────────────────────────────────

describe('listOrders', () => {
  it('GETs /api/orders and returns the array', async () => {
    mockApiGet.mockResolvedValue([sampleOrder({ id: 'o1' }), sampleOrder({ id: 'o2' })]);

    const result = await listOrders();

    expect(mockApiGet).toHaveBeenCalledWith('/api/orders');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('o1');
    expect(result[1].id).toBe('o2');
  });

  it('returns empty array when user has no orders', async () => {
    mockApiGet.mockResolvedValue([]);

    const result = await listOrders();

    expect(result).toEqual([]);
  });

  it('propagates 401 ApiError', async () => {
    mockApiGet.mockRejectedValue(new ApiError(401, 'Unauthorized'));

    const err = await listOrders().catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(401);
  });

  it('propagates 403 ApiError', async () => {
    mockApiGet.mockRejectedValue(new ApiError(403, 'Forbidden'));

    await expect(listOrders()).rejects.toBeInstanceOf(ApiError);
  });

  it('propagates 429 ApiError after retry exhaustion', async () => {
    mockApiGet.mockRejectedValue(new ApiError(429, 'Too many requests'));

    const err = await listOrders().catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(429);
  });

  it('propagates network TypeError', async () => {
    mockApiGet.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(listOrders()).rejects.toBeInstanceOf(TypeError);
  });

  it('propagates SyntaxError on malformed JSON body', async () => {
    mockApiGet.mockRejectedValue(new SyntaxError('Unexpected token'));

    await expect(listOrders()).rejects.toBeInstanceOf(SyntaxError);
  });
});

// ── getPrintQuote ────────────────────────────────────────────────────────────

describe('getPrintQuote', () => {
  it('POSTs to /api/print-quote with the provided payload', async () => {
    mockApiPost.mockResolvedValue({ shipping_cost_cents: 500, estimated_days: 5 });

    const result = await getPrintQuote({
      product_sku: 'POSTER_18X24',
      size: '18x24',
      country: 'US',
    });

    expect(mockApiPost).toHaveBeenCalledWith('/api/print-quote', {
      product_sku: 'POSTER_18X24',
      size: '18x24',
      country: 'US',
    });
    expect(result.shipping_cost_cents).toBe(500);
    expect(result.estimated_days).toBe(5);
  });

  it('propagates 401 ApiError', async () => {
    mockApiPost.mockRejectedValue(new ApiError(401, 'Unauthorized'));

    const err = await getPrintQuote({
      product_sku: 'sku', size: '18x24', country: 'US',
    }).catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(401);
  });

  it('propagates 403 ApiError', async () => {
    mockApiPost.mockRejectedValue(new ApiError(403, 'Forbidden'));

    await expect(getPrintQuote({
      product_sku: 'sku', size: '18x24', country: 'US',
    })).rejects.toBeInstanceOf(ApiError);
  });

  it('propagates 404 ApiError (SKU not found)', async () => {
    mockApiPost.mockRejectedValue(new ApiError(404, 'Unknown SKU'));

    const err = await getPrintQuote({
      product_sku: 'does-not-exist', size: '18x24', country: 'US',
    }).catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(404);
  });

  it('propagates 429 ApiError after retry exhaustion', async () => {
    mockApiPost.mockRejectedValue(new ApiError(429, 'Too many requests'));

    const err = await getPrintQuote({
      product_sku: 'sku', size: '18x24', country: 'US',
    }).catch((e: unknown) => e);

    expect((err as ApiError).status).toBe(429);
  });

  it('propagates network TypeError', async () => {
    mockApiPost.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getPrintQuote({
      product_sku: 'sku', size: '18x24', country: 'US',
    })).rejects.toBeInstanceOf(TypeError);
  });

  it('propagates SyntaxError on malformed JSON body', async () => {
    mockApiPost.mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));

    await expect(getPrintQuote({
      product_sku: 'sku', size: '18x24', country: 'US',
    })).rejects.toBeInstanceOf(SyntaxError);
  });
});
