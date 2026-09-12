# Epic 26 Context: Legacy Decommission Final

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 26 là bước cuối cùng trong lộ trình chuẩn hóa kiến trúc Universal Scraping Engine (Epics 23–26). Sau khi Epic 25 đã biến `scrape()` thành thin dispatcher duy nhất, di chuyển toàn bộ caller nội bộ sang hybrid surface (`src/scrapers/social/`), và verify các API surface, Epic 26 tiến hành kiểm tra parity lần cuối, tạo git tag an toàn và rollback plan (Story 26.1), sau đó dỡ bỏ vĩnh viễn toàn bộ các module scraper legacy (`src/client/Scraper.js`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/index.js`, `src/scrapers/bluesky/index.js`, `src/scrapers/mastodon/index.js`) để XActions chỉ còn duy nhất một kiến trúc `AbstractCrawler` + `AbstractApiClient` (NFR-18).

## Stories

- Story 26.1: Pre-Decommission Parity & Rollback Preparation
- Story 26.2: Final Legacy Removal

## Requirements & Constraints

- **NFR-18 (Universal Architecture Compliance):** 100% nền tảng và crawler trong XActions kế thừa `AbstractCrawler` và `AbstractApiClient`. Không còn module scraper nào nằm ngoài `src/scrapers/social/<platform>/` hoặc các domain directories chuẩn (`src/scrapers/{ecom,realestate,recruitment,procurement}/`).
- **NFR-16 (Backward Compatibility):** Các lệnh CLI `unfollowx` và MCP tools không bị vỡ giao diện; các tham số cũ được map sang `CrawlerCommand` hoặc trả về error envelope chuẩn (`PlatformError`, `statusCode: 400`, `code: 'XACT_4001'`).
- **Git Tagging:** Tạo git tag `pre-decommission-YYYY-MM-DD` từ `main` trước khi xóa bất kỳ file nào.
- **Rollback SLA:** Rollback window trong 48h; cơ chế rollback là `git revert` commit decommission hoặc restore từ tag backup.
- **Documentation:** `docs/decommission-plan-26.md` và cập nhật `docs/deprecation-plan.md` sang trạng thái `removed`.
- **Quality Gates:** Toàn bộ test suite (`npm test`) và typecheck (`npm run typecheck`) phải pass với 0 errors cả trước và sau khi decommission.

## Technical Decisions

- **Two-Stage Execution:**
  - **Stage 1 (Story 26.1):** Parity Audit & Safety Shield. Tạo git tag dự phòng, lập văn bản kế hoạch decommission và checklist rollback, kiểm tra tính đầy đủ của hybrid surface so với legacy.
  - **Stage 2 (Story 26.2):** Code Decommission. Xóa vật lý các thư mục và file legacy, dọn dẹp các legacy shims và re-exports không còn cần thiết, cập nhật `platforms.js` và `package.json` exports.
- **Target Files for Decommission (Story 26.2):**
  - `src/client/Scraper.js`
  - `src/scrapers/twitter/` (toàn bộ, bao gồm `http/`)
  - `src/scrapers/facebook/` (toàn bộ legacy puppeteer files)
  - `src/scrapers/threads/index.js` (legacy)
  - `src/scrapers/bluesky/index.js` (legacy)
  - `src/scrapers/mastodon/index.js` (legacy)
- **Export Mapping Finalization:** Chuyển các legacy-shim exports trong `package.json` sang redirect hoặc deprecated wrapper chỉ rõ module thay thế.

## Cross-Story Dependencies

- **Story 26.1** là điều kiện tiên quyết bắt buộc cho **Story 26.2**. Không được xóa file ở 26.2 nếu 26.1 chưa tạo git tag và checklist rollback.
- Phụ thuộc ngược: Toàn bộ Phase 4 (Epic 23, 24, 25) phải hoàn tất trước khi kích hoạt Epic 26.
