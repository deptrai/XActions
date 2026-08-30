---
story_id: '16.1'
epic: 16
story_key: '16-1-shopee-search-product-review-scraper-tls-spoofing'
status: "ready-for-dev"
phase: "Phase 3"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "171be0ea89b9ec8832a829e34e5659858547b748"
---

# Story 16.1 — Shopee Search, Product & Review Scraper with TLS Spoofing

Status: ready-for-dev

## Story

As an **E-Commerce Merchant / Data Analyst**,  
I want **cào danh mục sản phẩm (`search_products`), chi tiết sản phẩm (`product_detail`), và đánh giá người mua (`product_reviews`) trên Shopee Việt Nam qua `ShopeeCrawler` kết hợp TLS Spoofing và Anti-Bot Detection**,  
so that **tôi có thể theo dõi giá bán, doanh số ước tính và phân tích đối thủ cạnh tranh mà không bị chặn bởi Akamai WAF**.

---

## Scope Note

Story 16.1 triển khai Shopee E-Commerce crawler đầu tiên trong Epic 16 trên nền tảng `AbstractCrawler` + `AbstractApiClient`:
1. **Module Location:** `src/scrapers/ecom/shopee/`
   - `crawler.js` — `ShopeeCrawler` kế thừa `AbstractCrawler`
   - `client.js` — `ShopeeClient` kế thừa `AbstractApiClient` sử dụng `got-scraping` (TLS/JA4 fingerprint spoofing)
   - `validator.js` — `ShopeePlatformResponseValidator` phát hiện mã lỗi anti-bot (ví dụ mã captcha `90309999` hoặc `error: -1`)
   - `normalize-product.js` — chuẩn hóa sản phẩm và đánh giá thành `PostItem` với `category: 'ecom'`, ID namespaced `shopee:${itemId}`
   - `index.js` — xuất `ShopeeCrawler`, `ShopeeClient`, `scrapeShopee`
2. **Actions:**
   - `search_products` (hoặc `search`): Tìm kiếm sản phẩm theo keyword, sắp xếp theo relevance/sales/top_sales.
   - `product_detail`: Lấy chi tiết thông tin sản phẩm (giá, tồn kho, flash sale, shop ID, mô tả).
   - `product_reviews`: Lấy danh sách đánh giá, sao rating, bình luận người mua của sản phẩm theo item ID + shop ID.
3. **Anti-Bot & Proxy Pool:**
   - Sử dụng `ProxyIpPool` với proxy xoay vòng tự động (Rotating Residential).
   - Khi phát hiện mã captcha `90309999` hoặc error challenge, throw `BotChallengeError` (`XACT_4030`, `suggestedAction: 'rotate_proxy'`).
4. **Data Normalization:**
   - Trả về `PostItem` / `CommentItem` với `category: 'ecom'` và metadata cấu trúc: `{ price, originalPrice, currency: 'VND', soldCount, rating, stock, shopId, itemId, discountPercent, location }`.
5. **Unified Dispatcher & Package Exports:**
   - Khai báo export `./scrapers/ecom/shopee` trong `package.json`.
   - Bổ sung nhánh `shopee` vào unified `scrape('shopee', action, options)` trong `src/scrapers/index.js`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 16.1 [dòng 857-868]
- `_bmad-output/planning-artifacts/prd.md` — FR-76, NFR-11/12/13/15/18 [dòng 91, 114-120]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-2, AD-3, AD-11, AD-14, AD-18
- `src/core/base-crawler.js` — `AbstractCrawler`
- `src/core/base-client.js` — `AbstractApiClient` (`got-scraping` transport)
- `src/core/platform-validator.js` — `AbstractPlatformResponseValidator`
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`
- `src/scrapers/index.js` — Unified dispatcher

---

## Cross-Epic Dependencies

- **Phụ thuộc Epic 10.1 & 10.2:** `AbstractCrawler`, `AbstractApiClient`, `PostItem`, `CommentItem`, `PrismaStore`.
- **Phụ thuộc Epic 11:** `ProxyIpPool`, `AdaptiveRateGovernor` (TLS Spoofing + IP Rotation).
- **Mở khóa Story 16.2:** TikTok Shop Product & Sales Scraper.

---

## Acceptance Criteria

### AC-1: ShopeeCrawler & Action Registration

* **Given** `ShopeeCrawler` trong `src/scrapers/ecom/shopee/crawler.js` kế thừa `AbstractCrawler`
* **When** khởi tạo crawler
* **Then** 3 action sau được đăng ký với descriptor chuẩn `ActionDescriptor`:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth | category |
|---|---|---|---|---|---|---|
| `search_products` | `['keyword']` | `['limit', 'page', 'sortBy', 'category']` | `{ keyword: 'ao thun', limit: 30, sortBy: 'sales' }` | `{ products: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }` | `false` | `ecom` |
| `product_detail` | `['itemId', 'shopId']` | `[]` | `{ itemId: '123456', shopId: '7890' }` | `{ product: PostItem }` | `false` | `ecom` |
| `product_reviews` | `['itemId', 'shopId']` | `['limit', 'offset', 'filterRating']` | `{ itemId: '123456', shopId: '7890', limit: 20 }` | `{ reviews: CommentItem[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }` | `false` | `ecom` |

* **And** `requiresAuth` mặc định là `false` (sử dụng guest mode + Rotating Proxy).

### AC-2: TLS/JA4 Spoofing & Web Search API

* **Given** `ShopeeClient` trong `src/scrapers/ecom/shopee/client.js` kế thừa `AbstractApiClient`
* **When** gọi endpoint Shopee Web API (ví dụ `https://shopee.vn/api/v4/search/search_items` hoặc `https://shopee.vn/api/v4/item/get`)
* **Then** request được thực hiện qua `got-scraping` với headers giả lập trình duyệt (bao gồm `x-api-source: rpc`, `referer: https://shopee.vn/`).
* **And** hỗ trợ `ProxyIpPool` xoay IP theo từng lượt gọi.

### AC-3: Anti-Bot & Captcha Challenge Detection

* **Given** response từ Shopee API
* **When** response trả về mã lỗi captcha `90309999`, `error: -1`, hoặc HTML Cloudflare/Akamai challenge page
* **Then** `ShopeePlatformResponseValidator.isBotChallenge(response)` trả về `true`
* **And** client throw `BotChallengeError` (`XACT_4030`, `statusCode: 403`, `suggestedAction: 'rotate_proxy'`).

### AC-4: Normalization & Storage

* **Given** response thành công chứa danh sách items hoặc reviews
* **When** normalize dữ liệu
* **Then** sinh ra `PostItem` với ID namespaced `shopee:${itemId}` và `category: 'ecom'`.
* **And** metadata chứa các trường chuẩn:
  - `price`: Giá bán hiện tại (đơn vị VND)
  - `originalPrice`: Giá gốc trước giảm
  - `soldCount`: Số lượng đã bán (lũy kế)
  - `rating`: Điểm đánh giá trung bình (1.0 - 5.0)
  - `stock`: Tồn kho khả dụng
  - `shopId`: ID của người bán
  - `itemId`: ID sản phẩm Shopee
  - `discountPercent`: Tỷ lệ giảm giá (%)
* **And** lưu trữ thành công vào PostgreSQL qua `PrismaStore`.

### AC-5: Unified Dispatcher `scrape('shopee', ...)`

* **Given** `src/scrapers/index.js`
* **When** gọi `scrape('shopee', 'search_products', { keyword: 'laptop' })`
* **Then** tự động định tuyến tới `ShopeeCrawler` và trả về kết quả chuẩn hóa.

### AC-6: Test Suite Coverage

* **Given** Vitest test suite `tests/scrapers/ecom/shopee/crawler-shopee.test.js`
* **When** chạy kiểm thử
* **Then** pass toàn bộ các trường hợp:
  - Đăng ký đúng 3 action descriptors (`category: 'ecom'`, `requiresAuth: false`)
  - `search_products` trả về `PostItem[]` với metadata thương mại điện tử đúng
  - `product_detail` trích xuất chi tiết sản phẩm
  - `product_reviews` trích xuất đánh giá và rating
  - `isBotChallenge` nhận diện mã `90309999` và throw `BotChallengeError`
  - Unified dispatcher `scrape('shopee', ...)` hoạt động trơn tru

---

## Tasks / Subtasks

- [ ] Task 1 (AC-1, AC-2): Xây dựng `ShopeeClient` & `ShopeePlatformResponseValidator`
  - [ ] 1.1 Tạo `src/scrapers/ecom/shopee/client.js` với các headers đặc thù của Shopee
  - [ ] 1.2 Tạo `src/scrapers/ecom/shopee/validator.js` nhận diện mã captcha `90309999`
- [ ] Task 2 (AC-1, AC-4): Xây dựng `normalize-product.js`
  - [ ] 2.1 Chuẩn hóa sản phẩm Shopee thành `PostItem` (`category: 'ecom'`)
  - [ ] 2.2 Chuẩn hóa đánh giá Shopee thành `CommentItem`
- [ ] Task 3 (AC-1, AC-2, AC-3): Xây dựng `ShopeeCrawler`
  - [ ] 3.1 Đăng ký 3 actions `search_products`, `product_detail`, `product_reviews`
  - [ ] 3.2 Triển khai handlers gọi API Shopee v4 (`/api/v4/search/search_items`, `/api/v4/item/get`, `/api/v4/item/get_ratings`)
- [ ] Task 4 (AC-5): Tích hợp Dispatcher & Package Exports
  - [ ] 4.1 Tạo `src/scrapers/ecom/shopee/index.js`
  - [ ] 4.2 Thêm nhánh `shopee` trong `src/scrapers/index.js`
  - [ ] 4.3 Khai báo export `"./scrapers/ecom/shopee"` trong `package.json`
- [ ] Task 5 (AC-6): TDD Test Suite & Hoàn thiện
  - [ ] 5.1 Viết `tests/scrapers/ecom/shopee/crawler-shopee.test.js`
  - [ ] 5.2 Chạy pass test suite và sync sprint-status

---

## Dev Agent Record

### Implementation Plan

1. Tạo thư mục `src/scrapers/ecom/shopee/`.
2. Triển khai `ShopeeClient` kế thừa `AbstractApiClient`.
3. Triển khai `ShopeePlatformResponseValidator` nhận diện lỗi anti-bot Shopee.
4. Triển khai `normalize-product.js` chuyển đổi raw Shopee JSON sang `PostItem` / `CommentItem`.
5. Triển khai `ShopeeCrawler` kế thừa `AbstractCrawler`.
6. Tích hợp `scrape('shopee', ...)` vào `src/scrapers/index.js` và cập nhật `package.json`.
7. Viết test suite `tests/scrapers/ecom/shopee/crawler-shopee.test.js`.

### Completion Notes

*(Để điền sau khi hoàn thành dev.)*

### File List

#### UPDATE
- `src/scrapers/index.js` — bổ sung dispatcher cho Shopee
- `package.json` — export `./scrapers/ecom/shopee`
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — cập nhật status `16-1` sang `ready-for-dev`

#### NEW
- `src/scrapers/ecom/shopee/crawler.js`
- `src/scrapers/ecom/shopee/client.js`
- `src/scrapers/ecom/shopee/validator.js`
- `src/scrapers/ecom/shopee/normalize-product.js`
- `src/scrapers/ecom/shopee/index.js`
- `tests/scrapers/ecom/shopee/crawler-shopee.test.js`
