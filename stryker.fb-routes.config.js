/**
 * Stryker config for Facebook routes — api/routes/facebook.js + facebookAccounts.js
 *
 * Run: npx stryker run stryker.fb-routes.config.js
 *
 * P0 areas: auth guard, dry-run default, account encryption (AES-256-GCM).
 *
 * @type {import('@stryker-mutator/core/core/StrykerOptions').StrykerOptions}
 */
export default {
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.js',
    related: false,
  },
  coverageAnalysis: 'perTest',
  mutate: [
    'api/routes/facebook.js',
    'api/routes/facebookAccounts.js',
  ],
  testFiles: [
    'tests/api/facebook-accounts.test.js',
    'tests/api/facebook-automate-routes.test.js',
    'tests/e2e/api-facebook.test.js',
  ],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 60 },
  timeoutMS: 60000,
  concurrency: 2,
  cleanTempDir: true,
  ignoreStatic: true,
};
