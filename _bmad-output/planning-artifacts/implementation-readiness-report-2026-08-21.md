---
stepsCompleted: [1, 2, 3, 4, 5, 6]
date: 2026-08-21
project: XActions
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-21
**Project:** XActions

## Step 1: Document Discovery

Tôi đã quét toàn bộ tài liệu trong `_bmad-output/planning-artifacts/`. Dưới đây là danh sách tài liệu được tìm thấy theo từng loại.

### PRD Documents

**Whole Documents:**
- `prd.md` (15,725 bytes, 2026-08-20 14:18) — PRD cho Epics 10–20.

**Sharded Documents:**
- Folder: `prds/prd-XActions-2026-06-08/`
  - `prd.md` (20,456 bytes, 2026-08-20) — Facebook Platform Extension.
  - `.decision-log.md`
- Folder: `prds/prd-XActions-2026-06-10-epic4/`
  - `prd.md` (18,279 bytes, 2026-08-20) — Epic 4 Growth Automation.
- Folder: `prds/prd-XActions-2026-08-14-epic7/`
  - `prd.md` (16,220 bytes, 2026-08-20) — Epic 7 Advanced Scraping.
  - `validation-report.md`
- Folder: `prds/prd-XActions-2026-08-18-universal-scraping-engine/`
  - `prd.md` (13,131 bytes, 2026-08-20) — Universal Scraping Engine.

### Architecture Documents

**Whole Documents:**
- `architecture.md` (46,292 bytes, 2026-08-20 14:18) — Architecture tổng hợp.

**Sharded Documents:**
- Folder: `architecture/xactions-hybrid-scraping-spine/`
  - `ARCHITECTURE-SPINE.md` (38,376 bytes, 2026-08-20) — Architecture spine r3.
  - `ARCHITECTURE-UX-REVIEW-2026-08-18.md` (8,102 bytes, 2026-08-19)
  - `ARCHITECTURE-DEV-REVIEW-2026-08-18.md`
  - `ARCHITECTURE-EPIC10-PM-REVIEW-2026-08-18.md`
  - `ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md`
  - `ARCHITECTURE-UPDATE-GATE-2026-08-18.md`
  - `ARCHITECTURE-UPDATE-GATE-2026-08-18-R3.md`
  - `EPIC10-DECISION-LOG-2026-08-18.md`
  - `.memlog.md`

**Research / Supplemental:**
- `research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md`

### Epics & Stories Documents

**Whole Documents:**
- `epics.md` (52,440 bytes, 2026-08-20 14:18) — Epics 10–20.
- `epics-full.md` (47,474 bytes, 2026-08-20 14:18) — Epics 1–9, 5b, 7, 8, 9.

### UX Design Documents

**Whole Documents:**
- `ux/DESIGN.md` (9,741 bytes, 2026-08-20 14:18) — Design tokens & components.
- `ux/EXPERIENCE.md` (11,494 bytes, 2026-08-08 21:16) — Experience flows (Facebook/X).

**Sharded / Review:**
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` (8,102 bytes, 2026-08-19) — UX findings từ kiến trúc.

## Issues Found

### ⚠️ CRITICAL: Duplicate PRD versions

Tìm thấy cả `prd.md` (whole) và 4 bản PRD trong `prds/` (sharded). Các bản này có overlap nội dung:
- `prd.md` mới nhất (2026-08-19 approved) và có FR-85..88 / NFR-17.
- `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` là bản nháp trước đó.
- Các bản cũ hơn (`2026-06-08`, `2026-06-10`, `2026-08-14`) chứa FR cho Epics 1–9.

Cần bạn xác nhận bản canonical cho từng phạm vi:
- **Epics 10–20:** `prd.md` có phải là canonical không?
- **Epics 1–9 (Facebook):** Các PRD cũ có phải deprecated / chỉ dùng để tham khảo không?

### ⚠️ CRITICAL: Architecture whole vs sharded

Tìm thấy cả `architecture.md` (whole, 46K) và `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (sharded, 38K). Cần chọn canonical.

### ⚠️ WARNING: UX docs lỗi thời

`DESIGN.md` và `EXPERIENCE.md` được cập nhật 2026-06-19/2026-08-08, trước khi Epics 10–20 được phê duyệt. `ARCHITECTURE-UX-REVIEW` là nguồn mới hơn (2026-08-19) nhưng chưa được chuyển thành UX spec cụ thể.

## Required Actions

1. Xác nhận PRD canonical (`prd.md` vs `prds/*`).
2. Xác nhận Architecture canonical (`architecture.md` vs `ARCHITECTURE-SPINE.md`).
3. Xác nhận có cần bổ sung UX review vào `DESIGN.md` / `EXPERIENCE.md` không.

## Menu

**Document Discovery hoàn tất.**

**Select an Option:** [C] Continue to PRD Analysis — User selected 'C'.

---

## Step 2: PRD Analysis

### PRDs Read

Tôi đã đọc toàn bộ các PRD sau:

| PRD | FR Range | NFR Range | Ghi chú |
|---|---|---|---|
| `prd.md` | FR-64..FR-84 + FR-85..FR-88 (Appendix) | NFR-11..NFR-17 | Canonical cho Epics 10–20; approved 2026-08-19. |
| `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` | FR-64..FR-84 | NFR-11..NFR-16 | Bản nháp trước; thiếu FR-85..88 / NFR-17. |
| `prds/prd-XActions-2026-08-14-epic7/prd.md` | FR-55..FR-63 | NFR-10..NFR-15 | Epic 7; FR-62 được defer Phase 3. |
| `prds/prd-XActions-2026-06-10-epic4/prd.md` | FR-15..FR-23 | NFR-6..NFR-10 | Epic 4 (Facebook growth automation). |
| `prds/prd-XActions-2026-06-08/prd.md` | FR-1..FR-14 | — | Facebook Platform Extension v1. |

### Functional Requirements Extracted

**FR-1..FR-14 — Facebook Platform Extension (Epic 1–3):**

| ID | Requirement |
|---|---|
| FR-1 | Scrape Facebook profile công khai. |
| FR-2 | Scrape posts gần đây của profile/page. |
| FR-3 | Scrape followers khi Facebook cho phép. |
| FR-4 | Search posts/nội dung Facebook. |
| FR-5 | Đăng ký Facebook vào dispatcher (`facebook`/`fb`). |
| FR-6 | Like post (dry-run mặc định). |
| FR-7 | Comment trên post (dry-run mặc định). |
| FR-8 | Tạo post text (kèm media). |
| FR-9 | Cơ chế an toàn dùng chung (dry-run, delay, batch, retry, stop condition). |
| FR-10 | Login bằng session cookie `c_user` + `xs`. |
| FR-11 | MCP tool/option Facebook. |
| FR-12 | CLI `--platform facebook`. |
| FR-13 | REST API + Dashboard cho Facebook. |
| FR-14 | Persistence job automation qua Prisma. |

**FR-15..FR-23 — Epic 4 Facebook Growth Automation:**

| ID | Requirement |
|---|---|
| FR-15 | Lên lịch post Facebook. |
| FR-16 | Auto-share post. |
| FR-17 | View boost (scroll simulation). |
| FR-18 | Tham gia nhóm tự động. |
| FR-19 | Đăng bài vào nhiều nhóm (batch). |
| FR-20 | Scrape thành viên nhóm. |
| FR-21 | Gửi kết bạn tự động. |
| FR-22 | Hủy lời mời kết bạn đang chờ. |
| FR-23 | Newsfeed farming / account warming. |

**FR-55..FR-63 — Epic 7 Facebook Advanced Scraping:**

| ID | Requirement |
|---|---|
| FR-55 | Account health check. |
| FR-56 | Account pool & parallel runner. |
| FR-57 | Search Facebook multi-type (posts/people/pages/groups). |
| FR-58 | Scrape post comments. |
| FR-59 | Scrape group posts. |
| FR-60 | Scrape group comments. |
| FR-61 | Hydration JSON extraction. |
| FR-62 | GraphQL replay (deferred Phase 3). |
| FR-63 | Unified Facebook scrape service. |

**FR-64..FR-84 — Epics 10–20 Universal Scraping Engine (canonical `prd.md`):**

| ID | Requirement | Epic |
|---|---|---|
| FR-64 | Core domain interfaces (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) | 10 |
| FR-65 | Tiered Hybrid Signer Engine | 13/14 |
| FR-66 | Proxy Pool & Auto-Quarantine (Static/Dynamic Tunnel, WebRTC/DNS leak flags, buffer expiration, 429/403 quarantine 5 min, retry 3 lần, standby backoff 30s) | 11 |
| FR-66B | Adaptive Rate Limiter | 11 |
| FR-67 | Namespaced PostgreSQL Storage & JSONB GIN Indexes | 10 |
| FR-68 | Terminal ASCII QR Code Login | 12 |
| FR-69 | CDP Remote Attach Mode | 12 |
| FR-70 | Topological Comment Tree Extraction | 14 |
| FR-71 | Twitter Crawler Refactor | 13 |
| FR-72 | Facebook Crawler Refactor | 13 |
| FR-73 | MCP Daemon & CLI Integration + Streaming Dataset Exporter | 14 |
| FR-74 | Threads Meta GraphQL Scraper | 15 |
| FR-75 | TikTok Video, Hashtag & Comment Scraper | 15 |
| FR-76 | Shopee Product, Price & Review Scraper | 16 |
| FR-77 | TikTok Shop E-Commerce Winning Products Scraper | 16 |
| FR-78 | Chợ Tốt Multi-Category Scraper with Phone Extractor | 17 |
| FR-79 | Batdongsan.com.vn Property Scraper | 17 |
| FR-80 | TopCV Recruitment Scraper | 18 |
| FR-81 | VietnamWorks Job Scraper | 18 |
| FR-82 | LinkedIn B2B Lead & Job Scraper | 18 |
| FR-83 | Realtime Thin Event Redis Stream Ingest | 14 |
| FR-84 | Nowing Adapter Cutover & Legacy Scraper Decommissioning | 20 |

**FR-85..FR-88 + NFR-17 — Appendix bổ sung (chỉ có trong `prd.md`):**

| ID | Requirement | Epic / Area |
|---|---|---|
| FR-85 | Internal Operator Dashboard & Admin CLI | 19 |
| FR-86 | Metadata Schema Contract for Consumers | 10.5 |
| FR-87 | Data Retention Policy (raw 30 ngày, processed vĩnh viễn, audit log 90 ngày) | Cross-cutting |
| FR-88 | 3-Tier Incremental Gap-Filling | Cross-cutting |
| NFR-17 | Operational Observability (real-time metrics, SSE/polling 5–30s, alert thresholds) | 19 |

### Non-Functional Requirements Extracted

**NFR-1..NFR-5** không được đánh số rõ trong PRD cũ; PRD `2026-06-08` chỉ liệt kê cross-cutting NFRs dạng văn bản (Rate-limit, Anti-detection, Security, Selector resilience, Consistency, Testability).

**NFR-6..NFR-10 — Epic 4:**

| ID | Requirement |
|---|---|
| NFR-6 | Delay sàn cho write action (Cluster 1: 30–90s; Cluster 2: 60–180s). |
| NFR-7 | `runGuardedBatch` là bắt buộc cho mọi vòng lặp ghi. |
| NFR-8 | Cảnh báo account risk không thể tắt. |
| NFR-9 | Giới hạn throughput scheduling (≤ 5 scheduled posts/giờ/user). |
| NFR-10 | Không thu thập PII nhạy cảm. |

**NFR-10..NFR-15 — Epic 7:**

| ID | Requirement |
|---|---|
| NFR-10 | Không lưu trữ — XActions chỉ trả JSON. |
| NFR-11 | Health check nhanh < 2s, không mở browser. |
| NFR-12 | Concurrency cap mặc định 4, tối đa 8. |
| NFR-13 | Privacy — cookie/token không log/echo. |
| NFR-14 | Resilience — DOM fallback khi hydration/GraphQL fail. |
| NFR-15 | Read velocity — delay 1–3s, giới hạn 50 scroll/task. |

**NFR-11..NFR-17 — Epics 10–20 (canonical `prd.md`):**

| ID | Requirement |
|---|---|
| NFR-11 | Giảm ≥ 85% RAM, ≥ 70% CPU so với full headless. |
| NFR-12 | Tăng tốc 5x–10x (>500 req/s) bằng async HTTP client pool. |
| NFR-13 | Auto-quarantine 429/403, replay 3 lần exponential backoff. |
| NFR-14 | Không lưu plain-text password; đăng nhập qua QR/CDP. |
| NFR-15 | `src/core/` zero-dependency; thêm platform chỉ cần adapter. |
| NFR-16 | MIT/Apache 2.0; tương thích ngược CLI `unfollowx` và 80+ MCP tools. |
| NFR-17 | Operational observability (metrics endpoints, SSE/polling, alerts). |

### Additional Requirements / Constraints

- **Data Retention Policy:** Raw data 30 ngày, processed data vĩnh viễn ở Nowing, audit logs 90 ngày.
- **3-Tier Incremental Gap-Filling:** full seed → delta/gap fill → on-demand refresh.
- **Open Questions (Epic 7):** FR-62 GraphQL replay deferred Phase 3.
- **Assumptions:** Tái dùng `Operation` model; không tạo bảng riêng cho Facebook ở MVP.

### PRD Completeness Assessment

**Điểm mạnh:**
- PRD `prd.md` (Epics 10–20) đã approved, có FR-64..FR-88 và NFR-11..NFR-17 đầy đủ.
- Có appendix traceability ngắn gọn Epic 19/20/10.5.
- Phasing rõ ràng (Phase 1–5).

**Điểm yếu / rủi ro:**
1. **Khoảng trống FR-24..FR-54:** Không tìm thấy PRD cho Epics 5, 5b, 6. `epics-full.md` đề cập FR-24..FR-54 nhưng thiếu PRD source.
2. **Xung đột số NFR:** NFR-10 xuất hiện ở cả Epic 4 (Không thu thập PII) và Epic 7 (Không lưu trữ). NFR-11..NFR-15 cũng xuất hiện ở cả Epic 7 và Epics 10–20 với nội dung khác nhau.
3. **FR-66 / FR-66B / FR-73A / FR-73B:** Có sub-label `A`/`B` nhưng chưa có quy ước rõ ràng trong master register.
4. **FR-62 GraphQL replay:** Được defer nhưng vẫn xuất hiện trong `epics-full.md` và `prd-XActions-2026-08-14-epic7/prd.md`; cần quyết định implement hoặc loại bỏ.
5. **Duplicate PRD:** `prd.md` và `prd-XActions-2026-08-18-universal-scraping-engine/prd.md` gần như giống nhau, bản cũ thiếu appendix FR-85..88 / NFR-17.

### PRD Analysis Summary

- **Tổng FR tracked:** 88 (FR-1..FR-88, với FR-24..FR-54 thiếu source).
- **Tổng NFR tracked:** 17 (NFR-1..NFR-17, với xung đột NFR-10..NFR-15).
- **Canonical PRD:** `prd.md` cho Epics 10–20; `prd-XActions-2026-08-14-epic7` cho Epic 7; `prd-XActions-2026-06-10-epic4` cho Epic 4; `prd-XActions-2026-06-08` cho Epics 1–3.
- **Trạng thái:** Cần khắc phục khoảng trống FR-24..FR-54 và xung đột NFR trước khi đánh giá epic coverage.

**Step 2 hoàn tất. Tiếp tục Epic Coverage Validation.**

---

## Step 3: Epic Coverage Validation

### Epic FR Coverage Extracted

**Từ `epics-full.md` (Epics 1–9 / FR1–FR63):**

| FR Range | Epic | Tên Epic | Trạng thái |
|---|---|---|---|
| FR1–FR7 | Epic 1 | Facebook Data Reading | ✅ Done |
| FR12–FR14 | Epic 2 | Facebook Automation | ✅ Done |
| FR8–FR11 | Epic 3 | Facebook Multi-Surface & Persistence | ✅ Done |
| FR15–FR22 | Epic 4 | Facebook Growth Automation | ✅ Done |
| FR23–FR27 | Epic 5 | Facebook Messenger Port | ✅ Done |
| FR28–FR39 | Epic 5b | Marketplace & Infrastructure Enhancements | ✅ Done |
| FR40–FR54 | Epic 6 | Facebook Anti-Detection & Bot Countermeasures | 🔄 13 backlog |
| FR55–FR61, FR63 | Epic 7 | Facebook Advanced Scraping & Multi-Account Parallel Execution | ✅ Done (FR62 deferred) |
| PCR2, PCR6, PCR7 | Epic 8 | Facebook Backend Reliability | 🆕 backlog |
| PCR1, PCR3–PCR5 | Epic 9 | Facebook Live Data & Behavioral Hardening | 🆕 backlog |

**Từ `epics.md` (Epics 10–20 / FR64–FR88):**

| FR | Epic / Story | Ghi chú |
|---|---|---|
| FR64 | Story 10.1 | Core Domain Interfaces |
| FR65 | Story 13.1 | Tiered Hybrid Signer Engine |
| FR66 | Story 11.1 + 11.2 | Proxy Pool & Auto-Quarantine |
| FR66B | Story 11.4 | Adaptive Rate Limiter & Account Protection Governor |
| FR67 | Story 10.2 | Namespaced PostgreSQL Storage |
| FR68 | Story 12.1 | Terminal QR Login |
| FR69 | Story 12.2 | CDP Remote Attach |
| FR70 | Story 14.1 | Topological Comment Tree |
| FR71 | Story 13.2 | Twitter Crawler Refactor |
| FR72 | Story 13.3 | Facebook Crawler Refactor |
| FR73 | Story 14.2 | MCP Daemon & CLI Integration |
| FR74 | Story 15.1 | Threads Scraper Adapter |
| FR75 | Story 15.2 | TikTok Scraper |
| FR76 | Story 16.1 | Shopee Scraper |
| FR77 | Story 16.2 | TikTok Shop Scraper |
| FR78 | Story 17.1 | Chợ Tốt Scraper |
| FR79 | Story 17.2 | Batdongsan Scraper |
| FR80 | Story 18.1 | TopCV Scraper |
| FR81 | Story 18.2 | VietnamWorks Scraper |
| FR82 | Story 18.3 | LinkedIn Scraper |
| FR83 | Story 14.3 | Redis Stream Ingest |
| FR84 | Story 20.1 | Nowing Cutover |
| FR85 | Stories 19.1–19.4, 19.6–19.8 | Operator Dashboard & Admin CLI |
| FR86 | Story 10.5 | Metadata Schema Contract |
| FR87 | Stories 10.2, 19.x | Data Retention Policy |
| FR88 | Stories 10.3, 11.x | 3-Tier Incremental Gap-Filling |

### FR Coverage Analysis

| FR | PRD Requirement | Epic Coverage | Trạng thái |
|---|---|---|---|
| FR1 | Scrape profile | Epic 1 | ✅ Covered |
| FR2 | Scrape posts | Epic 1 | ✅ Covered |
| FR3 | Scrape followers | Epic 1 | ✅ Covered |
| FR4 | Search posts | Epic 1 | ✅ Covered |
| FR5 | Register platform | Epic 1 | ✅ Covered |
| FR6 | Like post | Epic 2 | ✅ Covered |
| FR7 | Comment post | Epic 2 | ✅ Covered |
| FR8 | Create post | Epic 2 | ✅ Covered |
| FR9 | Shared safety guardrails | Epic 2 | ✅ Covered |
| FR10 | Login with cookie | Epic 2 | ✅ Covered |
| FR11 | MCP tool Facebook | Epic 3 | ✅ Covered |
| FR12 | CLI `--platform facebook` | Epic 3 | ✅ Covered |
| FR13 | REST API + Dashboard | Epic 3 | ✅ Covered |
| FR14 | Persistence via Prisma | Epic 3 | ✅ Covered |
| FR15 | Schedule post | Epic 4 | ✅ Covered |
| FR16 | Auto-share | Epic 4 | ✅ Covered |
| FR17 | View boost | Epic 4 | ✅ Covered |
| FR18 | Join group | Epic 4 | ✅ Covered |
| FR19 | Batch group post | Epic 4 | ✅ Covered |
| FR20 | Scrape group members | Epic 4 | ✅ Covered |
| FR21 | Send friend requests | Epic 4 | ✅ Covered |
| FR22 | Cancel pending requests | Epic 4 | ✅ Covered |
| FR23 | Newsfeed farming | Epic 4 | ✅ Covered |
| FR24 | `shareLinkByUid` v1 | Epic 5 | ✅ Covered |
| FR25 | Auth proxy | Epic 5 | ✅ Covered |
| FR26 | Input queue surfaces | Epic 5 | ✅ Covered |
| FR27 | Session/campaign UI | Epic 5 | ✅ Covered |
| FR28 | Marketplace scraper | Epic 5b | ✅ Covered |
| FR29 | Parse multi-currency | Epic 5b | ✅ Covered |
| FR30 | Extract title camelCase | Epic 5b | ✅ Covered |
| FR31 | Extract location | Epic 5b | ✅ Covered |
| FR32 | `shareLinkByUid` v2 | Epic 5b | ✅ Covered |
| FR33 | `recipientUid` support | Epic 5b | ✅ Covered |
| FR34 | Per-recipient results | Epic 5b | ✅ Covered |
| FR35 | `headless` parameter | Epic 5b | ✅ Covered |
| FR36 | `headless: true` defaults | Epic 5b | ✅ Covered |
| FR37 | `headless: false` mode | Epic 5b | ✅ Covered |
| FR38 | Response includes mode | Epic 5b | ✅ Covered |
| FR39 | Auto-resolve Chrome path | Epic 5b | ✅ Covered |
| FR40 | User-Agent pool | Epic 6 | ✅ Done |
| FR41 | Viewport randomization | Epic 6 | ✅ Done |
| FR42 | WebRTC leak prevention | Epic 6 | ✅ Done |
| FR43 | Override navigator props | Epic 6 | ✅ Done |
| FR44 | Bezier mouse movement | Epic 6 | **backlog** | ⚠️ Gap |
| FR45 | Human click simulation | Epic 6 | **backlog** | ⚠️ Gap |
| FR46 | Typing simulation | Epic 6 | **backlog** | ⚠️ Gap |
| FR47 | Natural scrolling | Epic 6 | **backlog** | ⚠️ Gap |
| FR48 | Session warming | Epic 6 | **backlog** | ⚠️ Gap |
| FR49 | Timezone override | Epic 6 | **backlog** | ⚠️ Gap |
| FR50 | Geolocation override | Epic 6 | **backlog** | ⚠️ Gap |
| FR51 | Persistent profiles | Epic 6 | **backlog** | ⚠️ Gap |
| FR52 | Fingerprint consistency | Epic 6 | **backlog** | ⚠️ Gap |
| FR53 | Velocity limits | Epic 6 | **backlog** | ⚠️ Gap |
| FR54 | Account age awareness | Epic 6 | **backlog** | ⚠️ Gap |
| FR55 | Account health check | Epic 7 | ✅ Covered |
| FR56 | Account pool & parallel runner | Epic 7 | ✅ Covered |
| FR57 | Multi-type search | Epic 7 | ✅ Covered |
| FR58 | Scrape post comments | Epic 7 | ✅ Covered |
| FR59 | Scrape group posts | Epic 7 | ✅ Covered |
| FR60 | Scrape group comments | Epic 7 | ✅ Covered |
| FR61 | Hydration JSON extraction | Epic 7 | ✅ Covered |
| FR62 | GraphQL replay | **deferred** | ⚠️ Pending decision |
| FR63 | Unified Facebook scrape service | Epic 7 | ✅ Covered |
| FR64 | Core domain interfaces | Story 10.1 | ✅ Covered |
| FR65 | Tiered Hybrid Signer Engine | Story 13.1 | ✅ Covered |
| FR66 | Proxy Pool & Auto-Quarantine | Story 11.1/11.2 | ✅ Covered |
| FR66B | Adaptive Rate Limiter | Story 11.4 | ✅ Covered |
| FR67 | Namespaced PostgreSQL Storage | Story 10.2 | ✅ Covered |
| FR68 | Terminal QR Login | Story 12.1 | ✅ Covered |
| FR69 | CDP Remote Attach | Story 12.2 | ✅ Covered |
| FR70 | Topological Comment Tree | Story 14.1 | ✅ Covered |
| FR71 | Twitter Crawler Refactor | Story 13.2 | ✅ Covered |
| FR72 | Facebook Crawler Refactor | Story 13.3 | ✅ Covered |
| FR73 | MCP Daemon & CLI Integration | Story 14.2 | ✅ Covered |
| FR74 | Threads Scraper | Story 15.1 | ✅ Covered |
| FR75 | TikTok Scraper | Story 15.2 | ✅ Covered |
| FR76 | Shopee Scraper | Story 16.1 | ✅ Covered |
| FR77 | TikTok Shop Scraper | Story 16.2 | ✅ Covered |
| FR78 | Chợ Tốt Scraper | Story 17.1 | ✅ Covered |
| FR79 | Batdongsan Scraper | Story 17.2 | ✅ Covered |
| FR80 | TopCV Scraper | Story 18.1 | ✅ Covered |
| FR81 | VietnamWorks Scraper | Story 18.2 | ✅ Covered |
| FR82 | LinkedIn Scraper | Story 18.3 | ✅ Covered |
| FR83 | Redis Stream Ingest | Story 14.3 | ✅ Covered |
| FR84 | Nowing Cutover | Story 20.1 | ✅ Covered |
| FR85 | Operator Dashboard & Admin CLI | Epic 19 | ✅ Covered |
| FR86 | Metadata Schema Contract | Story 10.5 | ✅ Covered |
| FR87 | Data Retention Policy | Story 10.2 / Epic 19 | ✅ Covered |
| FR88 | 3-Tier Incremental Gap-Filling | Story 10.3 / Epic 11 | ✅ Covered |

### Missing FR Coverage

#### Critical Missing / Pending

| FR | Vấn đề | Khuyến nghị |
|---|---|---|
| **FR24–FR54 (Epic 6 backlog)** | 13/18 FR trong Epic 6 (fingerprint/behavioral) đang ở trạng thái `backlog`, không có story chi tiết nào được tạo. | Chuyển Epic 6 từ `backlog` sang `in-progress`, chia nhỏ thành 2–3 stories cho fingerprint/behavior/session-hygiene. |
| **FR62 — GraphQL replay** | Được defer Phase 3 trong PRD Epic 7, nhưng vẫn xuất hiện trong `epics-full.md` và `epics.md` Story 13.3 (Facebook Crawler Refactor có thể cần). | Quyết định: implement trong Epic 7/13.3 hoặc loại bỏ / chuyển sang `FUTURE-WORK.md` rõ ràng. |
| **FR24–FR54 thiếu PRD source** | Không có PRD nào trong `prds/` cho Epics 5, 5b, 6 (ngoại trừ các FR được liệt kê trong `epics-full.md`). | Tạo PRD tổng hợp hoặc xác nhận `epics-full.md` là source duy nhất cho các FR này. |

#### High Priority Gaps

- **NFR numbering conflict:** NFR-10 có 2 nghĩa (Epic 4: no PII; Epic 7: no storage). NFR-11–NFR-15 cũng xuất hiện ở cả Epic 7 và Epics 10–20 với nội dung khác nhau.
- **FR numbering style inconsistency:** `epics-full.md` dùng `FR1` (không dấu gạch), `epics.md` dùng `FR64` (không dấu gạch), PRD dùng `FR-64`. Cần thống nhất `FR-XX`.
- **FR66 / FR66B / FR73A / FR73B:** Các sub-label chưa được khai báo rõ trong master register.

### Coverage Statistics

- **Tổng FR tracked:** 88 (FR-1..FR-88).
- **FRs covered ✅:** 71.
- **FRs backlog / missing / pending:** 14 (FR44–FR54) + 1 (FR62) = 15.
- **Coverage percentage:** ~80% (nếu tính FR44–FR54 là backlog), ~83% nếu chỉ tính FR được gán epic.

**Step 3 hoàn tất. Tiếp tục UX Alignment.**

---

## Step 4: UX Alignment Assessment

### UX Document Status

- `ux/DESIGN.md` — Tồn tại (draft, 2026-06-19). Design tokens, components cho dashboard X/Twitter + Facebook.
- `ux/EXPERIENCE.md` — Tồn tại (draft, 2026-06-19). User flows cho Facebook automation, account warmup, friend requests.
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` — Tồn tại (2026-08-18). 10 UX findings (F1–F10) từ kiến trúc r3.

### UX ↔ PRD Alignment

| PRD Requirement | UX Coverage | Đánh giá |
|---|---|---|
| FR-85 / Epic 19 — Operator Dashboard & Admin CLI | DESIGN.md có sidebar nav (`Dashboard`, `Analytics`, `Accounts`) nhưng chưa định nghĩa 5 views (Jobs, Proxies, Accounts, Checkpoints, Stream Metrics) theo F9. | ⚠️ Partial |
| FR-68 / Epic 12 — Terminal QR Login | EXPERIENCE.md không đề cập QR login; DESIGN.md chỉ có account selector. F2 chỉ ra thiếu non-TTY fallback. | ❌ Gap |
| FR-73 / Epic 14 — MCP Daemon HTTP/SSE | Không có UX cho daemon startup/status (F1). | ❌ Gap |
| FR-66B / Epic 11 — Adaptive Rate Governor | DESIGN.md không có components cho governor status, healthy proxy ratio, hibernation (F3). | ❌ Gap |
| FR-83 / Epic 14 — Redis Stream | Không có dashboard panel cho stream metrics (F7). | ❌ Gap |
| FR-86 / Story 10.5 — Metadata Schema Contract | Không có Schema Viewer component trong DESIGN.md (F8). | ❌ Gap |
| FR-87 / FR-88 — Data retention & 3-tier gap fill | Không có UX cho checkpoint management (F4) hoặc retention policy config. | ❌ Gap |
| NFR-17 — Operational Observability | DESIGN.md chỉ có generic result panel, chưa có real-time metrics / alerts. | ❌ Gap |

### UX ↔ Architecture Alignment

| Architecture Decision | UX Implication | Tình trạng |
|---|---|---|
| AD-7 MCP HTTP/SSE daemon (port 3001) | Cần `xactions daemon start/status/stop` và dashboard tile (F1). | ❌ Chưa cover |
| AD-5 Terminal QR Login | Cần non-TTY fallback, timeout message, URL/short code (F2). | ❌ Chưa cover |
| AD-13 Adaptive Rate Governor | Cần public status API + CLI `xactions status` + dashboard view (F3). | ❌ Chưa cover |
| AD-10/AD-12 CrawlCheckpoint | Cần API/CLI `xactions checkpoints list` + dashboard table (F4). | ❌ Chưa cover |
| AD-11 Platform registry | Cần `listActions()` và `xactions actions --platform <p>` (F5). | ❌ Chưa cover |
| AD-9 Error taxonomy | Cần error envelope `{ code, type, message, retryAfter, suggestedAction }` (F6). | ❌ Chưa cover |
| AD-7 Redis Stream `stream:social:raw_posts` | Cần metrics panel `eventsPerSecond`, `pendingMessages`, `droppedEvents`, `lastAckTime` (F7). | ❌ Chưa cover |
| AD-4 `Post.metadata` Json | Cần schema discovery UX `x_schema_get --platform shopee --category ecom` (F8). | ❌ Chưa cover |
| AD-2 backward compatibility `unfollowx` | Cần legacy CLI command mapping và error message rõ ràng (F10). | ❌ Chưa cover |
| Internal Operator Dashboard | DESIGN.md chưa có 5 views cụ thể (F9). | ❌ Chưa cover |

### Warnings

1. **DESIGN.md / EXPERIENCE.md lỗi thời (2026-06-19):** Chỉ cover Facebook + X/Twitter dashboard cũ, không cover Epics 10–20 (operator dashboard, multi-platform scrapers, MCP daemon, governor, checkpoints, stream metrics).
2. **10 UX findings từ ARCHITECTURE-UX-REVIEW chưa được chuyển thành story/AC:** F1–F10 còn dạng recommendations, chưa có epic/story cụ thể chịu trách nhiệm.
3. **Thiếu components mới:** Admin Status Card, Alert Banner, Data Table, Schema Viewer, Stream Metrics Chart, CLI Output Blocks (cần cho Epic 19/operator flows).
4. **Persona chưa rõ:** EXPERIENCE.md tập trung marketer/end-user; Epic 19/operator persona chưa được định nghĩa.

### UX Alignment Summary

- **UX docs tồn tại:** Có.
- **Align với PRD cũ (Epic 1–4):** Tương đối khớp.
- **Align với PRD mới (Epics 10–20):** **KHÔNG khớp** — thiếu operator dashboard, MCP/CLI discovery, governor/checkpoint/stream metrics UX.
- **Kiến trúc chưa bổ sung UX rules:** F1–F10 cần được map vào AD và story AC.

**Step 4 hoàn tất. Tiếp tục Epic Quality Review.**

---

## Step 5: Epic Quality Review

### Epic Structure Validation

#### A. User Value Focus Check

| Epic | Title / Goal | Đánh giá user value |
|---|---|---|
| **Epic 8** | `Facebook Backend Reliability` — "Harden backend infrastructure: database connection pooling, MCP error contract, auth token handling." | 🔴 **Technical epic, thiếu user value.** Không nói cho ai, để làm gì, lợi ích gì. Cần reframe thành user-centric (e.g. "Facebook Backend Stability for Operators & MCP Clients"). |
| **Epic 9** | `Facebook Live Data & Behavioral Hardening` — "Harden runtime Facebook behavior: dry-run short-circuit, live DOM selectors, testable delay seams." | 🟠 **Technical epic.** Có thể chấp nhận nếu là maintenance/hardening, nhưng nên định rõ người dùng là Operator hoặc AI agent. |
| **Epic 10** | `Unified PostgreSQL Storage (Prisma) & Core Interfaces` | 🟡 **Phần lớn là foundation.** Story 10.1/10.2 dùng user role "Core Developer" / "Backend & Platform Engineer" — không phải end-user. Cần reframe lợi ích cho Operator/Data Scientist. |
| **Epic 11** | `Resilient Network & Proxy Pool Management` | 🟢 User value rõ ràng cho Operator/Reliability Engineer. |
| **Epic 19** | `Internal Operator Dashboard, Admin CLI & Operational Observability` | 🟢 User value rõ ràng cho Operations Manager. |
| **Epic 20** | `Nowing Cutover & Legacy Scraper Decommissioning` | 🟢 User value rõ: giảm Docker size, thống nhất hạ tầng. |

#### B. Epic Independence & Forward Dependencies

| Vấn đề | Ví dụ | Mức độ |
|---|---|---|
| **Story 11.5 phụ thuộc 11.4 + 11.7** | AC 11.5 yêu cầu `governor`, `PlatformResponseValidator` — là output của 11.4 và 11.7. | 🔴 Critical — forward reference trong epic. |
| **Story 11.6 phụ thuộc 11.5 + 11.4** | AC 11.6 yêu cầu `AbstractApiClient pipeline đã chạy` và `governor.hibernateAccount` — phụ thuộc 11.5/11.4. | 🔴 Critical — forward reference. |
| **Story 20.1 phụ thuộc Epics 15–18** | AC: "Given XActions đã hoàn thành các crawler đa nền tảng (Social, Ecom, BĐS, Tuyển dụng) từ Epic 15–18". | 🔴 Critical — forward cross-epic dependency. |
| **Story 18.3 phụ thuộc 12.2** | LinkedIn CDP attach cần Epic 12.2 hoàn thành. | 🟠 Major — cross-epic dependency, cần map rõ. |
| **Thiếu Cross-Epic Dependency Map** | `epics.md` không còn phần "Cross-Epic Dependency & Sequence Map". | 🔴 Critical — khó kiểm soát thứ tự và blocker. |

#### C. Story Sizing & Structure

| Story | Vấn đề | Khuyến nghị |
|---|---|---|
| **Story 10.1** | "As a Core Developer" — technical role, story nền tảng. | 🟠 Chuyển user role thành "Platform Engineer" hoặc chấp nhận là foundation, nhưng phải có lợi ích rõ cho developer consumer. |
| **Story 10.2** | "As a Backend & Platform Engineer" — technical role. | 🟠 Tương tự 10.1. |
| **Story 11.5** | Kết hợp request pipeline + two-mode IP + validator + no direct fallback — epic-sized. | 🔴 Tách hoặc sắp xếp lại sau 11.7; hoặc merge 11.3/11.5/11.6 theo logic pipeline. |
| **Story 11.6** | Rate-limit/bot-challenge defense trùng lặp với 11.3 (quarantine/retry/hibernation). | 🔴 Consolidate hoặc phân rõ: 11.3 = interceptor cơ bản; 11.6 = platform validator + hibernation. |
| **Story 20.1** | Bao gồm cả shadow-run adapter + xóa 20+ scraper + gỡ dependencies — quá lớn. | 🔴 Chia thành 20.1 (Nowing Shadow-Run Adapter) và 20.2 (Legacy Scraper Decommissioning). |

#### D. Acceptance Criteria Review

| Story | AC Quality | Vấn đề |
|---|---|---|
| **10.1** | Dài, nhiều "And" liên tiếp. | 🟡 Nên chia thành 2–3 story nhỏ hơn hoặc nhóm AC theo theme (interfaces, errors, registry). |
| **10.2** | Format Given/When/Then, rõ ràng. | ✅ Tốt. |
| **11.3** | AC tập trung, có Given/When/Then. | ✅ Tốt. |
| **11.4** | Nhiều "And" liên tiếp, bao gồm cả Redis lag. | 🟡 Có thể tách Redis lag thành story riêng hoặc AC riêng. |
| **11.5** | AC là một pipeline tuần tự 6 bước. | 🟠 Quá lớn, cần chia hoặc giảm scope. |
| **11.6** | Chồng chéo với 11.3. | 🔴 Cần merge hoặc làm rõ ranh giới. |
| **20.1** | AC yêu cầu nhiều epic khác hoàn thành trước, không testable độc lập. | 🔴 Tách + thêm pre-condition thay vì AC. |

#### E. Database/Entity Creation Timing

- **Story 10.2** tạo `Post`, `Comment`, `CrawlCheckpoint` — đúng thời điểm (khi cần lưu trữ).
- **Story 10.1** tạo abstract classes, không tạo DB — hợp lý.
- Không phát hiện story tạo tất cả bảng upfront.

### Quality Assessment Summary

#### 🔴 Critical Violations

1. **Epic 8 là technical epic** — không có user value rõ ràng. Cần reframe.
2. **Story 11.5 và 11.6 có forward dependency trong Epic 11** — phụ thuộc 11.4, 11.7, 11.3. Cần sắp xếp lại thứ tự hoặc consolidate.
3. **Story 20.1 epic-sized và phụ thuộc Epics 15–18** — cần split thành 2 stories và thêm cross-epic dependency map.
4. **Thiếu Cross-Epic Dependency Map trong `epics.md`** — khó xác định thứ tự và blocker.

#### 🟠 Major Issues

5. **Story 10.1 / 10.2 dùng user role kỹ thuật** (Core Developer, Backend Engineer) — nên reframe hoặc giải thích user value.
6. **11.3, 11.5, 11.6 chồng chéo scope** — cả 3 đều đề cập quarantine, retry, backoff, hibernation. Cần consolidate hoặc ranh giới rõ.
7. **Story 18.3 bị block bởi 12.2** — cross-epic dependency cần được document.
8. **Epic 9 technical** — cần định nghĩa rõ target user.

#### 🟡 Minor Concerns

9. **NFR traceability matrix trong `epics.md`** chỉ map NFR → story, không map FR → story — khó traceability.
10. **Một số AC quá dài** (10.1, 11.4) — nên chia nhỏ để testable.

### Epic Quality Verdict

**Tồn tại 4–5 critical violations cần khắc phục trước khi bắt đầu Phase 4:**
- Reframe Epic 8/10 (nếu áp dụng user-value strictly).
- Sắp xếp lại Epic 11 (consolidate 11.3/11.5/11.6 hoặc điều chỉnh thứ tự).
- Split Story 20.1.
- Thêm Cross-Epic Dependency Map.
- Document dependency 18.3 → 12.2.

**Step 5 hoàn tất. Tiến hành Final Assessment.**

---

## Step 6: Final Assessment

### Overall Readiness Status

**NEEDS WORK**

Dự án có PRD, Architecture, Epics, và UX docs, nhưng tồn tại nhiều critical gaps về traceability, epic quality, UX alignment, và canonicalization cần khắc phục trước khi bắt đầu Phase 4.

### Critical Issues Requiring Immediate Action

1. **Canonical PRD & FR/NFR Numbering Conflicts**
   - `prd.md` (whole) và `prd-XActions-2026-08-18-universal-scraping-engine/prd.md` gần như trùng lặp.
   - `FR-66` / `FR-66B`, `FR-73` / `FR-73A` / `FR-73B` — chưa có quy ước rõ ràng.
   - NFR-10, NFR-11–NFR-15 xuất hiện ở nhiều PRD với nghĩa khác nhau.
   - Thiếu PRD source cho FR-24..FR-54 (Epics 5, 5b, 6).

2. **Epic Quality Violations**
   - **Epic 8** là technical epic (`Facebook Backend Reliability`) — thiếu user value.
   - **Story 11.5 / 11.6** có forward dependency trong Epic 11 (phụ thuộc 11.3, 11.4, 11.7).
   - **Story 20.1** epic-sized (shadow-run + decommissioning) và phụ thuộc Epics 15–18.
   - **Thiếu Cross-Epic Dependency Map** trong `epics.md`.

3. **UX Alignment Gaps**
   - `DESIGN.md` / `EXPERIENCE.md` lỗi thời (2026-06-19), không cover Epics 10–20.
   - 10 UX findings từ `ARCHITECTURE-UX-REVIEW-2026-08-18` chưa được chuyển thành epic/story.
   - Thiếu components mới: Admin Status Card, Alert Banner, Schema Viewer, Stream Metrics Chart.

4. **Architecture Canonicalization**
   - Cả `architecture.md` (whole) và `ARCHITECTURE-SPINE.md` (sharded) cùng tồn tại. Cần khai báo canonical và đánh dấu deprecated.
   - UX review findings chưa được merge vào architecture/spine.

5. **FR/NFR Traceability**
   - `epics.md` chỉ có NFR matrix, không có FR → story mapping.
   - FR-62 (GraphQL replay) cần quyết định: implement hoặc loại bỏ / defer rõ ràng.

### Recommended Next Steps

1. **Declare canonical docs:**
   - `prd.md` canonical cho Epics 10–20.
   - `ARCHITECTURE-SPINE.md` canonical architecture.
   - Đánh dấu `architecture.md` và `prd-XActions-2026-08-18-universal-scraping-engine/prd.md` deprecated.

2. **Tạo FR/NFR master register:**
   - Giải quyết xung đột NFR-10..NFR-15 bằng cách thêm prefix phạm vi (FB-, E7-, U-).
   - Quy ước cho FR-66A/B, FR-73A/B.
   - Tạo PRD bổ sung hoặc xác nhận source cho FR-24..FR-54.

3. **Refine epics:**
   - Reframe Epic 8 / Epic 10 theo hướng user value.
   - Sắp xếp lại Epic 11 (consolidate 11.3/11.5/11.6 hoặc điều chỉnh thứ tự).
   - Split Story 20.1 thành 20.1 (Shadow-Run Adapter) và 20.2 (Legacy Decommissioning).
   - Thêm Cross-Epic Dependency Map vào `epics.md`.

4. **Address UX gaps:**
   - Cập nhật `DESIGN.md` / `EXPERIENCE.md` với operator/AI flows.
   - Tạo `ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` mapping F1–F10 sang epic/story với AC.

5. **Resolve open FR decisions:**
   - FR-62: implement trong Phase 3 hoặc loại bỏ khỏi PRD.
   - FR-24..FR-54: xác nhận PRD source.

### Final Note

Assessment này xác định **5 nhóm vấn đề critical** (canonicalization, FR/NFR conflicts, epic quality, UX alignment, cross-epic dependencies) và **10+ major/minor gaps**. Khắc phục các vấn đề critical trước khi triển khai sẽ giảm đáng kể rủi ro phải refactor hoặc dừng sprint giữa chừng. Báo cáo này có thể dùng làm input cho sprint planning hoặc product council review.

---

**Implementation Readiness Assessment Complete**

- **Assessor:** AI Product Manager (nirholas)
- **Date:** 2026-08-21
- **Project:** XActions
- **Report file:** `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-21.md`

Workflow complete.
