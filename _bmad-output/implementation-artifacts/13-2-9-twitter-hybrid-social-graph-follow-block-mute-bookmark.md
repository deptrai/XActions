---
story_id: '13.2.9'
epic: 13
story_key: '13-2-9-twitter-hybrid-social-graph-follow-block-mute-bookmark'
status: "done"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "approved"
baseline_commit: "ec85dbff7747ad97a2080c417cd70cc1df4f6b89"
---

# Story 13.2.9 — Twitter Hybrid Social Graph (Follow, Block, Mute, Bookmark)

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-08-30  
**Summary:**
- 8 actions social graph (`follow`, `unfollow`, `block`, `unblock`, `mute`, `unmute`, `bookmark`, `unbookmark`) được đăng ký và thực thi chính xác.
- Tự động resolve `username` sang `userId` thông qua `UserByScreenName`.
- Write safety tuân thủ đầy đủ delay floor (2–5s cho REST, 1–3s cho GraphQL), `dryRun=true` mặc định, rate governor check `canAccountRequest`.
- Tự động serialize x-www-form-urlencoded cho REST 1.1 mutations.
- Gắn `@deprecated` annotations đầy đủ cho toàn bộ legacy functions trong `src/client/Scraper.js`, `src/client/api/users.js`, `src/scrapers/twitter/http/engagement.js`.
- Test suite đạt độ bao phủ 13/13 tests pass, toàn bộ suite hybrid đạt 89/89 tests pass.

#### Action Items (Resolved)
- [x] [Review][Patch] Hỗ trợ serialize form-urlencoded payload trong `TwitterClient.requestRest`.
- [x] [Review][Patch] Mở rộng validator nhận diện payload REST response và bookmark mutations.

## Story

As a **Twitter Growth & Moderation Operator**,  
I want **quản lý mối quan hệ tài khoản (follow, unfollow, block, unblock, mute, unmute, bookmark, unbookmark) qua `TwitterClient`/`TwitterCrawler` kiến trúc hybrid**,  
so that **tôi có thể tự động hóa growth và moderation tài khoản mà không cần mở browser**.

---

## Scope Note

Story 13.2.9 triển khai 8 action quản trị quan hệ xã hội (social graph) cho `TwitterCrawler`:
- `follow` → REST `/1.1/friendships/create.json` (hỗ trợ `userId` hoặc `username`)
- `unfollow` → REST `/1.1/friendships/destroy.json` (hỗ trợ `userId` hoặc `username`)
- `block` → REST `/1.1/blocks/create.json` (hỗ trợ `userId` hoặc `username`)
- `unblock` → REST `/1.1/blocks/destroy.json` (hỗ trợ `userId` hoặc `username`)
- `mute` → REST `/1.1/mutes/users/create.json` (hỗ trợ `userId` hoặc `username`)
- `unmute` → REST `/1.1/mutes/users/destroy.json` (hỗ trợ `userId` hoặc `username`)
- `bookmark` → GraphQL `CreateBookmark` (queryId `aoDbu3RHznuiSkQ9aNM67Q`)
- `unbookmark` → GraphQL `DeleteBookmark` (queryId `Wlmlj2-xzyS1GN3a6cj-mQ`)

### Yêu cầu chung cho tất cả action:
- Khai báo `requiresAuth: true`, `category: 'social'`.
- `dryRun=true` mặc định (gate) để tránh thao tác thật khi chưa chỉ định rõ `dryRun: false`.
- Tuân thủ delay floor **2–5s** giữa các tác vụ social (`gaussianDelay(2000, 5000)`).
- Hỗ trợ phân giải `username` thành `userId` qua `UserByScreenName` khi gọi `follow`, `unfollow`, `block`, `unblock`, `mute`, `unmute` với `username` hoặc URL profile (`https://x.com/username`).
- Hỗ trợ chuẩn hóa `tweetId` qua `resolveTweetId` cho `bookmark` và `unbookmark`.
- Tuân thủ rate governor (`governor.canAccountRequest`) và sticky proxy per accountId.
- Trả về `{ success: boolean }`.
- Xử lý idempotent:
  - Bookmark: `already bookmarked`, `already favorited`, `you have already`.
  - Social Graph: `already following`, `already requested`, `cannot find specified user` (khi unblock/unfollow user đã unblocked/unfollowed).
- Gắn `@deprecated` cho các hàm legacy tương ứng trong `src/client/Scraper.js`, `src/client/api/users.js`, `src/scrapers/twitter/http/engagement.js`, và `src/scrapers/twitter/http/index.js`.
- Cập nhật `docs/deprecation-plan.md`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.9 [dòng 539-551]
- `_bmad-output/planning-artifacts/prd.md` — FR-71, NFR-11/12/13/16 [dòng 79, 114-120]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-3, AD-11, AD-13, AD-14
- `_bmad-output/implementation-artifacts/13-2-8-twitter-hybrid-engagement-like-retweet.md` — mẫu triển khai engagement mutations, idempotent handler
- `src/core/base-crawler.js` — `AbstractCrawler.registerAction`, `ActionDescriptor`
- `src/core/base-client.js` — `AbstractApiClient.request`, `requestRest`, `requestGraphQl`
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`
- `src/scrapers/social/twitter/client.js` — `requestRest`, `requestGraphQl`, `resolveUsername`, `resolveTweetId`
- `src/scrapers/social/twitter/crawler.js` — `TwitterCrawler` hiện tại
- `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator`
- `src/scrapers/twitter/http/endpoints.js` — `REST`, `GRAPHQL` constants
- `src/scrapers/twitter/http/engagement.js` — legacy `followUser`, `unfollowUser`, `blockUser`, `unblockUser`, `muteUser`, `unmuteUser`, `bookmarkTweet`, `unbookmarkTweet`
- `src/client/Scraper.js` — legacy `followUser`, `unfollowUser`
- `src/client/api/users.js` — legacy `followUser`, `unfollowUser`
- `docs/deprecation-plan.md` — legacy-to-hybrid mapping và status tracker

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2.8:** Mẫu triển khai mutation handler, `gaussianDelay`, rate governor.
- **Phụ thuộc Story 13.2.1/13.2.2:** `UserByScreenName`, `bookmarks` query action.
- **Mở khóa Story 13.2.10 (Direct Messaging) & 13.2.11 (List Management)**.
- **Mở khóa Story 13.2.12 (Integration & Caller Migration)**.

---

## Acceptance Criteria

### AC-1: Đăng ký 8 actions trong `TwitterCrawler`

* **Given** `TwitterCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** crawler được khởi tạo
* **Then** 8 action sau được đăng ký với descriptor chuẩn `ActionDescriptor` (`snake_case`):

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth | category |
|---|---|---|---|---|---|---|
| `follow` | `[]` (cần `userId` hoặc `username`) | `['userId', 'username', 'dryRun']` | `{ username: 'elonmusk', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `unfollow` | `[]` (cần `userId` hoặc `username`) | `['userId', 'username', 'dryRun']` | `{ username: 'elonmusk', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `block` | `[]` (cần `userId` hoặc `username`) | `['userId', 'username', 'dryRun']` | `{ username: 'spammer', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `unblock` | `[]` (cần `userId` hoặc `username`) | `['userId', 'username', 'dryRun']` | `{ username: 'spammer', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `mute` | `[]` (cần `userId` hoặc `username`) | `['userId', 'username', 'dryRun']` | `{ username: 'noisy_account', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `unmute` | `[]` (cần `userId` hoặc `username`) | `['userId', 'username', 'dryRun']` | `{ username: 'noisy_account', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `bookmark` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` | `social` |
| `unbookmark` | `['tweetId']` | `['dryRun']` | `{ tweetId: '1900000000000000000', dryRun: false }` | `{ success: boolean }` | `true` | `social` |

* **And** `listActions()` trả về danh sách có đủ 8 actions với `requiresAuth: true`.

### AC-2: User ID Resolution cho Social Graph Handlers

* **Given** action `follow`, `unfollow`, `block`, `unblock`, `mute`, hoặc `unmute`
* **When** truyền `args.userId` dạng numeric string (`12345678`)
* **Then** handler sử dụng trực tiếp `userId`.
* **When** truyền `args.username` (hoặc URL profile `https://x.com/username`)
* **Then** handler phân giải username sang `userId` bằng truy vấn `UserByScreenName` (`queryId: 'NimuplG1OB7Fd2btCLdBOw'`).
* **When** không truyền cả `userId` lẫn `username`
* **Then** throw `PlatformError` với `code: 'XACT_4001'`, `type: ErrorTypes.INVALID_ARGS`.

### AC-3: REST Social Graph Mutations (Follow, Unfollow, Block, Unblock, Mute, Unmute)

* **Given** `userId` đã được resolve
* **When** gọi live action (`dryRun: false`)
* **Then** gửi POST request tới REST endpoint tương ứng:
  - `follow` ➔ `/1.1/friendships/create.json` với form body `{ user_id: userId, skip_status: 'true' }`
  - `unfollow` ➔ `/1.1/friendships/destroy.json` với form body `{ user_id: userId, skip_status: 'true' }`
  - `block` ➔ `/1.1/blocks/create.json` với form body `{ user_id: userId }`
  - `unblock` ➔ `/1.1/blocks/destroy.json` với form body `{ user_id: userId }`
  - `mute` ➔ `/1.1/mutes/users/create.json` với form body `{ user_id: userId }`
  - `unmute` ➔ `/1.1/mutes/users/destroy.json` với form body `{ user_id: userId }`
* **And** trả về `{ success: true }`.

### AC-4: GraphQL Bookmark Mutations (Bookmark, Unbookmark)

* **Given** action `bookmark` hoặc `unbookmark`
* **When** gọi với `tweetId` (numeric string hoặc status URL)
* **Then** chuẩn hóa `tweetId` bằng `resolveTweetId`
* **And** gửi GraphQL POST request qua `TwitterClient.requestGraphQl`:
  - `bookmark` ➔ `CreateBookmark` (`queryId: 'aoDbu3RHznuiSkQ9aNM67Q'`) với variables `{ tweet_id: tweetId }`
  - `unbookmark` ➔ `DeleteBookmark` (`queryId: 'Wlmlj2-xzyS1GN3a6cj-mQ'`) với variables `{ tweet_id: tweetId }`
* **And** trả về `{ success: true }`.

### AC-5: Dry-Run Gate

* **Given** bất kỳ action nào trong 8 actions trên
* **When** không truyền `dryRun` hoặc truyền `dryRun: true`
* **Then** validate input (`tweetId` hoặc `userId`/`username`), log `[DRY RUN] <action>: ...` và KHÔNG gọi API thực tế.
* **And** trả về `{ success: true }`.

### AC-6: Write Safety & Delays

* **Given** live action (`dryRun: false`)
* **When** được thực thi
* **Then** delay ngẫu nhiên Gaussian từ 2s đến 5s (`gaussianDelay(2000, 5000)`).
* **And** kiểm tra rate limit / velocity qua `governor.canAccountRequest(accountId, 'twitter')`.
* **And** không in token hay cookie vào console log.

### AC-7: Idempotent Error Handling

* **Given** Twitter trả về error responses cho quan hệ đã tồn tại
* **When** `response.errors` chứa các thông báo idempotent (case-insensitive):
  - `already following`, `already requested`, `you are already following`, `cannot find specified user`, `already bookmarked`, `you have already`
* **Then** coi là thành công và trả về `{ success: true }`.

### AC-8: Deprecation Markers & Plan

* **Given** các hàm legacy liên quan
* **When** triển khai xong Story 13.2.9
* **Then** gắn `@deprecated` cho:
  - `src/client/Scraper.js`: `followUser`, `unfollowUser`
  - `src/client/api/users.js`: `followUser`, `unfollowUser`
  - `src/scrapers/twitter/http/engagement.js`: `followUser`, `unfollowUser`, `followByUsername`, `blockUser`, `unblockUser`, `muteUser`, `unmuteUser`, `bookmarkTweet`, `unbookmarkTweet`
  - `src/scrapers/twitter/http/index.js`: export list
* **And** cập nhật `docs/deprecation-plan.md` với status `deprecated-marked` cho Twitter Legacy Social Graph.

### AC-9: Test Suite Coverage

* **Given** Vitest test suite `tests/scrapers/social/twitter/crawler-social-graph.test.js`
* **When** chạy kiểm thử
* **Then** pass toàn bộ các trường hợp:
  - 8 action descriptors được đăng ký đúng
  - validate input (thiếu tweetId/userId/username hoặc invalid format)
  - resolve username sang userId cho các REST social actions
  - gọi đúng REST / GraphQL endpoint với payload mong đợi
  - dryRun=true không gọi mạng
  - xử lý idempotent errors
  - kiểm tra `@deprecated` annotations trong source code

---

## Dev Notes / Implementation Hints

### 1. Handler Structure
Nên xây dựng 2 private helpers trong `src/scrapers/social/twitter/crawler.js`:
- `#resolveTargetUserId(args, session)`: kiểm tra `args.userId` hoặc lấy `resolveUsername(args.username || args.url)` rồi gọi `UserByScreenName` để lấy `rest_id`.
- `#performRestSocialAction(args, session, actionName, endpointPath, buildBody)`: delay 2-5s, gọi `this.client.requestRest(endpointPath, { method: 'POST', body, accountId, requiresAuth: true, cookies: session?.cookies })`.
- `#performBookmarkAction(args, session, actionName, mutationConfig)`: tương tự `#performEngagement` ở 13.2.8.

### 2. Idempotent Error List
```js
const IDEMPOTENT_SOCIAL_MESSAGES = [
  'already following',
  'already requested',
  'already bookmarked',
  'you have already',
  'cannot find specified user',
  'not found in list',
];
```

### 3. Response Validator
Bổ sung `data.create_bookmark` và `data.delete_bookmark` vào `TwitterPlatformResponseValidator.isValidPayload()` nếu cần thiết.

---

## Tasks / Subtasks

- [x] Task 1 (AC-1, AC-9): Đăng ký 8 actions trong `TwitterCrawler`
  - [x] 1.1 Đăng ký `follow`, `unfollow`, `block`, `unblock`, `mute`, `unmute` với `category: 'social'`, `requiresAuth: true`, `outputType: '{ success: boolean }'`
  - [x] 1.2 Đăng ký `bookmark`, `unbookmark` với `requiredArgs: ['tweetId']`, `category: 'social'`, `requiresAuth: true`, `outputType: '{ success: boolean }'`
- [x] Task 2 (AC-2, AC-3): Triển khai REST Social Graph Handlers
  - [x] 2.1 Viết helper `#resolveTargetUserId` hỗ trợ cả `userId` và `username`/URL profile
  - [x] 2.2 Viết helper `#performRestSocialAction` và handlers `follow`, `unfollow`, `block`, `unblock`, `mute`, `unmute`
  - [x] 2.3 Áp dụng `gaussianDelay(2000, 5000)` và dry-run gate
  - [x] 2.4 Bắt và xử lý lỗi idempotent
- [x] Task 3 (AC-4): Triển khai GraphQL Bookmark Handlers
  - [x] 3.1 Handlers `bookmark`, `unbookmark` gọi `CreateBookmark` / `DeleteBookmark`
  - [x] 3.2 Chuẩn hóa `tweetId` qua `resolveTweetId`
  - [x] 3.3 Áp dụng `gaussianDelay(1000, 3000)` và dry-run gate
- [x] Task 4 (AC-8): Đánh dấu Deprecation
  - [x] 4.1 Thêm `@deprecated` vào `src/client/Scraper.js`
  - [x] 4.2 Thêm `@deprecated` vào `src/client/api/users.js`
  - [x] 4.3 Thêm `@deprecated` vào `src/scrapers/twitter/http/engagement.js` và `index.js`
  - [x] 4.4 Cập nhật `docs/deprecation-plan.md`
- [x] Task 5 (AC-9): TDD Tests & Hoàn thiện
  - [x] 5.1 Tạo `tests/scrapers/social/twitter/crawler-social-graph.test.js`
  - [x] 5.2 Chạy pass test suite và kiểm tra regression toàn bộ Twitter crawlers (89/89 tests passed)
  - [x] 5.3 Cập nhật status story sang `review` và sync `sprint-status.yaml`

---

## Dev Agent Record

### Implementation Plan

1. Đăng ký 8 actions (`follow`, `unfollow`, `block`, `unblock`, `mute`, `unmute`, `bookmark`, `unbookmark`) trong constructor `TwitterCrawler`.
2. Tạo helper `#resolveTargetUserId` và `#performRestSocialAction` trong `crawler.js`.
3. Tích hợp các REST endpoints (`friendshipsCreate`, `friendshipsDestroy`, `blocksCreate`, `blocksDestroy`, `mutesCreate`, `mutesDestroy`) với serialization form body trong `requestRest`.
4. Tích hợp các GraphQL mutations (`CreateBookmark`, `DeleteBookmark`) qua `#performEngagement`.
5. Mở rộng `TwitterPlatformResponseValidator` để nhận diện payload REST response và bookmark mutations.
6. Thêm deprecation annotations vào `src/client/Scraper.js`, `src/client/api/users.js`, `src/scrapers/twitter/http/engagement.js`.
7. Cập nhật `docs/deprecation-plan.md`.
8. Viết test `tests/scrapers/social/twitter/crawler-social-graph.test.js`.

### Completion Notes

- Đã triển khai đầy đủ 8 action social graph & bookmarking trong `TwitterCrawler`.
- Tự động resolve `username` hoặc URL profile sang numeric `userId` qua `UserByScreenName`.
- Tích hợp write safety: `gaussianDelay(2000, 5000)` cho social REST và `gaussianDelay(1000, 3000)` cho bookmark GraphQL; `dryRun=true` mặc định; rate governor checks.
- Xử lý lỗi idempotent cho cả REST friendships/blocks/mutes và GraphQL bookmarks.
- Cập nhật deprecation annotations và bảng mapping trong `docs/deprecation-plan.md`.
- Toàn bộ 13/13 tests mới và 89/89 tests của Twitter hybrid crawler đều pass 100%.

### Change Log

- 2026-08-30: Hoàn thành triển khai Story 13.2.9 (Social graph actions, bookmarking, validator updates, legacy deprecation, acceptance tests).

### File List

#### UPDATE
- `src/scrapers/social/twitter/crawler.js` — thêm 8 action handlers và helpers `#resolveTargetUserId`, `#performRestSocialAction`
- `src/scrapers/social/twitter/client.js` — hỗ trợ body form-url-encoded serialization trong `requestRest`
- `src/scrapers/social/twitter/validator.js` — bổ sung bookmark mutation và REST response payload validation
- `src/client/Scraper.js` — thêm `@deprecated` cho `followUser`, `unfollowUser`
- `src/client/api/users.js` — thêm `@deprecated` cho `followUser`, `unfollowUser`
- `src/scrapers/twitter/http/engagement.js` — thêm `@deprecated` cho các social graph functions
- `docs/deprecation-plan.md` — cập nhật status tracker và mapping table
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — cập nhật `13-2-9` sang `review`

#### NEW
- `tests/scrapers/social/twitter/crawler-social-graph.test.js` — acceptance test suite cho 8 social graph actions
