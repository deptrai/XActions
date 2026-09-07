# Epic 17 Retrospective: Real Estate & Procurement Intelligence (Chợ Tốt & Batdongsan)

Status: done  
Date: 2026-09-08

## Summary

Epic 17 implement **real estate scrapers** cho Chợ Tốt và Batdongsan — 2 nền tảng bất động sản lớn nhất Việt Nam.

Epic complete across two stories:

| Story | Status | Outcome |
|---|---|---|
| 17.1 Chợ Tốt Multi-Category Scraper + Phone Mask | done | `ChototCrawler`, phone mask detection |
| 17.2 Batdongsan.com.vn Property Scraper | done | `BatdongsanCrawler`, mobile de-obfuscation |

## What Went Well

1. **Chợ Tốt multi-category**
   - Nhà đất, xe, đồ điện tử, v.v.
   - `phone_masked` detection cho masked phone.

2. **Batdongsan mobile de-obfuscation**
   - Mobile site có obfuscated phone/email.
   - De-obfuscation logic implemented.

3. **Phone extraction VN format**
   - Regex VN phone pattern.
   - `***` masked phone detection.

## What Was Difficult

1. **Batdongsan obfuscation**
   - Phone/email bị mã hóa trong JavaScript.
   - Cần reverse decode logic.

2. **Chợ Tốt dynamic content**
   - Lazy loading, infinite scroll.
   - Cần page/offset pagination.

## Key Decisions

1. **Phone mask detection**
   - `phone_masked` note khi thấy `***`.
   - Không tự động unmask — cần browser click.

2. **Mobile version cho Batdongsan**
   - Mobile site có thêm data mà desktop không có.

## Follow-up Recommendations

1. **Batdongsan project detail**
   - Hiện chỉ listing — chưa có project detail.

2. **Chợ Tốt seller profile**
   - Seller rating, history.

## Final State

- Epic 17 status: **done**
- All two stories: **done**
- Retrospective: **done**
