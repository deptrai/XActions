---
epic: 13
story: 13.11
status: ready-for-dev
created: '2026-09-19'
updated: '2026-09-19'
baseline_commit: ace25a82
---

# Story 13.11: Marketplace Advanced Filters — `sortBy`/`condition` + MCP/CLI exposure

## Epic
Epic 13: High-Throughput Hybrid Scraping Engine

## Goal
Hoàn thiện phần còn lại của Facebook Marketplace Advanced Filters: thêm `sortBy` (price/date) và `condition` (new/used) vào `marketplace()` action, và expose đầy đủ các tham số địa lý/lọc đã có (`radiusKm`/`latitude`/`longitude`/`categoryId`) cùng tham số mới qua MCP `x_facebook_marketplace` inputSchema và CLI flags.

## FRs Covered
- FR-111 (Marketplace Advanced Filters — Sort & Condition)

## NFRs Covered
- NFR-16 (backward compat — existing args unchanged)
- NFR-20 (real implementations, no mocks)

## Story

As an XActions consumer (Nowing Lead Hub),
I want to sort and filter Facebook Marketplace results by price/date/condition via MCP and CLI,
So that I can surface the most relevant listings without post-processing on the consumer side.

## Background / Current State

`FacebookCrawler.marketplace()` (`src/scrapers/social/facebook/crawler.js:1834-2060`) **đã implement sẵn**:
- `query`, `location` (+ slug/URL resolution)
- `minPrice`/`maxPrice` (aliases `priceMin`/`priceMax`)
- `category` slug + `categoryId` numeric
- `latitude`/`longitude`/`radiusKm` (default 50 khi có coords)
- `limit` (1–200, default 50), `cursor`/`after`, `dryRun`

**Gaps còn lại:**
1. `sortBy` — chưa có (cần `relevance|price_asc|price_desc|date_listed`).
2. `condition` — chưa có (`new|used` filter).
3. **MCP `x_facebook_marketplace` inputSchema** (`src/mcp/server.js:1815-1829`) chỉ expose `query/location/limit/minPrice/maxPrice/category/dryRun/authCookie` — **thiếu** `categoryId`, `latitude`, `longitude`, `radiusKm`, `cursor` dù handler đã đọc chúng (line 4661-4690).
4. **CLI** (`src/cli/commands/scrape.js`) đã có nhiều flag nhưng cần xác nhận `sortBy`/`condition` mới được thêm.

## Acceptance Criteria

### AC-1: `sortBy` support in `marketplace()`
**Given** `args.sortBy` ∈ `relevance|price_asc|price_desc|date_listed`
**When** `marketplace()` is called
**Then** it validates the enum (invalid → `XACT_4001` INVALID_ARGS)
**And** maps to the corresponding Marketplace URL/search param (e.g. `sortBy=price_ascend`/`creation_time_descend` per Facebook's sort keys)
**And** defaults to `relevance` when omitted

### AC-2: `condition` support in `marketplace()`
**Given** `args.condition` ∈ `new|used` (array or single)
**When** `marketplace()` is called
**Then** it validates and maps to Facebook's itemCondition filter param
**And** combines correctly with existing price/category/geo filters

### AC-3: MCP inputSchema completion
**Given** the `x_facebook_marketplace` tool definition
**When** inputSchema is read
**Then** it exposes `categoryId`, `latitude`, `longitude`, `radiusKm`, `cursor`, `sortBy`, `condition` in addition to existing fields
**And** handler validation already reads these (verify + add input validation for new fields)

### AC-4: CLI flags
**Given** `xactions scrape --action marketplace`
**When** `--sort-by`, `--condition`, `--radius-km`, `--latitude`, `--longitude`, `--category-id` are passed
**Then** they map into the `marketplace()` args and reach the crawler

### AC-5: Backward compatibility
**Given** existing callers using only current args
**When** they call `marketplace()` without sortBy/condition
**Then** behavior is unchanged (defaults applied, no breakage)

### AC-6: Tests (real, no mocks)
**Given** the arg-validation matrix
**When** `vitest run tests/scrapers/social/facebook` executes
**Then** invalid `sortBy`/`condition` → `XACT_4001`
**And** valid combos produce correct search URL params (assert via `buildMarketplaceSearchUrl` / dryRun preview)
**And** MCP tool input validation accepts/rejects new fields correctly

## Files to Create/Modify
- `src/scrapers/social/facebook/crawler.js` — `marketplace()`: add `sortBy`/`condition` validation + param mapping
- `src/scrapers/social/facebook/normalize-marketplace.js` — `buildMarketplaceSearchUrl`: include sort/condition params
- `src/mcp/server.js` — `x_facebook_marketplace` inputSchema + validation for new fields
- `src/cli/commands/scrape.js` — add `--sort-by`, `--condition` flags
- `tests/scrapers/social/facebook/marketplace-filters.test.js` — new

## Out of Scope
- Re-implementing existing minPrice/maxPrice/geo filters (already done)
- Facebook Marketplace write/post actions
- Post-fetch result re-sorting (sort is a query-time param, not client-side)

## Open Questions
- OQ-1: Exact Facebook sort/condition URL param keys → verify against live Marketplace URL structure during dev (dryRun preview makes this observable).
- OQ-2: Does Facebook support `condition` on all categories/locales? → Validate per-category; graceful fallback to no-condition if unsupported.

## Dev Notes
- `dryRun: true` returns `{ preview: { ...options, searchUrl } }` — use it to assert the URL params without network.
- `resolveMarketplaceLocation` + `buildMarketplaceSearchUrl` already centralize URL construction — extend there, not inline.
- **Expected param names** (verify against live Marketplace URL, then add to `buildMarketplaceSearchUrl` params array alongside existing `minPrice=`/`lat=`/`radius=`/`cursor=`):
  - `sortBy` → Facebook search sort key, e.g. `sortBy=price_ascend` / `sortBy=price_descend` / `sortBy=creation_time_descend` (map `relevance` → omit param, default).
  - `condition` → `itemCondition=new` / `itemCondition=used` (comma-join for multi).
  - Existing params follow the pattern `name=value` joined by `&` in the `/search/?` path — new keys follow the same convention.
