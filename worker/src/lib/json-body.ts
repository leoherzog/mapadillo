/**
 * Request body parsing shared by the JSON route handlers.
 */

import type { Context } from 'hono';

/**
 * Parse the request body as a JSON object or array.
 * On malformed JSON or a non-object body, sets a 400 on `c.res` and returns null; callers `return c.res`.
 */
export async function readJsonBody<T extends object>(c: Context): Promise<T | null> {
  try {
    const body: unknown = await c.req.json();
    if (body !== null && typeof body === 'object') return body as T;
  } catch {
    // Fall through to the 400 below.
  }
  c.res = c.json({ error: 'Invalid JSON body' }, 400);
  return null;
}
