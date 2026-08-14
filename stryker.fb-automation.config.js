/**
 * Stryker config for facebookAutomation.js — P0 automation module.
 *
 * Run: npx stryker run stryker.fb-automation.config.js
 *
 * P0 areas: runGuardedBatch rate-limit guard, like/comment/post automation,
 * friend requests, join groups, view boost, account warmup.
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
  mutate: ['api/services/facebookAutomation.js'],
  testFiles: [
    'tests/services/facebook-automation-actions.test.js',
    'tests/services/facebook-automation-batch.test.js',
    'tests/services/facebook-automation.integration.test.js',
    'tests/services/facebook-batch-post-groups-edge.test.js',
    'tests/services/facebook-batch-post-groups.test.js',
    'tests/services/facebook-cancel-friend-requests.test.js',
    'tests/services/facebook-friend-requests.test.js',
    'tests/services/facebook-guarded-batch.test.js',
    'tests/services/facebook-join-groups-edge.test.js',
    'tests/services/facebook-join-groups.test.js',
    'tests/services/facebook-share-edge.test.js',
    'tests/services/facebook-share.test.js',
    'tests/services/facebook-view-boost-edge.test.js',
    'tests/services/facebook-view-boost.test.js',
    'tests/services/facebook-warmup-account.test.js',
    'tests/services/facebookAutomation.findLikeButton.test.js',
  ],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 60 },
  timeoutMS: 60000,
  concurrency: 2,
  cleanTempDir: true,
  ignoreStatic: true,
};
