---
story_id: '13.2.8'
epic: 13
story_key: '13-2-8-twitter-hybrid-engagement-like-retweet'
status: "done"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "approved"
baseline_commit: "b7c667761906a1833e8ecd82ce65fa0c80243bb6"
---

# Story 13.2.8 — Twitter Hybrid Engagement (Like & Retweet)

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-08-30  
**Summary:**
- 4 actions engagement (`like`, `unlike`, `retweet`, `undo_retweet`) được triển khai đúng chuẩn `AbstractCrawler` và `ActionDescriptor`.
- Tích hợp write safety đầy đủ: Gaussian delay floor (1–3s), `dryRun=true` mặc định, rate governor check `canAccountRequest`.
- Cơ chế xử lý idempotent errors hoàn chỉnh cho cả mutations yêu cầu.
- Gắn `@deprecated` annotations đầy đủ cho toàn bộ legacy functions trong `src/client/Scraper.js`, `src/client/api/tweets.js`, `src/scrapers/twitter/http/engagement.js`.
- Test suite đạt độ bao phủ 13/13 tests pass, không gây regression (89/89 tests pass).

#### Action Items (Resolved)
- [x] [Review][Patch] Đảm bảo action names tuân thủ snake_case (`undo_retweet`).
- [x] [Review][Patch] Mở rộng validator nhận diện mutation responses và GraphQL errors.

## Story

As a **Twitter Growth Operator**,  
I want **thực hiện like, retweet, undoRetweet, và unlike qua `TwitterClient` kiến trúc hybrid**,  
so that **tôi có thể tự động hóa tương tác cơ bản với nội dung theo chiến lược growth**.

---

## Scope Note

Story 13.2.8 triển khai bốn action engagement mới cho `TwitterCrawler`: `like`, `unlike`, `retweet`, `undo_retweet`. Các action này sử dụng các GraphQL mutations:

- `like` → `FavoriteTweet` (queryId `lI07N6Otwv1PhnEgXILM7A`)
- `unlike` → `UnfavoriteTweet` (queryId `ZYKSe-w7KEslx3JhSIk5LA`)
- `retweet` → `CreateRetweet` (queryId `ojPdsZsimiJrUGLR1sjUtA`)
- `undoRetweet` → `DeleteRetweet` (queryId `iQtK4dl5hBmXewYZuEOKVw`)

Input chính: `tweetId` (bắt buộc), có thể là numeric ID hoặc URL `https://x.com/username/status/1900000000000000000`. Tùy chọn `dryRun` (mặc định `true`).

Tất cả engagement action phải:
- Khai báo `requiresAuth: true`.
- Có `dryRun=true` mặc định (gate) để tránh ghi thật khi không chủ đích.
- Tuân thủ delay floor **1–3s** giữa các lần gọi engagement.
- Đi qua `AdaptiveGovernor`, `AccountPool`, sticky proxy.
- Trả về `{ success: boolean }` hoặc `PostItem` với `metadata.sourceMethod` tương ứng.
- Trả về `PlatformError` với `suggestedAction` phù hợp (`relogin`, `rotate_account`, `retry_after_delay`).
- Không log cookie/token.
- Xử lý idempotent: nếu Twitter trả lỗi "already favorited" / "already retweeted" / "not found in list of retweets" thì coi như `success: true`.

Legacy functions `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong `src/client/Scraper.js`, `src/client/api/tweets.js`, và `src/scrapers/twitter/http/engagement.js` phải được đánh dấu `@deprecated` và cập nhật `docs/deprecation-plan.md`.

`src/scrapers/social/twitter/` đã tồn tại sau Story 13.2.7, nên dev chỉ cần thêm action mới, deprecation markers, và tests.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.8 [dòng 527-537]
- `_bmad-output/planning-artifacts/prd.md` — FR-71, NFR-11/12/13/16 [dòng 79, 114-120]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-3 [dòng 142-163], AD-11 [dòng 233-243], AD-13 [dòng 250-260], AD-14 [dòng 272-283]
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2
- `_bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md` — `ProfileItem`, `PostItem`, `PlatformError`
- `_bmad-output/implementation-artifacts/13-2-6-twitter-hybrid-content-composition-post-reply-quote.md` — write pattern, dry-run gate, delay floor, telemetry, validation
- `_bmad-output/implementation-artifacts/13-2-7-twitter-hybrid-content-scheduling.md` — mutation handler pattern với `gaussianDelay` và `requestGraphQl`
- `src/core/base-crawler.js` — `AbstractCrawler.registerAction`, `ActionDescriptor` [dòng 21-307]
- `src/core/base-client.js` — `AbstractApiClient` request pipeline, 429/403 interceptor [dòng 43-893]
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`
- `src/core/types.js` — `PostItem`, `ActionDescriptor` [dòng 9-102]
- `src/scrapers/social/twitter/client.js` — `requestGraphQl`, `resolveTweetId`, `resolveUsername`, `parseTwitterCookies` [dòng 22-558]
- `src/scrapers/social/twitter/crawler.js` — existing actions, `composeContent` / `schedule` pattern [dòng 293-328, 2070-2550]
- `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator` [dòng 1-180]
- `src/scrapers/social/twitter/index.js` — barrel exports, `scrapeTwitter`
- `src/scrapers/twitter/http/endpoints.js` — `GRAPHQL` object (`FavoriteTweet`, `UnfavoriteTweet`, `CreateRetweet`, `DeleteRetweet`) [dòng 111-113], `DEFAULT_FEATURES` [dòng 175-212]
- `src/scrapers/twitter/http/engagement.js` — legacy `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` [dòng 180-216]
- `src/scrapers/twitter/http/index.js` — export engagement functions [dòng 29]
- `src/client/Scraper.js` — legacy `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` [dòng 530-576]
- `src/client/api/tweets.js` — legacy `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` [dòng 370-441]
- `src/utils/gaussian-delay.js` — delay helper
- `docs/deprecation-plan.md` — Status tracker [dòng 79-97], legacy-to-hybrid mapping [dòng 98-127]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2.6/13.2.7:** `TwitterCrawler` action pattern, `requestGraphQl`, `DEFAULT_FEATURES`, `DEFAULT_FIELD_TOGGLES`, telemetry pattern.
- **Phụ thuộc Story 13.2, 13.2.1–13.2.5:** `TwitterClient`, `TwitterCrawler`, `PlatformError`, `TwitterPlatformResponseValidator`, `PrismaStore`.
- **Phụ thuộc Epic 10.1/10.2:** `AbstractCrawler`, `AbstractApiClient`, `PrismaStore`.
- **Phụ thuộc Epic 11:** `ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool`.
- **Phụ thuộc Story 13.1:** `PreSignedTokenRing`, `SignerWorkerPagePool`.
- **Mở khóa Story 13.2.9** (social graph) — mở rộng REST mutations cho `follow`, `block`, `mute`, `bookmark`.
- **Mở khóa Story 13.2.12** (integration/caller migration).

---

## Acceptance Criteria

### AC-1: Đăng ký action `like`, `unlike`, `retweet`, `undoRetweet` trong `TwitterCrawler`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký 4 action với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth | category |
|---|---|---|---|---|---|---|
| `like` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `unlike` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `retweet` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `undo_retweet` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` | `social` |

* **And** action names phải `snake_case` theo regex `/^[a-z0-9_]+$/` — vì vậy action undo phải là `undo_retweet`, không phải `undoRetweet`.
* **And** `tweetId` có thể là numeric ID hoặc URL `https://x.com/username/status/1900000000000000000`.
* **And** `dryRun` mặc định `true`; khi `dryRun=true` action phải validate input, log "dry run" nhưng KHÔNG gửi request thực.
* **And** `listActions()` trả về đầy đủ action mới với `requiresAuth: true`.

### AC-2: `like` handler — FavoriteTweet mutation

* **Given** action `like` đã đăng ký
* **When** gọi `crawler.start({ action: 'like', args: { tweetId: '1900000000000000000', dryRun: false } })`
* **Then** handler validate `tweetId` non-empty và chuẩn hóa qua `resolveTweetId`
* **And** gọi GraphQL `FavoriteTweet` [queryId: `lI07N6Otwv1PhnEgXILM7A`][src/scrapers/twitter/http/endpoints.js dòng 111] với variables `{ tweet_id: tweetId }`
* **And** sử dụng `DEFAULT_FEATURES` từ `endpoints.js`
* **And** gọi `TwitterClient.requestGraphQl` với `method: 'POST'`, `requiresAuth: true`, `accountId` từ `session`
* **And** parse `response.errors`; nếu bất kỳ message nào case-insensitive khớp idempotent list thì trả về `{ success: true }`
* **And** trả về `{ success: true }` khi API thành công

### AC-3: `unlike` handler — UnfavoriteTweet mutation

* **Given** action `unlike` đã đăng ký
* **When** gọi `crawler.start({ action: 'unlike', args: { tweetId: '1900000000000000000', dryRun: false } })`
* **Then** gọi GraphQL `UnfavoriteTweet` [queryId: `ZYKSe-w7KEslx3JhSIk5LA`][src/scrapers/twitter/http/endpoints.js dòng 112] với variables `{ tweet_id: tweetId }`
* **And** parse `response.errors` case-insensitive khớp idempotent list; nếu khớp, trả về `{ success: true }`

### AC-4: `retweet` handler — CreateRetweet mutation

* **Given** action `retweet` đã đăng ký
* **When** gọi `crawler.start({ action: 'retweet', args: { tweetId: '1900000000000000000', dryRun: false } })`
* **Then** gọi GraphQL `CreateRetweet` [queryId: `ojPdsZsimiJrUGLR1sjUtA`][src/scrapers/twitter/http/endpoints.js dòng 113] với variables `{ tweet_id: tweetId, dark_request: false }`
* **And** parse `response.errors` case-insensitive khớp idempotent list; nếu khớp, trả về `{ success: true }`

### AC-5: `undo_retweet` handler — DeleteRetweet mutation

* **Given** action `undo_retweet` đã đăng ký
* **When** gọi `crawler.start({ action: 'undo_retweet', args: { tweetId: '1900000000000000000', dryRun: false } })`
* **Then** gọi GraphQL `DeleteRetweet` [queryId: `iQtK4dl5hBmXewYZuEOKVw`][src/scrapers/twitter/http/endpoints.js dòng 114] với variables `{ source_tweet_id: tweetId, dark_request: false }`
* **And** parse `response.errors` case-insensitive khớp idempotent list; nếu khớp, trả về `{ success: true }`

### AC-6: Dry-run gate

* **Given** bất kỳ engagement action nào
* **When** gọi `crawler.start({ action: 'like', args: { tweetId: '1900000000000000000' } })` (không truyền `dryRun` hoặc `dryRun: true`)
* **Then** validate `tweetId` qua `resolveTweetId`, log `[DRY RUN] like: { tweetId }` nhưng KHÔNG gọi `requestGraphQl`
* **And** trả về `{ success: true }`

### AC-7: Write safety — delay floor và governor

* **Given** action engagement đã gọi
* **When** gọi ngoài dry-run
* **Then** delay tối thiểu 1s, tối đa 3s trước khi gửi request thực (dùng `gaussianDelay(1000, 3000)`)
* **And** `governor.canAccountRequest(accountId, 'twitter')` được kiểm tra tự động bởi `AbstractCrawler.start()` và `AbstractApiClient.request()`; nếu từ chối throw `PlatformError` `code: XACT_4291`, `suggestedAction: 'rotate_account'`
* **And** sử dụng sticky proxy gắn với `accountId`

### AC-8: Error handling

* **Given** request bị lỗi
* **When** Twitter trả về 401/403/429/5xx hoặc `response.errors`
* **Then** `AbstractApiClient.request()` và `TwitterCrawler` sẽ throw `PlatformError` với mapping:
  - 401 / auth_expired → `code: XACT_4010`, `suggestedAction: 'relogin'`
  - 403 (bot challenge) → `code: XACT_4030`, `suggestedAction: 'rotate_proxy'`
  - 429 → `code: XACT_4290`, `suggestedAction: 'rotate_account'` hoặc `retry_after_delay`
  - 5xx / GraphQL errors không idempotent → `code: XACT_5000`, `suggestedAction: 'retry_after_delay'`
* **And** handler phải kiểm tra `response.errors` trước khi re-throw: nếu message case-insensitive khớp idempotent list thì trả về `{ success: true }` thay vì throw
* **And** log KHÔNG bao gồm cookie, token, `authorization` header

### AC-9: Deprecation markers

* **Given** legacy functions trong `src/client/Scraper.js`, `src/client/api/tweets.js`, `src/scrapers/twitter/http/engagement.js`, `src/scrapers/twitter/http/index.js`
* **When** triển khai xong Story 13.2.8
* **Then** thêm JSDoc `@deprecated` trước `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong các file trên, với nội dung `— use TwitterCrawler.start({ action: '...', args: { tweetId, dryRun: false } }) instead.`
* **And** cập nhật `docs/deprecation-plan.md` mapping:
  - `src/client/Scraper.js likeTweet/unlikeTweet/retweet/unretweet` → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undo_retweet`
  - `src/client/api/tweets.js likeTweet/unlikeTweet/retweet/unretweet` → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undo_retweet`
  - `src/scrapers/twitter/http/engagement.js likeTweet/unlikeTweet/retweet/unretweet` → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undo_retweet`
  - `src/scrapers/twitter/http/index.js` export tương ứng → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undo_retweet`

### AC-10: Tests

* **Given** Vitest test suite
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-engagement.test.js`
* **Then** pass tất cả test sau:
  - `like`, `unlike`, `retweet`, `undo_retweet` được đăng ký với đúng descriptor (`requiresAuth: true`, `requiredArgs` gồm `tweetId`, `category` là `social`)
  - `like`/`unlike`/`retweet`/`undo_retweet` validate `tweetId` (empty, whitespace, invalid URL)
  - `like` gọi `FavoriteTweet` với đúng variables
  - `retweet` gọi `CreateRetweet` với đúng variables (bao gồm `dark_request: false`)
  - `undo_retweet` gọi `DeleteRetweet` với đúng variables (bao gồm `source_tweet_id`)
  - dry-run trả về `{ success: true }` và không gọi API
  - delay floor 1–3s (có thể test bằng elapsed time hoặc spy `gaussianDelay`)
  - governor từ chối trả `XACT_4291`
  - idempotent errors trả về `{ success: true }`
  - legacy functions có `@deprecated` tags
  - `docs/deprecation-plan.md` được cập nhật

---

## Dev Notes / Implementation Hints

### Shared patterns từ 13.2.6 / 13.2.7

* Tái sử dụng `composeContent` / `schedule` handler style: một private method `#performEngagement(args, session, sourceMethod)` hoặc 4 handler công khai gọi chung.
* Mỗi handler:
  - Validate `tweetId` qua `resolveTweetId(args.tweetId || args.url)`.
  - `dryRun = args.dryRun !== false`.
  - Nếu dryRun: log `[DRY RUN] <sourceMethod>: { tweetId }` và trả về `{ success: true }`.
  - Live: `gaussianDelay(1000, 3000)`, log `[WRITE] <sourceMethod>: { accountId, tweetId }`.
  - Gọi `this.client.requestGraphQl(queryId, operationName, variables, DEFAULT_FEATURES, DEFAULT_FIELD_TOGGLES, { accountId, requiresAuth: true, method: 'POST', cookies: session?.cookies })`.
  - Parse `response?.errors` hoặc `response?.data?.errors`. Nếu bất kỳ message nào khớp idempotent list (case-insensitive) thì trả về `{ success: true }`.
  - Nếu lỗi thật thì let `PlatformError` propagate (401/403/429/5xx đã được `AbstractApiClient` map).
  - Trả về `{ success: true }`.

### Mutation variables

```js
// like
{ tweet_id: tweetId }

// unlike
{ tweet_id: tweetId }

// retweet
{ tweet_id: tweetId, dark_request: false }

// undoRetweet
{ source_tweet_id: tweetId, dark_request: false }
```

### Idempotent error messages

Theo `src/scrapers/twitter/http/engagement.js` dòng 68-75:

```js
const IDEMPOTENT_ENGAGEMENT_MESSAGES = [
  'already favorited',
  'already retweeted',
  'already bookmarked',
  'you have already',
  'not found in list of retweets',
];
```

Nếu `response.errors` (hoặc `response.data.errors`) chứa bất kỳ message nào case-insensitive khớp một trong các chuỗi trên, handler trả về `{ success: true }` thay vì throw.

### GraphQL query IDs

Các query ID đã có sẵn trong `src/scrapers/twitter/http/endpoints.js`:
```js
FavoriteTweet:   { queryId: 'lI07N6Otwv1PhnEgXILM7A', operationName: 'FavoriteTweet' },
UnfavoriteTweet: { queryId: 'ZYKSe-w7KEslx3JhSIk5LA', operationName: 'UnfavoriteTweet' },
CreateRetweet:   { queryId: 'ojPdsZsimiJrUGLR1sjUtA', operationName: 'CreateRetweet' },
DeleteRetweet:   { queryId: 'iQtK4dl5hBmXewYZuEOKVw', operationName: 'DeleteRetweet' },
```

### Response parsing

* `TwitterPlatformResponseValidator.isValidPayload` hiện tại chưa nhận diện các mutation engagement. Thêm nhận diện cho:
  - `data.favorite_tweet` / `data.unfavorite_tweet`
  - `data.create_retweet` / `data.delete_retweet`
  - `data.legacy` / `data.rest_id` của các mutation objects
* Các mutation engagement cũng trả về `{ data: { ... } }` hoặc `{ success: boolean }` trong body; việc cập nhật validator tránh bị `base-client` đánh dấu `invalid payload` sau khi request 200 OK.

### Deprecation

* Thêm `@deprecated likeTweet — use TwitterCrawler.start({ action: 'like', args: { tweetId, dryRun: false } }) instead.` trước mỗi legacy function.
* Cập nhật `docs/deprecation-plan.md` thêm các dòng mapping.

---

## Open Questions / TBD

1. **Response shape của engagement mutations:** Có thể trả về `{ data: { favorite_tweet: { ... } } }` hoặc chỉ `{ success: true }`. Test mock cả hai trường hợp.
2. **Idempotent errors:** Đảm bảo bắt đúng message case-insensitive.
3. **Output type:** Đã chốt là `{ success: boolean }` theo đúng AC-1.

---

## Deprecation Mapping

| Legacy Function | File | Replacement |
|---|---|---|
| `likeTweet(http, tweetId)` | `src/client/api/tweets.js:378` | `TwitterCrawler.start({ action: 'like', args: { tweetId, dryRun: false } })` |
| `unlikeTweet(http, tweetId)` | `src/client/api/tweets.js:396` | `TwitterCrawler.start({ action: 'unlike', args: { tweetId, dryRun: false } })` |
| `retweet(http, tweetId)` | `src/client/api/tweets.js:414` | `TwitterCrawler.start({ action: 'retweet', args: { tweetId, dryRun: false } })` |
| `unretweet(http, tweetId)` | `src/client/api/tweets.js:432` | `TwitterCrawler.start({ action: 'undo_retweet', args: { tweetId, dryRun: false } })` |
| `likeTweet(id)` | `src/client/Scraper.js:536` | `twitter:like` |
| `unlikeTweet(id)` | `src/client/Scraper.js:548` | `twitter:unlike` |
| `retweet(id)` | `src/client/Scraper.js:560` | `twitter:retweet` |
| `unretweet(id)` | `src/client/Scraper.js:572` | `twitter:undo_retweet` |
| `likeTweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:180` | `twitter:like` |
| `unlikeTweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:190` | `twitter:unlike` |
| `retweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:204` | `twitter:retweet` |
| `unretweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:214` | `twitter:undo_retweet` |

---

## Tasks / Subtasks

- [x] Task 1 (AC-1, AC-10): Đăng ký action `like`, `unlike`, `retweet`, `undo_retweet` trong `TwitterCrawler`
  - [x] 1.1 Thêm 4 action với `requiredArgs: ['tweetId']`, `optionalArgs: ['dryRun']`, `requiresAuth: true`, `outputType: '{ success: boolean }'`, `category: 'social'`
  - [x] 1.2 Đảm bảo `listActions()` trả về đầy đủ action mới
  - [x] 1.3 Sử dụng `resolveTweetId` để chuẩn hóa `tweetId` từ URL hoặc numeric ID
- [x] Task 2 (AC-2–AC-5, AC-7–AC-8): Implement handlers cho engagement mutations
  - [x] 2.1 Implement `like(args, session)` gọi `FavoriteTweet`
  - [x] 2.2 Implement `unlike(args, session)` gọi `UnfavoriteTweet`
  - [x] 2.3 Implement `retweet(args, session)` gọi `CreateRetweet` với `dark_request: false`
  - [x] 2.4 Implement `undoRetweet(args, session)` gọi `DeleteRetweet` với `source_tweet_id` và `dark_request: false`
  - [x] 2.5 Validate `tweetId` non-empty, không whitespace-only, đúng format
  - [x] 2.6 Implement dry-run gate trả về `{ success: true }` không gọi API
  - [x] 2.7 Gọi `gaussianDelay(1000, 3000)` trước live call
  - [x] 2.8 Kiểm tra `governor.canAccountRequest` trước request
  - [x] 2.9 Xử lý idempotent errors (`already favorited`, `already retweeted`, v.v.)
  - [x] 2.10 Map 401/403/429/5xx và `response.errors` thành `PlatformError` với `suggestedAction` đúng
- [x] Task 3 (AC-9): Deprecation markers
  - [x] 3.1 Thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong `src/client/api/tweets.js`
  - [x] 3.2 Thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong `src/client/Scraper.js`
  - [x] 3.3 Thêm `@deprecated` cho các function tương ứng trong `src/scrapers/twitter/http/engagement.js`
  - [x] 3.4 Thêm `@deprecated` cho export wrapper trong `src/scrapers/twitter/http/index.js` (nếu có)
  - [x] 3.5 Cập nhật `docs/deprecation-plan.md`
- [x] Task 4 (AC-10): Red-phase TDD tests
  - [x] 4.1 Tạo `tests/scrapers/social/twitter/crawler-engagement.test.js`
  - [x] 4.2 Viết test action descriptors
  - [x] 4.3 Viết test validate `tweetId`
  - [x] 4.4 Viết test `like`/`unlike`/`retweet`/`undo_retweet` gọi đúng GraphQL mutation
  - [x] 4.5 Viết test dry-run không gọi API
  - [x] 4.6 Viết test idempotent errors trả về `success: true`
  - [x] 4.7 Viết test governor từ chối trả `XACT_4291`
  - [x] 4.8 Viết test `@deprecated` tags và `docs/deprecation-plan.md`
- [x] Task 5: Chạy test suite và cập nhật story file
  - [x] 5.1 Chạy `vitest run tests/scrapers/social/twitter/crawler-engagement.test.js` pass (13/13 passed)
  - [x] 5.2 Chạy `vitest run tests/scrapers/social/twitter/` không regression (76/76 passed)
  - [x] 5.3 Cập nhật `File List`, `Change Log`, `Completion Notes`, `Status`

---

## Dev Agent Record

### Implementation Plan

1. Đăng ký action `like`, `unlike`, `retweet`, `undo_retweet` trong `TwitterCrawler` với `ActionDescriptor` đúng (`requiresAuth: true`, `dryRun` default, `tweetId` required, `category: 'social'`).
2. Implement 4 handlers trong `crawler.js` qua helper private `#performEngagement`:
   - Validate `tweetId` qua `resolveTweetId`.
   - `dryRun = args.dryRun !== false`; khi dry-run log và return `{ success: true }`.
   - Live: `gaussianDelay(1000, 3000)`, log `[WRITE] <action>`, gọi `requestGraphQl` với query ID tương ứng.
   - Xử lý idempotent errors, throw `PlatformError` cho lỗi thật.
3. Cập nhật `docs/deprecation-plan.md` với mapping từ legacy functions sang `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undo_retweet`.
4. Thêm `@deprecated` JSDoc cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong `src/client/Scraper.js`, `src/client/api/tweets.js`, `src/scrapers/twitter/http/engagement.js`, `src/scrapers/twitter/http/index.js`.
5. Cập nhật `TwitterPlatformResponseValidator` để nhận diện các mutation response.
6. Viết acceptance test suite `tests/scrapers/social/twitter/crawler-engagement.test.js` và kiểm tra toàn bộ test suite Twitter crawler pass (76/76 tests).

### Completion Notes

- Đã triển khai đầy đủ 4 action engagement (`like`, `unlike`, `retweet`, `undo_retweet`) trên `TwitterCrawler` theo kiến trúc Hybrid.
- Tích hợp write safety: `gaussianDelay(1000, 3000)`, `dryRun=true` mặc định, và `canAccountRequest` rate governor.
- Xử lý lỗi idempotent cho Twitter errors ('already favorited', 'already retweeted', 'not found in list of retweets', v.v.) trả về `{ success: true }`.
- Gắn `@deprecated` annotations cho toàn bộ legacy functions trong `src/client/Scraper.js`, `src/client/api/tweets.js`, `src/scrapers/twitter/http/engagement.js`, và `src/scrapers/twitter/http/index.js`.
- Cập nhật `docs/deprecation-plan.md`.
- Đã chạy unit/integration test suite: 13/13 tests cho story 13.2.8 và 76/76 tests Twitter hybrid pass 100%.

### Change Log

- 2026-08-30: Triển khai hoàn tất Story 13.2.8 (Hybrid Like, Unlike, Retweet, UndoRetweet actions, validator updates, deprecations, và test suite).

### File List

#### UPDATE
- `src/scrapers/social/twitter/crawler.js` — thêm 4 action engagement và handler `#performEngagement`
- `src/scrapers/social/twitter/validator.js` — mở rộng `isValidPayload` nhận diện GraphQL mutations & errors
- `src/client/Scraper.js` — thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet`
- `src/client/api/tweets.js` — thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet`
- `src/scrapers/twitter/http/engagement.js` — thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet`
- `src/scrapers/twitter/http/index.js` — thêm `@deprecated` export note cho engagement exports
- `docs/deprecation-plan.md` — mapping và status tracker
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — cập nhật `13-2-8` sang `review`

#### NEW
- `tests/scrapers/social/twitter/crawler-engagement.test.js` — red-phase TDD acceptance tests
