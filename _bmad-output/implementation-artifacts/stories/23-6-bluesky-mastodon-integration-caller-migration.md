---
title: 'Story 23.6: Bluesky & Mastodon Integration & Caller Migration'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 0
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
   - Re-export `MastodonCrawler` và `MastodonClient` ở top-level named exports.
   - Thêm nhánh dispatch hybrid cho `platformName === 'mastodon' || platformName === 'masto'` trong hàm `scrape()`, mapping các actions (`profile`, `followers`, `following`, `tweets`/`posts`/`feed`/`user_feed`, `search`, `hashtag`, `trending`) tương tự như cách Bluesky đã được xử lý ở Story 23.2.
   - Loại bỏ hoặc thu gọn nhánh `needsClient` cũ của mastodon trong `scrape()`.
2. **Barrel Exports trong `src/scrapers/social/index.js`**:
   - Export `* as mastodon from './mastodon/index.js'`.
   - Export `{ MastodonClient, MastodonCrawler, MastodonPlatformResponseValidator } from './mastodon/index.js'`.
3. **Package Exports trong `package.json`**:
   - Bổ sung export subpath `./scrapers/social/mastodon` và `./scrapers/social/bluesky` nếu chưa có, đảm bảo consumer có thể import trực tiếp.
4. **Deprecation Markers & Documentation**:
   - Gắn `@deprecated` JSDoc vào `src/scrapers/bluesky/index.js` và `src/scrapers/mastodon/index.js`.
   - Cập nhật bảng Status Tracker trong `docs/deprecation-plan.md` cho Bluesky và Mastodon legacy sang `deprecated-marked`.
5. **E2E & Dispatcher Tests**:
   - Tạo test suite `tests/scrapers/social/mastodon/dispatcher.test.js` kiểm chứng `scrape('mastodon', action, options)` và alias `scrape('masto', ...)` dispatch chính xác tới `MastodonCrawler`.
   - Chạy toàn bộ test suites của Bluesky và Mastodon để đảm bảo zero regression.

## Boundaries & Constraints

**Always:**
- Giữ 100% khả năng tương thích ngược cho chữ ký `scrape(platform, action, options)`.
- Ánh xạ các action aliases phổ biến của người dùng:
  - `posts`, `tweets`, `timeline`, `feed`, `user_feed` -> `posts`
  - `hashtag`, `tag` -> `hashtag`
  - `search` -> `search`
- Tuân thủ quy tắc Pure ESM, không thêm dependency ngoài.
- Thử nghiệm không mock cho dispatcher: inject in-memory hoặc stub crawler/client dependencies trong unit tests theo mẫu `tests/scrapers/social/bluesky/dispatcher.test.js`.

**Ask First:**
- Nếu cần gỡ bỏ hoàn toàn file `src/scrapers/mastodon/index.js` hoặc `src/scrapers/bluesky/index.js` (việc này thuộc Epic 26 - Final Legacy Decommission).
- Nếu cần thay đổi CLI commands hiện có.

**Never:**
- Không sửa logic xử lý core trong `src/core/base-crawler.js` hay `src/core/base-client.js`.
- Không làm gãy các callers hiện có của `scrape('bluesky', ...)` hoặc các platform khác.

## I/O & Edge-Case Matrix

| Scenario | Input / Invocation | Expected Output / Behavior | Error Handling |
|----------|-------------------|---------------------------|----------------|
| Mastodon profile via scrape() | `scrape('mastodon', 'profile', { username: 'Gargron' })` | Trả về `ProfileItem` qua `MastodonCrawler.getProfile` | 404 -> `PlatformError (XACT_4001)` |
| Mastodon alias "masto" | `scrape('masto', 'posts', { username: 'Gargron' })` | Dispatches tới `MastodonCrawler` | Invalid username -> `XACT_4001` |
| Mastodon hashtag via scrape() | `scrape('mastodon', 'hashtag', { hashtag: 'tech' })` | Trả về `PostItem[]` | Empty hashtag -> `XACT_4001` |
| Mastodon trending via scrape() | `scrape('mastodon', 'trending', { limit: 10 })` | Trả về `PostItem[]` | Instance without trends -> `[]` |
| Unknown action for mastodon | `scrape('mastodon', 'invalid_action', {})` | Ném `Error` thông báo action không khả dụng | Clear error message với danh sách actions |
| Bluesky profile via scrape() | `scrape('bluesky', 'profile', { username: 'user.bsky.social' })` | Vẫn hoạt động ổn định qua `BlueskyCrawler` | Zero regression |

</frozen-after-approval>

## Code Map

- `src/scrapers/index.js`:
  - Dòng 67-68: Import hiện tại của Bluesky (`BlueskyCrawler`, `BlueskyClient`).
  - Dòng 1073-1171: Nhánh dispatch hybrid của Bluesky (mẫu tham khảo chính xác).
  - Dòng 1587-1608: Nhánh `needsClient` cũ gọi `mastodon.createClient` -> Cần thay thế bằng nhánh hybrid `MastodonCrawler`.
  - Dòng 1705-1716: Re-exports `MastodonCrawler`, `MastodonClient`.
- `src/scrapers/social/index.js`:
  - Barrel export cho social modules.
- `package.json`:
  - `exports` map cho social scrapers.
- `docs/deprecation-plan.md`:
  - Status tracker cho legacy code.
- `tests/scrapers/social/bluesky/dispatcher.test.js`:
  - Test mẫu cho việc kiểm thử universal dispatcher.

## Tasks & Acceptance

**Execution:**
- [ ] `src/scrapers/index.js`:
  - Import `MastodonCrawler` và `MastodonClient` từ `./social/mastodon/index.js`.
  - Re-export `MastodonCrawler` và `MastodonClient` ở named exports cuối file.
  - Thêm nhánh dispatch hybrid cho `mastodon` / `masto`:
    - Action map: `profile`, `followers`, `following`, `posts`, `tweets`, `timeline`, `feed`, `user_feed`, `search`, `hashtag`, `trending`.
    - Phân giải options (`username`, `handle`, `target`, `query`, `hashtag`, `limit`, `max_id`, `since_id`, `instance`, `accessToken`).
    - Khởi tạo `MastodonClient` và `MastodonCrawler`, chạy `crawler.start()`, tự động gọi `crawler.cleanup()` trong `finally`.
  - Dọn dẹp điều kiện `needsClient` để không còn rơi vào logic legacy.
- [ ] `src/scrapers/social/index.js`:
  - Re-export `* as mastodon from './mastodon/index.js'`.
  - Re-export `MastodonClient, MastodonCrawler, MastodonPlatformResponseValidator`.
- [ ] `package.json`:
  - Bổ sung export `./scrapers/social/mastodon` và `./scrapers/social/bluesky`.
- [ ] `src/scrapers/bluesky/index.js` & `src/scrapers/mastodon/index.js`:
  - Thêm JSDoc `@deprecated` dẫn link tới `docs/deprecation-plan.md` và hybrid replacement.
- [ ] `docs/deprecation-plan.md`:
  - Thêm dòng cho Bluesky Legacy và Mastodon Legacy trong bảng Status Tracker với trạng thái `deprecated-marked`.
- [ ] `tests/scrapers/social/mastodon/dispatcher.test.js`:
  - Viết unit tests kiểm tra:
    - `scrape('mastodon', 'profile')` gọi `MastodonCrawler`.
    - `scrape('masto', 'trending')` hỗ trợ alias `masto`.
    - Ném lỗi rõ ràng khi action không hợp lệ.

**Acceptance Criteria:**
- Given `scrape('mastodon', 'profile', { username: 'Gargron' })`, when invoked, then it executes through `MastodonCrawler` and returns a valid `ProfileItem`.
- Given `scrape('masto', 'trending')`, when invoked with alias `masto`, then it dispatches to `MastodonCrawler`.
- Given `package.json`, when inspecting `exports`, then `./scrapers/social/mastodon` and `./scrapers/social/bluesky` are available.
- Given legacy files `src/scrapers/bluesky/index.js` and `src/scrapers/mastodon/index.js`, then they are clearly marked `@deprecated`.
- Given `tests/scrapers/social/mastodon/dispatcher.test.js`, when running `npx vitest run`, then all tests pass.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/mastodon/dispatcher.test.js`
- `npx vitest run tests/scrapers/social/bluesky/dispatcher.test.js`
- `npx vitest run tests/scrapers/social/`
