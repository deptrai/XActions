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

## Code Map

- `src/scrapers/legal/ip-trademark/index.js` — `IpLegalCrawler`
- `src/scrapers/legal/ip-trademark/client.js`
- `src/scrapers/legal/ip-trademark/schema.js`
- `src/scrapers/index.js` — dispatcher
- `tests/scrapers/legal/ip-trademark/`
