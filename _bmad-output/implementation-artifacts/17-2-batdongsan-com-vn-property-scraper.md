---
story_id: "17.2"
epic: 17
story_key: "17-2-batdongsan-com-vn-property-scraper"
status: "ready-for-dev"
phase: "Phase 3"
created: 2026-08-27
updated: 2026-08-31
last_updated: 2026-08-31T11:00:00Z
owner: "DEV"
reviewed: "Pending"
baseline_commit: "c70af602"
---

# Story 17.2: Batdongsan.com.vn Property Scraper

Status: ready-for-dev

## ⚠️ Critical Constraints & Architecture Guidelines

1. **Architecture Compliance (AD-2, AD-3, AD-14):**
   - Must extend `AbstractCrawler` in `src/scrapers/realestate/batdongsan/crawler.js` and `AbstractApiClient` in `src/scrapers/realestate/batdongsan/client.js`.
   - Must provide `BatdongsanPlatformResponseValidator` extending `AbstractPlatformResponseValidator` in `src/scrapers/realestate/batdongsan/validator.js`.
   - Must expose clean barrel in `src/scrapers/realestate/batdongsan/index.js` and integrate into `src/scrapers/index.js` (`scrape('batdongsan', ...)`).
2. **Mobile API Endpoint & De-obfuscation Engine (`p_sync`):**
   - Base endpoint: `POST https://apimap.batdongsan.com.vn/api/p_sync`.
   - De-obfuscation pipeline: `raw buffer -> gzip (optional) -> base64 decode -> nibble-swap (swap high/low 4 bits of each byte) -> UTF-8 / Latin-1 JSON parse`.
   - Reverse nibble-swap formula: `((b & 0x0F) << 4) | (b >> 4)`.
3. **Payload Structure & Search Parameters:**
   - `ptype`: `38` for sell / buy, `49` for rent.
   - `cate`: Category code (0 for all, 41 for apartments, 49 for houses, 40 for land).
   - `city`: City code (e.g. `SG` for TP.HCM, `HN` for Hà Nội, `DN` for Đà Nẵng).
   - `p`: Page number (1-based).
   - `ps`: Page size (default 20).
4. **Data Normalization & Namespaced Models:**
   - Normalized as `PostItem` (`id: batdongsan:listing:<productId>`, `platform: 'batdongsan'`, `category: 'realestate'`).
   - Seller normalized as `ProfileItem` (`id: batdongsan:user:<contactName>`, `platform: 'batdongsan'`).
   - Store batch in `PrismaStore.storeBatch()` and save crawl checkpoints.
5. **Zero Mocks Testing (AD-10):**
   - Tests in `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js` using local `node:http` mock servers.

## Story

As a **Real Estate Investor & Market Research Analyst**,  
I want **cào tin rao bất động sản, diện tích, mức giá/m2, vị trí địa lý theo quận/huyện trên Batdongsan.com.vn qua `BatdongsanCrawler` và `BatdongsanClient` với bộ giải mã `p_sync`**,  
So that **tôi có thể theo dõi biến động thị trường BĐS, so sánh đơn giá và phát hiện cơ hội đầu tư BĐS tiềm năng.**

## Scope Note

Story 17.2 là mảnh ghép hoàn thiện cuối cùng cho Epic 17 (Real Estate & Procurement Intelligence).

- **Trong phạm vi Story 17.2:**
  - `src/scrapers/realestate/batdongsan/client.js`: `BatdongsanClient` gửi HTTP requests tới mobile endpoint với User-Agent rotation, proxy-aware.
  - `src/scrapers/realestate/batdongsan/crawler.js`: `BatdongsanCrawler` đăng ký 2 actions:
    1. `search_listings`: Tìm kiếm tin rao BĐS theo tỉnh thành (`city`), loại giao dịch (`listingType`), danh mục (`category`), phân trang (`page`, `limit`).
    2. `listing_detail`: Bóc tách thông tin chi tiết một tin rao theo `productId` / URL.
  - `src/scrapers/realestate/batdongsan/normalize-batdongsan.js`: Parser giải mã nhị phân nibble-swap, bóc tách giá tiền, diện tích, đơn giá m2, tọa độ GPS, số phòng.
  - `src/scrapers/realestate/batdongsan/validator.js`: Kiểm tra rate limit (429), IP ban (403), và cấu trúc payload `data` array.
  - `src/scrapers/realestate/batdongsan/index.js`: Barrel xuất `BatdongsanCrawler`, `BatdongsanClient`, `scrapeBatdongsan`.
  - `src/scrapers/index.js`: Đăng ký `batdongsan` vào unified `scrape()` dispatcher.
  - `package.json`: Export `./scrapers/realestate/batdongsan`.
  - `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js`: Suite test đầy đủ red-phase ATDD.

- **Ngoài phạm vi:**
  - Tự động đăng tin hoặc liên hệ môi giới.
  - Thay đổi schema Prisma.

## Acceptance Criteria

### AC-1: Action Registry & Crawler Contract
- **Given** `BatdongsanCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/realestate/batdongsan/crawler.js`
- **When** gọi `crawler.listActions()`
- **Then** đăng ký đầy đủ 2 action với đúng `ActionDescriptor`:

| action | category | requiredArgs | optionalArgs | requiresAuth |
|---|---|---|---|---|
| `search_listings` | `realestate` | `[]` | `['city', 'category', 'listingType', 'minPrice', 'maxPrice', 'page', 'limit']` | `false` |
| `listing_detail` | `realestate` | `['productId']` | `['url']` | `false` |

### AC-2: `p_sync` Payload Decoding & Nibble-Swap
- **Given** chuỗi bytes nhị phân mã hóa từ endpoint `https://apimap.batdongsan.com.vn/api/p_sync`
- **When** qua hàm `decodeBatdongsanPayload(rawBuffer)`
- **Then** thực thi tuần tự: `gzip decompression -> base64 decode -> nibble swap -> JSON parse` và khôi phục đúng cấu trúc JSON `{ data: [...] }`.

### AC-3: Listing Search & Normalization
- **Given** gọi `crawler.start({ action: 'search_listings', args: { city: 'SG', category: 'can-ho', limit: 10 } })`
- **When** `BatdongsanClient` thực thi HTTP POST tới `p_sync`
- **Then** kết quả trả về `{ listings: PostItem[], pageInfo: { current_page: number, has_next_page: boolean, total_items?: number } }`.
- **And** mỗi tin đăng chuẩn hóa thành `PostItem` với `id: 'batdongsan:listing:<productId>'`, `category: 'realestate'`, `metadata.price`, `metadata.priceM2`, `metadata.size`, `metadata.location`, `metadata.rooms`.

### AC-4: Unified `scrape("batdongsan", ...)` Dispatcher & Package Exports
- **Given** `scrape('batdongsan', 'search_listings', { city: 'HN' })`
- **When** gọi từ `src/scrapers/index.js`
- **Then** khởi tạo `BatdongsanCrawler` và trả về danh sách `listings`.
- **And** `package.json` export `./scrapers/realestate/batdongsan`.

### AC-5: No-Mocks Integration Test Suite
- **Given** `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js`
- **When** chạy `npx vitest run tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js`
- **Then** toàn bộ test cases (search_listings, listing_detail, nibble-swap decoding, validator, dispatcher) đều PASS 100%.

## Tasks / Subtasks

- [ ] **Task 1 — Core Module Scaffolding (AC-1, AC-4)**
  - [ ] 1.1 Tạo thư mục `src/scrapers/realestate/batdongsan/`.
  - [ ] 1.2 Tạo `client.js` — `BatdongsanClient` kế thừa `AbstractApiClient`.
  - [ ] 1.3 Tạo `validator.js` — `BatdongsanPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`.
  - [ ] 1.4 Tạo `crawler.js` — `BatdongsanCrawler` kế thừa `AbstractCrawler` với 2 action descriptors.
  - [ ] 1.5 Tạo `index.js` barrel export và hàm tiện ích `scrapeBatdongsan`.
  - [ ] 1.6 Cập nhật `package.json` exports và `src/scrapers/index.js` dispatcher.

- [ ] **Task 2 — De-obfuscation & Normalization Engine (AC-2, AC-3)**
  - [ ] 2.1 Tạo `src/scrapers/realestate/batdongsan/normalize-batdongsan.js`.
  - [ ] 2.2 Viết `nibbleSwap(buf)` và `decodeBatdongsanPayload(rawBuffer)`.
  - [ ] 2.3 Viết `normalizeBatdongsanListing(productObj)` → `PostItem`.
  - [ ] 2.4 Cấu hình map thành phố (`SG`, `HN`, `DN`) và danh mục BĐS.

- [ ] **Task 3 — Crawler Action Handlers (AC-3)**
  - [ ] 3.1 Cài đặt `searchListings(args, session)` — gọi `p_sync` giải mã payload và phân trang.
  - [ ] 3.2 Cài đặt `listingDetail(args, session)` — bóc tách chi tiết tin BĐS.
  - [ ] 3.3 Tích hợp `storeBatch()` với `PrismaStore` và checkpointing.

- [ ] **Task 4 — Anti-bot & Response Validation (AC-1)**
  - [ ] 4.1 Cài đặt `BatdongsanPlatformResponseValidator.isBotChallenge` phát hiện Cloudflare / rate limit.
  - [ ] 4.2 Cài đặt `isValidPayload` kiểm tra cấu trúc payload `data` hợp lệ.

- [ ] **Task 5 — Test Suite & Verification (AC-5)**
  - [ ] 5.1 Tạo `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js` dùng `node:http`.
  - [ ] 5.2 Test nibble-swap decoding, search, detail, unified dispatcher.
  - [ ] 5.3 Chạy test suite và xác nhận 100% green.

## Dev Notes
- Mobile API URL: `https://apimap.batdongsan.com.vn/api/p_sync`
- Mobile User-Agent: `Dalvik/2.1.0 (Linux; U; Android 8.0.0; SM-G9500 Build/R16NW)`
- City codes: `SG` (Hồ Chí Minh), `HN` (Hà Nội), `DN` (Đà Nẵng), `BD` (Bình Dương), `DDN` (Đồng Nai).
