---
baseline_commit: 14242c8
---

# Story 6.11: Typing with Typos

Status: done

## Story

As a developer using the Facebook automation scraper,
I want typing simulation with variable speed and typos,
So that Facebook doesn't detect mechanical typing (per ADR-014).

## Acceptance Criteria

1. **AC1 — `humanType(page, text, options)` exists in `src/scrapers/facebook/human.js`**
   - **Given** the existing module `src/scrapers/facebook/human.js` (Stories 6.9 + 6.10)
   - **When** it is imported
   - **Then** `humanType` is an exported async function
   - **And** `human.js` remains a pure module — does NOT import puppeteer (receives `page` as parameter)
   - **And** the function signature is `(page, text, { delayFn, rng } = {})`

2. **AC2 — Each character has variable delay 80-120ms**
   - **Given** `humanType(page, text)` is called with text
   - **When** each character is typed
   - **Then** `page.keyboard.type(char)` is called for each character (one at a time)
   - **And** a delay of 80-120ms (randomized) occurs after each character
   - **And** the delay is randomized via `rng`

3. **AC3 — Typo rate 1-2% for alphabet characters**
   - **Given** an alphabet character is about to be typed
   - **When** `rng()` determines whether to make a typo
   - **Then** there is a 1-2% chance (randomized threshold) the character is mistyped
   - **And** typos only apply to alphabet characters `[a-zA-Z]` (not digits, spaces, or punctuation)
   - **And** the typo character is a random adjacent key on QWERTY layout (not a random char)

4. **AC4 — Typo sequence: type wrong → pause → backspace → retype**
   - **Given** a typo is triggered for a character
   - **When** the typo sequence executes
   - **Then** the wrong character is typed via `page.keyboard.type(wrongChar)`
   - **And** a pause of 100-300ms occurs (realization delay — human notices the mistake)
   - **And** `page.keyboard.press('Backspace')` is called to delete the wrong character
   - **And** the correct character is typed via `page.keyboard.type(correctChar)`
   - **And** the normal 80-120ms delay follows the correct character

5. **AC5 — Pause 100-300ms between words, 200-500ms after punctuation**
   - **Given** a character is typed
   - **When** the next character is processed
   - **Then** if the current character is a space (word boundary), the delay before the next character is 100-300ms (instead of 80-120ms)
   - **And** if the current character is punctuation `[.,!?;:]`, the delay before the next character is 200-500ms
   - **And** these word/punctuation pauses replace the normal 80-120ms delay (they don't stack)

6. **AC6 — `delayFn` seam for testing (NFR3)**
   - **Given** `humanType(page, text, { delayFn })` is called with a custom `delayFn`
   - **When** the typing sequence executes
   - **Then** the custom `delayFn` is used for all delays (per-char, typo pause, word pause, punctuation pause)
   - **And** tests can inject `vi.fn()` to verify call count without waiting

7. **AC7 — `rng` seam for deterministic testing**
   - **Given** `humanType(page, text, { rng })` is called with a custom `rng` function
   - **When** the typing sequence executes
   - **Then** the custom `rng` is used for all random decisions (delay duration, typo decision, typo character, word/punctuation pause)
   - **And** tests can inject a seeded RNG for deterministic behavior

8. **AC8 — Total typing time reasonable (NFR1)**
   - **Given** `humanType(page, text)` is called with default `delayFn`
   - **When** the typing completes
   - **Then** total elapsed time is proportional to text length (no infinite loops, no hangs)
   - **And** for a 50-character text, total time is <15s (50 chars × ~120ms + pauses ≈ 6-10s)

9. **AC9 — No regression in existing tests**
   - **Given** the new `humanType` export is added to `human.js`
   - **When** existing tests run
   - **Then** all existing tests in `tests/scrapers/facebook-human.test.js` still pass (28 from Stories 6.9 + 6.10)
   - **And** `humanMoveMouse` and `humanClick` still work unchanged
   - **And** the new export does not break any existing imports

## Tasks / Subtasks

- [x] **Task 1: Implement `humanType` in `src/scrapers/facebook/human.js`** (AC: #1-#8)
  - [x] 1.1 Add `humanType(page, text, { delayFn, rng } = {})` export to existing `human.js`
  - [x] 1.2 Update module header JSDoc: add `humanType` to Exports, change Scope "Story 6.11 (future)" to "Story 6.11: humanType (variable speed, typos)"
  - [x] 1.3 Add QWERTY adjacent-key map helper (for typo character selection)
  - [x] 1.4 Implement typing loop:
    - For each character in `text`:
      - Determine if char is alphabet `[a-zA-Z]`
      - If alphabet and `rng() < 0.015` (1.5% typo rate): trigger typo sequence
        - Type wrong char (adjacent QWERTY key): `await page.keyboard.type(wrongChar)`
        - Pause 100-300ms: `await delayFn(100 + rng() * 200)`
        - Backspace: `await page.keyboard.press('Backspace')`
        - Type correct char: `await page.keyboard.type(char)`
      - Else: type char normally: `await page.keyboard.type(char)`
      - Determine delay after this char:
        - If char is space `' '`: delay 100-300ms: `await delayFn(100 + rng() * 200)`
        - Else if char matches `[.,!?;:]`: delay 200-500ms: `await delayFn(200 + rng() * 300)`
        - Else: delay 80-120ms: `await delayFn(80 + rng() * 40)`
  - [x] 1.5 Export `humanType` alongside existing `humanMoveMouse` and `humanClick`

- [x] **Task 2: Write tests for `humanType` in `tests/scrapers/facebook-human.test.js`** (AC: #1-#9)
  - [x] 2.1 Test: `humanType` is an async function (AC1)
  - [x] 2.2 Test: calls `page.keyboard.type` for each character (AC2)
  - [x] 2.3 Test: delay 80-120ms after each normal character (AC2)
  - [x] 2.4 Test: typo rate 1.5% — with seeded rng, verify typo triggers at expected threshold (AC3)
  - [x] 2.5 Test: typos only apply to alphabet characters, not digits/spaces/punctuation (AC3)
  - [x] 2.6 Test: typo sequence is type-wrong → pause → backspace → retype (AC4)
  - [x] 2.7 Test: typo pause is 100-300ms (AC4)
  - [x] 2.8 Test: word pause 100-300ms after space character (AC5)
  - [x] 2.9 Test: punctuation pause 200-500ms after `[.,!?;:]` (AC5)
  - [x] 2.10 Test: `delayFn` seam is used for all delays (AC6)
  - [x] 2.11 Test: `rng` seam is used for all random decisions (AC7)
  - [x] 2.12 Test: empty string — no keyboard.type calls (edge case)
  - [x] 2.13 Test: single character — one keyboard.type call
  - [x] 2.14 Test: `humanMoveMouse` and `humanClick` still work (AC9 — no regression)

- [x] **Task 3: Run full test suite + verify no regressions** (AC: #9)
  - [x] 3.1 Run `vitest run tests/scrapers/facebook-human.test.js` — all pass (42/42: 28 existing + 14 new)
  - [x] 3.2 Run `vitest run tests/scrapers/facebook-fingerprint.test.js` — all pass
  - [x] 3.3 Run `vitest run tests/scrapers/facebook-auth.test.js` — all pass
  - [x] 3.4 Run `vitest run tests/scrapers/facebook-index.test.js -t "createPage"` — all pass (12/12)

## Dev Notes

### Architecture Compliance (ADR-014 — binding)

- `human.js` is a **pure module** — no puppeteer import (same as `fingerprint.js`)
- `humanType(page, text, { delayFn, rng })` — `page` passed as parameter
- `delayFn` default = `setTimeout`-based; tests inject `vi.fn()` (NFR3)
- `rng` default = `Math.random`; tests inject seeded RNG for determinism
- **MUST NOT reimplement** mouse movement or click logic — this story only types

### ADR-014 Spec (binding)

From `architecture.md` ADR-014:
> Typing: 80-120ms/ký tự, typo rate 1-2% (gõ sai → backspace → type lại), pause 100-300ms giữa words, 200-500ms sau punctuation.

### Implementation Pattern (follow Stories 6.9 + 6.10 exactly)

Stories 6.9 + 6.10 established the pattern for `human.js`:
1. Default seams at top: `defaultDelayFn`, `defaultRng`
2. Helper functions (e.g., `cubicBezier`)
3. Exported functions with JSDoc
4. Options destructured in function body: `const { delayFn = defaultDelayFn, rng = defaultRng } = options;`
5. `await page.keyboard.type(...)` / `await page.keyboard.press(...)` calls

**Follow this exact pattern for `humanType`.**

### QWERTY Adjacent-Key Map (for typo character selection)

When a typo occurs, the wrong character should be a **plausible typo** — an adjacent key on the QWERTY layout, not a random character. This mimics real human typing errors (finger slips to a neighboring key).

```
Row 1: q w e r t y u i o p
Row 2: a s d f g h j k l
Row 3: z x c v b n m
```

Adjacent keys (simplified — left/right neighbors on same row + same column on adjacent rows):

```js
const QWERTY_ADJACENT = {
  'a': ['q','w','s','z'], 'b': ['v','g','h','n'], 'c': ['x','d','f','v'],
  'd': ['s','e','r','f','c','x'], 'e': ['w','r','d','s'], 'f': ['d','r','g','v','c'],
  'g': ['f','t','h','b','v'], 'h': ['g','y','j','n','b'], 'i': ['u','o','k','j'],
  'j': ['h','u','k','m','n'], 'k': ['j','i','l',',','m'], 'l': ['k','o','p',';','.'],
  'm': ['n','j','k',','], 'n': ['b','h','j','m'], 'o': ['i','p','l','k'],
  'p': ['o','l',';'], 'q': ['w','a'], 'r': ['e','t','f','d'],
  's': ['a','w','e','d','z','x'], 't': ['r','y','g','f'], 'u': ['y','i','j','h'],
  'v': ['c','f','g','b'], 'w': ['q','e','s','a'], 'x': ['z','s','d','c'],
  'y': ['t','u','h','g'], 'z': ['a','s','x'],
};
```

For uppercase letters, convert to lowercase, find adjacent, then convert back if original was uppercase.

### Typo Rate Calculation

The spec says "1-2% typo rate". This means:
- `typoRate = 0.01 + rng() * 0.01` → 0.01 to 0.02 (1-2%)
- This is rolled **once per call** (not per character) — so the typo rate is consistent within a single typing session
- Then for each alphabet char: `if (rng() < typoRate)` → trigger typo

**Alternative (simpler):** Roll per character with fixed 1.5% rate: `if (rng() < 0.015)` → typo. This is also acceptable and easier to test. **Use the simpler approach** — fixed 1.5% per alphabet char, rolled per character.

### Typing Sequence (strict order per character)

```
For each char in text:
  1. If char is alphabet AND rng() < 0.015 (1.5% typo rate):
     a. wrongChar = random adjacent QWERTY key (preserve case)
     b. await page.keyboard.type(wrongChar)        // Type wrong char
     c. await delayFn(100 + rng() * 200)           // Pause 100-300ms (realization)
     d. await page.keyboard.press('Backspace')     // Delete wrong char
     e. await page.keyboard.type(char)             // Type correct char
  2. Else:
     a. await page.keyboard.type(char)             // Type char normally
  3. Delay after char:
     - If char is ' ':       await delayFn(100 + rng() * 200)  // Word pause 100-300ms
     - Else if char in [.,!?;:]: await delayFn(200 + rng() * 300) // Punctuation pause 200-500ms
     - Else:                 await delayFn(80 + rng() * 40)    // Normal 80-120ms
```

**Note:** The delay after the correct char in a typo sequence still follows the same rule (word/punctuation/normal). The typo pause (100-300ms) is separate — it's the "realization delay" between typing the wrong char and pressing backspace.

### Edge Cases

- **Empty string:** No `keyboard.type` calls, no delays — return immediately
- **Single character:** One `keyboard.type` call + one delay
- **String with only spaces:** Each space triggers word pause (100-300ms), no typos
- **String with only punctuation:** Each punctuation triggers punctuation pause (200-500ms), no typos
- **String with digits:** Digits typed normally (80-120ms), no typos (typos only for alphabet)
- **Uppercase letters:** Typos preserve case — if 'A' is mistyped, wrong char is uppercase adjacent

### Test Helper (already exists)

`tests/helpers/fake-page.js` already has `page.keyboard` with:
- `type(text, opts)` → records to `calls.keyboard.type`
- `press(key)` → records to `calls.keyboard.press`
- `down(key)` → records to `calls.keyboard.down`
- `up(key)` → records to `calls.keyboard.up`

**No changes needed to fake-page.js for this story.**

### Scope Boundaries (STRICT)

- **In scope:** `humanType` function only (Story 6.11)
- **Out of scope:**
  - `humanScroll` (Story 6.12)
  - Integration into `shareLinkByUid` (future story)
  - Integration into `facebookAutomation` (future story)
  - Modifying `humanMoveMouse` (Story 6.9 — done, do not touch)
  - Modifying `humanClick` (Story 6.10 — done, do not touch)
  - Modifying `fake-page.js` (already has keyboard support)

### Previous Story Intelligence (Stories 6.9 + 6.10)

**Files created/modified in Stories 6.9 + 6.10:**
- `src/scrapers/facebook/human.js` — 214 lines, exports `humanMoveMouse` + `humanClick`
- `tests/scrapers/facebook-human.test.js` — 28 tests (14 Story 6.9 + 14 Story 6.10)
- `tests/helpers/fake-page.js` — has `mouse` (move, click, down, up) + `keyboard` (type, press, down, up)

**Patterns established:**
- Pure module, no puppeteer import
- `delayFn` and `rng` seams with defaults
- JSDoc with `@param`, `@returns`
- Tests use `makeFakePage()` and inject `delayFn: async () => {}` for speed
- Tests verify seam usage with `vi.fn()`
- Real-browser test scripts (`test-human-mouse-real.mjs`, `test-human-click-real.mjs`)

**Code review findings (Story 6.9):**
- Correction loop jitter was ±1px, patched to ±2px to comply with AC3
- Lesson: ensure all randomization ranges match AC spec exactly

### Key Files

- [Source: src/scrapers/facebook/human.js] — UPDATE file, add `humanType` export
- [Source: tests/scrapers/facebook-human.test.js] — UPDATE file, add `humanType` tests
- [Reference: tests/helpers/fake-page.js] — NO CHANGES (already has `page.keyboard`)
- [Reference: _bmad-output/planning-artifacts/epics-full.md] — Epic 6, Story 6.11 spec (lines 810-823)
- [Reference: _bmad-output/planning-artifacts/architecture.md] — ADR-014 (lines 714-728)

## Dev Agent Record

### Agent Model Used

GLM-5.2 High (Devin CLI)

### Debug Log References

- Unit tests: `npx vitest run tests/scrapers/facebook-human.test.js` → 42/42 pass (28 existing + 14 new)
- No-regression: `npx vitest run tests/scrapers/facebook-fingerprint.test.js tests/scrapers/facebook-auth.test.js` → 92/92 pass
- createPage tests: `npx vitest run tests/scrapers/facebook-index.test.js -t "createPage"` → 12/12 pass

### Completion Notes List

- All 9 ACs satisfied
- `humanType` uses `page.keyboard.type(char)` per character, not bulk typing
- 1.5% typo rate for alphabet characters only (`[a-zA-Z]`)
- QWERTY adjacent-key map for plausible wrong characters; preserves uppercase
- Typo sequence: wrong char → 100-300ms pause → Backspace → correct char
- Word pause 100-300ms after space; punctuation pause 200-500ms after `[.,!?;:]`
- Normal delay 80-120ms for all other characters
- `delayFn` and `rng` seams follow same pattern as `humanMoveMouse`/`humanClick`
- No changes to `fake-page.js` — existing `page.keyboard.type`/`press` support sufficient
- 42 tests pass; no regressions in mouse/click tests

### File List

- `src/scrapers/facebook/human.js` — Added `humanType` export + `QWERTY_ADJACENT` map + `getTypoChar` helper
- `tests/scrapers/facebook-human.test.js` — Added 14 `humanType` tests

## Change Log
