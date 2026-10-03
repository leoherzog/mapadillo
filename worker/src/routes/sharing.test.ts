import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import {
  applyTestSchema, request, createTestSession, jsonRequest, createMap, createShare, createStop, grantShare,
} from '../test-helpers.js';

beforeAll(applyTestSchema);

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
        claim_token: string | null;
        claim_token_expires_at: string | null;
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
    expect(claimedShare.claim_token).toBeNull();
    expect(claimedShare.claim_token_expires_at).toBeNull();
    expect(claimedShare.user_id).toBe(claimeeId);
    expect(claimedShare.user_name).toBe('Test User');
    expect(claimedShare.user_email).toBeTruthy();
  });

  it('omits expired unclaimed invites', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);
    const live = await createShare(mapId, cookie, 'viewer');

    const expiredId = crypto.randomUUID();
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, role, claim_token, claim_token_expires_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(expiredId, mapId, 'viewer', crypto.randomUUID(), pastIso).run();

    const res = await request(`/api/maps/${mapId}/shares`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shares: Array<{ id: string }> };
    expect(body.shares.map((s) => s.id)).toEqual([live.id]);
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
  it('same user claiming the same token twice opens the map both times', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const { claim_token } = await createShare(mapId, ownerCookie, 'viewer');

    for (let i = 0; i < 2; i++) {
      const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, claimeeCookie);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { map_id: string };
      expect(body.map_id).toBe(mapId);
    }
  });

  it('claimant can reopen an expired link, and other users are told it is claimed', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    const { cookie: otherCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    const token = crypto.randomUUID();
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, user_id, role, claim_token, claim_token_expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), mapId, claimeeId, 'viewer', token, pastIso).run();

    const reopen = await jsonRequest(`/api/shares/claim/${token}`, 'POST', {}, claimeeCookie);
    expect(reopen.status).toBe(200);

    const other = await jsonRequest(`/api/shares/claim/${token}`, 'POST', {}, otherCookie);
    expect(other.status).toBe(403);
    const body = (await other.json()) as { error: string };
    expect(body.error).toContain('already been claimed');
  });

  it('claiming upgrades role when incoming share has higher privilege', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Give user a claimed viewer share first
    await grantShare(mapId, claimeeId, 'viewer');

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
    await grantShare(mapId, claimeeId, 'editor');

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

    // The incoming invite stays unclaimed for someone else
    const invite = await env.DB.prepare(
      'SELECT user_id, claim_token FROM map_shares WHERE id = ?',
    ).bind(inviteId).first<{ user_id: string | null; claim_token: string | null }>();
    expect(invite?.user_id).toBeNull();
    expect(invite?.claim_token).toBe(claim_token);
  });

  it('expired claim token returns 404 and deletes the invite', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    // Seed an expired unclaimed invite directly (past timestamp).
    const shareId = crypto.randomUUID();
    const token = crypto.randomUUID();
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare(
      'INSERT INTO map_shares (id, map_id, role, claim_token, claim_token_expires_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(shareId, mapId, 'viewer', token, pastIso).run();

    const res = await jsonRequest(`/api/shares/claim/${token}`, 'POST', {}, claimeeCookie);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid');

    const row = await env.DB.prepare(
      'SELECT id FROM map_shares WHERE id = ?',
    ).bind(shareId).first<{ id: string }>();
    expect(row).toBeNull();
  });

  it('fresh claim token succeeds and stores expiry', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: claimeeCookie, userId: claimeeId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    const { claim_token } = await createShare(mapId, ownerCookie, 'viewer');

    // Sanity: POST /:id/shares sets a non-NULL expiry
    const row = await env.DB.prepare(
      'SELECT claim_token_expires_at FROM map_shares WHERE claim_token = ?',
    ).bind(claim_token).first<{ claim_token_expires_at: string | null }>();
    expect(row?.claim_token_expires_at).toBeTruthy();
    expect(Date.parse(row!.claim_token_expires_at!)).toBeGreaterThan(Date.now());

    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, claimeeCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { map_id: string };
    expect(body.map_id).toBe(mapId);

    // And the share is claimed
    const claimed = await env.DB.prepare(
      'SELECT user_id, claim_token FROM map_shares WHERE map_id = ? AND user_id = ?',
    ).bind(mapId, claimeeId).first<{ user_id: string; claim_token: string | null }>();
    expect(claimed?.user_id).toBe(claimeeId);
    expect(claimed?.claim_token).toBe(claim_token);
  });

  it('claimed-by-another returns 403', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: user2Cookie } = await createTestSession();
    const { cookie: user3Cookie } = await createTestSession();
    const mapId = await createMap(ownerCookie);
    const { claim_token } = await createShare(mapId, ownerCookie, 'viewer');

    const first = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, user2Cookie);
    expect(first.status).toBe(200);

    // User3 tries to claim the same token
    const res = await jsonRequest(`/api/shares/claim/${claim_token}`, 'POST', {}, user3Cookie);
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

    await createStop(cookie, mapId, { type: 'point', name: 'Stop A', lat: 48.8566, lng: 2.3522 });
    await createStop(cookie, mapId, { type: 'point', name: 'Stop B', lat: 51.5074, lng: -0.1278 });

    // Duplicate the map
    const res = await jsonRequest(`/api/maps/${mapId}/duplicate`, 'POST', {}, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };

    expect(body.name).toBe('Test Map (copy)');
    expect(body.id).not.toBe(mapId);

    const getRes = await request(`/api/maps/${body.id}`, { headers: { cookie } });
    const copy = (await getRes.json()) as {
      stops: Array<{ id: string; name: string; map_id: string; latitude: number }>;
    };
    expect(copy.stops.length).toBe(2);

    // Stops should have new IDs and belong to the new map
    for (const stop of copy.stops) {
      expect(stop.map_id).toBe(body.id);
    }
    const stopNames = copy.stops.map((s) => s.name).sort();
    expect(stopNames).toEqual(['Stop A', 'Stop B']);
  });

  it('duplicate of a shared map works for collaborator', async () => {
    const { cookie: ownerCookie } = await createTestSession();
    const { cookie: editorCookie, userId: editorId } = await createTestSession();
    const mapId = await createMap(ownerCookie);

    await grantShare(mapId, editorId, 'editor');

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
  it('returns id, claim_token and role in the response', async () => {
    const { cookie } = await createTestSession();
    const mapId = await createMap(cookie);

    const res = await jsonRequest(`/api/maps/${mapId}/shares`, 'POST', { role: 'editor' }, cookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      claim_token: string;
      role: string;
    };

    // All fields should be present
    expect(body.id).toBeTruthy();
    expect(body.claim_token).toBeTruthy();
    expect(body.role).toBe('editor');

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

    await grantShare(mapId, editorId, 'editor');

    const res = await jsonRequest(
      `/api/maps/${mapId}/visibility`,
      'PUT',
      { visibility: 'public' },
      editorCookie,
    );
    // The editor can see the map, so an owner-only route answers 403
    expect(res.status).toBe(403);
  });
});
