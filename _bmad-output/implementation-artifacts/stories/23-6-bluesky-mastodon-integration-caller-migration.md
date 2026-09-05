---
title: 'Story 23.6: Bluesky & Mastodon Integration & Caller Migration'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 1
baseline_commit: '88d590d0'
context:
  - _bmad-output/implementation-artifacts/epic-23-context.md
  - _bmad-output/implementation-artifacts/stories/23-2-bluesky-hybrid-crawler.md
  - _bmad-output/implementation-artifacts/stories/23-4-mastodon-hybrid-crawler.md
  - src/scrapers/index.js
  - src/scrapers/social/index.js
  - package.json
  - docs/deprecation-plan.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sau khi hoàn thành `BlueskyCrawler` (Story 23.2) và `MastodonCrawler` (Story 23.4), `src/scrapers/index.js` vẫn đang sử dụng module legacy `src/scrapers/mastodon/index.js` cho platform `mastodon`/`masto`. Trong `package.json`, export `./scrapers/social` chưa re-export mastodon hybrid classes và các legacy modules `src/scrapers/bluesky/index.js`, `src/scrapers/mastodon/index.js` chưa được gắn `@deprecated` cũng như chưa cập nhật vào `docs/deprecation-plan.md`.

**Approach:**
1. **Dispatcher Migration trong `src/scrapers/index.js`**:
   - Thêm import `MastodonCrawler` và `MastodonClient` từ `./social/mastodon/index.js`.
   - Re-export `MastodonCrawler` và `MastodonClient` ở top-level named exports, kèm factory helpers `createMastodonClient(options)` và `createMastodonCrawler(client, options)` đồng nhất với Facebook.
   - Thêm nhánh dispatch hybrid cho `platformName === 'mastodon' || platformName === 'masto'` trong hàm `scrape()`, mapping các actions (`profile`, `followers`, `following`, `tweets`/`posts`/`feed`/`user_feed`, `search`, `hashtag`, `trending`) tương tự như cách Bluesky đã được xử lý ở Story 23.2.
   - Xóa bỏ dead code `needsClient` cũ của mastodon trong `scrape()` (dòng 1507 và khối 1587-1608).
   - Cập nhật JSDoc comment của `scrape()` hướng dẫn định dạng gọi chuẩn.
2. **Barrel Exports trong `src/scrapers/social/index.js`**:
   - Export `* as mastodon from './mastodon/index.js'`.
   - Export `{ MastodonClient, MastodonCrawler, MastodonPlatformResponseValidator } from './mastodon/index.js'`.
3. **Package Exports trong `package.json`**:
   - Bổ sung export subpath `./scrapers/social/mastodon` và `./scrapers/social/bluesky`, đảm bảo consumer có thể import trực tiếp.
4. **Deprecation Markers & Documentation**:
   - Gắn `@deprecated` JSDoc vào `src/scrapers/bluesky/index.js` và `src/scrapers/mastodon/index.js`.
   - Cập nhật bảng Status Tracker trong `docs/deprecation-plan.md` cho Bluesky và Mastodon legacy sang `deprecated-marked`.
5. **E2E & Dispatcher Tests**:
   - Tạo test suite `tests/scrapers/social/mastodon/dispatcher.test.js` sử dụng mock HTTP server cục bộ (`node:http` port 0) kiểm chứng `scrape('mastodon', action, options)` và alias `scrape('masto', ...)` dispatch chính xác tới `MastodonCrawler`.
   - Chạy toàn bộ test suites của Bluesky và Mastodon để đảm bảo zero regression.

## Boundaries & Constraints

**Always:**
- Giữ 100% khả năng tương thích ngược cho chữ ký `scrape(platform, action, options)`.
- Ánh xạ các action aliases phổ biến của người dùng:
  - `posts`, `tweets`, `timeline`, `feed`, `user_feed` -> `posts`
  - `hashtag`, `tag` -> `hashtag`
  - `search` -> `search`
- Dọn sạch dead code: xóa hoàn toàn biến `needsClient` và nhánh `if (needsClient)` cũ trong `src/scrapers/index.js`.
- Bổ sung cả hai factory function `createMastodonClient` và `createMastodonCrawler` ở cuối file `src/scrapers/index.js`.
- Tuân thủ quy tắc Pure ESM, không thêm dependency ngoài.
- Kiểm thử dispatcher bằng server HTTP cục bộ (`node:http` port 0) tương tự `tests/scrapers/social/bluesky/dispatcher.test.js` để test chạy nhanh, độc lập mạng.

**Ask First:**
- Nếu cần gỡ bỏ hoàn toàn file `src/scrapers/mastodon/index.js` hoặc `src/scrapers/bluesky/index.js` (việc này thuộc Epic 26 - Final Legacy Decommission).
- Nếu cần thay đổi CLI commands hiện có.

**Never:**
- Không sửa logic xử lý core trong `src/core/base-crawler.js` hay `src/core/base-client.js`.
- Không làm gãy các callers hiện có của `scrape('bluesky', ...)` hoặc các platform khác.

## I/O & Edge-Case Matrix

| Scenario | Input / Invocation | Expected Output / Behavior | Error Handling |
|----------|-------------------|---------------------------|----------------|
| Mastodon profile via scrape() | `scrape('mastodon', 'profile', { username: 'Gargron', baseUrl: localUrl })` | Trả về `ProfileItem` qua `MastodonCrawler.getProfile` | 404 -> `PlatformError (XACT_4001)` |
| Mastodon alias "masto" | `scrape('masto', 'posts', { username: 'Gargron', baseUrl: localUrl })` | Dispatches tới `MastodonCrawler` action `posts` | Invalid username -> `XACT_4001` |
| Mastodon hashtag via scrape() | `scrape('mastodon', 'hashtag', { hashtag: 'tech', baseUrl: localUrl })` | Trả về `PostItem[]` qua `MastodonCrawler.getHashtag` | Empty hashtag -> `XACT_4001` |
| Mastodon trending via scrape() | `scrape('mastodon', 'trending', { limit: 10, baseUrl: localUrl })` | Trả về `PostItem[]` qua `MastodonCrawler.getTrending` | Instance without trends -> `[]` |
| Unknown action for mastodon | `scrape('mastodon', 'invalid_action', {})` | Ném `Error` thông báo action không khả dụng | Clear error message với danh sách actions |
| Bluesky profile via scrape() | `scrape('bluesky', 'profile', { username: 'user.bsky.social' })` | Vẫn hoạt động ổn định qua `BlueskyCrawler` | Zero regression |

</frozen-after-approval>

## Code Map

- `src/scrapers/index.js`:
  - Dòng 67-68: Import hiện tại của Bluesky (`BlueskyCrawler`, `BlueskyClient`).
  - Dòng 1073-1171: Nhánh dispatch hybrid của Bluesky (mẫu tham khảo chính xác).
  - Dòng 1507 & 1587-1608: `needsClient` cũ gọi `mastodon.createClient` -> Cần xóa bỏ dead code này sau khi thêm nhánh hybrid `MastodonCrawler`.
  - Dòng 1693-1716: Re-exports `FacebookCrawler`, `FacebookClient`, `BlueskyCrawler`, `BlueskyClient` -> Thêm `MastodonCrawler`, `MastodonClient`, `createMastodonClient`, `createMastodonCrawler`.
- `src/scrapers/social/index.js`:
  - Barrel export cho social modules.
- `package.json`:
  - `exports` map cho social scrapers.
- `docs/deprecation-plan.md`:
  - Status tracker cho legacy code.
- `tests/scrapers/social/bluesky/dispatcher.test.js`:
  - Test mẫu cho việc kiểm thử universal dispatcher với local HTTP server.

## Tasks & Acceptance

### Task 1: `src/scrapers/social/index.js`
- [x] Export `* as mastodon from './mastodon/index.js'`.
- [x] Re-export `{ MastodonClient, MastodonCrawler, MastodonPlatformResponseValidator } from './mastodon/index.js'`.

### Task 2: `package.json`
- [x] Bổ sung export subpath:
  - `"./scrapers/social/mastodon": "./src/scrapers/social/mastodon/index.js"`
  - `"./scrapers/social/bluesky": "./src/scrapers/social/bluesky/index.js"`

### Task 3: `src/scrapers/index.js`
- [x] Import `MastodonCrawler` và `MastodonClient` từ `./social/mastodon/index.js`.
- [x] Cập nhật JSDoc ví dụ ở dòng 22 và dòng 398.
- [x] Thêm nhánh dispatch hybrid cho `platformName === 'mastodon' || platformName === 'masto'`:
  - Action map: `profile`, `followers`, `following`, `posts`, `tweets`, `timeline`, `feed`, `user_feed`, `search`, `hashtag`, `trending`.
  - Phân giải options (`username`, `handle`, `target`, `query`, `hashtag`, `limit`, `max_id`, `since_id`, `instance`, `accessToken`, `baseUrl`).
  - Khởi tạo `MastodonClient` và `MastodonCrawler`, gọi `await crawler.start()`, auto cleanup trong `finally`.
- [x] Xóa bỏ biến `needsClient` ở dòng 1507 và khối `if (needsClient)` ở dòng 1587-1608.
- [x] Bổ sung helper functions:
  ```javascript
  export function createMastodonClient(options = {}) {
    return new MastodonClient(options);
  }
  export function createMastodonCrawler(client, options = {}) {
    return new MastodonCrawler({ client, ...options });
  }
  ```
- [x] Re-export `MastodonCrawler`, `MastodonClient`, `createMastodonClient`, `createMastodonCrawler` ở named exports cuối file.

### Task 4: Deprecation Markers & Docs
- [x] Gắn `@deprecated` JSDoc vào `src/scrapers/bluesky/index.js` dẫn link tới `src/scrapers/social/bluesky/`.
- [x] Gắn `@deprecated` JSDoc vào `src/scrapers/mastodon/index.js` dẫn link tới `src/scrapers/social/mastodon/`.
- [x] Cập nhật `docs/deprecation-plan.md` thêm 2 dòng cho Bluesky Legacy và Mastodon Legacy trong bảng Status Tracker với trạng thái `deprecated-marked`.

### Task 5: Dispatcher Unit Tests
- [x] Tạo `tests/scrapers/social/mastodon/dispatcher.test.js`:
  - Dùng `node:http` tạo mock server cục bộ.
  - Test `scrape('mastodon', 'profile')` dispatches tới `MastodonCrawler`.
  - Test `scrape('masto', 'trending')` hỗ trợ alias `masto`.
  - Test `scrape('mastodon', 'posts')` và `scrape('mastodon', 'hashtag')`.
  - Test ném lỗi khi gọi action không hợp lệ.

**Acceptance Criteria:**
- Given `scrape('mastodon', 'profile', { username: 'Gargron', baseUrl: serverUrl })`, when invoked, then it dispatches through `MastodonCrawler` and returns a valid `ProfileItem`.
- Given `scrape('masto', 'trending', { baseUrl: serverUrl })`, when invoked with alias `masto`, then it dispatches through `MastodonCrawler`.
- Given `package.json`, when checking exports, then `./scrapers/social/mastodon` and `./scrapers/social/bluesky` are available.
- Given `src/scrapers/bluesky/index.js` and `src/scrapers/mastodon/index.js`, then they have `@deprecated` tags.
- Given `tests/scrapers/social/mastodon/dispatcher.test.js`, when running `npx vitest run`, then all tests pass.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/mastodon/dispatcher.test.js`
- `npx vitest run tests/scrapers/social/bluesky/dispatcher.test.js`
- `npx vitest run tests/scrapers/social/`

### Review Findings (2026-09-05)

#### decision-needed
- [x] [Review][Decision] Should `scrape('mastodon', 'trends', ...)` be added as an alias for `trending`? — Blind Hunter notes that `trends` is common Mastodon API terminology but only `trending` is mapped. Spec boundary says "trending", not "trends".

#### patch
- [x] [Review][Patch] `options.limit` non-numeric/NaN leaves `mappedArgs.limit` unvalidated and can send `limit=NaN` to API [src/scrapers/index.js:1235-1241]
- [x] [Review][Patch] `hashtag` action does not fall back to `options.url` for target resolution [src/scrapers/index.js:1213]
- [x] [Review][Patch] `instance` resolution does not consider `options.url` for standalone instance URLs [src/scrapers/index.js:1214]
- [x] [Review][Patch] `MASTODON_ACTION_MAP` lookup is not normalized for case/whitespace [src/scrapers/index.js:1202]
- [x] [Review][Patch] `createMastodonCrawler(client, options)` treats a plain options object as `client` [src/scrapers/index.js:1811-1813]
- [x] [Review][Patch] Legacy function names (`scrapeProfile`, `scrapeTweets`, etc.) no longer dispatch after dead-code removal [src/scrapers/index.js:1584-1608] — intentional or needs migration?
- [x] [Review][Patch] Legacy `./scrapers/bluesky` and `./scrapers/mastodon` package exports still point to deprecated modules [package.json:21-22]
- [x] [Review][Patch] `platforms.mastodon` / `platforms.bluesky` still expose legacy modules [src/scrapers/index.js:140-145]
- [x] [Review][Patch] Default export still binds legacy `mastodon` and `bluesky` modules instead of hybrid [src/scrapers/index.js:1778-1779]
- [x] [Review][Patch] Missing `createBlueskyClient` / `createBlueskyCrawler` factory helpers [src/scrapers/index.js]
- [x] [Review][Patch] `types/index.d.ts` does not declare new Story 23.6 exports (`MastodonClient`, `MastodonCrawler`, etc.) [types/index.d.ts]
- [x] [Review][Patch] JSDoc `@param {import('../types/xactions.js').XActionsOptions}` points to non-existent file [src/scrapers/index.js:187,391]
- [x] [Review][Patch] Mastodon dispatcher test reaches external `mastodon.social` when `target` is a URL [tests/scrapers/social/mastodon/dispatcher.test.js:209]
- [x] [Review][Patch] Several `scrape('mastodon', ...)` argument branches lack coverage (`since_id`, `type`, `cursor`, direct `exclude_replies`, `autoClose: false`, custom `options.client`) [tests/scrapers/social/mastodon/dispatcher.test.js]

#### defer
- [x] [Review][Defer] `src/scrapers/social/mastodon/index.js` barrel omits `createMastodonClient` and `createMastodonCrawler` — pre-existing factory pattern inconsistency, not a regression.

### Review Findings — Re-review (2026-09-05)

#### decision-needed
- [ ] [Review][Decision] Legacy `platforms.bluesky` / `platforms.mastodon` throw hard errors instead of warning per deprecation plan — `docs/deprecation-plan.md` Phase 1 says "Mark & Warn", not "Error on Import". Do you want to keep the throwers (treat as Phase 2) or switch to `console.warn` + deprecated proxy? [src/scrapers/index.js:147-150, default export]

#### patch
- [ ] [Review][Patch] `options.url` with non-profile paths (e.g. hashtag/tag URLs) throws "Invalid Mastodon profile URL format" because `resolveMastodonTarget` is called unconditionally before checking `mappedAction` [src/scrapers/index.js:1228-1236]
- [ ] [Review][Patch] `options.client` with custom `baseUrl` is ignored for `mappedArgs.instance` when `options.instance`/`baseUrl` are omitted, falling back to `mastodon.social` and sending wrong `instance` argument to crawler [src/scrapers/index.js:1237-1253]
- [ ] [Review][Patch] `createMastodonCrawler(client, options)` accepts a plain options object as first param but `createBlueskyCrawler` does not; signatures are inconsistent and the type declaration only allows `MastodonClient` [src/scrapers/index.js:1851-1855, types/index.d.ts:813]
- [ ] [Review][Patch] `BlueskyClient.close()` and `MastodonClient.close()` declared in `types/index.d.ts` but do not exist at runtime [types/index.d.ts:787,800]
- [ ] [Review][Patch] `BlueskyClient.login()` declared to return `Promise<Record<string, unknown>>` but actually returns `Promise<string>` (accessJwt) [types/index.d.ts:784]
- [ ] [Review][Patch] JSDoc `@param {import('../types/index.d.ts').XActionsOptions}` references a file that does not export `XActionsOptions`; correct path is `../types/xactions.d.ts` [src/scrapers/index.js:191,400]
- [ ] [Review][Patch] Legacy imports `bluesky` and `mastodon` in `src/scrapers/index.js` are now unused after `platforms`/`default` replaced with throwers, creating dead code [src/scrapers/index.js:41-42]
- [ ] [Review][Patch] `MastodonCrawler`/`MastodonClient` imported directly from `crawler.js`/`client.js` instead of the spec-required barrel `./social/mastodon/index.js` [src/scrapers/index.js:71-76]
- [ ] [Review][Patch] Dispatcher mock server does not assert `limit`, `max_id`, or `Authorization` header in the `posts` test, so parameter normalization (`count`→`limit`, `token`→`accessToken`, `max_id`) is not actually verified [tests/scrapers/social/mastodon/dispatcher.test.js:267-278]
- [ ] [Review][Patch] CLI pagination/reply options (`cursor`, `since_id`, `includeReplies`) for `scrape('mastodon','posts',...)` lack dispatcher test coverage [tests/scrapers/social/mastodon/dispatcher.test.js]
- [ ] [Review][Patch] No test verifies the legacy `platforms.mastodon`/`platforms.bluesky` throwers emit the migration message [tests/scrapers/social/mastodon/dispatcher.test.js]
- [ ] [Review][Patch] `createBlueskyClient` / `createBlueskyCrawler` factory helpers lack test coverage despite being newly exported [tests/scrapers/social/bluesky/dispatcher.test.js]

#### defer
- [ ] [Review][Defer] `types/index.d.ts` uses `Record<string, unknown>` for all hybrid client/crawler constructor deps; this is broad and pre-existing for Bluesky. Mastodon follows same pattern.

