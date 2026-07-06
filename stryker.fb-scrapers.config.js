/**
 * Stryker config for facebook scrapers — src/scrapers/facebook/*.js
 *
 * Run: npx stryker run stryker.fb-scrapers.config.js
 *
 * P0 areas: loginWithCookie, loginWithPassword, scrapeProfile, scrapePosts,
 * scrapeFollowers, search, proxy rotation, GraphQL token scraping.
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
    'src/scrapers/facebook/index.js',
    'src/scrapers/facebook/graphql.js',
    'src/scrapers/facebook/messengerQueue.js',
    'src/scrapers/facebook/messengerShare.js',
    'src/scrapers/facebook/proxy.js',
  ],
  testFiles: [
    'tests/scrapers/facebook-auth.test.js',
    'tests/scrapers/facebook-exports.test.js',
    'tests/scrapers/facebook-followers.test.js',
    'tests/scrapers/facebook-graphql.test.js',
    'tests/scrapers/facebook-group-members-edge.test.js',
    'tests/scrapers/facebook-group-members.test.js',
    'tests/scrapers/facebook-live.test.js',
    'tests/scrapers/facebook-messenger-queue.test.js',
    'tests/scrapers/facebook-posts.test.js',
    'tests/scrapers/facebook-profile.test.js',
    'tests/scrapers/facebook-proxy.test.js',
    'tests/scrapers/facebook-search.test.js',
    'tests/scrapers/messengerShare.test.js',
  ],
  reporters: ['clear-text', 'html', 'json'],
  thresholds: { high: 80, low: 60, break: 60 },
  timeoutMS: 60000,
  concurrency: 2,
  cleanTempDir: true,
  ignoreStatic: true,
};
