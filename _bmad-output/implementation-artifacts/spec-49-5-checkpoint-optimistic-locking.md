---
title: 'Story 49.5 — Checkpoint Optimistic Locking + P2 Sweep'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
---

## Auto Run Result

**Status:** done
**Summary:** Added optimistic locking to `resumeCheckpoint` and `pauseCheckpoint` via `updateMany` + `updatedAt` guard — concurrent mutations return 409 Conflict (XACT_4009). P2 sweep items deferred with reasons documented in deferred-work.md.

**Files changed:**
- `src/store/checkpoint-manager.js` — optimistic locking on resume/pause

**Verification:**
- `node --check` — syntax OK
- `npx vitest run tests/api/checkpoints-routes.test.js` — 12/12 pass
