/**
 * User preferences routes — GET + PUT /api/user/preferences
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { VALID_UNITS, type Units } from '../../../shared/units.js';
import { readJsonBody } from '../lib/json-body.js';

const prefs = new Hono<AppEnv>();

/** GET /api/user/preferences — return current user preferences; units is null until first set */
prefs.get('/preferences', async (c) => {
  const user = c.get('user')!;
  const row = await c.env.DB.prepare('SELECT units FROM "user" WHERE id = ?')
    .bind(user.id)
    .first<{ units: Units | null }>();

  return c.json({ units: row?.units ?? null });
});

/** PUT /api/user/preferences — update user preferences and return the stored values */
prefs.put('/preferences', async (c) => {
  const user = c.get('user')!;

  const body = await readJsonBody<{ units?: string }>(c);
  if (!body) return c.res;

  if (body.units !== undefined && !VALID_UNITS.has(body.units)) {
    return c.json({ error: 'Invalid units — must be "km" or "mi"' }, 400);
  }

  const row = body.units === undefined
    ? await c.env.DB.prepare('SELECT units FROM "user" WHERE id = ?')
      .bind(user.id)
      .first<{ units: Units | null }>()
    : await c.env.DB.prepare('UPDATE "user" SET units = ? WHERE id = ? RETURNING units')
      .bind(body.units, user.id)
      .first<{ units: Units | null }>();

  return c.json({ units: row?.units ?? null });
});

export default prefs;
