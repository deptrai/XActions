---
story_id: "14.1"
story_key: "14-1-hierarchical-comment-tree-extraction-algorithm"
stepsCompleted: ["step-01-preflight-and-context", "step-02-generation-mode", "step-03-test-strategy", "step-04-generate-tests"]
lastStep: "step-04-generate-tests"
lastSaved: 2026-08-26T13:30:00Z
detected_stack: backend
execution_mode: sequential
tdd_phase: RED
---

# ATDD Checklist — Story 14.1: Hierarchical Comment Tree Extraction with Topological Sort

## Test Strategy

| AC | Scenario | Test Level | Priority | File |
|----|----------|------------|----------|------|
| AC-1 | `CommentTreeExtractor` BFS depth assignment | Unit / Component | P0 | `tests/scrapers/social/comment-tree.test.js` |
| AC-1 | Recursive reply collection by parent | Unit / Component | P0 | `tests/scrapers/social/comment-tree.test.js` |
| AC-3 | Topological sort by depth before persist | Unit / Component | P0 | `tests/scrapers/social/comment-tree.test.js` |
| AC-2 | Cycle detection (self-reference) | Unit / Component | P1 | `tests/scrapers/social/comment-tree.test.js` |
| AC-1 | `maxDepth` boundary | Unit / Component | P1 | `tests/scrapers/social/comment-tree.test.js` |
| AC-1 | `maxComments` boundary | Unit / Component | P1 | `tests/scrapers/social/comment-tree.test.js` |
| AC-2 | Deduplication across pagination / recursion | Unit / Component | P2 | `tests/scrapers/social/comment-tree.test.js` |
| AC-4 | `get_comments` action descriptor | Integration | P0 | `tests/scrapers/social/facebook/crawler-comments.test.js` |
| AC-4 | Root comments normalized and persisted | Integration | P0 | `tests/scrapers/social/facebook/crawler-comments.test.js` |
| AC-4 | Nested replies with correct `depth` and `parentCommentId` | Integration | P0 | `tests/scrapers/social/facebook/crawler-comments.test.js` |
| AC-1/AC-4 | `maxDepth` and `maxComments` respected for `get_comments` | Integration | P1 | `tests/scrapers/social/facebook/crawler-comments.test.js` |
| AC-4 | Empty post returns `[]` | Integration | P1 | `tests/scrapers/social/facebook/crawler-comments.test.js` |
| Edge case | Full Facebook post URL parsing | Integration | P2 | `tests/scrapers/social/facebook/crawler-comments.test.js` |

## Red-Phase Test Files

| File | Description | Status |
|------|-------------|--------|
| `tests/scrapers/social/comment-tree.test.js` | Unit/component red-phase tests for `CommentTreeExtractor` | Skipped (red) |
| `tests/scrapers/social/facebook/crawler-comments.test.js` | Integration red-phase tests for `FacebookCrawler.get_comments` | Skipped (red) |

## Stack & Framework

- **Stack:** `backend` (Node.js ESM library, no browser UI).
- **Test framework:** Vitest 4.x.
- **No mocks, no fakes:** Tests use `http.createServer`, real `FacebookClient`, real `FacebookCrawler`, `ProxyIpPool`, `AccountPool`, `SessionManager`, `AdaptiveRateGovernor`.
- **Red-phase convention:** All new tests are written as `it.skip` / `describe.skip`. They assert expected behavior and will fail once unskipped until the implementation is written.

## Fixture & Helper Needs

| Need | Status |
|------|--------|
| Local `http.createServer` for mock Facebook home + `/api/graphql` | Inlined in each test file |
| `commentDocIds` map (`COMMENT_ROOTS`, `COMMENT_REPLIES` placeholders) | Inlined in `crawler-comments.test.js` |
| `mockStore.storeCommentBatch` | Inlined in `crawler-comments.test.js` |
| `makeCommentNode` / `makeRaw` helpers | Inlined in test files |

## Important Notes for Green Phase

1. The `CommentTreeExtractor` contract used by the red-phase tests is:
   ```js
   const extractor = new CommentTreeExtractor(fetchLayer, normalizeFn, { maxDepth, maxComments });
   const comments = await extractor.fetch(postId);
   ```
   - `fetchLayer({ postId, parentCommentId, after, limit })` returns `{ comments: raw[], pageInfo: { has_next_page, end_cursor } }`.
   - `normalizeFn(raw, postId)` returns a `CommentItem`.
2. The `get_comments` red-phase tests expect `crawler.start({ action: 'get_comments', args: { postId, maxDepth, maxComments }, session: { accountId } })` to return `{ comments: CommentItem[], pageInfo }`.
3. All `CommentItem.id` values are expected to follow the `${platform}:${postExternalId}:${commentExternalId}` namespacing rule.
4. The mock GraphQL response shape in `crawler-comments.test.js` is a scaffold. The developer may need to adjust both the mock server response and the normalizer when the real Facebook GraphQL comment shape is captured.

## Next Steps

1. Implement `src/scrapers/social/comment-tree.js`.
2. Implement `FacebookCrawler.getComments` / `get_comments` action in `src/scrapers/social/facebook/crawler.js`.
3. Unskip tests one test at a time and make them pass (green phase).
4. Run `npm run typecheck` and `npx vitest run tests/scrapers/social/comment-tree.test.js tests/scrapers/social/facebook/crawler-comments.test.js`.
