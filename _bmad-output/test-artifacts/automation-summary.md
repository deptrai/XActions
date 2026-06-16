---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-identify-targets', 'step-03-write-tests', 'step-04-verify-tests']
lastStep: 'step-04-execute-and-report'
lastSaved: '2026-06-16'
inputDocuments:
  - '/Users/luisphan/Documents/GitHub/XActions/_bmad/tea/config.yaml'
  - '/Users/luisphan/Documents/GitHub/XActions/.claude/worktrees/linear-stirring-reef/package.json'
  - '/Users/luisphan/Documents/GitHub/XActions/.claude/worktrees/linear-stirring-reef/tests/services/facebook-automation.test.js'
  - '/Users/luisphan/Documents/GitHub/XActions/.claude/worktrees/linear-stirring-reef/api/services/facebookAutomation.js'
  - '_bmad-output/implementation-artifacts/4-1-schedule-post.md'
  - '_bmad-output/implementation-artifacts/4-2-auto-share-post.md'
  - '_bmad-output/implementation-artifacts/4-3-view-boost.md'
  - '_bmad-output/implementation-artifacts/4-4-join-groups.md'
  - 'api/services/facebookScheduler.js'
---

# Coverage Plan

## Stack / Mode
- Stack: fullstack
- Mode: BMad-integrated
- Scope: Epic 2 — Facebook Automation (Stories 2.1–2.4)

## Targets

### Unit
- `api/services/facebookAutomation.js`
  - `runGuardedBatch` (Story 2.1)
  - `randomDelay` (Story 2.1)
  - `likeFacebookPosts` (Story 2.2)
  - `commentOnFacebookPosts` (Story 2.3)
  - `createFacebookPost` (Story 2.4)
- Priority: P0/P1
- Why: core guardrail logic and write actions are risk-bearing; exercised directly with spy actionFn/likeFn/commentFn/createPostFn and injectable delay

### No additional levels
- No API/E2E/browser flows for these stories
- No duplication of scraper tests
- No contract tests; no external provider involved

## Coverage focus
- Default `dryRun=true` across all functions
- Preview shape + no action invocation in dry-run
- `dryRun=false` path with per-item action execution
- `maxBatch` enforcement in dry-run + real run
- bounded retry
- explicit stop condition seam
- `onProgress` guard and failure isolation
- null/undefined item handling
- `randomDelay(min, max)` validation
- `alreadyLiked` idempotency (Story 2.2)
- `commentText` pass-through in results (Story 2.3)
- `previewContent` / `content` in results (Story 2.4)
- account-risk warning before first real write

## Priority rationale
- P0: guardrails, safety defaults, batch bounds, retry/stop semantics
- P1: callback/error isolation and input validation
- P2: minor shape edge cases / helper behavior

## Test Results

- File: `tests/services/facebook-automation.test.js`
- Runner: vitest v4.0.18
- Run date: 2026-06-09
- Result: **71 passed, 0 failed** (duration: ~223ms)

### Suites verified
- `runGuardedBatch > input validation` — 13 tests
- `runGuardedBatch > strict dryRun gate (HIGH safety guard)` — 4 tests
- `runGuardedBatch > dry-run default` — 6 tests
- `runGuardedBatch > dryRun:false — real write branch` — 6 tests
- `runGuardedBatch > maxBatch enforcement` — 4 tests
- `runGuardedBatch > account-risk warning` — 4 tests
- `runGuardedBatch > result shape` — 2 tests
- `runGuardedBatch > delay seam` — 3 tests
- `runGuardedBatch > maxRetry` — 3 tests
- `runGuardedBatch > shouldStop` — 3 tests
- `runGuardedBatch > onProgress` — 3 tests
- `runGuardedBatch > randomDelay` — 2 tests
- `likeFacebookPosts > dry-run default` — 1 test
- `likeFacebookPosts > dryRun:false — real write` — 1 test
- `likeFacebookPosts > alreadyLiked handling` — 2 tests
- `likeFacebookPosts > error handling` — 1 test
- `likeFacebookPosts > maxBatch enforcement` — 1 test
- `commentOnFacebookPosts > dry-run default` — 1 test
- `commentOnFacebookPosts > dryRun:false — real write` — 1 test
- `commentOnFacebookPosts > commentText in results` — 1 test
- `commentOnFacebookPosts > error handling` — 1 test
- `commentOnFacebookPosts > maxBatch enforcement` — 1 test
- `createFacebookPost > dry-run default` — 1 test
- `createFacebookPost > dryRun:false — real write` — 2 tests
- `createFacebookPost > content in results` — 1 test
- `createFacebookPost > error handling` — 1 test
- `createFacebookPost > account-risk warning` — 2 tests

## Status: COMPLETE

---

## TEA Round 2 — Story 2.2 Gap Coverage (2026-06-09)

### Coverage Gaps Addressed

| Gap | Priority | Resolution |
|---|---|---|
| `findLikeButton` — 0 tests | P0 | 6 unit tests added |
| `likeSinglePost` (private) — 0 tests | P1 | 6 integration tests via real stack |

### New Test Files

**`tests/services/facebookAutomation.findLikeButton.test.js`** (6 tests)
- English Like button → `{ alreadyLiked: false }`
- Vietnamese Like button (Thích) → `{ alreadyLiked: false }`
- English already-liked (Remove Like) → `{ alreadyLiked: true }`
- Vietnamese already-liked (Bỏ thích) → `{ alreadyLiked: true }`
- waitForSelector timeout → throws `/Like button not found/i`
- alreadyLiked priority over liked state

**`tests/services/facebook-automation.integration.test.js`** (6 tests)
- Navigate + click English Like → `ok:true, alreadyLiked:false`
- Navigate + click Vietnamese Like → `ok:true, alreadyLiked:false`
- Already liked en (Remove Like) → no click, `alreadyLiked:true`
- Already liked vi (Bỏ thích) → no click, `alreadyLiked:true`
- Button not found → `ok:false`, error matches `/Like button not found/i`
- Dry-run safety gate → no `goto`, no click

### Final Results

- **New tests:** +12 (6 unit + 6 integration)
- **Total service tests:** 83 pass, 0 fail
- **Regressions:** 0
- **Technique:** fake page objects + `vi.useFakeTimers()` for internal `sleep()` bypass

---

## TEA Round — Epic 3 MCP Behavior Tests (2026-06-10)

### Coverage Gaps Addressed

| Gap | Priority | Resolution |
|---|---|---|
| `executeFacebookAutomateTool` auth guard — 0 tests | P0 | 7 unit tests added |
| `executeFacebookAutomateTool` arg validation — 0 tests | P0 | 9 unit tests added |
| dryRun strict gate (schema / contract) — 0 tests | P1 | 2 contract tests added |
| `server.test.js` silently skipped (node:test → vitest) | P1 | fixed; 24 tests now running |

### New Test Files

**`tests/mcp/facebook-automate-behavior.test.js`** (18 tests)
- Auth guard (7): absent, null, empty object, empty c_user, whitespace c_user, empty xs, whitespace xs
- Arg validation like (3): empty urls, absent urls, string instead of array
- Arg validation comment (4): empty urls, absent text, empty text, whitespace text
- Arg validation post (2): absent text, whitespace text
- dryRun schema gate (2): boolean type verified, not in required array

**`tests/mcp/server.test.js`** (24 tests — pre-existing, now running)
- Fixed: replaced `node:test` imports with vitest, `before` → `beforeAll`
- Covers: TOOLS array structure, x_ prefix convention, unique names, required fields

### Modified Files

**`src/mcp/server.js`**
- Added `executeFacebookAutomateTool` to named export for test access

### Final Results

- **New tests:** +18 behavior (facebook-automate-behavior.test.js)
- **Unlocked tests:** +24 (server.test.js was silently skipped, now passing)
- **MCP test total:** 55 (13 schema/contract + 18 behavior + 24 server definitions)
- **Full suite (mcp + services + scrapers):** 263 pass, 0 fail
- **Regressions:** 0

## Status: COMPLETE

---

## TEA Round 3 — MCP Partial authCookie Edge Cases (2026-06-10)

### Coverage Gaps Addressed

| Gap | Priority | Resolution |
|---|---|---|
| `authCookie: { xs }` only (c_user missing) | P2 | 1 test added |
| `authCookie: { c_user }` only (xs missing) | P2 | 1 test added |
| `authCookie` as plain string (not object) | P2 | 1 test added |

### Modified File

**`tests/mcp/facebook-automate-behavior.test.js`** (+3 tests → 21 total)

### Final MCP Results

- **Total MCP tests:** 58 (21 behavior + 30 contract + 7 server structure)
- **Full suite:** 1,138 pass, 23 fail (x402 server-required, pre-existing), 0 regressions
- Commit: `e977482`

---

## TEA Round — Epic 4 Growth Automation (2026-06-16)

**Mode:** Create / BMad-Integrated · **Stack:** backend (Vitest 4.x, API-only profile) · browser-free, no-mock

### Scope

Epic 4 has 4 implemented stories (4-1…4-4); 4-5 is `ready-for-dev` (no code) and 4-6…4-9 are
`backlog`. Expansion targeted the **implemented** surface only. Gap analysis (read-only sub-agent)
surfaced ~64 candidate uncovered branches; P0/P1 selected = validation branches, safety invariants
(dryRun strict-`=== false` gate, NFR3 cookie-scrubbing, NFR-6 30s delay floor, NFR-8 account-risk
warning, SSRF guard), retry/seam semantics, capture-Map merge edges. All tests unit/service-level
(no E2E — selectors UNVERIFIED, live-DOM out of scope).

### Coverage Gaps Addressed

| Target | Priority | Resolution |
|---|---|---|
| `runGuardedBatch` + `assertFacebookUrl` (shared chokepoint) | P0 | 25 tests |
| `scheduleFacebookPost` + `runDueSchedules` + `sweepStaleRunning` (4.1) | P0/P1 | 13 tests |
| `shareFacebookPosts` (4.2) | P1 | 12 tests |
| `warmupScrollFeed` (4.3) | P1 | 15 tests |
| `joinFacebookGroups` (4.4) | P0/P1 | 12 tests |

### New Test Files

- `tests/services/facebook-guarded-batch.test.js` (25) — dryRun:null gate, items-not-array, maxBatch/maxRetry invalid, retry count (1+maxRetry), null-item skip, onProgress shape + error-swallow, shouldStop abort, throwing-delay continue, delayMin:null normalize, actionFn-not-fn, ACCOUNT_RISK_WARNING; assertFacebookUrl http/subdomain accept + non-string/whitespace/scheme/host/lookalike reject
- `tests/services/facebook-share-edge.test.js` (12) — dryRun:null, non-string/duplicate/non-fb URL reject, ACCOUNT_RISK_WARNING, single-item no-delay, default (1000,3000) range, alreadyShared true/false merge, failed-item-not-mutated, default-retry, maxBatch boundary
- `tests/services/facebook-view-boost-edge.test.js` (15) — duration ==300/301/null/string/<=0 boundaries, missing URL, http+subdomain, dryRun:null, delay args (800,2500), run-summary shape, Operation complete, goto-throws→failed+200char+rethrow, err.code preserved, throwing-updateOperation-doesn't-mask, createOperation-throws-before-goto
- `tests/services/facebook-join-groups-edge.test.js` (12) — input non-object, groupUrls-not-array, keyword whitespace, default limit 10, limit 0/-/non-int, searchFn non-array/non-fb-URL, delayMin NaN/Inf→floor, delayMax-below-floor clamp, no-status merge, ACCOUNT_RISK_WARNING, keyword dry-run no-browser
- `tests/services/facebook-schedule-edge.test.js` (13) — content non-string, scheduledAt missing/unparseable, dryRun:null, mediaUrls preview+persist, facebookAccountId persist, sweepStaleRunning, empty queue, throughput boundary (4 under cap → runs), jitter 5–15min window, two-due-in-tick, NFR3 named-error + err.code scrubbing

### Final Results

- **New tests:** +77 (25 + 13 + 12 + 15 + 12)
- **Services suite:** 221 pass, 0 fail (144 prior + 77 new) — **0 regressions**
- **Full project suite:** 1434 pass, 22 skipped, 9 fail — all `tests/x402-integration.test.js` (pre-existing ECONNREFUSED, server-required, documented in CLAUDE.md). Not caused by this expansion.

### Residual risk

- **No live-DOM coverage.** 4.2 "Share now", 4.4 Join/pending + all group/share selectors remain UNVERIFIED (`docs/agents/selectors-facebook.md` verify-checklist). These tests cover control flow (validation, batching, capture-Map, safety floors) via injected seams — they do NOT prove real selectors click the right element. Live verify on a test account still required before `dryRun:false`.
- **4.1 is DB-backed** (real Prisma, isolated test-user `test-user-sched-4-1-edge`). Requires `DATABASE_URL`.
- **Deferred (low-priority):** `startFacebookScheduler` idempotency (sets a process-global cron guard — unsafe in-suite without a teardown seam); internal `isPostSuccess` unknown-shape + `postFailureReason` 80-char truncation (non-exported — covered indirectly).

## Status: COMPLETE
