---
baseline_commit:
---

# Story 11.7: Crawler–Governor Integration & Platform Response Validator Contract

Status: ready-for-dev

## Story

As a Platform Scraper Developer,
I want `AbstractCrawler` to check the governor before every action and an `AbstractPlatformResponseValidator` contract so scraper subclasses can implement platform-specific bot-detection logic,
So that each platform defines its own valid payload, WAF, and rate-limit signals without cluttering core code.

## Acceptance Criteria

1. **Given** `AbstractCrawler` is extended in `src/core/base-crawler.js`
   - **When** `start(command)` is called
   - **Then** the crawler calls `governor.recordRequest()` and checks `governor.canAccountRequest()` / `governor.getMaxThroughput(platform)` before each action.

2. **Given** `src/core/platform-validator.js` defines `AbstractPlatformResponseValidator`
   - **Then** it declares `isValidPayload(response)`, `isBotChallenge(response)`, and `isRateLimit(response)`.

3. **Given** at least two scraper subclasses (Twitter, Facebook)
   - **Then** each implements its own `PlatformResponseValidator`.

## Implementation Notes

- `AbstractCrawler` should accept `governor` in constructor options (defaulting to `global` or a no-op).
- Before each action, call `governor.canAccountRequest(accountId, platform)`. If false, throw `RateLimitError` or rotate account.
- After a successful request, call `governor.recordRequest({ accountId, platform, ... })`.
- Subclasses inject a `PlatformResponseValidator` to interpret raw responses and map them to `PlatformError`, `RateLimitError`, or `BotChallengeError`.
