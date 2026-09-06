---
title: 'Story 22.2: Healthcare, Clinics & Pharmacy Network Crawler (Medpro, YouMed, Thuocsi)'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-2026-08-21.md
  - src/scrapers/index.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần danh bạ bác sĩ, phòng khám, nhà thuốc để bán thiết bị y tế và dược phẩm B2B.

**Approach:**
1. Tạo `HealthcareCrawler` tại `src/scrapers/healthcare/index.js`.
2. Support `medpro.vn`, `youmed.vn`, `thuocsi.vn` qua REST gateway.
3. Trích xuất: `clinicName`, `doctorName`, `specialty`, `hotline`, `address`, `schedule`, `pharmaCatalog[]` (giá sỉ).
4. Chuẩn hóa `PostItem` với `platform: 'medpro' | 'youmed' | 'thuocsi'`, `category: 'healthcare'`.
5. Dispatch alias: `medpro`, `youmed`, `thuocsi`, `healthcare`.

## Boundaries & Constraints

**Always:**
- Tuân thủ AD-22/NFR-19.
- Thêm `specialty` và `businessType` vào metadata.
- Kiểm tra lịch sử/pháp lý trước khi cào dữ liệu nhạy cảm.

**Ask First:**
- Nếu cần cào giá thuốc lẻ chi tiết.
- Nếu cần thêm bệnh viện/public data.

**Never:**
- Không cào hồ sơ bệnh nhân hoặc dữ liệu cá nhân nhạy cảm.
- Không tải dữ liệu hạn chế truy cập.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Search clinics | `scrape('medpro','search_clinics',{specialty:'Nhi khoa'})` | Clinic list | Empty → `[]` |
| Pharma wholesale | `scrape('thuocsi','catalog',{category:'kháng sinh'})` | Wholesale price list | Empty → `[]` |
| Doctor detail | `scrape('youmed','doctor',{id:'dr_001'})` | Profile with schedule | Invalid → `XACT_4001` |

</frozen-after-approval>

## Code Map

- `src/scrapers/healthcare/index.js` — `HealthcareCrawler`
- `src/scrapers/healthcare/client.js`
- `src/scrapers/healthcare/schema.js`
- `src/scrapers/index.js` — dispatcher
- `tests/scrapers/healthcare/`
