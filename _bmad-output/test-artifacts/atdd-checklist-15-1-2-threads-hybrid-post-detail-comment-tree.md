---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-29'
storyId: '15.1.2'
storyKey: '15-1-2-threads-hybrid-post-detail-comment-tree'
storyFile: '_bmad-output/implementation-artifacts/15-1-2-threads-hybrid-post-detail-comment-tree.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-15-1-2-threads-hybrid-post-detail-comment-tree.md'
generatedTestFiles:
  - 'tests/scrapers/social/threads/crawler-post-detail.test.js'
inputDocuments:
  - '_bmad-output/implementation-artifacts/15-1-2-threads-hybrid-post-detail-comment-tree.md'
  - 'src/scrapers/social/threads/crawler.js'
  - 'src/scrapers/social/threads/client.js'
  - 'tests/scrapers/social/threads/crawler.test.js'
  - 'tests/scrapers/social/threads/profile.test.js'
---

# ATDD Checklist: Story 15.1.2 — Threads Hybrid Post Detail & Comment Tree

## 1. Context & Preflight Summary

- **Story ID:** 15.1.2
- **Story Key:** `15-1-2-threads-hybrid-post-detail-comment-tree`
- **Detected Stack:** Backend (Node.js / Vitest / Hybrid GraphQL & SSR Scraper)
- **Test Framework:** Vitest (`vitest run`)
- **Key Constraints:**
  - Zero mocks / stubs / fakes. Use real `http.createServer` for test responses.
  - Root post is a `PostItem` and replies are `CommentItem[]`.
  - Shared post ID / shortcode / URL resolution with reverse base64 alphabet decoding.
  - Optional `includeReplies` delegating to `get_post_comments`.
  - Graceful degradation to depth=0 when `COMMENT_REPLIES` is not configured without throwing `XACT_5000`.
  - Checkpoint and Redis Stream thin event emission (`storageRef`).
  - TypeScript strict mode compliance.

## 2. Generation Mode

- **Selected Mode:** AI Generation (Backend / Protocol & Parser scaffolding)
- **Rationale:** Stack là Node.js backend & hybrid HTTP/GraphQL scraping engine, các scenarios kiểm thử bao gồm action registration, GraphQL parsing, SSR fallback, storage adapter conversion và streaming telemetry. Không yêu cầu browser recording.

## 3. Test Strategy & Acceptance Criteria Mapping

| ID | Acceptance Criterion | Test Scenario | Level | Priority | Red Phase Status |
|---|---|---|---|---|---|
| **SCN-1** | AC-1: Action Registration | `ThreadsCrawler` registers `post_detail` in `ActionRegistry` with required `postId` and optional args | Unit / Contract | **P0** | 🔴 RED (Failing as expected) |
| **SCN-2** | AC-2 & AC-4: Post ID & Shortcode Resolution | `post_detail` resolves numeric ID, shortcode (`CuZ7X9_sF9y`), and URL (`/t/<shortcode>`) to extract root `PostItem` | Integration | **P0** | 🔴 RED (Failing as expected) |
| **SCN-3** | AC-2 & AC-6: Persistence & Thin Event | `post_detail` persists root post via `storeBatch`, saves checkpoint `post_detail`, and publishes thin event | Integration | **P0** | 🔴 RED (Failing as expected) |
| **SCN-4** | AC-3: Optional Reply Tree | `post_detail` with `includeReplies=true` returns root post + top-level replies even when `COMMENT_REPLIES=null` | Integration | **P1** | 🔴 RED (Failing as expected) |
| **SCN-5** | AC-4 / Edge: 404 & Empty Input | `post_detail` throws `XACT_4041` when post not found and `XACT_4001` on missing/empty `postId` | Integration / Negative | **P1** | 🔴 RED (Failing as expected) |

## 4. Generated Test Scaffolds

- **Test File:** `tests/scrapers/social/threads/crawler-post-detail.test.js`
- **Total Test Cases:** 7 scenarios across 5 test suites
- **Mocking Policy:** 100% Mock-free (using Node.js `http.createServer` for realistic GraphQL & SSR endpoints).
- **Verification:** Ran `npm test -- tests/scrapers/social/threads/crawler-post-detail.test.js --run` and verified 5 failing tests due to un-implemented `post_detail` action.

## 5. Next Steps for Implementation (Handoff to Dev Story)

1. Run `/bmad-dev-story 15.1.2` or proceed to implementation.
2. Register `post_detail` in `ThreadsCrawler` constructor (T1.1).
3. Implement `#shortcodeToNumericId` and `#resolvePostId` (T2).
4. Implement `getPostDetail(args, session)` replacing the stub (T1.2, T3).
5. Wire `includeReplies` fallback in `getPostDetail` (T4).
6. Verify all 7 tests in `crawler-post-detail.test.js` turn GREEN.
