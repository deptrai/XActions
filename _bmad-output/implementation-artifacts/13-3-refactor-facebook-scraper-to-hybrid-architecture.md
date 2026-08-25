# Story 13.3: Refactor Facebook Scraper to Hybrid Architecture

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Facebook Community Marketer**,  
I want **cào bài viết nhóm và trang Facebook qua DocID GraphQL requests và Proxy Pool**,  
so that **tôi có thể theo dõi cộng đồng với độ trễ thấp và không bị checkpoint IP**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.3]

## Acceptance Criteria

### AC-1: Kế thừa AbstractCrawler
- **Given** `FacebookCrawler` được triển khai trong `src/scrapers/social/facebook/index.js`
- **When** khởi tạo với `client`, `store`, `sessionManager`, `governor`, `accountPool`, `proxyProvider`
- **Then** `FacebookCrawler` kế thừa `AbstractCrawler`
- **And** đăng ký `ActionRegistry` với các action `group_posts`, `page_posts`, `search` (nếu khả thi)
- **And** `requiresAuth = true`, `name = 'facebook'`, `platform = 'facebook'`
- **And** `listActions()` trả về `ActionDescriptor[]` đúng shape theo AD-11

### AC-2: FacebookClient kế thừa AbstractApiClient
- **Given** `FacebookClient` kế thừa `AbstractApiClient` trong `src/scrapers/social/facebook/client.js`
- **When** gọi `client.request('POST', url, options)` hoặc `client.requestWithSign(...)`
- **Then** request đi qua proxy từ `ProxyIpPool` / `proxyProvider`
- **And** sử dụng `got-scraping` (mặc định) hoặc `undici` theo `options.client`
- **And** retry 429/403, quarantine proxy, rotate account theo pipeline sẵn có trong `AbstractApiClient`

### AC-3: Group Posts
- **Given** `groupId` và session cookies hợp lệ (`c_user`, `xs`)
- **When** gọi `crawler.start({ action: 'group_posts', args: { groupId }, session: { accountId } })`
- **Then** crawler gọi GraphQL endpoint `https://www.facebook.com/api/graphql/` với `doc_id` tương ứng
- **And** trích xuất danh sách bài viết
- **And** chuẩn hóa thành `PostItem[]` với `id: 'facebook:${postId}'`, `platform: 'facebook'`, `category: 'social'`
- **And** tự động lưu vào `PrismaStore` (nếu `store` được cung cấp)

### AC-4: Page Posts
- **Given** `pageId` và session cookies hợp lệ
- **When** gọi `crawler.start({ action: 'page_posts', args: { pageId }, session: { accountId } })`
- **Then** crawler gọi GraphQL endpoint tương tự AC-3 nhưng với `doc_id` của page feed
- **And** trả về `PostItem[]` đã chuẩn hóa và lưu vào `PrismaStore`

### AC-5: Session Cookie Tương Thích
- **Given** session cookies đã mã hóa/lưu trong `SessionManager` / database
- **When** `FacebookClient` gửi request
- **Then** cookies `c_user` và `xs` được serialize vào header `Cookie`
- **And** `fb_dtsg`, `lsd`, `jazoest`, `hsi`, `__spin_r`, `__spin_t` được trích xuất từ home page HTML và đưa vào body GraphQL
- **And** không log giá trị cookie/token (NFR-4)

### AC-6: Proxy & Sticky IP
- **Given** `FacebookClient` được cấu hình với `proxyProvider`/`proxyPool`
- **When** gửi request với `accountId`
- **Then** `AbstractApiClient.resolveProxy()` chọn sticky proxy cho account (nếu `proxyPool.getStickyProxy` tồn tại)
- **And** không fallback về direct connection khi proxy fail (AD-3)

### AC-7: Graceful doc_id Rotation
- **Given** Facebook thay đổi / xoay doc_id
- **When** response trả về shape không mong muốn hoặc lỗi 403/400
- **Then** không throw trực tiếp; trả về `PlatformError` với `suggestedAction: 'retry_after_delay'`
- **And** log warning `⚠️ Facebook doc_id may be rotated` (NFR-7)

### AC-8: Kiểm thử thực (No Mocks)
- **Given** test suite `tests/scrapers/facebook/facebook-crawler.test.js` (hoặc tương đương)
- **When** chạy `npm test`
- **Then** không sử dụng `vi.fn`, mock, stub, fake
- **And** dùng local HTTP server + `StaticProxyProvider` + real `got`/`undici`
- **And** chạy `npm run typecheck` pass

## Tasks / Subtasks

- [ ] T1: Tạo cấu trúc thư mục `src/scrapers/social/facebook/` (AC-1, AC-2)
  - [ ] T1.1: Tạo `src/scrapers/social/index.js` barrel
  - [ ] T1.2: Tạo `src/scrapers/social/facebook/index.js` export `FacebookCrawler`, `FacebookClient`, `FacebookPlatformResponseValidator`
  - [ ] T1.3: Tạo `src/scrapers/social/facebook/client.js`
  - [ ] T1.4: Tạo `src/scrapers/social/facebook/crawler.js` (hoặc đặt trong `index.js`)
  - [ ] T1.5: Tạo `src/scrapers/social/facebook/validator.js` (có thể tái sử dụng/adapt từ `src/scrapers/facebook/validator.js`)
  - [ ] T1.6: Cập nhật `src/index.js` để export `FacebookCrawler` từ `src/scrapers/social/index.js` (không sửa legacy `src/scrapers/index.js`)
- [ ] T2: Triển khai `FacebookClient` (AC-2, AC-5, AC-6)
  - [ ] T2.1: Constructor kế thừa `AbstractApiClient`, nhận `baseUrl`, `docIds`, `cookies`, `proxyProvider`, `governor`, `client='got'`
  - [ ] T2.2: `warmup()` / `ensureTokens(accountId, cookieHeader)` — fetch home page HTML, parse tokens
  - [ ] T2.3: `buildGraphQlBody(docId, variables, tokens)` — trả về `application/x-www-form-urlencoded` string
  - [ ] T2.4: `requestGraphQl(docId, variables, options)` — wrap `this.request()` với đúng headers/body
  - [ ] T2.5: Cache tokens theo `accountId` với TTL (khuyến nghị 5 phút)
- [ ] T3: Triển khai `FacebookCrawler` (AC-1, AC-3, AC-4)
  - [ ] T3.1: Constructor đăng ký `group_posts`, `page_posts`, `search` (nếu khả thi)
  - [ ] T3.2: `groupPosts(args, session)` handler
  - [ ] T3.3: `pagePosts(args, session)` handler
  - [ ] T3.4: Chuẩn hóa response thành `PostItem[]`
  - [ ] T3.5: Gọi `this.store.storeBatch(posts, { upsert: true })` nếu có store
  - [ ] T3.6: `cleanup()` đóng/release client resources
- [ ] T4: Triển khai / tái sử dụng `FacebookPlatformResponseValidator` (AC-7)
  - [ ] T4.1: Tạo `src/scrapers/social/facebook/validator.js`
  - [ ] T4.2: Nhận diện HTML hợp lệ, JSON GraphQL hợp lệ, checkpoint/bot challenge, doc_id rotation
- [ ] T5: Viết tests (AC-8)
  - [ ] T5.1: Tạo `tests/scrapers/facebook/facebook-crawler.test.js` hoặc `tests/scrapers/social/facebook/crawler.test.js`
  - [ ] T5.2: Local server trả về HTML home với tokens và GraphQL JSON
  - [ ] T5.3: Test `group_posts`, `page_posts`, `listActions`, `cleanup`
  - [ ] T5.4: Test proxy quarantine retry với real proxy provider
- [ ] T6: Chạy verification
  - [ ] T6.1: `npm run typecheck`
  - [ ] T6.2: `npm test -- tests/scrapers/social/facebook/`
  - [ ] T6.3: `npm test -- tests/core/` (regression)

## Dev Notes

### Project Structure Notes

- **Target folder mới:** `src/scrapers/social/facebook/` (theo `epics.md` và kiến trúc AD-8).
- **Legacy folder hiện tại:** `src/scrapers/facebook/` chứa Puppeteer-based scraper cũ. **KHÔNG sửa/xoá file legacy** trong story này; chúng sẽ được decommission trong Epic 20.
- **Conflict / variance:**
  - `epics.md` ghi `src/scrapers/social/facebook/index.js`, nhưng repo hiện tại chưa có `src/scrapers/social/`. Quyết định: tạo mới, không di chuyển legacy.
  - `src/scrapers/index.js` (legacy dispatcher) vẫn trỏ `facebook` đến `src/scrapers/facebook/index.js`. Không sửa để tránh break `scrape()` cũ. Thay vào đó export `FacebookCrawler` qua `src/scrapers/social/index.js` và `src/index.js`.

### Core Code State to Preserve

- `AbstractApiClient.request()` ở `src/core/base-client.js` **hiện đang có fallback direct connection** khi `provider` rỗng (do `provider || opts.requiresResidential ? this.resolveProxy(...) : null`) [Source: `src/core/base-client.js:534-536`].  
  **Yêu cầu:** `FacebookClient` **bắt buộc** phải được cấu hình `proxyProvider`/`proxyPool` vì `requiresAuth=true` và Facebook là auth-required platform. Không được để rơi vào `proxy = null`.
- `AbstractApiClient.requestWithSign()` **không merge `signResult.body` vào `mergedOptions.body`**. Nó chỉ merge `headers`, `query`, `cookies`, và `signature` [Source: `src/core/base-client.js:359-468`].  
  **Yêu cầu:** Đối với GraphQL `application/x-www-form-urlencoded`, hãy xây dựng body string trong `FacebookClient` method rồi gọi `this.request()` trực tiếp với `options.body` và `options.headers['content-type']`. Hoặc sử dụng `tokenRing` cho `lsd` nếu design, nhưng vẫn phải tự build phần body còn lại.
- `AbstractApiClient.#normalizeRequestBody()` chỉ `JSON.stringify` body object khi `content-type` chứa `json`. Với `application/x-www-form-urlencoded`, object sẽ không được serialize đúng [Source: `src/core/base-client.js:746-757`].  
  **Yêu cầu:** Truyền `body` là string `new URLSearchParams(form).toString()`.
- `AbstractCrawler.start()` tự động resolve `accountId` từ `command.session.accountId` hoặc `this.accountPool.getNextAvailable()`, kiểm tra `governor`, rồi gọi handler với `(args, session)` [Source: `src/core/base-crawler.js:149-243`].  
  **Yêu cầu:** Handler lấy cookies từ `this.sessionManager.get(accountId)` và truyền vào client (qua `client.updateCookies()` hoặc `options.headers.cookie`).

### Authentication & Token Handling

- Facebook GraphQL yêu cầu:
  - **Cookies:** `c_user`, `xs` (session auth).
  - **Form/Query tokens:** `lsd`, `fb_dtsg`, `jazoest`, `hsi`, `__spin_r`, `__spin_t`, `__rev`.
  - **Static/rotating:** `doc_id` (hardcoded per query type), `__a=1`, `__req=...`, `__comet_req=15`, `fb_api_caller_class=RelayModern`, `fb_api_req_friendly_name`, `server_timestamps=true`.
- Chiến lược token:
  1. `FacebookClient.warmup(accountId, cookies)` gọi `GET ${baseUrl}` với header `Cookie`.
  2. Parse HTML response (string) bằng regex tương tự `src/scrapers/facebook/graphql.js:469-483` [Source: `src/scrapers/facebook/graphql.js:469-483`].
  3. Cache tokens theo `accountId` (Map) với TTL ~5 phút.
  4. Build `application/x-www-form-urlencoded` body bao gồm tất cả token + `doc_id` + `variables`.
- Nếu dùng `tokenRing` cho `lsd`: refill `PreSignedTokenRing` từ cache tokens (chỉ cần 1 `lsd` nếu nó ổn định trong session). `requestWithSign(..., { signType: 'token', location: 'query', name: 'lsd' })` có thể dùng cho một số endpoint, nhưng không bắt buộc.

### Anti-Bot & Error Handling

- Sử dụng `FacebookPlatformResponseValidator` (mới hoặc adapt từ `src/scrapers/facebook/validator.js`) để phát hiện bot challenge, checkpoint, payload rỗng.
- `AbstractApiClient` tự xử lý 429/403 proxy quarantine [Source: `src/core/base-client.js:641-688`].
- Đối với `doc_id` rotation: nếu response không parse được JSON hợp lệ hoặc `data` tree không có trường mong đợi, **KHÔNG throw panic**; trả về `PlatformError` với `code: 'XACT_5000'`, `suggestedAction: 'retry_after_delay'`, `type: ErrorTypes.INTERNAL` (NFR-7).

### Data Normalization

- `PostItem.id` = `facebook:${postId}` (e.g., `facebook:1234567890`).
- `PostItem.category` = `'social'`.
- `PostItem.platform` = `'facebook'`.
- `PostItem.authorId`, `authorName` lấy từ `node.author.id` / `node.author.name` của GraphQL response.
- `PostItem.content` = text của post; `mediaUrls` = danh sách ảnh/video.
- `PostItem.likesCount`, `repliesCount`, `repostsCount`, `viewsCount` parse từ `feedback` nếu có.
- `PostItem.postUrl` dạng `https://www.facebook.com/groups/{groupId}/posts/{postId}` hoặc `https://www.facebook.com/{pageId}/posts/{postId}`.
- Lưu qua `this.store.storeBatch(posts, { upsert: true })` nếu `this.store` tồn tại [Source: `src/store/prisma-store.js:180-220`].

### Testing Strategy

- **No mocks, no `vi.fn`, no fake HTTP clients.** [Source: `AGENTS.md`, `CLAUDE.md`]
- Cung cấp test seam `baseUrl` trong `FacebookClient` constructor (default `https://www.facebook.com`). Tests set `baseUrl = 'http://localhost:<port>'`.
- Dùng `http.createServer` trong test để:
  - Trả về HTML home chứa `lsd`, `fb_dtsg`, `jazoest`, `hsi`, `__spin_r`, `__spin_t`.
  - Trả về JSON GraphQL hợp lệ cho `/api/graphql/`.
- Dùng `StaticProxyProvider` + real proxy (có thể là local SOCKS hoặc `ProxyIpPool`) để kiểm tra proxy pipeline.
- Cấu hình `FacebookClient` với `client = 'got'` để test form-urlencoded body dễ hơn.

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 18, JSDoc + `npm run typecheck` (`tsc --noEmit`).
- **HTTP Client:** `got-scraping` mặc định (`client: 'got'`) vì hỗ trợ `proxyUrl` string và `application/x-www-form-urlencoded` body string tốt. `undici` optional.
- **Proxy:** `ProxyIpPool` hoặc `StaticProxyProvider` từ `src/proxy/index.js`. Auth-required platforms bắt buộc sticky proxy per account.
- **Browser / Signer:** Không bắt buộc mở browser cho mỗi request. Dùng HTTP-only để fetch home page HTML, parse tokens. Nếu cần ký động, dùng `SignerWorkerPagePool` (đã hoàn thiện ở Story 13.1), nhưng không phải AC của story này.
- **Cookie serialization:** Tự động bởi `AbstractApiClient` từ `this.cookies`. Nếu truyền `options.headers.cookie` thì `this.cookies` không bị ghi đè.

## Architecture Compliance

| AD | Rule | Implementation |
|----|------|----------------|
| AD-1 | Tiered Hybrid Signer | Sử dụng `PreSignedTokenRing` cho `lsd` nếu cần; `SignerWorkerPagePool` cho ký động nếu cần; HTTP client cho fetch chính. |
| AD-2 | Unified Base Interfaces | `FacebookCrawler` extends `AbstractCrawler`; `FacebookClient` extends `AbstractApiClient`. |
| AD-3 | Sticky IP per account | `FacebookClient.requiresAuth = true`; `resolveProxy` ưu tiên `proxyPool.getStickyProxy(accountId)`. Không direct fallback. |
| AD-4 | Namespaced PostgreSQL | `PostItem.id = 'facebook:${postId}'`; lưu `PrismaStore` với `category: 'social'`. |
| AD-8 | Multi-Domain Expansion | File mới trong `src/scrapers/social/facebook/`. Legacy `src/scrapers/facebook/` không đụng. |
| AD-9 | GraphQL layer tách riêng | Tách `client.js` (HTTP + tokens) và `crawler.js` (normalize + store). Có thể tách thêm `graphql.js` nếu cần. |
| AD-11 | ActionRegistry | Action names `group_posts`, `page_posts`, `search` (snake_case). `listActions()` trả về `ActionDescriptor`. |
| AD-12 | CrawlCheckpoint | Optional: dùng `CrawlCheckpoint` để lưu cursor phân trang nếu response có `page_info.end_cursor`. Không bắt buộc cho MVP. |
| AD-14 | Error Envelope | Mọi lỗi trả về `PlatformError` với `code`, `type`, `suggestedAction`. |

## Library & Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| `got-scraping` | `^3.2.15` | HTTP client default, TLS/JA4 spoofing, proxy `proxyUrl`, header generator. [Source: `package.json:119`] |
| `undici` | `^7.29.0` | HTTP client fallback; `ProxyAgent`/`Socks5ProxyAgent`. [Source: `package.json:141`] |
| `p-limit` | `^7.2.0` | Giới hạn concurrency nếu cần batch nhiều request. [Source: `package.json:128`] |
| `playwright` | `^1.62.1` | Chỉ dùng nếu cần `SignerWorkerPagePool` evaluate (không bắt buộc). [Source: `package.json:129`] |
| `puppeteer` | `^24.34.0` | Không dùng cho hybrid path. [Source: `package.json:132`] |
| `vitest` | `^4.0.18` | Test framework. [Source: `package.json` hoặc `vitest.config.js`] |

## File Structure Requirements

### CREATE

| File | Description |
|------|-------------|
| `src/scrapers/social/index.js` | Barrel export các social crawlers (Facebook, Twitter, Threads, TikTok tương lai). |
| `src/scrapers/social/facebook/index.js` | Export `FacebookCrawler`, `FacebookClient`, `FacebookPlatformResponseValidator`, constants. |
| `src/scrapers/social/facebook/client.js` | `FacebookClient` extends `AbstractApiClient`. |
| `src/scrapers/social/facebook/crawler.js` | `FacebookCrawler` extends `AbstractCrawler` (hoặc gộp vào `index.js` nếu ngắn gọn). |
| `src/scrapers/social/facebook/validator.js` | `FacebookPlatformResponseValidator` extends `AbstractPlatformResponseValidator`. |
| `tests/scrapers/social/facebook/crawler.test.js` | Tests thực (no mocks). |
| `tests/scrapers/social/facebook/client.test.js` | Tests `FacebookClient` với local server + real proxy. |

### UPDATE

| File | Description |
|------|-------------|
| `src/index.js` | Thêm `export * from './scrapers/social/index.js'` để public API nhìn thấy `FacebookCrawler`. Cẩn thận tránh duplicate nếu `src/scrapers/index.js` đã export. |
| `types/core.d.ts` hoặc `types/index.d.ts` | Thêm type declarations cho `FacebookCrawler`, `FacebookClient` options nếu cần (không bắt buộc nhưng nên có). |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/scrapers/facebook/*` | Legacy Puppeteer scraper; decommission trong Epic 20. |
| `src/scrapers/index.js` (legacy dispatcher) | Giữ backward compatibility; `scrape()` function cũ. Chỉ sửa nếu bạn chắc chắn không break callers. |
| `src/core/base-client.js` | Đã hoàn thiện ở Story 13.1. Chỉ dùng API, không sửa logic. |
| `src/core/base-crawler.js` | Đã hoàn thiện. Chỉ kế thừa. |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test`.
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** Dùng `http.createServer` để phục vụ HTML home + JSON GraphQL.
- **Real proxy:** Dùng `StaticProxyProvider` hoặc `ProxyIpPool` với proxy local.
- **Coverage tối thiểu:**
  - `FacebookClient.warmup()` parse đúng tokens.
  - `FacebookClient.requestGraphQl()` gửi đúng form body và cookie.
  - `FacebookCrawler.listActions()` trả về `ActionDescriptor[]`.
  - `FacebookCrawler.start({ action: 'group_posts', ... })` trả về `PostItem[]`.
  - `FacebookCrawler.start({ action: 'page_posts', ... })` trả về `PostItem[]`.
  - Response bot challenge / checkpoint được xử lý qua validator.
  - `cleanup()` không leak.
- **Regression:** Chạy `npm run typecheck` và `npm test -- tests/core/` (157 tests hiện tại phải vẫn pass).

## Previous Story Intelligence

### Story 13.1 — Tiered Signer Architecture (Done)

- `AbstractApiClient` đã có `tokenRing`, `signerPool`, `requestWithSign`, `request`, `updateCookies`.
- `PreSignedTokenRing` lưu string tokens, `next()` O(1), throw `XACT_5000` khi empty.
- `SignerWorkerPagePool` dùng Playwright/Puppeteer qua adapter, `p-limit`, drain-in-flight close.
- `requestWithSign` chỉ merge `headers`/`query`/`cookies`/`signature`; không merge `body`.
- `base-client.js` hiện tại (sau commit `90a0f55`) giữ ternary `provider || opts.requiresResidential ? resolveProxy(...) : null`, cho phép direct connection khi thiếu provider. [Source: `git log --oneline`]

### Story 13.2 — Twitter Refactor (ready-for-dev)

- Chưa triển khai trong repo.
- Có thể tham khảo `src/scrapers/twitter/http/client.js` nếu tồn tại, nhưng 13.2 chưa done nên không dựa vào.
- Nên theo pattern: `TwitterClient` extends `AbstractApiClient` + `TwitterCrawler` extends `AbstractCrawler`.

### Git Intelligence

Recent commits (mới nhất trước story này):
- `90a0f55 feat(test): add real Facebook API probe script for Story 13.1 Tiered Signer Engine`
- `313c051 feat(test): add real API probe script for Story 13.1 Tiered Signer Engine`
- `ef8cab3 Resolve Story 13.1 review findings and remove mock-based tests.`
- `4fc1351 docs(sprint): mark Story 13.1 Tiered Signer Architecture as done`
- `b999169 fix(core): apply code review refinements for Story 13.1 Tiered Signer Architecture`

Patterns:
- Commit messages theo format `type(scope): description`.
- Không dùng mock trong tests.
- `base-client.js` và `signer-pool.js` vừa được refactor; tránh sửa trừ khi cần thiết.

## Latest Tech Information

- `got-scraping@^3.2.15` — stable, hỗ trợ `proxyUrl` và header generator. [Source: `package.json`]
- `undici@^7.29.0` — modern fetch, `ProxyAgent`/`Socks5ProxyAgent` dispatcher, `AbortSignal.timeout`.
- `playwright@^1.62.1` — headless, hỗ trợ browser context, page evaluate.
- `vitest@^4.0.18` — test runner, ESM, timeout mặc định 30s.
- Facebook GraphQL `doc_id` có thể xoay bất kỳ lúc nào; cần graceful fallback (NFR-7).

## Project Context Reference

- Epic 13: `_bmad-output/planning-artifacts/epics.md#epic-13-high-throughput-hybrid-scraping-engine-twitter--facebook-refactor`
- Architecture: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (AD-1, AD-2, AD-3, AD-8, AD-9, AD-11, AD-12, AD-14)
- PRD: `_bmad-output/planning-artifacts/prd.md` (FR-72: Facebook Crawler Refactor)
- Facebook PRD: `_bmad-output/planning-artifacts/prd-facebook-epics-5-6-2026-08-21.md` (FR-23, NFR-7, AR8-AR10)
- Core contracts:
  - `src/core/base-crawler.js` (AbstractCrawler, ActionRegistry)
  - `src/core/base-client.js` (AbstractApiClient, request, requestWithSign, resolveProxy)
  - `src/core/platform-validator.js` (AbstractPlatformResponseValidator)
  - `src/core/signer-pool.js` (PreSignedTokenRing, SignerWorkerPagePool)
  - `src/store/prisma-store.js` (PrismaStore.storeBatch)
  - `src/core/types.js` (PostItem, CommentItem, CATEGORY_VALUES)
- Legacy reference:
  - `src/scrapers/facebook/index.js` (để tránh break)
  - `src/scrapers/facebook/graphql.js` (pattern trích xuất token, build form body)
  - `src/scrapers/facebook/validator.js` (có thể adapt)

## Open Questions / Decisions

1. **doc_id values:** Hiện tại chưa có doc_id cố định cho group feed / page feed trong repo. Dev cần tìm doc_id thực tế qua network inspection hoặc chấp nhận test với doc_id test. Nếu Facebook xoay doc_id, tuân thủ NFR-7 (graceful fallback, không throw panic).
2. **Token strategy lsd vs. requestWithSign:** Quyết định đề xuất là dùng `this.request()` trực tiếp với body string; `lsd` cache trong client state. Nếu muốn dùng `PreSignedTokenRing` cho `lsd`, refill từ `warmup()` và dùng `requestWithSign` với `signType='token'`, location `query` hoặc `header` (`x-fb-lsd`).
3. **Pagination:** AC không yêu cầu phân trang. Optional dùng `CrawlCheckpoint` để lưu `cursor` nếu response có `page_info.end_cursor`.
4. **Public exports:** Có nên cập nhật `src/scrapers/index.js` legacy để `scrape('facebook', 'group_posts', ...)` dùng `FacebookCrawler`? **Khuyến nghị:** Không trong story này để tránh breaking `scrape()` legacy; chỉ export qua `src/index.js` và `src/scrapers/social/index.js`.

## Dev Agent Record

### Agent Model Used

Create Story Workflow — `bmad-create-story` skill, manual analysis bằng `vibervn-context-engine` MCP và `Read` tool.

### Completion Notes

- Story 13.3 được auto-discover từ `sprint-status.yaml` là story đầu tiên còn `backlog` trong Epic 13.
- Phân tích toàn bộ epics, architecture, PRD Facebook, code `base-client.js`, `base-crawler.js`, `signer-pool.js`, `prisma-store.js`, `facebook/legacy`, và gần nhất git log.
- Đã ghi nhận user action gần đây trên `base-client.js` (fallback direct connection ternary) để dev agent không regress.

### File List

- `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md`
