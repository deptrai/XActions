/**
 * Stryker config for facebookScheduler.js — P0 scheduled post module.
 *
 * Run: npx stryker run stryker.fb-scheduler.config.js
 *
 * P0 areas: node-cron scheduling, throughput cap (≤5/hour), crash recovery.
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
  mutate: ['api/services/facebookScheduler.js'],
  testFiles: [
    'tests/services/facebook-schedule-edge.test.js',
    'tests/services/facebook-schedule.test.js',
  ],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 60 },
  timeoutMS: 60000,
  concurrency: 2,
  cleanTempDir: true,
  ignoreStatic: true,
};
