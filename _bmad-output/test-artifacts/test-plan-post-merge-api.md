---
workflow: testarch-test-design
status: in-progress
scope: post-upstream-merge API regression
created: 2026-08-13
author: Murat (Test Architect)
---

# Kế hoạch test API sau merge upstream — không dùng cookie thật

## 1. Mục tiêu

- Xác minh tất cả tầng API Express hoạt động ổn định sau khi merge `upstream/main` vào `develop`.
- Phát hiện hồi quy ở middleware, routing, validation, auth, rate-limiting, x402, và các điểm tiếp xúc với database.
- **Không dùng cookie Facebook/Twitter thật** — tập trung vào dry-run, validation, error-path, và các luồng không cần cookie.
- Tuân thủ quy tắc dự án: **không mock, stub, fake** — dùng real DB, real Redis, real server, và real `dryRun`.

## 2. Giả định & ràng buộc

| # | Giả định / ràng buộc | Tác động |
|---|---|---|
| 1 | Không có cookie thật của Facebook/Twitter | Các success path của scrape/auto-like/auto-comment/... **không thể test kết quả thật**. Thay vào đó test `dryRun=true`, validation, auth error, dry-run preview. |
| 2 | Không dùng mock | Mọi test phải gọi real server + real DB + real queue (nếu cần). Nếu Redis chưa chạy, phải start Redis trước. |
| 3 | Test DB riêng | Dùng PostgreSQL test database + `npx prisma db push`. Sau mỗi test suite truncate/reset dữ liệu test. |
| 4 | x402 có thể tắt | Với `X402_PAY_TO_ADDRESS` không set, middleware ở dev sẽ pass-through. Được dùng để test chức năng nền; test x402 riêng với cấu hình bật. |
| 5 | JWT test token | Seed một `User` trong DB và ký JWT bằng `JWT_SECRET` để test các route cần auth. |

## 3. Phân loại route theo độ cần cookie

### 3.1 Không cần cookie, không cần auth
- `GET /health`, `GET /api/health`
- `GET /api/ai/health`, `GET /api/ai/pricing`
- `GET /openapi.json`, `GET /.well-known/x402`
- `GET /llms.txt`, `/llms-full.txt`
- `GET /docs/*`, `/features`, `/about`, `/faq`, `/` (dashboard)
- `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/refresh`

### 3.2 Cần JWT, không cần cookie nền tảng
- `/api/user/*`, `/api/admin/*`, `/api/license/*`
- `/api/schedule/*`, `/api/tweet-schedule/*`
- `/api/operations/*` (status, list, cancel) — lưu ý: `POST` bắt đầu operation cần user có `sessionCookie` hoặc `twitterAccessToken`
- `/api/billing/plans` (Stripe plan listing)
- `/api/crm/*`, `/api/teams/*`, `/api/workflows/*`, `/api/graph/*` (nếu không gọi Twitter)
- `/api/agent/*` (start/stop) — cần auth, có thể test với test user

### 3.3 Cần cookie nền tảng nhưng có thể test dry-run / error
- `/api/twitter/*`
- `/api/facebook/*`, `/api/facebook/accounts/*`
- `/api/ai/scrape/*`, `/api/ai/actions/*`, `/api/ai/posting/*`, `/api/ai/engagement/*`
- `/api/operations/unfollow-non-followers` / `unfollow-everyone` / `detect-unfollowers`
- `/api/ai/messages/*`

### 3.4 Cần ngoài hệ thống (bỏ qua hoặc test riêng)
- `POST /webhooks/stripe` — cần webhook secret + Stripe CLI; nên test thủ công hoặc bằng Stripe CLI forward.
- `/webhooks/payments` (x402) — tương tự.

## 4. Ma trận rủi ro (P × I)

| R-ID | Mô tả | Loại | P | I | Điểm | P0? |
|---|---|---|---|---|---|---|
| R-01 | Middleware x402 chặn nhầm endpoint free hoặc cho qua endpoint trả phí | SEC | 2 | 3 | 6 | Có |
| R-02 | Auth middleware leak cookie/PII trong log hoặc error message | SEC | 2 | 3 | 6 | Có |
| R-03 | Rate limit sai -> block hợp lệ hoặc cho phép spam | PERF/OPS | 2 | 2 | 4 | P1 |
| R-04 | `dryRun=true` vẫn launch browser (không an toàn) | BUS | 2 | 3 | 6 | Có |
| R-05 | Operation record không được tạo khi job lỗi | DATA | 2 | 2 | 4 | P1 |
| R-06 | Route /api/facebook chấp nhận cookie thiếu `c_user`/`xs` mà không trả 400 | SEC | 2 | 2 | 4 | P1 |
| R-07 | Prisma schema không khớp DB sau merge (ví dụ cột `platform`) | DATA | 2 | 3 | 6 | Có |
| R-08 | `better-sqlite3`/native deps lỗi trên Node hiện tại | TECH | 2 | 2 | 4 | P1 |

## 5. Chiến lược test theo nhóm

### 5.1 P0 — Smoke + Middleware + Auth + Database

**Mục tiêu:** Xác nhận server khởi động, route public hoạt động, middleware x402/auth không crash, DB không rò rỉ PII.

| Test ID | Nhóm | Nội dung | Kỳ vọng chính |
|---|---|---|---|
| P0-01 | Smoke | `GET /health` và `GET /api/health` | 200, JSON `{ status: 'ok' }` |
| P0-02 | Smoke | `GET /api/ai/health` và `GET /api/ai/pricing` | 200, shape đúng, `x402.version === 2` |
| P0-03 | OpenAPI | `GET /openapi.json` | 200, valid JSON, chứa các `/api/ai/*` |
| P0-04 | x402 free | `GET /api/ai/health` khi `X402_PAY_TO_ADDRESS` không set | 200 (pass-through dev) |
| P0-05 | x402 paid | `POST /api/ai/scrape/profile` khi x402 enabled mà chưa trả tiền | 402 với payment requirements |
| P0-06 | Auth | `GET /api/user/me` không token | 401 |
| P0-07 | Auth | `GET /api/user/me` với JWT hợp lệ | 200, không leak password hash |
| P0-08 | PII | Error response khi cookie thiếu | Không chứa `c_user`, `xs`, `sessionCookie` |
| P0-09 | DB | `npx prisma db push` trên test DB | Không lỗi schema |
| P0-10 | DB | Query `Operation` sau mỗi API | `userId` đúng, `status` hợp lý |

### 5.2 P1 — DB-backed CRUD (không cần cookie nền tảng)

| Test ID | Nhóm | Nội dung | Kỳ vọng |
|---|---|---|---|
| P1-01 | Auth | `POST /api/auth/register` + `POST /api/auth/login` | JWT trả về, user lưu DB |
| P1-02 | User | `GET /api/user/me`, `PUT /api/user/settings` | Cập nhật đúng trường |
| P1-03 | Schedule | `POST /api/schedule` với test user | operation / schedule record tạo đúng |
| P1-04 | Tweet schedule | `POST /api/tweet-schedule` | schema `platform` được ghi đúng |
| P1-05 | Operations | `GET /api/operations`, `GET /api/operations/status/:id`, `POST /api/operations/cancel/:id` | CRUD đúng quyền user |
| P1-06 | Billing | `GET /api/billing/plans` | trả về plans shape |
| P1-07 | License | `GET /api/license/status` | 200 với test user |
| P1-08 | CRM/Teams/Workflow | `POST /api/crm/...`, `/api/teams/...`, `/api/workflows/...` | validation chặt, 200 hoặc 400 rõ ràng |

### 5.3 P1 — Cookie-less platform routes (dry-run + invalid cookie)

**Nguyên tắc:** Gọi với `dryRun=true` hoặc cookie giả `c_user=0000000000000; xs=invalid`. Không kỳ vọng success thật, chỉ kiểm tra API layer.

| Test ID | Nhóm | Endpoint | Input | Kỳ vọng |
|---|---|---|---|---|
| P1-FB-01 | Facebook dry-run | `POST /api/facebook/automate` (like/post/comment) | `dryRun=true`, `authCookie` giả | 200, trả về preview, KHÔNG launch browser |
| P1-FB-02 | Facebook validation | `POST /api/facebook/automate` thiếu `authCookie` | no cookie | 400 với message rõ ràng, không leak PII |
| P1-FB-03 | Facebook real run fail | `POST /api/facebook/automate` `dryRun=false` cookie giả | browser fail hoặc login fail | operation record `status: failed`, error message không chứa cookie |
| P1-FB-04 | Facebook accounts | `POST /api/facebook/accounts` lưu cookie giả | encrypted cookie | có thể giải mã? Không — chỉ kiểm tra tạo/lấy danh sách account |
| P1-TW-01 | Twitter dry-run | `POST /api/ai/action/auto-like` | `dryRun=true`, `sessionCookie` giả | 200 hoặc 202, trả operationId |
| P1-TW-02 | Twitter validate session | `POST /api/ai/actions/validate-session` | `sessionCookie` giả | `valid: false` |
| P1-TW-03 | Operations queue | `POST /api/operations/unfollow-non-followers` | user có `sessionCookie` giả, `dryRun=false` | operation queued, worker tự fail sau đó |
| P1-SC-01 | AI scrape | `POST /api/ai/scrape/profile` `dryRun=true` | username test | 200 nếu có cache/mock? Không — test 402 hoặc error shape |

### 5.4 P2 — Dashboard + Static + A2A + Scripts

| Test ID | Nhóm | Nội dung | Kỳ vọng |
|---|---|---|---|
| P2-01 | Dashboard | `GET /`, `/dashboard`, `/docs` | 200, HTML load được |
| P2-02 | Scripts | `GET /api/scripts` | 200, danh sách script shape |
| P2-03 | A2A | `POST /api/a2a/...` | 200/400 đúng, không crash |
| P2-04 | Plugin | `GET /api/plugins/*` | mount đúng, không lỗi 500 |

### 5.5 P3 — Performance + Rate limit + NFR

| Test ID | Nhóm | Nội dung | Kỳ vọng |
|---|---|---|---|
| P3-01 | Rate limit | Spam `POST /api/auth/login` > 10 lần/15 phút | 429 |
| P3-02 | Rate limit | Spam `POST /api/facebook/automate` > 60 lần/15 phút | 429 |
| P3-03 | CORS | `OPTIONS /openapi.json` từ origin khác | 204 với header đúng |
| P3-04 | Logging | Log morgan không chứa `Authorization` header | redact đúng |

## 6. Fixtures & môi trường test

### 6.1 Test database

```bash
# Tạo test DB (PostgreSQL)
createdb xactions_test

# .env.test
DATABASE_URL="postgresql://user:password@localhost:5432/xactions_test?schema=public"
JWT_SECRET="test-secret-do-not-use-in-production"
REDIS_HOST=localhost
REDIS_PORT=6379
NODE_ENV=test
# Tắt x402 cho smoke test; sau đó bật để test payment flow
# X402_PAY_TO_ADDRESS=0x...
```

### 6.2 Seed fixtures (real rows in DB)

```js
// tests/fixtures/seed.js
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export async function seedTestUser() {
  const user = await prisma.user.create({
    data: {
      email: 'test-api@xactions.app',
      twitterUsername: 'testuser',
      // không set sessionCookie thật
    }
  });
  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
  return { user, token };
}

export async function resetTestDb() {
  // Thứ tự xóa theo foreign keys
  await prisma.$executeRaw`TRUNCATE TABLE "Schedule", "Operation", "FacebookAccount", "Subscription", "User" CASCADE`;
}
```

### 6.3 Cookie/test payload mẫu

```js
const invalidFacebookCookie = {
  authCookie: { c_user: '0000000000000000', xs: 'invalid-test-xs' }
};

const invalidTwitterCookie = {
  sessionCookie: 'auth_token=invalid; ct0=invalid'
};
```

## 7. Lộ trình thực thi

### Giai đoạn 1 — Chuẩn bị (~30 phút)
1. Tạo test DB, chạy `npx prisma db push`.
2. Start Redis.
3. Kiểm tra `.env.test`.

### Giai đoạn 2 — Smoke + Middleware (~20 phút)
1. `npm run test:api:smoke` hoặc chạy file test P0.
2. Kiểm tra x402 free/paid behavior.
3. Kiểm tra health, openapi.

### Giai đoạn 3 — DB CRUD (~40 phút)
1. Auth, user, operations, schedule, billing, license.
2. CRM, teams, workflows.

### Giai đoạn 4 — Cookie-less platform (~60 phút)
1. Facebook `dryRun=true` + invalid cookie.
2. Twitter `dryRun=true` + `validate-session`.
3. Operations queue with invalid cookie.

### Giai đoạn 5 — Static + Dashboard + Webhooks (~20 phút)
1. Dashboard static files.
2. A2A, scripts, plugins.
3. Stripe webhook (nếu có Stripe CLI).

### Giai đoạn 6 — NFR + Rate limit (~20 phút)
1. Rate limit 429.
2. CORS, logging redaction.

**Tổng thời gian ước tính:** ~2.5–3 gi�ng, không tính thời gian viết test case.

## 8. Quality gates

- P0 pass rate **100%**.
- P1 pass rate **≥ 95%** (lỗi còn lại phải được accept/triage).
- Không có **500** khi input không hợp lệ — tất cả input sai phải trả 4xx với message rõ ràng.
- Không có **PII leak** (cookie, token) trong response hoặc log.
- `npx vitest run tests/` tất cả pass (regression suite hiện có).

## 9. Không nằm trong phạm vi

- Test kết quả scrape/automation thật trên Facebook/Twitter (yêu cầu cookie thật).
- Load/chaos test toàn hệ thống.
- Test UI E2E trên dashboard (có thể làm sau bằng Playwright).
- Test Stripe webhook real nếu không có Stripe CLI.

## 10. Appendix — Lệnh chạy tham khảo

```bash
# Start Redis
redis-server --daemonize yes

# Setup test DB
psql -c "DROP DATABASE IF EXISTS xactions_test;"
psql -c "CREATE DATABASE xactions_test;"
cp .env.example .env.test
# edit .env.test DATABASE_URL, JWT_SECRET, REDIS_*, NODE_ENV=test
npx prisma db push --schema=prisma/schema.prisma

# Run all tests
NODE_ENV=test vitest run

# Run API smoke only
NODE_ENV=test vitest run tests/api/smoke.test.js

# Run with x402 enabled
X402_PAY_TO_ADDRESS=0x... NODE_ENV=test vitest run tests/api/x402.test.js
```

## 11. Đề xuất test case mới cần viết

1. `tests/api/smoke.test.js` — P0-01 → P0-10
2. `tests/api/auth-crud.test.js` — P1-01 → P1-02
3. `tests/api/operations-schedule.test.js` — P1-03 → P1-05
4. `tests/api/facebook-no-cookie.test.js` — P1-FB-01 → P1-FB-04
5. `tests/api/twitter-no-cookie.test.js` — P1-TW-01 → P1-TW-03
6. `tests/api/rate-limit.test.js` — P3-01, P3-02
7. `tests/api/static-dashboard.test.js` — P2-01, P2-02
8. `tests/api/x402.test.js` — P0-05, P3-04

---

**Lưu ý cuối:** Kế hoạch này không thay thế test với cookie thật cho các luồng automation. Nó là lớp bảo hiểm để đảm bảo API không crash, không rò rỉ PII, và các guardrail hoạt động đúng khi cookie thật bị thiếu hoặc hết hạn.
