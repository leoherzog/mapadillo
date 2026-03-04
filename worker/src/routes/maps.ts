/**
 * Maps + Stops CRUD routes.
 *
 * Mounted at /api/maps — all routes assume requireAuth has already run,
 * so c.get('user').id is always available.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types.js';

// ── Types matching D1 schema ─────────────────────────────────────────────────

interface MapRow {
  id: string;
  owner_id: string;
  name: string;
  family_name: string | null;
  visibility: string;
  style_preferences: string;
  units: string;
  created_at: string;
  updated_at: string;
}

interface StopRow {
  id: string;
  map_id: string;
  position: number;
  name: string;
  label: string | null;
  latitude: number;
  longitude: number;
  icon: string | null;
  travel_mode: string | null;
  created_at: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const VALID_ICONS = new Set([
  'tree', 'leaf', 'flower', 'compass', 'fire', 'snowflake', 'sun', 'umbrella',
  'utensils', 'mug-hot', 'cake-candles', 'martini-glass', 'fish', 'camera',
  'landmark', 'globe', 'ticket', 'crown', 'house', 'bed', 'star', 'trophy',
  'gift', 'shop', 'paw', 'sparkles', 'plane', 'ship', 'train', 'bus', 'car',
  'suitcase', 'heart', 'anchor', 'circle', 'square', 'circle-check',
  'circle-plus', 'circle-info', 'circle-xmark',
]);

const VALID_TRAVEL_MODES = new Set(['drive', 'walk', 'bike', 'plane', 'boat']);
const VALID_VISIBILITY = new Set(['private', 'public']);
const VALID_UNITS = new Set(['km', 'mi']);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getOwnedMap(
  c: { get: (key: 'user') => { id: string }; env: { DB: D1Database }; json: (data: unknown, status: number) => Response },
  mapId: string,
): Promise<MapRow | Response> {
  const map = await c.env.DB.prepare('SELECT * FROM maps WHERE id = ?')
    .bind(mapId)
    .first<MapRow>();
  if (!map) {
    return c.json({ error: 'Map not found' }, 404);
  }
  if (map.owner_id !== c.get('user').id) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  return map;
}

function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

// ── Sub-app ──────────────────────────────────────────────────────────────────

const maps = new Hono<AppEnv>();

// POST / — create map
maps.post('/', async (c) => {
  const body = await c.req.json<{ name?: string; family_name?: string }>().catch(() => ({}));
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }

  const id = crypto.randomUUID();
  const userId = c.get('user').id;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'INSERT INTO maps (id, owner_id, name, family_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, userId, body.name.trim(), body.family_name?.trim() ?? null, now, now).run();

  const map = await c.env.DB.prepare('SELECT * FROM maps WHERE id = ?').bind(id).first<MapRow>();
  return c.json(map, 201);
});

// GET / — list maps for current user
maps.get('/', async (c) => {
  const userId = c.get('user').id;
  const mapRows = await c.env.DB.prepare(
    'SELECT * FROM maps WHERE owner_id = ? ORDER BY updated_at DESC',
  ).bind(userId).all<MapRow>();

  if (mapRows.results.length === 0) return c.json([]);

  // Batch all stop queries in a single D1 round-trip
  const stopStmts = mapRows.results.map((map) =>
    c.env.DB.prepare('SELECT * FROM stops WHERE map_id = ? ORDER BY position').bind(map.id),
  );
  const stopResults = await c.env.DB.batch(stopStmts);

  const mapsWithStops = mapRows.results.map((map, i) => ({
    ...map,
    stops: (stopResults[i] as D1Result<StopRow>).results,
  }));

  return c.json(mapsWithStops);
});

// GET /:id — get single map with stops
maps.get('/:id', async (c) => {
  const result = await getOwnedMap(c, c.req.param('id'));
  if (isResponse(result)) return result;

  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(result.id).all<StopRow>();

  return c.json({ ...result, stops: stops.results });
});

// PUT /:id — update map
maps.put('/:id', async (c) => {
  const result = await getOwnedMap(c, c.req.param('id'));
  if (isResponse(result)) return result;

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));

  const allowed = ['name', 'family_name', 'visibility', 'style_preferences', 'units'] as const;
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
      }
      if (key === 'visibility' && !VALID_VISIBILITY.has(val as string)) {
        return c.json({ error: 'visibility must be "private" or "public"' }, 400);
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
  values.push(result.id);

  await c.env.DB.prepare(
    `UPDATE maps SET ${updates.join(', ')} WHERE id = ?`,
  ).bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM maps WHERE id = ?')
    .bind(result.id).first<MapRow>();
  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(result.id).all<StopRow>();

  return c.json({ ...updated, stops: stops.results });
});

// DELETE /:id — delete map (cascade deletes stops)
maps.delete('/:id', async (c) => {
  const result = await getOwnedMap(c, c.req.param('id'));
  if (isResponse(result)) return result;

  await c.env.DB.prepare('DELETE FROM maps WHERE id = ?').bind(result.id).run();
  return c.json({ success: true });
});

// PUT /:id/stops/reorder — MUST be before /:id/stops/:stopId
maps.put('/:id/stops/reorder', async (c) => {
  const result = await getOwnedMap(c, c.req.param('id'));
  if (isResponse(result)) return result;

  const body = await c.req.json<{ order?: string[] }>().catch(() => ({}));
  if (!body.order || !Array.isArray(body.order)) {
    return c.json({ error: 'order must be an array of stop IDs' }, 400);
  }
  if (new Set(body.order).size !== body.order.length) {
    return c.json({ error: 'order must not contain duplicate stop IDs' }, 400);
  }

  // Verify all stop IDs belong to this map
  const existing = await c.env.DB.prepare(
    'SELECT id FROM stops WHERE map_id = ?',
  ).bind(result.id).all<{ id: string }>();

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

  // Null travel_mode for the new first stop
  if (body.order.length > 0) {
    stmts.push(
      c.env.DB.prepare('UPDATE stops SET travel_mode = NULL WHERE id = ?').bind(body.order[0]),
    );
  }

  // Include updated_at in the same atomic batch
  stmts.push(
    c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), result.id),
  );

  await c.env.DB.batch(stmts);

  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(result.id).all<StopRow>();

  return c.json(stops.results);
});

// POST /:id/stops — add stop
maps.post('/:id/stops', async (c) => {
  const result = await getOwnedMap(c, c.req.param('id'));
  if (isResponse(result)) return result;

  const body = await c.req.json<{
    name?: string;
    lat?: number;
    lng?: number;
    label?: string;
    icon?: string;
    travel_mode?: string;
  }>().catch(() => ({}));

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return c.json({ error: 'lat and lng are required numbers' }, 400);
  }
  if (body.icon && !VALID_ICONS.has(body.icon)) {
    return c.json({ error: `Invalid icon: ${body.icon}` }, 400);
  }
  if (body.travel_mode && !VALID_TRAVEL_MODES.has(body.travel_mode)) {
    return c.json({ error: `Invalid travel_mode: ${body.travel_mode}` }, 400);
  }

  // Auto-increment position
  const maxPos = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(position), -1) as max_pos FROM stops WHERE map_id = ?',
  ).bind(result.id).first<{ max_pos: number }>();
  const position = (maxPos?.max_pos ?? -1) + 1;

  // Force travel_mode = null for first stop
  const travelMode = position === 0 ? null : (body.travel_mode ?? null);

  const stopId = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO stops (id, map_id, position, name, label, latitude, longitude, icon, travel_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    stopId, result.id, position, body.name.trim(), body.label?.trim() ?? null,
    body.lat, body.lng, body.icon ?? null, travelMode,
  ).run();

  // Update map's updated_at
  await c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), result.id).run();

  const stop = await c.env.DB.prepare('SELECT * FROM stops WHERE id = ?')
    .bind(stopId).first<StopRow>();
  return c.json(stop, 201);
});

// PUT /:id/stops/:stopId — update stop
maps.put('/:id/stops/:stopId', async (c) => {
  const result = await getOwnedMap(c, c.req.param('id'));
  if (isResponse(result)) return result;

  const stopId = c.req.param('stopId');
  const stop = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE id = ? AND map_id = ?',
  ).bind(stopId, result.id).first<StopRow>();

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
    updates.push('name = ?');
    values.push((body.name as string).trim());
  }
  if ('label' in body) {
    updates.push('label = ?');
    values.push(body.label ?? null);
  }
  if ('lat' in body) {
    if (typeof body.lat !== 'number') return c.json({ error: 'lat must be a number' }, 400);
    updates.push('latitude = ?');
    values.push(body.lat);
  }
  if ('lng' in body) {
    if (typeof body.lng !== 'number') return c.json({ error: 'lng must be a number' }, 400);
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
    // Cannot set travel_mode on first stop
    if (stop.position === 0 && body.travel_mode !== null) {
      return c.json({ error: 'First stop cannot have a travel_mode' }, 400);
    }
    updates.push('travel_mode = ?');
    values.push(body.travel_mode ?? null);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  values.push(stopId);
  await c.env.DB.prepare(
    `UPDATE stops SET ${updates.join(', ')} WHERE id = ?`,
  ).bind(...values).run();

  // Update map's updated_at
  await c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), result.id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM stops WHERE id = ?')
    .bind(stopId).first<StopRow>();
  return c.json(updated);
});

// DELETE /:id/stops/:stopId — delete stop
maps.delete('/:id/stops/:stopId', async (c) => {
  const result = await getOwnedMap(c, c.req.param('id'));
  if (isResponse(result)) return result;

  const stopId = c.req.param('stopId');
  const stop = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE id = ? AND map_id = ?',
  ).bind(stopId, result.id).first<StopRow>();

  if (!stop) {
    return c.json({ error: 'Stop not found' }, 404);
  }

  // Atomic: delete, re-compact positions, null first stop's travel_mode, touch map
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM stops WHERE id = ?').bind(stopId),
    c.env.DB.prepare(
      'UPDATE stops SET position = position - 1 WHERE map_id = ? AND position > ?',
    ).bind(result.id, stop.position),
    c.env.DB.prepare(
      'UPDATE stops SET travel_mode = NULL WHERE map_id = ? AND position = 0',
    ).bind(result.id),
    c.env.DB.prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
      .bind(now, result.id),
  ]);

  return c.json({ success: true });
});

export default maps;
