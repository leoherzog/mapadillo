/**
 * User preferences routes — GET + PUT /api/user/preferences
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { VALID_UNITS } from '../../../shared/units.js';

const prefs = new Hono<AppEnv>();

/** GET /api/user/preferences — return current user preferences */
prefs.get('/preferences', async (c) => {
  const user = c.get('user')!;
  const row = await c.env.DB.prepare('SELECT units FROM "user" WHERE id = ?')
    .bind(user.id)
    .first<{ units: string }>();

  return c.json({ units: row?.units ?? 'km' });
});

/** PUT /api/user/preferences — update user preferences */
prefs.put('/preferences', async (c) => {
  const user = c.get('user')!;

  let body: { units?: string };
  try {
    body = await c.req.json<{ units?: string }>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.units !== undefined) {
    if (!VALID_UNITS.has(body.units)) {
      return c.json({ error: 'Invalid units — must be "km" or "mi"' }, 400);
    }
    await c.env.DB.prepare('UPDATE "user" SET units = ? WHERE id = ?')
      .bind(body.units, user.id)
      .run();
  }

  // Always return the current stored value
  const row = await c.env.DB.prepare('SELECT units FROM "user" WHERE id = ?')
    .bind(user.id)
    .first<{ units: string }>();

  return c.json({ units: row?.units ?? 'km' });
});

export default prefs;
