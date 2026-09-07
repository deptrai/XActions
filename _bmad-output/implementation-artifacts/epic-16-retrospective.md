# Epic 16 Retrospective: E-Commerce Multi-Platform Scrapers (Shopee & TikTok Shop)

Status: done  
Date: 2026-09-08

## Summary

Epic 16 implement **e-commerce scrapers** cho Shopee và TikTok Shop — 2 nền tảng lớn nhất tại Đông Nam Á.

Epic complete across two stories:

| Story | Status | Outcome |
|---|---|---|
| 16.1 Shopee Search/Product/Review Scraper + TLS Spoofing | done | `ShopeeCrawler` với `got-scraping` TLS/JA4 |
| 16.2 TikTok Shop Product/Sales Scraper | done | `TikTokShopCrawler` |

## What Went Well

1. **Shopee TLS spoofing**
   - Shopee chặn HTTP client thuần — `undici`/`got` bị 403.
   - `got-scraping` với TLS/JA4 fingerprint bypass được.

2. **TikTok Shop scraper**
   - Product listings, sales data, shop info.

## What Was Difficult

1. **Shopee anti-bot rất mạnh**
   - TLS fingerprint, headers, cookies đều được check.
   - `got-scraping` cần config đúng.

2. **Shopee search API không public**
   - Reverse từ frontend requests.
   - `item.get` và `search_items` endpoints.

## Key Decisions

1. **TLS spoofing cho Shopee**
   - `got-scraping` là default client cho Shopee.
   - TLS/JA4 spoof Safari/Chrome fingerprint.

2. **TikTok Shop reuse pattern Epic 15**
   - TikTok Shop kế thừa từ `AbstractCrawler`.
   - Shared TLS spoofing logic.

## Follow-up Recommendations

1. **Shopee flash sale / voucher scraping**
   - Hiện chỉ product/search — chưa có voucher/flash sale.

2. **TikTok Shop seller analytics**
   - Seller metrics, shop performance.

## Final State

- Epic 16 status: **done**
- All two stories: **done**
- Retrospective: **done**
