---
title: "Story 45.4: jev-backtest — Validate Predictions vs Actual Performance"
created: 2026-09-23
status: ready-for-dev
epic: 45
story: 45.4
---

# Story 45.4: jev-backtest

## User Story

As a data-driven growth operator,
I want to validate whether viral DNA predictions actually correlate with real engagement per platform,
So that I can trust (or calibrate) the viral stats before relying on them for content strategy.

## Acceptance Criteria

### AC1: Fetch Own Posts
- **Given** viral stats exist and I have posted content in the target platform+niche
- **When** I run `xactions backtest --platform {platform} --niche {niche} --days {days}`
- **Then** system fetches my posts from the last {days} days via platform-appropriate scraper

### AC2: Viral DNA Extraction
- **Given** own posts fetched
- **When** analyzing
- **Then** for each post, extracts viral DNA attributes (via cached Jev results or re-classification)

### AC3: Metrics Calculation
- **Given** predicted vs actual comparison
- **When** calculating metrics
- **Then** computes:
  - precision: of posts predicted "high viral", what % actually hit top quartile engagement
  - recall: of actual top-performing posts, what % were predicted "high viral"
  - accuracyByHookType: { [hookType]: { predicted, actual, accuracy } }
  - platformBreakdown: { [platform]: { precision, recall, sampleSize } }

### AC4: Report Output
- **Given** metrics calculated
- **When** generating report
- **Then** outputs to `data/backtest-reports/{category}-{platform}-{niche}-{date}.json`
- **And** prints summary: "Backtest complete: 73% precision, 45% recall. Assertion hooks: 89% accurate on Twitter."

### AC5: Insufficient Data Handling
- **Given** insufficient own posts for backtest (<10 in period)
- **When** backtest runs
- **Then** warns and suggests extending `--days` or mining competitor posts for calibration

## Technical Implementation

### Files
- `src/analytics/jevBacktest.js` — main implementation (✅ created)
- `src/filters/jevFilter.js` — viral score calculation (✅ created)
- `src/analytics/viralStatsStore.js` — stats loading (✅ created)

### API
- `POST /api/viral/backtest` — trigger backtest
- `GET /api/viral/backtest/:reportId` — get report

### CLI
```bash
xactions backtest --platform twitter --niche web3 --days 7
xactions backtest --platform linkedin --niche saas --days 30
```

## Test Plan

### Unit Tests
- `tests/analytics/jevBacktest.test.js`
  - `calculateMetrics()` precision/recall
  - `groupByHookType()` grouping
  - `runBacktest()` insufficient data handling
  - Report generation

### Integration Tests
- Mock viral stats + own posts → run backtest → verify metrics
- Verify report file output

### E2E Tests
- `xactions viral-mine` → `xactions backtest` → verify report generated
