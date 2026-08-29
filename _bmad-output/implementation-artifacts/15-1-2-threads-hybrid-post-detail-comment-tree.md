---
story_id: "15.1.2"
epic: 15
story_key: "15-1-2-threads-hybrid-post-detail-comment-tree"
status: "done"
phase: "Phase 4"
created: 2026-08-28
updated: 2026-08-29
owner: "DEV"
reviewed: "2026-08-29"
baseline_commit: 2c5e7e3338129261c8b34409df3e04aa63eefe3b
---

# Story 15.1.2: Threads Hybrid Post Detail & Comment Tree

Status: done

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **Build on top of Story 15.1 (done) and 15.1.1 (ready-for-dev).** `ThreadsClient` and `ThreadsCrawler` already exist in `src/scrapers/social/threads/`. This story *only* wires the missing `post_detail` action, adds a post/shortcode resolver, and reuses `get_post_comments` for the reply tree. Do not recreate the token cache, GraphQL pipeline, validator, or normalization helpers.
2. **No new Prisma models or schema migrations.** Reuse existing `Post` and `Comment` tables. The root post is a `PostItem` and replies are `CommentItem[]`, persisted exactly like `get_user_feed` and `get_post_comments` already do.
3. **`post_detail` returns one root post plus an optional comment tree.** It is a distinct action from `get_post_comments`. `post_detail` may delegate to `get_post_comments` for the reply tree when `includeReplies=true`, but it always extracts the root `PostItem` from the `BarcelonaPostPageQuery` (`POST_DETAIL`) payload first.
4. **Post ID resolution must support URL, shortcode, and numeric id.** Implement a shared `shortcodeToNumericId` decoder (reverse of the existing `numericIdToShortcode`) plus an SSR HTML fallback on `/t/<shortcode>` for shortcodes that cannot be decoded. Numeric ids pass through unchanged.
5. **`COMMENT_ROOTS` / `COMMENT_REPLIES` doc_ids are still null by default.** Until Story 15.1.3 captures verified doc_ids, `post_detail` must *not* throw `XACT_5000` when `includeReplies=true`. It clamps the effective comment depth to `0` when `COMMENT_REPLIES` is not configured, returning only the top-level replies already present in `reply_threads`.
6. **Token/cookie values never logged.** `lsd`, `csrftoken`, `fb_dtsg`, and any cookie must not appear in logs, errors, or envelopes (NFR-4).

## Story

As a **Threads Content Analyst**,  
I want **cào chi tiết một thread (nội dung + cây trả lời) bằng kiến trúc hybrid**,  
So that **tôi có thể phân tích toàn bộ conversation mà không bị mất reply lồng nhau**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 15, Story 15.1.2, lines 801-811]

## Acceptance Criteria

### AC-1: `ThreadsCrawler` registers the `post_detail` action
- **Given** `ThreadsCrawler` in `src/scrapers/social/threads/crawler.js`
- **When** the constructor runs
- **Then** it registers `post_detail` in `ActionRegistry` using snake_case alongside `get_user_feed`, `search`, and `get_post_comments`
- **And** `listActions()` returns the new `ActionDescriptor` with:
  - `requiredArgs: ['postId']`
  - `optionalArgs: ['includeReplies', 'maxDepth', 'maxComments', 'after']`
  - `outputType: '{ post: PostItem, comments?: CommentItem[], pageInfo?: any }'`
  - `example: { postId: 'CuZ7X9_sF9y', includeReplies: true, maxDepth: 3, maxComments: 100 }`
- **And** the resolved `requiresAuth` remains `true` (inherited from `ThreadsCrawler`)

### AC-2: `post_detail({ postId, includeReplies, maxDepth, maxComments, after })` extracts the root post
- **Given** a valid post id, shortcode, or URL
- **When** calling `crawler.start({ action: 'post_detail', args: { postId, includeReplies, ... }, session })`
- **Then** `getPostDetail` resolves the input to a **numeric** post id using `shortcodeToNumericId` or the `/t/<shortcode>` HTML fallback
- **And** it calls `POST_DETAIL` (`doc_id` default `5587632691339264`) via `client.requestGraphQl(...)`
- **And** it extracts the matching post from `data.data.containing_thread.thread_items[].post` first; if not found, it falls back to `data.data.reply_threads[].thread_items[].post`
- **And** it normalizes the result to `PostItem` with `id: generatePostId('threads', post.pk)`, `platform: 'threads'`, `category: 'social'`, and `metadata.sourceMethod: 'post_detail'`
- **And** it persists the root post via `this.store.storeBatch([post], { upsert: true })` if `store` is available
- **And** it writes a `CrawlCheckpoint` with `targetType: 'post_detail'`, `targetKey: <numericPostId>`, `status: 'completed'`, `storageRef: post.id`
- **And** it emits a thin event pointer to `stream:social:raw_posts` when `REDIS_STREAM_ENABLED=true`

### AC-3: `post_detail` optionally returns a `CommentItem[]` reply tree
- **Given** `includeReplies=true` in the `post_detail` call
- **When** the root post has been extracted
- **Then** the crawler delegates to the existing `getPostComments` logic for the same `postId`
- **And** it clamps `args.maxDepth` to `[0, 5]` (default `3`) and `args.maxComments` to `[1, 2000]` (default `500`)
- **And** if `this.docIds.COMMENT_REPLIES` is `null` and the requested `maxDepth > 0`, it **reduces the effective depth to `0`** and logs `⚠️ [THREADS] Nested replies deferred to Story 15.1.3; returning root-level comments only.`
- **And** it returns `comments` and `pageInfo` from `getPostComments` attached to the `post_detail` result
- **And** it does **not** throw `XACT_5000` for missing reply doc_ids when the user only asked for top-level replies

### AC-4: Post ID / shortcode / URL resolution
- **Given** `postId` can be any of:
  - a numeric id (e.g. `9988776655`)
  - a shortcode (e.g. `CuZ7X9_sF9y`)
  - a `/t/<shortcode>` URL (e.g. `https://www.threads.net/t/CuZ7X9_sF9y`)
  - a `/@<username>/post/<shortcode>` URL (e.g. `https://www.threads.net/@zuck/post/CuZ7X9_sF9y`)
  - a namespaced id (`threads:<shortcode_or_numeric>`)
- **When** resolving
- **Then** `getPostDetail` and `getPostComments` share a single `#resolvePostId(input)` helper
- **And** numeric input passes through unchanged
- **And** shortcodes are decoded to numeric ids using the reverse of the existing `SHORTCODE_ALPHABET` base64 decoder [Source: `src/scrapers/social/threads/crawler.js:32`, `src/scrapers/social/threads/crawler.js:307-317`]
- **And** when decoding fails or the input looks like a URL without a recognizable shortcode, the helper performs a `GET` to `https://www.threads.net/t/<shortcode>` (or the provided URL) and parses the embedded `application/json` `<script>` blocks for a post whose `code` matches the shortcode, returning its `pk`/`id`
- **And** if the post cannot be resolved, it throws `PlatformError { code: 'XACT_4041', type: 'not_found', suggestedAction: 'use_actions_list' }`

### AC-5: Root post extraction from `POST_DETAIL` payload
- **Given** a valid `POST_DETAIL` GraphQL response
- **When** extracting the root post
- **Then** the crawler walks `data.data.containing_thread` and `data.data.reply_threads` and returns the first post whose `pk` or `id` matches the resolved numeric post id
- **And** if the matching post is inside `containing_thread`, it is treated as the root post
- **And** if the matching post is inside `reply_threads`, it is still normalized as a `PostItem` (with `metadata.isReply: true` if the data indicates a reply)
- **And** the method `getPostDetail` replaces the current unimplemented stub that throws `XACT_5000` [Source: `src/scrapers/social/threads/crawler.js:993-1000`]
- **And** `getPostDetail` no longer returns a `getPostComments` result shape; it returns `{ post: PostItem }` plus optional `comments`/`pageInfo`

### AC-6: Reuse existing normalization, storage, checkpoint, and stream patterns
- **Given** extracted raw post and reply data
- **When** normalizing and persisting
- **Then** `#normalizePostItem` and `#normalizeCommentItem` are reused unchanged [Source: `src/scrapers/social/threads/crawler.js:324-461`]
- **And** `PostItem`/`CommentItem` ids are namespaced via `generatePostId`/`generateCommentId` [Source: `src/core/types.js:190-202`]
- **And** comments are saved via `this.store.storeCommentBatch(comments, { upsert: true })` and topologically sorted by `PrismaStore.storeCommentBatch` by depth [Source: `src/store/prisma-store.js:277-304`]
- **And** thin events are emitted via the existing `#emitCheckpointAndStream` pattern [Source: `src/scrapers/social/threads/crawler.js:119-154`]

### AC-7: Deprecation markers for legacy Threads post scraper
- **Given** the new hybrid `post_detail` action is implemented
- **When** inspecting `src/scrapers/threads/index.js`
- **Then** `scrapeTweets` already carries a `@deprecated` JSDoc marker (added in Story 15.1)
- **And** `docs/deprecation-plan.md` status tracker is updated to add or clarify a row for `Threads Puppeteer scrapeTweets / thread-post detail` as `deprecated-marked` (or update the existing `Threads Puppeteer` row to note `post_detail` is now in `ThreadsCrawler`)
- **And** no logic in the legacy file is modified

### AC-8: Kiểm thực (No Mocks)
- **Given** tests in `tests/scrapers/social/threads/crawler-post-detail.test.js`
- **When** running `npm test`
- **Then** no `vi.fn`, mocks, stubs, or fakes are used
- **And** a local `http.createServer` serves Threads-like HTML and GraphQL JSON for `POST_DETAIL`, `/t/<shortcode>`, and `/@<username>/post/<shortcode>`
- **And** `post_detail` returns the correct `PostItem` for numeric, shortcode, and URL inputs
- **And** `post_detail` with `includeReplies=true` returns `CommentItem[]` and a `pageInfo` object
- **And** `post_detail` with `COMMENT_REPLIES=null` and `maxDepth>0` falls back to root-level comments and logs a warning instead of throwing
- **And** `npm run typecheck` passes
- **And** regression `tests/scrapers/social/threads/` and `tests/scrapers/social/facebook/` pass

## Tasks / Subtasks

- [x] T1: Add `post_detail` to `ActionRegistry` and scaffold `getPostDetail`
  - [x] T1.1: Register `post_detail` action in `ThreadsCrawler` constructor [Source: `src/scrapers/social/threads/crawler.js:76-108`]
  - [x] T1.2: Replace unimplemented `getPostDetail(_args)` stub with working `getPostDetail(args, session)` [Source: `src/scrapers/social/threads/crawler.js:993-1000`]
  - [x] T1.3: Keep `getComments(_args)` throwing `XACT_5000` or optionally map it to `get_post_comments`
- [x] T2: Implement shared post ID resolution
  - [x] T2.1: Add `#shortcodeToNumericId(shortcode)` (base64 reverse decoder) using `SHORTCODE_ALPHABET`
  - [x] T2.2: Add `#resolvePostId(input, accountId)` that tries shortcode decode → numeric → SSR HTML fallback
  - [x] T2.3: Reuse `#resolvePostId` in `getPostDetail` and `getPostComments`
  - [x] T2.4: Parse `/t/<shortcode>` and `/@<user>/post/<shortcode>` HTML for `window.__sharedData`, `window.__INITIAL_STATE__`, and `<script type="application/json">` blocks containing the matching `code`/`pk`
- [x] T3: Implement root post extraction from `POST_DETAIL`
  - [x] T3.1: Call `client.requestGraphQl(POST_DETAIL, { postID: numericId }, { accountId })`
  - [x] T3.2: Walk `data.data.containing_thread` and `data.data.reply_threads` to find the post matching `numericId`
  - [x] T3.3: Normalize with `#normalizePostItem`, set `metadata.sourceMethod: 'post_detail'`
  - [x] T3.4: Persist via `storeBatch`, write `CrawlCheckpoint`, emit thin event
- [x] T4: Wire optional `includeReplies` to `get_post_comments`
  - [x] T4.1: When `args.includeReplies`, call `this.getPostComments(args, session)` after root post extraction
  - [x] T4.2: Clamp `maxDepth`/`maxComments` in `getPostComments` (already done) [Source: `src/scrapers/social/threads/crawler.js:838-839`]
  - [x] T4.3: When `COMMENT_REPLIES` is `null` and `maxDepth > 0`, override `args.maxDepth = 0` and log a warning
  - [x] T4.4: Return `{ post, comments, pageInfo }`
- [x] T5: Update `schemas/threads/social.json` (if needed)
  - [x] T5.1: Add `postDetail: boolean` or reuse `sourceMethod: 'post_detail'` (no schema change required; use existing `sourceMethod`)
- [x] T6: Update `docs/deprecation-plan.md`
  - [x] T6.1: Add/update status tracker row for Threads post/thread detail as `deprecated-marked`
- [x] T7: Write tests
  - [x] T7.1: Create `tests/scrapers/social/threads/crawler-post-detail.test.js`
  - [x] T7.2: Test numeric, shortcode, and URL postId inputs
  - [x] T7.3: Test `includeReplies=true` and `includeReplies=false`
  - [x] T7.4: Test missing `COMMENT_REPLIES` fallback to root-level comments
  - [x] T7.5: Run `npm run typecheck` and regression suites

## Dev Notes

### Project Structure Notes

- **Target files (UPDATE):** `src/scrapers/social/threads/crawler.js` (register action, implement `getPostDetail`, add `#resolvePostId`, add `#shortcodeToNumericId`), `docs/deprecation-plan.md`.
- **Target files (CREATE):** `tests/scrapers/social/threads/crawler-post-detail.test.js`.
- **No-touch files:** `src/scrapers/social/threads/client.js`, `src/scrapers/social/threads/validator.js`, `src/scrapers/social/threads/index.js` (barrel already exports `ThreadsCrawler`; no change needed), `src/core/base-client.js`, `src/core/base-crawler.js`, `src/core/comment-tree.js`, `src/store/prisma-store.js`, `src/scrapers/threads/index.js` (legacy; only markers).

### Core Code State to Preserve

- `ThreadsCrawler` constructor registers actions by calling `this.registerAction(...)`; the new `post_detail` must follow the same shape as `get_post_comments` [Source: `src/scrapers/social/threads/crawler.js:98-108`].
- `AbstractCrawler.start()` resolves `accountId`, runs `governor`, then calls the handler [Source: `src/core/base-crawler.js:151-252`]. New action inherits this automatically.
- `ThreadsClient.requestGraphQl` uses `Map`-based token cache and transport retry [Source: `src/scrapers/social/threads/client.js:652-778`].
- `getPostComments` already uses `CommentTreeExtractor`, `fetchLayer`, `p-limit(2)`, `maxDepth`/`maxComments` clamp, and a `POST_DETAIL` fallback for root comments [Source: `src/scrapers/social/threads/crawler.js:826-982`].
- `PrismaStore.storeCommentBatch` sorts by `depth` and inserts in topological order [Source: `src/store/prisma-store.js:277-304`].
- `defaultRedisStreamPublisher.publish` emits thin events and is non-blocking [Source: `src/utils/redis-stream-publisher.js:166-256`].

### Authentication & Token Handling

- Threads public GraphQL requires `lsd` token and fixed headers `x-ig-app-id: 238260118697367`, `x-asbd-id: 359341` (or override) [Source: `src/scrapers/social/threads/client.js:71-72, 601-622`].
- Guest account `threads-guest` with sticky proxy per AD-3.
- Do not log token values.

### GraphQL doc_id Strategy

| Action | Friendly Query Name | Default doc_id | Variables | Status |
|---|---|---|---|---|
| `post_detail` | `BarcelonaPostPageQuery` | `5587632691339264` | `{ "postID": "<numeric_id>" }` | Verified fallback |
| `get_post_comments` root | `BarcelonaPostPageQuery` or `COMMENT_ROOTS` | `5587632691339264` / `null` | `{ "postID": "<id>", "after", "first" }` | Fallback verified; root doc_id capture required for pagination |
| `get_post_comments` reply | (capture required) | `null` | `{ "postID": "<id>", "parentCommentId": "...", "after", "first" }` | Capture required |

- If `POST_DETAIL` doc_id is rotated and returns GraphQL errors, throw `XACT_5000` `suggestedAction: 'retry_after_delay'` and log a warning without exposing token values.

### Data Normalization

- `PostItem.id` = `generatePostId('threads', post.pk)` [Source: `src/core/types.js:190-192`].
- `CommentItem.id` = `generateCommentId('threads', postId, replyPost.pk)` [Source: `src/core/types.js:200-202`].
- `#normalizePostItem` and `#normalizeCommentItem` already handle `mediaUrls`, `taken_at`, `text_post_app_info`, etc. [Source: `src/scrapers/social/threads/crawler.js:324-461`].
- For `post_detail`, set `metadata.sourceMethod = 'post_detail'` instead of `'graphql'`.

### HTML / SSR Fallback for Shortcode Resolution

- If `#shortcodeToNumericId` fails or the input is a URL, perform a `GET` to `https://www.threads.net/t/<shortcode>`.
- Parse:
  - `window.__sharedData` or `window.__INITIAL_STATE__` if present.
  - `<script type="application/json"[^>]*>(.*?)</script>` blocks and search for a JSON object containing `code === shortcode` and a `pk`/`id` field.
  - `og:url` or `al:ios:url` for canonical post id.
- Return the first `pk` or `id` found for the matching post.
- If the page returns a login wall or no identifiable post, throw `XACT_4041`.

### Pagination, Checkpoint & Redis Thin Events

- `post_detail` is single-shot for the root post. Checkpoint `status: 'completed'`, `storageRef: post.id`.
- If `includeReplies=true`, `getPostComments` may return `pageInfo` for root-level pagination; merge it into the result.
- Thin events: after `storeBatch` and (optionally) `storeCommentBatch`, emit for each `PostItem` / `CommentItem` when `REDIS_STREAM_ENABLED=true`.

### Anti-Bot & Error Handling

- Reuse `ThreadsPlatformResponseValidator` [Source: `src/scrapers/social/threads/validator.js:1-233`].
- `AbstractApiClient.request()` throws `PlatformError` with appropriate codes; catch and route to the next fallback (shortcode → SSR HTML).
- If `includeReplies=true` and `COMMENT_REPLIES` is missing, do **not** throw; degrade to `maxDepth=0` and log.

### Testing Strategy

- **No mocks, no `vi.fn`, no fake HTTP clients** [Source: `AGENTS.md`, `CLAUDE.md`].
- Use `http.createServer` to serve:
  - `POST /api/graphql` returning `BarcelonaPostPageQuery` JSON.
  - `GET /t/<shortcode>` returning HTML with embedded JSON containing `code` and `pk`.
  - `GET /@<user>/post/<shortcode>` similarly.
- Test shortcode decoding both ways: `#numericIdToShortcode` and the new `#shortcodeToNumericId`.
- Test `post_detail` with `includeReplies=false` returns only `{ post }`.
- Test `post_detail` with `includeReplies=true` and `maxDepth=2` returns `{ post, comments, pageInfo }`.
- Test `post_detail` with `COMMENT_REPLIES=null` and `maxDepth=2` falls back to `maxDepth=0`.
- Test unknown shortcode / 404 HTML throws `XACT_4041`.

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 20.18.1, JSDoc + `npm run typecheck` [Source: `package.json:13-14, 96`].
- **HTTP Client:** `got-scraping@^3.2.15` (default `client: 'got'`) for TLS/JA4 spoofing and proxy [Source: `package.json:119`].
- **Proxy:** `ProxyIpPool.getStickyProxy(accountId)` for `requiresAuth=true` [Source: `src/core/base-client.js:181-229`].
- **Concurrency:** `p-limit@^7.2.0` already used by `CommentTreeExtractor` [Source: `package.json:128`].
- **Storage:** Reuse `PrismaStore.storeBatch` and `storeCommentBatch`.

## Architecture Compliance

| AD | Rule | Implementation |
|---|---|---|
| AD-1 | Tiered Hybrid Signer | No signer needed; reuse `ThreadsClient` `Map`-based token cache. |
| AD-2 | Unified Base Interfaces | `ThreadsCrawler` extends `AbstractCrawler`; action registered via `registerAction`. |
| AD-3 | Sticky IP per account | `requiresAuth=true`; `accountId='threads-guest'` with sticky proxy. |
| AD-4 | Namespaced PostgreSQL | `PostItem.id = 'threads:<post.pk>'`; `CommentItem.id = 'threads:<postId>:<comment.pk>'`. |
| AD-6 | Hierarchical Comment Tree | `CommentTreeExtractor` reused when `includeReplies=true`; `storeCommentBatch` sorts by `depth`. |
| AD-7 | Redis Stream Thin Events | Emit thin event pointers after `storeBatch` and `storeCommentBatch`. |
| AD-8 | Multi-Domain Expansion | New code stays in `src/scrapers/social/threads/`; legacy untouched. |
| AD-9 | Anti-Bot Payload Validation | `ThreadsPlatformResponseValidator` reused. |
| AD-11 | ActionRegistry | `post_detail` snake_case; `listActions()` shape preserved. |
| AD-12 | CrawlCheckpoint | Write checkpoint after root post extraction. |
| AD-14 | Error Envelope | `PlatformError` with `code`, `type`, `suggestedAction`, `platform`. |
| AD-18 | Metadata Schema Contract | `sourceMethod: 'post_detail'` stored in `metadata`; no new schema required. |

## Concrete `schemas/threads/social.json`

No schema change is required. `sourceMethod` already exists and accepts any string. Existing required fields remain `postCode`, `mediaType`, `sourceMethod`. If the dev wants to track `post_detail` explicitly, set `metadata.sourceMethod = 'post_detail'`.

## Library & Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| `got-scraping` | `^3.2.15` | HTTP client, TLS/JA4 spoofing, proxy [Source: `package.json:119`] |
| `p-limit` | `^7.2.0` | `CommentTreeExtractor` concurrency [Source: `package.json:128`] |
| `vitest` | `^4.0.18` | Test framework [Source: `package.json:161`] |

## File Structure Requirements

### CREATE

| File | Description |
|------|-------------|
| `tests/scrapers/social/threads/crawler-post-detail.test.js` | Tests for `post_detail` with numeric/shortcode/URL inputs and `includeReplies` |

### UPDATE

| File | Description |
|------|-------------|
| `src/scrapers/social/threads/crawler.js` | Register `post_detail`; implement `getPostDetail`; add `#resolvePostId` and `#shortcodeToNumericId`; reuse `#resolvePostId` in `getPostComments` |
| `docs/deprecation-plan.md` | Update status tracker for Threads post/thread detail as `deprecated-marked` |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/scrapers/social/threads/client.js` | Token cache / GraphQL request pipeline is stable. |
| `src/scrapers/social/threads/validator.js` | Response validator is stable. |
| `src/scrapers/social/threads/index.js` | Barrel already exports `ThreadsCrawler`. |
| `src/scrapers/threads/index.js` | Legacy; only `@deprecated` markers. |
| `src/core/base-client.js` | Stable; only consume APIs. |
| `src/core/base-crawler.js` | Stable; only register new action. |
| `src/core/comment-tree.js` | Stable; only consume `CommentTreeExtractor`. |
| `src/store/prisma-store.js` | Stable; `storeBatch` and `storeCommentBatch` already accept `PostItem`/`CommentItem`. |
| `prisma/schema.prisma` | No new model needed. |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test` [Source: `package.json:50, 161`].
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** Dùng `http.createServer` phục vụ HTML và JSON GraphQL.
- **Coverage tối thiểu:**
  - `post_detail` trả về `PostItem` với đúng `id`, `externalId`, `content`, `postUrl`, `publishedAt` từ `BarcelonaPostPageQuery`.
  - `post_detail` với `postId` là shortcode hoặc URL `/t/<shortcode>` giải mã ra đúng numeric post id.
  - `post_detail` với `includeReplies=true` trả về `{ post, comments, pageInfo }`.
  - `post_detail` với `includeReplies=true` và `COMMENT_REPLIES=null` trả về comments depth=0 và ghi log warning.
  - `get_post_comments` vẫn hoạt động như cũ (regression).
  - `listActions()` includes `post_detail`.
  - `npm run typecheck` pass.
- **Regression:** `tests/scrapers/social/threads/client.test.js`, `tests/scrapers/social/threads/crawler.test.js`, `tests/scrapers/social/threads/crawler-review.test.js`.

## Previous Story Intelligence

### Story 15.1 — Threads Scraper Adapter (Done)

- `ThreadsClient` (`src/scrapers/social/threads/client.js`) implements `ensureLsd`, `buildGraphQlBody`, `requestGraphQl`, transport retry, token cache, and error classification.
- `ThreadsCrawler` (`src/scrapers/social/threads/crawler.js`) registers `get_user_feed`, `search`, `get_post_comments`, normalizes `PostItem`/`CommentItem`, writes `CrawlCheckpoint`, and emits thin events.
- `ThreadsPlatformResponseValidator` (`src/scrapers/social/threads/validator.js`) detects bot challenges, rate limits, and valid payloads.
- `DEFAULT_THREADS_DOC_IDS` has `POST_DETAIL: '5587632691339264'`, `COMMENT_ROOTS: null`, `COMMENT_REPLIES: null` [Source: `src/scrapers/social/threads/crawler.js:23-29`].
- `getPostDetail` is currently an unimplemented stub [Source: `src/scrapers/social/threads/crawler.js:993-1000`].

### Story 15.1.1 — Threads Hybrid Profile & Followers/Following (ready-for-dev)

- Extends `ThreadsCrawler` with `profile`, `followers`, `following` actions.
- Uses `ProfileItem` → `PostItem` conversion for storage.
- Adds `schemas/threads/social.json` metadata fields for profiles (`isProfile`, `isFollower`, `isFollowing`, etc.).
- Documents public-list limitation fallback and capture-required `doc_id`s.
- Reuses `Map`-based token cache, sticky `threads-guest`, and `PrismaStore` patterns.

### Story 14.1 — Hierarchical Comment Tree (Done)

- `CommentTreeExtractor` is platform-agnostic BFS, depth assignment, cycle detection, orphan re-attachment.
- `get_post_comments` already integrates `CommentTreeExtractor` with `fetchLayer` and `normalizeFn` [Source: `src/scrapers/social/comment-tree.js:1-240`, `src/scrapers/social/threads/crawler.js:957-963`].

## Git Intelligence

Recent commits:
- `7b61ab26` `docs(story): create comprehensive 15.1.1 Threads profile/followers/following story and update sprint status` — baseline for 15.1.1.
- `2b90fffc` `fix(facebook): add SSRF guard for postId URLs in #resolvePostFeedbackContext` — URL validation pattern.
- `5f66f602` `docs(review): commit 14.3 review artifacts and diff`.
- `c77bf5ab` `merge(cli): correct admin stream alerts URL and add --token`.

Patterns:
- Commit messages follow `type(scope): description`.
- No mocks in tests.
- `base-client.js`, `base-crawler.js`, `prisma-store.js`, `comment-tree.js` are stable; avoid changes.

## Latest Tech Information

- Threads post shortcode is a base64-like encoding of the numeric post id using the alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_` [Source: `src/scrapers/social/threads/crawler.js:32`].
- The reverse decoder must map each character to its index, accumulate `value * 64 + index`, and produce the numeric id as a string (or BigInt then string).
- `POST_DETAIL` (`BarcelonaPostPageQuery`) response shape: `data.data.containing_thread.thread_items[].post` for the root, `data.data.reply_threads[].thread_items[].post` for top-level replies [Source: `src/scrapers/social/threads/crawler.js:528-555`].
- `got-scraping@^3.2.15` and `undici@^7.29.0` are the supported HTTP clients [Source: `package.json:119, 141`].

## Project Context Reference

- Epic 15: `_bmad-output/planning-artifacts/epics.md` — Epic 15: Vietnam Viral Social — Threads & TikTok Scraper Engine, Story 15.1.2 (lines 801-811).
- Previous story: `_bmad-output/implementation-artifacts/15-1-threads-scraper-adapter-meta-internal-graphql.md`.
- Previous story: `_bmad-output/implementation-artifacts/15-1-1-threads-hybrid-profile-followers-following.md`.
- Architecture: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (AD-1, AD-2, AD-3, AD-4, AD-6, AD-7, AD-8, AD-9, AD-11, AD-12, AD-14, AD-18).
- Deprecation plan: `docs/deprecation-plan.md`.
- Core contracts:
  - `src/core/types.js` (`PostItem`, `CommentItem`, `generatePostId`, `generateCommentId`).
  - `src/core/base-crawler.js` (`AbstractCrawler`, `ActionRegistry`, `start`, `listActions`).
  - `src/store/prisma-store.js` (`storeBatch`, `storeCommentBatch`, `saveCheckpoint`).
  - `src/utils/redis-stream-publisher.js` (`defaultRedisStreamPublisher`).
- Comment tree: `src/scrapers/social/comment-tree.js`.

## Senior Developer Review (AI)

- **Review Date:** 2026-08-29
- **Reviewers:** Blind Hunter, Edge Case Hunter, Acceptance Auditor
- **Outcome:** Approved (with auto-applied patches)
- **Findings Applied:**
  1. `[Security][Patch]` Added SSRF hostname guard for absolute `postId` URLs in `#resolvePostId` (`threads.net`).
  2. `[Bug][Patch]` Corrected `rawRootPost` fallback in `containing_thread` to search both `containing_thread` and `reply_threads` accurately for the target post without premature greedy assignment.
  3. `[Feature][Patch]` Forwarded session cookies to `#resolvePostId` and `getComments` for authenticated sessions.
  4. `[Reliability][Patch]` Re-threw upstream `PlatformError`s (rate limits, bot challenges, session expirations) in `#resolvePostId` instead of unconditionally masking them as 404s.

## Dev Agent Record

### Agent Model Used

Developer Agent — `bmad-dev-story` workflow on model `agy/gemini-3.7-flash-high[1m]`.

### Completion Notes

- Registered `post_detail` in `ActionRegistry` conforming to AD-11.
- Implemented `#shortcodeToNumericId` (reverse of `#numericIdToShortcode`) and `#resolvePostId` supporting numeric ID, shortcode base64 decoding, full/short URLs, and SSR HTML fallback.
- Replaced the `getPostDetail` stub with a complete implementation that extracts the root post from `POST_DETAIL` (`BarcelonaPostPageQuery`), normalizes with `#normalizePostItem`, writes checkpoints, emits thin events, and optionally attaches hierarchical comment replies when `includeReplies: true`.
- Handled graceful degradation: clamped comment depth to `0` when `COMMENT_REPLIES` is not yet configured.
- Added comprehensive no-mock test suite `tests/scrapers/social/threads/crawler-post-detail.test.js` covering numeric, shortcode, URL resolution, `includeReplies: true/false`, and error handling (5/5 tests pass).
- Verified TypeScript strict typecheck (`tsc --noEmit`) and full test suite with 0 regressions.

### File List

- `src/scrapers/social/threads/crawler.js` (Modified)
- `docs/deprecation-plan.md` (Modified)
- `tests/scrapers/social/threads/crawler-post-detail.test.js` (New)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Modified)
- `_bmad-output/implementation-artifacts/15-1-2-threads-hybrid-post-detail-comment-tree.md` (Modified)

### Change Log

- 2026-08-29: Implemented Story 15.1.2 Threads Hybrid Post Detail & Comment Tree with post_detail action, shortcode resolution, and tests.
