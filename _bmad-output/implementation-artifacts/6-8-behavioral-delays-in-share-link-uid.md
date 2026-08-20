---
baseline_commit: (implemented in Story 5b.2)
---

# Story 6.8: Behavioral Delays in Share-Link-UID

Status: done

## Story

As a Messenger campaign operator,
I want `shareLinkByUid` to use human-like delays between UI interactions,
So that mass-share campaigns do not trigger bot detection.

## Acceptance Criteria

1. `shareLinkByUid` accepts an injectable `delay(min, max)` function.
2. Delays are applied between navigation, focus, paste, and send actions.
3. Default delay ranges vary by headless mode and are conservative enough for mass messaging.

## Implementation Note

Implemented in `src/scrapers/facebook/shareLinkByUid.js` (Story 5b.2). Uses `delay` parameter with ranges: 1500ms–12000ms depending on the step.
