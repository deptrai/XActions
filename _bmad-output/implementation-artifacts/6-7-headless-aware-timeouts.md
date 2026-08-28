---
baseline_commit: (implemented in Story 5b.3)
---

# Story 6.7: Headless-Aware Timeouts

Status: done

## Story

As a developer,
I want navigation and wait timeouts to adapt based on headless mode,
So that visible debug sessions get more time and headless sessions stay fast.

## Acceptance Criteria

1. When `headless: true`, navigation uses `networkidle2` and 30s timeout.
2. When `headless: false`, navigation uses `domcontentloaded` and 60s timeout.
3. The selected wait strategy and timeout are applied consistently across `loginWithCookie`.

## Implementation Note

Implemented in `src/scrapers/facebook/index.js` (Story 5b.3). `navTimeout` and `navWaitUntil` are computed from `headless` flag.
