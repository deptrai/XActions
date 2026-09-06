---
title: 'Story 21.1: MaSoThue Company Registry Crawler'
type: 'feature'
created: '2026-09-05'
updated: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-2026-08-21.md
  - _bmad-output/planning-artifacts/research/domain-vietnam-2026-08-21.md
  - _bmad-output/planning-artifacts/research/technical-cloudflare-vn-b2b-endpoints-2026-09-06/research.md
  - src/scrapers/index.js
  - src/scrapers/ecom/shopee
  - src/scrapers/realestate/chotot
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI Lead Hub cần danh bạ doanh nghiệp mới thành lập tại Việt Nam để phát hiện khách hàng tiềm năng B2B. `masothue.com` là nguồn dữ liệu công khai về mã số thuế và địa chỉ doanh nghiệp chưa được tích hợp vào XActions.

**Approach:**
1. Tạo `MaSoThueCrawler` tại `src/scrapers/procurement/masothue/index.js` kế thừa `AbstractCrawler`.
2. Implement `MaSoThueClient` kế thừa `AbstractApiClient` với `undici`/`got` + browser headers.
3. Sử dụng `ProxyIpPool` theo AD-22 (VN proxy + `vi-VN` locale).
4. Hỗ trợ actions:
   - `search` — tìm theo mã số thuế / tên công ty
   - `search_by_province` — duyệt theo tỉnh/thành phố
   - `detail` — lấy chi tiết từ `/{taxCode}-{slug}`
5. Trích xuất: `taxCode`, `companyName`, `address`, `businessLines`, `detailUrl`.
6. Chuẩn hóa `PostItem` với `platform: 'masothue'`, `category: 'b2b_lead'`.
7. Lưu PostgreSQL qua `PrismaStore` và phát `ThinEvent` qua `RedisStreamPublisher`.
8. Thêm dispatcher alias: `masothue`, `maso_thue`, `mst` → `MaSoThueCrawler`.

## Boundaries & Constraints

**Always:**
- Dùng `AbstractCrawler` + `AbstractApiClient` + `CrawlerCommand`.
- Request qua `ProxyIpPool` với region `VN` (NFR-19).
- Gửi đầy đủ browser headers (`Accept`, `Accept-Language: vi-VN`, `Referer: https://masothue.com/`, `DNT: 1`, `Connection: keep-alive`, `Upgrade-Insecure-Requests: 1`).
- Parse HTML bằng `cheerio` hoặc `jsdom`.
- Publish Thin Event với `platform` và `category` chuẩn.
- Thêm tests tại `tests/scrapers/procurement/masothue/`.

**Ask First:**
- Nếu cần thêm field `phone`, `representativeName`, `establishedDate`, `charterCapital` — không có trên public page.
- Nếu cần lưu raw HTML snapshot quá 30 ngày.

**Never:**
- Không crawl dữ liệu cần đăng nhập.
- Không phá vỡ schema `PostItem` hiện có.

## I/O & Edge-Case Matrix

| Scenario | Input / Invocation | Expected Output | Error Handling |
|----------|--------------------|-----------------|----------------|
| Search by tax code | `scrape('masothue','search',{q:'0013180180'})` | `PostItem[]` with taxCode/companyName/address | Empty result → `[]` with `note` |
| Search by company name | `scrape('masothue','search',{q:'Nguyên Đãi'})` | `PostItem[]` matching results | Empty → `[]` |
| Province list | `scrape('masothue','search_by_province',{province:'binh-duong',page:1})` | `PostItem[]` | Province not found → `XACT_4001` |
| Detail | `scrape('masothue','detail',{taxCode:'0013180180'})` | `ProfileItem`/`PostItem` with businessLines | Not found → `XACT_4001` |
| Missing browser headers | Request without `Referer`/`Accept-Language` | Retry with full headers; if still 403 → `rate_limit` | Rotate proxy, log `bot_challenge` |

</frozen-after-approval>

## Code Map

- `src/scrapers/procurement/masothue/index.js` — `MaSoThueCrawler`
- `src/scrapers/procurement/masothue/client.js` — `MaSoThueClient` extends `AbstractApiClient`
- `src/scrapers/procurement/masothue/schema.js` — metadata schema
- `src/scrapers/procurement/masothue/validator.js` — `MaSoThuePlatformResponseValidator`
- `src/scrapers/index.js` — dispatcher alias `masothue`
- `tests/scrapers/procurement/masothue/crawler.test.js`
- `tests/scrapers/procurement/masothue/client.test.js`
