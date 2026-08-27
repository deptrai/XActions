---
story_id: '13.2.1'
epic: 13
story_key: '13-2-1-twitter-hybrid-profile-relationships'
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-28
updated: 2026-08-28
last_updated: 2026-08-28
owner: "DEV"
reviewed: "pending"
---

# Story 13.2.1 — Twitter Hybrid Profile & Relationships

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Twitter Growth Marketer**,  
I want **cào hồ sơ, followers, following, likers, retweeters, non-followers và thành viên list bằng `TwitterClient`/`TwitterCrawler` kiến trúc hybrid**,  
so that **tôi có thể xây dựng audience graph và phân tích mối quan hệ mà không cần mở Puppeteer tab mới**.

---

## Scope Note

Story 13.2.1 triển khai **profile & relationship actions** cho `TwitterCrawler` dựa trên `AbstractCrawler`/`AbstractApiClient` đã có ở `src/core/`. Story này phụ thuộc nền tảng từ Story 13.2 (foundation) và **bắt buộc tuân thủ 100% kiến trúc hybrid** (`PreSignedTokenRing` + `SignerWorkerPagePool` cho `x-client-transaction-id`) cùng `ProxyIpPool` sticky/rotate đã được củng cố ở các commit gần nhất (AD-3 rule 3b mới cập nhật 2026-08-27).

Tất cả output phải chuẩn hóa thành `ProfileItem`/`PostItem` với ID Namespaced `twitter:${externalId}` và ghi vào `PrismaStore` chunk 500 bản ghi. Các legacy function `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing` trong `src/scrapers/twitter/index.js` và `src/scrapers/twitter/http/relationships.js` phải được đánh dấu `@deprecated` theo kế hoạch decommission.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.2.1 [dòng 374-384], Story 13.2 [dòng 361-372], bảng phụ thuộc [dòng 21-24]
- `_bmad-output/planning-artifacts/prd.md` — FR-71, FR-65, NFR-11/12/15/18 [dòng 79, 78, 114-120, 171]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 [dòng 125-133], AD-2 [dòng 134-141], AD-3 [dòng 142-163], AD-4 [dòng 164-173], AD-8 [dòng 201-213], AD-9 [dòng 215-225], AD-10 [dòng 226-232], AD-11 [dòng 233-243], AD-12 [dòng 245-248], AD-13 [dòng 250-260], AD-14 [dòng 272-283], AD-18 [dòng 311-318]
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2 (AC-1..AC-4)
- `_bmad-output/implementation-artifacts/13-8-facebook-hybrid-marketplace.md` — mẫu triển khai hybrid gần nhất (action registry, `requestGraphQl`, normalizer, checkpoint, deprecation)
- `src/core/base-crawler.js` — `AbstractCrawler` contract & `ActionRegistry` integration [dòng 21-305]
- `src/core/base-client.js` — `AbstractApiClient` tiered signing, proxy rotation, 429/403 interceptor [dòng 43-893]
- `src/core/types.js` — `PostItem`, `ProfileItem`, `ActionDescriptor`, `CrawlerCommand` [dòng 9-101]
- `src/store/prisma-store.js` — `storeBatch` chunk 500, checkpoint save, metadata schema validation [dòng 13-365]
- `src/scrapers/twitter/http/endpoints.js` — GraphQL query IDs & `buildGraphQLUrl` [dòng 68-119, 324-332, 452-462]
- `src/scrapers/twitter/http/profile.js` — legacy parser `parseUserData`, `scrapeProfile` [dòng 131-218]
- `src/scrapers/twitter/http/relationships.js` — legacy `scrapeFollowers`, `scrapeFollowing`, `scrapeLikers`, `scrapeRetweeters`, `scrapeListMembers`, `scrapeNonFollowers` [dòng 48-517]
- `src/scrapers/twitter/validator.js` — `TwitterPlatformResponseValidator` hiện có [dòng 10-150]
- `src/scrapers/social/facebook/crawler.js` — `FacebookCrawler` constructor & action registration pattern [dòng 254-424]
- `src/scrapers/social/facebook/client.js` — `FacebookClient.requestGraphQl`/`buildGraphQlBody` pattern [dòng 74-570]
- `src/scrapers/social/facebook/normalize-profile.js` — mẫu `ProfileItem` → `PostItem` [dòng 62-97, 183-229]
- `schemas/twitter/social.json` — metadata schema cho Twitter social
- `docs/deprecation-plan.md` — mapping legacy → hybrid [dòng 21-27, 74-81, 90-101]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2** (`src/scrapers/social/twitter/` phải tồn tại `TwitterCrawler`/`TwitterClient` hoặc ít nhất skeleton từ AC của Story 13.2). Nếu Story 13.2 chưa được dev, dev phải hoàn thành phần nền (base `TwitterCrawler`, `TwitterClient`, `TwitterPlatformResponseValidator`) trước khi implement action 13.2.1.
- **Phụ thuộc Epic 10.1/10.2** (`AbstractCrawler`, `AbstractApiClient`, `PrismaStore`, `Post`/`Comment`/`CrawlCheckpoint` schema).
- **Phụ thuộc Epic 11** (`ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool` với sticky/rotate logic và action-level auth).
- **Phụ thuộc Story 13.1** (`PreSignedTokenRing`, `SignerWorkerPagePool` với `Promise.race()` timeout 3s).
- **Mở khóa Story 13.2.2** (thread/likes/bookmarks) — sử dụng lại `TwitterClient` GraphQL dispatch, normalizer, checkpoint pattern.
- **Mở khóa Story 13.2.12** (integration/caller migration) — `scrape('twitter','profile',...)` sẽ chuyển sang `TwitterCrawler`.

---

## Acceptance Criteria

### AC-1: Đăng ký action profile & relationships trong `TwitterCrawler`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký các action sau với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `profile` | `[]` | `['username', 'url']` | `{ username: 'elonmusk' }` | `{ profile: ProfileItem }` | `false` (public guest cho phép, nhưng opt-in `accountId` vẫn được tôn trọng) |
| `followers` | `['username']` | `['limit', 'cursor']` | `{ username: 'elonmusk', limit: 100 }` | `{ followers: ProfileItem[], pageInfo: any }` | `true` |
| `following` | `['username']` | `['limit', 'cursor']` | `{ username: 'elonmusk', limit: 100 }` | `{ following: ProfileItem[], pageInfo: any }` | `true` |
| `likers` | `['tweetId']` | `['limit', 'cursor']` | `{ tweetId: '1234567890', limit: 100 }` | `{ likers: ProfileItem[], pageInfo: any }` | `true` |
| `retweeters` | `['tweetId']` | `['limit', 'cursor']` | `{ tweetId: '1234567890', limit: 100 }` | `{ retweeters: ProfileItem[], pageInfo: any }` | `true` |
| `list_members` | `['listUrl']` | `['listId', 'limit', 'cursor']` | `{ listUrl: 'https://x.com/i/lists/123', limit: 100 }` | `{ members: ProfileItem[], pageInfo: any }` | `true` |
| `non_followers` | `['username']` | `['limit']` | `{ username: 'myuser', limit: 1000 }` | `{ nonFollowers: ProfileItem[], mutuals: ProfileItem[], stats: object }` | `true` |

* **And** tất cả action names phải là `snake_case` và không xung đột với action `search`, `timeline` của Story 13.2.
* **And** `listActions()` trả về đầy đủ 7 action với `requiresAuth` đã phân giải theo AD-11 rule 3.

### AC-2: `TwitterClient` GraphQL dispatch với hybrid signing

* **Given** `TwitterClient` kế thừa `AbstractApiClient` trong `src/scrapers/social/twitter/client.js`
* **When** gọi `requestGraphQl(queryId, operationName, variables, options)`
* **Then** client build URL `https://x.com/i/api/graphql/{queryId}/{operationName}?variables=...&features=...` theo `buildGraphQLUrl` trong `src/scrapers/twitter/http/endpoints.js` [dòng 324-332]
* **And** gửi headers: `authorization: Bearer <BEARER_TOKEN>`, `x-csrf-token: <ct0>`, `cookie: auth_token=...; ct0=...; guest_id=...` (nếu authenticated), `user-agent` từ `USER_AGENTS` [dòng 301-308]
* **And** sử dụng `requestWithSign` với `signType: 'page'` để sinh `x-client-transaction-id` header qua `SignerWorkerPagePool` với script evaluate từ on-demand JS của X (timeout 3,000ms, warmup 8,000ms) [AD-1 dòng 129-132]
* **And** dispatch HTTP qua `got-scraping` (mặc định) hoặc `undici.fetch` với sticky proxy cho auth request và rotating proxy cho no-auth request [AD-3 rule 3b]
* **And** `TwitterPlatformResponseValidator` phát hiện 429/403, rate-limit payload, bot challenge; `AbstractApiClient.request` tự động quarantine proxy, retry 3 lần, hibernate account khi cần [src/core/base-client.js dòng 538-773]

### AC-3: Handlers profile, followers, following, likers, retweeters, list_members, non_followers

* **Given** action đã đăng ký
* **When** gọi `crawler.start({ action, args, session })`
* **Then** handler `profile` gọi `UserByScreenName` hoặc `UserByRestId` [src/scrapers/twitter/http/endpoints.js dòng 71-72], parse `data.user.result` qua `parseTwitterProfile`, trả về `ProfileItem`
* **And** handlers `followers`/`following` gọi `Followers`/`Following` [dòng 88-89], paginate qua `cursor-bottom`, trả về `ProfileItem[]` với deduplication theo `username`
* **And** handlers `likers`/`retweeters` gọi `Likes`/`Retweeters` [dòng 92-93] với `tweetId`, parse `favoriters_timeline` / `retweeters_timeline`
* **And** handler `list_members` gọi `ListMembers` [dòng 96], parse `list.members_timeline`
* **And** handler `non_followers` gọi `following` rồi `followers` với cùng `limit`, tính set difference (`following.filter(f => !followerSet.has(f.username))`)
* **And** mọi handler pagination lưu `CrawlCheckpoint` với `platform='twitter'`, `targetType` (`user`/`tweet`/`list`/`non_followers`), `targetKey`, `lastCursor`, `lastCrawledAt` [src/store/prisma-store.js dòng 312-348]
* **And** mỗi request đều đi qua `governor.canAccountRequest` / `recordRequest` và `proxyPool.getStickyProxy(accountId)` nếu `requiresAuth: true`

### AC-4: Chuẩn hóa `ProfileItem`/`PostItem` và lưu trữ Namespaced

* **Given** response GraphQL hợp lệ
* **When** normalizer chạy
* **Then** `ProfileItem` có `id: twitter:${rest_id}`, `platform: 'twitter'`, `externalId: rest_id`, `username`, `name`, `bio` (đã expand t.co URLs), `avatar` (replace `_normal` → `_400x400`), `followersCount`, `followingCount`, `verified`, `protected`, `profileUrl`
* **And** khi lưu `ProfileItem[]` qua `PrismaStore.storeBatch`, chuyển đổi thành `PostItem` với `category: 'social'`, `authorId: rest_id`, `authorName: name`, `authorAvatar: avatar`, `content: bio \|\| name`, `mediaUrls: [avatar]`, `metadata` chứa `tweetId: rest_id`, `isProfile`, `isFollower`, `isFollowing`, `isLiker`, `isRetweeter`, `isListMember`, `isNonFollower`, `username`, `followersCount`, `followingCount`, `isVerified`, `protected`, `sourceMethod`, `cursor`, `listId` (nếu có)
* **And** `metadata.tweetId` bắt buộc để thỏa mãn `schemas/twitter/social.json` [dòng 56-59]
* **And** `PrismaStore` validate metadata, insert theo chunk 500, `skipDuplicates: true` [src/store/prisma-store.js dòng 180-228]
* **And** ID tuân theo Namespaced `twitter:${externalId}` [AD-4 dòng 167-168]

### AC-5: Deprecation marker và documentation

* **Given** `TwitterCrawler` đã đăng ký action profile/relationships
* **When** kiểm tra legacy code
* **Then** thêm JSDoc `@deprecated` và comment `// LEGACY — see docs/deprecation-plan.md` vào:
  - `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing` trong `src/scrapers/twitter/index.js`
  - `scrapeFollowers`, `scrapeFollowing`, `scrapeLikers`, `scrapeRetweeters`, `scrapeListMembers`, `scrapeNonFollowers` trong `src/scrapers/twitter/http/relationships.js`
  - `profile`, `followers`, `following`, `likes`, `retweeters`, `listMembers` helpers trong `src/client/Scraper.js` (nếu tồn tại)
* **And** cập nhật `docs/deprecation-plan.md` status tracker: Twitter Puppeteer & Twitter HTTP chuyển từ `deprecated-planned` sang `deprecated-marked` cho scope profile/followers/following; ghi rõ được thay thế bởi `twitter:profile`, `twitter:followers`, ...

### AC-6: Kiểm thử ATDD & smoke

* **Given** repo có `vitest` và `tests/scrapers/social/twitter/`
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-profile-relationships.test.js`
* **Then** tất cả AC-1..AC-5 có test red-phase hoặc green-phase tương ứng
* **And** test sử dụng local `node:http` server fake GraphQL với JSON response giống Twitter (không mock module — real implementation call real server) [mẫu: tests/scrapers/social/facebook/crawler-marketplace.test.js dòng 64-165]
* **And** có test smoke tùy chọn với `scripts/test-twitter-relationships-live.mjs` (nếu môi trường có proxy/cookie live) để xác nhận query IDs không stale
* **And** `npm run typecheck` không báo lỗi mới

---

## Tasks / Subtasks

- [ ] **Task 1 — Khởi tạo module `src/scrapers/social/twitter/` (AC-1, AC-2)**
  - [ ] 1.1 Tạo `src/scrapers/social/twitter/index.js` export `TwitterClient`, `TwitterCrawler`, `TwitterPlatformResponseValidator`, normalizer helpers
  - [ ] 1.2 Tạo `src/scrapers/social/twitter/client.js` — `TwitterClient` extends `AbstractApiClient`
  - [ ] 1.3 Tạo `src/scrapers/social/twitter/crawler.js` — `TwitterCrawler` extends `AbstractCrawler`, đăng ký 7 action
  - [ ] 1.4 Tạo `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator` extends `AbstractPlatformResponseValidator` (có thể kế thừa/tái sử dụng từ `src/scrapers/twitter/validator.js`)

- [ ] **Task 2 — Triển khai `TwitterClient` GraphQL + signing (AC-2)**
  - [ ] 2.1 Import `GRAPHQL`, `DEFAULT_FEATURES`, `buildGraphQLUrl`, `buildGraphQLVariables`, `USER_AGENTS`, `BEARER_TOKEN` từ `src/scrapers/twitter/http/endpoints.js`
  - [ ] 2.2 Implement `requestGraphQl(queryId, operationName, variables, options)` build URL, headers, cookie
  - [ ] 2.3 Implement `signTransactionId(method, path)` dùng `SignerWorkerPagePool.evaluate(script, [method, path], { timeoutMs: 3000 })`; script lấy từ on-demand JS hoặc thư viện `x-client-transaction-id` (nếu thêm dependency phải kiểm tra license)
  - [ ] 2.4 Tích hợp `PreSignedTokenRing` cho guest token `gt`/`ct0` và auth token `auth_token`/`ct0`; tách guest ring và account-bound ring theo AD-3 rule 3b
  - [ ] 2.5 Cấu hình `client = 'got'`, `platform = 'twitter'`, `requiresProxy = true` (real URLs), `requiresAuth = true` mặc định

- [ ] **Task 3 — Triển khai normalizers (AC-4)**
  - [ ] 3.1 Tạo `src/scrapers/social/twitter/normalize-profile.js` với `parseTwitterProfile`, `namespacedProfileId`, `profileItemToPostItem`
  - [ ] 3.2 Tạo `src/scrapers/social/twitter/normalize-relationships.js` với `parseTwitterUserEntry`, `parseUserList`, `userListToPostItems`
  - [ ] 3.3 Tạo `src/scrapers/social/twitter/normalize-list.js` với `parseListMembers`, `resolveListId` (trích listId từ URL an toàn, chống SSRF)

- [ ] **Task 4 — Triển khai handlers `TwitterCrawler` (AC-3)**
  - [ ] 4.1 `profile(args, session)` → gọi `UserByScreenName` hoặc `UserByRestId`
  - [ ] 4.2 `followers(args, session)` → `Followers` GraphQL + paginate + dedup + checkpoint
  - [ ] 4.3 `following(args, session)` → `Following` GraphQL + paginate + dedup + checkpoint
  - [ ] 4.4 `likers(args, session)` → `Likes` GraphQL (favoriters) + paginate
  - [ ] 4.5 `retweeters(args, session)` → `Retweeters` GraphQL + paginate
  - [ ] 4.6 `list_members(args, session)` → `ListMembers` GraphQL + `resolveListId`
  - [ ] 4.7 `non_followers(args, session)` → gọi nội bộ `followers` + `following`, tính set difference
  - [ ] 4.8 Cập nhật `CrawlCheckpoint` sau mỗi page và cuối cùng

- [ ] **Task 5 — Lưu trữ và metadata schema (AC-4)**
  - [ ] 5.1 Đảm bảo `profileItemToPostItem` trả về `category: 'social'` và `metadata.tweetId = externalId`
  - [ ] 5.2 Mở rộng `schemas/twitter/social.json` để hỗ trợ các trường profile: `isProfile`, `isFollower`, `isFollowing`, `isLiker`, `isRetweeter`, `isListMember`, `isNonFollower`, `username`, `followersCount`, `followingCount`, `isVerified`, `protected`, `sourceMethod`, `listId`, `cursor`
  - [ ] 5.3 Gọi `this.store.storeBatch(posts, { validateSchema: true })` sau mỗi page; chunk 500

- [ ] **Task 6 — Deprecation markers (AC-5)**
  - [ ] 6.1 Thêm `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing` trong `src/scrapers/twitter/index.js`
  - [ ] 6.2 Thêm `@deprecated` cho `relationships.js` legacy functions
  - [ ] 6.3 Thêm `@deprecated` cho phương thức tương ứng trong `src/client/Scraper.js`
  - [ ] 6.4 Cập nhật `docs/deprecation-plan.md` status tracker

- [ ] **Task 7 — Kiểm thử (AC-6)**
  - [ ] 7.1 Tạo `tests/scrapers/social/twitter/crawler-profile-relationships.test.js` ATDD với local http server
  - [ ] 7.2 Fake response cho `UserByScreenName`, `Followers`, `Following`, `Likes`, `Retweeters`, `ListMembers`
  - [ ] 7.3 Kiểm tra `listActions()` chứa 7 action
  - [ ] 7.4 Kiểm tra `profile` trả về `ProfileItem` đúng shape và `PostItem` sau khi convert
  - [ ] 7.5 Kiểm tra `followers`/`following` deduplication, cursor, checkpoint
  - [ ] 7.6 Kiểm tra `non_followers` set difference
  - [ ] 7.7 Kiểm tra `x-client-transaction-id` header được gửi khi sign script khả dụng
  - [ ] 7.8 Chạy `npm run typecheck` và `vitest run` local

---

## Dev Notes

### Kiến trúc & guardrails

- `TwitterCrawler` **bắt buộc** extends `AbstractCrawler` [src/core/base-crawler.js dòng 21-23] và `TwitterClient` **bắt buộc** extends `AbstractApiClient` [src/core/base-client.js dòng 43-53]. Không được tạo API surface riêng.
- `AbstractCrawler.start(command)` tự động tính `actionRequiresAuth = descriptor.requiresAuth ?? this.requiresAuth` và resolve `accountId` từ `AccountPool` nếu cần [src/core/base-crawler.js dòng 174-194]. Do đó action `profile` có thể khai báo `requiresAuth: false` để cho phép public guest, còn lại `true`.
- Action names phải `snake_case` theo regex `/^[a-z0-9_]+$/` [src/core/base-crawler.js dòng 84-90].
- `AbstractApiClient.resolveProxy` tự động chọn `getStickyProxy(accountId)` khi `requiresAuth` và `getNext()`/`getRotatingProxy()` khi no-auth [src/core/base-client.js dòng 184-232].
- `AbstractApiClient.request` tự động xử lý 429/403, quarantine proxy 5 phút, retry 3 lần, hibernate account [src/core/base-client.js dòng 540-773].
- Mọi `page.evaluate` trong `SignerWorkerPagePool` phải bọc `Promise.race` với timeout 3,000ms [src/core/signer-pool.js dòng 304-354].

### Cơ chế `x-client-transaction-id`

- Một số endpoint Twitter/X hiện tại yêu cầu header `x-client-transaction-id` (ví dụ `Followers`, `Following`, `SearchTimeline`) — nó là chuỗi base64 ~70-100 ký tự, single-use, được sinh từ on-demand JS của Twitter dựa trên HTTP method + API path. Nguồn tham khảo: `she-llac/twitter-graphql-scraper`, `glizzykingdreko/twitter-generator`, `x-client-transaction-id` npm package.
- Cách triển khai khuyến nghị: dùng `SignerWorkerPagePool.evaluate` với một hàm JS trích xuất từ `ondemand.s.js` (hoặc dùng thư viện `x-client-transaction-id` nếu license phù hợp) nhận `(method, path)` và trả về transaction id.
- Nếu sign thất bại (timeout, page dead), `SignWorkerPagePool` tự động spawn lại tab mới [src/core/signer-pool.js dòng 409-445]; fallback là để request không có header và chấp nhận 404/403 → `TwitterPlatformResponseValidator` sẽ ném `BotChallengeError`/`RateLimitError` và pipeline retry với proxy/account mới.
- Header `x-client-transaction-id` chỉ cần cho GraphQL queries/mutations; guest public profile (`UserByScreenName`) có thể không yêu cầu nếu dùng Bearer + guest token, nhưng nên gửi khi có sẵn.

### Token ring & auth mode

- `TwitterClient` có 2 token ring: `tokenRing` chứa `ct0` pre-signed cho authenticated account; `guestTokenRing` chứa `guest_id`/`ct0` cho public requests.
- `ensureTokens(accountId, cookies)` nên:
  - Nếu `accountId` khác `guest`: lấy `auth_token` và `ct0` từ `SessionManager.get(accountId).cookies`.
  - Nếu `accountId` là `guest` hoặc no-auth: gọi `POST https://api.x.com/1.1/guest/activate.json` với Bearer token để lấy `guest_token`, tính `ct0` từ random 32 bytes (Twitter guest `ct0` là 32 hex), lưu vào `guestTokenRing`.
- Tuyệt đối không log cookie/token trong debug log.

### GraphQL endpoints & variables

- Base URL: `https://x.com/i/api/graphql` [src/scrapers/twitter/http/endpoints.js dòng 47]
- Query IDs hiện tại (theo dõi độ stale bằng `npm run check:endpoints` hoặc `scripts/check-endpoints.mjs`):
  - `UserByScreenName: NimuplG1OB7Fd2btCLdBOw` [dòng 71]
  - `UserByRestId: tD8zKvQzwY3kdx5yz6YmOw` [dòng 72]
  - `Followers: gC_lyAxZOptAMLCJX5UhWw` [dòng 88]
  - `Following: 2vUj-_Ek-UmBVDNtd8OnQA` [dòng 89]
  - `Likes (Favoriters): LLkw5EcVutJL6y-2gkz22A` [dòng 92]
  - `Retweeters: X-XEqG5qHQSAwmvy00xfyQ` [dòng 93]
  - `ListMembers: BQp2IEYkgxuSxqbTAr1e1g` [dòng 96]
- Variables mẫu cho `Followers`/`Following`: `{ userId, count: 20, includePromotedContent: false, cursor }` [dòng 455-461]
- Variables cho `Likes`/`Retweeters`: `{ tweetId, count, includePromotedContent: true, cursor }` [dòng 467-473]
- Variables cho `ListMembers`: `{ listId, count, cursor }` [dòng 478-483]

### Normalization & storage

- Dùng `parseUserData` trong `src/scrapers/twitter/http/profile.js` làm baseline parser [dòng 131-169] nhưng chuyển sang return `ProfileItem`/`PostItem` thay vì object legacy.
- `ProfileItem` → `PostItem` phải set `category: 'social'` và `publishedAt: null` (vì không phải bài viết theo thời gian) [mẫu: src/scrapers/social/facebook/normalize-profile.js dòng 183-229].
- `likesCount` của profile PostItem có thể map từ `followersCount`; `repostsCount` = 0; `repliesCount` map từ `followingCount` hoặc 0.

### Project Structure Notes

- Cấu trúc chuẩn:
  ```
  src/scrapers/social/twitter/
  ├── index.js            # barrel export
  ├── client.js           # TwitterClient extends AbstractApiClient
  ├── crawler.js          # TwitterCrawler extends AbstractCrawler
  ├── validator.js        # TwitterPlatformResponseValidator
  ├── normalize-profile.js
  ├── normalize-relationships.js
  └── normalize-list.js
  tests/scrapers/social/twitter/
  └── crawler-profile-relationships.test.js
  ```
- **Không** đặt code hybrid trong `src/scrapers/twitter/` (legacy Puppeteer) hay `src/client/Scraper.js` (legacy HTTP class).
- Thêm export `twitter` trong `src/scrapers/social/index.js` tương tự `facebook`, `threads` [src/scrapers/social/index.js dòng 8-9].
- Cập nhật `src/scrapers/index.js` `platformActionMap` khi 13.2.12 làm integration; 13.2.1 chỉ cần đảm bảo `TwitterCrawler` có thể gọi được.

### Testing Requirements

- **Framework:** Vitest 4.x [CLAUDE.md].
- **Nguyên tắc:** Không mock/stub — real implementation gọi local `node:http` server hoặc live environment.
- **Test pattern:**
  1. Tạo `http.createServer` trả GraphQL JSON mẫu.
  2. Khởi tạo `TwitterClient({ baseUrl: serverUrl })` + `TwitterCrawler({ client })` + `PrismaStore({ prisma })`.
  3. Gọi `crawler.start({ action, args, session })`.
  4. Assert shape `ProfileItem`/`PostItem` và checkpoint.
- **Chạy:**
  ```bash
  vitest run tests/scrapers/social/twitter/crawler-profile-relationships.test.js
  npm run typecheck
  ```

### Previous Story Intelligence (Story 13.2)

- Story 13.2 đã xác định `TwitterCrawler` cần `search(query)` và `getTimeline(username)` sử dụng `TwitterHttpClient` + `SignerPagePool` với `Promise.race` 3s, normalize `PostItem` `twitter:${tweetId}`, ghi `PrismaStore`, và gắn `@deprecated` cho legacy files [file `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` AC-1..AC-4].
- Nếu skeleton 13.2 chưa tồn tại, dev phải khởi tạo `src/scrapers/social/twitter/client.js`/`crawler.js` theo AC của 13.2 trước khi làm action 13.2.1. Story 13.2.1 **không** bao gồm search/timeline — chỉ tập trung profile & relationships.

### Git Intelligence Summary

- 10 commit gần nhất tập trung vào Story 13.8 (Facebook Hybrid Marketplace), cung cấp mẫu thực tế:
  - Đăng ký action trong `FacebookCrawler` constructor [src/scrapers/social/facebook/crawler.js dòng 305-424].
  - `FacebookClient.requestGraphQl` build body + token ring partition theo auth mode [src/scrapers/social/facebook/client.js dòng 423-570].
  - Sửa `base-client.js` để `resolveProxy` tôn trọng `requiresAuth` action-level [commit `ba6f4551`, `97868f54`].
  - Sửa `base-crawler.js` để `actionRequiresAuth` override platform default [commit `97868f54`].
  - `action-registry.js` pin `requiresAuth` resolved trong `listActions()` [commit `97868f54`].
  - ATDD test dùng real `node:http` server [tests/scrapers/social/facebook/crawler-marketplace.test.js].
- Twitter legacy code đã có parser GraphQL sẵn ở `src/scrapers/twitter/http/profile.js` và `src/scrapers/twitter/http/relationships.js`, validator ở `src/scrapers/twitter/validator.js`; 13.2.1 sẽ **port** logic này vào kiến trúc hybrid thay vì viết lại.

### Latest Technical Information

- **GraphQL query IDs:** Theo `src/scrapers/twitter/http/endpoints.js` (cập nhật từ d60/twikit + the-convocation/twitter-scraper). Twitter/X đổi query ID khi deploy bundle mới; nên kiểm tra bằng `validateEndpoints()` [dòng 566-611] hoặc tool `twitter-graphql-scraper` của `she-llac`.
- **`x-client-transaction-id`:** Reverse-engineered; cần on-demand JS (`ondemand.s.js`) hoặc thư viện `x-client-transaction-id` (npm, MIT) để sinh. Dùng `SignerWorkerPagePool` với timeout 3s. Endpoint `Followers`, `Following`, `SearchTimeline` được ghi nhận yêu cầu header này.
- **`x-xp-forwarded-for`:** Header 512 hex tùy chọn, session-based, reverse-engineered; có thể dùng nếu public endpoints trả 403.
- **Rate limits:** Theo `RATE_LIMITS` trong `src/scrapers/twitter/http/endpoints.js` [dòng 247-294]; `Followers`/`Following` 50 req/15 phút. Đề xuất `AdaptiveRateGovernor.setPlatformLimit('twitter', { safeRequestsPerMinute: 30, baseReqPerSecondPerProxy: 1 })`.
- **TLS/JA4 spoofing:** `got-scraping` có sẵn trong `package.json` [dòng 119]. `undici` 7.29.0 cũng có sẵn [dòng 141].

### Security & Compliance

- Không log cookie `auth_token`, `ct0`, `guest_id`, `x-csrf-token`, `x-client-transaction-id`.
- `dryRun` mặc định `false` cho read actions; vẫn hỗ trợ `dryRun: true` để inspect request mà không gọi upstream.
- `resolveListId` và `resolveUsername` phải validate URL để chống SSRF (chỉ chấp nhận `x.com`, `twitter.com`, `mobile.twitter.com`).

---

## Dev Agent Record

### Agent Model Used

- (Để dev ghi nhận khi bắt đầu `dev-story`)

### Debug Log References

- (Để dev ghi nhận log file/shell khi cần)

### Completion Notes List

- (Dev cập nhật khi hoàn thành từng AC)

### File List

- `src/scrapers/social/twitter/index.js`
- `src/scrapers/social/twitter/client.js`
- `src/scrapers/social/twitter/crawler.js`
- `src/scrapers/social/twitter/validator.js`
- `src/scrapers/social/twitter/normalize-profile.js`
- `src/scrapers/social/twitter/normalize-relationships.js`
- `src/scrapers/social/twitter/normalize-list.js`
- `tests/scrapers/social/twitter/crawler-profile-relationships.test.js`
- `schemas/twitter/social.json` (cập nhật)
- `docs/deprecation-plan.md` (cập nhật)
- `src/scrapers/twitter/index.js` (deprecation marker)
- `src/scrapers/twitter/http/relationships.js` (deprecation marker)
- `src/client/Scraper.js` (deprecation marker)

---

## References

- `[Source: _bmad-output/planning-artifacts/epics.md#Story-13.2.1]` (dòng 374-384)
- `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-1..AD-18]`
- `[Source: _bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md]`
- `[Source: src/core/base-crawler.js]`
- `[Source: src/core/base-client.js]`
- `[Source: src/store/prisma-store.js]`
- `[Source: src/scrapers/twitter/http/endpoints.js]`
- `[Source: src/scrapers/twitter/http/profile.js]`
- `[Source: src/scrapers/twitter/http/relationships.js]`
- `[Source: src/scrapers/twitter/validator.js]`
- `[Source: src/scrapers/social/facebook/crawler.js]` (pattern mẫu)
- `[Source: src/scrapers/social/facebook/client.js]` (pattern mẫu)
- `[Source: src/scrapers/social/facebook/normalize-profile.js]` (pattern `ProfileItem` → `PostItem`)
- `[Source: tests/scrapers/social/facebook/crawler-marketplace.test.js]` (pattern ATDD test)
- `[Source: schemas/twitter/social.json]`
- `[Source: docs/deprecation-plan.md]`
