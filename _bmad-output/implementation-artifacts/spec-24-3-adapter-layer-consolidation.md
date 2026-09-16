---
title: 'Story 24.3 — Adapter Layer Consolidation'
type: 'chore'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
baseline_commit: 'd5c6dc25'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `src/scrapers/adapters/` contained 8 adapters but only 3 were actually used. The registry had 12 registrations including aliases for archived adapters.

**Approach:** Consolidate to essential adapters (base, puppeteer, playwright, http) and clean up registry registrations. This work was completed as part of Story 24.4 (archive unused modules).

## Boundaries & Constraints

**Always:**
- Keep `base.js` (contract), `puppeteer.js` (default), `playwright.js` (alternative), `http.js` (HTTP-only)
- Remove registrations for archived adapters (selenium, cheerio, crawlee, got-jsdom)
- Verify `npm run typecheck` passes

**Never:**
- KHÔNG xóa `http.js` — referenced in `browser.js` adapter option
- KHÔNG break `getAdapter()` or `listAdapters()` API

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| listAdapters | After consolidation | `['puppeteer', 'playwright', 'http', 'pw', 'pptr']` | N/A |
| getAdapter | `getAdapter('puppeteer')` | Returns PuppeteerAdapter instance | N/A |
| getAdapter | `getAdapter('playwright')` | Returns PlaywrightAdapter instance | N/A |
| getAdapter | `getAdapter('http')` | Returns HttpAdapter instance | N/A |
| Archived adapter | `getAdapter('selenium')` | Throws error (not registered) | N/A |

</frozen-after-approval>

## Code Map

- `src/scrapers/adapters/index.js` — Registry with 5 registrations (was 12)
- `src/scrapers/adapters/base.js` — BaseAdapter contract (kept)
- `src/scrapers/adapters/puppeteer.js` — Puppeteer adapter (kept)
- `src/scrapers/adapters/playwright.js` — Playwright adapter (kept)
- `src/scrapers/adapters/http.js` — HTTP adapter (kept)
- `archive/scrapers/adapters/` — Archived: selenium.js, cheerio.js, crawlee.js, got-jsdom.js

## Tasks & Acceptance

**Execution:**
- [x] `src/scrapers/adapters/index.js` — Remove 7 registrations (cheerio, crawlee, got-jsdom, selenium, got, jsdom, apify)
- [x] Verify `listAdapters()` returns only 5 adapters
- [x] Verify `npm run typecheck` passes (0 errors in modified files)

**Acceptance Criteria:**
- Given consolidated adapters, when call `listAdapters()`, then returns `['puppeteer', 'playwright', 'http', 'pw', 'pptr']`
- Given archived adapter, when call `getAdapter('selenium')`, then throws error (not registered)
- Given `npm run typecheck`, when run, then 0 errors in modified files

## Implementation Notes

- Completed as part of Story 24.4 (archive unused modules)
- `adapters/index.js` reduced from 12 registrations to 5
- All archived adapters moved to `archive/scrapers/adapters/`
- `http.js` kept despite 0 imports — referenced in `browser.js` adapter option

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Design Notes

**Rationale:** Story 24.4 already archived the unused adapters and cleaned up the registry. This spec documents the completed work for Epic 24 tracking.

## Verification

**Commands:**
- `npm run typecheck` — expected: 0 errors in modified files
- `node -e "import('./src/scrapers/adapters/index.js').then(m => console.log(m.listAdapters()))"` — expected: `['puppeteer', 'playwright', 'http', 'pw', 'pptr']`
