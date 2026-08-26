---
story_id: '13.7'
epic: 13
story_key: '13-7-facebook-hybrid-post-group-comments'
status: 'ready-for-dev'
phase: 'Phase 4'
created: '2026-08-28'
updated: '2026-08-28'
last_updated: '2026-08-28'
owner: 'DEV'
reviewed: 'Pending'
baseline_commit: 'a2d8c87b'
---

# Story 13.7: Facebook Hybrid Post & Group Comments

Status: ready-for-dev

## Story

As a **Facebook Sentiment Researcher**,  
I want **cào cây bình luận từ bài viết cá nhân/trang và bài viết trong nhóm Facebook bằng kiến trúc hybrid (HTTP GraphQL + browser bridge fallback)**,  
so that **tôi có thể phân tích sentiment và cấu trúc hội thoại với dữ liệu đầy đủ, không bị mất reply lồng nhau, và không còn phụ thuộc Puppeteer tab mới cho mỗi yêu cầu**.

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.7 [dòng 574-585]
- `_bmad-output/planning-artifacts/prd.md` — FR-70 (Topological Comment Tree Extraction) [dòng 81]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-2, AD-4, AD-6, AD-8, AD-9, AD-11, AD-14
- `_bmad-output/implementation-artifacts/14-1-hierarchical-comment-tree-extraction-algorithm.md` — `CommentTreeExtractor`, `FacebookCrawler.get_comments`, `CommentItem`, topological sort
- `src/scrapers/social/facebook/crawler.js` — `DEFAULT_FB_DOC_IDS` [dòng 191-205], `FB_COMMENT_RELAY_PROVIDERS` [dòng 211-216], constructor `get_comments` action [dòng 281-288], `getComments` wrapper [dòng 904-907], `getCommentsForPost` [dòng 918-1064], `#normalizeComment` [dòng 453-523], `#extractPostExternalId` [dòng 408-423], `#extractCommentExternalId` [dòng 531-547], `#resolvePostFeedbackContext` [dòng 637-711], `#saveCheckpoint` [dòng 1102-1158], `#clampMaxDepth` [dòng 430-434], `#clampMaxComments` [dòng 441-445]
- `src/scrapers/social/comment-tree.js` — `CommentTreeExtractor` BFS, cycle detection, topological sort [dòng 1-202]
- `src/scrapers/social/facebook/client.js` — `requestGraphQl` [dòng 435-517], `ensureTokens` [dòng 212-235], `buildGraphQlBody` [dòng 388-425]
- `src/scrapers/social/facebook/index.js` — exports [dòng 1-18]
- `src/scrapers/facebook/comments.js` — legacy `scrapeFacebookComments` [dòng 147-221], `scrapeFacebookGroupComments` [dòng 232-237], `extractCommentsFromDom` [dòng 33-93]
- `src/scrapers/facebook/normalize.js` — legacy `normalizeComment` [dòng 158-294], `stripPii` [dòng 634-638]
- `src/scrapers/facebook/core.js` — `assertFacebookUrlLocal` SSRF guard [dòng 348-367]
- `src/scrapers/facebook/index.js` — legacy re-exports [dòng 1-63]
- `src/scrapers/index.js` — `platformActionMap.facebook` [dòng 188-196]
- `src/core/base-crawler.js` — `registerAction` / `listActions` [dòng 72-115], `start` [dòng 149-243], `validateItem` [dòng 121-143]
- `src/core/types.js` — `CommentItem` typedef [dòng 31-47], `generateCommentId` [dòng 155-157]
- `src/store/prisma-store.js` — `storeCommentBatch` [dòng 271-298], `#normalizeComment` [dòng 101-163]
- `prisma/schema.prisma` — `Comment` model [dòng 361-387]
- `schemas/facebook/social.json` — metadata schema (không có schema cho comment)
- `src/core/metadata-schema-registry.js` — load/validate schema [dòng 152-303]
- `api/routes/facebook.js` — `VALID_ACTIONS` và validation `post_comments` / `group_comments` [dòng 270-356], `scrapeArgs` build [dòng 424-444]
- `api/services/facebookScrape.js` — `run` dispatch [dòng 23-56]
- `src/mcp/server.js` — `x_facebook_post_comments` tool [dòng 1629-1642], `x_facebook_group_comments` tool [dòng 1658-1671], `ACTION_MAP` [dòng 3229-3235], `executeFacebookScrapeTool` [dòng 3213-3257]
- `docs/deprecation-plan.md` — legacy mapping và status tracker
- `tests/scrapers/social/facebook/crawler-comments.test.js` — `get_comments` hybrid test scaffold
- `tests/scrapers/social/comment-tree.test.js` — `CommentTreeExtractor` tests
- `tests/scrapers/facebook-comments.test.js` / `facebook-group-comments.test.js` — legacy comment tests

## Cross-Epic Dependencies

- Depends on Story 13.3 (`FacebookClient`, `FacebookCrawler`, `DEFAULT_FB_DOC_IDS`, `PrismaStore`)
- Depends on Story 13.4 (`FacebookBrowserBridge`, CDP, token extraction)
- Depends on Story 13.5 (`resolveGroupId`, `#resolveCookies`, `#saveCheckpoint`, `profileItemToPostItem`)
- Depends on Story 13.6 (search action registration pattern, `DEFAULT_FB_DOC_IDS` placeholder strategy)
- Depends on Story 14.1 (`CommentTreeExtractor`, `get_comments` action, topological sort) — KHÔNG sửa logic lõi của 14.1, chỉ mở rộng
- Unlocks Story 13.8 (Facebook Hybrid Marketplace), Story 13.10 (Integration & Caller Migration)

## Baseline

- baseline_commit: a2d8c87b — Story 13.6 done, 14.1 `CommentTreeExtractor` + `get_comments` đã hoàn thành.
- `FacebookCrawler` đã có action `get_comments` với `getCommentsForPost` hoạt động qua GraphQL `COMMENT_ROOTS` / `COMMENT_REPLIES`.
- `CommentTreeExtractor` đã hỗ trợ BFS depth, cycle detection, dedup, topological sort.
- `PrismaStore.storeCommentBatch` đã sẵn sàng với topological insert.
- API/MCP/CLI vẫn đang route `post_comments` / `group_comments` tới legacy `scrapeFacebookComments` / `scrapeFacebookGroupComments` qua `src/scrapers/index.js`.
- `post_comments` và `group_comments` chưa được đăng ký trong `FacebookCrawler`.
- `getCommentsForPost` hiện không xử lý `after` (bị bỏ qua), không nhận `feedLocation`, không xử lý `includeReplies`, và `#normalizeComment` chưa strip PII.

## Acceptance Criteria

### AC-1: Đăng ký action `post_comments` và `group_comments`

- Given `FacebookCrawler` trong `src/scrapers/social/facebook/crawler.js`
- When khởi tạo
- Then đăng ký thêm `post_comments` và `group_comments` trong constructor
- And `post_comments` có `requiredArgs: ['url']`, `optionalArgs: ['postId', 'maxDepth', 'maxComments', 'limit', 'includeReplies', 'after']`
- And `group_comments` có `requiredArgs: ['url']`, `optionalArgs: ['postId', 'maxDepth', 'maxComments', 'limit', 'includeReplies', 'after']`
- And `listActions()` trả về cả `post_comments` và `group_comments`
- And action `get_comments` hiện tại vẫn giữ nguyên, không bị xóa (14.1 compatibility)

### AC-2: `post_comments` handler

- Given `url` là Facebook post URL, numeric post id, feedback id, hoặc share token
- When gọi `crawler.start({ action: 'post_comments', args: { url, maxDepth, maxComments, limit, includeReplies, after }, session })`
- Then `postComments(args, session)` trích xuất `postId` từ `url` hoặc `postId`, gọi `getCommentsForPost` với `feedLocation: 'POST_PERMALINK_DIALOG'`
- And trả về `{ comments: CommentItem[], pageInfo?: { has_next_page: boolean, end_cursor: string | null } }`
- And mọi comment được lưu batch qua `store.storeCommentBatch(comments, { upsert: true })` nếu store tồn tại
- And lưu checkpoint `targetType: 'post_comments'`, `targetKey: <postExternalId>`, `lastCursor: pageInfo.end_cursor`

### AC-3: `group_comments` handler

- Given `url` chứa `facebook.com/groups/...` hoặc `postId` cho group post
- When gọi `crawler.start({ action: 'group_comments', args: { url, ... }, session })`
- Then `groupComments(args, session)` từ chối URL không chứa `/groups/` hoặc không phải facebook.com
- And trích xuất `postId`, gọi `getCommentsForPost` với `feedLocation` ưu tiên cho group (mặc định `'GROUP'` hoặc placeholder; nếu GraphQL trả empty thì fallback về `'POST_PERMALINK_DIALOG'` hoặc browser bridge)
- And trả về `{ comments: CommentItem[], pageInfo }` và lưu checkpoint `targetType: 'group_comments'`

### AC-4: `includeReplies`, `limit`, `after` mapping

- Given args cho `post_comments` / `group_comments`
- When normalize
- Then `includeReplies: false` hoặc omitted (khi không có `maxDepth`) → `maxDepth = 0`, chỉ lấy root comments
- And `includeReplies: true` → `maxDepth = args.maxDepth ?? 3` (clamp [0,5])
- And `limit` được ánh xạ sang `maxComments` (clamp [1,2000]); `maxComments` vẫn được hỗ trợ như alias
- And `after` được truyền như root cursor ban đầu cho `CommentTreeExtractor` để hỗ trợ pagination

### AC-5: `CommentTreeExtractor` pagination support

- Given `CommentTreeExtractor.fetch(postId)` hiện tại
- When triển khai Story 13.7
- Then mở rộng `fetch(postId, options = {})` để chấp nhận `options.after` làm root cursor ban đầu, giữ backward-compatible với `fetch(postId)`
- And `getCommentsForPost` truyền `args.after` vào `extractor.fetch(postExternalId, { after: args.after || null })`

### AC-6: `CommentItem` normalization & PII

- Given raw GraphQL comment node
- When normalize
- Then `CommentItem.id = 'facebook:${postExternalId}:${commentExternalId}'`, `postId = 'facebook:${postExternalId}'`, `parentCommentId` namespaced nếu có
- And `depth` chính xác, `likesCount`, `subCommentsCount`, `authorId`, `authorName`, `authorAvatar`, `content`, `publishedAt`
- And `metadata` chứa `rawId`, `parentId`, `feedbackId`, `expansionToken`, `sourceMethod: 'graphql'` hoặc `'ssr'` / `'browser'`
- And `authorName` và `content` được strip phone/email theo NFR-11 trước khi trả về/lưu

### AC-7: Input validation & SSRF guard

- Given input không hợp lệ
- When gọi `post_comments` hoặc `group_comments`
- Then `url`/`postId` không được rỗng
- And `url` phải là facebook.com URL; `group_comments` phải chứa `/groups/`
- And `limit` / `maxComments` positive integer, max 2000
- And `maxDepth` trong [0,5]
- And `includeReplies` boolean nếu có
- And non-Facebook URL throw `PlatformError` `XACT_4001`

### AC-8: Fallback khi GraphQL thất bại

- Given `doc_id` comment không hợp lệ hoặc response rỗng
- When gọi `post_comments` / `group_comments`
- Then thử lại với `feedLocation` fallback hoặc `FacebookBrowserBridge` để lấy `feedbackId` từ HTML
- And nếu vẫn không có kết quả, trả về `{ comments: [], pageInfo: { has_next_page: false, end_cursor: null }, note?: string }` hoặc `PlatformError` với `suggestedAction: 'relogin'`
- And KHÔNG throw panic error

### AC-9: Deprecation markers

- Given legacy `scrapeFacebookComments`, `scrapeFacebookGroupComments` trong `src/scrapers/facebook/comments.js`
- When triển khai Story 13.7
- Then gắn JSDoc `@deprecated` với ghi chú "Replaced by `FacebookCrawler` action `post_comments` / `group_comments`"
- And cập nhật `docs/deprecation-plan.md` bảng `Legacy Facebook Functions → Hybrid Actions` thêm `scrapeFacebookComments` → `facebook:post_comments`, `scrapeFacebookGroupComments` → `facebook:group_comments`
- And status tracker cập nhật `Facebook Legacy Comments` (hoặc `src/scrapers/facebook/comments.js`) sang `deprecated-marked`

### AC-10: Test coverage

- Given repo có Vitest
- When triển khai
- Then thêm / mở rộng `tests/scrapers/social/facebook/crawler-post-group-comments.test.js` (hoặc mở rộng `crawler-comments.test.js`) với real `node:http` server
- And cover `post_comments` action, `group_comments` action, `includeReplies: false` → maxDepth=0, `limit` mapping, `after` pagination, PII stripping, non-Facebook / non-group URL rejection, topological sort, checkpoint lưu
- And chạy `npx vitest run tests/scrapers/social/facebook/` và `npx tsc --noEmit` pass

## Tasks / Subtasks

1. **Mở rộng `CommentTreeExtractor` trong `src/scrapers/social/comment-tree.js`**
   - `fetch(postId, options = {})` chấp nhận `options.after` làm root cursor ban đầu.
   - Truyền `after` vào `fetchLayerPaginated` cho root layer.

2. **Cập nhật `DEFAULT_FB_DOC_IDS` nếu cần**
   - Thêm `GROUP_COMMENT_ROOTS` và `GROUP_COMMENT_REPLIES` placeholders (có thể trỏ tới cùng `COMMENT_ROOTS`/`COMMENT_REPLIES` cho đến khi capture doc_id riêng cho group).

3. **Implement `postComments` và `groupComments` trong `src/scrapers/social/facebook/crawler.js`**
   - `postComments(args, session)`: xử lý `url`, `includeReplies`, `limit`, `after`, gọi `getCommentsForPost` với `feedLocation`.
   - `groupComments(args, session)`: validate `/groups/` URL, gọi `getCommentsForPost` với `feedLocation` group.
   - Đăng ký cả hai action trong constructor.

4. **Mở rộng `getCommentsForPost` để hỗ trợ `feedLocation` và `after`**
   - `const feedLocation = args.feedLocation || 'POST_PERMALINK_DIALOG'`.
   - Truyền `args.after` xuống `CommentTreeExtractor.fetch`.
   - Điều chỉnh `fetchLayer` dùng đúng `doc_id` và variables cho group nếu `feedLocation` là group.

5. **Cập nhật `#normalizeComment` để strip PII**
   - Thêm regex phone/email (giống legacy `stripPii`) áp dụng cho `authorName` và `content`.
   - Thêm `sourceMethod` vào metadata.

6. **Lưu checkpoint cho comments**
   - Sau khi `storeCommentBatch`, gọi `#saveCheckpoint` với `targetType: 'post_comments'` hoặc `'group_comments'`, `targetKey: postExternalId`, `lastCursor: pageInfo.end_cursor`.

7. **Đánh dấu legacy `@deprecated`**
   - `src/scrapers/facebook/comments.js`: `scrapeFacebookComments`, `scrapeFacebookGroupComments`.
   - `src/scrapers/facebook/index.js` re-export nếu cần.
   - `docs/deprecation-plan.md`: cập nhật mapping table và status tracker.

8. **Viết / mở rộng tests**
   - Tạo `tests/scrapers/social/facebook/crawler-post-group-comments.test.js` hoặc mở rộng `crawler-comments.test.js`.
   - Real `node:http` server, không mock.
   - Bao quát AC-1..AC-10.

9. **Chạy verification**
   - `npx vitest run tests/scrapers/social/facebook/`
   - `npx vitest run tests/scrapers/social/comment-tree.test.js`
   - `npx tsc --noEmit`

## Dev Notes

### Design Decisions

- **`post_comments` / `group_comments` là thin wrapper trên `getCommentsForPost`**: Tránh duplicate logic cây bình luận đã hoàn thiện ở 14.1. Hai action mới chỉ chuẩn hóa input (`url` thay vì `postId`, `limit` thay vì `maxComments`, `includeReplies`) và chọn `feedLocation` phù hợp.
- **Giữ `get_comments` nguyên vẹn**: 14.1 đã test và đăng ký `get_comments`. `get_comments` là power-user action với `postId`/`maxDepth` trực tiếp; `post_comments` là API-facing action với `url`/`includeReplies`/`limit`.
- **`includeReplies` default `false` cho `post_comments`/`group_comments`**: Phù hợp legacy `scrapeFacebookComments` và MCP tool description. Mapping:
  - `includeReplies === false` hoặc omitted (và không có `maxDepth`) → `maxDepth = 0`.
  - `includeReplies === true` → `maxDepth = args.maxDepth ?? 3`.
  - Nếu `maxDepth` được cung cấp, `includeReplies` được coi như `true` trừ khi `includeReplies === false`.
- **`limit` là alias cho `maxComments`**: API/MCP dùng `limit`; `getCommentsForPost` dùng `maxComments`. Wrapper ưu tiên `args.limit`, fallback `args.maxComments`, clamp [1,2000].
- **`url` là alias cho `postId`**: `getCommentsForPost` đã chấp nhận URL/feedback id/numeric, nên wrapper chỉ cần set `postId = args.url || args.postId`.
- **`after` root cursor**: `CommentTreeExtractor.fetch` cần nhận `options.after` để bắt đầu root pagination từ cursor đã lưu.
- **`feedLocation` group**: Mặc định `'GROUP'` cho `group_comments`. Nếu GraphQL trả rỗng/lỗi, thử fallback `'POST_PERMALINK_DIALOG'` (hoặc capture doc_id thực tế). `DEFAULT_FB_DOC_IDS` có thể thêm `GROUP_COMMENT_ROOTS`/`GROUP_COMMENT_REPLIES` placeholders để tách biệt nếu capture sau này cho thấy Facebook dùng doc_id khác.
- **PII stripping**: Áp dụng trong `#normalizeComment` cho `authorName` và `content` trước khi validate/store. Regex: `(\+?\d[\d\s\-().]{7,}\d)/g` cho phone, `[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g` cho email (giống legacy).

### Core Code State to Preserve

- Không xóa/sửa đổi lớn `CommentTreeExtractor` BFS/cycle/topological logic đã pass 14.1 tests.
- Không thay đổi `PrismaStore.storeCommentBatch` signature.
- Không sửa `src/scrapers/index.js` trong Story 13.7 (caller migration là Story 13.10) trừ khi thêm routing tạm cho 2 action mới là bắt buộc để test end-to-end. Nếu cần, thêm mapping tạm trong `src/scrapers/index.js` `platformActionMap.facebook` với comment giải thích `// Story 13.10 will consolidate all facebook routing`.
- Không xóa legacy `src/scrapers/facebook/comments.js`; chỉ thêm `@deprecated`.
- Giữ `FacebookClient.requestGraphQl` làm dispatcher duy nhất cho GraphQL.

### Authentication & Token Handling

- `post_comments` / `group_comments` lấy `accountId` và `cookies` từ `session` qua `#resolveCookies`.
- `FacebookClient.ensureTokens` lấy `lsd`/`fb_dtsg` từ token cache hoặc bridge.
- `buildGraphQlBody` inject `__user`, `__a`, `__comet_req`, `__spin_*`, `jazoest`, `lsd`, `fb_dtsg`.

### Comment GraphQL Dispatcher

Variables mẫu (hiện tại trong `getCommentsForPost`):

```js
{
  clientKey: null,
  expansionToken: isReply ? (context.expansionToken || null) : null,
  feedLocation: feedLocation,  // POST_PERMALINK_DIALOG hoặc GROUP
  focusCommentID: null,
  id: feedbackId,
  scale: 2,
  useDefaultActor: false,
  ...(isReply
    ? { repliesAfterCount, repliesAfterCursor, repliesBeforeCount: null, repliesBeforeCursor: null }
    : { commentsAfterCount, commentsAfterCursor, commentsBeforeCount: null, commentsBeforeCursor: null, commentsIntentToken: null, targetDialect: null }
  )
}
```

Object.assign `FB_COMMENT_RELAY_PROVIDERS` (captured 2026-08-26).

Friendly name tham khảo cho capture thêm (nếu cần):
- `CometUFICommentsListPaginationQuery` (root)
- `CometUFIReplyListPaginationQuery` (replies)
- `GroupsCometUFICommentsListPaginationQuery` (group root — chưa capture)

### Fallback Strategy

1. GraphQL `requestGraphQl` với `doc_id` tương ứng.
2. Nếu `feedbackId` thiếu hoặc GraphQL trả lỗi doc_id:
   - `getCommentsForPost` đã có SSR fallback: HTTP GET tới post URL và extract `Feedback` id từ hydration JSON (`#extractPostFeedbackIdFromHtml`).
   - Nếu vẫn thiếu, dùng `FacebookBrowserBridge` để navigate và extract `feedbackId` từ page context (best-effort; có thể implement `scrapeComments` trong bridge nếu cần).
3. Trả `note` hoặc `PlatformError` với `suggestedAction: 'relogin'` nếu private/restricted.

### URL & Post ID Resolution

- `#extractPostExternalId` hỗ trợ URL (lấy last path segment), `facebook:<id>`, numeric id.
- `#resolvePostFeedbackContext` hỗ trợ:
  1. Base64 `ZmVlZGJhY2s6` feedback id.
  2. Plain `feedback:<id>`.
  3. Numeric post id.
  4. Facebook URL/share token → HTTP GET + HTML extract.
  5. Synthetic `feedback:${input}` fallback cho test.
- `group_comments` validate thêm `url` chứa `/groups/` hoặc `postId` là group post (nếu đã biết).

### Namespaced IDs

- `CommentItem.id = 'facebook:${postExternalId}:${commentExternalId}'`.
- `CommentItem.postId = 'facebook:${postExternalId}'`.
- `parentCommentId = 'facebook:${postExternalId}:${parentExternalId}'`.
- `PrismaStore.#normalizeComment` tự động chuẩn hóa `postId` và `parentCommentId` nếu thiếu namespace.

### Technical Requirements

- ESM, JSDoc đầy đủ, `tsc --noEmit`.
- `limit`/`maxComments` mặc định 50 (legacy) hoặc 500? Quyết định: default `50` cho `post_comments`/`group_comments` để match legacy `scrapeFacebookComments`, max 2000. `get_comments` vẫn default `500`.
- `maxDepth` clamp [0,5], default 3 khi `includeReplies` true.
- Xử lý lỗi `AUTH_EXPIRED`, `RATE_LIMIT`, `INVALID_ARGS` bằng `PlatformError` + `SuggestedActions`.
- Không dùng mock/stub trong test.
- Không thêm runtime dependency mới.

### Architecture Compliance

- `FacebookCrawler extends AbstractCrawler`.
- Action registry pattern qua `registerAction`.
- `CommentTreeExtractor` platform-agnostic, topological sort.
- `CommentItem` lưu qua `PrismaStore.storeCommentBatch`.
- Namespaced IDs và schema validation nếu có schema.

### Library & Framework Requirements

Các package đã có:
- `got-scraping` / `undici` cho HTTP.
- `playwright` cho browser bridge.
- `p-limit` trong `CommentTreeExtractor`.
- `vitest` cho tests.
- `@prisma/client`, `prisma` cho storage.

### File Structure Requirements

```text
src/scrapers/social/
  comment-tree.js            ← mở rộng fetch(..., { after })
  facebook/
    crawler.js               ← thêm post_comments/group_comments handlers, update getCommentsForPost
    client.js                ← không thay đổi (trừ khi thêm helper cần thiết)
    index.js                 ← export nếu thêm helper mới

src/scrapers/facebook/
  comments.js                ← @deprecated trên scrapeFacebookComments, scrapeFacebookGroupComments
  index.js                   ← @deprecated trên re-export nếu cần

docs/deprecation-plan.md       ← cập nhật mapping và status
tests/scrapers/social/facebook/crawler-post-group-comments.test.js ← mới / mở rộng
```

### Testing Requirements

Tạo / mở rộng test với real `node:http` server:

- [P0] `post_comments` xuất hiện trong `listActions()`.
- [P0] `group_comments` xuất hiện trong `listActions()`.
- [P0] `post_comments` với `url` Facebook trả về `CommentItem[]` đúng namespace.
- [P0] `group_comments` với group URL trả về `CommentItem[]`.
- [P0] `includeReplies: false` chỉ trả về root comments (`depth === 0`).
- [P0] `includeReplies: true` lấy nested replies đến depth 3.
- [P0] `limit` ánh xạ sang `maxComments` và dừng đúng.
- [P0] `after` cursor root được truyền vào `CommentTreeExtractor`.
- [P0] `group_comments` reject URL không chứa `/groups/`.
- [P0] Non-Facebook URL reject SSRF.
- [P0] `PrismaStore.storeCommentBatch` được gọi và checkpoint `post_comments`/`group_comments` được lưu.
- [P1] PII stripping: comment có phone/email bị làm sạch.
- [P1] Fallback khi `feedLocation` group trả empty.
- [P1] Topological sort: root xuất hiện trước reply trong batch gửi đến store.

Lệnh kiểm thử:

```bash
npx vitest run tests/scrapers/social/facebook/crawler-post-group-comments.test.js
npx vitest run tests/scrapers/social/facebook/
npx vitest run tests/scrapers/social/comment-tree.test.js
npx tsc --noEmit
```

### Previous Story Intelligence

- Story 14.1 đã xây dựng `CommentTreeExtractor` và `FacebookCrawler.get_comments` với real HTTP test. Tận dụng toàn bộ.
- Story 13.5 cung cấp `#resolveCookies`, `#saveCheckpoint`, `resolveGroupId`, `assertFacebookUrlLocal`.
- Story 13.3/13.4 cung cấp `FacebookClient.requestGraphQl`, token cache, signer bridge.

### Project Context Reference

- `AGENTS.md` / `CLAUDE.md`: ESM, no mocks, `tsc --noEmit`, commit as `nirholas`, always push.
- `docs/deprecation-plan.md`: cập nhật khi hybrid comments hoàn thành.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: cập nhật status sang `ready-for-dev` (hoặc `in-progress` khi dev bắt đầu).

### Completion Notes

- Khi hoàn thành implementation, chuyển status file này sang `done` và cập nhật `last_updated`.
- Chạy lại `bmad-check-implementation-readiness` nếu có skill.
- Cập nhật `docs/deprecation-plan.md` sang `deprecated-marked` cho comments legacy.
