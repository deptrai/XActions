---
story_id: '13.2.10'
epic: 13
story_key: '13-2-10-twitter-hybrid-direct-messaging'
status: "review"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "9817e8ceb137f5881ac500fa02c08129745415a1"
---

# Story 13.2.10 — Twitter Hybrid Direct Messaging

Status: review

## Story

As a **Twitter Community Manager & Growth Operator**,  
I want **gửi tin nhắn trực tiếp (`send_dm`), đọc danh sách hội thoại (`dm_conversations`), và đọc tin nhắn chi tiết (`dm_messages`) qua `TwitterCrawler` kiến trúc hybrid**,  
so that **tôi có thể tự động hóa outreach và chăm sóc khách hàng/leads an toàn mà không cần mở trình duyệt**.

---

## Scope Note

Story 13.2.10 triển khai các action Direct Messaging (DM) cho `TwitterCrawler`:
1. `send_dm` (mutation / write): Gửi tin nhắn trực tiếp tới `userId` (hoặc `username`/profile URL).
   - Endpoint REST: `POST /1.1/dm/new2.json`
   - Hỗ trợ tham số: `userId`, `username`, `text`, `mediaId`, `conversationId`, `dryRun`.
   - Kiểm tra quyền nhận tin nhắn (`can_dm`) trước khi gửi (khi gửi qua username). Nếu người nhận không cho phép nhận tin nhắn từ người lạ, trả về `PlatformError` với `code: 'TWITTER_DM_NOT_ALLOWED'`.
2. `dm_conversations` (query / read): Lấy danh sách các cuộc hội thoại trong hộp thư DM.
   - Endpoint REST: `GET /1.1/dm/inbox_initial_state.json`
   - Hỗ trợ tham số: `limit`, `cursor`.
3. `dm_messages` (query / read): Lấy lịch sử tin nhắn trong một cuộc hội thoại cụ thể.
   - Endpoint REST: `GET /1.1/dm/conversation/{conversationId}.json`
   - Hỗ trợ tham số: `conversationId`, `limit`, `cursor`.

### Yêu cầu kiến trúc & An toàn:
- Toàn bộ action DM bắt buộc `requiresAuth: true`, `category: 'social'`.
- `dryRun=true` mặc định cho action `send_dm` để tránh gửi tin nhắn ngoài ý muốn.
- Delay floor cho write `send_dm`: **5–15s** (`gaussianDelay(5000, 15000)`).
- Delay floor cho read (`dm_conversations`, `dm_messages`): **1–3s** (`gaussianDelay(1000, 3000)`).
- Chuẩn hóa đầu ra `send_dm` thành `{ success: boolean, messageId: string, createdAt: string }` hoặc `{ success: true, dryRun: true }` khi ở chế độ dry-run.
- Chuẩn hóa đầu ra `dm_conversations` và `dm_messages` theo format object rõ ràng kèm phân trang `cursor` / `has_next_page`.
- Tuân thủ Rate Governor (`governor.canAccountRequest`) và Sticky Proxy per accountId.
- Gắn chú thích `@deprecated` cho các hàm legacy DM trong `src/client/Scraper.js`, `src/client/api/dms.js`, và `src/scrapers/twitter/http/dm.js`.
- Cập nhật `docs/deprecation-plan.md`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.10 [dòng 552-563]
- `_bmad-output/planning-artifacts/prd.md` — FR-71, NFR-11/12/13/16 [dòng 79, 114-120]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-3, AD-11, AD-13, AD-14
- `_bmad-output/implementation-artifacts/13-2-9-twitter-hybrid-social-graph-follow-block-mute-bookmark.md` — mẫu phân giải username qua `UserByScreenName`, REST request handling
- `src/core/base-crawler.js` — `AbstractCrawler.registerAction`, `ActionDescriptor`
- `src/core/base-client.js` — `AbstractApiClient.requestRest`
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`
- `src/scrapers/social/twitter/client.js` — `TwitterClient`, `resolveUsername`
- `src/scrapers/social/twitter/crawler.js` — `TwitterCrawler`
- `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator`
- `src/scrapers/twitter/http/endpoints.js` — `REST.dmNew`, `REST.dmInbox`, `REST.dmConversation`, `REST.dmDestroy`
- `src/scrapers/twitter/http/dm.js` — legacy DM implementation (`sendDM`, `getInbox`, `getConversation`)
- `src/client/Scraper.js` — legacy `sendDm`, `sendDmToUser`, `getDmConversations`, `getDmMessages`
- `src/client/api/dms.js` — legacy DM API client
- `docs/deprecation-plan.md` — legacy-to-hybrid mapping và status tracker

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2.8 / 13.2.9:** `TwitterCrawler` base action architecture, REST mutation pattern, `UserByScreenName` query helper.
- **Mở khóa Story 13.2.11 (List Management)**.
- **Mở khóa Story 13.2.12 (Integration & Caller Migration)**.

---

## Acceptance Criteria

### AC-1: Đăng ký 3 action DM trong `TwitterCrawler`

* **Given** `TwitterCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** crawler được khởi tạo
* **Then** 3 action sau được đăng ký với descriptor chuẩn `ActionDescriptor` (`snake_case`):

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth | category |
|---|---|---|---|---|---|---|
| `send_dm` | `[]` (cần `userId` hoặc `username`, kèm `text`) | `['userId', 'username', 'text', 'mediaId', 'conversationId', 'dryRun']` | `{ username: 'elonmusk', text: 'Hello', dryRun: false }` | `{ success: boolean, messageId?: string, createdAt?: string }` | `true` | `social` |
| `dm_conversations` | `[]` | `['limit', 'cursor']` | `{ limit: 20 }` | `{ conversations: object[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }` | `true` | `social` |
| `dm_messages` | `['conversationId']` | `['limit', 'cursor']` | `{ conversationId: '123-456', limit: 50 }` | `{ messages: object[], pageInfo: { has_next_page: boolean, end_cursor: string | null } }` | `true` | `social` |

* **And** `listActions()` trả về danh sách chứa đủ 3 actions với `requiresAuth: true`.

### AC-2: Quyền nhận tin nhắn & User Resolution (`send_dm`)

* **Given** gọi action `send_dm`
* **When** truyền `args.username` (hoặc profile URL)
* **Then** handler tra cứu `UserByScreenName` để lấy `rest_id` và kiểm tra thuộc tính `can_dm` (hoặc legacy `can_dm`).
* **And** nếu người nhận không cho phép nhận tin nhắn từ người gửi (`can_dm === false`), throw `PlatformError` với `code: 'TWITTER_DM_NOT_ALLOWED'`, `type: ErrorTypes.INVALID_ARGS`, `statusCode: 403`, `suggestedAction: SuggestedActions.CONTACT_SUPPORT`.
* **When** thiếu cả `userId` lẫn `username` (hoặc text rỗng / whitespace-only)
* **Then** throw `PlatformError` với `code: 'XACT_4001'`, `type: ErrorTypes.INVALID_ARGS`.

### AC-3: Gửi Direct Message (REST `POST /1.1/dm/new2.json`)

* **Given** `userId` hoặc `conversationId` hợp lệ và `dryRun: false`
* **When** `send_dm` được thực thi
* **Then** gửi request `POST /1.1/dm/new2.json` qua `TwitterClient.requestRest` với headers `content-type: application/json` và JSON payload:
  - Nếu có `conversationId`: `{ conversation_id: conversationId, text, cards_platform: 'Web-12', include_cards: 1, include_quote_count: true, dm_users: false, request_id: UUID }`
  - Nếu gửi theo `userId`: `{ conversation_id: `${userId}-${myUserId}` hoặc `${userId}`, recipient_ids: [userId], text, cards_platform: 'Web-12', include_cards: 1, include_quote_count: true, dm_users: false, request_id: UUID }`
  - Nếu có `mediaId`: đính kèm `attachment: { type: 'media', media: { id: mediaId } }`
* **And** trả về `{ success: true, messageId, createdAt }`.

### AC-4: Đọc Hộp Thư & Hội Thoại (`dm_conversations`, `dm_messages`)

* **Given** action `dm_conversations` hoặc `dm_messages`
* **When** gọi `dm_conversations({ limit, cursor })`
* **Then** gửi `GET /1.1/dm/inbox_initial_state.json` và phân tích danh sách hội thoại kèm thông tin đối phương (username, name, avatar, lastMessage).
* **When** gọi `dm_messages({ conversationId, limit, cursor })`
* **Then** gửi `GET /1.1/dm/conversation/{conversationId}.json` và trích xuất danh sách tin nhắn (id, text, senderId, createdAt, media).
* **And** trả về kết quả chuẩn hóa kèm `pageInfo: { has_next_page: boolean, end_cursor: string | null }`.

### AC-5: Dry-Run Gate & Safety Delays

* **Given** gọi `send_dm` với `dryRun` không truyền hoặc `dryRun: true`
* **Then** validate arguments, log `[DRY RUN] send_dm: ...` và trả về `{ success: true, dryRun: true }` mà không gửi request mạng.
* **Given** live `send_dm` (`dryRun: false`)
* **Then** áp dụng delay an toàn 5–15s (`gaussianDelay(5000, 15000)`).
* **And** kiểm tra `governor.canAccountRequest(accountId, 'twitter')`.
* **And** không để lộ cookie hay token trong log.

### AC-6: Deprecation Markers & Plan

* **Given** các module và hàm legacy liên quan tới DM
* **When** triển khai xong Story 13.2.10
* **Then** gắn `@deprecated` cho:
  - `src/client/Scraper.js`: `sendDm`, `sendDmToUser`, `getDmConversations`, `getDmMessages`
  - `src/client/api/dms.js`: `sendDm`, `sendDmToUser`, `getDmConversations`, `getDmMessages`
  - `src/scrapers/twitter/http/dm.js`: `sendDM`, `sendDMByUsername`, `getInbox`, `getConversation`, `deleteDM`
* **And** cập nhật `docs/deprecation-plan.md` với status `deprecated-marked` cho Twitter Legacy Direct Messaging.

### AC-7: Test Suite Coverage

* **Given** Vitest test suite `tests/scrapers/social/twitter/crawler-dm.test.js`
* **When** chạy kiểm thử
* **Then** pass toàn bộ các trường hợp:
  - Đăng ký 3 actions với đúng descriptor
  - `send_dm` kiểm tra recipient `can_dm` và ném `TWITTER_DM_NOT_ALLOWED` khi bị chặn
  - `send_dm` gửi payload JSON đúng format tới `/1.1/dm/new2.json`
  - `dm_conversations` trích xuất và chuẩn hóa hội thoại từ `inbox_initial_state.json`
  - `dm_messages` trích xuất tin nhắn từ `conversation/{id}.json`
  - dryRun=true không gọi mạng
  - Kiểm tra `@deprecated` annotations trong source code

---

## Dev Notes / Implementation Hints

### 1. Phân biệt JSON Payload và Form-Urlencoded
- Các REST endpoint thông thường của Twitter dùng `application/x-www-form-urlencoded`.
- Riêng `dm/new2.json` nhận `application/json` (hoặc JSON string). Trong `TwitterClient.requestRest`, cần hỗ trợ truyền `headers: { 'content-type': 'application/json' }` và `json: payload` (hoặc body JSON string) để got-scraping không tự động encode sang form URL.

### 2. Trích xuất `can_dm` trong `UserByScreenName`
Trong GraphQL response của `UserByScreenName`:
```js
const userResult = response?.user?.result;
const canDm = userResult?.legacy?.can_dm ?? userResult?.can_dm ?? true;
```

### 3. Response Validator
Cập nhật `TwitterPlatformResponseValidator.isValidPayload()` để nhận diện cấu trúc response DM:
- `data.inbox_initial_state` hoặc `data.conversation` hoặc `data.event` hoặc `data.entries`.

---

## Tasks / Subtasks

- [x] Task 1 (AC-1, AC-7): Đăng ký 3 actions trong `TwitterCrawler`
  - [x] 1.1 Đăng ký `send_dm` với `optionalArgs: ['userId', 'username', 'text', 'mediaId', 'conversationId', 'dryRun']`, `category: 'social'`, `requiresAuth: true`
  - [x] 1.2 Đăng ký `dm_conversations` và `dm_messages` với descriptor chuẩn
- [x] Task 2 (AC-2, AC-3, AC-5): Triển khai Handler `send_dm`
  - [x] 2.1 Viết logic kiểm tra recipient và quyền `can_dm`
  - [x] 2.2 Viết logic gửi JSON payload tới `/1.1/dm/new2.json`
  - [x] 2.3 Tích hợp `gaussianDelay(5000, 15000)` và dry-run gate
- [x] Task 3 (AC-4): Triển khai Handlers `dm_conversations` và `dm_messages`
  - [x] 3.1 Handler `dm_conversations` gọi `inbox_initial_state.json` và chuẩn hóa danh sách hội thoại
  - [x] 3.2 Handler `dm_messages` gọi `conversation/{conversationId}.json` và chuẩn hóa tin nhắn
  - [x] 3.3 Tích hợp `gaussianDelay(1000, 3000)`
- [x] Task 4 (AC-6): Đánh dấu Deprecation
  - [x] 4.1 Thêm `@deprecated` vào `src/client/Scraper.js` và `src/client/api/dms.js`
  - [x] 4.2 Thêm `@deprecated` vào `src/scrapers/twitter/http/dm.js`
  - [x] 4.3 Cập nhật `docs/deprecation-plan.md`
- [x] Task 5 (AC-7): TDD Tests & Hoàn thiện
  - [x] 5.1 Tạo `tests/scrapers/social/twitter/crawler-dm.test.js`
  - [x] 5.2 Chạy pass test suite và kiểm tra regression toàn bộ Twitter crawlers (99/99 tests passed)
  - [x] 5.3 Cập nhật status story sang `review` và sync `sprint-status.yaml`

---

## Dev Agent Record

### Implementation Plan

1. Đăng ký 3 action (`send_dm`, `dm_conversations`, `dm_messages`) trong constructor `TwitterCrawler`.
2. Mở rộng `TwitterPlatformResponseValidator` để nhận diện các response DM (`inbox_initial_state`, `entries`, `event`).
3. Triển khai phương thức `#resolveDmRecipient` (resolve username + validate `can_dm`).
4. Triển khai các phương thức `sendDm`, `dmConversations`, `dmMessages` trong `crawler.js`.
5. Đánh dấu deprecation trong `src/client/Scraper.js`, `src/client/api/dms.js`, `src/scrapers/twitter/http/dm.js`.
6. Cập nhật `docs/deprecation-plan.md`.
7. Viết test suite `tests/scrapers/social/twitter/crawler-dm.test.js`.

### Completion Notes

- Đã triển khai đầy đủ 3 action Direct Messaging trong `TwitterCrawler`: `send_dm`, `dm_conversations`, `dm_messages`.
- Tự động kiểm tra quyền `can_dm` khi gửi tới username; ném `TWITTER_DM_NOT_ALLOWED` khi người nhận chặn tin nhắn.
- Tích hợp write safety: `gaussianDelay(5000, 15000)` cho `send_dm`, `dryRun=true` mặc định, rate governor check.
- Hỗ trợ JSON payload formatting trong `TwitterClient.requestRest` cho `/1.1/dm/new2.json`.
- Cập nhật deprecation annotations trong `Scraper.js`, `api/dms.js`, `http/dm.js` và bảng mapping trong `docs/deprecation-plan.md`.
- Toàn bộ 10/10 tests DM mới và 99/99 tests của toàn bộ Twitter Hybrid Crawler đều pass 100%.

### Change Log

- 2026-08-30: Hoàn thành triển khai Story 13.2.10 (Direct Messaging actions, can_dm privacy check, inbox/conversation extraction, validator updates, legacy deprecation, acceptance tests).

### File List

#### UPDATE
- `src/scrapers/social/twitter/crawler.js` — thêm 3 action DM handlers
- `src/scrapers/social/twitter/validator.js` — mở rộng payload validation cho DM responses
- `src/scrapers/social/twitter/client.js` — tinh chỉnh `requestRest` hỗ trợ JSON payload
- `src/client/Scraper.js` — thêm `@deprecated` cho các DM methods
- `src/client/api/dms.js` — thêm `@deprecated` cho các DM methods
- `src/scrapers/twitter/http/dm.js` — thêm `@deprecated` cho DM operations
- `docs/deprecation-plan.md` — cập nhật status tracker và mapping table
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — cập nhật `13-2-10` sang `review`

#### NEW
- `tests/scrapers/social/twitter/crawler-dm.test.js` — test suite cho Direct Messaging actions
