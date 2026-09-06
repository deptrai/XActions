---
title: 'Story 21.2: Automotive & Vehicles Market Crawler (Oto.com.vn, Bonbanh, Chợ Tốt Xe)'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-2026-08-21.md
  - src/scrapers/index.js
  - src/scrapers/realestate/chotot
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần giám sát thị trường xe tại Việt Nam để tìm khách bán xe chính chủ, phát hiện nhu cầu vay trả góp, và thu thập dữ liệu định giá.

**Approach:**
1. Tạo `AutomotiveCrawler` tại `src/scrapers/vehicles/automotive/index.js` kế thừa `AbstractCrawler`.
2. Support `oto.com.vn`, `bonbanh.com`, và `chotot_xe` (mở rộng `src/scrapers/realestate/chotot`).
3. Trích xuất: `brand`, `model`, `year`, `mileage`, `transmission`, `fuel`, `price`, `sellerType` (`chinh-chu` | `salon`), `phone`.
4. Lọc masked phone `***`, tự động gắn `phone_masked` khi cần.
5. Chuẩn hóa `PostItem` với `platform: 'oto_vn' | 'bonbanh' | 'chotot_xe'`, `category: 'automotive'`.
6. Dispatch alias: `oto_vn`, `bonbanh`, `chotot_xe`, `automotive`.

## Boundaries & Constraints

**Always:**
- Reuse `src/scrapers/realestate/chotot` normalizer cho `chotot_xe`.
- Validate phone với regex VN.
- Tag VN locale + proxy theo AD-22/NFR-19.
- Test với `node:http` server mock local.

**Ask First:**
- Nếu cần thêm nền tảng xe khác (VD: `xe.vatgia.com`).
- Nếu cần thêm action đặc thù (VD: `get_price_trend`).

**Never:**
- Không lấy dữ liệu cần đăng nhập.
- Không sửa crawler `realestate/chotot` nếu có thể tách module xe riêng.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Search vehicles | `scrape('oto_vn','search',{brand:'Toyota',city:'TPHCM'})` | Vehicle listings | Empty → `[]` |
| Chotot xe | `scrape('chotot_xe','list',{page:1})` | `PostItem[]` xe | Masked phone → `note: phone_masked` |
| Bonbanh detail | `scrape('bonbanh','detail',{id:'12345'})` | `PostItem` with mileage/sellerType | Invalid → `XACT_4001` |
| Proxy fallback | VN proxy exhausted | Retry with normal proxy + `geo_mismatch` flag | Log warning |

</frozen-after-approval>

## Code Map

- `src/scrapers/vehicles/automotive/index.js` — `AutomotiveCrawler`
- `src/scrapers/vehicles/automotive/client.js`
- `src/scrapers/vehicles/automotive/normalize.js`
- `src/scrapers/index.js` — dispatcher alias
- `tests/scrapers/vehicles/automotive/`
