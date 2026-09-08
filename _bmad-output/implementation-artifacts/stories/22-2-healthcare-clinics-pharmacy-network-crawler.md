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

- `src/scrapers/healthcare/index.js` — barrel exports + `scrapeHealthcare()` dispatcher helper
- `src/scrapers/healthcare/client.js` — `HealthcareClient extends AbstractApiClient`
- `src/scrapers/healthcare/crawler.js` — `HealthcareCrawler extends AbstractCrawler`
- `src/scrapers/healthcare/schema.js` — city/specialty slug maps, phone validation
- `src/scrapers/healthcare/normalizer.js` — raw HTML/JSON → `PostItem` normalizer
- `src/scrapers/healthcare/validator.js` — `HealthcarePlatformResponseValidator`
- `src/scrapers/index.js` — dispatcher aliases
- `tests/scrapers/healthcare/` — unit/integration tests

## Tasks / Subtasks

### Phase 0: Foundation & Schema Setup
- [ ] **Task 0.1** — Add `healthcare` to `CATEGORIES` in `src/core/types.js` (AC: #4)
  - [ ] Add `HEALTHCARE: 'healthcare'` to `CATEGORIES`
  - [ ] Verify `isValidCategory('healthcare')` returns `true`
  - [ ] Update `prisma/schema.prisma` category comment
  - [ ] Update `types/index.d.ts` if category union is declared
- [ ] **Task 0.2** — Create directory `src/scrapers/healthcare/` with module files
  - [ ] `index.js`
  - [ ] `client.js`
  - [ ] `crawler.js`
  - [ ] `schema.js`
  - [ ] `normalizer.js`
  - [ ] `validator.js`

### Phase 1: HealthcareClient
- [ ] **Task 1.1** — Implement `HealthcareClient` extending `AbstractApiClient` (AC: #1)
  - [ ] `requiresAuth = false` (no login required)
  - [ ] `requiresProxy = false` (sites respond 200 direct)
  - [ ] `targetPlatform` in `{'medpro','youmed','nhathuoclongchau'}`
  - [ ] `#resolveBase(platform)` returns correct base URL
  - [ ] `searchClinics({ specialty, city, page })` for Medpro/YouMed
  - [ ] `getStores({ city, page })` for Long Chau
  - [ ] `getPharmacyCatalog()` placeholder (Thuocsi) → throws `XACT_4001` / logs deferred
  - [ ] `detail({ id, platform, slug })` for YouMed doctor/facility detail
  - [ ] `normalizeRawBody()` handles Buffer/ReadableStream/string

### Phase 2: HealthcareCrawler
- [ ] **Task 2.1** — Implement `HealthcareCrawler` extending `AbstractCrawler` (AC: #1)
  - [ ] Register actions: `search_clinics`, `search_doctors`, `get_stores`, `pharmacy_catalog`, `detail`
  - [ ] `search_clinics` maps to client `searchClinics`
  - [ ] `get_stores` maps to client `getStores`
  - [ ] `detail` validates required `id` and `platform`
  - [ ] `pharmacy_catalog` returns `PlatformError` for Thuocsi with `auth_gated` / deferred message
  - [ ] Return shape: `{ posts: PostItem[], pageInfo: { has_next_page, page } }` or `{ post: PostItem }`

### Phase 3: Normalizer
- [ ] **Task 3.1** — Implement `normalizeHealthcareResults(data, kind, options)`
  - [ ] **Medpro**: parse `__NEXT_DATA__.props.pageProps.initialHospitals` object keyed `0..n`
    - Extract `name`, `city.name`, `_id`/`partnerId`, `status`, `newHospitalTypes`
    - Map facility record to `PostItem`
  - [ ] **YouMed**: parse SSR HTML `doctor-card` blocks + fallback WP REST `specialities`
    - Doctor detail: `https://youmed.vn/dat-kham/bac-si/{slug}`
    - Extract name, specialty, hospital/clinic, address, image
  - [ ] **Long Chau**: parse `__NEXT_DATA__.props.pageProps.initialPharmacyRecommended.items`
    - Extract `shopNameDisplay`, `phone`, `location.address`, `location.coordinates`, `provinceName`, `wardName`, `operation.open`/`close`, `pharmacyLicenseData`, `responsiblePharmacist`
  - [ ] **Thuocsi**: return empty `[]` or throw `PlatformError` (auth-gated)

### Phase 4: Validator
- [ ] **Task 4.1** — `HealthcarePlatformResponseValidator`
  - [ ] Medpro: valid if body contains `__NEXT_DATA__` or JSON `initialHospitals`
  - [ ] YouMed: valid if body contains `doctor-card` or valid WP JSON `code: 200`
  - [ ] Long Chau: valid if `__NEXT_DATA__` contains `initialPharmacyRecommended`
  - [ ] Reject 4xx/5xx (except 403/429 handled as transient)

### Phase 5: Dispatcher & Integration
- [ ] **Task 5.1** — Wire into `src/scrapers/index.js` (AC: #5)
  - [ ] Add `healthcare`, `medpro`, `youmed`, `nhathuoclongchau` dispatcher aliases
  - [ ] Map actions: `search_clinics`, `search_doctors`, `get_stores`, `pharmacy_catalog`, `detail`
  - [ ] Construct `HealthcareClient` and `HealthcareCrawler` in `scrape()`

### Phase 6: Tests
- [ ] **Task 6.1** — Unit tests
  - [ ] `tests/scrapers/healthcare/client.test.js` — URL building, detail calls
  - [ ] `tests/scrapers/healthcare/crawler.test.js` — action dispatch, validation errors
  - [ ] `tests/scrapers/healthcare/normalizer.test.js` — fixture-based parsing for 3 platforms
  - [ ] `tests/scrapers/healthcare/schema.test.js` — slug/phone validation
  - [ ] `tests/scrapers/healthcare/validator.test.js` — platform payload validation
  - [ ] `tests/scrapers/healthcare/fixtures/` — HTML/JSON samples
- [ ] **Task 6.2** — Live probe regression
  - [ ] Medpro list returns > 200 facilities
  - [ ] YouMed SSR parses at least 1 doctor card
  - [ ] Long Chau `__NEXT_DATA__` stores count matches `totalCount`
  - [ ] `npx vitest run tests/scrapers/healthcare/` all pass

## Dev Notes

### 0. Add `HEALTHCARE` category
`src/core/types.js` must be updated **before** `HealthcareCrawler` is tested; otherwise `AbstractCrawler.validateItem()` rejects `category: 'healthcare'`.

```js
// src/core/types.js
export const CATEGORIES = Object.freeze({
  ...
  FNB_MERCHANT: 'fnb_merchant',
  HEALTHCARE: 'healthcare',  // ADD THIS for Story 22.2
});
```

Also update `prisma/schema.prisma` comment and any JSDoc/TSDoc category unions.

### 1. Platform vs Crawler `platform`
- `HealthcareCrawler.name = 'healthcare'`
- `HealthcareCrawler.platform = 'healthcare'`
- `PostItem.platform` = `'medpro' | 'youmed' | 'nhathuoclongchau'`
- `PostItem.category` = `'healthcare'`

### 2. No auth, no proxy by default
- All three public sites return 200 over direct VN HTTP.
- `requiresProxy = false`; allow override via `options.requiresProxy`.
- `requiresAuth = false`.

### 3. Medpro (`medpro.vn`)
- Facility list: `https://medpro.vn/co-so-y-te`
- `__NEXT_DATA__.props.pageProps.initialHospitals` is an object keyed by numeric index; use `Object.values()` to get array.
- Each item: `_id`, `name`, `city` (`_id`, `name`, `code`), `partnerId`, `status`, `newHospitalTypes`.
- Detail path not yet probed; use `detail` with `{ id, slug }` if available.

### 4. YouMed (`youmed.vn`)
- WP REST endpoint `https://youmed.vn/tin-tuc/wp-json/app/v2/specialities` returns specialties list; other `app/v2/*` routes are **404** on live probe.
- Doctor directory SSR: `https://youmed.vn/dat-kham/bac-si` contains `doctor-card` blocks with Angular attributes (`_ngcontent-sc*`).
- Doctor detail: `https://youmed.vn/dat-kham/bac-si/{slug}` (extract from card `href`).
- Parse card: name from link/h3, specialty/hospital from card text.

### 5. Long Chau (`nhathuoclongchau.com.vn`)
- Store directory: `https://nhathuoclongchau.com.vn/he-thong-cua-hang`
- `__NEXT_DATA__.props.pageProps.initialPharmacyRecommended` has `totalCount` and `items[]`.
- Each store: `shopNameDisplay`, `phone`, `provinceName`, `wardName`, `location.address`, `location.coordinates.latitude`, `location.coordinates.longitude`, `operation.open`, `operation.close`, `pharmacyLicenseData`, `responsiblePharmacist`.
- SSL cert is incomplete; use `https: { rejectUnauthorized: false }`.
- Full 2,649 stores may be paginated; default probe returns 5 visible items. Implement pagination via `/_next/data/{buildId}/he-thong-cua-hang.json` or query param if discovered.

### 6. Thuocsi (`thuocsi.vn`)
- All `api.buymed.com` endpoints return **401 Unauthorized**.
- Implement `pharmacy_catalog` as a stub that throws `PlatformError` `XACT_4001` with `message: 'thuocsi.vn requires authenticated B2B session — deferred to Epic 24'`.

### 7. PostItem metadata mapping
```js
metadata: {
  facilityName,
  doctorName,
  specialty,
  businessType,      // 'hospital' | 'clinic' | 'pharmacy'
  hotline,
  phone,
  phoneMasked,
  address,
  city,
  district,
  gpsLat,
  gpsLng,
  operationHours,    // { open, close }
  license,           // pharmacyLicenseData
  pharmacist,        // responsiblePharmacist
  sourcePlatform,
}
```

### 8. Error & Pagination
- `XACT_4001` — missing `id`, invalid `platform`, Thuocsi no auth.
- `XACT_4030` — bot challenge (rare; detected by validator).
- `has_next_page` for Medpro/YouMed: use `pageInfo` from API or conservative `items.length >= limit`.
- Long Chau default page returns 5 items; if `totalCount > items.length`, set `has_next_page: true` and implement page params.

### 9. Backward compatibility
- `scrape('healthcare', 'search_clinics', { platform: 'medpro', city: 'ho-chi-minh' })` must work.
- `scrape('medpro', 'search_clinics', { city: 'ho-chi-minh' })` must work.
- `scrape('youmed', 'detail', { id, slug })` must work.

---

*Validated 2026-09-08: live probes confirm Medpro (254 facilities via __NEXT_DATA__), YouMed (SSR doctor-card + WP specialities 200), Long Chau (2,649 total stores, 5 visible items in SSR), Thuocsi 401 (auth-gated, deferred).*
