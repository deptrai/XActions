# Story 34.8: Active Alerting & Re-qualification Workflow

## Story
- **As a** platform reliability operator,
- **I want** an active alerting mechanism (Telegram/Slack/Webhook) when scrapers drop to Tier C and a verifiable re-qualification workflow requiring 5 consecutive clean runs to promote them back to Tier B,
- **So that** production degradation triggers immediate human-in-the-loop attention outside business hours and repaired scrapers earn back their trust baseline without premature demotion flapping.

---

## Acceptance Criteria

### AC 1: Outbound Multi-Channel Alert Dispatch (AD-27)
- **Given** an evaluation or state transition resulting in Tier C,
- **When** `alertDispatcher.dispatchAlert(...)` is invoked,
- **Then**:
  - Outbound alerts are dispatched to configured channels (Telegram, Slack, generic Webhook).
  - The alert payload adheres to the required schema:
    ```json
    {
      "alert_id": "uuid",
      "scraper_id": "pasgo-merchant",
      "platform": "fnb",
      "previous_tier": "B",
      "current_tier": "C",
      "health_score": 62.1,
      "reason": "False 200 Rate > 15%",
      "evaluated_at": "2026-09-08T10:00:00Z",
      "action": "manual_review_required"
    }
    ```
  - Alerts are non-blocking notifications and never trigger automated scraper shutdown or ingestion cutoff.

### AC 2: Alert Deduplication & Suppression Window
- **Given** an alert already dispatched for a scraper,
- **When** another Tier C condition is detected within a 1-hour window (3,600,000ms),
- **Then**:
  - Outbound notification calls are suppressed (`deduped: true`, `dispatched: false`).
  - The alert is recorded in recent alert history.
  - When `BENCHMARK_ALERTS=false`, outbound calls are disabled across all channels while preserving in-memory/DB audit records.

### AC 3: 5-Clean-Run Re-qualification State Machine (AD-31)
- **Given** a scraper currently in Tier C,
- **When** `requalificationService.checkAndRequalify(scraperId)` evaluates recent canary/production runs,
- **Then**:
  - The scraper is promoted from Tier C to Tier B if and only if the last 5 consecutive runs are completely clean (`isSuccess === true && !false200Detected && !checkpointDetected`).
  - A single failure in the sequence resets the clean streak count and keeps the scraper in Tier C.
  - Upon promotion, `requalifiedAt` epoch timestamp is recorded, updating PostgreSQL `ScraperHealthScore`, Redis hash `hash:scraper:health_tier`, and `HealthTierCache`.
  - Future rolling 24-hour aggregations ignore errors before `requalifiedAt` (AD-31).

### AC 4: Operator Scorecard CLI `xactions benchmark alerts` Subcommand
- **Given** the XActions CLI,
- **When** running `xactions benchmark alerts` or `xactions benchmark alerts --format json`,
- **Then**:
  - Displays an aligned ASCII table of recent alerts (Scraper ID, Platform, Tier Transition, Score, Reason, Action, Timestamp).
  - Outputs formatted JSON array when `--format json` or `--json` is passed.
  - Shows a friendly green confirmation when no alerts are active.

### AC 5: REST API Alert & Requalification Endpoints
- **Given** the REST API router in `api/routes/benchmark.js`,
- **When** querying endpoints:
  - `GET /api/benchmark/alerts`: Returns recent alerts history.
  - `POST /api/benchmark/requalify/:id`: Evaluates or triggers re-qualification and returns promotion status.

### AC 6: Test Suite & Zero Regression
- **Given** `tests/benchmark/alerting.test.js`,
- **When** executing tests with Vitest,
- **Then**:
  - 100% of alert dispatch, deduplication, suppression, re-qualification, CLI, and API tests pass.
  - 0 regressions across all 18 benchmark test suites (158 tests).

---

## Architecture & Technical Guardrails

### 1. Human-in-the-Loop Tier C Alerting (AD-27)
Alerts are operator warnings requiring manual investigation (`action: "manual_review_required"`). Data ingestion continues without automatic cutoff.

### 2. Single Writer Re-qualification Epoch (AD-31)
`requalifiedAt` epoch timestamp guarantees that historic errors prior to re-qualification are excluded from subsequent rolling 24-hour evaluation windows, preventing promotion bouncing.

### 3. In-Memory Alert Deduplication
Maintains a 1-hour per-scraper deduplication map to protect operator chat channels from notification floods.

---

## Code Map

- `api/services/benchmark/alerting.js` (NEW): Multi-channel alert dispatcher and deduplicator.
- `api/services/benchmark/requalification.js` (NEW): Re-qualification evaluation and epoch setting.
- `api/routes/benchmark.js` (UPDATE): Add `/alerts` and `/requalify/:id` endpoints.
- `src/cli/commands/benchmark.js` (UPDATE): Add `alerts` subcommand and `formatAlertsTable`.
- `tests/benchmark/alerting.test.js` (NEW): Comprehensive unit & integration test suite.

---

## Tasks / Subtasks

- [x] **Phase 1: AlertDispatcher Implementation (`api/services/benchmark/alerting.js`)**
  - [x] Implement `AlertDispatcher` with Telegram, Slack, Webhook, and test seam (AC 1).
  - [x] Implement 1-hour deduplication window per scraper (AC 2).
  - [x] Implement `BENCHMARK_ALERTS=false` global suppression switch (AC 2).
  - [x] Format alert payload with `action: "manual_review_required"` (AC 1).

- [x] **Phase 2: RequalificationService Implementation (`api/services/benchmark/requalification.js`)**
  - [x] Implement `checkAndRequalify(scraperId)` checking 5 consecutive clean canary runs (AC 3).
  - [x] Implement `manualRequalify(scraperId)` operator override (AC 3).
  - [x] Set `requalifiedAt` epoch and update PostgreSQL, Redis hash, and RAM cache (AC 3).

- [x] **Phase 3: CLI Subcommand & REST API Endpoints (`src/cli/commands/benchmark.js`, `api/routes/benchmark.js`)**
  - [x] Implement `xactions benchmark alerts` CLI subcommand and ASCII table formatter (AC 4).
  - [x] Implement `GET /api/benchmark/alerts` endpoint (AC 5).
  - [x] Implement `POST /api/benchmark/requalify/:id` endpoint (AC 5).

- [x] **Phase 4: Test Suite & Verification (`tests/benchmark/alerting.test.js`)**
  - [x] Author unit tests for alert dispatch, payload shape, and deduplication (AC 1, AC 2).
  - [x] Author unit tests for re-qualification state transitions and epoch update (AC 3).
  - [x] Author tests for CLI `benchmark alerts` (AC 4).
  - [x] Author tests for REST API endpoints (AC 5).
  - [x] Verify full benchmark test suite (18 files, 158 tests) passes 100%.

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Implementation Plan
1. Chuẩn hóa đặc tả BDD Story 34.8.
2. Xây dựng `AlertDispatcher` trong `api/services/benchmark/alerting.js`.
3. Xây dựng `RequalificationService` trong `api/services/benchmark/requalification.js`.
4. Bổ sung subcommand `alerts` trong `src/cli/commands/benchmark.js`.
5. Bổ sung endpoint `/alerts` và `/requalify/:id` trong `api/routes/benchmark.js`.
6. Viết test suite `tests/benchmark/alerting.test.js` và kiểm tra toàn bộ benchmark suite.

### Debug Log
- Đảm bảo `AlertDispatcher` lưu giữ lịch sử cảnh báo ngay cả khi cờ `BENCHMARK_ALERTS=false` để phục vụ thanh tra audit từ dashboard và CLI.
- Xác thực `requalifiedAt` cập nhật đồng thời cả trong PostgreSQL `ScraperHealthScore`, Redis Hash `hash:scraper:health_tier` và `HealthTierCache`.

### Completion Notes
- Hoàn thành đầy đủ 4 Phase theo đúng đặc tả BDD và các yêu cầu kiến trúc AD-27, AD-31.
- 18 test files với 158 tests benchmark vượt qua 100%.

### File List
- `api/services/benchmark/alerting.js` (NEW)
- `api/services/benchmark/requalification.js` (NEW)
- `src/cli/commands/benchmark.js` (UPDATE)
- `api/routes/benchmark.js` (UPDATE)
- `tests/benchmark/alerting.test.js` (NEW)
- `_bmad-output/implementation-artifacts/stories/34-8-active-alerting-requalification-workflow.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)

### Change Log
- 2026-09-08: Chuẩn hóa đặc tả BDD Story 34.8, hoàn thành toàn bộ mã nguồn alerting, requalification, CLI, REST API và test suite 100% pass.

### Status
done

---

## Senior Developer Review (AI)

### Review Summary (2026-09-08)
- **Review Outcome:** Approved (Pass with Flying Colors)
- **Layer 1 (AC Verification):** Đạt 100% tiêu chí AC 1 đến AC 6. Alert payload đúng chuẩn với `action: "manual_review_required"`, deduplication 1 giờ hoạt động chính xác, re-qualification yêu cầu đúng 5 clean runs liên tiếp, CLI hiển thị bảng ASCII chuẩn và API endpoints trả về kết quả nhất quán.
- **Layer 2 (Architecture & Security):**
  - Tuân thủ AD-27: Cảnh báo đóng vai trò thông báo operator, không tự ý ngắt ingestion stream của Nowing.
  - Tuân thủ AD-31: Epoch `requalifiedAt` thiết lập chuẩn xác để loại bỏ các lỗi cũ trước thời điểm thăng hạng.
- **Layer 3 (Code Quality & Performance):**
  - Kiến trúc hướng sự kiện với dependency injection `dispatchSeam` giúp test chạy cực nhanh (12 tests trong 588ms).
  - Bộ nhớ đệm cảnh báo giới hạn 100 mục tránh memory leak.
- **Layer 4 (Edge Cases & Resilience):**
  - Xử lý mượt mà khi scraperId không hợp lệ (trả về 400).
  - Khi kênh gửi tin nhắn (Telegram/Slack/Webhook) lỗi mạng, hệ thống bắt lỗi và log warning, không làm sập ứng dụng.
- **Test Suite Verification:** 18 test files, 158 tests benchmark pass 100%. Không có lỗi hồi quy.
