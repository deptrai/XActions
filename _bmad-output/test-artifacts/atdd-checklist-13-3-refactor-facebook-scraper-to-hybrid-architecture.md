# ATDD Checklist — Story 13.3: Refactor Facebook Scraper to Hybrid Architecture

**Story ID:** 13.3  
**Epic:** 13 — High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)  
**Status:** 🔴 RED Phase (ATDD Initialized & Scaffolds Emitted)  
**Author:** Master Test Architect (TEA) & Senior Dev  
**Target Files:**
- `src/scrapers/social/facebook/index.js`
- `src/scrapers/social/facebook/client.js`
- `src/scrapers/social/facebook/crawler.js`
- `src/scrapers/social/facebook/validator.js`
- `src/scrapers/social/index.js`
- `tests/scrapers/social/facebook/crawler.test.js`
- `tests/scrapers/social/facebook/client.test.js`

---

## 📋 Acceptance Test Coverage Matrix

| AC # | Yêu cầu Kỹ thuật / Test Case | File Kiểm thử | Trạng thái Red Phase |
|---|---|---|:---:|
| **AC-1** | `FacebookCrawler` kế thừa `AbstractCrawler`, `requiresAuth = true`, `name = 'facebook'`, `platform = 'facebook'`, đăng ký `group_posts`, `page_posts` vào `ActionRegistry` | `tests/scrapers/social/facebook/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-2** | `FacebookClient` kế thừa `AbstractApiClient`, set `client = 'got'`, hỗ trợ `warmup` token extraction, retry 429/403, proxy quarantine | `tests/scrapers/social/facebook/client.test.js` | 🔴 RED (Fail as expected) |
| **AC-3** | `group_posts` handler gọi GraphQL endpoint `https://www.facebook.com/api/graphql/` với `doc_id`, trích xuất `PostItem[]` chuẩn hoá (`id: 'facebook:${postId}'`, `category: 'social'`) và lưu `PrismaStore` | `tests/scrapers/social/facebook/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-4** | `page_posts` handler gọi GraphQL endpoint của page feed, trả về `PostItem[]` chuẩn hoá và lưu `PrismaStore` | `tests/scrapers/social/facebook/crawler.test.js` | 🔴 RED (Fail as expected) |
| **AC-5** | Session cookie tương thích (`c_user`, `xs`), trích xuất `fb_dtsg`, `lsd`, `jazoest`, `__spin_r`, `__spin_t` từ HTML home page | `tests/scrapers/social/facebook/client.test.js` | 🔴 RED (Fail as expected) |
| **AC-6** | Proxy & Sticky IP qua `AbstractApiClient.resolveProxy()` gắn với `accountId`, không fallback direct connection | `tests/scrapers/social/facebook/client.test.js` | 🔴 RED (Fail as expected) |
| **AC-7** | Graceful `doc_id` rotation: không throw unhandled crash; trả về `PlatformError(XACT_5000, retry_after_delay)` và log warning | `tests/scrapers/social/facebook/client.test.js` | 🔴 RED (Fail as expected) |
| **AC-8** | Kiểm thử thực tế (No mocks, no `vi.fn`, local `http.createServer` + real `got`/`undici`) | `tests/scrapers/social/facebook/*.test.js` | 🔴 RED (Fail as expected) |

---

## 🎯 Verification Criteria (Red Phase Target)

- Test scaffolds được sinh và import các module mục tiêu.
- Khi chạy test lần đầu, 100% tests phải **FAILED chính xác** vì các class `FacebookCrawler`, `FacebookClient`, `FacebookPlatformResponseValidator` chưa được code.
