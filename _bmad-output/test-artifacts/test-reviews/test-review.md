---
stepsCompleted: ['step-01-load-context', 'step-02-discover-tests']
lastStep: 'step-02-discover-tests'
lastSaved: '2026-06-19'
reviewScope: suite
detectedStack: backend
inputDocuments:
  - knowledge/test-quality.md
  - knowledge/test-healing-patterns.md
  - knowledge/risk-governance.md
  - knowledge/test-levels-framework.md
---

# XActions Test Suite Quality Review

## Suite Overview

| Metric | Value |
|--------|-------|
| Total test files | 80 |
| Total test cases | ~1,615 |
| Framework | Vitest 4.x (ESM) |
| Project rule | No mocks/stubs/fakes — injectable seams only |
| Files with `vi.mock` violations | 1 |
| Files with no assertions | 0 |
| Files over 300 lines | 7 |

## Findings

### HIGH Severity

#### H1. `vi.mock` violation — breaks project mandate

**File:** `tests/scrapers/messengerShare.test.js:219`

```js
vi.mock('../../api/services/facebookAutomation.js', () => ({
  runGuardedBatch: vi.fn(async (items, actionFn, options) => { ... })
}));
```

**Impact:** Violates the foundational "no mocks/stubs/fakes" rule. This file even states "No vi.mock per project mandate" earlier, but a later describe block adds one.

**Fix:** Replace with an injectable `batchFn` seam passed directly to `messengerShareCampaign`, matching the pattern used in all `tests/services/facebook-*.test.js` files.

---

#### H2. Real wall-clock wait (1 second)

**File:** `tests/http-scraper/client.test.js:605-607`

```js
const start = Date.now();
await strategy.onRateLimit({ resetAt: Date.now() + 100 });
const elapsed = Date.now() - start;
expect(elapsed).toBeGreaterThanOrEqual(950);
```

**Impact:** Test literally sleeps ~1s. Non-deterministic (can flake under CPU pressure). Slows CI pipeline.

**Fix:** Make `delayMs` in `WaitingRateLimitStrategy` injectable via constructor/option. Assert the delay function was called with correct args, not that wall time elapsed.

---

### MEDIUM Severity

#### M1. `Date.now()` in time-sensitive schedule tests

**Files:** `tests/services/facebook-schedule.test.js`, `tests/services/facebook-schedule-edge.test.js`

Time-sensitive assertions use live `Date.now()` to compute "due" timestamps. Can flake near midnight, DST transitions, or under CI load.

**Fix:** Inject a `now` clock seam (same pattern as `warmupScrollFeed` and `warmupAccount`).

---

#### M2. try/catch for error-flow assertions (4 occurrences)

**Files:**
- `tests/http-scraper/integration.test.js:634, 660`
- `tests/scrapers/facebook-graphql.test.js:103`
- `tests/mcp/facebook-messenger-surface.test.js:152`

```js
try {
  await scrapeProfile(client, 'testuser');
  expect.fail('Should have thrown');
} catch (err) {
  expect(err).toBeInstanceOf(RateLimitError);
}
```

**Impact:** Anti-pattern — hides failure path, less readable than Vitest's built-in.

**Fix:** Use `await expect(...).rejects.toThrow(RateLimitError)` or `rejects.toMatchObject({...})`.

---

#### M3. Coverage gaps — 15 src/ subdirectories untested

```
src/ai/          src/analytics/     src/automation/
src/bulk/        src/compat/        src/graph/
src/notifications/ src/plugins/     src/portability/
src/scheduler/   src/scraping/      src/spaces/
src/streaming/   src/utils/         src/workflows/
```

Plus ~30 top-level `src/*.js` browser-paste scripts have no tests.

**Context:** Browser-paste scripts run in DevTools console — they are hard to unit test. But `src/ai/`, `src/analytics/`, `src/workflows/` contain Node.js logic that could be tested.

---

### LOW Severity

#### L1. Silent test skip via `if (!COOKIES)`

**File:** `tests/http-scraper/live.test.js:38`

Tests silently pass with no assertions when `COOKIES` env var is unset. CI shows green but nothing ran.

**Fix:** Use `describe.skipIf(!process.env.COOKIES)` to make the skip explicit in runner output.

---

#### L2. Seven files over 300 lines

| File | Lines |
|------|-------|
| `tests/scrapers/facebook.test.js` | 1,342 |
| `tests/http-scraper/tweets.test.js` | 1,085 |
| `tests/x402.test.js` | 1,039 |
| `tests/http-scraper/thread.test.js` | 1,009 |
| `tests/services/facebook-automation.test.js` | 976 |
| `tests/http-scraper/integration.test.js` | 853 |
| `tests/http-scraper/auth.test.js` | 836 |

**Impact:** Harder to debug failures, slower to understand. `facebook.test.js` at 1,342 lines should be split by feature area.

**Fix:** Split into focused files by domain (e.g., `facebook-like.test.js`, `facebook-comment.test.js`, `facebook-post.test.js`).

---

#### L3. Non-determinism: `Math.random()` in fixture factory

**File:** `tests/http-scraper/relationships.test.js:36-37`

Uses `Math.random()` for ID generation in fixtures. Acceptable since IDs don't affect assertion logic, but inconsistent with project's injectable-seam philosophy.

---

## Positive Observations

1. **Zero files with no assertions** — every test file validates something.
2. **Consistent seam pattern** in `tests/services/facebook-*.test.js` — injectable `delay`, `now`, `reactFn`, `collectFn`, `cancelFn`. Well-established convention.
3. **Good test naming** — describe blocks map to function names, `it` blocks describe behavior.
4. **Browser-free testing** for Puppeteer automation — tests never launch a real browser.
5. **Comprehensive edge-case files** (e.g., `facebook-join-groups-edge.test.js`, `facebook-schedule-edge.test.js`) — signals maturity.
6. **Test isolation** — no shared mutable state between tests detected (each test constructs its own fakes).

## Recommendations (Priority Order)

1. **Fix H1** — remove `vi.mock` from `messengerShare.test.js` (30 min, high value)
2. **Fix H2** — make rate-limit delay injectable (1h, prevents flaky CI)
3. **Fix M2** — replace try/catch with `rejects.toThrow()` in 4 files (30 min, readability)
4. **Fix M1** — inject clock in schedule tests (1h, prevents midnight flakiness)
5. **Fix L1** — use `describe.skipIf` for live tests (5 min, visibility)
6. **Defer L2** — file splitting is a refactoring effort, plan for a dedicated session

## Gate Decision

**CONCERNS** — No critical blockers, but 1 rule violation (vi.mock) and 1 real wall-clock wait should be fixed before marking the suite as "green baseline". Coverage gaps in `src/` are acknowledged but are mostly browser-paste scripts outside the automation core.
