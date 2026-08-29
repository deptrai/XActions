---
story_id: "15.1.4"
epic: 15
story_key: "15-1-4-threads-hybrid-integration-package-exports"
status: "ready-for-dev"
phase: "Phase 4"
created: 2026-08-29
updated: 2026-08-29
last_updated: 2026-08-29T06:00:00Z
owner: "DEV"
reviewed: "Pending"
baseline_commit: "51f006bd"
---

# Story 15.1.4: Threads Hybrid Integration & Package Exports

Status: ready-for-dev

## Story

As a **XActions Platform Engineer**,  
I want **`scrape('threads', ...)`, MCP/CLI tools, and public package exports to switch to the new `ThreadsCrawler` / `ThreadsClient` hybrid architecture**,  
So that **end users and internal callers no longer depend on the legacy `src/scrapers/threads/` Puppeteer-only code path, and all Threads operations benefit from the hybrid engine (Meta GraphQL-first, SSR fallback, sticky residential proxy, error envelopes, and action-level auth)**.

Như một **Kỹ sư Nền tảng XActions**,  
Tôi muốn **`scrape('threads', ...)`, công cụ MCP/CLI và public package exports chuyển sang kiến trúc hybrid `ThreadsCrawler` / `ThreadsClient` mới**,  
Để **người dùng cuối và các caller không còn phụ thuộc vào code path Puppeteer-only legacy `src/scrapers/threads/`, đồng thời mọi thao tác Threads tận dụng được hybrid engine (ưu tiên Meta GraphQL, fallback SSR, proxy residential cố định, error envelope chuẩn và xác thực cấp action).**

## Scope Note

Story 15.1.4 is the **cutover / integration story** for the Threads hybrid thread (Epic 15, Stories 15.1, 15.1.1, 15.1.2, 15.1.3). It does **not** introduce new Threads crawler actions; it migrates the existing public callers and package exports so they dispatch directly into the `ThreadsCrawler` action registry (`src/scrapers/social/threads/`).

- **Trong phạm vi 15.1.4:**
  - Cập nhật `src/scrapers/index.js` unified `scrape()` để khi `platform === 'threads'` thì chuyển sang `ThreadsCrawler.start()` (tương tự như `facebook` trong Story 13.10) thay vì gọi legacy Puppeteer `scrapeProfile` / `scrapeTweets` / `scrapeFollowers` / `scrapeFollowing` / `scrapeSearch` / `scrapePost`.
  - Cập nhật `package.json` `exports` để expose `./scrapers/social/threads` (hoặc đảm bảo `./scrapers/threads` và `./scrapers/social` trỏ đúng vào hybrid barrel).
  - Cập nhật `src/mcp/server.js` cho tất cả các tools (`x_crawl_post`, `x_crawl_user_timeline`, `x_crawl_comments`, `x_crawl_profile`, `x_crawl_search`, `x_actions_list`) để khi `platform === 'threads'` thì dispatch thẳng vào `ThreadsCrawler`.
  - Cập nhật `docs/deprecation-plan.md` status tracker sang `deprecated-planned` cho toàn bộ Threads legacy `src/scrapers/threads/` và ghi rõ dependency vào Story 15.1.4.
  - Thêm test suite integration `tests/scrapers/social/threads/caller-migration.test.js` để xác thực `scrape('threads', ...)` và package exports dispatch đúng sang hybrid `ThreadsCrawler` mà không khởi chạy Puppeteer.

- **Không trong phạm vi 15.1.4:**
  - Xóa vật lý thư mục `src/scrapers/threads/` (thuộc Epic 20.2 Legacy Scraper Code Decommissioning).
  - Thay đổi schema Prisma hay Redis Stream protocols.

## Acceptance Criteria

### AC-1: Unified `scrape("threads", action, options)` Dispatches to `ThreadsCrawler`
- **Given** `scrape(platform, action, options)` trong `src/scrapers/index.js`
- **When** `platform === 'threads'`
- **Then** `scrape()` chuyển hướng trực tiếp sang `ThreadsCrawler.start({ action, args, session })` mà không khởi chạy Puppeteer browser
- **And** các action mapping được hỗ trợ:
  - `profile` ➔ `ThreadsCrawler.getProfile({ username })`
  - `feed` / `user_feed` / `timeline` / `tweets` ➔ `ThreadsCrawler.getUserFeed({ username, count, cursor })`
  - `post` / `post_detail` ➔ `ThreadsCrawler.getPostDetail({ postId, includeReplies, maxDepth, maxComments })`
  - `comments` / `post_comments` ➔ `ThreadsCrawler.getPostComments({ postId, maxDepth, maxComments, after })`
  - `search` ➔ `ThreadsCrawler.searchPosts({ query, count, cursor, searchType })`
  - `followers` ➔ `ThreadsCrawler.getFollowers({ username, count, cursor })`
  - `following` ➔ `ThreadsCrawler.getFollowing({ username, count, cursor })`
- **And** trả về kết quả chuẩn hóa tương thích `ProfileItem`, `PostItem`, hoặc `{ post, comments }`

### AC-2: Package.json Exports & Module Resolution
- **Given** `package.json` của project XActions
- **When** consumer import từ `xactions/scrapers/social/threads` hoặc `xactions/scrapers/social`
- **Then** `package.json` chứa exports field `./scrapers/social/threads` map tới `./src/scrapers/social/threads/index.js`
- **And** `DEFAULT_THREADS_DOC_IDS`, `ThreadsCrawler`, `ThreadsClient`, `ThreadsPlatformResponseValidator` và normalizer helpers được export đầy đủ

### AC-3: Deprecation Tracking & Markers
- **Given** `docs/deprecation-plan.md` và `src/scrapers/threads/index.js`
- **When** Story 15.1.4 hoàn thành
- **Then** `docs/deprecation-plan.md` được cập nhật status `deprecated-planned` cho Threads legacy
- **And** `src/scrapers/threads/index.js` có `@deprecated` JSDoc và `// LEGACY — see docs/deprecation-plan.md`

### AC-4: Integration Test Suite (No-Mocks ATDD)
- **Given** `tests/scrapers/social/threads/caller-migration.test.js`
- **When** chạy qua `npx vitest run tests/scrapers/social/threads/caller-migration.test.js`
- **Then** tất cả các test cases xác nhận:
  - `scrape('threads', 'profile', ...)` gọi `ThreadsCrawler`
  - `scrape('threads', 'search', ...)` gọi `ThreadsCrawler`
  - `scrape('threads', 'post_detail', ...)` gọi `ThreadsCrawler`
  - `scrape('threads', 'comments', ...)` gọi `ThreadsCrawler`
  - `scrape('threads', 'followers', ...)` gọi `ThreadsCrawler`
  - Không có process Puppeteer nào được spawn khi thực hiện các action trên

## Developer Context & Implementation Guidance

### Key Files to Modify / Create:
1. `src/scrapers/index.js` (UPDATE): Thêm nhánh xử lý `platform === 'threads'` trong `scrape()`, khởi tạo `ThreadsCrawler` hoặc gọi `start()` trực tiếp tương tự nhánh `facebook` (xem `src/scrapers/index.js:150-240`).
2. `package.json` (UPDATE): Thêm `"./scrapers/social/threads": "./src/scrapers/social/threads/index.js"` vào `exports`.
3. `docs/deprecation-plan.md` (UPDATE): Cập nhật bảng và mục Threads sang trạng thái `deprecated-planned`.
4. `src/scrapers/threads/index.js` (UPDATE): Đảm bảo đầy đủ chú thích `@deprecated`.
5. `tests/scrapers/social/threads/caller-migration.test.js` (NEW): Bộ test tích hợp kiểm tra toàn bộ luồng caller migration.

### Testing Standard:
- Tuân thủ **No Mocks (AD-10)**: Sử dụng `node:http` servers local để test real HTTP pipeline của client/crawler.
- Run test: `npx vitest run tests/scrapers/social/threads`
