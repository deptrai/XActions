---
title: 'Story 21.3: HoSoCongTy & MuaSamCong Crawler (Cloudflare/SPA fallback)'
type: 'feature'
created: '2026-09-06'
status: 'backlog'
review_loop_iteration: 1
baseline_commit: '16b03257'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-cloudflare-vn-b2b-endpoints-2026-09-06/research.md
  - src/scrapers/index.js
  - src/core/platform-validator.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 21.1 (MaSoThue) là MVP. Hai nguồn còn lại (`hosocongty.vn`, `muasamcong.mpi.gov.vn`) phức tạp hơn và cần nghiên cứu hoặc anti-detection thêm.

- `hosocongty.vn`: Cloudflare managed challenge block HTTP client.
- `muasamcong.mpi.gov.vn`: Liferay SPA, không có public API rõ ràng.

**Approach:**
1. Tạo `B2BRegistryExtendedCrawler` tại `src/scrapers/procurement/b2b-registry-extended/index.js` kế thừa `AbstractCrawler`.
2. HoSoCongTy: dùng `StealthBrowser` (Puppeteer) để lấy `cf_clearance` cookie + `AbstractApiClient` cho request tiếp theo, HOẶC dùng `got-scraping` TLS/JA4 spoofing nếu Epic 27 hoàn thành.
3. MuaSamCong: parse HTML search results hoặc reverse authenticated Liferay API nếu tìm được.
4. Trích xuất: `taxCode`, `companyName`, `representativeName`, `phone`, `businessLines`, `charterCapital`, `establishedDate` (HSC); `tenderValue`, `tendererName`, `bidderList` (MuaSamCong).
5. Chuẩn hóa `PostItem` với `platform: 'hosocongty' | 'muasamcong'`, `category: 'b2b_lead'`.

## Boundaries & Constraints

**Always:**
- Dùng `AbstractCrawler` + `AbstractApiClient`.
- Request VN platforms qua `ProxyIpPool` với region `VN`.
- Thêm tests tại `tests/scrapers/procurement/b2b-registry-extended/`.

**Ask First:**
- Nếu cần dùng headless browser production.
- Nếu cần lưu `cf_clearance` cookies dài hạn.

**Never:**
- Không login bằng credentials giả mạo.
- Không phá vỡ schema `PostItem` hiện có.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| HSC detail (post-bypass) | `scrape('hosocongty','company',{taxCode:'0123456789'})` | `ProfileItem` with full info | Cloudflare block → `bot_challenge` |
| MuaSamCong search | `scrape('muasamcong','search_tenders',{keyword:'xây dựng'})` | Tender list | SPA render fail → fallback to HTML parse |
| MuaSamCong detail | `scrape('muasamcong','detail',{tenderNo:'...'})` | Tender with value/bidder | Not found → `XACT_4001` |

## Code Map

- `src/scrapers/procurement/b2b-registry-extended/index.js`
- `src/scrapers/procurement/b2b-registry-extended/client.js`
- `src/scrapers/procurement/b2b-registry-extended/schema.js`
- `src/scrapers/procurement/b2b-registry-extended/validator.js`
- `src/scrapers/index.js` — dispatcher alias `hosocongty`, `muasamcong`
- `tests/scrapers/procurement/b2b-registry-extended/`

## Unblocking conditions

- Epic 27.1 (`FingerprintManager` + TLS/JA4 spoofing) done, OR
- Manual browser cookie extraction workflow documented, OR
- MuaSamCong authenticated/private API discovered.
