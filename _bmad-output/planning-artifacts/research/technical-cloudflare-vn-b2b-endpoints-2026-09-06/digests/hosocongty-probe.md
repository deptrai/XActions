---
source: live_probe
url: https://hosocongty.vn
accessed: 2026-09-06
status: blocked_by_cloudflare
---

# HoSoCongTy Live Probe Results

## Findings

| Aspect | Result |
|--------|--------|
| Site type | Company registry lookup (`hosocongty.vn`) |
| Cloudflare | **403 "Just a moment..."** — Cloudflare managed challenge |
| TLS fingerprint | Cloudflare detects `undici`/`got` vs browser JA3/JA4 |
| Browser headers | Chrome UA + Referer + Accept-Language + DNT + Connection + Upgrade-Insecure-Requests → still 403 |
| Session requirement | Likely needs Cloudflare bypass (Puppeteer or browser cookie warmup) |

## Anti-bot findings

- **Managed challenge page** — requires browser or Cloudflare bypass
- `undici`/`got` alone insufficient — JA3 fingerprint check
- May work with `got-scraping` (TLS spoofing) if Cloudflare detects as browser — needs testing with VN residential proxy
- Alternative: headless browser (`Puppeteer` + stealth) for initial cookie warmup, then HTTP client for subsequent requests

## Missing fields

- All data fields — site is behind Cloudflare, no public data accessible via HTTP

## Recommended implementation approach

**Option A (Puppeteer warmup):** `StealthBrowser` + `puppeteer-extra-plugin-stealth` to solve challenge, extract `cf_clearance` cookie, then use `AbstractApiClient` for subsequent requests. Higher effort but more reliable.
**Option B (got-scraping):** Try `got-scraping` with TLS/JA4 spoofing + VN residential proxy — may bypass without browser.
**Option C (Defer):** If both fail, defer HoSoCongTy and rely on MaSoThue + MuaSamCong.

## Blockers

- Cloudflare managed challenge — needs browser or advanced TLS spoofing
