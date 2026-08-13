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
  - step-05-compare-r4
lastStep: step-05-compare-r4
lastSaved: 2026-08-13
inputDocuments:
  - /Users/luisphan/Documents/GitHub/XActions/_bmad-output/test-artifacts/test-reviews/test-review-api-e2e-2026-08-13-r4.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/fixture-architecture.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md
---

# Test Quality Review: `tests/api/` + `tests/e2e/` (Re-review r5)

**Quality Score**: 100/100 (A+ — Excellent)
**Review Date**: 2026-08-13
**Review Scope**: Directory — 7 test files + 1 shared fixture + 1 test-id helper
**Reviewer**: Luisphan (TEA Agent)
**Execution Result**: `npx vitest run tests/api tests/e2e` — **7/7 files passed, 129/129 tests passed, 20.33s**

---

## Executive Summary

**Overall Assessment**: Excellent — both r4 residuals targeted by this re-review are now materially resolved. Priority markers are no longer uniform `@P2`; the suite now uses `@P0` for critical auth-failure cases, `@P1` for validation matrix rows, and `@P2` for the majority of boundary/standard cases. The fixture architecture has also been expanded: `tests/api/fixtures/test-user.js` now exports `makeFacebookPostUrl()`, `makeFacebookGroupUrl()`, `makeFacebookProfileUrl()`, `makeAccountId()`, and `makeOperationId()`, and the previously hardcoded operation IDs, account IDs, and most Facebook URLs have been replaced by these factories.

**Recommendation**: **Approve for merge**. The suite remains deterministic, mock-free, network-free, and all tests pass. The only remaining items are 8 residual literal Facebook URLs and the `Error().stack` scope hack; both are low-severity polish and do not affect correctness or flakiness.

### Focused Comparison Against r4 Residuals

| r4 Residual Issue | Status in r5 | Evidence |
| --- | --- | --- |
| **Duplicate IDs inside `it.each` matrices** | ✅ Resolved (retained) | `nextTestId` is called once per row and embedded as the first column of `it.each` arrays (`tests/e2e/api-auth.test.js:24-29`, `tests/e2e/api-operations.test.js:87-90`, `tests/api/facebook-automate-routes.test.js:66-86`). The 129 IDs extracted from the verbose test run are all unique. |
| **Missing IDs (facebook-automate-routes)** | ✅ Resolved (retained) | `tests/api/facebook-automate-routes.test.js:16` imports `nextTestId` and uses it for all 26 tests in the file. |
| **Priority markers are all `@P2` only** | ✅ Resolved | 129 tests now carry `@P0` (2 tests), `@P1` (26 tests), or `@P2` (101 tests). No `@P3` is used. Verified in the verbose test output and source code. |
| **Literal URLs/IDs in payloads** | ⚠️ Mostly resolved | Operation IDs (`'some-operation-id'`) and account IDs (`'acct1'`, `'acct2'`) are fully replaced by `makeOperationId()` / `makeAccountId()`. Facebook post URLs are largely driven by `makeFacebookPostUrl()`. **8 literal Facebook URLs remain** in 3 files (`tests/api/facebook-routes-integration.test.js:39, 46, 90`, `tests/api/facebook-automate-routes.test.js:50, 80`, `tests/e2e/api-facebook.test.js:46, 86, 95`). `makeFacebookProfileUrl()` and `makeFacebookGroupUrl()` are defined but not yet consumed. |

### Key Strengths

- **Priority markers are now varied and meaningful**: auth-refresh failure cases are `@P0`, validation-matrix rows are `@P1`, and boundary/standard cases are `@P2`. The suite can now be filtered by criticality (`npx vitest run --grep "@P0"`, etc.).
- **Full test ID coverage**: 129/129 tests have a unique ID. There are 0 missing and 0 duplicate IDs.
- **`it.each` IDs are per-row**: The row-first-column pattern guarantees each matrix row gets its own sequential number.
- **Data factories are in place and actively used**: `tests/api/fixtures/test-user.js:16-34` provides `makeFacebookPostUrl()`, `makeFacebookGroupUrl()`, `makeFacebookProfileUrl()`, `makeAccountId()`, and `makeOperationId()`. Deterministic counters and SHA-256 suffixes keep values reproducible and unique.
- **No mocks, stubs, spies, or hard waits**: 0 `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock` / `waitForTimeout` / `sleep` / `setTimeout` in the two directories.
- **Network/Puppeteer-free**: All tests exercise local validation, Express route guards, or pure crypto/account validation. No real Facebook URLs are fetched.
- **All 129 tests pass**: Deterministic under `pool: 'forks'` and `sequence.shuffle: true`.

### Key Weaknesses

- **8 residual literal Facebook URLs remain**: They are used in validation payloads where the exact URL string is irrelevant to the assertion, but they are not yet driven by `makeFacebookProfileUrl()` / `makeFacebookGroupUrl()`.
- **Two fixture factories are defined but unused**: `makeFacebookProfileUrl()` and `makeFacebookGroupUrl()` in `tests/api/fixtures/test-user.js:20, 24` are not imported by any test. Replacing the 8 literals with them would complete the fixture migration.
- **Stack-trace-based scope derivation is still brittle**: `tests/utils/test-ids.js:7-16` still uses `new Error().stack` and a regex to derive the file scope. It works today, but would break if stack formatting changes or tests are bundled/minified.

---

## Quality Criteria Assessment

| Tiêu chí | Trạng thái | Lỗi vi phạm | Ghi chú |
| --- | --- | --- | --- |
| BDD Format (Given-When-Then) | PASS | 0 | Tên `it()` mô tả rõ ràng, không dùng BDD |
| Test IDs | PASS | 0 | 129/129 ID duy nhất; `it.each` mỗi dòng có ID riêng |
| Priority Markers (P0–P3) | PASS | 0 | Có `@P0` (2), `@P1` (26), `@P2` (101); đã đa dạng hóa |
| Hard Waits | PASS | 0 | Không `waitForTimeout`, `sleep`, `setTimeout` trong 7 file |
| Determinism (no conditionals) | PASS | 0 | `sequence.shuffle: true` vẫn bật, fixture/user/cookie counter xác định |
| Isolation (cleanup, no shared state) | PASS | 0 | `beforeAll`/`afterAll` + `cleanupTestUser` mỗi file |
| Fixture Patterns | PASS | 0 | `tests/api/fixtures/test-user.js` dùng chung cho API + E2E |
| Data Factories | WARN | 1 | Cookie/ID/URL post qua factory; còn 8 URL Facebook literal |
| Network-First Pattern | N/A | 0 | API/E2E gọi Express trực tiếp, không navigate |
| Explicit Assertions | PASS | 0 | Mọi assertion cụ thể, không `not.toBe(400)` |
| Test Length (≤300 dòng) | PASS | 0 | File dài nhất 295 dòng |
| Test Duration (≤1.5 min/test) | PASS | 0 | Mỗi test ≤127ms; toàn bộ suite 20.33s |
| Flakiness Patterns | PASS | 0 | Không còn test chạm mạng thật/Puppeteer |

**Total Violations**: 0 Critical, 0 High, 0 Medium, 2 Low (residual literal URLs + stack-trace helper).

---

## Quality Score Breakdown

```
Starting Score:          100
Critical Violations:     -0  × 10 = -0
High Violations:         -0  × 5  = -0
Medium Violations:       -0  × 2  = -0   (priority marker issue from r4 resolved)
Low Violations:          -2  × 1  = -2   (8 literal Facebook URLs remain;
                                          stack-trace ID helper still brittle)

Bonus Points:
  Full unique test ID coverage:   +1
  No network/Puppeteer calls:     +1
  Deterministic fixtures:         +1
                         --------
Total Bonus:             +3

Raw Total:               101
Capped at:               100

Final Score:             100/100
Grade:                   A+ (Excellent)
```

> Score improved from 99 (r4) to 100 (r5) because the priority-marker medium violation is fully resolved and the fixture architecture is now in active use. The raw score is 101, capped at 100, reflecting the two residual low-severity items (8 literal URLs and the stack-trace scope hack) which do not block merge.

---

## Execution Details

```
Command: npx vitest run tests/api tests/e2e
Test Files: 7 passed (7)
Tests:      129 passed (129)
Start at:   21:30:39
Duration:   20.33s (transform 2.34s, setup 0ms, import 14.60s, tests 3.14s, environment 1ms)
```

The total suite time is 20.33s. The actual test execution time is **3.14s**; the remaining time is Vite/server module import overhead, which is normal for a cold fork-pool run. The slowest single test observed was **127ms** (`tests/e2e/api-auth.test.js > Auth endpoints > POST /api/auth/login with valid credentials → 200`), well under the 30s `testTimeout`.

### Test ID Verification

A grep of the verbose reporter output produced **129 unique `[5.5-{scope}-{level}-{seq} @P{priority}]` IDs**, matching the 129 passing tests. Priority distribution extracted from the source code:

| Priority | Count | Files |
| --- | --- | --- |
| `@P0` | 2 | `tests/e2e/api-auth.test.js:79-80` |
| `@P1` | 26 | `tests/e2e/api-auth.test.js:25-28` (4), `tests/e2e/api-operations.test.js:88-90` (3), `tests/api/facebook-automate-routes.test.js:67-85` (19) |
| `@P2` | 101 | Remaining tests across all 7 files |
| `@P3` | 0 | — |

| File | Tests | Unique IDs |
| --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 42 | 42 |
| `tests/api/facebook-automate-routes.test.js` | 26 | 26 |
| `tests/api/facebook-routes-integration.test.js` | 17 | 17 |
| `tests/e2e/api-auth.test.js` | 14 | 14 |
| `tests/e2e/api-facebook.test.js` | 9 | 9 |
| `tests/e2e/api-health.test.js` | 8 | 8 |
| `tests/e2e/api-operations.test.js` | 13 | 13 |

**No duplicate IDs. No missing IDs.**

---

## Critical Issues (Must Fix)

**None.** No hard waits, mocks, missing assertions, or runtime failures.

---

## Medium Issues (P2 — Recommendations)

**None.** The r4 medium issue (uniform `@P2` priority markers) is resolved.

---

## Low Issues (P3)

### L1. Residual literal Facebook URLs (8 occurrences)

**Files / Lines**:
- `tests/api/facebook-routes-integration.test.js:39, 46, 90` — `https://facebook.com/test`
- `tests/api/facebook-automate-routes.test.js:50, 80` — `https://facebook.com/somepage`, `https://facebook.com/groups/test`
- `tests/e2e/api-facebook.test.js:46, 86, 95` — `https://facebook.com/somepage`

**Criterion**: Data Factories

These 8 literals are used in validation tests where the exact URL does not affect the assertion, but they are not yet driven by `makeFacebookProfileUrl()` or `makeFacebookGroupUrl()`. They are the only remaining literal data in the two directories.

### L2. `nextTestId` scope derived from `Error().stack`

**File**: `tests/utils/test-ids.js:7-16`
**Criterion**: Test IDs

The helper uses `new Error().stack` and a regex to extract the caller file. It works for the current Node/Vitest setup, but it is fragile under stack-format changes, bundling, or minification. Consider deriving scope from a per-file constant or `import.meta.url`.

---

## Best Practices Found

### BP1. Varied priority markers

**Files**: `tests/e2e/api-auth.test.js:25-29, 79-81`, `tests/e2e/api-operations.test.js:87-90`, `tests/api/facebook-automate-routes.test.js:66-86`
**Pattern**: `nextTestId('API'|'E2E', 'P0'|'P1'|'P2')` now receives an explicit priority:

```js
it.each([
  [nextTestId('E2E', 'P1'), 'empty body', {}, ['username', 'password']],
  // ...
])(`[%s] POST /api/auth/register with %s → 400`, ...)
```

This enables filtering and triage by criticality (`@P0` for auth-refresh failure, `@P1` for validation matrices, `@P2` for standard/boundary cases).

### BP2. Factory-driven operation and account IDs

**Files**: `tests/e2e/api-operations.test.js:12, 55, 61`, `tests/api/facebook-routes-integration.test.js:13, 151`, `tests/e2e/api-facebook.test.js:14`
**Pattern**: `makeOperationId()` and `makeAccountId()` replace hardcoded strings and use deterministic per-process counters.

### BP3. Factory-driven Facebook post URLs

**Files**: `tests/api/facebook-routes-integration.test.js:101, 129, 139, 150, 161`, `tests/api/facebook-automate-routes.test.js:42, 59, 70, 131`, `tests/e2e/api-facebook.test.js:38, 55, 106, 116`
**Pattern**: `makeFacebookPostUrl(id)` replaces `https://facebook.com/post/1` with a configurable, deterministic factory.

---

## Test File Analysis

### Suite Metadata

- **Framework**: Vitest 4.0.18
- **Environment**: Node.js, `supertest`
- **Config**: `vitest.config.js` — `pool: 'forks'`, `fileParallelism: false`, `testTimeout: 30000`, `sequence.shuffle: true`, `reporters: ['verbose']`
- **Test Files**: 7
- **Total Lines**: 1014
- **Total Tests**: 129
- **Total Assertions (`expect(`)**: 189
- **Hard Waits**: 0
- `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock`: 0
- **Unique Test IDs**: 129
- **Tests with no ID**: 0
- **Duplicate Test IDs**: 0
- **P0 / P1 / P2 / P3 markers**: 2 / 26 / 101 / 0

### Test Files

| File | Dòng | Tests | Assertions | Max Duration | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 50 | 99ms | Approve |
| `tests/api/facebook-automate-routes.test.js` | 135 | 26 | 18 | 33ms | Approve |
| `tests/api/facebook-routes-integration.test.js` | 170 | 17 | 40 | 59ms | Approve |
| `tests/e2e/api-auth.test.js` | 115 | 14 | 24 | 127ms | Approve |
| `tests/e2e/api-facebook.test.js` | 120 | 9 | 18 | 49ms | Approve |
| `tests/e2e/api-health.test.js` | 60 | 8 | 19 | 107ms | Approve |
| `tests/e2e/api-operations.test.js` | 119 | 13 | 20 | 79ms | Approve |

**Suite Average**: 100/100 (A+ — Excellent)

---

## Context and Integration

### Related Artifacts

- Review trước: `_bmad-output/test-artifacts/test-reviews/test-review-api-e2e-2026-08-13-r4.md`
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
| 2026-08-13 r5 | 100/100 | A+ | 0 | ⬆️ Improved |

---

## Next Steps

### Immediate Actions (Before or Right After Merge)

1. **L1 — Replace the 8 remaining literal Facebook URLs**
   - Import `makeFacebookProfileUrl()` / `makeFacebookGroupUrl()` into the 3 files listed above and replace `https://facebook.com/test`, `https://facebook.com/somepage`, and `https://facebook.com/groups/test`.
   - Priority: P3
   - Owner: QA
   - Estimated Effort: 15m

2. **L2 — Harden `nextTestId` scope derivation**
   - Consider passing an explicit scope or using `import.meta.url` instead of parsing `Error().stack`.
   - Priority: P3
   - Owner: QA
   - Estimated Effort: 30m

### Re-Review Needed?

**No re-review required for merge.** A future re-review (r6) is only warranted if the team wants a formal sign-off after the final 8 literal URLs are replaced.

---

## Decision

**Recommendation**: **Approve for merge**

**Rationale**: The two test-quality residuals from r4 have been materially resolved. Priority markers now span `@P0`–`@P2`, enabling criticality filtering. Operation IDs, account IDs, and the majority of Facebook URLs are now driven by deterministic fixtures. All 129 tests pass with unique, stable IDs. The only remaining gaps — 8 literal Facebook URLs and the `Error().stack` scope hack — are low-risk maintainability items that do not introduce flakiness, do not cause real network calls, and do not reduce assertion quality. The suite is deterministic, mock-free, and mergeable as-is.

---

## Appendix: Violation Summary by Location

| File:Line | Severity | Tiêu chí | Vấn đề | Fix nhanh |
| --- | --- | --- | --- | --- |
| `tests/api/facebook-routes-integration.test.js:39, 46, 90` | L1 | Data Factories | URL `facebook.com/test` literal | Dùng `makeFacebookProfileUrl()` |
| `tests/api/facebook-automate-routes.test.js:50` | L1 | Data Factories | URL `facebook.com/somepage` literal | Dùng `makeFacebookProfileUrl()` |
| `tests/api/facebook-automate-routes.test.js:80` | L1 | Data Factories | URL `facebook.com/groups/test` literal | Dùng `makeFacebookGroupUrl()` |
| `tests/e2e/api-facebook.test.js:46, 86, 95` | L1 | Data Factories | URL `facebook.com/somepage` literal | Dùng `makeFacebookProfileUrl()` |
| `tests/utils/test-ids.js:7-16` | L2 | Test IDs | Scope từ `Error().stack`, dễ vỡ | Dùng `import.meta.url` hoặc const per file |

---

## Review Metadata

**Generated By**: BMad TEA Agent — `bmad-testarch-test-review`
**Review ID**: test-review-api-e2e-2026-08-13-r5
**Timestamp**: 2026-08-13
**Version**: 5.0
**Workflow**: testarch-test-review v5.0
