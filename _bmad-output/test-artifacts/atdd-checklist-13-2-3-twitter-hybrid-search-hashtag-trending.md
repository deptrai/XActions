# ATDD Red-Phase Checklist — Story 13.2.3

Story: **Story 13.2.3 — Twitter Hybrid Search, Hashtag & Trending**  
Epic: **Epic 13 — High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)**  
Baseline Commit: `b6be3218`  
Branch: `worktree-bmad-testarch-atdd-13-2-3`

---

## 1. Acceptance Criteria Checklist

- [ ] **AC-1: Register `search`, `hashtag`, `trending` actions in `TwitterCrawler`**
  - [ ] `TwitterCrawler` inherits `AbstractCrawler` (`name: 'twitter'`, `platform: 'twitter'`).
  - [ ] Action `search` registered with `requiredArgs: ['query']` and optional args for filters, pagination, time window, engagement, language.
  - [ ] Action `hashtag` registered with `requiredArgs: ['hashtag']` and optional args for filter/limit/cursor.
  - [ ] Action `trending` registered with no required args and optional `woeid`, `limit`.
  - [ ] `requiresAuth: false` by default for all three actions; opt-in `accountId` still respected.
  - [ ] `listActions()` resolves all three actions and `ActionDescriptor` shapes are correct.

- [ ] **AC-2: `search` handler via GraphQL SearchTimeline with advanced query composition**
  - [ ] `crawler.start({ action: 'search', args: { query, filter: 'Latest', since, until, from, to, minLikes, minRetweets, lang, limit, cursor } })` dispatches `SearchTimeline` GraphQL.
  - [ ] `rawQuery` is built by merging `query` with advanced operators (`from:`, `since:`, `until:`, `min_faves:`, `min_retweets:`, `lang:`, `filter:`).
  - [ ] Variables include `count`, `querySource: 'typed_query'`, `product: args.filter`, and optional `cursor`.
  - [ ] Response parsed via `parseTimelineInstructions` from `data.search_by_raw_query.search_timeline.timeline.instructions`.
  - [ ] Output is `{ posts: PostItem[], pageInfo: { hasNextPage: boolean, endCursor: string | null } }`.
  - [ ] Deduplication by `id` and limit-enforced pagination.
  - [ ] `CrawlCheckpoint` saved with `targetType: 'search'`, `targetKey: <rawQuery>`.

- [ ] **AC-3: `hashtag` handler as wrapper around `search` with `#` prefix**
  - [ ] Hashtag argument stripped of leading `#` then rebuilt as `#<tag>` query.
  - [ ] Delegates to `search` handler with same filter/limit/cursor options.
  - [ ] `PostItem.metadata` contains `isHashtag: true`, `hashtag: <tag>`, `sourceMethod: 'hashtag'`.
  - [ ] `CrawlCheckpoint` saved with `targetType: 'hashtag'`, `targetKey: <tag>`.

- [ ] **AC-4: `trending` handler via REST `trends/place.json` with fallback**
  - [ ] `crawler.start({ action: 'trending', args: { woeid, limit } })` calls `GET /1.1/trends/place.json?id=<woeid>`.
  - [ ] Parses `resp[0].trends` into `{ name, tweetCount, url, category }`.
  - [ ] Normalizes each trend as `PostItem` with id `twitter:trend:<woeid>:<hash>`.
  - [ ] `metadata` contains `tweetId`, `isTrending`, `trendWoeid`, `tweetCount`, `trendUrl`, `isPromoted`, `sourceMethod: 'trending'`.
  - [ ] Filters out promoted trends when `includePromoted: false`.
  - [ ] Falls back to GraphQL `SearchTimeline` with `rawQuery: 'trending'` on 4xx/5xx.
  - [ ] `CrawlCheckpoint` saved with `targetType: 'trending'`, `targetKey: <woeid>`.

- [ ] **AC-5: Namespaced `PostItem` normalization and `PrismaStore` persistence**
  - [ ] Tweet `PostItem` uses `id: twitter:${rest_id}` and `externalId: rest_id`.
  - [ ] Trend `PostItem` uses stable id `twitter:trend:<woeid>:<hash>`.
  - [ ] `category: 'social'`, `platform: 'twitter'` on all results.
  - [ ] `metadata.tweetId` set and required by `schemas/twitter/social.json`.
  - [ ] `PrismaStore.storeBatch(posts, { validateSchema: true })` called per page in chunks of ≤500.
  - [ ] Checkpoint updated after each page with `lastCursor` and `lastCrawledAt`.

- [ ] **AC-6: Deprecation markers and documentation updates**
  - [ ] JSDoc `@deprecated` added to `searchTweets`, `scrapeHashtag`, `scrapeTrending` in `src/scrapers/twitter/index.js`.
  - [ ] JSDoc `@deprecated` added to `searchTweets`, `searchUsers`, `scrapeTrending`, `scrapeHashtag` in `src/scrapers/twitter/http/search.js`.
  - [ ] JSDoc `@deprecated` added to `searchTweets`, `searchProfiles`, `getTrends`, `getExploreTabs` in `src/client/Scraper.js` (if exists).
  - [ ] `docs/deprecation-plan.md` status tracker updated: Twitter search/hashtag/trending moved to `deprecated-marked`, replaced by `twitter:search`, `twitter:hashtag`, `twitter:trending`.

- [ ] **AC-7: ATDD tests and smoke verification**
  - [ ] Test file `tests/scrapers/social/twitter/crawler-search-hashtag-trending.test.js` created with all tests in red phase (`it.skip`).
  - [ ] Tests use a real local `node:http` fake server for GraphQL SearchTimeline and REST `/1.1/trends/place.json` responses.
  - [ ] No module mocking; real implementations call the real fake server.
  - [ ] Optional smoke script `scripts/test-twitter-search-live.mjs` for live query-ID validation.
  - [ ] Type check (`npx tsc --noEmit` or `npm run typecheck`) passes without new errors.

---

## 2. Red Phase Test Cases (`tests/scrapers/social/twitter/crawler-search-hashtag-trending.test.js`)

- [ ] **Test 1:** Action registration — `search`, `hashtag`, `trending` with correct `ActionDescriptor` shapes.
- [ ] **Test 2:** Global tweet search returns normalized `PostItem[]` with metadata and pagination.
- [ ] **Test 3:** Advanced query composition merges operators into `rawQuery` (`from:`, `since:`, `until:`, `min_faves:`, `min_retweets:`, `lang:`, `filter:`).
- [ ] **Test 4:** User search (`filter: 'People'`) returns normalized `ProfileItem` / `PostItem` results.
- [ ] **Test 5:** Hashtag action with `#AI` (without leading hash) and `#machinelearning` (with leading hash) normalizes to single `#`.
- [ ] **Test 6:** Trending action with `woeid: 1`, `includePromoted: false` filters out promoted trends.
- [ ] **Test 7:** Trending action with `woeid: 23424977`, `includePromoted: true` includes promoted trends and sends correct `id` query param.
- [ ] **Test 8:** Input validation throws `PlatformError` for empty query, invalid filter, empty hashtag.
- [ ] **Test 9:** Pagination — first page cursor forwarded to second `SearchTimeline` request.
- [ ] **Test 10:** Persistence — search results stored in `Post` table and `CrawlCheckpoint` saved with `targetType: 'search'`.
- [ ] **Test 11:** Persistence — trending results save `CrawlCheckpoint` with `targetType: 'trending'` and `targetKey` containing `woeid:1`.
- [ ] **Test 12:** Schema validation — search result `metadata` passes `metadataSchemaRegistry.validateMetadata('twitter', 'social', ...)`.
- [ ] **Test 13:** Schema validation — hashtag and trending result `metadata` pass schema validation.

---

## 3. TDD Compliance Statement

- [ ] All new test cases are skipped (`it.skip`) — red phase.
- [ ] No implementation modules are imported with real definitions (target files do not yet exist).
- [ ] Fake server is a real `node:http` server; no module mocking.
- [ ] Tests reference non-existent `src/scrapers/social/twitter/crawler.js` and `client.js` to guarantee red-phase import failures.

---

## 4. Validation & Next Steps

- [ ] Run `vitest run tests/scrapers/social/twitter/crawler-search-hashtag-trending.test.js` and confirm all tests are skipped.
- [ ] Run `npx tsc --noEmit` (or `npm run typecheck` if available) and verify no new errors from the test file itself.
- [ ] Once green-phase development begins, unskip tests one AC at a time.
