---
title: 'Story 23.2: Bluesky Hybrid Crawler'
type: 'feature'
created: '2026-09-04'
baseline_commit: 'ccd4c1ec76b736651ff8d227631be1242af99b1b'
status: 'done'
review_loop_iteration: 0
context:
  - src/scrapers/social/bluesky/validator.js
  - src/scrapers/bluesky/index.js
  - src/core/base-client.js
  - src/core/abstract-crawler.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 23.1 đã tạo Bluesky AT Protocol client nhưng chưa hoàn thiện integration với `AbstractApiClient`, proxy rotation, và `ActionRegistry`. Kết quả E2E từ Story 23.5 cho thấy:
- `Bluesky Search Posts` trả về 403 khi gọi từ dashboard vì `app.bsky.feed.searchPosts` yêu cầu auth và legacy client không dùng proxy.
- `Bluesky Trending` hiển thị "Action trending not available" vì crawler chưa đăng ký action `trending`.
- Legacy `src/scrapers/bluesky/index.js` dùng `fetch` trực tiếp, không qua `AbstractApiClient` pipeline.

**Approach:** Implement `BlueskyCrawler` kế thừa `AbstractCrawler`, `BlueskyClient` kế thừa `AbstractApiClient`, đăng ký action `profile`, `followers`, `following`, `tweets`/`posts`, `search`, `trending`, `feed`, và ensure mọi request đi qua proxy/governor/response validator.

## Boundaries & Constraints

**Always:**
- Đặt crawler tại `src/scrapers/social/bluesky/crawler.js`.
- Đặt client tại `src/scrapers/social/bluesky/client.js`.
- Kế thừa `AbstractCrawler` và `AbstractApiClient` từ `src/core/`.
- Dùng `BlueskyPlatformResponseValidator` đã có trong `src/scrapers/social/bluesky/validator.js`.
- Đăng ký action theo snake_case: `profile`, `followers`, `following`, `posts`, `search`, `trending`, `feed`.
- Hỗ trợ auth optional: nếu user có `identifier`/`password` thì dùng; nếu không thì public API với proxy.
- Dữ liệu chuẩn hóa `ProfileItem` / `PostItem` với ID `bluesky:${uri|handle}`.

**Ask First:**
- Nếu cần thay đổi dashboard HTML/JS để gửi `accountIds` cho Bluesky Search.
- Nếu cần deprecated legacy `src/scrapers/bluesky/index.js` ngay trong story này.

**Never:**
- Không sửa logic `BlueskyPlatformResponseValidator` (đã hoàn thành ở Story 23.5).
- Không thay đổi `AbstractPlatformResponseValidator`.
- Không viết logic platform-specific vào `src/core`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Profile (no auth) | `{ handle: 'nichxbt.bsky.social' }` | Profile `ProfileItem` hợp lệ | `AuthSessionExpiredError` nếu 401 |
| Profile (with auth) | `{ handle, identifier, password }` | Profile với đầy đủ metadata | `AuthSessionExpiredError` nếu 401 |
| Search (no auth) | `{ query: 'bluesky' }` | Nếu public endpoint chặn IP → `RateLimitError`/proxy rotation | `BotChallengeError` nếu 403 |
| Search (with auth) | `{ query, identifier, password }` | Mảng `PostItem[]` | `AuthSessionExpiredError` nếu 401 |
| Trending (no auth) | `{}` | Mảng trending topics `PostItem[]` | `RateLimitError` nếu 429 |
| Trending (with auth) | `{ identifier, password }` | Mảng trending topics | `AuthSessionExpiredError` nếu 401 |
| Empty feed | `{ handle, posts: 0 }` | `[]` | `PlatformError` không throw vì valid empty |
| Rate limit | 429 | `RateLimitError` với `retryAfterMs` | Quarantine proxy |

## Code Map

- `src/core/base-client.js` — `AbstractApiClient` pipeline: proxy, governor, retry, validator.
- `src/core/abstract-crawler.js` — `AbstractCrawler`, `ActionRegistry`.
- `src/scrapers/social/bluesky/validator.js` — response validator đã hoàn thành.
- `src/scrapers/social/twitter/crawler.js` — mẫu `AbstractCrawler` kế thừa.
- `src/scrapers/bluesky/index.js` — legacy client, cần tham khảo.
- `src/scrapers/social/index.js` — barrel export.
- `dashboard/platform.html` hoặc `dashboard/platforms/bluesky.html` — UI nếu cần account selection.

## Tasks & Acceptance

**Execution:**
- [x] `src/scrapers/social/bluesky/client.js` — `BlueskyClient` kế thừa `AbstractApiClient`, implement `sign()` no-op, `baseUrl`, `request()` qua XRPC, hỗ trợ auth optional, gắn `BlueskyPlatformResponseValidator`.
- [x] `src/scrapers/social/bluesky/crawler.js` — `BlueskyCrawler` kế thừa `AbstractCrawler`, đăng ký actions: `profile`, `followers`, `following`, `posts`, `search`, `trending`, `feed`.
- [x] `src/scrapers/social/bluesky/index.js` — barrel export `client.js`, `crawler.js`, `validator.js`.
- [x] Cập nhật `src/scrapers/social/index.js` — export `bluesky`.
- [x] `src/scrapers/index.js` — sửa dispatcher để `bluesky` dùng `BlueskyCrawler` thay vì legacy `src/scrapers/bluesky/index.js`.
- [x] `tests/scrapers/social/bluesky/crawler.test.js` — unit tests cho các action chính.
- [x] `tests/scrapers/social/bluesky/client.test.js` — unit tests cho client XRPC, auth, proxy.
- [x] `tests/scrapers/social/bluesky/normalizer.test.js` — unit tests cho normalizer.
- [x] `tests/scrapers/social/bluesky/dispatcher.test.js` — unit tests cho universal dispatcher.

**Acceptance Criteria:**
- Given `BlueskyCrawler` kế thừa `AbstractCrawler`, when gọi `start({ action: 'search', args: { query: 'bluesky' } })`, then trả về `PostItem[]` hoặc phân loại lỗi đúng (auth/proxy/rate-limit).
- Given `BlueskyCrawler`, when gọi `trending`, then trả về trending topics từ `app.bsky.unspecced.getTrendingTopics`.
- Given unit tests, when chạy `npx vitest run tests/scrapers/social/bluesky/`, then tất cả tests pass.

## Spec Change Log

- 2026-09-04 — Tạo story sau E2E Story 23.5; xác định Bluesky Search cần auth/proxy và Bluesky Trending chưa implement.

## Design Notes

E2E từ Story 23.5 cho thấy legacy `src/scrapers/bluesky/index.js` gọi `fetch` trực tiếp, không qua proxy pool. Với public endpoint từ VN, Bluesky `searchPosts` trả 403 từ BunnyCDN. Khi chuyển sang `AbstractApiClient` + `BlueskyPlatformResponseValidator`, lỗi 403 sẽ được xoay proxy hoặc yêu cầu auth.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/bluesky/crawler.test.js tests/scrapers/social/bluesky/client.test.js`
- `npx vitest run tests/scrapers/social/bluesky/`
- E2E: dashboard Bluesky Search Posts + Trending
