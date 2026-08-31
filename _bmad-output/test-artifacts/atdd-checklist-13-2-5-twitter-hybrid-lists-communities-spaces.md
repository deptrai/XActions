# ATDD Red-Phase Checklist — Story 13.2.5

Story: **Story 13.2.5 — Twitter Hybrid Lists, Communities & Spaces**  
Epic: **Epic 13 — High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)**  
Baseline Commit: `05c6ec53`  
Branch: `worktree-e2e-story-13-2-4`

---

## 1. Acceptance Criteria Checklist

- [ ] **AC-1: Register `list_members`, `community_members`, and `spaces` actions in `TwitterCrawler`**
  - [ ] `TwitterCrawler` inherits `AbstractCrawler` (`name: 'twitter'`, `platform: 'twitter'`).
  - [ ] Action `list_members` registered with `requiredArgs: ['listUrl']`, optional `listId`, `limit`, `cursor`, `requiresAuth: true`.
  - [ ] Action `community_members` registered with `requiredArgs: ['communityUrl']`, optional `communityId`, `limit`, `cursor`, `requiresAuth: true`.
  - [ ] Action `spaces` registered with `requiredArgs: ['query']`, optional `limit`, `cursor`, `state`, `requiresAuth: false`.
  - [ ] `list_members` parses `listId` from `listUrl` via regex `/lists\/(\d+)/`.
  - [ ] `community_members` parses `communityId` from `communityUrl` via regex `/communities\/(\d+)/`.
  - [ ] `listActions()` resolves all three actions and `ActionDescriptor` shapes are correct (`action`, `description`, `requiredArgs`, `optionalArgs`, `example`, `outputType`, `requiresAuth`).

- [ ] **AC-2: `list_members` handler via GraphQL `ListMembers`**
  - [ ] `crawler.start({ action: 'list_members', args: { listUrl, limit, cursor } })` extracts `listId`.
  - [ ] If `listId` not found in URL, throws `PlatformError` with `XACT_4001` / `invalid_args`.
  - [ ] Calls GraphQL `ListMembers` (`queryId: BQp2IEYkgxuSxqbTAr1e1g`) with variables `{ listId, count: Math.min(limit, 100), cursor }`.
  - [ ] Uses `DEFAULT_FEATURES` and `DEFAULT_FIELD_TOGGLES` from `src/scrapers/twitter/http/endpoints.js`.
  - [ ] Parses response via `parseUserList(instructions)` from `src/scrapers/twitter/http/relationships.js`.
  - [ ] Normalizes each user to `ProfileItem` via `normalizeUserProfile(user, { isListMember: true, listId, sourceMethod: 'list_members' })`.
  - [ ] Output is `{ members: ProfileItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }`.
  - [ ] Deduplication by username and limit-enforced pagination.
  - [ ] Persists `ProfileItem` as `PostItem` via `profileItemToPostItem(member)` and `PrismaStore.storeBatch(...)`.
  - [ ] `CrawlCheckpoint` saved with `targetType: 'list_members'`, `targetKey: twitter:list:${listId}`.
  - [ ] Emits Redis stream thin events if `redisPublisher` is configured.

- [ ] **AC-3: `community_members` handler via GraphQL or browser-as-signer bridge**
  - [ ] `crawler.start({ action: 'community_members', args: { communityUrl, limit, cursor } })` extracts `communityId`.
  - [ ] If `communityId` not found in URL, throws `PlatformError` with `XACT_4001` / `invalid_args`.
  - [ ] Attempts public GraphQL endpoint for community members (dev agent must verify query ID and operation name).
  - [ ] If GraphQL unavailable, falls back to browser-as-signer bridge via `TwitterClient` + `SignerWorkerPagePool` to fetch `https://x.com/i/communities/<communityId>/members`.
  - [ ] Parses user list from response (same shape as `ListMembers`: `instructions[].entries[]`, `user_results.result`).
  - [ ] Normalizes each user to `ProfileItem` via `normalizeUserProfile(user, { isCommunityMember: true, communityId, sourceMethod: 'community_members' })`.
  - [ ] Output is `{ members: ProfileItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }`.
  - [ ] Persists `ProfileItem` as `PostItem` via `profileItemToPostItem(member)`.
  - [ ] `CrawlCheckpoint` saved with `targetType: 'community_members'`, `targetKey: twitter:community:${communityId}`.
  - [ ] Throws `PlatformError` with `code: TWITTER_COMMUNITY_PRIVATE` / `suggestedAction: 'relogin'` if community requires private membership.

- [ ] **AC-4: `spaces` handler via GraphQL or browser-as-signer search**
  - [ ] `crawler.start({ action: 'spaces', args: { query, limit, cursor, state } })` dispatches search request.
  - [ ] Attempts public GraphQL endpoint for Spaces search (dev agent must verify query ID and operation name, e.g. `AudioSpaceSearch` or `LiveEventTimeline`).
  - [ ] If GraphQL unavailable, falls back to `https://x.com/search?q=<query>&f=spaces` with browser-as-signer bridge.
  - [ ] Each space normalized to `PostItem`:
    - [ ] `id: twitter:spaces:${spaceId}`
    - [ ] `platform: 'twitter'`, `category: 'social'`
    - [ ] `externalId: spaceId`
    - [ ] `authorId`, `authorName`, `authorAvatar` from host user if available
    - [ ] `content: space.title || space.description || ''`
    - [ ] `mediaUrls: []` or audio stream URL if extractable
    - [ ] `metadata.isSpace: true`
    - [ ] `metadata.spaceState: 'live' | 'scheduled' | 'ended'`
    - [ ] `metadata.participantCount: number`
    - [ ] `metadata.startedAt: ISO string | null`
    - [ ] `metadata.sourceMethod: 'spaces'`
  - [ ] Output is `{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }`.
  - [ ] Deduplication by `spaceId` and limit-enforced pagination.
  - [ ] `CrawlCheckpoint` saved with `targetType: 'spaces'`, `targetKey: twitter:spaces:${query}`.

- [ ] **AC-5: Namespaced `ProfileItem` / `PostItem` normalization and `PrismaStore` persistence**
  - [ ] `ProfileItem` for list/community members uses `id: twitter:${rest_id}` and `externalId: rest_id`.
  - [ ] `ProfileItem.username`, `name`, `bio`, `avatar`, `profileUrl`, `followersCount`, `followingCount` populated from `legacy` user fields.
  - [ ] `PostItem` for spaces uses stable `id: twitter:spaces:${spaceId}`.
  - [ ] `category: 'social'`, `platform: 'twitter'` on all results.
  - [ ] `metadata.tweetId` set (for `ProfileItem`-derived `PostItem` use `externalId` as `tweetId`) and required by `schemas/twitter/social.json`.
  - [ ] `PrismaStore.storeBatch(items, { validateSchema: true })` called per page in chunks of ≤500.
  - [ ] Checkpoint updated after each page with `lastCursor` and `lastCrawledAt`.

- [ ] **AC-6: Deprecation markers and documentation updates**
  - [ ] JSDoc `@deprecated` added to `scrapeListMembers` in `src/scrapers/twitter/index.js`.
  - [ ] JSDoc `@deprecated` added to `scrapeCommunityMembers` in `src/scrapers/twitter/index.js`.
  - [ ] JSDoc `@deprecated` added to `scrapeSpaces` in `src/scrapers/twitter/index.js`.
  - [ ] `docs/deprecation-plan.md` status tracker updated: list/community/space scrapers moved to `deprecated-marked`, replaced by `twitter:list_members`, `twitter:community_members`, `twitter:spaces`.

- [ ] **AC-7: ATDD tests and smoke verification**
  - [ ] Test file `tests/scrapers/social/twitter/crawler-lists-communities-spaces.test.js` created with all tests in red phase (`it.skip` or `expect.fail`).
  - [ ] Tests use a real local `node:http` fake server for GraphQL `ListMembers` responses.
  - [ ] No module mocking; real implementations call the real fake server.
  - [ ] Optional smoke script `scripts/test-twitter-lists-communities-spaces-live.mjs` for live query-ID validation.
  - [ ] Type check (`npx tsc --noEmit` or `npm run typecheck`) passes without new errors.

---

## 2. Red Phase Test Cases (`tests/scrapers/social/twitter/crawler-lists-communities-spaces.test.js`)

- [ ] **Test 1:** Action registration — `list_members`, `community_members`, `spaces` with correct `ActionDescriptor` shapes.
- [ ] **Test 2:** `list_members` extracts `listId` from `listUrl`.
- [ ] **Test 3:** `list_members` with `listId` directly dispatches `ListMembers` GraphQL and returns `ProfileItem[]`.
- [ ] **Test 4:** `list_members` pagination cursor forwarded to second `ListMembers` request.
- [ ] **Test 5:** `list_members` persists `ProfileItem` as `PostItem` with `metadata.isListMember: true` and `metadata.listId`.
- [ ] **Test 6:** `list_members` throws `PlatformError` for malformed `listUrl`.
- [ ] **Test 7:** `community_members` extracts `communityId` from `communityUrl`.
- [ ] **Test 8:** `community_members` returns `ProfileItem[]` with `metadata.isCommunityMember: true` and `metadata.communityId`.
- [ ] **Test 9:** `community_members` persists `CrawlCheckpoint` with `targetType: 'community_members'`.
- [ ] **Test 10:** `community_members` throws `PlatformError` with `TWITTER_COMMUNITY_PRIVATE` for private community.
- [ ] **Test 11:** `spaces` returns `PostItem[]` with `metadata.isSpace: true` and `metadata.spaceState`.
- [ ] **Test 12:** `spaces` deduplicates by `spaceId` and enforces `limit`.
- [ ] **Test 13:** `spaces` persists `CrawlCheckpoint` with `targetType: 'spaces'`.
- [ ] **Test 14:** `listActions()` includes all three actions with resolved `requiresAuth`.
- [ ] **Test 15:** Legacy `scrapeListMembers`, `scrapeCommunityMembers`, `scrapeSpaces` have `@deprecated` JSDoc tags.

---

## 3. Cross-Cutting Concerns

- [ ] All new files follow project conventions (`// by nichxbt`, ESM `import`/`export`, `const` over `let`, async/await).
- [ ] No `any` or `@ts-ignore` in new TypeScript declarations if `tsc` is enabled.
- [ ] `TwitterCrawler` constructor does not exceed readable length; consider extracting `community_members`/`spaces` handler registration to helper methods.
- [ ] Normalizers extracted to `src/scrapers/social/twitter/normalize-lists-communities-spaces.js` (or split into `normalize-list.js`, `normalize-community.js`, `normalize-spaces.js`) consistent with `normalize-media.js`.
- [ ] GraphQL query IDs for community/space endpoints are documented with sources (twikit, twitter-scraper, or network inspection).
- [ ] Browser-as-signer fallback uses existing `SignerWorkerPagePool` and `TwitterClient` bridge, not a new Puppeteer dependency.
