/**
 * Stryker base config for XActions.
 *
 * Per-module configs (stryker.{module}.config.js) override `mutate` and `testFiles`
 * for focused mutation runs. Run with:
 *   npx stryker run                           # uses this base config
 *   npx stryker run stryker.{module}.config.js
 *
 * XActions P0 modules (gate applies): session/cookie handling, rate-limit guards,
 * billing/payments, data integrity, MCP tool contracts.
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
    'src/**/*.js',
    '!src/**/__mocks__/**',
    '!src/**/*.test.js',
    '!archive/**',
  ],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 60 },
  timeoutMS: 60000,
  concurrency: 2,
  cleanTempDir: true,
  ignoreStatic: true,
};
