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

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **Build on top of Stories 15.1, 15.1.1, 15.1.2, and 15.1.3 (all implemented).** `ThreadsClient` and `ThreadsCrawler` already exist in `src/scrapers/social/threads/`. This story *only* performs caller migration, unified dispatcher wiring, package exports, MCP/CLI tool cutover, and deprecation marking. Do not rewrite or restructure crawler actions.
2. **Unified `scrape('threads', ...)` Must Use Hybrid `ThreadsCrawler`.** `src/scrapers/index.js` must dispatch `threads` calls directly to `ThreadsCrawler.start({ action, args, session })` without launching Puppeteer browser instances, following the same pattern established for `facebook` in Story 13.10.
3. **Backward Compatibility & Action Mapping.** Existing action aliases (`tweets`, `timeline`, `feed`, `user_feed`, `posts`, `post`, `post_detail`, `comments`, `post_comments`, `profile`, `followers`, `following`, `search`) must be mapped to corresponding `ThreadsCrawler` actions seamlessly.
4. **Zero Mocks Testing (AD-10).** All integration test suites in `tests/scrapers/social/threads/` must use local `node:http` servers and real HTTP request pipelines (`got-scraping`). No `vi.fn`, stubs, or fake HTTP clients.
5. **Telemetry & Security (NFR-4).** Security tokens (`lsd`, `csrftoken`, `fb_dtsg`) and raw cookies must never be logged or exposed in error envelopes.
6. **Legacy Code Retention (Epic 20.2).** Do NOT delete `src/scrapers/threads/` directory in this story. Mark it as `@deprecated` and update `docs/deprecation-plan.md` to `deprecated-planned` for Phase 1. Physical file deletion is scheduled for Epic 20.2.

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
  - Cập nhật `package.json` `exports` để expose `./scrapers/social/threads` và `./scrapers/social`.
  - Cập nhật `src/mcp/server.js`:
    - `x_crawl_post` và `x_crawl_comments_tree` (các tool cross-platform thực sự tồn tại) dispatch qua `scrape('threads', ...)`.
    - `x_actions_list` đã import `ThreadsCrawler`; giữ nguyên và verify không khởi chạy Puppeteer.
    - Bổ sung `x_get_profile_multiplatform`, `x_get_tweets_multiplatform`, `x_search_tweets_multiplatform` trong `src/mcp/local-tools.js` để khi `args.platform === 'threads'` thì gọi `scrape('threads', 'profile'|'get_user_feed'|'search', options)` thay vì Twitter-only path. Các tên `x_crawl_profile`, `x_crawl_user_timeline`, `x_crawl_search`, `x_crawl_comments` không tồn tại trong codebase.
  - Cập nhật `docs/deprecation-plan.md` status tracker sang `deprecated-planned` cho toàn bộ Threads legacy `src/scrapers/threads/` và ghi rõ dependency vào Story 15.1.4.
  - Gắn `@deprecated` JSDoc và `// LEGACY — see docs/deprecation-plan.md` cho `src/scrapers/threads/index.js`.
  - Thêm test suite integration `tests/scrapers/social/threads/caller-migration.test.js` để xác thực `scrape('threads', ...)` và package exports dispatch đúng sang hybrid `ThreadsCrawler` mà không khởi chạy Puppeteer.

- **Known Issue / Live Test Note:** Khi chạy với real data, `ThreadsClient.ensureLsd()` có thể fail nếu Meta HTML trả về JSON array `["LSD",[],{"token":"..."},<integer>]` thay vì pattern regex hiện tại trong `src/scrapers/social/threads/client.js:32-37`. Dev agent cần kiểm tra và mở rộng `LSD_REGEXES` nếu live test còn lỗi (đã phát hiện trong smoke test trước khi validate story này).

- **Không trong phạm vi 15.1.4:**
  - Xóa vật lý thư mục `src/scrapers/threads/` (thuộc Epic 20.2 Legacy Scraper Code Decommissioning).
  - Thay đổi schema Prisma hay Redis Stream protocols.

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 15, Story 15.1.4 [dòng 826-838]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 (Tiered Signer), AD-2 (AbstractCrawler/ActionRegistry), AD-3 (Proxy Strategy), AD-10 (No Mocks Testing), AD-14 (Error Envelope)
- `_bmad-output/implementation-artifacts/15-1-threads-scraper-adapter-meta-internal-graphql.md` — Story 15.1 base hybrid engine
- `_bmad-output/implementation-artifacts/15-1-1-threads-hybrid-profile-followers-following.md` — Story 15.1.1 profile & connection actions
- `_bmad-output/implementation-artifacts/15-1-2-threads-hybrid-post-detail-comment-tree.md` — Story 15.1.2 post_detail & shortcode resolution
- `_bmad-output/implementation-artifacts/15-1-3-threads-hybrid-docid-hardening-search-comments.md` — Story 15.1.3 search & comments doc_id hardening
- `_bmad-output/implementation-artifacts/13-10-facebook-hybrid-integration-caller-migration.md` — Model implementation pattern for hybrid caller migration
- `src/scrapers/social/threads/crawler.js` — `ThreadsCrawler` class & action registry
- `src/scrapers/social/threads/client.js` — `ThreadsClient` Meta GraphQL client
- `src/scrapers/social/threads/index.js` — Social Threads barrel
- `src/scrapers/index.js` — Unified `scrape()` dispatcher
- `package.json` — Package exports definition
- `docs/deprecation-plan.md` — Deprecation status tracking

## Acceptance Criteria

### AC-1: Unified `scrape("threads", action, options)` Hybrid Dispatch
- **Given** `scrape(platform, action, options)` trong `src/scrapers/index.js`
- **When** `platform === 'threads'`
- **Then** `src/scrapers/index.js` KHÔNG tạo Puppeteer page qua `createBrowser`/`createPage`
- **And** nó khởi tạo `ThreadsCrawler` (với `ThreadsClient` + proxy/governor/accountPool nếu có)
- **And** gọi `crawler.start({ action: mappedAction, args, session })` với `session: { accountId: options.accountId || 'threads-guest', cookies: options.authCookie || options.cookies }`
- **And** `crawler.cleanup()` được gọi khi hoàn thành nếu `options.autoClose !== false`
- **And** trả về kết quả chuẩn hóa tương thích `ProfileItem`, `PostItem[]`, `CommentItem[]`, hoặc `{ post, comments }`

### AC-2: Action Name Mapping Matrix for `scrape('threads', ...)`

| `scrape()` action | `ThreadsCrawler` action | Tham số chuyển đổi (`args`) | Ghi chú |
|---|---|---|---|
| `profile` | `profile` | `{ username: options.username \|\| target }` | Hỗ trợ username có/không có `@` |
| `feed` / `user_feed` / `timeline` / `tweets` | `get_user_feed` | `{ username: options.username \|\| target, count: options.limit \|\| options.count, cursor: options.cursor }` | Mặc định count = 20 |
| `post` / `post_detail` | `post_detail` | `{ postId: options.postId \|\| options.url \|\| target, includeReplies: options.includeReplies !== false, maxDepth: options.maxDepth, maxComments: options.maxComments }` | Hỗ trợ numeric ID, shortcode, URL |
| `comments` / `post_comments` | `get_post_comments` | `{ postId: options.postId \|\| options.url \|\| target, maxDepth: options.maxDepth, maxComments: options.maxComments, after: options.cursor }` | Multi-depth comment tree |
| `search` | `search` | `{ query: options.query \|\| target, count: options.limit \|\| options.count, cursor: options.cursor, searchType: options.searchType }` | GraphQL-first + SSR fallback |
| `followers` | `followers` | `{ username: options.username \|\| target, count: options.limit \|\| options.count, cursor: options.cursor }` | Trả về danh sách profiles & limitation note |
| `following` | `following` | `{ username: options.username \|\| target, count: options.limit \|\| options.count, cursor: options.cursor }` | Trả về danh sách profiles & limitation note |

### AC-3: Package.json Exports & Module Resolution
- **Given** `package.json` của project XActions
- **When** consumer import từ `xactions/scrapers/social/threads` hoặc `xactions/scrapers/social`
- **Then** `package.json` chứa exports field:
  - `"./scrapers/social/threads": "./src/scrapers/social/threads/index.js"`
  - `"./scrapers/social": "./src/scrapers/social/index.js"`
- **And** `DEFAULT_THREADS_DOC_IDS`, `ThreadsCrawler`, `ThreadsClient`, `ThreadsPlatformResponseValidator`, `threadsNamespacedProfileId`, `normalizeThreadsProfile`, `profileItemToPostItem` được export đầy đủ

### AC-4: Deprecation Tracking & Markers
- **Given** `docs/deprecation-plan.md` và `src/scrapers/threads/index.js`
- **When** Story 15.1.4 hoàn thành
- **Then** `docs/deprecation-plan.md` cập nhật status `deprecated-planned` cho toàn bộ `src/scrapers/threads/`
- **And** `src/scrapers/threads/index.js` có `@deprecated` JSDoc và `// LEGACY — see docs/deprecation-plan.md`
- **And** ghi rõ dependency vào Story 15.1.4 trong bảng mapping

### AC-5: Integration Test Suite (No-Mocks ATDD)
- **Given** `tests/scrapers/social/threads/caller-migration.test.js`
- **When** chạy qua `npx vitest run tests/scrapers/social/threads/caller-migration.test.js`
- **Then** tất cả các test cases xác nhận:
  - `scrape('threads', 'profile', ...)` dispatches to `ThreadsCrawler` action `profile` (handler `getProfile`)
  - `scrape('threads', 'timeline' | 'tweets' | 'feed' | 'user_feed', ...)` maps to action `get_user_feed` (handler `getUserFeed`)
  - `scrape('threads', 'post' | 'post_detail', ...)` maps to action `post_detail` (handler `getPostDetail`)
  - `scrape('threads', 'comments' | 'post_comments', ...)` maps to action `get_post_comments` (handler `getPostComments`)
  - `scrape('threads', 'search', ...)` maps to action `search` (handler `searchPosts` / `search`)
  - `scrape('threads', 'followers', ...)` maps to action `followers` (handler `getFollowers`)
  - `scrape('threads', 'following', ...)` maps to action `following` (handler `getFollowing`)
  - Không có Puppeteer browser process nào được launch khi chạy `scrape('threads', ...)`

## Developer Context & Implementation Guidance

### Key Files to Modify / Create:

#### 1. `src/scrapers/index.js` (UPDATE)
- Import `ThreadsCrawler` from `./social/threads/crawler.js` and `ThreadsClient` from `./social/threads/client.js`.
- In `scrape(platform, action, options)`:
  - Add `threads` handling branch (similar to `facebook` at `src/scrapers/index.js:150-240`).
  - Map incoming `action` via `THREADS_ACTION_MAP`.
  - Instantiate `ThreadsCrawler` with `client`, `accountPool`, `proxyPool`, `governor`.
  - Pass `session: { accountId: options.accountId || 'threads-guest', cookies: options.authCookie || options.cookies }`.
  - Execute `await crawler.start({ action: mappedAction, args: mappedArgs, session })`.
  - Cleanup crawler if `options.autoClose !== false`.

#### 2. `package.json` (UPDATE)
- Add `"./scrapers/social/threads": "./src/scrapers/social/threads/index.js"` to `exports`.
- Ensure `"./scrapers/social": "./src/scrapers/social/index.js"` is present.
- Keep legacy `"./scrapers/threads": "./src/scrapers/threads/index.js"` for backward compatibility until Epic 20.2.

#### 3. `src/mcp/server.js` & `src/mcp/local-tools.js` (UPDATE)
- `src/mcp/server.js`:
  - `x_crawl_post` (`executeCrawlPostTool`) gọi `scrape(platform, 'post_detail' | 'posts', ...)` — khi `platform === 'threads'` phải dispatch vào `ThreadsCrawler` qua `src/scrapers/index.js`.
  - `x_crawl_comments_tree` (`executeCrawlCommentsTreeTool`) gọi `scrape(platform, 'get_comments', ...)` — map sang `get_post_comments` trong `THREADS_ACTION_MAP`.
  - `x_actions_list` đã import `ThreadsCrawler`; verify `cleanup()` không leak Puppeteer.
- `src/mcp/local-tools.js`:
  - Thêm `x_get_profile_multiplatform`, `x_get_tweets_multiplatform`, `x_search_tweets_multiplatform` để khi `args.platform === 'threads'` thì gọi `scrape('threads', 'profile' | 'get_user_feed' | 'search', options)`.
  - `x_get_thread` hiện là Twitter-only; không đổi tên trong 15.1.4. Nếu cần hỗ trợ Threads post detail qua tool này, mở rộng sau.

#### 4. `docs/deprecation-plan.md` (UPDATE)
- Update Threads row in legacy-to-hybrid mapping table:
  - Set status to `deprecated-planned`.
  - Reference Story 15.1.4 as the caller migration baseline.

#### 5. `src/scrapers/threads/index.js` (UPDATE)
- Add top-level comment: `// LEGACY — see docs/deprecation-plan.md`.
- Add `@deprecated` JSDoc to `createBrowser`, `scrapeProfile`, `scrapeTweets`, `scrapeFollowers`, `scrapeFollowing`, `scrapeSearch`, `scrapePost`.

#### 6. `tests/scrapers/social/threads/caller-migration.test.js` (NEW)
- Implement ATDD test suite using `node:http` mock servers.
- Cover all action dispatches through `scrape('threads', action, options)`:
  - `'profile'`, `'feed'`, `'user_feed'`, `'timeline'`, `'tweets'`, `'post'`, `'post_detail'`, `'comments'`, `'post_comments'`, `'search'`, `'followers'`, `'following'`.
- Verify absence of Puppeteer browser launch (assert no `puppeteer.launch` calls, no `Chromium` process spawned).
- Verify package exports:
  - `xactions/scrapers/social/threads` resolves to `src/scrapers/social/threads/index.js`.
  - `xactions/scrapers/social` resolves and re-exports Threads public symbols.

### ATDD Artifacts

- **Checklist:** `_bmad-output/test-artifacts/atdd-checklist-15-1-4-threads-hybrid-integration-package-exports.md`
- **Red-Phase Test Scaffold:** `tests/scrapers/social/threads/caller-migration.test.js` (13 tests, currently `describe.skip()`)
- **TDD Phase:** RED — remove `describe.skip()` task-by-task during `dev-story`

## Testing Standards & Commands
- **No Mocks Rule**: Do NOT use `vi.fn()` or fake HTTP clients. Build local `node:http` servers to return realistic HTML and GraphQL responses.
- **Run Tests**:
  ```bash
  npx vitest run tests/scrapers/social/threads
  npx vitest run tests/scrapers/social/threads/caller-migration.test.js
  ```
- **Live Smoke Test**:
  ```bash
  node scripts/test-threads-live.js
  ```
  Nếu `ensureLsd` fail vì Meta HTML thay đổi JSON pattern, kiểm tra `LSD_REGEXES` trong `src/scrapers/social/threads/client.js`.
