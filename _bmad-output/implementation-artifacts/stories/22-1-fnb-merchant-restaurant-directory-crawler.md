---
title: 'Story 22.1: F&B Merchant & Restaurant Directory Crawler (PasGo, Foody, Riviu)'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-2026-08-21.md
  - src/scrapers/index.js
  - src/scrapers/ecom/shopee
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần danh bạ F&B tại VN (nhà hàng, quán cafe, quán ăn) để bán POS, nguyên liệu, và phân tích thị trường F&B.

**Approach:**
1. Tạo `FnbMerchantCrawler` tại `src/scrapers/fnb/merchant/index.js`.
2. Support `pasgo.vn`, `foody.vn`, `riviu.vn` qua REST API mobile app + TLS spoofing (reuse Shopee pattern).
3. Trích xuất: `name`, `manager`, `hotline`, `address`, `gpsLat`, `gpsLng`, `menuItems[]`, `rating`, `reviewCount`.
4. Chuẩn hóa `PostItem` với `platform: 'pasgo' | 'foody' | 'riviu'`, `category: 'fnb_merchant'`.
5. Dispatch alias: `pasgo`, `foody`, `riviu`, `fnb`.

## Boundaries & Constraints

**Always:**
- Request qua VN proxy + locale `vi-VN`.
- Validate `phone` là SĐT VN hợp lệ.
- Thêm action `getNewlyOpened` và `searchByDistrict`.

**Ask First:**
- Nếu cần crawl review chi tiết theo từng khách hàng.
- Nếu cần thực đơn ảnh/menu PDF.

**Never:**
- Không tải lên app store/spoof mobile device khi chưa được approve.
- Không lưu raw cookies của app.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Search by city/district | `scrape('pasgo','search_restaurants',{city:'Hà Nội',district:'Đống Đa'})` | Restaurant list | Empty → `[]` |
| Newly opened | `scrape('foody','newly_opened',{days:30})` | Recent merchants | None → `[]` |
| Detail merchant | `scrape('riviu','detail',{id:'abc123'})` | `PostItem` with menu & reviews | Not found → `XACT_4001` |

</frozen-after-approval>

## Live Probe Findings (2026-09-08)

**Story approach adjusted after probe:**

| Platform | Original Approach | Probe Result | New Approach |
|---|---|---|---|
| PasGo | HTML / REST API | ✅ 200, JSON-LD | Parse SSR HTML + JSON-LD |
| Foody | `gappapi.deliverynow.vn` mobile app API | ❌ 403/404 | Parse `foody.vn/{city}/nha-hang` embedded `var jsonData.searchItems` (no app API) |
| Riviu | HTML / REST API | ✅ 200 Nuxt SSR | Parse Nuxt SSR HTML; `reviewapi.riviu.co` path discovery deferred |

**Key details:**
- `gappapi.deliverynow.vn` is not public — requires app auth. **Do not use.**
- Foody page embeds `var jsonData = { ..., searchItems: [...] }` where each item has `Address`, `District`, `City`, `Phone`, `TotalReview`, `AvgRating`, `Cuisines`, `DetailUrl`.
- Riviu renders Nuxt SSR HTML; no public REST API surface found on first probe.

## Code Map

- `src/scrapers/fnb/merchant/index.js` — `FnbMerchantCrawler`
- `src/scrapers/fnb/merchant/client.js`
- `src/scrapers/fnb/merchant/schema.js`
- `src/scrapers/index.js` — dispatcher
- `tests/scrapers/fnb/merchant/`
