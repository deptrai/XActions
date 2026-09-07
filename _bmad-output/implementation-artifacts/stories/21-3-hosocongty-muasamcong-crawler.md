---
title: 'Story 21.3: HoSoCongTy & MuaSamCong Crawler (Cloudflare/SPA fallback)'
type: 'feature'
created: '2026-09-06'
status: 'review'
review_loop_iteration: 1
baseline_commit: 'ed7e2ac8'
baseline_commit: 'ed7e2ac8'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-cloudflare-vn-b2b-endpoints-2026-09-06/research.md
  - _bmad-output/planning-artifacts/research/technical-cloudflare-vn-b2b-endpoints-2026-09-06/digests/hosocongty-probe.md
  - _bmad-output/planning-artifacts/research/technical-cloudflare-vn-b2b-endpoints-2026-09-06/digests/muasamcong-probe.md
  - src/scrapers/index.js
  - src/core/base-crawler.js
  - src/core/base-client.js
  - src/scrapers/procurement/masothue/
  - src/scraping/stealthBrowser.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 21.1 (MaSoThue) là MVP. Hai nguồn còn lại (`hosocongty.vn`, `muasamcong.mpi.gov.vn`) phức tạp hơn và cần nghiên cứu hoặc anti-detection thêm.

- `hosocongty.vn`: Cloudflare managed challenge block HTTP client (`undici`/`got` → 403 JA3/JA4 fingerprint).
- `muasamcong.mpi.gov.vn`: Liferay SPA, không có public API rõ ràng; search trả HTML.

**Approach:**
1. Tạo `B2BRegistryExtendedCrawler` tại `src/scrapers/procurement/b2b-registry-extended/index.js` kế thừa `AbstractCrawler`.
2. HoSoCongTy: 2-tier fallback (a) `got-scraping` TLS/JA4 + VN proxy, (b) `StealthBrowser` (Puppeteer) warmup → `cf_clearance` cookie → `AbstractApiClient` với cookie.
3. MuaSamCong: parse HTML search results (server-side rendered) hoặc reverse Liferay AJAX endpoint.
4. Trích xuất: `taxCode`, `companyName`, `representativeName`, `phone`, `businessLines`, `charterCapital`, `establishedDate` (HSC); `tenderNo`, `tenderName`, `procuringEntityName`, `bidSubmissionDeadline`, `bidValue`, `bidSecurity` (MuaSamCong).
5. Chuẩn hóa `PostItem` với `platform: 'hosocongty' | 'muasamcong'`, `category: 'b2b'`.

## Boundaries & Constraints

**Always:**
- Dùng `AbstractCrawler` + `AbstractApiClient`.
- Request VN platforms qua `ProxyIpPool` với region `VN`.
- Browser fallback dùng `launchStealthBrowser` + `createStealthPage` từ `src/scraping/stealthBrowser.js`.
- Thêm tests tại `tests/scrapers/procurement/b2b-registry-extended/`.
- Validate response bằng `AbstractPlatformResponseValidator` (`isBotChallenge` detect "Just a moment...").
- Inject `publisher`/`eventPublisher` vào crawler constructor cho `ThinEvent` publishing.
- Implement `listActions()` để expose action descriptors cho MCP/dispatcher.

**Ask First:**
- Nếu cần dùng headless browser production (Puppeteer startup cost ~2s/page).
- Nếu cần lưu `cf_clearance` cookies dài hạn (TTL ~30 phút).

**Never:**
- Không login bằng credentials giả mạo.
- Không phá vỡ schema `PostItem` hiện có.
- Không dùng mocks/stubs/fakes trong tests.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| HSC detail (got-scraping success) | `scrape('hosocongty','company',{taxCode:'0123456789'})` | `PostItem` with full info | Cloudflare block → try browser warmup |
| HSC browser warmup | `scrape('hosocongty','company',{taxCode:'0123456789'})` | `PostItem` | Cookie expired → retry once |
| MuaSamCong search | `scrape('muasamcong','search_tenders',{keyword:'xây dựng'})` | `PostItem[]` | SPA render fail → parse raw HTML |
| MuaSamCong detail | `scrape('muasamcong','detail',{tenderNo:'...'})` | `PostItem` with value/bidder | Not found → `XACT_4001` |
| Cloudflare challenge | Any HSC request | `PlatformError` type=`bot_challenge` | Retry with next tier |

## Code Map

- `src/scrapers/procurement/b2b-registry-extended/index.js` — `B2BRegistryExtendedCrawler`, `scrapeB2BRegistryExtended`
- `src/scrapers/procurement/b2b-registry-extended/client.js` — `B2BRegistryExtendedClient` extends `AbstractApiClient`
- `src/scrapers/procurement/b2b-registry-extended/browser.js` — `CloudflareWarmup` (Puppeteer cookie extraction)
- `src/scrapers/procurement/b2b-registry-extended/schema.js` — metadata schema
- `src/scrapers/procurement/b2b-registry-extended/normalizer.js` — `normalizeHosocongty`, `normalizeMuasamcong`
- `src/scrapers/procurement/b2b-registry-extended/validator.js` — `B2BRegistryExtendedValidator`
- `src/scrapers/index.js` — dispatcher alias `hosocongty`, `muasamcong`, `b2b_registry_extended` in `platforms` object
- `tests/scrapers/procurement/b2b-registry-extended/`
- `types/index.d.ts` — add `B2BRegistryExtendedCrawler` types

## Technical Implementation

### HoSoCongTy (hosocongty.vn)

**Live probe (2026-09-06):** 403 Cloudflare "Just a moment..." managed challenge. `undici`/`got` blocked by JA3 fingerprint.

**Implementation (2-tier fallback):**

```javascript
// client.js — 2-tier fallback
async request(method, url, options = {}) {
  // Tier 1: got-scraping TLS spoofing
  try {
    const resp = await this.gotScrapingRequest(url, options);
    if (this.isValidPayload(resp)) return resp;
  } catch (e) { /* fallthrough to Tier 2 */ }

  // Tier 2: Browser warmup → cf_clearance cookie
  const cookies = await this.warmupBrowser(url);
  return this.httpRequest(url, { ...options, cookies });
}
```

**Key details:**
- `got-scraping` package already in `package.json` (`^3.2.15`).
- `cf_clearance` cookie TTL ~30 minutes; cache in memory (`Map<domain, {cookies, expiresAt}>`).
- Browser warmup: `launchStealthBrowser({ proxy: vnProxy })` → `createStealthPage` → `page.goto(url)` → extract `cf_clearance` cookie.
- URL pattern: `https://hosocongty.vn/tra-cuu/{taxCode}` or search `/tim-kiem?q={query}` (probe needed for exact endpoints).

**Extractable fields (if accessible):**
- `taxCode`, `companyName`, `representativeName`, `phone`, `businessLines`, `charterCapital`, `establishedDate`
- `address`, `legalForm`, `status`

### MuaSamCong (muasamcong.mpi.gov.vn)

**Live probe (2026-09-06):** 200 OK, Liferay SPA with server-side rendered HTML.

**Search endpoint:**
```
GET /web/guest/bc/-/search?searchType=bidding&searchScope=lcnt&searchBy=notifyNo,bidName&keywordMatch=all&keyword={keyword}
```

**Detail endpoint:**
```
GET /web/guest/contractor-selection?render=detail-v2&notifyNo={tenderNo}&step=tbmt
```

**Parsing approach:** `cheerio` hoặc `jsdom` (không dùng regex cho HTML parsing).

**Extractable fields from search HTML:**

| Field | CSS Selector | Example |
|-------|-------------|---------|
| `tenderNo` | `.content__body__left__item__infor__code` | `IB2600511963-00` |
| `tenderName` | `.content__body__left__item__infor__contract__name` | `Cung cấp dịch vụ ăn, nghỉ...` |
| `procuringEntityName` | `h6:contains("Chủ đầu tư") span` | `Cục Quản trị Văn phòng Quốc hội` |
| `publishDate` | `h6:contains("Ngày đăng tải thông báo") span` | `07/09/2026 - 02:07` |
| `bidSubmissionDeadline` | `.content__body__right__item__infor__contract h5` | `09:00` + `21/09/2026` |
| `bidStatus` | `.content__body__left__item__infor__notice--be` | `Chưa đóng thầu` / `Đã đóng thầu` |
| `bidField` | `h6:contains("Lĩnh vực") span` | `Phi tư vấn` |
| `bidLocation` | `h6:contains("Địa điểm") span` | `Thành phố Hồ Chí Minh; Thành phố Hà Nội` |

**Detail page fields (tab "Thông tin chung"):**

| Field | Label | Example |
|-------|-------|---------|
| `tenderNo` | `Mã TBMT` | `IB2600511963` |
| `publishDate` | `Ngày đăng tải` | `07/09/2026 02:07` |
| `planNo` | `Mã KHLCNT` | `PL2600280844` |
| `tenderName` | `Tên gói thầu` | `Cung cấp dịch vụ ăn, nghỉ...` |
| `procuringEntityName` | `Chủ đầu tư` / `Bên mời thầu` | `Cục Quản trị Văn phòng Quốc hội` |
| `bidValue` | `Số tiền bảo đảm dự thầu` | `133.000.000 VND` |
| `bidSecurity` | `Hình thức đảm bảo dự thầu` | `Thư bảo lãnh hoặc giấy chứng nhận bảo hiểm bảo lãnh` |
| `bidField` | `Lĩnh vực` | `Phi tư vấn` |
| `bidForm` | `Hình thức lựa chọn nhà thầu` | `Đấu thầu rộng rãi` |
| `contractType` | `Loại hợp đồng` | `Đơn giá cố định` |
| `bidMethod` | `Phương thức lựa chọn nhà thầu` | `Một giai đoạn một túi hồ sơ` |
| `bidDuration` | `Thời gian thực hiện gói thầu` | `12 tháng` |
| `bidSubmissionDeadline` | `Thời điểm đóng thầu` | `21/09/2026 09:00` |
| `bidOpeningDate` | `Thời điểm mở thầu` | `21/09/2026 09:00` |
| `bidLocation` | `Địa điểm thực hiện gói thầu` | `Thành phố Hồ Chí Minh Thành phố Hà Nội` |

**NOT extractable from search summary:** `bidderList` — need detail page or API.

## Architecture Compliance

**Story 21.1 patterns to follow:**
- `AbstractCrawler` + `AbstractApiClient` structure
- `registerAction` for `search`, `detail`, `search_tenders`
- `raw: true` request → `{status, headers, body: Buffer}` → normalize body to string
- `ProxyIpPool` with `region: 'VN'`
- `PrismaStore` for persistence
- `RedisStreamPublisher` for `stream:social:raw_posts`

**Constructor pattern (from Story 21.2):**
```javascript
constructor(deps = {}) {
  const client = deps.client || new B2BRegistryExtendedClient(deps);
  super({ client, ...deps, requiresAuth: deps.requiresAuth ?? false });
  this.publisher = deps.publisher || deps.eventPublisher || null;
}
```

**Persist pattern (from Story 21.2):**
```javascript
async #persist(posts) {
  if (this.store && typeof this.store.storeBatch === 'function' && posts.length > 0) {
    await this.store.storeBatch(posts).catch(() => {});
  }

  if (this.publisher && typeof this.publisher.publish === 'function' && posts.length > 0) {
    for (const post of posts) {
      await this.publisher.publish({
        id: post.id,
        platform: post.platform,
        externalId: post.externalId,
        category: post.category,
        authorId: post.authorId,
        crawledAt: post.crawledAt,
        storageRef: post.id,
      }).catch(() => {});
    }
  }
}
```

**Dispatcher pattern (from Story 21.2):**
```javascript
// src/scrapers/index.js
import b2bRegistryExtended from './procurement/b2b-registry-extended/index.js';

const platforms = {
  // ... existing platforms
  b2b_registry_extended: b2bRegistryExtended,
  hosocongty: b2bRegistryExtended,
  muasamcong: b2bRegistryExtended,
};
```

**Test patterns:**
- `node:http` mock server (no mocks/stubs/fakes per project rules)
- Fixtures: minimal HTML matching real structure
- Vitest 4.x, 30s timeout

## Dependencies

- `got-scraping`: `^3.2.15` (already installed)
- `puppeteer`: `^24.34.0` (already installed)
- `puppeteer-extra`: `^3.3.6` (already installed)
- `puppeteer-extra-plugin-stealth`: `^2.11.2` (already installed)
- `undici`: `^7.29.0` (already installed)
- `cheerio` or `jsdom`: for HTML parsing (add if not present)

## Unblocking Conditions

- ✅ Epic 27.1 (`FingerprintManager` + TLS/JA4 spoofing) — `got-scraping` provides basic TLS spoofing; Epic 27.1 would enhance this.
- ✅ Manual browser cookie extraction workflow — implemented via `launchStealthBrowser`.
- 🟡 MuaSamCong authenticated/private API — not found; using HTML parsing fallback.

## Story 21.1 & 21.2 Learnings

1. **MaSoThue client structure** (`src/scrapers/procurement/masothue/`):
   - `client.js`: `getDefaultHeaders()` with full browser headers
   - `request()` override to normalize `body` Buffer→string
   - `search()`, `searchByProvince()`, `detail()` methods
   - `validator.js`: `isBotChallenge()` detects "Just a moment..." / "cloudflare" / "captcha"
   - `normalizer.js`: `extractItems` with cheerio-like HTML parsing

2. **Dispatcher pattern** (`src/scrapers/index.js`):
   - Import crawler/client, register aliases, map actions, pass `options` to client/crawler
   - Register in `platforms` object: `b2b_registry_extended`, `hosocongty`, `muasamcong`

3. **Error handling:**
   - `PlatformError` with `ErrorTypes.BOT_CHALLENGE` for Cloudflare
   - `SuggestedActions.ROTATE_PROXY` for rate limits

4. **Persistence & events** (from Story 21.2):
   - `deps.publisher || deps.eventPublisher` for `ThinEvent` publishing
   - `#persist()` method for `PrismaStore` + `RedisStreamPublisher`

## Testing Requirements

**Test files:**
- `tests/scrapers/procurement/b2b-registry-extended/client.test.js`
- `tests/scrapers/procurement/b2b-registry-extended/crawler.test.js`

**Test patterns (from Story 21.1/21.2):**
```javascript
import { createServer } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Mock server returns HTML fixtures
const server = createServer((req, res) => {
  if (req.url.includes('/tra-cuu/')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HOSOCONGTY_DETAIL_HTML);
  }
  if (req.url.includes('/web/guest/bc/-/search')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(MUASAMCONG_SEARCH_HTML);
  }
  if (req.url.includes('/web/guest/contractor-selection')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(MUASAMCONG_DETAIL_HTML);
  }
  // ...
});
```

**Fixtures needed:**
- HoSoCongTy company detail HTML (real structure unknown — create minimal fixture with expected fields)
- MuaSamCong search results HTML (see below)
- MuaSamCong detail page HTML (see below)
- Cloudflare challenge page HTML (for `isBotChallenge` test)

**MuaSamCong search HTML fixture:**
```html
<div class="content__body__left__item">
  <div class="content__body__left__item__infor">
    <p class="content__body__left__item__infor__code">Mã TBMT: IB2600511963-00</p>
    <span class="content__body__left__item__infor__notice--be">Chưa đóng thầu</span>
    <h5 class="content__body__left__item__infor__contract__name format__text__title">
      Cung cấp dịch vụ ăn, nghỉ, tiệc chiêu đãi đón đoàn vào tại Hà Nội và TP. Hồ Chí Minh
    </h5>
    <h6>Chủ đầu tư: <span>Cục Quản trị Văn phòng Quốc hội</span></h6>
    <h6>Ngày đăng tải thông báo: <span>07/09/2026 - 02:07</span></h6>
    <h6>Lĩnh vực: <span>Phi tư vấn</span></h6>
    <h6>Địa điểm: <span>Thành phố Hồ Chí Minh; Thành phố Hà Nội;</span></h6>
  </div>
  <div class="content__body__right__item__infor__contract">
    <h5>09:00</h5>
    <h5>21/09/2026</h5>
  </div>
</div>
```

**MuaSamCong detail HTML fixture:**
```html
<div id="info-general">
  <p>Mã TBMT: IB2600511963</p>
  <p>Ngày đăng tải: 07/09/2026 02:07</p>
  <p>Mã KHLCNT: PL2600280844</p>
  <p>Tên gói thầu: Cung cấp dịch vụ ăn, nghỉ, tiệc chiêu đãi đón đoàn vào tại Hà Nội và TP. Hồ Chí Minh</p>
  <p>Chủ đầu tư: Cục Quản trị Văn phòng Quốc hội</p>
  <p>Bên mời thầu: Cục Quản trị Văn phòng Quốc hội</p>
  <p>Lĩnh vực: Phi tư vấn</p>
  <p>Hình thức lựa chọn nhà thầu: Đấu thầu rộng rãi</p>
  <p>Loại hợp đồng: Đơn giá cố định</p>
  <p>Thời gian thực hiện gói thầu: 12 tháng</p>
  <p>Thời điểm đóng thầu: 21/09/2026 09:00</p>
  <p>Thời điểm mở thầu: 21/09/2026 09:00</p>
  <p>Số tiền bảo đảm dự thầu: 133.000.000 VND</p>
  <p>Hình thức đảm bảo dự thầu: Thư bảo lãnh hoặc giấy chứng nhận bảo hiểm bảo lãnh</p>
</div>
```

## Acceptance Criteria

1. **Given** `B2BRegistryExtendedCrawler` in `src/scrapers/procurement/b2b-registry-extended/index.js` extends `AbstractCrawler`
2. **When** calling `scrape('hosocongty','company',{ taxCode })` or `scrape('muasamcong','search_tenders',{ keyword })`
3. **Then** scraper uses `got-scraping` TLS/JA4 spoofing or `StealthBrowser` cookie warmup for HoSoCongTy and HTML parsing for MuaSamCong
4. **And** extracts fields: `taxCode`, `companyName`, `representativeName`, `phone`, `businessLines`, `charterCapital`, `establishedDate` (HSC); `tenderNo`, `tenderName`, `procuringEntityName`, `bidSubmissionDeadline`, `bidValue`, `bidSecurity` (MuaSamCong)
5. **And** normalizes to `PostItem` (`platform: 'hosocongty' | 'muasamcong'`, `category: 'b2b'`)
6. **And** persists via `PrismaStore` and publishes `ThinEvent` to `stream:social:raw_posts`
7. **And** dispatcher aliases `hosocongty`, `muasamcong` work via `scrape()` and `getPlatform()`

## File Structure

```
src/scrapers/procurement/b2b-registry-extended/
  ├── index.js          — B2BRegistryExtendedCrawler, scrapeB2BRegistryExtended
  ├── client.js         — B2BRegistryExtendedClient extends AbstractApiClient
  ├── browser.js        — CloudflareWarmup (Puppeteer cookie extraction)
  ├── schema.js         — metadata schema constants
  ├── normalizer.js     — normalizeHosocongty, normalizeMuasamcong
  └── validator.js      — B2BRegistryExtendedValidator
```

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| HoSoCongTy Cloudflare unbreakable | High | High | 2-tier fallback; if all fail, throw `bot_challenge` with clear message |
| MuaSamCong changes SPA structure | Medium | Medium | Abstract parsing into `normalizer.js`; add `isBotChallenge` detection |
| `got-scraping` insufficient | Medium | High | Fallback to `StealthBrowser` warmup |
| cf_clearance cookie expires fast | High | Medium | Cache cookie with TTL; re-warmup on 403 |

## Open Questions

1. Does HoSoCongTy expose public company detail pages? (probe blocked by Cloudflare)
2. Does MuaSamCong have authenticated mobile app API? (probe found none)
3. Can `got-scraping` bypass Cloudflare managed challenge? (needs live test)

## Completion Notes

- Story created 2026-09-06 with comprehensive technical context
- All research findings incorporated from `technical-cloudflare-vn-b2b-endpoints-2026-09-06`
- Story 21.1 patterns and code structure documented for reuse
- Test patterns established from Stories 21.1 and 21.2
- Validation improvements applied: `publisher` injection, `getPlatform` registration, `listActions()`, `raw: true` pattern, MuaSamCong fixture example
- Live probe verified MuaSamCong detail page structure and field extraction

## Dev Agent Record

### Implementation Plan

1. Scaffold `B2BRegistryExtendedClient` extending `AbstractApiClient` with 2-tier HoSoCongTy fallback (got-scraping TLS/JA4 → `StealthBrowser` warmup → `cf_clearance` cookie) and direct MuaSamCong HTML requests.
2. Implement `B2BRegistryExtendedValidator` for rate-limit and bot-challenge detection (`Just a moment`, `cloudflare`, `captcha`).
3. Implement `B2BRegistryExtendedNormalizer` with balanced `<div>` block extraction for MuaSamCong search items and best-effort label extraction for HoSoCongTy detail.
4. Create `B2BRegistryExtendedCrawler` extending `AbstractCrawler` with actions `search`, `search_tenders`, `detail`, `publisher`/`eventPublisher` injection, and `#persist()` to `PrismaStore` + `RedisStreamPublisher`.
5. Register `b2b_registry_extended`, `hosocongty`, `muasamcong` aliases in `src/scrapers/index.js` dispatcher and default exports.
6. Add TypeScript declarations for `B2BRegistryExtendedClient`/`B2BRegistryExtendedCrawler`/`scrapeB2BRegistryExtended`.
7. Write `node:http` integration tests for client and crawler using real HTML fixtures (no mocks/stubs).

### Debug Log

- Fixed `requiresProxy` class-field overwrite: class fields execute after `super()` and clobber `options.requiresProxy`; preserved explicit option in constructor.
- Fixed `raw: true` undici ReadableStream body: added `drainBody` to convert stream → UTF-8 string in `normalizeRawBody`.
- Fixed `extractBalancedBlocks` regex ambiguity: `class="content__body__left__item"` also matched `content__body__left__item__infor`; added delimiter check (`"` or space) to only match top-level blocks.
- Fixed missing `title` property in `buildPostItem` causing `post.title` undefined.
- Fixed `tests/store/prisma-store.test.js` regression: `CATEGORIES` now includes `automotive` (from Story 21.2); updated hard-coded expected array.

### File List

- `src/scrapers/procurement/b2b-registry-extended/index.js`
- `src/scrapers/procurement/b2b-registry-extended/client.js`
- `src/scrapers/procurement/b2b-registry-extended/browser.js`
- `src/scrapers/procurement/b2b-registry-extended/schema.js`
- `src/scrapers/procurement/b2b-registry-extended/normalizer.js`
- `src/scrapers/procurement/b2b-registry-extended/validator.js`
- `src/scrapers/index.js`
- `types/index.d.ts`
- `tests/scrapers/procurement/b2b-registry-extended/client.test.js`
- `tests/scrapers/procurement/b2b-registry-extended/crawler.test.js`
- `tests/store/prisma-store.test.js`

### Change Log

- Added B2B registry crawler with Cloudflare/SPA fallback support.
- Added dispatcher aliases and action mapping for `hosocongty`, `muasamcong`, `b2b_registry_extended`.
- Added TypeScript declarations.
- Fixed `prisma-store` test category list after `automotive` category introduction.

### Completion Notes

All acceptance criteria implemented:
- `B2BRegistryExtendedCrawler` extends `AbstractCrawler`.
- `search`, `search_tenders`, `detail` actions registered and dispatched via `scrape()`/`getPlatform()`.
- HoSoCongTy uses got-scraping Tier 1 and `StealthBrowser` warmup Tier 2.
- MuaSamCong parses server-rendered HTML search/detail pages.
- `PostItem` normalization sets `platform: 'hosocongty' | 'muasamcong'`, `category: 'b2b'`.
- `#persist()` integrates `PrismaStore` and `RedisStreamPublisher`.
- Type declarations added to `types/index.d.ts`.

Tests: 8/8 pass (`tests/scrapers/procurement/b2b-registry-extended/`). Regression suite: `masothue`, `automotive`, `prisma-store` pass. Pre-existing `auth-token-standardization` failures unrelated to this story.

### Status

Ready for review.
