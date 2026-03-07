import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { AppEnv, Env } from '../types.js';

/** Binding names whose value is a RateLimit. */
type RateLimitBindings = {
  [K in keyof Env as Env[K] extends RateLimit ? K : never]: true;
};

/**
 * Factory that returns a Hono middleware enforcing a per-key rate limit.
 *
 * @param binding   - Name of the RateLimit binding on Env (e.g. 'RATE_LIMITER_PROXY')
 * @param keyFn     - Derives the rate-limit key from the context (e.g. user id, IP)
 */
export function rateLimit(
  binding: keyof RateLimitBindings,
  keyFn: (c: Context<AppEnv>) => string,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const limiter = c.env[binding] as RateLimit;
    const { success } = await limiter.limit({ key: keyFn(c) });
    if (!success) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
  });
}
