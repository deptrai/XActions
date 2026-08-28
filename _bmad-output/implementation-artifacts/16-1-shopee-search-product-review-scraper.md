---
baseline_commit:
---

# Story 16.1: Shopee Search, Product & Review Scraper with TLS Spoofing

Status: ready-for-dev

## Story

As an E-Commerce Merchant / Data Analyst,
I want to scrape Shopee Vietnam product categories, flash sales, prices, and reviews via TLS spoofing,
So that I can analyze competitors without being blocked by Akamai WAF.

## Acceptance Criteria

1. **Given** `ShopeeCrawler` in `src/scrapers/ecom/shopee/index.js` extends `AbstractCrawler`
2. **When** calling `searchProducts(keyword)` or `getProductReviews(itemid, shopid)`
3. **Then** the crawler calls Shopee Web Search API via `got-scraping` (TLS/JA4 spoofing) and `ProxyIpPool`
4. **And** it detects anti-bot captcha code `90309999` and auto-rotates proxy on challenge
5. **And** it stores normalized `PostItem` data (`platform: 'shopee'`, `category: 'ecom'`, `metadata: { price, soldCount, rating }`)

## Implementation Note

Legacy Shopee scraper exists in `nowing_backend/app/proprietary/platforms/shopee/`. This story ports/adapts it to the `AbstractCrawler` + `AbstractApiClient` architecture.
