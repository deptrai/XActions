---
source: live_probe
url: https://muasamcong.mpi.gov.vn
accessed: 2026-09-06
status: partial
---

# MuaSamCong Live Probe Results

## Findings

| Aspect | Result |
|--------|--------|
| Site type | Liferay-based SPA (`muasamcong.mpi.gov.vn`) — Bộ Kế hoạch Đầu tư (MPI) |
| Public search | Form at `/web/guest/bc/-/search` — returns HTML, not JSON |
| API endpoints | **Not found** — no `/api/v1/*` or public REST endpoint detected in JS |
| Authentication | No public tender search API — requires authenticated session or scraping rendered HTML |

## Data available in public UI

- `searchType` = `bidding` (thông tin đấu thầu)
- `searchType` = `news` (tin tức)
- `searchType` = `notify` (thông báo)
- `searchScope` = `lcnt` (Lựa chọn nhà thầu) / `lcndt` (Lựa chọn nhà đầu tư)
- `searchBy` = `notifyNo,bidName` | `planNo,name` | `ycbg` | `cgttrg`
- `procuringEntityName` — bên mời thầu

## Missing fields

- `tenderValue` — not visible in search result summary
- `bidderList` — not visible in search result summary
- `tendererName` — visible as `procuringEntityName`

## Recommended implementation approach

**Option A (HTML scrape):** `AbstractCrawler` + `AbstractApiClient` + `undici` with proper headers → parse search result HTML. Slower but works.
**Option B (API reverse):** Inspect Liferay portlet AJAX calls in browser DevTools — may exist internal API endpoints like `/o/egp-*/services/...` but requires authenticated session.
**Option C (Skip for MVP):** Focus on MaSoThue + HoSoCongTy first; defer MuaSamCong to Story 21.3 or later.

## Blockers

- No public API endpoint identified
- Liferay SPA renders search results server-side but uses JavaScript for interaction
- May need headless browser (Puppeteer) for reliable scraping
