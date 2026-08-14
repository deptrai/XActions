# Story 7.3: Comments & Group Content

---
baseline_commit: 715aa942e6d84d78ae4ea38d92dbd95aa27a9bb8
---

Status: review

## Change Log

- 2026-08-14: Story created from Epic 7 architecture and 7.2 learnings.
- 2026-08-14: Implemented scrapers (`scrapeFacebookComments`, `scrapeFacebookGroupPosts`, `scrapeFacebookGroupComments`), normalizers, DOM fallback helpers, API route wiring, and tests.

## Story

As a user running multi-account Facebook scraping,
I want to scrape comments from a post and posts/comments from Facebook groups,
so that I can analyze engagement, sentiment, and community activity at scale.

## Acceptance Criteria

**AC1 — Scrape Post Comments (FR-58, NFR-10, NFR-14, NFR-15)**

1. `scrapeFacebookComments(page, postUrl, options)` is implemented in `src/scrapers/facebook/index.js` and exported.
2. `postUrl` must be a valid `facebook.com` URL; validate with `assertFacebookUrlLocal` before `page.goto`.
3. Navigates to the post permalink.
4. Switches the comment sort from "Most relevant" to "All comments" if the sort UI is present; if the control is missing or switching fails, proceed with the default sort (do not throw).
5. Scrolls to load more comments and clicks expanders with text such as "View more comments" or "X replies" (or `[aria-label*="View more comments"]` / `[role="button"]` fallback) during the scroll loop.
6. Each returned comment has the shape:
   ```js
   {
     id,
     authorName,
     authorUrl,
     text,
     timestamp,
     likes,
     replies[],
     parentId
   }
   ```
7. `replies[]` is present and populated only when `options.includeReplies === true`.
8. `parentId` is `null` for top-level comments and the parent comment `id` for nested replies.
9. Deduplicate comments with a `Map` keyed by `id` during the scroll loop, following the pattern established in Story 7.2.
10. Uses `extractHydrationJson(page, ['Comment'], { fallbackExtractor, limit })` as the primary extraction path; `fallbackExtractor` must be `async (page, typenames) => Promise<any[]>`. Falls back to DOM selectors when hydration is insufficient.
11. Stops when `options.limit` is reached, after `maxRetries` consecutive empty scrolls, or after `maxScrolls` (50) scrolls. Scroll delay is `1–3s`.
12. Returns `{ note, platform: 'facebook' }` when the post is restricted or comments are disabled (do **not** throw).

**AC2 — Scrape Group Posts (FR-59, NFR-10, NFR-14, NFR-15)**

1. `scrapeFacebookGroupPosts(page, groupUrl, options)` is implemented in `src/scrapers/facebook/index.js` and exported.
2. `groupUrl` must be a valid `facebook.com/groups/` URL; validate with `assertFacebookUrlLocal` before `page.goto`.
3. Sets mobile UA and viewport **before** `page.goto`:
   ```js
   await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');
   await page.setViewport({ width: 390, height: 844, isMobile: true });
   ```
4. Navigates to the group URL (or `m.facebook.com/groups/{id}` if the mobile redirect is required).
5. Returns posts with the same shape as `scrapeTweets` / `searchFacebook` post results:
   ```js
   {
     id,
     text,
     timestamp,
     likes,
     comments,
     url,
     media,
     platform: 'facebook'
   }
   ```
6. Returns `{ note, platform: 'facebook' }` when the group is private/restricted and the account is not a member.
7. Uses `extractHydrationJson(page, ['Story'], { fallbackExtractor, limit })` as primary extraction; `fallbackExtractor` must be `async (page, typenames) => Promise<any[]>`. Falls back to DOM selectors when hydration is insufficient.
8. Deduplicate group posts with a `Map` keyed by `id` during the scroll loop.
9. Bounded scroll loop: `1–3s` delay, max `50` scrolls, `maxRetries` consecutive empty scrolls.

**AC3 — Scrape Group Comments (FR-60, NFR-10, NFR-14, NFR-15)**

1. `scrapeFacebookGroupComments(page, groupPostUrl, options)` is implemented in `src/scrapers/facebook/index.js` and exported.
2. Verifies `groupPostUrl` contains `facebook.com/groups/`; if not, throws a clear 400-style error.
3. Is a thin wrapper that calls `scrapeFacebookComments(page, groupPostUrl, options)` — no duplicated extraction logic.
4. Returns the same comment shape as AC1.
5. Returns `{ note, platform: 'facebook' }` when the group is private or comments are restricted.

**AC4 — Unified Dispatcher & API Surface (FR-63, NFR-13)**

1. The `platformActionMap` in `src/scrapers/index.js` already maps:
   - `post_comments` → `scrapeFacebookComments`
   - `group_posts` → `scrapeFacebookGroupPosts`
   - `group_comments` → `scrapeFacebookGroupComments`
   Verify these mappings work after implementation; do **not** remove or change them.
2. Update `api/routes/facebook.js`:
   - Add `post_comments`, `group_posts`, `group_comments` to `VALID_ACTIONS`.
   - Validate that `url` is provided for these actions.
   - Validate `limit` is a positive integer when supplied.
   - For `post_comments` and `group_comments` only, validate `includeReplies` is a boolean when supplied; skip this check for `group_posts`.
   - Pass `url`, `limit`, and `includeReplies` into `scrapeArgs` so the dispatcher can forward them.
3. Cookie resolution (`authCookie.accountId`, `accountIds[]`, or auto-pick) stays as implemented in 7.2 / 7.4; `scrape()` receives the resolved cookie object.
4. Do **not** implement `FacebookScrapeService` or MCP tools in this story — those are owned by Story 7.4.

**AC5 — Resilience, Privacy, and Velocity (NFR-10, NFR-11, NFR-13, NFR-14, NFR-15)**

1. Use `extractHydrationJson` as primary extraction, DOM fallback as secondary.
2. Strip phone numbers and emails from `text` and `authorName` via `stripPii`.
3. Never log `c_user`, `xs`, `authCookie`, or raw HTML in error messages.
4. Detect checkpoints via `assertNoCheckpoint(page, source)` after navigation and inside scroll loops.
5. Respect read velocity: `1–3s` scroll delay, max `50` scrolls per task.

## Tasks / Subtasks

- [x] **Task 1: Implement `scrapeFacebookComments` (AC1, AC5)**
  - [x] Add `scrapeFacebookComments(page, postUrl, options = {})` to `src/scrapers/facebook/index.js`.
  - [x] Validate `postUrl` with `assertFacebookUrlLocal` and normalize it if needed.
  - [x] Navigate to the post; call `assertNoCheckpoint`.
  - [x] Switch comment sort to "All comments" when the sort control is present.
  - [x] Implement bounded scroll loop (`limit`, `maxRetries`, `maxScrolls`, `delay`).
  - [x] Extract primary data with `extractHydrationJson(page, ['Comment'], { fallbackExtractor, limit })`.
  - [x] Implement `extractCommentsFromDom(page)` fallback.
  - [x] Click "View more comments" / "X replies" expanders during scroll.
  - [x] Normalize each comment to `{ id, authorName, authorUrl, text, timestamp, likes, replies[], parentId }` using `normalizeComment`.
  - [x] Populate `replies[]` and `parentId` only when `includeReplies === true`.
  - [x] Return `{ note, platform: 'facebook' }` for restricted posts/comments.

- [x] **Task 2: Implement `scrapeFacebookGroupPosts` (AC2, AC5)**
  - [x] Add `scrapeFacebookGroupPosts(page, groupUrl, options = {})` to `src/scrapers/facebook/index.js`.
  - [x] Validate `groupUrl` with `assertFacebookUrlLocal`; ensure it contains `/groups/`.
  - [x] Set mobile UA and viewport (`390x844`, `isMobile: true`) before `page.goto`.
  - [x] Navigate to the group (handle `m.facebook.com` redirect/login fallback).
  - [x] Implement bounded scroll loop with `1–3s` delay and `maxScrolls: 50`.
  - [x] Extract primary data with `extractHydrationJson(page, ['Story'], { fallbackExtractor, limit })`.
  - [x] Implement `extractGroupPostsFromDom(page)` fallback.
  - [x] Normalize each post with `normalizeGroupPost` to the `scrapeTweets` shape.
  - [x] Return `{ note, platform: 'facebook' }` for private/restricted groups.

- [x] **Task 3: Implement `scrapeFacebookGroupComments` (AC3, AC5)**
  - [x] Add `scrapeFacebookGroupComments(page, groupPostUrl, options = {})` to `src/scrapers/facebook/index.js`.
  - [x] Verify `groupPostUrl` contains `facebook.com/groups/`.
  - [x] Call `scrapeFacebookComments(page, groupPostUrl, options)` and return its result.
  - [x] No duplicated extraction logic.

- [x] **Task 4: Add normalizers and DOM fallback helpers (AC1, AC2, AC5)**
  - [x] Add `normalizeComment(raw)` in `src/scrapers/facebook/index.js`.
  - [x] Add `normalizeGroupPost(raw)` in `src/scrapers/facebook/index.js`; reuse the existing `normalizePost` shape and only add group-specific fields if needed.
  - [x] Add private helpers `extractCommentsFromDom(page)` and `extractGroupPostsFromDom(page)`.
  - [x] Apply `stripPii` to all text and author fields.

- [x] **Task 5: Update default export (AC1, AC2, AC3)**
  - [x] Add the three new functions to the default export object in `src/scrapers/facebook/index.js`.

- [x] **Task 6: Update API route (AC4)**
  - [x] Add `post_comments`, `group_posts`, `group_comments` to `VALID_ACTIONS` in `api/routes/facebook.js`.
  - [x] Validate `url` is present for these actions.
  - [x] Validate `limit` is a positive integer when present.
  - [x] Validate `includeReplies` is a boolean for `post_comments` and `group_comments`.
  - [x] Forward `url`, `limit`, and `includeReplies` in `scrapeArgs`.

- [x] **Task 7: Tests (all ACs)**
  - [x] Create `tests/scrapers/facebook-comments.test.js`:
    - [x] Unit tests for `normalizeComment` with hydration and DOM fields.
    - [x] `scrapeFacebookComments` with fake `page` for successful extraction.
    - [x] Sort-switch, scroll, expander, and limit behavior.
    - [x] `includeReplies: true/false` shape.
    - [x] Restricted post returns `{ note, platform }`.
    - [x] Invalid `postUrl` throws.
    - [x] DOM fallback path.
  - [x] Create `tests/scrapers/facebook-group-posts.test.js`:
    - [x] Unit tests for `normalizeGroupPost`.
    - [x] Mobile UA and viewport (`{ width: 390, height: 844, isMobile: true }`) are set before `goto`.
    - [x] Group post extraction and `note` for restricted groups.
    - [x] Invalid `groupUrl` throws.
  - [x] Create `tests/scrapers/facebook-group-comments.test.js` or extend `facebook-comments.test.js`:
    - [x] `scrapeFacebookGroupComments` delegates to `scrapeFacebookComments`.
    - [x] Rejects non-group URLs.
    - [x] Same output shape as post comments.
  - [x] Update or create `tests/api/facebook-scrape.test.js` for route-level `post_comments`, `group_posts`, `group_comments` validation.
  - [x] Run targeted vitest and relevant integration tests.

## Dev Agent Record

### Debug Log
- 2026-08-14: `normalizeComment` initially did not set `parentId` for nested replies. Added optional `fallbackParentId` parameter and passed the parent `id` when recursing.
- 2026-08-14: `api/routes/facebook.js` eagerly constructed `searchArgs` with `query.trim()`, which threw for non-search actions. Replaced with conditional inline construction so `query.trim()` is only evaluated for `search` or `marketplace`.

### Completion Notes
- Implemented `scrapeFacebookComments`, `scrapeFacebookGroupPosts`, `scrapeFacebookGroupComments`, `normalizeComment`, `normalizeGroupPost`, `extractCommentsFromDom`, and `extractGroupPostsFromDom` in `src/scrapers/facebook/index.js`.
- Wired `post_comments`, `group_posts`, and `group_comments` into `api/routes/facebook.js` with `url`, `limit`, and `includeReplies` validation.
- Added `scrapeFacebookComments`, `scrapeFacebookGroupPosts`, and `scrapeFacebookGroupComments` to the default export.
- Created unit/integration tests: `tests/scrapers/facebook-comments.test.js`, `tests/scrapers/facebook-group-posts.test.js`, `tests/scrapers/facebook-group-comments.test.js`, and `tests/api/facebook-scrape.test.js`.
- Ran `npx vitest run tests/scrapers/facebook*.test.js tests/api/facebook*.test.js` — 24 files passed, 1 skipped (986 passed / 14 skipped).

## File List

- Modified: `src/scrapers/facebook/index.js`
- Modified: `api/routes/facebook.js`
- Created: `tests/scrapers/facebook-comments.test.js`
- Created: `tests/scrapers/facebook-group-posts.test.js`
- Created: `tests/scrapers/facebook-group-comments.test.js`
- Created: `tests/api/facebook-scrape.test.js`
- Modified: `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Dev Notes

### Critical context

- **Runtime context:** Node.js library + API. Puppeteer, Prisma, Express. ESM only (`import`/`export`).
- **No mocks rule:** Tests may use fake `page`/`axios` seams by injecting functions, but do not stub internals.
- **No storage rule (NFR-10):** Return JSON only; do not persist results in Prisma or `Operation`.
- **Privacy (NFR-13):** Never log `c_user`, `xs`, cookie strings, or raw HTML. Error messages must not echo cookie values.
- **Read velocity (NFR-15):** Scroll delay `1–3s`; hard limit `50` scrolls per task.
- **Hydration is primary (FR-61, AD-7.8):** Use `extractHydrationJson` first; DOM fallback only when hydration is insufficient.
- **Mobile group feed (FR-59):** Group posts require mobile UA and `390x844` viewport; desktop often fails in headless.
- **No circular dependencies:** `src/scrapers` must not import `api/services`. Do not call `FacebookAccountPool` or `FacebookScrapeService` from the scrapers.
- **No duplicates:** `scrapeFacebookGroupComments` must be a thin wrapper over `scrapeFacebookComments`.
- **Story 7.4 boundary:** API service unification, `FacebookAuthResolver`, and MCP tools are **not** in this story. Only the scraper functions and minimal route wiring to make them callable via `POST /api/facebook/scrape`.

### Files to modify / create

- `src/scrapers/facebook/index.js` — add `scrapeFacebookComments`, `scrapeFacebookGroupPosts`, `scrapeFacebookGroupComments`, `normalizeComment`, `normalizeGroupPost`, and DOM fallback helpers.
- `src/scrapers/index.js` — confirm / keep `platformActionMap` entries for `post_comments`, `group_posts`, `group_comments`.
- `api/routes/facebook.js` — extend `VALID_ACTIONS`, `url`/`limit`/`includeReplies` validation, and `scrapeArgs`.
- `tests/scrapers/facebook-comments.test.js` — new.
- `tests/scrapers/facebook-group-posts.test.js` — new.
- `tests/scrapers/facebook-group-comments.test.js` — optional if not folded into comments test.
- `tests/api/facebook-scrape.test.js` — add or update route-level cases.

### Architecture compliance

- Follow the C4 component map in `ARCHITECTURE-SPINE.md` §5: new scrapers live in the `FacebookScrapers` container.
- Reuse `extractHydrationJson` from `src/scrapers/facebook/hydration.js` (Story 7.1).
- Use `assertFacebookUrl` / `assertFacebookUrlLocal` SSRF guards before any `page.goto`.
- Use `assertNoCheckpoint` after navigation and inside scroll loops.
- Reuse anti-detection from Epic 6 (`fingerprint.js`, `createPage`, `loginWithCookie`).
- `FacebookScrapeService` (Story 7.4) will call `scrape('facebook', action, args)`; keep the scraper functions callable with the standard `(page, target, options)` signature.

### Library / framework requirements

- `puppeteer-extra` + `puppeteer-extra-plugin-stealth` (already used).
- No new runtime dependencies expected.

### File structure requirements

- All Facebook scraper functions live in `src/scrapers/facebook/index.js` or in submodules imported and re-exported from it.
- Tests live under `tests/scrapers/` and `tests/api/`.

### Testing standards

- Pure normalizers: test with plain objects, no Puppeteer.
- Scraper helpers: test with fake `page` objects exposing `goto`, `evaluate`, `url`, `setUserAgent`, `setViewport`, `click`, `waitForSelector`, `close`.
- Dispatcher: test `scrape('facebook', 'post_comments', { url, ... })` routes through the `platformActionMap`.
- API route: test `POST /api/facebook/scrape` with `action` and `url`.
- Edge cases to cover:
  - invalid `postUrl` / `groupUrl`
  - non-facebook URLs (SSRF)
  - missing `url`
  - non-positive `limit`
  - `includeReplies` not a boolean
  - restricted post/group returns `{ note, platform }`
  - hydration failure triggers DOM fallback
  - `scrapeFacebookGroupComments` delegates to `scrapeFacebookComments`

### Previous story intelligence

- Story 7.2 established:
  - `extractHydrationJson` + `fallbackExtractor` pattern.
  - Per-type normalizers and pure-function tests.
  - `platformActionMap` for Facebook-specific actions.
  - `Map` keyed by `id` for deduplication.
  - Bounded scroll loop with `maxRetries`, `maxScrolls`, and immediate `break` when `limit` is reached.
  - `assertNoCheckpoint` inside the scroll loop.
  - API route validation before `scrape()` to return 400 instead of 500.
- Story 7.2 review found these high-priority items that 7.3 must avoid or carry forward:
  - Fix URL-derived ID extraction for `/groups/{id}`, `/pages/{id}`, and `profile.php?id=...` paths.
  - Reject numeric IDs as usernames in normalizers; prefer URL-derived handles.
  - Validate all user-facing inputs (`url`, `limit`, `includeReplies`) explicitly in the API route.
  - Do not forward action-specific parameters to the wrong action.
  - Avoid one extra scroll after `limit` is reached.

### Latest technical information

- `extractHydrationJson` supports `__typename` filtering including `Story` and `Comment` [Source: `src/scrapers/facebook/hydration.js`, `src/scrapers/facebook/index.js`].
- `assertFacebookUrlLocal` exists in `src/scrapers/facebook/index.js` (lines 1485–1504) and is SSRF-safe.
- `scrapeTweets` already contains a mobile-UA path for `/groups/` URLs that can be used as a reference for `scrapeFacebookGroupPosts` [Source: `src/scrapers/facebook/index.js` lines 794–802].
- `scrapeGroupMembers` contains a working pattern for bounded scroll + `note` response for restricted groups [Source: `src/scrapers/facebook/index.js`].
- The `platformActionMap` for 7.3 already exists as placeholders in `src/scrapers/index.js` [Source: `src/scrapers/index.js` lines 192–199].

### References

- `_bmad-output/architecture-artifacts/epic7-2026-08-14/STORIES.md` — Story 7.3 acceptance criteria and implementation notes.
- `_bmad-output/architecture-artifacts/epic7-2026-08-14/ARCHITECTURE-SPINE.md` — C4 component map, data flows, NFR mapping.
- `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/prd.md` — FR-58, FR-59, FR-60, FR-61, FR-63, NFR-10..NFR-15.
- `_bmad-output/implementation-artifacts/7-2-multi-type-search.md` — patterns for hydration-first extraction, scroll loops, dispatchers, and tests.
- `src/scrapers/facebook/index.js` — existing scrapers, normalizers, `assertFacebookUrlLocal`, `stripPii`.
- `src/scrapers/index.js` — `scrape()` dispatcher and `platformActionMap`.
- `api/routes/facebook.js` — `POST /api/facebook/scrape` route.
- `src/scrapers/facebook/hydration.js` — `extractHydrationJson`.
