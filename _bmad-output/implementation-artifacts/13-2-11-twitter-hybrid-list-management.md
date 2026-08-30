---
story_id: '13.2.11'
epic: 13
story_key: '13-2-11-twitter-hybrid-list-management'
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "45159b6cec4a6b57aa0f4ce5d1a0b58b60a866e2"
---

# Story 13.2.11 — Twitter Hybrid List Management

Status: ready-for-dev

## Story

As a **Twitter Community Manager & Growth Operator**,  
I want **tạo danh sách (`create_list`), thêm thành viên (`add_list_members`), và xoá thành viên (`remove_list_members`) qua `TwitterCrawler` kiến trúc hybrid**,  
so that **tôi có thể tự động hóa quy trình phân loại đối tượng (list curation) theo batch mà không cần mở trình duyệt**.

---

## Scope Note

Story 13.2.11 triển khai 3 action quản trị danh sách (List Management) cho `TwitterCrawler`:
1. `create_list` (mutation / write): Tạo mới danh sách Twitter.
   - Endpoint: REST `/1.1/lists/create.json` (hoặc GraphQL `CreateList` mutation)
   - Tham số: `name` (bắt buộc, max 25 chars), `description` (tùy chọn, max 100 chars), `isPrivate` (boolean, mặc định `false`), `dryRun`.
   - Trả về: `{ success: boolean, listId: string, name: string, isPrivate: boolean }` hoặc `{ success: true, dryRun: true }`.
2. `add_list_members` (mutation / write): Thêm danh sách người dùng vào một List.
   - Endpoint: REST `/1.1/lists/members/create_all.json` hoặc `/1.1/lists/members/create.json`
   - Hỗ trợ batching: Tự động chia nhỏ mảng `userIds` thành các batch tối đa **100 userIds** mỗi lượt gọi.
   - Hỗ trợ phân giải: Chấp nhận danh sách `userIds` hoặc `usernames` (tự động phân giải qua `UserByScreenName`).
   - Tham số: `listId` (bắt buộc), `userIds` hoặc `usernames` (mảng hoặc chuỗi phân cách bởi dấu phẩy), `dryRun`.
   - Trả về: `{ success: boolean, listId: string, addedCount: number, batchCount: number }`.
3. `remove_list_members` (mutation / write): Xoá người dùng khỏi một List.
   - Endpoint: REST `/1.1/lists/members/destroy_all.json` hoặc `/1.1/lists/members/destroy.json`
   - Hỗ trợ batching: Tự động chia nhỏ mảng `userIds` thành các batch tối đa **100 userIds** mỗi lượt gọi.
   - Hỗ trợ phân giải: Chấp nhận danh sách `userIds` hoặc `usernames`.
   - Tham số: `listId` (bắt buộc), `userIds` hoặc `usernames`, `dryRun`.
   - Trả về: `{ success: boolean, listId: string, removedCount: number, batchCount: number }`.

### Yêu cầu kiến trúc & An toàn:
- Toàn bộ action yêu cầu `requiresAuth: true`, `category: 'social'`.
- `dryRun=true` mặc định cho tất cả các action ghi danh sách.
- Delay floor cho write actions: **2–5s** giữa các batch (`gaussianDelay(2000, 5000)`).
- Kiểm tra Rate Governor (`governor.canAccountRequest`) và Sticky Proxy theo `accountId`.
- Gắn chú thích `@deprecated` cho các hàm legacy list trong `src/client/Scraper.js` và `src/client/api/lists.js`.
- Cập nhật `docs/deprecation-plan.md`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.11 [dòng 564-575]
- `_bmad-output/planning-artifacts/prd.md` — FR-71, NFR-11/12/13/16 [dòng 79, 114-120]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-3, AD-11, AD-13, AD-14
- `_bmad-output/implementation-artifacts/13-2-9-twitter-hybrid-social-graph-follow-block-mute-bookmark.md` — REST mutation pattern & user resolution
- `_bmad-output/implementation-artifacts/13-2-10-twitter-hybrid-direct-messaging.md` — DM & REST JSON handling
- `src/core/base-crawler.js` — `AbstractCrawler.registerAction`, `ActionDescriptor`
- `src/core/base-client.js` — `AbstractApiClient.requestRest`
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`
- `src/scrapers/social/twitter/client.js` — `TwitterClient`
- `src/scrapers/social/twitter/crawler.js` — `TwitterCrawler` (đã có `list_members` read action từ 13.2.5)
- `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator`
- `src/scrapers/twitter/http/endpoints.js` — `REST` definitions
- `src/client/Scraper.js` — legacy `getListTweets`, `getListMembers`, `getListById`
- `src/client/api/lists.js` — legacy list API functions
- `docs/deprecation-plan.md` — legacy-to-hybrid mapping và status tracker

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2.5:** Đã có action đọc `list_members`.
- **Phụ thuộc Story 13.2.9 / 13.2.10:** Mẫu xử lý REST payload, rate governor, user resolution.
- **Mở khóa Story 13.2.12:** Hoàn tất toàn bộ sub-stories của Epic 13.2 Twitter refactor và tiến hành Caller Migration.

---

## Acceptance Criteria

### AC-1: Đăng ký 3 action List Management trong `TwitterCrawler`

* **Given** `TwitterCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** crawler được khởi tạo
* **Then** 3 action sau được đăng ký với descriptor chuẩn `ActionDescriptor` (`snake_case`):

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth | category |
|---|---|---|---|---|---|---|
| `create_list` | `['name']` | `['description', 'isPrivate', 'dryRun']` | `{ name: 'Tech Leaders', description: 'Curated list', isPrivate: false, dryRun: false }` | `{ success: boolean, listId?: string, name?: string }` | `true` | `social` |
| `add_list_members` | `['listId']` | `['userIds', 'usernames', 'dryRun']` | `{ listId: '12345678', usernames: ['elonmusk', 'sama'], dryRun: false }` | `{ success: boolean, listId: string, addedCount: number, batchCount: number }` | `true` | `social` |
| `remove_list_members` | `['listId']` | `['userIds', 'usernames', 'dryRun']` | `{ listId: '12345678', usernames: ['spammer'], dryRun: false }` | `{ success: boolean, listId: string, removedCount: number, batchCount: number }` | `true` | `social` |

* **And** `listActions()` trả về danh sách chứa đủ 3 actions với `requiresAuth: true`.

### AC-2: Handler `create_list`

* **Given** gọi `create_list` với `args.name`
* **When** `args.name` hợp lệ (non-empty, length <= 25) và `dryRun: false`
* **Then** gửi POST request tới REST `/1.1/lists/create.json` với payload:
  `{ name, description: description || '', mode: isPrivate ? 'private' : 'public' }`
* **And** trích xuất `id_str` hoặc `id` từ response và trả về `{ success: true, listId, name, isPrivate }`.
* **When** `name` rỗng hoặc vượt quá 25 ký tự
* **Then** throw `PlatformError` với `code: 'XACT_4001'`, `type: ErrorTypes.INVALID_ARGS`.

### AC-3: Batching & User Resolution cho `add_list_members` / `remove_list_members`

* **Given** gọi `add_list_members` hoặc `remove_list_members`
* **When** truyền danh sách `usernames`
* **Then** tự động phân giải từng `username` sang `userId` thông qua `UserByScreenName`.
* **When** tổng số lượng `userIds` > 100
* **Then** tự động chia thành các batch có kích thước tối đa 100 `userIds` mỗi lượt gọi.
* **And** mỗi batch được gửi tới endpoint tương ứng:
  - Add: `POST /1.1/lists/members/create_all.json` với form body `{ list_id: listId, user_id: 'id1,id2,id3...' }`
  - Remove: `POST /1.1/lists/members/destroy_all.json` với form body `{ list_id: listId, user_id: 'id1,id2,id3...' }`
* **And** áp dụng Gaussian delay 2–5s giữa các batch calls.

### AC-4: Dry-Run Gate & Safety

* **Given** bất kỳ action list nào với `dryRun` không truyền hoặc `dryRun: true`
* **Then** validate arguments, log `[DRY RUN] <action>: ...` và trả về kết quả mô phỏng mà không gọi request mạng thực tế.
* **Given** live action (`dryRun: false`)
* **Then** kiểm tra `governor.canAccountRequest(accountId, 'twitter')` trước mỗi network dispatch.

### AC-5: Deprecation Markers & Plan

* **Given** các module và hàm legacy liên quan tới Lists
* **When** triển khai xong Story 13.2.11
* **Then** gắn `@deprecated` cho:
  - `src/client/Scraper.js`: `getListTweets`, `getListMembers`, `getListById`
  - `src/client/api/lists.js`: `getListTweets`, `getListMembers`, `getListById`
- **And** cập nhật `docs/deprecation-plan.md` với status `deprecated-marked` cho Twitter Legacy List Management.

### AC-6: Test Suite Coverage

* **Given** Vitest test suite `tests/scrapers/social/twitter/crawler-lists.test.js`
* **When** chạy kiểm thử
* **Then** pass toàn bộ các test cases:
  - Đăng ký 3 action descriptors đúng
  - `create_list` validate tên và gửi POST tới `/1.1/lists/create.json`
  - `add_list_members` chunk 100 userIds và gửi tới `/1.1/lists/members/create_all.json`
  - `remove_list_members` gửi tới `/1.1/lists/members/destroy_all.json`
  - dryRun=true không gọi mạng
  - `@deprecated` tags xuất hiện đầy đủ

---

## Dev Notes / Implementation Hints

### 1. REST Endpoints bổ sung vào `src/scrapers/twitter/http/endpoints.js`
```js
listsCreate: '/1.1/lists/create.json',
listsMembersCreateAll: '/1.1/lists/members/create_all.json',
listsMembersDestroyAll: '/1.1/lists/members/destroy_all.json',
```

### 2. Chunking Helper
```js
function chunkArray(array, size = 100) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
```

### 3. Response Validator
Bổ sung `data.member_count !== undefined || data.subscriber_count !== undefined` hoặc `data.mode !== undefined` vào `TwitterPlatformResponseValidator.isValidPayload()` nếu cần.

---

## Tasks / Subtasks

- [ ] Task 1 (AC-1, AC-6): Đăng ký 3 actions List Management trong `TwitterCrawler`
  - [ ] 1.1 Thêm endpoints vào `src/scrapers/twitter/http/endpoints.js`
  - [ ] 1.2 Đăng ký `create_list`, `add_list_members`, `remove_list_members` trong `TwitterCrawler`
- [ ] Task 2 (AC-2, AC-4): Triển khai Handler `create_list`
  - [ ] 2.1 Validate tên danh sách (1-25 chars)
  - [ ] 2.2 Dispatch POST tới `/1.1/lists/create.json`
  - [ ] 2.3 Áp dụng `gaussianDelay(2000, 5000)` và dry-run gate
- [ ] Task 3 (AC-3, AC-4): Triển khai Handlers `add_list_members` và `remove_list_members`
  - [ ] 3.1 Hỗ trợ resolve danh sách usernames sang userIds
  - [ ] 3.2 Tự động batching thành các mảng 100 userIds
  - [ ] 3.3 Dispatch POST tới `lists/members/create_all.json` và `lists/members/destroy_all.json`
- [ ] Task 4 (AC-5): Đánh dấu Deprecation
  - [ ] 4.1 Thêm `@deprecated` vào `src/client/Scraper.js` và `src/client/api/lists.js`
  - [ ] 4.2 Cập nhật `docs/deprecation-plan.md`
- [ ] Task 5 (AC-6): TDD Tests & Hoàn thiện
  - [ ] 5.1 Tạo `tests/scrapers/social/twitter/crawler-lists.test.js`
  - [ ] 5.2 Chạy pass test suite và kiểm tra regression toàn bộ Twitter crawlers
  - [ ] 5.3 Cập nhật status story sang `review` và sync `sprint-status.yaml`

---

## Dev Agent Record

### Implementation Plan

1. Khai báo các endpoints REST cho List management trong `src/scrapers/twitter/http/endpoints.js`.
2. Đăng ký 3 actions (`create_list`, `add_list_members`, `remove_list_members`) trong `TwitterCrawler`.
3. Triển khai các phương thức `createList`, `addListMembers`, `removeListMembers` trong `crawler.js`.
4. Mở rộng `TwitterPlatformResponseValidator` nhận diện response của List objects.
5. Gắn `@deprecated` annotations trong `src/client/Scraper.js`, `src/client/api/lists.js`.
6. Cập nhật `docs/deprecation-plan.md`.
7. Viết test suite `tests/scrapers/social/twitter/crawler-lists.test.js`.

### Completion Notes

*(Để điền sau khi hoàn thành dev.)*

### File List

#### UPDATE
- `src/scrapers/social/twitter/crawler.js` — thêm 3 action List Management handlers
- `src/scrapers/social/twitter/validator.js` — mở rộng payload validation cho List responses
- `src/scrapers/twitter/http/endpoints.js` — bổ sung REST endpoints cho list mutations
- `src/client/Scraper.js` — thêm `@deprecated` cho các List methods
- `src/client/api/lists.js` — thêm `@deprecated` cho các List methods
- `docs/deprecation-plan.md` — cập nhật status tracker và mapping table
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — cập nhật `13-2-11` sang `ready-for-dev`

#### NEW
- `tests/scrapers/social/twitter/crawler-lists.test.js` — test suite cho List Management actions
