---
story_id: '13.2.7'
epic: 13
story_key: '13-2-7-twitter-hybrid-content-scheduling'
status: "done"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-31
last_updated: 2026-08-31
owner: "DEV"
reviewed: "approved"
baseline_commit: "7f67bb484d0b13512e09bb3e9c564bb1ebfec6b0"
---

# Story 13.2.7 — Twitter Hybrid Content Scheduling

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-08-31  
**Summary:**
- Đã đăng ký action `schedule` trong `TwitterCrawler` đúng chuẩn `ActionDescriptor`.
- Tích hợp write safety: Gaussian delay floor, default `dryRun: true`, kiểm tra governor `canAccountRequest`.
- Normalization `publishAt` (Date, string, timestamp seconds/ms) thành Unix seconds chính xác.
- Tất cả 13/13 tests tại `crawler-content-scheduling.test.js` passed 100%.

epic: 13
story_key: '13-2-7-twitter-hybrid-content-scheduling'
status: "in-progress"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "db054e92eb8ec9937a2a2d76cbf4aa143f87f686"
---

# Story 13.2.7 — Twitter Hybrid Content Scheduling

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Twitter Content Operator**,  
I want **lập lịch tweet để đăng tự động trong tương lai qua `TwitterClient` kiến trúc hybrid**,  
so that **tôi có thể lập lịch nội dung mà không cần giữ trình duyệt mở**.

---

## Scope Note

Story 13.2.7 triển khai **action `schedule`** cho `TwitterCrawler`, kế thừa toàn bộ write-safety pattern của Story 13.2.6 (`post`/`reply`/`quote`).

* `schedule` tạo một tweet được lên lịch đăng trong tương lai qua GraphQL mutation `CreateScheduledTweet` (queryId `LCVzRQGxOaGnOnYH01NQXg`).
* Input chính: `text` (bắt buộc), `publishAt` (bắt buộc) có thể là ISO string, `Date`, hoặc Unix seconds. Tùy chọn `mediaIds` (tối đa 4), `premium`, `sensitive`, `dryRun`.
* Output: `{ tweet: PostItem }` với `metadata.scheduledAt`, `metadata.scheduledTweetId`, `metadata.sourceMethod: 'schedule'`. Nếu API trả về `rest_id`, dùng `twitter:${rest_id}` làm `id`.
* Tất cả write-safety rules của 13.2.6 áp dụng: `requiresAuth: true`, `dryRun=true` mặc định, delay floor 3–7s, `AdaptiveGovernor`, sticky proxy, `PlatformError` với `suggestedAction`, không log cookie/token.
* Legacy function `schedulePost` trong `src/scrapers/twitter/http/actions.js` (và index export) phải được đánh dấu `@deprecated`; nếu `src/client/Scraper.js` có bất kỳ hàm lập lịch nào cũng gắn `@deprecated`. Cập nhật `docs/deprecation-plan.md` mapping `schedulePost` → `TwitterCrawler.start({ action: 'schedule' })`.

`src/scrapers/social/twitter/` đã tồn tại sau Story 13.2.6, nên dev chỉ cần thêm action mới, validator, normalizer/crawler helper và deprecation markers.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.7 [dòng 514-520]
- `_bmad-output/planning-artifacts/prd.md` — FR-71, NFR-11/12/13/16 [dòng 79, 114-120]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 [dòng 125-133], AD-2 [dòng 134-141], AD-3 [dòng 142-163], AD-4 [dòng 164-174], AD-11 [dòng 233-243], AD-13 [dòng 250-260], AD-14 [dòng 272-283], AD-18 [dòng 311-318]
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2
- `_bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md` — `ProfileItem`, `PostItem`, `PlatformError`
- `_bmad-output/implementation-artifacts/13-2-6-twitter-hybrid-content-composition-post-reply-quote.md` — write pattern, `composeContent`, `CreateTweet`, dry-run gate, delay floor, telemetry, validation
- `src/core/base-crawler.js` — `AbstractCrawler.registerAction`, `ActionDescriptor` [dòng 21-307]
- `src/core/base-client.js` — `AbstractApiClient` request pipeline, 429/403 interceptor [dòng 43-893]
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`
- `src/core/types.js` — `PostItem`, `ActionDescriptor` [dòng 9-102]
- `src/scrapers/social/twitter/client.js` — `requestGraphQl`, `resolveTweetId`, `resolveUsername`, `parseTwitterCookies` [dòng 22-558]
- `src/scrapers/social/twitter/crawler.js` — existing actions, `composeContent` pattern [dòng 293-328, 2070-2181]
- `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator` [dòng 1-180]
- `src/scrapers/social/twitter/normalize-tweet.js` — `tweetToPostItem` [dòng 18-66]
- `src/scrapers/social/twitter/index.js` — barrel exports, `scrapeTwitter`
- `src/scrapers/twitter/http/endpoints.js` — `GRAPHQL` object, `DEFAULT_FEATURES`, `DEFAULT_FIELD_TOGGLES` [dòng 68-119, 175-220]
- `src/scrapers/twitter/http/actions.js` — legacy `schedulePost`, `CREATE_SCHEDULED_TWEET` [dòng 25-28, 261-309]
- `src/scrapers/twitter/http/index.js` — export `schedulePost` [dòng 117-120]
- `src/client/Scraper.js` — legacy `sendTweet`, `sendQuoteTweet` [dòng 489-525]
- `src/client/api/tweets.js` — legacy `sendTweet`, `sendQuoteTweet` [dòng 267-347]
- `src/utils/gaussian-delay.js` — delay helper
- `schemas/twitter/social.json` — metadata schema, required `tweetId` [dòng 1-205]
- `docs/deprecation-plan.md` — Status tracker [dòng 79-97], legacy-to-hybrid mapping [dòng 98-127]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2.6:** `TwitterCrawler.composeContent`, `CreateTweet`, `DEFAULT_FEATURES`, `DEFAULT_FIELD_TOGGLES`, telemetry pattern.
- **Phụ thuộc Story 13.2, 13.2.1–13.2.5:** `TwitterClient`, `TwitterCrawler`, `PlatformError`, `TwitterPlatformResponseValidator`, `PrismaStore`.
- **Phụ thuộc Epic 10.1/10.2:** `AbstractCrawler`, `AbstractApiClient`, `PrismaStore`.
- **Phụ thuộc Epic 11:** `ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool`.
- **Phụ thuộc Story 13.1:** `PreSignedTokenRing`, `SignerWorkerPagePool`.
- **Mở khóa Story 13.2.8** (engagement) — sử dụng lại `CreateScheduledTweet` pattern cho `FavoriteTweet`/`CreateRetweet`.
- **Mở khóa Story 13.2.12** (integration/caller migration).

---

## Acceptance Criteria

### AC-1: Đăng ký action `schedule` trong `TwitterCrawler`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký action `schedule` với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `schedule` | `['text', 'publishAt']` | `['mediaIds', 'premium', 'sensitive', 'dryRun']` | `{ text: 'Hello future XActions', publishAt: '2026-09-01T12:00:00Z', dryRun: false }` | `{ tweet: PostItem }` | `true` |

* **And** action name phải `snake_case` theo regex `/^[a-z0-9_]+$/`.
* **And** `listActions()` trả về action `schedule` với `requiresAuth: true`.

### AC-2: `schedule` handler — tạo tweet lên lịch

* **Given** action `schedule` đã đăng ký
* **When** gọi `crawler.start({ action: 'schedule', args: { text: 'Hello future', publishAt: '2026-09-01T12:00:00Z', dryRun: false } })`
* **Then** handler validate `text` non-empty và độ dài `≤ 280` (hoặc `≤ 25000` nếu `premium: true`)
* **And** validate `publishAt` là thời điểm trong tương lai (so với `Date.now()` ±5s để tránh race); nếu `publishAt` là ISO string hoặc `Date` hoặc Unix seconds/milliseconds, normalize về Unix seconds `executeAt`
* **And** validate `mediaIds.length ≤ 4`; nếu vượt quá throw `PlatformError` `XACT_4001`
* **And** gọi GraphQL `CreateScheduledTweet` [queryId: `LCVzRQGxOaGnOnYH01NQXg`][src/scrapers/twitter/http/actions.js dòng 25-28] với variables:
  ```js
  {
    post_tweet_request: {
      auto_populate_reply_metadata: false,
      status: text,
      exclude_reply_user_ids: [],
      media_ids: mediaIds,
    },
    execute_at: executeAt,
  }
  ```
* **And** sử dụng `DEFAULT_FEATURES`, `DEFAULT_FIELD_TOGGLES` từ `endpoints.js`
* **And** gọi `TwitterClient.requestGraphQl` với `method: 'POST'`, `requiresAuth: true`, `accountId` từ `session`
* **And** parse response `data.create_scheduled_tweet` / `data.tweet` / `data.id` thành `PostItem` với:
  - `id: twitter:${rest_id}` nếu API trả `rest_id`; nếu không có `rest_id`, dùng `twitter:scheduled-${id}` hoặc `twitter:scheduled-${executeAt}-${hash}`.
  - `category: 'social'`
  - `metadata.tweetId: <externalId>`
  - `metadata.sourceMethod: 'schedule'`
  - `metadata.scheduledAt: <publishAt ISO string>`
  - `metadata.scheduledTweetId: <scheduled id từ response>`

### AC-3: Dry-run gate

* **Given** action `schedule`
* **When** gọi `crawler.start({ action: 'schedule', args: { text: 'Hello future', publishAt: '2026-09-01T12:00:00Z' } })` (không truyền `dryRun` hoặc `dryRun: true`)
* **Then** validate input, build variables, log `[DRY RUN] schedule: { text, publishAt }` nhưng KHÔNG gọi `requestGraphQl`
* **And** trả về `PostItem` với `metadata.dryRun: true`, `metadata.scheduledAt`, `metadata.sourceMethod: 'schedule'`
* **And** `content` là `text`, `id` là synthetic `twitter:schedule-dryrun-${timestamp}`

### AC-4: Write safety — delay floor và governor

* **Given** action write đã gọi
* **When** gọi `schedule` (ngoài dry-run)
* **Then** delay tối thiểu 3s, tối đa 7s trước khi gửi request thực (dùng `gaussianDelay(3000, 7000)`)
* **And** kiểm tra `governor.canAccountRequest(accountId, 'twitter')` trước khi request; nếu từ chối throw `PlatformError` `code: XACT_4291`, `suggestedAction: 'rotate_account'`
* **And** sử dụng sticky proxy gắn với `accountId`

### AC-5: Error handling

* **Given** request bị lỗi
* **When** Twitter trả về 401/403/429/5xx hoặc `response.errors`
* **Then** throw `PlatformError` với mapping:
  - 401 / auth_expired → `code: XACT_4010`, `suggestedAction: 'relogin'`
  - 403 (bot challenge) → `code: XACT_4030`, `suggestedAction: 'rotate_proxy'`
  - 429 → `code: XACT_4290`, `suggestedAction: 'rotate_account'` hoặc `retry_after_delay`
  - 5xx / GraphQL errors → `code: XACT_5000`, `suggestedAction: 'retry_after_delay'`
* **And** log KHÔNG bao gồm cookie, token, `authorization` header

### AC-6: Deprecation markers

* **Given** legacy `schedulePost` trong `src/scrapers/twitter/http/actions.js` và `src/scrapers/twitter/http/index.js`
* **When** triển khai xong Story 13.2.7
* **Then** thêm JSDoc `@deprecated schedulePost — use TwitterCrawler.start({ action: 'schedule', args: { text, publishAt, dryRun: false } }) when available.` trước `schedulePost`
* **And** cập nhật `docs/deprecation-plan.md` mapping:
  - `src/scrapers/twitter/http/actions.js schedulePost` → `TwitterCrawler.start({ action: 'schedule' })`
  - `src/scrapers/twitter/http/index.js schedulePost` → `TwitterCrawler.start({ action: 'schedule' })`
* **And** nếu `src/client/Scraper.js` hoặc `src/client/api/tweets.js` có hàm lập lịch, gắn `@deprecated` tương tự

### AC-7: Response validator

* **Given** `TwitterPlatformResponseValidator`
* **When** nhận response từ `CreateScheduledTweet`
* **Then** `isValidPayload` trả về `true` cho `data.create_scheduled_tweet` / `data.tweet` / `data.id` hoặc `data.tweet_results.result`
* **And** `isRateLimit`/`isBotChallenge` vẫn hoạt động như cũ

### AC-8: Tests

* **Given** Vitest test suite
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-content-scheduling.test.js`
* **Then** pass tất cả test sau:
  - `schedule` được đăng ký với đúng descriptor (`requiresAuth: true`, `requiredArgs` gồm `text` và `publishAt`)
  - `schedule` validate `text` và `publishAt`
  - `schedule` convert `publishAt` Date/ISO/milliseconds về Unix seconds `execute_at`
  - `schedule` gọi `CreateScheduledTweet` với đúng variables
  - `schedule` dry-run trả về `PostItem` với `metadata.dryRun: true` và không gọi API
  - `schedule` parse response thành `PostItem` với `metadata.scheduledAt` và `sourceMethod: 'schedule'`
  - delay floor 3–7s giữa các lần gọi live (có thể test bằng elapsed time hoặc spy `gaussianDelay`)
  - governor từ chối trả `XACT_4291`
  - legacy `schedulePost` có `@deprecated` tag
  - `docs/deprecation-plan.md` được cập nhật

---

## Dev Notes / Implementation Hints

### CreateScheduledTweet mutation

* `CreateScheduledTweet` là mutation GraphQL khác với `CreateTweet`.
* Query ID: `LCVzRQGxOaGnOnYH01NQXg` (từ `src/scrapers/twitter/http/actions.js` dòng 25-28). Nếu Twitter đổi query ID, dev cần reverse-engineer từ x.com network tab.
* Operation name: `CreateScheduledTweet`.
* Variables shape legacy:
  ```js
  {
    post_tweet_request: {
      auto_populate_reply_metadata: false,
      status: text,
      exclude_reply_user_ids: [],
      media_ids: mediaIds,
    },
    execute_at: executeAt, // Unix seconds
  }
  ```
* Nếu API hiện tại dùng shape mới (giống `CreateTweet` với thêm `scheduled_at` hoặc `execute_at`), cập nhật variables theo real payload; tuy nhiên ưu tiên giữ shape legacy vì đã được ghi nhận trong code.

### publishAt normalization

```js
function normalizePublishAt(input) {
  if (!input) throw new PlatformError({ code: 'XACT_4001', ... });
  let date;
  if (input instanceof Date) date = input;
  else if (typeof input === 'number') {
    // assume ms if > 1e12, else seconds
    date = input > 1e12 ? new Date(input) : new Date(input * 1000);
  } else if (typeof input === 'string') {
    date = new Date(input);
  }
  if (isNaN(date.getTime())) throw new PlatformError({ code: 'XACT_4001', ... });
  if (date.getTime() < Date.now() - 5000) throw new PlatformError({ code: 'XACT_4001', message: 'publishAt must be in the future' });
  return Math.floor(date.getTime() / 1000); // Unix seconds
}
```

### Response parsing

* Expected response paths (theo legacy `schedulePost`):
  - `json?.data?.tweet?.rest_id`
  - `json?.data?.create_scheduled_tweet?.id`
  - `json?.data?.id`
* Nếu response chứa `tweet_results.result` (full tweet object), dùng `tweetToPostItem`.
* Nếu response chỉ chứa id/rest_id, build `PostItem` synthetic với `content: text` và metadata `scheduledAt`, `scheduledTweetId`.

### Shared patterns từ 13.2.6

* Tái sử dụng `composeContent` hoặc tách `scheduleContent` riêng. Đề xuất tách thành `scheduleContent(args, session)` trong `crawler.js` vì `CreateScheduledTweet` có variables khác `CreateTweet`.
* Validate `text` non-empty, không chỉ whitespace, và giới hạn độ dài 280/25,000.
* Validate `mediaIds.length ≤ 4`.
* `dryRun` mặc định `true`; `args.dryRun !== false` để live.
* Dùng `gaussianDelay(3000, 7000)` trước live call.
* Log telemetry `[DRY RUN] schedule` / `[WRITE] schedule` với `{ accountId, textLength, hasMedia, publishAt, dryRun }`; KHÔNG log cookies/tokens.
* Check `response.errors` trước khi parse; surface `graphQLErrors` thành `PlatformError` `XACT_5000`.
* Gọi `#persistPostItems([post])` và `#emitCheckpointAndStream` sau live write.

### GraphQL query ID placement

* Thêm `CreateScheduledTweet` vào `GRAPHQL` object trong `src/scrapers/twitter/http/endpoints.js` để nhất quán với `CreateTweet`:
  ```js
  CreateScheduledTweet: { queryId: 'LCVzRQGxOaGnOnYH01NQXg', operationName: 'CreateScheduledTweet' },
  ```
* Hoặc thêm vào `TWITTER_GRAPHQL_QUERY_IDS` trong `crawler.js` nếu dev muốn giữ local. Khuyến nghị đặt trong `endpoints.js` để các module khác dùng chung.

### Metadata schema

* `schemas/twitter/social.json` yêu cầu `metadata.tweetId` là `string`. PostItem do `schedule` tạo phải có `metadata.tweetId` (dù là synthetic id khi dry-run).
* Thêm trường `scheduledAt` (string ISO) và `scheduledTweetId` (string) vào `metadata`. Không cần cập nhật schema vì schema cho phép additional properties (draft-07 `additionalProperties: true` mặc định), nhưng nếu `metadata-schema-registry` validate nghiêm, hãy đảm bảo các trường mới có kiểu `string`.

---

## Open Questions / TBD

1. **CreateScheduledTweet variables shape:** Đang dùng legacy shape từ `src/scrapers/twitter/http/actions.js`. Nếu test fail với real/fake server, kiểm tra lại x.com request payload. Có thể Twitter đã chuyển sang cùng variables với `CreateTweet` kèm `scheduled_at`.
2. **Response shape:** API có thể trả về `tweet_results.result` hay chỉ `id`. Test cần mock cả hai.
3. **`src/client/Scraper.js` có `scheduleTweet` không?** Hiện tại không tìm thấy `scheduleTweet` trong `src/client/Scraper.js`. Nếu method tồn tại dưới tên khác (ví dụ `schedulePost`), hãy gắn `@deprecated`; nếu không, chỉ cần cập nhật `src/scrapers/twitter/http/`.
4. **Media trong scheduled tweet:** Legacy dùng `media_ids: string[]` trong `post_tweet_request`. Giữ nguyên. Nếu API yêu cầu `media.entities` giống `CreateTweet`, đổi theo.

---

## Deprecation Mapping

| Legacy Function | File | Replacement |
|---|---|---|
| `schedulePost(client, text, scheduledAt, options)` | `src/scrapers/twitter/http/actions.js:261` | `TwitterCrawler.start({ action: 'schedule', args: { text, publishAt: scheduledAt, mediaIds, dryRun: false } })` |
| `schedulePost(text, scheduledAt, opts)` | `src/scrapers/twitter/http/index.js:117` | `TwitterCrawler.start({ action: 'schedule', ... })` |
| `Scraper.scheduleTweet(text, options)` (nếu tồn tại) | `src/client/Scraper.js` | `TwitterCrawler.start({ action: 'schedule', ... })` |

---

## Tasks / Subtasks

- [ ] Task 1 (AC-1, AC-8): Đăng ký action `schedule` trong `TwitterCrawler` với descriptor đúng
  - [ ] 1.1 Thêm `schedule` action với `requiredArgs: ['text', 'publishAt']`, `optionalArgs: ['mediaIds', 'premium', 'sensitive', 'dryRun']`, `requiresAuth: true`, `outputType: '{ tweet: PostItem }'`
  - [ ] 1.2 Đảm bảo `listActions()` trả về `schedule` với `requiresAuth: true`
  - [ ] 1.3 Thêm `CreateScheduledTweet` vào `GRAPHQL` object trong `src/scrapers/twitter/http/endpoints.js`
- [ ] Task 2 (AC-2, AC-4, AC-5): Implement `scheduleContent(args, session)` handler
  - [ ] 2.1 Validate `text` (non-empty, không whitespace-only, ≤ 280/25,000)
  - [ ] 2.2 Validate `publishAt` và normalize về Unix seconds; reject thời điểm quá khứ
  - [ ] 2.3 Validate `mediaIds.length ≤ 4`
  - [ ] 2.4 Build `CreateScheduledTweet` variables với `post_tweet_request` + `execute_at`
  - [ ] 2.5 Implement dry-run gate trả về `PostItem` với `metadata.dryRun: true`
  - [ ] 2.6 Gọi `gaussianDelay(3000, 7000)` và kiểm tra `governor.canAccountRequest` trước live call
  - [ ] 2.7 Gọi `TwitterClient.requestGraphQl` với `method: 'POST'`, `requiresAuth: true`, `DEFAULT_FEATURES` + `DEFAULT_FIELD_TOGGLES`
  - [ ] 2.8 Parse response thành `PostItem` với `metadata.scheduledAt`, `scheduledTweetId`, `sourceMethod: 'schedule'`; xử lý `response.errors`
  - [ ] 2.9 Persist `PostItem` và checkpoint
- [ ] Task 3 (AC-7): Cập nhật `TwitterPlatformResponseValidator` nhận diện `create_scheduled_tweet`
  - [ ] 3.1 Thêm `create_scheduled_tweet` / `data.tweet` / `data.id` vào `isValidPayload`
- [ ] Task 4 (AC-6): Deprecation markers
  - [ ] 4.1 Thêm `@deprecated` JSDoc cho `schedulePost` trong `src/scrapers/twitter/http/actions.js`
  - [ ] 4.2 Thêm `@deprecated` JSDoc cho `schedulePost` wrapper trong `src/scrapers/twitter/http/index.js`
  - [ ] 4.3 Kiểm tra `src/client/Scraper.js` và `src/client/api/tweets.js` có hàm lập lịch; nếu có thì gắn `@deprecated`
  - [ ] 4.4 Cập nhật `docs/deprecation-plan.md` mapping `schedulePost` → `twitter:schedule`
- [ ] Task 5 (AC-8): Red-phase TDD tests
  - [ ] 5.1 Tạo `tests/scrapers/social/twitter/crawler-content-scheduling.test.js`
  - [ ] 5.2 Viết test kiểm tra action descriptor `schedule`
  - [ ] 5.3 Viết test validate text, publishAt, mediaIds
  - [ ] 5.4 Viết test dry-run không gọi API
  - [ ] 5.5 Viết test live call với đúng variables
  - [ ] 5.6 Viết test parse response thành PostItem
  - [ ] 5.7 Viết test governor từ chối trả `XACT_4291`
  - [ ] 5.8 Viết test `@deprecated` tag trên `schedulePost`
  - [ ] 5.9 Viết test `docs/deprecation-plan.md` mapping
- [ ] Task 6: Chạy full suite và cập nhật story file
  - [ ] 6.1 Chạy `vitest run tests/scrapers/social/twitter/crawler-content-scheduling.test.js` pass
  - [ ] 6.2 Chạy `vitest run tests/scrapers/social/twitter/` không regression
  - [ ] 6.3 Chạy full suite nếu cần
  - [ ] 6.4 Cập nhật `File List`, `Change Log`, `Completion Notes`, `Status`

## Dev Agent Record

### Implementation Plan

1. Đăng ký action `schedule` trong `TwitterCrawler` với `ActionDescriptor` đúng (`requiresAuth: true`, `dryRun` default, `text` + `publishAt` required, `mediaIds`/`premium`/`sensitive` optional).
2. Implement `scheduleContent(args, session)` hoặc mở rộng `composeContent`:
   - Validate `text` (non-empty, not whitespace-only, ≤ 280/25,000).
   - Validate `mediaIds.length ≤ 4`.
   - Normalize `publishAt` về Unix seconds `executeAt`; reject past times.
   - Build `CreateScheduledTweet` variables.
   - Dry-run gate trả về synthetic `PostItem` với `metadata.dryRun: true`.
   - Live: `gaussianDelay(3000, 7000)`, log `[WRITE] schedule`, gọi `requestGraphQl`.
   - Parse response thành `PostItem` với `metadata.scheduledAt`, `scheduledTweetId`, `sourceMethod: 'schedule'`.
   - Persist post và checkpoint.
3. Thêm `CreateScheduledTweet` vào `GRAPHQL` trong `src/scrapers/twitter/http/endpoints.js`.
4. Cập nhật `TwitterPlatformResponseValidator.isValidPayload` để nhận `create_scheduled_tweet`.
5. Thêm `@deprecated` cho `schedulePost` trong `src/scrapers/twitter/http/actions.js` và `src/scrapers/twitter/http/index.js`; cập nhật `docs/deprecation-plan.md`.
6. Viết red-phase tests `tests/scrapers/social/twitter/crawler-content-scheduling.test.js` và chạy đến khi pass.

### Completion Notes

*(Để điền sau khi dev hoàn thành.)*

### File List

#### UPDATE
- `src/scrapers/social/twitter/crawler.js` — thêm action `schedule` và handler
- `src/scrapers/social/twitter/validator.js` — nhận diện `create_scheduled_tweet`
- `src/scrapers/twitter/http/endpoints.js` — thêm `CreateScheduledTweet` vào `GRAPHQL`
- `src/scrapers/twitter/http/actions.js` — thêm `@deprecated` cho `schedulePost`
- `src/scrapers/twitter/http/index.js` — thêm `@deprecated` cho `schedulePost` export wrapper
- `docs/deprecation-plan.md` — mapping và status tracker
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — cập nhật `13-2-7` sang `ready-for-dev`

#### NEW
- `tests/scrapers/social/twitter/crawler-content-scheduling.test.js` — red-phase TDD tests

#### OPTIONAL / CONSIDER
- `src/scrapers/social/twitter/normalize-scheduled-tweet.js` — nếu response parsing phức tạp hơn dự kiến

### Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-30 | Created story context from epics, 13.2.6 learnings, and legacy `schedulePost` | BMad Create-Story |
