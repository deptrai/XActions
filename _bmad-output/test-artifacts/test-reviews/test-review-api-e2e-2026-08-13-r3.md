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
lastStep: step-04-generate-report
lastSaved: 2026-08-13
inputDocuments:
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/fixture-architecture.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-levels-framework.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/api-request.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/auth-session.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/fixtures-composition.md
  - /Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/ci-burn-in.md
---

# Test Quality Review: `tests/api/` + `tests/e2e/` (Re-review r3)

**Quality Score**: 96/100 (A — Excellent)
**Review Date**: 2026-08-13
**Review Scope**: Directory — 7 test files + 1 shared fixture + 1 test-id helper
**Reviewer**: Luisphan (TEA Agent)
**Execution Result**: `npx vitest run tests/api tests/e2e` — **7/7 files passed, 129/129 tests passed, 12.01s**

---

## Executive Summary

**Overall Assessment**: Excellent — four of the five r2 remaining issues are fully or substantially resolved. The suite is now fast, deterministic, and free of real-network calls. `facebook-automate-routes.test.js` no longer triggers Puppeteer/Facebook, `makeTestUserId`/`makeValidFacebookCookie` are reproducible, and the stale `Lxx` source-line comments in `facebook-accounts.test.js` have been replaced with stable mutant descriptions. The only meaningful remaining gap is the test ID/priority scheme: IDs are now unique across files, but still collide inside `it.each` matrices and are missing from `facebook-automate-routes.test.js`; priority markers default to `@P2` with no real prioritization.

**Recommendation**: **Approve for merge**. The suite is mergeable as-is. The residual ID/priority items are maintainability concerns, not blockers, and can be addressed in a follow-up polish PR.

### Key Strengths

- **H1 network/Puppeteer dependency removed**: `tests/api/facebook-automate-routes.test.js:91-131` now only exercises validation and dry-run paths. The slow 8–15s tests from r2 (`cancel-friend-requests`, `group-members` with a real URL) are gone. Suite duration dropped from **45.63s → 12.01s** and the slowest single test from **15502ms → 107ms**.
- **M2 stale source-line comments fixed**: `tests/api/facebook-accounts.test.js:124, 133, 138, 157, 172, 182, 203, 222, 232, 233, 244, 253, 260, 261, 272, 282, 291` now reference Stryker mutants by name (`StringLiteral mutant: 'hex' → ''`, `ConditionalExpression mutant: false → parts.length check bypassed`, etc.) instead of fragile line numbers.
- **L1 `makeTestUserId` is now reproducible**: `tests/api/fixtures/test-user.js:12-17` uses a per-process counter with a caller-supplied prefix (`makeTestUserId('auth-e2e')`), and `makeValidFacebookCookie` at `tests/api/fixtures/test-user.js:28-39` uses a deterministic counter + SHA-256 hex suffix.
- **No regressions in coverage**: 129 tests pass (3 slow/flaky network tests removed), `expect()` count is 189, and the suite still has zero mocks/stubs/spies (`vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock`).
- **Boundary + mutation-kill quality retained**: `facebook-accounts.test.js` still exercises 50/51 char label, 10/20 digit `c_user`, 4096/4097 char `xs`, trim, type coercion, and auth-tag tampering.

### Key Weaknesses

- **H2 test ID scheme not fully stable**: `tests/utils/test-ids.js:3-20` now adds a file-scoped prefix and a priority marker, so **cross-file duplicates are gone**. However, `nextTestId` is evaluated **once per `it.each` title**, so all rows in a matrix share the same ID. In this run that produced:
  - `5.5-e2e-api-auth-E2E-001 @P2` used 4 times
  - `5.5-e2e-api-auth-E2E-006 @P2` used 2 times
  - `5.5-e2e-api-operations-E2E-008 @P2` used 3 times
- **26 tests have no ID at all**: `tests/api/facebook-automate-routes.test.js:36, 44, 52, 63, 96, 103, 117, 126` never call `nextTestId`. Out of 129 tests, only **103 carry an ID** and only **97 are unique**.
- **M1 priority markers are present but not useful**: `nextTestId(level, priority = 'P2')` at `tests/utils/test-ids.js:3` appends `@P2` by default, but every single call in the suite uses the default. There are no `@P0`, `@P1`, or `@P3` markers, and `facebook-automate-routes.test.js` has no marker at all. The marker exists, but the suite is not actually prioritized.
- **L2 a few literal IDs/URLs remain**: `tests/e2e/api-operations.test.js:54, 60` uses `'some-operation-id'`; `tests/api/facebook-routes-integration.test.js:99, 127, 137, 148, 149, 159` uses `'https://facebook.com/post/1'` and `'acct1'`, `'acct2'`; `tests/api/facebook-automate-routes.test.js:39, 47, 56, 67, 77, 127` uses literal Facebook URLs. These are not sensitive or flaky in the current validation-only context, but they are not factory-driven.

---

## Quality Criteria Assessment

| Tiêu chí | Trạng thái | Lỗi vi phạm | Ghi chú |
| --- | --- | --- | --- |
| BDD Format (Given-When-Then) | PASS | 0 | Tên `it()` mô tả rõ ràng, không dùng BDD |
| Test IDs | WARN | 2 | Unique giữa các file; vẫn trùng trong `it.each` và thiếu 26 ID |
| Priority Markers (P0–P3) | WARN | 2 | Có marker `@P2` mặc định, không có P0/P1/P3, thiếu trong `facebook-automate-routes` |
| Hard Waits | PASS | 0 | Không `waitForTimeout`, `sleep`, `setTimeout` trong 7 file |
| Determinism (no conditionals) | PASS | 0 | `sequence.shuffle: true` vẫn bật, nhưng fixture/user/cookie counter xác định |
| Isolation (cleanup, no shared state) | PASS | 0 | `beforeAll`/`afterAll` + `cleanupTestUser` |
| Fixture Patterns | PASS | 0 | `tests/api/fixtures/test-user.js` dùng chung cho API + E2E |
| Data Factories | PASS | 0 | Cookie/ID qua factory; còn vài URL/ID literal |
| Network-First Pattern | N/A | 0 | API/E2E gọi Express trực tiếp, không navigate |
| Explicit Assertions | PASS | 0 | Không còn `not.toBe(400)`; mọi assertion cụ thể |
| Test Length (≤300 dòng) | PASS | 0 | File dài nhất 295 dòng |
| Test Duration (≤1.5 min/test) | PASS | 0 | Mỗi test ≤107ms; toàn bộ suite 12.01s |
| Flakiness Patterns | PASS | 0 | Không còn test chạm mạng thật/Puppeteer |

**Total Violations**: 0 Critical, 1 High, 0 Medium, 3 Low

*(Chất lượng thực tế tốt hơn con số vi phạm: H2 và M1 liên quan chặt chẽ đến cùng một helper `nextTestId`, nên còn 1 nhóm vấn đề cơ bản thay vì 3 vấn đề riêng biệt.)*

---

## Quality Score Breakdown

```
Starting Score:          100
Critical Violations:     -0  × 10 = -0
High Violations:         -1  × 5  = -5   (residual test ID scheme: it.each duplicates + 26 missing IDs)
Medium Violations:       -0  × 2  = -0
Low Violations:          -3  × 1  = -3   (priority markers not prioritized; hardcoded operation/account/URL literals; stack-trace ID helper slightly brittle)

Bonus Points:
  Deterministic Fixtures:       +2
  Network-Free Fast Suite:      +2
  Perfect Isolation:            +1
  Boundary + Mutation-Kill:     +1
                         --------
Total Bonus:             +6

Final Score:             96/100
Grade:                   A (Excellent)
```

> Điểm tăng từ 92 (r2) lên 96 (r3) phản ánh việc khắc phục H1 (network), M2 (stale comments), L1 (seeded user/cookie), và cải thiện H2 (ID không còn trùng giữa các file). Điểm bị kéo xuống bởi residual test ID trong `it.each`, 26 test thiếu ID, và priority markers chưa có ý nghĩa thực sự.

---

## Critical Issues (Must Fix)

**Không có P0.** Không phát hiện hard wait, mock, assertion ẩn, test thiếu assertion, hoặc lỗi thực thi.

---

## High Issues (P1 — Should Fix)

### H1. Residual test ID instability

**File**: `tests/utils/test-ids.js:3-20`, `tests/e2e/api-auth.test.js:29, 81`, `tests/e2e/api-operations.test.js:90`, `tests/api/facebook-automate-routes.test.js:36-131`
**Criterion**: Test IDs
**Knowledge Base**: [test-levels-framework.md](...)

**Mô tả**:
- `nextTestId` được gọi **một lần** trong template literal của `it.each`, do đó toàn bộ 4 case `register`, 2 case `refresh`, và 3 case `operations/no-session` chia sẻ cùng ID.
- `facebook-automate-routes.test.js` không import `nextTestId`, nên 26/129 test trong suite không có ID.
- Helper dùng `new Error().stack` để lấy tên file — tương đối dễ vỡ nếu stack format thay đổi hoặc khi test được bundle/minify.

**Current Code**:

```js
// tests/utils/test-ids.js:3-20
export function nextTestId(level, priority = 'P2') {
  const stack = new Error().stack || '';
  const callerLine = stack
    .split('\n')
    .slice(2)
    .find((line) => line.includes('/tests/') && !line.includes('/test-ids.js'));
  // ... returns `5.5-${scope}-${level}-${seq} @${priority}`
}

// tests/e2e/api-auth.test.js:29
])(`[${nextTestId('E2E')}] POST /api/auth/register with %s → 400`, ...)
```

**Recommended Fix**:

```js
// Embed a per-row ID + priority inside the first column
it.each([
  ['5.5-e2e-api-auth-E2E-001 @P2 empty body', {}, ['username', 'password']],
  ['5.5-e2e-api-auth-E2E-002 @P2 invalid username', { ... }],
  // ...
])('POST /api/auth/register with %s → 400', async (desc, body, expectedPaths) => { ... })
```

For `facebook-automate-routes.test.js`, re-introduce `nextTestId` (or per-row IDs) so all 26 tests are tagged.

---

## Medium Issues (P2 — Recommendations)

### M1. Priority markers do not express real priority

**File**: `tests/utils/test-ids.js:3`, all 7 test files
**Criterion**: Priority Markers

`nextTestId(level, priority = 'P2')` always defaults to `@P2`. No test passes a priority override, so the suite cannot be filtered by critical/high/low priority. Additionally, `facebook-automate-routes.test.js` has no marker.

**Recommended Fix**:

```js
it(`[${nextTestId('API', 'P1')}] returns 400 for missing label`, ...)
```

Mark true smoke/health checks as `@P1`, error-boundary/edge cases as `@P2` or `@P3`.

---

## Low Issues (P3)

### L1. A few hardcoded operation/account/URL literals

**File**: `tests/e2e/api-operations.test.js:54, 60`, `tests/api/facebook-routes-integration.test.js:99, 127, 137, 148, 159`, `tests/api/facebook-automate-routes.test.js:39, 47, 56, 67, 77, 127`
**Criterion**: Data Factories

`'some-operation-id'`, `'acct1'`, `'acct2'`, `'https://facebook.com/post/1'`, etc. are acceptable for validation tests but not driven by factories. Recommend moving to `makeOperationId()` or `makeFacebookUrl()` helpers with `overrides`.

---

## Best Practices Found

### BP1. `tests/api/fixtures/test-user.js` is now fully reproducible

**File**: `tests/api/fixtures/test-user.js:12-39`
**Pattern**: Counter-based factory with deterministic hashing

```js
let userIdCounter = 0;
export function makeTestUserId(prefix = 'test') {
  return `${prefix}-${String(++userIdCounter).padStart(6, '0')}`;
}

let cookieCounter = 0;
export function makeValidFacebookCookie(overrides = {}) {
  const n = ++cookieCounter;
  const cUser = String(100000000000000 + n).padStart(15, '0');
  return { c_user: cUser, xs: `xs-${String(n).padStart(8, '0')}-${deterministicHex(n)}`, ...overrides };
}
```

### BP2. Network-free validation in `facebook-automate-routes.test.js`

**File**: `tests/api/facebook-automate-routes.test.js:62-89`
**Pattern**: 19-row `it.each` matrix covering action validation

Replaces the three slow/flaky network-dependent tests from r2 with fast local validation.

### BP3. Stale line-number comments replaced by mutant descriptions

**File**: `tests/api/facebook-accounts.test.js:124-292`
**Pattern**: Stryker-aware test comments by mutant type rather than line number

```js
// StringLiteral mutant: 'hex' → '' → cipher.update throws or produces binary
```

---

## Test File Analysis

### Suite Metadata

- **Framework**: Vitest 4.0.18
- **Environment**: Node.js, `supertest`
- **Config**: `vitest.config.js` — `pool: 'forks'`, `fileParallelism: false`, `testTimeout: 30000`, `sequence.shuffle: true`
- **Test Files**: 7
- **Total Lines**: 1005
- **Total Tests**: 129
- **Total Assertions (`expect(`)**: 189
- **Hard Waits**: 0
- `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock`: 0
- **Unique Test IDs**: 97
- **Tests with no ID**: 26
- **Duplicate Test IDs**: 3 (all within `it.each` matrices)

### Test Files

| File | Dòng | Tests | Assertions | Max Duration | Fixtures |
| --- | --- | --- | --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 50 | 102ms | Không |
| `tests/api/facebook-automate-routes.test.js` | 131 | 26 | 18 | 102ms | `test-user.js` |
| `tests/api/facebook-routes-integration.test.js` | 168 | 17 | 40 | 32ms | `test-user.js` |
| `tests/e2e/api-auth.test.js` | 115 | 14 | 24 | 107ms | `test-user.js` |
| `tests/e2e/api-facebook.test.js` | 118 | 9 | 18 | 32ms | `test-user.js` |
| `tests/e2e/api-health.test.js` | 60 | 8 | 19 | 20ms | Không |
| `tests/e2e/api-operations.test.js` | 118 | 13 | 20 | 34ms | `test-user.js` |

### Test ID / Priority Distribution

| Category | Count | Notes |
| --- | --- | --- |
| Unique ID | 97 | Dạng `5.5-{file}-{level}-{seq} @P2` |
| Duplicate ID | 7 tests | `E2E-001` ×4, `E2E-006` ×2, `E2E-008` ×3 |
| No ID | 26 | Toàn bộ `facebook-automate-routes.test.js` |
| P0 / P1 / P3 | 0 | Tất cả marker là `@P2` |

---

## Per-File Scores

| File | Dòng | Tests | Assertions | Điểm | Grade | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- |
| `tests/e2e/api-health.test.js` | 60 | 8 | 19 | 99 | A | Approve |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 50 | 97 | A | Approve |
| `tests/api/facebook-routes-integration.test.js` | 168 | 17 | 40 | 96 | A | Approve |
| `tests/e2e/api-facebook.test.js` | 118 | 9 | 18 | 96 | A | Approve |
| `tests/e2e/api-operations.test.js` | 118 | 13 | 20 | 95 | A | Approve |
| `tests/e2e/api-auth.test.js` | 115 | 14 | 24 | 95 | A | Approve |
| `tests/api/facebook-automate-routes.test.js` | 131 | 26 | 18 | 93 | A | Approve with comments |

**Suite Average**: 96/100 (A — Excellent)

---

## Context and Integration

### Related Artifacts

- Review trước: `_bmad-output/test-artifacts/test-reviews/test-review-api-e2e-2026-08-13-r2.md`
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

---

## Knowledge Base References

- `test-quality.md` — Definition of Done (no hard waits, <300 dòng, <1.5 phút/test, explicit assertions)
- `fixture-architecture.md` — Pure function → Fixture → mergeTests pattern
- `data-factories.md` — Factory functions với overrides, tránh hardcoded
- `test-levels-framework.md` — E2E vs API vs Unit phân loại
- `api-request.md` — Typed HTTP client và retry strategy
- `auth-session.md` — Token persistence và multi-user auth
- `fixtures-composition.md` — Composable fixtures
- `ci-burn-in.md` — Flakiness detection patterns (10-iteration loop)

---

## Next Steps

### Immediate Actions (Before or Right After Merge)

1. **H1 — Fix residual test ID scheme**
   - Embed per-row IDs in `it.each` matrices (`api-auth`, `api-operations`) and add IDs to `facebook-automate-routes`.
   - Priority: P1
   - Owner: QA
   - Estimated Effort: 1–2h

2. **M1 — Use real priority values**
   - Call `nextTestId('API'|'E2E', 'P0'|'P1'|'P2'|'P3')` and default critical smoke tests to `@P1`.
   - Priority: P2
   - Owner: QA
   - Estimated Effort: 30m

### Follow-up Actions (Future PRs)

1. Replace remaining hardcoded operation/account/URL literals with small factory helpers.
2. Consider making `nextTestId` derive file scope from `import.meta.url` or a per-file constant instead of `Error().stack`.
3. Run a 10-iteration burn-in on `tests/api tests/e2e` once IDs are stable.

### Re-Review Needed?

**No re-review required for merge.** Re-review (r4) only if test ID/priority work is completed and the team wants a formal sign-off.

---

## Decision

**Recommendation**: **Approve for merge**

**Rationale**: Suite đã khắc phục hầu hết các vấn đề r2: test nhanh (12s), không còn network/Puppeteer, fixture xác định, comment source-line được thay bằng mô tả mutant. Các vấn đề còn lại (test ID `it.each` duplicate, 26 test thiếu ID, marker @P2 mặc định) là maintainability cấp thấp, không gây flaky và không nên block merge. Điểm 96/100 phản ánh chất lượng xuất sắc với một số polish còn lại.

---

## Appendix: Violation Summary by Location

| File:Line | Severity | Tiêu chí | Vấn đề | Fix nhanh |
| --- | --- | --- | --- | --- |
| `tests/utils/test-ids.js:3-20` | H1 | Test IDs | `it.each` chia sẻ ID; 26 test thiếu ID | Embed row ID hoặc gọi nextTestId per row |
| `tests/e2e/api-auth.test.js:29, 81` | H1 | Test IDs | `it.each` dùng 1 ID cho 4/2 case | Embed row ID trong desc |
| `tests/e2e/api-operations.test.js:90` | H1 | Test IDs | `it.each` dùng 1 ID cho 3 case | Embed row ID trong desc |
| `tests/api/facebook-automate-routes.test.js:36-131` | H1 | Test IDs | 26 test không có ID | Thêm `nextTestId` hoặc per-row ID |
| `tests/utils/test-ids.js:3` | M1 | Priority | `priority = 'P2'` mặc định, không có P0/P1/P3 | Truyền priority cụ thể |
| `tests/e2e/api-operations.test.js:54, 60` | L1 | Data Factories | `'some-operation-id'` | Dùng factory |
| `tests/api/facebook-routes-integration.test.js:99, 127, 137, 148, 149, 159` | L1 | Data Factories | URL `facebook.com/post/1`, `acct1/2` | Dùng factory |
| `tests/api/facebook-automate-routes.test.js:39, 47, 56, 67, 77, 127` | L1 | Data Factories | URL Facebook literal | Dùng factory |

---

## Review Metadata

**Generated By**: BMad TEA Agent — `bmad-testarch-test-review`
**Review ID**: test-review-api-e2e-2026-08-13-r3
**Timestamp**: 2026-08-13
**Version**: 3.0
**Workflow**: testarch-test-review v5.0
