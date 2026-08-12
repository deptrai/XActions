---
baseline_commit: c6c9552
---

# Story 6.12: Natural Scrolling

Status: done

## Story

As a developer using the Facebook automation scraper,
I want scrolling with variable speed and momentum,
So that Facebook doesn't detect fixed-distance scrolls (per ADR-014).

## Acceptance Criteria

1. **AC1 — `humanScroll(page, distance, options)` exists in `src/scrapers/facebook/human.js`**
   - **Given** the existing module `src/scrapers/facebook/human.js` (Stories 6.9–6.11)
   - **When** it is imported
   - **Then** `humanScroll` is an exported async function
   - **And** `human.js` remains a pure module — does NOT import puppeteer (receives `page` as parameter)
   - **And** the function signature is `(page, distance, { delayFn, rng } = {})`

2. **AC2 — Scroll divided into 5-10 chunks with variable speed**
   - **Given** `humanScroll(page, 1000)` is called
   - **When** the scroll executes
   - **Then** the scroll is divided into 5-10 chunks (randomized via `rng`)
   - **And** each chunk scrolls a portion of the total distance
   - **And** the chunk count is randomized between 5 and 10 per call

3. **AC3 — Speed follows sin curve (slow → fast → slow)**
   - **Given** a scroll with multiple chunks
   - **When** each chunk distance is calculated
   - **Then** the per-chunk distance follows a sine curve over the chunk index
   - **And** early and late chunks are smaller (slower) than middle chunks
   - **And** the middle chunk(s) are the largest (fastest)

4. **AC4 — 20% chance overshoot + correction**
   - **Given** `humanScroll(page, 1000)` is called
   - **When** the scroll executes
   - **Then** there is a 20% chance the scroll overshoots the target distance
   - **And** if overshoot occurs, the page scrolls past the target then corrects back
   - **And** the overshoot distance is 5-15% of the target (not fixed px)

5. **AC5 — Delay 100-400ms between chunks**
   - **Given** a scroll with multiple chunks
   - **When** the scroll executes
   - **Then** a delay of 100-400ms (randomized) occurs between chunks
   - **And** the delay is randomized via `rng`

6. **AC6 — `delayFn` seam for testing (NFR3)**
   - **Given** `humanScroll(page, 1000, { delayFn })` is called with a custom `delayFn`
   - **When** the scroll executes
   - **Then** the custom `delayFn` is used for all inter-chunk delays
   - **And** tests can inject `vi.fn()` to verify call count without waiting

7. **AC7 — `rng` seam for deterministic testing**
   - **Given** `humanScroll(page, 1000, { rng })` is called with a custom `rng` function
   - **When** the scroll executes
   - **Then** the custom `rng` is used for all random decisions (chunk count, chunk sizes, overshoot, delays)
   - **And** tests can inject a seeded RNG for deterministic behavior

8. **AC8 — Total scroll time reasonable (NFR1)**
   - **Given** `humanScroll(page, 1000)` is called with default `delayFn`
   - **When** the scroll completes
   - **Then** total elapsed time is <6 seconds for typical distances
   - **And** the total is bounded by (chunk count × 400ms max + wheel dispatch time)

9. **AC9 — No regression in existing tests**
   - **Given** the new `humanScroll` export is added to `human.js`
   - **When** existing tests run
   - **Then** all existing tests in `tests/scrapers/facebook-human.test.js` still pass (42 from Stories 6.9–6.11)
   - **And** `humanMoveMouse`, `humanClick`, and `humanType` still work unchanged
   - **And** the new export does not break any existing imports

## Tasks / Subtasks

- [x] **Task 1: Add `mouse.wheel` to `tests/helpers/fake-page.js`** (AC: #6, #7, #9)
  - [x] 1.1 Add `wheel: async (delta) => { calls.mouse.wheel.push(delta); }` to `mouse` object
  - [x] 1.2 Initialize `calls.mouse.wheel = []` in `calls` object
  - [x] 1.3 Verify existing fake-page tests still pass (no regression)

- [x] **Task 2: Implement `humanScroll` in `src/scrapers/facebook/human.js`** (AC: #1-#8)
  - [x] 2.1 Update module header JSDoc: add `humanScroll` to Exports, change Scope "Story 6.12 (future)" to "Story 6.12: humanScroll (sin curve, chunks)"
  - [x] 2.2 Add `humanScroll(page, distance, { delayFn, rng } = {})` export to existing `human.js`
  - [x] 2.3 Determine chunk count: `chunkCount = 5 + Math.floor(rng() * 6)` (5..10)
  - [x] 2.4 Compute sin-curve weights for each chunk: `weight = 0.5 + 0.5 * Math.sin((i + 0.5) / chunkCount * Math.PI)`
  - [x] 2.5 Compute raw chunk distances: `chunkDist = totalWeight * distance`
  - [x] 2.6 Round chunk distances to integers, preserving sum (adjust last chunk to cover rounding error)
  - [x] 2.7 20% overshoot chance: `if (rng() < 0.2)` overshoot by 5-15% (5 + rng() * 10 percent)
  - [x] 2.8 If overshoot: add extra chunk(s) past target, then correction chunk(s) back
  - [x] 2.9 Call `page.mouse.wheel({ deltaY: chunkDistance })` for each chunk
  - [x] 2.10 Call `delayFn(100 + rng() * 300)` between chunks

- [x] **Task 3: Write tests for `humanScroll` in `tests/scrapers/facebook-human.test.js`** (AC: #1-#9)
  - [x] 3.1 Test: `humanScroll` is an async function (AC1)
  - [x] 3.2 Test: `page.mouse.wheel` called 5-10 times (AC2)
  - [x] 3.3 Test: sum of all `deltaY` values equals input `distance` (AC2, AC3)
  - [x] 3.4 Test: middle chunk is largest (sin curve slow-fast-slow) (AC3)
  - [x] 3.5 Test: first and last chunks are smaller than middle (AC3)
  - [x] 3.6 Test: 20% overshoot triggers with rng=0.0 and adds correction (AC4)
  - [x] 3.7 Test: delay 100-400ms between chunks (AC5)
  - [x] 3.8 Test: `delayFn` seam used for all inter-chunk delays (AC6)
  - [x] 3.9 Test: `rng` seam used for all random decisions (AC7)
  - [x] 3.10 Test: zero distance → no wheel calls (edge case)
  - [x] 3.11 Test: negative distance works (scrolls up, chunks are negative)
  - [x] 3.12 Test: `humanMoveMouse`, `humanClick`, `humanType` still work (AC9 — no regression)

- [x] **Task 4: Run full test suite + verify no regressions** (AC: #9)
  - [x] 4.1 Run `vitest run tests/scrapers/facebook-human.test.js` — all pass (57/57: 42 existing + 15 new)
  - [x] 4.2 Run `vitest run tests/scrapers/facebook-fingerprint.test.js` — all pass
  - [x] 4.3 Run `vitest run tests/scrapers/facebook-auth.test.js` — all pass
  - [x] 4.4 Run `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` — all pass (12/12)

### Review Findings

- [x] **[Review][Patch] Small-distance scroll behavior clamped** `[src/scrapers/facebook/human.js:360-364]`
  - Resolved by clamping chunk count to `Math.max(1, Math.min(Math.abs(distance), desiredChunkCount))`.
  - For `distance = ±1`, only one 1-px wheel call; for `distance = 3`, at most 3 non-zero chunks. Added 3 regression tests.
  - Overshoot for `distance = 1` still falls back to `±1px`; this is the unavoidable minimum pixel overshoot and is acceptable for sub-20px distances.

- [x] **[Review][Defer] No input validation for `page`, `distance`, `delayFn`, `rng`** `[src/scrapers/facebook/human.js:352-356]`
  - Same pattern as `humanMoveMouse`, `humanClick`, and `humanType` (pre-existing). No production call sites for `humanScroll` currently exist. Defer to a cross-cutting validation/refactor story for all `human.*` functions.

## Dev Notes

### Architecture Compliance (ADR-014 — binding)

- `human.js` is a **pure module** — no puppeteer import (same as `fingerprint.js`)
- `humanScroll(page, distance, { delayFn, rng })` — `page` passed as parameter
- `delayFn` default = `setTimeout`-based; tests inject `vi.fn()` (NFR3)
- `rng` default = `Math.random`; tests inject seeded RNG for determinism
- **MUST NOT reimplement** mouse movement, click, or typing logic — this story only scrolls

### ADR-014 Spec (binding)

From `architecture.md` ADR-014:
> Scrolling: 5-10 chunks, sin curve speed, 20% overshoot + correction, 100-400ms giữa chunks.

### Implementation Pattern (follow Stories 6.9–6.11 exactly)

Stories 6.9–6.11 established the pattern for `human.js`:
1. Default seams at top: `defaultDelayFn`, `defaultRng`
2. Helper functions (e.g., `cubicBezier`, `getTypoChar`, `QWERTY_ADJACENT`)
3. Exported functions with JSDoc
4. Options destructured in function body: `const { delayFn = defaultDelayFn, rng = defaultRng } = options;`
5. `await page.mouse.*(...)` / `await page.keyboard.*(...)` calls

**Follow this exact pattern for `humanScroll`.**

### Sin-Curve Chunk Sizing

For `chunkCount` chunks, compute a weight for each chunk `i` (0-indexed):

```js
const t = (i + 0.5) / chunkCount; // midpoint of chunk in [0, 1]
const weight = 0.5 + 0.5 * Math.sin(t * Math.PI); // starts low, peaks at 0.5, ends low
```

This creates a smooth acceleration/deceleration profile:
- First chunk: weight ≈ 0.5 (slow start)
- Middle chunk: weight ≈ 1.0 (fastest)
- Last chunk: weight ≈ 0.5 (slow end)

Then:
```js
const totalWeight = weights.reduce((a, b) => a + b, 0);
const rawDistances = weights.map(w => (w / totalWeight) * distance);
```

Round to integers and adjust the last chunk so the sum exactly equals `distance`:
```js
const rounded = rawDistances.map(d => Math.round(d));
const adjustment = distance - rounded.reduce((a, b) => a + b, 0);
rounded[rounded.length - 1] += adjustment;
```

### Overshoot Logic

```
willOvershoot = rng() < 0.2
if (willOvershoot:
  overshootPercent = 0.05 + rng() * 0.10  // 5-15%
  overshootDistance = Math.round(distance * overshootPercent)
  // The last chunk goes beyond target by overshootDistance
  // Then a correction chunk scrolls back by overshootDistance
```

Implementation approach: compute base chunks that sum to `distance`, then if overshoot:
- Replace the final base chunk with two chunks: one that ends at `distance` and one that goes `overshootDistance` past
- Add a correction chunk of `-overshootDistance` to scroll back

Simpler implementation: after all base chunks that sum to `distance`, if overshoot:
- Append an overshoot chunk of `+overshootDistance`
- Append a correction chunk of `-overshootDistance`

But this means the **total scroll distance after all chunks is `distance`**, not `distance + overshoot - overshoot = distance`. The user sees the page scroll to `distance`, then past, then back. **This is correct behavior** — overshoot then correction.

### Wheel Calls (Puppeteer API)

Puppeteer `page.mouse.wheel({ deltaY })` dispatches a mouse wheel event with the given delta. For tests, fake `page.mouse.wheel` just records the `deltaY` value.

```js
await page.mouse.wheel({ deltaY: chunkDistance });
```

### Inter-Chunk Delay

Between each wheel call:
```js
await delayFn(100 + rng() * 300); // 100-400ms
```

No delay after the final chunk.

### Edge Cases

- **Zero distance:** No wheel calls, return immediately
- **Negative distance:** Chunks computed the same way (negative raw distances), sin curve still applies; page scrolls up
- **Small distance with overshoot:** If `overshootDistance` rounds to 0, skip overshoot (or treat as 1 if non-zero)

### Test Helper Update

`tests/helpers/fake-page.js` needs `page.mouse.wheel`:

```js
const mouse = {
  move: async (x, y, opts) => { calls.mouse.move.push({ x, y, opts }); },
  click: async (x, y, opts) => { calls.mouse.click.push({ x, y, opts }); },
  down: async (opts) => { calls.mouse.down.push(opts); },
  up: async (opts) => { calls.mouse.up.push(opts); },
  wheel: async (delta) => { calls.mouse.wheel.push(delta); },  // NEW for Story 6.12
};
```

And in `calls`:
```js
const calls = {
  ...
  mouse: { move: [], click: [], down: [], up: [], wheel: [] },  // add wheel
};
```

### Scope Boundaries (STRICT)

- **In scope:** `humanScroll` function only (Story 6.12)
- **Out of scope:**
  - Integration into `shareLinkByUid` (future story)
  - Integration into `facebookAutomation` (future story)
  - Modifying `humanMoveMouse`, `humanClick`, `humanType` (previous stories — done, do not touch)

### Previous Story Intelligence (Stories 6.9–6.11)

**Files created/modified in Stories 6.9–6.11:**
- `src/scrapers/facebook/human.js` — 325 lines, exports `humanMoveMouse`, `humanClick`, `humanType`
- `tests/scrapers/facebook-human.test.js` — 42 tests (14 + 14 + 14)
- `tests/helpers/fake-page.js` — `mouse` (move, click, down, up) + `keyboard` (type, press, down, up)

**Patterns established:**
- Pure module, no puppeteer import
- `delayFn` and `rng` seams with defaults
- JSDoc with `@param`, `@returns`
- Tests use `makeFakePage()` and inject `delayFn: async () => {}` for speed
- Tests verify seam usage with `vi.fn()`
- Real-browser test scripts for each function

**Code review findings:**
- Story 6.9: correction loop jitter patched from ±1px to ±2px
- Story 6.10: used separate `mouse.down()` + `mouse.up()` not `mouse.click()`
- Story 6.11: typo rate fixed at 1.5%, QWERTY map for plausible typos

### Key Files

- [Source: src/scrapers/facebook/human.js] — UPDATE file, add `humanScroll` export
- [Source: tests/helpers/fake-page.js] — UPDATE file, add `mouse.wheel` recorder
- [Source: tests/scrapers/facebook-human.test.js] — UPDATE file, add `humanScroll` tests
- [Reference: _bmad-output/planning-artifacts/epics-full.md] — Epic 6, Story 6.12 spec (lines 825-838)
- [Reference: _bmad-output/planning-artifacts/architecture.md] — ADR-014 (lines 714-728)

## Dev Agent Record

### Agent Model Used

GLM-5.2 High (Devin CLI)

### Debug Log References

- Unit tests: `npx vitest run tests/scrapers/facebook-human.test.js` → 54/54 pass (42 existing + 12 new)
- No-regression: `npx vitest run tests/scrapers/facebook-fingerprint.test.js tests/scrapers/facebook-auth.test.js` → 92/92 pass
- createPage tests: `npx vitest run tests/scrapers/facebook-index.test.js -t "createPage"` → 12/12 pass
- Post-review patch tests: `npx vitest run tests/scrapers/facebook-human.test.js` → 57/57 pass

### Completion Notes List

- All 9 ACs satisfied
- `humanScroll(page, distance, { delayFn, rng })` added to `human.js`
- 5-10 chunks with sin-curve sizing (slow → fast → slow)
- Chunk distances rounded to integers; last chunk adjusted to preserve exact `distance` sum
- 20% overshoot chance: 5-15% past target, then correction chunk back
- 100-400ms inter-chunk delay
- `page.mouse.wheel({ deltaY })` for each chunk
- Zero distance returns immediately; negative distance supported
- `fake-page.js` updated with `mouse.wheel` recorder
- No regressions in `humanMoveMouse`, `humanClick`, `humanType`

### File List

- `src/scrapers/facebook/human.js` — Added `humanScroll` export
- `tests/helpers/fake-page.js` — Added `mouse.wheel` recorder
- `tests/scrapers/facebook-human.test.js` — Added 12 `humanScroll` tests

## Change Log
