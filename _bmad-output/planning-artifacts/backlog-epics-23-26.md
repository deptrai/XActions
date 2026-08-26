---
title: "Backlog — Epics 23–26: Universal AbstractCrawler Migration, Dispatcher Unification & Legacy Decommission"
created: 2026-08-26
status: backlog
reason: "Phase 4 (Epics 10–20) covers Twitter/X, Facebook, Threads, TikTok, Shopee, E-Commerce, Real Estate, HR/B2B, Admin, and Nowing cutover. These epics complete the universalization of the entire XActions scraper layer under one AbstractCrawler architecture."
---

# Backlog — Epics 23–26

> **Created during the Implementation Readiness re-run on 2026-08-26.**
> These epics ensure **every platform and scraper in XActions** — including Bluesky, Mastodon, legacy utility scripts, and adapters — eventually runs through `AbstractCrawler` / `AbstractApiClient` / `CrawlerCommand`.
> They are intentionally placed **outside Phase 4** to avoid resetting the Phase 4 `READY` status. They can start in parallel once Epic 13 (hybrid engine) is stable.

---

## Cross-Epic Dependency Map

```
Epic 20.2 (Legacy decommission) ─┐
                                 ├──→ Epic 26 (Final legacy removal)
Epic 23 (Bluesky/Mastodon) ──────┤
Epic 24 (Utility/Adapters) ──────┤
                                 │
                                 ↓
                         Epic 25 (Unified dispatcher)
```

- **Epic 23** and **Epic 24** can run in parallel after Epic 13.1 (Tiered Signer) and 13.3 (Facebook hybrid) are done.
- **Epic 25** depends on 23, 24, and Phase 4 integration stories (13.2.12, 13.10, 15.1.4).
- **Epic 26** depends on 25 and the original Epic 20.2 decommission conditions (shadow-run parity ≥ 99% for 7 days).

---

## Epic 23: Bluesky & Mastodon on AbstractCrawler

> **Epic grouping note:** This is a *platform suite* for two HTTP-only, no-JS platforms. Both use public REST/AT Protocol APIs and require no Puppeteer, making them ideal candidates to validate the `AbstractApiClient` + `AbstractCrawler` pattern for lightweight platforms.

### Story 23.1: Bluesky AT Protocol Client
As a **Platform Scraper Developer**,  
I want **a `BlueskyClient` in `src/scrapers/social/bluesky/client.js` that extends `AbstractApiClient`**,  
So that **all Bluesky HTTP calls go through the same resilient request pipeline (proxy, governor, 429/403 handling, TLS spoofing) as Twitter and Facebook**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` in `src/core/base-client.js`
* **When** implementing `BlueskyClient extends AbstractApiClient`
* **Then** `BlueskyClient` sets `name = 'bluesky'`, `platform = 'bluesky'`, `requiresAuth = false`
* **And** default `service = 'https://public.api.bsky.app'`
* **And** supports optional auth (`identifier`/`password`) for non-public data
* **And** all `request()` calls pass through `governor.recordRequest()` and proxy rotation
* **And** response is validated by a `BlueskyPlatformResponseValidator` (Story 23.5)
* **And** reuses `ProxyIpPool` and `AccountPool` contracts without platform-specific side-loading

### Story 23.2: Bluesky Hybrid Crawler
As a **Bluesky Growth Marketer**,  
I want **cào profile, followers, following, user feed, search, và feed của Bluesky qua `BlueskyCrawler` kiến trúc hybrid**,  
So that **tôi có thể phân tích audience và nội dung trên Bluesky với cùng một `CrawlerCommand` interface như Twitter/X**.

**Acceptance Criteria:**
* **Given** `BlueskyCrawler` in `src/scrapers/social/bluesky/crawler.js` extends `AbstractCrawler`
* **When** gọi `profile({ username })`, `followers({ username, limit })`, `following({ username, limit })`, `get_user_feed({ username, limit })`, `search({ query, limit })`, `scrape_feed({ feedUri, limit })`
* **Then** crawler dispatches through `BlueskyClient` and paginates with `cursor`
* **And** dữ liệu trả về chuẩn hóa theo `ProfileItem` / `PostItem` với ID Namespaced `bluesky:${uri|handle}`
* **And** supports `onProgress` callback
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing`, `scrapeTweets`, `searchTweets`, `scrapeFeed` trong `src/scrapers/bluesky/index.js` (legacy); cập nhật `docs/deprecation-plan.md`.

### Story 23.3: Mastodon REST API Client
As a **Platform Scraper Developer**,  
I want **a `MastodonClient` in `src/scrapers/social/mastodon/client.js` that extends `AbstractApiClient`**,  
So that **Mastodon scraping uses the same governor, proxy, and retry pipeline as every other platform**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` in `src/core/base-client.js`
* **When** implementing `MastodonClient extends AbstractApiClient`
* **Then** `MastodonClient` sets `name = 'mastodon'`, `platform = 'mastodon'`, `requiresAuth = false`
* **And** default `instance = 'https://mastodon.social'` nhưng configurable
* **And** supports optional `accessToken` cho authenticated endpoints
* **And** all REST calls pass through `governor.recordRequest()` and proxy rotation
* **And** response is validated by a `MastodonPlatformResponseValidator` (Story 23.5)
* **And** HTML-to-plain-text decoding logic (`toPlainText`) is moved to `MastodonClient` normalization helper, not duplicated

### Story 23.4: Mastodon Hybrid Crawler
As a **Mastodon Instance Analyst**,  
I want **cào profile, followers, following, timeline, search, hashtag, và trending của Mastodon qua `MastodonCrawler` kiến trúc hybrid**,  
So that **tôi theo dõi nội dung và mối quan hệ trên bất kỳ Mastodon instance nào từ một interface thống nhất**.

**Acceptance Criteria:**
* **Given** `MastodonCrawler` in `src/scrapers/social/mastodon/crawler.js` extends `AbstractCrawler`
* **When** gọi `profile({ username, instance })`, `followers({ username, limit, instance })`, `following({ username, limit, instance })`, `get_user_feed({ username, limit, instance })`, `search({ query, limit, instance })`, `hashtag({ hashtag, limit, instance })`, `trending({ limit, instance })`
* **Then** crawler dispatches through `MastodonClient` với `instance` parameter
* **And** dữ liệu trả về chuẩn hóa theo `ProfileItem` / `PostItem` với ID Namespaced `mastodon:${instance}:${id}`
* **And** supports `onProgress` callback
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing`, `scrapeTweets`, `searchTweets`, `scrapeHashtag`, `scrapeTrending` trong `src/scrapers/mastodon/index.js` (legacy); cập nhật `docs/deprecation-plan.md`.

### Story 23.5: Bluesky & Mastodon Response Validators
As a **Reliability Engineer**,  
I want **`BlueskyPlatformResponseValidator` và `MastodonPlatformResponseValidator` implement `AbstractPlatformResponseValidator`**,  
So that **crawler biết phân biệt lỗi mạng, rate-limit, auth failure, và payload không hợp lệ cho từng platform**.

**Acceptance Criteria:**
* **Given** `AbstractPlatformResponseValidator` trong `src/core/platform-validator.js`
* **When** tạo `BlueskyPlatformResponseValidator` và `MastodonPlatformResponseValidator`
* **Then** mỗi validator implement `isValidPayload(response)`, `isBotChallenge(response)`, `isRateLimit(response)`, `isAuthExpired(response)`
* **And** Mastodon validator nhận diện HTTP 401/403/429 và JSON error body
* **And** Bluesky validator nhận diện `error` field trong AT Protocol response
* **And** cả hai trả về `SuggestedActions` phù hợp (`ROTATE_PROXY`, `WAIT`, `RELOGIN`, `SKIP`)

### Story 23.6: Bluesky & Mastodon Integration & Caller Migration
As a **XActions Platform Engineer**,  
I want **`scrape('bluesky'|'mastodon', ...)` và tất cả caller chuyển sang `BlueskyCrawler`/`MastodonCrawler` mới**,  
So that **người dùng cuối không còn phụ thuộc `src/scrapers/bluesky/index.js` và `src/scrapers/mastodon/index.js` cũ**.

**Acceptance Criteria:**
* **Given** `BlueskyCrawler` và `MastodonCrawler` hỗ trợ đủ action (profile, followers, following, feed, search, hashtag, trending)
* **When** kiểm tra `src/scrapers/index.js`
* **Then** platform `bluesky`/`mastodon` import từ `src/scrapers/social/bluesky/index.js` / `src/scrapers/social/mastodon/index.js` thay vì legacy
* **And** `package.json` exports thêm `./scrapers/social` hoặc cập nhật `./scrapers/bluesky` / `./scrapers/mastodon` để consumer truy cập `BlueskyClient`/`BlueskyCrawler` / `MastodonClient`/`MastodonCrawler`
* **And** MCP tools / CLI commands gọi `scrape('bluesky'|'mastodon', action, args)` thay vì import trực tiếp
* **And** `tests/scrapers/bluesky-*.test.js` và `tests/scrapers/mastodon-*.test.js` chuyển sang test `BlueskyCrawler`/`MastodonCrawler`
* **And (Scope & Deprecation Marker)** cập nhật `docs/deprecation-plan.md` status tracker sang `deprecated-planned` cho Bluesky/Mastodon legacy.

---

## Epic 24: Utility Scripts & Adapters Migration

> **Epic grouping note:** This epic is a *cleanup & consolidation* epic. It does not add user-facing features; it removes technical debt and aligns leftover `src/scrapers/` modules with the single architecture.

### Story 24.1: Inventory & Deprecation Decision for Standalone Scripts
As a **Platform Scraper Developer**,  
I want **một inventory đầy đủ các file `src/scrapers/*.js` độc lập và `src/scrapers/adapters/`**,  
So that **team quyết định rõ ràng: convert thành action, archive, hoặc xoá từng file**.

**Acceptance Criteria:**
* **Given** các file: `bookmarkExporter.js`, `showMoreExpander.js`, `threadUnroller.js`, `videoDownloader.js`, `viralTweets.js`, `index.js`, `index.d.ts`, và toàn bộ `src/scrapers/adapters/`
* **When** chạy audit
* **Then** đầu ra là `docs/utility-script-audit-23-24.md` với bảng:
  - Tên file
  - Mô tả chức năng
  - Context dùng (browser console / Node.js / CLI / MCP)
  - Quyết định: `convert-to-action` / `archive` / `delete` / `keep`
  - Story chịu trách nhiệm (24.2 hoặc 24.4)

### Story 24.2: Browser Utility Features as Crawler Actions
As a **Content Operator**,  
I want **các tính năng từ `videoDownloader.js`, `bookmarkExporter.js`, `threadUnroller.js` có sẵn dưới dạng `CrawlerCommand` trong `TwitterCrawler`**,  
So that **tôi có thể gọi chúng từ CLI/MCP thay vì dán script vào console**.

**Acceptance Criteria:**
* **Given** quyết định từ Story 24.1
* **When** triển khai
* **Then** `TwitterCrawler` thêm các action: `download_video({ tweetId, quality })`, `export_bookmarks({ username, limit })`, `unroll_thread({ tweetId })`
* **And** mỗi action trả về `PostItem[]` hoặc `Buffer`/`ReadableStream` cho download
* **And** legacy file được gắn `@deprecated` với ghi chú thay thế
* **And** CLI/MCP expose `xactions download video <tweetId>` và `xactions export bookmarks <username>`

### Story 24.3: Adapter Layer Consolidation
As a **Platform Scraper Developer**,  
I want **`src/scrapers/adapters/` được thu gọn thành adapter provider cho `AbstractApiClient`**,  
So that **không còn 7 adapter khác nhau mà chỉ còn những cái thực sự cần cho CDP/HTTP/Playwright**.

**Acceptance Criteria:**
* **Given** `src/scrapers/adapters/` gồm: `base.js`, `cheerio.js`, `crawlee.js`, `got-jsdom.js`, `http.js`, `playwright.js`, `puppeteer.js`, `selenium.js`
* **When** audit từ Story 24.1
* **Then** giữ lại tối đa 3 adapter: `http.js` (`undici`/`got-scraping` + TLS spoofing), `playwright.js`/`puppeteer.js` (CDP attach), `base.js` (contract)
* **And** `AbstractApiClient` chọn adapter qua config `adapter: 'http' | 'playwright' | 'puppeteer'`
* **And** các adapter cũ (`selenium`, `cheerio`, `crawlee`, `got-jsdom`) được chuyển vào `archive/` hoặc xoá nếu không còn import
* **And** `npm run typecheck` pass sau khi xoá

### Story 24.4: Archive or Remove Unused Scraper Modules
As a **Codebase Maintainer**,  
I want **các file được đánh dấu `archive` trong audit đã được chuyển ra khỏi `src/scrapers/`**,  
So that **`src/scrapers/` chỉ còn `social/` dispatcher và platform crawlers**.

**Acceptance Criteria:**
* **Given** `docs/utility-script-audit-23-24.md`
* **When** thực hiện Story 24.4
* **Then** các file được chuyển vào `archive/scrapers/` hoặc `scripts/`
* **And** `package.json` exports không còn trỏ tới các file đã archive
* **And** `README.md` cập nhật vị trí mới của các script dán console
* **And** `npm test` pass; không còn dead imports

---

## Epic 25: Unified Dispatcher & Public API Finalization

> **Epic grouping note:** This is the *glue* epic. It makes `scrape(platform, action, args)` the single entry point for all internal and external callers.

### Story 25.1: Universal `scrape()` Dispatcher
As a **XActions Platform Engineer**,  
I want **`src/scrapers/index.js` trở thành một thin dispatcher duy nhất cho mọi platform**,  
So that **không còn logic scraper nào nằm ngoài `src/scrapers/social/<platform>/`**.

**Acceptance Criteria:**
* **Given** các crawler trong `src/scrapers/social/twitter/`, `src/scrapers/social/facebook/`, `src/scrapers/social/threads/`, `src/scrapers/social/bluesky/`, `src/scrapers/social/mastodon/`
* **When** gọi `scrape('twitter'|'facebook'|'threads'|'bluesky'|'mastodon', action, args)`
* **Then** dispatcher resolve platform → `AbstractCrawler` instance → gọi `.start({ action, args })`
* **And** dispatcher hỗ trợ dependency injection (`client`, `store`, `governor`, `accountPool`, `proxyPool`)
* **And** legacy `import twitter from './twitter/index.js'` trong `src/scrapers/index.js` bị xoá
* **And** `src/scrapers/social/index.js` export all platform crawlers/clients/validators

### Story 25.2: `package.json` Exports v2
As a **Library Consumer**,  
I want **mọi `package.json` export trỏ tới `src/scrapers/social/` thay vì legacy platform folders**,  
So that **tôi import một kiến trúc ổn định dù tên file legacy đã bị xoá**.

**Acceptance Criteria:**
* **Given** `package.json` hiện tại có `./scrapers/twitter`, `./scrapers/bluesky`, `./scrapers/mastodon`, `./scrapers/threads`
* **When** cập nhật
* **Then** `./scrapers` trỏ tới `src/scrapers/index.js` (dispatcher)
* **And** `./scrapers/social` trỏ tới `src/scrapers/social/index.js`
* **And** `./scrapers/<platform>` redirect tới `src/scrapers/social/<platform>/index.js` (nếu giữ tên export)
* **And** `./scrapers/twitter/http` bị xoá hoặc redirect sang `./scrapers/social/twitter/client.js`
* **And** `npm run typecheck` pass

### Story 25.3: MCP / CLI / API Caller Migration
As a **XActions Platform Engineer**,  
I want **tất cả MCP tools, CLI commands, và API routes gọi `scrape()` hoặc `CrawlerCommand` thay vì import scraper cụ thể**,  
So that **không còn coupling trực tiếp với legacy modules**.

**Acceptance Criteria:**
* **Given** `src/mcp/server.js`, `src/cli/commands/`, `api/routes/`
* **When** grep/import audit
* **Then** không còn `import` từ `src/client/Scraper.js`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/`, `src/scrapers/bluesky/`, `src/scrapers/mastodon/`
* **And** tất cả caller gọi `scrape(platform, action, args)` hoặc `CrawlerCommand`
* **And** `unfollowx` commands được map vào `CrawlerCommand` hoặc trả `suggestedAction` (NFR-16)
* **And** tests E2E cho MCP/CLI pass với dispatcher mới

### Story 25.4: Backward Compatibility & Error Mapping
As a **Library Consumer**,  
I want **mã cũ gọi `scrape('twitter', ...)` vẫn hoạt động với `suggestedAction` rõ ràng khi action không còn hỗ trợ**,  
So that **migrations không gây breaking change đột ngột**.

**Acceptance Criteria:**
* **Given** dispatcher mới
* **When** gọi action đã bị loại bỏ hoặc tên platform cũ
* **Then** trả `PlatformError` với `type: ErrorTypes.DEPRECATED`, `suggestedAction` chỉ rõ action/platform thay thế
* **And** `package.json` exports giữ mapping cho ít nhất 1 release cycle
* **And** `docs/deprecation-plan.md` liệt kê mapping đầy đủ từ legacy API → new API

---

## Epic 26: Legacy Decommission Final

> **Epic grouping note:** This is the *decommission* epic. It should only start after shadow-run parity is proven for all migrated platforms.

### Story 26.1: Pre-Decommission Parity & Rollback Preparation
As a **Reliability Engineer**,  
I want **một parity report đầy đủ cho Bluesky/Mastodon/Adapters trước khi xóa legacy code**,  
So that **decommission không gây regression cho consumer cũ**.

**Acceptance Criteria:**
* **Given** Epic 23, 24, 25 done
* **When** chạy shadow-run trong 7 ngày
* **Then** field-level diff giữa legacy (`src/scrapers/bluesky/`, `src/scrapers/mastodon/`, utility scripts) và hybrid (`src/scrapers/social/`) ≤ 1%
* **And** `npm test` pass trên toàn bộ test suite
* **And** `npm run typecheck` pass
* **And** tạo git tag `pre-decommission-YYYY-MM-DD` từ `main`
* **And** `docs/decommission-plan-26.md` ghi rõ danh sách file sẽ xóa và rollback conditions

### Story 26.2: Final Legacy Removal
As a **Codebase Maintainer**,  
I want **xoá toàn bộ legacy scraper modules sau khi parity đạt**,  
So that **XActions chỉ còn một kiến trúc `AbstractCrawler` duy nhất**.

**Acceptance Criteria:**
* **Given** parity ≥ 99% và tag backup đã tạo
* **When** chạy Story 26.2
* **Then** xóa:
  - `src/client/Scraper.js`
  - `src/scrapers/twitter/` (toàn bộ)
  - `src/scrapers/twitter/http/` (toàn bộ)
  - `src/scrapers/facebook/` (toàn bộ)
  - `src/scrapers/threads/index.js` (legacy)
  - `src/scrapers/bluesky/index.js` (legacy)
  - `src/scrapers/mastodon/index.js` (legacy)
  - `src/scrapers/adapters/` (nếu đã consolidate)
  - các utility scripts đã archive
* **And** `package.json` exports cập nhật
* **And** `docs/deprecation-plan.md` status tracker chuyển sang `removed`
* **And** `npm test` pass, `npm run typecheck` pass
* **And** `unfollowx` CLI smoke test pass
* **And** Nowing shadow-run vẫn duy trì parity trong 24h sau merge

---

## Conditions to Start / Reactivate

1. **Epic 13.1 (Tiered Signer)** và **Epic 13.3 (Facebook hybrid)** đã ổn định — `AbstractApiClient` + `AbstractCrawler` pattern đã chứng minh.
2. **Epic 20.1 (Nowing shadow-run)** đang chạy — để có môi trường so sánh parity cho Bluesky/Mastodon.
3. Product Council phê duyệt scope expansion sang Bluesky/Mastodon hoặc chấp nhận để ở backlog.
4. Architecture review xác nhận `AbstractCrawler` không cần thay đổi core để hỗ trợ nền tảng HTTP-only.
5. Legal/compliance review xác nhận public data scraping trên Bluesky/Mastodon tuân thủ Terms of Service.

## Definition of Done for Epics 23–26

- `src/scrapers/social/` chứa tất cả platform crawlers.
- `src/scrapers/index.js` chỉ là dispatcher.
- `src/client/Scraper.js` không còn tồn tại.
- `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/`, `src/scrapers/bluesky/`, `src/scrapers/mastodon/`, `src/scrapers/adapters/` không còn legacy code.
- `package.json` exports ổn định, backward-compatible.
- `npm test` + `npm run typecheck` pass.
- `bmad-check-implementation-readiness` re-run → **READY**.
