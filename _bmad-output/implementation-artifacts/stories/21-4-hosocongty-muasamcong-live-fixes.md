---
title: 'Story 21.4: HoSoCongTy & MuaSamCong Live-Fix (Route & Selector Drift)'
type: 'bug'
created: '2026-09-07'
status: 'done'
review_loop_iteration: 0
baseline_commit: '818d14d1'
context:
  - _bmad-output/implementation-artifacts/stories/21-3-hosocongty-muasamcong-crawler.md
  - src/scrapers/procurement/b2b-registry-extended/
  - src/scrapers/index.js
  - tests/scrapers/procurement/b2b-registry-extended/
---

## Intent

**Problem:** Story 21.3 pass unit tests nhưng browser-pilot verification cho thấy crawler **fail on live sites** vì route và selector drift:

1. **HoSoCongTy search URL sai** — `client.js` dùng `/tim-kiem?q=` trả 404; live route là `/search?key=...&opt=0&p=0&d=0`.
2. **HoSoCongTy search markup không khớp** — `normalizeHosocongty` regex `class="[^"]*company[^"]*"` không match `<ul class="hsdn">`.
3. **HoSoCongTy detail labels sai** — live site dùng `Tên viết tắt`, `Địa chỉ thuế`, `Đại diện pháp luật`, `Ngày cấp`, `Trạng thái`; `extractByLabel` đang tìm `Tên công ty`, `Địa chỉ`, `Người đại diện`, `Ngày thành lập`, `Tình trạng`.
4. **`extractByLabel` regex break trên nested tags** — pattern `[^<\n]+` dừng ngay khi value nằm sau `<i>` hoặc `<a>` (ví dụ `<li><i class="fa ..."></i> Mã số thuế: <a>CODE</a></li>`).
5. **MuaSamCong route lỗi thời** — `/web/guest/bc/-/search` trả 404; trang `/web/guest/notification-system` tồn tại nhưng search là client-rendered SPA, không có server-side HTML với `content__body__left__item`.
6. **MuaSamCong cần API/Liferay endpoint khác** — search thực tế là form modal phụ thuộc `data-hero-search-body`; cần reverse endpoint AJAX hoặc dùng `notification-system` search.

**Goal:** Cập nhật `B2BRegistryExtendedClient` + `normalizeB2BRegistryResults` để khớp **live HTML** của cả hai trang, hoặc bổ sung fallback/API path mới khi HTML không còn đủ.

## Acceptance Criteria

- [x] `scrape('hosocongty','search',{q:'...'})` gọi `https://hosocongty.vn/search?key=...` và trả về `PostItem[]` đúng.
- [x] `scrape('hosocongty','detail',{id:'...'})` hoặc `companyDetailHosocongty` normalize đầy đủ fields từ live `<ul class="hsct">` markup.
- [x] `scrape('muasamcong','search_tenders',{keyword:'...'})` tìm được endpoint thực tế (SPA API hoặc alternative page) và trả `PostItem[]`.
- [x] `extractByLabel` xử lý value chứa nested tags (`<a>`, `<i>`, `<span>`) bằng regex hoặc DOM parser.
- [x] Thêm integration test (real `node:http` server) với fixture HTML lấy từ live site để guard selector drift.
- [x] Không phá vỡ contract `PostItem`, `XACT_4001`/`XACT_4040`, `PlatformError`/`BotChallengeError` đã thiết lập trong 21.3.

## Tasks

### Task 1: Fix HoSoCongTy search route & normalizer
- [x] Đổi `searchHosocongty` URL từ `/tim-kiem?q=` → `/search?key=` (kèm `opt`, `p`, `d` defaults).
- [x] Viết `normalizeHosocongtySearch` mới dùng `<ul class="hsdn">` > `<li>` structure.
- [x] Bóc `taxCode` từ `<a>` text hoặc `title="TAXCODE - NAME"` attribute.
- [x] Bóc `address` từ `<div><em>Địa chỉ:</em> ...` block.
- [x] Update `search` action descriptor: `optionalArgs` thêm `opt`, `p`, `d` cho HoSoCongTy.

### Task 2: Fix HoSoCongTy detail normalizer
- [x] Đổi labels trong `extractByLabel`: `Tên viết tắt`/`Tên công ty`, `Địa chỉ thuế`, `Đại diện pháp luật`, `Điện thoại`, `Ngày cấp`, `Trạng thái`.
- [x] Sửa `extractByLabel` để capture value bên trong nested tags: pattern `label[^:]*:[\s\S]*?<\/i>?\s*([^<]+)` hoặc dùng `cheerio`/`jsdom` nếu cho phép.
- [x] Fallback `authorId` stable: `hosocongty:${taxCode}` hoặc `hosocongty:${companyName}`.
- [x] `publishedAt` parse `Ngày cấp` (DD/MM/YYYY).

### Task 3: Fix MuaSamCong search path
- [x] Research live MuaSamCong search flow: load `https://muasamcong.mpi.gov.vn/web/guest/notification-system` hoặc hero search trên homepage.
- [x] Nếu có server-rendered search page khác → cập nhật `searchTendersMuasamcong` URL.
- [x] Nếu không có → chuyển sang XHR/API call (Liferay `p_p_id=...` hoặc `/o/egp-portal-theme/...` endpoint).
- [x] Nếu phải dùng browser render → sử dụng `StealthBrowser` + `page.content()` để lấy HTML rồi normalize.
- [x] Cập nhật `normalizeMuasamcongSearch` để khớp markup thực tế (hiện không còn `content__body__left__item`).

### Task 4: Fix MuaSamCong detail path
- [x] Xác định route detail thực tế (có thể `contractor-selection` đã đổi hoặc yêu cầu JS render).
- [x] Nếu API → đổi client sang `application/json` và parse JSON response.
- [x] Nếu HTML → cập nhật selector cho `Mã TBMT`, `Tên gói thầu`, `Chủ đầu tư`, `Thời điểm đóng thầu`, v.v.

### Task 5: Add live-HTML integration fixtures
- [x] Save real captured HTML (sanitized) vào `tests/fixtures/b2b-registry-extended/hosocongty-search.html`, `hosocongty-detail.html`, `muasamcong-search.html`, `muasamcong-detail.html`.
- [x] Viết test `normalizer.live.test.js` assert normalize output khớp fixture.
- [x] Viết test `client.live.test.js` với `node:http` mock server serve fixture HTML (no mocks/stubs — real HTTP response).

### Task 6: Update docs & status
- [x] Cập nhật `src/scrapers/procurement/b2b-registry-extended/README.md` (nếu có) hoặc `docs/` với route mới.
- [x] Update `types/index.d.ts` nếu signature method đổi.
- [x] Run `npx vitest run tests/scrapers/procurement/b2b-registry-extended` và regression suite.
- [ ] Commit + push `develop`.

## Dev Notes

- Story 21.3 commit: `818d14d1` (baseline).
- Live HTML captured (browser pilot 2026-09-07):
  - `hosocongty.vn/` search form: `action="search"`, `input name="key"`, `select name="opt"`, `select name="p"`, `select name="d"`.
  - `hosocongty.vn` search results: `<ul class="hsdn">` > `<li>` > `<h3><a title="TAXCODE - NAME">NAME</a></h3><div><em>Địa chỉ:</em> ADDR<br/>Mã số thuế: <a>CODE</a></div>`.
  - `hosocongty.vn` detail: `<div class="module_data detail"><ul class="hsct">` — labels: `Tên viết tắt`, `Mã số thuế`, `Địa chỉ thuế`, `Đại diện pháp luật`, `Điện thoại`, `Ngày cấp`, `Trạng thái`.
  - `muasamcong.mpi.gov.vn/web/guest/bc/-/search` returns 404.
  - `muasamcong.mpi.gov.vn/web/guest/notification-system` loads title "Thông báo của Bộ" but content region empty (SPA hydrate).
  - MuaSamCong homepage has hero search template `data-hero-search-body` — likely POST/GET to an AJAX endpoint.
- Constraint: **no mocks/stubs/fakes**; use real `node:http` server + real captured HTML fixtures.
- Constraint: `cheerio`/`jsdom` may not be installed; prefer regex fix or add dependency only if allowed by project conventions.
- `extractByLabel` regex `[^<\n]+` fails when value is inside nested tags — must handle `<li><i ...></i> Label: <a>Value</a></li>` pattern.
- `authorId` should be stable: `hosocongty:${taxCode}` or `hosocongty:${companyName}`.
- `publishedAt` parse `Ngày cấp` (DD/MM/YYYY) via `parseVietnameseDate`.
- For MuaSamCong: no server-rendered search page exists. `notification-system` is a client-rendered SPA portlet (`egpportalnotificationsystem_WAR_egpportalnotificationsystem`). Use `StealthBrowser` + `page.content()` after hydration, or reverse the Liferay AJAX endpoint behind the portlet. Fallback: `winning-bid-data` page may have server-rendered tables.
- Tests must verify: correct URL built, correct `PostItem` fields, `publishedAt` is valid Date, `bidStatus` text (not CSS class), `authorId` stable, `XACT_4001`/`XACT_4040` thrown on invalid/not-found.

## File List

- `src/scrapers/procurement/b2b-registry-extended/client.js`
- `src/scrapers/procurement/b2b-registry-extended/normalizer.js`
- `src/scrapers/procurement/b2b-registry-extended/index.js`
- `src/scrapers/procurement/b2b-registry-extended/browser.js` (if SPA render needed)
- `src/scrapers/index.js` (if dispatcher args change)
- `tests/scrapers/procurement/b2b-registry-extended/`
- `tests/fixtures/b2b-registry-extended/`
- `types/index.d.ts`

## Change Log

- 2026-09-07: Created from browser-pilot live verification of Story 21.3.
- 2026-09-07: Implemented live fixes for HoSoCongTy route & markup, MuaSamCong Liferay REST APIs & fallbacks, resilient extractByLabel, live fixtures, and integration tests.

## Status

done
