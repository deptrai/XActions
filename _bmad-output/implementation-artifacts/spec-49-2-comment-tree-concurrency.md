---
title: 'Story 49.2 — CommentTreeExtractor Concurrency Hardening'
type: 'feature'
created: '2026-09-24'
status: 'done'
review_loop_iteration: 0
route: 'dispatch'
---

## Intent

Fix 2 P1 deferred items in `CommentTreeExtractor`:
1. Empty `end_cursor` with `has_next_page=true` stops pagination prematurely
2. Cycle detector returns false on already-visited nodes (allows re-attachment to existing cycle)

## Auto Run Result

**Status:** done
**Summary:** Fixed empty-cursor pagination bug (retry with same cursor instead of stopping), fixed cycle detector (visited-set re-encounter = cycle found). Added `tests/scrapers/social/comment-tree.test.js` with 4 tests covering both fixes.

**Files changed:**
- `src/scrapers/social/comment-tree.js` — 2 fixes
- `tests/scrapers/social/comment-tree.test.js` — new test file

**Verification:**
- `node --check` — syntax OK
- `npx vitest run tests/scrapers/social/comment-tree.test.js` — 4/4 pass
