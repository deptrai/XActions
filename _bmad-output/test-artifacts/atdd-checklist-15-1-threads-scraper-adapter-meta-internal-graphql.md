# ATDD Checklist — Story 15.1: Threads Scraper Adapter (Meta Internal GraphQL)

**Story ID:** 15.1  
**Epic:** 15 — Vietnam Viral Social — Threads & TikTok Scraper Engine  
**Status:** 🔴 RED Phase (ATDD Initialized & Scaffolds Emitted)  
**Author:** Master Test Architect (TEA) & Senior Dev  
**Target Files:**
- `src/scrapers/social/threads/index.js`
- `src/scrapers/social/threads/client.js`
- `src/scrapers/social/threads/crawler.js`
- `src/scrapers/social/threads/validator.js`
- `src/scrapers/social/index.js`
- `tests/scrapers/social/threads/client.test.js`
- `tests/scrapers/social/threads/crawler.test.js`

---

## 📋 Acceptance Test Coverage Matrix

| AC # | Yêu cầu Kỹ thuật / Test Case | File Kiểm thử | Trạng thái Red Phase |
|---|---|---|:---:|
| **AC-1** | `ThreadsClient` kế thừa `AbstractApiClient`, `client = 'got'`, `requiresAuth = true`, `platform = 'threads'`, `ensureLsd()` trích xuất `lsd`, `csrftoken`, `fb_dtsg` từ HTML với cache TTL 30m và in-flight deduplication | `tests/scrapers/social/threads/client.test.js` | 🔴 RED (Fail as expected) |
| **AC-2** | `ThreadsClient.requestGraphQl()` gửi GraphQL payload `application/x-www-form-urlencoded` với `doc_id`, `lsd`, `variables`, headers `x-ig-app-id: 238260118697367`, `x-asbd-id: 359341`, `x-fb-lsd`, xử lý `PlatformError(XACT_5000)` khi `doc_id` bị xoay | `tests/scrapers/social/threads/client.test.js` | 🔴 RED (Fail as expected) |
| **AC-3** | `ThreadsCrawler` kế thừa `AbstractCrawler`, `requiresAuth = true`, `name = 'threads'`, `platform = 'threads'`, đăng ký `get_user_feed`, `search`, `get_post_comments` trong `ActionRegistry` | `tests/scrapers/social/threads/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-4** | `get_user_feed(username)`: resolve numeric `userID` từ `@username` HTML, gọi GraphQL `BarcelonaProfileThreadsTabQuery`, chuẩn hoá `PostItem[]` (`id: 'threads:${postId}'`, `category: 'social'`), lưu `PrismaStore` và cập nhật `CrawlCheckpoint` | `tests/scrapers/social/threads/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-5** | `search(query)`: gọi GraphQL search hoặc SSR HTML fallback, chuẩn hoá `PostItem[]`, lưu `PrismaStore` và cập nhật `CrawlCheckpoint` | `tests/scrapers/social/threads/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-6** | `get_post_comments(postId)`: clamp `maxDepth [0,5]`, `maxComments [1,2000]`, tích hợp `CommentTreeExtractor` với callback `fetchLayer`, duyệt cây phân cấp, chuẩn hoá `CommentItem[]` và lưu `storeCommentBatch` | `tests/scrapers/social/threads/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-7** | Data Normalization: ánh xạ đầy đủ trường `PostItem` / `CommentItem` (`authorId`, `authorName`, `content`, `likesCount`, `repliesCount`, `publishedAt`, `mediaUrls`, `metadata`) tuân thủ `src/core/types.js` | `tests/scrapers/social/threads/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-8** | `ThreadsPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`, nhận diện HTML/GraphQL hợp lệ, phát hiện bot challenge/checkpoint (403), rate limit (429) | `tests/scrapers/social/threads/client.test.js` | 🔴 RED (Fail as expected) |
| **AC-9** | Deprecation marker: gắn `@deprecated` cho tất cả exports của `src/scrapers/threads/index.js` legacy (Puppeteer) | `tests/scrapers/social/threads/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-10** | Kiểm thử thực tế (No mocks, no `vi.fn`, local `http.createServer` + real `got`/`undici`, TypeScript strict mode) | `tests/scrapers/social/threads/*.test.js` | 🔴 RED (Fail as expected) |

---

## 🎯 Verification Criteria (Red Phase Target)

- Test scaffolds được sinh và import các module mục tiêu từ `src/scrapers/social/threads/`.
- Khi chạy `npx vitest run tests/scrapers/social/threads/`, 100% tests phải **FAILED chính xác** vì các class `ThreadsCrawler`, `ThreadsClient`, `ThreadsPlatformResponseValidator` chưa được code (`ERR_MODULE_NOT_FOUND`).
