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
---

# Story 13.2.2 — Twitter Hybrid Thread, Likes & Bookmarks

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Twitter Content Researcher**,
I want **cào chi tiết một thread (conversation), danh sách likes của tweet, và bookmarks của tài khoản bằng kiến trúc hybrid**,
so that **tôi có thể phân tích nội dung tweet, engagement và nội dung người dùng đã lưu**.

---

## Scope Note

Story 13.2.2 triển khai **thread, likes, và bookmarks actions** cho `TwitterCrawler` dựa trên `AbstractCrawler`/`AbstractApiClient` đã thiết lập ở Story 13.2 và 13.2.1. Story này **bổ sung actions vào `TwitterCrawler` đã có** (không tạo mới từ đầu).

**Lưu ý phụ thuộc quan trọng:** `src/scrapers/social/twitter/` chưa tồn tại trên branch `develop` (Story 13.2 và 13.2.1 chưa implement). Nếu skeleton chưa có, dev phải hoàn thành nền tảng `TwitterCrawler`/`TwitterClient`/`TwitterPlatformResponseValidator` theo AC của Story 13.2 và 13.2.1 trước. Story 13.2.2 chỉ focus vào 3 actions: `thread`, `likes`, `bookmarks`.

Tất cả output phải chuẩn hóa thành `PostItem` (thread/bookmarks) hoặc `ProfileItem` (likes — danh sách người đã like) với ID Namespaced `twitter:${externalId}` và ghi vào `PrismaStore` chunk 500 bản ghi. Các legacy function `scrapeThread`, `scrapeLikes`, `scrapeBookmarks` trong `src/scrapers/twitter/index.js` phải được đánh dấu `@deprecated`.

---

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Story 13.2.2 [dòng 454-464], Story 13.2 [dòng 429-439], Story 13.2.1 [dòng 442-452]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 [dòng 125-133], AD-2 [dòng 134-141], AD-3 [dòng 142-163], AD-4 [dòng 164-174], AD-11 [dòng 233-243], AD-12 [dòng 245-248]
- `_bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md` — nền tảng Story 13.2 (AC-1..AC-4)
- `_bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md` — Story 13.2.1 pattern hoàn chỉnh cho action registration, GraphQL dispatch, normalization, checkpoint, deprecation
- `src/core/base-crawler.js` — `AbstractCrawler` contract & `ActionRegistry` [dòng 21-307]
- `src/core/base-client.js` — `AbstractApiClient` tiered signing, proxy rotation, 429/403 interceptor
- `src/core/types.js` — `PostItem`, `CommentItem`, `ProfileItem`, `ActionDescriptor`, `CrawlerCommand` [dòng 9-102]
- `src/scrapers/twitter/http/endpoints.js` — GraphQL query IDs: `TweetDetail` [dòng 81], `Likes (Favoriters)` [dòng 92], `BookmarkTimeline` [dòng 100], `UserLikes` [dòng 78]; `buildGraphQLVariables` [dòng 341-556]; `RATE_LIMITS` [dòng 247-294]
- `src/scrapers/twitter/http/thread.js` — Legacy parsers: `parseConversationModule` [dòng 76-121], `parseTweetDetailResponse` [dòng 134-224], `reconstructThread` [dòng 245-351], `scrapeThread` [dòng 376-423], `scrapeConversation` [dòng 515-601]
- `src/scrapers/twitter/http/tweets.js` — `parseTweetData` [dòng 77-202], `parseTimelineInstructions` [dòng 219-293]
- `src/scrapers/twitter/http/relationships.js` — `parseUserEntry` [dòng 48-65], `parseUserList` [dòng 81-150], `scrapeLikers` [dòng 442-461]
- `src/scrapers/twitter/index.js` — Legacy Puppeteer: `scrapeThread` [dòng 541-582], `scrapeLikes` [dòng 596-640], `scrapeBookmarks` [dòng 796-834]
- `src/scrapers/twitter/validator.js` — `TwitterPlatformResponseValidator`
- `src/scrapers/social/tiktok/crawler.js` — Pattern mẫu: action registration, checkpoint emission [dòng 61-108]
- `src/scrapers/social/facebook/crawler.js` — Pattern mẫu: `registerAction`, `#normalizePostItem`, `#normalizeComment` [dòng 90-200]
- `src/store/prisma-store.js` — `storeBatch` chunk 500, `storeCommentBatch` topological sort, `saveCheckpoint` [dòng 186-374]
- `schemas/twitter/social.json` — Metadata schema, required `tweetId` [dòng 110-112]
- `docs/deprecation-plan.md` — Status tracker [dòng 79-97], legacy-to-hybrid mapping [dòng 98-127]

---

## Cross-Epic Dependencies

- **Phụ thuộc Story 13.2 & 13.2.1:** `src/scrapers/social/twitter/` phải tồn tại `TwitterCrawler`, `TwitterClient`, `TwitterPlatformResponseValidator`, normalizer helpers. Nếu chưa có, dev phải hoàn thành phần nền trước.
- **Phụ thuộc Epic 10.1/10.2:** `AbstractCrawler`, `AbstractApiClient`, `PrismaStore`, `Post`/`Comment`/`CrawlCheckpoint` schema.
- **Phụ thuộc Epic 11:** `ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool`.
- **Phụ thuộc Story 13.1:** `PreSignedTokenRing`, `SignerWorkerPagePool`.
- **Mở khóa Story 13.2.3** (search/hashtag/trending) — sử dụng lại `TwitterClient` dispatch pattern.
- **Mở khóa Story 13.2.12** (integration/caller migration).

---

## Acceptance Criteria

### AC-1: Đăng ký action thread, likes, bookmarks trong `TwitterCrawler`

* **Given** `TwitterCrawler` extends `AbstractCrawler` trong `src/scrapers/social/twitter/crawler.js`
* **When** khởi tạo crawler
* **Then** đăng ký 3 action mới với descriptor đúng `ActionDescriptor` shape:

| action | requiredArgs | optionalArgs | example | outputType | requiresAuth |
|---|---|---|---|---|---|
| `thread` | `['tweetId']` | `['cursor', 'limit', 'walkToRoot']` | `{ tweetId: '1234567890' }` | `{ posts: PostItem[], rootTweet: PostItem \| null, pageInfo: any }` | `false` (public guest cho phép, opt-in `accountId` vẫn được tôn trọng) |
| `likes` | `['tweetId']` | `['limit', 'cursor']` | `{ tweetId: '1234567890', limit: 100 }` | `{ likers: ProfileItem[], pageInfo: any }` | `true` |
| `bookmarks` | `[]` | `['limit', 'cursor']` | `{ limit: 50 }` | `{ posts: PostItem[], pageInfo: any }` | `true` |

* **And** `thread` có `requiresAuth: false` vì TweetDetail endpoint có thể dùng guest token.
* **And** `bookmarks` bắt buộc auth (`requiresAuth: true`) vì BookmarkTimeline là endpoint riêng tư của user.
* **And** `likes` (Favoriters) bắt buộc auth.
* **And** action names phải `snake_case` theo regex `/^[a-z0-9_]+$/` [src/core/base-crawler.js dòng 84-90].
* **And** `listActions()` trả về đầy đủ action mới đã phân giải `requiresAuth`.

### AC-2: Handler thread — Conversation tree với parentId đúng

* **Given** action `thread` đã đăng ký
* **When** gọi `crawler.start({ action: 'thread', args: { tweetId: '123' } })`
* **Then** handler gọi `TweetDetail` GraphQL endpoint [queryId: `U0HTv-bAWTBYylwEMT7x5A`] với variables `{ focalTweetId: tweetId, ... }` [src/scrapers/twitter/http/endpoints.js dòng 415-429]
* **And** response được parse qua `parseTweetDetailResponse` để trích xuất tweets và cursors từ `data.threaded_conversation_with_injections_v2.instructions`
* **And** `reconstructThread(tweets)` tạo conversation tree với `rootTweet`, `authorReplies`, `conversation` sử dụng `inReplyTo.tweetId` làm parent linkage
* **And** mỗi tweet được normalize thành `PostItem` với:
  - `id: twitter:${rest_id}`
  - `externalId: rest_id`
  - `content: legacy.full_text`
  - `metadata.tweetId: rest_id` (bắt buộc theo schema)
  - `metadata.parentTweetId: inReplyTo.tweetId || null`
  - `metadata.conversationId: rootTweet.id`
  - `metadata.isReply: Boolean(inReplyTo)`
  - `metadata.isThread: true`
  - `metadata.sourceMethod: 'thread'`
  - `metadata.hashtags`, `metadata.mentions`, `metadata.lang`
* **And** nếu `args.walkToRoot = true`, handler đi ngược reply chain (giống `scrapeFullThread`) tối đa 50 bước để tìm root tweet trước khi cào thread
* **And** support pagination qua cursor (bottom cursor cho "Show more replies")
* **And** deduplication tweet theo `id` (set)
* **And** lưu `CrawlCheckpoint` với `targetType: 'thread'`, `targetKey: tweetId`

### AC-3: Handler likes — Likers ProfileItem[]

* **Given** action `likes` đã đăng ký
* **When** gọi `crawler.start({ action: 'likes', args: { tweetId: '123', limit: 100 } })`
* **Then** handler gọi `Likes` (Favoriters) GraphQL endpoint [queryId: `LLkw5EcVutJL6y-2gkz22A`, operationName: `Favoriters`] [src/scrapers/twitter/http/endpoints.js dòng 92]
* **And** variables: `{ tweetId, count: 20, includePromotedContent: true, cursor }` [dòng 465-474]
* **And** response path: `data.favoriters_timeline.timeline.instructions`
* **And** parse user entries qua `parseUserList(instructions)` → `parseUserEntry(rawUser)` [src/scrapers/twitter/http/relationships.js dòng 48-65, 81-150]
* **And** mỗi user được normalize thành `ProfileItem` với:
  - `id: twitter:${rest_id}`
  - `externalId: rest_id`
  - `username: legacy.screen_name`
  - `name: legacy.name`
  - `bio: legacy.description`
  - `avatar: profile_image_url_https` (replace `_normal` → `_400x400`)
  - `followersCount: legacy.followers_count`
  - `followingCount: legacy.friends_count`
  - `metadata: { isLiker: true, tweetId, sourceMethod: 'likes' }`
* **And** khi lưu `ProfileItem[]` qua `PrismaStore.storeBatch`, chuyển đổi thành `PostItem` với `category: 'social'`, `metadata.tweetId = rest_id` (bắt buộc)
* **And** paginate qua `cursor-bottom-*` entries cho multi-page
* **And** deduplication theo `username`
* **And** lưu `CrawlCheckpoint` với `targetType: 'likes'`, `targetKey: tweetId`

### AC-4: Handler bookmarks — Bookmarked PostItem[]

* **Given** action `bookmarks` đã đăng ký
* **When** gọi `crawler.start({ action: 'bookmarks', args: { limit: 50 } })`
* **Then** handler gọi `BookmarkTimeline` GraphQL endpoint [queryId: `qToeLeMs43Q8cr7tRYXmaQ`, operationName: `Bookmarks`] [dòng 100]
* **And** variables: `{ count, cursor }` [dòng 496-502]
* **And** **bắt buộc auth** — gửi `authorization: Bearer`, `x-csrf-token: ct0`, `cookie: auth_token=...; ct0=...`
* **And** response path: `data.bookmark_timeline_v2.timeline.instructions` (hoặc `data.bookmark_timeline.timeline.instructions`)
* **And** parse tweet entries qua `parseTimelineInstructions(instructions)` [src/scrapers/twitter/http/tweets.js dòng 219-293]
* **And** mỗi tweet normalize thành `PostItem` với:
  - `id: twitter:${rest_id}`
  - `metadata.tweetId: rest_id`
  - `metadata.isBookmarked: true`
  - `metadata.sourceMethod: 'bookmarks'`
  - `metadata.bookmarkCount` (nếu có trong `legacy.bookmark_count`)
* **And** paginate qua `cursor-bottom-*`
* **And** deduplication theo tweet `id`
* **And** lưu `CrawlCheckpoint` với `targetType: 'bookmarks'`, `targetKey: accountId || 'self'`

### AC-5: Chuẩn hóa metadata & lưu trữ Namespaced

* **Given** response GraphQL hợp lệ
* **When** normalizer chạy
* **Then** tất cả `PostItem` tuân theo ID pattern `twitter:${externalId}` [AD-4]
* **And** `metadata.tweetId` bắt buộc cho validator `schemas/twitter/social.json` [dòng 110-112]
* **And** `PrismaStore.storeBatch(posts, { upsert: true })` insert chunk 500, `skipDuplicates: true`
* **And** mở rộng `schemas/twitter/social.json` thêm các trường:
  - `parentTweetId: { type: 'string' }` — ID tweet cha trong conversation
  - `isThread: { type: 'boolean' }` — tweet thuộc conversation thread
  - `isBookmarked: { type: 'boolean' }` — tweet từ bookmarks
  - `conversationId: { type: 'string' }` — ID conversation root

### AC-6: Deprecation marker và documentation

* **Given** `TwitterCrawler` đã đăng ký action thread/likes/bookmarks
* **When** kiểm tra legacy code
* **Then** thêm JSDoc `@deprecated` và comment `// LEGACY — see docs/deprecation-plan.md` vào:
  - `scrapeThread` tại `src/scrapers/twitter/index.js` [dòng 541]
  - `scrapeLikes` tại `src/scrapers/twitter/index.js` [dòng 596]
  - `scrapeBookmarks` tại `src/scrapers/twitter/index.js` [dòng 796]
  - `scrapeThread`, `scrapeFullThread`, `scrapeConversation` tại `src/scrapers/twitter/http/thread.js` [dòng 376, 448, 515]
  - `scrapeLikers` tại `src/scrapers/twitter/http/relationships.js` [dòng 442]
* **And** cập nhật `docs/deprecation-plan.md`:
  - Thêm row: `scrapeThread (Twitter)` → `twitter:thread`
  - Thêm row: `scrapeLikes (Twitter)` → `twitter:likes`
  - Thêm row: `scrapeBookmarks (Twitter)` → `twitter:bookmarks`
  - Status: `deprecated-marked` Phase 1 (Epic 13.2.2)

### AC-7: Kiểm thử ATDD & smoke

* **Given** repo có `vitest` và `tests/scrapers/social/twitter/`
* **When** chạy `vitest run tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js`
* **Then** tất cả AC-1..AC-6 có test tương ứng
* **And** test sử dụng local `node:http` server fake GraphQL với JSON response giống Twitter (không mock module — real implementation gọi real server) [mẫu: tests/scrapers/social/facebook/crawler-marketplace.test.js dòng 64-165]
* **And** test case cho thread:
  - Fake `TweetDetail` response với `threaded_conversation_with_injections_v2.instructions` chứa tweet entries và conversation modules
  - Verify `rootTweet` không null
  - Verify `metadata.parentTweetId` đúng cho reply tweets
  - Verify deduplication
* **And** test case cho likes:
  - Fake `Favoriters` response với `favoriters_timeline.timeline.instructions` chứa user entries
  - Verify `ProfileItem` shape (`username`, `followersCount`, `avatar`)
  - Verify `metadata.isLiker === true`
* **And** test case cho bookmarks:
  - Fake `Bookmarks` response với `bookmark_timeline_v2.timeline.instructions`
  - Verify `PostItem` shape
  - Verify `metadata.isBookmarked === true`
  - Verify auth required (test `requiresAuth` in action descriptor)
* **And** `npm run typecheck` không báo lỗi mới

---

## Tasks / Subtasks

- [ ] **Task 1 — Tạo normalizer files (AC-2, AC-3, AC-4, AC-5)**
  - [ ] 1.1 Tạo `src/scrapers/social/twitter/normalize-thread.js` với:
    - `parseTwitterTweetToPostItem(parsedTweet, sourceMethod)` — chuyển output từ `parseTweetData` thành `PostItem`
    - `normalizeThreadResponse(response)` — parse TweetDetail response → `{ posts: PostItem[], rootTweet, pageInfo }`
    - Import và tái sử dụng `parseTweetData` từ `src/scrapers/twitter/http/tweets.js`
    - Import và tái sử dụng `parseConversationModule`, `reconstructThread` từ `src/scrapers/twitter/http/thread.js`
  - [ ] 1.2 Tạo `src/scrapers/social/twitter/normalize-bookmarks.js` với:
    - `normalizeBookmarksResponse(response)` — parse BookmarkTimeline response → `{ posts: PostItem[], pageInfo }`
    - Tái sử dụng `parseTweetData`, `parseTimelineInstructions` từ legacy
  - (Likes normalizer: tái sử dụng `parseUserEntry`/`parseUserList` từ `relationships.js` hoặc `normalize-relationships.js` của Story 13.2.1)

- [ ] **Task 2 — Đăng ký 3 actions trong `TwitterCrawler` (AC-1)**
  - [ ] 2.1 Trong `src/scrapers/social/twitter/crawler.js`, thêm `registerAction` cho `thread`, `likes`, `bookmarks` trong constructor
  - [ ] 2.2 Verify `listActions()` trả về tất cả action cũ (từ 13.2.1) + 3 action mới

- [ ] **Task 3 — Implement handler thread (AC-2)**
  - [ ] 3.1 `thread(args, session)` gọi `TwitterClient.requestGraphQl('U0HTv-bAWTBYylwEMT7x5A', 'TweetDetail', variables)`
  - [ ] 3.2 Parse response qua `normalizeThreadResponse`
  - [ ] 3.3 Nếu `args.walkToRoot`, loop ngược `inReplyTo.tweetId` tối đa 50 bước (port logic từ `scrapeFullThread`)
  - [ ] 3.4 Support pagination (bottom cursor)
  - [ ] 3.5 `this.store.storeBatch(posts, { upsert: true })` + `saveCheckpoint`

- [ ] **Task 4 — Implement handler likes (AC-3)**
  - [ ] 4.1 `likes(args, session)` gọi `TwitterClient.requestGraphQl('LLkw5EcVutJL6y-2gkz22A', 'Favoriters', variables)`
  - [ ] 4.2 Parse `data.favoriters_timeline.timeline.instructions` qua `parseUserList`
  - [ ] 4.3 Normalize → `ProfileItem[]`, convert → `PostItem[]` cho storage
  - [ ] 4.4 Paginate + dedup + checkpoint

- [ ] **Task 5 — Implement handler bookmarks (AC-4)**
  - [ ] 5.1 `bookmarks(args, session)` gọi `TwitterClient.requestGraphQl('qToeLeMs43Q8cr7tRYXmaQ', 'Bookmarks', variables)`
  - [ ] 5.2 Parse `data.bookmark_timeline_v2.timeline.instructions` qua `parseTimelineInstructions`
  - [ ] 5.3 Normalize → `PostItem[]`
  - [ ] 5.4 Paginate + dedup + checkpoint

- [ ] **Task 6 — Cập nhật metadata schema (AC-5)**
  - [ ] 6.1 Mở rộng `schemas/twitter/social.json` thêm `parentTweetId`, `isThread`, `isBookmarked`, `conversationId`

- [ ] **Task 7 — Deprecation markers (AC-6)**
  - [ ] 7.1 Thêm `@deprecated` cho `scrapeThread`, `scrapeLikes`, `scrapeBookmarks` trong `src/scrapers/twitter/index.js`
  - [ ] 7.2 Thêm `@deprecated` cho `scrapeThread`, `scrapeFullThread`, `scrapeConversation` trong `src/scrapers/twitter/http/thread.js`
  - [ ] 7.3 Thêm `@deprecated` cho `scrapeLikers` trong `src/scrapers/twitter/http/relationships.js`
  - [ ] 7.4 Cập nhật `docs/deprecation-plan.md` status tracker + mapping table

- [ ] **Task 8 — Cập nhật barrel export (AC-1)**
  - [ ] 8.1 Cập nhật `src/scrapers/social/twitter/index.js` export normalize-thread.js, normalize-bookmarks.js

- [ ] **Task 9 — Kiểm thử (AC-7)**
  - [ ] 9.1 Tạo `tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js`
  - [ ] 9.2 Fake TweetDetail response cho thread tests
  - [ ] 9.3 Fake Favoriters response cho likes tests
  - [ ] 9.4 Fake BookmarkTimeline response cho bookmarks tests
  - [ ] 9.5 Verify action descriptors: `requiresAuth` đúng, action names đúng
  - [ ] 9.6 Verify PostItem/ProfileItem shape, namespaced IDs
  - [ ] 9.7 Verify conversation tree parentTweetId linkage
  - [ ] 9.8 Chạy `npm run typecheck` và `vitest run` local

---

## Dev Notes

### Kiến trúc & guardrails

- `TwitterCrawler` **bắt buộc** extends `AbstractCrawler` [src/core/base-crawler.js dòng 21-23] và `TwitterClient` **bắt buộc** extends `AbstractApiClient` [src/core/base-client.js dòng 43-53]. Không được tạo API surface riêng.
- `AbstractCrawler.start(command)` tự động tính `actionRequiresAuth = descriptor.requiresAuth ?? this.requiresAuth` [src/core/base-crawler.js dòng 174-194].
- Action names phải `snake_case` theo regex `/^[a-z0-9_]+$/` [src/core/base-crawler.js dòng 84-90].
- Mọi `page.evaluate` trong `SignerWorkerPagePool` bọc `Promise.race` timeout 3,000ms [AD-1].

### GraphQL endpoints & variables

- **TweetDetail** (`thread` action):
  - queryId: `U0HTv-bAWTBYylwEMT7x5A`, operationName: `TweetDetail` [endpoints.js dòng 81]
  - Variables: `{ focalTweetId, with_rux_injections: false, rankingMode: 'Relevance', includePromotedContent: true, withCommunity: true, withQuickPromoteEligibilityTweetFields: true, withBirdwatchNotes: true, withVoice: true, withV2Timeline: true }` [dòng 415-429]
  - Response path: `data.threaded_conversation_with_injections_v2.instructions`
  - Rate limit: 150 req/15 min [dòng 256]
  - **CRITICAL:** Response chứa `TimelineAddEntries` với 3 loại entries: `tweet-{id}` (single tweet), `conversationthread-{id}` (conversation module), `cursor-*` (pagination). Dev phải handle hết 3 loại. Xem `parseTweetDetailResponse` [thread.js dòng 134-224].

- **Likes / Favoriters** (`likes` action):
  - queryId: `LLkw5EcVutJL6y-2gkz22A`, operationName: `Favoriters` [endpoints.js dòng 92]
  - Variables: `{ tweetId, count: 20, includePromotedContent: true, cursor }` [dòng 465-474]
  - Response path: `data.favoriters_timeline.timeline.instructions`
  - Rate limit: 75 req/15 min [dòng 261]
  - **IMPORTANT:** Đây là endpoint "ai đã like tweet này" (users-who-liked), KHÔNG phải "tweet mà user đã like" (UserLikes — queryId khác: `IohM3gxQHfvWePH5E3KuNA`). Phân biệt rõ ràng để tránh lỗi.

- **BookmarkTimeline** (`bookmarks` action):
  - queryId: `qToeLeMs43Q8cr7tRYXmaQ`, operationName: `Bookmarks` [endpoints.js dòng 100]
  - Variables: `{ count, cursor }` — KHÔNG có userId/tweetId; endpoint tự trả bookmarks của user đang auth [dòng 496-502]
  - Response path: `data.bookmark_timeline_v2.timeline.instructions` hoặc `data.bookmark_timeline.timeline.instructions` (cần thử cả hai)
  - Rate limit: 75 req/15 min [dòng 265]
  - **BẮT BUỘC AUTH:** Guest token KHÔNG truy cập được bookmarks. Handler phải kiểm tra `requiresAuth: true` + accountId.

### Conversation tree parsing — Chi tiết kỹ thuật

Legacy code đã có logic hoàn chỉnh cần **port** (không viết lại):

1. **`parseTweetDetailResponse(response)`** [thread.js dòng 134-224]:
   - Duyệt `instructions` → `TimelineAddEntries` → entries
   - Entry `tweet-{id}` → `parseTweetData(entry.content.itemContent.tweet_results.result)`
   - Entry `conversationthread-{id}` → `parseConversationModule(entry.content)` → tweets + cursors
   - Entry `cursor-*` → extract pagination cursor value
   - `TimelineAddToModule` → appended replies

2. **`reconstructThread(tweets)`** [thread.js dòng 245-351]:
   - Xây dựng `Map<tweetId, tweet>` và tìm root (tweet không có `inReplyTo`)
   - Phân `authorReplies` vs `conversation` dựa trên `author.id === rootTweet.author.id`
   - Walk tree DFS từ root → children (sorted chronologically)
   - Output: `{ rootTweet, authorReplies, conversation, tree }`

3. **`parseTweetData(rawTweet)`** [tweets.js dòng 77-202]:
   - Handle `TweetTombstone`, `TweetWithVisibilityResults`
   - Extract: `author` (core.user_results), `metrics` (legacy.favorite_count etc.), `media` (extended_entities), `inReplyTo` (in_reply_to_status_id_str), `quotedTweet`, `hashtags`, `mentions`, `isRetweet`
   - **Dev PHẢI tái sử dụng `parseTweetData`** — không viết parser tweet mới.

### Chuyển đổi parsed tweet → PostItem

Hàm `parseTwitterTweetToPostItem(parsed, sourceMethod)` cần:
```
PostItem {
  id: `twitter:${parsed.id}`,
  externalId: parsed.id,
  platform: 'twitter',
  category: 'social',
  authorId: parsed.author.id,
  authorName: parsed.author.username || parsed.author.name,
  authorAvatar: parsed.author.avatar,
  authorUrl: `https://x.com/${parsed.author.username}`,
  postUrl: `https://x.com/${parsed.author.username}/status/${parsed.id}`,
  content: parsed.text,
  mediaUrls: parsed.media.map(m => m.url || m.videoUrl).filter(Boolean),
  likesCount: parsed.metrics.likes,
  repostsCount: parsed.metrics.retweets,
  repliesCount: parsed.metrics.replies,
  viewsCount: parsed.metrics.views,
  publishedAt: parsed.createdAt ? new Date(parsed.createdAt) : null,
  crawledAt: new Date(),
  metadata: {
    tweetId: parsed.id, // BẮT BUỘC cho schema
    parentTweetId: parsed.inReplyTo?.tweetId || null,
    conversationId: null, // set từ rootTweet.id
    isReply: parsed.isReply,
    isRetweet: parsed.isRetweet,
    isThread: true, // khi source là thread
    isBookmarked: false, // khi source là bookmarks → true
    replyCount: parsed.metrics.replies,
    retweetCount: parsed.metrics.retweets,
    likeCount: parsed.metrics.likes,
    quoteCount: parsed.metrics.quotes,
    bookmarkCount: parsed.metrics.bookmarks,
    hashtags: parsed.hashtags,
    mentions: parsed.mentions.map(m => m.username),
    lang: parsed.lang,
    sourceMethod,
  }
}
```

### Chuyển đổi ProfileItem → PostItem cho storage

Giống pattern Story 13.2.1 — `profileItemToPostItem(profile)`:
```
PostItem {
  id: `twitter:${rest_id}`,
  category: 'social',
  content: bio || name,
  mediaUrls: avatar ? [avatar] : [],
  metadata: { tweetId: rest_id, isLiker: true, sourceMethod: 'likes', ... }
}
```

### Token ring & auth mode

- `thread` dùng `requiresAuth: false` → guest token ring, rotating proxy
- `likes` dùng `requiresAuth: true` → account-bound token ring, sticky proxy
- `bookmarks` dùng `requiresAuth: true` → account-bound token ring, sticky proxy
- `x-client-transaction-id` header: cần cho `TweetDetail` nhưng có fallback nếu sign timeout [AD-1]

### Checkpoint pattern

Mỗi handler ghi `CrawlCheckpoint` qua `this.store.saveCheckpoint()`:
```
{
  platform: 'twitter',
  targetType: 'thread' | 'likes' | 'bookmarks',
  targetKey: tweetId | accountId,
  lastCursor: pageInfo.end_cursor,
  lastCrawledAt: new Date(),
  status: hasMore ? 'has_more' : 'completed',
  storageRef: firstPost.id || '',
}
```
Xem mẫu: `src/scrapers/social/tiktok/crawler.js` dòng 118-155.

### Security & compliance

- Không log cookie `auth_token`, `ct0`, `x-csrf-token`, `x-client-transaction-id`.
- `resolveVideoId` / `resolveTweetId` phải validate input — chỉ chấp nhận numeric tweet ID hoặc URL từ `x.com`, `twitter.com`, `mobile.twitter.com`.
- bookmarks chứa nội dung riêng tư — không cache ngoài PrismaStore.

### Project Structure Notes

- Cấu trúc file mới:
  ```
  src/scrapers/social/twitter/
  ├── index.js                   # barrel export (cập nhật)
  ├── client.js                  # TwitterClient (từ 13.2.1)
  ├── crawler.js                 # TwitterCrawler (thêm 3 actions)
  ├── validator.js               # TwitterPlatformResponseValidator (từ 13.2.1)
  ├── normalize-profile.js       # (từ 13.2.1)
  ├── normalize-relationships.js # (từ 13.2.1)
  ├── normalize-list.js          # (từ 13.2.1)
  ├── normalize-thread.js        # MỚI — thread PostItem normalizer
  └── normalize-bookmarks.js     # MỚI — bookmarks PostItem normalizer
  tests/scrapers/social/twitter/
  ├── crawler-profile-relationships.test.js  # (từ 13.2.1)
  └── crawler-thread-likes-bookmarks.test.js # MỚI
  ```
- **Không** đặt code hybrid trong `src/scrapers/twitter/` (legacy Puppeteer) hay `src/client/Scraper.js`.

### Testing Requirements

- **Framework:** Vitest 4.x [CLAUDE.md].
- **Nguyên tắc:** Không mock/stub — real implementation gọi local `node:http` server.
- **Test pattern** (xem `tests/scrapers/social/facebook/crawler-marketplace.test.js`):
  1. `http.createServer` trả GraphQL JSON mẫu cho từng endpoint.
  2. Route `/i/api/graphql/{queryId}/{operationName}` → trả response phù hợp.
  3. `TwitterClient({ baseUrl: serverUrl })` + `TwitterCrawler({ client })`.
  4. Assert shape `PostItem`/`ProfileItem`, `metadata.tweetId`, namespaced IDs, pagination.
- **Chạy:**
  ```bash
  vitest run tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js
  npm run typecheck
  ```

### Previous Story Intelligence (Story 13.2.1)

- Story 13.2.1 thiết lập toàn bộ pattern: `TwitterClient.requestGraphQl`, action registration trong constructor, normalizer module riêng biệt, checkpoint emission, deprecation markers. **Dev phải đọc kỹ Story 13.2.1** trước khi bắt đầu.
- Story 13.2.1 đã giải quyết: `x-client-transaction-id` signing mechanism, token ring partition (guest vs account-bound), `resolveUsername` SSRF protection, `profileItemToPostItem` conversion pattern.
- Nếu 13.2.1 chưa implement trên nhánh làm việc, dev cần hoàn thành skeleton theo AC của 13.2 + 13.2.1 trước — tối thiểu: `TwitterClient` với `requestGraphQl`, `TwitterCrawler` skeleton, `TwitterPlatformResponseValidator`.

### Git Intelligence Summary

- 10 commit gần nhất tập trung vào Threads docid hardening (Story 15.1.3) và Story 13.8 (Facebook Marketplace). Pattern commit: prefix `feat(platform):`, `fix(platform):`.
- `src/scrapers/social/twitter/` chưa tồn tại — đây là context quan trọng cho dependency.

---

## Dev Agent Record

### Agent Model Used

- (Để dev ghi nhận khi bắt đầu `dev-story`)

### Debug Log References

- (Để dev ghi nhận log file/shell khi cần)

### Completion Notes List

- (Dev cập nhật khi hoàn thành từng AC)

### File List

- `src/scrapers/social/twitter/crawler.js` (cập nhật — thêm 3 actions)
- `src/scrapers/social/twitter/normalize-thread.js` (MỚI)
- `src/scrapers/social/twitter/normalize-bookmarks.js` (MỚI)
- `src/scrapers/social/twitter/index.js` (cập nhật — thêm exports)
- `tests/scrapers/social/twitter/crawler-thread-likes-bookmarks.test.js` (MỚI)
- `schemas/twitter/social.json` (cập nhật — thêm parentTweetId, isThread, isBookmarked, conversationId)
- `docs/deprecation-plan.md` (cập nhật — thêm thread/likes/bookmarks mapping)
- `src/scrapers/twitter/index.js` (deprecation marker)
- `src/scrapers/twitter/http/thread.js` (deprecation marker)
- `src/scrapers/twitter/http/relationships.js` (deprecation marker — scrapeLikers)

---

## References

- `[Source: _bmad-output/planning-artifacts/epics.md#Story-13.2.2]` (dòng 454-464)
- `[Source: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md#AD-1..AD-12]`
- `[Source: _bmad-output/implementation-artifacts/13-2-refactor-twitter-scraper-to-hybrid-architecture.md]`
- `[Source: _bmad-output/implementation-artifacts/13-2-1-twitter-hybrid-profile-relationships.md]`
- `[Source: src/core/base-crawler.js]`
- `[Source: src/core/base-client.js]`
- `[Source: src/core/types.js]`
- `[Source: src/store/prisma-store.js]`
- `[Source: src/scrapers/twitter/http/endpoints.js]`
- `[Source: src/scrapers/twitter/http/thread.js]`
- `[Source: src/scrapers/twitter/http/tweets.js]`
- `[Source: src/scrapers/twitter/http/relationships.js]`
- `[Source: src/scrapers/twitter/index.js]`
- `[Source: src/scrapers/twitter/validator.js]`
- `[Source: src/scrapers/social/tiktok/crawler.js]` (pattern mẫu checkpoint emission)
- `[Source: src/scrapers/social/facebook/crawler.js]` (pattern mẫu action registration)
- `[Source: tests/scrapers/social/facebook/crawler-marketplace.test.js]` (pattern ATDD test)
- `[Source: schemas/twitter/social.json]`
- `[Source: docs/deprecation-plan.md]`
