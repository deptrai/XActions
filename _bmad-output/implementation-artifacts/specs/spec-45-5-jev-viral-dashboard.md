---
title: "Story 45.5: jev-viral-dashboard — Web UI for Universal Viral DNA Mining"
created: 2026-09-23
status: ready-for-dev
epic: 45
story: 45.5
---

# Story 45.5: jev-viral-dashboard

## User Story

As a non-technical growth operator,
I want a web dashboard to run viral mining across all platforms, view stats, and see backtest results,
So that I don't need to use CLI commands.

## Acceptance Criteria

### AC1: Mining Form
- **Given** Epic 45 backend stories (45.1-45.4) are complete
- **When** I navigate to `/dashboard/viral-miner.html`
- **Then** I see:
  - Category selector: Social | Recruitment | Real Estate | E-Commerce
  - Platform selector: dropdown filtered by category
  - Niche input: text field with autocomplete
  - Count slider: 100-10000
  - "Run Mining" button
  - Progress indicator: posts processed, Jev calls, estimated cost, elapsed time

### AC2: Real-time Progress
- **Given** viral mining is running
- **When** I view the progress section
- **Then** I see real-time updates via polling (every 5s)
- **And** a "Cancel" button to abort

### AC3: Results Display
- **Given** mining is complete
- **When** results load
- **Then** I see:
  - Bar chart of `hookTypeDistribution` (hook types on X, viralRate% on Y)
  - "Top Patterns" list: top 5 attribute combinations
  - "Run Backtest" button
  - "Compare Platforms" tab

### AC4: Backtest Report
- **Given** backtest results exist
- **When** I click "View Backtest Report"
- **Then** I see precision/recall metrics, accuracy by hook type, platform breakdown

### AC5: Empty State
- **Given** no viral stats exist for selected platform+niche
- **When** I load the page
- **Then** I see "No data yet" with CTA to run first mining job

## Technical Implementation

### Files
- `dashboard/viral-miner.html` — main page
- `dashboard/js/viral-miner.js` — frontend logic
- `api/routes/viral.js` — API endpoints (✅ created)

### API Endpoints Used
- `POST /api/viral/mine` — start job
- `GET /api/viral/mine/:jobId` — poll status
- `GET /api/viral/stats/:platform/:niche` — load stats
- `POST /api/viral/backtest` — run backtest
- `GET /api/viral/platforms` — list platforms

## Test Plan

### Unit Tests
- `tests/dashboard/viral-miner.test.js` — form logic, API calls

### Integration Tests
- Mock API responses → verify UI updates
- Test polling logic

### E2E Tests
- Navigate to page → fill form → run mining → verify results display
