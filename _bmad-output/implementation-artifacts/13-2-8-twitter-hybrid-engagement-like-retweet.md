---
story_id: '13.2.8'
epic: 13
story_key: '13-2-8-twitter-hybrid-engagement-like-retweet'
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "26b6f5c1d2d2a9f2e8c7a3b1c9d4e5f6a7b8c9d0e"
---

# Story 13.2.8 — Twitter Hybrid Engagement (Like & Retweet)

Status: ready-for-dev

## Story

As a **Twitter Growth Operator**,  
I want **thực hiện like, retweet, undoRetweet, và unlike qua `TwitterClient` kiến trúc hybrid**,  
so that **tôi có thể tự động hóa tương tác cơ bản với nội dung theo chiến lược growth**.

---

## Scope Note

Story 13.2.8 triển khai bốn action engagement mới cho `TwitterCrawler`: `like`, `unlike`, `retweet`, `undoRetweet`. Các action này sử dụng các GraphQL mutations:

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

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `like` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` |
| `unlike` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` |
| `retweet` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` |
| `undoRetweet` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` |

* **And** action names phải `snake_case` theo regex `/^[a-z0-9_]+$/`.
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
* **And** trả về `{ success: true }` khi API thành công hoặc response chứa lỗi idempotent ("already favorited", "you have already")

### AC-3: `unlike` handler — UnfavoriteTweet mutation

* **Given** action `unlike` đã đăng ký
* **When** gọi `crawler.start({ action: 'unlike', args: { tweetId: '1900000000000000000', dryRun: false } })`
* **Then** gọi GraphQL `UnfavoriteTweet` [queryId: `ZYKSe-w7KEslx3JhSIk5LA`][src/scrapers/twitter/http/endpoints.js dòng 112] với variables `{ tweet_id: tweetId }`
* **And** xử lý idempotent tương tự `like`

### AC-4: `retweet` handler — CreateRetweet mutation

* **Given** action `retweet` đã đăng ký
* **When** gọi `crawler.start({ action: 'retweet', args: { tweetId: '1900000000000000000', dryRun: false } })`
* **Then** gọi GraphQL `CreateRetweet` [queryId: `ojPdsZsimiJrUGLR1sjUtA`][src/scrapers/twitter/http/endpoints.js dòng 113] với variables `{ tweet_id: tweetId, dark_request: false }`
* **And** xử lý idempotent cho "already retweeted"

### AC-5: `undoRetweet` handler — DeleteRetweet mutation

* **Given** action `undoRetweet` đã đăng ký
* **When** gọi `crawler.start({ action: 'undoRetweet', args: { tweetId: '1900000000000000000', dryRun: false } })`
* **Then** gọi GraphQL `DeleteRetweet` [queryId: `iQtK4dl5hBmXewYZuEOKVw`][src/scrapers/twitter/http/endpoints.js dòng 114] với variables `{ source_tweet_id: tweetId, dark_request: false }`
* **And** xử lý idempotent cho "not found in list of retweets"

### AC-6: Dry-run gate

* **Given** bất kỳ engagement action nào
* **When** gọi `crawler.start({ action: 'like', args: { tweetId: '1900000000000000000' } })` (không truyền `dryRun` hoặc `dryRun: true`)
* **Then** validate `tweetId`, log `[DRY RUN] like: { tweetId }` nhưng KHÔNG gọi `requestGraphQl`
* **And** trả về `{ success: true }`

### AC-7: Write safety — delay floor và governor

* **Given** action engagement đã gọi
* **When** gọi ngoài dry-run
* **Then** delay tối thiểu 1s, tối đa 3s trước khi gửi request thực (dùng `gaussianDelay(1000, 3000)`)
* **And** kiểm tra `governor.canAccountRequest(accountId, 'twitter')` trước khi request; nếu từ chối throw `PlatformError` `code: XACT_4291`, `suggestedAction: 'rotate_account'`
* **And** sử dụng sticky proxy gắn với `accountId`

### AC-8: Error handling

* **Given** request bị lỗi
* **When** Twitter trả về 401/403/429/5xx hoặc `response.errors`
* **Then** throw `PlatformError` với mapping:
  - 401 / auth_expired → `code: XACT_4010`, `suggestedAction: 'relogin'`
  - 403 (bot challenge) → `code: XACT_4030`, `suggestedAction: 'rotate_proxy'`
  - 429 → `code: XACT_4290`, `suggestedAction: 'rotate_account'` hoặc `retry_after_delay`
  - 5xx / GraphQL errors không idempotent → `code: XACT_5000`, `suggestedAction: 'retry_after_delay'`
* **And** log KHÔNG bao gồm cookie, token, `authorization` header

### AC-9: Deprecation markers

* **Given** legacy functions trong `src/client/Scraper.js`, `src/client/api/tweets.js`, `src/scrapers/twitter/http/engagement.js`, `src/scrapers/twitter/http/index.js`
* **When** triển khai xong Story 13.2.8
* **Then** thêm JSDoc `@deprecated` trước `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong các file trên
* **And** cập nhật `docs/deprecation-plan.md` mapping:
  - `src/client/Scraper.js likeTweet/unlikeTweet/retweet/unretweet` → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undoRetweet`
  - `src/client/api/tweets.js likeTweet/unlikeTweet/retweet/unretweet` → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undoRetweet`
  - `src/scrapers/twitter/http/engagement.js likeTweet/unlikeTweet/retweet/unretweet` → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undoRetweet`
  - `src/scrapers/twitter/http/index.js` export tương ứng → `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undoRetweet`

### AC-10: Tests

* **Given** Vitest test suite
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-engagement.test.js`
* **Then** pass tất cả test sau:
  - `like`, `unlike`, `retweet`, `undoRetweet` được đăng ký với đúng descriptor (`requiresAuth: true`, `requiredArgs` gồm `tweetId`)
  - `like`/`unlike`/`retweet`/`undoRetweet` validate `tweetId` (empty, whitespace, invalid URL)
  - `like` gọi `FavoriteTweet` với đúng variables
  - `retweet` gọi `CreateRetweet` với đúng variables (bao gồm `dark_request: false`)
  - `undoRetweet` gọi `DeleteRetweet` với đúng variables (bao gồm `source_tweet_id`)
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
  - Parse response errors; nếu idempotent thì `success: true`, nếu lỗi thật thì throw `PlatformError`.
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
- `already favorited`
- `already retweeted`
- `already bookmarked`
- `you have already`
- `not found in list of retweets`

Nếu `response.errors` chứa bất kỳ message nào (case-insensitive), trả về `{ success: true }`.

### GraphQL query IDs

Các query ID đã có sẵn trong `src/scrapers/twitter/http/endpoints.js`:
```js
FavoriteTweet:   { queryId: 'lI07N6Otwv1PhnEgXILM7A', operationName: 'FavoriteTweet' },
UnfavoriteTweet: { queryId: 'ZYKSe-w7KEslx3JhSIk5LA', operationName: 'UnfavoriteTweet' },
CreateRetweet:   { queryId: 'ojPdsZsimiJrUGLR1sjUtA', operationName: 'CreateRetweet' },
DeleteRetweet:   { queryId: 'iQtK4dl5hBmXewYZuEOKVw', operationName: 'DeleteRetweet' },
```

### Response parsing

* `TwitterPlatformResponseValidator.isValidPayload` hiện tại chưa nhận diện các mutation engagement. Nếu cần, thêm nhận diện cho `data.favorite_tweet`, `data.unfavorite_tweet`, `data.create_retweet`, `data.delete_retweet`, `data.unfavorite_tweet`.
* Tuy nhiên, các mutation engagement thường trả về `{ success: boolean }` hoặc `{ data: { ... } }` đơn giản; `isValidPayload` có thể không cần thay đổi nếu response trả về object hợp lệ.

### Deprecation

* Thêm `@deprecated likeTweet — use TwitterCrawler.start({ action: 'like', args: { tweetId, dryRun: false } }) instead.` trước mỗi legacy function.
* Cập nhật `docs/deprecation-plan.md` thêm các dòng mapping.

---

## Open Questions / TBD

1. **Response shape của engagement mutations:** Có thể trả về `{ data: { favorite_tweet: { ... } } }` hoặc chỉ `{ success: true }`. Test cần mock cả hai.
2. **Idempotent errors:** Đảm bảo bắt đúng message case-insensitive.
3. **Output type:** Có trả về `PostItem` hay chỉ `{ success: boolean }`? Theo AC và legacy pattern, trả về `{ success: boolean }` là đủ. Nếu cần `PostItem`, có thể mở rộng sau.

---

## Deprecation Mapping

| Legacy Function | File | Replacement |
|---|---|---|
| `likeTweet(http, tweetId)` | `src/client/api/tweets.js:378` | `TwitterCrawler.start({ action: 'like', args: { tweetId, dryRun: false } })` |
| `unlikeTweet(http, tweetId)` | `src/client/api/tweets.js:396` | `TwitterCrawler.start({ action: 'unlike', args: { tweetId, dryRun: false } })` |
| `retweet(http, tweetId)` | `src/client/api/tweets.js:414` | `TwitterCrawler.start({ action: 'retweet', args: { tweetId, dryRun: false } })` |
| `unretweet(http, tweetId)` | `src/client/api/tweets.js:432` | `TwitterCrawler.start({ action: 'undoRetweet', args: { tweetId, dryRun: false } })` |
| `likeTweet(id)` | `src/client/Scraper.js:536` | `twitter:like` |
| `unlikeTweet(id)` | `src/client/Scraper.js:548` | `twitter:unlike` |
| `retweet(id)` | `src/client/Scraper.js:560` | `twitter:retweet` |
| `unretweet(id)` | `src/client/Scraper.js:572` | `twitter:undoRetweet` |
| `likeTweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:180` | `twitter:like` |
| `unlikeTweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:190` | `twitter:unlike` |
| `retweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:204` | `twitter:retweet` |
| `unretweet(client, tweetId)` | `src/scrapers/twitter/http/engagement.js:214` | `twitter:undoRetweet` |

---

## Tasks / Subtasks

- [ ] Task 1 (AC-1, AC-10): Đăng ký action `like`, `unlike`, `retweet`, `undoRetweet` trong `TwitterCrawler`
  - [ ] 1.1 Thêm 4 action với `requiredArgs: ['tweetId']`, `optionalArgs: ['dryRun']`, `requiresAuth: true`, `outputType: '{ success: boolean }'`
  - [ ] 1.2 Đảm bảo `listActions()` trả về đầy đủ action mới
  - [ ] 1.3 Sử dụng `resolveTweetId` để chuẩn hóa `tweetId` từ URL hoặc numeric ID
- [ ] Task 2 (AC-2–AC-5, AC-7–AC-8): Implement handlers cho engagement mutations
  - [ ] 2.1 Implement `like(args, session)` gọi `FavoriteTweet`
  - [ ] 2.2 Implement `unlike(args, session)` gọi `UnfavoriteTweet`
  - [ ] 2.3 Implement `retweet(args, session)` gọi `CreateRetweet` với `dark_request: false`
  - [ ] 2.4 Implement `undoRetweet(args, session)` gọi `DeleteRetweet` với `source_tweet_id` và `dark_request: false`
  - [ ] 2.5 Validate `tweetId` non-empty, không whitespace-only, đúng format
  - [ ] 2.6 Implement dry-run gate trả về `{ success: true }` không gọi API
  - [ ] 2.7 Gọi `gaussianDelay(1000, 3000)` trước live call
  - [ ] 2.8 Kiểm tra `governor.canAccountRequest` trước request
  - [ ] 2.9 Xử lý idempotent errors (`already favorited`, `already retweeted`, v.v.)
  - [ ] 2.10 Map 401/403/429/5xx và `response.errors` thành `PlatformError` với `suggestedAction` đúng
- [ ] Task 3 (AC-9): Deprecation markers
  - [ ] 3.1 Thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong `src/client/api/tweets.js`
  - [ ] 3.2 Thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong `src/client/Scraper.js`
  - [ ] 3.3 Thêm `@deprecated` cho các function tương ứng trong `src/scrapers/twitter/http/engagement.js`
  - [ ] 3.4 Thêm `@deprecated` cho export wrapper trong `src/scrapers/twitter/http/index.js` (nếu có)
  - [ ] 3.5 Cập nhật `docs/deprecation-plan.md`
- [ ] Task 4 (AC-10): Red-phase TDD tests
  - [ ] 4.1 Tạo `tests/scrapers/social/twitter/crawler-engagement.test.js`
  - [ ] 4.2 Viết test action descriptors
  - [ ] 4.3 Viết test validate `tweetId`
  - [ ] 4.4 Viết test `like`/`unlike`/`retweet`/`undoRetweet` gọi đúng GraphQL mutation
  - [ ] 4.5 Viết test dry-run không gọi API
  - [ ] 4.6 Viết test idempotent errors trả về `success: true`
  - [ ] 4.7 Viết test governor từ chối trả `XACT_4291`
  - [ ] 4.8 Viết test `@deprecated` tags và `docs/deprecation-plan.md`
- [ ] Task 5: Chạy test suite và cập nhật story file
  - [ ] 5.1 Chạy `vitest run tests/scrapers/social/twitter/crawler-engagement.test.js` pass
  - [ ] 5.2 Chạy `vitest run tests/scrapers/social/twitter/` không regression
  - [ ] 5.3 Cập nhật `File List`, `Change Log`, `Completion Notes`, `Status`

---

## Dev Agent Record

### Implementation Plan

1. Đăng ký action `like`, `unlike`, `retweet`, `undoRetweet` trong `TwitterCrawler` với `ActionDescriptor` đúng (`requiresAuth: true`, `dryRun` default, `tweetId` required).
2. Implement 4 handlers trong `crawler.js`:
   - Validate `tweetId` qua `resolveTweetId`.
   - `dryRun = args.dryRun !== false`; khi dry-run log và return `{ success: true }`.
   - Live: `gaussianDelay(1000, 3000)`, log `[WRITE] <action>`, gọi `requestGraphQl` với query ID tương ứng.
   - Xử lý idempotent errors, throw `PlatformError` cho lỗi thật.
3. Cập nhật `docs/deprecation-plan.md` với mapping từ legacy functions sang `twitter:like` / `twitter:unlike` / `twitter:retweet` / `twitter:undoRetweet`.
4. Thêm `@deprecated` JSDoc cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet` trong `src/client/Scraper.js`, `src/client/api/tweets.js`, `src/scrapers/twitter/http/engagement.js`, `src/scrapers/twitter/http/index.js`.
5. Viết red-phase tests `tests/scrapers/social/twitter/crawler-engagement.test.js` và chạy đến khi pass.

### Completion Notes

*(Để điền sau khi dev hoàn thành.)*

### File List

#### UPDATE
- `src/scrapers/social/twitter/crawler.js` — thêm 4 action engagement và handlers
- `src/client/Scraper.js` — thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet`
- `src/client/api/tweets.js` — thêm `@deprecated` cho các engagement functions
- `src/scrapers/twitter/http/engagement.js` — thêm `@deprecated` cho `likeTweet`, `unlikeTweet`, `retweet`, `unretweet`
- `src/scrapers/twitter/http/index.js` — thêm `@deprecated` cho engagement exports (nếu cần)
- `docs/deprecation-plan.md` — mapping và status tracker
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — cập nhật `13-2-8` sang `ready-for-dev`

#### NEW
- `tests/scrapers/social/twitter/crawler-engagement.test.js` — red-phase TDD tests
