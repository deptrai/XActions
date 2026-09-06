---
title: "Technical Research — Cloudflare & VN B2B Endpoint Reality"
date: 2026-09-06
type: technical
decision: "Story 21.1 implementation feasibility"
author: Winston
---

# Technical Research: Cloudflare & VN B2B Endpoint Reality

> Research question: Can Story 21.1 be implemented as HTTP-only with TLS spoofing + VN proxy, or does it need browser fallback / anti-detection (Epic 27)?

## Executive Summary

| Platform | Verdict | Approach |
|----------|---------|----------|
| **MaSoThue** | ✅ **Feasible HTTP-only** | `AbstractApiClient` + `undici`/`got` + proper browser headers + VN proxy. HTML parsing with `cheerio`/`jsdom`. |
| **HoSoCongTy** | 🔴 **Blocked by Cloudflare managed challenge** | Needs Puppeteer/stealth cookie warmup or Epic 27 TLS/JA4 spoofing. Defer or fallback. |
| **MuaSamCong** | 🟡 **Partial — HTML SPA, no public API** | Liferay SPA; no public REST API found. Requires HTML parse or authenticated API reverse engineering. |

## Detailed Findings

### 1. MaSoThue (masothue.com)

- **Live probe 2026-09-06:** 200 OK with full browser headers.
- **Cloudflare:** Only triggers when headers are minimal (no `Accept`, `Referer`, `DNT`, `Upgrade-Insecure-Requests`).
- **Endpoints verified:**
  - `/Search/?type=auto&q={query}` → 302, redirects to HTML results
  - `/Search/?q={query}&type=legalName` → HTML results
  - `/{taxCode}-{company-slug}` → HTML detail page
  - `/tra-cuu-ma-so-thue-theo-tinh/{province_slug}-{id}` → HTML province list
- **Extractable fields:** `taxCode`, `companyName`, `address`, `businessLines`, `detailUrl`
- **NOT extractable on public page:** `phone`, `representativeName`, `establishedDate`, `charterCapital` — these are not shown in public detail.

### 2. HoSoCongTy (hosocongty.vn)

- **Live probe 2026-09-06:** 403 Cloudflare "Just a moment..." managed challenge.
- **Cloudflare:** JA3/JA4 fingerprint check blocks `undici`/`got`.
- **Puppeteer:** Likely needed for `cf_clearance` cookie.
- **Data fields:** Unknown — page is behind challenge.

### 3. MuaSamCong (muasamcong.mpi.gov.vn)

- **Live probe 2026-09-06:** 200 OK for public search page.
- **Site type:** Liferay SPA with server-side rendered HTML.
- **Public API:** Not found — no `/api/v1/*` or unauthenticated REST endpoint.
- **Search form params:** `searchType`, `searchScope`, `searchBy`, `keywordMatch`, `projectType`
- **Extractable fields from search result HTML:** `tenderNo`, `tenderName`, `procuringEntityName` (`tendererName`), `publishDate`
- **NOT extractable from search summary:** `tenderValue`, `bidderList` — need detail page parse or internal API.

## Implementation Recommendation

### Minimum Viable Story 21.1 (2-week sprint)

1. **Implement MaSoThue crawler only** in first pass.
   - Actions: `search`, `search_by_province`, `detail`
   - Proxy: `ProxyIpPool` with `region: 'VN'` (AD-22)
   - Client: `undici`/`got` with browser headers
   - Parser: `cheerio` + CSS selectors
   - Output: `PostItem` (`platform: 'masothue'`, `category: 'b2b_lead'`)

2. **Defer HoSoCongTy and MuaSamCong** to follow-up stories unless Epic 27 anti-detection lands first.
   - **HoSoCongTy:** needs Cloudflare bypass.
   - **MuaSamCong:** needs authenticated API research or detail-page parsing.

### Architecture Decision

This does **not** require full Epic 27 for basic MaSoThue. It can be built on existing `AbstractApiClient` + `ProxyIpPool`. HoSoCongTy and MuaSamCong will benefit from Epic 27 but are not blockers for the first slice.

## Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| MaSoThue blocks IP for fast scraping | High | Medium | VN proxy rotation + governor rate limiting |
| MaSoThue adds challenge page | Medium | High | Add `AbstractPlatformResponseValidator` `isBotChallenge` |
| HoSoCongTy stays Cloudflare-blocked | High | High | Defer or use Puppeteer fallback |
| MuaSamCong has no public API | High | High | Parse HTML or use authenticated API |

## Open Questions

1. Does MaSoThue expose SĐT/representative for some companies? (sample says no)
2. Does MuaSamCong have an authenticated mobile app API?
3. Can HoSoCongTy be bypassed with `got-scraping` + VN residential proxy alone?

## Conclusion

**Story 21.1 can proceed with a narrowed scope: MaSoThue first.** HoSoCongTy and MuaSamCong should be split into separate follow-up stories or deferred until Epic 27 anti-detection and additional API research are complete.
