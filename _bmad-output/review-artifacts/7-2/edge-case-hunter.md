# Edge-Case Review — Story 7.2 (Multi-Type Facebook Search)

Reviewed the implementation diff against the Story 7.2 spec. The requested test suite passes (`tests/scrapers/facebook-search.test.js`, `tests/api/facebook-routes-integration.test.js`). Below are the edge-case findings, grouped by the focus areas in the request.

---

## 1. Invalid `type`

- **`src/scrapers/facebook/index.js:1098-1102`** — `validateSearchType` rejects any `type` not in the `VALID_SEARCH_TYPES` Set (`posts`, `people`, `pages`, `groups`, `all`). It handles non-string values because `Set.has(nonString)` is simply `false`.
- **`src/scrapers/facebook/index.js:1307`** — `searchFacebook` defaults `type` to `'posts'` when omitted, then validates. Good.
- **`api/routes/facebook.js:162-170`** — Returns 400 for invalid `type` strings during `action === 'search'`, but only when `type !== undefined && type !== null`.
  - `type: ''` is still validated and rejected (empty string is not in `VALID_TYPES`).
  - `type: null` is silently treated as omitted/defaulted to `posts`. If the intent is that an explicit `null` is invalid, this is a gap.

## 2. Missing `query`

- **`src/scrapers/facebook/index.js:1104-1108`** — `validateSearchQuery` throws for non-string or empty/whitespace `query`. Good.
- **`api/routes/facebook.js:158-160`** — Returns 400 for missing/empty `query` on `search`/`marketplace`. Good.
- **Risk:** `api/routes/facebook.js:158-160` uses `!query?.trim()`. If `query` is a non-string (e.g., a number or object), `query?.trim()` can throw a `TypeError` and fall through to the generic `catch`, producing a 500 instead of a 400. The route does not type-check `query`.

## 3. `limit` 0 / negative / non-numeric

- **`src/scrapers/facebook/index.js:1110-1115`** — `validateSearchLimit` uses `Number(limit)` and rejects `0`, negative, non-numeric, non-integer, and `Infinity`. Tests in `tests/scrapers/facebook-search.test.js:411-415` cover `0`, `-5`, and `'abc'`. Good.
- **Risk:** `api/routes/facebook.js:210` does `...(limit !== undefined && { limit: Number(limit) })`. It does **not** validate `limit`, so:
  - `limit: 0`, `limit: ''`, `limit: null`, `limit: false`, `limit: 'abc'`, and `limit: 1.5` are all forwarded to the scraper and cause `searchFacebook` to throw.
  - Because the route wraps all scraper errors in a generic 500 (`api/routes/facebook.js:217-221`), malformed `limit` values become 500s instead of 400s.
- **Code smell:** `searchFacebook` (`src/scrapers/facebook/index.js:1307-1311`) validates `limit` but does not coerce `options.limit` back to a number. `searchByType` then receives the original value (which may be a numeric string like `'5'`). It works because JS coerces in numeric comparisons/slice, but it is brittle.

## 4. `type: 'all'` with 0 results

- **`src/scrapers/facebook/index.js:1315-1321`** — Runs the four sub-searches sequentially and always returns an object with `posts`, `people`, `pages`, `groups` keys.
- **`tests/scrapers/facebook-search.test.js:469-473`** — Covers the all-empty case.
- **Gap:** No unit test covers `type: 'all'` with a *mix* of empty and non-empty categories (e.g., posts found but groups empty). The current implementation handles this correctly, but it is untested.

## 5. Hydration failure triggering DOM fallback

- **`src/scrapers/facebook/index.js:1252-1254`** — Calls `extractHydrationJson` with `fallbackExtractor: async () => []`. This disables the generic DOM fallback inside `hydration.js:81-84`.
- **`src/scrapers/facebook/index.js:1263-1266`** — Always runs the type-specific DOM fallback (`extractPostsFromDom` or `extractListItemsFromDom`) when `results.size < limit`. So DOM extraction does run when hydration is insufficient.
- **Risk:** If `extractHydrationJson` itself throws (e.g., `page.evaluate` timeout), `searchByType` has no try/catch. The DOM fallback is never attempted and the whole search aborts.
- **Coverage gap:** `tests/scrapers/facebook-index.test.js:900-992` exercises the post DOM fallback through `searchTweets`, but `tests/scrapers/facebook-search.test.js` only tests hydration-driven results. The DOM fallback for `people`, `pages`, and `groups` is not covered.

## 6. `location` handling

- **`src/scrapers/facebook/index.js:1117-1123`** — `buildSearchQuery` appends ` near ${location.trim()}` only when `location` is a non-empty string, then the combined string is `encodeURIComponent`-ed. No separate URL parameter is added. Good.
- **`tests/scrapers/facebook-search.test.js:425-437`** — Verifies `coffee near Seattle` is encoded correctly.
- **Risk:** `api/routes/facebook.js:209` does `...(location && { location: location.trim() })` without checking `typeof location === 'string'`. A non-string `location` (number, object) will throw a `TypeError` and produce a 500.
- **Gap:** No API-level test for `location` with special characters or whitespace-only `location`.

## 7. `parallel` deferred but accepted

- **`src/scrapers/facebook/index.js:1306-1321`** — `searchFacebook` accepts `parallel` in `options` but never reads it. `type: 'all'` always runs the four sub-searches sequentially on the single provided `page`. This matches AC2 (deferred to Story 7.4).
- **`api/routes/facebook.js:208`** — Passes `parallel` through without boolean validation. Harmless, but undocumented.
- **Gap:** No test demonstrates that `parallel: true` is accepted yet ignored (a `type: 'all'` + `parallel: true` test would document the contract).

## 8. Sequential navigation on same `page`

- **`src/scrapers/facebook/index.js:1316-1319`** — Reuses the same `page` for all four sub-searches. Each `searchByType` navigates via `page.goto` to the appropriate `SEARCH_TYPE_URLS[type]` (`src/scrapers/facebook/index.js:1062-1067`). Good.
- **Edge:** If any sub-search throws (e.g., checkpoint detection in `assertNoCheckpoint` at `src/scrapers/facebook/index.js:1091-1096`), the whole `searchFacebook` call aborts; there is no per-type recovery. This is acceptable for the current story but is a hard failure mode for `type: 'all'`.

## 9. `maxScrolls` vs `maxRetries`

- **`src/scrapers/facebook/index.js:1249`** — Loop condition correctly combines `results.size < limit && retries < maxRetries && scrolls < maxScrolls`.
- **`src/scrapers/facebook/index.js:1278-1282`** and **`:1286`** — `retries` increments only when no new results are added; `scrolls` increments every iteration. Good.
- **Edge:** `maxRetries` and `maxScrolls` are not validated. Passing `0` or a negative value causes immediate loop exit and an empty result after `goto`/`delay`. These should probably be rejected or clamped.
- **Edge:** Because the `while` condition is only checked at the top, the body always completes one full iteration (including an extra scroll + delay) even if `limit` is reached inside that iteration.

## 10. Deduplication

- **`src/scrapers/facebook/index.js:1245`** — Uses a `Map` keyed by `normalized.id`, adding both hydration and DOM results. Same id suppresses duplicates. Good.
- **Risk:** Hydration and DOM can identify the same entity with different ids (e.g., numeric `User.id` vs username extracted from URL), so the same entity may appear twice in the final output.
- **Bug — DOM fallback id extraction for groups/pages:**
  - `extractListItemsFromDom` (`src/scrapers/facebook/index.js:1209-1210`) extracts the id as the first path segment of the link URL.
  - For group URLs such as `facebook.com/groups/{id}` the first segment is `groups`, and for page URLs such as `facebook.com/pages/{name}/{id}` the first segment is `pages`.
  - **All group/page DOM results from such URLs share the same `id` (`'groups'` or `'pages'`)**, so the `Map` keeps only the last one. This defeats the DOM fallback when hydration is missing for these types.
  - For people, the same logic could produce `id: 'people'` if Facebook ever uses `/people/...` profile URLs.
- **Follow-on effect:** For these bad ids, `extractListItemsFromDom` sets `username: id` for people (`:1215`) and `normalizePeopleSearchResult` will use the bad id as the username.

## 11. URL encoding

- **`src/scrapers/facebook/index.js:1239`** — `searchUrl` uses `encodeURIComponent(query)`. Good.
- **`src/scrapers/facebook/index.js:1117-1123`** — `buildSearchQuery` appends ` near ${location}` before encoding, so the entire effective query is encoded once. Good.
- **`tests/scrapers/facebook-search.test.js:181-193`** and **`:244-256`** — Cover special characters and `%` encoding for post search. Good.
- **Gap:** No explicit test for `location` special characters (`&`, `#`, `%`) or for URL encoding of `people`/`pages`/`groups` search types.
- **Note:** `SEARCH_TYPE_URLS` uses paths like `/search/posts` (no trailing slash), while AC5 lists `/search/posts/?q=...` (with trailing slash). Functionally both resolve, but the implementation diverges from the spec wording.

## 12. Checkpoint detection

- **`src/scrapers/facebook/index.js:1086-1089`** and **`:1091-1096`** — `isCheckpointUrl` / `assertNoCheckpoint` check the page URL for `/checkpoint/` or `facebook.com/checkpoint`. Works for real and fake `page.url()`.
- **`src/scrapers/facebook/index.js:1242`** — `assertNoCheckpoint` is called only once, immediately after `page.goto`.
- **Risk:** The implementation does **not** inspect the page body for checkpoint indicators, even though the Dev Notes mention "URL contains `/checkpoint/` or body contains checkpoint indicators". A checkpoint that does not change the URL (e.g., an interstitial rendered at the original URL) will be missed.
- **Edge:** If a checkpoint appears mid-scroll, it will not be detected because `assertNoCheckpoint` is not called inside the scroll loop.

## 13. Real vs fake page behavior

- `searchByType` relies on `page.goto`, `page.url()`, and `page.evaluate(fn, ...args)`. Fake pages in the test suite implement these.
- `extractHydrationJson` (`src/scrapers/facebook/hydration.js:62-79`) serializes a function and `typenames` into the browser; real Puppeteer will execute it. The `WeakSet` cycle guard is correct.
- `extractPostsFromDom` / `extractListItemsFromDom` (`src/scrapers/facebook/index.js:1125-1228`) pass `NON_PROFILE_SEGMENTS` (an array) and `type` (a string) as `page.evaluate` arguments; both are serializable. Good.
- The fake `page.url()` in tests returns a static non-checkpoint URL, so `assertNoCheckpoint` never fires unless explicitly set.

## 14. `searchTweets` backward-compat wrapper

- **`src/scrapers/facebook/index.js:1333-1335`** — Is exactly the thin wrapper required by AC8: `return searchFacebook(page, query, { ...options, type: 'posts' });`.
- **`src/scrapers/facebook/index.js:1708`** — `searchTweets` is still in the default export; the named export is preserved. Good.
- **Old tests still pass:** `tests/scrapers/facebook-index.test.js:900-992` continue to exercise the post DOM fallback through `searchTweets`.
- **Wrapper semantics:** It overrides any `options.type` with `'posts'`, so `searchTweets` cannot be accidentally used for other types. Correct.
- **Stale test name:** `tests/scrapers/facebook-search.test.js:148-165` is titled "scrape(...,'search',...) routes to searchTweets", but the dispatcher now routes `facebook`/`search` to `searchFacebook`. The test still passes because the post result shape is identical, but the description is misleading.

## 15. Other cross-cutting observations

- **API validation hole:** `api/routes/facebook.js:202-211` forwards `type`, `parallel`, `location`, and `limit` to `scrape()` without validating them. Combined with the generic 500 error handler, malformed inputs for `limit`/`location`/`query` type become 500s instead of 400s.
- **Validation order:** `searchFacebook` (`src/scrapers/facebook/index.js:1309-1311`) validates `query` → `type` → `limit` before any navigation. Good.
- **Dispatcher routing:** `src/scrapers/index.js:190-203` adds `platformActionMap` and correctly maps `facebook`/`fb` `search` to `searchFacebook`, falling back to the global `actionMap` for other platforms. Good.
- **Top-level `searchTweets` re-export:** `src/scrapers/index.js:81` and `:348` still export the Twitter `searchTweets`. This is not a bug — Facebook callers should use `scrape('facebook','search',...)` or import from `src/scrapers/facebook/index.js`.

## 16. Recommendations for follow-up

1. Fix `extractListItemsFromDom` id extraction for `/groups/` and `/pages/` paths so the DOM fallback for groups and pages does not collapse all results to a single `id`.
2. Add API-level validation for `query` type, `limit` positivity/integer, and `location` string type so malformed inputs return 400, not 500.
3. Add unit tests for DOM fallback results for `people`, `pages`, and `groups`.
4. Add a test for `type: 'all'` with mixed empty/populated categories.
5. Consider coercing `searchFacebook`/`searchByType` `limit` to a number after validation to avoid string-limit coercion in the scroll loop.
