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
  - src/core/base-crawler.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions hiện có module Mastodon cũ (`src/scrapers/mastodon/index.js`) sử dụng `fetch` trực tiếp, không tích hợp `AbstractApiClient`, không qua `ProxyIpPool`, không có `AdaptiveRateGovernor` rate limiting, và không dùng `ActionRegistry`/`CrawlerCommand` chuẩn của Universal Scraping Engine. Dù validator (`MastodonPlatformResponseValidator`) đã hoàn thành ở Story 23.5, nhưng hệ thống vẫn thiếu `MastodonClient` và `MastodonCrawler` chuẩn theo kiến trúc core.

**Approach:**
1. Xây dựng `resolveMastodonTarget(input, defaultInstance)` và `normalizer.js` trong `src/scrapers/social/mastodon/normalizer.js`:
   - Phân giải linh hoạt mọi định dạng handle (`@user@instance`, `user@instance`), URL web (`https://instance/@user`), hoặc raw username.
   - Chuẩn hóa Account, Status, Search, Tag thành `ProfileItem` và `PostItem` với ID namespaced `mastodon:${instance}:${id}`.
   - Triển khai `toPlainText(html)` loại bỏ triệt để HTML tags và giải mã đầy đủ entities (`&amp;`, `&quot;`, `&#39;`, `&apos;`, `&lt;`, `&gt;`, `&nbsp;`).
   - Giữ nguyên metadata hữu ích vào `metadata` JSONB (`instance`, `acct`, `emojis`, `spoiler_text`, `sensitive`, `reblogs_count`, `favourites_count`).
2. Xây dựng `MastodonClient` kế thừa `AbstractApiClient` trong `src/scrapers/social/mastodon/client.js`:
   - Kết nối Mastodon REST API qua pipeline proxy rotation, exponential backoff, governor recording.
   - Hỗ trợ phân trang qua `max_id` / `since_id` và trích xuất `Link` header.
   - Mặc định sử dụng `MastodonPlatformResponseValidator` để phát hiện 429, 401, 403, và lỗi JSON.
3. Xây dựng `MastodonCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/social/mastodon/crawler.js`:
   - Đăng ký đầy đủ 7 action chuẩn snake_case: `profile`, `followers`, `following`, `posts` (alias `get_user_feed`), `search`, `hashtag`, `trending`.
   - Quản lý pipeline command, hỗ trợ lưu `store` (`PrismaStore`) và callback `onProgress`.
4. Tạo barrel file `src/scrapers/social/mastodon/index.js` export `MastodonClient`, `MastodonCrawler`, `normalizer`, `validator`.
5. Xây dựng bộ unit tests không mock (`client.test.js`, `crawler.test.js`, `normalizer.test.js`) đạt độ phủ 100% các scenario và edge case.

## Boundaries & Constraints

**Always:**
- Đặt code mới tại `src/scrapers/social/mastodon/`.
- Kế thừa trực tiếp `AbstractApiClient` (`src/core/base-client.js`) và `AbstractCrawler` (`src/core/base-crawler.js`).
- Sử dụng `MastodonPlatformResponseValidator` từ `src/scrapers/social/mastodon/validator.js` làm responseValidator mặc định.
- Tên actions trong `ActionRegistry` phải đúng chuẩn snake_case: `profile`, `followers`, `following`, `posts` (alias `get_user_feed`), `search`, `hashtag`, `trending`.
- ID chuẩn hóa phải namespaced: `mastodon:${instance}:${id}` (ví dụ `mastodon:mastodon.social:112345678`).
- Instance mặc định là `https://mastodon.social`, cho phép override linh hoạt qua `args.instance`, `options.instance`, hoặc phân giải từ handle/URL.
- Instance URL luôn được chuẩn hóa: có scheme `https://`, loại bỏ trailing slash `/`.
- Trích xuất plain text sạch bằng `toPlainText(html)` cho cả bio (`ProfileItem.bio`) và status content (`PostItem.content`).
- Khai báo `requiresAuth: false` cho tất cả public actions; hỗ trợ `accessToken` tùy chọn cho private/authorized instances.
- Phân trang hỗ trợ cả `max_id` param và parse `Link` header để trả về `pageInfo: { next_max_id, has_next_page }`.
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
| Profile (webfinger handle) | `profile({ username: '@Gargron@mastodon.social' })` | Tự động bóc tách thành username `Gargron` và instance `https://mastodon.social` | Format sai -> `XACT_4001` |
| Profile (web URL) | `profile({ username: 'https://mastodon.social/@Gargron' })` | Tự động bóc tách thành username `Gargron` và instance `https://mastodon.social` | URL không hợp lệ -> `XACT_4001` |
| User Feed / Posts | `posts({ username: 'Gargron', limit: 20 })` | Mảng `PostItem[]` với content plain text đã giải mã HTML, đầy đủ `metadata` JSONB | Empty feed -> `[]` |
| Posts pagination | `posts({ username: 'Gargron', limit: 20, max_id: '112345' })` | Mảng `PostItem[]` trang tiếp theo | Invalid max_id -> empty hoặc `XACT_4001` |
| Followers / Following | `followers({ username: 'Gargron', limit: 40 })` | `{ profiles: ProfileItem[], pageInfo: { next_max_id: string \| null, has_next_page: boolean } }` | Account private -> `AuthSessionExpiredError` hoặc `PlatformError` |
| Search posts / accounts / hashtags | `search({ query: 'open source', type: 'statuses' })` | `{ posts: PostItem[], profiles: ProfileItem[], hashtags: any[] }` | Rate limit 429 -> `RateLimitError` |
| Hashtag timeline | `hashtag({ hashtag: 'technology', limit: 30 })` | Mảng `PostItem[]` có hashtag tương ứng | Empty tag -> `[]` |
| Trending Statuses | `trending({ limit: 10 })` | Mảng `PostItem[]` trending statuses | Instance không hỗ trợ public trends -> fallback graceful sang empty array |
| Instance hostname only | `{ instance: 'fosstodon.org' }` | Tự động chuẩn hóa thành `https://fosstodon.org` | Host không hợp lệ -> `XACT_4001` |
| Rate Limit HTTP 429 | Bất kỳ request nào nhận 429 | Ném `RateLimitError`, trigger proxy quarantine | Validator phát hiện và ném `RateLimitError` |
| Auth Expired HTTP 401 | Truy cập endpoint cần auth với token hỏng | Ném `AuthSessionExpiredError` với `suggestedAction: 'relogin'` | Validator nhận diện `invalid_token` |

</frozen-approval>

## Code Map

- `src/core/base-client.js`: `AbstractApiClient` lớp cha quản lý request pipeline, proxy rotation, governor recording.
- `src/core/base-crawler.js`: `AbstractCrawler` lớp cha quản lý `ActionRegistry`, validation `CrawlerCommand`.
- `src/scrapers/social/mastodon/validator.js`: `MastodonPlatformResponseValidator` kiểm tra payload hợp lệ, 429, 401, 403.
- `src/scrapers/social/bluesky/`: Mẫu tham khảo hoàn chỉnh nhất (Story 23.2) gồm `client.js`, `crawler.js`, `normalizer.js`, `index.js`.
- `src/scrapers/mastodon/index.js`: Legacy scraper, chứa endpoints REST API tham khảo:
  - Account lookup: `GET /api/v1/accounts/lookup?acct=:acct`
  - Account statuses: `GET /api/v1/accounts/:id/statuses?limit=:limit&max_id=:max_id`
  - Followers: `GET /api/v1/accounts/:id/followers?limit=:limit&max_id=:max_id`
  - Following: `GET /api/v1/accounts/:id/following?limit=:limit&max_id=:max_id`
  - Search: `GET /api/v2/search?q=:q&type=:type&resolve=true`
  - Hashtag: `GET /api/v1/timelines/tag/:tag`
  - Trending statuses: `GET /api/v1/trends/statuses?limit=:limit`
- `types/core.d.ts`: Định nghĩa kiểu dữ liệu `PostItem`, `ProfileItem`, `CrawlerCommand`, `ActionDescriptor`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/scrapers/social/mastodon/normalizer.js`:
  - Implement `resolveMastodonTarget(input, defaultInstance)`: parse `username` và `instance` từ handle `@user@host`, `user@host`, URL `https://host/@user` hoặc username đơn.
  - Implement `normalizeInstanceUrl(url)`: gắn scheme `https://` nếu thiếu, bỏ trailing slash.
  - Implement `toPlainText(html)`: xử lý tag `<br>`, `<p>`, `<a href="...">text</a>`, giải mã entities: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&apos;`, `&nbsp;`.
  - Implement `namespacedMastodonId(instance, id)`: trả về `mastodon:${cleanInstance}:${id}`.
  - Implement `normalizeMastodonAccount(account, instance) -> ProfileItem`: map fields id, username, acct, displayName, bio, avatar, followersCount, followingCount, statusesCount, url, và `metadata` JSONB.
  - Implement `normalizeMastodonStatus(status, instance) -> PostItem`: map id, author, content (plain text), publishedAt, mediaUrls, likesCount (`favourites_count`), repostsCount (`reblogs_count`), repliesCount, và `metadata` JSONB (`spoiler_text`, `sensitive`, `emojis`, `tags`).
  - Implement `parseLinkHeader(header)`: trích xuất `max_id` từ header `Link: <...?max_id=123>; rel="next"`.
- [ ] `src/scrapers/social/mastodon/client.js`:
  - Implement `MastodonClient extends AbstractApiClient`:
    - `name = 'mastodon'`, `platform = 'mastodon'`, `requiresAuth = false`.
    - Quản lý `defaultInstance` (default: `'https://mastodon.social'`) và `accessToken` optional.
    - Wire `MastodonPlatformResponseValidator` mặc định.
    - Implement các REST helper: `lookupAccount(acct, instance)`, `getAccount(id, instance)`, `getAccountStatuses(id, options)`, `getAccountFollowers(id, options)`, `getAccountFollowing(id, options)`, `search(options)`, `getHashtagTimeline(tag, options)`, `getTrendingStatuses(options)`.
    - Mọi request đều gọi qua `this.request(method, url, options)` để kế thừa proxy rotation, governor recording, và response validator.
- [ ] `src/scrapers/social/mastodon/crawler.js`:
  - Implement `MastodonCrawler extends AbstractCrawler`:
    - Constructor nhận dependency: `{ client, store, sessionManager, governor, accountPool, proxyPool, redisPublisher, requiresAuth }`.
    - Đăng ký 7 actions:
      1. `profile`: `{ username, instance? }` -> `ProfileItem`
      2. `followers`: `{ username, instance?, limit?, max_id? }` -> `{ profiles: ProfileItem[], pageInfo }`
      3. `following`: `{ username, instance?, limit?, max_id? }` -> `{ profiles: ProfileItem[], pageInfo }`
      4. `posts`: `{ username, instance?, limit?, max_id?, since_id? }` (alias `get_user_feed`) -> `PostItem[]`
      5. `search`: `{ query, instance?, type?, limit?, max_id? }` -> `{ posts, profiles, hashtags }`
      6. `hashtag`: `{ hashtag, instance?, limit?, max_id? }` -> `PostItem[]`
      7. `trending`: `{ instance?, limit? }` -> `PostItem[]`
    - Lưu vào `store` nếu có (`store.storeContent` / `store.storeBatch`).
    - Hỗ trợ callback `onProgress({ scraped, limit })`.
- [ ] `src/scrapers/social/mastodon/index.js`:
  - Barrel export: `MastodonClient`, `MastodonCrawler`, `MastodonPlatformResponseValidator`, `resolveMastodonTarget`, `toPlainText`, normalizers.
- [ ] Comprehensive Unit Tests:
  - `tests/scrapers/social/mastodon/normalizer.test.js`:
    - Test `resolveMastodonTarget` với các format handle, webfinger, URL, username đơn.
    - Test `toPlainText` giải mã sạch thẻ HTML và các loại entities.
    - Test `normalizeMastodonAccount` và `normalizeMastodonStatus` sinh ID namespaced và `metadata` chuẩn.
    - Test `parseLinkHeader` bóc tách `max_id`.
  - `tests/scrapers/social/mastodon/client.test.js`:
    - Test khởi tạo client, instance URL normalization, auth headers.
    - Test các method gọi REST API endpoints.
    - Test error mapping (429 -> `RateLimitError`, 401 -> `AuthSessionExpiredError`).
  - `tests/scrapers/social/mastodon/crawler.test.js`:
    - Test danh sách actions đã đăng ký (`listActions()`).
    - Test thực thi từng action qua mock client in-memory hoặc live.
    - Test tích hợp store và onProgress.

**Acceptance Criteria:**
- Given `MastodonCrawler`, when gọi `listActions()`, then trả về 7 actions đúng chuẩn snake_case: `profile`, `followers`, `following`, `posts`, `search`, `hashtag`, `trending`.
- Given input `@Gargron@mastodon.social` hoặc `https://mastodon.social/@Gargron`, when gọi action `profile`, then tự động phân giải instance `https://mastodon.social` và username `Gargron`, trả về `ProfileItem` có ID `mastodon:mastodon.social:<id>`.
- Given status content `<p>Hello &amp; welcome to Mastodon!<br>Enjoy your stay.</p>`, when normalize, then trả về plain text `Hello & welcome to Mastodon!\nEnjoy your stay.` mà không chứa thẻ HTML hoặc encoded entities.
- Given response có header `Link: <...max_id=98765>; rel="next"`, when lấy followers hoặc posts, then crawler trả về `pageInfo.next_max_id === '98765'` và `has_next_page === true`.
- Given API trả về HTTP 429 hoặc 401, then client & crawler ném đúng `RateLimitError` hoặc `AuthSessionExpiredError` kèm error envelope.
- Given bộ test suite `tests/scrapers/social/mastodon/`, when chạy `npx vitest run tests/scrapers/social/mastodon/`, then 100% tests pass.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/mastodon/`
- `npx vitest run tests/scrapers/social/mastodon/normalizer.test.js`
- `npx vitest run tests/scrapers/social/mastodon/client.test.js`
- `npx vitest run tests/scrapers/social/mastodon/crawler.test.js`
