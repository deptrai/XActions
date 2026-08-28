---
baseline_commit:
---

# Story 17.1: Chợ Tốt Multi-Category Scraper with Phone Mask Detector

Status: ready-for-dev

## Story

As a Real Estate Broker / Lead Generator,
I want to scrape real-estate listings on Chợ Tốt including unmasked phone numbers,
So that Nowing AI Lead Hub receives 100% high-quality owner phone numbers.

## Acceptance Criteria

1. **Given** `ChototCrawler` in `src/scrapers/realestate/chotot/index.js` extends `AbstractCrawler`
2. **When** calling `searchListings({ category: 'nha-dat', region: 'tp-ho-chi-minh' })`
3. **Then** the scraper calls the Chợ Tốt API gateway to fetch listings and phone-decode endpoint
4. **And** it drops masked phone numbers containing `*` or not matching Vietnamese phone regex
5. **And** it saves listing with phone to `Post.metadata` in PostgreSQL and emits a thin event to Nowing

## Implementation Note

Legacy Chợ Tốt scraper exists in `nowing_backend/app/proprietary/platforms/chotot/`. This story ports/adapts it to the `AbstractCrawler` + `AbstractApiClient` architecture.
