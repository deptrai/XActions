---
title: "Future Work & Deferred Scope"
created: 2026-08-21
updated: 2026-08-21
status: approved
---

# Future Work & Deferred Scope

Tài liệu này tập hợp các yêu cầu, ý tưởng, và tính năng bị hoãn lại để tránh scope creep trong các phase hiện tại. Các mục chỉ được mở lại khi đáp ứng điều kiện kích hoạt rõ ràng.

---

## FR-62: GraphQL Replay (Facebook / Universal)

**Nguồn:** `archive/prds/prd-XActions-2026-08-14-epic7/prd.md` §4.5, `archive/epics-1-9-legacy.md` Epic 7.

**Mô tả:** Capture `doc_id` từ `api/graphql` request trong Puppeteer và replay bằng HTTP client (`axios`/`undici`) với `fb_dtsg`, `lsd`, `__dyn`, `__csr`. Fallback sang hydration/DOM nếu `doc_id` rotate.

**Tại sao defer:**
- Cần `doc_id` mapping ổn định ≥ 30 ngày trước khi đầu tư replay engine.
- GraphQL endpoint Facebook có thể thay đổi nhanh, rủi ro brittle cao.
- DOM fallback và hydration extraction (FR-61) đã đủ cho MVP.

**Điều kiện mở lại:**
1. Story 5.1 (GraphQL Layer) và 7.1 (Health/Pool/Hydration) ổn định.
2. ≥ 80% `doc_id` mapping ổn định trong 30 ngày trên production-like traffic.
3. Có replay cache storage (`redis`/`sqlite`) để lưu mapping.
4. Product Council approve Phase 3 scope.

**Impact khi triển khai:**
- Giảm RAM usage (không cần giữ browser tab trong quá trình replay).
- Tăng tốc độ scrape comments/search (10x–50x so với DOM scroll).

---

## Facebook Marketplace Advanced Filters

**Mô tả:** Lọc theo giá min/max, khoảng cách, category, sort by date/price.

**Điều kiện mở lại:** FR-28..FR-31 stable, có real-user feedback.

---

## Advanced Fingerprint Spoofing (Canvas / WebGL / Audio)

**Mô tả:** Spoofing canvas fingerprint, WebGL vendor/renderer, audio context để tránh bot detection nâng cao.

**Điều kiện mở lại:** FR-40..FR-54 stable, checkpoint rate vẫn > 5%.

---

## AI-Generated Content for Growth Automation

**Mô tả:** Tự động sinh nội dung post/comment/friend request message bằng LLM.

**Điều kiện mở lại:** Product Council approve AI content policy, có integration với AI layer hiện có.

---

## Multi-Account Parallel Manager UI

**Mô tả:** Dashboard quản lý nhiều account, proxy assignment, hibernation queue.

**Điều kiện mở lại:** Epic 19 operator dashboard hoàn thành, Epic 7 multi-account stable.

---

## Epic 21–22: B2B Procurement, Corporate & Automotive / Local F&B, Healthcare & Legal Intelligence

**Nguồn:** `epics.md` §Epic 21–22 (moved 2026-08-26).

**Mô tả:** Mở rộng XActions sang các vertical B2B & local services: đấu thầu/doanh nghiệp, ô tô, F&B, y tế, sở hữu trí tuệ.

**Tại sao defer:**
- Nằm ngoài PRD canonical hiện tại (Epics 10–20).
- Chưa có PRD, UX personas/flows, hoặc architecture review cho các domain mới.
- Cần review pháp lý cho dữ liệu chính phủ, y tế, IP.

**Điều kiện mở lại:**
1. Product Council approve PRD mới cho verticals này.
2. UX documentation (personas, flows, mockups) được hoàn thiện.
3. Architecture review xác nhận `AbstractCrawler`/`ProxyIpPool` sẵn sàng mở rộng.
4. Xem chi tiết: `_bmad-output/planning-artifacts/backlog-epics-21-22.md`.

---

*Document owner: BMad Product Council. Reviewed every sprint-end for activation conditions.*
