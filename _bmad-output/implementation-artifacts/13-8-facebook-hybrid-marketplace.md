---
story_id: '13.8'
epic: 13
story_key: '13-8-facebook-hybrid-marketplace'
status: "ready-for-dev"
phase: "Phase 4"
created: 2026-08-27
updated: 2026-08-27
last_updated: 2026-08-27
owner: "DEV"
reviewed: ""
baseline_commit: "c45d770f"
---

# Story 13.8: Facebook Hybrid Marketplace

Status: ready-for-dev

## Story

As a **Facebook Marketplace Researcher**,  
I want **tìm kiếm và cào danh sách sản phẩm trên Facebook Marketplace qua kiến trúc hybrid (HTTP GraphQL + browser bridge fallback)**,  
So that **tôi có thể theo dõi giá, sản phẩm và seller mà không bị giới hạn bởi Puppeteer rendering, tốc độ chậm, và tiêu thụ tài nguyên cao**.

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.8 [dòng 587-598]
- `_bmad-output/planning-artifacts/prd-facebook-epics-5-6-2026-08-21.md` — FR-28..FR-31 (Marketplace Scraper, Multi-Currency Price Parse, Title/Location Extraction) [dòng 87-97]
- `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-26.md` — FR/NFR coverage, Facebook module readiness [dòng 145-180, 207-220]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-2 (AbstractCrawler/ActionRegistry), AD-4 (Namespaced Storage/JSONB GIN), AD-8 (Multi-Domain Expansion Blueprint), AD-9 (Anti-Bot Payload Validation), AD-10 (3-Tier Incremental Gap-Filling), AD-11 (CrawlerCommand/ActionRegistry)
- `_bmad-output/implementation-artifacts/13-7-facebook-hybrid-post-group-comments.md` — patterns cho `FacebookCrawler` action, PII stripping, checkpoint, validation
- `_bmad-output/implementation-artifacts/13-6-facebook-hybrid-search-global-group-search.md` — patterns cho `search()`, `groupSearch()`, `DEFAULT_FB_DOC_IDS`, `requestGraphQl` dispatcher
- `src/scrapers/social/facebook/crawler.js` — `DEFAULT_FB_DOC_IDS` [dòng 199-220], constructor action registry [dòng 280-407], `search()` [dòng 1089-1121], `#searchByType()` [dòng 1130-1192], `groupSearch()` [dòng 1234-1332], `#normalizePostItem()` [dòng 416-479], `#saveCheckpoint()` [dòng 1717-1773], `stripPii()` [dòng 226-239]
- `src/scrapers/social/facebook/client.js` — `requestGraphQl()` [dòng 435-517], `buildGraphQlBody()` [dòng 388-425], `ensureTokens()` / `#fetchTokens()` [dòng 212-379]
- `src/scrapers/social/facebook/index.js` — exports [dòng 1-26]
- `src/scrapers/social/facebook/normalize-search.js` — `normalizeFacebookSearchPost()`, `searchResultToPostItem()` [dòng 1-277]
- `src/scrapers/index.js` — `platformActionMap.facebook` [dòng 188-196], unified `scrape()` [dòng 157-328]
- `src/scrapers/facebook/marketplace.js` — legacy `scrapeMarketplace()` Puppeteer DOM flow [dòng 1-147]
- `src/scrapers/facebook/normalize.js` — `normalizeMarketplaceListing()`, `buildMarketplaceSearchUrl()`, `resolveMarketplaceLocation()`, `MARKETPLACE_KNOWN_LOCATIONS` [dòng 659-734]
- `src/scrapers/facebook/index.js` — legacy re-exports [dòng 1-63]
- `src/core/types.js` — `PostItem` typedef [dòng 9-28], `CATEGORIES` [dòng 127-135], `generatePostId()` [dòng 145-147]
- `src/types/facebook.d.ts` — `FacebookMarketplaceListing` interface [dòng 219-231]
- `src/store/prisma-store.js` — `storeBatch()` chunking [dòng 217-228], `saveCheckpoint()` [dòng 312-329]
- `prisma/schema.prisma` — `Post`, `CrawlCheckpoint` models
- `schemas/facebook/social.json` — metadata schema cho search/profile (cần mở rộng cho marketplace)
- `src/mcp/server.js` — `x_facebook_marketplace` tool definition [dòng 1572-1587], tool handler [dòng 3151-3200]
- `api/routes/facebook.js` — `VALID_ACTIONS`, `scrapeArgs` cho marketplace [dòng 270-316, 434-435]
- `api/services/facebookScrape.js` — `run()` dispatcher [dòng 23-56]
- `docs/deprecation-plan.md` — legacy mapping table và status tracker [dòng 76-99]
- `src/scrapers/social/facebook/crawler-search.test.js` — ATDD pattern với real `node:http` server [dòng 260-551]
- `src/scrapers/social/facebook/crawler-post-group-comments.test.js` — ATDD pattern cho action với SSRF/PII/pagination [dòng 1-120]
- Web research: Facebook Marketplace GraphQL `doc_id` patterns, `bqf.callsite: "COMMERCE_MKTPLACE_WWW"`, `browse_request_params` với `filter_location_latitude/longitude`, `filter_price_lower_bound/upper_bound` (cents), `filter_radius_km`, `commerce_search_and_rp_category_id`; URL `https://www.facebook.com/marketplace/<location>/search/?query=...&minPrice=...&maxPrice=...`; doc_id cần capture từ live session.

## Cross-Epic Dependencies

- Depends on Story 13.3 (`FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`, `PrismaStore`)
- Depends on Story 13.4 (`FacebookBrowserBridge`, CDP/launch Chrome, token extraction, `httpFallback`)
- Depends on Story 13.5 (`profile` browser fallback pattern, `profileItemToPostItem`, `#saveCheckpoint`, `resolveGroupId` URL parsing style)
- Depends on Story 13.6 (`search()` action, `normalizeFacebookSearchPost`, `searchResultToPostItem`, `DEFAULT_FB_DOC_IDS` placeholder strategy, variable builder pattern)
- Depends on Story 13.7 (input validation, PII stripping, `PlatformError` `XACT_4001`, `limit`/`maxComments` clamp, `after` pagination, checkpoint)
- Depends on Story 10.2 (`Post` / `CrawlCheckpoint` Prisma schema, `PrismaStore.storeBatch`)
- Depends on Story 10.5 (`metadata-schema-registry.js`, `schemas/facebook/*.json`)
- Depends on Epic 11 (`ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool`)
- Unlocks Story 13.10 (Facebook Hybrid Integration & Caller Migration) — chuyển `scrape('facebook', 'marketplace', ...)`, MCP `x_facebook_marketplace`, API route sang `FacebookCrawler`

## Baseline

- baseline_commit: `c45d770f` — Story 13.7 done, `FacebookCrawler` đã có `search`, `group_search`, `post_comments`, `group_comments`, `get_comments`, `profile`, `followers`, `following`, `group_members`, `group_posts`, `page_posts`.
- `FacebookClient.requestGraphQl()` / `buildGraphQlBody()` đã sẵn sàng với `lsd`, `fb_dtsg`, `jazoest`, `__user`, `__a`, `__comet_req`.
- `DEFAULT_FB_DOC_IDS` chưa có `MARKETPLACE_SEARCH` / `MARKETPLACE_LOCATION`; cần placeholder + capture live doc_id hoặc SSR/browser fallback.
- `FacebookCrawler.search()` và `groupSearch()` đã có pattern dispatch GraphQL + parse `edges`/`page_info` + `storeBatch` + checkpoint.
- Legacy `scrapeMarketplace()` trong `src/scrapers/facebook/marketplace.js` vẫn hoạt động qua Puppeteer DOM; `buildMarketplaceSearchUrl()` / `normalizeMarketplaceListing()` trong `src/scrapers/facebook/normalize.js` là baseline cho URL builder và normalization.
- `PostItem` là storage contract chính; `FacebookMarketplaceListing` tồn tại trong `src/types/facebook.d.ts` nhưng không có trong `src/core/types.js`.
- `src/scrapers/index.js` `platformActionMap.facebook` chưa mapping `marketplace` sang hybrid; `scrape('facebook','marketplace')` vẫn đi vào legacy `scrapeMarketplace`.
- MCP `x_facebook_marketplace` hiện vẫn import `scrapeMarketplace` từ `src/scrapers/facebook/index.js`.

## Acceptance Criteria

### AC-1: Đăng ký action `marketplace`

- Given `FacebookCrawler` trong `src/scrapers/social/facebook/crawler.js`
- When khởi tạo
- Then đăng ký thêm action `marketplace` trong constructor với:
  - `requiredArgs: ['query']`
  - `optionalArgs: ['location', 'category', 'priceMin', 'priceMax', 'limit', 'cursor', 'radiusKm', 'latitude', 'longitude']`
  - `example: { query: 'macbook pro 14', location: 'Ho Chi Minh City', priceMax: 1200, limit: 20 }`
  - `outputType: '{ posts: PostItem[], pageInfo?: any }'`
- And `listActions()` trả về `marketplace`
- And `marketplace` là snake_case, không xung đột với `search` / `group_search`

### AC-2: `marketplace()` handler

- Given args `{ query, location, category, priceMin, priceMax, limit, cursor, radiusKm, latitude, longitude }`
- When gọi `crawler.start({ action: 'marketplace', args, session })`
- Then `marketplace(args, session)` validate `query` non-empty, gọi `FacebookClient.requestGraphQl()` với `doc_id` từ `this.docIds.MARKETPLACE_SEARCH` hoặc `DEFAULT_FB_DOC_IDS.MARKETPLACE_SEARCH`
- And xây dựng `variables` theo mẫu Marketplace GraphQL:
  - `count`/`first` = `limit`
  - `cursor` = `cursor` (hoặc `after`)
  - `params.bqf.callsite = 'COMMERCE_MKTPLACE_WWW'`
  - `params.bqf.query = query`
  - `params.browse_request_params.filter_location_latitude/longitude` (nếu có lat/lng hoặc resolved từ `location`)
  - `params.browse_request_params.filter_price_lower_bound/upper_bound` (chuyển `priceMin`/`priceMax` sang cents, ví dụ `priceMin * 100`)
  - `params.browse_request_params.filter_radius_km` (mặc định 50 nếu không truyền)
  - `params.browse_request_params.commerce_search_and_rp_category_id` (nếu `category` là category ID)
- And parse response từ `data.marketplace_search_listings` / `data.searchResults` / `data.browse` (tên connection có thể điều chỉnh sau khi capture live) để lấy `edges` và `page_info`
- And trả về `{ posts: PostItem[], pageInfo?: { has_next_page: boolean, end_cursor: string | null }, note?: string }`

### AC-3: Chuẩn hóa listing thành `PostItem`/`MarketplaceItem`

- Given raw marketplace listing node từ GraphQL hoặc browser fallback
- When normalize
- Then mỗi listing trả về `PostItem` với:
  - `id = 'facebook:<listingId>'`, `externalId = <listingId>`, `platform = 'facebook'`
  - `category` = `'ecom'` (ưu tiên) hoặc `'social'` nếu schema `ecom` chưa sẵn sàng
  - `authorId` = seller id (nếu có) hoặc seller name được hash/strip
  - `authorName` = tên seller sau khi strip PII
  - `content` = listing title (sau khi strip PII)
  - `mediaUrls` = `[image]` nếu có
  - `publishedAt` = listing creation time nếu có, ngược lại `null`
  - `postUrl` = `https://www.facebook.com/marketplace/item/<listingId>` hoặc `listingUrl`
  - `metadata` chứa `price` (string hoặc number), `currency`, `location`, `seller`, `sellerUrl`, `category`, `categoryId`, `isMarketplace: true`, `sourceMethod: 'graphql'` / `'browser'`, `rawId`
- And `validateItem(postItem)` pass trước khi lưu / trả về
- And nếu team quyết định tạo `MarketplaceItem` typedef trong `src/core/types.js`, phải có `marketplaceToPostItem()` helper tương tự `searchResultToPostItem()`

### AC-4: `location`, `priceMin`, `priceMax`, `limit`, `cursor` mapping

- Given args cho `marketplace`
- When normalize
- Then `query` stripped whitespace, không rỗng, tối đa 512 ký tự
- And `location` được resolve thành slug hoặc lat/lng (nếu `latitude`/`longitude` không được truyền) dùng logic từ `resolveMarketplaceLocation()`
- And `priceMin`/`priceMax` là non-negative number, `priceMin <= priceMax`; chuyển sang cents khi gửi GraphQL
- And `limit` clamp [1, 200] (mặc định 50, tối đa 200 để khớp MCP hiện tại)
- And `cursor` (hoặc `after`) được truyền vào GraphQL variables để phân trang
- And `category` nếu có phải là string không chứa path traversal

### AC-5: Fallback khi GraphQL thất bại

- Given `MARKETPLACE_SEARCH` doc_id không hợp lệ, response rỗng, hoặc `FacebookClient` trả lỗi doc_id rotated
- When gọi `marketplace`
- Then thử fallback về `FacebookBrowserBridge` (nếu `cdpUrl` / `launchChrome` được cấu hình) để navigate đến URL từ `buildMarketplaceSearchUrl(query, { location, category, minPrice: priceMin, maxPrice: priceMax })` và evaluate DOM
- Or fallback về HTTP SSR fetch của trang `marketplace/<location>/search/?query=...` rồi parse embedded JSON (nếu bridge không có)
- And nếu vẫn không có kết quả, trả về `{ posts: [], pageInfo: { has_next_page: false, end_cursor: null }, note?: string }` hoặc `PlatformError` với `suggestedAction: 'relogin'` khi auth hết hạn
- And KHÔNG throw panic error khi doc_id placeholder chưa capture

### AC-6: Phân trang và checkpoint

- Given `marketplace` trả về `pageInfo`
- When hoàn thành một page
- Then lưu kết quả batch qua `this.store.storeBatch(posts, { upsert: true })` nếu store tồn tại
- And gọi `#saveCheckpoint` với `targetType: 'marketplace'`, `targetKey: <query[:location][:category]>` (tương tự targetKey pattern của `search`), `lastCursor: pageInfo.end_cursor`, `items: posts`, `hasMore: pageInfo.has_next_page`
- And emit Thin Event vào `stream:social:raw_posts` cho mỗi listing đã lưu (nếu `REDIS_STREAM_ENABLED`)
- And hỗ trợ resume từ checkpoint nếu caller truyền `cursor`

### AC-7: Input validation & SSRF guard

- Given input không hợp lệ
- When gọi `marketplace`
- Then `query` không được rỗng, không phải URL độc hại
- And `priceMin`/`priceMax` là number hoặc string parse được, `>= 0`, `priceMin <= priceMax`
- And `limit` positive integer, max 200
- And `location` nếu là URL thì phải là `facebook.com/marketplace/*` hoặc reject; tốt hơn là chỉ chấp nhận free-form city/location string
- And `category` chỉ là plain string (slug/id), không chứa `../`, `//`
- And non-Facebook / invalid input throw `PlatformError` `XACT_4001`
- And `latitude`/`longitude` nếu có phải trong khoảng hợp lệ [-90,90] / [-180,180]

### AC-8: API / MCP / CLI caller migration (mức tối thiểu cho 13.8)

- Given `FacebookCrawler` đã hỗ trợ action `marketplace`
- When khởi tạo
- Then `api/routes/facebook.js` vẫn chấp nhận `action: 'marketplace'` trong `VALID_ACTIONS` và truyền `query`, `location`, `category`, `priceMin`, `priceMax`, `limit` vào `scrapeArgs`
- And `api/services/facebookScrape.js` không break với action `marketplace`
- And `src/mcp/server.js` `x_facebook_marketplace` có thể gọi `FacebookCrawler.start()` thay vì legacy `scrapeMarketplace` (nếu 13.10 chưa hoàn thành thì tối thiểu đảm bảo action hoạt động qua `crawler.start()`)
- And `src/scrapers/index.js` `platformActionMap.facebook` được cập nhật khi 13.10 diễn ra; trong 13.8 có thể thêm alias tạm thời nếu cần

### AC-9: Deprecation markers

- Given legacy `scrapeMarketplace` trong `src/scrapers/facebook/marketplace.js`
- When triển khai Story 13.8
- Then gắn JSDoc `@deprecated` với ghi chú "Replaced by `FacebookCrawler` action `marketplace`"
- And cập nhật `docs/deprecation-plan.md` bảng `Legacy Facebook Functions → Hybrid Actions` thêm `scrapeMarketplace` → `facebook:marketplace`
- And cập nhật status tracker: `Facebook Legacy Marketplace` (hoặc `src/scrapers/facebook/marketplace.js`) sang `deprecated-marked`
- And `src/scrapers/facebook/index.js` re-export vẫn giữ `scrapeMarketplace` nhưng với comment `// LEGACY — see docs/deprecation-plan.md`

### AC-10: Test coverage

- Given repo có Vitest
- When triển khai
- Then tạo / mở rộng `tests/scrapers/social/facebook/crawler-marketplace.test.js` với real `node:http` server
- And cover: action registry, `marketplace` GraphQL dispatch, variable builder với `bqf`, price-to-cents, location resolution, pagination cursor, normalization, PII stripping (seller phone/email), invalid price/limit rejection, checkpoint lưu, PrismaStore batch, fallback khi doc_id rỗng
- And chạy `npx vitest run tests/scrapers/social/facebook/` và `npx tsc --noEmit` pass
- And test server mock trả về Marketplace-like response với `edges` / `page_info` tương tự pattern của `crawler-search.test.js`

## Tasks / Subtasks

1. [ ] **Thêm `MARKETPLACE_SEARCH` doc_id placeholders vào `DEFAULT_FB_DOC_IDS`**
   - [ ] Thêm `MARKETPLACE_SEARCH: 'fb_marketplace_search_doc'` (hoặc `null` nếu chưa capture)
   - [ ] Thêm `MARKETPLACE_LOCATION: 'fb_marketplace_location_doc'` (nếu cần resolve location string → lat/lng)
   - [ ] Đảm bảo `this.docIds` merge với `deps.docIds` trong constructor

2. [ ] **Implement `marketplace(args, session)` trong `src/scrapers/social/facebook/crawler.js`**
   - [ ] Validate `query`, `priceMin`, `priceMax`, `limit`, `location`, `category`
   - [ ] Resolve `location` thành slug hoặc lat/lng/radius
   - [ ] Build GraphQL variables theo Marketplace pattern
   - [ ] Gọi `this.client.requestGraphQl()` với doc_id và variables
   - [ ] Parse response `edges` / `page_info`
   - [ ] Normalize từng listing thành `PostItem`
   - [ ] Gọi `storeBatch` và `#saveCheckpoint`

3. [ ] **Tạo / mở rộng `normalize-marketplace.js`**
   - [ ] `normalizeFacebookMarketplaceListing(raw, query = '')` tương tự `normalizeFacebookSearchPost`
   - [ ] `marketplaceListingToPostItem(item)` tương tự `searchResultToPostItem`
   - [ ] Strip PII từ `authorName` (seller) và `content` (title)
   - [ ] Parse price, currency, location, seller, image, listingUrl, category

4. [ ] **Cập nhật `schemas/facebook/social.json` (hoặc tạo `schemas/facebook/ecom.json`)**
   - [ ] Thêm marketplace metadata fields: `isMarketplace`, `price`, `currency`, `location`, `seller`, `listingUrl`, `categoryId`, `isMarketplace`
   - [ ] Đảm bảo `PrismaStore.storeBatch` validate pass

5. [ ] **Cập nhật constructor `FacebookCrawler` đăng ký action `marketplace`**
   - [ ] `registerAction({ action: 'marketplace', ... })` với đầy đủ required/optional args, example, outputType

6. [ ] **Implement fallback khi GraphQL fail**
   - [ ] Bọc request trong try/catch
   - [ ] Nếu `doc_id` rỗng / response rỗng / lỗi `XACT_5000`, thử `FacebookBrowserBridge` navigate `buildMarketplaceSearchUrl()`
   - [ ] Nếu bridge không có, trả về `posts: []` với `note` hoặc `PlatformError` `suggestedAction: 'relogin'` khi auth

7. [ ] **Đánh dấu legacy `@deprecated`**
   - [ ] `src/scrapers/facebook/marketplace.js`: `scrapeMarketplace`
   - [ ] `src/scrapers/facebook/index.js` re-export nếu cần
   - [ ] `docs/deprecation-plan.md`: cập nhật mapping table và status tracker

8. [ ] **Cập nhật API / MCP surfaces (tối thiểu)**
   - [ ] `api/routes/facebook.js`: đảm bảo `scrapeArgs` cho `marketplace` truyền đủ `query`, `location`, `category`, `priceMin`, `priceMax`, `limit`
   - [ ] `src/mcp/server.js` `x_facebook_marketplace`: giữ input schema, cho phép gọi `FacebookCrawler.start()` (hoặc ghi chú migration sang 13.10)
   - [ ] `api/services/facebookScrape.js`: đảm bảo `run('marketplace', ...)` không break

9. [ ] **Viết / mở rộng tests**
   - [ ] Tạo `tests/scrapers/social/facebook/crawler-marketplace.test.js`
   - [ ] Real `node:http` server, không mock
   - [ ] Bao quát AC-1..AC-10

10. [ ] **Chạy verification**
    - [ ] `npx vitest run tests/scrapers/social/facebook/`
    - [ ] `npx vitest run tests/scrapers/social/facebook/crawler-marketplace.test.js`
    - [ ] `npx tsc --noEmit`
    - [ ] `npx prisma validate` (nếu thay đổi schema metadata thì cần migration hoặc raw SQL)

## Technical Requirements

- **ESM 100%**: Mọi file mới phải là `.js` ESM với `import`/`export`; không dùng `require`.
- **JSDoc / TypeScript types**: Tất cả hàm mới có JSDoc `@param` / `@returns`; chạy `npx tsc --noEmit` pass. Không dùng `any` nếu có thể; dùng `Record<string, any>` hoặc `unknown` khi cần.
- **No mocks trong production code**: Chỉ test file dùng `node:http` server real; không dùng `vi.mock()` / `sinon`.
- **Không thêm runtime dependency mới**: Chỉ dùng `got-scraping`/`undici`, `puppeteer`/`playwright` đã có; không cài thêm package.
- **PII stripping (NFR-11)**: Áp dụng regex phone/email từ `crawler.js` hoặc tốt hơn cho `authorName` và `content` của listing.
- **Error envelope**: Mọi lỗi trả về `PlatformError` với `code`, `type`, `suggestedAction`.
- **Checkpoint & Redis Stream**: Tích hợp `#saveCheckpoint` và emit Thin Event pointer theo pattern 13.7.
- **Metadata schema contract (FR-86)**: Publish JSON Schema cho `Post.metadata` của marketplace.

## Architecture Compliance

- **AbstractCrawler (AD-2)**: `FacebookCrawler` đã kế thừa `AbstractCrawler`; action `marketplace` đăng ký qua `ActionRegistry`; `start()` dispatch đến handler.
- **FacebookClient (AD-2, AD-3)**: Dùng `requestGraphQl()` làm dispatcher duy nhất; KHÔNG tạo `marketplace-graphql.js` riêng. `FacebookClient` tái sử dụng token ring, sticky proxy, rate governor.
- **PrismaStore (AD-4)**: Lưu listing dưới dạng `Post` với `id = facebook:<listingId>`; metadata JSONB; batch chunk 500; `@@unique([platform, externalId])`.
- **Namespaced IDs (AD-4)**: Mọi output dùng `facebook:<externalId>`; tránh collision.
- **CrawlerCommand (AD-11)**: Action `marketplace` nhận `CrawlerCommand` `{ action, args, session }`.
- **Anti-Bot Validation (AD-9)**: `FacebookPlatformResponseValidator` phát hiện challenge/rate-limit; `FacebookCrawler` throw `RateLimitError`/`BotChallengeError` khi cần.
- **3-Tier Gap-Filling (AD-10)**: Hỗ trợ `cursor` / `after` để resume; checkpoint lưu `lastCursor`.
- **Multi-Domain Blueprint (AD-8)**: Marketplace nằm trong `src/scrapers/social/facebook/`; không tạo thư mục `src/scrapers/ecom/facebook/` riêng trong Epic 13.

## Library & Framework Requirements

- `got-scraping` hoặc `undici` — qua `AbstractApiClient` / `FacebookClient`
- `puppeteer` / `playwright` — qua `FacebookBrowserBridge` nếu cần fallback
- `@prisma/client` — `PrismaStore`
- `vitest` — tests
- `node:http` — test server
- Không thêm runtime dependency mới.

## File Structure Requirements

**Cập nhật:**
- `src/scrapers/social/facebook/crawler.js` — thêm `marketplace` action, `DEFAULT_FB_DOC_IDS` marketplace placeholders, `#normalizeMarketplaceListing` hoặc import
- `src/scrapers/social/facebook/client.js` — không cần thay đổi nếu `requestGraphQl` đã đủ; có thể thêm helper `scrapeMarketplaceWithBrowser` tương tự `scrapeProfileWithBrowser` nếu cần
- `src/scrapers/social/facebook/index.js` — export `normalizeFacebookMarketplaceListing`, `marketplaceListingToPostItem`
- `src/scrapers/social/facebook/normalize-marketplace.js` — (file mới) normalizer cho marketplace
- `schemas/facebook/social.json` — mở rộng metadata marketplace (hoặc tạo `schemas/facebook/ecom.json`)
- `src/types/facebook.d.ts` — cập nhật `FacebookMarketplaceListing` nếu cần
- `src/core/types.js` — (tùy chọn) thêm `MarketplaceItem` typedef nếu team quyết định
- `src/scrapers/facebook/marketplace.js` — gắn `@deprecated`
- `src/scrapers/facebook/index.js` — gắn `@deprecated` re-export
- `docs/deprecation-plan.md` — cập nhật mapping table, status tracker
- `api/routes/facebook.js` — scrapeArgs cho marketplace
- `src/mcp/server.js` — ghi chú / cập nhật `x_facebook_marketplace` handler
- `tests/scrapers/social/facebook/crawler-marketplace.test.js` — (file mới) ATDD tests

**Không sửa:**
- `src/core/base-crawler.js`, `src/core/base-client.js` — core contracts ổn định
- `src/scrapers/index.js` — dispatcher migration thuộc Story 13.10 (có thể sửa tạm nếu cần smoke test)

## Testing Requirements

- **Real `node:http` server**: Test phải tạo server local, mock `GET /` cho token extraction, `POST /api/graphql/` cho marketplace response.
- **No mocks/stubs**: Không dùng `vi.fn()`, `sinon`, `nock`.
- **Test coverage bắt buộc**:
  - `[AC-1]` action `marketplace` được đăng ký với đúng required/optional args
  - `[AC-2]` GraphQL dispatch với đúng `doc_id` và `variables` (có `bqf.callsite`, `filter_price_lower_bound` cents)
  - `[AC-3]` normalized `PostItem` có `id: 'facebook:<listingId>'`, `metadata.isMarketplace: true`, `price`, `location`, `seller`
  - `[AC-4]` `limit` clamp, `priceMin`/`priceMax` validation, cursor truyền vào variables
  - `[AC-5]` fallback khi doc_id trả empty / lỗi; trả về `posts: []` và `note`
  - `[AC-6]` `storeBatch` và `CrawlCheckpoint` được ghi; Thin Event emit nếu Redis mock/flag
  - `[AC-7]` `PlatformError` `XACT_4001` cho query rỗng, price invalid, SSRF location URL
  - `[AC-9]` legacy `scrapeMarketplace` có `@deprecated` trong JSDoc
- **Chạy verification**:
  - `npx vitest run tests/scrapers/social/facebook/crawler-marketplace.test.js`
  - `npx vitest run tests/scrapers/social/facebook/`
  - `npx tsc --noEmit`
  - `npx prisma validate`

## Previous Story Intelligence

Từ Story 13.7 (`13-7-facebook-hybrid-post-group-comments.md`):

- **Input validation patterns**: Dùng `#validatePostCommentTarget` style để reject URL không hợp lệ với `PlatformError` `XACT_4001`; dùng `URL` constructor và regex; dùng `assertFacebookUrl`.
- **Limit clamp**: `#clampMaxComments` [1, 2000] default 50; `#normalizeCount` từ `AbstractCrawler`.
- **Pagination**: `after` cursor trim, kiểm tra whitespace, truyền vào GraphQL variables.
- **PII stripping**: `PII_PHONE_RE` và `PII_EMAIL_RE` áp dụng cho `authorName` và `content`; có thể false-positive với date/price nên cần tighten.
- **Checkpoint**: `#saveCheckpoint` với `targetType`, `targetKey`, `lastCursor`, items, `hasMore`; emit Redis Stream.
- **Depth-aware doc_id**: `getCommentsForPost` chọn doc_id theo `feedLocation` và `replyDepth`; marketplace có thể cần tương tự nếu có nested levels.
- **Review patches**: cần validate input shape up-front, tránh `null`/`''` bypass, dùng `pathname.startsWith('/groups/')` cho group URL.

Từ Story 13.6:

- **Search variable builder**: `query`/`searchTerm`/`queryString`, `count`/`first`, `cursor`/`after`.
- **Response parse**: `res?.data?.serpResponse?.results?.edges` / `page_info`.
- **Location append**: `query = location ? '${rawQuery} near ${location}' : rawQuery`.
- **Multi-type handling**: `search` hỗ trợ `type` và `type: 'all'`.

Áp dụng cho 13.8:
- Marketplace cần variable builder riêng với `bqf` và `browse_request_params`.
- Response parse cần linh hoạt vì tên connection có thể khác (`marketplace_search_listings`, `browse`, `searchResults`).
- Cần location resolution nâng cao hơn: từ string → slug hoặc lat/lng.

## Project Context Reference

- `AGENTS.md` / `CLAUDE.md` — ESM, `const` over `let`, async/await, error emoji prefixes, no mocks, always commit/push as `nirholas`.
- `docs/deprecation-plan.md` — gắn `@deprecated` JSDoc, cập nhật status tracker, không xóa legacy cho đến Epic 20.2.
- `prisma/schema.prisma` — `Post.id` namespaced, `metadata Json?`, `CrawlCheckpoint` unique key.
- `src/core/metadata-schema-registry.js` — load/validate schema theo `schemas/<platform>/<category>.json`.
- Git baseline: `c45d770f` — 13.7 done; 5 commit gần nhất: `c45d770f`, `a09dab81`, `27ad46ad`, `ca10682e`, `c4beb26a`.

## Completion Notes

- Story 13.8 chuyển từ `backlog` → `ready-for-dev` sau khi file này và `sprint-status.yaml` được cập nhật.
- Epic 13 giữ `in-progress`, không cần cập nhật epic status.
- Các doc_id Marketplace thực cần được capture từ live Facebook session trong quá trình dev; placeholders `fb_marketplace_search_doc` chỉ dùng cho test / fallback.
- Nếu GraphQL response shape khác với giả định trong AC-2, cần điều chỉnh parser sau khi capture live; story này ghi rõ giả định và đề xuất capture.
- Migration hoàn chỉnh của `src/scrapers/index.js`, `api/services/facebookScrape.js`, `src/mcp/server.js` sang `FacebookCrawler` thuộc Story 13.10; trong 13.8 cần đảm bảo action `marketplace` có thể gọi qua `crawler.start()` và legacy vẫn hoạt động với `@deprecated`.
