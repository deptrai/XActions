---
baseline_commit:
---

# Story 17.2: Batdongsan.com.vn Property Scraper

Status: ready-for-dev

## Story

As an Investor,
I want to scrape property listings and land prices on Batdongsan.com.vn,
So that I can track market fluctuations by district.

## Acceptance Criteria

1. **Given** `BatdongsanCrawler` in `src/scrapers/realestate/batdongsan/index.js` extends `AbstractCrawler`
2. **When** calling `scrapeCategory(url)`
3. **Then** the scraper fetches data via HTTP Client with UA rotation and Proxy Pool
4. **And** it extracts area, price/m², location, and saves to `Post.metadata` in PostgreSQL

## Implementation Note

Legacy Batdongsan scraper exists in `nowing_backend/app/proprietary/platforms/batdongsan/`. This story ports/adapts it to the `AbstractCrawler` + `AbstractApiClient` architecture.
