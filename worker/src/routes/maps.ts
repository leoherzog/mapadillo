/**
 * Maps + Stops CRUD routes.
 *
 * Mounted at /api/maps — most routes require requireAuth,
 * GET /:id uses optionalAuth for public map viewing.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import type { MapRow, StopRow } from '../db/types.js';
import type { MapRole } from '../../../shared/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_ICONS = new Set([
  'tree', 'leaf', 'flower', 'compass', 'fire', 'snowflake', 'sun', 'umbrella',
  'utensils', 'mug-hot', 'cake-candles', 'martini-glass', 'fish', 'camera',
  'landmark', 'globe', 'ticket', 'crown', 'house', 'bed', 'star', 'trophy',
  'gift', 'shop', 'paw', 'sparkles', 'plane', 'ship', 'train', 'bus', 'car',
  'suitcase', 'heart', 'anchor', 'circle', 'square', 'circle-check',
  'circle-plus', 'circle-info', 'circle-xmark',
]);

// Source of truth: src/config/travel-modes.ts — keep in sync
const VALID_TRAVEL_MODES = new Set(['drive', 'walk', 'bike', 'plane', 'boat']);
const VALID_TYPES = new Set(['point', 'route']);
const VALID_UNITS = new Set(['km', 'mi']);

function isValidLat(v: number): boolean {
  return isFinite(v) && v >= -90 && v <= 90;
}

function isValidLng(v: number): boolean {
  return isFinite(v) && v >= -180 && v <= 180;
}

// ── Role-based access control ────────────────────────────────────────────────

export async function getMapWithRole(
  db: D1Database,
  mapId: string,
  userId: string | null,
): Promise<{ map: MapRow; role: MapRole } | null> {
  const map = await db.prepare('SELECT * FROM maps WHERE id = ?')
    .bind(mapId)
    .first<MapRow>();
  if (!map) return null;

  // Owner check
  if (userId && userId === map.owner_id) {
    return { map, role: 'owner' };
  }

  // Share check
  if (userId) {
    const share = await db.prepare(
      'SELECT role FROM map_shares WHERE map_id = ? AND user_id = ?',
    ).bind(mapId, userId).first<{ role: string }>();
    if (share) {
      return { map, role: share.role as MapRole };
    }
  }

  // Public check
  if (map.visibility === 'public') {
    return { map, role: 'public' };
  }

  return null;
}

function canEdit(role: MapRole): boolean {
  return role === 'owner' || role === 'editor';
}

// ── Sub-app ──────────────────────────────────────────────────────────────────

const maps = new Hono<AppEnv>();

// POST / — create map
maps.post('/', async (c) => {
  const body = await c.req.json<{ name?: string; family_name?: string; units?: string }>().catch((): { name?: string; family_name?: string; units?: string } => ({}));
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  if (body.name.trim().length > 200) {
    return c.json({ error: 'name must be 200 characters or fewer' }, 400);
  }
  if (body.family_name && typeof body.family_name === 'string' && body.family_name.trim().length > 200) {
    return c.json({ error: 'family_name must be 200 characters or fewer' }, 400);
  }
  const units = body.units && VALID_UNITS.has(body.units) ? body.units : 'km';

  const id = crypto.randomUUID();
  const userId = c.get('user')!.id;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO maps (id, owner_id, name, family_name, units, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, userId, body.name.trim(), body.family_name?.trim() ?? null, units, now, now).run();

  const map = await c.env.DB.prepare('SELECT * FROM maps WHERE id = ?').bind(id).first<MapRow>();
  return c.json(map, 201);
});

// GET / — list maps for current user (owned + shared)
maps.get('/', async (c) => {
  const userId = c.get('user')!.id;

  // Fetch owned maps
  const ownedRows = await c.env.DB.prepare(
    'SELECT * FROM maps WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100',
  ).bind(userId).all<MapRow>();

  // Fetch shared maps
  const sharedRows = await c.env.DB.prepare(
    `SELECT m.*, ms.role AS share_role
     FROM map_shares ms
     JOIN maps m ON ms.map_id = m.id
     WHERE ms.user_id = ?
     ORDER BY m.updated_at DESC
     LIMIT 100`,
  ).bind(userId).all<MapRow & { share_role: string }>();

  const allMaps = [
    ...ownedRows.results.map((m) => ({ ...m, role: 'owner' as const })),
    ...sharedRows.results.map((m) => {
      const { share_role, ...mapData } = m;
      return { ...mapData, role: share_role as 'editor' | 'viewer' };
    }),
  ];

  if (allMaps.length === 0) return c.json([]);

  // Batch all stop queries in a single D1 round-trip
  const stopStmts = allMaps.map((map) =>
    c.env.DB.prepare('SELECT * FROM stops WHERE map_id = ? ORDER BY position').bind(map.id),
  );
  const stopResults = await c.env.DB.batch(stopStmts);

  const mapsWithStops = allMaps.map((map, i) => ({
    ...map,
    stops: (stopResults[i] as D1Result<StopRow>).results,
  }));

  return c.json(mapsWithStops);
});

// GET /:id — get single map with stops (uses optional auth, allows public)
maps.get('/:id', async (c) => {
  const userId = c.get('user')?.id ?? null;
  const result = await getMapWithRole(c.env.DB, c.req.param('id'), userId);

  if (!result) {
    return c.json({ error: 'Map not found' }, 404);
  }

  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(result.map.id).all<StopRow>();

  return c.json({ ...result.map, role: result.role, stops: stops.results });
});

// PUT /:id — update map (owner or editor)
maps.put('/:id', async (c) => {
  const userId = c.get('user')!.id;
  const result = await getMapWithRole(c.env.DB, c.req.param('id'), userId);

  if (!result) return c.json({ error: 'Map not found' }, 404);
  if (!canEdit(result.role)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<Record<string, unknown>>().catch((): Record<string, unknown> => ({}));

  const allowed = ['name', 'family_name', 'style_preferences', 'units'] as const;
  const updates: string[] = [];
  const values: unknown[] = [];

  for (const key of allowed) {
    if (key in body) {
      let val = body[key];
      if (key === 'name') {
        if (!val || typeof val !== 'string' || !(val as string).trim()) {
          return c.json({ error: 'name cannot be empty' }, 400);
        }
        val = (val as string).trim();
        if ((val as string).length > 200) {
          return c.json({ error: 'name must be 200 characters or fewer' }, 400);
        }
      }
      if (key === 'family_name' && typeof val === 'string' && val.trim().length > 200) {
        return c.json({ error: 'family_name must be 200 characters or fewer' }, 400);
      }
      if (key === 'units' && !VALID_UNITS.has(val as string)) {
        return c.json({ error: 'units must be "km" or "mi"' }, 400);
      }
      if (key === 'style_preferences' && typeof val === 'object') {
        val = JSON.stringify(val);
      }
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (updates.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  const now = new Date().toISOString();
  updates.push('updated_at = ?');
  values.push(now);
  values.push(result.map.id);

  await c.env.DB.prepare(
    `UPDATE maps SET ${updates.join(', ')} WHERE id = ?`,
  ).bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM maps WHERE id = ?')
    .bind(result.map.id).first<MapRow>();
  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(result.map.id).all<StopRow>();

  return c.json({ ...updated, stops: stops.results });
});

// DELETE /:id — delete map (owner only, cascade deletes stops)
maps.delete('/:id', async (c) => {
  const userId = c.get('user')!.id;
  const result = await getMapWithRole(c.env.DB, c.req.param('id'), userId);

  if (!result) return c.json({ error: 'Map not found' }, 404);
  if (result.role !== 'owner') return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare('DELETE FROM maps WHERE id = ?').bind(result.map.id).run();
  return c.json({ success: true });
});

// PUT /:id/stops/reorder — MUST be before /:id/stops/:stopId
maps.put('/:id/stops/reorder', async (c) => {
  const userId = c.get('user')!.id;
  const result = await getMapWithRole(c.env.DB, c.req.param('id'), userId);

  if (!result) return c.json({ error: 'Map not found' }, 404);
  if (!canEdit(result.role)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{ order?: string[] }>().catch((): { order?: string[] } => ({}));
  if (!body.order || !Array.isArray(body.order)) {
    return c.json({ error: 'order must be an array of stop IDs' }, 400);
  }
  if (new Set(body.order).size !== body.order.length) {
    return c.json({ error: 'order must not contain duplicate stop IDs' }, 400);
  }

  // Verify all stop IDs belong to this map
  const existing = await c.env.DB.prepare(
    'SELECT id FROM stops WHERE map_id = ?',
  ).bind(result.map.id).all<{ id: string }>();

  const existingIds = new Set(existing.results.map((s) => s.id));
  for (const sid of body.order) {
    if (!existingIds.has(sid)) {
      return c.json({ error: `Stop ${sid} not found in this map` }, 400);
    }
  }
  if (body.order.length !== existingIds.size) {
    return c.json({ error: 'order must include all stop IDs' }, 400);
  }

  // Batch update positions
  const stmts = body.order.map((sid, i) =>
    c.env.DB.prepare('UPDATE stops SET position = ? WHERE id = ?').bind(i, sid),
  );

  // Points at position 0 must never have a travel_mode (routes keep theirs)
  stmts.push(
    c.env.DB.prepare("UPDATE stops SET travel_mode = NULL WHERE map_id = ? AND position = 0 AND type = 'point'")
      .bind(result.map.id),
  );

  // Include updated_at in the same atomic batch
  stmts.push(
    c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), result.map.id),
  );

  await c.env.DB.batch(stmts);

  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(result.map.id).all<StopRow>();

  return c.json(stops.results);
});

// POST /:id/stops — add stop (owner or editor)
maps.post('/:id/stops', async (c) => {
  const userId = c.get('user')!.id;
  const result = await getMapWithRole(c.env.DB, c.req.param('id'), userId);

  if (!result) return c.json({ error: 'Map not found' }, 404);
  if (!canEdit(result.role)) return c.json({ error: 'Forbidden' }, 403);

  type StopBody = {
    type?: string;
    name?: string;
    lat?: number;
    lng?: number;
    label?: string;
    icon?: string;
    travel_mode?: string;
    dest_name?: string;
    dest_lat?: number;
    dest_lng?: number;
  };
  const body = await c.req.json<StopBody>().catch((): StopBody => ({}));

  const type = body.type ?? 'point';
  if (!VALID_TYPES.has(type)) {
    return c.json({ error: `Invalid type: ${type}` }, 400);
  }
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  if (body.name.trim().length > 200) {
    return c.json({ error: 'name must be 200 characters or fewer' }, 400);
  }
  if (body.label && typeof body.label === 'string' && body.label.trim().length > 500) {
    return c.json({ error: 'label must be 500 characters or fewer' }, 400);
  }
  if (body.dest_name && typeof body.dest_name === 'string' && body.dest_name.trim().length > 200) {
    return c.json({ error: 'dest_name must be 200 characters or fewer' }, 400);
  }
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return c.json({ error: 'lat and lng are required numbers' }, 400);
  }
  if (!isValidLat(body.lat)) {
    return c.json({ error: 'lat must be a finite number between -90 and 90' }, 400);
  }
  if (!isValidLng(body.lng)) {
    return c.json({ error: 'lng must be a finite number between -180 and 180' }, 400);
  }
  if (body.icon && !VALID_ICONS.has(body.icon)) {
    return c.json({ error: `Invalid icon: ${body.icon}` }, 400);
  }

  // travel_mode validation: only allowed on routes
  if (body.travel_mode && !VALID_TRAVEL_MODES.has(body.travel_mode)) {
    return c.json({ error: `Invalid travel_mode: ${body.travel_mode}` }, 400);
  }
  if (type === 'point' && body.travel_mode) {
    return c.json({ error: 'Points cannot have a travel_mode' }, 400);
  }

  // dest_* validation: only for routes
  if (type === 'point' && (body.dest_lat != null || body.dest_lng != null || body.dest_name != null)) {
    return c.json({ error: 'Points cannot have destination fields' }, 400);
  }
  if (body.dest_lat != null && typeof body.dest_lat !== 'number') {
    return c.json({ error: 'dest_lat must be a number' }, 400);
  }
  if (body.dest_lng != null && typeof body.dest_lng !== 'number') {
    return c.json({ error: 'dest_lng must be a number' }, 400);
  }
  if (typeof body.dest_lat === 'number' && !isValidLat(body.dest_lat)) {
    return c.json({ error: 'dest_lat must be a finite number between -90 and 90' }, 400);
  }
  if (typeof body.dest_lng === 'number' && !isValidLng(body.dest_lng)) {
    return c.json({ error: 'dest_lng must be a finite number between -180 and 180' }, 400);
  }

  // Auto-increment position
  const maxPos = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) as max_pos FROM stops WHERE map_id = ?',
  ).bind(result.map.id).first<{ max_pos: number }>();
  const position = (maxPos?.max_pos ?? -1) + 1;

  const travelMode = type === 'route' ? (body.travel_mode ?? 'drive') : null;

  const stopId = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO stops (id, map_id, position, type, name, label, latitude, longitude, icon, travel_mode, dest_name, dest_latitude, dest_longitude, route_geometry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      stopId, result.map.id, position, type, body.name.trim(), body.label?.trim() ?? null,
      body.lat, body.lng, body.icon ?? null, travelMode,
      body.dest_name?.trim() ?? null, body.dest_lat ?? null, body.dest_lng ?? null, null,
    ),
    c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
      .bind(now, result.map.id),
  ]);

  const stop = await c.env.DB.prepare('SELECT * FROM stops WHERE id = ?')
    .bind(stopId).first<StopRow>();
  return c.json(stop, 201);
});

// PUT /:id/stops/:stopId — update stop (owner or editor)
maps.put('/:id/stops/:stopId', async (c) => {
  const userId = c.get('user')!.id;
  const result = await getMapWithRole(c.env.DB, c.req.param('id'), userId);

  if (!result) return c.json({ error: 'Map not found' }, 404);
  if (!canEdit(result.role)) return c.json({ error: 'Forbidden' }, 403);

  const stopId = c.req.param('stopId');
  const stop = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE id = ? AND map_id = ?',
  ).bind(stopId, result.map.id).first<StopRow>();

  if (!stop) {
    return c.json({ error: 'Stop not found' }, 404);
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  const updates: string[] = [];
  const values: unknown[] = [];

  if ('name' in body) {
    if (!body.name || typeof body.name !== 'string' || !(body.name as string).trim()) {
      return c.json({ error: 'name cannot be empty' }, 400);
    }
    if ((body.name as string).trim().length > 200) {
      return c.json({ error: 'name must be 200 characters or fewer' }, 400);
    }
    updates.push('name = ?');
    values.push((body.name as string).trim());
  }
  if ('label' in body) {
    if (body.label !== null && typeof body.label !== 'string') {
      return c.json({ error: 'label must be a string or null' }, 400);
    }
    if (typeof body.label === 'string' && body.label.trim().length > 500) {
      return c.json({ error: 'label must be 500 characters or fewer' }, 400);
    }
    updates.push('label = ?');
    values.push(typeof body.label === 'string' ? body.label.trim() : null);
  }
  if ('lat' in body) {
    if (typeof body.lat !== 'number') return c.json({ error: 'lat must be a number' }, 400);
    if (!isValidLat(body.lat as number)) return c.json({ error: 'lat must be a finite number between -90 and 90' }, 400);
    updates.push('latitude = ?');
    values.push(body.lat);
  }
  if ('lng' in body) {
    if (typeof body.lng !== 'number') return c.json({ error: 'lng must be a number' }, 400);
    if (!isValidLng(body.lng as number)) return c.json({ error: 'lng must be a finite number between -180 and 180' }, 400);
    updates.push('longitude = ?');
    values.push(body.lng);
  }
  if ('icon' in body) {
    if (body.icon !== null && !VALID_ICONS.has(body.icon as string)) {
      return c.json({ error: `Invalid icon: ${body.icon}` }, 400);
    }
    updates.push('icon = ?');
    values.push(body.icon ?? null);
  }
  if ('travel_mode' in body) {
    if (body.travel_mode !== null && !VALID_TRAVEL_MODES.has(body.travel_mode as string)) {
      return c.json({ error: `Invalid travel_mode: ${body.travel_mode}` }, 400);
    }
    if (stop.type === 'point' && body.travel_mode !== null) {
      return c.json({ error: 'Points cannot have a travel_mode' }, 400);
    }
    updates.push('travel_mode = ?');
    values.push(body.travel_mode ?? null);
  }
  if ('type' in body) {
    return c.json({ error: 'type cannot be changed after creation' }, 400);
  }
  if ('dest_name' in body) {
    if (body.dest_name !== null && typeof body.dest_name !== 'string') {
      return c.json({ error: 'dest_name must be a string or null' }, 400);
    }
    if (typeof body.dest_name === 'string' && body.dest_name.trim().length > 200) {
      return c.json({ error: 'dest_name must be 200 characters or fewer' }, 400);
    }
    updates.push('dest_name = ?');
    values.push(typeof body.dest_name === 'string' ? body.dest_name.trim() : null);
  }
  if ('dest_lat' in body) {
    if (body.dest_lat !== null && typeof body.dest_lat !== 'number') {
      return c.json({ error: 'dest_lat must be a number' }, 400);
    }
    if (typeof body.dest_lat === 'number' && !isValidLat(body.dest_lat)) {
      return c.json({ error: 'dest_lat must be a finite number between -90 and 90' }, 400);
    }
    updates.push('dest_latitude = ?');
    values.push(body.dest_lat ?? null);
  }
  if ('dest_lng' in body) {
    if (body.dest_lng !== null && typeof body.dest_lng !== 'number') {
      return c.json({ error: 'dest_lng must be a number' }, 400);
    }
    if (typeof body.dest_lng === 'number' && !isValidLng(body.dest_lng)) {
      return c.json({ error: 'dest_lng must be a finite number between -180 and 180' }, 400);
    }
    updates.push('dest_longitude = ?');
    values.push(body.dest_lng ?? null);
  }
  if ('route_geometry' in body) {
    if (body.route_geometry !== null && typeof body.route_geometry !== 'string') {
      return c.json({ error: 'route_geometry must be a string or null' }, 400);
    }
    updates.push('route_geometry = ?');
    values.push(body.route_geometry ?? null);
  }

  // Auto-invalidate cached geometry when coordinates or travel_mode change
  const geoFields = ['lat', 'lng', 'dest_lat', 'dest_lng', 'travel_mode'];
  if (geoFields.some((f) => f in body) && !('route_geometry' in body)) {
    updates.push('route_geometry = ?');
    values.push(null);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  values.push(stopId);
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE stops SET ${updates.join(', ')} WHERE id = ?`,
    ).bind(...values),
    c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
      .bind(now, result.map.id),
  ]);

  const updated = await c.env.DB.prepare('SELECT * FROM stops WHERE id = ?')
    .bind(stopId).first<StopRow>();
  return c.json(updated);
});

// DELETE /:id/stops/:stopId — delete stop (owner or editor)
maps.delete('/:id/stops/:stopId', async (c) => {
  const userId = c.get('user')!.id;
  const result = await getMapWithRole(c.env.DB, c.req.param('id'), userId);

  if (!result) return c.json({ error: 'Map not found' }, 404);
  if (!canEdit(result.role)) return c.json({ error: 'Forbidden' }, 403);

  const stopId = c.req.param('stopId');
  const stop = await c.env.DB.prepare(
    'SELECT position FROM stops WHERE id = ? AND map_id = ?',
  ).bind(stopId, result.map.id).first<{ position: number }>();

  if (!stop) {
    return c.json({ error: 'Stop not found' }, 404);
  }

  // Atomic: delete, re-compact positions, null point travel_mode at pos 0, touch map
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM stops WHERE id = ?').bind(stopId),
    c.env.DB.prepare(
      'UPDATE stops SET position = position - 1 WHERE map_id = ? AND position > ?',
    ).bind(result.map.id, stop.position),
    c.env.DB.prepare(
      "UPDATE stops SET travel_mode = NULL WHERE map_id = ? AND position = 0 AND type = 'point'",
    ).bind(result.map.id),
    c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
      .bind(now, result.map.id),
  ]);

  return c.json({ success: true });
});

export default maps;
