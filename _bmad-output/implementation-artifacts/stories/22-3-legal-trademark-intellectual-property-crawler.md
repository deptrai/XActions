---
title: 'Story 22.3: Legal & Trademark Intellectual Property Crawler (Cục Sở hữu Trí tuệ)'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'bc8fdd1f'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-technical-feasibility-research-2026-08-21.md
  - src/scrapers/index.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần phát hiện sớm các đơn đăng ký nhãn hiệu, sáng chế mới nộp từ Cục Sở hữu Trí tuệ Việt Nam để tiếp cận sớm các doanh nghiệp chuẩn bị ra mắt thương hiệu/sản phẩm mới (cung cấp dịch vụ Marketing, Thiết kế bao bì, Công bố chất lượng sản phẩm và Pháp lý sở hữu trí tuệ).

**Approach:**
1. Tạo `IpLegalCrawler` tại `src/scrapers/legal/ip-trademark/index.js` kế thừa `AbstractCrawler`.
2. Hỗ trợ nguồn dữ liệu công báo điện tử từ `ipvietnam.gov.vn` (danh sách đơn nhãn hiệu/sáng chế chuyển công bố hàng tuần và danh bạ tổng hợp năm).
3. Bóc tách dữ liệu: `applicationNumber`, `applicationDate`, `publicationDate`, `gazettePeriod`, `status`, `applicantName`, `trademarkName`.
4. Chuẩn hóa `PostItem` với `platform: 'ipvietnam'`, `category: 'legal'`.
5. Dispatch alias: `ipvietnam`, `ip_legal`, `legal`.

## Boundaries & Constraints

**Always:**
- Tuân thủ AD-22/NFR-19.
- Thiết lập `rejectUnauthorized: false` trên kết nối HTTPS tới `ipvietnam.gov.vn` để vượt qua lỗi chuỗi chứng chỉ SSL thiếu intermediate CA của cổng chính phủ.
- Dùng kết nối trực tiếp (`requiresProxy: false`, `requiresAuth: false`) do cổng thông tin công khai không chặn IP Việt Nam.
- Chuẩn hóa số đơn theo định dạng chuẩn (ví dụ: `4-2026-11740`, `4-2024-14654`).

**Ask First:**
- Nếu cần cào các nguồn văn bản quy phạm pháp luật khác (ví dụ: `vanban.chinhphu.vn`).

**Never:**
- Không cố truy cập các tài liệu mật hoặc thông tin chưa công bố.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Search weekly gazette | `scrape('ipvietnam','search_gazette',{page:1})` | Trademark application list | Empty → `[]` |
| Get weekly list by URL | `scrape('ipvietnam','get_weekly_list',{articleUrl:'...'})` | List of applications in article | Invalid URL → `XACT_4001` |
| Detail application | `scrape('ipvietnam','detail',{id:'4-2026-11740'})` | `PostItem` with application info | Not found → `XACT_4004` |
| Yearly summary | `scrape('ipvietnam','yearly_summary',{year:2026})` | Gazette downloads & aggregate stats | Not found → `XACT_4004` |

</frozen-after-approval>

## Acceptance Criteria (BDD)

### AC 1: Architecture & Base Class Conformance
- **Given** `IpLegalCrawler` tại `src/scrapers/legal/ip-trademark/crawler.js`
- **When** crawler được khởi tạo
- **Then** nó kế thừa `AbstractCrawler`, thiết lập `platform: 'ipvietnam'`, `category: 'legal'`, `requiresProxy: false`, `requiresAuth: false`, và cài đặt đầy đủ lifecycle `init()` và `cleanup()`.

### AC 2: Weekly Gazette List Extraction (`search_gazette` / `get_weekly_list`)
- **Given** cổng công báo Cục SHTT tại `https://ipvietnam.gov.vn/web/guest/danh-sach-don-chuyen-cong-bo-hang-tuan`
- **When** gọi `search_gazette({ page })` hoặc `get_weekly_list({ articleUrl })`
- **Then** crawler bóc tách danh sách các đơn nhãn hiệu chuyển công bố từ bảng HTML 4 cột (`STT`, `Số đơn`, `Ngày nộp đơn`, `Ngày chuyển công bố`)
- **And** trả về mảng `PostItem[]` với pagination metadata (`has_next_page`, `page`, `total`).

### AC 3: Yearly Summary & Document Downloads (`yearly_summary`)
- **Given** bài viết tổng hợp công bố cả năm trên `ipvietnam.gov.vn`
- **When** gọi `yearly_summary({ year: 2026 })`
- **Then** crawler trích xuất danh sách link tải file dữ liệu tổng hợp chính thức (`.xlsx`, `.pdf`) như `NH_2026_updated_34.xlsx`.

### AC 4: Application Detail Query (`detail`)
- **Given** số đơn hợp lệ (ví dụ: `4-2026-11740`)
- **When** gọi `detail({ id: '4-2026-11740' })`
- **Then** crawler trả về 1 `PostItem` duy nhất với đầy đủ metadata của đơn.

### AC 5: Schema Standardization & Types
- **Given** raw HTML hoặc dữ liệu bóc tách
- **When** normalizer xử lý
- **Then** sinh ra `PostItem` hợp lệ:
  - `id`: `ipvietnam:${applicationNumber}`
  - `platform`: `ipvietnam`
  - `category`: `legal`
  - `metadata.applicationNumber`: `string`
  - `metadata.applicationDate`: `string` (ISO format)
  - `metadata.publicationDate`: `string` (ISO format)
  - `metadata.status`: `'chuyển công bố (hợp lệ)'`
  - `metadata.sourcePlatform`: `'ipvietnam'`
- **And** category `legal` được định nghĩa trong `src/core/types.js` (`CATEGORIES.LEGAL = 'legal'`).

### AC 6: Resilience & Platform Validator
- **Given** `IpLegalPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`
- **When** nhận response từ `ipvietnam.gov.vn`
- **Then** kiểm tra tính hợp lệ của HTML (chứa các từ khóa `danh-sach-don`, `công báo`, `sở hữu công nghiệp`), nhận diện rate limit hoặc bảo trì, và từ chối status >= 400.

### AC 7: Persistence & Thin-Event Dispatch
- **Given** crawler có cấu hình `store` và `publisher`
- **When** các mục `PostItem` được bóc tách thành công
- **Then** từng item được xác thực qua `this.validateItem(item)`, lưu trữ vào DB qua `store.savePost(item)` và phát thin-event qua `this.publisher.publish(item)`.

### AC 8: Unified Dispatcher Integration
- **Given** dispatcher `src/scrapers/index.js`
- **When** gọi `scrape('ipvietnam', action, options)` hoặc `scrape('legal', action, options)`
- **Then** lệnh được định tuyến chính xác tới `IpLegalCrawler` và thực thi đúng action.

### AC 9: Test Suite Coverage
- **Given** bộ test tại `tests/scrapers/legal/ip-trademark/`
- **When** chạy `vitest`
- **Then** toàn bộ unit tests và integration tests pass 100% (mock server, validator, schema, crawler, dispatch).

---

## Live Probe Findings (2026-09-08)

**Story approach adjusted after live probe:**

| Target | Probe Result | Resolution |
|---|---|---|
| `wipo.ipvietnam.gov.vn` | ❌ DNS points to 127.0.0.1 (dead) | Abandon legacy WIPO URL |
| `wipopublish.ipvietnam.gov.vn` | ❌ Socket hang up / TLS drop | Do not rely on Wicket UI |
| `ipvietnam.gov.vn/danh-sach-don-chuyen-cong-bo-hang-tuan` | ✅ 200 OK (42KB HTML) | **Primary source:** Liferay portlet listing weekly gazette articles |
| Weekly article pages | ✅ 200 OK HTML tables | Table columns: `STT`, `Số đơn`, `Ngày nộp đơn`, `Ngày chuyển công bố` |
| Yearly summary article | ✅ 200 OK with direct .xlsx/.pdf downloads | `NH_2026_updated_34.xlsx` (621KB, 24,000+ records) |

**Key findings:**
- `ipvietnam.gov.vn` publishes weekly trademark lists directly inside article HTML tables with clean columns: `Số đơn` (e.g. `4-2024-14654`, `4-2026-11740`), `Ngày nộp đơn` (`08/04/2024`), `Ngày chuyển công bố` (`10/04/2026`).
- SSL certificate chain on `ipvietnam.gov.vn` requires `rejectUnauthorized: false`.
- The site responds directly in Vietnam with 200 OK without proxy or authentication.

---

## Code Map

- `src/scrapers/legal/ip-trademark/index.js` — barrel exports + `scrapeIpLegal()` dispatcher helper
- `src/scrapers/legal/ip-trademark/client.js` — `IpLegalClient extends AbstractApiClient`
- `src/scrapers/legal/ip-trademark/crawler.js` — `IpLegalCrawler extends AbstractCrawler`
- `src/scrapers/legal/ip-trademark/schema.js` — date normalizers, application number formatters
- `src/scrapers/legal/ip-trademark/normalizer.js` — raw HTML → `PostItem` normalizer
- `src/scrapers/legal/ip-trademark/validator.js` — `IpLegalPlatformResponseValidator`
- `src/scrapers/index.js` — dispatcher aliases
- `tests/scrapers/legal/ip-trademark/` — unit & integration tests

---

## Tasks / Subtasks

### Phase 0: Foundation & Schema Setup
- [x] **Task 0.1** — Add `legal` to `CATEGORIES` in `src/core/types.js` (AC: #5)
  - [x] Add `LEGAL: 'legal'` to `CATEGORIES` object
  - [x] Verify `isValidCategory('legal')` returns `true`
  - [x] Update `prisma/schema.prisma` category comment
- [x] **Task 0.2** — Create directory `src/scrapers/legal/ip-trademark/` with module files (AC: #1)
  - [x] `index.js`
  - [x] `client.js`
  - [x] `crawler.js`
  - [x] `schema.js`
  - [x] `normalizer.js`
  - [x] `validator.js`

### Phase 1: IpLegalClient
- [x] **Task 1.1** — Implement `IpLegalClient` extending `AbstractApiClient` (AC: #1, #2, #3, #4)
  - [x] `requiresAuth = false`
  - [x] `requiresProxy = false`
  - [x] `rejectUnauthorized: false` for all HTTPS requests to `ipvietnam.gov.vn`
  - [x] `getGazetteList({ page })` — fetches `/web/guest/danh-sach-don-chuyen-cong-bo-hang-tuan`
  - [x] `getArticleContent(articleUrl)` — fetches a specific weekly gazette article
  - [x] `getYearlySummary({ year })` — fetches yearly aggregate document links
  - [x] `detail({ id })` — looks up an application number

### Phase 2: IpLegalCrawler
- [x] **Task 2.1** — Implement `IpLegalCrawler` extending `AbstractCrawler` (AC: #1, #2, #7)
  - [x] Implement `init()` and `cleanup()` lifecycle methods
  - [x] Register actions: `search_gazette`, `get_weekly_list`, `yearly_summary`, `detail`
  - [x] Action aliases: `search` -> `search_gazette`
  - [x] Enforce `this.validateItem(post)` on all returned items
  - [x] Return standard shape: `{ posts: PostItem[], pageInfo: { has_next_page, page, total } }` or `{ post: PostItem }`

### Phase 3: Normalizer & Schema
- [x] **Task 3.1** — Implement `normalizeIpLegalResults(data, kind, options)` (AC: #2, #5)
  - [x] Parse weekly gazette article HTML tables (`STT`, `Số đơn`, `Ngày nộp đơn`, `Ngày chuyển công bố`)
  - [x] Map to `PostItem`:
    - `id`: `ipvietnam:${applicationNumber}`
    - `platform`: `ipvietnam`
    - `category`: `legal`
    - `title`: `Đơn nhãn hiệu ${applicationNumber}`
    - `metadata.applicationNumber`: `4-2026-xxxxx`
    - `metadata.applicationDate`: parsed ISO date
    - `metadata.publicationDate`: parsed ISO date
    - `metadata.gazettePeriod`: week/period string
    - `metadata.status`: `chuyển công bố (hợp lệ)`
    - `metadata.sourcePlatform`: `ipvietnam`
  - [x] Parse yearly summary links (.xlsx/.pdf download URLs)
  - [x] Parse detail record
- [x] **Task 3.2** — Implement date/number helpers in `schema.js` (AC: #5)
  - [x] `normalizeApplicationNumber(raw)`
  - [x] `parseVnDate(rawDate)` (DD/MM/YYYY -> ISO)

### Phase 4: Validator
- [x] **Task 4.1** — `IpLegalPlatformResponseValidator` (AC: #6)
  - [x] Valid if response HTML contains `danh-sach-don` or `công báo` or `sở hữu công nghiệp`
  - [x] Implement `isRateLimit(response)`
  - [x] Implement `isBotChallenge(response)`
  - [x] Reject responses with HTTP status >= 400

### Phase 5: Dispatcher & Integration
- [x] **Task 5.1** — Wire into `src/scrapers/index.js` (AC: #8)
  - [x] Add `ipvietnam`, `ip_legal`, `legal` dispatcher aliases
  - [x] Map actions: `search_gazette`, `search`, `get_weekly_list`, `yearly_summary`, `detail`

### Phase 6: Tests
- [x] **Task 6.1** — Unit tests & Fixtures (AC: #9)
  - [x] `tests/scrapers/legal/ip-trademark/client.test.js`
  - [x] `tests/scrapers/legal/ip-trademark/crawler.test.js`
  - [x] `tests/scrapers/legal/ip-trademark/normalizer.test.js`
  - [x] `tests/scrapers/legal/ip-trademark/schema.test.js`
  - [x] `tests/scrapers/legal/ip-trademark/validator.test.js`
  - [x] `tests/scrapers/legal/ip-trademark/dispatch.test.js`
  - [x] `tests/scrapers/legal/ip-trademark/fixtures/`
- [x] **Task 6.2** — Regression test suite run

---

## Dev Notes

### 0. Add `LEGAL` category
`src/core/types.js` must be updated with `LEGAL: 'legal'` in `CATEGORIES`.

### 1. SSL Handling
`ipvietnam.gov.vn` requires `{ rejectUnauthorized: false }` on all HTTPS requests due to missing intermediate certificate authority on government servers.

### 2. PostItem Schema Mapping
```js
{
  id: `ipvietnam:${applicationNumber}`,
  platform: 'ipvietnam',
  externalId: applicationNumber,
  title: `Đơn nhãn hiệu ${applicationNumber}`,
  category: 'legal',
  authorId: `ipvietnam`,
  authorName: 'Cục Sở hữu Trí tuệ Việt Nam',
  postUrl: articleUrl || `https://ipvietnam.gov.vn`,
  content: `Đơn nhãn hiệu ${applicationNumber} - Ngày nộp: ${applicationDate} - Ngày công bố: ${publicationDate}`,
  metadata: {
    applicationNumber,
    applicationDate,
    publicationDate,
    gazettePeriod,
    status: 'chuyển công bố (hợp lệ)',
    classes: [],
    sourcePlatform: 'ipvietnam',
  }
}
```

### 3. Extraction Patterns
- Table parsing: Tìm các hàng `<tr>` trong bảng, bỏ qua hàng header.
- Các cột: Cột 0 là STT, Cột 1 là Số đơn (`4-2024-xxxxx` hoặc `4-2026-xxxxx`), Cột 2 là Ngày nộp đơn (`DD/MM/YYYY`), Cột 3 là Ngày chuyển công bố (`DD/MM/YYYY`).
- Xử lý các link đính kèm file Excel `.xlsx`: Trích xuất URL tải trực tiếp từ thẻ `<a href="...">` có đuôi `.xlsx` hoặc `.pdf`.

---


### Review Findings (AI - 2026-09-08)
- [x] [Review][Patch] Fix false-positive detail return (returning first table row when application ID is not matched) [src/scrapers/legal/ip-trademark/normalizer.js:254]
- [x] [Review][Patch] Auto-traverse latest weekly gazette article in search_gazette to extract actual application records [src/scrapers/legal/ip-trademark/crawler.js:155]
- [x] [Review][Patch] Tighten gazette article regex to prevent matching administrative department menu items (Khối đơn vị) [src/scrapers/legal/ip-trademark/normalizer.js:52]
- [x] [Review][Patch] Remove non-deterministic Date.now() from gazette article item IDs to ensure store deduplication [src/scrapers/legal/ip-trademark/normalizer.js:200]
- [x] [Review][Patch] Validate calendar day boundaries against leap year and month length in parseVnDate [src/scrapers/legal/ip-trademark/schema.js:40]
- [x] [Review][Patch] Add action aliases mapping support in scrapeIpLegal helper [src/scrapers/legal/ip-trademark/index.js:28]
- [x] [Review][Patch] Include metadata.classes array in PostItem schema as specified in Dev Notes [src/scrapers/legal/ip-trademark/normalizer.js:140]
- [x] [Review][Patch] Support store.savePost fallback in crawler persistence [src/scrapers/legal/ip-trademark/crawler.js:140]
- [x] [Review][Patch] Support year filtering in yearly_summary normalizer [src/scrapers/legal/ip-trademark/normalizer.js:230]
- [x] [Review][Patch] Add real HTML fixtures from ipvietnam.gov.vn in tests/scrapers/legal/ip-trademark/fixtures/ [tests/scrapers/legal/ip-trademark/fixtures/]

## Dev Agent Record

### Implementation Summary
- Added `LEGAL: 'legal'` category to `CATEGORIES` in `src/core/types.js` and updated `prisma/schema.prisma`.
- Implemented `IpLegalClient` extending `AbstractApiClient` with `requiresProxy = false`, `requiresAuth = false`, and `rejectUnauthorized: false` for `ipvietnam.gov.vn`.
- Implemented `IpLegalCrawler` extending `AbstractCrawler` with `init()` / `cleanup()` and registered actions: `search_gazette` (alias `search`), `get_weekly_list`, `yearly_summary`, `detail`.
- Implemented `normalizeIpLegalResults` extracting table rows (STT, Số đơn, Ngày nộp đơn, Ngày chuyển công bố) and yearly documents (`.xlsx`, `.pdf`) into valid `PostItem` instances.
- Implemented `IpLegalPlatformResponseValidator` detecting structural signals, status >= 400 rejection, rate limit and bot challenges.
- Integrated dispatcher in `src/scrapers/index.js` with aliases `ipvietnam`, `ip_legal`, `legal` and exported `IpLegalCrawler`, `IpLegalClient`, `scrapeIpLegal`.
- Authored complete test suite with 45 unit/integration tests and verified live extraction on real `ipvietnam.gov.vn` gazette data.

### File List
- `src/core/types.js` (modified: added `LEGAL: 'legal'`)
- `prisma/schema.prisma` (modified: updated category comment)
- `src/scrapers/legal/ip-trademark/schema.js` (new)
- `src/scrapers/legal/ip-trademark/validator.js` (new)
- `src/scrapers/legal/ip-trademark/client.js` (new)
- `src/scrapers/legal/ip-trademark/normalizer.js` (new)
- `src/scrapers/legal/ip-trademark/crawler.js` (new)
- `src/scrapers/legal/ip-trademark/index.js` (new)
- `src/scrapers/index.js` (modified: added routing & exports)
- `tests/scrapers/legal/ip-trademark/schema.test.js` (new)
- `tests/scrapers/legal/ip-trademark/validator.test.js` (new)
- `tests/scrapers/legal/ip-trademark/client.test.js` (new)
- `tests/scrapers/legal/ip-trademark/normalizer.test.js` (new)
- `tests/scrapers/legal/ip-trademark/crawler.test.js` (new)
- `tests/scrapers/legal/ip-trademark/dispatch.test.js` (new)
- `tests/store/prisma-store.test.js` (modified: updated valid categories assertion)

### Status
done
