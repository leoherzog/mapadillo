/**
 * Hono middleware — optional authenticated session.
 *
 * Like requireAuth but does not return 401 if no session is present.
 * Sets user on context if a valid session exists, otherwise continues
 * without setting user (c.get('user') will be undefined).
 */

import { createMiddleware } from 'hono/factory';
import { getAuth } from '../auth.js';
import type { AppEnv } from '../types.js';

export const optionalAuth = createMiddleware<AppEnv>(async (c, next) => {
  const auth = getAuth(c.env);
  let session;
  try {
    session = await auth!.api.getSession({
      headers: c.req.raw.headers,
    });
  } catch {
    // D1 unavailable or malformed token — continue without user.
    await next();
    return;
  }

  if (session) {
    c.set('user', session.user);
  }
  await next();
});
