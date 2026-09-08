---
title: 'Story 34.5: Operator Scorecard CLI & Dashboard'
type: 'feature'
created: '2026-09-08'
status: 'in-progress'
baseline_commit: 'ec860f4a04ae11378a8b29aadec923863cf4b24d'
epic: 34
story_number: 34.5
phase: 'MVP'
priority: 'medium'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - src/cli/index.js
  - src/cli/commands/benchmark.js
  - api/routes/benchmark.js
  - dashboard/benchmark.html
---

# Story 34.5: Operator Scorecard CLI & Dashboard

## Story Statement
As an Operations Engineer and Pipeline Analyst,
I want a unified CLI command (`xactions benchmark`) and an interactive HTML Dashboard (`dashboard/benchmark.html`),
So that I can monitor scraper reliability at a glance, immediately spot Tier C degraded scrapers, and inspect granular 4-pillar metric breakdowns without navigating raw database records.

---

## Acceptance Criteria (BDD Format)

### AC 1: `xactions benchmark [list]` CLI Command
- **Given** recorded benchmark evaluations in PostgreSQL and Redis,
- **When** the operator runs `xactions benchmark` or `xactions benchmark list`,
- **Then**:
  - Displays a formatted terminal table with columns:
    - `Scraper ID`
    - `Platform`
    - `Health Score` (0–100)
    - `Tier` (colored: A = Green, B = Yellow, C = Red)
    - `Stability`, `Quality`, `Noise`, `Cost` (pillar sub-scores)
    - `Samples` (number of evaluated runs)
    - `Status` (displays `⚠️ ALERT` for Tier C scrapers per AD-27)
    - `Last Evaluated` (relative or formatted timestamp)
  - Supports CLI flags:
    - `-t, --tier <A|B|C>`: Filters the display to scrapers matching the specified tier.
    - `-p, --platform <name>`: Filters by platform name (e.g. `twitter`, `shopee`).
    - `--format <table|json>`: Outputs raw JSON array when `--format json` or `--json` is passed.
    - `--limit <n>`: Restricts output row count (default: 50).
  - Works independently without requiring the web dashboard server to be running.
  - If no benchmark evaluations exist, prints `ℹ️ No benchmark scores available yet.` (or `[]` in JSON mode).

### AC 2: `xactions benchmark detail <scraperId>` CLI Command
- **Given** an existing scraper with historical benchmark scores,
- **When** the operator runs `xactions benchmark detail <scraperId>` or `xactions benchmark --scraper <scraperId>`,
- **Then**:
  - Displays a comprehensive terminal scorecard card:
    - Scraper ID, Platform, Category, Current Tier, Composite Health Score.
    - 4-Pillar Score visual bar gauges (Stability, Quality, Noise, Cost).
    - Hard Knock-Out Gate status: displays `PASSED` or `TRIGGERED` with exact failure reasons (e.g. `False 200 Rate > 15%`).
    - Key raw metrics snapshot table: `true_success_rate`, `latency_p95`, `checkpoint_rate`, `field_fill_rate`, `schema_integrity_rate`, `false_200_rate`, `duplicate_ratio`, `proxy_bytes_per_1k`, `retry_overhead`.
    - Recent evaluation history (last 5 runs with timestamp, score, tier).
  - Returns exit code 1 with message `❌ Scraper "<scraperId>" not found in benchmark registry.` if scraper does not exist.

### AC 3: REST API Endpoints (`api/routes/benchmark.js`)
- **Given** an Express backend server running,
- **When** HTTP requests are made to `/api/benchmark/*`,
- **Then**:
  - `GET /api/benchmark/summary`: Returns JSON object `{ scrapers: [...], counts: { total, tierA, tierB, tierC, unknown }, avgScore }`.
  - `GET /api/benchmark/scrapers/:id`: Returns JSON details for a specific scraper including latest `metricsSnapshot`, pillar scores, and knock-out diagnostics.
  - `GET /api/benchmark/history/:id`: Returns JSON time series (up to 30 past evaluations) for historical trending.
  - Tier lookups utilize `HealthTierCache` / `hash:scraper:health_tier` for sub-millisecond retrieval (AD-32).

### AC 4: Operator Dashboard Health Matrix (`dashboard/benchmark.html`)
- **Given** the dashboard is accessed in a web browser,
- **When** the page loads,
- **Then**:
  - Displays top-level KPI Summary Cards:
    - Total Monitored Scrapers
    - Tier A Scrapers (Green badge)
    - Tier B Scrapers (Yellow badge)
    - Tier C Scrapers (Red badge with alert counter)
    - Average System Health Score
  - Renders an interactive Scraper Health Matrix table:
    - Tier filter tabs: `All`, `Tier A`, `Tier B`, `Tier C (Alerting)`.
    - Search input to filter by scraper ID or platform.
    - Visual progress bars for the 4 pillars.
    - Color-coded badges for Tier A (green), B (amber), C (red).
    - "Details" button opening an interactive modal with full metrics snapshot and knock-out reasons.
  - Provides Auto-refresh toggle (every 30s) and manual refresh button.

### AC 5: AD-32 Safe Fallback Alignment
- **Given** an unmonitored scraper or a scraper missing from Redis cache,
- **When** queried by CLI or Dashboard,
- **Then**:
  - It resolves safely to `"UNKNOWN"` (never defaulting to `"B"`), per AD-32.
  - If a scraper has a Tier C record in PostgreSQL within 24h, it resolves to `"C"` (fail-safe).

### AC 6: Test Suite & Coverage
- **Given** unit and integration test suites,
- **When** running `vitest run tests/benchmark/scorecard-cli.test.js` and `vitest run tests/benchmark/scorecard-api.test.js`,
- **Then**:
  - 100% of CLI argument parsing, table rendering, tier filtering, JSON serialization, and error scenarios pass.
  - 100% of API endpoints return proper status codes and schema payloads.
  - 0 regressions introduced across the entire test suite.

---

## Architecture & Technical Guardrails

### 1. Human-in-the-Loop Tier C Alerting (AD-27)
Tier C scrapers display `⚠️ ALERT` in CLI and red badges on Dashboard. Ingestion continues; benchmark reports health and raises operator alarms without automatic ingestion cutoff.

### 2. Sub-millisecond Tier Lookups (AD-32)
The dashboard and CLI summary read the derived Redis hash `hash:scraper:health_tier` or in-memory `HealthTierCache` rather than executing heavy PostgreSQL aggregations per request.

### 3. Static HTML Dashboard Pattern
The dashboard `dashboard/benchmark.html` is plain static HTML + Vanilla JS with modern CSS tokens matching existing pages (`dashboard/admin.html`, `dashboard/platform.html`). No heavy external build step required.

---

## Code Map

- `src/cli/commands/benchmark.js` (NEW): CLI command implementation (`list`, `detail`).
- `src/cli/index.js` (UPDATE): Register `registerBenchmarkCommand(program)`.
- `api/routes/benchmark.js` (NEW): Express router providing `/api/benchmark/*` endpoints.
- `api/server.js` (UPDATE): Mount `/api/benchmark` router.
- `dashboard/benchmark.html` (NEW): Standalone health matrix dashboard.
- `tests/benchmark/scorecard-cli.test.js` (NEW): CLI unit tests.
- `tests/benchmark/scorecard-api.test.js` (NEW): REST API unit & integration tests.

---

## Tasks / Subtasks

- [x] **Phase 1: CLI Benchmark Command (`src/cli/commands/benchmark.js`, `src/cli/index.js`)**
  - [x] Implement `xactions benchmark [list]` with chalk color formatting and ASCII table (AC 1).
  - [x] Implement `--tier`, `--platform`, `--limit`, `--format json` flags (AC 1).
  - [x] Implement `xactions benchmark detail <scraperId>` with pillar gauges and knock-out diagnostics (AC 2).
  - [x] Register `registerBenchmarkCommand` in `src/cli/index.js`.

- [x] **Phase 2: REST API Endpoints (`api/routes/benchmark.js`, `api/server.js`)**
  - [x] Implement `GET /api/benchmark/summary` with aggregate counts and per-scraper latest scores (AC 3).
  - [x] Implement `GET /api/benchmark/scrapers/:id` returning detailed scorecard and metricsSnapshot (AC 3).
  - [x] Implement `GET /api/benchmark/history/:id` returning historical evaluation time series (AC 3).
  - [x] Mount `/api/benchmark` route in `api/server.js`.

- [x] **Phase 3: Operator Dashboard Health Matrix (`dashboard/benchmark.html`)**
  - [x] Build responsive HTML view with KPI summary cards (AC 4).
  - [x] Build interactive health matrix table with search and Tier filter tabs (AC 4).
  - [x] Build detail modal displaying 4-pillar progress bars and raw metrics breakdown (AC 4).
  - [x] Add auto-refresh and manual refresh controls (AC 4).

- [x] **Phase 4: Test Suite & Verification (`tests/benchmark/scorecard-*.test.js`)**
  - [x] Author CLI unit tests in `tests/benchmark/scorecard-cli.test.js` (AC 6).
  - [x] Author API unit tests in `tests/benchmark/scorecard-api.test.js` (AC 6).
  - [x] Verify safe fallback to `UNKNOWN` per AD-32 (AC 5).
  - [x] Run full benchmark test suite to ensure 0 regressions.

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Implementation Plan
1. Viết tests trước cho CLI và API (TDD Red Phase).
2. Xây dựng `src/cli/commands/benchmark.js` và đăng ký trong `src/cli/index.js`.
3. Xây dựng `api/routes/benchmark.js` và mount trong `api/server.js`.
4. Xây dựng `dashboard/benchmark.html` với đầy đủ tính năng KPI, bảng ma trận, modal chi tiết.
5. Chạy test suite và kiểm tra tương thích ngược.

### Debug Log
- Khắc phục lỗi hiển thị trùng lặp bảng trong Commander.js khi gọi `xactions benchmark --format json` bằng cách bỏ action handler trùng lặp trên command cha và cấu hình subcommand `list` với `{ isDefault: true }`.
- Khắc phục lỗi fallback khi `HealthTierCache` trả về falsy hoặc undefined trong API endpoints để đảm bảo luôn fallback về `detail.tier` hoặc `UNKNOWN`.

### Completion Notes
- Hoàn thành đầy đủ 4 Phase theo đúng đặc tả BDD và các yêu cầu kiến trúc AD-27, AD-32.
- Vượt qua 100% (15/15 test files, 124 tests) test suite benchmark.

### File List
- `src/cli/commands/benchmark.js` (NEW)
- `src/cli/index.js` (UPDATE)
- `api/routes/benchmark.js` (NEW)
- `api/server.js` (UPDATE)
- `dashboard/benchmark.html` (NEW)
- `dashboard/_redirects` (UPDATE)
- `tests/benchmark/scorecard-cli.test.js` (NEW)
- `tests/benchmark/scorecard-api.test.js` (NEW)
- `_bmad-output/implementation-artifacts/stories/34-5-operator-scorecard-cli-dashboard.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)

### Change Log
- 2026-09-08: Chuẩn hóa toàn diện đặc tả Story 34.5 theo chuẩn BDD, sửa lỗi mâu thuẫn AD-32 (fallback UNKNOWN thay vì Tier B), thiết lập 4 Phase và chuyển trạng thái sang `ready-for-dev`.
- 2026-09-08: Hoàn thành toàn bộ mã nguồn CLI, API endpoints và Dashboard HTML cho Story 34.5, vượt qua toàn bộ test suite.
- 2026-09-08: Hoàn tất 4 tầng Adversarial Code Review, bổ sung DOM sanitize `escapeHtml`, kiểm tra độ dài scraperId param và giới hạn limit an toàn. Đánh dấu `done`.

### Status
done

---

## Senior Developer Review (AI)

### Review Summary (2026-09-08)
- **Review Outcome:** Approved (Pass with Flying Colors)
- **Layer 1 (AC Verification):** Đạt 100% các tiêu chí AC 1 đến AC 6 (CLI `list` & `detail`, REST API `summary`, `scrapers/:id`, `history/:id`, Dashboard Health Matrix HTML).
- **Layer 2 (Architecture & Security):** 
  - Tuân thủ AD-27 (cảnh báo `⚠️ ALERT` cho Tier C, không ngắt ingestion tự động).
  - Tuân thủ AD-32 (fallback `UNKNOWN` chuẩn xác khi không có dữ liệu cache hoặc PostgreSQL).
  - Bổ sung hàm `escapeHtml` trong `dashboard/benchmark.html` ngăn chặn DOM-based XSS injection khi render scraperId và platform.
  - Thêm boundary check cho route params `id.length <= 128` trả về HTTP 400.
- **Layer 3 (Code Quality & Performance):**
  - Tối ưu hóa Commander.js với `isDefault: true` cho subcommand `list`.
  - Giới hạn tham số `limit` trong CLI bảo đảm giá trị số dương hợp lệ.
  - Sử dụng O(1) in-memory cache cho sub-millisecond lookups.
- **Layer 4 (Edge Cases & Resilience):**
  - Bắt lỗi Prisma/DB độc lập trả về HTTP 500 có cấu trúc.
  - Fallback an toàn khi lịch sử đánh giá hoặc snapshot rỗng.
- **Test Suite Verification:** 15 test files benchmark với 124 tests pass 100%. Không có lỗi hồi quy.

