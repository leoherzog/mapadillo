import { createMiddleware } from 'hono/factory';
import { getAuth } from '../auth.js';
import type { AppEnv } from '../types.js';

/**
 * Auth middleware factory.
 *
 * @param required - If true, returns 401 when no session is found.
 *                   If false, continues without setting user.
 */
function authMiddleware(required: boolean) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const session = await getAuth(c.env)
      .api.getSession({ headers: c.req.raw.headers })
      .catch(() => null);
    if (session) c.set('user', session.user);
    else if (required) return c.json({ error: 'Unauthorized' }, 401);
    await next();
  });
}

export const requireAuth = authMiddleware(true);
export const optionalAuth = authMiddleware(false);
