---
story_id: "15.1.3"
epic: 15
story_key: "15-1-3-threads-hybrid-docid-hardening-search-comments"
status: "review"
phase: "Phase 4"
created: 2026-08-29
updated: 2026-08-29
owner: "DEV"
reviewed: "Pending"
baseline_commit: f18f6c2c
---

# Story 15.1.3: Threads Hybrid DocID Hardening for Search & Comments

Status: review

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **GraphQL First with Automatic SSR Fallback** — `searchPosts` and `getPostComments` must prioritize direct Meta GraphQL calls with persisted `doc_id`s. When a doc_id is unconfigured or returns rotation/execution errors, the crawler must gracefully degrade to HTTP SSR (`/search?q=...` or `POST_DETAIL`) without crashing or throwing premature errors.
2. **Standard Document IDs & Variables Contract** — `DEFAULT_THREADS_DOC_IDS` must define standard default keys: `SEARCH_POSTS`, `COMMENT_ROOTS`, `COMMENT_REPLIES`, and `POST_DETAIL`. All doc_ids remain overridable via constructor `deps.docIds`.
3. **Multi-layer Comment Tree Traversal** — `getPostComments` must query `COMMENT_ROOTS` for depth 0, and `COMMENT_REPLIES` for depths >= 1 with `parentCommentId` context.
4. **No Mocks Testing (AD-10)** — All test suites must use `node:http` servers and real network client pipelines (`got-scraping`). No `vi.fn`, stubs, or fake HTTP clients.
5. **Telemetry & Security (NFR-4)** — No token, cookie, or credential may be logged or echoed in error envelopes.

## Story

As a **Threads Platform Engineer**,  
I want **thay thế SSR fallback của `search` và `get_post_comments` bằng GraphQL `doc_id` ổn định**,  
So that **crawler không phụ thuộc HTML parsing dễ vỡ và đạt throughput cao hơn**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 15, Story 15.1.3, lines 813-825]

## Acceptance Criteria

### AC-1: Default DocID Configuration for Search & Comments
- **Given** `DEFAULT_THREADS_DOC_IDS` in `src/scrapers/social/threads/crawler.js`
- **When** the crawler is initialized without overrides
- **Then** `SEARCH_POSTS`, `COMMENT_ROOTS`, `COMMENT_REPLIES`, and `POST_DETAIL` are defined with candidate Meta GraphQL doc_ids
- **And** callers can override any doc_id via `deps.docIds` in `ThreadsCrawler` constructor

### AC-2: GraphQL-First Search Execution (`search` action)
- **Given** a search query keyword
- **When** calling `crawler.start({ action: 'search', args: { query, count, cursor, searchType }, session })`
- **Then** crawler dispatches GraphQL query with `docIds.SEARCH_POSTS` and variables `{ query, count, cursor, searchType }`
- **And** extracts `searchResults.threads[]` or `searchResults.edges[]`, normalizes to `PostItem[]` with `metadata.sourceMethod: 'graphql'`
- **And** extracts `pageInfo` (`has_next_page`, `end_cursor`)
- **And** if the GraphQL query fails or returns rotated doc_id error, automatically falls back to HTTP SSR search (`/search?q=...`) with `metadata.sourceMethod: 'ssr'`
- **And** saves results to `PrismaStore` and emits thin events to Redis stream `stream:social:raw_posts`

### AC-3: Multi-Layer GraphQL Comment Tree (`get_post_comments` action)
- **Given** a post ID
- **When** calling `crawler.start({ action: 'get_post_comments', args: { postId, maxDepth, maxComments, after }, session })`
- **Then** `fetchLayer` queries `docIds.COMMENT_ROOTS` for root-level comments (`parentCommentId == null`)
- **And** `fetchLayer` queries `docIds.COMMENT_REPLIES` for nested replies (`parentCommentId != null`)
- **And** unwrap nested `edge.node` wrappers, normalize into `CommentItem[]` with proper `depth` and `parentCommentId`
- **And** if `COMMENT_ROOTS` or `COMMENT_REPLIES` are missing or fail, degrades to `POST_DETAIL` (`BarcelonaPostPageQuery`) flat fallback without throwing `XACT_5000`

### AC-4: Error Handling & Graceful Degradation
- **Given** rotated doc_ids or upstream challenge responses
- **When** GraphQL request returns error
- **Then** crawler logs warning `⚠️ [THREADS] GraphQL query failed, falling back to SSR`
- **And** executes secondary fallback without data loss
- **And** throws `PlatformError` with proper `code` (`XACT_4290`, `XACT_4030`, `XACT_4041`, `XACT_5000`) only when all layers fail

### AC-5: Deprecation Plan Sync
- **Given** search and comments hardened to GraphQL first
- **When** reviewing `docs/deprecation-plan.md`
- **Then** update status tracker noting that search and comment extraction in ThreadsCrawler are fully hardened

### AC-6: Comprehensive ATDD Test Suite (No Mocks)
- **Given** `tests/scrapers/social/threads/docid-hardening.test.js`
- **When** running test suite
- **Then** local HTTP server verifies:
  1. GraphQL search execution and pagination (`pageInfo`)
  2. GraphQL search failure triggering automatic SSR fallback
  3. Two-layer GraphQL comment extraction (`COMMENT_ROOTS` and `COMMENT_REPLIES`)
  4. GraphQL comment failure triggering `POST_DETAIL` fallback
  5. Metadata source method tracking (`graphql` vs `ssr`)
- **And** `npm run typecheck` passes with 0 errors
- **And** 100% regression tests pass across `tests/scrapers/social/threads/`

## Tasks / Subtasks

- [x] T1: Update `DEFAULT_THREADS_DOC_IDS` and constructor configuration (AC-1)
- [x] T2: Harden `search` / `searchPosts` to prioritize GraphQL with automatic SSR fallback (AC-2, AC-4)
- [x] T3: Harden `get_post_comments` with multi-layer doc_ids (`COMMENT_ROOTS` and `COMMENT_REPLIES`) and fallback (AC-3, AC-4)
- [x] T4: Update `docs/deprecation-plan.md` tracker (AC-5)
- [x] T5: Create ATDD test suite `tests/scrapers/social/threads/docid-hardening.test.js` (AC-6)
- [x] T6: Run verification and typecheck

## Dev Agent Record

### Agent Model Used

Developer Agent — `bmad-dev-story` workflow.

### Implementation Notes

- Hardened `searchPosts` in `ThreadsCrawler` to prioritize GraphQL when `SEARCH_POSTS` is configured and seamlessly fallback to SSR HTTP without throwing `XACT_5000`.
- Hardened `getPostComments` with multi-layer doc_ids (`COMMENT_ROOTS` and `COMMENT_REPLIES`) with graceful degradation to flat `POST_DETAIL` fallback.
- Added comprehensive ATDD test suite in `tests/scrapers/social/threads/docid-hardening.test.js` (5/5 tests passing 100% with real HTTP server).
- Passed TypeScript strict typecheck (`tsc --noEmit`) and all 57 tests in `tests/scrapers/social/threads/`.

### File List

- `_bmad-output/implementation-artifacts/15-1-3-threads-hybrid-docid-hardening-search-comments.md` (Created)
- `_bmad-output/implementation-artifacts/atdd-checklist-15-1-3-threads-hybrid-docid-hardening-search-comments.md` (Created)
- `src/scrapers/social/threads/crawler.js` (Modified)
- `tests/scrapers/social/threads/docid-hardening.test.js` (Created)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Modified)
