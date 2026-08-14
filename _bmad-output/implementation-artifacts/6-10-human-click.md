---
baseline_commit: 2be628a
---

# Story 6.10: Human Click with Hover

Status: done

## Story

As a developer using the Facebook automation scraper,
I want click simulation with hover pause and realistic mouse down/up timing,
So that Facebook doesn't detect instant or mechanical clicks (per ADR-014).

## Acceptance Criteria

1. **AC1 — `humanClick(page, element, options)` exists in `src/scrapers/facebook/human.js`**
   - **Given** the existing module `src/scrapers/facebook/human.js` (created in Story 6.9)
   - **When** it is imported
   - **Then** `humanClick` is an exported async function
   - **And** `human.js` remains a pure module — does NOT import puppeteer (receives `page` and `element` as parameters)
   - **And** the function signature is `(page, element, { delayFn, rng } = {})`

2. **AC2 — Hover pause 100-400ms before click**
   - **Given** `humanClick(page, element)` is called
   - **When** the click sequence executes
   - **Then** there is a hover pause of 100-400ms (randomized) BEFORE the mouse down
   - **And** the pause duration is randomized via `rng`

3. **AC3 — Mouse down → hold 30-120ms → mouse up**
   - **Given** the hover pause has completed
   - **When** the click action executes
   - **Then** `page.mouse.down()` is called
   - **And** a hold delay of 30-120ms (randomized) occurs
   - **And** `page.mouse.up()` is called after the hold
   - **And** the order is strictly: down → delay → up (not a single `click()` call)

4. **AC4 — Uses element handle, not coordinates**
   - **Given** `humanClick(page, element)` is called with an element handle
   - **When** the click executes
   - **Then** the element handle is used to get the bounding box via `element.boundingBox()`
   - **And** the mouse is moved to the element's center via `humanMoveMouse` (reuse from Story 6.9)
   - **And** the click is performed at the element's center position
   - **And** if `boundingBox()` returns null, the function throws a generic error (no sensitive data in message, NFR4)

5. **AC5 — `delayFn` seam for testing (NFR3)**
   - **Given** `humanClick(page, element, { delayFn })` is called with a custom `delayFn`
   - **When** the click sequence executes
   - **Then** the custom `delayFn` is used for all delays (hover pause, hold)
   - **And** tests can inject `vi.fn()` to verify call count without waiting

6. **AC6 — `rng` seam for deterministic testing**
   - **Given** `humanClick(page, element, { rng })` is called with a custom `rng` function
   - **When** the click sequence executes
   - **Then** the custom `rng` is used for all random decisions (hover duration, hold duration)
   - **And** tests can inject a seeded RNG for deterministic behavior

7. **AC7 — Reuses `humanMoveMouse` from Story 6.9**
   - **Given** `humanClick` needs to move the mouse to the element
   - **When** the click sequence starts
   - **Then** `humanMoveMouse(page, centerX, centerY, { delayFn, rng })` is called
   - **And** the `delayFn` and `rng` seams are passed through to `humanMoveMouse`
   - **And** the function does NOT reimplement Bezier curve logic

8. **AC8 — Total click time <1s (NFR1)**
   - **Given** `humanClick(page, element)` is called with default `delayFn`
   - **When** the click completes (excluding the mouse movement from `humanMoveMouse`)
   - **Then** total elapsed time for hover + hold is <1 second
   - **And** hover pause is 100-400ms, hold is 30-120ms → max 520ms

9. **AC9 — No regression in existing tests**
   - **Given** the new `humanClick` export is added to `human.js`
   - **When** existing tests run
   - **Then** all existing tests in `tests/scrapers/` still pass
   - **And** `humanMoveMouse` (Story 6.9) still works unchanged
   - **And** the new export does not break any existing imports

## Tasks / Subtasks

- [x] **Task 1: Implement `humanClick` in `src/scrapers/facebook/human.js`** (AC: #1, #2, #3, #4, #5, #6, #7, #8)
  - [x] 1.1 Add `humanClick(page, element, { delayFn, rng } = {})` export to existing `human.js`
  - [x] 1.2 Update module header JSDoc to include `humanClick` in Exports section
  - [x] 1.3 Update Scope section: change "Story 6.10 (future)" to "Story 6.10: humanClick (hover pause, mouse down/up)"
  - [x] 1.4 Implement click sequence:
    - Call `element.boundingBox()` to get `{ x, y, width, height }`
    - If null, throw generic Error (no sensitive data — NFR4)
    - Calculate center: `centerX = x + width / 2`, `centerY = y + height / 2`
    - Call `humanMoveMouse(page, centerX, centerY, { delayFn, rng })` to move to element
    - Hover pause: `await delayFn(100 + rng() * 300)` (100-400ms)
    - Mouse down: `await page.mouse.down()`
    - Hold: `await delayFn(30 + rng() * 90)` (30-120ms)
    - Mouse up: `await page.mouse.up()`
  - [x] 1.5 Export `humanClick` alongside existing `humanMoveMouse`

- [x] **Task 2: Add `boundingBox` to fake ElementHandle in `tests/helpers/fake-page.js`** (AC: #4)
  - [x] 2.1 Add `boundingBox: async () => spec.boundingBox ?? null` to `makeElementHandle`
  - [x] 2.2 Default `boundingBox` to `{ x: 100, y: 200, width: 50, height: 30 }` if not specified in spec
  - [x] 2.3 Verify existing element handle tests still pass (no regression)

- [x] **Task 3: Write tests for `humanClick` in `tests/scrapers/facebook-human.test.js`** (AC: #1-#8)
  - [x] 3.1 Test: `humanClick` is an async function (AC1)
  - [x] 3.2 Test: calls `humanMoveMouse` to move to element center (AC4, AC7)
  - [x] 3.3 Test: hover pause 100-400ms occurs before mouse down (AC2)
  - [x] 3.4 Test: `page.mouse.down()` is called exactly once (AC3)
  - [x] 3.5 Test: `page.mouse.up()` is called exactly once after down (AC3)
  - [x] 3.6 Test: hold delay 30-120ms occurs between down and up (AC3)
  - [x] 3.7 Test: order is strictly down → delay → up (not `page.mouse.click()`) (AC3)
  - [x] 3.8 Test: `delayFn` seam is used for hover and hold delays (AC5)
  - [x] 3.9 Test: `rng` seam is used for hover and hold duration randomization (AC6)
  - [x] 3.10 Test: throws when `boundingBox()` returns null (AC4, NFR4)
  - [x] 3.11 Test: error message does not contain sensitive data (NFR4)
  - [x] 3.12 Test: uses element center coordinates (x + width/2, y + height/2) (AC4)
  - [x] 3.13 Test: does NOT call `page.mouse.click()` — uses down/up separately (AC3)
  - [x] 3.14 Test: `humanMoveMouse` is still exported and works (AC9 — no regression)

- [x] **Task 4: Run full test suite + verify no regressions** (AC: #9)
  - [x] 4.1 Run `vitest run tests/scrapers/facebook-human.test.js` — all pass (28/28: 14 existing + 14 new)
  - [x] 4.2 Run `vitest run tests/scrapers/facebook-fingerprint.test.js` — all pass
  - [x] 4.3 Run `vitest run tests/scrapers/facebook-auth.test.js` — all pass
  - [x] 4.4 Run `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` — all pass (12/12)

## Dev Notes

### Architecture Compliance (ADR-014 — binding)

- `human.js` is a **pure module** — no puppeteer import (same as `fingerprint.js`)
- `humanClick(page, element, { delayFn, rng })` — `page` and `element` passed as parameters
- `delayFn` default = `setTimeout`-based; tests inject `vi.fn()` (NFR3)
- `rng` default = `Math.random`; tests inject seeded RNG for determinism
- Total click time (hover + hold) <1s (NFR1) — max 520ms
- **MUST reuse `humanMoveMouse`** from Story 6.9 — do NOT reimplement Bezier curve
- `delayFn` and `rng` seams MUST be passed through to `humanMoveMouse`

### ADR-014 Spec (binding)

From `architecture.md` ADR-014:
> Human click: hover 100-400ms, mouse down → hold 30-120ms → mouse up, dùng element handle (không coordinate).

### Implementation Pattern (follow Story 6.9 exactly)

Story 6.9 established the pattern for `human.js`:
1. Default seams at top: `defaultDelayFn`, `defaultRng`
2. Helper functions (e.g., `cubicBezier`)
3. Exported functions with JSDoc
4. Options destructured in function body: `const { delayFn = defaultDelayFn, rng = defaultRng } = options;`
5. `await page.mouse.move(...)` / `await page.mouse.down()` / `await page.mouse.up()` calls

**Follow this exact pattern for `humanClick`.**

### Click Sequence (strict order)

```
1. element.boundingBox() → { x, y, width, height }
2. centerX = x + width / 2, centerY = y + height / 2
3. humanMoveMouse(page, centerX, centerY, { delayFn, rng })  // Bezier move to element
4. await delayFn(100 + rng() * 300)                           // Hover pause 100-400ms
5. await page.mouse.down()                                    // Mouse down
6. await delayFn(30 + rng() * 90)                             // Hold 30-120ms
7. await page.mouse.up()                                      // Mouse up
```

**Do NOT use `page.mouse.click()` or `element.click()`** — the spec requires separate down/up with a hold delay between them (AC3).

### Error Handling (NFR4)

If `element.boundingBox()` returns null:
```js
throw new Error('humanClick: element has no bounding box (not visible or detached)');
```
- Error message must NOT contain cookie values, fingerprint data, or tokens (NFR4)
- Generic message is sufficient — the caller knows which element they passed

### Test Helper Updates

`tests/helpers/fake-page.js` → `makeElementHandle` needs `boundingBox` method:
```js
boundingBox: async () => spec.boundingBox ?? { x: 100, y: 200, width: 50, height: 30 },
```

This allows tests to create element handles with custom bounding boxes or use the default.

### Scope Boundaries (STRICT)

- **In scope:** `humanClick` function only (Story 6.10)
- **Out of scope:**
  - `humanType` (Story 6.11)
  - `humanScroll` (Story 6.12)
  - Integration into `shareLinkByUid` (future story)
  - Integration into `facebookAutomation` (future story)
  - Modifying `humanMoveMouse` (Story 6.9 — done, do not touch)

### Previous Story Intelligence (Story 6.9)

**Files created in Story 6.9:**
- `src/scrapers/facebook/human.js` — 161 lines, exports `humanMoveMouse`
- `tests/scrapers/facebook-human.test.js` — 188 lines, 14 tests
- `tests/helpers/fake-page.js` — added `mouse` object (move, click, down, up)

**Patterns established:**
- Pure module, no puppeteer import
- `delayFn` and `rng` seams with defaults
- JSDoc with `@param`, `@returns`
- Tests use `makeFakePage()` and inject `delayFn: async () => {}` for speed
- Tests verify seam usage with `vi.fn()`
- Real-browser test script (`test-human-mouse-real.mjs`) for live verification

**Code review finding (Story 6.9):**
- Correction loop jitter was ±1px, patched to ±2px to comply with AC3
- Lesson: ensure all randomization ranges match AC spec exactly

### Key Files

- [Source: src/scrapers/facebook/human.js] — UPDATE file, add `humanClick` export
- [Source: tests/helpers/fake-page.js] — UPDATE file, add `boundingBox` to element handle
- [Source: tests/scrapers/facebook-human.test.js] — UPDATE file, add `humanClick` tests
- [Reference: _bmad-output/planning-artifacts/epics-full.md] — Epic 6, Story 6.10 spec (lines 796-808)
- [Reference: _bmad-output/planning-artifacts/architecture.md] — ADR-014 (lines 714-728)

## Dev Agent Record

### Agent Model Used

GLM-5.2 High (Devin CLI)

### Debug Log References

- Unit tests: `npx vitest run tests/scrapers/facebook-human.test.js` → 28/28 pass (14 Story 6.9 + 14 Story 6.10)
- No-regression: `npx vitest run tests/scrapers/facebook-fingerprint.test.js tests/scrapers/facebook-auth.test.js` → 92/92 pass
- createPage tests: `npx vitest run tests/scrapers/facebook-index.test.js -t "createPage"` → 12/12 pass

### Completion Notes List

- All 9 ACs satisfied
- `humanClick` reuses `humanMoveMouse` from Story 6.9 (AC7) — no Bezier reimplementation
- Click sequence: boundingBox → humanMoveMouse → hover 100-400ms → mouse.down() → hold 30-120ms → mouse.up()
- Does NOT use `page.mouse.click()` — separate down/up with hold delay (AC3)
- `delayFn` and `rng` seams passed through to `humanMoveMouse` (AC5, AC6)
- Error on null boundingBox is generic — no sensitive data (NFR4)
- Exported `makeElementHandle` from fake-page.js for standalone element handle creation in tests
- Used `'boundingBox' in spec` check (not `??`) so `spec.boundingBox = null` is respected

### File List

- `src/scrapers/facebook/human.js` — Added `humanClick` export (53 new lines)
- `tests/helpers/fake-page.js` — Added `boundingBox` to element handle, exported `makeElementHandle`
- `tests/scrapers/facebook-human.test.js` — Added 14 `humanClick` tests (138 new lines)

## Change Log
