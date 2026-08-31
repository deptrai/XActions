---
story_id: "17.2"
epic: 17
story_key: "17-2-batdongsan-com-vn-property-scraper"
status: "done"
phase: "Phase 3"
created: 2026-08-27
updated: 2026-09-01
last_updated: 2026-09-01T00:30:00Z
owner: "DEV"
reviewed: "approved"
baseline_commit: "bd62f1fb"
---

# Story 17.2: Batdongsan.com.vn Property Scraper

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-09-01  
**Summary:**
- `BatdongsanCrawler` và `BatdongsanClient` kế thừa `AbstractCrawler` và `AbstractApiClient` chuẩn mực, đăng ký 2 actions: `search_listings`, `listing_detail`.
- Cài đặt hoàn chỉnh bộ giải mã luồng nhị phân Mobile API (`p_sync`): Gzip ➔ Base64 ➔ Bitwise Nibble-Swap ➔ JSON Parse.
- Ánh xạ mã vùng tỉnh thành (`SG`, `HN`, `DN`, `BD`, `DDN`) và mã danh mục BĐS (`can-ho`: 41, `nha-rieng`: 49, `dat-nen`: 40, `biet-thu`: 50).
- Toàn bộ 11/11 tests tại `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js` và `tests/e2e/batdongsan-realestate.e2e.test.js` passed 100%.

## ⚠️ Critical Constraints & Architecture Guidelines

1. **Architecture Compliance (AD-2, AD-3, AD-14):**
   - Must extend `AbstractCrawler` in `src/scrapers/realestate/batdongsan/crawler.js` and `AbstractApiClient` in `src/scrapers/realestate/batdongsan/client.js`.
   - Must provide `BatdongsanPlatformResponseValidator` extending `AbstractPlatformResponseValidator` in `src/scrapers/realestate/batdongsan/validator.js`.
   - Must expose clean barrel in `src/scrapers/realestate/batdongsan/index.js` and integrate into `src/scrapers/index.js` (`scrape('batdongsan', ...)`).
2. **Mobile API Endpoint & De-obfuscation Engine (`p_sync`):**
   - Base endpoint: `POST https://apimap.batdongsan.com.vn/api/p_sync`.
   - De-obfuscation pipeline: `raw buffer -> gzip (optional) -> base64 decode -> nibble-swap (swap high/low 4 bits of each byte) -> UTF-8 JSON parse`.
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

## Tasks / Subtasks

- [x] **Task 1 — Core Module Scaffolding (AC-1, AC-4)**
  - [x] 1.1 Tạo thư mục `src/scrapers/realestate/batdongsan/`.
  - [x] 1.2 Tạo `client.js` — `BatdongsanClient` kế thừa `AbstractApiClient`.
  - [x] 1.3 Tạo `validator.js` — `BatdongsanPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`.
  - [x] 1.4 Tạo `crawler.js` — `BatdongsanCrawler` kế thừa `AbstractCrawler` với 2 action descriptors.
  - [x] 1.5 Tạo `index.js` barrel export và hàm tiện ích `scrapeBatdongsan`.
  - [x] 1.6 Cập nhật `package.json` exports và `src/scrapers/index.js` dispatcher.

- [x] **Task 2 — De-obfuscation & Normalization Engine (AC-2, AC-3)**
  - [x] 2.1 Tạo `src/scrapers/realestate/batdongsan/normalize-batdongsan.js`.
  - [x] 2.2 Viết `nibbleSwap(buf)` và `decodeBatdongsanPayload(rawBuffer)`.
  - [x] 2.3 Viết `normalizeBatdongsanListing(productObj)` → `PostItem`.
  - [x] 2.4 Cấu hình map thành phố (`SG`, `HN`, `DN`) và danh mục BĐS.

- [x] **Task 3 — Crawler Action Handlers (AC-3)**
  - [x] 3.1 Cài đặt `searchListings(args, session)` — gọi `p_sync` giải mã payload và phân trang.
  - [x] 3.2 Cài đặt `listingDetail(args, session)` — bóc tách chi tiết tin BĐS.
  - [x] 3.3 Tích hợp `storeBatch()` với `PrismaStore` và checkpointing.

- [x] **Task 4 — Anti-bot & Response Validation (AC-1)**
  - [x] 4.1 Cài đặt `BatdongsanPlatformResponseValidator.isBotChallenge` phát hiện Cloudflare / rate limit.
  - [x] 4.2 Cài đặt `isValidPayload` kiểm tra cấu trúc payload `data` hợp lệ.

- [x] **Task 5 — Test Suite & Verification (AC-5)**
  - [x] 5.1 Tạo `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js` dùng `node:http`.
  - [x] 5.2 Test nibble-swap decoding, search, detail, unified dispatcher.
  - [x] 5.3 Tạo `tests/e2e/batdongsan-realestate.e2e.test.js` cho E2E verification.
  - [x] 5.4 Chạy test suite và xác nhận 100% green.

## Dev Agent Record

### Implementation Plan
- Khởi tạo thư mục `src/scrapers/realestate/batdongsan/`.
- Cài đặt `BatdongsanClient`, `BatdongsanPlatformResponseValidator`, `normalize-batdongsan.js` (Bitwise Nibble-Swap & Gzip de-obfuscation), `BatdongsanCrawler`, và barrel `index.js`.
- Đăng ký `batdongsan` vào unified `scrape()` dispatcher tại `src/scrapers/index.js` và `package.json` exports.
- Viết test suite ATDD `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js` và E2E `tests/e2e/batdongsan-realestate.e2e.test.js`.

### Completion Notes
- Tất cả 11/11 test cases đều PASS 100%.
- De-obfuscation pipeline giải mã chính xác payload nhị phân `p_sync`.

## File List
- `src/scrapers/realestate/batdongsan/client.js` (NEW)
- `src/scrapers/realestate/batdongsan/validator.js` (NEW)
- `src/scrapers/realestate/batdongsan/normalize-batdongsan.js` (NEW)
- `src/scrapers/realestate/batdongsan/crawler.js` (NEW)
- `src/scrapers/realestate/batdongsan/index.js` (NEW)
- `tests/scrapers/realestate/batdongsan/crawler-batdongsan.test.js` (NEW)
- `tests/e2e/batdongsan-realestate.e2e.test.js` (NEW)
- `src/scrapers/index.js` (MODIFIED)
- `package.json` (MODIFIED)
- `_bmad-output/implementation-artifacts/17-2-batdongsan-com-vn-property-scraper.md` (MODIFIED)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)

## Change Log
- 2026-09-01: Triển khai hoàn thiện Story 17.2 Batdongsan.com.vn Property Scraper theo chuẩn BMad Hexagonal Architecture.
