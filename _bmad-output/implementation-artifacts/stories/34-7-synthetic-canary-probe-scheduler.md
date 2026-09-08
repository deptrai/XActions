# Story 34.7: Synthetic Canary Probe Scheduler

## Story
- **As a** platform reliability engineer,
- **I want** an automated synthetic canary probe scheduler running hourly against representative URLs across all monitored platforms,
- **So that** low-volume and mission-critical scrapers maintain an active reliability baseline, detecting False-200 blocks, checkpoints, and latency degradation independent of production traffic.

---

## Acceptance Criteria

### AC 1: Canonical Canary Configuration (AD-23, NFR-20)
- **Given** `src/benchmark/canary-config.js`,
- **When** defining probe targets,
- **Then**:
  - Contains representative, stable test URLs for all 9 core platforms (`twitter-hybrid`, `facebook-hybrid`, `threads-hybrid`, `tiktok-hybrid`, `shopee-hybrid`, `pasgo-merchant`, `masothue`, `youtube-crawler`, `zalo-hybrid`).
  - Identifies auth requirements and designated probe account keys.
  - Specifies standard hourly cron expression `0 * * * *` (yielding ≥ 24 evaluations/day per platform, satisfying NFR-20).
  - Specifies probe timeout ceiling of 30,000ms (30s).

### AC 2: Dedicated Probe Account Isolation & Guard (AD-35)
- **Given** an auth-required platform (e.g. Twitter, Facebook, Zalo),
- **When** `canaryRunner.probe(scraperId)` executes,
- **Then**:
  - It searches `AccountPool` specifically for accounts tagged `probe: true`, `isProbe: true`, or `probe-*`.
  - If no dedicated probe account is available:
    - It **fails safe** and logs `isSuccess: false` with HTTP 401 and error `Dedicated probe account unavailable (AD-35)`.
    - It **never** falls back to production or customer accounts (zero account pollution).
    - It emits failure telemetry and records the failure in PostgreSQL.

### AC 3: False-200 & Checkpoint Detection during Canary Probes (AD-30)
- **Given** an HTTP 200 response returned during a probe,
- **When** the response is evaluated by `getValidator(platform)`,
- **Then**:
  - Cloudflare Turnstile, Arkose challenge, or captcha page is detected -> `false200Detected: true`, `isSuccess: false`.
  - Login wall or checkpoint is detected -> `checkpointDetected: true`, `isSuccess: false`.
  - Clean payload matching expected structure -> `isSuccess: true`, `false200Detected: false`, `checkpointDetected: false`.

### AC 4: Telemetry Pipeline & Database Persistence (CAP-1, AD-33)
- **Given** a completed canary probe,
- **When** recording telemetry and database state,
- **Then**:
  - Emits telemetry event via `telemetryEmitter.emitRun(...)` with `source: 'canary'` and `isCanary: true`.
  - Writes a complete record to PostgreSQL `ScraperCanaryRun` with `scraperId`, `platform`, `targetUrl`, `isSuccess`, `latencyMs`, `httpStatus`, `false200Detected`, `checkpointDetected`, `errorReason`, and `executedAt`.

### AC 5: Transport Failure & Timeout Handling
- **Given** a hanging network request exceeding 30,000ms,
- **When** executing a probe,
- **Then**:
  - The request is aborted via `AbortController`.
  - Records `isSuccess: false`, `httpStatus: 504`, `latencyMs: 30000`, `errorReason: 'Probe timed out after 30000ms'`.
  - Network transport errors (e.g. `ECONNREFUSED`) are handled cleanly as HTTP 502 without crashing the service.

### AC 6: Test Suite & Zero Regression
- **Given** `tests/benchmark/canary-runner.test.js`,
- **When** running the test suite,
- **Then**:
  - 100% of test scenarios pass (probe account isolation, False 200 detection, login walls, timeout, probeAll concurrency guard, cron lifecycle).
  - All existing benchmark tests (17 files, 146 tests) pass with zero regressions.

---

## Architecture & Technical Guardrails

### 1. Dedicated Probe Accounts in AccountPool (AD-35)
Canary runs must never consume production customer quota or risk customer account suspension. If a dedicated probe account is missing on an auth-required platform, the canary marks the probe as failed and halts immediately.

### 2. Rate Governor & Quota Bypass (AD-33)
Canary probes run with `session.isCanary = true` and `source: 'canary'`. The rate governor ignores velocity and hibernation checks for canary requests.

### 3. Mutex Flag for Scheduled Probes
`CanaryRunner.probeAll()` uses internal boolean mutex `isProbing` to avoid overlapping executions if a previous hourly cycle takes longer than expected.

---

## Code Map

- `src/benchmark/canary-config.js` (NEW): Canary targets, probe accounts, cron and timeout settings.
- `api/services/benchmark/canary-runner.js` (NEW): Canary probe execution engine, validator integration, and scheduler.
- `api/server.js` (UPDATE): Wire canary scheduler startup and graceful shutdown.
- `tests/benchmark/canary-runner.test.js` (NEW): Unit & integration test suite.

---

## Tasks / Subtasks

- [x] **Phase 1: Canary Configuration (`src/benchmark/canary-config.js`)**
  - [x] Define `CANARY_CONFIGS` with target URLs for all 9 platforms (AC 1).
  - [x] Configure auth requirements and probe account keys (AC 1, AC 2).
  - [x] Define `DEFAULT_CANARY_CRON` ('0 * * * *') and `DEFAULT_CANARY_TIMEOUT_MS` (30s).

- [x] **Phase 2: CanaryRunner Implementation (`api/services/benchmark/canary-runner.js`, `api/server.js`)**
  - [x] Implement `CanaryRunner.probe(scraperId)` with validator integration (AC 2, AC 3).
  - [x] Enforce dedicated probe account isolation with fail-safe guard (AD-35) (AC 2).
  - [x] Emit canary telemetry with `source: 'canary'`, `isCanary: true` (AC 4).
  - [x] Persist records to PostgreSQL `ScraperCanaryRun` table (AC 4).
  - [x] Handle AbortController 30s timeout and transport errors (AC 5).
  - [x] Implement `probeAll()` with mutex protection against overlapping runs.
  - [x] Implement `startScheduler()` / `stopScheduler()` using node-cron.
  - [x] Wire `defaultCanaryRunner` in `api/server.js` with graceful shutdown.

- [x] **Phase 3: Test Suite & Verification (`tests/benchmark/canary-runner.test.js`)**
  - [x] Author unit tests for probe account missing vs available (AC 2).
  - [x] Author tests for False-200 and Checkpoint detection (AC 3).
  - [x] Author tests for timeout and transport failures (AC 5).
  - [x] Author tests for `probeAll()` and scheduler lifecycle (AC 1, AC 6).
  - [x] Verify full benchmark test suite (17 files, 146 tests) passes 100%.

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Implementation Plan
1. Chuẩn hóa đặc tả BDD Story 34.7.
2. Xây dựng cấu hình mục tiêu canary `src/benchmark/canary-config.js`.
3. Xây dựng `CanaryRunner` trong `api/services/benchmark/canary-runner.js`.
4. Tích hợp scheduler và graceful shutdown trong `api/server.js`.
5. Viết test suite `tests/benchmark/canary-runner.test.js`.
6. Chạy toàn bộ test suites và thực hiện review.

### Debug Log
- Điều chỉnh logic phân biệt `errorReason` giữa login wall (`isLoginWall`) và Cloudflare bot challenge (`false200Detected`) khi cả hai cờ cùng kích hoạt trên phản hồi HTTP 200.
- Sửa đường dẫn import `defaultTelemetryEmitter` từ `src/core/telemetry-emitter.js`.
- Bổ sung mock `fetchSeam` trong test tránh việc gọi live HTTP ra internet trong bài kiểm tra mutex.

### Completion Notes
- Đã hoàn thành 100% các tiêu chí AC 1 đến AC 6 và tuân thủ các quyết định kiến trúc AD-23, AD-30, AD-33, AD-35.
- 17 test files với 146 tests benchmark vượt qua 100%.

### File List
- `src/benchmark/canary-config.js` (NEW)
- `api/services/benchmark/canary-runner.js` (NEW)
- `api/server.js` (UPDATE)
- `tests/benchmark/canary-runner.test.js` (NEW)
- `_bmad-output/implementation-artifacts/stories/34-7-synthetic-canary-probe-scheduler.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)

### Change Log
- 2026-09-08: Chuẩn hóa đặc tả BDD Story 34.7 và hoàn thành triển khai mã nguồn, tích hợp scheduler và bộ test suite 100% pass.

### Status
done

---

## Senior Developer Review (AI)

### Review Summary (2026-09-08)
- **Review Outcome:** Approved (Pass with Flying Colors)
- **Layer 1 (AC Verification):** Đạt 100% tiêu chí từ AC 1 đến AC 6. Cấu hình canary chuẩn xác, scheduler chạy định kỳ mỗi giờ, timeout 30s với AbortController, phát hiện False-200 và Checkpoints, ghi nhận đầy đủ vào PostgreSQL `ScraperCanaryRun`.
- **Layer 2 (Architecture & Security):**
  - Tuân thủ AD-35: Cô lập tài khoản probe với `probe: true`, không bao giờ dùng tài khoản customer/production.
  - Tuân thủ AD-33: Gán `isCanary: true` và `source: 'canary'` để bỏ qua giới hạn velocity của rate governor.
  - Tuân thủ AD-23: Chạy định kỳ độc lập với traffic production.
- **Layer 3 (Code Quality & Performance):**
  - Quản lý concurrency an toàn với cờ mutex `isProbing`.
  - Tích hợp dependency injection `fetchSeam` giúp việc kiểm thử hoàn toàn độc lập với môi trường mạng thực tế.
- **Layer 4 (Edge Cases & Resilience):**
  - Xử lý mượt mà lỗi timeout, mạng chập chờn, scraperId không hợp lệ.
  - Tích hợp graceful shutdown trong `api/server.js`.
- **Test Suite Verification:** 17 test files, 146 tests benchmark pass 100%. Không có lỗi hồi quy.
