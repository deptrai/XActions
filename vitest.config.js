import 'dotenv/config';
import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

const testDatabaseUrl =
  process.env.DATABASE_URL_TEST ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5434/xactions_test?schema=public';

import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'apps/web'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
    // Retry once to absorb env-dependent flakiness (live-proxy 503s,
    // rate-limit contention under shuffle) without masking real failures —
    // a deterministic bug still fails on retry.
    retry: 1,
    include: ['tests/**/*.test.js'],
    exclude: [
      'node_modules',
      'dist',
      'archive',
      'tests/e2e/video*.e2e.test.js',
      'tests/e2e/admin-*.e2e.test.js',
      'tests/e2e/dashboard-navigation.e2e.test.js',
      'tests/x402-integration.test.js'
    ],
    reporters: ['verbose'],
    env: {
      DATABASE_URL: testDatabaseUrl,
      DATABASE_URL_TEST: testDatabaseUrl,
      // Story 42.4 — default the Jev challenge-diagnosis hook OFF in tests so
      // validator-flagged 2xx / 0-record mocks never reach the paid Jev API.
      // Tests that exercise the hook inject a fake brain / enable it explicitly.
      JEV_CHALLENGE_DIAG: '0',
      // Story 42.5 — same guard for the OSINT bio matcher: candidate bio pairs
      // in tests must never reach the paid Jev API by accident. Tests exercise
      // it via an injected fake brain + explicit JEV_OSINT_BIO_MATCH=1.
      JEV_OSINT_BIO_MATCH: '0',
      // Story 42.8 — same guard for the cognitive unfollow pass: unfollow
      // candidates in tests must never reach the paid Jev API by accident.
      // Tests exercise it via an injected fake brain / fetch stub + explicit
      // JEV_COGNITIVE_UNFOLLOW=1.
      JEV_COGNITIVE_UNFOLLOW: '0',
      // Story 42.9 — same guard for the post-variant judge: generated
      // tweets/replies in tests must never reach the paid Jev API by
      // accident. Tests exercise it via an injected fake brain + explicit
      // JEV_VARIANT_JUDGE=1.
      JEV_VARIANT_JUDGE: '0',
      // Pin the judge knobs too — the dotenv-loads above pull the dev's real
      // .env, so ambient values would otherwise flip verdicts in tests that
      // exercise the judge via injected brains.
      JEV_THRESHOLD_CRINGE: '0.3',
      JEV_VARIANT_JUDGE_MAX_REROLL: '1',
    },
    sequence: {
      shuffle: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'archive/',
        'scripts/',
        '*.config.js',
      ],
    },
  },
});
