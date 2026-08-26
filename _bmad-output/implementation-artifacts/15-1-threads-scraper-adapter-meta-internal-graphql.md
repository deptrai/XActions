---
story_id: "15.1"
epic: 15
story_key: "15-1-threads-scraper-adapter-meta-internal-graphql"
status: "ready-for-dev"
phase: "Phase 4"
created: 2026-08-26
updated: 2026-08-26
owner: "DEV"
reviewed: "Pending"
baseline_commit: e9ae115744371f8b74f43f7adb6861c436237ed2
---

# Story 15.1: Threads Scraper Adapter (Meta Internal GraphQL)

<!-- Note: Context analysis completed 2026-08-26. Ready for dev-story / bmad-dev-auto. -->

## Story

As a **Viral Marketer & Trend Researcher**,  
I want **cào bài viết, timeline và bình luận trên mạng xã hội Threads**,  
so that **tôi có thể nắm bắt các chủ đề nóng và drama thịnh hành của giới trẻ Việt Nam**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 15, Story 15.1, lines 446-458]

## Acceptance Criteria

### AC-1: ThreadsClient kế thừa AbstractApiClient
- **Given** `ThreadsClient` được triển khai trong `src/scrapers/social/threads/client.js`
- **When** khởi tạo với `baseUrl`, `proxyPool`, `governor`, `tokenRing`
- **Then** `ThreadsClient` kế thừa `AbstractApiClient` [Source: `src/core/base-client.js:43-140`]
- **And** `name = 'threads'`, `platform = 'threads'`, `requiresAuth = false` (public/no-auth scraping), `client = 'got'` [Source: `src/core/base-client.js:44-54`]
- **And** `ensureLsd()` tự động fetch `https://www.threads.net/@instagram` (hoặc profile page) để trích xuất `lsd` token từ HTML [Source: `go-threads lsd.go` pattern `LSD",[],\{"token":"([^"]+)"\}`]
- **And** `lsd` được refill vào `PreSignedTokenRing` (hoặc cache nội bộ 30 phút) để `buildGraphQlBody` lấy qua `this.tokenRing.next()` [Source: `src/core/signer-pool.js:19-79`]

### AC-2: ThreadsClient dispatch GraphQL với doc_id
- **Given** `doc_id` và `variables`
- **When** gọi `client.requestGraphQl(docId, variables, options)`
- **Then** POST `https://www.threads.net/api/graphql` với `content-type: application/x-www-form-urlencoded`
- **And** body gồm `doc_id`, `lsd`, `variables` (JSON stringified) [Source: `m1guelpf/threads-re` & `go-threads endpoints.go`]
- **And** headers gồm `x-ig-app-id: 238260118697367`, `x-asbd-id: 359341` (hoặc `129477` nếu capture gần nhất khác — cho phép override), `x-fb-lsd: <lsd>`, `x-csrftoken` (nếu `csrftoken` cookie có) [Source: `go-threads endpoints.go:14-58`, `yinyajiang/go-threads:78-93`]
- **And** parser kết quả JSON, phát hiện lỗi GraphQL (`errors`), rate-limit, bot challenge, empty payload, doc_id rotated qua `ThreadsPlatformResponseValidator`
- **And** khi GraphQL trả `errors` với `message` chứa "Invalid doc_id" / "execution failed" thì throw `PlatformError` với `code: 'XACT_5000'`, `type: 'internal'`, `suggestedAction: 'retry_after_delay'` (NFR-7)

### AC-3: ThreadsCrawler kế thừa AbstractCrawler
- **Given** `ThreadsCrawler` trong `src/scrapers/social/threads/crawler.js`
- **When** khởi tạo với `client`, `store`, `governor`, `proxyPool`
- **Then** kế thừa `AbstractCrawler` [Source: `src/core/base-crawler.js:21-63`]
- **And** `requiresAuth = false`, `name = 'threads'`, `platform = 'threads'`
- **And** đăng ký `search`, `get_user_feed`, `get_post_comments` trong `ActionRegistry` [Source: `src/core/base-crawler.js:72-115`]
- **And** `listActions()` trả về `ActionDescriptor[]` đúng shape AD-11 với `requiredArgs`, `optionalArgs`, `outputType`, `example`

### AC-4: get_user_feed(username)
- **Given** username hợp lệ (không có `@`)
- **When** gọi `crawler.start({ action: 'get_user_feed', args: { username, count, cursor }, session })`
- **Then** crawler resolve `userID` numeric từ `https://www.threads.net/@<username>` HTML (regex `"user_id":"(\d+)"` hoặc SSR `userData.user.pk/id`) [Source: `yinyajiang/go-threads:149-163`]
- **And** gọi GraphQL `BarcelonaProfileThreadsTabQuery` với `doc_id` mặc định `6232751443445612` [Source: `go-threads endpoints.go:19-24`, `m1guelpf/threads-re`]
- **And** variables `{"userID":"<numeric_id>"}` (hoặc kèm `first`, `after` nếu phân trang được xác nhận qua capture)
- **And** trích xuất `data.mediaData.threads[]` hoặc SSR `mediaData.edges[].node.thread_items[].post` [Source: `go-threads/graphql.go:86-130`, `go-threads/parsers.go`]
- **And** chuẩn hóa thành `PostItem[]` với `id: 'threads:${post.pk}'`, `platform: 'threads'`, `category: 'social'` [Source: `src/core/types.js:8-28`]
- **And** tự động lưu vào `PrismaStore` qua `this.store.storeBatch(posts, { upsert: true })` nếu `store` được cấp [Source: `src/store/prisma-store.js:180-228`]

### AC-5: search(query)
- **Given** từ khóa `query`
- **When** gọi `crawler.start({ action: 'search', args: { query, count, cursor, searchType }, session })`
- **Then** ưu tiên GraphQL search-post với `doc_id` được cấu hình trong `DEFAULT_THREADS_DOC_IDS.SEARCH_POSTS` (nếu dev đã capture từ network)
- **And** fallback SSR nếu doc_id chưa có: fetch `https://www.threads.net/search?q=<query>&serp_type=default`, parse pre-rendered `mediaData.threads[]` hoặc DOM article list [Source: `src/scrapers/threads/index.js:261-332` legacy pattern]
- **And** trả về `PostItem[]` hợp lệ; nếu search trả về user list, có thể aggregate top user feeds nhưng phải ghi rõ trong metadata/search mode
- **And** lưu vào `PrismaStore` qua `storeBatch` nếu có store

### AC-6: get_post_comments(postId)
- **Given** post id numeric, short code, hoặc URL
- **When** gọi `crawler.start({ action: 'get_post_comments', args: { postId, maxDepth, maxComments, after }, session })`
- **Then** resolve post numeric id nếu input là short code / URL
- **And** dùng GraphQL `BarcelonaPostPageQuery` với `doc_id` mặc định `5587632691339264` (hoặc override) [Source: `m1guelpf/threads-re`, `go-threads endpoints.go:22`]
- **And** trích xuất `data.data.containing_thread` (main post) và `data.data.reply_threads[]` [Source: `junhoyeo/threads-api` types]
- **And** dùng `CommentTreeExtractor` (`src/scrapers/social/comment-tree.js:30-181`) để duyệt BFS, gán depth, detect cycle, deduplicate
- **And** chuẩn hóa thành `CommentItem[]` với `id: 'threads:${postId}:${replyPost.pk}'`, `platform: 'threads'`, `postId: 'threads:${postId}'` [Source: `src/core/types.js:31-47`]
- **And** lưu qua `this.store.storeCommentBatch(comments, { upsert: true })` nếu có store [Source: `src/store/prisma-store.js:271-298`]

### AC-7: PostItem / CommentItem normalization
- **Given** raw GraphQL nodes / SSR objects
- **When** normalize
- **Then** map đầy đủ trường theo `src/core/types.js`
- **And** `authorId`, `authorName`, `authorAvatar` từ `post.user.pk/id`, `post.user.username`, `post.user.profile_pic_url`
- **And** `content` từ `post.caption.text`
- **And** `mediaUrls` từ `image_versions2.candidates[].url` (chọn candidate lớn nhất), `video_versions[].url`, `carousel_media[].image_versions2.candidates[].url`
- **And** `likesCount` = `post.like_count`; `repliesCount` = `post.text_post_app_info.direct_reply_count` hoặc `post.comment_count`; `repostsCount` = `post.media_repost_count`; `viewsCount` = `post.play_count` (nếu có)
- **And** `publishedAt` từ `post.taken_at` (Unix timestamp)
- **And** `postUrl` ưu tiên `https://www.threads.net/@${authorUsername}/post/${post.code}`, fallback `https://www.threads.net/t/${post.code}`
- **And** `metadata` chứa `postCode`, `mediaType`, `isReply`, `carousel`, `replyControl`, `sourceMethod` để `PrismaStore` validate schema [Source: `src/core/metadata-schema-registry.js:166-275`, `src/store/prisma-store.js:198-210`]

### AC-8: Anti-Bot & Error Handling
- **Given** response bất thường (HTTP 200 kèm empty `data`, 403, 429, HTML login wall)
- **When** validator phát hiện
- **Then** `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator` [Source: `src/core/platform-validator.js:10-43`]
- **And** phân loại bot challenge (status 403, body chứa "checkpoint", "captcha", "log in", "login"), rate limit (429 / "rate limit" / "too many requests"), empty payload
- **And** throw `PlatformError` với `code: 'XACT_4290'/'XACT_4030'/'XACT_5000'` và `suggestedAction: 'rotate_proxy'/'retry_after_delay'` [Source: `src/core/error-envelope.js:48-147`]
- **And** không lưu dữ liệu rỗng / false 200 OK (AD-9)

### AC-9: Deprecation marker
- **Given** `src/scrapers/threads/index.js` legacy (Puppeteer)
- **When** triển khai xong `ThreadsCrawler`
- **Then** gắn `@deprecated` JSDoc cho các export trong `src/scrapers/threads/index.js:1-12`, `src/scrapers/threads/index.js:261-332` [Source: `src/scrapers/threads/index.js:1-396`]
- **And** cập nhật `docs/deprecation-plan.md:76-83` status tracker sang `deprecated-marked` (Phase 1)
- **And** không xoá / sửa logic legacy; chỉ thêm marker

### AC-10: Kiểm thực (No Mocks)
- **Given** test suites `tests/scrapers/social/threads/client.test.js` và `tests/scrapers/social/threads/crawler.test.js`
- **When** chạy `npm test`
- **Then** không sử dụng `vi.fn`, mock, stub, fake [Source: `AGENTS.md` Mandatory Rules]
- **And** dùng local HTTP server + `ProxyIpPool`/`StaticProxyProvider` + real `got`/`undici` để mô phỏng `www.threads.net` HTML và `/api/graphql`
- **And** `npm run typecheck` pass
- **And** regression `tests/scrapers/social/facebook/` và `tests/core/` vẫn pass

## Tasks / Subtasks

- [ ] T1: Tạo cấu trúc thư mục `src/scrapers/social/threads/` (AC-1, AC-2, AC-3)
  - [ ] T1.1: Tạo `src/scrapers/social/threads/index.js` barrel export `ThreadsClient`, `ThreadsCrawler`, `ThreadsPlatformResponseValidator`, `DEFAULT_THREADS_DOC_IDS`
  - [ ] T1.2: Tạo `src/scrapers/social/threads/client.js` — `ThreadsClient` extends `AbstractApiClient`
  - [ ] T1.3: Tạo `src/scrapers/social/threads/crawler.js` — `ThreadsCrawler` extends `AbstractCrawler`
  - [ ] T1.4: Tạo `src/scrapers/social/threads/validator.js` — `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator`
  - [ ] T1.5: Tạo `src/scrapers/social/threads/normalizer.js` (tùy chọn) — các hàm normalize post/comment cho testability
  - [ ] T1.6: Cập nhật `src/scrapers/social/index.js:1-9` để re-export Threads module
  - [ ] T1.7: Tạo `schemas/threads/social.json` metadata schema
- [ ] T2: Triển khai `ThreadsClient` (AC-1, AC-2)
  - [ ] T2.1: Constructor kế thừa `AbstractApiClient`, set `client: 'got'`, `baseUrl: 'https://www.threads.net'`, `requiresAuth: false`
  - [ ] T2.2: `ensureLsd()` fetch landing/profile page HTML, parse `LSD` token, `csrftoken`, `fb_dtsg`, cache 30 phút hoặc refill `tokenRing`
  - [ ] T2.3: `buildGraphQlBody(docId, variables, tokens)` — `URLSearchParams` với `doc_id`, `lsd`, `variables`, header `x-ig-app-id`, `x-asbd-id`, `x-fb-lsd`
  - [ ] T2.4: `requestGraphQl(docId, variables, options)` — POST, parse JSON, classify errors
- [ ] T3: Triển khai `ThreadsCrawler` (AC-3, AC-4, AC-5, AC-6)
  - [ ] T3.1: Constructor đăng ký `search`, `get_user_feed`, `get_post_comments`
  - [ ] T3.2: `getUserFeed({ username, count, cursor })` — resolve user id, call feed doc_id, normalize `PostItem[]`
  - [ ] T3.3: `search({ query, count, cursor, searchType })` — GraphQL search (if doc_id captured) or SSR fallback
  - [ ] T3.4: `getPostComments({ postId, maxDepth, maxComments, after })` — resolve post id, call post detail doc_id, wrap `CommentTreeExtractor`
  - [ ] T3.5: `normalizePost(raw)` & `normalizeComment(raw, postId)` theo `src/core/types.js`
  - [ ] T3.6: Persist `PostItem[]` qua `storeBatch`, `CommentItem[]` qua `storeCommentBatch`
- [ ] T4: Triển khai `ThreadsPlatformResponseValidator` (AC-8)
  - [ ] T4.1: Tạo `src/scrapers/social/threads/validator.js`
  - [ ] T4.2: Nhận diện valid payload, bot challenge, rate limit, empty data
- [ ] T5: Viết tests (AC-10)
  - [ ] T5.1: `tests/scrapers/social/threads/client.test.js` — local server trả HTML tokens + GraphQL JSON, test `ensureLsd`, `requestGraphQl`
  - [ ] T5.2: `tests/scrapers/social/threads/crawler.test.js` — test `get_user_feed`, `search`, `get_post_comments`, `listActions`
  - [ ] T5.3: Chạy `npm run typecheck` và `npm test -- tests/scrapers/social/threads/`
- [ ] T6: Deprecation marker & docs (AC-9)
  - [ ] T6.1: Thêm `@deprecated` JSDoc vào `src/scrapers/threads/index.js`
  - [ ] T6.2: Cập nhật `docs/deprecation-plan.md` status tracker
- [ ] T7: Chạy verification
  - [ ] T7.1: `npm run typecheck`
  - [ ] T7.2: `npm test -- tests/scrapers/social/threads/`
  - [ ] T7.3: `npm test -- tests/scrapers/social/facebook/` (regression)
  - [ ] T7.4: `npm test -- tests/core/` (regression)

## Dev Notes

### Project Structure Notes

- **Target folder mới:** `src/scrapers/social/threads/` (theo AD-8 Multi-Domain Expansion). [Source: `src/core/base-client.js:43-140`, `src/core/base-crawler.js:21-63`]
- **Legacy folder hiện tại:** `src/scrapers/threads/index.js` là Puppeteer-based scraper cũ, theo `docs/deprecation-plan.md:27-29` mapping. **KHÔNG sửa logic legacy**, chỉ thêm `@deprecated` JSDoc.
- **Conflict / variance:**
  - `epics.md` ghi `src/scrapers/social/threads/index.js` nhưng repo chưa có `src/scrapers/social/threads/`. Quyết định: tạo mới.
  - `src/scrapers/index.js:41-43` vẫn import legacy `threads`. Không xoá để tránh break `scrape('threads', ...)` cũ.
  - `src/index.js:27-30` đã export `src/scrapers/social/index.js`, do đó khi cập nhật barrel sẽ tự động expose `ThreadsCrawler` qua public API.

### Core Code State to Preserve

- `AbstractApiClient.client` mặc định là `'undici'` [Source: `src/core/base-client.js:53-54`]. `ThreadsClient` **bắt buộc** set `client: 'got'` để `got-scraping` xử lý `proxyUrl` và TLS spoofing.
- `AbstractApiClient.resolveProxy()` sử dụng `proxyPool.getStickyProxy(accountId)` khi `requiresAuth=true` [Source: `src/core/base-client.js:181-229`]. Vì `ThreadsCrawler.requiresAuth=false`, proxy sẽ dùng `getNext()`/`getRotatingProxy()` (rotating residential) — phù hợp AD-3 cho no-auth platforms.
- `AbstractApiClient.request()` không tự serialize object body khi `content-type` là `application/x-www-form-urlencoded`; truyền `body` là string `URLSearchParams(...).toString()` [Source: `src/core/base-client.js:750-761`].
- `AbstractCrawler.start()` tự động resolve `accountId`, kiểm tra `governor`, rồi gọi handler `(args, session)` [Source: `src/core/base-crawler.js:149-244`]. Vì `requiresAuth=false`, `accountId` có thể là `null`.
- `PrismaStore.storeBatch()` validate `category` và `metadata` schema trước khi ghi [Source: `src/store/prisma-store.js:180-210`]. Do đó bắt buộc tạo `schemas/threads/social.json`.
- `PrismaStore.#normalizePost()` tự động tạo `id = 'threads:${externalId}'` nếu thiếu, và `crawledAt = new Date()` [Source: `src/store/prisma-store.js:51-94`].
- `PrismaStore.#normalizeComment()` tự động tạo `id`, chuẩn hóa `postId`, gán `depth` nếu thiếu [Source: `src/store/prisma-store.js:101-163`].

### Authentication & Token Handling

- Threads public GraphQL không yêu cầu đăng nhập, nhưng bắt buộc `lsd` (CSRF token) và một số header cơ bản.
- `lsd` được embed trong HTML dạng `"LSD",[],{"token":"..."}` [Source: `go-threads lsd.go:13-32`]. Có thể fetch `/@instagram` hoặc `/@<username>`.
- `csrftoken` cookie cần được set cùng `x-csrftoken` header nếu muốn tránh "empty edges" (Apify actor ghi nhận endpoint kiểm tra cookie/header match) [Source: web research Apify actor].
- `x-ig-app-id` cố định `238260118697367`; `x-asbd-id` có thể là `359341` (go-threads) hoặc `129477` (yinyajiang). Khuyến nghị cho phép override qua constructor.
- Chiến lược token:
  1. `ThreadsClient.ensureLsd()` fetch landing page, parse `lsd`, `csrftoken`, `fb_dtsg`.
  2. Cache theo proxy/session key với TTL 30 phút hoặc refill `PreSignedTokenRing`.
  3. `buildGraphQlBody` lấy `lsd` từ ring/cache, build `URLSearchParams`.

### GraphQL doc_id Strategy

Sử dụng persisted Relay `doc_id` cho các query sau (chú ý Meta xoay đổi doc_id, cần fallback/override):

| Query | Friendly Name | Default doc_id | Variables | Response shape |
|---|---|---|---|---|
| Profile root | `BarcelonaProfileRootQuery` | `23996318473300828` | `{"userID":"<id>"}` | `data.userData.user` |
| User threads | `BarcelonaProfileThreadsTabQuery` | `6232751443445612` | `{"userID":"<id>"}` | `data.mediaData.threads[]` |
| User replies | `BarcelonaProfileRepliesTabQuery` | `6307072669391286` | `{"userID":"<id>"}` | `data.mediaData.threads[]` |
| Post detail | `BarcelonaPostPageQuery` | `5587632691339264` | `{"postID":"<id>"}` (kèm relay provider flags) | `data.data.containing_thread`, `data.data.reply_threads[]` |
| Post likers | `BarcelonaMediaLikersQuery` | `9360915773983802` | `{"mediaID":"<id>"}` | `users[]` |
| Search users | `BarcelonaSearchUserResultsQuery` | `27238810212443285` | `{"query":"...","search_surface":null,...}` | `users[]` |
| Search posts | `BarcelonaSearchPostsQuery` (unknown) | `<TO_CAPTURE_FROM_NETWORK>` | TBD | TBD |

- Nếu `doc_id` bị rotate và response trả về `errors` / empty `data`, throw `XACT_5000` `suggestedAction: 'retry_after_delay'` và log warning `⚠️ Threads doc_id may be rotated` (NFR-7).
- `get_user_feed` là action ổn định nhất vì doc_id đã được công bố rộng rãi.
- `search` và `get_post_comments` có thể cần capture doc_id mới từ browser network; spec yêu cầu dev cung cấp override qua `deps.docIds` và SSR fallback.

### Data Normalization

- `PostItem.id` = `threads:${post.pk}`.
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
  - `id` = `threads:${postId}:${replyPost.pk}` (dùng `generateCommentId('threads', postId, replyPost.pk)` [Source: `src/core/types.js:139-141`]).
  - `platform` = `'threads'`, `postId` = `'threads:${postId}'`.
  - `externalId` = `replyPost.pk`.
  - `parentCommentId` = `threads:${postId}:${parentPk}` nếu là reply; `null` nếu root.
  - `depth` do `CommentTreeExtractor` gán.
  - `authorId/authorName/authorAvatar` từ `replyPost.user`.
  - `content` = `replyPost.caption?.text`.
  - `likesCount` = `replyPost.like_count`.
  - `subCommentsCount` = `replyPost.text_post_app_info?.direct_reply_count`.
  - `publishedAt` = `new Date(Number(replyPost.taken_at) * 1000)`.

### Anti-Bot & Error Handling

- Sử dụng `ThreadsPlatformResponseValidator` extends `AbstractPlatformResponseValidator`.
- `isValidPayload`:
  - JSON object có `data.userData.user`, `data.mediaData.threads`, `data.data.containing_thread`, `data.data.reply_threads`, `data.searchResults`, hoặc `data.errors` (để client classify).
  - HTML body có `LSD`, `DTSGInitialData`, hoặc SSR JSON.
- `isBotChallenge`:
  - status 403.
  - body chứa "checkpoint", "captcha", "log in", "login", "confirm your identity".
  - JSON `errors` chứa `code` 1357004 hoặc tương tự.
- `isRateLimit`:
  - status 429.
  - body / error text chứa "rate limit", "too many requests", "action blocked", "temporarily blocked".
- Khi phát hiện challenge/rate-limit, `AbstractApiClient` pipeline tự quarantine proxy và retry theo cấu hình [Source: `src/core/base-client.js:520-721`].
- Vì `requiresAuth=false`, khi proxy fail thì `suggestedAction` nên là `rotate_proxy` thay vì `rotate_account`.

### Testing Strategy

- **No mocks, no `vi.fn`, no fake HTTP clients** [Source: `AGENTS.md`, `CLAUDE.md`].
- Cung cấp `baseUrl` trong `ThreadsClient` constructor (default `https://www.threads.net`). Tests set `baseUrl = 'http://localhost:<port>'`.
- Dùng `http.createServer` để:
  - Trả về HTML profile/search/post page chứa `LSD` token và `user_id`.
  - Trả về JSON GraphQL hợp lệ cho `/api/graphql` với `data.mediaData.threads[]` / `data.data.containing_thread` / `data.data.reply_threads[]`.
- Dùng `ProxyIpPool` hoặc `StaticProxyProvider` để kiểm tra proxy pipeline.
- `ThreadsClient` sử dụng `client = 'got'` để `got-scraping` xử lý `proxyUrl`.

### Pagination & Checkpoint

- `get_user_feed`: nếu response có `page_info` với `has_next_page` / `end_cursor`, trả về `pageInfo` và hỗ trợ `cursor` argument. Nếu không rõ, giữ `pageInfo` mặc định `{ has_next_page: false, end_cursor: null }`.
- `search`: tương tự; nếu dùng SSR fallback thì phân trang bằng scroll/cursor embedded.
- `get_post_comments`: `CommentTreeExtractor` tự quản lý BFS; mỗi layer `fetchLayer` có thể dùng `after` cursor nếu GraphQL trả `page_info`.

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 20.18.1, JSDoc + `npm run typecheck` (`tsc --noEmit`) [Source: `package.json:13-14`, `package.json:96`].
- **HTTP Client:** `got-scraping@^3.2.15` mặc định (`client: 'got'`) vì hỗ trợ `proxyUrl` string, TLS/JA4 spoofing, header generator [Source: `package.json:119`].
- **HTTP Fallback:** `undici@^7.29.0` nếu `client: 'undici'`, cần cấu hình `ProxyAgent`/`Socks5ProxyAgent` [Source: `package.json:141`].
- **Proxy:** `ProxyIpPool` từ `src/proxy/index.js`. Vì no-auth, dùng rotating/residential proxy (no sticky IP per account) [Source: AD-3].
- **Browser / Signer:** Không bắt buộc browser per request. Dùng HTTP-only fetch HTML để lấy `lsd`. Nếu cần động ký, dùng `SignerWorkerPagePool` nhưng không bắt buộc cho MVP.
- **Cookie serialization:** Tự build `Cookie` header từ `this.cookies` hoặc `options.headers.cookie` [Source: `src/core/base-client.js:767-841`].
- **Concurrency:** `p-limit@^7.2.0` nếu cần batch [Source: `package.json:128`].

## Architecture Compliance

| AD | Rule | Implementation |
|----|------|----------------|
| AD-1 | Tiered Hybrid Signer | `PreSignedTokenRing` cho `lsd`; `SignerWorkerPagePool` optional; HTTP client là transport chính. |
| AD-2 | Unified Base Interfaces | `ThreadsCrawler` extends `AbstractCrawler`; `ThreadsClient` extends `AbstractApiClient`. |
| AD-3 | Sticky IP per account | `requiresAuth=false` → sử dụng rotating/residential proxy, không sticky. Vẫn qua `ProxyIpPool`, không direct fallback. |
| AD-4 | Namespaced PostgreSQL | `PostItem.id = 'threads:${post.pk}'`; `CommentItem.id = 'threads:${postId}:${replyPk}'; lưu `category: 'social'`. |
| AD-6 | Hierarchical Comment Tree | Dùng `CommentTreeExtractor` BFS, topological sort, cycle detection; `PrismaStore.storeCommentBatch` lưu theo depth. |
| AD-8 | Multi-Domain Expansion | File mới trong `src/scrapers/social/threads/`. Legacy `src/scrapers/threads/` không đụng. |
| AD-9 | Anti-Bot Payload Validation | `ThreadsPlatformResponseValidator` kế thừa `AbstractPlatformResponseValidator`, phát hiện bot challenge/rate limit/empty payload. |
| AD-11 | ActionRegistry | Action names `search`, `get_user_feed`, `get_post_comments` (snake_case). `listActions()` trả về `ActionDescriptor`. |
| AD-12 | CrawlCheckpoint | Optional: lưu `cursor` / `lastTimestamp` khi response có `page_info.end_cursor`. |
| AD-14 | Error Envelope | Mọi lỗi trả về `PlatformError` với `code`, `type`, `suggestedAction`, `platform`. |
| AD-18 | Metadata Schema Contract | Tạo `schemas/threads/social.json` để `PrismaStore` validate metadata. |

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
| `src/scrapers/threads/index.js` | Thêm `@deprecated` JSDoc cho các export (KHÔNG sửa logic) [Source: `src/scrapers/threads/index.js:1-12`, `src/scrapers/threads/index.js:261-332`] |
| `docs/deprecation-plan.md` | Cập nhật status tracker `Threads Puppeteer` sang `deprecated-marked` [Source: `docs/deprecation-plan.md:76-83`] |
| `types/index.d.ts` | (Optional) Thêm type declarations cho `ThreadsClient`, `ThreadsCrawler` |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/scrapers/index.js` (legacy dispatcher) | Giữ backward compatibility; `scrape()` function cũ. Chỉ sửa nếu chắc chắn không break callers. |
| `src/core/base-client.js` | Đã hoàn thiện ở Story 13.1. Chỉ dùng API, không sửa logic. |
| `src/core/base-crawler.js` | Đã hoàn thiện. Chỉ kế thừa. |
| `src/core/comment-tree.js` | Đã hoàn thiện ở Story 14.1. Dùng API, không sửa logic. |
| `src/scrapers/threads/index.js` logic | Legacy; chỉ thêm `@deprecated`, không thay đổi hành vi. |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test` [Source: `package.json:50`, `package.json:161`].
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** Dùng `http.createServer` để phục vụ HTML profile/search/post + JSON GraphQL.
- **Real proxy:** Dùng `ProxyIpPool` hoặc `StaticProxyProvider` với proxy local.
- **Coverage tối thiểu:**
  - `ThreadsClient.ensureLsd()` parse đúng `lsd` từ HTML.
  - `ThreadsClient.requestGraphQl()` gửi đúng form body, headers, và doc_id.
  - `ThreadsCrawler.listActions()` trả về `ActionDescriptor[]`.
  - `ThreadsCrawler.start({ action: 'get_user_feed', ... })` trả về `PostItem[]`.
  - `ThreadsCrawler.start({ action: 'search', ... })` trả về `PostItem[]` (GraphQL hoặc SSR fallback).
  - `ThreadsCrawler.start({ action: 'get_post_comments', ... })` trả về `CommentItem[]` với đúng depth.
  - Response bot challenge / rate limit được xử lý qua validator.
  - `cleanup()` không leak.
- **Regression:** Chạy `npm run typecheck` và `npm test -- tests/core/` / `npm test -- tests/scrapers/social/facebook/` để đảm bảo không phá Facebook/comment-tree tests.

## Previous Story Intelligence

### Story 13.1 — Tiered Signer Architecture (Done)

- `AbstractApiClient` đã có `tokenRing`, `signerPool`, `request`, `requestWithSign`, `resolveProxy` [Source: `src/core/base-client.js:43-140`].
- `PreSignedTokenRing` lưu string tokens, `next()` O(1), throw `XACT_5000` khi empty [Source: `src/core/signer-pool.js:43-79`].
- `SignerWorkerPagePool` dùng Playwright/Puppeteer qua adapter, `p-limit`, drain-in-flight close [Source: `src/core/signer-pool.js:92-342`].

### Story 13.3 — Facebook Hybrid Scraper (Done)

- `FacebookClient` mẫu triển khai `ensureTokens`, `buildGraphQlBody`, `requestGraphQl` với `application/x-www-form-urlencoded` [Source: `src/scrapers/social/facebook/client.js:45-397`].
- `FacebookCrawler` đăng ký `group_posts`, `page_posts`, `get_comments`, normalize `PostItem`/`CommentItem`, lưu `PrismaStore` [Source: `src/scrapers/social/facebook/crawler.js:62-834`].
- `FacebookPlatformResponseValidator` phát hiện bot challenge, rate limit, valid payload [Source: `src/scrapers/social/facebook/validator.js:34-208`].
- Pattern `DEFAULT_FB_DOC_IDS` + `deps.docIds` override nên tái sử dụng cho `DEFAULT_THREADS_DOC_IDS`.

### Story 14.1 — Hierarchical Comment Tree (Review/Done)

- `CommentTreeExtractor` platform-agnostic BFS, depth assignment, cycle detection, topological sort [Source: `src/scrapers/social/comment-tree.js:30-181`].
- `FacebookCrawler.getCommentsForPost` đã wrap `CommentTreeExtractor` và normalize comment nodes [Source: `src/scrapers/social/facebook/crawler.js:300-560`].
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

- Threads public GraphQL endpoint `https://www.threads.net/api/graphql` dùng Relay persisted queries (`doc_id`); không cần authentication nhưng cần `lsd` token [Source: `m1guelpf/threads-re`, `go-threads`].
- `doc_id` thường xuyên bị Meta xoay; cần cơ chế capture/override [Source: `DEV Community — Scraping Threads by Meta When There's No API`].
- `x-ig-app-id: 238260118697367` là constant cho web app; `x-asbd-id` có thể thay đổi [Source: `go-threads endpoints.go:14-58`, `yinyajiang/go-threads:78-93`].
- `lsd` token lấy từ HTML `LSD",[],{"token":"..."}` hoặc `document.querySelector('input[name=lsd]')`; `csrftoken` cookie cần khớp `x-csrftoken` header để tránh empty response [Source: `go-threads lsd.go`, Apify actor docs].
- Web search UI trên `threads.net` không expose search bar, nhưng endpoint `/?q=` và GraphQL search tồn tại; cần capture hoặc SSR fallback [Source: `wisechecker.com`, Apify actors].
- `got-scraping@^3.2.15` — stable, hỗ trợ `proxyUrl` và header generator [Source: `package.json:119`].
- `undici@^7.29.0` — modern fetch, `ProxyAgent`/`Socks5ProxyAgent` dispatcher, `AbortSignal.timeout` [Source: `package.json:141`].

## Project Context Reference

- Epic 15: `_bmad-output/planning-artifacts/epics.md` — Epic 15: Vietnam Viral Social — Threads & TikTok Scraper Engine, Story 15.1 (lines 446-458).
- Architecture: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (AD-1, AD-2, AD-3, AD-4, AD-6, AD-8, AD-9, AD-11, AD-12, AD-14, AD-18).
- Deprecation plan: `docs/deprecation-plan.md` (Threads legacy mapping, status tracker).
- Core contracts:
  - `src/core/base-client.js` (`AbstractApiClient`, `request`, `requestWithSign`, `resolveProxy`)
  - `src/core/base-crawler.js` (`AbstractCrawler`, `ActionRegistry`, `start`, `listActions`)
  - `src/core/platform-validator.js` (`AbstractPlatformResponseValidator`)
  - `src/core/signer-pool.js` (`PreSignedTokenRing`, `SignerWorkerPagePool`)
  - `src/store/prisma-store.js` (`storeBatch`, `storeCommentBatch`)
  - `src/core/types.js` (`PostItem`, `CommentItem`, `generatePostId`, `generateCommentId`)
  - `src/core/metadata-schema-registry.js` (schema validation)
  - `src/scrapers/social/comment-tree.js` (`CommentTreeExtractor`)
- Legacy reference:
  - `src/scrapers/threads/index.js` (Puppeteer-based; để tránh break, chỉ thêm `@deprecated`)
- Similar done story:
  - `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md`
  - `_bmad-output/implementation-artifacts/14-1-hierarchical-comment-tree-extraction-algorithm.md`

## Open Questions / Decisions

1. **Search post doc_id:** Chưa có doc_id công khai ổn định cho keyword search posts trên `threads.net`. Dev cần capture từ browser network hoặc triển khai SSR fallback. Nếu capture được, cập nhật `DEFAULT_THREADS_DOC_IDS.SEARCH_POSTS` và bổ sung variables/response shape.
2. **Post detail / reply pagination doc_id:** `BarcelonaPostPageQuery` doc_id có thể xoay; yinyajiang repo dùng `6992290264212558`, go-threads dùng `5587632691339264`. Khuyến nghị default `5587632691339264` với `deps.docIds` override.
3. **x-asbd-id value:** Có hai giá trị `359341` (go-threads) và `129477` (yinyajiang). Cho phép override qua constructor; default `359341`.
4. **Pagination variables:** Các query `BarcelonaProfileThreadsTabQuery` và `BarcelonaPostPageQuery` có thể cần thêm `first`, `after`, `__relay_internal__pv__*` flags. Dev cần capture live request hoặc dùng SSR khi GraphQL trả thiếu pagination.
5. **Token strategy:** `lsd` nên cache trong `PreSignedTokenRing` (mỗi token là một `lsd`) hay internal `Map`? Khuyến nghị dùng `tokenRing` để kế thừa chiến lược `AbstractApiClient` và dễ rotate khi token expire.
6. **Scope of comments:** `get_post_comments` là tính năng bổ sung (story nói "bài viết, timeline và bình luận"). Nếu GraphQL reply tree không ổn định, có thể deliver `get_user_feed` + `search` trước và tách comments thành follow-up.

## Validation Report

| Check | Status | Notes |
|-------|--------|-------|
| User story + BDD acceptance criteria | Pass | Khớp `epics.md` Story 15.1. |
| Architecture compliance (AD-1..AD-18) | Pass | Đã map AD-1, AD-2, AD-3, AD-4, AD-6, AD-8, AD-9, AD-11, AD-12, AD-14, AD-18. |
| Technical requirements / stack | Pass | `got-scraping@^3.2.15`, `undici@^7.29.0`, `vitest@^4.0.18`, Node >= 20.18.1. |
| File structure (CREATE/UPDATE/NO TOUCH) | Pass | Tách rõ legacy `src/scrapers/threads/` vs mới `src/scrapers/social/threads/`. |
| Testing requirements | Pass | No mocks, local HTTP server, real proxy, typecheck. |
| Previous story intelligence | Pass | Dựa trên Story 13.3 (done), 14.1 (done). |
| Git intelligence | Updated | Đã cập nhật với 5 commit mới nhất. |
| Core code state to preserve | Pass | Kiểm tra `base-client.js:53-54` default `client='undici'`, `base-client.js:750-761` body normalization, `base-crawler.js:149-244` start flow, `prisma-store.js:198-210` schema validation. |
| UX / experience flows | N/A | Story là headless scraper; không có UI mới. |
| Security (cookie/token, no logs) | Pass | NFR-4: không log `lsd`, cookie; chỉ log warning khi doc_id rotate. |

### Fixes Applied During Validation

1. Thêm YAML frontmatter với `story_id`, `epic`, `story_key`, `status`, `created`, `updated`, `owner`, `reviewed`, `baseline_commit`.
2. Phân biệt rõ `get_user_feed` (profile feed) và `search` (keyword) vì `epics.md` AC dùng `search(query)` hoặc `getUserFeed(username)`.
3. Thêm action `get_post_comments` để cover "bình luận" trong story objective.
4. Ghi rõ `requiresAuth=false` vì Threads public GraphQL không cần login; phù hợp AD-3 no-auth rotating proxy.
5. Liệt kê known `doc_id` từ open-source repos và đánh dấu `SEARCH_POSTS` / reply pagination là cần capture từ network.

### Outstanding Items (Dev Agent Owned)

- Xác nhận / capture `doc_id` thực tế cho `search` (nếu có) hoặc triển khai SSR fallback.
- Xác nhận / capture doc_id + variables cho `BarcelonaPostPageQuery` và reply pagination.
- Quyết định giá trị `x-asbd-id` phù hợp qua test thực tế.
- Tạo `schemas/threads/social.json` metadata schema trước khi lưu `PrismaStore`.

## Dev Agent Record

### Agent Model Used

Create Story Workflow — `bmad-create-story` skill, manual analysis bằng `vibervn-context-engine` MCP và `Read` tool.

### Completion Notes

- Story 15.1 được xác định từ user input `15-1-threads-scraper-adapter-meta-internal-graphql` (Epic 15, Story 1).
- Phân tích toàn bộ epics, architecture spine, deprecation plan, code `base-client.js`, `base-crawler.js`, `signer-pool.js`, `prisma-store.js`, `types.js`, `comment-tree.js`, `src/scrapers/threads/index.js` legacy, `src/scrapers/social/facebook/` mẫu, và gần nhất git log.
- Web research về Threads GraphQL doc_id, token extraction, headers, response shapes từ `m1guelpf/threads-re`, `junhoyeo/threads-api`, `anatolykoptev/go-threads`, `yinyajiang/go-threads`, DEV Community, và Apify actors.
- Validation passed; file sẵn sàng cho `dev-story` / `bmad-dev-auto`.

### File List

- `_bmad-output/implementation-artifacts/15-1-threads-scraper-adapter-meta-internal-graphql.md`
