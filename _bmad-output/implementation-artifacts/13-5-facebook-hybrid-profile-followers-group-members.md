---
story_id: "13.5"
epic: 13
story_key: "13-5-facebook-hybrid-profile-followers-group-members"
status: "ready-for-dev"
phase: "Phase 4"
created: 2026-08-27
updated: 2026-08-27
last_updated: 2026-08-27
owner: "DEV"
reviewed: "Pending"
baseline_commit: "80f91a5"
---

# Story 13.5: Facebook Hybrid Profile, Followers & Group Members

Status: ready-for-dev

<!-- Validation: ultimate context engine analysis completed. Run dev-story for implementation. -->

## Story

As a **Facebook Growth Marketer**,  
I want **cào thông tin hồ sơ, danh sách followers/following, và thành viên nhóm Facebook qua kiến trúc hybrid (HTTP GraphQL hoặc CDP signer bridge) mà không cần mở Puppeteer tab mới cho mỗi yêu cầu**,  
so that **tôi có thể thu thập dữ liệu cá nhân/cộng đồng với tốc độ cao, tiêu thụ tài nguyên thấp, và lưu trữ tập trung qua PrismaStore**.

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.5 [dòng 548-559]
- `_bmad-output/planning-artifacts/prd.md` — FR-72 (Facebook Crawler Refactor) [dòng 80]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-2, AD-3, AD-4, AD-8, AD-9, AD-10, AD-11, AD-12, AD-14, AD-15
- `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md` — `FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`, token cache
- `_bmad-output/implementation-artifacts/13-4-facebook-browser-as-signer-bridge.md` — `FacebookBrowserBridge`, Playwright default, token extraction
- `src/scrapers/social/facebook/crawler.js` — `FacebookCrawler` hiện tại, action registry `group_posts`, `page_posts`, `get_comments` [dòng 62-133]
- `src/scrapers/social/facebook/client.js` — `FacebookClient`, `requestGraphQl`, `buildGraphQlBody`, `ensureTokens` [dòng 52-556]
- `src/scrapers/social/facebook/signer-bridge.js` — `FacebookBrowserBridge`, `extractFacebookTokensScript` [dòng 120-502]
- `src/scrapers/social/facebook/validator.js` — `FacebookPlatformResponseValidator` [dòng 34-208]
- `src/scrapers/social/threads/crawler.js` — `#emitCheckpointAndStream` pattern [dòng 114-152]
- `src/scrapers/social/facebook/crawler.js` — patterns `groupPosts`/`pagePosts`/`getCommentsForPost` để viết handler mới [dòng 536-637, 688-834]
- `src/scrapers/facebook/core.js` — `assertFacebookUrlLocal`, `NON_PROFILE_SEGMENTS`, `normalizeHandle` (qua `normalize.js`) [dòng 58-64, 348-367]
- `src/scrapers/facebook/normalize.js` — `normalizeProfile`, `normalizeFollower`, `normalizeGroupMember` [dòng 86-122, 314-322, 647-657]
- `src/scrapers/facebook/followers.js` — `scrapeFollowers`, `scrapeGroupMembers` legacy patterns [dòng 34-210]
- `src/core/base-crawler.js` — `AbstractCrawler`, `registerAction`, `start`, `listActions` [dòng 21-244]
- `src/core/types.js` — `PostItem`, `CommentItem`, `ActionDescriptor` [dòng 9-84]
- `src/store/prisma-store.js` — `PrismaStore`, `storeBatch` [dòng 13-220]
- `prisma/schema.prisma` — `Post`, `Comment`, `CrawlCheckpoint` [dòng 328-406]

## Cross-Epic Dependencies

- **Depends on** Story 13.1 (`AbstractCrawler`, `AbstractApiClient`, `PreSignedTokenRing`, `SignerWorkerPagePool`)
- **Depends on** Story 13.3 (`FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`, `PrismaStore`)
- **Depends on** Story 13.4 (`FacebookBrowserBridge`, CDP attach/launch, token extraction, Playwright default)
- **Unblocks** Story 13.6 (Facebook Hybrid Search), Story 13.7 (Comments hardening), Story 13.10 (Integration & caller migration)
- **Foundation:** Epic 10 (interfaces, Prisma, schema), Epic 11 (proxy/governor), Epic 12.2 (CDP launcher)

## Baseline

- `baseline_commit: 80f91a5`
- `FacebookCrawler` đã có `group_posts`, `page_posts`, `get_comments` tại `src/scrapers/social/facebook/crawler.js`.
- `FacebookClient` đã triển khai `requestGraphQl`, `buildGraphQlBody`, token cache, browser bridge option.

## Acceptance Criteria

### AC-1: Kế thừa AbstractCrawler & AbstractApiClient

- **Given** `FacebookCrawler` trong `src/scrapers/social/facebook/crawler.js` [dòng 62]
- **When** khởi tạo
- **Then** kế thừa `AbstractCrawler`, `requiresAuth = true`, `name = 'facebook'`, `platform = 'facebook'`
- **And** `FacebookClient` kế thừa `AbstractApiClient`, `client = 'got'` [dòng 63], `requiresAuth = true` [dòng 60]

### AC-2: Đăng ký action mới

- **Given** `FacebookCrawler` đã đăng ký `group_posts`, `page_posts`, `get_comments`
- **When** triển khai Story 13.5
- **Then** đăng ký thêm action `profile`, `followers`, `following`, `group_members` (snake_case) vào `ActionRegistry` trong constructor
- **And** `listActions()` trả về `ActionDescriptor[]` với đúng `requiredArgs`, `optionalArgs`, `example`, `outputType` theo `src/core/types.js`
- **And** `category` và `requiresAuth` có thể được thêm như extra fields (không xóa các trường hiện có); việc refactor global `ActionDescriptor` là optional

### AC-3: Facebook GraphQL Dispatcher (DocID/LSD)

- **Given** `FacebookClient` đã có `requestGraphQl` với DocID + `lsd`/`fb_dtsg` [dòng 432-514]
- **When** thêm các endpoint profile/followers/following/group_members
- **Then** sử dụng trực tiếp `FacebookClient.requestGraphQl()` làm dispatcher; **KHÔNG** tạo file `graphql-dispatcher.js` riêng trừ khi chỉ là alias `dispatch()`
- **And** `lsd` được lấy từ `PreSignedTokenRing` hoặc token cache; `fb_dtsg`/`jazoest`/`__spin_*` được inject đúng như `buildGraphQlBody` [dòng 385-423]
- **And** nếu GraphQL trả lỗi hoặc shape không mong đợi, trả `PlatformError` với `suggestedAction: 'retry_after_delay'` (không throw panic) [dòng 502-510]

### AC-4: Profile Hybrid

- **Given** `username` hoặc `url` (vd `zuck`, `https://www.facebook.com/zuck`)
- **When** gọi `crawler.start({ action: 'profile', args: { username } })` hoặc `{ url }`
- **Then** `FacebookCrawler` parse tham số thành `targetKey` (handle/userId) qua `resolveTargetKey(username|url)`, gọi GraphQL hoặc `FacebookBrowserBridge` nếu endpoint chưa ổn định
- **And** trả về `ProfileItem` với `id: 'facebook:${externalId}'`, `platform: 'facebook'`
- **And** `ProfileItem` chứa `name`, `username`, `bio`, `avatar`, `profileUrl`, `followersCount`, `followingCount`, `metadata`

### AC-5: Followers & Following Hybrid

- **Given** `username` hoặc `url`
- **When** gọi `crawler.start({ action: 'followers', args: { username, limit } })`
- **Then** `FacebookCrawler` gọi GraphQL với pagination cursor cho đến khi đạt `limit`
- **And** trả về `ProfileItem[]`, mỗi item `id: 'facebook:${externalId}'`
- **And** `action: 'following'` là **optional / best-effort**; nếu Facebook không expose list (personal profile), trả về note object hoặc `PlatformError` với `code: 'UNSUPPORTED_ACTION'`, không block toàn bộ implementation

### AC-6: Group Members Hybrid

- **Given** `groupUrl` hoặc `groupId` (vd `https://www.facebook.com/groups/123456`)
- **When** gọi `crawler.start({ action: 'group_members', args: { groupUrl, limit } })`
- **Then** `FacebookCrawler` parse `groupUrl` thành `groupId` qua `resolveGroupId(groupUrl)`, validate URL bằng `assertFacebookUrlLocal` (SSRF guard), gọi GraphQL hoặc browser fallback
- **And** trả về `ProfileItem[]` với `id: 'facebook:${userId}'` (hoặc `facebook:${username}` nếu chỉ có handle)
- **And** nếu nhóm private hoặc không có danh sách thành viên, trả về note object hoặc `PlatformError` với `suggestedAction: 'relogin'`

### AC-7: ProfileItem với Namespaced ID

- **Given** bất kỳ kết quả profile/follower/following/group-member
- **When** normalize
- **Then** `ProfileItem.id` bắt buộc `facebook:${externalId}`
- **And** nếu `externalId` là username, `id` vẫn là `facebook:<username>`; nếu là numeric userId, `id` là `facebook:<userId>`
- **And** `ProfileItem.platform = 'facebook'`

### AC-8: PrismaStore & Checkpoint

- **Given** `FacebookCrawler` được cấu hình với `store` (PrismaStore)
- **When** hoàn thành một action
- **Then** `profile` được lưu dưới dạng `PostItem` mapping (category `'social'`) qua `store.storeBatch([postItem], { upsert: true })`, với `publishedAt: null`
- **And** `followers`/`following`/`group_members` cũng map thành `PostItem[]` và lưu qua `store.storeBatch(items, { upsert: true })`; **KHÔNG** hardcode chunk 500 — để `PrismaStore` tự xử lý
- **And** sau mỗi action gọi `saveCheckpoint` với `{ platform: 'facebook', targetType, targetKey, lastCursor, lastCrawledAt }` đúng `prisma/schema.prisma` [dòng 389-406]
- **And** emit thin event `stream:social:raw_posts` cho mỗi item mới

### AC-9: Deprecation Markers

- **Given** các hàm legacy `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers` trong `src/scrapers/facebook/`
- **When** Story 13.5 hoàn thành
- **Then** thêm `@deprecated` JSDoc vào `src/scrapers/facebook/profile.js#scrapeProfile`, `src/scrapers/facebook/followers.js#scrapeFollowers`, `src/scrapers/facebook/followers.js#scrapeGroupMembers`
- **And** cập nhật `docs/deprecation-plan.md` ghi rõ các hàm trên được thay thế bởi `FacebookCrawler` action:

| Legacy function | Hybrid action |
|-----------------|---------------|
| `scrapeProfile` | `facebook:profile` |
| `scrapeFollowers` | `facebook:followers` |
| `scrapeGroupMembers` | `facebook:group_members` |

### AC-10: Kiểm thực (No Mocks)

- **Given** test suite mới `tests/scrapers/social/facebook/crawler-profile.test.js`
- **When** chạy `npm test`
- **Then** không dùng `vi.fn`, mock, stub, fake
- **And** dùng `http.createServer` để serve Facebook-like HTML + JSON GraphQL cho `profile`, `followers`, `following`, `group_members`
- **And** `npm run typecheck` pass
- **And** chạy `npm test -- tests/scrapers/social/facebook/` pass

## Tasks / Subtasks

- [ ] T1: Thêm `ProfileItem` type/normalizer và dispatcher (AC-3, AC-7)
  - [ ] T1.1: Định nghĩa `ProfileItem` JSDoc/typedef (id, platform, externalId, username, name, bio, avatar, profileUrl, followersCount, followingCount, metadata, crawledAt) trong `src/core/types.js` và `ProfileItem` interface trong `types/core.d.ts`
  - [ ] T1.2: Tạo `src/scrapers/social/facebook/normalize-profile.js` với `normalizeFacebookProfile`, `normalizeFacebookFollower`, `normalizeFacebookGroupMember`, `namespacedId`
  - [ ] T1.3: Sử dụng `FacebookClient.requestGraphQl()` làm dispatcher; chỉ thêm alias `dispatch()` nếu cần, không tạo `graphql-dispatcher.js` riêng
  - [ ] T1.4: Bổ sung `DEFAULT_FB_DOC_IDS` placeholders cho `PROFILE`, `FOLLOWERS`, `FOLLOWING`, `GROUP_MEMBERS` [dòng 39-49 crawler.js]
- [ ] T2: Mở rộng `FacebookClient` (AC-3, AC-4, AC-6)
  - [ ] T2.1: Thêm helper `resolveTargetKey(username|url)` sử dụng `normalizeHandle` pattern
  - [ ] T2.2: Thêm `resolveGroupId(groupUrl)` với `assertFacebookUrlLocal` SSRF guard
  - [ ] T2.3: Đảm bảo `requestGraphQl` hỗ trợ doc_id mới và graceful doc_id rotation
- [ ] T3: Mở rộng `FacebookCrawler` với action mới (AC-2, AC-4, AC-5, AC-6)
  - [ ] T3.1: `registerAction('profile', ...)` handler `profile(args, session)`
  - [ ] T3.2: `registerAction('followers', ...)` handler với pagination
  - [ ] T3.3: `registerAction('following', ...)` handler best-effort với fallback note/UNSUPPORTED_ACTION
  - [ ] T3.4: `registerAction('group_members', ...)` handler với group URL parsing
  - [ ] T3.5: `getGroupPosts`/`getPagePosts` hiện có giữ nguyên (không regression); nếu cập nhật metadata để phù hợp `schemas/facebook/social.json`, phải vẫn pass regression
- [ ] T4: Lưu trữ, schema & Checkpoint (AC-8)
  - [ ] T4.1: Tạo `schemas/facebook/social.json` với schema cho `ProfileItem` metadata (isProfile, sourceMethod, followersCount, followingCount, profilePic, coverPic, bio, location, joinDate)
  - [ ] T4.2: Mapping `ProfileItem` → `PostItem` cho `store.storeBatch`; `publishedAt: null`
  - [ ] T4.3: Triển khai `PrismaStore.saveCheckpoint()` hoặc expose `prisma` để gọi `prisma.crawlCheckpoint.upsert()`; ghi `lastCrawledAt` đúng Prisma field
  - [ ] T4.4: Sau mỗi action gọi `saveCheckpoint` + emit `stream:social:raw_posts` (tham khảo `ThreadsCrawler.#emitCheckpointAndStream`)
- [ ] T5: Deprecation markers (AC-9)
  - [ ] T5.1: Thêm `@deprecated` JSDoc trong `src/scrapers/facebook/profile.js#scrapeProfile` [dòng 180]
  - [ ] T5.2: Thêm `@deprecated` JSDoc trong `src/scrapers/facebook/followers.js#scrapeFollowers` [dòng 34]
  - [ ] T5.3: Thêm `@deprecated` JSDoc trong `src/scrapers/facebook/followers.js#scrapeGroupMembers` [dòng 128]
  - [ ] T5.4: Cập nhật `docs/deprecation-plan.md` với mapping table
- [ ] T6: Tests (AC-10)
  - [ ] T6.1: Tạo `tests/scrapers/social/facebook/crawler-profile.test.js`
  - [ ] T6.2: Local server trả về tokens + JSON GraphQL cho profile/followers/following/group_members
  - [ ] T6.3: Kiểm tra Namespaced ID `facebook:${externalId}`
  - [ ] T6.4: Kiểm tra `listActions()` và deprecation marker tồn tại
  - [ ] T6.5: `npm run typecheck` + `npm test -- tests/scrapers/social/facebook/`
- [ ] T7: (Optional) Refactor `ActionDescriptor` global
  - [ ] T7.1: Nếu muốn include `category`/`requiresAuth` trong `listActions()` output chính thức, cập nhật `src/core/types.js`, `types/core.d.ts`, `base-crawler.js#listActions()`. **Đây là task optional, không bắt buộc cho Story 13.5.**

## Dev Notes

### Design Decisions

| Decision | Option chosen | Rationale |
|----------|---------------|-----------|
| GraphQL dispatcher | **A** — `FacebookClient.requestGraphQl()` là dispatcher | `FacebookClient` đã merge headers/body/cookies qua `AbstractApiClient.request()`; không cần `graphql-dispatcher.js` riêng |
| CrawlCheckpoint field | Dùng `lastCrawledAt` trong `prisma/schema.prisma` [dòng 397] | `lastCrawledAt` là tên field thực tế trong Prisma schema |
| `saveCheckpoint` | Triển khai `PrismaStore.saveCheckpoint()` hoặc expose `#prisma` | `AbstractStore` chưa định nghĩa phương thức này; cần thêm để gọi `prisma.crawlCheckpoint.upsert()` |
| `following` action | Optional / best-effort | Facebook personal profile following list thường không expose; trả note hoặc `UNSUPPORTED_ACTION` |
| Profile storage | Map `ProfileItem` → `PostItem` với `publishedAt: null` | Prisma chưa có `Profile` model; `PostItem` là cách lưu trữ tập trung |
| Chunking | Không hardcode 500; gọi `store.storeBatch(items, { upsert: true })` | `PrismaStore` tự xử lý chunking bằng `#chunkSize` |
| Normalizer names | `normalizeFacebookProfile`, `normalizeFacebookFollower`, `normalizeFacebookGroupMember` | Tránh xung đột với legacy `src/scrapers/facebook/normalize.js` |
| `ActionDescriptor` | Dùng shape hiện tại `src/core/types.js`; `category`/`requiresAuth` là extra optional | Không bắt buộc refactor global type; nếu làm thì tách thành task optional |
| Schema | Tạo `schemas/facebook/social.json` | Định nghĩa metadata fields cho `ProfileItem` mapped sang `PostItem`; giữ backward-compat với `group_posts`/`page_posts` hiện có |

### Project Structure Notes

- **Target folder:** `src/scrapers/social/facebook/` — tất cả code hybrid mới thuộc folder này theo AD-8.
- **Legacy folder:** `src/scrapers/facebook/` (Puppeteer) **KHÔNG sửa logic** ngoài việc thêm `@deprecated` JSDoc; sẽ decommission ở Epic 20.2.
- **Pattern reuse:** Không có `src/scrapers/social/facebook/core.js`; tái sử dụng patterns từ `src/scrapers/social/facebook/crawler.js` (cấu trúc handler `groupPosts`/`pagePosts`/`getCommentsForPost`) và từ legacy `src/scrapers/facebook/core.js` (`assertFacebookUrlLocal`, `NON_PROFILE_SEGMENTS`, `normalizeHandle`).
- **Legacy dispatcher:** `src/scrapers/index.js` giữ nguyên để tránh break `scrape('facebook', ...)` cũ.
- **Conflict / variance:**
  - `epics.md` yêu cầu `PostItem (profile) / CommentItem / ProfileItem` — `src/core/types.js` chưa có `ProfileItem`, cần định nghĩa trong story này và map sang `PostItem` khi lưu PrismaStore.
  - `FacebookClient.requestGraphQl()` đóng vai trò dispatcher. **KHÔNG** tạo `src/scrapers/social/facebook/graphql-dispatcher.js` trừ khi chỉ là alias `dispatch = (...args) => this.requestGraphQl(...args)`.

### Core Code State to Preserve

- `FacebookClient.requestGraphQl` **chỉ merge `headers`, `body`, `cookies`** vào `this.request()`; không dùng `requestWithSign()` vì `AbstractApiClient.requestWithSign()` không merge `signResult.body` (13.3 Dev Notes [dòng 133]).
- `FacebookClient.#fetchTokens` (HTTP regex extraction) được đánh dấu `deprecated-planned` trong 13.4; vẫn giữ làm fallback.
- `FacebookBrowserBridge.extractTokens` là mặc định khi `cdpUrl`/`launchChrome` được cấu hình; Playwright mặc định, Puppeteer khi `XACTIONS_SCRAPER_ADAPTER=puppeteer` (13.4 AC-5).
- `AbstractCrawler.start()` tự động resolve `accountId`, kiểm tra `governor`, rồi gọi handler `(args, session)` [dòng 149-244].
- `AbstractCrawler.registerAction()` bắt buộc tên `snake_case` regex `^[a-z0-9_]+$` [dòng 84-90].
- `AbstractCrawler.listActions()` trả về `{ action, description, requiredArgs, optionalArgs, example, outputType }` [dòng 106-115].

### Authentication & Token Handling

- `FacebookClient.ensureTokens(accountId, cookies)` trích `lsd`, `fb_dtsg`, `jazoest`, `spin_r`, `spin_t`, `hsi`, `c_user` từ browser hoặc HTML [dòng 211-267].
- Token cache theo `accountId:cookieHash` với TTL 5 phút và 30s pre-expiry refresh [dòng 215-221].
- `buildGraphQlBody` tạo `application/x-www-form-urlencoded` với `doc_id`, `variables`, `lsd`, `fb_dtsg`, ... [dòng 385-423].
- `FacebookClient` set `client = 'got'` [dòng 63]; body phải là string `URLSearchParams.toString()`.

### Facebook GraphQL Dispatcher (DocID/LSD)

- **Option A (được chọn):** `FacebookClient.requestGraphQl(docId, variables, options)` là dispatcher. Nó gọi `this.request('POST', '/api/graphql/', ...)` với form-urlencoded body.
- **Option B (tùy chọn):** Nếu cần một class riêng, chỉ tạo alias trong `FacebookClient` hoặc `FacebookCrawler` như `dispatch = (...args) => this.client.requestGraphQl(...args)`.
- **Không được:** gửi request trực tiếp bằng `axios`, `fetch`, hoặc client HTTP khác ngoài `AbstractApiClient.request()` (AD-3, AD-2).

### ProfileItem & Namespaced ID

`ProfileItem` shape (bắt buộc cho mọi output của action `profile`, `followers`, `following`, `group_members`):

```js
/** @typedef {Object} ProfileItem
 * @property {string} id            // `facebook:${externalId}`
 * @property {string} platform      // 'facebook'
 * @property {string} externalId    // numeric userId hoặc username
 * @property {string} username
 * @property {string} name
 * @property {string} [bio]
 * @property {string} [avatar]
 * @property {string} [profileUrl]
 * @property {number} [followersCount]
 * @property {number} [followingCount]
 * @property {Object} [metadata]
 * @property {Date}   [crawledAt]
 */
```

Thêm vào `types/core.d.ts`:

```ts
export interface ProfileItem {
  id: string;
  platform: string;
  externalId: string;
  username: string;
  name: string;
  bio?: string;
  avatar?: string;
  profileUrl?: string;
  followersCount?: number;
  followingCount?: number;
  metadata?: Record<string, unknown>;
  crawledAt?: Date;
}
```

- `externalId` ưu tiên numeric `userId` từ GraphQL; nếu không có, dùng `username`.
- `id` luôn `facebook:${externalId}` (AD-4 Namespaced ID).

### Target & URL Helpers

Thêm helpers vào `FacebookClient` hoặc `FacebookCrawler` (khuyến nghị đặt trong `client.js` hoặc module helper riêng để reusable):

```js
import { NON_PROFILE_SEGMENTS } from '../../scrapers/facebook/core.js';

/**
 * @param {string} input
 * @returns {string}
 */
function resolveTargetKey(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: 'Missing username or url', suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  let handle = input.trim();
  if (/^https?:\/\//i.test(handle)) {
    assertFacebookUrlLocal(handle, 'profile url');
    const url = new URL(handle);
    const idMatch = url.search.match(/[?&]id=(\d+)/);
    if (idMatch) return `profile.php?id=${idMatch[1]}`;
    const parts = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0 || NON_PROFILE_SEGMENTS.includes(parts[0])) {
      throw new PlatformError({
        code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
        message: 'URL does not resolve to a profile', suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    return parts[0];
  }
  return handle.replace(/^@/, '').split('/')[0].split('?')[0];
}

/**
 * @param {string} input
 * @returns {string}
 */
function resolveGroupId(input) {
  if (/^\d+$/.test(input)) return input;
  if (typeof input !== 'string' || !input.trim()) {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: 'Missing groupUrl or groupId', suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  assertFacebookUrlLocal(input, 'group url');
  const url = new URL(input);
  const match = url.pathname.match(/\/groups\/([^/?#]+)/);
  if (!match) {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: 'Cannot parse groupId from URL', suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  return match[1];
}

/**
 * @param {string} url
 * @param {string} [label='URL']
 * @returns {void}
 */
function assertFacebookUrlLocal(url, label = 'URL') {
  if (typeof url !== 'string' || !url.trim()) {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: `${label} must be a non-empty string`, suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: `${label} must be a valid URL`, suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: `${label} must be an http(s) URL`, suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) {
    throw new PlatformError({
      code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS,
      message: `${label} must be a facebook.com URL`, suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }
}
```

### Data Normalization

- `profile`:
  - Từ GraphQL `node { id, name, username, bio, profile_picture, followers_count, following_count }`.
  - Fallback HTML mbasic/desktop pattern từ `src/scrapers/facebook/profile.js` [dòng 30-258] nếu GraphQL doc_id chưa ổn định.
  - Sử dụng `normalizeFacebookProfile(raw, targetKey)` để tránh xung đột với legacy.
- `followers` / `following`:
  - Từ GraphQL edges `{ node: { id, name, username, profile_picture } }`.
  - Dừng khi đạt `limit` hoặc hết `page_info.end_cursor`.
  - Sử dụng `normalizeFacebookFollower(raw)`.
  - Nếu endpoint trả list rỗng/restricted, trả `note` object (giống legacy `scrapeFollowers` [dòng 54-60]).
- `following` best-effort:
  - Trước khi gọi, thử GraphQL với doc_id `FOLLOWING`.
  - Nếu Facebook trả lỗi, list rỗng, hoặc không có `page_info`, trả về:

```js
{
  note: 'Facebook does not expose the personal profile following list for this account.',
  platform: 'facebook',
  targetKey,
}
```

hoặc throw `PlatformError`:

```js
new PlatformError({
  code: 'UNSUPPORTED_ACTION',
  type: ErrorTypes.INVALID_ARGS,
  message: 'Following list is not available for this Facebook profile',
  suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
  platform: 'facebook',
});
```

- `group_members`:
  - Từ GraphQL `group { members { edges } }`.
  - Parse `groupUrl` thành `groupId` bằng `resolveGroupId`.
  - Validate URL với `assertFacebookUrlLocal` trước navigation (AD-9 SSRF guard).
  - Sử dụng `normalizeFacebookGroupMember(raw)`.

### Storage Mapping (PrismaStore)

Vì Prisma chưa có `Profile` model, map `ProfileItem` → `PostItem` khi lưu. Mọi profile/follower/following/group-member item đều có `publishedAt: null` vì chúng không phải post theo thời gian:

```js
function profileItemToPostItem(profile) {
  return {
    id: profile.id,
    externalId: profile.externalId,
    platform: 'facebook',
    category: 'social',
    authorId: profile.externalId,
    authorName: profile.name,
    authorAvatar: profile.avatar,
    authorUrl: profile.profileUrl,
    postUrl: profile.profileUrl,
    content: profile.bio || '',
    mediaUrls: profile.avatar ? [profile.avatar] : [],
    likesCount: profile.followersCount || 0,
    repostsCount: 0,
    repliesCount: profile.followingCount || 0,
    viewsCount: 0,
    metadata: {
      isProfile: true,
      sourceMethod: 'graphql',
      followersCount: profile.followersCount,
      followingCount: profile.followingCount,
      ...profile.metadata,
    },
    publishedAt: null,
    crawledAt: new Date(),
  };
}
```

- Gọi `this.store.storeBatch(items.map(profileItemToPostItem), { upsert: true })`.
- **KHÔNG** tự chunk 500; `PrismaStore#chunkSize` đã xử lý [dòng 217-228].

### Schema mới: `schemas/facebook/social.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Facebook Social Post & Profile Metadata",
  "type": "object",
  "anyOf": [
    {
      "title": "ProfileItem Metadata",
      "properties": {
        "isProfile": { "type": "boolean", "enum": [true] },
        "sourceMethod": { "type": "string" },
        "followersCount": { "type": "integer", "minimum": 0 },
        "followingCount": { "type": "integer", "minimum": 0 },
        "profilePic": { "type": "string" },
        "coverPic": { "type": "string" },
        "bio": { "type": "string" },
        "location": { "type": "string" },
        "joinDate": { "type": "string" }
      },
      "required": ["isProfile", "sourceMethod"]
    },
    {
      "title": "General Social Post Metadata",
      "properties": {
        "isProfile": { "type": "boolean", "enum": [false] },
        "creationTime": {
          "oneOf": [{ "type": "string" }, { "type": "number" }]
        },
        "sourceMethod": { "type": "string" }
      }
    }
  ]
}
```

- File được tự động load bởi `src/core/metadata-schema-registry.js` [dòng 295-303].
- `group_posts`/`page_posts` hiện tại nếu chưa có `isProfile`/`sourceMethod` vẫn pass nhờ variant "General" (không require gì); khuyến nghị backfill `sourceMethod: 'graphql'` cho consistency.

### Checkpoint & Stream Emission

Mỗi action mới phải lưu `CrawlCheckpoint` và emit thin event. Tham khảo `ThreadsCrawler.#emitCheckpointAndStream` [dòng 114-152]:

```js
async #emitCheckpointAndStream({ targetType, targetKey, cursor = null, items = [], hasMore = false }) {
  try {
    const checkpoint = {
      platform: 'facebook',
      targetType,
      targetKey,
      lastCursor: cursor || undefined,
      lastCrawledAt: new Date(),
      status: hasMore ? 'has_more' : 'completed',
    };

    if (this.store && typeof this.store.saveCheckpoint === 'function') {
      await this.store.saveCheckpoint(checkpoint);
    } else if (this.store?.prisma?.crawlCheckpoint) {
      await this.store.prisma.crawlCheckpoint.upsert({
        where: { platform_targetType_targetKey: { platform: 'facebook', targetType, targetKey } },
        update: checkpoint,
        create: checkpoint,
      });
    }

    const redisClient = this.store?.redis || this.sessionManager?.redis;
    if (redisClient && process.env.REDIS_STREAM_ENABLED === 'true') {
      for (const item of items) {
        await redisClient.xadd(
          'stream:social:raw_posts',
          '*',
          'id', item.id,
          'platform', 'facebook',
          'externalId', item.externalId,
          'category', item.category || 'social',
          'authorId', item.authorId || '',
          'crawledAt', item.crawledAt ? item.crawledAt.toISOString() : new Date().toISOString(),
          'storageRef', item.id,
        );
      }
    }
  } catch (err) {
    console.warn(`⚠️ [FACEBOOK TELEMETRY] Checkpoint/stream emission warning: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- `lastCrawledAt` là field duy nhất được ghi.
- `PrismaStore` cần triển khai `saveCheckpoint(checkpoint)` hoặc expose `prisma` để fallback; nếu thêm vào `PrismaStore`, cũng cập nhật `types/store.d.ts` nếu cần.

### Proxy, CDP & Browser Bridge

- `FacebookCrawler` kế thừa `requiresAuth = true` → `AbstractCrawler.start()` sẽ resolve `accountId` và gắn sticky proxy (AD-3).
- `FacebookClient` constructor nhận `cdpUrl`, `launchChrome`, `browserBridge` (nếu cần browser fallback cho profile/followers) [dòng 155-158].
- `FacebookBrowserBridge` dùng Playwright mặc định; profile-per-account tại `.data/facebook-profiles/<c_user>` (13.4 AC-6).
- Nếu action `profile`/`followers` cần DOM (ví dụ mbasic fallback), dùng `FacebookBrowserBridge` với `page.evaluate()` và `Promise.race` 3s timeout (AD-1).

### Anti-Bot & Error Handling

- `FacebookPlatformResponseValidator.isValidPayload` cần nhận diện các trường mới `profile`, `user`, `node`, `members`, `edges`, `page_info` [dòng 87-148].
- `isBotChallenge` phát hiện checkpoint/login wall [dòng 154-181].
- `isRateLimit` phát hiện 429/368 [dòng 187-207].
- Mọi lỗi phải trả `PlatformError` với `code`, `type`, `suggestedAction` (AD-14).

### ActionDescriptor Reconciliation

- `src/core/types.js` hiện định nghĩa:

```js
/**
 * @typedef {Object} ActionDescriptor
 * @property {string} action
 * @property {string} [description]
 * @property {string[]} [requiredArgs]
 * @property {string[]} [optionalArgs]
 * @property {Object} [example]
 * @property {string} [outputType]
 */
```

- Story này phải dùng đúng shape trên cho `registerAction`/`listActions`.
- `category` và `requiresAuth` có thể thêm như extra fields trong descriptor object khi gọi `registerAction()`, ví dụ:

```js
this.registerAction(/** @type {any} */ ({
  action: 'profile',
  category: 'social',
  requiresAuth: true,
  requiredArgs: ['username'],
  ...
}));
```

- Nếu muốn `listActions()` chính thức trả về `category`/`requiresAuth`, đó là một global refactor task optional (T7), không bắt buộc.

### CrawlCheckpoint (AD-12)

- Mỗi action ghi `CrawlCheckpoint` với:
  - `platform: 'facebook'`
  - `targetType`: `'profile' | 'followers' | 'following' | 'group_members'`
  - `targetKey`: normalized handle hoặc groupId
  - `lastCursor`: `page_info.end_cursor` nếu có
  - `lastCrawledAt`: thời điểm crawl (field thực tế trong Prisma)

## Sample GraphQL Payloads & Test Fixtures

Dưới đây là các payload mẫu để dùng trong test `http.createServer`.

### `profile`

**Request variables:**

```json
{
  "username": "zuck",
  "scale": 2
}
```

**Response:**

```json
{
  "data": {
    "user": {
      "id": "100000000",
      "name": "Mark Zuckerberg",
      "username": "zuck",
      "bio": "Bringing the world closer together.",
      "profile_picture": { "uri": "https://scontent-ams2-1.xx.fbcdn.net/v/avatar.jpg" },
      "followers_count": 12000000,
      "following_count": 125
    }
  }
}
```

### `followers`

**Request variables:**

```json
{
  "username": "zuck",
  "first": 50,
  "after": null
}
```

**Response:**

```json
{
  "data": {
    "user": {
      "followers": {
        "edges": [
          {
            "node": {
              "id": "100000001",
              "name": "Alice Smith",
              "username": "alice.smith",
              "profile_picture": { "uri": "https://cdn.fb.com/alice.jpg" }
            }
          }
        ],
        "page_info": {
          "has_next_page": true,
          "end_cursor": "cursor_followers_1"
        }
      }
    }
  }
}
```

### `following` (best-effort)

**Request variables:**

```json
{
  "username": "zuck",
  "first": 50,
  "after": null
}
```

**Restricted response:**

```json
{
  "data": {
    "user": {
      "following": null
    }
  },
  "errors": [
    {
      "message": "Following list is not available",
      "code": 1675030
    }
  ]
}
```

### `group_members`

**Request variables:**

```json
{
  "groupId": "123456789",
  "first": 50,
  "after": null
}
```

**Response:**

```json
{
  "data": {
    "group": {
      "id": "123456789",
      "members": {
        "edges": [
          {
            "node": {
              "id": "100000002",
              "name": "Bob Member",
              "username": "bob.member",
              "profile_picture": { "uri": "https://cdn.fb.com/bob.jpg" }
            }
          }
        ],
        "page_info": {
          "has_next_page": false,
          "end_cursor": null
        }
      }
    }
  }
}
```

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 18, JSDoc + `npm run typecheck` (`tsc --noEmit`).
- **HTTP Client:** `got-scraping` mặc định (`client: 'got'`); `undici` fallback (AD-3).
- **Proxy:** `ProxyIpPool.getStickyProxy(accountId)` cho Facebook (AD-3); không direct fallback.
- **Storage:** `PrismaStore` — gọi `storeBatch(items, { upsert: true })` và để store tự xử lý chunking nội bộ.
- **TypeScript:** Cập nhật `types/core.d.ts` thêm `ProfileItem` interface; `types/index.d.ts` nếu cần.
- **No `any` / `@ts-ignore`:** Mọi public property phải JSDoc-typed.
- **No credentials in logs:** Không log `c_user`, `xs`, `lsd`, `fb_dtsg` (NFR-4).

## Architecture Compliance

| AD | Rule | Implementation |
|----|------|----------------|
| AD-1 | Tiered Hybrid Signer | `FacebookClient` refill `PreSignedTokenRing` với `lsd`; `FacebookBrowserBridge` dùng `Promise.race` 3s/8s cho `page.evaluate`. |
| AD-2 | Unified Base Interfaces | `FacebookCrawler` extends `AbstractCrawler`; `FacebookClient` extends `AbstractApiClient`; action names `snake_case`. |
| AD-3 | Sticky IP per account | `FacebookClient.requiresAuth = true`; proxy qua `ProxyIpPool.getStickyProxy(accountId)`. |
| AD-4 | Namespaced PostgreSQL | `ProfileItem.id = 'facebook:${externalId}'`; lưu PrismaStore qua PostItem mapping. |
| AD-8 | Multi-Domain Expansion | Code mới trong `src/scrapers/social/facebook/`; legacy `src/scrapers/facebook/` không đụng logic. |
| AD-9 | Anti-Bot Payload Validation | `FacebookPlatformResponseValidator` nhận diện `profile`/`members` payloads; rate-limit/checkpoint triggers `PlatformError`. |
| AD-10 | 3-Tier Gap-Filling | `CrawlCheckpoint` ghi `lastCursor`/`lastCrawledAt` cho profile/followers/following/group_members. |
| AD-11 | ActionRegistry | Đăng ký `profile`, `followers`, `following`, `group_members`; `listActions()` trả `ActionDescriptor[]` với optional `category`/`requiresAuth`. |
| AD-12 | CrawlCheckpoint | `CrawlCheckpoint` với `@@unique([platform, targetType, targetKey])`; ghi `lastCrawledAt` theo Prisma field. |
| AD-14 | Error Envelope | Mọi lỗi trả về `PlatformError` với `code`, `type`, `suggestedAction`. |
| AD-15 | Terminal QR / Non-invasive Auth | `FacebookClient` nhận cookies/tokens từ `SessionManager` (được cung cấp bởi QR/CDP login); không log credentials. |

## Library & Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| `got-scraping` | `^3.2.15` | HTTP client mặc định, TLS/JA4 spoofing, proxy `proxyUrl` [package.json]. |
| `undici` | `^7.29.0` | HTTP client fallback với `ProxyAgent` [package.json]. |
| `playwright` | `^1.62.1` | Browser engine CDP attach (mặc định) [package.json]. |
| `puppeteer` | `^24.34.0` | Browser engine khi `XACTIONS_SCRAPER_ADAPTER=puppeteer`. |
| `p-limit` | `^7.2.0` | Giới hạn concurrency nếu cần batch request [package.json]. |

## File Structure Requirements

### CREATE

| File | Description |
|------|-------------|
| `schemas/facebook/social.json` | JSON schema cho Facebook `social` metadata (ProfileItem & general post). |
| `src/scrapers/social/facebook/normalize-profile.js` | Pure normalizers `normalizeFacebookProfile`, `normalizeFacebookFollower`, `normalizeFacebookGroupMember` với namespaced IDs. |
| `tests/scrapers/social/facebook/crawler-profile.test.js` | Tests thực cho `profile`, `followers`, `following`, `group_members`. |

### UPDATE

| File | Description |
|------|-------------|
| `src/scrapers/social/facebook/crawler.js` | Thêm action `profile`, `followers`, `following`, `group_members`; thêm `DEFAULT_FB_DOC_IDS` mới; thêm `#emitCheckpointAndStream`; gọi `store.storeBatch` với `upsert: true`. |
| `src/scrapers/social/facebook/client.js` | Mở rộng `DEFAULT_FB_DOC_IDS`, thêm helpers `resolveTargetKey`, `resolveGroupId`, `assertFacebookUrlLocal` nếu đặt ở client. |
| `src/scrapers/social/facebook/index.js` | Export `ProfileItem` normalizer. |
| `src/scrapers/social/facebook/validator.js` | Nhận diện `profile`, `members`, `user` payloads. |
| `src/core/types.js` | Thêm `ProfileItem` JSDoc typedef. |
| `types/core.d.ts` | Thêm `ProfileItem` interface. |
| `src/store/prisma-store.js` | Triển khai `saveCheckpoint()` hoặc expose `prisma` để gọi `prisma.crawlCheckpoint.upsert()`. |
| `docs/deprecation-plan.md` | Cập nhật status tracker + mapping table cho `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers`. |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/core/base-client.js` | Hoàn thiện ở 13.1/13.3; chỉ dùng API. |
| `src/core/base-crawler.js` | Hoàn thiện ở 10.1; chỉ kế thừa. Nếu cần thêm `category`/`requiresAuth` vào `listActions()` output, đó là task optional T7. |
| `src/core/signer-pool.js` | Hoàn thiện ở 13.1. |
| `src/scrapers/facebook/` (logic) | Legacy; chỉ thêm `@deprecated` JSDoc. |
| `src/scrapers/index.js` | Legacy dispatcher; giữ backward compatibility. |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test`.
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** `http.createServer` phục vụ:
  - HTML home với `lsd`, `fb_dtsg`, `jazoest`, `__spin_*`.
  - JSON GraphQL cho `/api/graphql/` với `data.profile`, `data.user.followers`, `data.user.following`, `data.group.members`.
- **Real proxy:** `StaticProxyProvider` hoặc `ProxyIpPool` local.
- **Test fixtures:** Dùng các sample payloads ở trên để seed server.
- **Coverage tối thiểu:**
  - `listActions()` trả về đúng `ActionDescriptor[]` (bao gồm `profile`, `followers`, `following`, `group_members`).
  - `profile({ username })` trả về `ProfileItem` với `id: 'facebook:${externalId}'`.
  - `followers({ username, limit })` trả về `ProfileItem[]` và phân trang.
  - `following({ username, limit })` trả về `ProfileItem[]` hoặc note/UNSUPPORTED_ACTION khi bị hạn chế.
  - `group_members({ groupUrl, limit })` parse URL + trả `ProfileItem[]`.
  - Response rỗng/restricted trả về `PlatformError` hoặc note object.
  - `saveCheckpoint` được gọi với `lastCrawledAt`.
  - `cleanup()` gọi `client.close()` và không leak.
- **Regression:** `npm run typecheck` và `npm test -- tests/core/` phải pass.

## Previous Story Intelligence

### Story 13.3 (Done)

- `FacebookCrawler` kế thừa `AbstractCrawler`, đã đăng ký `group_posts`, `page_posts` [dòng 107-132].
- `FacebookClient` kế thừa `AbstractApiClient`, `client = 'got'`, `requiresAuth = true`.
- `requestGraphQl` đã xử lý `doc_id`, `variables`, token cache, `application/x-www-form-urlencoded` body.
- `DEFAULT_FB_DOC_IDS` chỉ có `GROUP_FEED`, `PAGE_FEED`, `COMMENT_ROOTS`, `COMMENT_REPLIES`, `COMMENT_REPLIES_DEPTH2` [dòng 39-49].
- Legacy `src/scrapers/facebook/` không đụng.

### Story 13.4 (Done)

- `FacebookClient` hỗ trợ `browserBridge`, `cdpUrl`, `launchChrome`.
- `FacebookBrowserBridge` dùng Playwright mặc định, Puppeteer khi `XACTIONS_SCRAPER_ADAPTER=puppeteer`.
- Per-account profile dir `.data/facebook-profiles/<c_user>`; sticky proxy + anti-leak browser args.
- HTTP-only `#fetchTokens` là fallback và được đánh dấu `deprecated-planned`.

## Project Context Reference

- Epic 13: `_bmad-output/planning-artifacts/epics.md#epic-13-high-throughput-hybrid-scraping-engine-twitter--facebook-refactor`
- FR-72: `_bmad-output/planning-artifacts/prd.md` dòng 80
- AD-2/AD-3/AD-4/AD-10/AD-11/AD-12/AD-14/AD-15: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`

## Dev Agent Record

### Agent Model Used

- `swe-1-7` (SWE-1.7 Max)

### Debug Log References

- `FacebookClient.requestGraphQl` trace: `src/scrapers/social/facebook/client.js:432-514`
- `FacebookClient.buildGraphQlBody` trace: `src/scrapers/social/facebook/client.js:385-423`
- `FacebookCrawler` action registry: `src/scrapers/social/facebook/crawler.js:106-133`
- `FacebookBrowserBridge.extractTokens`: `src/scrapers/social/facebook/signer-bridge.js:384-482`
- `ThreadsCrawler.#emitCheckpointAndStream`: `src/scrapers/social/threads/crawler.js:114-152`
- `PrismaStore.storeBatch` chunking: `src/store/prisma-store.js:217-228`
- `CrawlCheckpoint` Prisma schema: `prisma/schema.prisma:389-406`

### Completion Notes List

- [ ] Tạo `schemas/facebook/social.json` với ProfileItem metadata schema.
- [ ] Tạo `src/scrapers/social/facebook/normalize-profile.js` với `normalizeFacebookProfile`, `normalizeFacebookFollower`, `normalizeFacebookGroupMember`.
- [ ] Sử dụng `FacebookClient.requestGraphQl()` làm dispatcher; không tạo `graphql-dispatcher.js` riêng.
- [ ] Thêm action `profile`, `followers`, `following`, `group_members` vào `FacebookCrawler`.
- [ ] Đảm bảo namespaced ID `facebook:${externalId}` cho mọi output.
- [ ] Lưu kết quả qua `PrismaStore` mapping `ProfileItem` → `PostItem` với `publishedAt: null`.
- [ ] Triển khai `PrismaStore.saveCheckpoint()` (hoặc fallback `prisma.crawlCheckpoint.upsert()`) và emit `stream:social:raw_posts`.
- [ ] Thêm `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers` và cập nhật `docs/deprecation-plan.md`.
- [ ] Viết tests thực (no mocks) cho các action mới.

### File List

- `src/scrapers/social/facebook/crawler.js` (update)
- `src/scrapers/social/facebook/client.js` (update)
- `src/scrapers/social/facebook/index.js` (update)
- `src/scrapers/social/facebook/validator.js` (update)
- `src/core/types.js` (update)
- `types/core.d.ts` (update)
- `src/store/prisma-store.js` (update — saveCheckpoint / prisma exposure)
- `src/scrapers/social/facebook/normalize-profile.js` (create)
- `schemas/facebook/social.json` (create)
- `tests/scrapers/social/facebook/crawler-profile.test.js` (create)
- `docs/deprecation-plan.md` (update)
- `src/scrapers/facebook/profile.js` (deprecation JSDoc only)
- `src/scrapers/facebook/followers.js` (deprecation JSDoc only)
