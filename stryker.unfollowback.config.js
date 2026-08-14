/**
 * Stryker config for src/unfollowback.js — P0 rate-limit/ban-risk module.
 *
 * Run: npx stryker run stryker.unfollowback.config.js
 *
 * P0 areas: rate-limit boundary, max-action cap, session expiry handling.
 * Verdict per bmad-xactions-mutation-gate: FAIL if total < 60% OR p0Survived > 0.
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
  mutate: ['src/unfollowback.js'],
  testFiles: ['tests/http-scraper/relationships.test.js'],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 60 },
  timeoutMS: 60000,
  concurrency: 2,
  cleanTempDir: true,
  ignoreStatic: true,
};
