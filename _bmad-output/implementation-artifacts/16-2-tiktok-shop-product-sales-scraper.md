---
baseline_commit:
---

# Story 16.2: TikTok Shop Product & Sales Scraper

Status: ready-for-dev

## Story

As a TikTok Affiliate & Merchant,
I want to scrape top-selling products and affiliate commissions on TikTok Shop,
So that I can discover winning products for ad campaigns.

## Acceptance Criteria

1. **Given** `TikTokShopCrawler` in `src/scrapers/ecom/tiktok-shop/index.js` extends `AbstractCrawler`
2. **When** calling `getTopSellingProducts(category)`
3. **Then** the crawler fetches data via Web API with dynamic signing from the Signer Pool
4. **And** it extracts price, sales, and shop rating and saves to PostgreSQL

## Implementation Note

Legacy TikTok Shop scraper exists in `nowing_backend/app/proprietary/platforms/tiktok-shop/`. This story ports/adapts it to the `AbstractCrawler` + `AbstractApiClient` architecture.
