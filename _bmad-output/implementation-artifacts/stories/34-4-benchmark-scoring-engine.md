---
title: 'Story 34.4: Benchmark Scoring Engine'
type: 'feature'
created: '2026-09-08'
status: 'in-progress'
baseline_commit: '159b66c73454fe93e98ac69ad010d2f2bb584841'
epic: 34
story_number: 34.4
phase: 'MVP'
priority: 'high'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - src/benchmark/scoring-engine.js
  - src/benchmark/state-manager.js
  - src/utils/safe-ratio.js
---

# Story 34.4: Benchmark Scoring Engine

## Story Statement
As an Operations Engineer and Data Pipeline Architect,
I want an automated Benchmark Scoring Engine that calculates a 0–100 Health Score and assigns Tiers (A/B/C) using a 4-pillar formula with hard knock-out gates,
So that Nowing and downstream consumers receive clear, non-compensatory health ratings per scraper without allowing critical failure modes to be masked by unrelated metrics.

---

## Acceptance Criteria (BDD Format)

### AC 1: 4-Pillar Scoring & Linear Interpolation Math (metrics-catalog.md)
- **Given** a set of aggregated telemetry metrics for a scraper,
- **When** `BenchmarkScoringEngine.calculateScores(metrics, category)` is executed,
- **Then**:
  - Each metric $m_i$ is mapped to a normalized sub-score $S_i \in [0, 100]$ using linear interpolation:
    - Standard positive metric: $S_i = \text{clamp}\left(100 \times \frac{m_i - \text{fail}}{\text{target} - \text{fail}}, 0, 100\right)$
    - Inverted metric (lower is better: latency, duplicate ratio, false 200, proxy bytes, retries, checkpoint rate):
      $S_i = \text{clamp}\left(100 \times \frac{\text{fail} - m_i}{\text{fail} - \text{target}}, 0, 100\right)$
  - Pillar sub-scores are calculated as: $\text{pillar\_score} = \frac{\sum w_i \times S_i}{\sum w_i}$ for applicable metrics.
  - Overall Health Score is calculated with exact pillar weights:
    $$\text{HealthScore} = 0.35 \times \text{Stability} + 0.30 \times \text{Quality} + 0.20 \times \text{Noise} + 0.15 \times \text{Cost}$$
  - Division by zero in any metric calculation uses `safeRatio(numerator, denominator, fallback)` and returns the fallback without throwing `NaN` or crashing.

### AC 2: Non-Compensatory Hard Knock-Out Gates (AD-26)
- **Given** an aggregated evaluation window for a scraper,
- **When** any of the following 4 hard knock-out gates are triggered:
  1. `True Success Rate < 80%` (`true_success_rate < 0.80`)
  2. `Essential Field Fill Rate < 85%` (`field_fill_rate < 0.85`)
  3. `False 200 Rate > 15%` (`false_200_rate > 0.15`)
  4. `Schema Integrity Rate < 90%` (`schema_integrity_rate < 0.90`)
- **Then**:
  - The assigned `tier` MUST be forced to `"C"` regardless of the composite Health Score (even if composite is 90+).
  - The scoring result records `knockoutTriggered: true` and an array of `knockoutReasons` identifying the triggered gates.
  - If no knock-out gates are triggered, tier is assigned by standard thresholds:
    - $\text{HealthScore} \ge 90 \implies \text{Tier A}$
    - $70 \le \text{HealthScore} < 90 \implies \text{Tier B}$
    - $\text{HealthScore} < 70 \implies \text{Tier C}$

### AC 3: Category-Specific Denominator Re-normalization (AD-28)
- **Given** a scraper belonging to a specific category in `CATEGORY_VALUES` (`src/core/types.js`),
- **When** evaluating metrics marked N/A for that category:
  - `ecom`, `fnb_merchant`, `healthcare`, `legal`: exclude `comment_completeness`.
  - `realestate`, `recruitment`, `automotive`: exclude `comment_completeness`, `contact_accuracy`.
  - `b2b`: exclude `comment_completeness`, `contact_accuracy`, `data_freshness`.
- **Then**:
  - Excluded metrics are omitted from the pillar calculation.
  - Remaining metric weights within that pillar are re-normalized to sum to the full pillar weight so the scraper is not penalized for inapplicable data types.

### AC 4: Single-Writer Tier State Machine & Re-qualification Epoch (AD-31)
- **Given** a new evaluation result from `BenchmarkScoringEngine`,
- **When** updating tier state in PostgreSQL and Redis,
- **Then**:
  - Tier transitions must be processed through `BenchmarkStateManager` as the single authoritative writer.
  - If a scraper has a `requalifiedAt` timestamp, failures occurring prior to `requalifiedAt` are excluded from the rolling knock-out window.
  - The state manager writes the new `tier` to Redis Hash `hash:scraper:health_tier` and updates in-memory `healthTierCache`.
  - A new `ScraperHealthScore` row is inserted into PostgreSQL with `healthScore`, `tier`, `metricsSnapshot`, `evaluatedAt`.

### AC 5: Rolling Aggregation Pipeline (AD-23, AD-29)
- **Given** raw telemetry rollups from `TelemetryConsumer.aggregateRuns()`,
- **When** the scoring engine processes an aggregation window (1-hour or 24-hour),
- **Then**:
  - Computes aggregated rates across all runs for the scraper in the window:
    - $\text{true\_success\_rate} = \frac{\text{successful\_runs}}{\text{total\_runs}}$
    - $\text{false\_200\_rate} = \frac{\text{false200\_requests}}{\text{total\_2xx\_requests}}$
    - $\text{checkpoint\_rate} = \frac{\text{checkpoint\_requests}}{\text{total\_requests}}$
    - $\text{proxy\_bytes\_per\_1k} = \text{safeRatio}(\text{total\_proxy\_bytes} \times 1000, \text{total\_items\_scraped}, 500 \times 1024 \times 1024)$
  - Persists the evaluation record without mutating existing historical rows (append-only).

### AC 6: Test Suite & Comprehensive Synthetic Dataset
- **Given** a synthetic 24-hour telemetry dataset containing healthy, degraded, and failing scrapers across multiple categories,
- **When** the test suite `tests/benchmark/scoring-engine.test.js` is executed,
- **Then**:
  - 100% of mathematical formulas, inverted metrics, clamping, safeRatio edge cases, knock-out gates, and category re-normalizations are verified.
  - Total scoring execution time is strictly less than 500ms per scraper.

---

## Architecture & Technical Guardrails

### 1. Hard Knock-Out Gates (AD-26)
Gate evaluation runs BEFORE weighted composite calculation. Canonical metric names match AD-29/AD-30:
```javascript
export const KNOCK_OUT_GATES = [
  { name: 'true_success_rate', test: v => v < 0.80, reason: 'True Success Rate < 80%' },
  { name: 'field_fill_rate', test: v => v < 0.85, reason: 'Essential Field Fill Rate < 85%' },
  { name: 'false_200_rate', test: v => v > 0.15, reason: 'False 200 Rate > 15%' },
  { name: 'schema_integrity_rate', test: v => v < 0.90, reason: 'Schema Integrity Rate < 90%' },
];
```

### 2. Category Profile Mapping (AD-28)
```javascript
export const CATEGORY_EXCLUSIONS = {
  social: [],
  ecom: ['comment_completeness'],
  realestate: ['comment_completeness', 'contact_accuracy'],
  recruitment: ['comment_completeness', 'contact_accuracy'],
  automotive: ['comment_completeness', 'contact_accuracy'],
  b2b: ['comment_completeness', 'contact_accuracy', 'data_freshness'],
  fnb_merchant: ['comment_completeness'],
  healthcare: ['comment_completeness'],
  legal: ['comment_completeness'],
};
```

### 3. Metric Benchmarks (Target & Fail Values)
```javascript
export const METRIC_CONFIGS = {
  // Stability (0.35)
  true_success_rate: { pillar: 'stability', weight: 0.40, target: 0.98, fail: 0.70, inverted: false },
  latency_p95: { pillar: 'stability', weight: 0.25, target: 3500, fail: 15000, inverted: true },
  checkpoint_rate: { pillar: 'stability', weight: 0.20, target: 0.005, fail: 0.05, inverted: true },
  proxy_quarantine_rate: { pillar: 'stability', weight: 0.15, target: 0.05, fail: 0.25, inverted: true },

  // Quality (0.30)
  field_fill_rate: { pillar: 'quality', weight: 0.35, target: 0.95, fail: 0.60, inverted: false },
  schema_integrity_rate: { pillar: 'quality', weight: 0.35, target: 0.98, fail: 0.80, inverted: false },
  data_freshness: { pillar: 'quality', weight: 0.15, target: 300, fail: 3600, inverted: true },
  comment_completeness: { pillar: 'quality', weight: 0.15, target: 0.90, fail: 0.50, inverted: false },

  // Noise (0.20)
  duplicate_ratio: { pillar: 'noise', weight: 0.30, target: 0.02, fail: 0.15, inverted: true },
  spam_noise_ratio: { pillar: 'noise', weight: 0.25, target: 0.05, fail: 0.25, inverted: true },
  contact_accuracy: { pillar: 'noise', weight: 0.20, target: 0.85, fail: 0.40, inverted: false },
  false_200_rate: { pillar: 'noise', weight: 0.25, target: 0.01, fail: 0.15, inverted: true },

  // Cost (0.15)
  proxy_bytes_per_1k: { pillar: 'cost', weight: 0.40, target: 50 * 1024 * 1024, fail: 500 * 1024 * 1024, inverted: true },
  account_burn_rate: { pillar: 'cost', weight: 0.30, target: 0.001, fail: 0.02, inverted: true },
  retry_overhead: { pillar: 'cost', weight: 0.30, target: 0.15, fail: 1.0, inverted: true },
};
```

---

## Code Map

- `src/utils/safe-ratio.js` (NEW): Safe division helper avoiding `NaN` or zero division.
- `src/benchmark/scoring-engine.js` (NEW): Normalization math, pillar scoring, knock-out gates, category re-normalization.
- `src/benchmark/state-manager.js` (NEW): Single-writer tier state manager respecting `requalifiedAt` epoch (AD-31).
- `tests/benchmark/scoring-engine.test.js` (NEW): Unit tests covering math, knock-outs, category profiles, synthetic 24h dataset.

---

## Tasks / Subtasks

- [x] **Phase 1: Safe Ratio & Core Scoring Mathematics (`src/utils/safe-ratio.js`, `src/benchmark/scoring-engine.js`)**
  - [x] Implement `safeRatio(num, den, fallback)` utility (AC 1).
  - [x] Implement `clamp(val, min, max)` and linear normalization for positive and inverted metrics (AC 1).
  - [x] Implement category-aware weight re-normalization (AC 3).
  - [x] Implement pillar sub-score calculation and composite Health Score (AC 1).

- [x] **Phase 2: Non-Compensatory Hard Knock-Out Gates & Tier Classification (`src/benchmark/scoring-engine.js`)**
  - [x] Implement `KNOCK_OUT_GATES` evaluation before composite weighting (AC 2).
  - [x] Implement tier classification: A (90-100), B (70-89), C (<70 or knock-out) (AC 2).
  - [x] Attach `knockoutTriggered` and `knockoutReasons` to diagnostic scoring output (AC 2).

- [x] **Phase 3: Benchmark State Manager & Re-qualification Epoch (`src/benchmark/state-manager.js`)**
  - [x] Implement `BenchmarkStateManager` as single writer to `hash:scraper:health_tier` and `ScraperHealthScore` (AC 4).
  - [x] Filter out failures older than `requalifiedAt` during rolling window evaluations (AD-31).
  - [x] Synchronize state to `healthTierCache` in RAM and Redis (AC 4).

- [x] **Phase 4: Telemetry Aggregation & 24h Synthetic Dataset Testing (`tests/benchmark/scoring-engine.test.js`)**
  - [x] Build unit test suite covering normalization math, inverted metrics, clamping, safeRatio (AC 6).
  - [x] Build knock-out gate unit tests verifying immediate Tier C cap (AC 2, AC 6).
  - [x] Build category exclusion tests verifying dynamic denominator re-normalization (AC 3, AC 6).
  - [x] Build 24-hour synthetic dataset verifying correct Tier A/B/C assignment across multiple scrapers (AC 5, AC 6).
  - [x] Run complete benchmark test suite to verify 0 regressions (AC 6).

---

### Review Findings

- [x] [Review][Patch] Pass all non-nullable schema columns (platform, stabilityScore, qualityScore, noiseScore, costScore, sampleCount) to prisma.scraperHealthScore.create [src/benchmark/state-manager.js:142]
- [x] [Review][Patch] Fix false_200_rate calculation to divide by total2xxRequests instead of totalRequests [src/benchmark/scoring-engine.js:335]
- [x] [Review][Patch] Fix zero-item proxy_bytes_per_1k fallback to 500MB (score 0) instead of 50MB (score 100) [src/benchmark/scoring-engine.js:338]
- [x] [Review][Patch] Enforce AD-31 State Machine: prevent premature promotion from Tier C until 5 consecutive clean runs [src/benchmark/state-manager.js:125]
- [x] [Review][Patch] Fix storeMetrics missing fallback: do not award 100% quality on aborted/unsuccessful runs [src/benchmark/scoring-engine.js:320]
- [x] [Review][Patch] Fix clamp(undefined) producing NaN by validating Number.isFinite [src/benchmark/scoring-engine.js:114]
- [x] [Review][Patch] Guard evaluateKnockoutGates and calculateScores against null/undefined arguments [src/benchmark/scoring-engine.js:150]
- [x] [Review][Patch] Use nullish coalescing for requestCount and avgLatencyMs to handle numeric zero [src/benchmark/scoring-engine.js:301]
- [x] [Review][Patch] Add tests for non-knockout score < 70, zero-item proxy cost, and Prisma contract validation [tests/benchmark/scoring-engine.test.js:310]

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-5[1m]

### Implementation Plan
1. Viết tests trước cho `safe-ratio.js` và `scoring-engine.js` (TDD Red Phase).
2. Tạo `src/utils/safe-ratio.js` với fallback an toàn.
3. Tạo `src/benchmark/scoring-engine.js` triển khai đầy đủ các công thức chuẩn hóa, knock-out gates, profiles ngành.
4. Tạo `src/benchmark/state-manager.js` cài đặt single-writer state machine và epoch `requalifiedAt`.
5. Tạo `tests/benchmark/scoring-engine.test.js` với dataset 24h giả lập.
6. Chạy vitest và tối ưu hóa hiệu năng (Green & Refactor Phase).

### Debug Log References
- Cài đặt `safeRatio(num, den, fallback)` tại `src/utils/safe-ratio.js`, xử lý mọi trường hợp zero division, null, undefined, NaN mà không ném lỗi.
- Triển khai `BenchmarkScoringEngine` (`src/benchmark/scoring-engine.js`) với công thức 4 trụ cột (Stability 0.35, Quality 0.30, Noise 0.20, Cost 0.15), hàm nội suy `normalizeMetric` cho cả chỉ số dương và nghịch đảo, loại trừ chỉ số theo `CATEGORY_EXCLUSIONS` và tái chuẩn hóa mẫu số.
- Triển khai 4 hard knock-out gates (True Success < 80%, Field Fill < 85%, False 200 > 15%, Schema Integrity < 90%) đánh giá trước composite score để ép xuống Tier C.
- Cài đặt `BenchmarkStateManager` (`src/benchmark/state-manager.js`) làm single writer duy nhất cập nhật `ScraperHealthScore`, `hash:scraper:health_tier` và `healthTierCache`, đồng thời lọc dữ liệu cũ hơn `requalifiedAt` epoch.
- Áp dụng 9 bản vá code review: truyền đầy đủ các cột bắt buộc vào Prisma `ScraperHealthScore`, sửa mẫu số `false_200_rate` theo `total2xxRequests`, sửa fallback proxy bytes trên 0-item run thành 500MB (score 0), áp dụng máy trạng thái AD-31 (cần 5 clean runs để promote C -> B), sửa `clamp(undefined)` và các guard null/undefined.
- Xây dựng 22 unit & synthetic dataset tests trong `tests/benchmark/scoring-engine.test.js`, toàn bộ 107 tests benchmark và 629 tests client/http-scraper đều pass 100%.

### Completion Notes List
- 100% Acceptance Criteria (AC 1 -> AC 6) đã được hoàn thành.
- Công thức nội suy tuyến tính và knock-out gates hoạt động chính xác theo `metrics-catalog.md` và `AD-26`.
- Profile ngành loại trừ chỉ số N/A và tái chuẩn hóa trọng số theo `AD-28`.
- Single writer state machine và epoch filtering triển khai đúng theo `AD-31`, `AD-32`.
- Thời gian thực thi cho toàn bộ 5 scraper 24-hour rollups chỉ mất ~5ms (< 500ms theo NFR).

### File List
- `src/utils/safe-ratio.js` (NEW)
- `src/benchmark/scoring-engine.js` (NEW)
- `src/benchmark/state-manager.js` (NEW)
- `tests/benchmark/scoring-engine.test.js` (NEW)
- `_bmad-output/implementation-artifacts/stories/34-4-benchmark-scoring-engine.md` (UPDATE)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (UPDATE)

### Change Log
- 2026-09-08: Hoàn tất toàn diện Phase 1 đến Phase 4 của Story 34.4, áp dụng toàn bộ 9 bản vá review và nghiệm thu thành công.

### Status
done
