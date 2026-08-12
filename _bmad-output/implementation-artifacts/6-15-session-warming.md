# Story 6.15: Session Warming Sequence

Status: ready-for-dev

## Story

As a developer,
I want automatic warm-up before actions,
So that Facebook doesn't detect cold-session-immediate-action.

## Acceptance Criteria

1. **AC1 — Session warming sequence is implemented as `warmSession(page, options)`**
   - **Given** an authenticated Puppeteer page
   - **When** `warmSession(page, { delayFn, rng })` is called
   - **Then** it performs the exact sequence:
     - visit homepage (`https://www.facebook.com/`)
     - wait **3-8s**
     - scroll **300-800px**
     - wait **2-6s**
     - scroll **200-500px**
     - wait **1-4s**
     - random mouse movements **3 times**
     - wait **0.5-2s** after each mouse movement

2. **AC2 — `warmSession` is a pure function with injectable seams**
   - **Given** `warmSession` is called
   - **When** it runs
   - **Then** it does NOT import Puppeteer or any browser library directly
   - **And** it uses `delayFn` and `rng` seams (default: `setTimeout`-based, `Math.random`)
   - **And** it reuses `humanScroll` and `humanMoveMouse` from `src/scrapers/facebook/human.js`
   - **And** no cookie, token, or account metadata is logged (NFR4)

3. **AC3 — `loginWithCookie` triggers session warming after successful login**
   - **Given** `loginWithCookie(page, { c_user, xs, ... })` completes successfully
   - **When** the function is about to return the page
   - **Then** it calls `warmSession(page, { delayFn, rng })` before returning
   - **And** the page is left on the homepage after warming

4. **AC4 — Debug skip option**
   - **Given** `loginWithCookie` is called with `{ headless: false, skipWarmup: true }`
   - **When** the function executes
   - **Then** the warming sequence is skipped
   - **And** the page is returned immediately after login verification

5. **AC5 — Range-randomized delays are deterministic with `rng`**
   - **Given** `warmSession(page, { rng: () => 0.5 })` is called
   - **When** the delay ranges are computed
   - **Then** the first wait is `3000 + 0.5 * 5000 = 5500ms`
   - **And** the second wait is `2000 + 0.5 * 4000 = 4000ms`
   - **And** the third wait is `1000 + 0.5 * 3000 = 2500ms`
   - **And** each post-mouse wait is `500 + 0.5 * 1500 = 1250ms`

6. **AC6 — Randomized scroll distances are deterministic with `rng`**
   - **Given** `warmSession(page, { rng: () => 0.5 })` is called
   - **When** the scroll distances are computed
   - **Then** the first scroll is `300 + 0.5 * 500 = 550px`
   - **And** the second scroll is `200 + 0.5 * 300 = 350px`

7. **AC7 — Random mouse coordinates stay within safe viewport bounds**
   - **Given** `warmSession(page, { rng: () => 0.5 })` is called
   - **When** the 3 mouse moves are computed
   - **Then** each `(x, y)` coordinate is within `[0, viewport.width]` and `[0, viewport.height]`
   - **And** `humanMoveMouse(page, x, y, { delayFn, rng })` is called 3 times

8. **AC8 — Total warming duration stays under 30 seconds**
   - **Given** `warmSession` runs with default seams
   - **When** all delays, scrolls, and mouse movements complete
   - **Then** the total duration is between ~5s and ~30s
   - **And** the function returns without crashing

9. **AC9 — No regression in existing tests**
   - **Given** all changes are applied
   - **When** the full Facebook test suite runs
   - **Then** all existing tests pass (`facebook-human`, `facebook-fingerprint`, `facebook-auth`, `facebook-index`, `facebook-limits`, `facebook-automation-batch`)

## Tasks / Subtasks

- [ ] **Task 1: Implement `warmSession` in a new pure module `src/scrapers/facebook/warmup.js`** (AC: #1, #2, #5, #6, #7, #8)
  - [ ] 1.1 Create `src/scrapers/facebook/warmup.js` with copyright header and JSDoc
  - [ ] 1.2 Add default seams: `defaultDelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms))` and `defaultRng = Math.random`
  - [ ] 1.3 Import `humanScroll` and `humanMoveMouse` from `./human.js`
  - [ ] 1.4 Export `warmSession(page, { delayFn = defaultDelayFn, rng = defaultRng, skipWarmup = false } = {})`
  - [ ] 1.5 If `skipWarmup` is `true`, return immediately
  - [ ] 1.6 Navigate to `https://www.facebook.com/` via `page.goto`
  - [ ] 1.7 Wait 3-8s using `delayFn(3000 + rng() * 5000)`
  - [ ] 1.8 Scroll 300-800px using `humanScroll(page, 300 + rng() * 500, { delayFn, rng })`
  - [ ] 1.9 Wait 2-6s using `delayFn(2000 + rng() * 4000)`
  - [ ] 1.10 Scroll 200-500px using `humanScroll(page, 200 + rng() * 300, { delayFn, rng })`
  - [ ] 1.11 Wait 1-4s using `delayFn(1000 + rng() * 3000)`
  - [ ] 1.12 For `i = 0..2`, generate `(x, y)` within viewport bounds and call `humanMoveMouse(page, x, y, { delayFn, rng })`
  - [ ] 1.13 After each mouse move, wait 0.5-2s using `delayFn(500 + rng() * 1500)`
  - [ ] 1.14 Return `{ steps: [...], durationMs }` for observability
  - [ ] 1.15 Never log `c_user`, cookies, or account metadata (NFR4)

- [ ] **Task 2: Re-export `warmSession` from `src/scrapers/facebook/index.js`** (AC: #1)
  - [ ] 2.1 Add `export { warmSession } from './warmup.js'` (or inline if team prefers, but keep `warmup.js` pure)
  - [ ] 2.2 Add `warmSession` to the default export object

- [ ] **Task 3: Integrate `warmSession` into `loginWithCookie` in `src/scrapers/facebook/index.js`** (AC: #3, #4)
  - [ ] 3.1 Accept `options` in `loginWithCookie` (some callers already pass it implicitly for `headless`)
  - [ ] 3.2 Destructure `headless` and `skipWarmup` from options
  - [ ] 3.3 After successful login verification and after setting `page._fbAccountId`, call `await warmSession(page, { delayFn, rng })`
  - [ ] 3.4 Skip warming only when `headless === false && skipWarmup === true` (debug mode, per ADR-016)
  - [ ] 3.5 Wrap `warmSession` call in try/catch: if warming fails, log a warning but do NOT throw (warming is best-effort, not a hard blocker)

- [ ] **Task 4: Write unit tests in `tests/scrapers/facebook-warmup.test.js`** (AC: #1-#8, #10)
  - [ ] 4.1 Test: `warmSession` is exported and is a function
  - [ ] 4.2 Test: `page.goto` is called with `https://www.facebook.com/`
  - [ ] 4.3 Test: first delay is in `[3000, 8000]` ms with `rng: () => 0.5` → `5500`
  - [ ] 4.4 Test: first scroll distance is in `[300, 800]` px with `rng: () => 0.5` → `550`
  - [ ] 4.5 Test: second delay is in `[2000, 6000]` ms with `rng: () => 0.5` → `4000`
  - [ ] 4.6 Test: second scroll distance is in `[200, 500]` px with `rng: () => 0.5` → `350`
  - [ ] 4.7 Test: third delay is in `[1000, 4000]` ms with `rng: () => 0.5` → `2500`
  - [ ] 4.8 Test: 3 mouse movements occur, each followed by a delay in `[500, 2000]` ms
  - [ ] 4.9 Test: `humanScroll` and `humanMoveMouse` are called with the provided `delayFn` and `rng`
  - [ ] 4.10 Test: `skipWarmup: true` makes `warmSession` return without any `page.goto` or delay calls
  - [ ] 4.11 Test: `loginWithCookie` calls `warmSession` by default (mock/spy by patching module or using a fake page)
  - [ ] 4.12 Test: `loginWithCookie` with `headless: false, skipWarmup: true` does NOT call `warmSession`

- [ ] **Task 5: Write real-browser smoke test `test-session-warming-real.mjs`** (AC: #8, #9)
  - [ ] 5.1 Use the same live-account filter pattern as `test-human-scroll-real.mjs`
  - [ ] 5.2 Login with `loginWithCookie` and verify `warmSession` runs without errors
  - [ ] 5.3 Measure total warming duration and verify `< 30000ms`
  - [ ] 5.4 Verify `page.url()` includes `facebook.com` after warming
  - [ ] 5.5 Add skip logic if no live account is available (do NOT fail the test)

- [ ] **Task 6: Run full test suite and verify no regressions** (AC: #9)
  - [ ] 6.1 Run `npx vitest run tests/scrapers/facebook-warmup.test.js`
  - [ ] 6.2 Run `npx vitest run tests/scrapers/facebook-*.test.js`
  - [ ] 6.3 Run `npx vitest run tests/services/facebook-automation-batch.test.js`
  - [ ] 6.4 Run `node test-session-warming-real.mjs` with a live account (optional, gated by env/session availability)

## Dev Notes

### Architecture Compliance (Binding ADRs)

- **ADR-016: Session lifecycle** — `loginWithCookie()` must call `warmSession(page)` after successful login, before returning the page. Warming skip condition: `headless: false && skipWarmup: true` (debug mode only). Source: `_bmad-output/planning-artifacts/architecture.md` lines 752-762.
- **ADR-014: Behavioral simulation** — `human.js` provides `humanScroll` and `humanMoveMouse` with `delayFn`/`rng` seams. `warmSession` must reuse these, not re-implement scroll/mouse math. Source: `architecture.md` lines 710-728 and `src/scrapers/facebook/human.js`.
- **ADR-015: Velocity & account-age** — Warming is NOT bound by `enforceDelay`'s 5-15s floor; it has its own delay ranges. Do NOT use `enforceDelay` for these waits. Source: `architecture.md` lines 730-750 and `src/scrapers/facebook/limits.js`.
- **ADR-006: Facebook adapter pattern** — `src/scrapers/facebook/index.js` exports `createBrowser`, `createPage`, `loginWithCookie`, and the new `warmSession`. Source: `architecture.md` lines 486-497.

### Pure Module Pattern

- `warmup.js` must be a **pure module** — no Puppeteer imports at module level. It receives `page` as a parameter and uses injectable seams.
- Keep the same header style as `human.js` and `limits.js`:
  - copyright + `// by nichxbt`
  - JSDoc for module
  - default seams at the top
  - exported function with JSDoc
- Do NOT log cookies, `c_user`, or any account metadata.

### Module Boundaries

| File | Action | Reason |
|---|---|---|
| `src/scrapers/facebook/warmup.js` | **NEW** | Pure `warmSession` function, keeps `human.js`/`limits.js` separation of concerns |
| `src/scrapers/facebook/index.js` | **UPDATE** | Re-export `warmSession`; integrate into `loginWithCookie` per ADR-016 |
| `tests/scrapers/facebook-warmup.test.js` | **NEW** | Unit tests with `makeFakePage` and injectable seams |
| `test-session-warming-real.mjs` | **NEW** | Real-browser smoke test following existing `test-human-*.mjs` pattern |

### What Story 6.14 Already Built

- `loginWithCookie` sets `page._fbAccountId = c_user` after successful login.
- `limits.js` has `getAccountAgeDays`, `getActionLimit`, `enforceDelay`.
- `human.js` has `humanScroll`, `humanMoveMouse`, `humanClick`, `humanType` with `delayFn`/`rng`.
- `runGuardedBatch` accepts `action` and `accountAgeDays` and integrates `limits.js`.

### Implementation Notes

- **Viewport bounds for mouse moves:** Use `page.viewportSize()` or default to `{ width: 1280, height: 720 }` if not available. The fake page helper can be extended to return a viewport if needed.
- **Warming is best-effort:** If `humanScroll` or `humanMoveMouse` throws, catch and log a warning, but do not fail the login. A session that failed to warm is still better than no session; callers can decide to abort.
- **Default behavior:** `skipWarmup` defaults to `false`. Only manual debug (`headless: false` + explicit `skipWarmup: true`) should bypass.
- **Return value:** `warmSession` returns `{ steps, durationMs }` so callers can log/observe progress without exposing account data.

### Testing Standards

- Use `tests/helpers/fake-page.js` for unit tests — it is a configurable state machine, not a mock, so it satisfies the "no mocks" rule in `CLAUDE.md`.
- Use `vi.fn()` only for seams (`delayFn`, `rng`), not for faking browser behavior.
- For real-browser tests, follow the live-account pattern and use `process.exit(0|1|2)` for pass/fail/fatal.

### References

- Story spec: `_bmad-output/planning-artifacts/epics-full.md` lines 867-878
- ADR-016: `_bmad-output/planning-artifacts/architecture.md` lines 752-762
- ADR-014: `_bmad-output/planning-artifacts/architecture.md` lines 710-728
- ADR-015: `_bmad-output/planning-artifacts/architecture.md` lines 730-750
- Existing behavioral utilities: `src/scrapers/facebook/human.js`
- Session orchestration: `src/scrapers/facebook/index.js`
- Fake page helper: `tests/helpers/fake-page.js`
- Real-browser test pattern: `test-human-scroll-real.mjs`, `test-human-mouse-real.mjs`

## Dev Agent Record

### Agent Model Used

GLM-5.2 High (Devin CLI)

### Debug Log References

- `npx vitest run tests/scrapers/facebook-warmup.test.js` → TBD
- `npx vitest run tests/scrapers/facebook-*.test.js` → TBD
- `npx vitest run tests/services/facebook-automation-batch.test.js` → TBD
- `node test-session-warming-real.mjs` → TBD

### Completion Notes List

- TBD

### File List

- `src/scrapers/facebook/warmup.js` — NEW pure session-warming module
- `src/scrapers/facebook/index.js` — UPDATE re-export and `loginWithCookie` integration
- `tests/scrapers/facebook-warmup.test.js` — NEW unit tests
- `test-session-warming-real.mjs` — NEW real-browser smoke test
