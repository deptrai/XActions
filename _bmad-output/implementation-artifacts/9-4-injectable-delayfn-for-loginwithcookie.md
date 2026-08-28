---
baseline_commit:
---

# Story 9.4: Injectable delayFn for loginWithCookie

Status: ready-for-dev

## Story

As a developer,
I want `loginWithCookie` to accept an injectable `delayFn`,
So that tests run fast and avoid flaky timeouts in parallel suites.

## Acceptance Criteria

1. **Given** `loginWithCookie(page, cookies, { delayFn: async () => {} })`
2. **When** the function runs
3. **Then** all internal random delays use the provided `delayFn`
4. **And** the default behavior remains unchanged when `delayFn` is not provided

5. **Given** a test passes `delayFn: async () => {}`
6. **When** `loginWithCookie` is called
7. **Then** the test completes without real `setTimeout` delays

## Implementation Note

Relates to PCR5. The `delayFn` seam should be passed through `loginWithCookie` and any internal wait helpers it calls.
