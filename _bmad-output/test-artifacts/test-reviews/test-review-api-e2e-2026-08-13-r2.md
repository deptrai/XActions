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

# Test Quality Review: `tests/api/` + `tests/e2e/` (Re-review r2)

**Quality Score**: 92/100 (A — Good)
**Review Date**: 2026-08-13
**Review Scope**: Directory — 7 test files + 1 shared fixture + 1 test-id helper
**Reviewer**: Luisphan (TEA Agent)
**Execution Result**: `npx vitest run tests/api tests/e2e` — **7/7 files passed, 132/132 tests passed, 45.63s**

---

## Executive Summary

**Overall Assessment**: Good — các vấn đề P1 từ r1 đã được khắc phục rõ rệt: validate cookie shape trên `api/routes/facebook.js` khiến test invalid cookie trả về 400 ngay lập tức (~3ms); tất cả 7 file đã có test ID; các assertion `not.toBe(400)` đã thay bằng `toBe(200/400/500)` rõ ràng; fixture `makeValidFacebookCookie` đã random hóa; `api-health.test.js` đã xác định status và rate-limit headers cụ thể. Tuy nhiên, vẫn còn rủi ro quan trọng: một số test vẫn chạm mạng thật / Puppeteer và tốn 8–15 giây; scheme `nextTestId` bị trùng lặp ID giữa các file và giữa các case `it.each`; các comment tham chiếu số dòng source đã lỗi thời.

**Recommendation**: **Approve with Comments** — suite đủ chất lượng merge, nhưng nên khắc phục H1 (network) và H2 (ID scheme) trước khi mở rộng cho story tiếp theo.

### Key Strengths

- **H1 cookie-shape fix hiệu quả**: `api/routes/facebook.js:15-51` thêm `validateRawCookie` với regex `^\d{10,20}$`; test `returns 400 for an invalidly shaped raw cookie` ở `facebook-routes-integration.test.js:85` chạy **3ms** thay vì ~14s.
- **Tất cả test đã có ID** dùng `tests/utils/test-ids.js`; tên test giờ dạng `[5.5-API-001] ...` / `[5.5-E2E-001] ...`.
- **Assertions cụ thể hóa**: `facebook-automate-routes.test.js` không còn `not.toBe(400)`; dry-run/valid case đều assert `toBe(200)` + `ok: true`, invalid case assert `toBe(400/500)`.
- **Fixture cải tiến**: `tests/api/fixtures/test-user.js:21-30` `makeValidFacebookCookie` sinh random 15-digit `c_user` và `xs`, hỗ trợ `overrides`; `makeTestUserId` dùng `randomUUID` tránh collision.
- **api-health xác định hơn**: `GET /` assert `toBe(200)`; rate-limit headers assert `x-ratelimit-limit` và `x-ratelimit-remaining` cụ thể.
- **Không có mock/stub/spy**: 0 `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock` trong 7 file.
- **Isolation tốt**: mỗi file có `beforeAll`/`afterAll` với `seedTestUser`/`cleanupTestUser` và user ID duy nhất.
- **Boundary + mutation-kill vẫn xuất sắc** ở `facebook-accounts.test.js`.

### Key Weaknesses

- **Vẫn còn test phụ thuộc mạng thật / Puppeteer chậm** trong `facebook-automate-routes.test.js`:
  - `POST /api/facebook/scrape — group-members with valid url format → 200` (**15502ms**)
  - `cancel-friend-requests — dryRun with invalid session cookie → 500` (**10502ms**)
  - `cancel-friend-requests — with optional fields → 500 when session is invalid` (**8175ms**)
- **Test ID scheme có vấn đề thiết kế**: `nextTestId` trong `tests/utils/test-ids.js` reset theo file (do `pool: 'forks'`) tạo ra ID trùng lặp giữa các file; `it.each` gọi `nextTestId` một lần nên tất cả row chia sẻ cùng ID.
- **Comment số dòng source lỗi thời** trong `facebook-accounts.test.js` (L49, L50, L58, L65, L66, L88...) không còn khớp với `api/routes/facebookAccounts.js` hiện tại.
- **Chưa có priority marker** `@P0`/`@P1`/`@P2`/`@P3`.
- `makeTestUserId` dùng `randomUUID()` không seed, không reproducible khi debug.

---

## Quality Criteria Assessment

| Tiêu chí | Trạng thái | Lỗi vi phạm | Ghi chú |
| --- | --- | --- | --- |
| BDD Format (Given-When-Then) | PASS | 0 | Tên `it()` mô tả rõ ràng, không dùng BDD |
| Test IDs | WARN | 7 | Có ID nhưng `nextTestId` reset theo file và `it.each` chia sẻ ID |
| Priority Markers (P0–P3) | FAIL | 7 | Không có marker `@P0`/`@P1`/`@P2`/`@P3` |
| Hard Waits | PASS | 0 | Không `waitForTimeout`, `sleep`, `setTimeout` trong test |
| Determinism (no conditionals) | WARN | 2 | `sequence.shuffle: true`; `makeTestUserId`/`makeValidFacebookCookie` dùng random |
| Isolation (cleanup, no shared state) | PASS | 0 | `beforeAll`/`afterAll` + `cleanupTestUser` |
| Fixture Patterns | PASS | 0 | `tests/api/fixtures/test-user.js` dùng chung cho API + E2E |
| Data Factories | PASS | 0 | Cookie/ID đều qua factory; còn vài URL literal |
| Network-First Pattern | N/A | 0 | API test, không navigate |
| Explicit Assertions | PASS | 0 | Không còn `not.toBe(400)`; mọi assertion cụ thể |
| Test Length (≤300 dòng) | PASS | 0 | File dài nhất 295 dòng |
| Test Duration (≤1.5 min/test) | PASS | 0 | Mỗi test <30s; 3 test ~8-15s gần ceiling |
| Flakiness Patterns | WARN | 3 | `group-members`, `cancel-friend-requests` chạm mạng; test ID không ổn định giữa các file |

**Total Violations**: 0 Critical, 2 High, 2 Medium, 2 Low

---

## Quality Score Breakdown

```
Starting Score:          100
Critical Violations:     -0  × 10 = -0
High Violations:         -2  × 5  = -10
Medium Violations:       -2  × 2  = -4
Low Violations:          -2  × 1  = -2

Bonus Points:
  Comprehensive Fixtures:       +5
  Perfect Isolation:            +3
  Boundary + Mutation-Kill:     +2
                         --------
Total Bonus:             +10

Final Score:             92/100
Grade:                   A (Good)
```

> Điểm tăng từ 89 (r1) lên 92 phản ánh việc khắc phục P1 cụ thể: H1 cookie-shape 400, H2 test ID, M3 explicit assertions, M2 fixture, L1/L2 api-health. Điểm bị kéo xuống bởi các test Puppeteer chậm và scheme ID chưa chắc chắn.

---

## Critical Issues (Must Fix)

**Không có P0.** Không phát hiện hard wait, mock, assertion ẩn hoàn toàn, hay test thiếu assertion.

---

## High Issues (P1 — Should Fix)

### H1. Một số test vẫn chạm mạng thật / Puppeteer và tốn 8–15 giây

**File**: `tests/api/facebook-automate-routes.test.js:93-98`, `tests/api/facebook-automate-routes.test.js:99-108`, `tests/api/facebook-automate-routes.test.js:137-145`
**Criterion**: Flakiness / Determinism / Test Duration
**Knowledge Base**: [test-quality.md](...), [ci-burn-in.md](...)

**Mô tả**:
- `cancel-friend-requests — dryRun with invalid session cookie → 500`: **10502ms**
- `cancel-friend-requests — with optional fields → 500 when session is invalid`: **8175ms**
- `POST /api/facebook/scrape — group-members with valid url format → 200`: **15502ms**

Ba test này vẫn khởi động trình duyệt / navigate đến `facebook.com` / URL group thật. Dù đều pass trong run này, chúng phụ thuộc network và có thể fail hoặc vượt `testTimeout: 30000` nếu Facebook chậm/không reachable. Riêng `cancel-friend-requests` còn có comment source (`api/routes/facebook.js:564`) nói cần page access ngay cả trong dryRun.

**Current Code**:

```js
// tests/api/facebook-automate-routes.test.js:93-98
it(`[${nextTestId('API')}] cancel-friend-requests — dryRun with invalid session cookie → 500`, async () => {
  const res = await postAutomate({ action: 'cancel-friend-requests', authCookie: VALID_COOKIE });
  expect(res.status).toBe(500);
  expect(res.body.ok).toBe(false);
  expect(res.body.error).toMatch(/See server logs/i);
});

// tests/api/facebook-automate-routes.test.js:138-145
it(`[${nextTestId('API')}] POST /api/facebook/scrape — group-members with valid url format → 200`, async () => {
  const res = await postScrape({
    action: 'group-members',
    url: 'https://www.facebook.com/groups/123456789/members',
  });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});
```

**Recommended Fix**:
- Option A: Thêm biến môi trường `TEST_FACEBOOK_TIMEOUT` ngắn (e.g. 3000ms) chỉ trong test env và `vitest.config.js`, để các integration test fail-fast thay vì đợi 10-15s.
- Option B: Di chuyển các test này sang `tests/e2e/facebook-real-network.test.js` với tag `@P1 @network` và chạy burn-in 10 lần trước merge.
- Option C: Thêm `dryRun: true` rõ ràng vào `cancel-friend-requests` tests và cải thiện route để short-circuit khi cookie không hợp lệ trước khi mở browser.

**Burn-in đề xuất**:

```bash
for i in {1..10}; do
  npx vitest run tests/api/facebook-automate-routes.test.js -t "group-members with valid url format" || break
done
```

### H2. Test ID scheme chưa ổn định và bị trùng lặp

**File**: `tests/utils/test-ids.js:1-3`, `tests/api/*.test.js`, `tests/e2e/*.test.js`
**Criterion**: Test IDs
**Knowledge Base**: [test-levels-framework.md](...)

**Mô tả**:
- `nextTestId` dùng `let seq = 0` ở module-level. Do `pool: 'forks'` mỗi file chạy trong process riêng, `seq` reset, dẫn đến ID trùng lặp giữa các file (ví dụ nhiều file đều có `[5.5-API-001]`).
- Khi dùng trong `it.each`, `nextTestId` chỉ được gọi **một lần** khi định nghĩa test, nên toàn bộ 19 case của ma trận validation đều mang ID `[5.5-API-004]`. Tương tự cho `api-auth` (`register` 4 case dùng `[5.5-E2E-001]`, `refresh` 2 case dùng `[5.5-E2E-006]`) và `api-operations` (3 case dùng `[5.5-E2E-008]`).

**Current Code**:

```js
// tests/utils/test-ids.js
let seq = 0;
export function nextTestId(level) {
  return `5.5-${level}-${String(++seq).padStart(3, '0')}`;
}

// tests/api/facebook-automate-routes.test.js:84
])(`[${nextTestId('API')}] %s → 400`, async (desc, body, pattern) => {
```

**Recommended Fix**:

```js
// tests/utils/test-ids.js
let seq = 0;
export function nextTestId(level, filePrefix = '') {
  return `5.5-${level}-${filePrefix}-${String(++seq).padStart(3, '0')}`;
}

// Hoặc dùng stable ID cố định theo test, ví dụ:
export const testIds = {
  'unknown-action': '5.5-API-004-001',
  'missing-action': '5.5-API-004-002',
  // ...
};
```

Với `it.each`, nên nhúng ID riêng cho từng row hoặc để `desc` chứa ID:

```js
it.each([
  ['5.5-API-004-001 unknown action', { ... }],
  ['5.5-API-004-002 missing action', { ... }],
])(`[5.5-API-004] %s → 400`, ...)
```

---

## Medium Issues (P2 — Recommendations)

### M1. Thiếu priority marker

**File**: all 7 test files
**Criterion**: Priority Markers

Dự án không yêu cầu bắt buộc, nhưng với khối lượng test tăng, nên thêm `@P0 @API`, `@P1 @E2E` vào tên hoặc metadata để chạy selective.

### M2. Comment số dòng source lỗi thời

**File**: `tests/api/facebook-accounts.test.js:118, 122-124, 129-134, 156-159, 171-173, 181-183, 191-193, 202-204, 210-212, 216-218, 221-223, 226-229, 252-254, 261-262, 271-273, 281-283, 290-292`
**Criterion**: Maintainability

Các comment kiểu `L49, L50, L58, L65, L66, L88` tham chiếu đến số dòng `api/routes/facebookAccounts.js` đã dịch chuyển (ví dụ `parts.length` check hiện ở dòng 60, test ghi L58; `String(c_user).trim()` ở dòng 91, test ghi L88). Nên thay bằng tên hàm / mô tả mutant.

**Recommended Fix**:

```js
// ✅ Better
// StringLiteral mutant: 'hex' encoding must not be empty
// ConditionalExpression mutant: parts.length check must not be bypassed
```

---

## Low Issues (P3)

### L1. `makeTestUserId` dùng `randomUUID()` không có seed

**File**: `tests/api/fixtures/test-user.js:12-15`
**Criterion**: Determinism

Đảm bảo unique trong parallel nhưng không reproducible. Có thể thay bằng counter hoặc `faker.string.uuid()` với seed cố định nếu cần debug lặp lại.

### L2. Một số URL/ID vẫn hardcoded

**File**: `tests/api/facebook-automate-routes.test.js:138-145`, `tests/e2e/api-operations.test.js:53-62`
**Criterion**: Data Factories

Ví dụ `'https://www.facebook.com/groups/123456789/members'`, `'some-operation-id'`, `'acct1'`, `'acct2'`. Dù không phải sensitive data, nên dùng factory với overrides để dễ mở rộng.

---

## Best Practices Found

### BP1. Shared fixture `tests/api/fixtures/test-user.js` là mẫu tốt

**File**: `tests/api/fixtures/test-user.js`
**Pattern**: Pure function → Fixture → seed/cleanup
**Knowledge Base**: [fixture-architecture.md](...), [data-factories.md](...)

```js
export function makeValidFacebookCookie(overrides = {}) {
  const cUser = String(100000000000000 + Math.floor(Math.random() * 900000000000000));
  return {
    c_user: cUser,
    xs: `xs-${randomUUID().slice(0, 24)}`,
    ...overrides,
  };
}

export async function cleanupTestUser(userId) {
  await prisma.operation.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.schedule.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.facebookAccount.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
}
```

### BP2. Sử dụng `it.each` cho ma trận validation

**File**: `tests/api/facebook-automate-routes.test.js:63-89`
**Pattern**: Parametrized tests

Mặc dù ID bị chia sẻ, ma trận vẫn giảm lặp và dễ thêm case.

### BP3. Boundary + mutation-kill testing xuất sắc

**File**: `tests/api/facebook-accounts.test.js`
**Pattern**: Boundary + mutation-aware

Kiểm tra 50/51 ký tự label, 10/20 chữ số c_user, 4096/4097 ký tự xs, trim, type coercion, auth tag tamper, hex encoding. Nên dùng làm reference cho validation tests khác.

### BP4. H1 fix nhanh và chính xác

**File**: `api/routes/facebook.js:15-51`, `tests/api/facebook-routes-integration.test.js:85-94`
**Pattern**: Fail-fast validation before network call

```js
// api/routes/facebook.js
const C_USER_UID_RE = /^\d{10,20}$/;
function validateRawCookie(authCookie) {
  const cUser = String(authCookie?.c_user ?? '').trim();
  const xs = String(authCookie?.xs ?? '').trim();
  if (!cUser && !xs) return null;
  if (!C_USER_UID_RE.test(cUser)) {
    return '❌ authCookie.c_user must be a numeric Facebook UID (10-20 digits).';
  }
  if (!xs) {
    return '❌ A Facebook session is required...';
  }
  return null;
}
```

Kết quả: test invalid cookie trả về 400 trong **3ms**, không còn phụ thuộc network.

---

## Test File Analysis

### Suite Metadata

- **Framework**: Vitest 4.0.18
- **Environment**: Node.js, `supertest`
- **Config**: `vitest.config.js` — `pool: 'forks'`, `fileParallelism: false`, `testTimeout: 30000`, `sequence.shuffle: true`
- **Test Files**: 7
- **Total Lines**: 1026
- **Total Tests**: 132
- **Total Assertions (expect)**: 196
- **Hard Waits**: 0
- `vi.mock` / `vi.fn` / `vi.spyOn` / `jest.mock`: 0

### Test Files

| File | Dòng | Tests | Assertions | Max Duration | Fixtures |
| --- | --- | --- | --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 50 | 364ms | Không |
| `tests/api/facebook-automate-routes.test.js` | 152 | 29 | 25 | **15502ms** | `test-user.js` |
| `tests/api/facebook-routes-integration.test.js` | 168 | 17 | 40 | 44ms | `test-user.js` |
| `tests/e2e/api-auth.test.js` | 115 | 14 | 24 | 127ms | `test-user.js` |
| `tests/e2e/api-facebook.test.js` | 118 | 9 | 18 | 43ms | `test-user.js` |
| `tests/e2e/api-health.test.js` | 60 | 8 | 19 | 25ms | Không |
| `tests/e2e/api-operations.test.js` | 118 | 13 | 20 | 23ms | `test-user.js` |

### Test Scope

- **Test IDs**: Tất cả 7 file có ID qua `nextTestId`, nhưng ID trùng lặp giữa các file và giữa các row `it.each`.
- **Priority Distribution**:
  - P0 (Critical): 0
  - P1 (High): 0 (không có marker)
  - P2 (Medium): 0
  - P3 (Low): 0
  - Unknown: 132

### Assertions Analysis

- **Total Assertions**: 196
- **Assertions per Test (avg)**: ~1.48
- **Assertion Types**: `toBe`, `toMatch`, `toMatchObject`, `toHaveProperty`, `toBeInstanceOf`, `toContain`, `not.toBe`, `not.toContain`

---

## Per-File Scores

| File | Dòng | Tests | Assertions | Điểm | Grade | Trạng thái |
| --- | --- | --- | --- | --- | --- | --- |
| `tests/e2e/api-health.test.js` | 60 | 8 | 19 | 96 | A | Approve |
| `tests/api/facebook-routes-integration.test.js` | 168 | 17 | 40 | 95 | A | Approve |
| `tests/e2e/api-facebook.test.js` | 118 | 9 | 18 | 93 | A- | Approve |
| `tests/api/facebook-accounts.test.js` | 295 | 42 | 50 | 92 | A- | Approve |
| `tests/e2e/api-auth.test.js` | 115 | 14 | 24 | 91 | A- | Approve |
| `tests/e2e/api-operations.test.js` | 118 | 13 | 20 | 91 | A- | Approve |
| `tests/api/facebook-automate-routes.test.js` | 152 | 29 | 25 | 84 | B | Approve with comments |

**Suite Average**: 92/100 (A — Good)

---

## Context and Integration

### Related Artifacts

- Review trước: `_bmad-output/test-artifacts/test-reviews/test-review-api-e2e-2026-08-13-r1.md`
- Fixture chung: `tests/api/fixtures/test-user.js`
- Test ID helper: `tests/utils/test-ids.js`
- Cookie shape validation: `api/routes/facebook.js:15-51`

### Quality Trends

| Review Date | Score | Grade | Critical Issues | Trend |
| --- | --- | --- | --- | --- |
| 2026-08-13 | 75/100 | B | 0 | Baseline |
| 2026-08-13 r1 | 89/100 | A | 0 | ⬆️ Improved |
| 2026-08-13 r2 | 92/100 | A | 0 | ⬆️ Improved |

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

### Immediate Actions (Before Merge)

1. **H1** — Kiểm soát network cho `cancel-friend-requests` và `group-members` tests
   - Priority: P1
   - Owner: Backend / QA
   - Estimated Effort: 2–4h

2. **H2** — Sửa `nextTestId` để ID là duy nhất toàn cục và không bị chia sẻ bởi `it.each`
   - Priority: P1
   - Owner: QA
   - Estimated Effort: 1–2h

3. **M2** — Thay comment số dòng source bằng mô tả mutant
   - Priority: P2
   - Owner: Dev
   - Estimated Effort: 30m

### Follow-up Actions (Future PRs)

1. Thêm priority marker `@P0`/`@P1` để hỗ trợ selective testing.
2. Cải thiện `makeTestUserId` để reproducible (seeded UUID/counter) khi cần debug.
3. Chạy 10-iteration burn-in trên `facebook-automate-routes.test.js` trước khi merge story tiếp theo.

### Re-Review Needed?

**⚠️ Re-review after P1 fixes** — đặc biệt H1 (network) và H2 (test ID scheme). Sau khi fix, chạy lại `npx vitest run tests/api tests/e2e` và cập nhật score.

---

## Decision

**Recommendation**: **Approve with Comments**

**Rationale**: Suite đã cải thiện đáng kể so với r1 (89 → 92). Các vấn đề P1 đã được khắc phục: cookie-shape 400 nhanh, test ID, assertion cụ thể, fixture random, api-health chính xác. Còn lại rủi ro chính là 3 test chạm Puppeteer/mạng thật (~8-15s) và scheme `nextTestId` chưa ổn định. Các vấn đề này không nên block merge nhưng cần fix trước khi mở rộng suite cho story tiếp theo.

---

## Appendix: Violation Summary by Location

| File:Line | Severity | Tiêu chí | Vấn đề | Fix nhanh |
| --- | --- | --- | --- | --- |
| `facebook-automate-routes.test.js:93-98` | P1 | Flakiness | `cancel-friend-requests` 10502ms | Short timeout env hoặc tách network E2E |
| `facebook-automate-routes.test.js:99-108` | P1 | Flakiness | `cancel-friend-requests` 8175ms | Short timeout env hoặc tách network E2E |
| `facebook-automate-routes.test.js:138-145` | P1 | Flakiness | `group-members` 15502ms | Short timeout env hoặc tách network E2E |
| `tests/utils/test-ids.js:1-3` | P1 | Test IDs | Trùng lặp / `it.each` chia sẻ ID | Stable file prefix + row suffix |
| Tất cả 7 file | P2 | Priority Markers | Không có `@P0`/`@P1` | Thêm marker |
| `facebook-accounts.test.js:118-292` | P2 | Maintainability | Comment số dòng source lỗi thời | Mô tả mutant |
| `test-user.js:12-15` | P3 | Determinism | `makeTestUserId` randomUUID không seed | Counter hoặc seeded UUID |
| `facebook-automate-routes.test.js:138-145`, `api-operations.test.js:53-62` | P3 | Data Factories | URL/ID literal | Factory với overrides |

---

## Review Metadata

**Generated By**: BMad TEA Agent — `bmad-testarch-test-review`
**Review ID**: test-review-api-e2e-2026-08-13-r2
**Timestamp**: 2026-08-13
**Version**: 2.0
**Workflow**: testarch-test-review v5.0
