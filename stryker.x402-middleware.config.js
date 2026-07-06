/**
 * Stryker config for x402 payment middleware — P0 billing module.
 *
 * Run: npx stryker run stryker.x402-middleware.config.js
 *
 * P0 areas: payment verification, credit deduction, idempotency, error handling.
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
  mutate: ['api/middleware/x402.js'],
  testFiles: ['tests/x402-middleware-real.test.js'],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 60 },
  timeoutMS: 60000,
  concurrency: 2,
  cleanTempDir: true,
  ignoreStatic: true,
};
