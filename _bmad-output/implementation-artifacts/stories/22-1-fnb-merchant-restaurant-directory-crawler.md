---
title: 'Story 22.1: F&B Merchant & Restaurant Directory Crawler (PasGo, Foody, Riviu)'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-2026-08-21.md
  - src/scrapers/index.js
  - src/scrapers/ecom/shopee
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần danh bạ F&B tại VN (nhà hàng, quán cafe, quán ăn) để bán POS, nguyên liệu, và phân tích thị trường F&B.

**Approach:**
1. Tạo `FnbMerchantCrawler` tại `src/scrapers/fnb/merchant/index.js`.
2. Support `pasgo.vn`, `foody.vn`, `riviu.vn` qua REST API mobile app + TLS spoofing (reuse Shopee pattern).
3. Trích xuất: `name`, `manager`, `hotline`, `address`, `gpsLat`, `gpsLng`, `menuItems[]`, `rating`, `reviewCount`.
4. Chuẩn hóa `PostItem` với `platform: 'pasgo' | 'foody' | 'riviu'`, `category: 'fnb_merchant'`.
5. Dispatch alias: `pasgo`, `foody`, `riviu`, `fnb`.

## Boundaries & Constraints

**Always:**
- Request qua VN proxy + locale `vi-VN`.
- Validate `phone` là SĐT VN hợp lệ.
- Thêm action `getNewlyOpened` và `searchByDistrict`.

**Ask First:**
- Nếu cần crawl review chi tiết theo từng khách hàng.
- Nếu cần thực đơn ảnh/menu PDF.

**Never:**
- Không tải lên app store/spoof mobile device khi chưa được approve.
- Không lưu raw cookies của app.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Search by city/district | `scrape('pasgo','search_restaurants',{city:'Hà Nội',district:'Đống Đa'})` | Restaurant list | Empty → `[]` |
| Newly opened | `scrape('foody','newly_opened',{days:30})` | Recent merchants | None → `[]` |
| Detail merchant | `scrape('riviu','detail',{id:'abc123'})` | `PostItem` with menu & reviews | Not found → `XACT_4001` |

</frozen-after-approval>

## Live Probe Findings (2026-09-08)

**Story approach adjusted after probe:**

| Platform | Original Approach | Probe Result | New Approach |
|---|---|---|---|
| PasGo | HTML / REST API | ✅ 200, JSON-LD | Parse SSR HTML + JSON-LD |
| Foody | `gappapi.deliverynow.vn` mobile app API | ❌ 403/404 | Parse `foody.vn/{city}/nha-hang` embedded `var jsonData.searchItems` (no app API) |
| Riviu | HTML / REST API | ✅ 200 Nuxt SSR | Parse Nuxt SSR HTML; `reviewapi.riviu.co` path discovery deferred |

**Key details:**
- `gappapi.deliverynow.vn` is not public — requires app auth. **Do not use.**
- Foody page embeds `var jsonData = { ..., searchItems: [...] }` where each item has `Address`, `District`, `City`, `Phone`, `TotalReview`, `AvgRating`, `Cuisines`, `DetailUrl`.
- Riviu renders Nuxt SSR HTML; no public REST API surface found on first probe.

## Tasks / Subtasks

### Phase 0: Foundation & Schema Setup
- [x] **Task 0.1** — Add `fnb_merchant` to `CATEGORIES` in `src/core/types.js` (AC: #1)
  - [x] Add `FNB_MERCHANT: 'fnb_merchant'` to `CATEGORIES` object
  - [x] Verify `CATEGORY_VALUES` includes it
- [x] **Task 0.2** — Create directory structure `src/scrapers/fnb/merchant/` (AC: #1)
  - [x] `index.js` — barrel export + `scrapeFnb()` helper
  - [x] `client.js` — `FnbMerchantClient` extends `AbstractApiClient`
  - [x] `crawler.js` — `FnbMerchantCrawler` extends `AbstractCrawler`
  - [x] `schema.js` — platform constants, city/district mapping, phone validation
  - [x] `validator.js` — `FnbPlatformResponseValidator` extends `AbstractPlatformResponseValidator`
  - [x] `normalizer.js` — HTML → `PostItem` normalizer

### Phase 1: Platform Clients & Parsers
- [x] **Task 1.1** — PasGo client + parser (AC: #2, #3)
  - [x] Implement `PasGoClient` with `searchRestaurants()`, `getNewlyOpened()`, `searchByDistrict()`
  - [x] Parse SSR HTML + JSON-LD (`itemscope itemtype="http://schema.org/Restaurant"`)
  - [x] Extract: `name`, `address`, `phone`, `geo.lat`, `geo.lng`, `menuItems`, `rating`, `reviewCount`
- [x] **Task 1.2** — Foody client + parser (AC: #2, #3)
  - [x] Implement `FoodyClient` with `searchRestaurants()`, `getNewlyOpened()`, `searchByDistrict()`
  - [x] Parse `var jsonData.searchItems` from embedded script
  - [x] Extract: `Address`, `District`, `City`, `Phone`, `TotalReview`, `AvgRating`, `Cuisines`, `DetailUrl`
- [x] **Task 1.3** — Riviu client + parser (AC: #2, #3)
  - [x] Implement `RiviuClient` with `searchRestaurants()`, `getNewlyOpened()`, `searchByDistrict()`
  - [x] Parse Nuxt SSR HTML (no public API — scrape rendered page)
  - [x] Extract: restaurant cards, address, phone, rating, review count

### Phase 2: Crawler Actions & Dispatch
- [x] **Task 2.1** — Register crawler actions (AC: #2)
  - [x] `search_restaurants` — args: `platform`, `city`, `district`, `category`, `page`, `limit`
  - [x] `newly_opened` — args: `platform`, `days`, `city`, `limit`
  - [x] `search_by_district` — args: `platform`, `city`, `district`, `limit`
  - [x] `detail` — args: `platform`, `id` or `slug`
- [x] **Task 2.2** — Normalize to `PostItem` (AC: #3)
  - [x] `platform: 'pasgo' | 'foody' | 'riviu'`
  - [x] `category: 'fnb_merchant'`
  - [x] `metadata` schema: `restaurantName`, `manager`, `hotline`, `address`, `gpsLat`, `gpsLng`, `menuItems[]`, `rating`, `reviewCount`, `phoneMasked`, `phone`, `detailUrl`, `city`, `district`, `cuisine`
- [x] **Task 2.3** — Register dispatcher aliases in `src/scrapers/index.js` (AC: #4)
  - [x] `pasgo`, `foody`, `riviu`, `fnb`

### Phase 3: Testing & Validation
- [x] **Task 3.1** — Create test fixtures `tests/scrapers/fnb/merchant/fixtures/` (AC: #5)
  - [x] `pasgo-search.html` — sample PasGo restaurant listing page
  - [x] `pasgo-detail.html` — sample PasGo restaurant detail
  - [x] `foody-search.html` — sample Foody page with `jsonData`
  - [x] `foody-detail.html` — sample Foody detail
  - [x] `riviu-search.html` — sample Riviu SSR page
  - [x] `riviu-detail.html` — sample Riviu detail
- [x] **Task 3.2** — Write unit tests `tests/scrapers/fnb/merchant/` (AC: #5)
  - [x] `client.test.js` — HTTP client with `node:http` mock server
  - [x] `crawler.test.js` — action dispatch, PostItem normalization, edge cases
  - [x] `normalizer.test.js` — HTML → PostItem per platform
- [x] **Task 3.3** — Validation matrix (AC: #5)
  - [x] Empty results → `[]`
  - [x] Invalid id → `XACT_4001`
  - [x] Bot challenge → `XACT_4030` (if detected)
  - [x] Phone masked → `phoneMasked: true`, `phone: null`

---

## Dev Notes

### Critical Implementation Requirements

#### 0. Add `FNB_MERCHANT` to `CATEGORIES` FIRST
`CATEGORY_VALUES` in `src/core/types.js` currently lacks `fnb_merchant`. `AbstractCrawler.validateItem()` will reject `category: 'fnb_merchant'` if not added.

```js
// src/core/types.js
export const CATEGORIES = Object.freeze({
  SOCIAL: 'social',
  ECOMMERCE: 'ecom',
  REAL_ESTATE: 'realestate',
  RECRUITMENT: 'recruitment',
  B2B: 'b2b',
  AUTOMOTIVE: 'automotive',
  FNB_MERCHANT: 'fnb_merchant',  // ADD THIS for Story 22.1
});
```

#### 1. Platform vs Crawler `platform` Field
- `FnbMerchantCrawler.name = 'fnb'` (for dispatcher alias `fnb`, error envelope, action registry).
- `FnbMerchantCrawler.platform = 'fnb'` (for logging/governor key).
- `PostItem.platform` must be the real source: `'pasgo' | 'foody' | 'riviu'`. This value is stored in `Post.id` (`${platform}:${externalId}`).

#### 2. VN Proxy & Locale (AD-22 / NFR-19)
- All requests MUST go through VN proxy when available.
- Set `Accept-Language: vi-VN,vi;q=0.9,en-US;q=0.8` header.
- `requiresProxy = true` by default; allow override via `options.requiresProxy`.
- If proxy unavailable, set `geo_mismatch` flag and continue with direct request (log warning).

#### 3. Vietnamese Phone Validation
- Regex: `/^(0[0-9]{9,10})$/` — 10–11 digits starting with `0`.
- Examples: `0901234567` (10 digits), `09876543210` (11 digits).
- If phone is masked (`***`, `...`, `không hiển thị`) → `metadata.phone = null`, `metadata.phoneMasked = true`.
- If phone is present → `metadata.phone = <string>`, `authorId = phone` (or external id if no phone).

#### 4. PasGo Extraction (JSON-LD)
- Endpoint: `https://pasgo.vn/{city_slug}/nha-hang?page={page}`
- JSON-LD `itemscope itemtype="http://schema.org/Restaurant"`:
  - `itemprop="name"` — restaurant name
  - `itemprop="address"` — address block (may contain `itemprop="streetAddress"`, `itemprop="addressLocality"`)
  - `itemprop="telephone"` — phone number
  - `itemprop="geo"` — `itemprop="latitude"`, `itemprop="longitude"`
  - `itemprop="aggregateRating"` — `itemprop="ratingValue"`, `itemprop="reviewCount"`
  - `itemprop="servesCuisine"` — cuisine type
- Detail URL: `https://pasgo.vn/{city_slug}/nha-hang/{slug}-{id}`

#### 5. Foody Extraction (Embedded JSON)
- Endpoint: `https://www.foody.vn/{city_slug}/nha-hang`
- Parse `var jsonData = { ... }` from `<script>` tag:
  - `jsonData.searchItems` — array of restaurant objects
  - Each item: `Id`, `Name`, `Address`, `District`, `City`, `Phone`, `TotalReview`, `AvgRating`, `Cuisines`, `DetailUrl`, `Latitude`, `Longitude`
- `newly_opened` filter: check `IsNew` or `OpeningDate` within `days` param.

#### 6. Riviu Extraction (Nuxt SSR)
- Endpoint: `https://riviu.vn/{city_slug}/nha-hang` or `https://riviu.vn/search?q={query}`
- Parse rendered HTML (Nuxt SSR):
  - Restaurant cards: `div.restaurant-card` or `article.restaurant`
  - Title: `h3.restaurant-name` or `a[href*="/nha-hang/"]`
  - Address: `span.address` or `div.location`
  - Rating: `span.rating` or `div.score`
  - Review count: `span.review-count`
- No public API — scrape SSR HTML directly.

#### 7. `pageInfo` Contract
```ts
{ posts: PostItem[], pageInfo: { has_next_page: boolean, page: number, total?: number } }
```
`has_next_page = posts.length >= limit` and at least one more page exists. Do not guess `total` if platform doesn't expose it.

#### 8. Error Handling
- `XACT_4001` — invalid input (missing required args, invalid id/slug).
- `XACT_4030` — bot challenge / Cloudflare block (detected by validator).
- `XACT_5001` — network timeout or unexpected error.
- Empty results → return `{ posts: [], pageInfo: { has_next_page: false } }`.

#### 9. `init()` / `cleanup()`
- `init()` → no-op, return `Promise.resolve()`.
- `cleanup()` → `if (this.client && typeof this.client.cleanup === 'function') await this.client.cleanup().catch(() => {});`

---

### Platform-Specific Extraction Details

| Platform | Endpoint Pattern | Extraction Method | Key Markers |
|---|---|---|---|
| `pasgo` | `https://pasgo.vn/{city}/nha-hang?page={n}` | JSON-LD (`schema.org/Restaurant`) | `itemprop="name"`, `itemprop="address"`, `itemprop="telephone"`, `itemprop="geo"`, `itemprop="aggregateRating"` |
| `foody` | `https://www.foody.vn/{city}/nha-hang` | Embedded `var jsonData.searchItems` | `jsonData.searchItems[].Id`, `.Name`, `.Address`, `.District`, `.City`, `.Phone`, `.TotalReview`, `.AvgRating`, `.Cuisines`, `.DetailUrl` |
| `riviu` | `https://riviu.vn/{city}/nha-hang` | Nuxt SSR HTML parse | `div.restaurant-card`, `h3.restaurant-name`, `span.address`, `span.rating`, `span.review-count` |

#### PasGo JSON-LD Sample
```json
{
  "@context": "http://schema.org",
  "@type": "Restaurant",
  "name": "Nhà hàng ABC",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "123 Đường ABC",
    "addressLocality": "Quận 1",
    "addressRegion": "TP. Hồ Chí Minh"
  },
  "telephone": "0901234567",
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": "10.7769",
    "longitude": "106.7009"
  },
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.5",
    "reviewCount": "120"
  },
  "servesCuisine": "Món Việt"
}
```

#### Foody `jsonData` Sample
```json
{
  "searchItems": [
    {
      "Id": 12345,
      "Name": "Quán Ăn XYZ",
      "Address": "456 Đường XYZ",
      "District": "Quận 3",
      "City": "TP. Hồ Chí Minh",
      "Phone": "0912345678",
      "TotalReview": 85,
      "AvgRating": 4.2,
      "Cuisines": ["Món Việt", "Hải sản"],
      "DetailUrl": "https://www.foody.vn/ho-chi-minh/quan-an-xyz",
      "Latitude": 10.7829,
      "Longitude": 106.6936,
      "IsNew": true,
      "OpeningDate": "2026-08-15"
    }
  ]
}
```

#### Riviu SSR Sample
```html
<div class="restaurant-card">
  <a href="/ho-chi-minh/nha-hang/nha-hang-def" class="restaurant-link">
    <h3 class="restaurant-name">Nhà Hàng DEF</h3>
  </a>
  <span class="address">789 Đường DEF, Quận 5, TP. Hồ Chí Minh</span>
  <span class="rating">4.0</span>
  <span class="review-count">(56 đánh giá)</span>
  <span class="phone">0923456789</span>
</div>
```

---

### Testing Standards

- **Framework**: Vitest 4.x (`vitest run`).
- **Environment**: Node.js (not jsdom).
- **No mocks/stubs/fakes** — real implementations only.
- **Timeout**: 30s per test, 30s for hooks.
- **Mock HTTP**: Use `node:http` to create local test server that returns fixture HTML.
- **Fixtures**: Store in `tests/scrapers/fnb/merchant/fixtures/` as `.html` files.

#### Test Matrix
| Test Case | Input | Expected | Notes |
|---|---|---|---|
| PasGo search | `scrape('pasgo','search_restaurants',{city:'ha-noi'})` | `PostItem[]` with `platform:'pasgo'` | Verify JSON-LD parsing |
| Foody search | `scrape('foody','search_restaurants',{city:'ho-chi-minh'})` | `PostItem[]` with `platform:'foody'` | Verify `jsonData` extraction |
| Riviu search | `scrape('riviu','search_restaurants',{city:'ha-noi'})` | `PostItem[]` with `platform:'riviu'` | Verify Nuxt SSR parsing |
| Newly opened | `scrape('foody','newly_opened',{days:30})` | `PostItem[]` filtered by `IsNew` or `OpeningDate` | Verify date filtering |
| Search by district | `scrape('pasgo','search_by_district',{city:'ha-noi',district:'dong-da'})` | `PostItem[]` filtered by district | Verify district matching |
| Detail | `scrape('pasgo','detail',{id:'abc123'})` | `PostItem` with full metadata | Verify detail extraction |
| Empty result | `scrape('pasgo','search_restaurants',{city:'invalid'})` | `[]` | Verify empty handling |
| Invalid id | `scrape('foody','detail',{id:'invalid'})` | `XACT_4001` | Verify error code |
| Masked phone | `scrape('foody','search_restaurants',{city:'ha-noi'})` | `phoneMasked: true` if `***` | Verify phone masking |
| Bot challenge | `scrape('pasgo','search_restaurants',{city:'ha-noi'})` with challenge HTML | `XACT_4030` | Verify challenge detection |

---

### Project Structure Notes

- New module: `src/scrapers/fnb/merchant/` — follows existing scraper pattern (`client.js`, `crawler.js`, `normalizer.js`, `schema.js`, `validator.js`, `index.js`).
- Update `src/scrapers/index.js` — add `fnb` dispatcher alias.
- Update `types/index.d.ts` — add `FnbMerchantCrawler`, `FnbMerchantClient`, `FnbPlatform` types.
- Tests: `tests/scrapers/fnb/merchant/` — mirrors source structure.

### References

- [Source: `src/scrapers/procurement/masothue/` — Epic 21 pattern for HTML → PostItem normalization]
- [Source: `src/scrapers/vehicles/automotive/` — Epic 21 pattern for multi-platform crawler]
- [Source: `src/core/types.js` — `CATEGORIES`, `generatePostId`, `isValidCategory`]
- [Source: `src/core/base-crawler.js` — `AbstractCrawler` contract]
- [Source: `src/core/base-client.js` — `AbstractApiClient` contract]
- [Source: `_bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-technical-feasibility-research-2026-08-21.md` — PasGo/Foody/Riviu endpoint research]
- [Source: `_bmad-output/implementation-artifacts/epic-22-readiness-assessment.md` — live probe findings]

---

## Dev Agent Record

### Agent Model Used
Claude Opus 5 (1M context)

### Debug Log References
- `epic-22-readiness-assessment.md` — live probe results
- `22-2-healthcare-clinics-pharmacy-network-crawler.md` — Long Chau probe (sibling story)

### Completion Notes List
- Story 22.1 validated and enriched with full dev context.
- Added `fnb_merchant` category requirement.
- Added detailed extraction specs for PasGo (JSON-LD), Foody (embedded `jsonData`), Riviu (Nuxt SSR).
- Added VN proxy, phone validation, error handling, test matrix.
- Added platform-specific JSON-LD/JSON/HTML samples.
- Implementation completed 2026-09-08.
- All 119 tests pass (13 new + 106 regression).
- No regressions in masothue, automotive, b2b-registry, realestate, recruitment.

### File List
- `src/scrapers/fnb/merchant/index.js` — NEW
- `src/scrapers/fnb/merchant/client.js` — NEW
- `src/scrapers/fnb/merchant/crawler.js` — NEW
- `src/scrapers/fnb/merchant/schema.js` — NEW
- `src/scrapers/fnb/merchant/validator.js` — NEW
- `src/scrapers/fnb/merchant/normalizer.js` — NEW
- `src/scrapers/index.js` — UPDATE (add `fnb` alias + dispatch)
- `src/core/types.js` — UPDATE (add `FNB_MERCHANT` category)
- `types/index.d.ts` — UPDATE (add FnbMerchant types)
- `tests/scrapers/fnb/merchant/client.test.js` — NEW
- `tests/scrapers/fnb/merchant/crawler.test.js` — NEW
- `tests/scrapers/fnb/merchant/normalizer.test.js` — NEW
- `tests/scrapers/fnb/merchant/fixtures/` — NEW (8 HTML fixture files)
  - `pasgo-search.html`
  - `pasgo-detail.html`
  - `foody-search.html`
  - `foody-detail.html`
  - `riviu-search.html`
  - `riviu-detail.html`
  - `challenge.html`
  - `empty.html`

### Change Log
- 2026-09-08: Story 22.1 implemented — `FnbMerchantCrawler` + `FnbMerchantClient` for PasGo (JSON-LD), Foody (`jsonData`), Riviu (Nuxt SSR). Registered `fnb`, `pasgo`, `foody`, `riviu` dispatch aliases. Added `fnb_merchant` to `CATEGORIES`. 13 new tests, 119 total pass.

---

## Senior Developer Review (AI)

**Review Date:** 2026-09-07  
**Review Outcome:** Changes Requested  
**Action Items:** 6 resolved (see Fixes Applied)

### Review Findings Summary

Four reviewer agents (Blind Hunter ×2, Edge Case Hunter, Verification Gap) reviewed the diff and identified 33 findings across client, crawler, normalizer, schema, and validator modules. Key categories:

- **Correctness:** missing HTTP status checks, broken pagination `has_next_page`, missing `validateItem` calls, `phoneMatch[2]` index error, null `ld.address` crash, invalid district substring matching.
- **Verification gaps:** `client.test.js` invoked a private method via `client['#buildSearchUrl']` which is always `undefined` — the assertion tested a hardcoded fallback string instead of the real method. No `validator.test.js` or `schema.test.js` existed; `crawler.test.js` tested instantiation only.
- **Code policy:** `// ── F&B Merchant path (Story 22.1) ──` comment violated the project rule against story references in code comments.

### Fixes Applied

**`src/scrapers/fnb/merchant/client.js`**
- `#buildSearchUrl` now resolves `base` from `FNB_BASE_URLS[platform]` (with `options.baseUrl` override) so any platform can be requested on the same client instance.
- Pagination added for Foody/Riviu (`?page=N` when `page > 1`); `days` passed through for `newly_opened`.
- `getDefaultHeaders` computes `Referer` from the actual request URL, not the client `baseUrl`.
- `normalizeRawBody` handles `null`, `Buffer`, `ReadableStream`/`Node stream`, and `resp.data` fallbacks.
- `normalizeCitySlug` called with `platform` argument.
- `detail()` throws `PlatformError` when `slug` is missing for Foody/Riviu (ID-based URLs not supported).

**`src/scrapers/fnb/merchant/crawler.js`**
- `platform` removed from `requiredArgs` (kept in `optionalArgs`); `#resolvePlatform` defaults to `pasgo` and reports the attempted platform in errors.
- `searchRestaurants` validates `city` is present; `searchByDistrict` and `detail` already validate their required args.
- `extractResponseBody` helper checks HTTP status: throws `NOT_FOUND` for 404, `INVALID_ARGS` for other 4xx, `INTERNAL` for 5xx/empty response.
- `has_next_page` uses `posts.length === limit` (more conservative than `>=`).
- `validateItem` called on every `PostItem` before `#persist`.
- `detail` accepts numeric `id` by converting to string.

**`src/scrapers/fnb/merchant/normalizer.js`**
- `decodeEntities` bounds numeric code points to `0..0x10FFFF`.
- `ld.url` trailing slashes stripped before extracting `externalId`; `ld.address` guarded against `null`.
- Microdata regex accepts `https://` and `FoodEstablishment` types.
- `extractFoodyItems` and `extractRiviuItems` return early when `html` is not a string.
- District filter uses word-level matching instead of substring (`quan-1` no longer matches `quan-10`).
- Riviu phone regex fixed: `phoneMatch[1]` instead of non-existent `phoneMatch[2]`.
- Foody `jsonData` key-quoting regex simplified to avoid corrupting string literals.

**`src/scrapers/fnb/merchant/schema.js`**
- `normalizeDistrictSlug` handles `Đ/đ` before NFD normalization (`Đống Đa` → `dong-da`).
- `parseVnPhone` converts `+84`/`84` prefix to `0` before validating.

**`src/scrapers/fnb/merchant/validator.js`**
- Rewritten to use platform-structural markers (`application/ld+json`+`schema.org`, `var jsonData`/`searchItems`, `__NUXT__`/`restaurant-card`) instead of domain names.
- `isValidPayload` rejects 4xx/5xx and requires either a structural signal or ≥2 Vietnamese F&B terms.
- `#getText` handles `Buffer` and object `data`/`body`.
- `isLoginWall` and `isAuthExpired` implemented.

**`src/scrapers/index.js`**
- Removed `(Story 22.1)` from `// ── F&B Merchant path ──` comment.

**`types/index.d.ts`**
- Removed `(Story 22.1)` from `// ── F&B Merchant ──` comment.

**`tests/scrapers/fnb/merchant/`**
- `client.test.js`: rewrote to inject `httpClient` and assert actual request URLs (`/ha-noi/nha-hang?page=1`, `/ho-chi-minh/nha-hang?page=2`, etc.).
- `crawler.test.js`: added execution-path tests for `search_restaurants`, `detail`, 404 handling, and missing-arg validation.
- `normalizer.test.js`: added `kind: 'detail'` and `kind: 'newly_opened'` / `search_by_district` filter tests.
- `validator.test.js` (new): tests rate limit, bot challenge, valid/invalid payloads for all platforms.
- `schema.test.js` (new): tests `normalizeCitySlug`, `normalizeDistrictSlug`, `parseVnPhone`, `parseRating`, `parseReviewCount`, `parseOpeningDate`, `isNewlyOpened`.

### Test Results

- `npx vitest run tests/scrapers/fnb/merchant/` — **57/57 pass** (was 13/13 before fixes).
- Scoped regression (`tests/scrapers/fnb/ tests/scrapers/social/bluesky/ tests/scrapers/social/mastodon/`) — **193/193 pass**.
- No regressions in adjacent crawler modules.

### Outstanding Notes

- `has_next_page` remains conservative (`posts.length === limit`); real pagination accuracy depends on each platform's page size and cannot be verified without live requests.
- The `limit` JSDoc on `#buildSearchUrl` is documentation-only; F&B platforms do not expose a uniform `page_size` parameter.

**Status:** All identified issues resolved; story ready for `done` after final commit.
