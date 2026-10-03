/**
 * Shared types for the Cloudflare Worker app.
 */

import type { SessionUser } from '../../shared/types.js';

/** Bindings and secrets, generated into worker-configuration.d.ts by `npm run types`. */
export type Env = Cloudflare.Env;

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user?: SessionUser;
  };
};
