---
workflow: testarch-test-review
scope: directory (tests/api + tests/e2e)
review_date: 2026-08-13
reviewer: Luisphan
stepsCompleted:
  - step-01-load-context
  - step-02-discover-tests
  - step-03-quality-evaluation
  - step-04-generate-report
  - step-05-compare-r3
lastStep: step-05-compare-r3
lastSaved: 2026-08-13
inputDocuments:
  - /Users/luisphan/Documents/GitHub/XActions/_bmad-output/test-artifacts/test-reviews/test-review-api-e2e-2026-08-13-r3.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/fixture-architecture.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md
---

# Test Quality Review: `tests/api/` + `tests/e2e/` (Re-review r4)

**Quality Score**: 99/100 (A — Excellent)
**Review Date**: 2026-08-13
**Review Scope**: Directory — 7 test files + 1 shared fixture + 1 test-id helper
**Reviewer**: Luisphan (TEA Agent)
**Execution Result**: `npx vitest run tests/api tests/e2e` — **7/7 files passed, 129/129 tests passed, 44.85s**

---

## Executive Summary

**Overall Assessment**: Excellent — the two structural test-ID issues flagged in r3 are fully resolved. All 129 tests now carry a unique, stable ID, including the 26 tests in `facebook-automate-routes.test.js` that previously had none and the rows inside `it.each` matrices that previously shared a single ID. The remaining gaps are maintainability only: every priority marker is still the default `@P2`, and a small set of literal URLs/IDs are still used in validation payloads.

**Recommendation**: **Approve for merge**. The suite is deterministic, mock-free, network-free, and all tests pass. The unresolved items are low-risk polish and should not block merge.

### Focused Comparison Against r3 Residuals

| r3 Residual Issue | Status in r4 | Evidence |
| --- | --- | --- |
| **Duplicate IDs inside `it.each` matrices** | ✅ Resolved | `nextTestId` is now called once per row and embedded as the first column of `it.each` arrays (`tests/e2e/api-auth.test.js:24-39`, `tests/e2e/api-operations.test.js:86-90`, `tests/api/facebook-automate-routes.test.js:64-89`). The 129 IDs extracted from the verbose test run are all unique. |
| **Missing IDs (26 tests in `facebook-automate-routes.test.js`)** | ✅ Resolved | `tests/api/facebook-automate-routes.test.js:14` now imports `nextTestId` and uses it for all 26 tests in the file. |
| **Priority markers are all `@P2` only** | ⚠️ Not resolved | All 129 test IDs are `@P2`. No call passes a priority override (`'P0'`, `'P1'`, `'P3'`); `tests/utils/test-ids.js:3` keeps `priority = 'P2'`. |
| **Literal URLs/IDs in payloads** | ⚠️ Not resolved | 24 literal strings remain across 4 files (`tests/e2e/api-operations.test.js:54, 60`, `tests/api/facebook-routes-integration.test.js:37, 44, 88, 99, 127, 137, 148, 149, 159`, `tests/api/facebook-automate-routes.test.js:40, 48, 57, 68, 78, 129`, `tests/e2e/api-facebook.test.js:36, 44, 53, 84, 93, 104, 114`). |

### Key Strengths

- **Full test ID coverage**: 129/129 tests have a unique ID. There are 0 missing and 0 duplicate IDs.
- **`it.each` IDs are per-row**: The row-first-column pattern guarantees each matrix row gets its own sequential number, eliminating the template-literal sharing bug from r3.
- **No regressions in coverage or assertions**: 189 `expect()` calls (108 in `tests/api`, 81 in `tests/e2e`), same as r3.
- **No mocks, stubs, spies, or hard waits**: 0 `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock` / `waitForTimeout` / `sleep` / `setTimeout` in the two directories.
- **Network/Puppeteer-free**: All tests exercise local validation, Express route guards, or pure crypto/account validation. No real Facebook URLs are fetched.
- **Deterministic fixtures remain stable**: `tests/api/fixtures/test-user.js:12-39` still uses per-process counters and SHA-256 suffixes.

### Key Weaknesses

- **Priority markers still do not express real priority**: Every `nextTestId` call in the 7 files uses the default `@P2`. The suite cannot be filtered or triaged by criticality.
- **Literal operation/account/URL values remain**: `'some-operation-id'`, `'acct1'`, `'acct2'`, and `https://facebook.com/post/1`, `/somepage`, `/test`, `/groups/test` are still hardcoded in validation payloads. They are not driven by `makeOperationId()` or `makeFacebookUrl()` factories.
- **Stack-trace-based scope derivation is still brittle**: `tests/utils/test-ids.js:7-16` still uses `new Error().stack` and a regex to derive the file scope. It works today, but would break if stack formatting changes or tests are bundled/minified.

---

## Quality Criteria Assessment

| Tiêu chí | Trạng thái | Lỗi vi phạm | Ghi chú |
| --- | --- | --- | --- |
| BDD Format (Given-When-Then) | PASS | 0 | Tên `it()` mô tả rõ ràng, không dùng BDD |
| Test IDs | PASS | 0 | 129/129 ID duy nhất; `it.each` mỗi dòng có ID riêng; `facebook-automate-routes` đã có ID |
| Priority Markers (P0–P3) | WARN | 1 | Tất cả marker là `@P2`; không có P0/P1/P3 |
| Hard Waits | PASS | 0 | Không `waitForTimeout`, `sleep`, `setTimeout` trong 7 file |
| Determinism (no conditionals) | PASS | 0 | `sequence.shuffle: true` vẫn bật, fixture/user/cookie counter xác định |
| Isolation (cleanup, no shared state) | PASS | 0 | `beforeAll`/`afterAll` + `cleanupTestUser` mỗi file |
| Fixture Patterns | PASS | 0 | `tests/api/fixtures/test-user.js` dùng chung cho API + E2E |
| Data Factories | WARN | 1 | Cookie/ID qua factory; còn vài URL/ID literal |
| Network-First Pattern | N/A | 0 | API/E2E gọi Express trực tiếp, không navigate |
| Explicit Assertions | PASS | 0 | Mọi assertion cụ thể, không `not.toBe(400)` |
| Test Length (≤300 dòng) | PASS | 0 | File dài nhất 295 dòng |
| Test Duration (≤1.5 min/test) | PASS | 0 | Mỗi test ≤501ms; toàn bộ suite 44.85s |
| Flakiness Patterns | PASS | 0 | Không còn test chạm mạng thật/Puppeteer |

**Total Violations**: 0 Critical, 0 High, 1 Medium, 1 Low (plus 1 residual low for stack-trace helper).

---

## Quality Score Breakdown

```
Starting Score:          100
Critical Violations:     -0  × 10 = -0
High Violations:         -0  × 5  = -0   (r3 residual test ID instability resolved)
Medium Violations:       -1  × 2  = -2   (priority markers still @P2 only)
Low Violations:          -2  × 1  = -2   (literal URLs/IDs; stack-trace ID helper still brittle)

Bonus Points:
  Full unique test ID coverage:   +1
  No network/Puppeteer calls:     +1
  Deterministic fixtures:         +1
                         --------
Total Bonus:             +3

Final Score:             99/100
Grade:                   A (Excellent)
```

> Score improved from 96 (r3) to 99 (r4) because the test-ID high violation (duplicate `it.each` IDs + 26 missing IDs) is now fully resolved. The remaining -2 medium/low points reflect the unresolved priority and literal-data items, both of which are maintainability concerns, not functional blockers.

---

## Execution Details

```
Command: npx vitest run tests/api tests/e2e
Test Files: 7 passed (7)
Tests:      129 passed (129)
Start at:   2026-08-13 20:56:59
Duration:   44.85s (transform 5.02s, setup 0ms, import 31.91s, tests 8.85s, environment 2ms)
```

The total duration is higher than r3's 12.01s, but the actual test execution time is only **8.85s**. The additional ~31s is Vite/server module import overhead and is consistent with a cold fork-pool run. The slowest single test observed was **501ms** (`tests/e2e/api-auth.test.js > Auth endpoints > POST /api/auth/login with invalid credentials → 401`), well under the 30s `testTimeout`.

### Test ID Verification

A grep of the verbose reporter output produced **129 unique `[5.5-{scope}-{level}-{seq} @P2]` IDs**, matching the 129 passing tests:

| File | Tests | Unique IDs |
| --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 42 | 42 |
| `tests/api/facebook-automate-routes.test.js` | 26 | 26 |
| `tests/api/facebook-routes-integration.test.js` | 17 | 17 |
| `tests/e2e/api-auth.test.js` | 14 | 14 |
| `tests/e2e/api-facebook.test.js` | 9 | 9 |
| `tests/e2e/api-health.test.js` | 8 | 8 |
| `tests/e2e/api-operations.test.js` | 13 | 13 |

**No duplicate IDs. No missing IDs. All `@P2`.**

---

## Critical Issues (Must Fix)

**None.** No hard waits, mocks, missing assertions, or runtime failures.

---

## Medium Issues (P2 — Recommendations)

### M1. Priority markers still do not express real priority

**File**: `tests/utils/test-ids.js:3`, all 7 test files
**Criterion**: Priority Markers

`nextTestId(level, priority = 'P2')` still defaults to `@P2`, and every call in the suite uses one argument (`'API'` or `'E2E'`). There are no `@P0`, `@P1`, or `@P3` markers, so the suite cannot be filtered by criticality.

**Recommended Fix**:

```js
it(`[${nextTestId('API', 'P1')}] returns 400 for missing label`, ...)
```

Mark smoke/health auth guards as `@P1`, boundary/mutation cases as `@P2` or `@P3`.

---

## Low Issues (P3)

### L1. Literal operation/account/URL values remain

**Files / Lines**:
- `tests/e2e/api-operations.test.js:54, 60` — `'some-operation-id'`
- `tests/api/facebook-routes-integration.test.js:37, 44, 88, 99, 127, 137, 148, 149, 159` — `https://facebook.com/test`, `https://facebook.com/post/1`, `https://facebook.com/post/2`, `'acct1'`, `'acct2'`
- `tests/api/facebook-automate-routes.test.js:40, 48, 57, 68, 78, 129` — `https://facebook.com/post/1`, `https://facebook.com/somepage`, `https://facebook.com/groups/test`
- `tests/e2e/api-facebook.test.js:36, 44, 53, 84, 93, 104, 114` — `https://facebook.com/post/1`, `https://facebook.com/somepage`

**Criterion**: Data Factories

These literals are acceptable for validation tests but are not factory-driven. Recommend `makeOperationId()` and `makeFacebookUrl()` helpers with `overrides`.

### L2. `nextTestId` scope derived from `Error().stack`

**File**: `tests/utils/test-ids.js:7-16`
**Criterion**: Test IDs

The helper uses `new Error().stack` and a regex to extract the caller file. It works for the current Node/Vitest setup, but it is fragile under stack-format changes, bundling, or minification. Consider deriving scope from a per-file constant or `import.meta.url`.

---

## Best Practices Found

### BP1. Per-row `it.each` IDs

**Files**: `tests/e2e/api-auth.test.js:24-39`, `tests/e2e/api-operations.test.js:86-90`, `tests/api/facebook-automate-routes.test.js:64-89`
**Pattern**: Embed `nextTestId(level)` as the first column of each `it.each` row, then use `[%s]` in the title template.

```js
it.each([
  [nextTestId('E2E'), 'empty body', {}, ['username', 'password']],
  [nextTestId('E2E'), 'invalid username', { ... }, ['username']],
  // ...
])('[%s] POST /api/auth/register with %s → 400', async (id, desc, body, expectedPaths) => { ... })
```

This guarantees each matrix row receives a unique, sequential ID and appears in the test name.

### BP2. Full `nextTestId` coverage in `facebook-automate-routes.test.js`

**File**: `tests/api/facebook-automate-routes.test.js:14, 36-131`
**Pattern**: All 26 tests now import and call `nextTestId('API')`, including the 19-row action-validation matrix and the auth-guard/validation tests.

---

## Test File Analysis

### Suite Metadata

- **Framework**: Vitest 4.0.18
- **Environment**: Node.js, `supertest`
- **Config**: `vitest.config.js` — `pool: 'forks'`, `fileParallelism: false`, `testTimeout: 30000`, `sequence.shuffle: true`, `reporters: ['verbose']`
- **Test Files**: 7
- **Total Lines**: 1007
- **Total Tests**: 129
- **Total Assertions (`expect(`)**: 189
- **Hard Waits**: 0
- `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock`: 0
- **Unique Test IDs**: 129
- **Tests with no ID**: 0
- **Duplicate Test IDs**: 0
- **P0 / P1 / P3 markers**: 0

### Test Files

| File | Dòng | Tests | Assertions | Max Duration | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 50 | 432ms | Approve |
| `tests/api/facebook-automate-routes.test.js` | 133 | 26 | 18 | 190ms | Approve |
| `tests/api/facebook-routes-integration.test.js` | 168 | 17 | 40 | 101ms | Approve |
| `tests/e2e/api-auth.test.js` | 115 | 14 | 24 | 501ms | Approve |
| `tests/e2e/api-facebook.test.js` | 118 | 9 | 18 | 135ms | Approve |
| `tests/e2e/api-health.test.js` | 60 | 8 | 19 | 276ms | Approve |
| `tests/e2e/api-operations.test.js` | 118 | 13 | 20 | 75ms | Approve |

**Suite Average**: 99/100 (A — Excellent)

---

## Context and Integration

### Related Artifacts

- Review trước: `_bmad-output/test-artifacts/test-reviews/test-review-api-e2e-2026-08-13-r3.md`
- Fixture chung: `tests/api/fixtures/test-user.js`
- Test ID helper: `tests/utils/test-ids.js`
- Cookie shape validation: `api/routes/facebook.js:15-51`

### Quality Trends

| Review Date | Score | Grade | Critical Issues | Trend |
| --- | --- | --- | --- | --- |
| 2026-08-13 | 75/100 | B | 0 | Baseline |
| 2026-08-13 r1 | 89/100 | A | 0 | ⬆️ Improved |
| 2026-08-13 r2 | 92/100 | A | 0 | ⬆️ Improved |
| 2026-08-13 r3 | 96/100 | A | 0 | ⬆️ Improved |
| 2026-08-13 r4 | 99/100 | A | 0 | ⬆️ Improved |

---

## Next Steps

### Immediate Actions (Before or Right After Merge)

1. **M1 — Use real priority values**
   - Call `nextTestId('API'|'E2E', 'P0'|'P1'|'P2'|'P3')` for at least smoke/health checks (`@P1`) and edge/boundary cases (`@P2`/`@P3`).
   - Priority: P2
   - Owner: QA
   - Estimated Effort: 30m

2. **L1 — Replace remaining literals with factory helpers**
   - Introduce `makeOperationId()` and `makeFacebookUrl()` with optional overrides, then replace `'some-operation-id'`, `'acct1'`, `'acct2'`, and the `https://facebook.com/...` literals in the 4 files listed above.
   - Priority: P3
   - Owner: QA
   - Estimated Effort: 1h

3. **L2 — Harden `nextTestId` scope derivation**
   - Consider passing an explicit scope or using `import.meta.url` instead of parsing `Error().stack`.
   - Priority: P3
   - Owner: QA
   - Estimated Effort: 30m

### Re-Review Needed?

**No re-review required for merge.** A future re-review (r5) only makes sense if the team completes the priority/literal cleanup and wants a formal sign-off.

---

## Decision

**Recommendation**: **Approve for merge**

**Rationale**: The two test-quality blockers from r3 (duplicate `it.each` IDs and 26 missing IDs) are fully resolved. All 129 tests pass with unique, stable IDs. The remaining gaps — default `@P2` priority markers, a handful of hardcoded URLs/IDs, and the `Error().stack` scope hack — are low-risk maintainability items. They do not introduce flakiness, do not cause real network calls, and do not reduce assertion quality. The suite is deterministic, mock-free, and mergeable as-is.

---

## Appendix: Violation Summary by Location

| File:Line | Severity | Tiêu chí | Vấn đề | Fix nhanh |
| --- | --- | --- | --- | --- |
| `tests/utils/test-ids.js:3` | M1 | Priority Markers | `priority = 'P2'` mặc định, không có P0/P1/P3 | Truyền priority cụ thể |
| `tests/e2e/api-operations.test.js:54, 60` | L1 | Data Factories | `'some-operation-id'` | Dùng `makeOperationId()` |
| `tests/api/facebook-routes-integration.test.js:37, 44, 88, 99, 127, 137, 148, 149, 159` | L1 | Data Factories | URL `facebook.com/post/1`, `facebook.com/test`, `acct1/2` | Dùng `makeFacebookUrl()` / factory |
| `tests/api/facebook-automate-routes.test.js:40, 48, 57, 68, 78, 129` | L1 | Data Factories | URL Facebook literal | Dùng `makeFacebookUrl()` |
| `tests/e2e/api-facebook.test.js:36, 44, 53, 84, 93, 104, 114` | L1 | Data Factories | URL Facebook literal | Dùng `makeFacebookUrl()` |
| `tests/utils/test-ids.js:7-16` | L2 | Test IDs | Scope từ `Error().stack`, dễ vỡ | Dùng `import.meta.url` hoặc const per file |

---

## Review Metadata

**Generated By**: BMad TEA Agent — `bmad-testarch-test-review`
**Review ID**: test-review-api-e2e-2026-08-13-r4
**Timestamp**: 2026-08-13
**Version**: 4.0
**Workflow**: testarch-test-review v5.0
