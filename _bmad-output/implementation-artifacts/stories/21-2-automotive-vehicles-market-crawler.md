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
- `src/scrapers/vehicles/automotive/client.js` — `AutomotiveClient` extends `AbstractApiClient`
- `src/scrapers/vehicles/automotive/normalizer.js` — normalize BonBanh / Oto.com.vn HTML/JSON
- `src/scrapers/vehicles/automotive/schema.js` — constants, city/brand mapping, metadata schema
- `src/scrapers/vehicles/automotive/validator.js` — `AutomotivePlatformResponseValidator` extends `AbstractPlatformResponseValidator`
- `src/scrapers/realestate/chotot/client.js` — reusable Chợ Tốt HTTP gateway client
- `src/scrapers/realestate/chotot/normalize-chotot.js` — reuse `CATEGORY_CONFIG.cars` / `motorbikes`
- `src/scrapers/realestate/chotot/index.js` — `scrapeChotot` helper
- `src/scrapers/index.js` — dispatcher alias `oto_vn`, `bonbanh`, `chotot_xe`, `automotive`
- `tests/scrapers/vehicles/automotive/crawler.test.js`
- `tests/scrapers/vehicles/automotive/client.test.js`

---

## Technical Requirements

### Required Crawler Contract
- `AutomotiveCrawler` extends `AbstractCrawler` (`src/core/base-crawler.js`).
  - `name = 'automotive'`.
  - `requiresAuth = false` (public listing sites).
  - `registerAction()` action names must be snake_case (`search`, `list`, `detail`, `search_by_platform`).
  - `start({action, args, session})` returns `{ posts: PostItem[], pageInfo }` or `{ post: PostItem }`.
  - `init()` and `cleanup()` must be implemented (even if empty).
- `AutomotiveClient` extends `AbstractApiClient` (`src/core/base-client.js`).
  - `platform = 'automotive'` (or per-sub-platform `oto_vn`, `bonbanh`, `chotot_xe`).
  - `client = 'got'` (default) or `'undici'`; do not mix clients in one request pipeline.
  - `requiresAuth = false`.
  - `requiresProxy = false` by default; allow override via `options.requiresProxy`.
  - Provide `request()` overrides per target:
    - `OtoVnClient` / `BonBanhClient` / `ChototXeClient` may be distinct classes or one client with `baseUrl` switch.
- `AutomotivePlatformResponseValidator` extends `AbstractPlatformResponseValidator`.
  - Detect bot challenge / Cloudflare block.
  - Detect empty result / 404.

### Platform-Specific Extraction
| Platform | Endpoint Pattern | Extraction Method | Key HTML/JSON markers |
|---|---|---|---|
| `bonbanh` | `https://bonbanh.com/oto/page,{page}` | Schema.org Microdata (`itemscope itemtype="http://schema.org/Car"`) | `itemprop="name"`, `itemprop="price"`, `itemprop="vehicleEngine"`, `itemprop="mileageFromOdometer"`, `itemprop="vehicleTransmission"`, `itemprop="fuelType"` |
| `oto_vn` | `https://www.oto.com.vn/mua-ban-xe{-brand}{-city}/page/{page}` | HTML parse + structured data / JSON-LD | Look for listing card with `data-item-id`, price `.{N} triệu` / `.{N} tỷ`, `.{km}` or `.{N} km`, transmission, fuel |
| `chotot_xe` | `https://gateway.chotot.com/wg/cg/2010?st=s&ot=...&page={page}` | Reuse `ChototClient.getJson()` with `cg: 2010` (cars) or `cg: 2020` (motorbikes) | JSON `adlist` items; `subject`, `price`, `area`, `category`, `ad_id`; phone may need `contact` endpoint or be masked with `***` |

### Price Parsing Rule
- BonBanh / Oto.com.vn dùng chuỗi tiếng Việt: `"795 Triệu"`, `"1 tỷ 250 triệu"`, `"Thỏa thuận"`.
- Normalize to integer VND:
  - `1 tỷ = 1_000_000_000`.
  - `1 triệu = 1_000_000`.
  - `"Thỏa thuận"` / `"Giá alo"` → `null` with `priceNegotiable: true`.
- Store both `price` (number) and `priceFormatted` (string) in `metadata`.

### Phone & Seller Rules
- Vietnamese phone regex: `/^(0[0-9]{9,10})$/` (10–11 digits; examples `0901234567`, `09876543210`).
- Masked phone (`***`, `...`, `không hiển thị`) → set `metadata.phone = null` and `metadata.phoneMasked = true`.
- If phone is present, set `metadata.phone` (string) and `authorId = phone` (or external listing id when phone absent).
- `sellerType` inference:
  - BonBahn: presence of `salon` class / URL slug containing `salon` / multiple listings by same author → `salon`; otherwise `chinh-chu`.
  - Oto.com.vn: seller label `"Cá nhân"` → `chinh-chu`; `"Salon"` / `"Đại lý"` → `salon`.
  - Chợ Tốt: `company_ad: true` / `type: 'company'` → `salon`; else `chinh-chu`.

### PostItem Schema (Automotive)
```typescript
{
  id: `${platform}:${externalId}`,          // e.g. "bonbanh:xe-vinfast-vf8-plus-awd-2023-6917077"
  platform: 'oto_vn' | 'bonbanh' | 'chotot_xe',
  externalId: string,                       // listing slug or ad_id
  category: 'automotive',
  authorId: string,                         // phone or seller id
  authorName: string,                       // seller name or salon name
  content: string,                          // human-readable summary: "VinFast VF8 Plus AWD - 2023 - Giá: 795 Triệu - 25.000 km"
  metadata: {
    brand: string,
    model: string,
    year: number,
    mileage: number | null,                 // km
    mileageFormatted: string,
    transmission: 'số tự động' | 'số sàn' | 'số tay' | string,
    fuel: 'xăng' | 'dầu' | 'điện' | 'hybrid' | string,
    price: number | null,
    priceFormatted: string,
    priceNegotiable: boolean,
    sellerType: 'chinh-chu' | 'salon',
    phone: string | null,
    phoneMasked: boolean,
    address: string,
    city: string,
    detailUrl: string,
    imageUrls?: string[],
    listingDate?: string,
    sourcePlatform: string,
  },
  crawledAt: Date,
}
```
Use `generatePostId(platform, externalId)` from `src/core/types.js` for `id`.

### Architecture Compliance
- **AD-2:** Mọi module mới phải kế thừa `AbstractCrawler` / `AbstractApiClient`. `src/client/` legacy KHÔNG được import.
- **AD-3 (No-Auth rotating proxy):** `requiresAuth = false` → proxy xoay per-request hoặc per-batch. Không dùng sticky IP trừ khi caller truyền `accountId`.
- **AD-4 (PrismaStore):** Sau khi normalize, gọi `this.store.storeBatch(posts.slice(0, limit))` nếu store attached.
- **AD-7 (Thin Event):** Phát `ThinEvent` pointer qua `RedisStreamPublisher` nếu `publisher` được truyền vào crawler. Event shape: `{ id, platform, externalId, category, authorId, crawledAt, storageRef }`.
- **AD-1:** HTTP-only; không cần `signerPool` / `tokenRing` cho các nguồn này.
- **NFR-18:** 100% `AbstractCrawler` + `CrawlerCommand`, dispatch qua `src/scrapers/index.js`.

### File Structure Requirements
```
src/scrapers/vehicles/automotive/
├── index.js            # barrel: exports AutomotiveCrawler, clients, helper, default object
├── crawler.js          # AutomotiveCrawler extends AbstractCrawler
├── client.js           # AutomotiveClient / OtoVnClient / BonBanhClient / ChototXeClient extends AbstractApiClient
├── normalizer.js       # parse BonBanh / Oto.com.vn HTML and Chợ Tốt JSON
├── schema.js           # constants, brand/model aliases, city slug map, metadata JSON schema
└── validator.js        # AutomotivePlatformResponseValidator extends AbstractPlatformResponseValidator

tests/scrapers/vehicles/automotive/
├── crawler.test.js
└── client.test.js
```

### Testing Requirements
- Dùng **Vitest 4.x**; tạo `node:http` server mock (giống tests 21.1). **No mocks, stubs, or fakes** — only real HTTP server fixtures.
- Test files phải assert:
  1. `AutomotiveCrawler` is `AbstractCrawler`; `requiresAuth = false`.
  2. Actions registered: `search`, `list`, `detail` (hoặc tương đương).
  3. `search` / `list` trả về `{ posts: PostItem[], pageInfo: { has_next_page: boolean } }`.
  4. `detail` trả về `{ post: PostItem }`.
  5. `price` parse đúng từ `"795 Triệu"`, `"1 tỷ 250 triệu"`.
  6. Masked phone trả về `metadata.phone === null && metadata.phoneMasked === true`.
  7. `sellerType` inference đúng (`chinh-chu` vs `salon`).
  8. Dispatcher aliases `oto_vn`, `bonbanh`, `chotot_xe`, `automotive` hoạt động qua `scrape()`.
  9. Invalid args throw `PlatformError` với code `XACT_4001`.
- Chạy: `npx vitest run tests/scrapers/vehicles/automotive/`.

### Library / Framework Requirements
- Sử dụng sẵn `AbstractApiClient.request()` với `client: 'got'` (hoặc `undici` nếu được chỉ định).
- KHÔNG thêm npm dependencies mới ngoài những gì đã có trong `package.json` (`got-scraping`, `undici`, `cheerio` chỉ khi cần — project chủ yếu parse thủ công / regex).
- Reuse `ChototClient`, `CHOTOT_GATEWAY_URL`, `CATEGORY_CONFIG` từ `src/scrapers/realestate/chotot/`. KHÔNG copy-paste code Chợ Tốt.

---

## Previous Story Intelligence (21.1 — MaSoThue)

- **Pattern established:** `src/scrapers/procurement/masothue/{index,client,crawler,normalizer,schema,validator}.js` cùng barrel file.
- **Client defaults:** `client = 'got'`, `requiresAuth = false`, browser headers (`Accept-Language: vi-VN`, `Referer`, `DNT`, `Upgrade-Insecure-Requests`).
- **Response raw mode:** `this.request(method, url, { raw: true, ... })` trả về `{ body: string, status, headers }`; client tự normalize Buffer → string.
- **Crawler persistence:** `this.store.storeBatch(posts.slice(0, limit))` guarded by `typeof this.store.storeBatch === 'function'`.
- **E2E lesson:** HTML parser phải dựa trên markup thật. Với MaSoThue, `data-prefetch` blocks dùng cho listing và `itemprop` cho detail; tránh regex `\d{9,13}` toàn trang vì false-positive từ ad-slot IDs.
- **Dispatcher pattern:** `src/scrapers/index.js` thêm block với `AUTOMOTIVE_ACTION_MAP` và alias `oto_vn`, `bonbanh`, `chotot_xe`, `automotive`, mapping args `brand`, `model`, `year`, `priceMin`, `priceMax`, `city`, `page`, `limit`, `id`, `platform`.
- **Commit convention:** `feat(21.2): ...` và push as `nirholas`.

---

## Tasks / Subtasks

- [ ] 1. Scaffolding: create `src/scrapers/vehicles/automotive/{index,client,crawler,schema,validator}.js` and `tests/scrapers/vehicles/automotive/`.
- [ ] 2. Implement `AutomotiveClient` with per-platform `baseUrl` (Oto.com.vn, BonBanh, ChototXe) and browser headers.
- [ ] 3. Implement `AutomotivePlatformResponseValidator` (bot challenge, empty result, 404 detection).
- [ ] 4. Implement `AutomotiveCrawler` with actions: `search` (cross-platform), `list` (per platform paging), `detail` (per listing id).
- [ ] 5. Implement `normalizer.js` for BonBanh Schema.org Microdata and Oto.com.vn HTML card parsing.
- [ ] 6. Integrate `ChototClient` with `cg: 2010` (cars) / `2020` (motorbikes) and parse vehicle JSON into `PostItem`.
- [ ] 7. Add Vietnamese price parser (`Triệu`, `tỷ`, `Thỏa thuận`) and VN phone validator.
- [ ] 8. Add `schema.js` with brand aliases, city slug map, and JSON Schema for `metadata`.
- [ ] 9. Register dispatcher aliases in `src/scrapers/index.js` (`oto_vn`, `bonbanh`, `chotot_xe`, `automotive`).
- [ ] 10. Add Vitest tests: client, crawler, dispatcher, price/phone/sellerType edge cases.
- [ ] 11. Run `npx vitest run tests/scrapers/vehicles/automotive/` and fix failures.
- [ ] 12. Run `npx vitest run` (full suite) to ensure no regression.
- [ ] 13. Update `types/index.d.ts` if `PostItem`/`Post` metadata shape is referenced there.
- [ ] 14. Commit and push as `nirholas`.

---

## Dev Agent Record

### Implementation Plan
1. Copy structural pattern from `src/scrapers/procurement/masothue/` → `src/scrapers/vehicles/automotive/`.
2. Replace `MaSoThueClient` logic with multi-baseUrl `AutomotiveClient` supporting `oto_vn`, `bonbanh`, `chotot_xe` sub-platforms.
3. Write `normalizer.js` focusing on **Schema.org Microdata** for BonBanh and **Chợ Tốt JSON** for `chotot_xe`.
4. Implement `AutomotiveCrawler` actions using `registerAction()` with snake_case names.
5. Add dispatcher branch in `src/scrapers/index.js` mirroring MaSoThue block.
6. Write tests with `node:http` mock server asserting `PostItem` shape.
7. Full test run + regression check.
8. Commit/push.

### Debug Log
- *TBD during implementation.*

### Completion Notes
- *TBD.*

---

## Status

**ready-for-dev** — comprehensive developer context completed 2026-09-06.
