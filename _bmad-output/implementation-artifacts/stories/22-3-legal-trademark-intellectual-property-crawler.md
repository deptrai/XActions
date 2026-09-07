---
title: 'Story 22.3: Legal & Trademark Intellectual Property Crawler (Cục Sở hữu Trí tuệ)'
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 1
baseline_commit: 'ac8d22f5'
context:
  - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  - _bmad-output/planning-artifacts/research/technical-vietnam-multi-domain-scrapers-2026-08-21.md
  - src/scrapers/index.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI cần cảnh báo sớm các đơn đăng ký nhãn hiệu/sáng chế để bán dịch vụ marketing/thiết kế/luật.

**Approach:**
1. Tạo `IpLegalCrawler` tại `src/scrapers/legal/ip-trademark/index.js`.
2. Support `wipo.ipvietnam.gov.vn` (công báo đơn đăng ký nhãn hiệu, sáng chế).
3. Trích xuất: `applicationNumber`, `applicantName`, `trademarkName`, `applicationDate`, `status`, `classes[]`.
4. Chuẩn hóa `PostItem` với `platform: 'ipvietnam'`, `category: 'legal'`.
5. Dispatch alias: `ipvietnam`, `ip_legal`.

## Boundaries & Constraints

**Always:**
- Tuân thủ AD-22/NFR-19.
- Theo dõi `applicationDate` để đảm bảo cào đúng khoảng thời gian.

**Ask First:**
- Nếu cần thêm các nguồn pháp lý khác (VD: `vanban.chinhphu.vn`).

**Never:**
- Không truy cập tài liệu mật hoặc không công khai.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| New trademark applications | `scrape('ipvietnam','search',{days:7})` | Application list | Empty → `[]` |
| Detail application | `scrape('ipvietnam','detail',{applicationNumber:'12345'})` | `PostItem` with classes | Not found → `XACT_4001` |

</frozen-after-approval>

## Live Probe Findings (2026-09-08)

**Story approach adjusted after probe:**

| Item | Original | Probe Result | New Approach |
|---|---|---|---|
| Endpoint | `wipo.ipvietnam.gov.vn` | ❌ DNS → 127.0.0.1 (dead) | Use `wipopublish.ipvietnam.gov.vn` or `ipvietnam.gov.vn` gazette pages |
| Protocol | JSP form | ✅ 200 (Wicket app) | Apache Wicket stateful app with jsessionid; requires `got-scraping` + `CERT_NONE` |
| Search method | Simple POST | ⚠️ Form submit returns page; results via Wicket AJAX | Option 1: Gazette HTML scrape (simpler); Option 2: StealthBrowser for Wicket detail |

**Key details:**
- `wipo.ipvietnam.gov.vn` is dead. Real search is at `wipopublish.ipvietnam.gov.vn/wopublish-search/public/trademarks` (Apache Wicket).
- Wicket requires session (`jsessionid`) and specific `IFormSubmitListener` action URLs. Results are rendered server-side after Wicket state transitions.
- `ipvietnam.gov.vn` publishes weekly IP gazette lists as Liferay content pages (`danh-sach-don-chuyen-cong-bo-hang-tuan`) — simpler HTML scrape.
- SSL certificate on `ipvietnam.gov.vn` is incomplete; client must disable `rejectUnauthorized` / use `CERT_NONE`.

**Recommended approach:**
- Primary: scrape weekly gazette list pages from `ipvietnam.gov.vn` for new applications.
- Fallback: use StealthBrowser (Puppeteer) on `wipopublish.ipvietnam.gov.vn` for detail lookups by application number.

**Story 22.3 update needed:**
- Change platform alias to `ipvietnam`.
- Replace `wipo.ipvietnam.gov.vn` with `wipopublish.ipvietnam.gov.vn` + `ipvietnam.gov.vn`.
- Add SSL/TLS handling: disable certificate verification.
- Implement `search_gazette` and `detail` actions.

## Code Map

- `src/scrapers/legal/ip-trademark/index.js` — `IpLegalCrawler`
- `src/scrapers/legal/ip-trademark/client.js`
- `src/scrapers/legal/ip-trademark/schema.js`
- `src/scrapers/index.js` — dispatcher
- `tests/scrapers/legal/ip-trademark/`
