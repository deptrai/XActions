---
title: 'Story 23.4: Mastodon Hybrid Crawler'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 0
baseline_commit: '4d63f213bfa7a7b8e1f0e21a8a3a0e6e768165b6'
context:
  - _bmad-output/implementation-artifacts/epic-23-context.md
  - _bmad-output/implementation-artifacts/stories/23-2-bluesky-hybrid-crawler.md
  - src/scrapers/social/mastodon/validator.js
  - src/scrapers/mastodon/index.js
  - src/core/base-client.js
  - src/core/abstract-crawler.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions hiện có module Mastodon cũ (`src/scrapers/mastodon/index.js`) sử dụng `fetch` trực tiếp, không tích hợp `AbstractApiClient`, không qua `ProxyIpPool`, không có `AdaptiveRateGovernor` rate limiting, và không dùng `ActionRegistry`/`CrawlerCommand` chuẩn của Universal Scraping Engine. Dù validator (`MastodonPlatformResponseValidator`) đã có ở Story 23.5, nhưng chưa có `MastodonClient` và `MastodonCrawler` kế thừa framework core.

**Approach:** 
1. Xây dựng `MastodonClient` kế thừa `AbstractApiClient` trong `src/scrapers/social/mastodon/client.js` kết nối Mastodon REST API qua pipeline proxy, governor, và response validation.
2. Xây dựng `normalizer.js` trong `src/scrapers/social/mastodon/normalizer.js` để chuẩn hóa các payload Account, Status, Search, Tag thành `ProfileItem` và `PostItem` với ID namespaced `mastodon:${instance}:${id}` và giải mã HTML entities sạch (`toPlainText`).
3. Xây dựng `MastodonCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/social/mastodon/crawler.js`, đăng ký đầy đủ 7 action: `profile`, `followers`, `following`, `posts`/`get_user_feed`, `search`, `hashtag`, `trending`.
4. Tạo barrel file `src/scrapers/social/mastodon/index.js` export `MastodonClient`, `MastodonCrawler`, `normalizer`, `validator`.
5. Viết comprehensive unit tests (`client.test.js`, `crawler.test.js`, `normalizer.test.js`) phủ toàn bộ actions, error envelopes, pagination và proxy/governor integration.

## Boundaries & Constraints

**Always:**
- Đặt code mới tại `src/scrapers/social/mastodon/`.
- Kế thừa trực tiếp `AbstractApiClient` (`src/core/base-client.js`) và `AbstractCrawler` (`src/core/base-crawler.js`).
- Sử dụng `MastodonPlatformResponseValidator` từ `src/scrapers/social/mastodon/validator.js` làm responseValidator mặc định.
- Tên actions trong `ActionRegistry` phải đúng chuẩn snake_case: `profile`, `followers`, `following`, `posts` (alias `get_user_feed`), `search`, `hashtag`, `trending`.
- ID chuẩn hóa phải namespaced: `mastodon:${instance}:${id}` (ví dụ `mastodon:mastodon.social:112345678`).
- Instance mặc định là `https://mastodon.social`, nhưng cho phép override linh hoạt qua `args.instance`, `options.instance`, hoặc URL trong username/target.
- Giải mã HTML entity (ví dụ `&amp;` -> `&`, `&lt;` -> `<`, thẻ `<p>`, `<br>`) khi trích xuất bio và content để tránh dirty text (tái sử dụng giải pháp `toPlainText` từ legacy).
- Khai báo `requiresAuth: false` cho tất cả public actions; hỗ trợ `accessToken` tùy chọn cho private/authorized instances.
- Không dùng mocks trong unit tests; dùng real dependencies hoặc in-memory handlers theo chuẩn repo.

**Ask First:**
- Nếu cần sửa đổi `src/scrapers/index.js` (việc này thuộc Story 23.6 - Migration & Caller Integration).
- Nếu cần can thiệp dashboard UI.

**Never:**
- Không sửa file `src/scrapers/social/mastodon/validator.js` đã hoàn thành và verified ở Story 23.5.
- Không dùng Puppeteer hoặc browser engine (Mastodon là 100% HTTP REST API).
- Không thêm dependency npm mới; sử dụng `undici`/`fetch` sẵn có trong core client.

## I/O & Edge-Case Matrix

| Scenario | Input / Action | Expected Output | Error Handling |
|----------|---------------|-----------------|----------------|
| Profile (clean username) | `profile({ username: 'Gargron', instance: 'mastodon.social' })` | `ProfileItem` chuẩn hóa, ID `mastodon:mastodon.social:<id>` | 404 -> `PlatformError (XACT_4001)` |
| Profile (webfinger handle) | `profile({ username: '@Gargron@mastodon.social' })` | Tự động bóc tách username và instance | Format sai -> `XACT_4001` |
| User Feed / Posts | `posts({ username: 'Gargron', limit: 20 })` | Mảng `PostItem[]` với content plain text đã giải mã HTML | Empty feed -> `[]` |
| Followers / Following | `followers({ username: 'Gargron', limit: 40 })` | `{ profiles: ProfileItem[], pageInfo: { next_max_id } }` | Account private -> `AuthSessionExpiredError` hoặc `PlatformError` |
| Search posts / hashtags | `search({ query: 'open source', type: 'statuses' })` | `{ posts: PostItem[], profiles: ProfileItem[], hashtags: any[] }` | Rate limit 429 -> `RateLimitError` |
| Trending Statuses/Tags | `trending({ limit: 10 })` | Mảng `PostItem[]` trending statuses | Instance không bật public trending -> fallback graceful |
| Instance custom domain | `{ instance: 'fosstodon.org' }` | Tự động chuẩn hóa protocol `https://fosstodon.org` | Invalid host -> `XACT_4001` |
| Rate Limit HTTP 429 | Bất kỳ request nào nhận 429 | Ném `RateLimitError`, trigger proxy quarantine | Validator phát hiện và ném `RateLimitError` |
| Auth Expired HTTP 401 | Truy cập private endpoint với token hỏng | Ném `AuthSessionExpiredError` với `suggestedAction: 'relogin'` | Validator nhận diện `invalid_token` |

</frozen-after-approval>

## Code Map

- `src/core/base-client.js`: `AbstractApiClient` lớp cha quản lý request pipeline, proxy rotation, governor recording.
- `src/core/base-crawler.js`: `AbstractCrawler` lớp cha quản lý `ActionRegistry`, validation `CrawlerCommand`.
- `src/scrapers/social/mastodon/validator.js`: `MastodonPlatformResponseValidator` kiểm tra payload hợp lệ, 429, 401, 403.
- `src/scrapers/social/bluesky/`: Mẫu tham khảo hoàn chỉnh nhất (Story 23.2) gồm `client.js`, `crawler.js`, `normalizer.js`, `index.js`.
- `src/scrapers/mastodon/index.js`: Legacy scraper, chứa endpoints URL REST API (`/api/v1/accounts/lookup`, `/api/v1/accounts/:id/statuses`, `/api/v1/accounts/:id/followers`, `/api/v2/search`, `/api/v1/trends/statuses`) và helper `toPlainText`.
- `types/core.d.ts`: Định nghĩa kiểu dữ liệu `PostItem`, `ProfileItem`, `CrawlerCommand`, `ActionDescriptor`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/scrapers/social/mastodon/normalizer.js`:
  - Implement `toPlainText(html)` giải mã HTML entities và xuống dòng chuẩn.
  - Implement `namespacedMastodonId(instance, id)`.
  - Implement `normalizeMastodonAccount(account, instance) -> ProfileItem`.
  - Implement `normalizeMastodonStatus(status, instance) -> PostItem`.
  - Implement `normalizeMastodonTag(tag, instance) -> PostItem`.
- [ ] `src/scrapers/social/mastodon/client.js`:
  - Implement `MastodonClient extends AbstractApiClient`.
  - Khởi tạo instance URL chuẩn hóa, headers `Authorization: Bearer <token>` nếu có `accessToken`.
  - Hỗ trợ methods gọi REST API: `lookupAccount`, `getAccountStatuses`, `getAccountFollowers`, `getAccountFollowing`, `search`, `getTrendingStatuses`, `getHashtagTimeline`.
  - Wire `MastodonPlatformResponseValidator` và tích hợp `governor.recordRequest()`.
- [ ] `src/scrapers/social/mastodon/crawler.js`:
  - Implement `MastodonCrawler extends AbstractCrawler`.
  - Đăng ký 7 actions: `profile`, `followers`, `following`, `posts` (kèm alias `get_user_feed`), `search`, `hashtag`, `trending`.
  - Xử lý options: `limit`, `max_id`, `since_id`, `cursor`, `instance`, `accessToken`, `onProgress`.
  - Lưu kết quả vào `store` (`PrismaStore`) nếu được cấu hình.
- [ ] `src/scrapers/social/mastodon/index.js`:
  - Export `MastodonClient`, `MastodonCrawler`, `MastodonPlatformResponseValidator`, và normalizers.
- [ ] Tests:
  - `tests/scrapers/social/mastodon/normalizer.test.js`: test HTML cleaning, entity decoding, namespaced IDs.
  - `tests/scrapers/social/mastodon/client.test.js`: test REST endpoints resolution, token headers, error mapping.
  - `tests/scrapers/social/mastodon/crawler.test.js`: test action registration, execution pipeline, output shapes.

**Acceptance Criteria:**
- Given `MastodonCrawler` khởi tạo, when gọi `listActions()`, then trả về đầy đủ 7 actions chuẩn snake_case.
- Given `MastodonCrawler.start({ action: 'profile', args: { username: 'Gargron', instance: 'https://mastodon.social' } })`, then trả về `ProfileItem` có `platform: 'mastodon'` và ID `mastodon:mastodon.social:<id>`.
- Given `toPlainText`, when nhận `<p>Hello &amp; welcome<br/>to Mastodon</p>`, then trả về `Hello & welcome\nto Mastodon`.
- Given request gặp HTTP 429 hoặc 401, then client & crawler ném đúng `RateLimitError` hoặc `AuthSessionExpiredError` theo error envelope.
- Given bộ tests cho Mastodon hybrid, when chạy `npx vitest run tests/scrapers/social/mastodon/`, then 100% tests pass.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/mastodon/`
- `npx vitest run tests/scrapers/social/mastodon/crawler.test.js`
- `npx vitest run tests/scrapers/social/mastodon/client.test.js`
- `npx vitest run tests/scrapers/social/mastodon/normalizer.test.js`
