---
source: live_probe
url: https://masothue.com
accessed: 2026-09-06
status: success
---

# MaSoThue Live Probe Results

## Endpoints verified

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/Search/?type=auto&q={query}` | GET | 302 → HTML | Returns HTML search results page; `type=auto` returns autocomplete-style HTML |
| `/Search/?q={query}&type=legalName` | GET | 200 | Returns HTML with company links matching legal representative name |
| `/{taxCode}-{company-slug}` | GET | 200 | Returns detail page with company info table |
| `/tra-cuu-ma-so-thue-theo-tinh/{province_slug}-{id}` | GET | 200 | Returns province-level company list |

## Data extractable from detail page

- `taxCode` (from URL pattern + "Mã số thuế" row)
- `companyName` (from H1 title: `{taxCode} - {companyName}`)
- `address` (from "Địa chỉ" row, `itemprop='address'`)
- `businessLines` (from "Ngành nghề chính" row + related links)
- `representativeName` — NOT found in public detail page (no "Đại diện" or "Giám đốc" field visible)
- `phone` — NOT found (no phone field in public detail page)
- `detailUrl` — canonical URL

## Anti-bot findings

- Cloudflare challenge page returned when request lacks proper browser headers
- With `User-Agent: Chrome/129 + Referer: masothue.com + Accept: text/html + Accept-Language: vi-VN + DNT: 1 + Connection: keep-alive + Upgrade-Insecure-Requests: 1` — 200 OK
- No JA3/JA4 fingerprint check detected — works with basic HTTP client (undici/got)
- No rate limit observed in single probe; likely IP-based rate limiting for bulk
- No session cookie required

## Missing fields

- `representativeName` — may exist on some pages but not in this sample
- `phone` — not exposed on public detail page; likely requires login or different endpoint
- `establishedDate`, `charterCapital` — not found on public detail page

## Recommended implementation approach

HTTP-only with `AbstractApiClient` + `undici`/`got` + proper headers. No headless browser needed for basic company lookup. For bulk scraping, rotate VN proxy + throttle requests.
