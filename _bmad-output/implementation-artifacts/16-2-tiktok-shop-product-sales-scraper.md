---
story_id: '16.2'
epic: 16
story_key: '16-2-tiktok-shop-product-sales-scraper'
status: "done"
phase: "Phase 3"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "3bf943541a7a3a49cc0f1cbfd726a99175d2748e"
---

# Story 16.2 — TikTok Shop Product & Sales Scraper

Status: done

## Story

As a **TikTok Affiliate & E-Commerce Merchant**,  
I want **cào danh sách sản phẩm bán chạy (`top_products`), hoa hồng affiliate, doanh số ước tính và đánh giá shop trên TikTok Shop qua `TikTokShopCrawler` kết hợp Signer Bridge (`a_bogus`/`msToken`)**,  
so that **tôi có thể phát hiện các sản phẩm Winning Products và các nhà bán hàng tiềm năng để tối ưu chiến dịch quảng cáo & affiliate marketing**.

---

## Scope Note

Story 16.2 triển khai TikTok Shop E-Commerce crawler trên nền tảng `AbstractCrawler` + `AbstractApiClient`:
1. **Module Location:** `src/scrapers/ecom/tiktok-shop/`
   - `crawler.js` — `TikTokShopCrawler` kế thừa `AbstractCrawler`
   - `client.js` — `TikTokShopClient` kế thừa `AbstractApiClient` sử dụng `got-scraping` và `TikTokBrowserBridge` / `SignerPagePool` cho chữ ký `a_bogus` / `msToken`
   - `validator.js` — `TikTokShopPlatformResponseValidator` phát hiện mã lỗi anti-bot (status !== 0, captcha challenge)
   - `normalize-product.js` — chuẩn hóa sản phẩm TikTok Shop thành `PostItem` với `category: 'ecom'`, ID namespaced `tiktokshop:${productId}`
   - `index.js` — xuất `TikTokShopCrawler`, `TikTokShopClient`, `scrapeTikTokShop`
2. **Actions:**
   - `top_products`: Cào danh sách sản phẩm bán chạy theo ngành hàng (`category`) hoặc từ khóa.
   - `product_detail`: Lấy chi tiết thông tin sản phẩm (giá, hoa hồng affiliate commission, số lượng đã bán, shop info).
   - `search_products`: Tìm kiếm sản phẩm TikTok Shop theo keyword.
3. **Signer Pool & Anti-Bot:**
   - Tái sử dụng `TikTokBrowserBridge` / `SignerPagePool` từ `src/scrapers/social/tiktok/signer-bridge.js` để tự động sinh `a_bogus` / `msToken`.
   - Bắt các lỗi `error !== 0` hoặc verify challenge để ném `BotChallengeError` / `RateLimitError`.
4. **Data Normalization:**
   - Trả về `PostItem` với `category: 'ecom'` và metadata: `{ price, originalPrice, currency: 'VND', soldCount, commissionRate, commissionAmount, rating, shopId, shopName, productId }`.
5. **Unified Dispatcher & Package Exports:**
   - Khai báo export `"./scrapers/ecom/tiktok-shop"` trong `package.json`.
   - Bổ sung nhánh `tiktok-shop` / `tiktokshop` vào `src/scrapers/index.js`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 16.2 [dòng 869-879]
- `_bmad-output/planning-artifacts/prd.md` — FR-77, NFR-11/12/13/15/18 [dòng 92, 114-120]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-2, AD-3, AD-11, AD-14, AD-18
- `src/scrapers/social/tiktok/signer-bridge.js` — `TikTokBrowserBridge`
- `src/scrapers/social/tiktok/client.js` — `TikTokClient` pattern
- `src/scrapers/ecom/shopee/` — E-commerce normalizer & crawler pattern
- `src/core/base-crawler.js` — `AbstractCrawler`
- `src/core/base-client.js` — `AbstractApiClient`
- `src/scrapers/index.js` — Unified dispatcher

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 15.2:** `TikTokBrowserBridge`, `SignerPagePool`.
- **Phụ thuộc Story 16.1:** `ShopeeCrawler` E-commerce normalizer pattern (`category: 'ecom'`).
- **Mở khóa Epic 17:** Real Estate & Procurement Intelligence (Chợ Tốt & Batdongsan).

---

## Acceptance Criteria

### AC-1: TikTokShopCrawler & Action Registration

* **Given** `TikTokShopCrawler` trong `src/scrapers/ecom/tiktok-shop/crawler.js` kế thừa `AbstractCrawler`
* **When** khởi tạo crawler
* **Then** 3 action sau được đăng ký với descriptor chuẩn `ActionDescriptor`:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth | category |
|---|---|---|---|---|---|---|
| `top_products` | `[]` | `['category', 'limit', 'page']` | `{ category: 'fashion', limit: 20 }` | `{ products: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }` | `false` | `ecom` |
| `product_detail` | `['productId']` | `[]` | `{ productId: '172948291048' }` | `{ product: PostItem }` | `false` | `ecom` |
| `search_products` | `['keyword']` | `['limit', 'page', 'sortBy']` | `{ keyword: 'son moi', limit: 20 }` | `{ products: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }` | `false` | `ecom` |

### AC-2: Dynamic Signing qua Signer Pool (`a_bogus`)

* **Given** `TikTokShopClient` trong `src/scrapers/ecom/tiktok-shop/client.js`
* **When** gửi request tới TikTok Shop API (ví dụ `/api/v1/oec/affiliate/product/list` hoặc `/api/v1/shop/product/detail`)
* **Then** URL được ký tự động bằng `TikTokBrowserBridge` / `SignerPagePool` sinh `a_bogus` và `msToken`.

### AC-3: Anti-Bot & Response Validation

* **Given** response từ TikTok Shop
* **When** response có `code !== 0` và `code !== 200`, hoặc chứa thông báo captcha / verify challenge
* **Then** `TikTokShopPlatformResponseValidator.isBotChallenge(response)` trả về `true`
* **And** throw `BotChallengeError` (`XACT_4030`, `statusCode: 403`).

### AC-4: E-Commerce Data Normalization

* **Given** danh sách sản phẩm hoặc chi tiết sản phẩm từ TikTok Shop
* **When** chuẩn hóa qua `normalize-product.js`
* **Then** sinh ra `PostItem` với ID namespaced `tiktokshop:${productId}` và `category: 'ecom'`.
* **And** metadata lưu trữ đầy đủ:
  - `productId`: ID sản phẩm
  - `price`: Giá bán (VND)
  - `originalPrice`: Giá gốc
  - `soldCount`: Số lượng đã bán
  - `commissionRate`: Tỷ lệ hoa hồng affiliate (%)
  - `commissionAmount`: Số tiền hoa hồng ước tính (VND)
  - `rating`: Điểm đánh giá (1.0 - 5.0)
  - `shopId`: ID shop bán
  - `shopName`: Tên shop bán
* **And** lưu trữ vào PostgreSQL qua `PrismaStore`.

### AC-5: Unified Dispatcher Integration

* **Given** `src/scrapers/index.js`
* **When** gọi `scrape('tiktok_shop' | 'tiktokshop', 'top_products', { category: 'electronics' })`
* **Then** tự động định tuyến sang `TikTokShopCrawler` và trả về kết quả chuẩn hóa.

### AC-6: Test Suite Coverage

* **Given** Vitest test suite `tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js`
* **When** chạy kiểm thử
* **Then** pass toàn bộ các trường hợp:
  - Đăng ký 3 action descriptors đúng
  - `top_products` trích xuất danh sách sản phẩm bán chạy kèm hoa hồng affiliate
  - `product_detail` lấy chi tiết sản phẩm
  - `search_products` tìm kiếm sản phẩm theo keyword
  - Xử lý anti-bot challenge khi `code !== 0`
  - Unified dispatcher hoạt động chính xác

---

## Tasks / Subtasks

- [x] Task 1 (AC-1, AC-2): Xây dựng `TikTokShopClient` & `TikTokShopPlatformResponseValidator`
  - [x] 1.1 Tạo `src/scrapers/ecom/tiktok-shop/client.js` kết nối `TikTokBrowserBridge`
  - [x] 1.2 Tạo `src/scrapers/ecom/tiktok-shop/validator.js`
- [x] Task 2 (AC-1, AC-4): Xây dựng `normalize-product.js`
  - [x] 2.1 Chuẩn hóa sản phẩm TikTok Shop thành `PostItem` (`category: 'ecom'`)
- [x] Task 3 (AC-1, AC-2, AC-3): Xây dựng `TikTokShopCrawler`
  - [x] 3.1 Đăng ký 3 actions `top_products`, `product_detail`, `search_products`
  - [x] 3.2 Triển khai handlers gọi TikTok Shop APIs
- [x] Task 4 (AC-5): Tích hợp Dispatcher & Package Exports
  - [x] 4.1 Tạo `src/scrapers/ecom/tiktok-shop/index.js`
  - [x] 4.2 Bổ sung nhánh `tiktokshop`/`tiktok_shop` vào `src/scrapers/index.js`
  - [x] 4.3 Khai báo export `"./scrapers/ecom/tiktok-shop"` trong `package.json`
- [x] Task 5 (AC-6): TDD Test Suite & Hoàn thiện
  - [x] 5.1 Viết `tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js`
  - [x] 5.2 Chạy pass test suite và sync sprint-status

---

### Review Findings

- [x] [Review][Patch] Validator treats `code: 200` as a bot challenge [src/scrapers/ecom/tiktok-shop/validator.js:107-112]
  `isBotChallenge()` returns `true` for any non-zero `code` on HTTP 200. AC-3 explicitly requires `code !== 0 && code !== 200`; a success payload with `code: 200` therefore throws `XACT_4030` instead of being accepted. **Fixed**: validator now treats `0` and `200` as success, and coerces string codes to numbers.

- [x] [Review][Patch] Crawler calls `savePosts()` which does not exist on the store [src/scrapers/ecom/tiktok-shop/crawler.js:111-112,159-160,209-210]
  `AbstractStore` and `PrismaStore` implement `storeBatch`/`storeContent`, not `savePosts`. The persistence branch is silently skipped and `PostItem` records are never saved to PostgreSQL, violating AC-4. **Fixed**: replaced all `savePosts` calls with `storeBatch(products, { upsert: true })`.

- [x] [Review][Patch] TikTok Shop URLs lack `aid` device param so the signer bridge cannot match them [src/scrapers/social/tiktok/signer-bridge.js:411, src/scrapers/ecom/tiktok-shop/client.js:179-186]
  `TikTokBrowserBridge.signUrl()` waits for a request whose URL contains the `aid` query value. `TikTokShopClient.buildApiUrl()` does not attach `aid`, so the listener never fires and signing either times out or returns no tokens. **Fixed**: `buildApiUrl` now injects `aid=1988` when not present.

- [x] [Review][Patch] `top_products` descriptor lists an unapproved `sortBy` optional arg [src/scrapers/ecom/tiktok-shop/crawler.js:49]
  AC-1 table defines `top_products` `optionalArgs` as `['category', 'limit', 'page']`; the code adds `sortBy`. **Fixed**: removed `sortBy` from `top_products` optionalArgs.

- [x] [Review][Patch] Price parser fails on dot thousand separators [src/scrapers/ecom/tiktok-shop/normalize-product.js:23]
  `rawPrice.replace(/[^\d.]/g, '')` keeps all dots. For Vietnamese prices like `"149.000"` it returns `149` instead of `149000`; for `"149.000.000"` it returns `NaN` and falls back to `0`. **Fixed**: treats dots as thousand separators when present, then removes them before parsing.

- [x] [Review][Patch] String API `code` values bypass validation [src/scrapers/ecom/tiktok-shop/validator.js:71,107,132]
  `typeof data?.code === 'number'` is `false` for `"40001"`, so the validator falls back to `code = 0` and treats error payloads as valid. **Fixed**: coerces string codes to `Number` consistently across `isValidPayload`, `isBotChallenge`, and `isRateLimit`.

- [x] [Review][Patch] `productsRaw` is not guaranteed to be an array [src/scrapers/ecom/tiktok-shop/crawler.js:99,197]
  If the upstream API returns `products: null` or `products: {}`, `for (const raw of productsRaw)` throws an unhandled `TypeError`. **Fixed**: wraps `productsRaw` with `Array.isArray` fallback to `[]`.

- [x] [Review][Patch] Numeric search keywords are rejected [src/scrapers/ecom/tiktok-shop/crawler.js:173]
  `typeof args?.keyword === 'string'` discards numeric product IDs such as `12345`. The keyword should be coerced with `String()`. **Fixed**: coerces keyword with `String()`.

- [x] [Review][Patch] Non-numeric `page` argument becomes the string `"NaN"` [src/scrapers/ecom/tiktok-shop/client.js:199,227, src/scrapers/ecom/tiktok-shop/crawler.js:88,186]
  `Number('abc')` is `NaN`; `Math.max(0, NaN)` is `NaN`, which `String()` converts to `"NaN"` and sends to the API. **Fixed**: added `|| 0` fallback after `Number()` for `limit` and `page` in both client and crawler.

- [x] [Review][Patch] `TikTokShopClient.sign()` does not wrap bridge errors [src/scrapers/ecom/tiktok-shop/client.js:105-116]
  If `signerBridge.signUrl()` throws, the raw error propagates rather than being converted into a `PlatformError` or falling back to stub signing. **Fixed**: wrapped `signerBridge.signUrl()` in try/catch and throws a `PlatformError` with `XACT_4030`.

- [x] [Review][Patch] `#getLazyBridge()` is dead code [src/scrapers/ecom/tiktok-shop/client.js:77-82]
  The private method is defined but never referenced elsewhere in the class. **Fixed**: removed `#getLazyBridge()`.

- [x] [Review][Patch] Missing `schemas/tiktokshop/ecom.json` for metadata validation [schemas/tiktokshop/ecom.json missing]
  No schema is registered for `platform: 'tiktokshop', category: 'ecom'`. `MetadataSchemaRegistry` falls back to `{ valid: true }`, so `PrismaStore` cannot enforce the TikTok Shop metadata contract. **Fixed**: added `schemas/tiktokshop/ecom.json`.

- [x] [Review][Patch] `scrapeTikTokShop` helper is untested [src/scrapers/ecom/tiktok-shop/index.js:28-39]
  The package subpath export convenience function has zero direct test coverage; a regression in lifecycle or delegation would not be caught. **Fixed**: added dedicated test, fixed `scrapeTikTokShop` to forward `store` to crawler.

- [x] [Review][Defer] Missing TypeScript declarations for TikTok Shop classes [types/index.d.ts]
  `TikTokShopClient`, `TikTokShopCrawler`, and `scrapeTikTokShop` are not declared. The project as a whole has not yet exported e-commerce scraper types, so this is pre-existing/out-of-scope for this story.

- [x] [Review][Defer] No telemetry, checkpoint, or Redis stream publishing in `TikTokShopCrawler` [src/scrapers/ecom/tiktok-shop/crawler.js]
  Other crawlers publish crawl events and save checkpoints. This is not required by any AC of Story 16.2 and can be added when the operational observability layer is standardized.

- [x] [Review][Defer] No cursor-based pagination support [src/scrapers/ecom/tiktok-shop/crawler.js, client.js]
  `pageInfo.end_cursor` is returned but `cursor`/`next_cursor` cannot be passed back into `getTopProducts`/`searchProducts`. AC-1 only requires `page`/`limit` pagination.

### Re-review Findings (2026-08-31)

- [x] [Review][Patch] `TikTokShopClient.getProductDetail()` does not validate `productId` [src/scrapers/ecom/tiktok-shop/client.js:220-224]
  `null`, `undefined`, or empty strings are coerced to `"null"`/`"undefined"` and sent as invalid `product_id` query parameters. Add an explicit `INVALID_ARGS` guard.

- [x] [Review][Patch] `TikTokShopClient.buildApiUrl()` can crash on `undefined` endpointPath or `null` params [src/scrapers/ecom/tiktok-shop/client.js:181-196]
  `endpointPath.startsWith('/')` throws if `endpointPath` is `undefined`; `Object.entries(params)` throws if `params` is `null`. Use `String()` and `params || {}` guards.

- [x] [Review][Patch] `TikTokShopCrawler.topProducts()` and `searchProducts()` accept `null` args [src/scrapers/ecom/tiktok-shop/crawler.js:86-89,173-188]
  `args?.limit`/`args?.page` guards are missing; passing `null` for `args` throws. Destructure from `args || {}`.

- [x] [Review][Patch] `TikTokShopCrawler.productDetail()` does not sanitize `productId` [src/scrapers/ecom/tiktok-shop/crawler.js:127-139]
  Whitespace-only or non-string `productId` passes the truthy check. Trim and validate with `String(productId).trim()`.

- [x] [Review][Patch] `scrapeTikTokShop()` ignores a caller-provided client and can crash on `null` options [src/scrapers/ecom/tiktok-shop/index.js:28-39]
  Always constructs `new TikTokShopClient(options)` even when `options.client` exists. Also `options.store` is duplicated via `...options`. Accept `options.client` and guard `options || {}`.

- [x] [Review][Patch] `normalizeTikTokShopProduct()` can store `NaN` for numeric fields [src/scrapers/ecom/tiktok-shop/normalize-product.js:55-58]
  `Number()` of a non-numeric string yields `NaN`. Use `Number.isFinite()` fallback for `soldCount`, `commissionRate`, and `rating`.

- [x] [Review][Patch] `buildTikTokShopPageInfo()` coerces numeric cursor `0` to `null` [src/scrapers/ecom/tiktok-shop/normalize-product.js:114-123]
  `nextCursor !== ''` check treats `0` as falsy and returns `end_cursor: null`. Preserve `0` with explicit `null`/`undefined`/`''` checks.

- [x] [Review][Patch] `normalizeTikTokShopProduct()` duplicates title in `content` when no description [src/scrapers/ecom/tiktok-shop/normalize-product.js:51-52,79]
  Fallback `description = ... || title` causes `content: "title\n\ntitle"`. Only append description when it differs from title.

- [x] [Review][Patch] `buildTikTokShopPageInfo()` overrides explicit `has_more: false` [src/scrapers/ecom/tiktok-shop/normalize-product.js:118]
  `inferredHasNext` recomputes from cursor and page size even when `hasMore` is explicitly `false`. Respect explicit `hasMore`.

- [x] [Review][Patch] `TikTokShopCrawler` silently swallows `storeBatch()` failures [src/scrapers/ecom/tiktok-shop/crawler.js:113,161,212]
  `.catch(() => {})` hides database/validation errors. Log or surface the error at debug level.

- [x] [Review][Patch] `TikTokShopCrawler.top_products` descriptor missing `sortBy` [src/scrapers/ecom/tiktok-shop/crawler.js:49]
  Handler passes `sortBy: args.sortBy` to `getTopProducts`, but `optionalArgs` is `['category', 'limit', 'page']`. Either remove `sortBy` usage or add it to `optionalArgs` per AC-1.

- [x] [Review][Patch] `scrape('tiktokshop', ...)` passes `NaN` for non-numeric `limit`/`page`/`offset` [src/scrapers/index.js:196-200]
  `Number('abc')` is `NaN` and still assigned to `mappedArgs`. Guard with `Number.isFinite()` before assigning.

- [x] [Review][Patch] `crawler-tiktok-shop.test.js` mutates `process.env.TIKTOK_BROWSER_SIGN` without restoring [tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js:266-376]
  `scrapeTikTokShop` test sets `process.env.TIKTOK_BROWSER_SIGN = 'false'` inside the test and does not restore the original value, leaking state to later tests.

- [x] [Review][Patch] `schemas/tiktokshop/ecom.json` should allow additional metadata properties [schemas/tiktokshop/ecom.json]
  Schema is missing `additionalProperties` setting. Add `additionalProperties: true` so the validator does not reject extra normalized e-commerce fields.

- [x] [Review][Patch] `TIKTOK_SHOP_ACTION_MAP` rejects common action aliases [src/scrapers/index.js:376-389]
  Kebab-case (`top-products`, `product-detail`, `search-products`), camelCase (`topProducts`, `productDetail`, `searchProducts`), and `bestsellers` aliases are not mapped. Add aliases for discoverability.

- [x] [Review][Defer] Validator `isBotChallenge()` treats all non-zero/non-200 codes as bot challenge [src/scrapers/ecom/tiktok-shop/validator.js:107-116]
  Normal business errors (e.g. item not found) could be misclassified. However, AC-3 requires `code !== 0` to throw `XACT_4030`; distinguishing business vs anti-bot codes requires a known error-code allow-list that is not yet available.

- [x] [Review][Defer] `BOT_CHALLENGE_MARKERS` includes `'rate limit'` [src/scrapers/ecom/tiktok-shop/validator.js:18-26]
  Rate-limit messages also trigger `isBotChallenge()`. This is acceptable because rate-limited responses should quarantine the proxy/session and trigger retry; `isRateLimit()` still catches explicit 429/rate-limit markers.

- [x] [Review][Defer] `#getData()` / `#getBodyText()` handle raw string bodies poorly [src/scrapers/ecom/tiktok-shop/validator.js:36-53]
  Raw HTML strings are not inspected directly for challenge markers. Pre-existing pattern in other platform validators; raw HTML body is typically in `response.body` or `response.text` which is checked.

- [x] [Review][Defer] `TikTokShopClient` does not support `POST`/`PUT`/`PATCH` request bodies [src/scrapers/ecom/tiktok-shop/client.js:154-173]
  Story 16.2 only defines `GET` endpoints (`top_products`, `product_detail`, `search_products`). Body support belongs to a future story if write actions are added.

- [x] [Review][Defer] Hardcoded User-Agent in `TikTokShopClient` [src/scrapers/ecom/tiktok-shop/client.js:135-137]
  `#defaultUserAgent()` returns a fixed string. Allowing overrides requires constructor option propagation and signer bridge agreement; not required by AC-2.

- [x] [Review][Defer] `TikTokShopClient` does not expose `init()` / session-warmup lifecycle [src/scrapers/ecom/tiktok-shop/client.js:74-130]
  Bridge warm-up and token extraction are currently implicit per request. AC-2 only requires dynamic signing; explicit warm-up can be added when operational.

- [x] [Review][Defer] `aid=1988` is hardcoded in `buildApiUrl()` [src/scrapers/ecom/tiktok-shop/client.js:187-189]
  The default enables the signer bridge to match outbound URLs. Making it configurable is a future enhancement once multiple TikTok Shop app IDs are needed.

- [x] [Review][Defer] No PreSignedTokenRing / token cache integration [src/scrapers/ecom/tiktok-shop/client.js:95-119]
  Each call waits for browser signing. Caching pre-signed tokens is a performance optimization deferred to the tiered-signer epic.

- [x] [Review][Defer] `TikTokBrowserBridge` warm-up navigates to `/foryou` on affiliate subdomain [src/scrapers/ecom/tiktok-shop/client.js:65-72]
  Bridge behavior is outside the scope of `TikTokShopClient`; the client supplies a base URL and lets the bridge resolve its own warm-up path.

- [x] [Review][Defer] Multi-region currency hardcoded as `VND` [src/scrapers/ecom/tiktok-shop/normalize-product.js:93]
  AC-4 explicitly specifies `currency: 'VND'`. Multi-region support requires market context not yet provided.

- [x] [Review][Defer] Dot-thousand price parser may corrupt decimal prices for non-VND [src/scrapers/ecom/tiktok-shop/normalize-product.js:17-34]
  Story 16.2 targets Vietnamese TikTok Shop prices. USD-style decimal parsing can be added when multi-region support is implemented.

- [x] [Review][Defer] Missing shop avatar, product video, and published date extraction [src/scrapers/ecom/tiktok-shop/normalize-product.js:61-85]
  These fields are not in the AC-4 metadata list. Add when upstream payloads and consumer needs are confirmed.

- [x] [Review][Defer] Unified `scrape()` does not map `cursor`, `shopId`, `sellerId`, signer-pool, or session-manager options [src/scrapers/index.js:190-230]
  Cursor pagination, shop filtering, and signer-pool configuration are out of scope for AC-1/AC-5 and can be added when the operational layer supports them.

- [x] [Review][Defer] Test coverage gaps for HTTP errors, schema validation, multi-page pagination, and `autoClose` [tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js]
  Additional tests improve quality but are not required by the current ACs. Add in a follow-up test-hardening pass.

- [x] [Review][Defer] Missing TypeScript declarations for TikTok Shop classes [types/index.d.ts]
  Already deferred in the original review; the project has not yet exported e-commerce scraper types.

## Dev Agent Record

### Implementation Plan

1. Tạo thư mục `src/scrapers/ecom/tiktok-shop/`.
2. Triển khai `TikTokShopClient` kế thừa `AbstractApiClient`.
3. Triển khai `TikTokShopPlatformResponseValidator`.
4. Triển khai `normalize-product.js` chuyển đổi response sang `PostItem`.
5. Triển khai `TikTokShopCrawler` kế thừa `AbstractCrawler`.
6. Tích hợp dispatcher và `package.json` export.
7. Viết test suite `tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js`.

### Completion Notes

- Implemented `TikTokShopClient` extending `AbstractApiClient` with `got-scraping` transport and `TikTokBrowserBridge` signing fallback.
- Implemented `TikTokShopPlatformResponseValidator` to detect `code !== 0`, captcha/verify challenge, rate-limit, and HTML responses.
- Implemented `normalize-product.js` to map TikTok Shop products to canonical `PostItem` with `category: 'ecom'` and namespaced IDs (`tiktokshop:${productId}`).
- Implemented `TikTokShopCrawler` with 3 actions: `top_products`, `product_detail`, `search_products`.
- Integrated `tiktokshop` / `tiktok_shop` into `src/scrapers/index.js` unified dispatcher.
- Added `package.json` export `"./scrapers/ecom/tiktok-shop"`.
- Wrote red-phase test suite `tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js`; 9/9 pass.
- Fixed type-check issues introduced by TikTok Shop code (`proxy`, `resp.data`, `savePosts`, `authorAvatar` typing).
- Targeted scraper tests pass (33/33) for `tests/scrapers/ecom` and `tests/scrapers/social/tiktok`.
- Full `npx vitest run` still times out on unrelated `tests/scrapers/facebook-index.test.js`.

### File List

#### UPDATE
- `src/scrapers/index.js`
- `package.json`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src/core/types.js` (`authorAvatar` JSDoc allows `string | null`)

#### NEW
- `src/scrapers/ecom/tiktok-shop/crawler.js`
- `src/scrapers/ecom/tiktok-shop/client.js`
- `src/scrapers/ecom/tiktok-shop/validator.js`
- `src/scrapers/ecom/tiktok-shop/normalize-product.js`
- `src/scrapers/ecom/tiktok-shop/index.js`
- `tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js`

---

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-08-30 | nich (@nichxbt) | Initial implementation of Story 16.2 TikTok Shop Product & Sales Scraper |
| 2026-08-30 | nich (@nichxbt) | Fix type-check issues and mark story `review` |
