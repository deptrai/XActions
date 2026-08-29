---
story_id: '13.2.2'
epic: 13
story_key: '13-2-2-twitter-hybrid-thread-likes-bookmarks'
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-29
updated: 2026-08-29
last_updated: 2026-08-29
owner: "DEV"
reviewed: "pending"
baseline_commit: "836d2a63"
---

# Story 13.2.2 — Twitter Hybrid Thread, Likes & Bookmarks

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Twitter Content Researcher**,  
I want **cào chi tiết một thread (conversation), danh sách likes của tweet, và bookmarks của tài khoản bằng `TwitterClient`/`TwitterCrawler` kiến trúc hybrid**,  
so that **tôi có thể phân tích nội dung tweet, engagement và nội dung người dùng đã lưu mà không cần Puppeteer tab mới**.

---

## Scope Note

Story 13.2.2 triển khai **thread, likes, bookmarks actions** cho `TwitterCrawler` dựa trên `AbstractCrawler`/`AbstractApiClient` đã có ở `src/core/`. Story này phụ thuộc nền tảng từ Story 13.2 (`TwitterCrawler` skeleton) và **bắt buộc tuân thủ 100% kiến trúc hybrid** (`PreSignedTokenRing` + `SignerWorkerPagePool` cho `x-client-transaction-id`) cùng `ProxyIpPool` sticky/rotate đã được củng cố ở các commit gần nhất.

Tất cả output phải chuẩn hóa thành `PostItem[]` (thread, bookmarks) hoặc `ProfileItem[]` (likes) với ID Namespaced `twitter:${externalId}` và ghi vào `PrismaStore` chunk 500 bản ghi. Các legacy function `scrapeThread`, `scrapeLikes`, `scrapeBookmarks` trong `src/scrapers/twitter/index.js` phải được đánh dấu `@deprecated` theo kế hoạch decommission.

Story này **không** tạo lại `TwitterClient`/`TwitterCrawler` — nó mở rộng các action đã đăng ký trong skeleton từ Story 13.2 / 13.2.1.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.2.2 [dòng 454-464], Story 13.2 [dòng 429-440], Story 13.2.1 [dòng 442-452]
- `_bmad-output/planning-artifacts/prd.md` — FR-71, FR-65, NFR-11/12/15/18 [dòng 79, 78, 114-120, 171]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 [dòng 125-133], AD-2 [dòng 134-141], AD-3 [dòng 142-163], AD-4 [dòng 164-173], AD-9 [dòng 215-225], AD-11 [dòng 233-243], AD-12 [dòng 245-248], AD-13 [dòng 250-260]
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2 (AC-1..AC-4)
- `_bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md` — mẫu `TwitterCrawler` action registry, `TwitterClient` GraphQL dispatch, normalizer, checkpoint, deprecation
- `src/core/base-crawler.js` — `AbstractCrawler` contract & `ActionRegistry` integration [dòng 21-305]
- `src/core/base-client.js` — `AbstractApiClient` tiered signing, proxy rotation, 429/403 interceptor [dòng 43-893]
- `src/core/types.js` — `PostItem`, `ProfileItem`, `CommentItem`, `ActionDescriptor`, `CrawlerCommand`, `generatePostId` [dòng 9-101, 145-147]
- `src/store/prisma-store.js` — `storeBatch` chunk 500, checkpoint save, metadata schema validation [dòng 13-365]
- `src/scrapers/twitter/http/endpoints.js` — GraphQL query IDs & `buildGraphQLUrl` / `buildGraphQLVariables` [dòng 68-119, 324-332, 414-429, 464-474, 495-502]
- `src/scrapers/twitter/http/thread.js` — `parseConversationModule`, `reconstructThread`, `scrapeThread`, `scrapeFullThread`, `scrapeConversation` [dòng 64-601]
- `src/scrapers/twitter/http/tweets.js` — `parseTweetData`, `parseTimelineInstructions` [dòng 61-270]
- `src/scrapers/twitter/http/relationships.js` — `parseUserList`, `scrapeUserList`, `scrapeLikers` [dòng 48-517]
- `src/scrapers/twitter/http/index.js` — legacy re-exports `scrapeThread`, `scrapeFullThread`, `scrapeConversation`, `scrapeLikers` [dòng 22-25]
- `src/scrapers/twitter/index.js` — legacy `scrapeThread`, `scrapeLikes`, `scrapeBookmarks` [dòng 530-640, 790-834]
- `src/scrapers/twitter/validator.js` — `TwitterPlatformResponseValidator` hiện có [dòng 10-150]
- `src/scrapers/social/tiktok/crawler.js` — mẫu `AbstractCrawler` action registry, checkpoint, Redis stream, `node:http` ATDD [dòng 26-460]
- `src/scrapers/social/tiktok/client.js` — mẫu `AbstractApiClient` request builder [dòng 1-200]
- `src/scrapers/social/tiktok/normalizer.js` — mẫu `PostItem`/`CommentItem` normalization [dòng 1-300]
- `src/scrapers/social/facebook/crawler.js` — `FacebookCrawler` `#saveCheckpoint`, `PostItem`/`CommentItem` normalization pattern [dòng 550-680, 1717-1773]
- `src/scrapers/social/threads/crawler.js` — mẫu `AbstractCrawler` registration + `PostItem`/`CommentItem` [dòng 47-180]
- `schemas/twitter/social.json` — metadata schema cho Twitter social
- `docs/deprecation-plan.md` — mapping legacy → hybrid [dòng 21-27, 74-101]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2** (`src/scrapers/social/twitter/` phải tồn tại `TwitterCrawler`/`TwitterClient` skeleton từ AC của Story 13.2). Nếu skeleton chưa được dev, dev phải hoàn thành phần nền (base `TwitterCrawler`, `TwitterClient`, `TwitterPlatformResponseValidator`) trước khi implement action 13.2.2.
- **Phụ thuộc Story 13.2.1** (`twitter:profile`, `twitter:likers` action, normalizer `ProfileItem` → `PostItem`, `parseUserList`, `scrapeUserList` helper). 13.2.2 sẽ tái sử dụng `parseUserList` / `userListToPostItems` và `profileItemToPostItem` nếu đã có.
- **Phụ thuộc Epic 10.1/10.2** (`AbstractCrawler`, `AbstractApiClient`, `PrismaStore`, `Post`/`Comment`/`CrawlCheckpoint` schema).
- **Phụ thuộc Epic 11** (`ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool` với sticky/rotate logic và action-level auth).
- **Phụ thuộc Story 13.1** (`PreSignedTokenRing`, `SignerWorkerPagePool` với `Promise.race()` timeout 3s).
- **Mở khóa Story 13.2.3** (search/hashtag/trending) — sử dụng lại `TwitterClient` GraphQL dispatch, normalizer, checkpoint pattern.
- **Mở khóa Story 13.2.12** (integration/caller migration) — `scrape('twitter','thread',...)` sẽ chuyển sang `TwitterCrawler`.

---

## Acceptance Criteria

### AC-1: Đăng ký action `thread`, `likes`, `bookmarks` trong `TwitterCrawler`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký các action sau với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `thread` | `['tweet_id']` | `['limit', 'cursor', 'sort_by']` | `{ tweet_id: '1234567890', limit: 200, sort_by: 'relevance' }` | `{ posts: PostItem[], pageInfo: any }` | `false` (public guest có thể đọc thread công khai; opt-in `accountId` vẫn được tôn trọng) |
| `likes` | `['tweet_id']` | `['limit', 'cursor']` | `{ tweet_id: '1234567890', limit: 100 }` | `{ likers: ProfileItem[], pageInfo: any }` | `true` |
| `bookmarks` | `[]` | `['username', 'limit', 'cursor']` | `{ username: 'elonmusk', limit: 100 }` | `{ posts: PostItem[], pageInfo: any }` | `true` |

* **And** tất cả action names phải là `snake_case` và không xung đột với action `search`, `timeline`, `profile`, `followers`, `following`, `likers`, `retweeters`, `list_members`, `non_followers` của Story 13.2 / 13.2.1.
* **And** `listActions()` trả về đầy đủ 3 action với `requiresAuth` đã phân giải theo AD-11 rule 3.
* **And** `thread` action chấp nhận cả `tweet_id` numeric string và `url` (`https://x.com/.../status/<id>` hoặc `https://twitter.com/.../status/<id>`); `bookmarks` chấp nhận `username` hoặc `account_id` từ `session`.

### AC-2: `TwitterClient` GraphQL dispatch với hybrid signing

* **Given** `TwitterClient` kế thừa `AbstractApiClient` trong `src/scrapers/social/twitter/client.js`
* **When** gọi `requestGraphQl(queryId, operationName, variables, options)`
* **Then** client build URL `https://x.com/i/api/graphql/{queryId}/{operationName}?variables=...&features=...` theo `buildGraphQLUrl` trong `src/scrapers/twitter/http/endpoints.js` [dòng 324-332]
* **And** gửi headers: `authorization: Bearer <BEARER_TOKEN>`, `x-csrf-token: <ct0>`, `cookie: auth_token=...; ct0=...; guest_id=...` (nếu authenticated), `user-agent` từ `USER_AGENTS` [dòng 301-308]
* **And** sử dụng `requestWithSign` với `signType: 'page'` để sinh `x-client-transaction-id` header qua `SignerWorkerPagePool` với script evaluate từ on-demand JS của X (timeout 3,000ms, warmup 8,000ms) [AD-1 dòng 129-132]
* **And** dispatch HTTP qua `got-scraping` (mặc định) hoặc `undici.fetch` với sticky proxy cho auth request và rotating proxy cho no-auth request [AD-3 rule 3b]
* **And** `TwitterPlatformResponseValidator` phát hiện 429/403, rate-limit payload, bot challenge; `AbstractApiClient.request` tự động quarantine proxy, retry 3 lần, hibernate account khi cần [src/core/base-client.js dòng 538-773]

### AC-3: Handler `thread`, `likes`, `bookmarks`

* **Given** action đã đăng ký
* **When** gọi `crawler.start({ action, args, session })`
* **Then** handler `thread` gọi `TweetDetail` (`U0HTv-bAWTBYylwEMT7x5A`) [src/scrapers/twitter/http/endpoints.js dòng 81] với `buildGraphQLVariables('TweetDetail', { tweetId, cursor, ... })` [dòng 414-429]; parse `data.threaded_conversation_with_injections_v2.instructions` qua `parseTweetDetailResponse`/`parseConversationModule` trong `thread.js` [dòng 76-224]; reconstruct conversation tree qua `reconstructThread` [dòng 245-351]
* **And** handler `thread` paginate qua `cursor-bottom` / `ShowMoreThreads` cho đến khi đạt `limit` hoặc hết dữ liệu; trả về `PostItem[]` với `metadata.parentId` (nếu reply), `metadata.conversationId` (root tweet id), `metadata.inReplyTo`, `metadata.isReply`, `metadata.rootTweetId`
* **And** handler `likes` gọi `Likes` (`LLkw5EcVutJL6y-2gkz22A`) [dòng 92] với `tweetId`, parse `favoriters_timeline.timeline.instructions` qua `parseUserList` trong `relationships.js` [dòng 81-150]; trả về `ProfileItem[]`
* **And** handler `bookmarks` gọi `BookmarkTimeline` (`qToeLeMs43Q8cr7tRYXmaQ`) [dòng 100] với variables `{ count, cursor }` [dòng 495-502]; parse `data.bookmark_timeline_v2.instructions` thành tweet array qua `parseTimelineInstructions` hoặc custom `parseBookmarkTimeline`; trả về `PostItem[]` với `metadata.isBookmarked: true`
* **And** mọi handler pagination lưu `CrawlCheckpoint` với `platform='twitter'`, `targetType` (`thread`/`tweet_likers`/`bookmarks`), `targetKey`, `lastCursor`, `lastCrawledAt` [src/store/prisma-store.js dòng 312-348]
* **And** mỗi request đều đi qua `governor.canAccountRequest` / `recordRequest` và `proxyPool.getStickyProxy(accountId)` nếu `requiresAuth: true`

### AC-4: Chuẩn hóa `PostItem`/`ProfileItem` và lưu trữ Namespaced

* **Given** response GraphQL hợp lệ
* **When** normalizer chạy
* **Then** `thread` `PostItem` có `id: twitter:${tweetId}`, `platform: 'twitter'`, `externalId: tweetId`, `category: 'social'`, `authorId: userRestId`, `authorName: name`, `authorAvatar: avatar`, `content: text`, `mediaUrls: [...]`, `likesCount`, `repostsCount`, `repliesCount`, `viewsCount`, `publishedAt: createdAt`, `metadata.tweetId`, `metadata.conversationId` (root id), `metadata.parentId` (nếu reply), `metadata.inReplyTo` (object), `metadata.isReply`, `metadata.isRetweet`, `metadata.isQuote`, `metadata.hashtags`, `metadata.mentions`, `metadata.sourceMethod: 'thread'`
* **And** `likes` `ProfileItem` có `id: twitter:${rest_id}`, `platform: 'twitter'`, `externalId: rest_id`, `username`, `name`, `bio` (đã expand t.co URLs), `avatar` (replace `_normal` → `_400x400`), `followersCount`, `followingCount`, `verified`, `protected`, `profileUrl`
* **And** `likes` `ProfileItem[]` được chuyển thành `PostItem[]` khi lưu qua `PrismaStore.storeBatch` với `category: 'social'`, `content: bio \|\| name`, `authorId: rest_id`, `authorName: name`, `authorAvatar: avatar`, `mediaUrls: [avatar]`, `metadata` chứa `tweetId: rest_id`, `isProfile`, `isLiker: true`, `username`, `followersCount`, `followingCount`, `isVerified`, `protected`, `sourceMethod: 'likes'`, `cursor`, `likedTweetId`
* **And** `bookmarks` `PostItem[]` có `metadata.isBookmarked: true`, `metadata.sourceMethod: 'bookmarks'`, `metadata.conversationId` (root id)
* **And** `PrismaStore` validate metadata, insert theo chunk 500, `skipDuplicates: true` [src/store/prisma-store.js dòng 180-228]
* **And** ID tuân theo Namespaced `twitter:${externalId}` [AD-4 dòng 167-168]

### AC-5: Thread tree reconstruction với `parentId` đúng

* **Given** `thread` trả về nhiều tweet trong cùng conversation
* **When** normalizer chạy
* **Then** mỗi reply `PostItem` có `metadata.parentId` trỏ tới tweet ID mà nó reply (hoặc `null` nếu root)
* **And** `metadata.conversationId` của tất cả tweet trong thread là root tweet id
* **And** thứ tự `posts` tuân theo `createdAt` tăng dần (chronological) như output của `reconstructThread` [src/scrapers/twitter/http/thread.js dòng 245-351]
* **And** nếu tweet bị xóa / `TweetTombstone`, vẫn giữ lại slot với `tombstone: true`, `content` là text tombstone, `id` tạm từ `parentId`/`conversationId` + index nếu thiếu `rest_id`

### AC-6: Deprecation marker và documentation

* **Given** `TwitterCrawler` đã đăng ký action `thread`, `likes`, `bookmarks`
* **When** kiểm tra legacy code
* **Then** thêm JSDoc `@deprecated` và comment `// LEGACY — see docs/deprecation-plan.md` vào:
  - `scrapeThread`, `scrapeLikes`, `scrapeBookmarks` trong `src/scrapers/twitter/index.js`
  - `scrapeThread`, `scrapeFullThread`, `scrapeConversation` trong `src/scrapers/twitter/http/index.js` (re-export) và `src/scrapers/twitter/http/thread.js`
  - `scrapeLikers` trong `src/scrapers/twitter/http/index.js` (re-export) và `src/scrapers/twitter/http/relationships.js`
* **And** cập nhật `docs/deprecation-plan.md` status tracker: Twitter thread/likes/bookmarks chuyển từ `deprecated-planned` sang `deprecated-marked`, ghi rõ được thay thế bởi `twitter:thread`, `twitter:likes`, `twitter:bookmarks`

### AC-7: Kiểm thử ATDD & smoke

* **Given** repo có `vitest` và `tests/scrapers/social/twitter/`
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js`
* **Then** tất cả AC-1..AC-6 có test red-phase hoặc green-phase tương ứng
* **And** test sử dụng local `node:http` server fake GraphQL với JSON response giống Twitter (không mock module — real implementation call real server) [mẫu: tests/scrapers/social/tiktok/crawler.test.js dòng 13-216]
* **And** có test smoke tùy chọn với `scripts/test-twitter-thread-likes-bookmarks-live.mjs` (nếu môi trường có proxy/cookie live) để xác nhận query IDs không stale
* **And** `npm run typecheck` không báo lỗi mới

---

## Tasks / Subtasks

- [ ] **Task 1 — Chuẩn bị module `src/scrapers/social/twitter/` (AC-1, AC-2)**
  - [ ] 1.1 Đảm bảo `src/scrapers/social/twitter/index.js` export `TwitterClient`, `TwitterCrawler`, `TwitterPlatformResponseValidator`, normalizer helpers
  - [ ] 1.2 Đảm bảo `src/scrapers/social/twitter/client.js` — `TwitterClient` extends `AbstractApiClient` với `requestGraphQl(queryId, operationName, variables, options)`
  - [ ] 1.3 Đảm bảo `src/scrapers/social/twitter/crawler.js` — `TwitterCrawler` extends `AbstractCrawler`, có thể đăng ký thêm action
  - [ ] 1.4 Đảm bảo `src/scrapers/social/twitter/validator.js` — `TwitterPlatformResponseValidator` extends `AbstractPlatformResponseValidator`
  - [ ] 1.5 Tạo `src/scrapers/social/twitter/normalize-thread.js` với `parseTweetDetailResponse`, `reconstructThread`, `tweetToPostItem`, `conversationToPostItems`
  - [ ] 1.6 Tạo `src/scrapers/social/twitter/normalize-bookmarks.js` với `parseBookmarkTimeline`, `bookmarkTweetsToPostItems`
  - [ ] 1.7 Mở rộng `src/scrapers/social/twitter/normalize-relationships.js` (hoặc tạo `normalize-likes.js`) với `likersToPostItems`, `favoritersToProfileItems`

- [ ] **Task 2 — Triển khai `thread` handler (AC-1, AC-3, AC-5)**
  - [ ] 2.1 `thread(args, session)` → extract `tweetId` từ `tweet_id` hoặc URL (`x.com/.../status/<id>`, `twitter.com/.../status/<id>`)
  - [ ] 2.2 Gọi `TweetDetail` GraphQL với `buildGraphQLVariables('TweetDetail', { tweetId, cursor, ... })`
  - [ ] 2.3 Parse `data.threaded_conversation_with_injections_v2.instructions` qua `parseTweetDetailResponse`/`parseConversationModule`
  - [ ] 2.4 Reconstruct conversation tree qua `reconstructThread`, paginate qua `ShowMoreThreads`/`cursor-bottom` cho đến `limit`
  - [ ] 2.5 Convert mỗi tweet thành `PostItem` với `metadata.parentId`, `metadata.conversationId`, `metadata.inReplyTo`, `metadata.isReply`, `metadata.isRetweet`, `metadata.isQuote`, `metadata.rootTweetId`
  - [ ] 2.6 Lưu `storeBatch(posts, { upsert: true })` và `saveCheckpoint` mỗi page

- [ ] **Task 3 — Triển khai `likes` handler (AC-1, AC-3, AC-4)**
  - [ ] 3.1 `likes(args, session)` → validate `tweetId`
  - [ ] 3.2 Gọi `Likes` GraphQL với `buildGraphQLVariables('Likes', { tweetId, cursor, ... })`, parse `favoriters_timeline.timeline.instructions`
  - [ ] 3.3 Chuyển user entries thành `ProfileItem[]` qua `parseUserEntry`/`parseUserList`
  - [ ] 3.4 Convert `ProfileItem[]` thành `PostItem[]` khi lưu với `metadata.isLiker: true`, `metadata.likedTweetId`
  - [ ] 3.5 Lưu `storeBatch(posts, { upsert: true })` và `saveCheckpoint` mỗi page

- [ ] **Task 4 — Triển khai `bookmarks` handler (AC-1, AC-3, AC-4)**
  - [ ] 4.1 `bookmarks(args, session)` → resolve `accountId` từ `session.accountId`, `args.username` → `AccountPool`, hoặc `auth_token` cookie; `requiresAuth: true`
  - [ ] 4.2 Gọi `BookmarkTimeline` GraphQL với `buildGraphQLVariables('BookmarkTimeline', { cursor, ... })`
  - [ ] 4.3 Parse `data.bookmark_timeline_v2.instructions` thành tweets (dùng `parseTimelineInstructions` hoặc custom)
  - [ ] 4.4 Convert tweets thành `PostItem[]` với `metadata.isBookmarked: true`, `metadata.sourceMethod: 'bookmarks'`, `metadata.conversationId`
  - [ ] 4.5 Lưu `storeBatch(posts, { upsert: true })` và `saveCheckpoint` mỗi page

- [ ] **Task 5 — Metadata schema và lưu trữ (AC-4, AC-5)**
  - [ ] 5.1 Mở rộng `schemas/twitter/social.json` với các trường mới: `parentId`, `conversationId`, `inReplyTo`, `rootTweetId`, `isBookmarked`, `likedTweetId`, `sourceMethod: { enum: ['thread','likes','bookmarks','profile','followers','following','likers','retweeters','list_members','non_followers','search','timeline','hashtag','trending','media'] }`
  - [ ] 5.2 Đảm bảo `metadata.tweetId` luôn là `string` (dù là profile converted) để thỏa mãn `required: ['tweetId']`
  - [ ] 5.3 Gọi `this.store.storeBatch(posts, { validateSchema: true, upsert: true })` sau mỗi page; chunk 500

- [ ] **Task 6 — Deprecation markers (AC-6)**
  - [ ] 6.1 Thêm `@deprecated` cho `scrapeThread`, `scrapeLikes`, `scrapeBookmarks` trong `src/scrapers/twitter/index.js`
  - [ ] 6.2 Thêm `@deprecated` cho `scrapeThread`, `scrapeFullThread`, `scrapeConversation` trong `src/scrapers/twitter/http/thread.js` và `src/scrapers/twitter/http/index.js`
  - [ ] 6.3 Thêm `@deprecated` cho `scrapeLikers` trong `src/scrapers/twitter/http/relationships.js` (nếu 13.2.1 chưa làm)
  - [ ] 6.4 Cập nhật `docs/deprecation-plan.md` status tracker

- [ ] **Task 7 — Kiểm thử (AC-7)**
  - [ ] 7.1 Tạo `tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js` ATDD với local http server
  - [ ] 7.2 Fake response cho `TweetDetail`, `Likes`, `BookmarkTimeline`
  - [ ] 7.3 Kiểm tra `listActions()` chứa `thread`, `likes`, `bookmarks`
  - [ ] 7.4 Kiểm tra `thread` trả về `PostItem[]` đúng `parentId`/`conversationId`, thứ tự chronological
  - [ ] 7.5 Kiểm tra `likes` trả về `ProfileItem[]` / converted `PostItem[]`
  - [ ] 7.6 Kiểm tra `bookmarks` trả về `PostItem[]` với `isBookmarked: true`
  - [ ] 7.7 Kiểm tra `x-client-transaction-id` header được gửi khi sign script khả dụng
  - [ ] 7.8 Chạy `npm run typecheck` và `vitest run` local

---

## Dev Notes

### Kiến trúc & guardrails

- `TwitterCrawler` **bắt buộc** extends `AbstractCrawler` [src/core/base-crawler.js dòng 21-23] và `TwitterClient` **bắt buộc** extends `AbstractApiClient` [src/core/base-client.js dòng 43-53]. Không được tạo API surface riêng.
- `AbstractCrawler.start(command)` tự động tính `actionRequiresAuth = descriptor.requiresAuth ?? this.requiresAuth` và resolve `accountId` từ `AccountPool` nếu cần [src/core/base-crawler.js dòng 174-194]. Do đó action `thread` có thể khai báo `requiresAuth: false` để cho phép public guest, còn `likes`/`bookmarks` `requiresAuth: true`.
- Action names phải `snake_case` theo regex `/^[a-z0-9_]+$/` [src/core/base-crawler.js dòng 84-90]. `tweetId` trong args thì vẫn camelCase theo JSDoc.
- `AbstractApiClient.resolveProxy` tự động chọn `getStickyProxy(accountId)` khi `requiresAuth` và `getNext()`/`getRotatingProxy()` khi no-auth [src/core/base-client.js dòng 184-232].
- `AbstractApiClient.request` tự động xử lý 429/403, quarantine proxy 5 phút, retry 3 lần, hibernate account [src/core/base-client.js dòng 540-773].
- Mọi `page.evaluate` trong `SignerWorkerPagePool` phải bọc `Promise.race` với timeout 3,000ms [src/core/signer-pool.js dòng 304-354].

### Cơ chế `x-client-transaction-id`

- Một số endpoint Twitter/X hiện tại yêu cầu header `x-client-transaction-id` (ví dụ `Followers`, `Following`, `SearchTimeline`, `Likes`, `BookmarkTimeline`). Nguồn tham khảo: `she-llac/twitter-graphql-scraper`, `glizzykingdreko/twitter-generator`, `x-client-transaction-id` npm package.
- Cách triển khai khuyến nghị: dùng `SignerWorkerPagePool.evaluate` với một hàm JS trích xuất từ `ondemand.s.js` (hoặc dùng thư viện `x-client-transaction-id` nếu license phù hợp) nhận `(method, path)` và trả về transaction id.
- Nếu sign thất bại (timeout, page dead), `SignWorkerPagePool` tự động spawn lại tab mới [src/core/signer-pool.js dòng 409-445]; fallback là để request không có header và chấp nhận 404/403 → `TwitterPlatformResponseValidator` sẽ ném `BotChallengeError`/`RateLimitError` và pipeline retry với proxy/account mới.

### Token ring & auth mode

- `TwitterClient` có 2 token ring: `tokenRing` chứa `ct0` pre-signed cho authenticated account; `guestTokenRing` chứa `guest_id`/`ct0` cho public requests.
- `ensureTokens(accountId, cookies)` nên:
  - Nếu `accountId` khác `guest`: lấy `auth_token` và `ct0` từ `SessionManager.get(accountId).cookies`.
  - Nếu `accountId` là `guest` hoặc no-auth: gọi `POST https://api.x.com/1.1/guest/activate.json` với Bearer token để lấy `guest_token`, tính `ct0` từ random 32 bytes, lưu vào `guestTokenRing`.
- Tuyệt đối không log cookie/token trong debug log.

### GraphQL endpoints & variables

- Base URL: `https://x.com/i/api/graphql` [src/scrapers/twitter/http/endpoints.js dòng 47]
- Query IDs hiện tại (theo dõi độ stale bằng `npm run check:endpoints` hoặc `scripts/check-endpoints.mjs`):
  - `TweetDetail: U0HTv-bAWTBYylwEMT7x5A` [dòng 81] — conversation thread
  - `Likes (Favoriters): LLkw5EcVutJL6y-2gkz22A` [dòng 92] — who liked a tweet
  - `BookmarkTimeline: qToeLeMs43Q8cr7tRYXmaQ` [dòng 100] — authenticated user's bookmarked tweets
- Variables `TweetDetail` mẫu: `{ focalTweetId, with_rux_injections: false, rankingMode: 'Relevance', includePromotedContent: true, withCommunity: true, withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true, withV2Timeline: true, cursor }` [dòng 414-429]
- Variables `Likes` mẫu: `{ tweetId, count, includePromotedContent: true, cursor }` [dòng 464-474]
- Variables `BookmarkTimeline` mẫu: `{ count, cursor }` [dòng 495-502]

### Parsing & normalization

- Dùng `parseTweetData` trong `src/scrapers/twitter/http/tweets.js` làm baseline parser [dòng 77-202] nhưng chuyển sang return `PostItem` thay vì object legacy.
- `parseTweetDetailResponse` trong `thread.js` [dòng 134-224] xử lý `TimelineAddEntries`, `TimelineAddToModule`, `cursor-bottom-*`, `conversationthread-*`.
- `reconstructThread` [dòng 245-351] trả về `{ rootTweet, authorReplies, conversation, tree }`. `conversation` đã sort chronological. Dùng `conversation` làm nguồn `PostItem[]` chính.
- `parseUserList` trong `relationships.js` [dòng 81-150] đã parse users từ `instructions`; tái sử dụng cho `likes`.
- `parseTimelineInstructions` trong `tweets.js` [dòng 219-270] có thể parse `BookmarkTimeline` nếu cấu trúc tương tự user timelines; nếu không, viết `parseBookmarkTimeline` riêng.

### Thread-specific normalization

- `PostItem.id = twitter:${tweetId}`
- `PostItem.metadata.conversationId = rootTweet.id`
- `PostItem.metadata.parentId = tweet.inReplyTo?.tweetId ?? null`
- `PostItem.metadata.inReplyTo = tweet.inReplyTo` (object `{ tweetId, userId, username }`)
- `PostItem.metadata.isReply = tweet.isReply`
- `PostItem.metadata.isRetweet = tweet.isRetweet`
- `PostItem.metadata.isQuote = Boolean(tweet.quotedTweet)`
- `PostItem.metadata.rootTweetId = rootTweet.id`
- `PostItem.metadata.sourceMethod = 'thread'`
- `PostItem.publishedAt = tweet.createdAt` (ISO string)
- `PostItem.authorAvatar = tweet.author.avatar`
- `PostItem.mediaUrls = tweet.media.map(m => m.videoUrl || m.url)`

### Likes normalization

- `ProfileItem.id = twitter:${rest_id}`
- `ProfileItem.externalId = rest_id`
- `ProfileItem.username = legacy.screen_name`
- `ProfileItem.name = legacy.name`
- `ProfileItem.bio = legacy.description` (expand `t.co` URLs nếu có)
- `ProfileItem.avatar = legacy.profile_image_url_https.replace('_normal', '_400x400')`
- `ProfileItem.followersCount = legacy.followers_count`
- `ProfileItem.followingCount = legacy.friends_count`
- `ProfileItem.verified = user.is_blue_verified || legacy.verified`
- `ProfileItem.protected = legacy.protected`
- `ProfileItem.profileUrl = https://x.com/${username}`
- Convert `ProfileItem` → `PostItem` khi lưu: `metadata.isLiker: true`, `metadata.likedTweetId`, `metadata.sourceMethod: 'likes'`, `metadata.tweetId: rest_id`

### Bookmarks normalization

- `BookmarkTimeline` trả về timeline instructions chứa tweet entries; parse tương tự `UserTweets`.
- `PostItem.metadata.isBookmarked: true`
- `PostItem.metadata.sourceMethod: 'bookmarks'`
- `PostItem.metadata.conversationId = rootTweetId` (nếu có trong raw, nếu không dùng tweetId)

### Project Structure Notes

- Cấu trúc chuẩn:
  ```
  src/scrapers/social/twitter/
  ├── index.js            # barrel export (đã có từ 13.2)
  ├── client.js           # TwitterClient extends AbstractApiClient (đã có từ 13.2/13.2.1)
  ├── crawler.js          # TwitterCrawler extends AbstractCrawler, thêm 3 actions
  ├── validator.js        # TwitterPlatformResponseValidator (đã có)
  ├── normalizer.js       # hoặc tách thành:
  ├── normalize-thread.js
  ├── normalize-likes.js
  ├── normalize-bookmarks.js
  tests/scrapers/social/twitter/
  └── crawler-thread-likes-bookmarks.test.js
  ```
- **Không** đặt code hybrid trong `src/scrapers/twitter/` (legacy Puppeteer) hay `src/client/Scraper.js` (legacy HTTP class).
- `package.json` exports `./scrapers/social/twitter` sẽ được thêm ở Story 13.2.12; 13.2.2 không sửa `package.json`.

### Testing Requirements

- **Framework:** Vitest 4.x [CLAUDE.md].
- **Nguyên tắc:** Không mock/stub — real implementation gọi local `node:http` server hoặc live environment.
- **Test pattern:**
  1. Tạo `http.createServer` trả GraphQL JSON mẫu cho `TweetDetail`, `Likes`, `BookmarkTimeline`.
  2. Khởi tạo `TwitterClient({ baseUrl: serverUrl })` + `TwitterCrawler({ client })` + mock `PrismaStore`.
  3. Gọi `crawler.start({ action, args, session })`.
  4. Assert shape `PostItem`/`ProfileItem`, `metadata.parentId`/`conversationId`, checkpoint.
- **Chạy:**
  ```bash
  vitest run tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js
  npm run typecheck
  ```

### Previous Story Intelligence (Story 13.2 / 13.2.1)

- Story 13.2 đã xác định `TwitterCrawler` cần `search(query)` và `getTimeline(username)` sử dụng `TwitterHttpClient` + `SignerPagePool` với `Promise.race` 3s, normalize `PostItem` `twitter:${tweetId}`, ghi `PrismaStore`, và gắn `@deprecated` cho legacy files.
- Story 13.2.1 đã implement `profile`, `followers`, `following`, `likers`, `retweeters`, `list_members`, `non_followers` với normalizer `ProfileItem` → `PostItem`, `parseUserList`, `scrapeUserList`, `CrawlCheckpoint`, ATDD tests.
- Nếu skeleton 13.2 / 13.2.1 chưa tồn tại, dev phải khởi tạo `src/scrapers/social/twitter/client.js`/`crawler.js` theo AC của 13.2 và 13.2.1 trước khi làm action 13.2.2. Story 13.2.2 **không** bao gồm search/timeline/profile — chỉ tập trung `thread`, `likes`, `bookmarks`.

### Git Intelligence Summary

- 10 commit gần nhất tập trung vào Story 15.2 (TikTokCrawler) và 15.1.4 (Threads integration), cung cấp mẫu thực tế:
  - Đăng ký action trong `TikTokCrawler` constructor [src/scrapers/social/tiktok/crawler.js dòng 61-108].
  - `TikTokClient` request builder với `requestTikTokApi` [src/scrapers/social/tiktok/client.js dòng 100-250].
  - `normalizeTikTokPost`, `normalizeTikTokComment` trong `normalizer.js`.
  - ATDD test dùng real `node:http` server [tests/scrapers/social/tiktok/crawler.test.js dòng 13-216].
- Twitter legacy code đã có parser GraphQL sẵn ở `src/scrapers/twitter/http/thread.js`, `tweets.js`, `relationships.js`; 13.2.2 sẽ **port** logic này vào kiến trúc hybrid thay vì viết lại.

### Latest Technical Information

- **GraphQL query IDs:** Theo `src/scrapers/twitter/http/endpoints.js` (cập nhật từ d60/twikit + the-convocation/twitter-scraper). Twitter/X đổi query ID khi deploy bundle mới; nên kiểm tra bằng `validateEndpoints()` [dòng 566-611] hoặc tool `twitter-graphql-scraper` của `she-llac`.
- **`x-client-transaction-id`:** Reverse-engineered; cần on-demand JS (`ondemand.s.js`) hoặc thư viện `x-client-transaction-id` (npm, MIT) để sinh. Dùng `SignerWorkerPagePool` với timeout 3s. Endpoint `Likes` và `BookmarkTimeline` có khả năng yêu cầu header này.
- **Rate limits:** Theo `RATE_LIMITS` trong `src/scrapers/twitter/http/endpoints.js` [dòng 247-294]; đề xuất `AdaptiveRateGovernor.setPlatformLimit('twitter', { safeRequestsPerMinute: 30, baseReqPerSecondPerProxy: 1 })`.
- **TLS/JA4 spoofing:** `got-scraping` có sẵn trong `package.json` [dòng 119]. `undici` 7.29.0 cũng có sẵn [dòng 141].

### Security & Compliance

- Không log cookie `auth_token`, `ct0`, `guest_id`, `x-csrf-token`, `x-client-transaction-id`.
- `dryRun` mặc định `false` cho read actions; vẫn hỗ trợ `dryRun: true` để inspect request mà không gọi upstream.
- `resolveTweetId` từ URL phải validate host là `x.com`, `twitter.com`, `mobile.twitter.com`, `t.co` để chống SSRF; từ chối các host khác.

---

## Dev Agent Record

### Agent Model Used

- (Để dev ghi nhận khi bắt đầu `dev-story`)

### Debug Log References

- (Để dev ghi nhận log file/shell khi cần)

### Completion Notes List

- (Dev cập nhật khi hoàn thành từng AC)

### File List

- `src/scrapers/social/twitter/crawler.js` (cập nhật thêm 3 actions)
- `src/scrapers/social/twitter/client.js` (nếu cần mở rộng `requestGraphQl`)
- `src/scrapers/social/twitter/normalize-thread.js` (mới)
- `src/scrapers/social/twitter/normalize-likes.js` (mới)
- `src/scrapers/social/twitter/normalize-bookmarks.js` (mới)
- `src/scrapers/social/twitter/index.js` (nếu cần export thêm)
- `tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js` (mới)
- `schemas/twitter/social.json` (cập nhật)
- `docs/deprecation-plan.md` (cập nhật)
- `src/scrapers/twitter/index.js` (deprecation marker)
- `src/scrapers/twitter/http/thread.js` (deprecation marker)
- `src/scrapers/twitter/http/index.js` (deprecation marker cho re-exports)

---

## References

- `[Source: _bmad-output/planning-artifacts/epics.md#Story-13.2.2]` (dòng 454-464)
- `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-1..AD-18]`
- `[Source: _bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md]`
- `[Source: _bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md]`
- `[Source: src/core/base-crawler.js]`
- `[Source: src/core/base-client.js]`
- `[Source: src/store/prisma-store.js]`
- `[Source: src/scrapers/twitter/http/endpoints.js]`
- `[Source: src/scrapers/twitter/http/thread.js]`
- `[Source: src/scrapers/twitter/http/tweets.js]`
- `[Source: src/scrapers/twitter/http/relationships.js]`
- `[Source: src/scrapers/twitter/index.js]`
- `[Source: src/scrapers/social/tiktok/crawler.js]` (pattern ATDD)
- `[Source: src/scrapers/social/tiktok/client.js]` (pattern client)
- `[Source: tests/scrapers/social/tiktok/crawler.test.js]` (pattern test)
- `[Source: schemas/twitter/social.json]`
- `[Source: docs/deprecation-plan.md]`
