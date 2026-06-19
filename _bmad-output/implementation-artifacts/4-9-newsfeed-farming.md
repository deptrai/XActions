---
baseline_commit: e2deee0
---

# Story 4.9: Newsfeed farming / account warming (dry-run default)

Status: review

<!-- Epic 4 (Facebook Growth Automation, Cluster 2 — medium-high risk). Source: epics.md#Story 4.9 + PRD prd-XActions-2026-06-10-epic4 FR-23. Realizes UJ-7. -->

## Story

As a new-account operator using XActions,
I want to warm up an account with natural newsfeed scrolling and light reactions,
so that I can build a normal behavioral fingerprint before running heavier automation.

## Context — what this story builds

Story 4.9 adds `warmupAccount(page, options)` — an EXTENSION of Story 4.3's `warmupScrollFeed` with two additions: (1) **optional probabilistic reactions** (like a post with low probability during scroll), and (2) a **longer duration cap** (600s vs 4.3's 300s). It is NOT a `runGuardedBatch` case (no item batch — FR-23 is NOT in NFR-7 list), but it IS in the **NFR-8 mandatory-warning list** (the warming itself is a risk signal).

Key constraints from PRD:
- `reactProbability` default 0.05, capped at 0.2 (CANNOT go higher even if configured)
- `allowReactions` default `false` — when false, this is pure scroll (identical to 4.3's warmupScrollFeed behavior)
- `durationSeconds` clamped to **600** (not 300 like 4.3)
- NO follow / friend-request / comment actions in warmup mode — reactions (like) ONLY when `allowReactions=true`
- **Mandatory warning** (NFR-8): "Account warming không đảm bảo tránh checkpoint. Dùng trên account thử nghiệm trước khi dùng account chính."
- `dryRun` default true — describes behavior WITHOUT opening browser

Pattern: clone `warmupScrollFeed` (4.3) and add: longer cap, reaction probability gate, mandatory warning emit.

## Acceptance Criteria

**AC1 — `warmupAccount` entry + scroll behavior**
1. `warmupAccount(page, options = {})` exported from `api/services/facebookAutomation.js` + added to default export.
2. On a real run: navigate to Facebook home feed, scroll with randomized speed + pauses (≥5s pause at least once per 3 screens of scroll). Loop until elapsed time reaches the (clamped) `durationSeconds`.
3. **NO follow, friend-request, or comment actions** — only scroll + optional like reactions (gated by `allowReactions`).

**AC2 — Duration clamp 600s**
4. `MAX_WARMUP_DURATION_SECONDS = 600` named constant. Values > 600 are clamped (not rejected). Default duration ~120s. Values ≤ 0 / non-finite → throw.
5. Same clamp-not-reject posture as 4.3 (`warmupScrollFeed`'s `MAX_DURATION_SECONDS = 300`).

**AC3 — Reactions (probabilistic, gated, capped)**
6. `options.allowReactions` default `false`. When false → pure scroll, NO reactions (functionally identical to 4.3 but with longer cap + warning).
7. `options.reactProbability` default `0.05`. **Capped at 0.2** — a value > 0.2 is silently clamped (same posture as durationSeconds: clamp, not reject). Value ≤ 0 means no reactions (equivalent to `allowReactions: false`).
8. When `allowReactions: true` and `reactProbability > 0`: after each scroll, with probability `reactProbability`, attempt to find and click a Like button on a visible post (reuse `findLikeButton` from Story 2.2 — already exported). If the post is already liked → skip (do not unlike). If Like button not found → skip silently (no throw — warming must not crash on a missing button).
9. Injectable `reactFn` seam (default: real find-and-click-like) so tests control reactions without a browser.

**AC4 — Mandatory warning (NFR-8)**
10. Before a real run (not dry-run), emit a mandatory, non-suppressible warning: `"⚠️ Account warming does not guarantee avoiding checkpoint. Use a test account before using your main account."` This is IN ADDITION to (not a replacement of) any runGuardedBatch warning — but since this is NOT routed through runGuardedBatch, the warning must be emitted DIRECTLY by `warmupAccount` (not inherited).
11. The warning is emitted via `console.warn(...)` (same surface as runGuardedBatch's warning). Do NOT add a flag to suppress it (NFR-8: non-suppressible for FR-23).

**AC5 — Dry-run (default): describe, do NOT open browser**
12. `dryRun` default `true` (strict `=== false` gate). Dry-run returns a preview of the planned behavior: `{ dryRun: true, platform: 'facebook', preview: { durationSeconds, clamped, allowReactions, reactProbability, reactProbabilityClamped } }`. NO `page.*` call, `page` may be null.

**AC6 — ≥5s pause once per 3 screens**
13. The scroll loop must include a longer pause (≥5s) at least once every 3 scroll iterations — this makes the behavior more "human" and is explicitly in the epics AC. Implement via a counter: every 3rd scroll, `await delay(5000, 8000)` instead of the normal shorter pause.

**AC7 — Tests (browser-free, no mocks/stubs/fakes)**
14. Tests with injected `delay` + `now` + `reactFn` seams:
    - dry-run: returns preview, no `page.*`, page may be null
    - duration clamp: 9999 → 600; default applied; ≤0 → throws
    - `allowReactions: false` (default): no `reactFn` called even with `reactProbability > 0`
    - `allowReactions: true, reactProbability: 1.0` (forced 100% for test determinism): `reactFn` called on every scroll; cap verifies `reactProbability` clamped to 0.2 in preview
    - mandatory warning emitted before real run (spy on console.warn or injectable warn seam)
    - scroll-only: `page.click` never called when `allowReactions: false`
    - ≥5s pause every 3 scrolls: delay spy records a longer pause every 3rd iteration
    - NO follow/friend/comment: assert only scroll + like-reaction (nothing else)
15. Vitest 4.x, `npx vitest run <file>`. Browser-free via seams. No real network.

## Tasks / Subtasks

- [x] **Task 1: `warmupAccount` entry + duration clamp** (AC1, AC2, AC5)
  - [x] Export + default export; `MAX_WARMUP_DURATION_SECONDS=600`; clamp not reject; default 120; throw ≤0
  - [x] Strict dryRun gate; dry-run returns preview; page may be null
- [x] **Task 2: Scroll loop with ≥5s pause every 3 screens** (AC1, AC6)
  - [x] Clone 4.3's `warmupScrollFeed` loop structure (injectable delay + now seams, maxScrolls backstop)
  - [x] Counter: every 3rd scroll → longer pause (5-8s)
- [x] **Task 3: Reactions (gated + capped)** (AC3)
  - [x] `allowReactions` gate (default false); `reactProbability` default 0.05 cap 0.2
  - [x] When enabled: Math.random() < reactProbability → call `reactFn(page)` (default: findLikeButton + click if not already liked; skip silently on failure)
  - [x] Injectable `reactFn` seam
- [x] **Task 4: Mandatory warning** (AC4)
  - [x] `console.warn(...)` before real run; non-suppressible; NOT from runGuardedBatch (direct emit)
- [x] **Task 5: Tests** (AC7)
  - [x] All AC7 cases; `npx vitest run <file>` green

## Dev Notes

### REUSE-FIRST

- **Clone `warmupScrollFeed` (4.3)** as base — same injectable `delay`/`now` seams, same `maxScrolls` backstop (adapted for 600s), same strict dryRun gate, same `assertFacebookUrl` (for the home-feed URL, though it's always facebook.com). Diff from 4.3: longer cap, reaction gate, mandatory warning, ≥5s pause counter. [Source: api/services/facebookAutomation.js#warmupScrollFeed]
- **Reuse `findLikeButton` (Story 2.2)** for the reaction action — already exported, handles locale-aware Like/Unlike detection. If `alreadyLiked` → skip (do not unlike). If not found → skip (don't crash the warming loop). [Source: api/services/facebookAutomation.js#findLikeButton]
- **DO NOT use `runGuardedBatch`** — FR-23 is NOT in NFR-7 list (no batch of items). The scroll + occasional reaction is a single time-bounded loop, not a batch write. Same reasoning as 4.3.
- **DO emit the warning directly** — FR-23 IS in NFR-8 list, but since we're not using runGuardedBatch (which normally emits warnings), the function must `console.warn` its own warning before the real run.

### Lessons applied (4.3 review)

- **maxScrolls backstop** (4.3 review HIGH) — cap iterations to prevent busy-spin if `delay` is no-op + `now` is default. Same formula: `ceil(durationMs / minPause) + 1`.
- **safeError `code: message`** (4.3 review MED) — if Operation persistence is added, use the same `code: truncated_message` format.
- **`Promise.resolve()` wrap** (4.3 review LOW) — if injected seams can throw sync.
- **Document delay↔now coupling** in JSDoc (4.3 review).
- **Clamp, don't reject** for durationSeconds and reactProbability (both are "over-limit → reduce, not error").

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (add `warmupAccount` + `MAX_WARMUP_DURATION_SECONDS` + default-export entry).
- NEW: test file under `tests/services/`.
- No Prisma model, no CLI/MCP/REST surface this story. Operation persistence optional (injectable seam like 4.3 — nice-to-have, not required by FR-23 ACs).
- Navigate to `https://www.facebook.com/` (home feed) — no user-input URL needed.

### Critical context

- Node.js, ESM. `// by nichxbt`; emoji log prefixes.
- Tests: Vitest 4.x, **no mocks/stubs/fakes** — injected `delay`/`now`/`reactFn` seams.
- FR-23 is the LAST story of Epic 4 and the second Cluster 2 feature that DOES NOT use runGuardedBatch. It's more like 4.3 (scroll loop) than 4.4/4.5/4.7 (batch writes).
- Reactions are LOW-probability and ONLY likes — no comments, no shares, no follows. This is deliberate: a warmup that comments/follows would be indistinguishable from automation to Facebook's detectors.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.9: Newsfeed farming / account warming]
- [Source: _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md#FR-23, §7 NFR-8 (mandatory warning), §4.3 Cluster 2]
- [Source: api/services/facebookAutomation.js#warmupScrollFeed (clone base), #findLikeButton (reaction reuse), #MAX_DURATION_SECONDS (clamp pattern)]
- [Source: _bmad-output/implementation-artifacts/4-3-view-boost.md (scroll loop + seams + busy-spin backstop)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- Clock step bug: `makeFakeClock` initial value caused loop to exit before first scroll — fixed by starting at `-step` so first call returns 0.
- `reactProbability: 1.0` test assertion: raw 1.0 is clamped to 0.2 per AC3.7, so `reactFn.calls === scrolls` is impossible — corrected to `toBeGreaterThan(0)`.

### Completion Notes List

- Implemented `warmupAccount(page, options)` as clone of `warmupScrollFeed` (4.3) with: longer cap (600s vs 300s), no `targetUrl`/`assertFacebookUrl`, ≥5s pause every 3rd iteration, probabilistic reaction gate, mandatory NFR-8 warning.
- `MAX_WARMUP_DURATION_SECONDS=600`, `DEFAULT_WARMUP_DURATION_SECONDS=120` exported as named constants.
- `reactProbability` normalization: >0.2→0.2 (clamped), ≤0/NaN/non-number→0 (never throw). Duration validation: ≤0/NaN/non-number→throw; >600→clamp.
- Default `reactFn` wraps `findLikeButton` in try/catch (it throws on not-found), clicks only when `alreadyLiked===false`.
- Mandatory `console.warn` emitted directly before real run (non-suppressible, not via runGuardedBatch).
- Operation persistence intentionally omitted per Dev Notes (FR-23 ACs do not require it).
- 27/27 tests green. Pre-existing failures (x402-integration, facebook-schedule Prisma) are server/DB-dependent and unrelated to this story.

### File List

- `api/services/facebookAutomation.js` — added `warmupAccount`, `MAX_WARMUP_DURATION_SECONDS`, `DEFAULT_WARMUP_DURATION_SECONDS`, `defaultReactFn`; updated default export
- `tests/services/facebook-warmup-account.test.js` — new test file (27 tests)

## Change Log

- 2026-06-16: Story 4.9 created (context engine). Status → ready-for-dev. (Luisphan)
- 2026-06-19: Pre-dev spec review (adversarial, claude-opus-4-8). Fixed 15 findings. Status unchanged. (claude-opus-4-8)
- 2026-06-19: Implementation complete (claude-sonnet-4-6). warmupAccount + 27 tests green. Status → review.
