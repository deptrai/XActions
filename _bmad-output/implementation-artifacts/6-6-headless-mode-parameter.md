---
baseline_commit: (implemented in Story 5b.3)
---

# Story 6.6: Headless Mode Parameter

Status: done

## Story

As a multi-account operator,
I want to control headless vs visible browser mode per session,
So that I can debug with a visible browser and run production headless.

## Acceptance Criteria

1. `createBrowser()` and `loginWithCookie()` accept a `headless` boolean option.
2. `headless: true` (default) launches invisible browser.
3. `headless: false` launches visible browser.
4. The selected mode is returned in response metadata.

## Implementation Note

Implemented in `src/scrapers/facebook/index.js` (Story 5b.3). `headless` defaults to `'new'` and is configurable via `options.headless`.
