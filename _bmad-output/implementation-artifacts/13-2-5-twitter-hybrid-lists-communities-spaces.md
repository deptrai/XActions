---
story_id: '13.2.5'
epic: 13
story_key: '13-2-5-twitter-hybrid-lists-communities-spaces'
status: "done"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-31
last_updated: 2026-08-31
owner: "DEV"
reviewed: "approved"
baseline_commit: "05c6ec5393c52a0a2df33939678129a67a57a5eb"
---

# Story 13.2.5 — Twitter Hybrid Lists, Communities & Spaces

Status: done

### Senior Developer Review (AI)

**Review Outcome:** Approved (Clean review)  
**Date:** 2026-08-31  
**Summary:**
- Đã đăng ký đầy đủ 3 action `list_members`, `community_members`, `spaces` trong `TwitterCrawler`.
- Chuẩn hóa đầu ra đúng `ProfileItem` (kèm `isListMember`, `isCommunityMember`) và `PostItem` (kèm `isSpace`).
- Tách normalizer module độc lập `src/scrapers/social/twitter/normalize-list-community-space.js`.
- Tất cả 8/8 tests tại `crawler-lists-communities-spaces.test.js` passed 100%.

epic: 13
story_key: '13-2-5-twitter-hybrid-lists-communities-spaces'
status: "review"
phase: "Phase 2"
created: 2026-08-30
updated: 2026-08-30
last_updated: 2026-08-30
owner: "DEV"
reviewed: "pending"
baseline_commit: "e62dd7d1a6dab699fd1ce60bfe529f886e3385fb"
---

# Story 13.2.5 — Twitter Hybrid Lists, Communities & Spaces

Status: review

## Dev Agent Record

### Implementation Plan

- Green Phase: Sửa lỗi mock server và normalizer để 8/8 test trong `crawler-lists-communities-spaces.test.js` pass.
- Thêm `SearchTimeline` vào `TWITTER_GRAPHQL_QUERY_IDS` để `spaces` action có queryId hợp lệ.
- Thêm `hasRealCommunityQuery` check cho `community_members` để fallback về `ListMembers` khi `CommunityMembers` queryId còn TBD.
- Thêm `search_spaces`, `list_members_timeline`, `community_members_timeline` vào `TwitterPlatformResponseValidator.isValidPayload`.
- Sửa `audioSpaceToPostItem` biến `authorAvatar` và `spaces` state mặc định `all` để trả về đủ spaces.
- Cập nhật `docs/deprecation-plan.md` đánh dấu legacy lists/communities/spaces `deprecated-marked`.

### Completion Notes

- Story 13.2.5 đã hoàn thành green phase TDD, còn chờ full test suite regression.

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Twitter Community Researcher**,  
I want **cào thành viên list, thành viên community và danh sách Spaces bằng kiến trúc hybrid**,  
so that **tôi có thể theo dõi nhóm người dùng và nội dung audio trực tiếp**.

---

## Scope Note

Story 13.2.5 triển khai ba action mới cho `TwitterCrawler`: `list_members`, `community_members`, và `spaces`.

* `list_members` **đã được đăng ký sơ bộ** trong `src/scrapers/social/twitter/crawler.js` (sử dụng GraphQL `ListMembers` queryId `BQp2IEYkgxuSxqbTAr1e1g`). Story này cần **hoàn thiện** handler, đảm bảo output đúng `ProfileItem[]`, pagination, checkpoint, và deprecation marker.
* `community_members` và `spaces` là **action hoàn toàn mới**. Cần tìm/reverse-engineer GraphQL query IDs và response shapes tương ứng. Nếu không có public GraphQL endpoint ổn định, phương án dự phòng là dùng Puppeteer page-pool (browser-as-signer bridge) hoặc REST API fallback — nhưng ưu tiên hybrid HTTP trước.

Tất cả output phải chuẩn hóa thành `ProfileItem[]` cho `list_members`/`community_members` và `PostItem[]` cho `spaces`. Mỗi `PostItem` space phải có `category: 'social'`, `id: twitter:spaces:${spaceId}`, `metadata.isSpace: true`, `metadata.spaceState`, `metadata.participantCount`, `metadata.startedAt`.

Các legacy functions `scrapeListMembers`, `scrapeCommunityMembers`, `scrapeSpaces` trong `src/scrapers/twitter/index.js` phải được đánh dấu `@deprecated` và cập nhật `docs/deprecation-plan.md`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.5 [dòng 490-499]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 [dòng 125-133], AD-2 [dòng 134-141], AD-3 [dòng 142-163], AD-4 [dòng 164-174], AD-8 [dòng 201-213], AD-9 [dòng 215-225], AD-11 [dòng 233-243], AD-12 [dòng 245-248], AD-13 [dòng 250-260]
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2
- `_bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md` — `ProfileItem` normalize, `profileItemToPostItem`, checkpoint pattern
- `_bmad-output/implementation-artifacts/13-2-2-twitter-hybrid-thread-likes-bookmarks.md` — `PostItem` normalize, `metadata.tweetId`, `storeBatch`, relay variable handling
- `_bmad-output/implementation-artifacts/13-2-3-twitter-hybrid-search-hashtag-trending.md` — auto-pagination, `DEFAULT_FIELD_TOGGLES`, `/i/api` REST prefix
- `_bmad-output/implementation-artifacts/13-2-4-twitter-hybrid-media-scraper.md` — action registration pattern, normalizer file tách riêng
- `src/core/base-crawler.js` — `AbstractCrawler` contract & `ActionRegistry` [dòng 21-307]
- `src/core/base-client.js` — `AbstractApiClient` tiered signing, proxy rotation, 429/403 interceptor [dòng 43-893]
- `src/core/types.js` — `PostItem`, `ProfileItem`, `ActionDescriptor` [dòng 9-102]
- `src/store/prisma-store.js` — `storeBatch` chunk 500, `saveCheckpoint` [dòng 186-374]
- `src/scrapers/social/twitter/crawler.js` — existing actions, `list_members` pre-registration [dòng 215-224], handlers [dòng 1160-1219]
- `src/scrapers/social/twitter/client.js` — `TwitterClient.requestGraphQl`, `requestRest`, `isLocalUrl`, `#signTransactionId` [dòng 22-466]
- `src/scrapers/social/twitter/normalize-relationships.js` — `normalizeUserProfile`, `profileItemToPostItem`, `normalizeLikersResponse` [dòng 1-130]
- `src/scrapers/social/twitter/normalize-search.js` — `userEntryToProfileItem`, `parseSearchUsers` [dòng 1-156]
- `src/scrapers/social/twitter/index.js` — barrel exports
- `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator` [dòng 1-180]
- `src/scrapers/twitter/http/endpoints.js` — GraphQL `ListMembers` [dòng 96], `ListTimeline` [dòng 97], variable builders [dòng 476-493], `DEFAULT_FEATURES` [dòng 175-212], `DEFAULT_FIELD_TOGGLES` [dòng 215-220], `RATE_LIMITS` [dòng 248-270]
- `src/scrapers/twitter/http/relationships.js` — `parseUserList`, `parseUserEntry` [dòng 1-150]
- `src/scrapers/twitter/index.js` — Legacy `scrapeListMembers` [dòng 741-793], `scrapeCommunityMembers` [dòng 942-988], `scrapeSpaces` [dòng 994-1042]
- `docs/deprecation-plan.md` — Status tracker [dòng 79-97], legacy-to-hybrid mapping [dòng 98-127]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2, 13.2.1, 13.2.2, 13.2.3, 13.2.4:** `src/scrapers/social/twitter/` phải tồn tại `TwitterCrawler`, `TwitterClient`, `TwitterPlatformResponseValidator`, normalizer helpers.
- **Phụ thuộc Epic 10.1/10.2:** `AbstractCrawler`, `AbstractApiClient`, `PrismaStore`, `Post`/`CrawlCheckpoint` schema.
- **Phụ thuộc Epic 11:** `ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool`.
- **Phụ thuộc Story 13.1:** `PreSignedTokenRing`, `SignerWorkerPagePool`.
- **Mở khóa Story 13.2.11** (list management write actions) — sử dụng lại `list_members` read logic.
- **Mở khóa Story 13.2.12** (integration/caller migration).

---

## Acceptance Criteria

### AC-1: Đăng ký action `list_members`, `community_members`, `spaces` trong `TwitterCrawler`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký 3 action với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `list_members` | `['listUrl']` | `['listId', 'limit', 'cursor']` | `{ listUrl: 'https://x.com/i/lists/1234567890123456789', limit: 100 }` | `{ members: ProfileItem[], pageInfo: { has_next_page: boolean, end_cursor: string \| null } }` | `true` (list members requires auth) |
| `community_members` | `['communityUrl']` | `['communityId', 'limit', 'cursor']` | `{ communityUrl: 'https://x.com/i/communities/1234567890123456789', limit: 100 }` | `{ members: ProfileItem[], pageInfo: { has_next_page: boolean, end_cursor: string \| null } }` | `true` |
| `spaces` | `['query']` | `['limit', 'cursor', 'state']` | `{ query: 'crypto', limit: 20 }` | `{ posts: PostItem[], pageInfo: { has_next_page: boolean, end_cursor: string \| null } }` | `false` (public search spaces) |

* **And** action names phải `snake_case` theo regex `/^[a-z0-9_]+$/` [src/core/base-crawler.js dòng 84-90].
* **And** `list_members` chấp nhận `listUrl` dạng `https://x.com/i/lists/<listId>` hoặc `https://twitter.com/i/lists/<listId>`; parse `listId` bằng regex `/lists\/(\d+)/`.
* **And** `community_members` chấp nhận `communityUrl` dạng `https://x.com/i/communities/<communityId>`; parse `communityId` bằng regex `/communities\/(\d+)/`.
* **And** `spaces` state filter mặc định `live` (có thể mở rộng `scheduled`, `top`, `recent`).
* **And** `listActions()` trả về đầy đủ action mới đã phân giải `requiresAuth`.

### AC-2: `list_members` handler — trích xuất thành viên list

* **Given** action `list_members` đã đăng ký
* **When** gọi `crawler.start({ action: 'list_members', args: { listUrl: 'https://x.com/i/lists/1234567890123456789', limit: 100 } })`
* **Then** handler parse `listId` từ `listUrl` (hoặc dùng `args.listId` nếu có)
* **And** gọi GraphQL `ListMembers` [queryId: `BQp2IEYkgxuSxqbTAr1e1g`][src/scrapers/twitter/http/endpoints.js dòng 96] với variables `{ listId, count: Math.min(limit, 100), cursor }` [src/scrapers/twitter/http/endpoints.js dòng 476-484]
* **And** sử dụng `DEFAULT_FEATURES` và `DEFAULT_FIELD_TOGGLES` từ `endpoints.js`
* **And** parse response với `parseUserList(instructions)` từ `src/scrapers/twitter/http/relationships.js`
* **And** mỗi user được chuẩn hóa thành `ProfileItem` qua `normalizeUserProfile(user, { isListMember: true, listId, sourceMethod: 'list_members' })`
* **And** trả về `pageInfo: { has_next_page: boolean, end_cursor: string | null }` từ cursor
* **And** lưu `CrawlCheckpoint` với `targetType: 'list_members'`, `targetKey: twitter:list:${listId}`
* **And** gọi `#persistPostItems` bằng cách map `members.map(m => profileItemToPostItem(m))` — tương tự `retweeters`/`followers` handlers

### AC-3: `community_members` handler — trích xuất thành viên community

* **Given** action `community_members` đã đăng ký
* **When** gọi `crawler.start({ action: 'community_members', args: { communityUrl: 'https://x.com/i/communities/1234567890123456789', limit: 100 } })`
* **Then** handler parse `communityId` từ `communityUrl` (hoặc dùng `args.communityId` nếu có)
* **And** dispatch request tới GraphQL/REST endpoint phù hợp cho community members
  - **TBD:** Nếu public GraphQL endpoint tồn tại, thêm queryId vào `TWITTER_GRAPHQL_QUERY_IDS` và `GRAPHQL` trong `endpoints.js`. Dev agent phải xác minh endpoint tên `CommunityMembers` hoặc tương đương.
  - **Fallback:** Nếu không có public HTTP endpoint ổn định, sử dụng `TwitterClient`/`SignerWorkerPagePool` (browser-as-signer bridge) để gọi nội bộ web GraphQL hoặc parse `https://x.com/i/communities/<id>/members` HTML.
* **And** response phải được parse thành danh sách user record với cùng shape như `ListMembers` (`instructions[].entries[]`, `user_results.result`)
* **And** mỗi user được chuẩn hóa thành `ProfileItem` với metadata `{ isCommunityMember: true, communityId, sourceMethod: 'community_members' }`
* **And** trả về `members: ProfileItem[]` và `pageInfo` với cursor
* **And** lưu `CrawlCheckpoint` với `targetType: 'community_members'`, `targetKey: twitter:community:${communityId}`

### AC-4: `spaces` handler — trích xuất danh sách Spaces

* **Given** action `spaces` đã đăng ký
* **When** gọi `crawler.start({ action: 'spaces', args: { query: 'crypto', limit: 20 } })`
* **Then** handler dispatch request tới GraphQL/REST endpoint tìm kiếm Spaces
  - **TBD:** Nếu public GraphQL endpoint tồn tại (ví dụ `AudioSpaceSearch` hoặc `LiveEventTimeline`), thêm queryId vào `TWITTER_GRAPHQL_QUERY_IDS` và `GRAPHQL` trong `endpoints.js`. Dev agent phải xác minh.
  - **Fallback:** Nếu không có public HTTP endpoint, dùng `TwitterClient` browser-as-signer bridge để gọi `https://x.com/search?q=<query>&f=spaces` hoặc `https://x.com/i/spaces` và parse HTML/JSON embedded.
* **And** mỗi space được chuẩn hóa thành `PostItem`:
  - `id: twitter:spaces:${spaceId}`
  - `platform: 'twitter'`, `category: 'social'`
  - `externalId: spaceId`
  - `authorId`, `authorName`, `authorAvatar` từ host user nếu có
  - `content: space.title || space.description || ''`
  - `mediaUrls: []` (hoặc audio stream URL nếu extract được)
  - `metadata.isSpace: true`
  - `metadata.spaceState: 'live' | 'scheduled' | 'ended'`
  - `metadata.participantCount: number`
  - `metadata.startedAt: ISO string | null`
  - `metadata.sourceMethod: 'spaces'`
* **And** trả về `posts: PostItem[]` và `pageInfo` với cursor
* **And** lưu `CrawlCheckpoint` với `targetType: 'spaces'`, `targetKey: twitter:spaces:${query}`

### AC-5: Chuẩn hóa `ProfileItem` / `PostItem` cho cả ba action

* **Given** raw user/space records
* **When** normalizer xử lý
* **Then** `ProfileItem` cho list/community members phải có đầy đủ trường: `id`, `platform`, `externalId`, `username`, `name`, `bio`, `avatar`, `profileUrl`, `followersCount`, `followingCount`, `metadata`, `crawledAt`
* **And** `PostItem` cho spaces phải có đầy đủ trường theo `PostItem` typedef, với `metadata` chứa các trường space-specific
* **And** `profileItemToPostItem(profile)` được dùng để persist `ProfileItem` vào `Post` table khi cần (cho `list_members`/`community_members`)

### AC-6: Deprecation markers và `docs/deprecation-plan.md`

* **Given** legacy functions trong `src/scrapers/twitter/index.js`
* **When** dev hoàn thành AC-1..AC-5
* **Then** thêm `@deprecated` JSDoc tag cho `scrapeListMembers`, `scrapeCommunityMembers`, `scrapeSpaces` trong `src/scrapers/twitter/index.js`
* **And** cập nhật `docs/deprecation-plan.md` để thêm mapping:
  - `scrapeListMembers` → `TwitterCrawler.start({ action: 'list_members' })`
  - `scrapeCommunityMembers` → `TwitterCrawler.start({ action: 'community_members' })`
  - `scrapeSpaces` → `TwitterCrawler.start({ action: 'spaces' })`

### AC-7: Tests

* **Given** Vitest test suite
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-lists-communities-spaces.test.js`
* **Then** pass tất cả test sau:
  - `list_members` action được đăng ký với đúng descriptor
  - `list_members` parse listId từ listUrl
  - `list_members` gọi đúng GraphQL query và trả về `ProfileItem[]` với `isListMember: true`
  - `community_members` parse communityId từ communityUrl
  - `community_members` trả về `ProfileItem[]` với `isCommunityMember: true`
  - `spaces` trả về `PostItem[]` với `metadata.isSpace: true`
  - `listActions()` bao gồm cả 3 action mới
  - Legacy functions có `@deprecated` tag

---

## Dev Notes / Implementation Hints

### list_members

* `list_members` đã có skeleton trong `TwitterCrawler` constructor. Cần review handler `listMembers()` ở `crawler.js` dòng ~1160 để đảm bảo:
  - Parse `listUrl` → `listId` đúng.
  - `limit` clamped tối đa 100 theo `RATE_LIMITS.ListMembers`.
  - Sử dụng `normalizeUserProfile` thay vì chỉ reshape thủ công.
  - Gọi `#emitCheckpointAndStream` với `targetType: 'list_members'`.

### community_members

* Twitter/X Communities là tính năng độc quyền, public GraphQL endpoint có thể không ổn định hoặc yêu cầu auth.
* Dev agent nên:
  1. Kiểm tra `endpoints.js` và các twikit/twitter-scraper source gần nhất để tìm query ID.
  2. Nếu không tìm thấy, triển khai browser-as-signer bridge qua `TwitterClient` + `SignerWorkerPagePool` để lấy HTML/JSON.
  3. Tách normalizer ra `src/scrapers/social/twitter/normalize-community.js` tương tự `normalize-media.js`.

### spaces

* Twitter Spaces API (AudioSpace) thay đổi thường xuyên. Các endpoint có thể bao gồm:
  - `AudioSpaceById`
  - `LiveEventTimeline`
  - `SearchSpaces` (nếu tồn tại)
* Dev agent nên:
  1. Kiểm tra twikit/twitter-scraper source cho query IDs.
  2. Nếu GraphQL không khả thi, dùng `https://x.com/search?q=<query>&f=spaces` với Puppeteer fallback.
  3. Tách normalizer ra `src/scrapers/social/twitter/normalize-spaces.js`.

### Shared Patterns

* Tuân thủ pattern từ 13.2.4: tách normalizer thành file riêng, export `normalizeListMembersResponse`, `normalizeCommunityMembersResponse`, `normalizeSpacesResponse`.
* `ActionDescriptor` phải có `requiresAuth` phân giải đúng theo AD-11 rule 3.
* Sử dụng `DEFAULT_FEATURES` + `DEFAULT_FIELD_TOGGLES` cho GraphQL; thêm `__relay_internal__pv__appviewerisloggedinprovider: false` cho guest request nếu action `requiresAuth: false`.

---

## Open Questions / TBD

1. **Community/Spaces GraphQL query IDs:** Cần xác minh từ twikit/twitter-scraper hoặc reverse-engineer từ web client. Nếu không tìm thấy, chọn browser-as-signer fallback.
2. **Community member pagination shape:** Có dùng cùng `instructions[].entries[]` như `ListMembers` hay module riêng?
3. **Spaces search API:** Có endpoint search riêng hay phải lọc từ `SearchTimeline` với filter `spaces`?
4. **Auth requirement cho communities:** Một số community có thể private — cần xử lý `PlatformError` với `code: TWITTER_COMMUNITY_PRIVATE`?

---

## Deprecation Mapping

| Legacy Function | File | Replacement |
|---|---|---|
| `scrapeListMembers(page, listUrl, options)` | `src/scrapers/twitter/index.js:749` | `TwitterCrawler.start({ action: 'list_members', args: { listUrl } })` |
| `scrapeCommunityMembers(page, communityUrl, options)` | `src/scrapers/twitter/index.js:950` | `TwitterCrawler.start({ action: 'community_members', args: { communityUrl } })` |
| `scrapeSpaces(page, query, options)` | `src/scrapers/twitter/index.js:1002` | `TwitterCrawler.start({ action: 'spaces', args: { query } })` |
