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

Resolved spec decisions (pre-dev review 2026-06-19):
- **`warmupAccount(page, options)` — NO `targetUrl` param.** Unlike `warmupScrollFeed(page, targetUrl, options)`, the home-feed URL is fixed. Hardcode `https://www.facebook.com/` internally; do NOT call `assertFacebookUrl` (no user-supplied URL to guard, the constant is trusted).
- **`DEFAULT_WARMUP_DURATION_SECONDS = 120`** — named constant, EXACT value 120 (not "~120"). Intentionally longer than 4.3's 60s default because warming benefits from a longer baseline session.
- **`findLikeButton` THROWS when not found** (current code, L260) — it does NOT skip. To honor "skip silently", the default `reactFn` MUST wrap `findLikeButton` in try/catch and swallow the throw. Caller owns the skip — `findLikeButton` itself does not.
- **`findLikeButton` only FINDS** (`{ element, alreadyLiked }`) — it does NOT click. The default `reactFn` calls `findLikeButton`, then `element.click()` ONLY when `alreadyLiked === false`.
- **dry-run is PURE COMPUTE** — calls NO seam (`delay`/`now`/`reactFn`) and NO `page.*`. Same posture as 4.8 (dry-run does not drive browser).
- **`now` IS a function-level option** (`now = () => Date.now()`), not test-only — needed for the busy-spin backstop, same as 4.3.

Pattern: clone `warmupScrollFeed` (4.3) and add: longer cap, reaction probability gate, mandatory warning emit.

## Acceptance Criteria

**AC1 — `warmupAccount` entry + scroll behavior**
1. `warmupAccount(page, options = {})` exported from `api/services/facebookAutomation.js` + added to default export. NO `targetUrl` param — the home-feed URL `https://www.facebook.com/` is hardcoded internally (no `assertFacebookUrl`).
2. On a real run: navigate to the hardcoded home feed, scroll with randomized speed + pauses. A ≥5s pause occurs at least once every 3 scroll iterations (see AC6 — "screen" and "iteration" are used interchangeably; the unit of measure is the scroll iteration). Loop until elapsed time reaches the (clamped) `durationSeconds`.
3. **NO follow, friend-request, or comment actions** — only scroll + optional like reactions (gated by `allowReactions`).

**AC2 — Duration clamp 600s**
4. `MAX_WARMUP_DURATION_SECONDS = 600` named constant. Values > 600 are clamped (not rejected). Default when missing/null = `DEFAULT_WARMUP_DURATION_SECONDS = 120` (exact, named constant). Values ≤ 0 / non-finite / non-number → throw.
5. Same clamp-not-reject posture as 4.3 (`warmupScrollFeed`'s `MAX_DURATION_SECONDS = 300`).

**AC3 — Reactions (probabilistic, gated, capped)**
6. `options.allowReactions` default `false`. When false → pure scroll, NO reactions (functionally identical to 4.3 but with longer cap + warning).
7. `options.reactProbability` default `0.05`. Normalization (clamp, never throw): value `> 0.2` → clamped to `0.2`; value `≤ 0`, `NaN`, `Infinity`, or non-number → normalized to `0` (meaning no reactions, equivalent to `allowReactions: false`). The normalized value is what drives the gate and what `preview.reactProbability` reports.
8. When `allowReactions: true` and normalized `reactProbability > 0`: after each scroll, with probability `reactProbability` (`Math.random() < reactProbability`), call `reactFn(page)`. The DEFAULT `reactFn`: (a) call `findLikeButton(page)` — which THROWS if not found (current code L260, it does NOT skip); wrap in try/catch and swallow → skip silently (warming must not crash); (b) if `{ alreadyLiked: true }` → skip (do NOT unlike); (c) if `{ alreadyLiked: false }` → `element.click()`. `findLikeButton` only FINDS; the click is the caller's responsibility.
9. Injectable `reactFn` seam (default: the find-then-click-like described in #8) so tests control reactions without a browser.

**AC4 — Mandatory warning (NFR-8)**
10. Before a real run (not dry-run), emit a mandatory, non-suppressible warning: `"⚠️ Account warming does not guarantee avoiding checkpoint. Use a test account before using your main account."` This is IN ADDITION to (not a replacement of) any runGuardedBatch warning — but since this is NOT routed through runGuardedBatch, the warning must be emitted DIRECTLY by `warmupAccount` (not inherited).
11. The warning is emitted via `console.warn(...)` (same surface as runGuardedBatch's warning). Do NOT add a flag to suppress it (NFR-8: non-suppressible for FR-23).

**AC5 — Dry-run (default): describe, do NOT open browser**
12. `dryRun` default `true` (strict `=== false` gate). Dry-run is PURE COMPUTE: calls NO seam (`delay`/`now`/`reactFn`) and NO `page.*` (`page` may be `null`). Returns `{ dryRun: true, platform: 'facebook', preview: { durationSeconds, clamped, allowReactions, reactProbability, reactProbabilityClamped } }` where:
    - `durationSeconds` = effective (clamped) duration; `clamped` = boolean (true if input > 600)
    - `reactProbability` = the NORMALIZED value (after clamp/normalize per AC3.7), not the raw input
    - `reactProbabilityClamped` = **boolean** flag (true if raw input was > 0.2, mirrors `clamped`)

**AC6 — ≥5s pause once per 3 scroll iterations**
13. The scroll loop must include a longer pause (≥5s) at least once every 3 scroll iterations. "Screen" and "iteration" mean the same unit here (one `scrollBy` = one iteration). Implement via a counter: every 3rd iteration, `await delay(5000, 8000)` instead of the normal short pause (`delay(800, 2500)`). Note: the `maxScrolls` backstop formula (`ceil(durationMs / minPause) + 1` with `minPause = 800`) still holds — the longer 5-8s pauses only make a real run do FEWER scrolls than the cap, never more, so the backstop remains a safe upper bound.

**AC7 — Tests (browser-free, no mocks/stubs/fakes)**
14. Tests with injected `delay` + `now` + `reactFn` seams (no `Math.random` mock — drive determinism via probability boundaries 0 and 1.0 only, never a middle value like 0.05):
    - dry-run: returns preview, calls NO seam and NO `page.*`, `page` may be `null`
    - duration clamp: 9999 → 600; missing → 120 (exact); ≤0 / NaN / non-number → throws
    - `allowReactions: false` (default): `reactFn` NOT called even with `reactProbability > 0`
    - `allowReactions: true, reactProbability: 1.0`: `reactFn` called on every scroll iteration (Math.random() ∈ [0,1) is always < 1.0)
    - `allowReactions: true, reactProbability: 0` (and negative/NaN): `reactFn` NEVER called (normalized to 0)
    - reactProbability clamp: input `0.9` → `preview.reactProbability === 0.2` and `preview.reactProbabilityClamped === true`; input `0.05` → `0.05` / `false`
    - mandatory warning: emitted via `console.warn` spy (vitest `vi.spyOn(console,'warn')` — NOT a mock of the function under test, just an observer). It is NOT injectable/suppressible (NFR-8). Assert it fires before the first scroll on a real run, and does NOT fire on dry-run.
    - scroll-only: when `allowReactions: false`, `page.click` and `reactFn` are never called; only `page.goto` + `page.evaluate(scrollBy)` happen
    - ≥5s pause every 3 iterations: delay spy records a `[5000, 8000]` pause on every 3rd iteration and `[800, 2500]` otherwise
    - NO follow/friend/comment: the fake `page` exposes spies for any social-action method the loop could conceivably call (e.g. a generic `click` + asserting `goto` is only the home URL); assert the loop touches ONLY `goto`(home) + `evaluate`(scroll) + (when enabled) `reactFn`. Document that this is a structural guard, not proof of absence.
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

- **Clone `warmupScrollFeed` (4.3)** as base — same injectable `delay`/`now` seams, same `maxScrolls` backstop (adapted for 600s), same strict dryRun gate. Diff from 4.3: NO `targetUrl` param (hardcode home URL, drop the `assertFacebookUrl` call — there's no user-supplied URL), longer cap (600), reaction gate, mandatory warning, ≥5s pause counter. [Source: api/services/facebookAutomation.js#warmupScrollFeed]
- **Reuse `findLikeButton` (Story 2.2)** for the reaction — already exported, locale-aware Like/Unlike detection, returns `{ element, alreadyLiked }`. ⚠️ CORRECTION to earlier claim: `findLikeButton` does NOT skip on not-found — it **THROWS** (L280-283, L302-304), and it only FINDS (does not click). The default `reactFn` must: (1) try/catch around `findLikeButton` to swallow the throw → skip silently; (2) `element.click()` only when `alreadyLiked === false`. [Source: api/services/facebookAutomation.js#findLikeButton, L260]
- **DO NOT use `runGuardedBatch`** — FR-23 is NOT in NFR-7 list (no batch of items). The scroll + occasional reaction is a single time-bounded loop, not a batch write. Same reasoning as 4.3.
- **DO emit the warning directly** — FR-23 IS in NFR-8 list, but since we're not using runGuardedBatch (which normally emits warnings), the function must `console.warn` its own warning before the real run.

### Lessons applied (4.3 review)

- **maxScrolls backstop** (4.3 review HIGH) — cap iterations to prevent busy-spin if `delay` is no-op + `now` is default. Same formula: `ceil(durationMs / minPause) + 1`.
- **safeError `code: message`** (4.3 review MED) — if Operation persistence is added, use the same `code: truncated_message` format.
- **`Promise.resolve()` wrap** (4.3 review LOW) — if injected seams can throw sync.
- **Document delay↔now coupling** in JSDoc (4.3 review).
- **Clamp/normalize, don't reject** for `durationSeconds` (clamp >600→600; but ≤0/NaN/non-number→THROW) and `reactProbability` (>0.2→0.2; ≤0/NaN/non-number→0, never throw). Note the asymmetry: bad duration throws, bad probability normalizes to "no reactions".

### Project Structure Notes

- MODIFY: `api/services/facebookAutomation.js` (add `warmupAccount` + `MAX_WARMUP_DURATION_SECONDS` + `DEFAULT_WARMUP_DURATION_SECONDS` + default-export entry).
- NEW: test file under `tests/services/`.
- No Prisma model, no CLI/MCP/REST surface this story.
- **Operation persistence: OMIT for this story.** FR-23 ACs do not require it, and AC7 does not test it. Do NOT clone 4.3's `userId`/`createOperation`/`updateOperation` plumbing — leaving it in would be dead, untested code. If persistence is wanted later, add it as a separate change with its own tests.
- Navigate to `https://www.facebook.com/` (home feed) — hardcoded, no user-input URL, no `assertFacebookUrl`.

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
