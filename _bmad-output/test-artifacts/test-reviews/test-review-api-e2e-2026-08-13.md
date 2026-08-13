---
workflow: testarch-test-review
scope: directory (tests/api + tests/e2e)
review_date: 2026-08-13
reviewer: Murat (Test Architect)
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
---

# Test Quality Review: `tests/api/` + `tests/e2e/`

**Quality Score**: 75/100 (B — Acceptable)
**Review Date**: 2026-08-13
**Review Scope**: Directory — 7 test files
**Reviewer**: Murat (TEA Agent)
**Execution Result**: `npx vitest run tests/api tests/e2e` — **7/7 files passed, 130/130 tests passed, 19.67s**

---

## Executive Summary

**Overall Assessment**: Acceptable — test suite chạy được, pass 100%, không có mock/hard wait, nhưng còn nhiều pattern rủi ro: `if` điều khiển assertion, chấp nhận nhiều status code, file dài >300 dòng, và một test có tên gây hiểu nhầm với kết quả thực tế.

**Recommendation**: **Approve with Comments** — merge được, nhưng nên khắc phục P1 (conditionals, non-determinism) trước khi mở rộng.

### Key Strengths

- Tất cả test đều chạy real `app` qua `supertest`, không mock Express layer.
- `tests/api/facebook-routes-integration.test.js` dùng `beforeAll`/`afterAll` để seed và xóa user thật trong DB — đúng pattern isolation.
- `tests/api/facebook-accounts.test.js` bao phủ boundary và mutation-kill rất tốt (c_user, xs, label, encrypt/decrypt).
- Không phát hiện `vi.mock`, `waitForTimeout`, hoặc hard wait.
- Các test E2E health đơn giản, tập trung, chạy nhanh.

### Key Weaknesses

- `tests/api/facebook-automate-routes.test.js` vượt 300 dòng và dùng `if (res.status === 400)` để điều khiển assertion.
- Nhiều file chấp nhận cả 200/500/401/429 trong cùng một test, làm giảm tính xác định.
- Một test tên `returns 500 (not 400) when scrape dispatch fails` nhưng thực tế trả về 200 — test vẫn pass do kỳ vọng quá rộng.
- Không có test ID, priority marker, fixture dùng chung, hay data factory.

---

## Quality Criteria Assessment

| Tiêu chí | Trạng thái | Lỗi vi phạm | Ghi chú |
| --- | --- | --- | --- |
| BDD Format (Given-When-Then) | N/A | 0 | Dự án không dùng BDD; tên `it()` mô tả đủ rõ |
| Test IDs | FAIL | 7 files | Không có ID chính thức nào |
| Priority Markers (P0–P3) | FAIL | 7 files | Không có marker `@P0`/`@P1` |
| Hard Waits | PASS | 0 | Không `waitForTimeout`, `sleep` |
| Determinism (no conditionals) | FAIL | ~15 | Nhiều `if` kiểm soát assertion, chấp nhận nhiều status code |
| Isolation (cleanup, no shared state) | WARN | 3 | `facebook-routes-integration` tốt; các file khác dùng cùng `app` không cleanup |
| Fixture Patterns | FAIL | 7 files | Không dùng `test.extend` hay shared setup |
| Data Factories | FAIL | 7 files | Hardcoded email/userId, không factory |
| Network-First Pattern | N/A | 0 | API test, không navigate |
| Explicit Assertions | WARN | 5 | Một số assertion bị ẩn trong nhánh `if` |
| Test Length (≤300 dòng) | FAIL | 1 | `facebook-automate-routes.test.js` = 358 dòng |
| Test Duration (≤1.5 min/test) | PASS | 0 | Tất cả <1.5 phút; lâu nhất ~13s |
| Flakiness Patterns | WARN | 4 | Status động, rate-limit 429, `[200,500]` acceptance |

**Total Violations**: 0 Critical, 5 High, 4 Medium, 4 Low

---

## Quality Score Breakdown

```
Starting Score:          100
High Violations:         -5 × 5 = -25
Medium Violations:       -2 × 4 = -8
Low Violations:          -1 × 4 = -4

Bonus Points:
  Không hard waits:               +5
  Real DB seed/cleanup:           +5
  Boundary/mutation coverage:     +5

Total Bonus:             +15

Final Score:             78/100
Grade:                   B (Acceptable)
```

> Điểm số được điều chỉnh xuống 75 để phản ánh rủi ro tổng thể của cả 7 file, không chỉ cộng trừ cơ học.

---

## Critical Issues (Must Fix)

**Không có P0 critical.** Không có hard wait, mock, hoặc test thiếu assertion hoàn toàn.

## High Issues (P1 — Should Fix)

### H1. Test tên gây hiểu nhầm — kết quả 200 nhưng kỳ vọng 500

**File**: `tests/api/facebook-routes-integration.test.js:114`
**Criterion**: Determinism / Explicit Assertions

**Mô tả**:
Test có tên `returns 500 (not 400) when scrape dispatch fails` nhưng assertion lại chấp nhận `[200, 500]`:

```js
it('returns 500 (not 400) when scrape dispatch fails (L157-161)', async () => {
  const res = await request(app)
    .post('/api/facebook/scrape')
    .set('Authorization', `Bearer ${authToken}`)
    .send({ action: 'profile', url: 'https://facebook.com/test' });
  expect([200, 500]).toContain(res.status);
  if (res.status === 500) {
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/scrape failed/i);
  }
});
```

Khi chạy thực tế, endpoint trả về **200**, test vẫn pass nhưng không kiểm chứng gì về shape phản hồi 200. Điều này có thể che giấu lỗi thực sự (scrape không nên 200 khi thiếu cookie/browser).

**Đề xuất sửa**:
- Nếu scrape thật sự thất bại phải là 500, đổi test để **bắt buộc 500** và seed với cookie thật hoặc cấu hình force fail.
- Hoặc đổi tên test thành `returns 200 or 500 depending on env` và assertion cả hai shape rõ ràng.

### H2. File `facebook-automate-routes.test.js` vượt 300 dòng

**File**: `tests/api/facebook-automate-routes.test.js` (358 dòng)
**Criterion**: Test Length

**Đề xuất sửa**:
- Tách thành 2–3 file: `auth-guards.test.js`, `action-validation.test.js`, `scrape-validation.test.js`.
- Hoặc trích xuất helper `makeRequest(token, body)` và `expectGuard(res, pattern)`.

### H3. `if` điều khiển assertion làm giảm determinism

**File**: `tests/api/facebook-automate-routes.test.js:60`, `tests/e2e/api-auth.test.js:22`
**Criterion**: Determinism

**Ví dụ**:

```js
// ❌ Bad
test('...', async () => {
  const res = await request(...);
  expect(GUARD_STATUSES).toContain(res.status);
  if (res.status === 400) {
    expect(res.body.error).toMatch(/action must be one of/);
  }
});
```

Nếu auth middleware hoặc rate limit trả 401/429, test pass mà không kiểm tra validation. Assertion bị ẩn trong nhánh.

**Đề xuất sửa**:
```js
// ✅ Better: force auth to pass (seed DB user) so validation always executes
const { user, token } = await seedUser();
const res = await request(app)
  .post('/api/facebook/automate')
  .set('Authorization', `Bearer ${token}`)
  .send({ action: 'nonexistent-action', authCookie: VALID_COOKIE });
expect(res.status).toBe(400);
expect(res.body.error).toMatch(/action must be one of/);
```

### H4. Test E2E auth phụ thuộc vào DB — chấp nhận 500

**File**: `tests/e2e/api-auth.test.js:99`
**Criterion**: Determinism / Flakiness

```js
it('POST /api/auth/login with invalid credentials → 401 or 500 (no DB)', async () => {
  ...
  expect([401, 500, RATE_LIMITED]).toContain(res.status);
});
```

Khi DB không chạy, test pass với 500. Điều này làm sai lệch tín hiệu: test nên **fail** nếu DB không chạy, hoặc bỏ qua rõ ràng (skip).

**Đề xuất sửa**:
- Seed DB trước khi chạy, hoặc
- Dùng `it.skipIf(!process.env.DATABASE_URL)` hoặc
- Chạy trong `beforeAll` kiểm tra DB và fail fast nếu không kết nối được.

### H5. `dryRun=true for like action` chấp nhận cả 200 hoặc 500

**File**: `tests/api/facebook-routes-integration.test.js:207`
**Criterion**: Determinism

Test dry-run chỉ nên trả về 200 với preview. Nếu 500, cần kiểm tra lỗi rõ ràng. Chấp nhận cả hai làm giảm ý nghĩa test.

---

## Medium Issues (P2 — Recommendations)

### M1. Thiếu fixture chung cho JWT

**File**: `tests/e2e/api-facebook.test.js`, `tests/e2e/api-operations.test.js`, `tests/api/facebook-automate-routes.test.js`
**Criterion**: Fixture Patterns

Mỗi test lặp lại:
```js
const jwt = await import('jsonwebtoken');
const secret = process.env.JWT_SECRET || 'test-secret';
const fakeToken = jwt.default.sign({ ... }, secret, { expiresIn: '1h' });
```

**Đề xuất**:
```js
// tests/fixtures/auth.js
export function makeTestToken(userId, secret = process.env.JWT_SECRET || 'test-secret') {
  return jwt.sign({ userId, username: 'ghost' }, secret, { expiresIn: '1h' });
}
```

### M2. `api-health.test.js` assertion yếu về rate limit header

**File**: `tests/e2e/api-health.test.js:53-63`
**Criterion**: Explicit Assertions

```js
const hasRateLimit = ...;
void hasRateLimit; // documented intent without flaky assertion
expect(res.status).toBe(200);
```

**Đề xuất**: Hoặc assert header thật, hoặc bỏ biến `hasRateLimit` nếu không dùng.

### M3. Thiếu test ID / priority marker

**File**: tất cả 7 file
**Criterion**: Test IDs / Priority Markers

Dự án có thể không yêu cầu, nhưng với khối lượng test lớn sau merge, việc đánh dấu `@P0 @API` sẽ giúp chạy selective.

### M4. Hardcoded cookie/userId/email

**File**: `tests/api/facebook-automate-routes.test.js`, `tests/api/facebook-routes-integration.test.js`
**Criterion**: Data Factories

`VALID_COOKIE`, `fake-test-user-XXX`, `fb_routes_test` là hardcoded. Không gây lỗi ngay nhưng khó bảo trì khi mở rộng.

---

## Low Issues (P3)

### L1. `NO_400_STATUSES.concat([200])` dài dòng

**File**: `tests/api/facebook-automate-routes.test.js:280`

Thay bằng `expect([200, 401, 429, 500]).toContain(res.status)`.

### L2. Comment chứa số dòng (L123, L157-161) dễ lỗi thời

**File**: `tests/api/facebook-routes-integration.test.js`

Khi refactor source, số dòng thay đổi sẽ khiến comment sai. Nên dùng tên hàm hoặc bỏ số dòng.

### L3. `api-operations.test.js` import `jsonwebtoken` trong test

**File**: `tests/e2e/api-operations.test.js:70`

Có thể import ở top-level hoặc dùng fixture.

---

## Best Practices Found

### BP1. Boundary testing xuất sắc trong `facebook-accounts.test.js`

**File**: `tests/api/facebook-accounts.test.js:21-287`
**Pattern**: Boundary + mutation-aware testing

Kiểm tra chính xác 50/51 ký tự label, 10/20 chữ số c_user, 4096/4097 ký tự xs, trim behavior, type coercion. Đây là file tham khảo tốt cho các API validation test khác.

### BP2. DB seed/cleanup trong `facebook-routes-integration.test.js`

**File**: `tests/api/facebook-routes-integration.test.js:21-34`
**Pattern**: Isolation with real DB

```js
beforeAll(async () => { await prisma.user.upsert(...); });
afterAll(async () => {
  await prisma.operation.deleteMany({ where: { userId: TEST_USER.id } });
  await prisma.user.deleteMany({ where: { id: TEST_USER.id } }).catch(() => {});
});
```

Nên áp dụng pattern này cho `api-auth.test.js`, `api-facebook.test.js`, `api-operations.test.js`.

### BP3. E2E health test tập trung, nhanh

**File**: `tests/e2e/api-health.test.js`
**Pattern**: Smoke test đơn giản

Kiểm tra health, openapi, helmet headers, 404 shape trong 65 dòng. Lý tưởng cho CI smoke.

---

## Per-File Scores

| File | Dòng | Test | Điểm | Grade | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| `tests/api/facebook-accounts.test.js` | 294 | 46 | 85 | A- | Approve |
| `tests/e2e/api-health.test.js` | 65 | 7 | 82 | B+ | Approve |
| `tests/e2e/api-operations.test.js` | 108 | 11 | 72 | B | Approve with comments |
| `tests/e2e/api-facebook.test.js` | 124 | 7 | 70 | B- | Approve with comments |
| `tests/e2e/api-auth.test.js` | 158 | 14 | 68 | C+ | Approve with comments |
| `tests/api/facebook-routes-integration.test.js` | 223 | 12 | 68 | C+ | Approve with comments |
| `tests/api/facebook-automate-routes.test.js` | 358 | 33 | 58 | C | Request changes |

**Suite Average**: 75/100 (B — Acceptable)

---

## Knowledge Base References

- `test-quality.md` — Definition of Done (no hard waits, <300 dòng, <1.5 phút/test, explicit assertions)
- `fixture-architecture.md` — Pure function → Fixture → mergeTests
- `data-factories.md` — Factory functions với overrides, tránh hardcoded
- `test-levels-framework.md` — E2E vs API vs Unit phân loại

---

## Next Steps

### Immediate (before merge nếu có thời gian)

1. **Sửa H1**: Làm rõ expectation test scrape dispatch fail — hoặc bắt buộc 500 hoặc đổi tên + assert shape 200.
2. **Sửa H2**: Tách `facebook-automate-routes.test.js` thành các file <300 dòng.
3. **Sửa H3/H4**: Thay `if` assertion bằng seed DB user thật để determinism 100%.

### Follow-up (PR sau)

1. Viết fixture `makeTestToken()` và `seedTestUser()` dùng chung cho `tests/api` + `tests/e2e`.
2. Thêm `@P0 @P1` markers và test IDs cho các test API để chạy selective.
3. Tái cấu trúc `api-auth.test.js` để không chấp nhận 500 khi DB sẵn sàng.

### Re-Review Needed?

**Re-review after P1 fixes** — đặc biệt H1, H3, H4.

---

## Decision

**Recommendation**: **Approve with Comments**

**Rationale**: Test suite chạy ổn định, pass 100%, không có mock/hard wait. Tuy nhiên, nhiều test dùng `if` điều khiển assertion và chấp nhận nhiều status code, làm giảm tính xác định. Một test (`facebook-routes-integration:114`) có tên gây hiểu nhầm nghiêm trọng. Các vấn đề P1 nên được fix trước khi mở rộng test suite cho post-merge API plan.

---

## Appendix: Violation Summary by Location

| File:Line | Severity | Tiêu chí | Vấn đề | Fix nhanh |
| --- | --- | --- | --- | --- |
| `facebook-routes-integration.test.js:114` | High | Determinism | Tên test 500 nhưng chấp nhận 200 | Đổi tên hoặc bắt buộc 500 |
| `facebook-automate-routes.test.js` (toàn file) | High | Test Length | 358 dòng | Tách file hoặc rút gọn |
| `facebook-automate-routes.test.js:60+` | High | Determinism | `if` assertion theo status | Seed DB user, assert cố định |
| `api-auth.test.js:99` | High | Flakiness | Chấp nhận 500 khi DB lỗi | Kiểm tra DB hoặc fail fast |
| `facebook-routes-integration.test.js:207` | High | Determinism | `[200,500]` quá rộng | Chỉ định behavior dry-run |
| `api-facebook.test.js:51,66,...` | Medium | Fixture Patterns | Lặp import/sign JWT mỗi test | Dùng helper chung |
| `api-health.test.js:63` | Medium | Assertions | `void hasRateLimit` assertion yếu | Assert header thật hoặc bỏ |
| `api-operations.test.js:70` | Medium | Fixture Patterns | Import jwt trong test | Import top-level |
| `facebook-automate-routes.test.js:280` | Low | Style | `NO_400_STATUSES.concat([200])` rối | Dùng mảng inline |
| `facebook-routes-integration.test.js:40+` | Low | Style | Comment số dòng L123, L157 | Dùng tên hàm hoặc xóa |

---

**Generated By**: BMad TEA Agent — `bmad-testarch-test-review`
**Review ID**: test-review-api-e2e-2026-08-13
**Timestamp**: 2026-08-13
