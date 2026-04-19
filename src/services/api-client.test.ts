import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiError, apiGet, apiPost, apiPut, apiDelete } from './api-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}


beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

// ── ApiError ─────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('has name, status, body, and message', () => {
    const err = new ApiError(422, { error: 'bad input' });
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ error: 'bad input' });
    expect(err.message).toBe('API error 422');
  });

  it('is instanceof Error', () => {
    expect(new ApiError(500, null)).toBeInstanceOf(Error);
  });
});

// ── apiGet ───────────────────────────────────────────────────────────────────

describe('apiGet', () => {
  it('returns parsed JSON on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: '1', name: 'Trip' }));

    const result = await apiGet<{ id: string; name: string }>('/api/maps');

    expect(result).toEqual({ id: '1', name: 'Trip' });
  });

  it('sends credentials: same-origin', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));

    await apiGet('/api/maps');

    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/maps', expect.objectContaining({
      credentials: 'same-origin',
    }));
  });

  it('throws ApiError with JSON body on error response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));

    const err = await apiGet('/api/maps/bad').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).body).toEqual({ error: 'Not found' });
  });

  it('throws ApiError with text body when JSON parse fails', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('Server Error', { status: 500 }),
    );

    const err = await apiGet('/api/broken').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).body).toBe('Server Error');
  });

  it('throws ApiError with null body when text() fails', async () => {
    const badResponse = {
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('no body')),
    } as unknown as Response;
    vi.mocked(fetch).mockResolvedValue(badResponse);

    const err = await apiGet('/api/broken').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toBeNull();
  });

  it('extracts message field from JSON error body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'Not allowed' }), { status: 403 }),
    );

    const err = await apiGet('/api/forbidden').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).body).toBe('Not allowed');
  });
});

// ── apiPost ──────────────────────────────────────────────────────────────────

describe('apiPost', () => {
  it('sends POST with JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'new' }, 201));

    await apiPost('/api/maps', { name: 'Road Trip' });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/maps');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Road Trip' });
  });

  it('sends POST without body when data is undefined', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));

    await apiPost('/api/trigger');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.body).toBeUndefined();
  });

  it('returns parsed response', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 'abc', name: 'Trip' }));

    const result = await apiPost<{ id: string }>('/api/maps', { name: 'Trip' });

    expect(result.id).toBe('abc');
  });
});

// ── apiPut ───────────────────────────────────────────────────────────────────

describe('apiPut', () => {
  it('sends PUT with JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ name: 'Updated' }));

    await apiPut('/api/maps/1', { name: 'Updated' });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.method).toBe('PUT');
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Updated' });
  });

  it('sends PUT without body when data is undefined', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));

    await apiPut('/api/maps/1/action');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.body).toBeUndefined();
  });
});

// ── apiDelete ────────────────────────────────────────────────────────────────

describe('apiDelete', () => {
  it('sends DELETE request', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));

    await apiDelete('/api/maps/1');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('/api/maps/1');
    expect(init!.method).toBe('DELETE');
  });

  it('throws ApiError on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: 'Not found' }, 404));

    await expect(apiDelete('/api/maps/bad')).rejects.toThrow(ApiError);
  });
});

// ── 204 No Content ──────────────────────────────────────────────────────────

describe('204 No Content', () => {
  it('returns undefined for 204 responses', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    const result = await apiDelete('/api/maps/1');

    expect(result).toBeUndefined();
  });
});

// ── 429 retry ────────────────────────────────────────────────────────────────

describe('429 Too Many Requests', () => {
  it('retries once after Retry-After seconds on success', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'ok' }));

    const result = await apiGet<{ id: string }>('/api/maps');

    expect(result).toEqual({ id: 'ok' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('throws ApiError(429) when the retry also 429s', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('still limited', { status: 429, headers: { 'Retry-After': '0' } }),
    );

    const err = await apiGet('/api/maps').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('caps Retry-After delay so a hostile server cannot wedge the UI', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch)
        .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '9999' } }))
        .mockResolvedValueOnce(jsonResponse({ ok: true }));

      const pending = apiGet('/api/maps');
      // Our internal cap is 5s; advance past that and the retry should resolve.
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
