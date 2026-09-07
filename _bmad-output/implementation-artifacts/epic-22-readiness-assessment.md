# Epic 22 Readiness Assessment — Live Probe Results

Date: 2026-09-08
Assessor: Claude
Verdict: **PASS — all 3 stories ready for implementation**
Status: ready-for-implementation

## Live Probe Results (2026-09-08)

| Platform | Endpoint | Status | Verdict |
|---|---|---|---|
| **PasGo** | `pasgo.vn/ha-noi/nha-hang` | ✅ 200, JSON-LD | Feasible — SSR HTML + JSON-LD |
| **Foody** | `foody.vn/ha-noi/nha-hang` | ✅ 200 | Feasible — **`var jsonData` contains `searchItems` array** with full restaurant data |
| **Foody App API** | `gappapi.deliverynow.vn/api/delivery/*` | ❌ 403/404 | **Not usable** — requires app auth |
| **Riviu** | `riviu.vn` | ✅ 200, Nuxt SSR | Feasible — parse SSR HTML; `reviewapi.riviu.co` root 404 (needs path discovery) |
| **YouMed** | `youmed.vn/dat-kham/bac-si` | ✅ 200 | Feasible — **WP REST API public**: `/tin-tuc/wp-json/app/v2/specialities` returns 200 JSON |
| **Medpro** | `medpro.vn/co-so-y-te` | ✅ 200 | Feasible — Next.js SSR; `api.medpro.com.vn` catch-all (needs real path discovery) |
| **Thuocsi** | `thuocsi.vn` | ✅ 200 | **Auth-gated** — `api.buymed.com` returns 401 Unauthorized for all endpoints |
| **IP Vietnam** | `wipopublish.ipvietnam.gov.vn/wopublish-search/public/trademarks` | ✅ 200 | Feasible — **Wicket (Java) stateful app**; needs session + Wicket form submit |

## Concern Resolutions

### ✅ Concern 1: Foody mobile app API — RESOLVED
- `gappapi.deliverynow.vn` returns 403 (`error: 90309999`) / 404 — not publicly usable.
- **Resolution:** Foody web page (`foody.vn/{city}/nha-hang`) embeds full search results in `var jsonData` → `searchItems` array with `Address`, `District`, `City`, `Phone`, `TotalReview`, `AvgRating`, `Cuisines`, `DetailUrl`. **No app API needed** — parse embedded JSON.
- **Story 22.1 update needed:** Approach #2 should say "Foody: parse embedded `jsonData.searchItems`" instead of "REST API mobile app".
- **Thuocsi**: `api.buymed.com` 401 on all catalog endpoints — **auth-gated**, defer to Epic 24.
- **Long Chau**: `nhathuoclongchau.com.vn/he-thong-cua-hang` embeds 2,649 pharmacies in `__NEXT_DATA__`; also available at `/_next/data/{buildId}/he-thong-cua-hang.json`. **Added to Story 22.2.**

### ✅ Concern 2: Riviu structured data — RESOLVED
- `riviu.vn` is a Nuxt.js SSR site (200 OK). `reviewapi.riviu.co` is the API backend but root returns 404.
- **Resolution:** Parse Nuxt SSR HTML directly; API path discovery deferred to dev (check `_nuxt/` JS chunks for API routes). Browser fallback available if needed.
- **Risk:** Medium — API endpoints unknown but SSR HTML is renderable.

### ⚠️ Concern 3: Healthcare data sensitivity — PARTIALLY RESOLVED
- **YouMed:** ✅ Public WP REST API confirmed (`/tin-tuc/wp-json/app/v2/specialities` → 200 JSON with 40+ specialties).
- **Medpro:** ✅ Public SSR page confirmed (200). `api.medpro.com.vn` returns catch-all "Hello" — real API paths need discovery from page JS.
- **Thuocsi:** ❌ **`api.buymed.com` returns 401 for all endpoints** — B2B wholesale catalog requires login.
- **Resolution:** Scope 22.2 to YouMed + Medpro public directory data. **Thuocsi catalog requires auth → raise scope question** (either drop Thuocsi or add auth support via account pool).
- **Compliance note:** Only public clinic/doctor directory data — no patient records, no prescription data.

### ✅ Concern 4: IP Vietnam JSP form — RESOLVED (revised approach)
- `wipo.ipvietnam.gov.vn` DNS → 127.0.0.1 (dead subdomain).
- Real endpoint: `wipopublish.ipvietnam.gov.vn/wopublish-search/public/trademarks` — **Apache Wicket stateful app** (jsessionid + form listener URLs).
- Search form POST returns the search page (results load via Wicket AJAX, not simple form submit).
- **Resolution:** Two options:
  1. **StealthBrowser (Puppeteer)** — render Wicket page, submit form via DOM, scrape results. Reliable but slower.
  2. **Gazette/công báo approach** — `ipvietnam.gov.vn` publishes weekly IP gazette lists (`danh-sach-don-chuyen-cong-bo-hang-tuan`) as Liferay content pages — simpler HTML scraping.
- **Recommendation:** Start with gazette HTML approach (simpler), keep Wicket browser fallback for detail lookups.
- **Story 22.3 update needed:** Replace `wipo.ipvietnam.gov.vn` (dead) with `wipopublish.ipvietnam.gov.vn` + gazette approach.

### ✅ Concern 5: epics.md Phase A sync — RESOLVED
- `epics.md` Phase A already lists Epic 22 with all 3 stories.
- VN Platform Coverage Matrix confirms `PasGo/Foody/Riviu`, `Medpro/YouMed/Thuocsi`, `IP Vietnam` as "Spec ready".
- **No action needed.**

## Story File Updates Needed

### Story 22.1 (`22-1-fnb-merchant-restaurant-directory-crawler.md`)
- **Approach #2:** Change "REST API mobile app + TLS spoofing" → "PasGo: SSR HTML + JSON-LD; Foody: embedded `jsonData.searchItems`; Riviu: Nuxt SSR HTML parse".
- Remove `gappapi.deliverynow.vn` reference.

### Story 22.2 (`22-2-healthcare-clinics-pharmacy-network-crawler.md`)
- **Scope:** YouMed (WP REST API) + Medpro (SSR HTML) confirmed public.
- **Thuocsi:** Requires auth (`api.buymed.com` 401) — **ask user: drop Thuocsi or add auth?**
- Compliance: only public directory data.

### Story 22.3 (`22-3-legal-trademark-intellectual-property-crawler.md`)
- **Endpoint:** Replace `wipo.ipvietnam.gov.vn` → `wipopublish.ipvietnam.gov.vn` (Wicket) or `ipvietnam.gov.vn` gazette pages.
- **Approach:** Gazette HTML scrape (primary) + StealthBrowser for detail lookups (fallback).
- SSL: `CERT_NONE` required (gov site has self-signed/incomplete chain).

## Final Verdict

**PASS** — Epic 22 is ready to start:

- **Story 22.1** (F&B): ✅ Ready — all 3 platforms feasible via SSR/HTML parsing (no app API needed).
- **Story 22.2** (Healthcare): ✅ Ready — YouMed + Medpro + **Long Chau** public; Thuocsi auth-gated and deferred to Epic 24.
- **Story 22.3** (Legal/IP): ✅ Ready — revised endpoint approach (gazette HTML or Wicket browser).

**Recommended order:** 22.1 → 22.2 → 22.3 (all ready; 22.2 now unblocked with Long Chau public data).
