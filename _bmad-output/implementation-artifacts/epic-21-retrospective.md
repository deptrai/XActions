# Epic 21 Retrospective: B2B Procurement, Corporate & Automotive Intelligence Engine

Status: done  
Date: 2026-09-08

## Summary

Epic 21 mở rộng XActions sang **B2B data collection** cho thị trường Việt Nam: danh bạ doanh nghiệp mới thành lập (MaSoThue), hồ sơ công ty chi tiết (HoSoCongTy), thông tin đấu thầu công (MuaSamCong), và thị trường xe (Oto.com.vn, BonBanh, Chợ Tốt Xe). Epic này là phần của **Vietnam market pivot** (FR-94, FR-95, NFR-19).

Epic complete across four stories:

| Story | Status | Outcome |
|---|---|---|
| 21.1 MaSoThue Company Registry Crawler | done | `MaSoThueCrawler` + `MaSoThueClient`, HTTP-only extraction, `masothue`/`maso_thue`/`mst` aliases |
| 21.2 Automotive & Vehicles Market Crawler | done | `AutomotiveCrawler` + `AutomotiveClient`, 3 platforms (`oto_vn`, `bonbanh`, `chotot_xe`), vehicle schema |
| 21.3 HoSoCongTy & MuaSamCong Crawler | done | `B2BRegistryExtendedCrawler` + `B2BRegistryExtendedClient`, Cloudflare/SPA fallback, `hosocongty`/`muasamcong` aliases |
| 21.4 HoSoCongTy & MuaSamCong Live-Fix | done | Route/selector drift fixes, live REST endpoint integration, real fixture tests |

Final verification: **59/59 tests pass** (8 test files) — 18 source files + 8 test files + 6 live fixtures.

**~9090 lines added across 17 commits** (`86e853bb..3a10e81d`), covering 3 new crawler modules, 1 extended B2B crawler, and dispatcher integration.

## What Went Well

1. **Research-first approach tránh lãng phí**
   - `technical-cloudflare-vn-b2b-endpoints-2026-09-06` research xác định rõ: MaSoThue feasible HTTP-only, HoSoCongTy cần Cloudflare bypass, MuaSamCong cần reverse Liferay API.
   - Story 21.1 được split thành MaSoThue-only MVP → tránh block bởi Cloudflare.
   - **Lesson:** Không nên gộp nhiều platform với complexity khác nhau vào 1 story.

2. **Cloudflare bypass strategy đa tầng hiệu quả**
   - `got-scraping` TLS/JA4 fingerprinting + VN proxy là tier 1.
   - `StealthBrowser` (Puppeteer) warmup → `cf_clearance` cookie → `AbstractApiClient` là tier 2.
   - `B2BRegistryExtendedClient` tự động escalate khi detect `isBotChallenge`.
   - **Lesson:** Pattern này có thể reuse cho các site VN khác bị Cloudflare.

3. **Live-fix workflow (21.4) giải quyết selector drift nhanh**
   - Browser-pilot verification phát hiện 6 vấn đề cụ thể (route 404, selector mismatch, nested tags, SPA rendering).
   - Story 21.4 được tạo ngay sau 21.3 review, không để lẫn vào epic khác.
   - Live fixture tests (`hosocongty-search.html`, `muasamcong-search.json`) guard regression.

4. **Thin wrapper + adapter pattern nhất quán**
   - `AutomotiveCrawler` reuse `ChototClient` cho `chotot_xe` — không duplicate.
   - `B2BRegistryExtendedCrawler` dispatch `search` → `search_tenders` cho MuaSamCong.
   - `src/scrapers/index.js` dispatcher thêm 6 aliases mới: `masothue`, `maso_thue`, `mst`, `oto_vn`, `bonbanh`, `chotot_xe`, `hosocongty`, `muasamcong`.

5. **Vehicle schema chuẩn hóa tốt**
   - `brand`, `model`, `year`, `mileage`, `transmission`, `fuel`, `price`, `sellerType` (`chinh-chu` | `salon`), `phone`.
   - Masked phone `***` tự động gắn `phone_masked` note.
   - `PostItem` normalization giữ nguyên contract chung.

## What Was Difficult

1. **Cloudflare/SPA blocking phức tạp hơn dự kiến**
   - `hosocongty.vn` trả 403 với `undici`/`got` thuần — cần `got-scraping` hoặc browser warmup.
   - `muasamcong.mpi.gov.vn` là Liferay SPA — search không render server-side.
   - **Solution:** 2-tier fallback + reverse engineering Liferay smart search REST endpoint (`/o/...` hoặc `p_p_resource_id`).

2. **Selector drift trên live site (21.4)**
   - HoSoCongTy đổi route `/tim-kiem?q=` → `/search?key=` và markup `<ul class="hsdn">`.
   - Detail labels đổi: `Tên công ty` → `Tên viết tắt`, `Địa chỉ` → `Địa chỉ thuế`, `Người đại diện` → `Đại diện pháp luật`.
   - `extractByLabel` regex `[^<\n]+` break khi value nằm trong nested `<a>` hoặc `<i>`.
   - **Lesson:** Cần live integration tests với real fixtures ngay từ đầu, không chỉ unit tests với mock HTML.

3. **Sprint-status naming inconsistency**
   - Story file `21-1-b2b-tender-company-registry-crawler.md` giữ nguyên sau split, nhưng sprint-status rename thành `21-1-masothue-company-registry-crawler`.
   - File `21-1-b2b-tender-company-registry-crawler-orig.md` được tạo để preserve history nhưng gây confuse.
   - **Lesson:** Khi split story, nên rename file luôn hoặc tạo file mới với suffix mới.

4. **MuaSamCong detail resolution phức tạp**
   - Tender detail cần `notifyNo` (không phải `id`) — phải resolve từ search results trước.
   - `getTenderDetailMuasamcong` fallback sang `/tra-cuu/` route khi không có slug.
   - **Lesson:** VN government sites thường không có REST API chuẩn — cần reverse engineering từ frontend JS.

5. **Type annotations và field declarations**
   - `eb449618` fix JSDoc `@type` cho `B2BRegistryExtendedClient` fields.
   - `3a10e81d` fix `client` field declaration trong crawler.
   - **Lesson:** Khi kế thừa `AbstractCrawler`/`AbstractApiClient`, phải khai báo rõ field types để TypeScript strict mode pass.

## Key Decisions

1. **Split Story 21.1 thành 2 story**
   - `39d91996`: 21.1 chỉ cover MaSoThue (feasible), defer HSC+MuaSamCong sang 21.3.
   - Tránh block epic bởi Cloudflare research.

2. **2-tier Cloudflare fallback**
   - Tier 1: `got-scraping` với TLS/JA4 + VN proxy.
   - Tier 2: `StealthBrowser` warmup → `cf_clearance` → inject vào `AbstractApiClient`.
   - Auto-escalate khi `isBotChallenge` detect "Just a moment...".

3. **MuaSamCong dùng smart search REST endpoint**
   - Reverse từ Liferay frontend: `/o/...` hoặc `p_p_resource_id=...` endpoint.
   - Không dùng `/web/guest/bc/-/search` (404) hay `/web/guest/notification-system` (SPA-only).

4. **Automotive reuse Chotot normalizer**
   - `chotot_xe` delegate sang `src/scrapers/realestate/chotot` — không duplicate logic.
   - `oto_vn` và `bonbanh` có normalizer riêng vì schema khác.

5. **Live-fix story riêng (21.4)**
   - Tạo story riêng cho selector drift thay vì patch lén vào 21.3.
   - Giữ history rõ ràng, dễ trace.

## Follow-up Recommendations

1. **MuaSamCong SPA endpoint cần monitor**
   - Liferay endpoint có thể đổi bất cứ lúc nào.
   - Cần thêm alert khi `search_tenders` trả empty hoặc 404.

2. **HoSoCongTy `cf_clearance` cookie TTL**
   - Cookie chỉ valid ~30 phút — cần refresh strategy nếu scrape dài.
   - Cân nhắc persistent browser session cho high-volume jobs.

3. **Thêm nền tảng B2B VN khác**
   - `trangvangvietnam.com`, `yellowpages.com.vn`, `vatgia.com` — cùng pattern.
   - Cần research feasibility trước khi estimate.

4. **Vehicle price trend analysis**
   - Story 21.2 chỉ extract listing data — chưa có `get_price_trend` action.
   - Cần historical data storage + aggregation.

5. **Phone unmasking cho Chotot Xe**
   - `phone_masked` flag đã có nhưng chưa có unmask flow (cần click "Hiện số" → browser automation).
   - **Ask First:** nếu cần unmask, cần thêm browser automation step.

6. **Epic 22 (F&B + Healthcare + Legal IP)**
   - `PasGo`, `Foody`, `Riviu`, `Medpro`, `YouMed`, `Thuocsi`, `ipvietnam.gov.vn` — tương tự complexity.
   - Cần research Cloudflare/SPA status trước khi estimate.

## Final State

- Epic 21 status: **done**
- All four stories: **done**
- Retrospective: **done**
- Tests: **59/59 pass** (8 test files)
- Working tree: clean (committed at `3a10e81d` + docs)
