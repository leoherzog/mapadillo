import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from './index.js';

/**
 * Helper: call a route on the Hono app with the Workers env injected.
 * Returns the Hono Response directly (no real HTTP round-trip).
 */
function request(path: string, init?: RequestInit) {
  return app.request(path, init, env);
}

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
  });

  it('returns JSON content type', async () => {
    const res = await request('/api/health');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('returns status ok with milestone 1', async () => {
    const res = await request('/api/health');
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', milestone: 1 });
  });
});

// ── Auth stubs (Milestone 2) ──────────────────────────────────────────────────

describe('Auth stubs - 501', () => {
  it('ALL /api/auth/anything returns 501', async () => {
    const res = await request('/api/auth/anything');
    expect(res.status).toBe(501);
  });

  it('POST /api/auth/sign-in returns 501', async () => {
    const res = await request('/api/auth/sign-in', { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('error body mentions Milestone 2', async () => {
    const res = await request('/api/auth/session');
    const body = await res.json();
    expect(body.error).toContain('Milestone 2');
  });
});

// ── Map stubs (Milestone 4) ──────────────────────────────────────────────────

describe('Map stubs - 501', () => {
  it('GET /api/maps returns 501', async () => {
    const res = await request('/api/maps');
    expect(res.status).toBe(501);
  });

  it('POST /api/maps returns 501', async () => {
    const res = await request('/api/maps', { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('GET /api/maps/:id returns 501', async () => {
    const res = await request('/api/maps/abc-123');
    expect(res.status).toBe(501);
  });

  it('PUT /api/maps/:id returns 501', async () => {
    const res = await request('/api/maps/abc-123', { method: 'PUT' });
    expect(res.status).toBe(501);
  });

  it('DELETE /api/maps/:id returns 501', async () => {
    const res = await request('/api/maps/abc-123', { method: 'DELETE' });
    expect(res.status).toBe(501);
  });

  it('error body mentions Milestone 4', async () => {
    const res = await request('/api/maps');
    const body = await res.json();
    expect(body.error).toContain('Milestone 4');
  });
});

// ── Geocoding stub (Milestone 3) ──────────────────────────────────────────────

describe('Geocoding stub - 501', () => {
  it('GET /api/geocode returns 501', async () => {
    const res = await request('/api/geocode');
    expect(res.status).toBe(501);
  });

  it('error body mentions Milestone 3', async () => {
    const res = await request('/api/geocode');
    const body = await res.json();
    expect(body.error).toContain('Milestone 3');
  });
});

// ── Routing stub (Milestone 5) ────────────────────────────────────────────────

describe('Routing stub - 501', () => {
  it('POST /api/route returns 501', async () => {
    const res = await request('/api/route', { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('error body mentions Milestone 5', async () => {
    const res = await request('/api/route', { method: 'POST' });
    const body = await res.json();
    expect(body.error).toContain('Milestone 5');
  });
});

// ── Unknown API routes ────────────────────────────────────────────────────────

describe('Unknown API routes - 404', () => {
  it('GET /api/nonexistent returns 404', async () => {
    const res = await request('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  it('POST /api/does-not-exist returns 404', async () => {
    const res = await request('/api/does-not-exist', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
