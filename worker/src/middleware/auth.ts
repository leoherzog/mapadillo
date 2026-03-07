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
    const auth = getAuth(c.env);
    let session;
    try {
      session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
    } catch {
      if (required) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      await next();
      return;
    }

    if (!session) {
      if (required) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      await next();
      return;
    }

    c.set('user', session.user);
    await next();
  });
}

export const requireAuth = authMiddleware(true);
export const optionalAuth = authMiddleware(false);
