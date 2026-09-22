---
title: "Story 45.3: jev-content-intel — Feed Stats vào Content Generation"
created: 2026-09-23
status: ready-for-dev
epic: 45
story: 45.3
---

# Story 45.3: jev-content-intel

## User Story

As a content creator using XActions,
I want content generation to leverage viral DNA stats from my niche on the target platform,
So that generated content follows proven viral patterns rather than generic templates.

## Acceptance Criteria

### AC1: Tweet Generator Integration
- **Given** `viralStats` exists for platform+niche and `USE_VIRAL_INTEL=true`
- **When** `tweetGenerator.generate({ platform: "linkedin", niche: "saas", topic: "AI agents" })` is called
- **Then** system loads latest `viral-stats-{category}-{platform}-{niche}.json`
- **And** injects into prompt context: "Viral DNA insights for LinkedIn/SaaS: data-driven hooks (3.1% viral), personalStory (1.8%), buzzword-heavy (0.4%). Top pattern: {attributes}. Optimize for these patterns."
- **And** LLM generates content informed by platform-specific viral stats

### AC2: Variant Judge Score Boost
- **Given** `jevVariantJudge` evaluates multiple content variants
- **When** `viralStats` is provided for target platform
- **Then** variants matching top-performing patterns get +0.2 score boost in evaluation

### AC3: Live Feed Prioritizer
- **Given** `jevFilter` processes live timeline/feed on any platform
- **When** `viralStats` is available for that platform
- **Then** posts matching high-viral-rate patterns are ranked higher in reply/engage priority queue

### AC4: Fallback Behavior
- **Given** `USE_VIRAL_INTEL=false` or no viral stats exist for platform+niche
- **When** any content generation runs
- **Then** system falls back to default behavior without viral intel injection

## Technical Implementation

### Files
- `src/ai/tweetGenerator.js` — inject viral stats into prompt (needs modification)
- `src/ai/jevVariantJudge.js` — add viral score boost (needs modification)
- `src/filters/jevFilter.js` — live feed prioritizer (✅ created)
- `src/analytics/viralStatsStore.js` — stats loading (✅ created)

### Config
- `USE_VIRAL_INTEL` env var (default: false)

### API
- Content generation endpoints use viral stats when enabled

## Test Plan

### Unit Tests
- `tests/ai/tweetGenerator.test.js` — viral stats injection
- `tests/ai/jevVariantJudge.test.js` — score boost
- `tests/filters/jevFilter.test.js` — prioritization

### Integration Tests
- Generate content with viral stats → verify prompt contains insights
- Judge variants with viral stats → verify score boost applied

### E2E Tests
- Enable `USE_VIRAL_INTEL` → generate tweet → verify viral pattern in output
