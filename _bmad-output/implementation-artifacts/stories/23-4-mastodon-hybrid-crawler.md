---
title: 'Story 23.4: Mastodon Hybrid Crawler'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 1
baseline_commit: '4d63f213bfa7a7b8e1f0e21a8a3a0e6e768165b6'
context:
  - _bmad-output/implementation-artifacts/epic-23-context.md
  - _bmad-output/implementation-artifacts/stories/23-2-bluesky-hybrid-crawler.md
  - src/scrapers/social/mastodon/validator.js
  - src/scrapers/mastodon/index.js
  - src/core/base-client.js
  - src/core/base-crawler.js
  - src/core/types.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions hiện có module Mastodon cũ (`src/scrapers/mastodon/index.js`) sử dụng `fetch` trực tiếp, không tích hợp `AbstractApiClient`, không qua `ProxyIpPool`, không có `AdaptiveRateGovernor` rate limiting, và không dùng `ActionRegistry`/`CrawlerCommand` chuẩn của Universal Scraping Engine. Story 23.3 đã được đánh dấu `done` nhưng thực tế **chỉ tạo ra client wrapper cũ trong `src/scrapers/mastodon/index.js`**, chứ chưa có `MastodonClient extends AbstractApiClient` chuẩn trong `src/scrapers/social/mastodon/`. Dù validator (`MastodonPlatformResponseValidator`) đã hoàn thành ở Story 23.5, hệ thống vẫn thiếu client/crawler hybrid chuẩn.

**Scope Note:** Story 23.4 hấp thụ phần còn thiếu của Story 23.3 — triển khai `MastodonClient` kế thừa `AbstractApiClient` trong `src/scrapers/social/mastodon/client.js`. Đây là công việc nội bộ cần thiết để hoàn thiện Epic 23, không tạo ra duplicate vì `src/scrapers/mastodon/index.js` vẫn là legacy wrapper cũ.

**Approach:**
1. Xây dựng `resolveMastodonTarget(input, defaultInstance)` và `normalizer.js` trong `src/scrapers/social/mastodon/normalizer.js`:
   - Phân giải linh hoạt mọi định dạng handle (`@user@instance`, `user@instance`), URL web (`https://instance/@user`), hoặc raw username.
   - Chuẩn hóa Account, Status, Search, Tag thành `ProfileItem` và `PostItem` với ID namespaced `mastodon:${instance}:${id}`.
   - Triển khai `toPlainText(html)` loại bỏ triệt để HTML tags và giải mã đầy đủ entities (`&amp;`, `&quot;`, `&#39;`, `&apos;`, `&lt;`, `&gt;`, `&nbsp;`).
   - Giữ nguyên metadata hữu ích vào `metadata` JSONB (`instance`, `acct`, `emojis`, `spoiler_text`, `sensitive`, `reblogs_count`, `favourites_count`, `tags`).
2. Xây dựng `MastodonClient` kế thừa `AbstractApiClient` trong `src/scrapers/social/mastodon/client.js`:
   - Kết nối Mastodon REST API qua pipeline proxy rotation, exponential backoff, governor recording.
   - **Bắt buộc** gán `this.responseValidator = options.responseValidator || new MastodonPlatformResponseValidator()` trong constructor.
   - **Bắt buộc** set `this.requiresAuth = false` và `this.requiresProxy = false` mặc định, vì Mastodon là public REST API.
   - Hỗ trợ phân trang qua `max_id` / `since_id` và trích xuất `Link` header.
3. Xây dựng `MastodonCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/social/mastodon/crawler.js`:
   - Đăng ký đầy đủ 7 action chuẩn snake_case: `profile`, `followers`, `following`, `posts` (alias `get_user_feed`), `search`, `hashtag`, `trending`.
   - Quản lý pipeline command, hỗ trợ lưu `store` (`PrismaStore`) và callback `onProgress`.
   - Mỗi action handler tự gọi `await this.client.init(session)` nếu có `accessToken` hoặc credentials (mẫu từ `BlueskyCrawler.#maybeAuthenticate`).
4. Tạo barrel file `src/scrapers/social/mastodon/index.js` export `MastodonClient`, `MastodonCrawler`, `normalizer`, `validator`.
5. Xây dựng bộ unit tests không mock (`client.test.js`, `crawler.test.js`, `normalizer.test.js`) đạt độ phủ toàn bộ scenario và edge case.

## Boundaries & Constraints

**Always:**
- Đặt code mới tại `src/scrapers/social/mastodon/`.
- Kế thừa trực tiếp `AbstractApiClient` (`src/core/base-client.js`) và `AbstractCrawler` (`src/core/base-crawler.js`).
- Sử dụng `MastodonPlatformResponseValidator` từ `src/scrapers/social/mastodon/validator.js` làm responseValidator mặc định.
- **Trong `MastodonClient` constructor, gán `this.responseValidator = options.responseValidator || new MastodonPlatformResponseValidator()` trước khi gọi `super()` hoặc trong `super({ ... })`.**
- **Trong `MastodonClient` constructor, set `requiresAuth: false` và `requiresProxy: false` mặc định, tránh kế thừa default `requiresAuth = true` của `AbstractApiClient`.**
- Tên actions trong `ActionRegistry` phải đúng chuẩn snake_case: `profile`, `followers`, `following`, `posts` (alias `get_user_feed`), `search`, `hashtag`, `trending`.
- ID chuẩn hóa phải namespaced: `mastodon:${instance}:${id}` (ví dụ `mastodon:mastodon.social:112345678`).
- Instance mặc định là `https://mastodon.social`, cho phép override linh hoạt qua `args.instance`, `options.instance`, hoặc phân giải từ handle/URL.
- Instance URL luôn được chuẩn hóa: có scheme `https://`, loại bỏ trailing slash `/`.
- Trích xuất plain text sạch bằng `toPlainText(html)` cho cả bio (`ProfileItem.bio`) và status content (`PostItem.content`).
- Khai báo `requiresAuth: false` cho tất cả public actions; hỗ trợ `accessToken` tùy chọn cho private/authorized instances.
- Phân trang hỗ trợ cả `max_id` param và parse `Link` header để trả về `pageInfo: { next_max_id, has_next_page }`.
- Dùng `CATEGORIES` từ `src/core/types.js` cho `PostItem.category` (`CATEGORIES.POST`, `CATEGORIES.PROFILE`, `CATEGORIES.TRENDING`, `CATEGORIES.HASHTAG`, ...).
- Không dùng mocks trong unit tests; dùng real dependencies hoặc in-memory handlers theo chuẩn repo.

**Ask First:**
- Nếu cần sửa đổi `src/scrapers/index.js` (việc này thuộc Story 23.6 - Migration & Caller Integration).
- Nếu cần can thiệp dashboard UI.

**Never:**
- Không sửa file `src/scrapers/social/mastodon/validator.js` đã hoàn thành và verified ở Story 23.5.
- Không dùng Puppeteer hoặc browser engine (Mastodon là 100% HTTP REST API).
- Không thêm dependency npm mới; sử dụng `undici`/`fetch` sẵn có trong core client.
- Không để `MastodonClient` kế thừa `requiresAuth = true` mặc định của `AbstractApiClient`; phải override thành `false`.

## Common Pitfalls for Dev Agent

- `AbstractApiClient` mặc định `requiresAuth = true`. Nếu không override trong `MastodonClient`, mọi request public sẽ throw `XACT_4010`.
- `this.responseValidator` mặc định là `null` trong `AbstractApiClient`. Nếu không gán `MastodonPlatformResponseValidator`, `base-client.js` sẽ bỏ qua validation hoàn toàn.
- Mastodon `search` endpoint (`/api/v2/search`) trả về object `{ accounts: [...], statuses: [...], hashtags: [...] }`, không phải array trực tiếp. Phải normalize 3 mảng con.
- Mastodon `trending` endpoint trả về array statuses, nhưng một số instance (ví dụ `mastodon.social`) có thể trả 403 hoặc 404 nếu không bật public trends. Phải fallback graceful sang `[]`.
- `id` field của Mastodon là `string` (numeric string). `namespacedMastodonId` phải `String(id)` trước khi nối chuỗi.

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
| Trending Statuses | `trending({ limit: 10 })` | Mảng `PostItem[]` trending statuses | Instance không hỗ trợ public trends -> `[]` graceful |
| Rate Limit HTTP 429 | Bất kỳ request nào nhận 429 | Ném `RateLimitError`, trigger proxy quarantine | Validator phát hiện và ném `RateLimitError` |
| Auth Expired HTTP 401 | Truy cập endpoint cần auth với token hỏng | Ném `AuthSessionExpiredError` với `suggestedAction: 'relogin'` | Validator nhận diện `invalid_token` |

</frozen-approval>

## Code Map

- `src/core/base-client.js`: `AbstractApiClient` lớp cha quản lý request pipeline, proxy rotation, governor recording.
- `src/core/base-crawler.js`: `AbstractCrawler` lớp cha quản lý `ActionRegistry`, validation `CrawlerCommand`.
- `src/core/types.js`: Định nghĩa `ProfileItem`, `PostItem`, `CrawlerCommand`, `ActionDescriptor`, `CATEGORIES`.
- `src/scrapers/social/mastodon/validator.js`: `MastodonPlatformResponseValidator` kiểm tra payload hợp lệ, 429, 401, 403.
- `src/scrapers/social/bluesky/`: Mẫu tham khảo hoàn chỉnh (Story 23.2) gồm `client.js`, `crawler.js`, `normalizer.js`, `index.js`.
- `src/scrapers/mastodon/index.js`: Legacy scraper, chứa endpoints REST API tham khảo:
  - Account lookup: `GET /api/v1/accounts/lookup?acct=:acct`
  - Account statuses: `GET /api/v1/accounts/:id/statuses?limit=:limit&max_id=:max_id`
  - Followers: `GET /api/v1/accounts/:id/followers?limit=:limit&max_id=:max_id`
  - Following: `GET /api/v1/accounts/:id/following?limit=:limit&max_id=:max_id`
  - Search: `GET /api/v2/search?q=:q&type=:type&resolve=true`
  - Hashtag: `GET /api/v1/timelines/tag/:tag`
  - Trending statuses: `GET /api/v1/trends/statuses?limit=:limit`

## Tasks & Acceptance

### 1. `src/scrapers/social/mastodon/normalizer.js`

- [ ] Implement `resolveMastodonTarget(input, defaultInstance)`: parse `username` và `instance` từ handle `@user@host`, `user@host`, URL `https://host/@user` hoặc username đơn.
- [ ] Implement `normalizeInstanceUrl(url)`: gắn scheme `https://` nếu thiếu, bỏ trailing slash.
- [ ] Implement `toPlainText(html)`: xử lý tag `<br>`, `<p>`, `<a>`, giải mã entities: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&apos;`, `&nbsp;`.
- [ ] Implement `namespacedMastodonId(instance, id)`: trả về `mastodon:${cleanInstance}:${id}`.
- [ ] Implement `normalizeMastodonAccount(account, instance) -> ProfileItem`:
  - Map fields: `id`, `username` (acct), `name` (display_name), `bio` (note sau `toPlainText`), `avatar`, `profileUrl` (url), `followersCount`, `followingCount`, `postsCount` (statuses_count).
  - `metadata` JSONB: `instance`, `acct`, `bot`, `locked`, `group`, `discoverable`, `created_at`, `fields`, `emojis`.
- [ ] Implement `normalizeMastodonStatus(status, instance) -> PostItem`:
  - Map fields: `id`, `platform`, `externalId`, `category = CATEGORIES.POST`, `authorId` (`account.id`), `authorName` (`account.display_name`), `authorAvatar`, `authorUrl` (`account.url`), `postUrl` (`url`), `content` (sau `toPlainText`), `mediaUrls` (`media_attachments[].url`), `likesCount` (`favourites_count`), `repostsCount` (`reblogs_count`), `repliesCount`, `publishedAt` (`created_at`), `crawledAt`.
  - `metadata` JSONB: `instance`, `acct`, `spoiler_text`, `sensitive`, `emojis`, `tags`, `visibility`, `language`, `reblog`.
- [ ] Implement `normalizeMastodonTag(tag, instance) -> PostItem` cho trending hashtags.
- [ ] Implement `parseLinkHeader(header)`: trích xuất `max_id` từ header `Link: <...?max_id=123>; rel="next"`.

### 2. `src/scrapers/social/mastodon/client.js`

- [ ] Implement `MastodonClient extends AbstractApiClient`:
  - `name = 'mastodon'`, `platform = 'mastodon'`.
  - Constructor nhận `{ baseUrl, service, instance, accessToken, responseValidator, proxyPool, accountPool, governor, sessionManager, requiresAuth, requiresProxy, timeout }`.
  - **Bắt buộc**: `super({ ...options, platform: 'mastodon', responseValidator: options.responseValidator || new MastodonPlatformResponseValidator(), requiresAuth: options.requiresAuth ?? false, requiresProxy: options.requiresProxy ?? false })`.
  - `this.baseUrl = normalizeInstanceUrl(options.baseUrl || options.service || options.instance || 'https://mastodon.social')`.
  - `this.accessToken = options.accessToken || null`.
  - Implement `sign()` no-op (Mastodon không cần crypto signing), return `{}`.
  - Implement `init(session)` nếu `session.accessToken` tồn tại thì gán `this.accessToken`.
  - Implement helper `buildUrl(path, params)` tạo query string với `URLSearchParams`.
  - Implement REST helper, **tất cả đều gọi `this.request('GET', url, { headers, skipResponseValidation: false })`**:
    - `lookupAccount(acct, instance?)`
    - `getAccount(id, instance?)`
    - `getAccountStatuses(id, options)`
    - `getAccountFollowers(id, options)`
    - `getAccountFollowing(id, options)`
    - `search(options)` — returns `{ accounts, statuses, hashtags }`
    - `getHashtagTimeline(tag, options)`
    - `getTrendingStatuses(options)`
  - Mọi request kế thừa proxy rotation, governor recording, và response validator.

### 3. `src/scrapers/social/mastodon/crawler.js`

- [ ] Implement `MastodonCrawler extends AbstractCrawler`:
  - Constructor nhận dependency: `{ client, store, sessionManager, governor, accountPool, proxyPool, redisPublisher, requiresAuth }`.
  - **Bắt buộc**: `super({ ...deps, client, requiresAuth: deps.requiresAuth ?? false })`.
  - Đăng ký 7 actions:
    1. `profile`: `{ username, instance? }` -> `ProfileItem`
    2. `followers`: `{ username, instance?, limit?, max_id? }` -> `{ profiles: ProfileItem[], pageInfo }`
    3. `following`: `{ username, instance?, limit?, max_id? }` -> `{ profiles: ProfileItem[], pageInfo }`
    4. `posts`: `{ username, instance?, limit?, max_id?, since_id? }` (alias `get_user_feed`) -> `PostItem[]`
    5. `search`: `{ query, instance?, type?, limit?, max_id? }` -> `{ posts, profiles, hashtags }`
    6. `hashtag`: `{ hashtag, instance?, limit?, max_id? }` -> `PostItem[]`
    7. `trending`: `{ instance?, limit? }` -> `PostItem[]`
  - Mỗi action handler tự gọi `await this.client.init(session)` nếu `session?.accessToken` tồn tại.
  - Lưu kết quả vào `store` nếu có (`store.storeContent` / `store.storeBatch`).
  - Hỗ trợ callback `onProgress({ scraped, limit })`.

### 4. `src/scrapers/social/mastodon/index.js`

- [ ] Barrel export: `MastodonClient`, `MastodonCrawler`, `MastodonPlatformResponseValidator`, `resolveMastodonTarget`, `toPlainText`, normalizers.

### 5. Comprehensive Unit Tests

- [ ] `tests/scrapers/social/mastodon/normalizer.test.js`:
  - Test `resolveMastodonTarget` với handle, webfinger, URL, username đơn.
  - Test `toPlainText` giải mã sạch thẻ HTML và entities.
  - Test `normalizeMastodonAccount` / `normalizeMastodonStatus` sinh ID namespaced và `metadata` chuẩn.
  - Test `parseLinkHeader` bóc tách `max_id`.
- [ ] `tests/scrapers/social/mastodon/client.test.js`:
  - Test `MastodonClient` constructor: `requiresAuth=false`, `requiresProxy=false`, `responseValidator` được gán.
  - Test instance URL normalization, auth headers.
  - Test REST helper endpoints và query params.
  - Test error mapping (429 -> `RateLimitError`, 401 -> `AuthSessionExpiredError`).
- [ ] `tests/scrapers/social/mastodon/crawler.test.js`:
  - Test danh sách actions đã đăng ký (`listActions()`).
  - Test thực thi từng action qua in-memory client hoặc live.
  - Test tích hợp store và onProgress.

**Acceptance Criteria:**
- Given `MastodonClient` khởi tạo, then `requiresAuth === false`, `requiresProxy === false`, và `responseValidator` là instance của `MastodonPlatformResponseValidator`.
- Given `MastodonCrawler`, when gọi `listActions()`, then trả về 7 actions đúng chuẩn snake_case: `profile`, `followers`, `following`, `posts`, `search`, `hashtag`, `trending`.
- Given input `@Gargron@mastodon.social` hoặc `https://mastodon.social/@Gargron`, when gọi action `profile`, then tự động phân giải instance `https://mastodon.social` và username `Gargron`, trả về `ProfileItem` có ID `mastodon:mastodon.social:<id>`.
- Given status content `<p>Hello &amp; welcome to Mastodon!<br>Enjoy your stay.</p>`, when normalize, then trả về plain text `Hello & welcome to Mastodon!\nEnjoy your stay.` mà không chứa thẻ HTML hoặc encoded entities.
- Given response có header `Link: <...max_id=98765>; rel="next"`, when lấy followers hoặc posts, then crawler trả về `pageInfo.next_max_id === '98765'` và `has_next_page === true`.
- Given API trả về HTTP 429 hoặc 401, then client & crawler ném đúng `RateLimitError` hoặc `AuthSessionExpiredError` kèm error envelope.
- Given `PostItem` từ Mastodon, when lưu store, then `category` là giá trị hợp lệ từ `CATEGORIES` (`post`, `profile`, `trending`, `hashtag`).
- Given bộ test suite `tests/scrapers/social/mastodon/`, when chạy `npx vitest run tests/scrapers/social/mastodon/`, then 100% tests pass.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/mastodon/`
- `npx vitest run tests/scrapers/social/mastodon/normalizer.test.js`
- `npx vitest run tests/scrapers/social/mastodon/client.test.js`
- `npx vitest run tests/scrapers/social/mastodon/crawler.test.js`

**Dry-run smoke command (sau khi implement):**
- `node -e "import('./src/scrapers/social/mastodon/index.js').then(m => console.log(Object.keys(m)))"`
