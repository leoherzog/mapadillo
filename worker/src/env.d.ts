/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare global {
  namespace Cloudflare {
    interface Env {
      /** D1 migrations read by vitest.config.ts; test-only binding. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

export {};
