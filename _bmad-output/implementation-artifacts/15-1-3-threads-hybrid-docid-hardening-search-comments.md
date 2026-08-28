---
story_id: "15.1.3"
epic: 15
story_key: "15-1-3-threads-hybrid-docid-hardening-search-comments"
status: "ready-for-dev"
phase: "Phase 4"
created: 2026-08-29
updated: 2026-08-29
owner: "DEV"
reviewed: "Pending"
baseline_commit: ecef236e
---

# Story 15.1.3: Threads Hybrid DocID Hardening for Search & Comments

Status: ready-for-dev

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **Do not break Story 15.1 / 15.1.1 / 15.1.2 behavior.** `get_user_feed`, `profile`, `followers`, `following`, and `post_detail` must keep working with their existing `doc_id`s. Only `search` and `get_post_comments` are in scope for hardening.
2. **`DEFAULT_THREADS_DOC_IDS` is the single source of truth.** Update `src/scrapers/social/threads/crawler.js:30-42` with verified/candidate `SEARCH_POSTS`, `COMMENT_ROOTS`, and `COMMENT_REPLIES` values. Preserve the ability to override via `deps.docIds`.
   - Defaults are **non-null candidate/verified strings** so GraphQL path runs by default.
   - Operators can force SSR fallback at runtime by passing `deps.docIds: { SEARCH_POSTS: null, COMMENT_ROOTS: null, COMMENT_REPLIES: null }`.
3. **SSR fallbacks must remain intact but secondary.** When a hardened `doc_id` is configured, the GraphQL path is tried first. If GraphQL fails with `XACT_5000` / `XACT_4290` / `XACT_4030`, or the `doc_id` is `null`, fall back to the existing SSR HTML path already implemented in `searchPosts` and `getPostComments`.
4. **No schema or Prisma changes.** Search and comments still normalize to `PostItem[]` and `CommentItem[]` using the existing `#normalizePostItem` / `#normalizeCommentItem` helpers.
5. **Doc IDs must be captured from live Meta GraphQL traffic.** Story 15.1 and 15.1.2 left them as `null`. The capture process is:
   1. Open a real browser to `https://www.threads.net`, log in if needed (use test account).
   2. Open DevTools → Network → filter `doc_id`.
   3. Trigger the action:
      - `search`: type a query in the search box or load `https://www.threads.net/search?q=<query>`.
      - `COMMENT_ROOTS`: open a post and click "View all comments" / scroll comments.
      - `COMMENT_REPLIES`: expand a reply thread under any comment.
   4. Copy the `doc_id` and `variables` payload from the `POST /api/graphql` request.
   5. Verify the response contains the expected shape (see sections below) and save the value in `DEFAULT_THREADS_DOC_IDS` with a `verified` or `candidate` marker comment.
   - If live capture is unavailable, use documented candidate values and mark them `candidate`.
6. **Token/cookie values never logged.** `lsd`, `csrftoken`, `fb_dtsg`, and any cookie must not appear in logs, errors, or envelopes (NFR-4).

## Story

As a **Threads Platform Engineer**,  
I want **thay thế SSR fallback của `search` và `get_post_comments` bằng GraphQL `doc_id` ổn định**,  
So that **crawler không phụ thuộc HTML parsing dễ vỡ và đạt throughput cao hơn**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 15, Story 15.1.3, lines 813-824]

## Acceptance Criteria

### AC-1: `DEFAULT_THREADS_DOC_IDS` gets hardened/candidate doc_id values for search and comments
- **Given** `src/scrapers/social/threads/crawler.js`
- **When** the `DEFAULT_THREADS_DOC_IDS` map is loaded
- **Then** it contains non-null `doc_id` strings for:
  - `SEARCH_POSTS`: `BarcelonaSearchPostsQuery` (candidate/verified)
  - `COMMENT_ROOTS`: root/top-level comments query (candidate/verified)
  - `COMMENT_REPLIES`: nested reply comments query (candidate/verified)
- **And** each value is annotated with an inline comment marking it `verified` or `candidate`
- **And** `deps.docIds` overrides `DEFAULT_THREADS_DOC_IDS` in the constructor [Source: `src/scrapers/social/threads/crawler.js:84-88`]
- **And** passing `null` via `deps.docIds` (or after override) forces the SSR fallback path

### AC-2: `search(query)` prefers GraphQL when `SEARCH_POSTS` is configured
- **Given** `searchPosts(args, session)` in `src/scrapers/social/threads/crawler.js:980-1099`
- **When** `this.docIds.SEARCH_POSTS` is non-null
- **Then** it calls `client.requestGraphQl(SEARCH_POSTS, { query, first, after, serp_type }, { accountId })` first
- **And** it extracts `PostItem[]` from the GraphQL response shape:
  - `res.data.mediaData.threads[]` (thread wrappers)
  - `res.data.searchResults.edges[].node` (edge wrappers)
  - `res.data.data.searchResults.edges[].node` (nested relay envelope)
  - `res.data.data.searchResults.page_info` for pagination
- **And** it sets `post.metadata.sourceMethod = 'graphql'` for every post returned from the GraphQL path
- **And** it validates each post with `this.validateItem(post)`
- **And** it persists via `storeBatch`, emits checkpoint/stream exactly as the SSR path does
- **And** it returns `{ posts, pageInfo }` with `pageInfo.end_cursor` / `has_next_page` from `page_info` if present

### AC-3: `search` falls back to SSR only when GraphQL is unavailable or fails
- **Given** `this.docIds.SEARCH_POSTS` is `null`, or the GraphQL request throws `XACT_5000`/`XACT_4290`/`XACT_4030`
- **When** `searchPosts` runs
- **Then** it catches the `PlatformError`, logs a warning with the error `code` (never token values), and falls back to the existing SSR HTTP `GET /search?q=...` path [Source: `src/scrapers/social/threads/crawler.js:1032-1098`]
- **And** it does not double-persist or double-emit when both paths are attempted
- **And** if the SSR path also fails, it throws the last `PlatformError` with:
  - `suggestedAction: 'rotate_account'` for `XACT_4290`/`XACT_4030`
  - `suggestedAction: 'retry_after_delay'` for `XACT_5000`
  - `suggestedAction: 'use_actions_list'` for `XACT_4001`

### AC-4: `get_post_comments` prefers dedicated `COMMENT_ROOTS` and `COMMENT_REPLIES` doc_ids
- **Given** `getPostComments(args, session)` in `src/scrapers/social/threads/crawler.js:1121-1277`
- **When** fetching the root comment layer (`parentCommentId == null`)
- **Then** it follows this precedence:
  1. `this.docIds.COMMENT_ROOTS` if non-null
  2. `this.docIds.POST_DETAIL` (`5587632691339264`) and use `#extractFallbackRootComments` [Source: `src/scrapers/social/threads/crawler.js:780-853`]
  3. SSR HTML parse of the post page
- **And** when fetching a nested reply layer (`parentCommentId != null`)
- **Then** it uses `this.docIds.COMMENT_REPLIES`
- **And** if `COMMENT_REPLIES` is `null`, it clamps the remaining depth to `0`, logs a warning, and does **not** throw
- **And** it continues to clamp `maxDepth` to `[0, 5]` (default `3`) and `maxComments` to `[1, 2000]` (default `500`)

### AC-5: GraphQL comment extraction supports relay connection shape
- **Given** a dedicated `COMMENT_ROOTS` or `COMMENT_REPLIES` `doc_id`
- **When** `getPostComments` receives the GraphQL response
- **Then** it correctly unwraps the following response shapes (reuse existing `unwrapNode` helper):
  - **Root comments:**
    - `res.data.data.node.comment_rendering_instance_for_feed_location.comments.edges[].node`
    - `res.data.data.node.comments.edges[].node`
    - `res.data.data.comments.edges[].node`
    - `res.data.data.reply_threads[].thread_items[].post` (POST_DETAIL fallback)
  - **Nested replies:**
    - `res.data.data.node.replies_connection.edges[].node`
    - `res.data.data.replies_connection.edges[].node`
- **And** it passes `parentCommentId` into the raw node as `parentId` when missing [Source: `src/scrapers/social/threads/crawler.js:1240-1244`]
- **And** it returns `{ comments, pageInfo }` with pagination cursor from `connection.page_info`
- **And** `CommentTreeExtractor` receives the same raw node shape it receives today

### AC-6: `post_detail` still uses `POST_DETAIL` and optionally delegates to `get_post_comments`
- **Given** `post_detail` action in `src/scrapers/social/threads/crawler.js:1280-1420`
- **When** `includeReplies=true`
- **Then** `getPostComments` is called with the resolved numeric post id
- **And** if `COMMENT_ROOTS` and `COMMENT_REPLIES` are now configured, the full hierarchical tree is fetched via GraphQL
- **And** if either is still `null`, the existing degradation logic still applies (depth clamped to `0`, warning logged)

### AC-7: Deprecation tracker updated for search and comments hardening
- **Given** `docs/deprecation-plan.md`
- **When** this story is complete
- **Then** the `Threads Puppeteer` row is updated to note `search` and `comments` GraphQL paths are hardened
- **And** the status for `src/scrapers/threads/index.js scrapeTweets / thread-post detail` is clarified as `deprecated-marked` with `search/comments doc_id hardened in Story 15.1.3`

### AC-8: Kiểm thực (No Mocks)
- **Given** tests in `tests/scrapers/social/threads/crawler-docid-hardening.test.js`
- **When** running `npm test`
- **Then** no `vi.fn`, mocks, stubs, or fakes are used
- **And** a local `http.createServer` serves:
  - `POST /api/graphql` that routes by `doc_id` to return:
    - `BarcelonaSearchPostsQuery` payload for `SEARCH_POSTS`
    - Root comment connection for `COMMENT_ROOTS`
    - Nested reply connection for `COMMENT_REPLIES`
    - `POST_DETAIL` (`5587632691339264`) payload for fallback
  - `GET /search?q=...` returning SSR HTML (to verify fallback)
- **And** `search` returns `PostItem[]` with `metadata.sourceMethod === 'graphql'` when `SEARCH_POSTS` is configured and `sourceMethod === 'ssr'` when SSR fallback triggers
- **And** `get_post_comments` returns `CommentItem[]` with correct `depth` and `parentCommentId` when `COMMENT_ROOTS`/`COMMENT_REPLIES` are configured
- **And** SSR fallback is exercised when `SEARCH_POSTS` or `COMMENT_ROOTS`/`COMMENT_REPLIES` is `null`
- **And** GraphQL failure (invalid/rotated `doc_id`) causes a fallback to SSR for `search` and `POST_DETAIL` for `get_post_comments`
- **And** `npm run typecheck` passes
- **And** regression `tests/scrapers/social/threads/` passes

## Tasks / Subtasks

- [ ] T1: Capture and harden `SEARCH_POSTS`, `COMMENT_ROOTS`, `COMMENT_REPLIES` doc_ids
  - [ ] T1.1: Capture live doc_ids from `https://www.threads.net/api/graphql` (see Critical Constraints #5)
  - [ ] T1.2: Add candidate/verified `doc_id` values to `DEFAULT_THREADS_DOC_IDS` with `verified`/`candidate` comments [Source: `src/scrapers/social/threads/crawler.js:30-42`]
  - [ ] T1.3: Document override via `deps.docIds` and how to force SSR fallback by setting `null`
  - [ ] T1.4: Add doc_id verification script or capture notes under `_bmad-output/research/threads-docid-capture-notes.md`
- [ ] T2: Harden `searchPosts` GraphQL path
  - [ ] T2.1: Ensure GraphQL-first logic at top of `searchPosts`; keep existing SSR fallback block [Source: `src/scrapers/social/threads/crawler.js:993-1099`]
  - [ ] T2.2: Extract `PostItem[]` from `mediaData.threads[]`, `searchResults.edges[]`, and nested `data.data.searchResults.edges[]`
  - [ ] T2.3: Set `post.metadata.sourceMethod = 'graphql'` for every post from the GraphQL path
  - [ ] T2.4: Ensure `validateItem`, `storeBatch`, checkpoint, and thin event are called for GraphQL results
  - [ ] T2.5: Wrap GraphQL call in `try/catch`; on `XACT_5000`/`XACT_4290`/`XACT_4030`, log warning and fall back to SSR
  - [ ] T2.6: Preserve `sourceMethod` tagging: `graphql` for GraphQL, `ssr` for SSR
- [ ] T3: Harden `getPostComments` GraphQL path
  - [ ] T3.1: Ensure `fetchLayer` selects `COMMENT_ROOTS` → `POST_DETAIL` → SSR for root layer [Source: `src/scrapers/social/threads/crawler.js:1146-1167`]
  - [ ] T3.2: Use `COMMENT_REPLIES` for nested reply layer; if `null`, clamp remaining depth to `0` and log warning (do not throw)
  - [ ] T3.3: Add extraction for `node.comment_rendering_instance_for_feed_location.comments` and `node.replies_connection` shapes
  - [ ] T3.4: Keep `POST_DETAIL` fallback for root comments and SSR parsing as last resort
  - [ ] T3.5: Try common variable shapes when calling `COMMENT_ROOTS` / `COMMENT_REPLIES`: `postID`, `post_id`, `after`, `first`, and (for reply layer) `parentCommentId`, `parent_comment_id`, `parent_id`, `parentId`
- [ ] T4: Update `docs/deprecation-plan.md`
  - [ ] T4.1: Add note in `Threads Puppeteer` row that search and comments are hardened with GraphQL doc_ids
  - [ ] T4.2: Ensure status remains `deprecated-marked` (not `removed` — integration is Story 15.1.4)
- [ ] T5: Write tests
  - [ ] T5.1: Create `tests/scrapers/social/threads/crawler-docid-hardening.test.js`
  - [ ] T5.2: Test GraphQL `search` returns full `PostItem[]` with `metadata.sourceMethod === 'graphql'`
  - [ ] T5.3: Test GraphQL `get_post_comments` root + nested returns `CommentItem[]` with correct `depth` and `parentCommentId`
  - [ ] T5.4: Test SSR fallback triggers when `SEARCH_POSTS` / `COMMENT_ROOTS` / `COMMENT_REPLIES` is `null`
  - [ ] T5.5: Test GraphQL failure (rate limit / invalid doc_id) falls back to SSR for `search` and to `POST_DETAIL`/SSR for `get_post_comments`
  - [ ] T5.6: Test GraphQL `search` pagination returns `pageInfo.end_cursor`
  - [ ] T5.7: Test `post_detail` with `includeReplies=true` and `COMMENT_ROOTS`/`COMMENT_REPLIES` configured returns full comment tree
  - [ ] T5.8: Run `npm run typecheck` and regression suites

## Dev Notes

### ATDD Artifacts

- **Checklist:** `_bmad-output/test-artifacts/atdd-checklist-15-1-3-threads-hybrid-docid-hardening-search-comments.md` (to be created by test-architect flow)
- **Scaffold Tests:** `tests/scrapers/social/threads/crawler-docid-hardening.test.js`

### Project Structure Notes

- **Target files (UPDATE):** `src/scrapers/social/threads/crawler.js`, `docs/deprecation-plan.md`.
- **Target files (CREATE):** `tests/scrapers/social/threads/crawler-docid-hardening.test.js`, optional doc_id capture note.
- **No-touch files:** `src/scrapers/social/threads/client.js`, `src/scrapers/social/threads/validator.js`, `src/scrapers/social/threads/index.js` (barrel), `src/scrapers/social/threads/normalizer.js`, `src/scrapers/threads/index.js` (legacy), `src/core/base-client.js`, `src/core/base-crawler.js`, `src/core/comment-tree.js`, `src/store/prisma-store.js`.

### Core Code State to Preserve

- `ThreadsCrawler` constructor receives `deps.docIds` and merges with `DEFAULT_THREADS_DOC_IDS` [Source: `src/scrapers/social/threads/crawler.js:84-88`].
- `searchPosts` currently has `if (this.docIds.SEARCH_POSTS) { ... }` GraphQL block followed by SSR fallback [Source: `src/scrapers/social/threads/crawler.js:993-1099`]. This structure is already correct; this story fills in the `doc_id`s and ensures extraction handles real GraphQL payload shapes.
- `getPostComments` `fetchLayer` currently does `docId = this.docIds.COMMENT_ROOTS || this.docIds.POST_DETAIL` for root and `this.docIds.COMMENT_REPLIES` for reply [Source: `src/scrapers/social/threads/crawler.js:1146-1167`]. This logic is already correct; this story verifies it with real doc_ids and adds response-shape coverage.
- `CommentTreeExtractor` contract is unchanged: `fetchLayer({ postId, parentCommentId, after, limit })` returns `{ comments: raw[], pageInfo }` [Source: `src/scrapers/social/comment-tree.js:32-62`].
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
| `get_user_feed` | `BarcelonaProfileThreadsTabQuery` | `6232751443445612` | `{ "userID": "<id>", "first", "after" }` | Verified |
| `search` | `BarcelonaSearchPostsQuery` | `null` (capture in T1) | `{ "query": "...", "first", "after", "serp_type" }` | Harden target |
| `get_post_comments` root | (capture in T1) | `COMMENT_ROOTS` | `{ "postID": "<id>", "after", "first" }` | Harden target |
| `get_post_comments` reply | (capture in T1) | `COMMENT_REPLIES` | `{ "postID": "<id>", "parentCommentId": "...", "after", "first" }` | Harden target |

- **Status legend:**
  - `verified` — tested against live `/api/graphql` response and confirmed correct shape.
  - `candidate` — captured from network traffic but not fully validated; may rotate.
  - `fallback` — existing fallback behavior, no dedicated `doc_id`.
- If a hardened `doc_id` is rotated and returns GraphQL errors, log a warning (no token values), fall back to SSR/`POST_DETAIL` if available, and re-throw only if **all** paths fail.
- Candidate variable shapes to try when capturing:
  - `SEARCH_POSTS`: `{ query, first, after, serp_type }`
  - `COMMENT_ROOTS`: `{ postID, post_id, after, first }`
  - `COMMENT_REPLIES`: `{ postID, post_id, parentCommentId, parent_comment_id, parent_id, parentId, after, first }`
- Capture sources:
  - `SEARCH_POSTS`: capture from `https://www.threads.net/api/graphql` when typing in search box or loading `/search?q=...`.
  - `COMMENT_ROOTS`: capture when clicking "View all comments" or loading a post page root comments pagination.
  - `COMMENT_REPLIES`: capture when expanding a reply thread in the UI.

### Data Normalization

- `PostItem.id` = `generatePostId('threads', post.pk)` [Source: `src/core/types.js:190-192`].
- `CommentItem.id` = `generateCommentId('threads', postId, replyPost.pk)` [Source: `src/core/types.js:200-202`].
- `#normalizePostItem` and `#normalizeCommentItem` already handle all field mapping [Source: `src/scrapers/social/threads/crawler.js:324-461`].
- **Critical:** For search, explicitly set `post.metadata.sourceMethod = 'graphql'` after extracting from GraphQL path, and `'ssr'` after extracting from SSR path. The normalizer default is `'graphql'`, so the GraphQL path needs no change unless posts are re-normalized.
- For comments, `metadata.sourceMethod` is `'graphql'` by default from the normalizer; keep as-is.

### Search GraphQL Response Shapes

The `BarcelonaSearchPostsQuery` payload may appear as any of these shapes:

```js
res.data.mediaData.threads[]          // thread wrappers containing post objects
res.data.searchResults.edges[].node   // edge wrappers containing post
res.data.data.searchResults.edges     // nested relay envelope
res.data.searchResults.page_info      // { has_next_page, end_cursor }
res.data.mediaData.page_info          // same
```

Use `#flattenThreadItems` (already in `crawler.js`) to unwrap `thread_items[]` and extract `post` objects.

### Comment GraphQL Response Shapes

Root comments:

```js
res.data.data.node.comment_rendering_instance_for_feed_location.comments.edges[].node
res.data.data.node.comments.edges[].node
res.data.data.comments.edges[].node
res.data.data.reply_threads[].thread_items[].post   // POST_DETAIL fallback
```

Replies:

```js
res.data.data.node.replies_connection.edges[].node
res.data.data.replies_connection.edges[].node
```

The `fetchLayer` already has an `unwrapNode` helper to drill through nested `edge.node` wrappers [Source: `src/scrapers/social/threads/crawler.js:1224-1237`].

### Pagination, Checkpoint & Redis Thin Events

- `search` writes one `CrawlCheckpoint` per query with `targetType: 'search'`, `targetKey: query`, cursor from `pageInfo`.
- `get_post_comments` writes one checkpoint with `targetType: 'post_comments'`, `targetKey: rootPostId`, cursor from root-level `pageInfo`.
- Thin events are emitted for every `PostItem` and `CommentItem` after persistence when `REDIS_STREAM_ENABLED=true`.

### Anti-Bot & Error Handling

- Reuse `ThreadsPlatformResponseValidator` [Source: `src/scrapers/social/threads/validator.js:1-233`].
- `AbstractApiClient.request()` throws `PlatformError` with appropriate codes; `searchPosts` and `getPostComments` must catch these and route to SSR/`POST_DETAIL` fallback.
- GraphQL `errors` array with `code` 1675004 / 1357001 / similar indicates a rotated/invalid `doc_id` — treat as `XACT_5000` and fall back, never log token values.
- For `get_post_comments`, if `COMMENT_REPLIES` is `null`, do **not** throw `XACT_5000`; clamp depth to `0` and log warning exactly as Story 15.1.2 does.

### Testing Strategy

- **No mocks, no `vi.fn`, no fake HTTP clients** [Source: `AGENTS.md`, `CLAUDE.md`].
- Use `http.createServer` to serve:
  - `POST /api/graphql` routing by `doc_id` to return:
    - `BarcelonaSearchPostsQuery` (`SEARCH_POSTS`) with `searchResults.edges[].node` + `page_info`
    - `COMMENT_ROOTS` with `node.comment_rendering_instance_for_feed_location.comments.edges[].node` + `page_info`
    - `COMMENT_REPLIES` with `node.replies_connection.edges[].node` + `page_info`
    - `POST_DETAIL` (`5587632691339264`) with `containing_thread` + `reply_threads`
    - Invalid `doc_id` response with `errors: [{ code: 1675004, message: 'Invalid doc_id' }]`
  - `GET /search?q=...` returning SSR HTML with embedded JSON search results.
- Test that `search` with `SEARCH_POSTS` configured returns `PostItem[]` with `metadata.sourceMethod === 'graphql'` and `pageInfo` from GraphQL.
- Test that `search` with `SEARCH_POSTS: null` or invalid `doc_id` returns `PostItem[]` with `metadata.sourceMethod === 'ssr'`.
- Test that `get_post_comments` with `COMMENT_ROOTS` and `COMMENT_REPLIES` configured returns a full hierarchical `CommentItem[]` tree with correct `depth`.
- Test that `get_post_comments` with `COMMENT_REPLIES: null` clamps to depth `0` and logs a warning.
- Test that `post_detail({ includeReplies: true })` uses `COMMENT_ROOTS`/`COMMENT_REPLIES` when configured.
- Test `npm run typecheck` and full Threads regression.

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
| AD-6 | Hierarchical Comment Tree | `CommentTreeExtractor` reused when `get_post_comments` is called; `storeCommentBatch` sorts by `depth`. |
| AD-7 | Redis Stream Thin Events | Emit thin event pointers after `storeBatch` and `storeCommentBatch`. |
| AD-8 | Multi-Domain Expansion | New code stays in `src/scrapers/social/threads/`; legacy untouched. |
| AD-9 | Anti-Bot Payload Validation | `ThreadsPlatformResponseValidator` reused. |
| AD-11 | ActionRegistry | `search` and `get_post_comments` already registered in snake_case; `listActions()` shape preserved. |
| AD-12 | CrawlCheckpoint | Write checkpoint after search and comment extraction. |
| AD-14 | Error Envelope | `PlatformError` with `code`, `type`, `suggestedAction`, `platform`. |
| AD-18 | Metadata Schema Contract | `sourceMethod` tracks `'graphql'` vs `'ssr'`; no new schema required. |

## Concrete `schemas/threads/social.json`

No schema change is required. `sourceMethod` already exists and accepts any string. Existing required fields remain `postCode`, `mediaType`, `sourceMethod`.

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
| `tests/scrapers/social/threads/crawler-docid-hardening.test.js` | Tests for hardened `search` and `get_post_comments` GraphQL paths plus SSR fallback |
| `_bmad-output/research/threads-docid-capture-notes.md` (optional) | Notes on how `SEARCH_POSTS`/`COMMENT_ROOTS`/`COMMENT_REPLIES` doc_ids were captured |

### UPDATE

| File | Description |
|------|-------------|
| `src/scrapers/social/threads/crawler.js` | Update `DEFAULT_THREADS_DOC_IDS`; refine GraphQL extraction for `search` and comments |
| `docs/deprecation-plan.md` | Update Threads legacy row with search/comments hardening note |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/scrapers/social/threads/client.js` | Token cache / GraphQL request pipeline is stable. |
| `src/scrapers/social/threads/validator.js` | Response validator is stable. |
| `src/scrapers/social/threads/index.js` | Barrel already exports `ThreadsCrawler` and defaults. |
| `src/scrapers/social/threads/normalizer.js` | Profile/post/comment normalization is stable. |
| `src/scrapers/threads/index.js` | Legacy; only `@deprecated` markers. |
| `src/core/base-client.js` | Stable; only consume APIs. |
| `src/core/base-crawler.js` | Stable; actions already registered. |
| `src/core/comment-tree.js` | Stable; only consume `CommentTreeExtractor`. |
| `src/store/prisma-store.js` | Stable; `storeBatch` and `storeCommentBatch` already accept `PostItem`/`CommentItem`. |
| `prisma/schema.prisma` | No new model needed. |

## Previous Story Intelligence

### Story 15.1 — Threads Scraper Adapter (Done)

- `ThreadsClient` implements `ensureLsd`, `buildGraphQlBody`, `requestGraphQl`, transport retry, token cache, and error classification.
- `ThreadsCrawler` registers `get_user_feed`, `search`, `get_post_comments`, normalizes `PostItem`/`CommentItem`, writes `CrawlCheckpoint`, and emits thin events.
- `DEFAULT_THREADS_DOC_IDS` left `SEARCH_POSTS`, `COMMENT_ROOTS`, `COMMENT_REPLIES` as `null` pending live capture [Source: `src/scrapers/social/threads/crawler.js:39-41`].
- `searchPosts` already has a GraphQL-first / SSR-fallback structure, but no verified `doc_id` was available.
- `getPostComments` already selects `COMMENT_ROOTS`/`COMMENT_REPLIES` vs `POST_DETAIL` fallback, but no verified `doc_id` was available.

### Story 15.1.1 — Threads Hybrid Profile & Followers/Following (Done)

- Extends `ThreadsCrawler` with `profile`, `followers`, `following` actions.
- Uses `ProfileItem` → `PostItem` conversion for storage.
- Adds `schemas/threads/social.json` metadata fields for profiles.
- `docIds.PROFILE`, `FOLLOWERS`, `FOLLOWING` still contain `null` or candidate values, with override via `deps.docIds`.

### Story 15.1.2 — Threads Hybrid Post Detail & Comment Tree (Done)

- Adds `post_detail` action with shortcode/URL resolution and SSR HTML fallback.
- `getPostComments` is reused when `includeReplies=true`.
- `DEFAULT_THREADS_DOC_IDS.POST_DETAIL` is `5587632691339264` and verified as `BarcelonaPostPageQuery` fallback.
- Review follow-ups applied: SSRF guard, bounded BFS for HTML parsing, `ErrorTypes.NOT_FOUND`, `validateItem` calls, clean fallbacks.

## Git Intelligence

Recent commits:
- `ecef236e` `fix(threads): apply 15.1.2 review patches — SSRF guard, bounded BFS, NOT_FOUND type, validateItem, clean fallbacks`
- `2d2c68d2` `feat(threads): implement hybrid post_detail action and shortcode resolver (Story 15.1.2)`
- `dc710152` `feat(threads): implement Threads hybrid GraphQL scraper adapter for Story 15.1`

Patterns:
- Commit messages follow `type(scope): description`.
- No mocks in tests.
- `src/scrapers/social/threads/crawler.js` is the main file for all Threads hybrid actions.

## Latest Tech Information

- Threads uses Meta internal GraphQL with persisted `doc_id` queries (e.g., `BarcelonaPostPageQuery`, `BarcelonaSearchPostsQuery`, `BarcelonaProfileThreadsTabQuery`).
- `doc_id` values are 15-17 digit numeric strings persisted by Meta Relay. They rotate periodically and must be captured from live `/api/graphql` network traffic.
- The `lsd`, `fb_dtsg`, `x-ig-app-id`, `x-asbd-id` headers are required for public (unauthenticated) GraphQL calls.
- Response payloads are typically `application/x-www-form-urlencoded` with `data` as a JSON object containing `data` (Relay envelope), `errors` (array of GraphQL errors with `code` and `message`), and optional `extensions`.

## Project Context Reference

- Epic 15: `_bmad-output/planning-artifacts/epics.md` — Epic 15: Vietnam Viral Social — Threads & TikTok Scraper Engine, Story 15.1.3 (lines 813-824).
- Previous story: `_bmad-output/implementation-artifacts/15-1-threads-scraper-adapter-meta-internal-graphql.md`.
- Previous story: `_bmad-output/implementation-artifacts/15-1-1-threads-hybrid-profile-followers-following.md`.
- Previous story: `_bmad-output/implementation-artifacts/15-1-2-threads-hybrid-post-detail-comment-tree.md`.
- Architecture: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (AD-1, AD-2, AD-3, AD-4, AD-6, AD-7, AD-8, AD-9, AD-11, AD-12, AD-14, AD-18).
- Deprecation plan: `docs/deprecation-plan.md`.
- Core contracts:
  - `src/core/types.js` (`PostItem`, `CommentItem`, `generatePostId`, `generateCommentId`).
  - `src/core/base-crawler.js` (`AbstractCrawler`, `ActionRegistry`, `start`, `listActions`).
  - `src/store/prisma-store.js` (`storeBatch`, `storeCommentBatch`, `saveCheckpoint`).
  - `src/utils/redis-stream-publisher.js` (`defaultRedisStreamPublisher`).
- Comment tree: `src/scrapers/social/comment-tree.js`.

## Dev Agent Record

### Agent Model Used

Create Story Workflow — `bmad-create-story` skill.

### Debug Log References

### Completion Notes List

- Story file created and ready for dev.

### File List

- `_bmad-output/implementation-artifacts/15-1-3-threads-hybrid-docid-hardening-search-comments.md` (created)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (to be updated)

### Open Decisions / Outstanding Items

- None — capture methodology and candidate/verified markers are documented in Critical Constraints #5 and GraphQL doc_id Strategy sections.

### Implementation Checklist (Quick Scan)

- [ ] `DEFAULT_THREADS_DOC_IDS.SEARCH_POSTS`, `COMMENT_ROOTS`, `COMMENT_REPLIES` populated with candidate/verified values and inline status comments.
- [ ] `searchPosts` tries GraphQL first, falls back to SSR on `XACT_5000`/`XACT_4290`/`XACT_4030`, sets correct `metadata.sourceMethod`.
- [ ] `getPostComments` root layer uses `COMMENT_ROOTS` → `POST_DETAIL` → SSR; reply layer uses `COMMENT_REPLIES` or clamps to depth `0`.
- [ ] Response-shape extraction covers `searchResults.edges[].node`, `mediaData.threads[]`, `comment_rendering_instance_for_feed_location.comments.edges[].node`, `replies_connection.edges[].node`.
- [ ] Pagination variables (`postID`, `post_id`, `after`, `first`, `parentCommentId`, `parent_comment_id`, `parent_id`, `parentId`) are tried defensively.
- [ ] `docs/deprecation-plan.md` updated to note search/comments are hardened.
- [ ] Tests use `http.createServer` with `doc_id`-based routing, no mocks.
- [ ] `npm run typecheck` and full Threads regression pass.
