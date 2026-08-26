# ATDD Red-Phase Checklist — Story 13.7

Story 13.7: Facebook Hybrid Post & Group Comments

Artifact: `_bmad-output/implementation-artifacts/13-7-facebook-hybrid-post-group-comments.md`
Baseline: `a2d8c87b`

## Red-phase test scaffolding rules

- Tất cả test viết trước khi chạm vào implementation.
- Test phải dựa trên `CommentItem`, `CommentTreeExtractor`, `FacebookCrawler`, real `node:http` server, không dùng `vi.fn`/stub/mock.
- Mỗi test phải `expect` thất bại trên baseline (màu đỏ) vì `post_comments`/`group_comments` chưa được đăng ký hoặc chưa ánh xạ đúng.
- Sau khi chạy `npx vitest run` lần đầu, thu thập danh sách test đỏ để dev-agent theo dõi.

## AC → Red test mapping

### AC-1: Actions `post_comments` và `group_comments` được đăng ký

- [x] Red test: `FacebookCrawler.listActions()` contains descriptor with `action: 'post_comments'`, `requiredArgs: ['url']`.
- [x] Red test: `FacebookCrawler.listActions()` contains descriptor with `action: 'group_comments'`, `requiredArgs: ['url']`.
- [x] Red test: `crawler.start({ action: 'post_comments' })` does not throw `Unknown action`.
- [x] Red test: `crawler.start({ action: 'group_comments' })` does not throw `Unknown action`.
- [x] Red test: `get_comments` descriptor is still present after 13.7 (regression).

### AC-2: `post_comments` handler

- [x] Red test: `post_comments` with a real local server returning GraphQL comment tree returns `comments` array of `CommentItem` with `id` matching `facebook:<postId>:<commentId>`.
- [x] Red test: `post_comments` persists comments via `store.storeCommentBatch` when store is provided.
- [x] Red test: `post_comments` returns `pageInfo.has_next_page` and `pageInfo.end_cursor`.
- [x] Red test: `post_comments` saves a checkpoint with `targetType: 'post_comments'`.

### AC-3: `group_comments` handler

- [x] Red test: `group_comments` with a `/groups/` post URL returns `CommentItem[]`.
- [x] Red test: `group_comments` rejects a non-group Facebook URL with `XACT_4001`.
- [x] Red test: `group_comments` saves a checkpoint with `targetType: 'group_comments'`.

### AC-4: `includeReplies`, `limit`, `after` mapping

- [x] Red test: `post_comments({ url, includeReplies: false })` fetches only root comments (`depth === 0`) and no reply layer calls are made.
- [x] Red test: `post_comments({ url, includeReplies: true, maxDepth: 2 })` fetches replies up to depth 2.
- [x] Red test: `post_comments({ url, limit: 10 })` maps `limit` to `maxComments` and stops at 10 root comments.
- [x] Red test: `post_comments({ url, maxComments: 20 })` is still supported.
- [x] Red test: `post_comments({ url, after: 'cursor_123' })` passes `after` to `CommentTreeExtractor` first root fetch.

### AC-5: `CommentTreeExtractor` pagination support

- [x] Red test: `CommentTreeExtractor.fetch('post_123', { after: 'cursor_123' })` starts first root call with `after`.
- [x] Red test: `CommentTreeExtractor.fetch('post_123')` (no options) remains backward-compatible and starts with null cursor.
- [x] Red test: `getCommentsForPost` passes `args.after` down to `extractor.fetch`.

### AC-6: `CommentItem` normalization & PII

- [x] Red test: returned `CommentItem.content` does not contain phone numbers or email addresses.
- [x] Red test: returned `CommentItem.authorName` does not contain phone numbers or email addresses.
- [x] Red test: `CommentItem.metadata` includes `sourceMethod`.
- [x] Red test: `CommentItem` matches `PrismaStore.#normalizeComment` output and Prisma `Comment` schema.

### AC-7: Input validation & SSRF

- [x] Red test: `post_comments({ url: '' })` throws `PlatformError` `XACT_4001`.
- [x] Red test: `post_comments({ url: 'https://evil.com/post/1' })` throws `PlatformError` `XACT_4001`.
- [x] Red test: `post_comments({ url: 'not a url' })` throws `PlatformError` `XACT_4001`.
- [x] Red test: `group_comments({ url: 'https://www.facebook.com/zuck/posts/1' })` throws `PlatformError` `XACT_4001` (no `/groups/`).
- [x] Red test: `post_comments({ url: 'https://www.facebook.com/zuck/posts/1', limit: 5000 })` clamps/throws on `limit` > 2000.

### AC-8: Fallback

- [x] Red test: when `feedbackId` cannot be resolved from a group URL, `group_comments` attempts SSR/browser fallback and returns `comments` or a controlled `PlatformError` with `suggestedAction: 'relogin'`.
- [x] Red test: no unhandled panic/throw from `post_comments` on GraphQL doc_id mismatch.

### AC-9: Deprecation

- [x] Red test: `src/scrapers/facebook/comments.js` contains `@deprecated` JSDoc on `scrapeFacebookComments` and `scrapeFacebookGroupComments`.
- [x] Red test: `docs/deprecation-plan.md` contains mapping rows `scrapeFacebookComments -> facebook:post_comments` and `scrapeFacebookGroupComments -> facebook:group_comments`.

### AC-10: Test coverage & quality

- [x] Red test suite created at `tests/scrapers/social/facebook/crawler-post-group-comments.test.js` (or extended `crawler-comments.test.js`).
- [x] All new tests fail on baseline with clear, actionable assertion messages.
- [x] `npx tsc --noEmit` may fail due to missing new action methods until implementation is added (acceptable red phase).

## Developer runbook

1. Copy baseline commit: `git -c advice.detachedHead=false checkout a2d8c87b`.
2. Create or extend test file based on this checklist.
3. Run `npx vitest run tests/scrapers/social/facebook/crawler-post-group-comments.test.js` and capture red list.
4. Run `npx tsc --noEmit` and capture type errors (expected red).
5. Hand off to implementation phase with this checklist pinned.

## Completion criteria

- [x] 100% red tests are present and fail on baseline.
- [x] Checklist linked in sprint status.
- [x] Implementation artifact 13.7 status set to `review`.
