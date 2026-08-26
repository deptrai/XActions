---
story_id: "13.5"
epic: 13
story_key: "13-5-facebook-hybrid-profile-followers-group-members"
status: "ready-for-dev"
phase: "Phase 4"
created: 2026-08-27
updated: 2026-08-27
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
- `src/scrapers/social/facebook/crawler.js` — patterns `groupPosts`/`pagePosts`/`getCommentsForPost` để viết handler mới [dòng 536-637, 688-834]
- `src/scrapers/facebook/core.js` — `assertFacebookUrlLocal`, `NON_PROFILE_SEGMENTS`, `normalizeHandle` (qua `normalize.js`) [dòng 58-64, 348-367]
- `src/scrapers/facebook/normalize.js` — `normalizeProfile`, `normalizeFollower`, `normalizeGroupMember` [dòng 86-122, 314-322, 647-?]
- `src/scrapers/facebook/followers.js` — `scrapeFollowers`, `scrapeGroupMembers` legacy patterns [dòng 34-210]
- `src/core/base-crawler.js` — `AbstractCrawler`, `registerAction`, `start`, `listActions` [dòng 21-244]
- `src/core/types.js` — `PostItem`, `CommentItem`, `ActionDescriptor` [dòng 9-47]
- `src/store/prisma-store.js` — `PrismaStore`, `storeBatch`, chunk 500 [dòng 13-220]
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
- **And** `listActions()` trả về `ActionDescriptor[]` với đúng `requiredArgs`, `optionalArgs`, `example`, `outputType` theo AD-11

### AC-3: FacebookGraphQLDispatcher (DocID/LSD)

- **Given** `FacebookClient` đã có `requestGraphQl` với DocID + `lsd`/`fb_dtsg` [dòng 432-514]
- **When** thêm các endpoint profile/followers/following/group_members
- **Then** sử dụng một `FacebookGraphQLDispatcher` (class hoặc `FacebookClient` đóng vai trò dispatcher) để gửi `doc_id`, `variables`, và form-urlencoded body qua `AbstractApiClient.request()`
- **And** `lsd` được lấy từ `PreSignedTokenRing` hoặc token cache; `fb_dtsg`/`jazoest`/`__spin_*` được inject đúng như `buildGraphQlBody` [dòng 385-423]
- **And** nếu GraphQL trả lỗi hoặc shape không mong đợi, trả `PlatformError` với `suggestedAction: 'retry_after_delay'` (không throw panic) [dòng 502-510]

### AC-4: Profile Hybrid

- **Given** `username` hoặc `url` (vd `zuck`, `https://www.facebook.com/zuck`)
- **When** gọi `crawler.start({ action: 'profile', args: { username } })` hoặc `{ url }`
- **Then** `FacebookCrawler` parse tham số thành `targetKey` (handle/userId), gọi GraphQL hoặc `FacebookBrowserBridge` nếu endpoint chưa ổn định
- **And** trả về `ProfileItem` với `id: 'facebook:${externalId}'`, `platform: 'facebook'`
- **And** `ProfileItem` chứa `name`, `username`, `bio`, `avatar`, `profileUrl`, `followersCount`, `followingCount`, `metadata`

### AC-5: Followers & Following Hybrid

- **Given** `username` hoặc `url`
- **When** gọi `crawler.start({ action: 'followers', args: { username, limit } })` hoặc `action: 'following'`
- **Then** `FacebookCrawler` gọi GraphQL với pagination cursor cho đến khi đạt `limit`
- **And** trả về `ProfileItem[]`, mỗi item `id: 'facebook:${externalId}'`
- **And** nếu Facebook không expose list (personal profile), trả về `PlatformError` với `type: 'invalid_args'` hoặc note object không lưu vào DB

### AC-6: Group Members Hybrid

- **Given** `groupUrl` hoặc `groupId` (vd `https://www.facebook.com/groups/123456`)
- **When** gọi `crawler.start({ action: 'group_members', args: { groupUrl, limit } })`
- **Then** `FacebookCrawler` parse `groupUrl` thành `groupId`, validate URL (SSRF guard), gọi GraphQL hoặc browser fallback
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
- **Then** `profile` được lưu dưới dạng `PostItem` mapping (category `'social'`) qua `store.storeBatch(..., { upsert: true })`
- **And** `followers`/`following`/`group_members` được lưu theo batch chunk 500 (nếu store được cung cấp)
- **And** cập nhật `CrawlCheckpoint` với `{ platform: 'facebook', targetType, targetKey, lastCursor }` theo AD-12

### AC-9: Deprecation Markers

- **Given** các hàm legacy `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers` trong `src/scrapers/facebook/`
- **When** Story 13.5 hoàn thành
- **Then** thêm `@deprecated` JSDoc vào `src/scrapers/facebook/profile.js#scrapeProfile`, `src/scrapers/facebook/followers.js#scrapeFollowers`, `src/scrapers/facebook/followers.js#scrapeGroupMembers`
- **And** cập nhật `docs/deprecation-plan.md` ghi rõ các hàm trên được thay thế bởi `FacebookCrawler` action `profile`, `followers`, `following`, `group_members`

### AC-10: Kiểm thực (No Mocks)

- **Given** test suite mới `tests/scrapers/social/facebook/crawler-profile.test.js`
- **When** chạy `npm test`
- **Then** không dùng `vi.fn`, mock, stub, fake
- **And** dùng `http.createServer` để serve Facebook-like HTML + JSON GraphQL cho `profile`, `followers`, `following`, `group_members`
- **And** `npm run typecheck` pass
- **And** chạy `npm test -- tests/scrapers/social/facebook/` pass

## Tasks / Subtasks

- [ ] T1: Thêm `ProfileItem` type/normalizer và `FacebookGraphQLDispatcher` (AC-3, AC-7)
  - [ ] T1.1: Định nghĩa `ProfileItem` JSDoc/typedef (id, platform, externalId, username, name, bio, avatar, profileUrl, followersCount, followingCount, metadata, crawledAt)
  - [ ] T1.2: Tạo `src/scrapers/social/facebook/normalize-profile.js` (hoặc tích hợp vào `crawler.js`) với `normalizeProfile`, `normalizeFollower`, `normalizeGroupMember`, `namespacedId`
  - [ ] T1.3: Tạo/tái sử dụng `FacebookGraphQLDispatcher` (DocID/LSD) tại `src/scrapers/social/facebook/graphql-dispatcher.js` hoặc mở rộng `FacebookClient`
  - [ ] T1.4: Bổ sung `DEFAULT_FB_DOC_IDS` placeholders cho `PROFILE`, `FOLLOWERS`, `FOLLOWING`, `GROUP_MEMBERS` [dòng 39-49 crawler.js]
- [ ] T2: Mở rộng `FacebookClient` (AC-3)
  - [ ] T2.1: Thêm helper `resolveTargetKey(username|url)` sử dụng `normalizeHandle` pattern
  - [ ] T2.2: Thêm `resolveGroupId(groupUrl)` với `assertFacebookUrlLocal` SSRF guard
  - [ ] T2.3: Đảm bảo `requestGraphQl` hỗ trợ doc_id mới và graceful doc_id rotation
- [ ] T3: Mở rộng `FacebookCrawler` với action mới (AC-2, AC-4, AC-5, AC-6)
  - [ ] T3.1: `registerAction('profile', ...)` handler `profile(args, session)`
  - [ ] T3.2: `registerAction('followers', ...)` handler với pagination
  - [ ] T3.3: `registerAction('following', ...)` handler với pagination
  - [ ] T3.4: `registerAction('group_members', ...)` handler với group URL parsing
  - [ ] T3.5: `getGroupPosts`/`getPagePosts` hiện có giữ nguyên (không regression)
- [ ] T4: Lưu trữ & Checkpoint (AC-8)
  - [ ] T4.1: Mapping `ProfileItem` → `PostItem` cho `store.storeBatch`
  - [ ] T4.2: Batch chunk 500 cho followers/group_members
  - [ ] T4.3: Ghi `CrawlCheckpoint` sau mỗi action với cursor/timestamp
- [ ] T5: Deprecation markers (AC-9)
  - [ ] T5.1: Thêm `@deprecated` JSDoc trong `src/scrapers/facebook/profile.js#scrapeProfile` [dòng 180]
  - [ ] T5.2: Thêm `@deprecated` JSDoc trong `src/scrapers/facebook/followers.js#scrapeFollowers` [dòng 34]
  - [ ] T5.3: Thêm `@deprecated` JSDoc trong `src/scrapers/facebook/followers.js#scrapeGroupMembers` [dòng 128]
  - [ ] T5.4: Cập nhật `docs/deprecation-plan.md` status tracker
- [ ] T6: Tests (AC-10)
  - [ ] T6.1: Tạo `tests/scrapers/social/facebook/crawler-profile.test.js`
  - [ ] T6.2: Local server trả về tokens + JSON GraphQL cho profile/followers/following/group_members
  - [ ] T6.3: Kiểm tra Namespaced ID `facebook:${externalId}`
  - [ ] T6.4: Kiểm tra `listActions()` và deprecation marker tồn tại
  - [ ] T6.5: `npm run typecheck` + `npm test -- tests/scrapers/social/facebook/`

## Dev Notes

### Project Structure Notes

- **Target folder:** `src/scrapers/social/facebook/` — tất cả code hybrid mới thuộc folder này theo AD-8.
- **Legacy folder:** `src/scrapers/facebook/` (Puppeteer) **KHÔNG sửa logic** ngoài việc thêm `@deprecated` JSDoc; sẽ decommission ở Epic 20.2.
- **Pattern reuse:** Không có `src/scrapers/social/facebook/core.js`; tái sử dụng patterns từ `src/scrapers/social/facebook/crawler.js` (cấu trúc handler `groupPosts`/`pagePosts`/`getCommentsForPost`) và từ legacy `src/scrapers/facebook/core.js` (`assertFacebookUrlLocal`, `NON_PROFILE_SEGMENTS`, `normalizeHandle`).
- **Legacy dispatcher:** `src/scrapers/index.js` giữ nguyên để tránh break `scrape('facebook', ...)` cũ.
- **Conflict / variance:**
  - `epics.md` yêu cầu `PostItem (profile) / CommentItem / ProfileItem` — `src/core/types.js` chưa có `ProfileItem`, cần định nghĩa trong story này và map sang `PostItem` khi lưu PrismaStore.
  - `FacebookGraphQLDispatcher` chưa tồn tại; nếu `FacebookClient` đã đóng vai trò dispatcher, hãy tách hoặc đặt alias để đáp ứng tên yêu cầu mà không phá test 13.3.

### Core Code State to Preserve

- `FacebookClient.requestGraphQl` **chỉ merge `headers`, `body`, `cookies`** vào `this.request()`; không dùng `requestWithSign()` vì `AbstractApiClient.requestWithSign()` không merge `signResult.body` (13.3 Dev Notes [dòng 133]).
- `FacebookClient.#fetchTokens` (HTTP regex extraction) được đánh dấu `deprecated-planned` trong 13.4; vẫn giữ làm fallback.
- `FacebookBrowserBridge.extractTokens` là mặc định khi `cdpUrl`/`launchChrome` được cấu hình; Playwright mặc định, Puppeteer khi `XACTIONS_SCRAPER_ADAPTER=puppeteer` (13.4 AC-5).
- `AbstractCrawler.start()` tự động resolve `accountId`, kiểm tra `governor`, rồi gọi handler `(args, session)` [dòng 149-244].
- `AbstractCrawler.registerAction()` bắt buộc tên `snake_case` regex `^[a-z0-9_]+$` [dòng 84-90].

### Authentication & Token Handling

- `FacebookClient.ensureTokens(accountId, cookies)` trích `lsd`, `fb_dtsg`, `jazoest`, `spin_r`, `spin_t`, `hsi`, `c_user` từ browser hoặc HTML [dòng 211-267].
- Token cache theo `accountId:cookieHash` với TTL 5 phút và 30s pre-expiry refresh [dòng 215-221].
- `buildGraphQlBody` tạo `application/x-www-form-urlencoded` với `doc_id`, `variables`, `lsd`, `fb_dtsg`, ... [dòng 385-423].
- `FacebookClient` set `client = 'got'` [dòng 63]; body phải là string `URLSearchParams.toString()`.

### FacebookGraphQLDispatcher (DocID/LSD)

- **Mục tiêu:** Một lớp/utility chịu trách nhiệm gửi Facebook GraphQL request với DocID + token ring.
- **Cách triển khai an toàn:**
  - Option A: `FacebookClient` đã có `requestGraphQl` — coi `FacebookClient` như `FacebookGraphQLDispatcher`, thêm alias/tên gọi trong tài liệu.
  - Option B: Tách `buildGraphQlBody` + `requestGraphQl` thành `src/scrapers/social/facebook/graphql-dispatcher.js` (class `FacebookGraphQLDispatcher`), `FacebookClient` ủy quyền `requestGraphQl` sang dispatcher.
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

- `externalId` ưu tiên numeric `userId` từ GraphQL; nếu không có, dùng `username`.
- `id` luôn `facebook:${externalId}` (AD-4 Namespaced ID).

### Data Normalization

- `profile`:
  - Từ GraphQL `node { id, name, username, bio, profile_picture, followers_count, following_count }`.
  - Fallback HTML mbasic/desktop pattern từ `src/scrapers/facebook/profile.js` [dòng 30-258] nếu GraphQL doc_id chưa ổn định.
- `followers` / `following`:
  - Từ GraphQL edges `{ node: { id, name, username, profile_picture } }`.
  - Dừng khi đạt `limit` hoặc hết `page_info.end_cursor`.
  - Nếu endpoint trả list rỗng/restricted, trả `note` object (giống legacy `scrapeFollowers` [dòng 54-60]).
- `group_members`:
  - Từ GraphQL `group { members { edges } }`.
  - Parse `groupUrl` thành `groupId` bằng regex `/groups/([^/]+)/` hoặc `/groups/[^/]+/user/(\d+)/`.
  - Validate URL với `assertFacebookUrlLocal` trước navigation (AD-9 SSRF guard).

### Storage Mapping (PrismaStore)

Vì Prisma chưa có `Profile` model, map `ProfileItem` → `PostItem` khi lưu:

```js
const postItem = {
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
  metadata: { isProfile: true, ...profile.metadata },
  crawledAt: new Date(),
};
```

- Gọi `this.store.storeBatch([postItem], { upsert: true })`.
- Với `followers`/`following`/`group_members`, lặp và lưu batch chunk 500.

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

### CrawlerCheckpoint (AD-12)

- Mỗi action ghi `CrawlCheckpoint` với:
  - `platform: 'facebook'`
  - `targetType`: `'profile' | 'followers' | 'following' | 'group_members'`
  - `targetKey`: normalized handle hoặc groupId
  - `lastCursor`: `page_info.end_cursor` nếu có
  - `lastTimestamp`: thời điểm crawl

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 18, JSDoc + `npm run typecheck` (`tsc --noEmit`).
- **HTTP Client:** `got-scraping` mặc định (`client: 'got'`); `undici` fallback (AD-3).
- **Proxy:** `ProxyIpPool.getStickyProxy(accountId)` cho Facebook (AD-3); không direct fallback.
- **Storage:** `PrismaStore` với chunk 500 records (AD-4).
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
| AD-10 | 3-Tier Gap-Filling | `CrawlCheckpoint` ghi `lastCursor`/`lastTimestamp` cho profile/followers/following/group_members. |
| AD-11 | ActionRegistry | Đăng ký `profile`, `followers`, `following`, `group_members`; `listActions()` trả `ActionDescriptor[]`. |
| AD-12 | CrawlCheckpoint | `CrawlCheckpoint` với `@@unique([platform, targetType, targetKey])`. |
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
| `src/scrapers/social/facebook/graphql-dispatcher.js` | `FacebookGraphQLDispatcher` — DocID/LSD GraphQL dispatch wrapper (nếu tách từ `FacebookClient`). |
| `src/scrapers/social/facebook/normalize-profile.js` | Pure normalizers `normalizeProfile`, `normalizeFollower`, `normalizeGroupMember` với namespaced IDs. |
| `tests/scrapers/social/facebook/crawler-profile.test.js` | Tests thực cho `profile`, `followers`, `following`, `group_members`. |

### UPDATE

| File | Description |
|------|-------------|
| `src/scrapers/social/facebook/crawler.js` | Thêm action `profile`, `followers`, `following`, `group_members`; thêm `DEFAULT_FB_DOC_IDS` mới. |
| `src/scrapers/social/facebook/client.js` | Mở rộng `DEFAULT_FB_DOC_IDS`, thêm helpers parse handle/group URL nếu cần. |
| `src/scrapers/social/facebook/index.js` | Export `ProfileItem` normalizer và `FacebookGraphQLDispatcher` nếu tạo mới. |
| `src/scrapers/social/facebook/validator.js` | Nhận diện `profile`, `members`, `user` payloads. |
| `src/core/types.js` | Thêm `ProfileItem` JSDoc typedef. |
| `types/core.d.ts` | Thêm `ProfileItem` interface. |
| `docs/deprecation-plan.md` | Cập nhật status tracker cho `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers`. |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/core/base-client.js` | Hoàn thiện ở 13.1/13.3; chỉ dùng API. |
| `src/core/base-crawler.js` | Hoàn thiện ở 10.1; chỉ kế thừa. |
| `src/core/signer-pool.js` | Hoàn thiện ở 13.1. |
| `src/scrapers/facebook/` (logic) | Legacy; chỉ thêm `@deprecated` JSDoc. |
| `src/scrapers/index.js` | Legacy dispatcher; giữ backward compatibility. |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test`.
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** `http.createServer` phục vụ:
  - HTML home với `lsd`, `fb_dtsg`, `jazoest`, `__spin_*`.
  - JSON GraphQL cho `/api/graphql/` với `data.profile`, `data.user.friends`, `data.group.members`.
- **Real proxy:** `StaticProxyProvider` hoặc `ProxyIpPool` local.
- **Coverage tối thiểu:**
  - `listActions()` trả về đúng `ActionDescriptor[]`.
  - `profile({ username })` trả về `ProfileItem` với `id: 'facebook:${externalId}'`.
  - `followers({ username, limit })` trả về `ProfileItem[]` và phân trang.
  - `following({ username, limit })` tương tự.
  - `group_members({ groupUrl, limit })` parse URL + trả `ProfileItem[]`.
  - Response rỗng/restricted trả về `PlatformError` hoặc note object.
  - `cleanup()` gọi `client.close()` và không leak.
- **Regression:** `npm run typecheck` và `npm test -- tests/core/` phải pass.

## Previous Story Intelligence

### Story 13.3 (Done)

- `FacebookCrawler` kế thừa `AbstractCrawler`, đã đăng ký `group_posts`, `page_posts`, `get_comments` [dòng 107-132].
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
- `FacebookCrawler` action registry: `src/scrapers/social/facebook/crawler.js:106-133`
- `FacebookBrowserBridge.extractTokens`: `src/scrapers/social/facebook/signer-bridge.js:384-482`

### Completion Notes List

- [ ] Tạo/mở rộng `FacebookGraphQLDispatcher` và `ProfileItem` normalizer.
- [ ] Thêm action `profile`, `followers`, `following`, `group_members` vào `FacebookCrawler`.
- [ ] Đảm bảo namespaced ID `facebook:${externalId}` cho mọi output.
- [ ] Lưu kết quả qua `PrismaStore` mapping `ProfileItem` → `PostItem`.
- [ ] Thêm `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers` và cập nhật `docs/deprecation-plan.md`.
- [ ] Viết tests thực (no mocks) cho các action mới.

### File List

- `src/scrapers/social/facebook/crawler.js` (update)
- `src/scrapers/social/facebook/client.js` (update)
- `src/scrapers/social/facebook/index.js` (update)
- `src/scrapers/social/facebook/validator.js` (update)
- `src/core/types.js` (update)
- `types/core.d.ts` (update)
- `src/scrapers/social/facebook/graphql-dispatcher.js` (create)
- `src/scrapers/social/facebook/normalize-profile.js` (create)
- `tests/scrapers/social/facebook/crawler-profile.test.js` (create)
- `docs/deprecation-plan.md` (update)
- `src/scrapers/facebook/profile.js` (deprecation JSDoc only)
- `src/scrapers/facebook/followers.js` (deprecation JSDoc only)
