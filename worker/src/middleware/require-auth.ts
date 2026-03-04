/**
 * Hono middleware — require authenticated session.
 *
 * Validates the session cookie via Better Auth, attaches user + session
 * to the Hono context, or returns 401.
 */

import { createMiddleware } from 'hono/factory';
import { getAuth } from '../auth.js';
import type { AppEnv } from '../types.js';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth(c.env);
  let session;
  try {
    session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });
  } catch {
    // D1 unavailable or malformed token — treat as unauthenticated.
    // Don't leak internal error details to the client.
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('user', session.user);
  await next();
});
