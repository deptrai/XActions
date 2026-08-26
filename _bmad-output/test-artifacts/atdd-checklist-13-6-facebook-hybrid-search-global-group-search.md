# ATDD Red-Phase Checklist — Story 13.6

Story: **Story 13.6: Facebook Hybrid Search (Global + Group Search)**  
Epic: **Epic 13 — Multi-Platform Hybrid Scraper Engine**  
Baseline Commit: `693e6e1`  
Branch: `feat/13-6-facebook-hybrid-search-global-group-search`

---

## 1. Acceptance Criteria Checklist

- [ ] **AC-1: Inherit AbstractCrawler & Action Registration**
  - [ ] `FacebookCrawler` inherits `AbstractCrawler` (`name: 'facebook'`, `platform: 'facebook'`, `requiresAuth: true`).
  - [ ] Action `search` registered in `ActionRegistry` (`requiredArgs: ['query']`, `optionalArgs: ['type', 'location', 'limit', 'cursor']`).
  - [ ] Action `group_search` registered in `ActionRegistry` (`requiredArgs: ['groupUrl', 'query']`, `optionalArgs: ['limit', 'cursor']`).
  - [ ] `listActions()` lists both `search` and `group_search`.

- [ ] **AC-2: Global Search (`search`)**
  - [ ] `search({ query, type: 'posts', limit })` returns normalized `PostItem[]` with pagination info.
  - [ ] `search({ query, type: 'people', limit })` returns normalized people search results.
  - [ ] `search({ query, type: 'pages', limit })` returns normalized page search results.
  - [ ] `search({ query, type: 'groups', limit })` returns normalized group search results.
  - [ ] `search({ query, type: 'all', limit })` returns `{ posts, people, pages, groups, pageInfo }`.

- [ ] **AC-3: Group Search (`group_search`)**
  - [ ] `group_search({ groupUrl, query, limit })` extracts `groupId` via `resolveGroupId` and executes search.
  - [ ] Rejects non-Facebook URLs and non-group URLs with `PlatformError` (`XACT_4001`).
  - [ ] Returns `{ posts: PostItem[], pageInfo }`.

- [ ] **AC-4: GraphQL Dispatcher with LSD/Token Handshake**
  - [ ] Dispatches GraphQL search queries via `FacebookClient.requestGraphQl`.
  - [ ] Reuses security tokens (`lsd`, `fb_dtsg`, `jazoest`, `c_user`).

- [ ] **AC-5: Namespaced IDs & Normalization**
  - [ ] All search result items have `id = 'facebook:${externalId}'`, `platform = 'facebook'`, `category = 'social'`.
  - [ ] Non-post results (`people`, `pages`, `groups`) have `publishedAt: null`.
  - [ ] Metadata contains `isSearchResult: true`, `searchType`, `query`, `resultType`, `sourceMethod`.

- [ ] **AC-6: Location Query Formatting & Pagination**
  - [ ] Formats query with location: `"<query> near <location>"`.
  - [ ] Supports limit (1..500) and cursor pagination (`pageInfo.has_next_page`, `pageInfo.end_cursor`).

- [ ] **AC-7: Input Validation & SSRF Guard**
  - [ ] Throws `PlatformError` (`XACT_4001`) on empty query, invalid type, or out-of-range limit.
  - [ ] Throws `PlatformError` (`XACT_4001`) on SSRF / non-Facebook group URLs.

- [ ] **AC-8: PrismaStore & Checkpoint Persistence**
  - [ ] Persists search results via `store.storeBatch(items, { upsert: true })`.
  - [ ] Saves crawl checkpoint with `targetType: 'search'`, `targetKey: '<query>:<type>'` or `'<groupId>:<query>'`.

- [ ] **AC-9: Deprecation Notices**
  - [ ] Marks `@deprecated` on legacy `searchFacebook`, `searchTweets`, and `scrapeFacebookGroupSearch` in `src/scrapers/facebook/`.
  - [ ] Updates `docs/deprecation-plan.md` tracker table.

- [ ] **AC-10: Metadata Schema Validation**
  - [ ] Updates `schemas/facebook/social.json` to allow search metadata fields (`isSearchResult`, `searchType`, `query`, `resultType`, `location`, etc.).

---

## 2. Red Phase Test Cases (`tests/scrapers/social/facebook/crawler-search.test.js`)

- [ ] **Test 1:** Action Registration & Action Descriptors verification.
- [ ] **Test 2:** Global Search `posts` via GraphQL dispatcher with normalized `PostItem[]`.
- [ ] **Test 3:** Global Search `people`, `pages`, `groups` with `ProfileItem` → `PostItem` normalization (`publishedAt: null`).
- [ ] **Test 4:** Global Search `type: 'all'` returning multi-entity shape.
- [ ] **Test 5:** Group Search with `resolveGroupId` and SSRF prevention.
- [ ] **Test 6:** Input Validation (empty query, invalid search type, out-of-bound limit).
- [ ] **Test 7:** Location appending and pagination cursor handling.
- [ ] **Test 8:** PrismaStore batch storage and checkpoint saving (`targetType: 'search'`).
