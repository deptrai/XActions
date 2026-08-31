---
story_id: "15.1"
epic: 15
story_key: "15-1-threads-scraper-adapter-meta-internal-graphql"
status: "done"
phase: "Phase 4"
created: 2026-08-26
updated: 2026-08-26
owner: "DEV"
reviewed: "Passed"
baseline_commit: 3a2e60bf764f693240212f43bceefb66804be47d
---

# Story 15.1: Threads Scraper Adapter (Meta Internal GraphQL)

<!-- Note: Context analysis completed 2026-08-26. Ready for dev-story / bmad-dev-auto. -->

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **Token cache model (not `PreSignedTokenRing`)** — `lsd` is a compound token object (`{ lsd, csrftoken, fb_dtsg }`) keyed by proxy/session. Use a `Map<string, { tokens, expiresAt }>` in-memory cache with a 30-minute TTL and in-flight deduplication, exactly like `FacebookClient.ensureTokens()` (`src/scrapers/social/facebook/client.js:64-68, 112-136`). `buildGraphQlBody` reads `lsd` from this cache, **never** from `this.tokenRing.next()`.
2. **Auth/proxy mode** — Architecture AD-3 lists **Threads** as an auth-required platform that must use a sticky IP per account. `ThreadsClient` and `ThreadsCrawler` **MUST** set `requiresAuth = true`. For this story the guest token path uses a synthetic account id `accountId = 'threads-guest'` and a sticky proxy obtained via `proxyPool.getStickyProxy('threads-guest')` (or a dedicated account pool key supplied by the operator). Do not implement Threads as `requiresAuth = false`.
3. **Missing / unverified `doc_id`s** — Root/reply comment `doc_id`s and the search-posts `doc_id` **must be captured from live network** before the crawler can paginate comments or search. `BarcelonaPostPageQuery` is acceptable as a post-detail fallback only. See the *Outstanding Items / Network Capture Required* section at the end of this story.
4. **`CommentTreeExtractor` contract** — `get_post_comments` **MUST** provide a `fetchLayer({ postId, parentCommentId, after, limit })` callback that returns `{ comments: raw[], pageInfo: { has_next_page, end_cursor } }`, plus a `normalizeFn(raw, postId)`. Clamp `maxDepth` to `[0,5]`, `maxComments` to `[1,2000]`, and use `p-limit(2)` concurrency. Model the implementation on `FacebookCrawler.getCommentsForPost` (`src/scrapers/social/facebook/crawler.js:677-823`).
5. **Legacy dispatcher still in effect** — `src/scrapers/index.js` continues to dispatch `scrape('threads', ...)` to the legacy `src/scrapers/threads/index.js` Puppeteer module. The new hybrid Threads scraper is reachable through `src/scrapers/social/index.js`. Package-level cutover is scheduled in **Epic 20.2**.

## Story

As a **Viral Marketer & Trend Researcher**,  
I want **cào bài viết, timeline và bình luận trên mạng xã hội Threads**,  
so that **tôi có thể nắm bắt các chủ đề nóng và drama thịnh hành của giới trẻ Việt Nam**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 15, Story 15.1, lines 446-458]

## Acceptance Criteria

### AC-1: ThreadsClient kế thừa AbstractApiClient
- **Given** `ThreadsClient` được triển khai trong `src/scrapers/social/threads/client.js`
- **When** khởi tạo với `baseUrl`, `proxyPool`, `governor`
- **Then** `ThreadsClient` kế thừa `AbstractApiClient` [Source: `src/core/base-client.js:43-140`]
- **And** `name = 'threads'`, `platform = 'threads'`, `requiresAuth = true`, `client = 'got'` [Source: `src/core/base-client.js:44-54`]
- **And** sử dụng `Map<string, { tokens, expiresAt }>` làm in-memory token cache với TTL 30 phút và `Map<string, Promise<tokens>>` để deduplicate in-flight fetch (mẫu `FacebookClient` tại `src/scrapers/social/facebook/client.js:64-68, 112-136`)
- **And** `ensureLsd(proxyOrSessionKey)` tự động fetch landing/profile page (ví dụ `https://www.threads.net/@instagram`) để trích xuất `lsd`, `csrftoken`, `fb_dtsg` từ HTML; cache key dựa trên proxy/session (không dùng `PreSignedTokenRing`)
- **And** `buildGraphQlBody(docId, variables, tokens)` nhận object tokens đã cache (chứa `lsd`, `csrftoken`, `fb_dtsg`) và build `application/x-www-form-urlencoded` body với `doc_id`, `lsd`, `variables` JSON-stringified
- **And** giá trị token/cookie **không bao giờ** được log hoặc trả về trong error envelope (NFR-4)

### AC-2: ThreadsClient dispatch GraphQL với doc_id
- **Given** `doc_id` và `variables`
- **When** gọi `client.requestGraphQl(docId, variables, options)`
- **Then** POST `https://www.threads.net/api/graphql` với `content-type: application/x-www-form-urlencoded`
- **And** body gồm `doc_id`, `lsd`, `variables` JSON-stringified, xây dựng từ object tokens đã cache
- **And** headers gồm `x-ig-app-id: 238260118697367`, `x-asbd-id: 359341` (cho phép override qua constructor thành `129477` hoặc giá trị capture mới nhất), `x-fb-lsd: <lsd>`, `x-csrftoken` (nếu `csrftoken` cookie có)
- **And** `requestGraphQl` trả về parsed JSON sau khi `AbstractApiClient.request()` gọi `ThreadsPlatformResponseValidator` để kiểm tra payload
- **And** khi response bị validator đánh dấu `isBotChallenge`/`isRateLimit` hoặc khi GraphQL trả `errors` với `message` chứa "Invalid doc_id" / "execution failed", `AbstractApiClient.request()` throw `PlatformError` với `code: 'XACT_5000'`, `type: 'internal'`, `suggestedAction: 'retry_after_delay'` (NFR-7)

### AC-3: ThreadsCrawler kế thừa AbstractCrawler
- **Given** `ThreadsCrawler` trong `src/scrapers/social/threads/crawler.js`
- **When** khởi tạo với `client`, `store`, `governor`, `proxyPool`
- **Then** kế thừa `AbstractCrawler` [Source: `src/core/base-crawler.js:21-63`]
- **And** `requiresAuth = true`, `name = 'threads'`, `platform = 'threads'`
- **And** guest `lsd` tokens được quản lý qua synthetic `accountId = 'threads-guest'` với sticky proxy `proxyPool.getStickyProxy('threads-guest')` (hoặc dedicated account pool key do operator cung cấp)
- **And** đăng ký `search`, `get_user_feed`, `get_post_comments` trong `ActionRegistry` [Source: `src/core/base-crawler.js:72-115`]
- **And** `listActions()` trả về `ActionDescriptor[]` đúng shape AD-11 với `requiredArgs`, `optionalArgs`, `outputType`, `example`

### AC-4: get_user_feed(username)
- **Given** username hợp lệ (không có `@`)
- **When** gọi `crawler.start({ action: 'get_user_feed', args: { username, count, cursor }, session })`
- **Then** crawler resolve `userID` numeric từ `https://www.threads.net/@<username>` HTML (regex `"user_id":"(\d+)"` hoặc SSR `userData.user.pk/id`)
- **And** gọi GraphQL `BarcelonaProfileThreadsTabQuery` với `doc_id` mặc định `6232751443445612` (cần xác nhận qua network capture; cho phép override qua `deps.docIds`)
- **And** variables `{"userID":"<numeric_id>"}` (hoặc kèm `first`, `after` nếu phân trang được xác nhận qua capture)
- **And** trích xuất `data.mediaData.threads[]` hoặc SSR `mediaData.edges[].node.thread_items[].post`
- **And** chuẩn hóa thành `PostItem[]` với `id: generatePostId('threads', post.pk)`, `platform: 'threads'`, `category: 'social'` [Source: `src/core/types.js:129-141`]
- **And** tự động lưu vào `PrismaStore` qua `this.store.storeBatch(posts, { upsert: true })` nếu `store` được cấp [Source: `src/store/prisma-store.js:180-228`]
- **And** sau khi `storeBatch` thành công, ghi `CrawlCheckpoint` với `platform: 'threads'`, `targetType: 'user_feed'`, `targetKey: <username>`, `lastCursor`, `lastTimestamp`, `lastCrawledAt` (mẫu `CrawlCheckpoint` tại `prisma/schema.prisma:389-406`)
- **And** sau khi `storeBatch` thành công, phát thin event pointer `{ id, platform, externalId, category, authorId, crawledAt, storageRef }` vào Redis Stream `stream:social:raw_posts` cho mỗi `PostItem` (nếu `REDIS_STREAM_ENABLED=true` và Redis client khả dụng)

### AC-5: search(query)
- **Given** từ khóa `query`
- **When** gọi `crawler.start({ action: 'search', args: { query, count, cursor, searchType }, session })`
- **Then** `BarcelonaSearchPostsQuery` `doc_id` **phải được capture từ live network**; chưa có `doc_id` verified nào được hardcode
- **And** fallback khi thiếu `doc_id`: hoặc (a) throw `PlatformError` `code: 'XACT_5000'`, `suggestedAction: 'retry_after_delay'`, hoặc (b) triển khai HTTP SSR fallback bằng `got` fetch `https://www.threads.net/search?q=<query>&serp_type=default` và parse `window.__SHARED_DATA\s*=\s*({.*?});` hoặc `<script type="application/json"[^>]*>(.*?)</script>` chứa `mediaData.threads[]` — **không** dùng code Puppeteer DOM legacy
- **And** trả về `PostItem[]` hợp lệ với `id: generatePostId('threads', post.pk)`; nếu search trả về user list, aggregate top user feeds và ghi rõ `metadata.searchMode`
- **And** lưu vào `PrismaStore` qua `storeBatch` nếu có store
- **And** sau `storeBatch` thành công, ghi `CrawlCheckpoint` `targetType: 'search'`, `targetKey: <query>` với `lastCursor`/`lastTimestamp`
- **And** sau `storeBatch` thành công, phát thin event pointers vào `stream:social:raw_posts` cho mỗi `PostItem`

### AC-6: get_post_comments(postId)
- **Given** post id numeric, short code, hoặc URL
- **When** gọi `crawler.start({ action: 'get_post_comments', args: { postId, maxDepth, maxComments, after }, session })`
- **Then** `args.maxDepth` được clamp về `[0, 5]` (mặc định `3`) và `args.maxComments` được clamp về `[1, 2000]` (mặc định `500`)
- **And** resolve post numeric id nếu input là short code / URL
- **And** dùng GraphQL `BarcelonaPostPageQuery` với `doc_id` mặc định `5587632691339264` chỉ như **post-detail fallback**; `doc_id` gốc/reply cho comment pagination **phải được capture từ live network** và override qua `deps.docIds`
- **And** trích xuất `data.data.containing_thread` (main post) và `data.data.reply_threads[]`
- **And** cung cấp `fetchLayer({ postId, parentCommentId, after, limit })` cho `CommentTreeExtractor` với return shape `{ comments: raw[], pageInfo: { has_next_page, end_cursor } }`, chọn `doc_id` root/reply khác nhau dựa trên `parentCommentId != null`, và dùng `p-limit(2)` concurrency (mẫu `FacebookCrawler.getCommentsForPost` tại `src/scrapers/social/facebook/crawler.js:677-823`)
- **And** `normalizeFn(raw, postId)` trả về `CommentItem` theo `src/core/types.js` với `id: generateCommentId('threads', postId, replyPost.pk)`, `postId: generatePostId('threads', postId)`
- **And** dùng `CommentTreeExtractor` (`src/scrapers/social/comment-tree.js:30-181`) để duyệt BFS, gán `depth`, detect cycle, deduplicate
- **And** lưu qua `this.store.storeCommentBatch(comments, { upsert: true })` nếu có store [Source: `src/store/prisma-store.js:271-298`]
- **And** sau `storeCommentBatch` thành công, ghi `CrawlCheckpoint` `targetType: 'post_comments'`, `targetKey: <postId>` với `lastCursor`/`lastTimestamp`
- **And** sau `storeCommentBatch` thành công, phát thin event pointers vào `stream:social:raw_posts` cho mỗi `CommentItem`

### AC-7: PostItem / CommentItem normalization
- **Given** raw GraphQL nodes / SSR objects
- **When** normalize
- **Then** map đầy đủ trường theo `src/core/types.js`
- **And** `PostItem.id` = `generatePostId('threads', post.pk)`; `CommentItem.id` = `generateCommentId('threads', postId, replyPost.pk)` [Source: `src/core/types.js:129-141`]
- **And** `authorId`, `authorName`, `authorAvatar` từ `post.user.pk/id`, `post.user.username`, `post.user.profile_pic_url`
- **And** `content` từ `post.caption.text`
- **And** `mediaUrls` từ `image_versions2.candidates[].url` (chọn candidate lớn nhất), `video_versions[].url`, `carousel_media[].image_versions2.candidates[].url`
- **And** `likesCount` = `post.like_count`; `repliesCount` = `post.text_post_app_info.direct_reply_count` hoặc `post.comment_count`; `repostsCount` = `post.media_repost_count`; `viewsCount` = `post.play_count` (nếu có)
- **And** `publishedAt` từ `post.taken_at` (Unix timestamp)
- **And** `postUrl` ưu tiên `https://www.threads.net/@${authorUsername}/post/${post.code}`, fallback `https://www.threads.net/t/${post.code}`
- **And** `metadata` chứa `postCode` (string), `mediaType` (string), `isReply` (boolean), `carousel` (string[]), `replyControl` (string), `sourceMethod` (string) theo `schemas/threads/social.json` với `required: ["postCode", "mediaType", "sourceMethod"]` [Source: `src/core/metadata-schema-registry.js:166-275`, `src/store/prisma-store.js:198-210`]

### AC-8: Anti-Bot & Error Handling
- **Given** response bất thường (HTTP 200 kèm empty `data`, 403, 429, HTML login wall)
- **When** `AbstractApiClient.request()` gọi `ThreadsPlatformResponseValidator`
- **Then** `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator` [Source: `src/core/platform-validator.js:10-43`]
- **And** `isValidPayload(response)` trả về `true/false`; `isBotChallenge(response)` trả về `true` khi status 403 hoặc body chứa "checkpoint", "captcha", "log in", "login"; `isRateLimit(response)` trả về `true` khi status 429 hoặc body chứa "rate limit", "too many requests"
- **And** `AbstractApiClient.request()` throw `PlatformError` với `code: 'XACT_4290'/'XACT_4030'/'XACT_5000'` và `suggestedAction` do `AbstractApiClient` tính toán (`rotate_account` khi `requiresAuth=true`; `retry_after_delay` cho `XACT_5000`) [Source: `src/core/error-envelope.js:48-147`, `src/core/base-client.js:580-628`]
- **And** không lưu dữ liệu rỗng / false 200 OK (AD-9)

### AC-9: Deprecation marker
- **Given** `src/scrapers/threads/index.js` legacy (Puppeteer)
- **When** triển khai xong `ThreadsCrawler`
- **Then** gắn `@deprecated` JSDoc cho **tất cả** exported symbols trong `src/scrapers/threads/index.js` (`createBrowser`, `createPage`, `scrapeProfile`, `scrapeTweets`, `searchTweets`, `scrapeFollowers`, `scrapeFollowing`) và default export tại dòng `388-396` [Source: `src/scrapers/threads/index.js:1-396`]
- **And** cập nhật `docs/deprecation-plan.md:76-83` status tracker sang `deprecated-marked` (Phase 1)
- **And** không xoá / sửa logic legacy; chỉ thêm marker

### AC-10: Kiểm thực (No Mocks)
- **Given** test suites `tests/scrapers/social/threads/client.test.js` và `tests/scrapers/social/threads/crawler.test.js`
- **When** chạy `npm test`
- **Then** không sử dụng `vi.fn`, mock, stub, fake [Source: `AGENTS.md` Mandatory Rules]
- **And** dùng local HTTP server + `ProxyIpPool`/`StaticProxyProvider` + real `got`/`undici` để mô phỏng `www.threads.net` HTML và `/api/graphql`
- **And** `npm run typecheck` pass
- **And** regression `tests/scrapers/social/facebook/` và `tests/core/` vẫn pass

## CommentTreeExtractor Callback Contract (for `get_post_comments`)

```js
// fetchLayer được truyền vào CommentTreeExtractor
const fetchLayer = async ({ postId, parentCommentId, after, limit }) => {
  const isReply = parentCommentId != null;
  const docId = isReply
    ? docIds.COMMENT_REPLIES   // phải capture từ live network
    : docIds.COMMENT_ROOTS;    // phải capture từ live network

  if (!docId) {
    throw new PlatformError({
      code: 'XACT_5000',
      type: 'internal',
      message: 'Threads comment doc_id is not configured',
      suggestedAction: 'retry_after_delay',
    });
  }

  const res = await client.requestGraphQl(docId, {
    postID: postId,
    after,
    first: Math.min(limit || 20, 50),
  }, { accountId: 'threads-guest' });

  const connection = isReply
    ? res?.data?.node?.replies_connection
    : res?.data?.node?.comment_rendering_instance_for_feed_location?.comments;

  const comments = (connection?.edges || []).map((edge) => edge?.node).filter(Boolean);
  if (isReply && parentCommentId) {
    for (const raw of comments) {
      if (raw.parentId === undefined) raw.parentId = parentCommentId;
    }
  }

  return {
    comments,
    pageInfo: connection?.page_info || { has_next_page: false, end_cursor: null },
  };
};

// normalizeFn trả về CommentItem
const normalizeFn = (raw, postId) => {
  const replyPost = raw;
  return {
    id: generateCommentId('threads', postId, replyPost.pk),
    platform: 'threads',
    externalId: String(replyPost.pk),
    postId: generatePostId('threads', postId),
    parentCommentId: replyPost.parentId
      ? generateCommentId('threads', postId, replyPost.parentId)
      : null,
    depth: 0, // CommentTreeExtractor gán đè sau
    authorId: replyPost.user?.pk || replyPost.user?.id,
    authorName: replyPost.user?.username,
    authorAvatar: replyPost.user?.profile_pic_url,
    content: replyPost.caption?.text || '',
    likesCount: replyPost.like_count || 0,
    subCommentsCount: replyPost.text_post_app_info?.direct_reply_count || 0,
    publishedAt: new Date(Number(replyPost.taken_at) * 1000),
    crawledAt: new Date(),
    metadata: {
      postCode: replyPost.code,
      mediaType: replyPost.media_type,
      isReply: !!replyPost.text_post_app_info?.is_reply,
      sourceMethod: 'graphql',
    },
  };
};
```

## Tasks / Subtasks

- [x] T1: Tạo cấu trúc thư mục `src/scrapers/social/threads/` (AC-1, AC-2, AC-3)
  - [x] T1.1: Tạo `src/scrapers/social/threads/index.js` barrel export `ThreadsClient`, `ThreadsCrawler`, `ThreadsPlatformResponseValidator`, `DEFAULT_THREADS_DOC_IDS`
  - [x] T1.2: Tạo `src/scrapers/social/threads/client.js` — `ThreadsClient` extends `AbstractApiClient`
  - [x] T1.3: Tạo `src/scrapers/social/threads/crawler.js` — `ThreadsCrawler` extends `AbstractCrawler`
  - [x] T1.4: Tạo `src/scrapers/social/threads/validator.js` — `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator`
  - [x] T1.5: Tạo `src/scrapers/social/threads/normalizer.js` (tùy chọn) — các hàm normalize post/comment cho testability
  - [x] T1.6: Cập nhật `src/scrapers/social/index.js:1-9` để re-export Threads module
  - [x] T1.7: Tạo `schemas/threads/social.json` metadata schema
- [x] T2: Triển khai `ThreadsClient` (AC-1, AC-2)
  - [x] T2.1: Constructor kế thừa `AbstractApiClient`, set `client: 'got'`, `baseUrl: 'https://www.threads.net'`, `requiresAuth: true`
  - [x] T2.2: `ensureLsd(proxyOrSessionKey)` fetch landing/profile page HTML, parse `lsd`, `csrftoken`, `fb_dtsg`, lưu vào `Map`-based cache TTL 30 phút với in-flight deduplication; **không** dùng `PreSignedTokenRing`
  - [x] T2.3: `buildGraphQlBody(docId, variables, tokens)` — `URLSearchParams` với `doc_id`, `lsd`, `variables`, header `x-ig-app-id`, `x-asbd-id`, `x-fb-lsd`; không log token values
  - [x] T2.4: `requestGraphQl(docId, variables, options)` — POST, parse JSON, classify errors
- [x] T3: Triển khai `ThreadsCrawler` (AC-3, AC-4, AC-5, AC-6)
  - [x] T3.1: Constructor đăng ký `search`, `get_user_feed`, `get_post_comments`; set `requiresAuth: true`
  - [x] T3.2: `getUserFeed({ username, count, cursor })` — resolve user id, call feed doc_id, normalize `PostItem[]`, ghi `CrawlCheckpoint`, emit thin events
  - [x] T3.3: `search({ query, count, cursor, searchType })` — GraphQL search nếu `SEARCH_POSTS` doc_id đã capture; nếu chưa thì throw `XACT_5000` hoặc SSR fallback HTTP với documented regex
  - [x] T3.4: `getPostComments({ postId, maxDepth, maxComments, after })` — resolve post id, clamp `[0,5]`/`[1,2000]`, implement `fetchLayer({ postId, parentCommentId, after, limit })` trả `{ comments, pageInfo }`, wrap `CommentTreeExtractor` với `p-limit(2)` concurrency
  - [x] T3.5: `normalizePost(raw)` & `normalizeComment(raw, postId)` theo `src/core/types.js`; dùng `generatePostId`/`generateCommentId`
  - [x] T3.6: Persist `PostItem[]` qua `storeBatch`, `CommentItem[]` qua `storeCommentBatch`
  - [x] T3.7: Sau mỗi `storeBatch`/`storeCommentBatch` thành công, ghi `CrawlCheckpoint` và phát thin event pointers vào Redis `stream:social:raw_posts`
- [x] T4: Triển khai `ThreadsPlatformResponseValidator` (AC-8)
  - [x] T4.1: Tạo `src/scrapers/social/threads/validator.js`
  - [x] T4.2: Nhận diện valid payload, bot challenge, rate limit, empty data
- [x] T5: Viết tests (AC-10)
  - [x] T5.1: `tests/scrapers/social/threads/client.test.js` — local server trả HTML tokens + GraphQL JSON, test `ensureLsd`, `requestGraphQl`
  - [x] T5.2: `tests/scrapers/social/threads/crawler.test.js` — test `get_user_feed`, `search`, `get_post_comments`, `listActions`
  - [x] T5.3: Chạy `npm run typecheck` và `npm test -- tests/scrapers/social/threads/`
- [x] T6: Deprecation marker & docs (AC-9)
  - [x] T6.1: Thêm `@deprecated` JSDoc vào `src/scrapers/threads/index.js`
  - [x] T6.2: Cập nhật `docs/deprecation-plan.md` status tracker
- [x] T7: Chạy verification
  - [x] T7.1: `npm run typecheck`
  - [x] T7.2: `npm test -- tests/scrapers/social/threads/`
  - [x] T7.3: `npm test -- tests/scrapers/social/facebook/` (regression)
  - [x] T7.4: `npm test -- tests/core/` (regression)

### Review Findings
- [x] [Review][Patch] Remove fake token fallbacks in ThreadsClient.#fetchTokens [src/scrapers/social/threads/client.js:118]
- [x] [Review][Patch] Narrow overly broad regex for LSD token extraction [src/scrapers/social/threads/client.js:80]
- [x] [Review][Patch] Refine target user ID extraction order to avoid session userId collision [src/scrapers/social/threads/crawler.js:199]
- [x] [Review][Patch] Fix non-greedy nested JSON parsing in searchPosts fallback [src/scrapers/social/threads/crawler.js:283]
- [x] [Review][Patch] Preserve nested reply comment parentId in getPostComments [src/scrapers/social/threads/crawler.js:338]
- [x] [Review][Patch] Implement CrawlCheckpoint and Redis Stream emission in crawler actions [src/scrapers/social/threads/crawler.js]
- [x] [Review][Patch] Update action registrations with standard AD-11 descriptors [src/scrapers/social/threads/crawler.js:38]
- [x] [Review][Patch] Align schemas/threads/social.json required fields with spec [schemas/threads/social.json:28]
- [x] [Review][Patch] Add shortcode and post URL resolution in getPostComments [src/scrapers/social/threads/crawler.js:320]
- [x] [Review][Patch] Add authorUrl in PostItem normalization [src/scrapers/social/threads/crawler.js:121]
- [x] [Review][Patch] Refine bot challenge & login wall detection in validator [src/scrapers/social/threads/validator.js:85]
- [x] [Review][Patch] Enhance cookie handling, timestamp parsing, and ErrorTypes classification [src/scrapers/social/threads/client.js]

## Dev Notes

### Project Structure Notes

- **Target folder mới:** `src/scrapers/social/threads/` (theo AD-8 Multi-Domain Expansion). [Source: `src/core/base-client.js:43-140`, `src/core/base-crawler.js:21-63`]
- **Legacy folder hiện tại:** `src/scrapers/threads/index.js` là Puppeteer-based scraper cũ, theo `docs/deprecation-plan.md:27-29` mapping. **KHÔNG sửa logic legacy**, chỉ thêm `@deprecated` JSDoc.
- **Conflict / variance:**
  - `epics.md` ghi `src/scrapers/social/threads/index.js` nhưng repo chưa có `src/scrapers/social/threads/`. Quyết định: tạo mới.
  - `src/scrapers/index.js:41-43` vẫn import legacy `threads`. `scrape('threads', ...)` package-level tiếp tục dispatch đến legacy Puppeteer module; cutover sang hybrid là **Epic 20.2**.
  - `src/index.js:27-30` đã export `src/scrapers/social/index.js`, do đó khi cập nhật barrel sẽ tự động expose `ThreadsCrawler` qua public API.

### Core Code State to Preserve

- `AbstractApiClient.client` mặc định là `'undici'` [Source: `src/core/base-client.js:53-54`]. `ThreadsClient` **bắt buộc** set `client: 'got'` để `got-scraping` xử lý `proxyUrl` và TLS spoofing.
- `AbstractApiClient.resolveProxy()` sử dụng `proxyPool.getStickyProxy(accountId)` khi `requiresAuth=true` [Source: `src/core/base-client.js:181-229`]. `ThreadsClient`/`ThreadsCrawler` set `requiresAuth=true` và dùng `accountId='threads-guest'` (hoặc key từ account pool) để có sticky IP theo AD-3.
- `AbstractApiClient.request()` không tự serialize object body khi `content-type` là `application/x-www-form-urlencoded`; truyền `body` là string `URLSearchParams(...).toString()` [Source: `src/core/base-client.js:750-761`].
- `AbstractCrawler.start()` tự động resolve `accountId`, kiểm tra `governor`, rồi gọi handler `(args, session)` [Source: `src/core/base-crawler.js:149-244`]. Với `requiresAuth=true`, nếu không có `accountId` thì crawler sẽ lấy từ `accountPool` hoặc dùng synthetic `'threads-guest'`.
- `PrismaStore.storeBatch()` validate `category` và `metadata` schema trước khi ghi [Source: `src/store/prisma-store.js:180-210`]. Do đó bắt buộc tạo `schemas/threads/social.json`.
- `PrismaStore.#normalizePost()` tự động tạo `id = 'threads:${externalId}'` nếu thiếu, và `crawledAt = new Date()` [Source: `src/store/prisma-store.js:51-94`].
- `PrismaStore.#normalizeComment()` tự động tạo `id`, chuẩn hóa `postId`, gán `depth` nếu thiếu [Source: `src/store/prisma-store.js:101-163`].

### Authentication & Token Handling

- Threads public GraphQL không yêu cầu đăng nhập, nhưng bắt buộc `lsd` (CSRF token) và một số header cơ bản.
- `lsd` được embed trong HTML dạng `"LSD",[],{"token":"..."}`. Có thể fetch `/@instagram` hoặc `/@<username>`.
- `csrftoken` cookie cần được set cùng `x-csrftoken` header nếu muốn tránh "empty edges".
- `x-ig-app-id` cố định `238260118697367`; `x-asbd-id` có thể là `359341` hoặc `129477`. Khuyến nghị cho phép override qua constructor.
- Chiến lược token (bắt buộc dùng `Map`-based cache, không dùng `PreSignedTokenRing`):
  1. `ThreadsClient.ensureLsd(proxyOrSessionKey)` fetch landing page qua `GET` với proxy/session key, parse `lsd`, `csrftoken`, `fb_dtsg` từ HTML.
  2. Cache object tokens theo key proxy/session với TTL 30 phút, dùng `Map<string, { tokens, expiresAt }>` và `Map<string, Promise<tokens>>` để deduplicate in-flight fetch (mẫu `FacebookClient.ensureTokens` tại `src/scrapers/social/facebook/client.js:64-68, 112-136`).
  3. `buildGraphQlBody(docId, variables, tokens)` nhận object tokens đã cache, build `URLSearchParams` với `doc_id`, `lsd`, `variables`.
- **Bảo mật (NFR-4):** Giá trị `lsd`, `csrftoken`, `fb_dtsg`, và bất kỳ cookie/session nào **không bao giờ** được log ra console, ghi vào file, hoặc trả về trong `PlatformError` envelope. Chỉ log thông báo không chứa giá trị token (ví dụ "token cache miss" hoặc "doc_id may be rotated").

### GraphQL doc_id Strategy

Sử dụng persisted Relay `doc_id` cho các action. Tất cả `doc_id` đều có thể bị Meta xoay; dev **bắt buộc** cung cấp override qua `deps.docIds`. Bảng dưới chỉ liệt kê trạng thái xác nhận, không dùng ngoài repo làm nguồn chính.

|| Action | Query | doc_id status | Ghi chú |
||---|---|---|---|
|| `get_user_feed` | `BarcelonaProfileThreadsTabQuery` | default `6232751443445612` | Cần xác nhận qua network capture; dùng làm default có thể override |
|| `search` | `BarcelonaSearchPostsQuery` | **capture required** | Chưa có doc_id công khai ổn định; fallback SSR HTTP hoặc `XACT_5000` |
|| `get_post_comments` (post detail) | `BarcelonaPostPageQuery` | default `5587632691339264` | Chỉ là fallback post-detail; `doc_id` root/reply comment **phải capture** từ network |

- Nếu `doc_id` bị rotate và response trả về `errors` / empty `data`, throw `XACT_5000` `suggestedAction: 'retry_after_delay'` và log warning `⚠️ Threads doc_id may be rotated` (NFR-7).
- Danh sách đầy đủ các `doc_id` candidate (từ open-source / network capture) được chuyển xuống phần *Outstanding Items / Network Capture Required* ở cuối story.

### Data Normalization

- `PostItem.id` = `generatePostId('threads', post.pk)` [Source: `src/core/types.js:129-141`].
- `PostItem.category` = `'social'`.
- `PostItem.platform` = `'threads'`.
- `PostItem.authorId` = `post.user.pk` hoặc `post.user.id`.
- `PostItem.authorName` = `post.user.username` (handle) hoặc `post.user.full_name`.
- `PostItem.authorAvatar` = `post.user.profile_pic_url`.
- `PostItem.authorUrl` = `https://www.threads.net/@${post.user.username}`.
- `PostItem.content` = `post.caption?.text || ''`.
- `PostItem.mediaUrls`:
  - Nếu `post.media_type === 1` (image): lấy `image_versions2.candidates` sorted by `width*height` desc, chọn `url` đầu tiên.
  - Nếu `post.media_type === 2` (video): lấy `video_versions` sorted by `type`/`width` desc.
  - Nếu `post.media_type === 8` (carousel): flatten `carousel_media[].image_versions2.candidates[].url`.
- `PostItem.likesCount` = `post.like_count || 0`.
- `PostItem.repliesCount` = `post.text_post_app_info?.direct_reply_count || post.comment_count || 0`.
- `PostItem.repostsCount` = `post.media_repost_count || 0`.
- `PostItem.viewsCount` = `post.play_count || 0`.
- `PostItem.publishedAt` = `new Date(Number(post.taken_at) * 1000)`.
- `PostItem.postUrl` = `https://www.threads.net/@${post.user.username}/post/${post.code}` hoặc fallback `/t/${post.code}`.
- `PostItem.metadata` = `{ postCode, mediaType, isReply: post.text_post_app_info?.is_reply, carousel: [...], replyControl, sourceMethod: 'graphql' }`.

- `CommentItem`:
  - `id` = `generateCommentId('threads', postId, replyPost.pk)` [Source: `src/core/types.js:139-141`].
  - `platform` = `'threads'`, `postId` = `generatePostId('threads', postId)`.
  - `externalId` = `replyPost.pk`.
  - `parentCommentId` = `generateCommentId('threads', postId, parentPk)` nếu là reply; `null` nếu root.
  - `depth` do `CommentTreeExtractor` gán.
  - `authorId/authorName/authorAvatar` từ `replyPost.user`.
  - `content` = `replyPost.caption?.text`.
  - `likesCount` = `replyPost.like_count`.
  - `subCommentsCount` = `replyPost.text_post_app_info?.direct_reply_count`.
  - `publishedAt` = `new Date(Number(replyPost.taken_at) * 1000)`.

### Anti-Bot & Error Handling

- Sử dụng `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator`.
- `isValidPayload(response)` trả về `true` nếu:
  - JSON object có `data.userData.user`, `data.mediaData.threads`, `data.data.containing_thread`, `data.data.reply_threads`, `data.searchResults`, hoặc `data.errors` (để client classify).
  - HTML body có `LSD`, `DTSGInitialData`, hoặc SSR JSON.
- `isBotChallenge(response)` trả về `true` nếu:
  - status 403.
  - body chứa "checkpoint", "captcha", "log in", "login", "confirm your identity".
  - JSON `errors` chứa `code` 1357004 hoặc tương tự.
- `isRateLimit(response)` trả về `true` nếu:
  - status 429.
  - body / error text chứa "rate limit", "too many requests", "action blocked", "temporarily blocked".
- `AbstractApiClient.request()` đọc kết quả `true/false` từ validator và throw `PlatformError` với `code`/`suggestedAction` tương ứng; validator **không** tự throw [Source: `src/core/base-client.js:580-628`].
- Khi phát hiện challenge/rate-limit, `AbstractApiClient` pipeline tự quarantine proxy và retry theo cấu hình [Source: `src/core/base-client.js:520-721`].

### Testing Strategy

- **No mocks, no `vi.fn`, no fake HTTP clients** [Source: `AGENTS.md`, `CLAUDE.md`].
- Cung cấp `baseUrl` trong `ThreadsClient` constructor (default `https://www.threads.net`). Tests set `baseUrl = 'http://localhost:<port>'`.
- Dùng `http.createServer` để:
  - Trả về HTML profile/search/post page chứa `LSD` token và `user_id`.
  - Trả về JSON GraphQL hợp lệ cho `/api/graphql` với `data.mediaData.threads[]` / `data.data.containing_thread` / `data.data.reply_threads[]`.
- Dùng `ProxyIpPool` hoặc `StaticProxyProvider` để kiểm tra proxy pipeline.
- `ThreadsClient` sử dụng `client = 'got'` để `got-scraping` xử lý `proxyUrl`.

### Pagination, Checkpoint & Redis Thin Events

- `get_user_feed`: nếu response có `page_info` với `has_next_page` / `end_cursor`, trả về `pageInfo` và hỗ trợ `cursor` argument. Nếu không rõ, giữ `pageInfo` mặc định `{ has_next_page: false, end_cursor: null }`.
- `search`: tương tự; nếu dùng SSR fallback thì phân trang bằng scroll/cursor embedded.
- `get_post_comments`: `CommentTreeExtractor` tự quản lý BFS; mỗi layer `fetchLayer` có thể dùng `after` cursor nếu GraphQL trả `page_info`.
- `CrawlCheckpoint`: sau mỗi action thành công, ghi / cập nhật `CrawlCheckpoint` với `platform: 'threads'`, `targetType` (`user_feed`/`search`/`post_comments`), `targetKey`, `lastCursor`, `lastTimestamp`, `lastCrawledAt`, `status` (`running`/`completed`/`failed` theo `src/store/checkpoint-manager.js:1-272` / `prisma/schema.prisma:389-406`).
- Redis thin events: sau `storeBatch`/`storeCommentBatch` thành công, phát thin event pointers `{ id, platform, externalId, category, authorId, crawledAt, storageRef }` vào `stream:social:raw_posts` (`MAXLEN ~ 1000000` hoặc `MINID` theo thời gian, configurable) khi `REDIS_STREAM_ENABLED=true`. Dùng `StreamMetricsReader` (`src/utils/stream-metrics.js`) để theo dõi consumer lag.

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 20.18.1, JSDoc + `npm run typecheck` (`tsc --noEmit`) [Source: `package.json:13-14`, `package.json:96`].
- **HTTP Client:** `got-scraping@^3.2.15` mặc định (`client: 'got'`) vì hỗ trợ `proxyUrl` string, TLS/JA4 spoofing, header generator [Source: `package.json:119`].
- **HTTP Fallback:** `undici@^7.29.0` nếu `client: 'undici'`, cần cấu hình `ProxyAgent`/`Socks5ProxyAgent` [Source: `package.json:141`].
- **Proxy:** `ProxyIpPool` từ `src/proxy/index.js`. Theo AD-3, `requiresAuth=true` sử dụng sticky IP per account (`getStickyProxy`) thay vì rotating proxy; `accountId='threads-guest'` hoặc dedicated account pool key.
- **Browser / Signer:** Không bắt buộc browser per request. Dùng HTTP-only fetch HTML để lấy `lsd`. Không dùng `PreSignedTokenRing` cho token compound object.
- **Cookie serialization:** Tự build `Cookie` header từ `this.cookies` hoặc `options.headers.cookie` [Source: `src/core/base-client.js:767-841`].
- **Concurrency:** `p-limit@^7.2.0` nếu cần batch [Source: `package.json:128`].

## Architecture Compliance

| AD | Rule | Implementation |
|----|------|----------------|
| AD-1 | Tiered Hybrid Signer | `Map`-based token cache cho `lsd`/`csrftoken`/`fb_dtsg` (không `PreSignedTokenRing`); HTTP client là transport chính. |
| AD-2 | Unified Base Interfaces | `ThreadsCrawler` extends `AbstractCrawler`; `ThreadsClient` extends `AbstractApiClient`. |
| AD-3 | Sticky IP per account | `requiresAuth=true`; guest tokens quản lý qua `accountId='threads-guest'` với `proxyPool.getStickyProxy(...)`. |
| AD-4 | Namespaced PostgreSQL | `PostItem.id = generatePostId('threads', post.pk)`; `CommentItem.id = generateCommentId('threads', postId, replyPk)`; lưu `category: 'social'`. |
| AD-6 | Hierarchical Comment Tree | Dùng `CommentTreeExtractor` BFS với `fetchLayer` callback, `p-limit(2)`, clamp `maxDepth`/`maxComments`, topological sort qua `PrismaStore.storeCommentBatch`. |
| AD-7 | Redis Stream Thin Events | Phát thin event pointers vào `stream:social:raw_posts` sau khi `storeBatch`/`storeCommentBatch` thành công. |
| AD-8 | Multi-Domain Expansion | File mới trong `src/scrapers/social/threads/`. Legacy `src/scrapers/threads/` không đụng. |
| AD-9 | Anti-Bot Payload Validation | `ThreadsPlatformResponseValidator` trả về `true/false`; `AbstractApiClient.request()` throw `PlatformError` với `code`/`suggestedAction`. |
| AD-11 | ActionRegistry | Action names `search`, `get_user_feed`, `get_post_comments` (snake_case). `listActions()` trả về `ActionDescriptor`. |
| AD-12 | CrawlCheckpoint | Ghi `CrawlCheckpoint` (cursor/timestamp) sau mỗi action thành công; đọc lại khi resume. |
| AD-14 | Error Envelope | Mọi lỗi trả về `PlatformError` với `code`, `type`, `suggestedAction`, `platform`. |
| AD-18 | Metadata Schema Contract | Tạo `schemas/threads/social.json` để `PrismaStore` validate metadata. |

## Concrete `schemas/threads/social.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Threads Social Post Metadata",
  "type": "object",
  "properties": {
    "postCode": {
      "type": "string"
    },
    "mediaType": {
      "type": "string"
    },
    "isReply": {
      "type": "boolean"
    },
    "carousel": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "replyControl": {
      "type": "string"
    },
    "sourceMethod": {
      "type": "string"
    }
  },
  "required": [
    "postCode",
    "mediaType",
    "sourceMethod"
  ]
}
```

## Library & Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| `got-scraping` | `^3.2.15` | HTTP client default, TLS/JA4 spoofing, proxy `proxyUrl`, header generator [Source: `package.json:119`] |
| `undici` | `^7.29.0` | HTTP client fallback; `ProxyAgent`/`Socks5ProxyAgent` [Source: `package.json:141`] |
| `p-limit` | `^7.2.0` | Giới hạn concurrency cho `CommentTreeExtractor` / batch request [Source: `package.json:128`] |
| `playwright` | `^1.62.1` | Chỉ dùng nếu cần `SignerWorkerPagePool` evaluate (không bắt buộc) [Source: `package.json:129`] |
| `puppeteer` | `^24.34.0` | Không dùng cho hybrid path; legacy `src/scrapers/threads/index.js` vẫn giữ [Source: `package.json:132`] |
| `vitest` | `^4.0.18` | Test framework [Source: `package.json:161`] |

## File Structure Requirements

### CREATE

| File | Description |
|------|-------------|
| `src/scrapers/social/threads/index.js` | Barrel export `ThreadsClient`, `ThreadsCrawler`, `ThreadsPlatformResponseValidator`, `DEFAULT_THREADS_DOC_IDS` |
| `src/scrapers/social/threads/client.js` | `ThreadsClient` extends `AbstractApiClient` |
| `src/scrapers/social/threads/crawler.js` | `ThreadsCrawler` extends `AbstractCrawler` |
| `src/scrapers/social/threads/validator.js` | `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator` |
| `src/scrapers/social/threads/normalizer.js` | (Optional) `normalizePost`, `normalizeComment` helpers để tái sử dụng và test dễ hơn |
| `schemas/threads/social.json` | JSON Schema cho `PostItem.metadata` platform `threads` category `social` |
| `tests/scrapers/social/threads/client.test.js` | Tests `ThreadsClient` với local HTTP server |
| `tests/scrapers/social/threads/crawler.test.js` | Tests `ThreadsCrawler` actions |

### UPDATE

| File | Description |
|------|-------------|
| `src/scrapers/social/index.js` | Thêm `export * from './threads/index.js'` để barrel nhìn thấy Threads [Source: `src/scrapers/social/index.js:1-9`] |
| `src/scrapers/threads/index.js` | Thêm `@deprecated` JSDoc cho **tất cả** exported symbols (`createBrowser`, `createPage`, `scrapeProfile`, `scrapeTweets`, `searchTweets`, `scrapeFollowers`, `scrapeFollowing`) và default export (KHÔNG sửa logic) [Source: `src/scrapers/threads/index.js:1-396`] |
| `docs/deprecation-plan.md` | Cập nhật status tracker `Threads Puppeteer` sang `deprecated-marked` [Source: `docs/deprecation-plan.md:76-83`] |
| `types/index.d.ts` | (Optional) Thêm type declarations cho `ThreadsClient`, `ThreadsCrawler` |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/scrapers/index.js` (legacy dispatcher) | `scrape('threads', ...)` package-level vẫn dispatch đến legacy `src/scrapers/threads/index.js`; cutover sang hybrid là Epic 20.2. Không sửa ở story này. |
| `src/core/base-client.js` | Đã hoàn thiện ở Story 13.1. Chỉ dùng API, không sửa logic. |
| `src/core/base-crawler.js` | Đã hoàn thiện. Chỉ kế thừa. |
| `src/scrapers/social/comment-tree.js` | Đã hoàn thiện ở Story 14.1. Dùng API, không sửa logic. |
| `src/scrapers/threads/index.js` logic | Legacy; chỉ thêm `@deprecated`, không thay đổi hành vi. |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test` [Source: `package.json:50`, `package.json:161`].
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** Dùng `http.createServer` để phục vụ HTML profile/search/post + JSON GraphQL.
- **Real proxy:** Dùng `ProxyIpPool` hoặc `StaticProxyProvider` với proxy local.
- **Coverage tối thiểu:**
  - `ThreadsClient.ensureLsd()` parse đúng `lsd` từ HTML, dùng `Map` cache với TTL, không dùng `tokenRing`.
  - `ThreadsClient.requestGraphQl()` gửi đúng form body, headers, và doc_id; token values không xuất hiện trong log/error.
  - `ThreadsCrawler.listActions()` trả về `ActionDescriptor[]`.
  - `ThreadsCrawler.start({ action: 'get_user_feed', ... })` trả về `PostItem[]`.
  - `ThreadsCrawler.start({ action: 'search', ... })` trả về `PostItem[]` (GraphQL hoặc SSR fallback).
  - `ThreadsCrawler.start({ action: 'get_post_comments', ... })` trả về `CommentItem[]` với đúng depth, `fetchLayer` callback hoạt động, `maxDepth`/`maxComments` clamped.
  - `CommentTreeExtractor` integration: `fetchLayer({ postId, parentCommentId, after, limit })` trả `{ comments, pageInfo }`, `normalizeFn(raw, postId)` trả `CommentItem`.
  - Sau `storeBatch`/`storeCommentBatch`, `CrawlCheckpoint` được ghi và thin events được phát vào `stream:social:raw_posts`.
  - Response bot challenge / rate limit được xử lý qua validator.
  - `cleanup()` không leak.
- **Regression:** Chạy `npm run typecheck` và `npm test -- tests/core/` / `npm test -- tests/scrapers/social/facebook/` để đảm bảo không phá Facebook/comment-tree tests.

## Previous Story Intelligence

### Story 13.1 — Tiered Signer Architecture (Done)

- `AbstractApiClient` đã có `tokenRing`, `signerPool`, `request`, `requestWithSign`, `resolveProxy` [Source: `src/core/base-client.js:43-140`].
- `PreSignedTokenRing` lưu string tokens, `next()` O(1), throw `XACT_5000` khi empty [Source: `src/core/signer-pool.js:43-79`]. **Threads KHÔNG dùng `PreSignedTokenRing` cho `lsd` vì cần lưu compound token object; thay vào đó dùng `Map`-based cache.**
- `SignerWorkerPagePool` dùng Playwright/Puppeteer qua adapter, `p-limit`, drain-in-flight close [Source: `src/core/signer-pool.js:92-342`].

### Story 13.3 — Facebook Hybrid Scraper (Done)

- `FacebookClient` mẫu triển khai `ensureTokens`, `buildGraphQlBody`, `requestGraphQl` với `application/x-www-form-urlencoded` [Source: `src/scrapers/social/facebook/client.js:45-397`].
- `FacebookCrawler` đăng ký `group_posts`, `page_posts`, `get_comments`, normalize `PostItem`/`CommentItem`, lưu `PrismaStore` [Source: `src/scrapers/social/facebook/crawler.js:62-834`].
- `FacebookPlatformResponseValidator` phát hiện bot challenge, rate limit, valid payload [Source: `src/scrapers/social/facebook/validator.js:34-208`].
- Pattern `DEFAULT_FB_DOC_IDS` + `deps.docIds` override nên tái sử dụng cho `DEFAULT_THREADS_DOC_IDS`.

### Story 14.1 — Hierarchical Comment Tree (Review/Done)

- `CommentTreeExtractor` platform-agnostic BFS, depth assignment, cycle detection, topological sort [Source: `src/scrapers/social/comment-tree.js:30-181`].
- `FacebookCrawler.getCommentsForPost` (`src/scrapers/social/facebook/crawler.js:677-823`) là mẫu tham khảo:
  - Tạo `commentContext` map (`Map<string, { feedbackId, expansionToken }>`) để giữ context phân trang cho từng comment.
  - `fetchLayer({ postId, parentCommentId, after, limit })` chọn `doc_id` khác nhau cho root (`COMMENT_ROOTS`) và reply (`COMMENT_REPLIES`), trả về `{ comments: raw[], pageInfo: { has_next_page, end_cursor } }`.
  - `normalizeFn(raw, postId)` chuẩn hóa raw node thành `CommentItem` và cập nhật `commentContext` với `feedbackId`/`expansionToken` từ `metadata`.
  - `maxDepth` clamp `[0,5]`, `maxComments` clamp `[1,2000]`; `p-limit(2)` concurrency.
- `PrismaStore.storeCommentBatch` đã lưu theo depth ascending [Source: `src/store/prisma-store.js:271-298`].

## Git Intelligence

Recent commits (mới nhất trước story này):
- `e9ae115` `feat(facebook): raise default request timeout to 120s` — thêm `this.timeout` vào `AbstractApiClient`, `FacebookClient` default 120s [Source: `git log --stat -5`].
- `4f08ad4` `fix(facebook): real-cookie comment extraction and false-positive bot challenge` — cập nhật `FacebookCrawler` `getCommentsForPost` cho live response shape [Source: `git log --stat -5`].
- `b021ed8` `feat(facebook): integrate captured GraphQL variables for comment extraction` — comment rendering instance variables [Source: `git log --stat -5`].
- `5918bbb` `feat(facebook): wire real captured comment GraphQL doc_ids` — `COMMENT_ROOTS`, `COMMENT_REPLIES`, `COMMENT_REPLIES_DEPTH2` [Source: `git log --stat -5`].
- `30f1171` `feat(comments): implement hierarchical comment tree extraction for Story 14.1` — `CommentTreeExtractor` và `FacebookCrawler.get_comments` [Source: `git log --stat -5`].

Patterns:
- Commit messages theo format `type(scope): description`.
- Không dùng mock trong tests.
- `base-client.js`, `base-crawler.js`, `comment-tree.js` vừa ổn định; tránh sửa trừ khi cần thiết.

## Latest Tech Information

- Threads public GraphQL endpoint `https://www.threads.net/api/graphql` dùng Relay persisted queries (`doc_id`); không cần authentication nhưng cần `lsd` token.
- `doc_id` thường xuyên bị Meta xoay; cần cơ chế capture/override.
- `x-ig-app-id: 238260118697367` là constant cho web app; `x-asbd-id` có thể thay đổi (các giá trị candidate: `359341`, `129477`).
- `lsd` token lấy từ HTML `"LSD",[],{"token":"..."}`; `csrftoken` cookie cần khớp `x-csrftoken` header để tránh empty response.
- Web search UI trên `threads.net` không expose search bar, nhưng endpoint `/?q=` và GraphQL search tồn tại; cần capture hoặc SSR fallback.
- `got-scraping@^3.2.15` — stable, hỗ trợ `proxyUrl` và header generator [Source: `package.json:119`].
- `undici@^7.29.0` — modern fetch, `ProxyAgent`/`Socks5ProxyAgent` dispatcher, `AbortSignal.timeout` [Source: `package.json:141`].

## Project Context Reference

- Epic 15: `_bmad-output/planning-artifacts/epics.md` — Epic 15: Vietnam Viral Social — Threads & TikTok Scraper Engine, Story 15.1 (lines 446-458).
- Architecture: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (AD-1, AD-2, AD-3, AD-4, AD-6, AD-7, AD-8, AD-9, AD-11, AD-12, AD-14, AD-18).
- Deprecation plan: `docs/deprecation-plan.md` (Threads legacy mapping, status tracker).
- Core contracts:
  - `src/core/base-client.js` (`AbstractApiClient`, `request`, `requestWithSign`, `resolveProxy`)
  - `src/core/base-crawler.js` (`AbstractCrawler`, `ActionRegistry`, `start`, `listActions`)
  - `src/core/platform-validator.js` (`AbstractPlatformResponseValidator`)
  - `src/core/signer-pool.js` (`PreSignedTokenRing`, `SignerWorkerPagePool`) — Threads dùng `Map`-based token cache, không dùng `PreSignedTokenRing` cho `lsd`
  - `src/store/prisma-store.js` (`storeBatch`, `storeCommentBatch`)
  - `src/core/types.js` (`PostItem`, `CommentItem`, `generatePostId`, `generateCommentId`)
  - `src/core/metadata-schema-registry.js` (schema validation)
  - `src/scrapers/social/comment-tree.js` (`CommentTreeExtractor`)
- Legacy reference:
  - `src/scrapers/threads/index.js` (Puppeteer-based; để tránh break, chỉ thêm `@deprecated`)
- Similar done story:
  - `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md`
  - `_bmad-output/implementation-artifacts/14-1-hierarchical-comment-tree-extraction-algorithm.md`

## Outstanding Items / Network Capture Required

Các mục dưới đây **bắt buộc** dev xác nhận qua capture từ trình duyệt / proxy thật trước khi chạy production. Không dùng các repo ngoài làm nguồn chính.

### Known `doc_id` candidates (pending live verification)

| Action | Query | Friendly Name | Candidate doc_id | Candidate variables | Ghi chú |
|---|---|---|---|---|---|
| `get_user_feed` | profile threads tab | `BarcelonaProfileThreadsTabQuery` | `6232751443445612` | `{"userID":"<numeric_id>"}` (có thể kèm `first`, `after`) | Cần xác nhận qua capture |
| `search` | search posts | `BarcelonaSearchPostsQuery` | *capture required* | TBD | Chưa có doc_id công khai ổn định |
| `get_post_comments` | post detail | `BarcelonaPostPageQuery` | `5587632691339264` | `{"postID":"<id>"}` kèm relay provider flags | Dùng làm fallback post-detail; root/reply comment doc_id **phải capture** |
| (future) | user profile root | `BarcelonaProfileRootQuery` | `23996318473300828` | `{"userID":"<id>"}` | Không bắt buộc cho MVP |
| (future) | user replies tab | `BarcelonaProfileRepliesTabQuery` | `6307072669391286` | `{"userID":"<id>"}` | Không bắt buộc cho MVP |
| (future) | post likers | `BarcelonaMediaLikersQuery` | `9360915773983802` | `{"mediaID":"<id>"}` | Không bắt buộc cho MVP |
| (future) | search users | `BarcelonaSearchUserResultsQuery` | `27238810212443285` | `{"query":"...","search_surface":null,...}` | Không bắt buộc cho MVP |

### Open decisions

1. **Search post doc_id:** Chưa có doc_id công khai ổn định cho keyword search posts trên `threads.net`. Dev cần capture từ browser network hoặc triển khai SSR fallback. Nếu capture được, cập nhật `DEFAULT_THREADS_DOC_IDS.SEARCH_POSTS` và bổ sung variables/response shape.
2. **Post detail / reply pagination doc_id:** `BarcelonaPostPageQuery` doc_id có thể xoay; candidate `5587632691339264` được dùng làm default post-detail, nhưng `doc_id` root/reply comment **phải capture** từ live network.
3. **x-asbd-id value:** Có hai giá trị candidate `359341` và `129477`. Cho phép override qua constructor; default `359341`.
4. **Pagination variables:** Các query `BarcelonaProfileThreadsTabQuery` và `BarcelonaPostPageQuery` có thể cần thêm `first`, `after`, `__relay_internal__pv__*` flags. Dev cần capture live request hoặc dùng SSR khi GraphQL trả thiếu pagination.

## Validation Report

| Check | Status | Notes |
|-------|--------|-------|
| User story + BDD acceptance criteria | Pass | Khớp `epics.md` Story 15.1. |
| Architecture compliance (AD-1..AD-18) | Pass | Đã map AD-1, AD-2, AD-3, AD-4, AD-6, AD-7, AD-8, AD-9, AD-11, AD-12, AD-14, AD-18. |
| Technical requirements / stack | Pass | `got-scraping@^3.2.15`, `undici@^7.29.0`, `vitest@^4.0.18`, Node >= 20.18.1. |
| File structure (CREATE/UPDATE/NO TOUCH) | Pass | Tách rõ legacy `src/scrapers/threads/` vs mới `src/scrapers/social/threads/`. |
| Testing requirements | Pass | No mocks, local HTTP server, real proxy, typecheck. |
| Previous story intelligence | Pass | Dựa trên Story 13.3 (done), 14.1 (done). |
| Git intelligence | Updated | Đã cập nhật với 5 commit mới nhất. |
| Core code state to preserve | Pass | Kiểm tra `base-client.js:53-54` default `client='undici'`, `base-client.js:181-229` sticky proxy cho `requiresAuth=true`, `base-client.js:580-628` validator → throw pattern, `base-crawler.js:149-244` start flow, `prisma-store.js:198-210` schema validation. |
| UX / experience flows | N/A | Story là headless scraper; không có UI mới. |
| Security (cookie/token, no logs) | Pass | NFR-4: `lsd`, `csrftoken`, `fb_dtsg`, cookie không được log hoặc trả về trong error; dùng `Map`-based token cache TTL 30 phút. |

### Fixes Applied During Validation

1. Thêm YAML frontmatter với `story_id`, `epic`, `story_key`, `status`, `created`, `updated`, `owner`, `reviewed`, `baseline_commit`.
2. Phân biệt rõ `get_user_feed` (profile feed) và `search` (keyword) vì `epics.md` AC dùng `search(query)` hoặc `getUserFeed(username)`.
3. Thêm action `get_post_comments` để cover "bình luận" trong story objective.
4. Cập nhật `requiresAuth=true` cho `ThreadsClient`/`ThreadsCrawler`; guest token path dùng `accountId='threads-guest'` với sticky proxy (AD-3).
5. Chuyển token strategy từ `PreSignedTokenRing` sang `Map`-based in-memory cache TTL 30 phút với in-flight deduplication, mẫu `FacebookClient`.
6. Điều chỉnh `ThreadsPlatformResponseValidator` trả về `true/false`; `AbstractApiClient.request()` throw `PlatformError`.
7. Bổ sung `fetchLayer` callback, `maxDepth`/`maxComments` clamp `[0,5]`/`[1,2000]`, `p-limit(2)` concurrency, và `normalizeFn` cho `CommentTreeExtractor`.
8. Thêm `CrawlCheckpoint` và thin event emission vào Redis `stream:social:raw_posts` sau `storeBatch`/`storeCommentBatch`.
9. Di chuyển known `doc_id` candidates xuống phần *Outstanding Items / Network Capture Required*; đánh dấu root/reply/`SEARCH_POSTS` là cần capture từ network.

### Outstanding Items (Dev Agent Owned)

- Xác nhận / capture `doc_id` thực tế cho `search` (nếu có) hoặc triển khai SSR fallback.
- Xác nhận / capture root/reply `doc_id` + variables cho `BarcelonaPostPageQuery` comment pagination.
- Quyết định giá trị `x-asbd-id` phù hợp qua test thực tế.
- Triển khai `schemas/threads/social.json` theo schema đã dự thảo ở trên.

## Dev Agent Record

### Agent Model Used

Developer Agent — `bmad-dev-story` workflow.

### Implementation Notes

- Triển khai hoàn chỉnh module `src/scrapers/social/threads/`:
  - `ThreadsClient` extends `AbstractApiClient` với `got-scraping`, dynamic extraction token (`lsd`, `csrftoken`, `fb_dtsg`), `Map`-based in-memory token cache (TTL 30 phút, in-flight request deduplication), và dispatch GraphQL request với Relay `doc_id`.
  - `ThreadsCrawler` extends `AbstractCrawler` với `requiresAuth = true`, synthetic guest account `threads-guest`, đăng ký các action `get_user_feed`, `search`, và `get_post_comments` vào `ActionRegistry`.
  - `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator` nhận diện valid payload (unwrapping nested `data` envelopes), bot challenge, login wall, và rate limit.
  - `normalizePost` và `normalizeComment` chuyển đổi raw response thành schema chuẩn `PostItem` và `CommentItem` theo AD-4 & `src/core/types.js`.
  - Tạo schema contract `schemas/threads/social.json` phục vụ validation metadata khi persist qua `PrismaStore.storeBatch`.
  - Hỗ trợ `CrawlCheckpoint` persistence và thin event pointer emission vào Redis stream `stream:social:raw_posts`.
  - Tích hợp `CommentTreeExtractor` cho `get_post_comments` với `fetchLayer` callback, `p-limit(2)`, `maxDepth` clamp [0, 5], `maxComments` clamp [1, 2000].
  - Gắn `@deprecated` JSDoc cho tất cả export symbols trong `src/scrapers/threads/index.js` và cập nhật `docs/deprecation-plan.md`.
- No-mock unit & integration tests viết mới trong `tests/scrapers/social/threads/client.test.js` và `tests/scrapers/social/threads/crawler.test.js` (13 tests pass 100%).
- Typecheck `npm run typecheck` (`tsc --noEmit`) đạt 0 lỗi. Toàn bộ regression test `tests/scrapers/social/` và `tests/core/` pass 100%.

### File List

- `_bmad-output/implementation-artifacts/15-1-threads-scraper-adapter-meta-internal-graphql.md`

### Review Findings

Generated: 2026-08-26T05:31:30Z

#### Decision needed

- [x] [Review][Decision] THR-DEC-01: AbstractApiClient 5xx and transport-error retry/quarantine ownership — Implemented a `ThreadsClient`-level `#withTransportRetry` wrapper for `ensureLsd` and `requestGraphQl` that retries `ProxyDeadError`, `XACT_5030`, `XACT_5000`, and generic transport errors with exponential backoff + jitter, quarantines dead proxies, and rotates proxies via `getProxy({ forceRotate: true })` / `getNext()` without touching `base-client.js`. (edge)
- [x] [Review][Decision] THR-DEC-02: CommentTreeExtractor cursor-deduplication and empty-cursor guard — Implemented the guard in `ThreadsCrawler.fetchLayer` using a per-call `seenCursors` set; `#normalizePageInfo` now clamps empty end_cursors with `has_next_page=true` and deduplicates repeated cursors before `CommentTreeExtractor` sees them. (edge)
- [x] [Review][Decision] THR-DEC-03: get_post_comments BarcelonaPostPageQuery fallback for comment pagination — Kept the short-term `POST_DETAIL` fallback and clamped/flattened it: the fallback now only extracts the top-level post from each reply thread and returns a single layer with `has_next_page=false` and `end_cursor=null`; reply layers without `COMMENT_REPLIES` now throw `XACT_5000`. (edge)
- [x] [Review][Decision] THR-DEC-04: Token cache and token-extraction failure need a proxy-aware contract — `ThreadsClient.#buildCacheKey` already uses `${accountId}::${proxyKey}::${cookieKey}`; token fetch now retries `maxTokenFetchRetries` times with short delay, clears the specific cache key on extraction failure, and `requestGraphQl` clears all tokens for the account on any `XACT_4010` error. (edge)

#### Patches

- [x] [Review][Patch] THR-P01: Child comment fetches do not pass the parent comment ID in GraphQL variables — `fetchLayer` receives `parentCommentId` but only sets `postID`, `post_id`, `after`, and `first` in the request body (`src/scrapers/social/threads/crawler.js:573-578`). When captured reply `doc_id`s are used this causes the wrong/missing parent scope and the same root bundle to be fetched for every parent. (edge)
- [x] [Review][Patch] THR-P02: Root `args.after` cursor leaks into child comment fetches — `fetchLayer` uses `after: after || args.after || null` (`src/scrapers/social/threads/crawler.js:576`), so a child layer with `after` unset reuses the root input cursor instead of starting at the top of the child list. (edge)
- [x] [Review][Patch] THR-P03: getUserFeed / searchPosts do not validate `count` — `first: args.count || 20` (`src/scrapers/social/threads/crawler.js:386,447`) forwards `0`, negative numbers, and `NaN` to the GraphQL request. Validate and clamp to a sensible range before building variables. (edge)
- [x] [Review][Patch] THR-P04: normalizePostItem only keeps the first post of a multi-post thread — `const post = raw.post || raw.thread_items?.[0]?.post || raw` (`src/scrapers/social/threads/crawler.js:154`) drops additional `thread_items` in a single Threads thread. Flatten `thread_items` so each contained post becomes a separate `PostItem`. (edge)
- [x] [Review][Patch] THR-P05: Post/comment `content` is not coerced to string — the normalizer falls back to `post.text`/`replyPost.text` without `String()` (`src/scrapers/social/threads/crawler.js:165-167,255-257`), so numeric or object values can leak into `PostItem.content`/`CommentItem.content`. (edge)
- [x] [Review][Patch] THR-P06: `taken_at` timestamp heuristic mis-handles edge values — `Number(takenAt) > 1e11` (`src/scrapers/social/threads/crawler.js:198-202,268-271`) treats far-future second timestamps as milliseconds and does not guard against strings like `'0'`. Use a more robust ms-vs-s check (e.g., length, `> 1e12` threshold, or explicit parsing). (edge)
- [x] [Review][Patch] THR-P07: `search()` discards `pageInfo` — the registered action handler `search()` calls `this.searchPosts()` and returns only `res.posts` (`src/scrapers/social/threads/crawler.js:527-528`), so callers cannot resume from a search cursor. Return the `{ posts, pageInfo }` object or expose `pageInfo` to `start()`. (edge)
- [x] [Review][Patch] THR-P08: getUserFeed / searchPosts checkpoint and pageInfo do not normalize empty `end_cursor` — the methods return `pageInfo` directly and the checkpoint uses `pageInfo?.end_cursor || args.cursor || null` (`src/scrapers/social/threads/crawler.js:408-419,465-473`). Empty/undefined `end_cursor` should be normalized to `null` instead of reusing the input cursor. (edge)
- [x] [Review][Patch] THR-P09: searchPosts SSR fallback returns `pageInfo: null` — the HTTP fallback builds a single result list and returns `{ posts, pageInfo: null }` (`src/scrapers/social/threads/crawler.js:514-517`) with no pagination, so `SEARCH_POSTS` doc_id capture is effectively required for any resumable search. Either parse a next cursor from the SSR HTML or document the limitation. (edge)
- [x] [Review][Patch] THR-P10: Missing `lsd` is accepted if `fb_dtsg` is present — `#fetchTokens` only throws when both `lsd` and `dtsg` are missing (`src/scrapers/social/threads/client.js:173-182`), allowing a token set with empty `lsd` to be sent as `x-fb-lsd: ''`. Require `lsd` to be present and non-empty. (edge)
- [x] [Review][Patch] THR-P11: Other Meta session-invalid codes are not mapped to auth rotation — only `190` and `1357004` are treated as `AUTH_EXPIRED` (`src/scrapers/social/threads/client.js:300-322`). Other common codes (e.g., `1357001`, `1675004`, `368` only maps to rate-limit) are wrapped as `XACT_5000`. Maintain a mapped set of session-invalid codes that rotate the account. (edge)
- [x] [Review][Patch] THR-P12: HTML responses that slip past the validator fail opaquely — `requestGraphQl` tries to JSON-parse string payloads and throws `XACT_5000` "Unexpected non-JSON response" (`src/scrapers/social/threads/client.js:278-292`). When the response is HTML (soft checkpoint or login wall), classify it with `ThreadsPlatformResponseValidator` and throw a `BotChallengeError`/rotatable `PlatformError` instead. (edge)
- [x] [Review][Patch] THR-P13: Soft 200 checkpoint pages may be missed by the validator — `isBotChallenge` (`src/scrapers/social/threads/validator.js:134-165`) only matches a narrow set of HTML/URL/error patterns. Soft 200 challenge strings like `"suspicious activity"`, `"unusual activity"`, `"verify your account"`, and `"log in to continue"` are not detected. Expand the heuristic set and add tests. (edge)
- [x] [Review][Patch] THR-P14: Connection-format child fetches may not unwrap nested `edge.node` wrappers — `comments = (connection?.edges || []).map((edge) => edge?.node).filter(Boolean)` (`src/scrapers/social/threads/crawler.js:605`) drops deeper wrapper shapes such as `edge.node.node`. Add a defensive unwrap helper. (edge)
- [x] [Review][Patch] THR-P15: ensureLsd in-flight dedup can amplify token endpoint load on failure — when the token fetch promise rejects, all waiters fail simultaneously and the next request immediately creates a new fetch (`src/scrapers/social/threads/client.js:99-109`). Add a short cooldown/backoff and quarantine the proxy on repeated token extraction failures. (edge)
- [x] [Review][Patch] THR-P16: Threads test coverage gaps — missing boundary tests for `getUserFeed` (`tests/scrapers/social/threads/crawler.test.js:239-276`), `getPostComments` (`tests/scrapers/social/threads/crawler.test.js:302-328`), network/proxy failure paths and 5xx/transport behavior for the client (`tests/scrapers/social/threads/client.test.js`), token extraction failure / TTL / in-flight-dedup failure (`tests/scrapers/social/threads/client.test.js:150-163`), `searchPosts` SSR fallback with malformed/empty HTML (`tests/scrapers/social/threads/crawler.test.js:278-300), and URL/shortcode normalization for `postId`/`username` (`tests/scrapers/social/threads/crawler.test.js:239-328`). Add targeted tests. (edge)

#### Deferred

- [x] [Review][Defer] THR-D01: CommentTreeExtractor exits on empty/null `end_cursor` even when `has_next_page` is true — `fetchLayerPaginated` sets `after` to `pageInfo.end_cursor` but does not continue when it is an empty string (`src/scrapers/social/comment-tree.js:155-158`). Pre-existing in shared `comment-tree.js` (Story 14.1); defer to that owner. (edge)
- [x] [Review][Defer] THR-D02: Comments with `subCommentsCount` missing or `0` are never expanded — the depth loop only expands parents where `(c.subCommentsCount ?? 0) > 0` (`src/scrapers/social/comment-tree.js:167-169`), which skips replies if the API omits the count or reports `0` with actual children. Pre-existing in `comment-tree.js`. (edge)
- [x] [Review][Defer] THR-D03: Cycle detector can re-attach to an existing cycle — `#wouldCreateCycle` returns `false` when it re-encounters an already-visited ID in the parent chain (`src/scrapers/social/comment-tree.js:190-201`), potentially allowing a cycle to be added. Pre-existing in `comment-tree.js`. (edge)
- [x] [Review][Defer] THR-D04: Orphan comments are not re-parented when the parent later arrives — missing parents are made into orphan roots (`src/scrapers/social/comment-tree.js:113-121`), but there is no second-pass re-parenting if the parent shows up in a later layer. Pre-existing in `comment-tree.js`. (edge)
- [x] [Review][Defer] THR-D05: Shared `byId`/`seen`/`total` state is mutated under `pLimit` without atomic guards — the BFS state is accessed from multiple concurrent `fetchLayerPaginated` calls (`src/scrapers/social/comment-tree.js:67-79,134-176`). Pre-existing in `comment-tree.js` (Story 14.1). (edge)
- [x] [Review][Defer] THR-D06: Single child `fetchLayer` failure rejects the entire comment tree — `Promise.all` over parent fetches has no per-parent error isolation (`src/scrapers/social/comment-tree.js:172-176`). Pre-existing in `comment-tree.js`. (edge)
- [x] [Review][Defer] THR-D07: No `comment-tree.test.js` for cycles, duplicate IDs, orphan re-parenting, or `subCommentsCount=0` — the project has no `tests/scrapers/social/comment-tree.test.js`. Out of scope for 15.1. (edge)
- [x] [Review][Defer] THR-D08: No concurrency / `p-limit` / shared-state race tests for `CommentTreeExtractor` — same missing `tests/scrapers/social/comment-tree.test.js` coverage. Out of scope for 15.1. (edge)
- [x] [Review][Defer] THR-D09: Legacy Puppeteer `scrapeTweets` / `searchTweets` still use post text fragment as fallback ID and lack proxy/cookie rotation and retry — only `@deprecated` markers were required for this story. Defer to Epic 20.2 deprecation work. (`src/scrapers/threads/index.js:196-213,245-316`) (edge)
