---
baseline_commit: b08e6038dfe769c8adfe994f86750819c38747e8
---

# Story 4.3: View boost via scroll simulation (dry-run default)

Status: ready-for-dev

<!-- Epic 4 (Facebook Growth Automation, Cluster 3 — low risk). Source: epics.md#Story 4.3 + PRD prd-XActions-2026-06-10-epic4 FR-17. -->

## Story

As a growth marketer using XActions,
I want to simulate natural scrolling on a page/post,
so that I can increase organic engagement signals without explicit actions.

## Context — what this story builds

Story 4.3 adds `warmupScrollFeed(page, targetUrl, options)` to `api/services/facebookAutomation.js`. Unlike 4.1 (schedule) and 4.2 (share), this is **NOT a batch write and NOT a `runGuardedBatch` case** — it is a single time-bounded scroll loop that performs **zero click/like/comment/share actions**. It only scrolls with randomized speed + pauses to generate passive view/dwell signals.

**Critical design decision — do NOT route through `runGuardedBatch`.** Verified against the PRD: NFR-7 (runGuardedBatch mandatory) lists only FR-18, FR-19, FR-21, FR-22; NFR-8 (non-suppressible account-risk warning) lists only FR-18, FR-19, FR-21, FR-22, FR-23. **FR-17 (view boost) is in neither list** — it has no batch of write-items and triggers no social action, so `runGuardedBatch` does not apply and a mandatory account-risk warning is NOT required. Forcing this into `runGuardedBatch` would be reinventing the wrong abstraction.

The lowest-risk feature in Epic 4: no DOM writes at all, only scrolling.

## Acceptance Criteria

**AC1 — `warmupScrollFeed` entry point + scroll behavior (FR-17)**
1. `warmupScrollFeed(page, targetUrl, options = {})` is exported from `api/services/facebookAutomation.js` and added to its default export.
2. On a real run it navigates to `targetUrl` then scrolls the feed with **randomized scroll amounts and randomized pauses between scrolls**, looping until the elapsed wall-clock time reaches the (clamped) `durationSeconds`.
3. It performs **NO click, like, comment, share, or any other interaction** — scroll only. (Tested by asserting `page.click` is never called.)

**AC2 — Duration clamp (not reject)**
4. `durationSeconds` is clamped to a maximum of **300** (`MAX_DURATION_SECONDS` named constant): a value > 300 is silently reduced to 300, NOT rejected with an error (FR-17: "vượt ngưỡng bị clamped, không từ chối"). A missing/invalid `durationSeconds` falls back to a sane default (e.g. 60). A `durationSeconds <= 0` (or non-finite) is rejected with a clear error — a zero/negative scroll session is a bug, not a no-op.

**AC3 — Dry-run (default): validate + compute, do NOT open/drive browser**
5. `dryRun` defaults to `true` (strict gate: only explicit `dryRun: false` runs the real scroll — mirror `runGuardedBatch`'s `=== false` gate so `dryRun: null` does NOT trigger a real run).
6. In dry-run: validate `targetUrl`, compute the clamped `durationSeconds` and the planned parameters, and return a preview WITHOUT calling any `page.*` method (no `goto`, no scroll). The `page` arg MAY be `null` in dry-run (mirror `scheduleFacebookPost`). Assert in tests that `page.goto`/`page.click`/scroll are not invoked in dry-run.
7. Preview shape, e.g. `{ dryRun: true, platform: 'facebook', preview: { targetUrl, durationSeconds: <clamped>, clamped: <bool> } }`.

**AC4 — URL validation (fail before browser)**
8. Validate `targetUrl` before opening/driving anything: must be a non-empty string parseable by `new URL()`, `http(s)` scheme, host `facebook.com` or `*.facebook.com`. Reject otherwise with a clear error BEFORE navigation (same guard added in Story 4.2 `shareFacebookPosts` — reuse the exact validation approach; consider extracting a shared `assertFacebookUrl(url)` helper since 4.2 and 4.3 now both need it). This prevents SSRF (`file:///`, internal hosts, `javascript:`).

**AC5 — Operation record (real run only)**
9. NO `Operation` record is created in dry-run. On a real run, IF `options.userId` is provided, create one `Operation` scoped by `userId` (`type: 'facebook_view_boost'`, PII-free `config` = `{ targetUrl, durationSeconds }`), and update it to completed/failed at the end. Operation persistence MUST be injectable (e.g. `options.createOperation` seam, default the real Prisma path) so tests stay DB-free. If no `userId` is provided, skip Operation creation (the function still scrolls) — do not throw.
10. `targetUrl` is not a secret, but never log cookies/session (NFR3) — no cookie handling happens in this function anyway (caller supplies an authenticated `page`).

**AC6 — Browser-free, deterministic tests (no mocks/stubs/fakes)**
11. The duration loop MUST be testable without a real 300-second wait. Inject seams: `options.delay` (default `randomDelay`; tests pass `() => {}`), and a time source `options.now` (default `() => Date.now()`; tests advance a fake clock) OR an explicit max-iterations seam — pick the one that lets a test drive the loop deterministically and assert it terminates at the clamped duration.
12. A fake `page` records `goto`, scroll (`evaluate`/`scrollBy`), and `click` calls. Tests assert:
    - dry-run: returns preview with clamped duration, calls NO `page.*` method, creates NO Operation
    - `durationSeconds: 9999` → clamped to 300 in preview (`clamped: true`)
    - `durationSeconds` default applied when omitted
    - `durationSeconds: 0`/negative/non-finite → throws
    - invalid/non-facebook/`file:` `targetUrl` → throws before any `page.*`
    - real run: scrolls more than once, NEVER calls `page.click`, terminates when the (fake) clock passes the clamped duration
    - real run with `userId` + injected `createOperation` → Operation created (type `facebook_view_boost`) and completed; without `userId` → no Operation, still scrolls
13. Vitest 4.x, `npx vitest run <file>`. Browser-free + DB-free via injected seams. No real network, no real sleep.

## Tasks / Subtasks

- [ ] **Task 1: `warmupScrollFeed` + clamp + URL validation** (AC1, AC2, AC4)
  - [ ] Export from `api/services/facebookAutomation.js` + add to default export
  - [ ] `MAX_DURATION_SECONDS = 300`; clamp (not reject) over-limit; default ~60; throw on `<=0`/non-finite
  - [ ] Validate `targetUrl` (reuse 4.2's facebook.com/scheme guard — extract `assertFacebookUrl` shared helper)
- [ ] **Task 2: dry-run branch** (AC3)
  - [ ] Strict `dryRun === false` gate; dry-run returns preview, touches no `page.*`, creates no Operation; `page` may be null
- [ ] **Task 3: real scroll loop** (AC1, AC6)
  - [ ] Navigate `targetUrl`; loop: random `scrollBy` + random pause via `delay` seam; terminate when `now()` elapsed >= clamped duration
  - [ ] NO click/like/comment/share — scroll only; injectable `now` + `delay` seams for deterministic tests
- [ ] **Task 4: Operation persistence (real run, optional userId)** (AC5)
  - [ ] Injectable `createOperation` seam (default real Prisma path); create `facebook_view_boost` scoped by userId on real run; skip if no userId; PII-free config
- [ ] **Task 5: Tests** (AC6)
  - [ ] Browser-free + DB-free unit tests (fake page + injected `delay`/`now`/`createOperation`) covering all AC6 cases
  - [ ] `npx vitest run <new test file>` green

## Dev Notes

### REUSE-FIRST + anti-reinvent (read before coding)

- **DO NOT use `runGuardedBatch`.** FR-17 is not a batch write (no item list, no social action) and is explicitly excluded from NFR-7/NFR-8 in the PRD. A scroll-only dwell loop is a different shape. Routing it through `runGuardedBatch` (which is built around `items[]` + `actionFn` + account-risk warning) would be the wrong abstraction. [Source: prd-XActions-2026-06-10-epic4.md §7 NFR-7/NFR-8 — FR-17 absent from both]
- **Reuse the scroll pattern** already proven in the codebase: random `scrollBy` + sleep + loop, e.g. `src/scrapers/viralTweets.js:107-119` (scrollBy 800 → sleep → check height) and `src/scrapers/twitter/index.js` (`window.scrollTo`/`scrollBy` via `page.evaluate`). Don't invent a new scroll mechanism. [Source: src/scrapers/viralTweets.js, src/scrapers/twitter/index.js]
- **Reuse the URL guard from Story 4.2.** `shareFacebookPosts` validates `new URL()` + `http(s)` + `facebook.com` host before navigating. 4.3 needs the identical check → extract a shared `assertFacebookUrl(url)` helper in `facebookAutomation.js` and call it from both (refactor 4.2's inline block to use it). [Source: api/services/facebookAutomation.js#shareFacebookPosts — URL validation block added in Story 4.2]
- **Reuse `randomDelay` + `sleep`** already in `facebookAutomation.js` (`randomDelay(min,max)` at line 18). Use `randomDelay` as the default `delay` seam. [Source: api/services/facebookAutomation.js:18]
- **Mirror `scheduleFacebookPost`'s null-page + dry-run + injectable-seam conventions** (story 4.1): `page` may be null in dry-run; strict `=== false` real gate; seams for browser-free/DB-free tests. [Source: api/services/facebookAutomation.js#scheduleFacebookPost; 4-1-schedule-post.md]

### Lessons applied (Stories 4.1, 4.2)

- **Clamp, don't reject** (this story's specific rule, FR-17) — over-limit `durationSeconds` is reduced to 300, not errored. But still reject `<=0`/non-finite (a session that can't run is a bug — same spirit as 4.1's past-`scheduledAt` reject).
- **Strict dry-run gate** `dryRun === false` (4.1/4.2) — `null`/`undefined` stays dry-run.
- **Validate before browser** (4.2) — URL guard runs before any `page.*`; SSRF-safe.
- **Injectable seams for deterministic tests** (4.1 `now`/`postExecutor`, 4.2 `shareFn`) — here the time-bounded loop specifically needs an injectable clock so a test never waits 300s. This is the make-or-break testability decision.
- **Operation persistence injectable + DB-free in tests** (4.1) — default real Prisma, inject in tests; scope by `userId`; PII-free config.
- **No silent-success trap** (4.2) — view-boost has no "did it succeed" assertion to fake; success = the loop ran for the duration without throwing. Don't fabricate engagement metrics.

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (add `warmupScrollFeed` + `MAX_DURATION_SECONDS` + `assertFacebookUrl` shared helper + default-export entry; refactor 4.2's inline URL guard to call the helper).
- NEW: test file under `tests/services/` mirroring 4.1/4.2 layout.
- No CLI/MCP/REST surface in THIS story. No scrape-dispatcher/login/scheduler change.
- No new Prisma model — reuses the existing `Operation` model (view-boost is ephemeral; no `Schedule`-style table needed).

### Critical context

- Node.js, ESM. Author credit `// by nichxbt`; emoji log prefixes (❌ ⚠️ ✅ 🔄).
- Tests: Vitest 4.x, Node env, 30s timeouts. **No mocks/stubs/fakes** — real functions + injected data/seam values (fake page object, `delay`/`now`/`createOperation` seams). The time seam is essential — a real-clock 300s loop would blow the 30s test timeout.
- `tests/x402-integration.test.js` ECONNREFUSED failures are pre-existing and unrelated.
- View-boost is the lowest-risk Epic 4 feature (no writes), but keep `dryRun` default `true` for consistency with ADR-007.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3: View boost via scroll simulation]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-17, §7 NFR-7/NFR-8 (FR-17 absent → no batch/no mandatory warning)]
- [Source: api/services/facebookAutomation.js#runGuardedBatch (do NOT use), #randomDelay, #scheduleFacebookPost (seam/null-page pattern), #shareFacebookPosts (URL guard to extract)]
- [Source: src/scrapers/viralTweets.js:107-119, src/scrapers/twitter/index.js — scroll-loop pattern to reuse]
- [Source: _bmad-output/implementation-artifacts/4-1-schedule-post.md, 4-2-auto-share-post.md — seam/validation/Operation precedents]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

- 2026-06-15: Story 4.3 created (context engine). Status → ready-for-dev. (Luisphan)
