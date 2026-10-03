/**
 * Sharing & access control routes.
 *
 * Mounted at /api/maps — sharing-specific sub-routes.
 * All routes here require requireAuth (applied in index.ts).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import type { MapData, Stop, StopRow, ShareRow } from '../../../shared/types.js';
import { rowToStop } from '../../../shared/types.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { readJsonBody } from '../lib/json-body.js';
import { getMapWithRole, insertStopStmt, requireMapRole } from './maps.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_ROLES = new Set(['viewer', 'editor']);

// Claim tokens are invite links shared via out-of-band channels (email, chat).
// A 30-day window balances usability (family members sometimes take days to
// click) against the blast radius of a leaked URL lingering in browser history
// or forwarded messages.
const CLAIM_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ── Sub-app ──────────────────────────────────────────────────────────────────

const sharing = new Hono<AppEnv>();

// GET /:id/shares — list shares for a map (owner only)
sharing.get('/:id/shares', async (c) => {
  const map = (await requireMapRole(c, 'owner', { hideForbidden: true }))?.map;
  if (!map) return c.res;

  const rows = await c.env.DB.prepare(
    `SELECT ms.id, ms.user_id, ms.role, ms.claim_token, ms.claim_token_expires_at, ms.created_at,
            u.name AS user_name, u.email AS user_email
     FROM map_shares ms
     LEFT JOIN "user" u ON ms.user_id = u.id
     WHERE ms.map_id = ?
     ORDER BY ms.created_at`,
  ).bind(map.id).all<ShareRow & { user_name: string | null; user_email: string | null }>();

  const shares = rows.results.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name,
    user_email: r.user_email,
    role: r.role,
    // Hide the single-use claim token once a share is claimed.
    claim_token: r.user_id !== null ? null : r.claim_token,
    claim_token_expires_at: r.user_id !== null ? null : r.claim_token_expires_at,
    claimed: r.user_id !== null,
    created_at: r.created_at,
  }));

  return c.json({ shares });
});

// POST /:id/shares — create invite link (owner only)
sharing.post('/:id/shares', rateLimit('RATE_LIMITER_PUBLIC', (c) => `shares:${c.get('user')!.id}`), async (c) => {
  const map = (await requireMapRole(c, 'owner', { hideForbidden: true }))?.map;
  if (!map) return c.res;

  const body = await readJsonBody<{ role?: string }>(c);
  if (!body) return c.res;
  if (!body.role || !VALID_ROLES.has(body.role)) {
    return c.json({ error: 'role must be "viewer" or "editor"' }, 400);
  }

  const id = crypto.randomUUID();
  const claimToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS).toISOString();

  await c.env.DB.prepare(
    'INSERT INTO map_shares (id, map_id, role, claim_token, claim_token_expires_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, map.id, body.role, claimToken, expiresAt).run();

  return c.json({
    id,
    claim_token: claimToken,
    claim_token_expires_at: expiresAt,
    role: body.role,
    url: `/claim/${claimToken}`,
  }, 201);
});

// PUT /:id/shares/:shareId — update share role (owner only)
sharing.put('/:id/shares/:shareId', async (c) => {
  const map = (await requireMapRole(c, 'owner', { hideForbidden: true }))?.map;
  if (!map) return c.res;

  const shareId = c.req.param('shareId');
  const body = await readJsonBody<{ role?: string }>(c);
  if (!body) return c.res;
  if (!body.role || !VALID_ROLES.has(body.role)) {
    return c.json({ error: 'role must be "viewer" or "editor"' }, 400);
  }

  const result = await c.env.DB.prepare(
    'UPDATE map_shares SET role = ? WHERE id = ? AND map_id = ?',
  ).bind(body.role, shareId, map.id).run();

  if (!result.meta.changes) {
    return c.json({ error: 'Share not found' }, 404);
  }

  return c.json({ success: true });
});

// DELETE /:id/shares/:shareId — remove a collaborator/invite (owner only)
sharing.delete('/:id/shares/:shareId', async (c) => {
  const map = (await requireMapRole(c, 'owner', { hideForbidden: true }))?.map;
  if (!map) return c.res;

  const shareId = c.req.param('shareId');
  const result = await c.env.DB.prepare(
    'DELETE FROM map_shares WHERE id = ? AND map_id = ?',
  ).bind(shareId, map.id).run();

  if (!result.meta.changes) {
    return c.json({ error: 'Share not found' }, 404);
  }

  return c.json({ success: true });
});

// PUT /:id/visibility — update map visibility (owner only)
sharing.put('/:id/visibility', async (c) => {
  const map = (await requireMapRole(c, 'owner', { hideForbidden: true }))?.map;
  if (!map) return c.res;

  const body = await readJsonBody<{ visibility?: string }>(c);
  if (!body) return c.res;
  if (!body.visibility || !['public', 'private'].includes(body.visibility)) {
    return c.json({ error: 'visibility must be "public" or "private"' }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE maps SET visibility = ?, updated_at = ? WHERE id = ?',
  ).bind(body.visibility, new Date().toISOString(), map.id).run();

  return c.json({ success: true, visibility: body.visibility });
});

// POST /:id/duplicate — duplicate a map (requires read access)
sharing.post('/:id/duplicate', async (c) => {
  const userId = c.get('user')!.id;
  const mapId = c.req.param('id');

  // Check read access: owner, shared, or public
  const result = await getMapWithRole(c.env.DB, mapId, userId);
  if (!result) return c.json({ error: 'Map not found' }, 404);
  const map = result.map;

  // Create new map
  const newMapId = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO maps (id, owner_id, name, family_name, visibility, export_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    newMapId, userId, `${map.name} (copy)`, map.family_name,
    'private', map.export_settings, now, now,
  ).run();

  // Copy all stops with new IDs
  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(mapId).all<StopRow>();

  const newStops: Stop[] = [];
  if (stops.results.length > 0) {
    const stmts = stops.results.map((row) => {
      const copy: StopRow = { ...row, id: crypto.randomUUID(), map_id: newMapId, created_at: now };
      newStops.push(rowToStop(copy));
      return insertStopStmt(c.env.DB, copy);
    });
    await c.env.DB.batch(stmts);
  }

  const newMap: MapData = {
    id: newMapId, owner_id: userId, name: `${map.name} (copy)`,
    family_name: map.family_name, visibility: 'private',
    export_settings: map.export_settings,
    created_at: now, updated_at: now,
  };
  return c.json({ ...newMap, stops: newStops }, 201);
});

// ── Claim share handler (mounted separately at /api/shares/claim/:token) ──

/** Claim an invite token for the signed-in user. index.ts applies auth and the per-user rate limit. */
export async function claimShareHandler(c: Context<AppEnv>) {
  const userId = c.get('user')!.id;
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT * FROM map_shares WHERE claim_token = ?',
  ).bind(token).first<{
    id: string;
    map_id: string;
    user_id: string | null;
    role: string;
    claim_token: string | null;
    claim_token_expires_at: string | null;
  }>();

  if (!share) {
    return c.json({ error: 'Invalid or expired invite link' }, 404);
  }

  // Already claimed by this user — treat as success (idempotent reclaim).
  // Evaluated BEFORE the expiry check so an already-successful claim is not
  // later reported as expired when the timestamp finally rolls past.
  if (share.user_id === userId) {
    return c.json({ map_id: share.map_id });
  }

  // Expiry check for unclaimed invites. A NULL expiry never expires.
  if (share.claim_token_expires_at) {
    const expiresAt = Date.parse(share.claim_token_expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      // Null the token so the one-shot invite can't be re-attempted.
      await c.env.DB.prepare(
        'UPDATE map_shares SET claim_token = NULL WHERE id = ? AND user_id IS NULL',
      ).bind(share.id).run();
      return c.json({ error: 'Invalid or expired invite link' }, 404);
    }
  }

  // Owner clicking their own invite — just redirect, don't create a redundant share
  const map = await c.env.DB.prepare('SELECT owner_id FROM maps WHERE id = ?')
    .bind(share.map_id).first<{ owner_id: string }>();
  if (map && map.owner_id === userId) {
    return c.json({ map_id: share.map_id });
  }

  // Already claimed by another user
  if (share.user_id !== null) {
    return c.json({ error: 'This invite has already been claimed' }, 403);
  }

  // Check if the user already has a different share for the same map.
  // If so, keep the higher-privilege role (editor > viewer), delete the other,
  // and return success without creating a duplicate (UNIQUE(map_id, user_id)).
  const existingShare = await c.env.DB.prepare(
    'SELECT id, role FROM map_shares WHERE map_id = ? AND user_id = ?',
  ).bind(share.map_id, userId).first<{ id: string; role: string }>();

  if (existingShare) {
    const roleRank: Record<string, number> = { editor: 2, viewer: 1 };
    const existingRank = roleRank[existingShare.role] ?? 1;
    const incomingRank = roleRank[share.role] ?? 1;

    if (incomingRank > existingRank) {
      // Incoming share has higher privilege — replace the existing one
      await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM map_shares WHERE id = ?').bind(existingShare.id),
        c.env.DB.prepare(
          'UPDATE map_shares SET user_id = ?, claim_token = NULL WHERE id = ?',
        ).bind(userId, share.id),
      ]);
    } else {
      // Existing share has equal or higher privilege — just nullify the incoming token
      await c.env.DB.prepare(
        'UPDATE map_shares SET claim_token = NULL WHERE id = ?',
      ).bind(share.id).run();
    }
    return c.json({ map_id: share.map_id });
  }

  // Claim it and nullify the token so it cannot be reused.
  // Include user_id IS NULL and claim_token = ? in the WHERE clause to guard
  // against a race condition where two requests try to claim the same token.
  const claimResult = await c.env.DB.prepare(
    'UPDATE map_shares SET user_id = ?, claim_token = NULL WHERE id = ? AND user_id IS NULL AND claim_token = ?',
  ).bind(userId, share.id, share.claim_token).run();

  if (claimResult.meta.changes === 0) {
    return c.json({ error: 'This invite has already been claimed' }, 409);
  }

  return c.json({ map_id: share.map_id });
}

export default sharing;
