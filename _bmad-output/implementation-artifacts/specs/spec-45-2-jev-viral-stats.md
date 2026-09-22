---
title: "Story 45.2: jev-viral-stats — Stats Aggregation & Storage"
created: 2026-09-23
status: ready-for-dev
epic: 45
story: 45.2
---

# Story 45.2: jev-viral-stats

## User Story

As a data analyst,
I want the raw viral profiles aggregated into actionable statistics per platform,
So that I can query "which hook type performs best on LinkedIn for SaaS niche" or "what price range works best for Chợ Tốt listings" without re-processing raw data.

## Acceptance Criteria

### AC1: Stats Aggregation
- **Given** a `PostViralProfile[]` corpus has been generated (from Story 45.1)
- **When** I run stats aggregation (auto-triggered after mining OR via `xactions viral-stats --platform {platform} --niche {niche}`)
- **Then** the system computes `ViralStats`:
  - platform: string (18 supported platforms)
  - category: string (social|recruitment|realestate|ecom)
  - niche: string
  - sampleSize: number
  - generatedAt: ISO timestamp
  - viralRateThreshold: number (top 10% engagement)
  - hookTypeDistribution: { [hookType]: { count, avgEngagement, viralRate } }
  - topPerformingPatterns: Array<{ attributes: {}, avgEngagement, count }>
  - attributeCorrelations: { [attribute]: correlationScore }
  - platformSpecificMetrics: { [platformAttr]: { distribution, avgEngagement } }
  - categoryInsights: cross-platform comparison within same category

### AC2: Schema Validation
- **Given** computed stats object
- **When** validating
- **Then** passes Zod schema `ViralStatsSchema`

### AC3: File Persistence
- **Given** validated stats
- **When** saving
- **Then** persists to `data/viral-stats/{category}-{platform}-{niche}-{date}.json`
- **And** maintains `data/viral-stats/latest-{platform}-{niche}.json` symlink

### AC4: Error Handling
- **Given** corpus file missing or corrupted
- **When** stats aggregation runs
- **Then** throws descriptive error and exits gracefully
- **Given** multiple mining runs for same platform+niche
- **When** stats generated
- **Then** uses most recent corpus file

## Technical Implementation

### Files
- `src/analytics/viralStatsStore.js` — main implementation (✅ created)

### API
- `GET /api/viral/stats/:platform/:niche` — get latest stats
- `GET /api/viral/stats` — list all stats

### CLI
```bash
xactions viral-stats --platform twitter --niche web3
xactions viral-stats --list
```

## Test Plan

### Unit Tests
- `tests/analytics/viralStatsStore.test.js`
  - `aggregateStats()` calculation correctness
  - `calculateEngagement()` weights
  - `calculateViralThreshold()` top 10%
  - Schema validation
  - File save/load

### Integration Tests
- Load corpus → aggregate → save → verify output
- Load stats → verify structure

### E2E Tests
- `xactions viral-mine` then `xactions viral-stats` → verify stats generated
