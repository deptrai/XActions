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

# Test Quality Review: `tests/api/` + `tests/e2e/` (Re-review r1)

**Quality Score**: 89/100 (A — Good)
**Review Date**: 2026-08-13
**Review Scope**: Directory — 7 test files + 1 shared fixture
**Reviewer**: Luisphan (TEA Agent)
**Execution Result**: `npx vitest run tests/api tests/e2e` — **7/7 files passed, 132/132 tests passed, 55.66s**

---

## Executive Summary

**Overall Assessment**: Good — hầu hết các vấn đề P1 từ lần review trước đã được khắc phục: file dài đã tách, assertion `if` theo status đã biến mất, fixture chung đã được tạo, DB seed/cleanup dùng thật, và tên test gây hiểu nhầm đã được sửa. Test suite chạy 100% pass. Còn lại rủi ro chủ yếu ở một test phụ thuộc mạng thật (chạy ~14s) và thiếu test ID / priority marker toàn bộ.

**Recommendation**: **Approve with Comments** — merge được, nhưng nên khắc phục P1 (test ID, kiểm soát network) trước khi mở rộng cho story tiếp theo.

### Key Strengths

- Tất cả test chạy real `app` qua `supertest`, không `vi.mock` / `vi.fn` / `vi.spyOn`.
- `tests/api/fixtures/test-user.js` cung cấp `seedTestUser`, `cleanupTestUser`, `makeTestToken`, `makeValidFacebookCookie` — đúng pattern pure-function → shared fixture.
- `facebook-automate-routes.test.js` đã rút gọn từ 358 dòng xuống 147 dòng và dùng `it.each` cho ma trận validation.
- `facebook-routes-integration.test.js` đã bỏ assertion `[200, 500]` gây hiểu nhầm; test scrape fail bây giờ bắt buộc `500` với cookie invalid.
- `api-auth.test.js` không còn chấp nhận `500` khi DB lỗi; sử dụng real DB user với `beforeAll` / `afterAll`.
- `facebook-accounts.test.js` giữ nguyên boundary + mutation-kill xuất sắc (c_user, xs, label, encrypt/decrypt).

### Key Weaknesses

- `facebook-routes-integration.test.js:84` — test scrape login fail vẫn chạy qua mạng thật, tốn ~14s và phụ thuộc timeout / kết nối ngoài.
- 7 file test không có test ID (`5.5-API-001`) hay priority marker (`@P0`, `@P1`).
- Một số giá trị vẫn hardcoded: `makeValidFacebookCookie` default, `fake-account-id`, `nonexistent-user-000`.
- 5 test trong `facebook-automate-routes.test.js` dùng `expect(res.status).not.toBe(400)` chưa kiểm tra status thành công cụ thể.
- `api-health.test.js:24` chấp nhận 200/301/302 cho `GET /` và dùng regex để phát hiện rate-limit headers.

---

## Quality Criteria Assessment

| Tiêu chí | Trạng thái | Lỗi vi phạm | Ghi chú |
| --- | --- | --- | --- |
| BDD Format (Given-When-Then) | PASS | 0 | Dự án không dùng BDD; tên `it()` mô tả rõ ràng |
| Test IDs | FAIL | 7 | Không có ID chính thức nào trên 7 file |
| Priority Markers (P0–P3) | FAIL | 7 | Không có marker `@P0`/`@P1`/`@P2`/`@P3` |
| Hard Waits | PASS | 0 | Không `waitForTimeout`, `sleep` |
| Determinism (no conditionals) | WARN | 2 | Một test scrape thật 14s, `GET /` chấp nhận nhiều status |
| Isolation (cleanup, no shared state) | PASS | 0 | `beforeAll`/`afterAll` + `cleanupTestUser` |
| Fixture Patterns | PASS | 0 | `tests/api/fixtures/test-user.js` dùng chung cho API + E2E |
| Data Factories | WARN | 3 | Fixture default cookie và một số id hardcoded |
| Network-First Pattern | N/A | 0 | API test, không navigate |
| Explicit Assertions | WARN | 5 | 5 test `not.toBe(400)` chưa cụ thể |
| Test Length (≤300 dòng) | PASS | 0 | File dài nhất 295 dòng |
| Test Duration (≤1.5 min/test) | PASS | 0 | Mỗi test <30s; suite ~56s |
| Flakiness Patterns | WARN | 2 | Test scrape thật, status động `GET /` |

**Total Violations**: 0 Critical, 2 High, 4 Medium, 3 Low

---

## Quality Score Breakdown

```
Starting Score:          100
Critical Violations:     -0  × 10 = -0
High Violations:         -2  × 5  = -10
Medium Violations:       -4  × 2  = -8
Low Violations:          -3  × 1  = -3

Bonus Points:
  Comprehensive Fixtures:       +5
  Perfect Isolation:            +5
                         --------
Total Bonus:             +10

Final Score:             89/100
Grade:                   A (Good)
```

> Điểm tăng từ 75 (review 2026-08-13) lên 89 phản ánh việc khắc phục đáng kể các P1: tách file, loại bỏ `if` assertion, thêm fixture chung, và sửa tên/test scrape gây hiểu nhầm.

---

## Critical Issues (Must Fix)

**Không có P0.** Không phát hiện hard wait, mock, assertion ẩn hoàn toàn, hay test thiếu assertion.

## High Issues (P1 — Should Fix)

### H1. Test scrape login fail vẫn phụ thuộc mạng thật và chạy ~14s

**File**: `tests/api/facebook-routes-integration.test.js:84`
**Criterion**: Flakiness / Determinism
**Knowledge Base**: [test-quality.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md), [ci-burn-in.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/ci-burn-in.md)

**Mô tả**:
Test `returns 500 when scrape login fails due to invalid cookie` hiện bắt buộc `500` (đã sửa từ review trước) nhưng vẫn kích hoạt scraper thật và đợi network timeout. Trong run vừa rồi test này chạy **14.026s** — gần một nửa thời gian toàn suite. Nếu network chậm hoặc Facebook không reachable, test có thể fail hoặc vượt `testTimeout: 30000`.

**Current Code**:

```js
it('returns 500 when scrape login fails due to invalid cookie', async () => {
  const res = await postScrape({
    action: 'profile',
    url: 'https://facebook.com/test',
    authCookie: { c_user: 'invalid', xs: 'invalid' },
  });
  expect(res.status).toBe(500);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(/scrape failed/i);
});
```

**Recommended Fix**:

- Option A: Buộc route handler validate cookie trước khi gọi scraper (trong `api/routes/facebook.js`) để trả về 500 ngay lập tức khi cookie invalid, không cần ra ngoài mạng.
- Option B: Nếu vẫn cần test integration đến scraper, thêm biến môi trường `TEST_SCRAPE_TIMEOUT` ngắn (e.g. 2000ms) chỉ trong test env và chạy burn-in 10 lần trước merge.

**Burn-in đề xuất**:

```bash
for i in {1..10}; do
  npx vitest run tests/api/facebook-routes-integration.test.js -t "returns 500 when scrape login fails" || break
done
```

### H2. Thiếu test ID trên tất cả 7 file test

**File**: all 7 files in `tests/api/` and `tests/e2e/`
**Criterion**: Test IDs
**Knowledge Base**: [test-levels-framework.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-levels-framework.md), [test-priorities-matrix.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-priorities-matrix.md)

**Mô tả**:
Không có ID chính thức theo định dạng `{EPIC}.{STORY}-{LEVEL}-{SEQ}` (ví dụ `5.5-API-001`). Điều này làm khó:
- Chạy selective test theo scope.
- Traceability giữa story/test design với test.
- Báo cáo CI rõ ràng khi test fail.

**Recommended Fix**:

Thêm ID trực tiếp vào tên test hoặc dùng helper:

```js
// tests/api/fixtures/test-user.js (hoặc tests/utils/test-ids.js)
export const testId = (epic, story, level, seq) =>
  `${epic}.${story}-${level}-${String(seq).padStart(3, '0')}`;
```

Ví dụ:

```js
it(`${testId(5, 5, 'API', 1)} POST /api/facebook/automate without auth token → 401`, async () => {
  ...
});
```

---

## Medium Issues (P2 — Recommendations)

### M1. Thiếu priority marker

**File**: all 7 test files
**Criterion**: Priority Markers

Dự án không yêu cầu bắt buộc, nhưng với khối lượng test tăng, nên thêm `@P0 @API`, `@P1 @E2E` vào tên hoặc metadata để chạy selective.

### M2. Còn dữ liệu hardcoded trong fixture và test

**File**: `tests/api/fixtures/test-user.js:23-25`, `tests/api/facebook-routes-integration.test.js:137`, `tests/e2e/api-facebook.test.js:109`, `tests/e2e/api-operations.test.js:75`
**Criterion**: Data Factories
**Knowledge Base**: [data-factories.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md)

**Mô tả**:
`makeValidFacebookCookie` trả về cookie mặc định cố định; một số test dùng `'fake-account-id'`, `'nonexistent-user-000'`, `'ghost'` trực tiếp.

**Recommended Fix**:

```js
// tests/api/fixtures/test-user.js
export function makeValidFacebookCookie(overrides = {}) {
  return {
    c_user: `10000${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`,
    xs: `xs-${randomUUID().slice(0, 16)}`,
    ...overrides,
  };
}

// Trong test
const fakeAccountId = `fake-${randomUUID().slice(0, 8)}`;
const res = await postAutomate({
  action: 'like',
  urls: ['https://facebook.com/post/1'],
  authCookie: { accountId: fakeAccountId },
  dryRun: true,
});
```

> Lưu ý: `randomUUID` đã dùng cho `makeTestUserId`, nhưng vẫn nên dùng factory có overrides thay vì string literal.

### M3. Assertion `not.toBe(400)` chưa kiểm tra status thành công cụ thể

**File**: `tests/api/facebook-automate-routes.test.js:94, 105, 110, 122, 138`
**Criterion**: Explicit Assertions
**Knowledge Base**: [test-quality.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/test-quality.md)

**Current Code**:

```js
it('cancel-friend-requests — empty body should NOT return 400 (auth + dryRun only)', async () => {
  const res = await postAutomate({ action: 'cancel-friend-requests', authCookie: VALID_COOKIE });
  expect(res.status).not.toBe(400);
  expect(typeof res.body.ok).toBe('boolean');
});
```

**Recommended Fix**:

Với dry-run, response mong đợi là `200` + `ok: true`:

```js
it('cancel-friend-requests — empty body returns 200 dry-run', async () => {
  const res = await postAutomate({ action: 'cancel-friend-requests', authCookie: VALID_COOKIE });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});
```

Tương tự cho `warmup-account`, `POST /api/facebook/scrape — group-members with valid url format should NOT return 400`.

### M4. Comment chứa số dòng source code, dễ lỗi thời

**File**: `tests/api/facebook-accounts.test.js:117, 201, 209, 216` (và nhiều dòng khác)
**Criterion**: Maintainability

Các comment kiểu `L49, L50, L58, L65, L66` và `L88` tham chiếu đến dòng source `api/routes/facebookAccounts.js`. Khi source refactor, số dòng thay đổi sẽ khiến comment sai. Nên thay bằng tên hàm / mô tả mutant.

**Recommended Fix**:

```js
// ✅ Better
// StringLiteral mutant: 'hex' encoding must not be empty
// MethodExpression mutant: c_user.trim() must not be removed
```

---

## Low Issues (P3)

### L1. `GET /` chấp nhận nhiều status

**File**: `tests/e2e/api-health.test.js:24`
**Criterion**: Determinism

```js
expect([200, 301, 302]).toContain(res.status);
```

Dù comment giải thích, test sẽ rõ ràng hơn nếu xác định chính xác status trả về trong env test (thường là `200` nếu dashboard `index.html` được serve trực tiếp).

### L2. Kiểm tra rate-limit header bằng regex

**File**: `tests/e2e/api-health.test.js:55-59`
**Criterion**: Explicit Assertions

```js
const rateLimitHeaders = Object.keys(res.headers).filter((h) =>
  /^(x-)?ratelimit|retry-after/i.test(h)
);
expect(rateLimitHeaders.length).toBeGreaterThan(0);
```

Nên assert một header cụ thể (ví dụ `x-ratelimit-limit` hoặc `retry-after`) để failure dễ diagnose.

### L3. `makeTestUserId` dùng `randomUUID()` không có seed

**File**: `tests/api/fixtures/test-user.js:12-15`
**Criterion**: Determinism

```js
export function makeTestUserId(prefix = 'test') {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}
```

Điều này đảm bảo unique trong parallel nhưng không reproducible. Có thể thay bằng counter hoặc `faker.string.uuid()` với seed cố định nếu cần debug lặp lại.

---

## Best Practices Found

### BP1. Shared fixture `tests/api/fixtures/test-user.js` là mẫu tốt

**File**: `tests/api/fixtures/test-user.js`
**Pattern**: Pure function → Fixture → seed/cleanup
**Knowledge Base**: [fixture-architecture.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/fixture-architecture.md), [data-factories.md](/Users/luisphan/.bmad/cache/custom-modules/github.com/deptrai/nowing/.claude/skills/bmad-testarch-test-review/resources/knowledge/data-factories.md)

```js
export async function seedTestUser(userId, username = 'api_test_user') {
  ...
  return { user, token: makeTestToken(user.id, user.username), password: 'TestPassword123!' };
}

export async function cleanupTestUser(userId) {
  await prisma.operation.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.schedule.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.facebookAccount.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}
```

Pure functions, có overrides, tự động cleanup, dùng chung giữa `tests/api` và `tests/e2e`.

### BP2. Sử dụng `it.each` cho ma trận validation

**File**: `tests/api/facebook-automate-routes.test.js:63-88`, `tests/e2e/api-auth.test.js:23-39`
**Pattern**: Parametrized tests

```js
it.each([
  ['unknown action', { action: 'nonexistent-action', authCookie: VALID_COOKIE }, /action must be one of/],
  ...
])('%s → 400', async (desc, body, pattern) => {
  const res = await postAutomate(body);
  expect(res.status).toBe(400);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(pattern);
});
```

Giảm lặp, rõ ràng, dễ thêm case.

### BP3. Boundary + mutation-kill testing xuất sắc

**File**: `tests/api/facebook-accounts.test.js:21-293`
**Pattern**: Boundary + mutation-aware

Kiểm tra 50/51 ký tự label, 10/20 chữ số c_user, 4096/4097 ký tự xs, trim, type coercion, auth tag tamper, hex encoding. Nên dùng làm reference cho validation tests khác.

### BP4. E2E health test tập trung, nhanh

**File**: `tests/e2e/api-health.test.js:1-61`
**Pattern**: Smoke test đơn giản

Kiểm tra health, openapi, helmet headers, 404 shape trong 62 dòng, không cần DB.

---

## Test File Analysis

### Suite Metadata

- **Framework**: Vitest 4.0.18
- **Environment**: Node.js, `supertest`
- **Config**: `vitest.config.js` — `pool: 'forks'`, `fileParallelism: false`, `testTimeout: 30000`
- **Test Files**: 7
- **Total Lines**: 1017
- **Total Tests**: 132
- **Total Assertions (expect)**: ~189
- **Hard Waits**: 0
- `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock`: 0

### Test Files

| File | Dòng | Tests | Assertions | Describe | beforeAll | afterAll | Fixtures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 50 | 5 | 0 | 0 | Không |
| `tests/api/facebook-automate-routes.test.js` | 147 | 29 | 20 | 4 | 1 | 1 | `test-user.js` |
| `tests/api/facebook-routes-integration.test.js` | 168 | 17 | 40 | 2 | 1 | 1 | `test-user.js` |
| `tests/e2e/api-auth.test.js` | 116 | 14 | 24 | 1 | 1 | 1 | `test-user.js` |
| `tests/e2e/api-facebook.test.js` | 118 | 9 | 18 | 1 | 1 | 1 | `test-user.js` |
| `tests/e2e/api-health.test.js` | 62 | 8 | 17 | 1 | 0 | 0 | Không |
| `tests/e2e/api-operations.test.js` | 118 | 13 | 20 | 1 | 1 | 1 | `test-user.js` |

### Test Scope

- **Test IDs**: Không có
- **Priority Distribution**:
  - P0 (Critical): 0
  - P1 (High): 0
  - P2 (Medium): 0
  - P3 (Low): 0
  - Unknown: 132

### Assertions Analysis

- **Total Assertions**: ~189
- **Assertions per Test (avg)**: ~1.43
- **Assertion Types**: `toBe`, `toMatch`, `toMatchObject`, `toHaveProperty`, `toBeInstanceOf`, `toContain`, `not.toBe`

---

## Per-File Scores

| File | Dòng | Tests | Điểm | Grade | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| `tests/e2e/api-auth.test.js` | 116 | 14 | 89 | B+ | Approve |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 88 | A- | Approve |
| `tests/api/facebook-automate-routes.test.js` | 147 | 29 | 87 | B+ | Approve |
| `tests/e2e/api-facebook.test.js` | 118 | 9 | 87 | B+ | Approve |
| `tests/e2e/api-operations.test.js` | 118 | 13 | 87 | B+ | Approve |
| `tests/e2e/api-health.test.js` | 62 | 8 | 85 | B | Approve |
| `tests/api/facebook-routes-integration.test.js` | 168 | 17 | 82 | B | Approve with comments |

**Suite Average**: 88/100 (A — Good)

---

## Context and Integration

### Related Artifacts

- Không tìm thấy story file riêng trong `_bmad-output/`. AC được suy diễn từ inline comments (ví dụ `facebook-accounts.test.js` đề cập Story 5.5 — AC2, AC9).
- `vitest.config.js` được sử dụng; `fileParallelism: false` đảm bảo test chạy tuần tự, phù hợp với suite dùng real DB/server.

### Quality Trends

| Review Date | Score | Grade | Critical Issues | Trend |
| --- | --- | --- | --- | --- |
| 2026-08-13 | 75/100 | B | 0 | Baseline |
| 2026-08-13 r1 | 89/100 | A | 0 | ⬆️ Improved |

---

## Knowledge Base References

Các tài liệu đã tham khảo cho review này:

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

### Immediate Actions (Before Merge)

1. **H1** — Kiểm soát network trong test scrape fail
   - Priority: P1
   - Owner: Backend / QA
   - Estimated Effort: 1–2h

2. **H2** — Thêm test IDs cho 7 file test
   - Priority: P1
   - Owner: QA
   - Estimated Effort: 1–2h

3. **M3** — Thay `not.toBe(400)` bằng `toBe(200)` cho các dry-run / valid cases
   - Priority: P2
   - Owner: Dev
   - Estimated Effort: 30m

### Follow-up Actions (Future PRs)

1. Thêm priority marker `@P0`/`@P1` để hỗ trợ selective testing.
2. Cải thiện `makeValidFacebookCookie` và các test token id để fully factory-based.
3. Chạy 10-iteration burn-in trên `facebook-routes-integration.test.js` trước khi merge story tiếp theo.

### Re-Review Needed?

**⚠️ Re-review after P1 fixes** — đặc biệt H1 (network) và H2 (test IDs). Sau khi fix, chạy lại `npx vitest run tests/api tests/e2e` và cập nhật score.

---

## Decision

**Recommendation**: **Approve with Comments**

**Rationale**: Test suite đã cải thiện đáng kể so với review gốc (75 → 89). Các vấn đề P1 nghiêm trọng (file dài, `if` assertion, tên test gây hiểu nhầm, thiếu cleanup) đã được khắc phục. Còn lại một test phụ thuộc mạng thật và thiếu test ID/priority marker. Các vấn đề này không nên block merge nhưng cần fix trước khi mở rộng suite cho story tiếp theo.

---

## Appendix: Violation Summary by Location

| File:Line | Severity | Tiêu chí | Vấn đề | Fix nhanh |
| --- | --- | --- | --- | --- |
| `facebook-routes-integration.test.js:84` | P1 | Flakiness | Test scrape thật, ~14s | Validate cookie trước khi gọi scraper hoặc timeout ngắn |
| `all 7 test files` | P1 | Test IDs | Không có test ID | Thêm `5.5-API-001` / `5.5-E2E-001` |
| `all 7 test files` | P2 | Priority Markers | Không có `@P0`/`@P1` | Thêm marker theo story |
| `test-user.js:23-25`, `facebook-routes-integration.test.js:137`, `api-facebook.test.js:109`, `api-operations.test.js:75` | P2 | Data Factories | Hardcoded cookie / id | Dùng factory với overrides |
| `facebook-automate-routes.test.js:94,105,110,122,138` | P2 | Explicit Assertions | `not.toBe(400)` chưa cụ thể | `toBe(200)` + `ok: true` |
| `facebook-accounts.test.js:117,201,209,216` | P2 | Maintainability | Comment số dòng source | Dùng tên hàm / mô tả mutant |
| `api-health.test.js:24` | P3 | Determinism | `GET /` chấp nhận 200/301/302 | Xác định canonical status |
| `api-health.test.js:55-59` | P3 | Explicit Assertions | Regex tìm rate-limit header | Assert header cụ thể |
| `test-user.js:12-15` | P3 | Determinism | `makeTestUserId` dùng randomUUID | Dùng counter hoặc seed |

---

## Review Metadata

**Generated By**: BMad TEA Agent — `bmad-testarch-test-review`
**Review ID**: test-review-api-e2e-2026-08-13-r1
**Timestamp**: 2026-08-13
**Version**: 1.0
**Workflow**: testarch-test-review v5.0
