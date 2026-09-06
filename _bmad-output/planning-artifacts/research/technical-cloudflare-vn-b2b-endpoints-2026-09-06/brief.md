---
title: "Technical Deep Recon — Cloudflare Bypass & MuaSamCong API for VN B2B Crawlers"
type: technical
decision: "Can Story 21.1 (B2B Registry Crawler) be implemented as HTTP-only with TLS spoofing + VN proxy, or does it need browser fallback / anti-detection (Epic 27)?"
targets:
  - masothue.com (tra cứu MST)
  - hosocongty.vn (thông tin doanh nghiệp)
  - muasamcong.mpi.gov.vn (đấu thầu)
questions:
  - What is the actual HTTP request pattern for masothue.com list/search/detail endpoints?
  - What is the actual HTTP request pattern for hosocongty.vn?
  - Does muasamcong.mpi.gov.vn expose any public API or SSR endpoints for tender search/notice detail?
  - What are the WAF/anti-bot mechanisms (Cloudflare turnstile/challenge, rate limits, TLS fingerprint checks)?
  - Which bypass methods work for public data scraping in Vietnam: TLS spoofing, VN residential proxy, headless browser, or all three?
  - What is the minimum viable implementation path for a 2-week sprint?
needed_by: Story 21.1
epic: 21
---
