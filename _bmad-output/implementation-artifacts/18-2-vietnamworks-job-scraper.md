---
baseline_commit:
---

# Story 18.2: VietnamWorks Job Scraper

Status: ready-for-dev

## Story

As a Headhunter,
I want to scrape mid- and senior-level job postings on VietnamWorks,
So that I can find recruitment opportunities for candidates.

## Acceptance Criteria

1. **Given** `VietnamWorksCrawler` in `src/scrapers/recruitment/vietnamworks/index.js` extends `AbstractCrawler`
2. **When** calling `searchJobs({ keyword, city })`
3. **Then** the scraper calls VietnamWorks public API to fetch job list and detailed JD
4. **And** it refreshes the public guest token automatically on 401

## Implementation Note

Legacy VietnamWorks scraper exists in `nowing_backend/app/proprietary/platforms/vietnamworks/`. This story ports/adapts it to the `AbstractCrawler` + `AbstractApiClient` architecture.
