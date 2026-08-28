---
baseline_commit: (implemented in Story 5b.4)
---

# Story 6.1: Chrome executablePath Auto-Resolution

Status: done

## Story

As a developer,
I want `createBrowser()` to automatically resolve the Chrome executable path,
So that XActions runs on environments without hardcoding Chrome locations.

## Acceptance Criteria

1. `createBrowser()` accepts an explicit `executablePath` option.
2. If omitted, it falls back to `PUPPETEER_EXECUTABLE_PATH` env var.
3. If env var missing, it searches common system Chrome paths.
4. Otherwise it uses the puppeteer default.

## Implementation Note

Implemented in `src/scrapers/facebook/index.js` (Story 5b.4). Resolution chain:
`options.executablePath` → `PUPPETEER_EXECUTABLE_PATH` → system Chrome → puppeteer default.
