---
story_id: "17.1"
epic: 17
story_key: "17-1-chotot-multi-category-scraper-with-phone-mask-detector"
status: "done"
phase: "Phase 3"
created: 2026-08-27
updated: 2026-08-31
last_updated: 2026-08-31T10:30:00Z
owner: "DEV"
reviewed: "approved"
baseline_commit: "515fae5d"
---

# Story 17.1: Chợ Tốt Multi-Category Scraper with Phone Mask Detector

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-08-31  
**Summary:**
- `ChototCrawler` và `ChototClient` kế thừa `AbstractCrawler` và `AbstractApiClient` chuẩn mực, đăng ký 3 actions: `search_listings`, `listing_detail`, `get_phone`.
- Tích hợp chuẩn mã hóa RSA-PKCS1v15 bằng `node:crypto` với public key Chợ Tốt 2048-bit để sinh token `e` giải mã số điện thoại.
- Bộ lọc `validateAndFormatPhone` loại bỏ triệt để số điện thoại masked (`*`, `x`, `X`) và xác thực đầu số 10 chữ số nhà mạng Việt Nam.
- Đã kiểm thử live với API thật của Chợ Tốt: bóc tách chính xác tin đăng BĐS, giá tiền, diện tích, hình ảnh và giải mã số điện thoại chính chủ.
- Toàn bộ 13/13 unit & E2E tests tại `tests/scrapers/realestate/chotot/crawler-chotot.test.js` và `tests/e2e/chotot-realestate.e2e.test.js` passed 100%.

## ⚠️ Critical Constraints & Architecture Guidelines

1. **Architecture Compliance (AD-2, AD-3, AD-14):**
   - Must extend `AbstractCrawler` in `src/scrapers/realestate/chotot/crawler.js` and `AbstractApiClient` in `src/scrapers/realestate/chotot/client.js`.
   - Must provide `ChototPlatformResponseValidator` extending `AbstractPlatformResponseValidator` in `src/scrapers/realestate/chotot/validator.js`.
   - Must expose clean barrel in `src/scrapers/realestate/chotot/index.js` and integrate into `src/scrapers/index.js` (`scrape('chotot', ...)`).
2. **Chợ Tốt Gateway API & RSA Public Key Phone Decryption:**
   - Base Gateway: `https://gateway.chotot.com`.
   - Listing search endpoint: `GET https://gateway.chotot.com/v1/public/ad-listing` with query parameters (`cg`, `region_v2`, `area_v2`, `limit`, `o`, `st`, `price`, `size`).
   - Phone decryption endpoint: `GET https://gateway.chotot.com/v1/public/ad-listing/phone?e=<base64_encrypted_list_id>`.
   - RSA PKCS#1 v1.5 encryption for `list_id` using Node's standard `crypto.publicEncrypt(publicKey, buffer)`.
3. **Phone Mask & Vietnamese Mobile Validation (Regex):**
   - Filter out masked phone numbers containing `*` or letters (e.g. `090****123`).
   - Validate unmasked numbers with official Vietnamese telecommunications prefix regex: `^(0|\+84)(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$`.
   - Normalize phone number to standard E.164 format or zero-leading format (`0901234567`).
4. **Multi-Category Group (cg) Support:**
   - `bds`: `cg=1000` (subcategories: `apartment`=1010, `house`=1020, `office`=1030, `land`=1040) (detail origin: `https://www.nhatot.com`).
   - `cars`: `cg=2010`, `motorbikes`: `cg=2020` (detail origin: `https://xe.chotot.com`).
   - `electronics`: `cg=5000`, `pets`: `cg=12000`, `fashion`: `cg=3000`, `home_goods`: `cg=8000`, `jobs`: `cg=13000` (detail origin: `https://www.chotot.com`).
5. **Data Normalization & Namespaced Models:**
   - Real estate & classified listings normalized as `PostItem` (`id: chotot:ad:<listId>`, `platform: 'chotot'`, `category: 'realestate'` / `'ecom'`).
   - Seller normalized as `ProfileItem` (`id: chotot:account:<accountOid>`, `platform: 'chotot'`).
   - Store batch in `PrismaStore.storeBatch()` and save crawl checkpoints.
6. **Zero Mocks Testing (AD-10):**
   - Tests in `tests/scrapers/realestate/chotot/crawler-chotot.test.js` using local `node:http` mock servers.

## Story

As a **Real Estate Broker & B2B Lead Generator**,  
I want **cào tin rao bất động sản, xe cộ, đồ điện tử trên Chợ Tốt và giải mã số điện thoại chính chủ bằng RSA encryption kèm bộ lọc phát hiện SĐT bị ẩn (`***`)**,  
So that **Nowing AI Lead Hub nhận được 100% dữ liệu tin đăng và số điện thoại liên hệ chính chủ có khả năng chuyển đổi cao.**

## Tasks / Subtasks

- [x] **Task 1 — Core Module Scaffolding (AC-1, AC-5)**
  - [x] 1.1 Tạo thư mục `src/scrapers/realestate/chotot/` và schema `schemas/realestate/property.json`.
  - [x] 1.2 Tạo `client.js` — `ChototClient` kế thừa `AbstractApiClient` kèm RSA encryption.
  - [x] 1.3 Tạo `validator.js` — `ChototPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`.
  - [x] 1.4 Tạo `crawler.js` — `ChototCrawler` kế thừa `AbstractCrawler` với 3 action descriptors.
  - [x] 1.5 Tạo `index.js` barrel export và hàm tiện ích `scrapeChotot`.
  - [x] 1.6 Cập nhật `package.json` exports và `src/scrapers/index.js` dispatcher.

- [x] **Task 2 — Normalizer, Category Config & Phone Security Engine (AC-2, AC-3, AC-4)**
  - [x] 2.1 Tạo `src/scrapers/realestate/chotot/normalize-chotot.js`.
  - [x] 2.2 Cấu hình mapping `CATEGORY_CONFIG` (bds, cars, motorbikes, electronics, jobs, pets, v.v.).
  - [x] 2.3 Viết hàm `encryptChototListId(listId)` dùng `crypto.publicEncrypt`.
  - [x] 2.4 Viết hàm `validateAndFormatPhone(phone)` kiểm tra regex SĐT VN và loại bỏ mask `*`.
  - [x] 2.5 Viết `normalizeChototListing(adObj)` → `PostItem` với metadata real estate/ecommerce.

- [x] **Task 3 — Crawler Action Handlers (AC-2, AC-3, AC-4)**
  - [x] 3.1 Cài đặt `searchListings(args, session)` — gọi public gateway `ad-listing` API kèm optional phone resolution.
  - [x] 3.2 Cài đặt `listingDetail(args, session)` — bóc tách chi tiết tin đăng.
  - [x] 3.3 Cài đặt `getPhone(args, session)` — giải mã và xác thực số điện thoại.
  - [x] 3.4 Tích hợp `storeBatch()` với `PrismaStore` và checkpointing.

- [x] **Task 4 — Anti-bot & Response Validation (AC-1)**
  - [x] 4.1 Cài đặt `ChototPlatformResponseValidator.isBotChallenge` phát hiện Cloudflare / Akamai 403.
  - [x] 4.2 Cài đặt `isValidPayload` kiểm tra cấu trúc JSON trả về `ads` array hoặc phone object.

- [x] **Task 5 — Test Suite & Verification (AC-6)**
  - [x] 5.1 Tạo `tests/scrapers/realestate/chotot/crawler-chotot.test.js` dùng `node:http`.
  - [x] 5.2 Test RSA encryption, phone mask validation, search, listing detail, dispatcher.
  - [x] 5.3 Tạo `tests/e2e/chotot-realestate.e2e.test.js` xác thực live public API.
  - [x] 5.4 Chạy test suite và xác nhận 100% green.

## Dev Agent Record

### Implementation Plan
- Khởi tạo thư mục `src/scrapers/realestate/chotot/` cùng schema `schemas/realestate/property.json`.
- Cài đặt `ChototClient`, `ChototPlatformResponseValidator`, `normalize-chotot.js`, `ChototCrawler`, và barrel `index.js`.
- Đăng ký `chotot` vào unified `scrape()` dispatcher tại `src/scrapers/index.js` và `package.json` exports.
- Viết test suite ATDD `tests/scrapers/realestate/chotot/crawler-chotot.test.js` và E2E Live API `tests/e2e/chotot-realestate.e2e.test.js`.

### Completion Notes
- Tất cả 13/13 test cases đều PASS 100%.
- Kiểm thử Live API Chợ Tốt: giải mã RSA thành công, bóc tách chính xác số điện thoại và tin đăng BĐS thực tế.

## File List
- `src/scrapers/realestate/chotot/client.js` (NEW)
- `src/scrapers/realestate/chotot/validator.js` (NEW)
- `src/scrapers/realestate/chotot/normalize-chotot.js` (NEW)
- `src/scrapers/realestate/chotot/crawler.js` (NEW)
- `src/scrapers/realestate/chotot/index.js` (NEW)
- `schemas/realestate/property.json` (NEW)
- `tests/scrapers/realestate/chotot/crawler-chotot.test.js` (NEW)
- `tests/e2e/chotot-realestate.e2e.test.js` (NEW)
- `src/scrapers/index.js` (MODIFIED)
- `package.json` (MODIFIED)
- `_bmad-output/implementation-artifacts/17-1-chotot-multi-category-scraper-with-phone-extractor.md` (MODIFIED)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)

## Change Log
- 2026-08-31: Triển khai hoàn thiện Story 17.1 Chợ Tốt Multi-Category Scraper with Phone Mask Detector theo chuẩn BMad Hexagonal Architecture.
