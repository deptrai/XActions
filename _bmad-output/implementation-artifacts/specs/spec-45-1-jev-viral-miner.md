---
title: "Story 45.1: jev-viral-miner — Universal Corpus Scraping & Jev Batch Classification"
created: 2026-09-23
status: ready-for-dev
epic: 45
story: 45.1
---

# Story 45.1: jev-viral-miner

## User Story

As a growth hacker / content strategist / market analyst,
I want to scrape a large corpus of posts from my niche on any supported platform and classify each post's viral DNA attributes via Jev,
So that I can discover which content patterns actually drive virality per platform instead of guessing.

## Acceptance Criteria

### AC1: Platform Detection & Scraper Selection
- **Given** I have configured XActions scrapers and a niche keyword
- **When** I run `xactions viral-mine --platform {platform} --niche {niche} --count {count}`
- **Then** the system detects platform category and uses appropriate scraper:
  - Social: `twitter`, `threads`, `facebook`, `tiktok`, `youtube`, `reddit`, `instagram`, `bluesky`, `mastodon`, `medium`, `zalo`
  - Recruitment: `linkedin`, `topcv`, `vietnamworks`
  - Real Estate: `chotot`, `batdongsan`
  - E-Commerce: `shopee`, `tiktok-shop`
- **And** calls the platform's search method (see Platform Registry)

### AC2: Corpus Scraping
- **Given** valid platform and niche
- **When** scraping begins
- **Then** system scrapes up to {count} posts matching the niche
- **And** respects `scraperConcurrency` (default 3) and `scraperDelay` (default 2000ms)
- **And** logs progress every 100 posts

### AC3: Jev Batch Classification
- **Given** posts scraped successfully
- **When** classification runs
- **Then** for each post, calls Jev with platform-specific question set (10-14 questions)
- **And** uses `JevBrain.batchDecide()` with `jevConcurrency` (default 10)
- **And** joins Jev answers with engagement metrics into `PostViralProfile[]`

### AC4: Cost Tracking
- **Given** batch classification in progress
- **When** processing
- **Then** tracks estimated cost: `posts × 14 × $0.00000048`
- **And** warns if projected cost > $0.10 per 10k posts

### AC5: Output Persistence
- **Given** classification complete
- **When** saving results
- **Then** saves to `data/viral-corpus/{category}-{platform}-{niche}-{timestamp}.json`
- **And** returns `MiningResult` with `outputPath`, `durationMs`, `cost`

### AC6: Error Handling
- **Given** Jev API unavailable/degraded
- **When** classification runs
- **Then** falls back to heuristic scoring, marks `jevDegraded: true`
- **Given** platform not supported
- **When** mining attempted
- **Then** returns error with available platforms list

## Technical Implementation

### Files
- `src/analytics/jevViralMiner.js` — main implementation (✅ created)
- `src/analytics/platformQuestions.js` — platform question sets (✅ created)
- `src/agents/jevBrain.js` — added `batchDecide()` (✅ updated)

### Dependencies
- Epic 34: Scrapers (all 18 platforms)
- Epic 42: JevBrain gateway

### API
- `POST /api/viral/mine` — trigger job
- `GET /api/viral/mine/:jobId` — status

### CLI
```bash
xactions viral-mine --platform twitter --niche web3 --count 1000
xactions viral-mine --platform linkedin --niche saas --count 500
xactions viral-mine --platform chotot --niche "apartment-hanoi" --count 200
```

## Test Plan

### Unit Tests
- `tests/analytics/jevViralMiner.test.js`
  - `normalizeNiche()` edge cases
  - `estimateCost()` calculations
  - `getScraper()` platform mapping
  - Error handling for invalid platform

### Integration Tests
- Mock scraper returns posts
- Mock JevBrain returns classifications
- Verify PostViralProfile structure
- Verify file output path

### E2E Tests
- `xactions viral-mine --platform twitter --niche test --count 10` (dry run)
- Verify output file created
- Verify cost estimation logged
