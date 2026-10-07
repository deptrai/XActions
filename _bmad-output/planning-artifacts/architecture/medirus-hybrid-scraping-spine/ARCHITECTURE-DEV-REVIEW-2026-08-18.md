# Dev Review — XActions Universal Hybrid Scraping Architecture (r3)

**Persona:** Amelia / Senior Software Engineer  
**Target:** `ARCHITECTURE-SPINE.md` (r3), `epics.md`, `package.json`, `src/scrapers/**`, `src/mcp/server.js`  
**Date:** 2026-08-18  
**Method:** Implementation lens — dependency, testability, code conflict, existing architecture reuse.

---

## Verdict

🟡 **Kiến trúc implementable, nhưng có 7 blocker cần giải quyết trước Story 10.1.** Các blocker tập trung ở: thiếu dependency trong `package.json`, mâu thuẫn với adapter system hiện tại, thiếu `src/core/` và `src/proxy/` modules, và chiến lược test cho code cần browser/proxy.

---

## Blockers (P0)

### B1 — Dependencies chưa có trong `package.json`
* **AD liên quan:** AD-1, AD-3, AD-5, AD-13
* **Vấn đề:** Spine yêu cầu `got-scraping` (AD-1), `qrcode-terminal` (AD-5), `socks-proxy-agent` (AD-3), có thể cả `undici` proxy agent. Kiểm tra `package.json` hiện tại không có các package này.
* **Hệ quả:** Story 10.1 và 11.1 sẽ fail ngay lập tức khi import.
* **Đề xuất:** Thêm `got-scraping ^3`, `qrcode-terminal ^0.12`, `socks-proxy-agent ^8` vào `dependencies`. Đồng thời audit và quyết định HTTP client duy nhất: nếu dùng `got-scraping` thì phải refactor `axios` trong 51 file (trừ `xspace-agents` và `docs` là out-of-scope).

### B2 — Mâu thuẫn giữa `src/core/AbstractCrawler` và `src/scrapers/adapters/BaseAdapter` hiện có
* **AD liên quan:** AD-2
* **Vấn đề:** Code hiện tại đã có `src/scrapers/adapters/base.js` (`BaseAdapter` với `launch`, `newPage`, `goto`, `evaluate`) và `src/scrapers/index.js` (unified `scrape(platform, task, args)`). Spine bắt đầu lại từ `src/core/base-crawler.js`, `base-client.js`, v.v. Không rõ mối quan hệ giữa hai hệ thống.
* **Hệ quả:** Team có thể viết lại `BaseAdapter` ở `src/core` trong khi `src/scrapers/adapters/` vẫn tồn tại, gây duplicate và confusion.
* **Đề xuất:** Làm rõ trong AD-2: `src/core/base-crawler.js` là **platform-agnostic contract**, `src/scrapers/adapters/base.js` là **browser framework adapter**. `AbstractCrawler` sử dụng `AdapterPage` từ `BaseAdapter` để ký động. Hoặc rename `src/scrapers/adapters` → `src/core/adapters` và kế thừa `BaseAdapter`.

### B3 — `src/core/`, `src/proxy/`, `src/store/` chưa tồn tại
* **AD liên quan:** AD-1, AD-2, AD-3, AD-4
* **Vấn đề:** `find_file_by_name` trả về 0 file trong các thư mục này. Code hiện tại có `src/scrapers/` (Twitter, Facebook, Threads), `api/` (Express), `src/cli/`, `src/mcp/`, `src/client/`, nhưng không có `src/core/`, `src/proxy/`, `src/store/`.
* **Hệ quả:** Story 10.1 phải scaffold toàn bộ core từ đầu, trong khi có thể reuse `src/scrapers/adapters/`, `src/scraping/stealthBrowser.js`, `src/streaming/browserPool.js`.
* **Đề xuất:** Trước khi viết mới, audit các file `src/scraping/stealthBrowser.js`, `src/streaming/browserPool.js`, `src/scrapers/adapters/**` để extract reusable parts vào `src/core/`.

### B4 — `prisma/schema.prisma` chưa có model `Post`, `Comment`, `CrawlCheckpoint`
* **AD liên quan:** AD-4, AD-10, AD-12
* **Vấn đề:** Spine định nghĩa schema mới, nhưng repo hiện tại có schema cũ (`User`, `Operation`, `TweetSnapshot`, `EngagementDaily`, v.v.). Nếu xóa/replace đột ngột, các story khác và legacy API sẽ vỡ.
* **Hệ quả:** Không thể `npx prisma migrate dev` cho đến khi quyết định cách migrate từ schema cũ.
* **Đề xuất:** Story 10.2 cần sub-task: (1) audit schema cũ, (2) đánh dấu legacy models `@deprecated`, (3) thêm `Post`/`Comment`/`CrawlCheckpoint` song song, (4) viết raw migration SQL cho GIN index, (5) test migration trên staging DB.

### B5 — Prisma GIN Index không thể khai báo natively
* **AD liên quan:** AD-4
* **Vấn đề:** Prisma 5.7.1 không hỗ trợ `USING gin` trong `@@index`. Raw migration SQL là cần thiết.
* **Hệ quả:** `prisma db push` hoặc `prisma migrate dev` có thể xóa/bỏ qua GIN index. `prisma db pull` sẽ không reflect index.
* **Đề xuất:** Thêm AD-4 Rule 3.1: raw migration file phải được đặt trong `prisma/migrations/` và không dùng `prisma db pull` sau khi apply raw index. Dùng `prisma migrate deploy` trong production.

### B6 — `package.json` chứa cả `puppeteer` và `playwright`
* **AD liên quan:** AD-1, AD-13
* **Vấn đề:** Spine đề cập `Signer Worker Page Pool` 4–8 tabs nhưng không chọn engine. Repo có sẵn `puppeteer-extra` adapter và `playwright` dependency. Browser binary của cả hai sẽ làm Docker image lớn.
* **Hệ quả:** Container size và CI install time tăng; team có thể mix `page.evaluate()` từ hai engine.
* **Đề xuất:** AD-1 thêm `Rule 5: Browser Engine Selection` — chọn **một engine chính** (đề xuất `puppeteer-extra` vì code hiện tại dùng nó) và dùng `BaseAdapter` để abstract. `playwright` giữ lại như optional adapter cho CDP attach (LinkedIn) nếu cần.

### B7 — MCP server default vẫn là stdio
* **AD liên quan:** AD-7, AD-14
* **Vấn đề:** `src/mcp/server.js` đã có `startHttpTransport()` nhưng `main()` mặc định gọi stdio trừ khi `MCP_TRANSPORT=http`. `npm run mcp` chạy `node src/mcp/server.js` → stdio.
* **Hệ quả:** Nowing phải set env thủ công, không phải daemon mặc định.
* **Đề xuất:** Sửa `package.json` script `mcp` thành `MCP_TRANSPORT=http PORT=3001 node src/mcp/server.js` hoặc thêm script `mcp:daemon`. Đảm bảo `GET /health` tồn tại trước khi Story 14.2 bắt đầu.

---

## High Findings (P1)

### H1 — `axios` được dùng rộng rãi, conflict với `got-scraping`/`undici`
* **AD liên quan:** AD-1
* **Vấn đề:** 51 file có `axios` (mặc dù phần lớn thuộc `xspace-agents` và docs), nhưng `src/scrapers/facebook/graphql.js`, `api/routes/twitter.js` dùng `axios`. Nếu chuyển sang `got-scraping` phải refactor từng file.
* **Đề xuất:** Không cần đổi tất cả trong Epic 10. AD-1 nên cho phép `axios` là legacy HTTP client cho đến khi refactor; `src/core/base-client.js` mới phải dùng `got-scraping`/`undici`, còn `src/client/` và `api/` giữ `axios` tạm thời.

### H2 — `Comment.id` format rườm rà
* **AD liên quan:** AD-4
* **Vấn đề:** `${platform}:${postExternalId}:${commentExternalId}` khiến `Comment.postId` (là `Post.id` = `${platform}:${externalId}`) bị lặp prefix. Ví dụ: `postId = "facebook:123"`, `id = "facebook:facebook:123:456"`.
* **Đề xuất:** Đơn giản hóa: `Comment.id = "${platform}:${externalId}"` và dùng `@@unique([platform, externalId, postId])` như Prisma schema đã có. `externalId` là ID gốc của comment, không cần nhúng `postExternalId` vào primary key.

### H3 — Testing "no mocks" là rào cản cho `SignerPagePool` và `ProxyIpPool`
* **AD liên quan:** AD-1, AD-3, AD-11
* **Vấn đề:** Project dùng Vitest với rule *No mocks, stubs, or fakes*. Unit test `PreSignedTokenRing`, `SignerPagePool`, `ProxyIpPool` không thể chạy mà không có real browser/proxy.
* **Đề xuất:** Bổ sung `dry-run` / `fake-adapter` mode được phép trong test. Ví dụ `SignerPagePool` test với fake `page.evaluate()` returning a fixed signature; `ProxyIpPool` test với local mock proxy server. Hoặc chuyển các test này thành integration test với `@vitest/node` và môi trường thật, gán tag `slow`.

### H4 — Redis consumer group `nowing_nlp_workers` chưa được tạo
* **AD liên quan:** AD-7
* **Vấn đề:** `XREADGROUP` yêu cầu group đã tồn tại. Nếu `XADD` xảy ra trước khi Nowing tạo group, consumer không đọc được messages cũ.
* **Đề xuất:** XActions khởi động phải tự tạo consumer group nếu chưa có (`XGROUP CREATE stream:social:raw_posts nowing_nlp_workers $ MKSTREAM`). Ghi rõ trong AD-7.

### H5 — `xspace-agents` và `python/` nằm trong cùng repo, gây noise
* **AD liên quan:** —
* **Vấn đề:** `grep` tìm `axios` trả về hầu hết từ `xspace-agents/` và `python/`. Các module này không liên quan đến Epics 10–19 nhưng làm khó audit.
* **Đề xuất:** Trong dev review/khi làm việc, giới hạn `grep`/`find` trong `src/`, `api/`, `prisma/`, `tests/`. Cân nhắc move `xspace-agents` và `python/` ra monorepo riêng trong tương lai.

### H6 — `Post.category` là `String`, không có enum/check constraint
* **AD liên quan:** AD-4
* **Vấn đề:** `category` nhận giá trị `'social' | 'ecom' | 'realestate' | 'recruitment' | 'b2b'`. Dùng `String` mở rộng dễ gây typo.
* **Đề xuất:** Dùng Prisma `enum Category { social ecom realestate recruitment b2b }` hoặc thêm validation ở `AbstractCrawler`.

### H7 — Dashboard realtime 5s có thể gây overload
* **AD liên quan:** AD-19
* **Vấn đề:** Polling mỗi 5s trên nhiều client sẽ đánh vào PostgreSQL/Redis liên tục.
* **Đề xuất:** Dùng SSE từ `metrics/stream` và `governor/status`, cache 1s server-side, client subscribe thay vì poll.

---

## Recommendations

1. **Trước Story 10.1:** Giải quyết B1–B7 bằng cách thêm dependency, quyết định engine/HTTP client, audit schema, sửa MCP default script.
2. **Story 10.1 refactor:** Không viết lại từ đầu; refactor `src/scrapers/adapters/base.js` → `src/core/adapters/base.js` và tạo `AbstractCrawler` wrapper trên `scrape()` hiện có.
3. **Test strategy:** Cho phép fake adapter trong unit test; integration test chạy với real browser/proxy được gán tag `slow`.
4. **Migration:** Tạo `prisma/migrations/YYYYMMDDHHMMSS_universal_schema/` với `migration.sql` raw GIN index; không dùng `prisma db pull`.
5. **Commit/push blocker fixes trước khi dev bắt đầu.**

---

*Review by Amelia — focused on what will break, what is missing, and what can be reused from existing code.*
