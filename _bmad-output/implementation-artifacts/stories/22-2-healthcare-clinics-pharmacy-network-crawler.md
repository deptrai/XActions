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
2. Support `medpro.vn`, `youmed.vn`, `nhathuoclongchau.com.vn` qua REST/SSR gateway; `thuocsi.vn` is auth-gated and deferred.
3. Trích xuất: `clinicName`, `doctorName`, `specialty`, `hotline`, `address`, `schedule`, `pharmaCatalog[]` (giá sỉ).
4. Chuẩn hóa `PostItem` với `platform: 'medpro' | 'youmed' | 'nhathuoclongchau' | 'thuocsi'`, `category: 'healthcare'`.
5. Dispatch alias: `medpro`, `youmed`, `nhathuoclongchau`, `thuocsi`, `healthcare`.

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
| Pharmacy directory (Long Chau) | `scrape('nhathuoclongchau','stores')` | 2,649-store list with GPS & hours | Empty → `[]` |
| Doctor detail | `scrape('youmed','doctor',{id:'dr_001'})` | Profile with schedule | Invalid → `XACT_4001` |

</frozen-after-approval>

## Live Probe Findings (2026-09-08)

**Story scope adjusted after probe:**

| Platform | Original Approach | Probe Result | New Approach |
|---|---|---|---|
| YouMed | REST Gateway | ✅ 200 + public WP REST API (`/tin-tuc/wp-json/app/v2/specialities` returns JSON) | Use public WP REST API or SSR HTML |
| Medpro | REST Gateway | ✅ 200 SSR; `api.medpro.com.vn` catch-all | Parse Next.js SSR HTML; discover real API from page bundle |
| Thuocsi | REST Gateway (`thuocsi.vn`) | ❌ `api.buymed.com` 401 on all endpoints | **Auth-gated B2B wholesale — deferred to Epic 24 (requires authenticated session pool)** |
| **Long Chau** *(added)* | N/A | ✅ 200 Next.js SSR + `__NEXT_DATA__` embeds **2,649 pharmacies** | Parse `__NEXT_DATA__` or `/_next/data/{buildId}/he-thong-cua-hang.json` for full pharmacy directory |

**Key details:**
- YouMed uses WordPress REST API at `youmed.vn/tin-tuc/wp-json/app/v2/*`. Specialties endpoint is public and returns structured JSON.
- Medpro is a Next.js app; `api.medpro.com.vn` returns generic `<p>Hello</p>` for all guessed paths, so real API endpoints must be extracted from page JS.
- `thuocsi.vn` is a Next.js app using `api.buymed.com`. All product/catalog endpoints return **401 Unauthorized** — requires login.
- `nhathuoclongchau.com.vn` is a Next.js app. The `/he-thong-cua-hang` page embeds the complete pharmacy directory (2,649 stores) inside `__NEXT_DATA__.props.pageProps.initialPharmacyRecommended`. The same payload is also exposed as JSON at `/_next/data/{buildId}/he-thong-cua-hang.json`.

**Compliance note:** Only public clinic/doctor/directory data — no patient records, prescriptions, or private health data.

**Scope decision:**
- Thuocsi stays in the story but is flagged as **auth-gated**; implement it later under Epic 24 (session pool / authenticated crawler work).
- Long Chau is added as an **additional** public pharmacy source, not a replacement.

## Code Map

- `src/scrapers/healthcare/index.js` — `HealthcareCrawler`
- `src/scrapers/healthcare/client.js`
- `src/scrapers/healthcare/schema.js`
- `src/scrapers/index.js` — dispatcher
- `tests/scrapers/healthcare/`
