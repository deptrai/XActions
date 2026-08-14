# Blind Hunter Review — Story 7.2: Multi-Type Facebook Search

The unit tests pass, but this diff is held together with brittle DOM regex, a couple of real logic bugs, and a lot of "hope Facebook never changes the markup." Findings are grouped by severity.

## Critical / Logic Errors

1. **Group result IDs collapse to the literal string `groups` in DOM fallback.**
   In `extractListItemsFromDom` the ID regex only captures the first path segment:
   ```js
   const id = idMatch ? `profile.php?id=${idMatch[1]}` : (abs.match(/facebook\.com\/([^/?&#]+)/i)?.[1] || abs);
   ```
   For a group URL like `https://www.facebook.com/groups/xyz/`, the first segment is `groups`, so *every* group gets `id: 'groups'`. The `Map` in `searchByType` then deduplicates all of them to a single entry. The same flaw hits `/pages/<id>` URLs.  
   **Evidence:** `src/scrapers/facebook/index.js:1209-1210`

2. **`extractHandleFromUrl` cannot parse numeric `profile.php?id=...` URLs.**
   Line 935 tests `^profile\.php\?id=\d+/i` against `URL.pathname.split('/')[0]`, but `pathname` does not include the query string, so the regex never matches. It then returns the first path segment (`profile.php`). Any numeric user therefore becomes `username: 'profile.php'`.
   **Evidence:** `src/scrapers/facebook/index.js:929-937`

3. **People DOM fallback sets `username` to a broken `profile.php?id=...` string.**
   `extractListItemsFromDom` sets `username: id` at line 1215. For numeric profiles, `id` is `profile.php?id=<number>`. `normalizePeopleSearchResult` then uses that as the resolved `username` because it has priority over URL parsing. The spec says to derive the username from the profile URL path; this does the opposite and produces unusable values.
   **Evidence:** `src/scrapers/facebook/index.js:1209-1215`, `src/scrapers/facebook/index.js:973-985`

4. **API route forwards search-only params to `marketplace`.**
   The ternary at `api/routes/facebook.js:204-211` is `action === 'search' || action === 'marketplace'`, so `type`, `parallel`, `location`, and `limit` are passed to `scrapeMarketplace`. AC10 is explicitly about `search`; `marketplace` should not receive `type` or `parallel`.
   **Evidence:** `api/routes/facebook.js:204-211`

5. **API route coerces `limit` with `Number()` but never validates it, turning bad input into 500s.**
   `limit: Number(limit)` at line 210 produces `NaN` for `'abc'`, `0` for `null`, and `-5` for `'-'`. None of these are caught in the route; they explode inside `searchFacebook` and come back as 500. The route already validates `type`; it should validate `limit` (and `location`/`parallel`) before launching a browser.
   **Evidence:** `api/routes/facebook.js:162-170`, `api/routes/facebook.js:204-211`

## DOM / Resilience Issues

6. **DOM list-item extraction is a grab-bag of brittle heuristics.**
   `extractListItemsFromDom` grabs the first `a[href]` without verifying it is the entity link (1190-1192), extracts `name` from the first newline of all `textContent` (1195), builds `lines` from every descendant including nested duplicates (1199-1201), and guesses `category` as the first line that is not `name`, `members`, `likes`, or `privacy` (1207). It also detects `privacy` with `/public|private|closed|secret/i`, which matches substrings like "publication" or "secretary." For groups it does not even require the link to contain `/groups/`. Buttons and metadata will be misclassified as results.
   **Evidence:** `src/scrapers/facebook/index.js:1186-1228`

7. **Post DOM text/author/timestamp extraction is easily polluted by UI chrome.**
   `extractPostsFromDom` picks the longest `[dir="auto"]` text by space count (1130-1145), so "Like · Comment · Share" or a long comment can win over the actual post text. The author loop has a small `NON_PROFILE` allow-list and no guard for paths like `facebook.com/settings`, `facebook.com/help`, etc. (1147-1159). The timestamp fallback `allLinks.find(... /\d/.test(a.textContent))` can match any link containing a digit, e.g. "5 likes" (1164-1167).
   **Evidence:** `src/scrapers/facebook/index.js:1125-1184`

8. **Checkpoint detection only happens once, immediately after `goto`.**
   `assertNoCheckpoint` is called once at line 1242. The Story 7.2 spec says to detect checkpoints by URL *or body indicators* and during search, not just on the initial navigation. A checkpoint that appears after scrolling goes undetected until a later, more opaque failure.
   **Evidence:** `src/scrapers/facebook/index.js:1091-1096`, `src/scrapers/facebook/index.js:1241-1242`

9. **`extractHydrationJson` is given a no-op fallback while a separate DOM fallback is bolted on.**
   `searchByType` passes `fallbackExtractor: async () => []` to `extractHydrationJson` (1252-1254). The contract of `extractHydrationJson` is that the fallback extractor should supply DOM results when hydration is empty; here it is explicitly neutered, and then `searchByType` runs its own DOM extraction anyway. This causes `page.evaluate` to be called twice per iteration for no benefit and is confusing to maintain.
   **Evidence:** `src/scrapers/facebook/index.js:1252-1266`

10. **`searchByType` performs an extra scroll after the limit is already reached.**
    If hydration or DOM extraction satisfies `limit` inside the current iteration, the DOM call is skipped (1263-1266), but the code still executes `page.evaluate(() => window.scrollTo(...))` and the 1.5-3s delay at lines 1284-1286 before the `while` condition re-evaluates. That is a wasted round-trip and delay.
    **Evidence:** `src/scrapers/facebook/index.js:1249-1286`

## Maintainability / Test Gaps

11. **`normalizeSearchResult` is dead code in the production search flow.**
    The new `searchByType` uses `normalizeByType` and the four new normalizers. `normalizeSearchResult` (913-923) is no longer called by `searchTweets`/`searchFacebook`; it is only exercised by its own unit tests. If it is still public API it should be documented, otherwise deprecated/removed.
    **Evidence:** `src/scrapers/facebook/index.js:913-923`, `src/scrapers/facebook/index.js:1076-1084`

12. **`scrape` declares unimplemented placeholder actions in `platformActionMap`.**
    `platformActionMap` maps `post_comments`, `group_posts`, and `group_comments` to function names that do not exist in the Facebook module (192-199). Callers get a confusing "Action not available" error instead of a clear "not yet implemented" message, and the map is re-created on every `scrape` call.
    **Evidence:** `src/scrapers/index.js:190-203`

13. **`searchFacebook` passes stale `options` (still containing `type: 'all'`) into the per-type searches.**
    At lines 1316-1319 `searchByType` is called with the unmodified `options` object, which still has `type: 'all'`. `searchByType` currently ignores `options.type` and uses its own `type` parameter, but passing a stale, irrelevant value is fragile and will break as soon as someone refactors `searchByType` to read `options.type`.
    **Evidence:** `src/scrapers/facebook/index.js:1306-1323`

14. **JSDoc for `POST /api/facebook/scrape` is stale.**
    The JSDoc at lines 132-141 still documents the old body (`{ action, url, query, authCookie }`) and does not mention `type`, `parallel`, `location`, or `limit`.
    **Evidence:** `api/routes/facebook.js:132-141`

15. **Tests do not exercise DOM fallback or individual people/pages/groups searches.**
    `tests/scrapers/facebook-search.test.js` only mocks `extractHydrationJson` via `makeSearchPage` and never drives `extractPostsFromDom` or `extractListItemsFromDom`. There are no tests for `type: 'people'`, `'pages'`, or `'groups'` in isolation, no checkpoint detection tests, no `fb` alias test, no `searchTweets`-as-wrapper assertion, and no verification that `marketplace` is unaffected. The API integration test only covers an invalid `type` and not valid `type`/`limit`/`location`/`parallel` combinations.
    **Evidence:** `tests/scrapers/facebook-search.test.js:383-497`, `tests/api/facebook-routes-integration.test.js:87-91`
