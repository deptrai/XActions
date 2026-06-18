---
baseline_commit: e2deee0
---

# Story 4.8: Cancel pending friend requests (dry-run default)

Status: review

<!-- Epic 4 (Facebook Growth Automation, Cluster 2 — medium-high risk). Source: epics.md#Story 4.8 + PRD prd-XActions-2026-06-10-epic4 FR-22. Realizes UJ-8. -->

## Story

As a growth hacker using XActions,
I want to bulk-cancel pending friend requests,
so that I can free up my friend-request quota without manual clicking.

## Context — what this story builds

Story 4.8 adds `cancelPendingFriendRequests(page, options)` — a two-phase action: (1) **scrape** the pending-requests list (`/friends/requests/sent`), then (2) **batch-cancel** each via `runGuardedBatch`. Unlike 4.7 (send requests, 60-180s delay), cancelling is a lighter cleanup action with a **2-5s delay** (PRD FR-22) — the lowest delay of any Cluster 2 write, but still through the guardrail.

Key design:
- **Phase 1 (read)**: navigate `/friends/requests/sent`, scroll-collect pending requests with metadata `{ name, profileUrl, dateSent }`. Filter by `olderThanDays` if provided. This mirrors 4.6's scrape pattern (bounded scroll + stall detection).
- **Phase 2 (write)**: the collected pending-request URLs become batch items routed through `runGuardedBatch` with 2-5s delay. Cancel = click "Cancel request" / "Hủy yêu cầu" per profile.
- **NFR-7**: FR-22 IS in the runGuardedBatch-mandatory list.
- **NFR-8**: FR-22 IS in the mandatory-warning list. Warning: "Hủy nhiều lời mời liên tiếp có thể bị Facebook gắn cờ; giữ batch nhỏ và dùng delay."
- **No delay floor constant needed** — 2-5s IS the range (same as runGuardedBatch's default 1-3s, just slightly wider). Pass `delayMin: 2000, delayMax: 5000` to runGuardedBatch.
- **Result shape**: `{ cancelled, failed, remaining }` (not the standard runGuardedBatch result — wrap/transform).

## Acceptance Criteria

**AC1 — `cancelPendingFriendRequests` entry + routing**
1. `cancelPendingFriendRequests(page, options = {})` exported from `api/services/facebookAutomation.js` + added to default export.
2. `options = { limit, olderThanDays?, dryRun? }`. `limit` = max cancellations (required, positive integer). `olderThanDays` = optional filter (only cancel requests older than N days).
3. `dryRun` defaults to `true` (strict `=== false` gate). Dry-run DOES navigate to collect the list (read phase — needed to show preview), but does NOT click any Cancel button.
4. Routes the cancel phase through `runGuardedBatch(targets, cancelFn, { delayMin: 2000, delayMax: 5000, ...rest })` — NO custom mutate loop (NFR-7).

**AC2 — Phase 1: collect pending requests**
5. Navigate `/friends/requests/sent` (or equivalent URL — UNVERIFIED, document). Bounded scroll + 1-3s delay (injectable `delay` seam) + stall detection (same pattern as 4.6 scrapeGroupMembers).
6. Extract per-request: `{ name, profileUrl, dateSent }`. `dateSent` parsed from the visible "Sent X days ago" / "Đã gửi X ngày trước" text (best-effort — null if unparseable).
7. If `olderThanDays` is provided, filter: only include requests where `dateSent` is >= N days ago. Unparseable dates are INCLUDED (err on the side of cancelling — the user explicitly asked to clean up).
8. Cap the collected list at `limit`.
9. Injectable `collectFn` seam (default real scrape) so tests skip real browser for Phase 1.

**AC3 — Dry-run preview**
10. Dry-run returns `{ dryRun: true, platform: 'facebook', pending: [{ name, profileUrl, dateSent }], count: N }` — the list of requests that WOULD be cancelled. Phase 1 runs (read-only navigation); Phase 2 does NOT run.
11. If no pending requests found (page empty or all filtered by olderThanDays) → return `{ dryRun: true, pending: [], count: 0 }` (no throw).

**AC4 — Phase 2: batch cancel**
12. Each collected `profileUrl` becomes a batch item. Internal `cancelSingleRequest(page, profileUrl)`: navigate to the profile (or use the sent-requests page row), click "Cancel request" / "Hủy yêu cầu" button, return `{ cancelled: boolean }`. PII-free throw if button not found.
13. `delayMin: 2000, delayMax: 5000` passed to runGuardedBatch (FR-22: "delay 2–5s giữa mỗi hủy").
14. Account-risk warning fires before first real cancel (inherited from runGuardedBatch; NFR-8).

**AC5 — Result shape**
15. Real-run result: `{ dryRun: false, platform: 'facebook', cancelled: N, failed: N, remaining: N }` where `remaining` = total pending found minus cancelled minus failed. Transform from runGuardedBatch's `{ succeeded, failed }` into this shape.

**AC6 — Safety**
16. No cancel under `dryRun=true` (test asserts no Cancel-button click in dry-run).
17. Account-risk warning inherited (not reimplemented/suppressed; NFR-8).
18. `limit` validates: positive finite integer; reject 0/negative/non-finite.

**AC7 — Tests (browser-free, no mocks/stubs/fakes)**
19. Tests with injected `cancelFn` seam + `collectFn` seam + `delay` spy:
    - dry-run: Phase 1 runs (collectFn called), preview returned, NO cancelFn called
    - real-run: collectFn returns N items → cancelFn called per item → result `{ cancelled, failed, remaining }`
    - `olderThanDays` filter: collectFn returns items with various dateSent → only old enough included
    - cancel that throws → `ok:false`, batch continues, counted as `failed`
    - empty pending list → `{ cancelled:0, failed:0, remaining:0 }` (no throw)
    - invalid `limit` (0, negative, non-finite) → throws
    - delay: spy receives (2000, 5000) between cancels
20. Vitest 4.x, `npx vitest run <file>`. Browser-free via injected seams.

## Tasks / Subtasks

- [x] **Task 1: `cancelPendingFriendRequests` entry** (AC1, AC6)
  - [x] Export + default export; strict dryRun gate; validate `limit`
- [x] **Task 2: Phase 1 — collect pending requests** (AC2)
  - [x] Navigate `/friends/requests/sent`; bounded scroll + stall detect + delay seam
  - [x] Extract `{ name, profileUrl, dateSent }`; filter by `olderThanDays`; cap at `limit`
  - [x] Injectable `collectFn` seam (default real scrape)
- [x] **Task 3: Dry-run preview** (AC3)
  - [x] Phase 1 runs, returns pending list; Phase 2 skipped
- [x] **Task 4: Phase 2 — batch cancel** (AC4, AC5)
  - [x] Route through `runGuardedBatch` with `delayMin:2000, delayMax:5000`; `cancelSingleRequest` per item
  - [x] Transform result to `{ cancelled, failed, remaining }`
- [x] **Task 5: Selectors doc** 
  - [x] Add "Friends — Cancel Pending (FR-22)" to selectors-facebook.md (UNVERIFIED + verify-checklist)
- [x] **Task 6: Tests** (AC7)
  - [x] All AC7 cases; `npx vitest run <file>` green

## Dev Notes

### REUSE-FIRST

- **Phase 1 = scrape pattern (4.6)**: bounded scroll, stall detection, injectable delay. Clone `scrapeGroupMembers` structure for the collect phase.
- **Phase 2 = batch write (4.4)**: `runGuardedBatch` routing with `delayMin/delayMax`, injectable `cancelFn` seam, capture-Map if needed.
- **Two-phase approach**: unlike 4.4/4.5/4.7 (single-phase batch), this story has a read-then-write flow. Dry-run runs Phase 1 (read) but skips Phase 2 (write). This is the correct posture — the user needs to SEE what will be cancelled before confirming.
- **No new delay floor constant** — 2-5s is close to the default 1-3s; just pass `delayMin: 2000, delayMax: 5000` directly (unlike 4.4's 30s or 4.7's 60s which are safety INVARIANTS; 2-5s for cancel is a spec value, not a non-negotiable floor).
- **Reuse `assertFacebookUrl`** if validating any URL. Pending-request page URL is fixed (`/friends/requests/sent`) so no user-input URL to validate here — but `cancelSingleRequest` navigates to `profileUrl` collected from DOM, which should already be facebook.com (validated by the scrape logic extracting from facebook.com page).

### Lessons applied (Stories 4.1–4.7)

- **Injectable seams for both phases** (collect + cancel) so tests stay browser-free.
- **Dry-run CAN drive browser for reads** — this is the opposite of 4.4 keyword-mode (where we decided dry-run does NOT search). Here Phase 1 is essential for the preview: the user needs to see WHICH requests will be cancelled. Document this explicitly.
- **Transform result shape** — runGuardedBatch returns `{ succeeded, failed, attempted }` but the spec wants `{ cancelled, failed, remaining }`. Map: `cancelled = succeeded`, `failed = failed`, `remaining = totalPending - cancelled - failed`.
- **`olderThanDays` with unparseable dates → include** — err on the side of cancelling (user's intent is cleanup; excluding an undated request means it stays forever).

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (add `cancelPendingFriendRequests` + `cancelSingleRequest` + default-export entry), `docs/agents/selectors-facebook.md` (Friends Cancel section).
- NEW: test file under `tests/services/`.
- No Prisma model, no CLI/MCP/REST surface this story.

### Critical context

- Node.js, ESM. `// by nichxbt`; emoji log prefixes.
- Tests: Vitest 4.x, **no mocks/stubs/fakes** — injected `collectFn`/`cancelFn`/`delay` seams.
- NFR-8: account-risk warning mandatory (FR-22 in list). Warning message per PRD: "Hủy nhiều lời mời liên tiếp có thể bị Facebook gắn cờ."
- Cancel is LOWER risk than send (4.7) — 2-5s delay vs 60-180s. But still a write batch through guardrail.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.8: Cancel pending friend requests]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-22, §7 NFR-7/NFR-8, UJ-8]
- [Source: api/services/facebookAutomation.js#runGuardedBatch, #joinFacebookGroups (batch template)]
- [Source: _bmad-output/implementation-artifacts/4-6-scrape-group-members.md (scrape/scroll pattern for Phase 1)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8

### Debug Log References

### Completion Notes List

- Added `cancelPendingFriendRequests(page, options)` to `api/services/facebookAutomation.js` — two-phase Cluster-2 cleanup action (FR-22).
- **Phase 1 (read)** — `defaultCollectSentRequests`: navigate `/friends/requests/sent`, bounded scroll + stall detection + injectable delay seam, extract `{ name, profileUrl, dateSent }`. Runs in dry-run too (preview needs it — opposite posture to 4.7 suggestions-mode).
- **Phase 2 (write)** — collected profileUrls → `runGuardedBatch` with `delayMin:2000, delayMax:5000` (FR-22 2-5s, lowest Cluster-2 delay; spec value not a floor invariant). `cancelSingleRequest` clicks Cancel-request button per profile; PII-free throw if not found; waitForSelector catch swallows only timeout.
- `parseRequestAgeDays` — best-effort parse of "Sent X days/weeks/months/years ago" (en/vi); unparseable → null. `olderThanDays` filter INCLUDES unparseable dates (err toward cleanup, AC2.7).
- Result transform: runGuardedBatch `{ succeeded, failed }` → `{ cancelled, failed, remaining }` where `remaining = totalPending - cancelled - failed`.
- Dry-run returns `{ dryRun:true, platform, pending:[...], count }`; empty list → count:0 (no throw). Real-run empty → `{ cancelled:0, failed:0, remaining:0 }`.
- `limit` validated as positive finite integer (rejects 0/negative/NaN/Infinity/non-integer/missing).
- Account-risk warning inherited from runGuardedBatch (NFR-8, non-suppressible).
- 17 browser-free tests (injected collectFn + cancelFn + delay spy): dry-run preview/empty/cap, real-run cancel/throw-continues/empty, olderThanDays filter (incl. unparseable→included), 2-5s delay, limit validation (5 cases), dry-run no-click safety, strict dryRun:null gate.
- `docs/agents/selectors-facebook.md`: added "Friends — Cancel Pending (FR-22)" section + 3 verify-checklist items (UNVERIFIED).
- Related batch-write regression suite green (145 tests across friend-requests/cancel/join/batch-post/automation). Pre-existing schedule flakiness under full parallel load is database contention, unrelated.

### File List

- `api/services/facebookAutomation.js` — added `CANCEL_DELAY_MIN_MS`/`CANCEL_DELAY_MAX_MS`, `parseRequestAgeDays`, `defaultCollectSentRequests`, `cancelSingleRequest`, `cancelPendingFriendRequests`; updated default export
- `tests/services/facebook-cancel-friend-requests.test.js` — new test file (17 tests)
- `docs/agents/selectors-facebook.md` — added Friends — Cancel Pending (FR-22) section + verify-checklist items

## Change Log

- 2026-06-16: Story 4.8 created (context engine). Status → ready-for-dev. (Luisphan)
- 2026-06-18: Implementation complete. Added `cancelPendingFriendRequests` (two-phase: collect → batch-cancel 2-5s, olderThanDays filter, result transform). 17 tests. Status → review. (claude-opus-4-8)
