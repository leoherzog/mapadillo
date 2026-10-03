/**
 * Sharing & access control routes.
 *
 * Mounted at /api/maps — sharing-specific sub-routes.
 * All routes here require requireAuth (applied in index.ts).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import type { MapData, StopRow, ShareRow, ShareRole } from '../../../shared/types.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { readJsonBody } from '../lib/json-body.js';
import { getMapWithRole, insertStopStmt, requireMapRole, selectStopsStmt } from './maps.js';

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
  const map = (await requireMapRole(c, 'owner'))?.map;
  if (!map) return c.res;

  const rows = await c.env.DB.prepare(
    `SELECT ms.id, ms.user_id, ms.role, ms.claim_token, ms.claim_token_expires_at, ms.created_at,
            u.name AS user_name, u.email AS user_email
     FROM map_shares ms
     LEFT JOIN "user" u ON ms.user_id = u.id
     WHERE ms.map_id = ?
       AND (ms.user_id IS NOT NULL OR ms.claim_token_expires_at IS NULL OR ms.claim_token_expires_at > ?)
     ORDER BY ms.created_at`,
  ).bind(map.id, new Date().toISOString()).all<ShareRow & { user_name: string | null; user_email: string | null }>();

  const shares = rows.results.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name,
    user_email: r.user_email,
    role: r.role,
    // A claimed share keeps its token so its claimant can reopen the link; it is not shown again.
    claim_token: r.user_id !== null ? null : r.claim_token,
    claim_token_expires_at: r.user_id !== null ? null : r.claim_token_expires_at,
    claimed: r.user_id !== null,
    created_at: r.created_at,
  }));

  return c.json({ shares });
});

// POST /:id/shares — create invite link (owner only)
sharing.post('/:id/shares', rateLimit('RATE_LIMITER_PUBLIC', (c) => `shares:${c.get('user')!.id}`), async (c) => {
  const map = (await requireMapRole(c, 'owner'))?.map;
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
  }, 201);
});

// PUT /:id/shares/:shareId — update share role (owner only)
sharing.put('/:id/shares/:shareId', async (c) => {
  const map = (await requireMapRole(c, 'owner'))?.map;
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
  const map = (await requireMapRole(c, 'owner'))?.map;
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
  const map = (await requireMapRole(c, 'owner'))?.map;
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

  const now = new Date().toISOString();
  const newMap: MapData = {
    id: crypto.randomUUID(), owner_id: userId, name: `${map.name} (copy)`,
    family_name: map.family_name, visibility: 'private',
    export_settings: map.export_settings,
    created_at: now, updated_at: now,
  };

  // Copy all stops with new IDs; the map and its stops commit in one batch.
  const stops = await selectStopsStmt(c.env.DB, map.id).all<StopRow>();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO maps (id, owner_id, name, family_name, visibility, export_settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      newMap.id, newMap.owner_id, newMap.name, newMap.family_name,
      newMap.visibility, newMap.export_settings, now, now,
    ),
    ...stops.results.map((row) => insertStopStmt(c.env.DB, {
      ...row, id: crypto.randomUUID(), map_id: newMap.id, created_at: now,
    })),
  ]);

  return c.json(newMap, 201);
});

// ── Claim share handler (mounted separately at /api/shares/claim/:token) ──

/** Claim an invite token for the signed-in user. index.ts applies auth and the per-user rate limit. */
export async function claimShareHandler(c: Context<AppEnv>) {
  const userId = c.get('user')!.id;
  const token = c.req.param('token');

  const share = await c.env.DB.prepare(
    'SELECT * FROM map_shares WHERE claim_token = ?',
  ).bind(token).first<ShareRow>();

  if (!share) {
    return c.json({ error: 'Invalid or expired invite link' }, 404);
  }

  // A claimed share keeps its token, so its claimant can reopen the link even
  // after expiry and everyone else is told it is taken.
  if (share.user_id === userId) {
    return c.json({ map_id: share.map_id });
  }
  if (share.user_id !== null) {
    return c.json({ error: 'This invite has already been claimed' }, 403);
  }

  // Expiry check for unclaimed invites. A NULL expiry never expires.
  if (share.claim_token_expires_at) {
    const expiresAt = Date.parse(share.claim_token_expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      // An expired invite can never be claimed, so remove it.
      await c.env.DB.prepare(
        'DELETE FROM map_shares WHERE id = ? AND user_id IS NULL',
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

  // A user holds at most one share per map (UNIQUE(map_id, user_id)). A higher
  // incoming role replaces their share; otherwise the invite stays unclaimed.
  const existingShare = await c.env.DB.prepare(
    'SELECT id, role FROM map_shares WHERE map_id = ? AND user_id = ?',
  ).bind(share.map_id, userId).first<Pick<ShareRow, 'id' | 'role'>>();

  if (existingShare) {
    const roleRank: Record<ShareRole, number> = { editor: 2, viewer: 1 };
    const existingRank = roleRank[existingShare.role];
    const incomingRank = roleRank[share.role];

    if (incomingRank > existingRank) {
      // Both statements are guarded on the invite still being unclaimed, so a
      // concurrent claim of it leaves the existing share untouched.
      const [, claimed] = await c.env.DB.batch([
        c.env.DB.prepare(
          'DELETE FROM map_shares WHERE id = ? AND EXISTS (SELECT 1 FROM map_shares WHERE id = ? AND user_id IS NULL AND claim_token = ?)',
        ).bind(existingShare.id, share.id, share.claim_token),
        c.env.DB.prepare(
          'UPDATE map_shares SET user_id = ? WHERE id = ? AND user_id IS NULL AND claim_token = ?',
        ).bind(userId, share.id, share.claim_token),
      ]);
      if (!claimed.meta.changes) {
        return c.json({ error: 'This invite has already been claimed' }, 409);
      }
    }
    return c.json({ map_id: share.map_id });
  }

  // The WHERE guard makes concurrent claims of the same token race-safe.
  const claimResult = await c.env.DB.prepare(
    'UPDATE map_shares SET user_id = ? WHERE id = ? AND user_id IS NULL AND claim_token = ?',
  ).bind(userId, share.id, share.claim_token).run();

  if (claimResult.meta.changes === 0) {
    return c.json({ error: 'This invite has already been claimed' }, 409);
  }

  return c.json({ map_id: share.map_id });
}

export default sharing;
