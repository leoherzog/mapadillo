import { describe, it, expect, beforeAll } from 'vitest';
import { applyTestSchema, request, createTestSession, jsonRequest } from '../test-helpers.js';

beforeAll(applyTestSchema);

// ── GET /api/user/preferences ─────────────────────────────────────────────────

describe('GET /api/user/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request('/api/user/preferences');
    expect(res.status).toBe(401);
  });

  it('returns null units for a new user', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/user/preferences', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: null });
  });

  it('returns stored units after they have been changed', async () => {
    const { cookie } = await createTestSession();

    // Change to miles
    await jsonRequest('/api/user/preferences', 'PUT', { units: 'mi' }, cookie);

    // Verify GET returns the updated value
    const res = await request('/api/user/preferences', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });
  });
});

// ── PUT /api/user/preferences ─────────────────────────────────────────────────

describe('PUT /api/user/preferences', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request('/api/user/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units: 'mi' }),
    });
    expect(res.status).toBe(401);
  });

  it('updates units to "mi" and returns the new value', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/user/preferences', 'PUT', { units: 'mi' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });
  });

  it('updates units to "km" and returns the new value', async () => {
    const { cookie } = await createTestSession();

    // First set to mi, then back to km
    await jsonRequest('/api/user/preferences', 'PUT', { units: 'mi' }, cookie);
    const res = await jsonRequest('/api/user/preferences', 'PUT', { units: 'km' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'km' });
  });

  it('returns 400 for invalid units value', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/user/preferences', 'PUT', { units: 'meters' }, cookie);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid units');
  });

  it('returns 400 for empty string units', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/user/preferences', 'PUT', { units: '' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/user/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost',
        cookie,
      },
      body: 'not valid json{{{',
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns current preferences when body has no units field', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/user/preferences', 'PUT', {}, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: null });
  });

  it('ignores unknown fields and still processes units', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/user/preferences', 'PUT', { units: 'mi', theme: 'dark' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });
  });

  it('persists changes across separate GET requests', async () => {
    const { cookie } = await createTestSession();

    // Update
    await jsonRequest('/api/user/preferences', 'PUT', { units: 'mi' }, cookie);

    // Verify with GET
    const res = await request('/api/user/preferences', {
      headers: { cookie },
    });
    const body = await res.json();
    expect(body).toEqual({ units: 'mi' });

    // Update again
    await jsonRequest('/api/user/preferences', 'PUT', { units: 'km' }, cookie);

    // Verify again
    const res2 = await request('/api/user/preferences', {
      headers: { cookie },
    });
    const body2 = await res2.json();
    expect(body2).toEqual({ units: 'km' });
  });

  it('does not affect other users preferences', async () => {
    const session1 = await createTestSession();
    const session2 = await createTestSession();

    // User 1 sets miles
    await jsonRequest('/api/user/preferences', 'PUT', { units: 'mi' }, session1.cookie);

    // User 2 has never set units
    const res = await request('/api/user/preferences', {
      headers: { cookie: session2.cookie },
    });
    const body = await res.json();
    expect(body).toEqual({ units: null });
  });
});

// ── CSRF protection ───────────────────────────────────────────────────────────

describe('CSRF protection on PUT /api/user/preferences', () => {
  it('returns 403 when Origin header is missing on PUT', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/user/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({ units: 'mi' }),
    }, { origin: false });
    expect(res.status).toBe(403);
  });

  it('returns 403 when Origin header does not match', async () => {
    const { cookie } = await createTestSession();
    const res = await request('/api/user/preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        origin: 'https://evil.com',
        cookie,
      },
      body: JSON.stringify({ units: 'mi' }),
    }, { origin: false });
    expect(res.status).toBe(403);
  });
});
