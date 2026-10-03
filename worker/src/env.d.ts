/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { Env as AppEnv } from './types.js';

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      /** D1 migrations read by vitest.config.ts; test-only binding. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
