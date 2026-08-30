---
story_id: '16.2'
epic: 16
story_key: '16-2-tiktok-shop-product-sales-scraper'
status: "ready-for-dev"
phase: "Phase 3"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "3bf943541a7a3a49cc0f1cbfd726a99175d2748e"
---

# Story 16.2 — TikTok Shop Product & Sales Scraper

Status: ready-for-dev

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

- [ ] Task 1 (AC-1, AC-2): Xây dựng `TikTokShopClient` & `TikTokShopPlatformResponseValidator`
  - [ ] 1.1 Tạo `src/scrapers/ecom/tiktok-shop/client.js` kết nối `TikTokBrowserBridge`
  - [ ] 1.2 Tạo `src/scrapers/ecom/tiktok-shop/validator.js`
- [ ] Task 2 (AC-1, AC-4): Xây dựng `normalize-product.js`
  - [ ] 2.1 Chuẩn hóa sản phẩm TikTok Shop thành `PostItem` (`category: 'ecom'`)
- [ ] Task 3 (AC-1, AC-2, AC-3): Xây dựng `TikTokShopCrawler`
  - [ ] 3.1 Đăng ký 3 actions `top_products`, `product_detail`, `search_products`
  - [ ] 3.2 Triển khai handlers gọi TikTok Shop APIs
- [ ] Task 4 (AC-5): Tích hợp Dispatcher & Package Exports
  - [ ] 4.1 Tạo `src/scrapers/ecom/tiktok-shop/index.js`
  - [ ] 4.2 Bổ sung nhánh `tiktokshop`/`tiktok_shop` vào `src/scrapers/index.js`
  - [ ] 4.3 Khai báo export `"./scrapers/ecom/tiktok-shop"` trong `package.json`
- [ ] Task 5 (AC-6): TDD Test Suite & Hoàn thiện
  - [ ] 5.1 Viết `tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js`
  - [ ] 5.2 Chạy pass test suite và sync sprint-status

---

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

*(Để điền sau khi hoàn thành dev.)*

### File List

#### UPDATE
- `src/scrapers/index.js`
- `package.json`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

#### NEW
- `src/scrapers/ecom/tiktok-shop/crawler.js`
- `src/scrapers/ecom/tiktok-shop/client.js`
- `src/scrapers/ecom/tiktok-shop/validator.js`
- `src/scrapers/ecom/tiktok-shop/normalize-product.js`
- `src/scrapers/ecom/tiktok-shop/index.js`
- `tests/scrapers/ecom/tiktok-shop/crawler-tiktok-shop.test.js`
