---
story_id: '13.2.6'
epic: 13
story_key: '13-2-6-twitter-hybrid-content-composition-post-reply-quote'
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "b541ec78"
---

# Story 13.2.6 — Twitter Hybrid Content Composition (Post, Reply, Quote)

Status: ready-for-dev

## Story

As a **Twitter Content Operator**,  
I want **đăng tweet, reply, và quote nội dung qua `TwitterClient` kiến trúc hybrid**,  
so that **tôi có thể tự động hóa nội dung mà không cần browser**.

---

## Scope Note

Story 13.2.6 triển khai ba action viết (write) mới cho `TwitterCrawler`: `post`, `reply`, `quote`. Các action này sử dụng GraphQL mutation `CreateTweet` (queryId `SiM_cAu83R0wnrpmKQQSEw`) thông qua `TwitterClient.requestGraphQl`.

* `post` tạo tweet mới với text tùy chọn và media IDs.
* `reply` tạo phản hồi cho một tweet (dùng `replyTo`/`in_reply_to_tweet_id`).
* `quote` tạo quote-tweet (dùng `attachment_url` hoặc `quoteTweetId`).

Tất cả write action phải:
* Khai báo `requiresAuth: true`.
* Có `dryRun=true` mặc định (gate) để tránh ghi thật khi không chủ đích.
* Tuân thủ delay floor 3–7s giữa các lần gọi write.
* Đi qua `AdaptiveGovernor`, `AccountPool`, sticky proxy.
* Trả về `PlatformError` với `suggestedAction` phù hợp (`relogin`, `reduce_rate`, `hibernate_account`, `retry_after_delay`).
* Không log cookie/token.

Legacy functions `postTweet`, `postThread`, `postReply`, `sendTweet`, `sendQuoteTweet` trong `src/client/Scraper.js` và `src/scrapers/twitter/http/actions.js` phải được đánh dấu `@deprecated` và cập nhật `docs/deprecation-plan.md`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.6 [dòng 501-512]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-3 (proxy/auth mode), AD-11/AD-13 (governor), AD-14 (error envelope)
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2
- `_bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md` — `ProfileItem`, `PostItem`, `PlatformError`
- `_bmad-output/implementation-artifacts/13-2-4-twitter-hybrid-media-scraper.md` — `TwitterClient` convenience wrapper pattern
- `src/core/base-crawler.js` — `AbstractCrawler.registerAction`, `ActionDescriptor` [dòng 21-307]
- `src/core/base-client.js` — `AbstractApiClient` request pipeline, `raw`, retry [dòng 43-893]
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`
- `src/core/types.js` — `PostItem`, `ProfileItem`, `ActionDescriptor` [dòng 9-102]
- `src/scrapers/social/twitter/client.js` — `requestGraphQl`, `requestStream`, `TwitterClient` [dòng 22-558]
- `src/scrapers/social/twitter/crawler.js` — existing action registration pattern [dòng 180-289]
- `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator.isValidPayload`
- `src/scrapers/twitter/http/endpoints.js` — `GRAPHQL.CreateTweet` [dòng 107], `DEFAULT_FEATURES` [dòng 175-212], variable builder [dòng 520-529], `RATE_LIMITS` [dòng 248-288]
- `src/scrapers/twitter/http/actions.js` — legacy `postTweet`, `replyToTweet`, `quoteTweet` [dòng 86-254]
- `src/client/Scraper.js` — legacy `sendTweet`, `sendQuoteTweet`, `deleteTweet` [dòng 489-525]
- `src/client/api/tweets.js` — legacy `sendTweet`, `sendQuoteTweet` [dòng 267-347]
- `src/utils/gaussian-delay.js` — delay helper
- `docs/deprecation-plan.md` — Status tracker [dòng 79-97]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.1:** `PreSignedTokenRing`, `SignerWorkerPagePool` cho `x-client-transaction-id`.
- **Phụ thuộc Story 13.2, 13.2.1–13.2.5:** `TwitterClient`, `TwitterCrawler`, `PlatformError`, `TwitterPlatformResponseValidator`.
- **Phụ thuộc Epic 10.1/10.2:** `AbstractCrawler`, `AbstractApiClient`, `PrismaStore`.
- **Phụ thuộc Epic 11:** `ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool`.
- **Mở khóa Story 13.2.7** (scheduling) — sử dụng lại `post` mutation logic.
- **Mở khóa Story 13.2.8** (engagement) — tương tự write pattern với `FavoriteTweet`/`CreateRetweet`.
- **Mở khóa Story 13.2.12** (integration/caller migration).

---

## Acceptance Criteria

### AC-1: Đăng ký action `post`, `reply`, `quote`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký 3 action với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `post` | `['text']` | `['mediaIds', 'premium', 'sensitive', 'dryRun']` | `{ text: 'Hello XActions', mediaIds: ['123'], dryRun: false }` | `{ tweet: PostItem }` | `true` |
| `reply` | `['tweetId', 'text']` | `['mediaIds', 'premium', 'sensitive', 'dryRun']` | `{ tweetId: '1900000000000000000', text: 'Nice', dryRun: false }` | `{ tweet: PostItem }` | `true` |
| `quote` | `['tweetId', 'text']` | `['mediaIds', 'premium', 'sensitive', 'dryRun']` | `{ tweetId: '1900000000000000000', text: 'Agree', dryRun: false }` | `{ tweet: PostItem }` | `true` |

* **And** action names phải `snake_case` theo regex `/^[a-z0-9_]+$/`.
* **And** `tweetId` có thể là numeric ID hoặc URL `https://x.com/username/status/1900000000000000000`.
* **And** `dryRun` mặc định `true`; khi `dryRun=true` action phải validate input, build request variables, log "dry run" nhưng KHÔNG gửi request thực.
* **And** `listActions()` trả về đầy đủ action mới với `requiresAuth: true`.

### AC-2: `post` handler — tạo tweet mới

* **Given** action `post` đã đăng ký
* **When** gọi `crawler.start({ action: 'post', args: { text: 'Hello XActions', mediaIds: ['123'], dryRun: false } })`
* **Then** handler validate `text` non-empty và độ dài `≤ 280` (hoặc `≤ 25000` nếu `premium: true`)
* **And** gọi GraphQL `CreateTweet` [queryId: `SiM_cAu83R0wnrpmKQQSEw`][src/scrapers/twitter/http/endpoints.js dòng 107] với variables:
  ```js
  {
    tweet_text: text,
    dark_request: false,
    media: {
      media_entities: mediaIds.map(id => ({ media_id: id, tagged_users: [] })),
      possibly_sensitive: false,
    },
    semantic_annotation_ids: [],
  }
  ```
* **And** sử dụng `DEFAULT_FEATURES`, `DEFAULT_FIELD_TOGGLES` từ `endpoints.js`
* **And** parse response `create_tweet.tweet_results.result` thành `PostItem` với `id: twitter:${rest_id}`, `category: 'social'`, `metadata.sourceMethod: 'post'`, `metadata.tweetId`, `metadata.createdAt`
* **And** nếu `dryRun=true` thì trả về mock `PostItem` với `metadata.dryRun: true` và KHÔNG gọi API

### AC-3: `reply` handler — phản hồi tweet

* **Given** action `reply` đã đăng ký
* **When** gọi `crawler.start({ action: 'reply', args: { tweetId: '1900000000000000000', text: 'Nice' } })`
* **Then** resolve `tweetId` từ URL hoặc numeric ID
* **And** gọi `CreateTweet` với thêm `reply: { in_reply_to_tweet_id: tweetId, exclude_reply_user_ids: [] }`
* **And** trả về `PostItem` với `metadata.replyToTweetId: tweetId`, `metadata.sourceMethod: 'reply'`

### AC-4: `quote` handler — quote tweet

* **Given** action `quote` đã đăng ký
* **When** gọi `crawler.start({ action: 'quote', args: { tweetId: '1900000000000000000', text: 'Agree' } })`
* **Then** resolve `tweetId` từ URL hoặc numeric ID
* **And** gọi `CreateTweet` với `attachment_url: https://x.com/i/status/${tweetId}`
* **And** trả về `PostItem` với `metadata.quotedTweetId: tweetId`, `metadata.sourceMethod: 'quote'`

### AC-5: Write safety — delay floor và governor

* **Given** action write đã gọi
* **When** gọi liên tiếp nhiều lần
* **Then** mỗi lần gọi `post`/`reply`/`quote` (ngoài dry-run) phải delay tối thiểu 3s, tối đa 7s giữa các lần gọi thực
* **And** kiểm tra `governor.canAccountRequest(accountId, 'twitter')` trước khi request
* **And** sử dụng sticky proxy gắn với `accountId`
* **And** nếu governor từ chối, throw `PlatformError` với `code: XACT_4291`, `suggestedAction: 'rotate_account'`

### AC-6: Error handling

* **Given** request bị lỗi
* **When** Twitter trả về 401/403/429/500
* **Then** throw `PlatformError` với:
  - 401 → `code: XACT_4010`, `suggestedAction: 'relogin'`
  - 403 (bot challenge) → `code: XACT_4030`, `suggestedAction: 'rotate_proxy'`
  - 429 → `code: XACT_4290`, `suggestedAction: 'rotate_account'` hoặc `retry_after_delay`
  - 5xx → `code: XACT_5030`, `suggestedAction: 'retry_after_delay'`
* **And** log KHÔNG bao gồm cookie, token, hoặc `authorization` header
* **And** write action phải kiểm tra `governor.canAccountRequest(accountId, 'twitter')` trước khi gửi; nếu từ chối throw `PlatformError` với `code: XACT_4291`, `suggestedAction: 'rotate_account'`

### AC-7: Deprecation markers

* **Given** legacy functions cũ trong `src/client/Scraper.js` và `src/scrapers/twitter/http/actions.js`
* **When** triển khai xong Story 13.2.6
* **Then** thêm JSDoc `@deprecated` trước `sendTweet`, `sendQuoteTweet`, `sendReply` (hoặc tương đương) trong `src/client/Scraper.js`
* **And** thêm `@deprecated` trước `postTweet`, `postThread`, `replyToTweet`, `quoteTweet`, `schedulePost` trong `src/scrapers/twitter/http/actions.js`
* **And** cập nhật `docs/deprecation-plan.md` để thêm mapping:
  - `sendTweet` / `postTweet` → `TwitterCrawler.start({ action: 'post' })`
  - `sendQuoteTweet` / `quoteTweet` → `TwitterCrawler.start({ action: 'quote' })`
  - `postThread` → chuỗi `post` hoặc `reply` tùy use-case
  - `replyToTweet` / `sendReply` → `TwitterCrawler.start({ action: 'reply' })`

### AC-8: Tests

* **Given** Vitest test suite
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-content-composition.test.js`
* **Then** pass tất cả test sau:
  - `post`, `reply`, `quote` được đăng ký với đúng descriptor
  - `post` validate text và gọi `CreateTweet` với đúng variables
  - `post` dry-run trả về `PostItem` với `metadata.dryRun: true` mà không gọi API
  - `reply` parse `tweetId` từ URL và thêm `reply` object
  - `quote` parse `tweetId` từ URL và thêm `attachment_url`
  - delay floor 3–7s giữa các lần gọi write (có thể test bằng elapsed time hoặc spy)
  - governor từ chối trả `XACT_4291`
  - legacy functions có `@deprecated` tag

---

## Dev Notes / Implementation Hints

### CreateTweet mutation

* `CreateTweet` là mutation GraphQL, method mặc định `POST`.
* `requestGraphQl` trong `TwitterClient` hỗ trợ cả `POST` (mặc định) và `GET` qua `options.method`.
* Với mutation, cần đảm bảo `options.requiresAuth: true` để `base-client` gửi `x-client-transaction-id` và cookies.
* Variables builder ở `endpoints.js` dòng 520-529 trả về shape chuẩn cho `CreateTweet`. Có thể dùng trực tiếp hoặc xây dựng variables trong handler.

### Response parsing

* Hàm `parseTweetResult` trong `src/scrapers/twitter/http/actions.js` dòng 72-80 là tham khảo tốt:
  ```js
  json?.data?.create_tweet?.tweet_results?.result ??
  json?.data?.create_tweet?.tweet_result?.result ??
  json?.data?.create_tweet ?? json
  ```
* Từ `result`, trích `rest_id`, `legacy` để build `PostItem`.

### Dry-run gate

* Mẫu từ Story 13.9 (Facebook social actions): nếu `args.dryRun !== false`, trả về preview object thay vì thực thi.
* Log dạng `🔄 [DRY RUN] post: { text, mediaIds }` — KHÔNG log cookies/tokens.
* Với `dryRun=false` mới gọi `requestGraphQl`.

### Delay floor

* Dùng helper `#sleep(ms)` trong `TwitterCrawler` hoặc import từ `src/utils/delay.js` nếu có.
* Mẫu:
  ```js
  const delayMs = 3000 + Math.floor(Math.random() * 4000); // 3-7s
  await this.#sleep(delayMs);
  ```
* Chỉ delay trước/lưu request thực, bỏ qua dry-run.

### Text validation

* `text` phải là non-empty string.
* Giới hạn 280 ký tự mặc định; `premium: true` cho phép 25,000.
* Có thể tái sử dụng hàm `validateTweetText` trong `src/scrapers/twitter/http/actions.js` hoặc viết lại trong `TwitterCrawler`.

### Tweet ID resolution

* `resolveTweetId` đã tồn tại trong `client.js` dòng 145-172; tái sử dụng.
* Cho phép cả numeric ID và URL `https://x.com/username/status/123`.

### Shared Patterns

* Tuân thủ pattern từ 13.2.5: tách logic response parsing ra `normalize-content.js` nếu cần, hoặc giữ inline trong `crawler.js` nếu đơn giản.
* `ActionDescriptor` phải có `requiresAuth` phân giải đúng theo AD-11 rule 3.
* Sử dụng `DEFAULT_FEATURES` + `DEFAULT_FIELD_TOGGLES` cho GraphQL.

---

## Open Questions / TBD

1. **Thread support:** Giữ ngoài scope Story 13.2.6; thread có thể thực hiện bằng cách gọi nhiều `post`/`reply` liên tiếp từ caller. Nếu cần, tạo action `thread` trong Story 13.2.7 hoặc 13.2.11.
2. **Media upload:** `mediaIds` giả định đã upload trước qua media uploader hoặc action `media` (Story 13.2.4). Không tích hợp upload mới trong Story 13.2.6.
3. **Quote URL format:** Dùng `https://x.com/i/status/${tweetId}` để nhất quán với `src/client/api/tweets.js`.
4. **Sensitive/premium flags:** Hỗ trợ tùy chọn `sensitive` (boolean, mặc định false) và `premium` (boolean, mặc định false) trong `optionalArgs` cho cả `post`/`reply`/`quote`.

---

## Deprecation Mapping

| Legacy Function | File | Replacement |
|---|---|---|
| `postTweet(client, text, options)` | `src/scrapers/twitter/http/actions.js:100` | `TwitterCrawler.start({ action: 'post', args: { text, mediaIds, dryRun: false } })` |
| `postThread(client, tweets, options)` | `src/scrapers/twitter/http/actions.js:154` | Chuỗi `post`/`reply` qua `TwitterCrawler.start` |
| `replyToTweet(client, tweetId, text, options)` | `src/scrapers/twitter/http/actions.js:231` | `TwitterCrawler.start({ action: 'reply', args: { tweetId, text, dryRun: false } })` |
| `quoteTweet(client, tweetId, text, options)` | `src/scrapers/twitter/http/actions.js:249` | `TwitterCrawler.start({ action: 'quote', args: { tweetId, text, dryRun: false } })` |
| `schedulePost(client, text, scheduledAt, options)` | `src/scrapers/twitter/http/actions.js:267` | Story 13.2.7: `TwitterCrawler.start({ action: 'schedule', ... })` |
| `sendTweet(http, text, options)` | `src/client/api/tweets.js:267` | `TwitterCrawler.start({ action: 'post', ... })` |
| `sendQuoteTweet(http, text, quotedTweetId, mediaIds)` | `src/client/api/tweets.js:316` | `TwitterCrawler.start({ action: 'quote', ... })` |
| `Scraper.sendTweet(text, options)` | `src/client/Scraper.js:495` | `TwitterCrawler.start({ action: 'post', ... })` |
| `Scraper.sendQuoteTweet(text, quotedTweetId, mediaIds)` | `src/client/Scraper.js:509` | `TwitterCrawler.start({ action: 'quote', ... })` |

---

## Dev Agent Record

### Implementation Plan

(TBD — to be filled during dev-story)

### Completion Notes

(TBD — to be filled during dev-story)
