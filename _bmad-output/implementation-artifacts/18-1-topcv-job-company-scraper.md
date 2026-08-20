---
baseline_commit:
---

# Story 18.1: TopCV Job & Company Scraper

Status: ready-for-dev

## Story

As an HR Tech Recruiter,
I want to scrape job postings, required skills, and salary ranges on TopCV,
So that I can track Vietnam IT and finance hiring trends.

## Acceptance Criteria

1. **Given** `TopCvCrawler` in `src/scrapers/recruitment/topcv/index.js` extends `AbstractCrawler`
2. **When** calling `searchJobs(keyword)`
3. **Then** the crawler fetches job postings and safely parses salary ranges (including "Thỏa thuận")
4. **And** it stores normalized `PostItem` data (`platform: 'topcv'`, `category: 'recruitment'`, `metadata: { salaryMin, salaryMax, skills }`)

## Implementation Note

Legacy TopCV scraper exists in `nowing_backend/app/proprietary/platforms/topcv/`. This story ports/adapts it to the `AbstractCrawler` + `AbstractApiClient` architecture.
