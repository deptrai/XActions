# Story 7.2: Multi-Type Facebook Search

---
baseline_commit: bce5ba6f121d20afcebe17ac7412e730b7e3f38c
---

Status: ready-for-dev

## Change Log

- 2026-08-14: Story created from merged Epic 7 architecture.

## Story

As a user running multi-account Facebook scraping,
I want to search Facebook by multiple types (posts, people, pages, groups) with optional parallel execution,
so that I can find relevant content and entities across Facebook surfaces efficiently.

## Acceptance Criteria

**AC1 — Input Parameters (FR-57)**
1. `searchFacebook(page, query, options)` accepts:
   - `query` (string, required) — search keyword.
   - `type` (string enum, default `'posts'`) — one of: `posts`, `people`, `pages`, `groups`, `all`.
   - `location` (string, optional) — geographic hint. If provided, append to the query as `${query} near ${location}` before URL encoding. Do **not** add a separate URL parameter; Facebook search does not expose a stable location filter parameter.
   - `limit` (number, default `30`) — max results per search type.
   - `authCookie` (object `{ c_user, xs }`, optional) — the `scrape()` dispatcher in `src/scrapers/index.js` automatically calls `loginWithCookie(page, authCookie)` when provided; do **not** call `loginWithCookie` inside `searchFacebook`.
   - `parallel` (boolean, default `false`) — accepted and passed through, but **not implemented in Story 7.2**. Multi-account fan-out is owned by `FacebookScrapeService` (Story 7.4).
2. Validation: throw a clear error for unsupported `type`, non-string `query`, or non-positive `limit`.

**AC2 — Sequential vs Parallel Execution (FR-57, NFR-12)**
3. `type: 'all'` defaults to **sequential** on the single provided `page`: run the four sub-searches one after another and merge.
4. `type: 'all'` with `parallel: true` is **deferred to Story 7.4**. `searchFacebook` must still accept the flag and return the merged `type: 'all'` shape, but it must **not** integrate with `FacebookAccountPool` in this story.

**AC3 — Response Shape for `type: 'all'` (FR-57)**
5. Returns an object with all 4 categories, every item carrying `platform: 'facebook'`:

```javascript
{
  posts:   [{ id, text, author, timestamp, url, platform: 'facebook' }],
  people:  [{ id, name, username, profileUrl, image, platform: 'facebook' }],
  pages:   [{ id, name, category, likes, pageUrl, image, platform: 'facebook' }],
  groups:  [{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }]
}
```

**AC4 — Response Shapes for Single Types (FR-57)**
6. `type: 'posts'` returns `Array<{ id, text, author, timestamp, url, platform: 'facebook' }>`.
7. `type: 'people'` returns `Array<{ id, name, username, profileUrl, image, platform: 'facebook' }>`.
8. `type: 'pages'` returns `Array<{ id, name, category, likes, pageUrl, image, platform: 'facebook' }>`.
9. `type: 'groups'` returns `Array<{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }>`.

**AC5 — URL Patterns (FR-57)**
10. Reuse the existing `FACEBOOK_BASE = 'https://www.facebook.com'` constant from `src/scrapers/facebook/index.js`. Navigate to the correct search URL for each type:
    - posts:   `${FACEBOOK_BASE}/search/posts/?q=${encodeURIComponent(query)}`
    - people:  `${FACEBOOK_BASE}/search/people/?q=${encodeURIComponent(query)}`
    - pages:   `${FACEBOOK_BASE}/search/pages/?q=${encodeURIComponent(query)}`
    - groups:  `${FACEBOOK_BASE}/search/groups/?q=${encodeURIComponent(query)}`

**AC6 — Pagination and Velocity (FR-57, NFR-15)**
11. Scroll to load more results.
12. Max `50` scrolls per task.
13. Delay `1–3 seconds` between scrolls.
14. Stop early when `limit` is reached or when a configurable number of consecutive empty scrolls (`maxRetries`, default `8`) is hit.

**AC7 — Extraction Strategy (FR-61, NFR-14)**
15. Primary extraction: `extractHydrationJson(page, typenames, { fallbackExtractor })`.
    - Signature: `extractHydrationJson(page, typenames, { fallbackExtractor: async (page, typenames) => any[] })`.
16. Supported typenames for each search type:
    - `posts`  → `['Story']`
    - `people` → `['User']`
    - `pages`  → `['Page']`
    - `groups` → `['Group']`
17. DOM fallback when hydration data is insufficient or returns fewer results than `limit`. Recommended fallback selectors for each type:
    - **posts:** reuse the existing `searchTweets` logic: `div[role="article"]`, `div[dir="auto"]`, `abbr[data-utime]`, and real profile links.
    - **people:** `[role="listitem"]` with a profile link (`a[href*="/"]`), name text inside the item, and `img` src.
    - **pages:** `[role="article"]` or `[role="listitem"]` with a page link, page name, category text, and like/member count text.
    - **groups:** `[role="listitem"]` with a `/groups/` link, group name, member count text, and privacy text.

**AC8 — Backward Compatibility (FR-57)**
18. Keep `searchTweets` as a named export in `src/scrapers/facebook/index.js`.
19. Make `searchTweets` a thin wrapper:

```javascript
export async function searchTweets(page, query, options = {}) {
  return searchFacebook(page, query, { ...options, type: 'posts' });
}
```

20. Do **not** remove the existing `searchTweets` function signature or export.

**AC9 — Unified Dispatcher (FR-57, FR-63)**
21. Extend `src/scrapers/index.js` `scrape()` with a `platformActionMap` for `facebook`. Add it immediately after the existing global `actionMap` (around line 188). The lookup should prefer the platform-specific map when the platform is `facebook` or `fb`, then fall back to the global `actionMap` for Twitter/Bluesky/Mastodon.
22. Facebook platform map (add the `search` binding now; the others are placeholders for Story 7.3):

```javascript
const platformActionMap = {
  facebook: {
    search: 'searchFacebook',
    post_comments: 'scrapeFacebookComments',    // placeholder for Story 7.3
    group_posts: 'scrapeFacebookGroupPosts',      // placeholder for Story 7.3
    group_comments: 'scrapeFacebookGroupComments' // placeholder for Story 7.3
  }
};
```

23. If the platform is not `facebook`, fall back to the existing global `actionMap` so Twitter/Bluesky/Mastodon behavior is unchanged.

**AC10 — API Surface (FR-63)**
24. Update `POST /api/facebook/scrape` in `api/routes/facebook.js`:
    - Destructure `type` and `parallel` from `req.body`.
    - Validate `type` when `action === 'search'` and `type` is provided: must be one of `posts`, `people`, `pages`, `groups`, `all`.
    - Pass `type`, `limit`, `location`, and `parallel` into `scrapeArgs`:

```javascript
const scrapeArgs = {
  ...options,
  ...(action === 'search' || action === 'marketplace'
    ? {
        query: query.trim(),
        ...(type && { type }),
        ...(parallel !== undefined && { parallel }),
        ...(location && { location: location.trim() }),
        ...(limit !== undefined && { limit: Number(limit) })
      }
    : { url: url.trim() }),
};
```

25. Keep validation of `query` for `search`.

## Tasks / Subtasks

- [ ] **Task 1: Implement `searchFacebook` dispatcher** (AC1, AC2, AC9)
  - [ ] Import `extractHydrationJson` from `./hydration.js`.
  - [ ] Add `searchFacebook(page, query, options)` to `src/scrapers/facebook/index.js`.
  - [ ] Validate `type` (enum), `query` (non-empty string), `limit` (positive integer).
  - [ ] Apply `location` by mutating the effective query only when `location` is non-empty.
  - [ ] For single `type`, delegate to the per-type helper.
  - [ ] For `type: 'all'`, call the four helpers sequentially on the same `page` and merge results into `{ posts, people, pages, groups }`.
- [ ] **Task 2: Implement per-type search helpers** (AC4, AC5, AC7)
  - [ ] `searchPosts(page, query, options)` — refactor existing `searchTweets` DOM logic into this helper; add hydration `Story` primary extraction.
  - [ ] `searchPeople(page, query, options)` — hydration `User` primary + DOM `[role="listitem"]` fallback.
  - [ ] `searchPages(page, query, options)` — hydration `Page` primary + DOM article/listitem fallback.
  - [ ] `searchGroups(page, query, options)` — hydration `Group` primary + DOM `[role="listitem"]` fallback.
- [ ] **Task 3: Implement per-type normalizers** (AC4)
  - [ ] `normalizePostSearchResult(raw)` → `{ id, text, author, timestamp, url, platform: 'facebook' }`.
  - [ ] `normalizePeopleSearchResult(raw)` → `{ id, name, username, profileUrl, image, platform: 'facebook' }` (map hydration `name` / DOM name; derive `username` from the profile URL path; `profileUrl` from `url` or href).
  - [ ] `normalizePageSearchResult(raw)` → `{ id, name, category, likes, pageUrl, image, platform: 'facebook' }` (map `category_name`/`fan_count` or DOM text).
  - [ ] `normalizeGroupSearchResult(raw)` → `{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }` (map `member_count`/`privacy` or DOM text).
- [ ] **Task 4: Update unified dispatcher `scrape()`** (AC9)
  - [ ] Add `platformActionMap` to `src/scrapers/index.js` after the global `actionMap`.
  - [ ] Prefer platform map when `platformName` is `facebook` or `fb`.
  - [ ] Preserve existing `actionMap` fallback for all other platforms.
- [ ] **Task 5: Keep `searchTweets` as backward-compat wrapper** (AC8)
  - [ ] Refactor the current `searchTweets` body into `searchFacebook` with `type: 'posts'`.
  - [ ] Replace `searchTweets` with the thin wrapper shown in AC8.
- [ ] **Task 6: Update API route** (AC10)
  - [ ] Modify `api/routes/facebook.js` `POST /scrape` to accept `type`, `parallel`, `location`, `limit` for `search`.
  - [ ] Add `type` enum validation for `action === 'search'`.
  - [ ] Pass these fields to `scrape('facebook', 'search', scrapeArgs)`.
- [ ] **Task 7: Tests** (all ACs)
  - [ ] Create `tests/scrapers/facebook/search.test.js`.
  - [ ] Test normalizers with fake raw data (post, people, page, group).
  - [ ] Test `searchFacebook` with a fake `page` for each `type` and `all`.
  - [ ] Test validation: unsupported `type`, missing `query`, negative/non-numeric `limit`.
  - [ ] Test `type: 'all'` with 0 results in one or more categories.
  - [ ] Test hydration failure triggers DOM fallback for each type.
  - [ ] Test dispatcher `scrape('facebook', 'search', { query, type, ... })` routes to `searchFacebook`.
  - [ ] Test `searchTweets` wrapper still returns the same posts shape as before.
  - [ ] Update or create `tests/api/facebook-scrape.test.js` with route-level cases for `type`, `parallel`, and invalid `type`.
  - [ ] Run targeted vitest and relevant integration tests.

## Dev Notes

### Critical context

- **Runtime context:** Node.js library + API. Uses Puppeteer, Prisma, Express. ESM only (`import`/`export`).
- **No mocks rule:** Tests may use fake `page`/`axios` seam by injecting functions, but do not stub internals.
- **No storage rule (NFR-10):** Return JSON only; do not persist search results in Prisma or `Operation`.
- **Privacy (NFR-13):** Never log `c_user`, `xs`, cookie strings, or raw HTML. Error messages must not echo cookie values.
- **Read velocity (NFR-15):** Scroll delay `1–3s`; hard limit `50` scrolls per task.
- **Hydration is primary (FR-61, AD-7.8):** Use `extractHydrationJson` first; DOM fallback only when hydration is insufficient.
- **Parallel fan-out boundary:** Multi-account `parallel: true` for `type: 'all'` is owned by `FacebookScrapeService` (Story 7.4). In Story 7.2, `searchFacebook` is a single-page, single-account function. The merged `type: 'all'` object must be implemented so the service can call 4 `searchFacebook` sub-tasks in Story 7.4.
- **No circular dependencies:** `src/scrapers` must not import `api/services`. Do not call `FacebookAccountPool` from `searchFacebook`.

### Files to modify / create

- `src/scrapers/facebook/index.js` — add `searchFacebook` and per-type helpers; refactor `searchTweets` to wrapper.
- `src/scrapers/index.js` — add `platformActionMap` for Facebook inside `scrape()`.
- `api/routes/facebook.js` — extend `POST /scrape` validation and args for `type`, `parallel`, `location`, `limit`.
- `tests/scrapers/facebook/search.test.js` — new test file.
- `tests/scrapers/facebook-index.test.js` — verify `searchTweets` backward-compat.
- `tests/api/facebook-scrape.test.js` — add or update route-level tests.

### Architecture compliance

- Follow the C4 component map in `ARCHITECTURE-SPINE.md` §5: `searchFacebook` lives in the `FacebookScrapers` container.
- `FacebookScrapeService` (Story 7.4) will be the single source of truth for API + MCP; `searchFacebook` must be callable with the standard `(page, query, options)` signature.
- Reuse `extractHydrationJson` from `src/scrapers/facebook/hydration.js` (Story 7.1).
- Reuse `FacebookAccountPool`/`checkAccountHealth` only through the future `FacebookScrapeService`; do not create circular imports from `src/scrapers` into `api/services`.

### Library / framework requirements

- `puppeteer-extra` + `puppeteer-extra-plugin-stealth` (already used in `src/scrapers/facebook/index.js`).
- `p-limit@^7.2.0` already in `package.json` (do not change version; owned by Story 7.1).
- No new runtime dependencies expected.

### File structure requirements

- All Facebook scrapers live under `src/scrapers/facebook/`.
- Per-type search helpers can be private to `src/scrapers/facebook/index.js` or in new files under `src/scrapers/facebook/search/`; if split, export only `searchFacebook` and `searchTweets` from `index.js`.
- Tests live under `tests/scrapers/facebook/` and `tests/api/`.

### Testing standards

- Pure normalizers: test with plain objects, no Puppeteer.
- Scraper helpers: test with fake `page` objects exposing `goto`, `evaluate`, `url`, `close`.
- Dispatcher: test `scrape('facebook', 'search', { query, type, ... })` uses the new `platformActionMap`.
- API route: test `POST /api/facebook/scrape` with `action: 'search'`, `query`, `type`.
- Edge cases to cover:
  - unsupported `type` (`'invalid'`, `'photos'`)
  - missing `query` for single-type search
  - non-positive `limit`
  - `type: 'all'` with 0 results for one or more categories
  - hydration failure triggers DOM fallback
  - `searchTweets` backward-compat wrapper

### Previous story intelligence

- Story 7.1 review found common issues that must NOT be repeated:
  - Validate all user inputs (`type`, `query`, `limit`, `c_user`, `xs`, `maxConcurrency`, `accountIds`) explicitly.
  - Avoid circular dependencies; `src/scrapers` should not import `api/services`.
  - Use `WeakSet` in any JSON walker to avoid circular-reference stack overflow (already in `hydration.js`).
  - Clamp `maxConcurrency` with `Math.max(1, ...)` before passing to `p-limit`.
  - `buildUserDataDir` must reject empty `c_user`.
  - `parseFlatProxy` must validate port is `1–65535`.
- Story 7.1 completion established:
  - `extractHydrationJson(page, typenames, { fallbackExtractor })` is available.
  - `FacebookAccountPool.runBatch` and `checkAccountHealth` are available, but owned by `FacebookScrapeService` in 7.4.
  - `FacebookAccount.encryptedProxy` is stored/encrypted; `parseFlatProxy` is the canonical parser.

### Latest technical information

- `FACEBOOK_BASE` is already defined as `'https://www.facebook.com'` in `src/scrapers/facebook/index.js` (line 39). Reuse it; do not redefine.
- Facebook search direct URLs work without the Meta AI overlay (source: research summary):
  - `https://www.facebook.com/search/posts/?q=...`
  - `https://www.facebook.com/search/people/?q=...`
  - `https://www.facebook.com/search/pages/?q=...`
  - `https://www.facebook.com/search/groups/?q=...`
- Facebook virtualizes the feed: collect results during scroll, not after a final big scroll.
- Hydration JSON lives in `<script type="application/json" data-content-len="...">` tags; look for `__typename` values `Story`, `User`, `Page`, `Group`.
- Likely hydration field mappings (use defensively; fall back to DOM if a field is missing or renamed):
  - `Story` → `id`, `message`/`message_text`, `actor { id, name }`, `published_time`, `url`.
  - `User` → `id`, `name`, `username`, `profile_picture`, `url`.
  - `Page` → `id`, `name`, `category_name`, `fan_count`, `url`, `profile_picture`.
  - `Group` → `id`, `name`, `member_count`, `privacy`, `url`, `profile_picture`.
- Stable DOM fallbacks (subject to Facebook UI changes):
  - **posts:** `div[role="article"]`, `div[dir="auto"]`, `abbr[data-utime]`, real profile links.
  - **people:** `[role="listitem"]` with profile link, name text, `img` src.
  - **pages:** `[role="article"]` or `[role="listitem"]` with page link, name, category, like count.
  - **groups:** `[role="listitem"]` with `/groups/` link, name, member count, privacy text.
- Group search may require mobile UA (390x844) similar to `scrapeTweets` for groups. If desktop search does not load results, consider switching to `https://m.facebook.com/search/groups/?q=...`.
- Anti-detection: realistic delays, separate `userDataDir` per `c_user`, proxy per account, and stealth plugin are already in place.
- Checkpoint detection during search: if the page URL contains `/checkpoint/` or body contains checkpoint indicators, throw a clear error without logging cookie values. Do not retry automatically in Story 7.2; retry is owned by `FacebookAccountPool` in Story 7.4.
- GraphQL `doc_id` values rotate frequently; do **not** rely on hard-coded GraphQL query hashes in Story 7.2. Direct GraphQL replay (FR-62) is deferred to Phase 3 / Story 7.4.

### Project context reference

- `src/scrapers/facebook/index.js` — existing `searchTweets` (lines 939–1029) is the baseline for posts DOM extraction.
- `src/scrapers/facebook/hydration.js` — `extractHydrationJson` (Story 7.1).
- `src/scrapers/facebook/graphql.js` — `buildCookieString`, `parseFacebookTokens`.
- `src/scrapers/index.js` — unified `scrape()` dispatcher (lines 163–298) and global `actionMap`.
- `api/routes/facebook.js` — `POST /api/facebook/scrape` (lines 143–207).
- `_bmad-output/architecture-artifacts/epic7-2026-08-14/STORIES.md` — Story 7.2 AC and implementation notes.
- `_bmad-output/architecture-artifacts/epic7-2026-08-14/ARCHITECTURE-SPINE.md` — component map and data flows.
- `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/prd.md` — FR-57, NFR-14, NFR-15.

## Dev Agent Record

### Agent Model Used

swe-1.7-max

### Debug Log References

- Create-story workflow used subagents for architecture, code, and web research.

### Completion Notes List

- (To be filled after `dev-story` implementation.)

### File List

- `src/scrapers/facebook/index.js`
- `src/scrapers/index.js`
- `api/routes/facebook.js`
- `tests/scrapers/facebook/search.test.js`
- `tests/scrapers/facebook-index.test.js`
- `tests/api/facebook-scrape.test.js`

## References

- FR-57: Multi-type Facebook search.
- NFR-10: No storage of scraped results.
- NFR-14: Resilience — hydration primary, DOM fallback.
- NFR-15: Read velocity — 1–3s scroll delay, max 50 scrolls.
- FR-61: Hydration JSON extraction.
- FR-63: API + MCP surface unification (Story 7.4).
