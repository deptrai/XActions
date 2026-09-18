# Technical Specification: Story 37.1 — Engine Telemetry & Adapter Registry Fix

**Story:** 37.1 (Epic 37: Lightweight Zero-Browser Engine)  
**Author:** Winston (System Architect)  
**Status:** done  
**Date:** 2026-09-18  
**Scope:** Rescoped from original "Platform-Static Routing" to minimal viable implementation.

---

## 1. Bối cảnh & Rescope Decision

Original Epic 37 scope (Platform-Static Routing via `engineTier` + `got-jsdom`) was found to be **architecturally redundant** during adversarial review (3-agent consensus: QA, Dev, Architect). The `DESCRIPTORS` registry + `AbstractApiClient` + `got` already achieves zero-browser routing for all lightweight platforms.

**Rescoped deliverable:** Document the existing two-tier reality, fix adapter registry gap, and add observability metadata — no new routing layer.

## 2. Changes Implemented

### 2.1. Register `got-jsdom` adapter (`src/scrapers/adapters/index.js`)
```javascript
registerBuiltin('got-jsdom', () => import('./got-jsdom.js'));
```
Fixes the gap where `GotJsdomAdapter` existed but was absent from the adapter registry, causing `getAdapter('got-jsdom')` to throw `Unknown scraper adapter` and breaking `getAvailableAdapter()` fallback chain.

### 2.2. Engine telemetry metadata (`src/core/base-crawler.js`)
```javascript
// Injected at end of AbstractCrawler.start() before return
if (result && typeof result === 'object' && !Array.isArray(result)) {
  resultObj._metadata = {
    engineUsed: baseClient?.requiresBrowser === false ? 'http' : 'browser',
    durationMs: Date.now() - startTime,
    platform: this.name,
    action: command.action,
  };
}
```
Every `scrape()` result now carries `_metadata.engineUsed` (`'http'` for `AbstractApiClient`-based lightweight platforms, `'browser'` for Puppeteer/CDP-backed stealth platforms) and `_metadata.durationMs` for observability.

### 2.3. AD-43 Invariant documented (`docs/architecture.md`)
Added Architecture Decision Record documenting that lightweight platforms are HTTP-first by design — no `engineTier` flag needed because `DESCRIPTORS` + `AbstractApiClient` already provides correct routing.

## 3. What Was NOT Changed (Anti-Duplicate)

- No `engineTier` field added to `DESCRIPTORS` or `PROFILE_ACTION_MAP` — would create parallel routing layer.
- No platforms migrated to `GotJsdomAdapter` — `AbstractApiClient` + `got` is strictly superior (has proxy support, retry logic, error classification).
- No changes to `scrape()` dispatch logic — `DESCRIPTORS` routing is already correct.

## 4. Acceptance Criteria

- [x] AC-1: `getAdapter('got-jsdom')` instantiates successfully.
- [x] AC-2: Every `AbstractCrawler.start()` result includes `_metadata.engineUsed` (`'http'` or `'browser'`).
- [x] AC-3: Every result includes `_metadata.durationMs` (non-negative integer).
- [x] AC-4: Array results (e.g., `PostItem[]`) do not get `_metadata` injected (preserves backward compat).
- [x] AC-5: All existing tests continue to pass.
