# Story 7.2 — Multi-Type Facebook Search Acceptance Audit

## Overall Assessment

The diff implements the `searchFacebook` dispatcher, per-type normalizers, the `searchTweets` backward-compatible wrapper, the `platformActionMap` in `scrape()`, and the API route changes. Most ACs and NFRs are satisfied. The most material issues are in the **group/page DOM fallback identifier extraction** and in **test coverage for DOM fallbacks / route-level cases**.

---

## Findings

- **AC5 — URL Patterns: trailing slash omitted before `?q=`.**
  - *Evidence*: `SEARCH_TYPE_URLS` in `src/scrapers/facebook/index.js` (lines 1062–1067) uses `/search/posts`, `/search/people`, `/search/pages`, `/search/groups`. `searchByType` builds the URL as `` `${FACEBOOK_BASE}${SEARCH_TYPE_URLS[type]}?q=${encodeURIComponent(query)}` `` (line 1239). The spec requires `/search/posts/?q=...`, `/search/people/?q=...`, etc. (with the trailing slash before `?q=`). This is a minor deviation; Facebook may redirect, but the generated URL does not match the stated pattern.

- **AC4 / AC7 — Group and page DOM fallback produce non-unique `id` values, collapsing results.**
  - *Evidence*: In `extractListItemsFromDom` (`src/scrapers/facebook/index.js` lines 1209–1210) the identifier is extracted as the first path segment of the absolute URL. For a group link such as `https://www.facebook.com/groups/xyz` this yields `id = 'groups'`; for a page link `https://www.facebook.com/pages/123` it yields `id = 'pages'`. The group/page branches return this `id` unchanged (lines 1217–1221). `normalizeGroupSearchResult` and `normalizePageSearchResult` keep `resolvedId = id` (lines 1014–1015, 1042–1043). `searchByType` deduplicates with `results.set(normalized.id, normalized)` (lines 1258–1261), so every group/page DOM result overwrites the same key and at most one result can be returned. This breaks AC4 (group/page single-type response) and AC7 (groups DOM fallback with a `/groups/` link) and weakens NFR-14.

- **AC7 — DOM fallback link filtering does not follow the per-type selectors in the spec.**
  - *Evidence*: `extractListItemsFromDom` (`src/scrapers/facebook/index.js` lines 1186–1223) selects the first `a[href]` in a listitem/article and does not verify that the link is a profile link, a page link, or contains `/groups/`. This deviates from the recommended selectors in AC7 (people with a profile link, groups with a `/groups/` link, etc.) and can cause non-result list items to be mis-classified as people/pages/groups.

- **AC7 / Task 7 — Missing DOM-fallback tests for people, pages, and groups.**
  - *Evidence*: `tests/scrapers/facebook-search.test.js` (lines 262–497) tests normalizers, `searchFacebook` happy paths, validation, and dispatcher routing, but contains no cases that force `extractHydrationJson` to return `[]` and then inject fake DOM results into `extractListItemsFromDom` for `people`, `pages`, or `groups`. A grep for `fallback` in the file only finds the normalizer “falls back to DOM-style fields” test. The existing `tests/scrapers/facebook-index.test.js` covers `searchTweets` (post DOM fallback) indirectly, but the new per-type DOM fallbacks are not exercised.

- **AC10 / Task 7 — API route test coverage for `type`, `parallel`, and `location` is incomplete.**
  - *Evidence*: `tests/api/facebook-routes-integration.test.js` adds only an invalid `type` 400 test (lines 90–94). It does not add route-level cases for valid `type` values, `parallel`, or `location`, and the expected `tests/api/facebook-scrape.test.js` was not created/updated for these fields.

- **AC1 / AC10 — API route does not validate `limit`; invalid values surface as HTTP 500.**
  - *Evidence*: `api/routes/facebook.js` line 210 passes `limit: Number(limit)` without validation. When `limit` is `'abc'`, `Number('abc')` is `NaN`; `searchFacebook` correctly throws in `validateSearchLimit` (`src/scrapers/facebook/index.js` lines 1110–1115), but the route catch at `api/routes/facebook.js` lines 217–221 returns a generic 500 `Facebook scrape failed. See server logs.` and logs the error. This is inconsistent with the `type` validation in the same route, which returns 400 with a clear message.

- **AC1 — `searchFacebook` JSDoc / destructured option surface omits `authCookie` and `parallel`.**
  - *Evidence*: `src/scrapers/facebook/index.js` JSDoc for `searchFacebook` (lines 1292–1305) and the destructuring at line 1307 list `type`, `location`, `limit`, etc., but not `authCookie` or `parallel`. Both are still accepted through `options` (`authCookie` is consumed by `scrape()` before `searchFacebook` is called; `parallel` is passed through but ignored per AC2). This is a documentation/surface gap, not a functional failure.

- **AC7 / NFR-14 — Checkpoint detection only runs once, not inside the scroll loop.**
  - *Evidence*: `assertNoCheckpoint` is called only after the initial `page.goto` in `searchByType` (`src/scrapers/facebook/index.js` line 1242). The scroll loop (lines 1249–1287) does not re-check the URL or page body for checkpoint indicators. The Dev Notes call for checkpoint detection “during search,” so this is an incomplete behavior.

---

## AC / NFR Compliance (no issues found)

- **AC1 — Input Parameters / Validation**: query, type, and limit validation is implemented; `location` is appended; `authCookie` and `parallel` are handled/passed through. See `src/scrapers/facebook/index.js` lines 1098–1128, 1306–1323, and `src/scrapers/index.js` lines 242–247.
- **AC2 — Sequential vs Parallel**: `type: 'all'` calls the four helpers sequentially on the same page; `parallel` is accepted but not wired to `FacebookAccountPool`. Lines 1315–1320.
- **AC3 — `type: 'all'` Response Shape**: returns `{ posts, people, pages, groups }` with `platform: 'facebook'`. Lines 1316–1320 and normalizers 943–1053.
- **AC6 — Pagination and Velocity**: scroll loop, `maxScrolls=50`, `maxRetries` (default 8), `limit`, and 1.5–3s inter-scroll delay. Lines 1231–1287.
- **AC8 — Backward Compatibility**: `searchTweets` remains a named export and is a thin wrapper around `searchFacebook(..., { type: 'posts' })`. Lines 1326–1335.
- **AC9 — Unified Dispatcher**: `platformActionMap` added after global `actionMap`, preferred for `facebook`/`fb`, falls back to global map. `src/scrapers/index.js` lines 190–203.
- **AC10 — API Surface**: route destructures and validates `type`, passes `type`, `parallel`, `location`, `limit` to `scrapeArgs`. `api/routes/facebook.js` lines 145–213 (with the `limit` validation gap noted above).
- **NFR-10 — No storage**: `searchFacebook` and the route return JSON only; no persistence in `Operation`/Prisma.
- **NFR-13 — Privacy**: search helpers and `validateRawCookie` do not log `c_user`, `xs`, or raw HTML; checkpoint errors do not echo cookie values. `api/routes/facebook.js` lines 22–34; `src/scrapers/facebook/index.js` lines 1091–1095.
- **NFR-15 — Read velocity**: `maxScrolls=50` and inter-scroll delay `delay(1500, 3000)` (1.5–3s). `src/scrapers/facebook/index.js` lines 1235, 1249, 1285.
