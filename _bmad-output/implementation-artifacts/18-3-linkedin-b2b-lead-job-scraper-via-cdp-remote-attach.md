---
baseline_commit:
---

# Story 18.3: LinkedIn B2B Lead & Job Scraper via CDP Remote Attach

Status: backlog

## Story

As a B2B Sales Director,
I want to scrape company and key-people information on LinkedIn via CDP Remote Attach with Gaussian jitter (3–7s),
So that I can build high-quality B2B lead lists without account locks.

## Acceptance Criteria

1. **Given** `LinkedInCrawler` in `src/scrapers/recruitment/linkedin/index.js` extends `AbstractCrawler`
2. **When** connecting via CDP Remote Attach (port 9222) to the user's real Chrome
3. **Then** the crawler uses the existing LinkedIn session to scrape profile, title, and company info
4. **And** it applies Gaussian random delay (3–7s) and checks for checkpoint challenge screens
5. **And** it stores data to PostgreSQL

## Implementation Note

Blocked by Epic 12.2 (CDP Remote Attach). Legacy LinkedIn scraper may exist in `nowing_backend/app/proprietary/platforms/linkedin/`. This story ports/adapts it to the `AbstractCrawler` + CDP architecture.
