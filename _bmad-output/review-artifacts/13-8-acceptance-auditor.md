# Acceptance Auditor Report — Story 13.8: Facebook Hybrid Marketplace

**Inputs:**
- Spec: `implementation-artifacts/13-8-facebook-hybrid-marketplace.md`
- Diff: `review-artifacts/13-8-facebook-hybrid-marketplace.diff`

**Verification run (read-only):**
- `npx vitest run tests/scrapers/social/facebook/crawler-marketplace.test.js` — passed (9/9)
- `npx tsc --noEmit` — passed
- `npx prisma validate` — passed

Despite test/type-check pass, the following deviations from the ACs/Technical/Architecture requirements were found.

---

## Findings

### AC-2 — GraphQL response parser misses `data.marketplaceSearch` and uses an undocumented `marketplace_search.feed_units` envelope
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1567-1574`
- **Explanation:** AC-2 requires the code to parse `data.marketplace_search_listings`, `data.searchResults`, `data.browse`, or `data.marketplaceSearch` for `edges` and `page_info`. The implementation checks `res?.data?.marketplace_search?.feed_units`, `marketplace_search_listings`, `searchResults`, `browse`, then falls back to `res?.data`. It never checks `res?.data?.marketplaceSearch`. If the live response shape is `{ data: { marketplaceSearch: { edges, page_info } } }`, the fallback to `res?.data` looks for `res.data.edges` and fails. The `feed_units` intermediate layer is also not described in AC-2.

### AC-2 — `categoryId` is not restricted to a numeric id before being used in GraphQL variables
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1442-1444` (regex) and `crawler.js:1552` (variables)
- **Explanation:** AC-2 states `commerce_search_and_rp_category_id` is added only when `categoryId` is a numeric string/id. The validation regex `^[a-zA-Z0-9_\-]+$` accepts non-numeric values such as `'abc-123'`, which are then passed into the GraphQL variables.

### AC-4 / AC-7 — `limit` is not validated as a positive integer
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1512` — `const limit = Math.max(1, Math.min(Number(args?.limit) || 50, 200));`
- **Explanation:** AC-4 requires `limit` clamped to `[1, 200]` and AC-7 requires it to be a positive integer. `Number('abc') || 50` silently defaults to 50 for non-numeric strings, and non-integer values (e.g. `3.5`) are accepted and forwarded as `count`/`first` to GraphQL, which can cause invalid requests.

### AC-5 — Browser fallback DOM extraction does not follow the legacy pattern
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1601-1621`; legacy pattern in `src/scrapers/facebook/marketplace.js:56-132`
- **Explanation:** AC-5 step 2 requires the fallback to use both selectors `a[href*="/marketplace/item/"], a[href*="/marketplace/listing/"]`, the `aria-label` regex, fallback text parsing, and then `normalizeMarketplaceListing()`. The new code only uses `a[href*="/marketplace/item/"]`, parses `id`/`title`/`price`/`image` from `innerText.split('\n')`, does not extract `location` or `seller`, does not use the specified regex, and does not call `normalizeMarketplaceListing()`.

### AC-5 — HTTP SSR fetch fallback is missing
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1587-1639`
- **Explanation:** AC-5 step 3 requires, when no browser bridge is available, to fetch the search URL with `FacebookClient.request('GET', ...)` or `got-scraping` and best-effort parse the embedded `require("MarketplaceSearchSchema")`/JSON hydration. The implementation only attempts the browser bridge and then returns an empty `posts` array with a `note`, skipping the SSR tier entirely.

### AC-7 — `location` URL validation is too permissive
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1498-1499`
- **Explanation:** AC-7 requires a `location` URL to be `facebook.com/marketplace/*` or be rejected. The regex `^https?:\/\/(?:www\.)?facebook\.com\/(?:marketplace\/)?` is unanchored and the `marketplace/` segment is optional, so it accepts URLs such as `https://www.facebook.com/profile`.

### AC-7 — `query` is not validated against URL/malicious input
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1367-1385`
- **Explanation:** AC-7 states `query` must be non-empty and not a URL/malicious. Only emptiness and max-length (500) are checked; a query like `http://malicious.com` is accepted and placed into the GraphQL payload.

### AC-8 — API/MCP `marketplace` still route to legacy `scrapeMarketplace`; new hybrid fields are ignored and no 13.10 migration note is present
- **Evidence:**
  - `src/scrapers/index.js:182` — global action map `marketplace: 'scrapeMarketplace'`
  - `api/services/facebookScrape.js:53-55` — delegates to `scrape()`
  - `src/mcp/server.js:3175-3192` — imports and calls `scrapeMarketplace`
  - `src/mcp/server.js:1572-1587` — `x_facebook_marketplace` input schema lacks `categoryId`, `latitude`, `longitude`, `radiusKm`, `cursor`, `after`, `priceMin`, `priceMax`
- **Explanation:** Although `api/routes/facebook.js` extracts and passes the new hybrid filters, `scrape('facebook', 'marketplace')` is resolved to legacy `scrapeMarketplace` in `src/scrapers/index.js`, which ignores `categoryId`, `cursor`, `dryRun`, lat/long, etc. MCP `x_facebook_marketplace` also uses the legacy path and does not expose the new input dimensions. AC-8 allows keeping the legacy surface in 13.8, but explicitly requires a clear migration note when not switched; none is present in the MCP, dispatcher, or `src/scrapers/index.js`.

### AC-6 — Checkpoint `targetKey` includes `categoryId`, `minPrice`, and `maxPrice` beyond the AC-specified pattern
- **Evidence:** `src/scrapers/social/facebook/crawler.js:1646`
- **Explanation:** AC-6 specifies `targetKey: <query[:location][:category]>` (similar to the `search` pattern). The implementation builds the key from `[rawQuery, location, category, categoryId, minPrice, maxPrice]`. While this aligns with the implementation artifact's internal “Review Findings” patch to include all active filter dimensions, it is a literal deviation from the published AC and should be reflected in an updated AC or accepted as a deliberate design decision.

### AC-10 — ATDD test suite has coverage gaps for AC-2, AC-4, AC-5, AC-6, and AC-8
- **Evidence:** `tests/scrapers/social/facebook/crawler-marketplace.test.js` (entire file; e.g. no assertions on request variables or API/MCP wiring)
- **Explanation:** The 9 tests all pass, but they do not assert:
  - GraphQL variables (`bqf.callsite`, `filter_price_lower_bound`/`filter_price_upper_bound` in cents, `categoryId`)
  - `limit` clamp/integer behavior
  - HTTP SSR fallback (only an empty bridge is tested)
  - Real browser DOM extraction (the AC-5 fallback test uses a hard-coded `mockBridge` object with pre-canned data, not the evaluate logic in `crawler.js`)
  - Thin Event/Redis stream emission
  - API route `scrapeArgs` wiring or MCP input schema

---

## Summary

The diff implements the core `marketplace` action, registration, normalization, schema, deprecation markers, and API field extraction correctly. The main acceptance gaps are in **fallback completeness** (missing SSR tier and simplified DOM extraction), **input validation** (`query` URL check, `location` URL strictness, `limit`/`categoryId` numeric checks), **GraphQL response parsing coverage**, and **caller migration** (API/MCP still hit the legacy scraper without a 13.10 migration note). The ATDD tests pass but do not exercise the legacy-equivalent fallback logic or fully assert the GraphQL variable contract.
