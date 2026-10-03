import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./src/db/migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          // Applied to D1 by applyTestSchema in src/test-helpers.ts.
          TEST_MIGRATIONS: migrations,
          // Test-only secrets — never used in production
          BETTER_AUTH_SECRET: 'test-secret-at-least-32-chars-for-better-auth',
          BETTER_AUTH_URL: 'http://localhost',
          GOOGLE_CLIENT_ID: 'test-google-client-id',
          GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
          FACEBOOK_CLIENT_ID: 'test-facebook-client-id',
          FACEBOOK_CLIENT_SECRET: 'test-facebook-client-secret',
          STRIPE_SECRET_KEY: 'test-stripe-key',
          STRIPE_WEBHOOK_SECRET: 'test-stripe-webhook-secret',
          PRODIGI_API_KEY: 'test-prodigi-key',
          PRODIGI_SANDBOX: 'true',
          ORS_API_KEY: 'test-ors-key',
          ADMIN_SECRET: 'test-admin-secret',
          DISCORD_WEBHOOK_URL: '',
        },
      },
    }),
  ],
  test: {
    // Show handler console output only for failing tests.
    silent: 'passed-only',
    // The Workers pool cannot run v8 coverage, which needs node:inspector.
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-helpers.ts'],
    },
    server: {
      deps: {
        // Bundle CJS deps that break in the workerd ESM runtime.
        // @better-auth/passkey → @simplewebauthn/server → @peculiar/* → tslib
        inline: [
          '@better-auth/passkey',
          '@simplewebauthn/server',
          /^@peculiar\//,
          'tslib',
        ],
      },
    },
  },
});
