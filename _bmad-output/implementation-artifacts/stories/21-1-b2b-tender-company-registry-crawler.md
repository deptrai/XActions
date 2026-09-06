---
title: 'Story 21.1: B2B Tender & Company Registry Crawler (MaSoThue, HoSoCongTy, MuaSamCong)'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-2026-08-21.md
  - _bmad-output/planning-artifacts/research/domain-vietnam-2026-08-21.md
  - src/scrapers/index.js
  - src/scrapers/ecom/shopee
  - src/scrapers/realestate/chotot
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI Lead Hub cần danh bạ doanh nghiệp mới thành lập và thông tin đấu thầu tại Việt Nam để phát hiện khách hàng tiềm năng B2B. Các nguồn dữ liệu công khai (`masothue.com`, `hosocongty.vn`, `muasamcong.mpi.gov.vn`) chưa được tích hợp vào XActions.

**Approach:**
1. Tạo `B2BRegistryCrawler` tại `src/scrapers/procurement/b2b-registry/index.js` kế thừa `AbstractCrawler`.
2. Implement `client.js` kế thừa `AbstractApiClient` với TLS spoofing + `ProxyIpPool` theo AD-22 (VN proxy + `vi-VN` locale).
3. Hỗ trợ 3 nguồn: `masothue` (tra cứu MST), `hosocongty` (thông tin DN), `muasamcong` (thông tin đấu thầu).
4. Trích xuất: `taxCode`, `companyName`, `representativeName`, `phone`, `businessLines`, `charterCapital`, `establishedDate`, `tenderValue`, `tendererName`, `bidderList`.
5. Chuẩn hóa `PostItem` với `platform: 'masothue' | 'muasamcong' | 'hosocongty'`, `category: 'b2b_lead'`.
6. Lưu PostgreSQL qua `PrismaStore` và phát `ThinEvent` qua `RedisStreamPublisher`.
7. Thêm dispatcher alias: `b2b_registry`, `masothue`, `hosocongty`, `muasamcong` → `B2BRegistryCrawler`.

## Boundaries & Constraints

**Always:**
- Dùng `AbstractCrawler` + `AbstractApiClient` + `CrawlerCommand`.
- Request VN platforms qua `ProxyIpPool` với region `VN` (NFR-19).
- Extract SĐT theo regex VN, lọc bỏ mask `***`.
- Publish Thin Event với `platform` và `category` chuẩn.
- Thêm tests tại `tests/scrapers/procurement/b2b-registry/`.

**Ask First:**
- Nếu cần headless browser cho JavaScript-rendered pages.
- Nếu cần lưu raw HTML snapshot quá 30 ngày.

**Never:**
- Không crawl dữ liệu cần đăng nhập cá nhân (backdoor).
- Không phá vỡ schema `PostItem` hiện có.

## I/O & Edge-Case Matrix

| Scenario | Input / Invocation | Expected Output | Error Handling |
|----------|--------------------|-----------------|----------------|
| Search companies by city | `scrape('masothue','search_companies',{city:'Hà Nội',industry:'phần mềm'})` | `PostItem[]` with taxCode/companyName/phone | Empty result → `[]` with `note` |
| Tender search by keyword | `scrape('muasamcong','search_tenders',{keyword:'xây dựng trường học'})` | Tender list with value/tenderer/bidderList | 403 → rotate VN proxy |
| HSC extract company | `scrape('hosocongty','company',{taxCode:'0123456789'})` | `ProfileItem` with full company info | Not found → `XACT_4001` |
| Phone mask detected | Raw `***` in phone field | Extract raw digits via alt source or mark masked | Return with `note: 'phone_masked'` |

</frozen-after-approval>

## Code Map

- `src/scrapers/procurement/b2b-registry/index.js` — `B2BRegistryCrawler`
- `src/scrapers/procurement/b2b-registry/client.js` — HTTP client
- `src/scrapers/procurement/b2b-registry/schema.js` — VN company/tender metadata schema
- `src/scrapers/index.js` — dispatcher alias registration
- `tests/scrapers/procurement/b2b-registry/crawler.test.js`
- `tests/scrapers/procurement/b2b-registry/client.test.js`
