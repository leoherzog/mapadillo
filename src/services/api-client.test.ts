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
    // Use a mock where json() rejects but text() resolves, simulating a
    // non-JSON error body. Real Response consumes the body stream on json(),
    // so we mock to test the intended fallback path.
    const mockRes = {
      ok: false,
      status: 500,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
      text: () => Promise.resolve('Server Error'),
    } as unknown as Response;
    vi.mocked(fetch).mockResolvedValue(mockRes);

    const err = await apiGet('/api/broken').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).body).toBe('Server Error');
  });

  it('throws ApiError with null body when both JSON and text fail', async () => {
    const badResponse = {
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('no json')),
      text: () => Promise.reject(new Error('no text')),
    } as unknown as Response;
    vi.mocked(fetch).mockResolvedValue(badResponse);

    const err = await apiGet('/api/broken').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toBeNull();
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
