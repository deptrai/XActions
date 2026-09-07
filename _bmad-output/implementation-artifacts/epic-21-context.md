# Epic 21 Context: B2B Procurement, Corporate & Automotive Intelligence Engine

## Epic Goal
Cào dữ liệu doanh nghiệp và thầu từ các nguồn công khai Việt Nam (MaSoThue, HoSoCongTy, MuaSamCong) để Nowing AI Lead Hub scoring.

## Story 21.1: MaSoThue Company Registry Crawler
- File: `src/scrapers/procurement/masothue/`
- Status: done
- Key pattern: `AbstractCrawler` + `AbstractApiClient` + `ProxyIpPool` + `PrismaStore` + ThinEvent.

## Story 21.2: Automotive Vehicles Market Crawler
- File: `src/scrapers/vehicles/automotive/`
- Status: done
- Platforms: `oto_vn`, `bonbanh`, `chotot_xe`.

## Story 21.3: HoSoCongTy & MuaSamCong Crawler (Cloudflare/SPA fallback)
- File: `src/scrapers/procurement/b2b-registry-extended/`
- Status: done
- Commit baseline: `818d14d1`
- Scope: 2-tier Cloudflare bypass for HoSoCongTy, HTML/SPA fallback for MuaSamCong.
- Limitation: Unit tests pass with synthetic HTML, but live browser-pilot found route and selector drift.

## Story 21.4: HoSoCongTy & MuaSamCong Live-Fix
- File: `_bmad-output/implementation-artifacts/stories/21-4-hosocongty-muasamcong-live-fixes.md`
- Status: ready-for-dev
- Baseline: `818d14d1`
- Goal: Fix real-site HTML parsing and route mapping found by browser pilot.

## Technical Constraints
- ESM only.
- No mocks/stubs/fakes in tests; use real `node:http` server if needed.
- `PostItem` schema: `platform`, `externalId`, `category: 'b2b'`, `metadata`.
- Error types: `PlatformError` with `ErrorTypes.BOT_CHALLENGE` / `INVALID_ARGS` / `NOT_FOUND`.
- `AbstractApiClient` class field `requiresProxy = true` runs after `super()` — must re-assign if options override.
- Proxy resolution via `resolveProxy()` + `getProxyAgent()`.

## Files to Touch for 21.4
- `src/scrapers/procurement/b2b-registry-extended/client.js`
- `src/scrapers/procurement/b2b-registry-extended/normalizer.js`
- `src/scrapers/procurement/b2b-registry-extended/index.js`
- `src/scrapers/procurement/b2b-registry-extended/browser.js` (if SPA render)
- `tests/scrapers/procurement/b2b-registry-extended/`
- `types/index.d.ts`
- `sprint-status.yaml`
