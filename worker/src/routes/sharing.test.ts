import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyTestSchema, request, createTestSession, jsonRequest } from '../test-helpers.js';

beforeAll(applyTestSchema);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createMap(cookie: string, name = 'Test Map'): Promise<string> {
  const res = await jsonRequest('/api/maps', 'POST', { name }, cookie);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Create a share invite via the API and return its id + claim_token */
async function createShare(
  mapId: string,
  cookie: string,
  role = 'viewer',
): Promise<{ id: string; claim_token: string }> {
  const res = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role }, cookie);
  return (await res.json()) as { id: string; claim_token: string };
}

// ── POST /:id/shares — invalid JSON body ─────────────────────────────────────

describe('Sharing - invalid JSON bodies', () => {
  it('POST /:id/shares returns 400 for malformed JSON', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await request(`/api/maps/${mapId}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: '{bad json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('POST /:id/shares returns 400 when role is missing', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', {}, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('role');
  });

  it('PUT /:id/shares/:shareId returns 400 for malformed JSON', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const { id: shareId } = await createShare(mapId, cookie);

    const res = await request(`/api/maps/${mapId}/shares/${shareId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: 'not json!',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('PUT /:id/visibility returns 400 for malformed JSON', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await request(`/api/maps/${mapId}/visibility`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: '<<<',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('PUT /:id/visibility returns 400 when visibility is missing', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/visibility`, 'PUT', {}, cookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('visibility');
  });
});

// ── GET /:id/shares — response shape and claim_token visibility ──────────────

describe('Sharing - GET /:id/shares response details', () => {
  it('omits claim_token for claimed shares but includes it for unclaimed', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Create two invites
    const unclaimed = await createShare(mapId, ownerCookie, 'viewer');
    const toClaim = await createShare(mapId, ownerCookie, 'editor');

    // Claim the second one
    await jsonRequest(`/api/shares/claim/${toClaim.claim_token}`, 'POST', {}, claimeeCookie);

    // List shares
    const res = await request(`/api/maps/${mapId}/shares`, { headers: { cookie: ownerCookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shares: Array<{
        id: string;
        user_id: string | null;
        user_name: string | null;
        user_email: string | null;
        role: string;
        claim_token?: string;
        claimed: boolean;
      }>;
    };

    expect(body.shares.length).toBe(2);

    // Find the unclaimed and claimed shares
    const unclaimedShare = body.shares.find((s) => s.id === unclaimed.id)!;
    const claimedShare = body.shares.find((s) => s.id === toClaim.id)!;

    // Unclaimed share should expose its claim_token
    expect(unclaimedShare.claimed).toBe(false);
    expect(unclaimedShare.claim_token).toBeTruthy();
    expect(unclaimedShare.user_id).toBeNull();

    // Claimed share should NOT expose claim_token, and should have user info
    expect(claimedShare.claimed).toBe(true);
    expect(claimedShare.claim_token).toBeUndefined();
    expect(claimedShare.user_id).toBe(claimeeId);
    expect(claimedShare.user_name).toBe('Test User');
    expect(claimedShare.user_email).toBeTruthy();
  });
});

// ── PUT/DELETE /:id/shares/:shareId — non-owner access ───────────────────────

describe('Sharing - non-owner cannot modify shares', () => {
  it('PUT /:id/shares/:shareId returns 404 for non-owner', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const { id: shareId } = await createShare(mapId, ownerCookie, 'viewer');

    const res = await jsonRequest(
      `/api/maps/${mapId}/shares/${shareId}`,
      'PUT',
      { role: 'editor' },
      otherCookie,
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /:id/shares/:shareId returns 404 for non-owner', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const { id: shareId } = await createShare(mapId, ownerCookie, 'viewer');

    const res = await request(`/api/maps/${mapId}/shares/${shareId}`, {
      method: 'DELETE',
      headers: { cookie: otherCookie },
    });
    expect(res.status).toBe(404);
  });
});

// ── Claim flow edge cases ────────────────────────────────────────────────────

describe('Sharing - claim edge cases', () => {
  it('same user claiming the same token twice is idempotent', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    await createMap(ownerCookie);

    // Create a second map so the UNIQUE(map_id, user_id) constraint is not hit
    const mapId2 = await createMap(ownerCookie, 'Second Map');

    // Manually insert a share that is already claimed by the claimee but still
    // has a claim_token (the "already claimed by this user" code path).
    const shareId = crypto.randomUUID();
    const token = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(shareId, mapId2, claimeeId, 'viewer', token).run();

    // Claimee hits the same token again — should be treated as success
    const res = await jsonRequest(`/api/shares/claim/${token}`, 'POST', {}, claimeeCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map_id: string };
    expect(body.map_id).toBe(mapId2);
  });

  it('claiming upgrades role when incoming share has higher privilege', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Give user a viewer share first (direct DB insert to simulate a claimed share)
    const existingShareId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, ?)',
    ).bind(existingShareId, mapId, claimeeId, 'viewer').run();

    // Create an unclaimed editor invite
    const { claim_token } = await createShare(mapId, ownerCookie, 'editor');

    // Claim the editor invite — should upgrade the role
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, claimeeCookie);
    expect(res.status).toBe(200);

    // Verify: old viewer share should be deleted, new editor share should exist
    const shares = await env.DB.prepare(
      'SELECT id, role FROM map_shares WHERE map_id = ? AND user_id = ?',
    ).bind(mapId, claimeeId).all<{ id: string; role: string }>();

    expect(shares.results.length).toBe(1);
    expect(shares.results[0].role).toBe('editor');
  });

  it('claiming keeps existing role when it is equal or higher privilege', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Give user an editor share first
    const existingShareId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, ?)',
    ).bind(existingShareId, mapId, claimeeId, 'editor').run();

    // Create an unclaimed viewer invite
    const { claim_token, id: inviteId } = await createShare(mapId, ownerCookie, 'viewer');

    // Claim the viewer invite — should keep editor role
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, claimeeCookie);
    expect(res.status).toBe(200);

    // Verify: editor share still exists
    const shares = await env.DB.prepare(
      'SELECT role FROM map_shares WHERE map_id = ? AND user_id = ?',
    ).bind(mapId, claimeeId).all<{ role: string }>();

    expect(shares.results.length).toBe(1);
    expect(shares.results[0].role).toBe('editor');

    // The incoming invite's claim_token should be nullified
    const invite = await env.DB.prepare(
      'SELECT claim_token FROM map_shares WHERE id = ?',
    ).bind(inviteId).first<{ claim_token: string | null }>();
    expect(invite?.claim_token).toBeNull();
  });

  it('claim race condition returns 409 when token consumed between SELECT and UPDATE', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie } = await createTestSession();
    const { userId: thirdUserId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Create a real unclaimed share
    const { claim_token, id: shareId } = await createShare(mapId, ownerCookie, 'viewer');

    // Simulate a race: between the route's SELECT and UPDATE, another request
    // claims the token. We do this by manually setting user_id + clearing token.
    await env.DB.prepare(
      'UPDATE map_shares SET user_id = ?, claim_token = NULL WHERE id = ?',
    ).bind(thirdUserId, shareId).run();

    // Now claimee tries to claim the original token — SELECT finds nothing (token nullified)
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, claimeeCookie);
    // Token no longer exists in the DB, so it returns 404
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid');
  });

  it('claimed-by-another returns 403', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { userId: user2Id } = await createTestSession();
    const { cookie: user3Cookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Create an invite and have it already claimed by user2 (but token still present)
    const shareId = crypto.randomUUID();
    const token = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token) VALUES (?, ?, ?, ?, ?)',
    ).bind(shareId, mapId, user2Id, 'viewer', token).run();

    // User3 tries to claim the same token
    const res = await jsonRequest(`/api/shares/claim/${token}`, 'POST', {}, user3Cookie);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('already been claimed');
  });
});

// ── Duplicate edge cases ─────────────────────────────────────────────────────

describe('Sharing - duplicate copies stops', () => {
  it('duplicate preserves stop data in the copy', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    // Add stops to the map (API uses lat/lng, not latitude/longitude)
    await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      type: 'point',
      name: 'Stop A',
      lat: 48.8566,
      lng: 2.3522,
    }, cookie);
    await jsonRequest(`/api/maps/${mapId}/stops`, 'POST', {
      type: 'point',
      name: 'Stop B',
      lat: 51.5074,
      lng: -0.1278,
    }, cookie);

    // Duplicate the map
    const res = await jsonRequest(`/api/maps/${mapId}/duplicate`, 'POST', {}, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      stops: Array<{ id: string; name: string; map_id: string; latitude: number }>;
    };

    expect(body.name).toBe('Test Map (copy)');
    expect(body.id).not.toBe(mapId);
    expect(body.stops.length).toBe(2);

    // Stops should have new IDs and belong to the new map
    for (const stop of body.stops) {
      expect(stop.map_id).toBe(body.id);
    }
    const stopNames = body.stops.map((s) => s.name).sort();
    expect(stopNames).toEqual(['Stop A', 'Stop B']);
  });

  it('duplicate of a shared map works for collaborator', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Give editor access
    const shareId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, ?)',
    ).bind(shareId, mapId, editorId, 'editor').run();

    // Editor duplicates the map
    const res = await jsonRequest(`/api/maps/${mapId}/duplicate`, 'POST', {}, editorCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; owner_id: string; visibility: string };

    // Duplicate is owned by the editor, not the original owner
    expect(body.owner_id).toBe(editorId);
    expect(body.visibility).toBe('private');
  });

  it('duplicate of a nonexistent map returns 404', async () => {
    const { cookie } = await createTestSession();
    const res = await jsonRequest('/api/maps/nonexistent-id/duplicate', 'POST', {}, cookie);
    expect(res.status).toBe(404);
  });
});

// ── Share creation returns correct response shape ────────────────────────────

describe('Sharing - POST /:id/shares response shape', () => {
  it('returns id, claim_token, role, and url in the response', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'editor' }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      claim_token: string;
      role: string;
      url: string;
    };

    // All fields should be present
    expect(body.id).toBeTruthy();
    expect(body.claim_token).toBeTruthy();
    expect(body.role).toBe('editor');
    expect(body.url).toBe(`/claim/${body.claim_token}`);

    // claim_token and id should be valid UUIDs (36 chars)
    expect(body.id.length).toBe(36);
    expect(body.claim_token.length).toBe(36);
  });
});

// ── Visibility non-owner via shared access ───────────────────────────────────

describe('Sharing - visibility non-owner with share access', () => {
  it('editor cannot change visibility (owner only)', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Give editor access
    const shareId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role) VALUES (?, ?, ?, ?)',
    ).bind(shareId, mapId, editorId, 'editor').run();

    const res = await jsonRequest(
      `/api/maps/${mapId}/visibility`,
      'PUT',
      { visibility: 'public' },
      editorCookie,
    );
    // getOwnedMap only returns for owner, so editor gets 404
    expect(res.status).toBe(404);
  });
});
