---
epic: 13
story: 13.11
status: done
created: '2026-09-19'
updated: '2026-09-20'
baseline_commit: 94b487150b0013809fb0f1ea3ff3f0d98b06d825
review_loop_iteration: 0
followup_review_recommended: false
deferred:
  - summary: >-
      Browser-DOM fallback (signer-bridge scrapeMarketplaceListings) does not propagate
      sortBy/condition — fallback URL builds only /marketplace/<loc>/search?query=...
    evidence: >-
      Verified at src/scrapers/social/facebook/signer-bridge.js:1377-1386 — the bridge
      builds its own targetUrl and ignores sort/condition options. Closing this needs a
      bridge-side URL-param extension, beyond a trivial patch.
    location: >-
      src/scrapers/social/facebook/crawler.js:2279 + src/scrapers/social/facebook/signer-bridge.js:1377
    severity: low
  - summary: >-
      GraphQL browse_request_params key names sort_by/item_condition are unverified
      against live Facebook; sibling keys use filter_* convention.
    evidence: >-
      maybe-false — cannot confirm without a live authenticated Marketplace session;
      OQ-1 in this spec already flags param-name verification. Test coverage now pins
      the emitted payload shape.
    location: >-
      src/scrapers/social/facebook/crawler.js:2144-2151
    severity: medium (unverified)
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

## Review Triage Log

### 2026-09-20 — Review pass
- verdicts: 20 findings — high 0, medium 3, low 7, false 6, maybe-false 1 (3 intent-alignment observations folded into entries below)
- findings:
  - `[medium]` `[patch]` REST `POST /api/facebook/scrape` silently drops `sortBy`/`condition` (Blind+VeriGap) — added destructure + forwarding in `api/routes/facebook.js:385-386,589-590`.
  - `[medium]` `[patch]` Non-dryRun GraphQL `browse_request_params.sort_by`/`item_condition` unverified (VeriGap) — added non-dryRun tests asserting `sort_by`/`item_condition` on captured `variables` (marketplace-filters.test.js).
  - `[medium]` `[patch]` AC-6 MCP-level validation untested (Intent+Blind) — added `executeFacebookEpic4Tool` tests covering sortBy/condition accept/reject/normalize.
  - `[low]` `[patch]` `sortBy` case normalization inconsistent across surfaces (Edge×4, Blind) — `.trim().toLowerCase()` applied in crawler, MCP, CLI, and URL builder.
  - `[low]` `[patch]` MCP forwards raw unnormalized `condition` (Edge+Blind) — now validates then forwards normalized/deduped value.
  - `[low]` `[patch]` Checkpoint `targetKey` omitted `sortBy`/`condition` — resume collision possible; added both to key (crawler.js:2274).
  - `[low]` `[patch]` AC-1 dryRun tests asserted only `typeof searchUrl` — added assertions on emitted `sortBy=`/`itemCondition=` params through `crawler.start`.
  - `[false]` `[reject]` MCP lat/long pairing unenforced (Edge) — crawler.js:1991-1995 already throws when only one coordinate is supplied; MCP forwards and crawler rejects.
  - `[false]` `[reject]` MCP/crawler skip lat/lng range validation (VeriGap other) — crawler.js:1968-1986 validates -90..90 / -180..180.
  - `[maybe-false]` `[defer]` GraphQL param names `sort_by`/`item_condition` vs live Facebook (Blind) — unverifiable offline; recorded in `deferred`.
  - `[low]` `[reject]` CLI has no early `--sort-by`/`--condition` validation (Blind) — crawler `XACT_4001` surfaces the same error one hop later; early-CLI check adds a branch for cosmetic gain.
  - `[low]` `[reject]` `--condition ',,'` empty-token input deferred to crawler (Edge) — same justification; crawler emits the invalid-args error.
  - `[low]` `[defer]` Browser-DOM fallback ignores sort/condition (Blind) — bridge signature gap; recorded in `deferred`.
  - `[low]` `[reject]` Non-string `sortBy` coercion at MCP (Edge) — merged into the case-normalization patch; `String().trim().toLowerCase()` + Set check rejects junk uniformly.
  - intent-alignment R1/R2/R3 observations (3) — descriptive only; R1+R3 confirmed as implemented; R2's MCP/CLI/GraphQL-payload test gaps converted into the medium patch entries above.

## Auto Run Result

**Summary.** Story 13.11 completed: `sortBy` (`relevance|price_asc|price_desc|date_listed`) and `condition` (`new|used`, single or array) added to `FacebookCrawler.marketplace()`, mapped to Facebook URL params (`sortBy=price_ascend|price_descend|creation_time_descend`, `itemCondition=new,used`) and to GraphQL `browse_request_params` (`sort_by`, `item_condition`). MCP `x_facebook_marketplace` inputSchema now exposes all geo/category/cursor params plus the two new ones, with handler validation. CLI `xactions scrape` gains `--sort-by`/`--condition`. REST `/api/facebook/scrape` forwards both new params (review patch).

**Files changed.**
- `src/scrapers/social/facebook/crawler.js` — sortBy/condition validation (XACT_4001), GraphQL param mapping, checkpoint targetKey extension, optionalArgs + JSDoc.
- `src/scrapers/social/facebook/normalize-marketplace.js` — `buildMarketplaceSearchUrl` emits `sortBy=`/`itemCondition=` with lowercase normalization.
- `src/mcp/server.js` — inputSchema +7 fields; handler validates and normalizes sortBy/condition before forwarding.
- `src/cli/commands/scrape.js` — `--sort-by`, `--condition` (comma-split, lowercased) flags.
- `api/routes/facebook.js` — forward `sortBy`/`condition` from request body into marketplace scrapeArgs (review patch).
- `tests/scrapers/social/facebook/marketplace-filters.test.js` — new; 42 tests covering validation matrix, URL params, MCP surface, and non-dryRun GraphQL payload.

**Review findings.** 20 findings → 7 patched (3 medium, 4 low), 6 rejected as false/refuted, 3 deferred (2 in `deferred` frontmatter + low rejected notes above), remainder were descriptive observations folded into the patch entries.

**Verification performed.** `vitest run tests/scrapers/social/facebook/marketplace-filters.test.js` → **42/42 pass**; `crawler-marketplace.test.js` → 9/9 pass (earlier single failure was a pre-existing SSR-fallback flake on baseline, not a regression — reproduced on clean `94b4871`); `tests/mcp/facebook-epic4-tools.test.js` + `facebook-tools.test.js` → pass.

**Residual risks.** GraphQL param names (`sort_by`, `item_condition`) are convention-matched but unverified against live Facebook — flagged in `deferred`; live verification is gated on an authenticated session. Browser-DOM fallback does not carry the new filters.

**Follow-up review recommended:** false — all patched entries are low/medium with test coverage; no unverified high-severity change remains.
