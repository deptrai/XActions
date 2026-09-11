---
epic: 35
story: 35.4
status: review
created: '2026-09-09'
updated: '2026-09-09'
---

# Story 35.4: Unified ProxyProvider Injection + Docs & Selector Registry

## Epic
Epic 35: Reddit, Medium & Instagram Scraper Expansion

## Goal
Ensure all new scrapers (Reddit, Medium, Instagram) can inject `ProxyProvider` uniformly, and update documentation/selector registry for future maintenance.

## FRs Covered
- FR-98, FR-99, FR-100 (all new platforms require proxy support)

## NFRs Covered
- NFR-3 (proxy rotation and session persistence)
- NFR-5 (ESM imports, `const` over `let`, emoji-prefixed errors)

## Story

As an XActions maintainer,
I want all new social scrapers to support `ProxyProvider` injection,
So that proxy management is consistent across platforms and easy to configure.

## Acceptance Criteria

### AC-1: ProxyProvider injection in RedditClient
**Given** `RedditClient` is constructed with `{ proxyProvider: pool }`  
**When** `client.fetch(url)` is called  
**Then** it uses the proxy from `pool.getProxy()` or `pool.getStickyProxy(accountId)`  
**And** falls back to `process.env.PROXY_URL` if no provider is set

### AC-2: ProxyProvider injection in MediumClient
**Given** `MediumClient` is constructed with `{ proxyProvider: pool }`  
**When** `client.fetch(url)` is called  
**Then** it uses the proxy for HTTP requests  
**And** RSS feed requests also route through the proxy

### AC-3: ProxyProvider injection in InstagramClient
**Given** `InstagramClient` is constructed with `{ proxyProvider: pool }`  
**When** the client launches browser or private API session  
**Then** it uses the proxy for all network traffic  
**And** sticky proxy is maintained per session

### AC-4: Proxy fallback and error handling
**Given** a proxy request fails with connection refused/timeout  
**When** the error is detected  
**Then** the client logs an error and can fall back to direct connection  
**And** `ProxyIpPool` quarantines the failing proxy for 5 minutes

### AC-5: Country and geo-targeting
**Given** `options.proxy` includes `{ country: 'us' }` or `country: 'gb'`  
**When** the client requests a proxy  
**Then** `ProxyProvider` returns a US/GB residential proxy if available  
**And** `country-vn` is only used for Vietnam-specific platforms

### AC-6: Documentation update
**Given** the new scrapers are implemented  
**When** `docs/agents/selectors.md` and `docs/agents/contributing-features.md` are updated  
**Then** they include Reddit, Medium, Instagram selectors and patterns  
**And** they reference the new `ProxyProvider` usage

### AC-7: Integration test
**Given** all three new scrapers are built  
**When** `vitest run tests/scrapers/proxy-injection` is executed  
**Then** each client successfully routes requests through `ProxyIpPool`  
**And** fallback to `PROXY_URL` works when no provider is injected

### AC-8: SocialAccount schema and migration
**Given** `prisma/schema.prisma` is updated with `SocialAccount`/`SocialAccountHealth`  
**When** `npx prisma migrate dev --name add_social_account` is run  
**Then** migration creates tables without errors  
**And** `SocialAccount` can store encrypted session data for Reddit, Medium, Instagram

## Files to Create/Modify
- `src/scrapers/social/reddit/client.js` (add proxy support)
- `src/scrapers/social/medium/client.js` (add proxy support)
- `src/scrapers/social/instagram/client.js` (add proxy support)
- `docs/agents/selectors.md` (add new platform selectors)
- `docs/agents/contributing-features.md` (add platform template)
- `tests/scrapers/proxy-injection.test.js`

## Out of Scope
- Refactoring existing scrapers (Twitter, Facebook, etc.) — only new platforms get `ProxyProvider` injection in this story.
- Proxy health dashboard or admin UI.

## Open Questions
- OQ-1 (RESOLVED): `ProxyProvider` is optional in constructor; if absent, fall back to `process.env.PROXY_URL` / `PROXY_URLS`. `ProxyIpPool` handles quarantine/sticky/round-robin automatically.
- OQ-2 (RESOLVED): Yes — create `SocialAccount` table in Prisma schema to store generic social platform sessions (Reddit, Medium, Instagram). Reuses `SessionManager` + `encryptedCookie`/`encryptedProxy` pattern.

## Spec Change Log

- 2026-09-09 — Tạo story từ Epic 35 (Reddit/Medium/Instagram scraper expansion).
- 2026-09-11 — Validation notes (kiểm chứng đối chiếu codebase, không sửa frozen intent):
  - **AC-1/2/3 đã implement sẵn**: cả 3 client (`reddit/client.js:45`, `medium/client.js`, `instagram/client.js`) extends `AbstractApiClient`, nhận `proxyPool`/`proxyProvider` trong constructor và wire qua `resolveProxy()` (`src/core/base-client.js:216`: ưu tiên `provider.getProxy()` → `pool.getStickyProxy(accountId)`). Không viết lại injection.
  - **Gap `PROXY_URL`**: `globalProxyPool` auto-seed từ `PROXY_URL`/`PROXY_URLS`/`XEEPY_PROXY_URL`/`FACEBOOK_PROXY` (`src/proxy/proxy-pool.js:707-712`); Instagram đọc env trực tiếp (`instagram/client.js:166`). Reddit/Medium **không** default sang `globalProxyPool` → khi không inject provider, request đi direct thay vì qua env proxy. Cần normalize fallback (ví dụ default `proxyPool = globalProxyPool` hoặc env-read như Instagram).
  - **AC-4**: `DEFAULT_QUARANTINE_MS = 5*60*1000` + `quarantine()` đã có (`proxy-pool.js:15,482`). Cần verify/thêm nhánh "proxy conn error → fall back direct" ở Reddit/Medium fetch path.
  - **AC-5**: `country` được hỗ trợ ở `src/proxy/providers.js` (`country-{cc}` trong URL, `defaultCountry`, `options.country`); `ProxyIpPool` (raw IP list) không có country. Country targeting áp dụng cho provider-class path — làm rõ trong docs/test.
  - **AC-6**: `docs/agents/selectors.md` có 0 mention reddit/medium/instagram — cần thêm section.
  - **AC-7**: `tests/scrapers/proxy-injection.test.js` chưa tồn tại. Repo rule no-mocks → dùng local HTTP proxy server thật (theo `tests/scrapers/facebook-proxy.test.js`).
  - **AC-8**: `model SocialAccount`/`SocialAccountHealth`/enum đã có trong `prisma/schema.prisma:329-365` (`encryptedCookie`/`encryptedProxy` đúng OQ-2) nhưng **chưa có migration** chứa chúng → cần `npx prisma migrate dev --name add_social_account`, không sửa model.
- 2026-09-11 — Implementation notes (dev):
  - `base-client.js`: export `isProxyConnectionError()` (kiểm tra cả `err.message` lẫn `err.details.error.message` — `request()` wrap transport error thành `{status:503, error}`); thêm `resolveEnvProxy()` (PROXY_URL first-entry) + `quarantineProxy(proxy, durationMs)` (best-effort); `resolveProxy` forward `country/city/state/region/isp/asn/sessionId/sessionduration/lifetime/period/sid` vào `provider.getProxy()` (AC-5 — trước đây bị drop); `RequestOptions.disableProxy` per-request opt-out trong `shouldUseProxy`.
  - `reddit/client.js` + `medium/client.js`: `#lastResolvedProxy` tracking trong `resolveProxy` override; env fallback `resolveEnvProxy()` khi pool không serve được (probe `getNext`); `request()` catch → `isProxyConnectionError` + có proxy → `quarantineProxy` + retry `disableProxy:true` (chỉ khi `!requiresProxy`); `requiresProxy:true` → quarantine + rethrow.
  - **Bug sửa kèm**: subclass ctor forward `requiresProxy` chỉ khi caller set (trước `?? false` khiến `_requiresProxyExplicit` luôn true → `_hasExplicitProxy` route chết); `this._hasExplicitProxy = true` khi inject `proxyPool` (trước đây strip khỏi superOptions → pool inject bị bỏ qua); bỏ field `requiresProxy = false` ở MediumClient (field init sau super() ghi đè option).
  - `instagram/client.js`: dùng `resolveEnvProxy()` thay inline env read; `_hasExplicitProxy` khi inject pool.
  - Docs AC-6: `selectors.md` + `contributing-features.md` thêm section 3 platforms + ProxyProvider contract.
  - AC-7: `tests/scrapers/proxy-injection.test.js` — 14 tests, real `ProxyIpPool`/`DynamicTunnelProvider` + `httpClient` seam.
  - AC-8 + migration-drift repair: dev DB ghi `20260808131605_init` applied nhưng thiếu file → shadow replay vỡ mọi `migrate dev`. Đã reconstruct file từ pg_dump (Post/Comment/CrawlCheckpoint, IF NOT EXISTS + DO-guarded FKs); patch `universal_scraping_schema` với `to_regclass()` guards (Post/Comment tạo ngoài migrations); `migrate resolve --applied` cho 20260828/20260908/20260911; `migrate deploy` apply universal → GIN indexes thật sự được tạo; `migrate status` → "up to date" (11 migrations).
  - Regression: reddit client.test.js 3 fail + medium client.test.js 2 fail — **pre-existing** (verify bằng git stash, fail y hệt trên baseline; env-seeded pool quarantine path trong 429/403 tests).
