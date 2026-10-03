/**
 * Maps + Stops CRUD routes.
 *
 * Mounted at /api/maps — most routes require requireAuth,
 * GET /:id uses optionalAuth for public map viewing.
 */

import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types.js';
import type { MapData, StopRow, MapRole } from '../../../shared/types.js';
import { canEditRole, rowToStop } from '../../../shared/types.js';
import { VALID_ICONS } from '../../../shared/icons.js';
import { isTravelMode } from '../../../shared/travel-modes.js';
import { readJsonBody } from '../lib/json-body.js';

// ── Value checkers ───────────────────────────────────────────────────────────
// Each returns an error message for an invalid present value, or null.
// Required, absent and null handling stays with the calling handler.

function lengthError(field: string, value: string, max: number): string | null {
  return value.trim().length > max ? `${field} must be ${max} characters or fewer` : null;
}

function latError(field: string, value: number): string | null {
  return isFinite(value) && value >= -90 && value <= 90
    ? null
    : `${field} must be a finite number between -90 and 90`;
}

function lngError(field: string, value: number): string | null {
  return isFinite(value) && value >= -180 && value <= 180
    ? null
    : `${field} must be a finite number between -180 and 180`;
}

function enumError(field: string, value: unknown, allowed: ReadonlySet<string>): string | null {
  return allowed.has(value as string) ? null : `Invalid ${field}: ${value}`;
}

// ── Role-based access control ────────────────────────────────────────────────

export async function getMapWithRole(
  db: D1Database,
  mapId: string,
  userId: string | null,
): Promise<{ map: MapData; role: MapRole } | null> {
  const map = await db.prepare('SELECT * FROM maps WHERE id = ?')
    .bind(mapId)
    .first<MapData>();
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

/**
 * Load the map named by route param `param` for the signed-in user and require `minRole`.
 * On failure sets `c.res` and returns null: 404 for a missing map, 403 for too low a role.
 * `hideForbidden` answers both with the same 404 so the response does not reveal the map exists.
 */
export async function requireMapRole(
  c: Context<AppEnv>,
  minRole: 'owner' | 'editor',
  { param = 'id', hideForbidden = false }: { param?: string; hideForbidden?: boolean } = {},
): Promise<{ map: MapData; role: MapRole } | null> {
  const result = await getMapWithRole(c.env.DB, c.req.param(param)!, c.get('user')!.id);
  const allowed = result && (minRole === 'owner' ? result.role === 'owner' : canEditRole(result.role));
  if (allowed) return result;
  if (hideForbidden) {
    c.res = c.json({ error: 'Not found or forbidden' }, 404);
  } else {
    c.res = result ? c.json({ error: 'Forbidden' }, 403) : c.json({ error: 'Map not found' }, 404);
  }
  return null;
}

/** Prepared statement to bump map updated_at. */
function touchMapStmt(db: D1Database, mapId: string, now: string): D1PreparedStatement {
  return db.prepare('UPDATE maps SET updated_at = ? WHERE id = ?').bind(now, mapId);
}

/** Prepared statement inserting every column of a stop row. */
export function insertStopStmt(db: D1Database, row: StopRow): D1PreparedStatement {
  return db.prepare(
    'INSERT INTO stops (id, map_id, position, type, name, label, latitude, longitude, icon, travel_mode, dest_name, dest_latitude, dest_longitude, dest_icon, route_geometry, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    row.id, row.map_id, row.position, row.type, row.name, row.label,
    row.latitude, row.longitude, row.icon, row.travel_mode,
    row.dest_name, row.dest_latitude, row.dest_longitude, row.dest_icon,
    row.route_geometry, row.created_at,
  );
}

// ── Sub-app ──────────────────────────────────────────────────────────────────

const maps = new Hono<AppEnv>();

// POST / — create map
maps.post('/', async (c) => {
  const body = await readJsonBody<{ name?: string; family_name?: string }>(c);
  if (!body) return c.res;
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  if (body.name.trim().length > 200) {
    return c.json({ error: 'name must be 200 characters or fewer' }, 400);
  }
  if (body.family_name && typeof body.family_name === 'string' && body.family_name.trim().length > 200) {
    return c.json({ error: 'family_name must be 200 characters or fewer' }, 400);
  }

  const id = crypto.randomUUID();
  const userId = c.get('user')!.id;
  const now = new Date().toISOString();

  const name = body.name.trim();
  const familyName = body.family_name?.trim() ?? null;

  await c.env.DB.prepare(
    'INSERT INTO maps (id, owner_id, name, family_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(id, userId, name, familyName, now, now).run();

  const map: MapData = {
    id, owner_id: userId, name, family_name: familyName,
    visibility: 'private', export_settings: '{}',
    created_at: now, updated_at: now,
  };
  return c.json(map, 201);
});

// GET / — list maps for current user (owned + shared)
maps.get('/', async (c) => {
  const userId = c.get('user')!.id;

  // Fetch owned maps
  const ownedRows = await c.env.DB.prepare(
    'SELECT * FROM maps WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 100',
  ).bind(userId).all<MapData>();

  // Fetch shared maps
  const sharedRows = await c.env.DB.prepare(
    `SELECT m.*, ms.role AS share_role
     FROM map_shares ms
     JOIN maps m ON ms.map_id = m.id
     WHERE ms.user_id = ?
     ORDER BY m.updated_at DESC
     LIMIT 100`,
  ).bind(userId).all<MapData & { share_role: string }>();

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
    c.env.DB.prepare('SELECT id, map_id, position, type, name, label, latitude, longitude, icon, travel_mode, dest_name, dest_latitude, dest_longitude, dest_icon, route_geometry, created_at FROM stops WHERE map_id = ? ORDER BY position').bind(map.id),
  );
  const stopResults = await c.env.DB.batch(stopStmts);

  const mapsWithStops = allMaps.map((map, i) => ({
    ...map,
    stops: (stopResults[i] as D1Result<StopRow>).results.map(rowToStop),
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

  return c.json({ ...result.map, role: result.role, stops: stops.results.map(rowToStop) });
});

// PUT /:id — update map (owner or editor)
maps.put('/:id', async (c) => {
  const result = await requireMapRole(c, 'editor');
  if (!result) return c.res;

  const body = await readJsonBody<Record<string, unknown>>(c);
  if (!body) return c.res;

  // Column values as stored; the SQL and the response are both derived from this.
  const patch: Partial<Pick<MapData, 'name' | 'family_name' | 'export_settings'>> = {};

  if ('name' in body) {
    const name = body.name;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return c.json({ error: 'name cannot be empty' }, 400);
    }
    const error = lengthError('name', name, 200);
    if (error) return c.json({ error }, 400);
    patch.name = name.trim();
  }
  if ('family_name' in body) {
    const familyName = body.family_name;
    if (typeof familyName === 'string') {
      const error = lengthError('family_name', familyName, 200);
      if (error) return c.json({ error }, 400);
    }
    patch.family_name = typeof familyName === 'string' ? familyName.trim() : familyName as null;
  }
  if ('export_settings' in body) {
    let val = body.export_settings;
    if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
    if (typeof val !== 'string') {
      return c.json({ error: 'export_settings must be a string or object' }, 400);
    }
    if (val.length > 10_000) {
      return c.json({ error: 'export_settings is too large' }, 400);
    }
    // Validate that it's well-formed JSON (or the sentinel empty-object).
    if (val !== '' && val !== '{}') {
      try {
        const parsed = JSON.parse(val);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return c.json({ error: 'export_settings must be a JSON object' }, 400);
        }
      } catch {
        return c.json({ error: 'export_settings must be valid JSON' }, 400);
      }
    }
    patch.export_settings = val;
  }

  const entries = Object.entries(patch);
  if (entries.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  const now = new Date().toISOString();
  const [, stopsResult] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE maps SET ${entries.map(([column]) => `${column} = ?, `).join('')}updated_at = ? WHERE id = ?`,
    ).bind(...entries.map(([, value]) => value), now, result.map.id),
    c.env.DB.prepare(
      'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
    ).bind(result.map.id),
  ]);

  return c.json({
    ...result.map,
    ...patch,
    updated_at: now,
    stops: (stopsResult as D1Result<StopRow>).results.map(rowToStop),
  });
});

// DELETE /:id — delete map (owner only)
//
// FK enforcement note: D1 does not reliably honour `PRAGMA foreign_keys = ON`
// per-connection, so the `ON DELETE CASCADE` / `ON DELETE RESTRICT` hints in
// the schema are advisory only. This handler emulates them explicitly:
//   • orders   → RESTRICT: refuse to delete if any order references the map.
//   • stops    → CASCADE:  delete rows explicitly.
//   • map_shares → CASCADE: delete rows explicitly.
maps.delete('/:id', async (c) => {
  const result = await requireMapRole(c, 'owner');
  if (!result) return c.res;

  // RESTRICT emulation: orders are financial records and must survive.
  const orderCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM orders WHERE map_id = ?',
  ).bind(result.map.id).first<{ count: number }>();
  if ((orderCount?.count ?? 0) > 0) {
    return c.json(
      { error: 'Cannot delete a map with existing orders. Cancel or archive orders first.' },
      409,
    );
  }

  // CASCADE emulation: remove child rows, then the map itself, atomically.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM stops WHERE map_id = ?').bind(result.map.id),
    c.env.DB.prepare('DELETE FROM map_shares WHERE map_id = ?').bind(result.map.id),
    c.env.DB.prepare('DELETE FROM maps WHERE id = ?').bind(result.map.id),
  ]);
  return c.json({ success: true });
});

// PUT /:id/stops/reorder — MUST be before /:id/stops/:stopId
maps.put('/:id/stops/reorder', async (c) => {
  const result = await requireMapRole(c, 'editor');
  if (!result) return c.res;

  const body = await readJsonBody<{ order?: string[] }>(c);
  if (!body) return c.res;
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

  // Include updated_at in the same atomic batch
  stmts.push(touchMapStmt(c.env.DB, result.map.id, new Date().toISOString()));

  await c.env.DB.batch(stmts);

  const stops = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE map_id = ? ORDER BY position',
  ).bind(result.map.id).all<StopRow>();

  return c.json(stops.results.map(rowToStop));
});

// POST /:id/stops — add stop (owner or editor)
maps.post('/:id/stops', async (c) => {
  const result = await requireMapRole(c, 'editor');
  if (!result) return c.res;

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
    dest_icon?: string;
  };
  const body = await readJsonBody<StopBody>(c);
  if (!body) return c.res;

  const type = body.type ?? 'point';
  if (type !== 'point' && type !== 'route') {
    return c.json({ error: `Invalid type: ${type}` }, 400);
  }
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  const lengthErr = lengthError('name', body.name, 200)
    ?? (typeof body.label === 'string' ? lengthError('label', body.label, 500) : null)
    ?? (typeof body.dest_name === 'string' ? lengthError('dest_name', body.dest_name, 200) : null);
  if (lengthErr) return c.json({ error: lengthErr }, 400);
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return c.json({ error: 'lat and lng are required numbers' }, 400);
  }
  // Falsy icon, dest_icon and travel_mode count as absent.
  const valueErr = latError('lat', body.lat)
    ?? lngError('lng', body.lng)
    ?? (body.icon ? enumError('icon', body.icon, VALID_ICONS) : null)
    ?? (body.dest_icon ? enumError('dest_icon', body.dest_icon, VALID_ICONS) : null)
    ?? (body.travel_mode && !isTravelMode(body.travel_mode) ? `Invalid travel_mode: ${body.travel_mode}` : null);
  if (valueErr) return c.json({ error: valueErr }, 400);

  // travel_mode and dest_* are only allowed on routes
  if (type === 'point' && body.travel_mode) {
    return c.json({ error: 'Points cannot have a travel_mode' }, 400);
  }

  if (type === 'point' && (body.dest_lat != null || body.dest_lng != null || body.dest_name != null)) {
    return c.json({ error: 'Points cannot have destination fields' }, 400);
  }
  if (body.dest_lat != null && typeof body.dest_lat !== 'number') {
    return c.json({ error: 'dest_lat must be a number' }, 400);
  }
  if (body.dest_lng != null && typeof body.dest_lng !== 'number') {
    return c.json({ error: 'dest_lng must be a number' }, 400);
  }
  const destErr = (typeof body.dest_lat === 'number' ? latError('dest_lat', body.dest_lat) : null)
    ?? (typeof body.dest_lng === 'number' ? lngError('dest_lng', body.dest_lng) : null);
  if (destErr) return c.json({ error: destErr }, 400);

  // Enforce per-map stop limit + auto-increment position in one batch
  const [countResult, maxPosResult] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM stops WHERE map_id = ?').bind(result.map.id),
    c.env.DB.prepare('SELECT COALESCE(MAX(position), -1) as max_pos FROM stops WHERE map_id = ?').bind(result.map.id),
  ]);
  const count = (countResult as D1Result<{ count: number }>).results[0]?.count ?? 0;
  if (count >= 200) {
    return c.json({ error: 'Maximum 200 stops per map' }, 400);
  }
  const position = ((maxPosResult as D1Result<{ max_pos: number }>).results[0]?.max_pos ?? -1) + 1;

  const now = new Date().toISOString();
  const row: StopRow = {
    id: crypto.randomUUID(),
    map_id: result.map.id,
    position,
    type,
    name: body.name.trim(),
    label: body.label?.trim() ?? null,
    latitude: body.lat,
    longitude: body.lng,
    icon: body.icon ?? null,
    travel_mode: type === 'route' ? (isTravelMode(body.travel_mode) ? body.travel_mode : 'drive') : null,
    dest_name: body.dest_name?.trim() ?? null,
    dest_latitude: body.dest_lat ?? null,
    dest_longitude: body.dest_lng ?? null,
    dest_icon: body.dest_icon ?? null,
    route_geometry: null,
    created_at: now,
  };

  await c.env.DB.batch([
    insertStopStmt(c.env.DB, row),
    touchMapStmt(c.env.DB, result.map.id, now),
  ]);

  return c.json(rowToStop(row), 201);
});

// PUT /:id/stops/:stopId — update stop (owner or editor)
maps.put('/:id/stops/:stopId', async (c) => {
  const result = await requireMapRole(c, 'editor');
  if (!result) return c.res;

  const stopId = c.req.param('stopId');
  const stop = await c.env.DB.prepare(
    'SELECT * FROM stops WHERE id = ? AND map_id = ?',
  ).bind(stopId, result.map.id).first<StopRow>();

  if (!stop) {
    return c.json({ error: 'Stop not found' }, 404);
  }

  const body = await readJsonBody<Record<string, unknown>>(c);
  if (!body) return c.res;

  // Column values as stored; null clears a nullable field.
  // The SQL and the response (no re-SELECT) are both derived from this.
  const patch: Partial<StopRow> = {};

  if ('name' in body) {
    const name = body.name;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return c.json({ error: 'name cannot be empty' }, 400);
    }
    const error = lengthError('name', name, 200);
    if (error) return c.json({ error }, 400);
    patch.name = name.trim();
  }
  if ('label' in body) {
    const label = body.label;
    if (label !== null && typeof label !== 'string') {
      return c.json({ error: 'label must be a string or null' }, 400);
    }
    if (typeof label === 'string') {
      const error = lengthError('label', label, 500);
      if (error) return c.json({ error }, 400);
    }
    patch.label = typeof label === 'string' ? label.trim() : null;
  }
  if ('lat' in body) {
    if (typeof body.lat !== 'number') return c.json({ error: 'lat must be a number' }, 400);
    const error = latError('lat', body.lat);
    if (error) return c.json({ error }, 400);
    patch.latitude = body.lat;
  }
  if ('lng' in body) {
    if (typeof body.lng !== 'number') return c.json({ error: 'lng must be a number' }, 400);
    const error = lngError('lng', body.lng);
    if (error) return c.json({ error }, 400);
    patch.longitude = body.lng;
  }
  if ('icon' in body) {
    const error = body.icon === null ? null : enumError('icon', body.icon, VALID_ICONS);
    if (error) return c.json({ error }, 400);
    patch.icon = body.icon as string | null;
  }
  if ('dest_icon' in body) {
    const error = body.dest_icon === null ? null : enumError('dest_icon', body.dest_icon, VALID_ICONS);
    if (error) return c.json({ error }, 400);
    patch.dest_icon = body.dest_icon as string | null;
  }
  if ('travel_mode' in body) {
    const travelMode = body.travel_mode;
    if (travelMode !== null && !isTravelMode(travelMode)) {
      return c.json({ error: `Invalid travel_mode: ${travelMode}` }, 400);
    }
    if (stop.type === 'point' && travelMode !== null) {
      return c.json({ error: 'Points cannot have a travel_mode' }, 400);
    }
    patch.travel_mode = travelMode;
  }
  if ('type' in body) {
    return c.json({ error: 'type cannot be changed after creation' }, 400);
  }
  if ('dest_name' in body) {
    const destName = body.dest_name;
    if (destName !== null && typeof destName !== 'string') {
      return c.json({ error: 'dest_name must be a string or null' }, 400);
    }
    if (typeof destName === 'string') {
      const error = lengthError('dest_name', destName, 200);
      if (error) return c.json({ error }, 400);
    }
    patch.dest_name = typeof destName === 'string' ? destName.trim() : null;
  }
  if ('dest_lat' in body) {
    const destLat = body.dest_lat;
    if (destLat !== null && typeof destLat !== 'number') {
      return c.json({ error: 'dest_lat must be a number' }, 400);
    }
    const error = destLat === null ? null : latError('dest_lat', destLat);
    if (error) return c.json({ error }, 400);
    patch.dest_latitude = destLat;
  }
  if ('dest_lng' in body) {
    const destLng = body.dest_lng;
    if (destLng !== null && typeof destLng !== 'number') {
      return c.json({ error: 'dest_lng must be a number' }, 400);
    }
    const error = destLng === null ? null : lngError('dest_lng', destLng);
    if (error) return c.json({ error }, 400);
    patch.dest_longitude = destLng;
  }
  if ('route_geometry' in body) {
    const geometry = body.route_geometry;
    if (geometry !== null && typeof geometry !== 'string') {
      return c.json({ error: 'route_geometry must be a string or null' }, 400);
    }
    if (typeof geometry === 'string' && geometry.length > 1_048_576) {
      return c.json({ error: 'route_geometry is too large' }, 400);
    }
    patch.route_geometry = geometry;
  } else if (['lat', 'lng', 'dest_lat', 'dest_lng', 'travel_mode'].some((f) => f in body)) {
    // Coordinate or travel_mode changes invalidate cached geometry.
    patch.route_geometry = null;
  }

  const entries = Object.entries(patch);
  if (entries.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE stops SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
    ).bind(...entries.map(([, value]) => value), stopId),
    touchMapStmt(c.env.DB, result.map.id, now),
  ]);

  return c.json(rowToStop({ ...stop, ...patch }));
});

// DELETE /:id/stops/:stopId — delete stop (owner or editor)
maps.delete('/:id/stops/:stopId', async (c) => {
  const result = await requireMapRole(c, 'editor');
  if (!result) return c.res;

  const stopId = c.req.param('stopId');
  const stop = await c.env.DB.prepare(
    'SELECT position FROM stops WHERE id = ? AND map_id = ?',
  ).bind(stopId, result.map.id).first<{ position: number }>();

  if (!stop) {
    return c.json({ error: 'Stop not found' }, 404);
  }

  // Atomic: delete, re-compact positions, touch map
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM stops WHERE id = ?').bind(stopId),
    c.env.DB.prepare(
      'UPDATE stops SET position = position - 1 WHERE map_id = ? AND position > ?',
    ).bind(result.map.id, stop.position),
    touchMapStmt(c.env.DB, result.map.id, now),
  ]);

  return c.json({ success: true });
});

export default maps;
