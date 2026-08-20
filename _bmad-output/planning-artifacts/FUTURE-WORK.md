---
date: 2026-08-21
status: canonical
---

# Future Work & Deferred Scope

Tài liệu này ghi lại các requirement/features đã được xác định trong PRD hoặc epic nhưng **không nằm trong scope triển khai hiện tại (Phase 3 hoặc sau)**. Mục đích là tránh silent gaps và cung cấp backlog rõ ràng cho các phase tiếp theo.

## FR-62: GraphQL Replay for Facebook Advanced Scraping

- **Nguồn:** `prds/prd-XActions-2026-08-14-epic7/prd.md`
- **Mô tả:** Hệ thống có thể lưu và replay request/response GraphQL để scrape nhanh hơn mà không cần mở browser hoặc parse DOM liên tục.
- **Lý do deferred:** Cần hoàn thiện GraphQL layer (Story 5.1) và anti-detection (Epic 6) trước. Đồng thời Facebook thay đổi `doc_id`/payload, replay có thể nhanh chóng lỗi thời.
- **Điều kiện mở lại:**
  - Story 5.1 stable.
  - Ít nhất 80% GraphQL endpoints có `doc_id` mapping ổn định trong 30 ngày.
  - Có storage cho replay cache (Redis/PostgreSQL).

## FR49–FR50: Timezone & Geolocation Override (Epic 6, Story 6.16)

- **Nguồn:** `epics-full.md` Epic 6
- **Mô tả:** `page.emulateTimezone()` và `page.setGeolocation()` khớp với proxy location.
- **Lý do deferred:** Cần integrate với proxy geo-IP database hoặc external service (e.g., ip-api, MaxMind). Tạm thời dùng IP location là đủ.

## FR51: Persistent Browser Profiles (Epic 6, Story 6.17)

- **Nguồn:** `epics-full.md` Epic 6
- **Mô tả:** Lưu `userDataDir` theo `profiles/fb-{c_user}/` để session giữ cookie/localStorage.
- **Lý do deferred:** Cần quản lý profile lifecycle, cleanup, và storage. Tạm thời dùng ephemeral profiles.

## Epic 3 Extension: MCP Facebook Tool Surface

- **Nguồn:** `epics-full.md`
- **Mô tả:** Mở rộng MCP tools cho `scrapeGroupMembers`, `scrapeMarketplace`, và `FacebookAccount` persistence.
- **Lý do deferred:** Cần hoàn thiện Epic 5/5b/6 trước để các tools trả kết quả ổn định.

## Multi-Account Parallel Execution (Epic 7 enhancement)

- **Nguồn:** `epics-full.md` Epic 7
- **Mô tả:** Account pool concurrency cap 4–8, health check <2s.
- **Lý do deferred:** Hiện tại Epic 7 đã có 4 stories; pool execution có thể tách thành Epic 7.2 hoặc Phase 3.

## Admin Dashboard Rich Views (Epic 19)

- **Nguồn:** `ARCHITECTURE-UX-REMEDIATION-2026-08-21.md`
- **Mô tả:** 5 views tương tác (Jobs, Proxies, Accounts, Checkpoints, Stream Metrics) với real-time updates.
- **Lý do deferred:** Cần có core operational API (Epic 10.4, 11.4, 14.3) trước.

## XActions Ecosystem Manus-Killer Architecture

- **Nguồn:** `_bmad-output/planning-artifacts/architecture/architecture-ecosystem-manus-killer-2026-08-20/ARCHITECTURE-SPINE.md`
- **Mô tả:** Tầm nhìn rộng hơn bao gồm multiple verticals, marketplace, và ecosystem.
- **Lý do deferred:** Vượt quá scope Phase 3/4; cân nhắc làm roadmap hoặc spin-off project.
