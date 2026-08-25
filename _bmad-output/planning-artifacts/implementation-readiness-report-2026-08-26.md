---
stepsCompleted: [1, 2, 3, 4, 5, 6]
documentOutputLanguage: Việt Nam
outputFile: _bmad-output/planning-artifacts/implementation-readiness-report-2026-08-26.md
selectedDocuments:
  prd:
    primary: _bmad-output/planning-artifacts/prd.md
    supplemental:
      - _bmad-output/planning-artifacts/prd-canonicalization-addendum-2026-08-21.md
      - _bmad-output/planning-artifacts/prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md
  architecture:
    primary: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md
    supplemental:
      - _bmad-output/planning-artifacts/architecture.md
      - _bmad-output/planning-artifacts/architecture/xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md
      - _bmad-output/planning-artifacts/research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md
  epics:
    primary: _bmad-output/planning-artifacts/epics.md
    supplemental:
      - _bmad-output/planning-artifacts/epics-full.md
      - _bmad-output/planning-artifacts/test-design-epic-12.md
  ux:
    primary: _bmad-output/planning-artifacts/ux/DESIGN.md
    supplemental:
      - _bmad-output/planning-artifacts/ux/EXPERIENCE-UNIVERSAL-2026-08-21.md
      - _bmad-output/planning-artifacts/ux/EXPERIENCE.md
unresolvedDuplicates:
  - PRD: tồn tại whole prd.md + 4 sharded prd.md
  - Architecture: tồn tại whole architecture.md + sharded ARCHITECTURE-SPINE.md
  - Epics: tồn tại epics.md + epics-full.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-26
**Project:** XActions

## 1. Document Inventory

### PRD Documents

**Whole Documents:**
- `prd.md` (16,975 bytes, 2026-08-20 14:32:32)
- `prd-canonicalization-addendum-2026-08-21.md` (4,904 bytes, 2026-08-20 14:33:55)
- `prd-facebook-epics-5-6-2026-08-21.md` (9,446 bytes, 2026-08-20 14:31:06)

**Sharded Documents:**
- Folder `prds/prd-XActions-2026-06-08/`
  - `prd.md` (20,671 bytes, 2026-08-20 14:33:02)
- Folder `prds/prd-XActions-2026-06-10-epic4/`
  - `prd.md` (18,466 bytes, 2026-08-20 14:33:17)
- Folder `prds/prd-XActions-2026-08-14-epic7/`
  - `prd.md` (16,423 bytes, 2026-08-20 14:33:31)
  - `validation-report.md` (9,586 bytes, 2026-08-15 01:26:52)
- Folder `prds/prd-XActions-2026-08-18-universal-scraping-engine/`
  - `prd.md` (13,342 bytes, 2026-08-20 14:32:44)

### Architecture Documents

**Whole Documents:**
- `architecture.md` (46,618 bytes, 2026-08-20 14:37:04)

**Sharded Documents:**
- Folder `architecture/xactions-facebook-gateway-2026-08-23/`
  - `ARCHITECTURE-SPINE.md` (15,661 bytes, 2026-08-23 06:07:31)
- Folder `architecture/xactions-hybrid-scraping-spine/`
  - `ARCHITECTURE-SPINE.md` (41,826 bytes, 2026-08-23 05:33:38)
  - `ARCHITECTURE-DEV-REVIEW-2026-08-18.md` (10,205 bytes, 2026-08-18 23:08:42)
  - `ARCHITECTURE-EPIC10-PM-REVIEW-2026-08-18.md` (8,243 bytes, 2026-08-18 23:42:36)
  - `ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md` (11,984 bytes, 2026-08-18 23:29:19)
  - `ARCHITECTURE-UPDATE-GATE-2026-08-18.md` (4,400 bytes, 2026-08-18 22:28:46)
  - `ARCHITECTURE-UPDATE-GATE-2026-08-18-R3.md` (2,957 bytes, 2026-08-18 22:55:06)
  - `ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` (6,004 bytes, 2026-08-20 14:36:09)
  - `ARCHITECTURE-UX-REVIEW-2026-08-18.md` (8,102 bytes, 2026-08-19 01:08:04)
  - `ARCHITECTURE-VALIDATION-REPORT-2026-08-18.html` (40,119 bytes, 2026-08-18 22:23:43)
  - `ARCHITECTURE-VALIDATION-REPORT-2026-08-18-R2.html` (14,721 bytes, 2026-08-18 22:51:48)
  - `EPIC10-DECISION-LOG-2026-08-18.md` (6,866 bytes, 2026-08-18 23:42:26)
  - Sub-folder `reviews/`
    - `review-validate-dc8a3ed-vs-9ebc9c4-2026-08-21.md` (7,202 bytes, 2026-08-21 02:43:03)

**Research:**
- `research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md` (27,937 bytes, 2026-08-18 21:01:13)

### Epics & Stories Documents

**Whole Documents:**
- `epics.md` (64,302 bytes, 2026-08-26 02:19:48)
- `epics-full.md` (50,662 bytes, 2026-08-21 04:00:51)
- `test-design-epic-12.md` (7,373 bytes, 2026-08-21 16:45:44)

### UX Design Documents

**Whole Documents:** Không tìm thấy `*ux*.md` ở root planning-artifacts.

**Sharded Documents:**
- Folder `ux/`
  - `DESIGN.md` (11,140 bytes, 2026-08-20 14:36:20)
  - `EXPERIENCE.md` (11,494 bytes, 2026-08-08 21:16:46)
  - `EXPERIENCE-UNIVERSAL-2026-08-21.md` (4,664 bytes, 2026-08-20 14:36:42)

## 2. Duplicate & Missing Document Findings

- **PRD**: Tồn tại cả whole `prd.md` và 4 folder sharded `prds/*`. Cần chọn bản chính.
- **Architecture**: Tồn tại whole `architecture.md` và sharded `xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`.
- **Epics**: Tồn tại `epics.md` (mới nhất) và `epics-full.md`.
- **UX**: Không có whole `*ux*.md` duy nhất; có 3 file trong `ux/`.

## 3. Selected Canonical Documents

| Loại | Primary | Supplemental |
|------|---------|--------------|
| PRD | `prd.md` | `prd-canonicalization-addendum-2026-08-21.md`, `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` |
| Architecture | `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` | `architecture.md`, `xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md`, `research/...` |
| Epics | `epics.md` | `epics-full.md`, `test-design-epic-12.md` |
| UX | `ux/DESIGN.md` | `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md`, `ux/EXPERIENCE.md` |

## 4. Epic Coverage Validation

### Epic FR Coverage Extracted

`epics.md` ánh xạ FR/NFR vào các epic/story qua **Requirements Inventory** (đầu tài liệu) và ma trận **NFR Traceability Matrix** (cuối tài liệu).

| FR | Requirement (tóm tắt) | Epic / Story Coverage | Status |
|---|---|---|---|
| FR64 | Core Domain Interfaces | Epic 10.1 | ✓ Covered |
| FR65 | Tiered Hybrid Signer Engine | Epic 13.1 | ✓ Covered |
| FR66 | Anti-Leak Proxy Pool | Epic 11.1, 11.2, 11.3, 11.6 | ✓ Covered |
| FR66B | Adaptive Rate Limiter/Governor | Epic 11.4, 11.7 | ✓ Covered |
| FR67 | Namespaced PostgreSQL Storage | Epic 10.2 | ✓ Covered |
| FR68 | Terminal QR Login | Epic 12.1 | ✓ Covered |
| FR69 | CDP Remote Attach | Epic 12.2 | ✓ Covered |
| FR70 | Topological Comment Tree | Epic 14.1 | ✓ Covered |
| FR71 | Twitter Crawler Refactor | Epic 13.2 | ✓ Covered |
| FR72 | Facebook Crawler Refactor | Epic 13.3 | ✓ Covered |
| FR73 | MCP Daemon & CLI + Dataset Exporter | Story 10.3 (FR73A), Story 14.2 (FR73B) | ✓ Covered |
| FR74 | Threads Scraper | Epic 15.1 | ✓ Covered |
| FR75 | TikTok Scraper | Epic 15.2 | ✓ Covered |
| FR76 | Shopee Scraper | Epic 16.1 | ✓ Covered |
| FR77 | TikTok Shop Scraper | Epic 16.2 | ✓ Covered |
| FR78 | Chợ Tốt Scraper | Epic 17.1 | ✓ Covered |
| FR79 | Batdongsan Scraper | Epic 17.2 | ✓ Covered |
| FR80 | TopCV Scraper | Epic 18.1 | ✓ Covered |
| FR81 | VietnamWorks Scraper | Epic 18.2 | ✓ Covered |
| FR82 | LinkedIn Scraper | Epic 18.3 | ✓ Covered |
| FR83 | Redis Thin Event Stream | Epic 14.3 | ✓ Covered |
| FR84 | Nowing Cutover & Decommission | Epic 20.1, 20.2 | ✓ Covered |
| FR85 | Admin Dashboard & CLI | Epic 19.1–19.8 | ✓ Covered |
| FR86 | Metadata Schema Contract | Story 10.5 | ✓ Covered |
| FR87 | Data Retention Policy | Story 10.2, Epic 19 | ✓ Covered |
| FR88 | 3-Tier Incremental Gap-Filling | Epic 10, 11 | ✓ Covered |

### NFR Coverage

| NFR | Requirement | Epic / Story Coverage | Status |
|---|---|---|---|
| NFR11 | Resource Optimization (85% RAM, 70% CPU) | 10.2, 13.1, 13.2, 13.3, 15.2, 16.1, 16.2, 17.1, 17.2, 18.1, 18.2, 18.3, 20.2, 21.1, 21.2, 22.1, 22.2, 22.3 | ✓ Mapped |
| NFR12 | Throughput (>500 req/s, <2ms RPC) | 13.1, 13.2, 13.3, 14.2, 15.2, 16.1, 16.2, 17.1, 17.2, 18.1, 18.2, 18.3, 21.1, 21.2, 22.1, 22.2, 22.3 | ✓ Mapped |
| NFR13 | Resilience & Auto-Failover (proxy retry 3x) | 11.1, 11.3, 11.4, 11.5, 11.6, 11.7 | ✓ Mapped |
| NFR14 | Zero-Credential Security | 12.1, 12.2 | ✓ Mapped |
| NFR15 | Clean Architecture & Extensibility | 10.1, 10.5, 11.1, 14.2, 21.1, 22.1 | ✓ Mapped |
| NFR16 | License & Backward Compatibility | 14.2, 20.1, 20.2 | ✓ Mapped |
| NFR17 | Operational Observability | 11.4, 14.3, 19.1, 19.2, 19.3, 19.6 | ✓ Mapped |

### Coverage Gaps

| GAP | Mô tả | Mức độ | Khuyến nghị |
|---|---|---|---|
| GAP-1 | **Epic 21–22 không có PRD / FR tương ứng.** `epics.md` thêm Epic 21 (B2B Procurement, Automotive) và Epic 22 (F&B, Healthcare, Legal) nhưng PRD canonical (prd.md) chỉ bao phủ Epics 10–20. | **Critical** | Cập nhật PRD hoặc tách Epic 21–22 thành PRD riêng; gán FR-89+ và NFR-18+ cho các domain mới. |
| GAP-2 | **FUTURE-FR-62 (GraphQL replay)** bị deferred, không có trong `epics.md` và sprint-status.yaml. | Low | Giữ trong `FUTURE-WORK.md`; không cần cho phase hiện tại. |
| GAP-3 | **FR-73 bị gộp chung trong PRD** nhưng tách thành 10.3 (Dataset Exporter) và 14.2 (MCP Envelope) trong `epics.md`; cần đảm bảo traceability. | Low | Giữ sub-label U-FR-73A / U-FR-73B trong addendum. |
| GAP-4 | **FR66 / FR66B** có thể bị hiểu nhầm với các sub-label A/B trong deprecated PRD. | Low | Sử dụng canonical numbering FR66 + FR66B. |

### Coverage Statistics

- **Total PRD FRs:** 25
- **FRs covered in epics:** 25 (100% cho phạm vi PRD)
- **Total PRD NFRs:** 7
- **NFRs mapped in epics:** 7 (100%)
- **Phạm vi ngoài PRD:** Epic 21–22 (6 stories) chưa có FR/NFR nguồn trong PRD canonical.

## 5. PRD Analysis

### Source PRD

- **Primary:** `prd.md` (canonical, approved, 2026-08-21)
- **Supplemental:** `prd-canonicalization-addendum-2026-08-21.md` (canonical numbering, master register), `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` (deprecated status)
- **Scope:** Epics 10–20

### Functional Requirements Extracted

| Canonical ID | Source ID | Requirement |
|---|---|---|
| U-FR-64 | FR-64 | Core Domain Interfaces: `AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge` thuần ESM, Zero-Dependency. |
| U-FR-65 | FR-65 | Tiered Hybrid Signer Engine: Pre-Signed Token Ring Buffer O(1) + Signer Worker Page Pool (4–8 tabs, `Promise.race` 3s) + `got-scraping`/`undici` (TLS/JA4). |
| U-FR-66 | FR-66 | Proxy Pool & Auto-Quarantine: quản lý Static/Dynamic Tunnel Proxy, chống rò rỉ WebRTC/DNS, buffer expiration 30s, quarantine 5 phút, retry 3 lần, standby 30s. |
| U-FR-66B | FR-66B | Adaptive Rate Limiter & Governor: điều tốc theo healthy proxy ratio, Leaky Bucket, hibernation account 15–30 phút. |
| U-FR-67 | FR-67 | Namespaced PostgreSQL Storage & JSONB GIN Indexes: `Post`/`Comment` với `${platform}:${externalId}`, `metadata Json?`, batch 500 records. |
| U-FR-68 | FR-68 | Terminal ASCII QR Code Login: tỷ lệ 1:1 trên Terminal, countdown 60s, timeout 120s, polling cookie. |
| U-FR-69 | FR-69 | CDP Remote Attach Mode: kết nối Chrome thật qua port 9222, Gaussian jitter 3–7s. |
| U-FR-70 | FR-70 | Topological Comment Tree Extraction: cây bình luận đa tầng, chống vòng, topological sort. |
| U-FR-71 | FR-71 | Twitter Crawler Refactor: GraphQL + Signer Page Pool + PrismaStore. |
| U-FR-72 | FR-72 | Facebook Crawler Refactor: GraphQL DocID dispatch + Proxy Pool. |
| U-FR-73 | FR-73 | MCP Daemon & CLI Integration + Streaming Dataset Exporter: Daemon HTTP/SSE port 3001, 80+ MCP tools, 3-Layer JSON Envelope, auto-artifact >100 records, JSONL/CSV export với backpressure. |
| U-FR-73A | (sub-label) | AI Streaming Dataset Exporter (Story 10.3) — xuất JSONL/CSV. |
| U-FR-73B | (sub-label) | MCP Tool Envelope & CLI Crawl (Story 14.2) — 3-Layer JSON Envelope. |
| U-FR-74 | FR-74 | Threads Meta GraphQL Scraper: bài viết, timeline, replies qua LSD token + DocID. |
| U-FR-75 | FR-75 | TikTok Video, Hashtag & Comment Scraper: `a_bogus`/`msToken` Signer Bridge, kiểm tra False 200 OK. |
| U-FR-76 | FR-76 | Shopee Product, Price & Review Scraper: TLS Spoofing + Anti-Bot Validation. |
| U-FR-77 | FR-77 | TikTok Shop Winning Products Scraper. |
| U-FR-78 | FR-78 | Chợ Tốt Multi-Category Scraper with Phone Extractor. |
| U-FR-79 | FR-79 | Batdongsan.com.vn Property Scraper. |
| U-FR-80 | FR-80 | TopCV Recruitment Scraper. |
| U-FR-81 | FR-81 | VietnamWorks Job Scraper. |
| U-FR-82 | FR-82 | LinkedIn B2B Lead & Job Scraper via CDP 9222. |
| U-FR-83 | FR-83 | Nowing Thin Event Redis Stream Ingest: `stream:social:raw_posts`, Thin Event Pointers. |
| U-FR-84 | FR-84 | Nowing Scrapers Cutover & Legacy Decommissioning. |
| U-FR-85 | FR-85 | Internal Operator Dashboard & Admin CLI. |
| U-FR-86 | FR-86 | Metadata Schema Contract for Consumers. |
| U-FR-87 | FR-87 | Data Retention Policy: raw 30 ngày, leads vĩnh viễn, checkpoints/audit 90 ngày. |
| U-FR-88 | FR-88 | 3-Tier Incremental Gap-Filling: full seed → delta → on-demand refresh; 0% duplication; 90% proxy cost saving. |

**Total PRD FRs: 25** (U-FR-64..U-FR-88)

### Non-Functional Requirements Extracted

| Canonical ID | Source ID | Requirement |
|---|---|---|
| U-NFR-11 | NFR-11 | Tối ưu tài nguyên: giảm ≥85% RAM, ≥70% CPU. |
| U-NFR-12 | NFR-12 | Băng thông & tốc độ: 5x–10x (>500 req/s), RPC <2ms. |
| U-NFR-13 | NFR-13 | Tự phục hồi & failover: proxy die/rate-limit, quarantine, replay 3 lần. |
| U-NFR-14 | NFR-14 | Bảo mật phi mật khẩu: QR/CDP. |
| U-NFR-15 | NFR-15 | Kiến trúc sạch: `src/core/` Zero-Dependency, adapters riêng biệt. |
| U-NFR-16 | NFR-16 | License & backward compatibility: MIT/Apache 2.0, `unfollowx`, 80+ MCP tools. |
| U-NFR-17 | NFR-17 | Operational observability: `/governor/status`, `/metrics/stream`, dashboard SSE 5–30s, alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`. |

**Total PRD NFRs: 7** (U-NFR-11..U-NFR-17)

### Additional Requirements / Constraints

- **FUTURE-FR-62** — GraphQL replay: deferred (xem `FUTURE-WORK.md`).
- **FR-24..FR-54** — Facebook Messenger/Marketplace/Anti-Detection (Epics 5, 5b, 6) nằm trong `prd-facebook-epics-5-6-2026-08-21.md`, không thuộc scope PRD này.
- **Data Retention Policy:** raw 30 ngày trong XActions, leads vĩnh viễn trong Nowing.
- **Phasing:** Phase 1–5 trong PRD appendix 7.3.

### PRD Completeness Assessment

- PRD đầy đủ cho Epics 10–20 với 25 FR, 7 NFR.
- FR-73 được đánh dấu chung cả dataset exporter và MCP daemon; trong `epics.md` tách thành 10.3 và 14.2 — cần theo dõi traceability.
- FR-66 và FR-66B có sub-label A/B; `epics.md` dùng FR66 + FR66B, tương đương.
- **GAP chính:** PRD không bao gồm **Epic 21–22** (B2B Procurement, F&B/Healthcare/Legal), mặc dù `epics.md` đã thêm.

## 6. UX Alignment Assessment

### UX Document Status

**Found:**
- `ux/DESIGN.md` (draft, 2026-06-19) — Design system & dashboard components.
- `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` (draft, 2026-08-21) — Personas và flows cho Epics 10–20.
- `ux/EXPERIENCE.md` (draft, 2026-08-08) — Older experience doc.
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` — UX remediation notes.

### UX ↔ PRD Alignment

| PRD Requirement | UX Coverage | Đánh giá |
|---|---|---|
| FR-68 Terminal QR Login | Flow C1/C2 trong `EXPERIENCE-UNIVERSAL` | ✓ Khớp; thiếu mockup cụ thể. |
| FR-69 CDP Attach | Flow R1 trong `EXPERIENCE-UNIVERSAL` | ✓ Khớp. |
| FR-85 Admin Dashboard | `DESIGN.md` Admin Status Card, Data Table, Stream Metrics Chart, Alert Banner; `EXPERIENCE-UNIVERSAL` O1/O2 | ✓ Đầy đủ. |
| FR-73B MCP / CLI | `EXPERIENCE-UNIVERSAL` A1/A2, C3/C4; `DESIGN.md` CLI Output Blocks | ✓ Khớp. |
| FR-86 Schema Viewer | `DESIGN.md` Schema Viewer component | ✓ Khớp. |
| FR-83 Stream Metrics | `DESIGN.md` Stream Metrics Line Chart | ✓ Khớp. |
| Multi-platform flows N1 | `EXPERIENCE-UNIVERSAL` Flow N1 | ✓ Khớp. |

### UX ↔ Architecture Alignment

| Architecture Decision | UX Implication | Đánh giá |
|---|---|---|
| `GET /governor/status`, `/metrics/stream` (NFR-17) | Admin Status Card, Stream Metrics Chart cần real-time data. Architecture expose metrics. | ✓ Khớp. |
| MCP over HTTP/SSE port 3001 | AI Agent flows cần 3-Layer JSON Envelope; architecture hỗ trợ. | ✓ Khớp. |
| Redis Stream `stream:social:raw_posts` | Nowing Integrator persona nhận thin events; architecture hỗ trợ. | ✓ Khớp. |

### UX Warnings

| Mã | Mô tả | Mức độ | Khuyến nghị |
|---|---|---|---|
| UX-W1 | `DESIGN.md` vẫn ở `draft` từ 2026-06-19, trước nhiều thay đổi kiến trúc và Epic 21–22. | Medium | Cập nhật hoặc xác nhận canonical; bổ sung components cho Epic 21–22 nếu cần. |
| UX-W2 | Không có wireframe/mockup cụ thể cho QR, CDP flow, Multi-platform new-user flow; chỉ có text flow. | Low | Bổ sung ASCII/text-based mockups. |
| UX-W3 | Epic 21–22 chưa xuất hiện trong UX docs. | Medium | Nếu giữ lại Epic 21–22, cần personas/flows tương ứng. |

## 7. Epic Quality Review

### Scope & Method

Đánh giá `epics.md` theo tiêu chuẩn create-epics-and-stories: user-value, độc lập, dependency, sizing, acceptance criteria, traceability.

### Epic-by-Epic Summary

| Epic | Tiêu đề | User Value | Independence | Quality Notes |
|---|---|---|---|---|
| 10 | Data & Platform Foundation | ✓ Foundation enabler; trừu tượng hóa cho toàn bộ crawler | ✓ Foundation | Có thể bị coi là technical; nhưng mô tả rõ vai trò enabler. |
| 11 | Resilient Network & Proxy Pool | ✓ Operator và crawler tránh die hàng loạt | ✓ Network layer | 8 stories, có thể oversized; nhưng chia nhỏ hợp lý. |
| 12 | Frictionless Authentication | ✓ QR/CDP login cho CLI users | ✓ Auth | 2 stories, rõ ràng. |
| 13 | Hybrid Scraping Engine (Twitter/Facebook) | ✓ High-throughput social scraping | ⛓️ Cần Epic 10, 11 | 3 stories; 13.2/13.3 có overlap với legacy code đã ghi nhận. |
| 14 | Deep Conversation, MCP, Event Stream | ✓ MCP/Redis stream cho AI/Nowing | ⛓️ Cần 10, 11, 13.1 | 3 stories; 14.2 MCP có overlap với `src/mcp/server.js`. |
| 15 | Vietnam Viral Social | ✓ Threads/TikTok coverage | ⛓️ Cần 13.1 (TikTok signer) | 2 stories; 15.1 overlap với existing Threads. |
| 16 | E-Commerce | ✓ Shopee/TikTok Shop data | ⛓️ Cần 10, 11 | 2 stories, mới. |
| 17 | Real Estate | ✓ BĐS leads + SĐT | ⛓️ Cần 10, 11 | 2 stories, mới. |
| 18 | HR & B2B Recruitment | ✓ Jobs/LinkedIn leads | ⛓️ Cần 10, 11, 12.2 | 3 stories; 18.3 unblocked sau 12.2 done. |
| 19 | Operator Dashboard, Admin CLI | ✓ Internal ops surfaces | ⛓️ Cần 10.4, 11.4, 14.3 | 8 stories (19.4–19.6 merged), có overlap admin CLI hiện có. |
| 20 | Nowing Cutover & Decommissioning | ✓ Cost/ops reduction | ⛓️ Cần 13–18 + 20.1 | 2 stories; 20.2 mở rộng xóa legacy code. |
| 21 | B2B Procurement, Corporate & Automotive | ⚠️ Không có PRD/UX; user value mơ hồ | ⚠️ Không rõ dependency | 2 stories; ngoài scope PRD; có thể là placeholder. |
| 22 | Local F&B, Healthcare, Legal | ⚠️ Không có PRD/UX | ⚠️ Không rõ dependency | 3 stories; ngoài scope PRD. |

### Dependency Analysis

- **Không có forward dependency theo số epic:** Epic N không cần Epic N+1.
- **Các dependency hợp lệ:** 13–18 cần 10, 11; 20 cần 13–18; 19 cần 10.4, 11.4, 14.3.
- **18.3 đã unblock:** 12.2 `done`; map đã cập nhật.
- **21–22 không có dependency:** Có thể làm song song sau khi foundation xong, nhưng thiếu PRD nên rủi ro cao.

### Acceptance Criteria Quality

- Phần lớn AC dùng định dạng Given/When/Then, testable, có kèm đường dẫn file và lệnh kiểm tra.
- Một số AC còn mơ hồ về "stable" hoặc "parity 99%" (Story 20.1, 20.2) cần định nghĩa rõ metric.
- Epic 21–22 AC thiếu FR/NFR mapping và chưa có validation approach.

### Quality Violations

| Mã | Vi phạm | Mức độ | Ví dụ | Khuyến nghị |
|---|---|---|---|---|
| EQ-1 | **Epic 21–22 nằm ngoài PRD scope, thiếu user research.** | Critical | Không có FR/NFR nguồn; tiêu đề giống "domain expansion" nhưng không rõ user outcome. | Quyết định lấy/tách: hoặc cập nhật PRD, hoặc chuyển sang backlog tương lai. |
| EQ-2 | **Một số epic foundation (10, 11) có tính technical.** | Major | "Data & Platform Foundation", "Resilient Network & Proxy Pool" không trực tiếp deliver end-user feature. | Giữ vì là enabler, nhưng đảm bảo mỗi story mô tả user outcome (operator, data scientist, AI agent). |
| EQ-3 | **Overlap với legacy code chưa giải quyết hết trong epics.** | Major | 13.2/13.3/15.1 overlap; 19.4–19.7 overlap; đã được ghi nhận trong sprint-change-proposal. | Theo dõi AC deprecation và xóa code legacy trong 20.2. |
| EQ-4 | **Epic 19 có 8 stories, có thể quá lớn cho một epic.** | Minor | Admin dashboard + CLI + REST API + MCP tools. | Cân nhắc tách thành Epic 19 (Observability) + Epic 19b (Admin Surface) nếu team lớn. |
| EQ-5 | **Story 20.2 "Legacy Scraper Code Decommissioning" là destructive operation.** | Major | Xóa `src/client/Scraper.js`, `src/scrapers/twitter/http/`, v.v. | Cần double-check deprecation plan và rollback strategy trước khi thực hiện. |

## 8. Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK** — Implementation Readiness của XActions đã đạt mức **đủ cho Epics 10–20**, nhưng còn nhiều vấn đề critical liên quan đến tài liệu trùng lặp, Epic 21–22 ngoài PRD scope, và thiếu UX cập nhật. Không nên bắt đầu toàn bộ Phase 4 cho đến khi các vấn đề dưới đây được xử lý.

### Critical Issues Requiring Immediate Action

1. **Epic 21–22 nằm ngoài PRD canonical.** Không có FR/NFR nguồn, không có UX, không rõ dependency. Nếu vẫn muốn triển khai, phải cập nhật PRD hoặc tách thành PRD riêng. Nếu không, chuyển sang backlog/future work.
2. **Trùng lặp tài liệu chưa giải quyết.** PRD có whole + 4 sharded; Architecture có whole + sharded; Epics có `epics.md` + `epics-full.md`. Cần xác nhận canonical hoặc archive/delete deprecated versions.
3. **`DESIGN.md` draft cũ (2026-06-19).** Chưa cập nhật kiến trúc mới, Admin components, và Epic 21–22.
4. **Story 20.2 xóa code legacy là destructive.** Cần double-check `docs/deprecation-plan.md` và rollback strategy trước khi thực hiện.
5. **Một số acceptance criteria còn mơ hồ.** "Stable", "parity ≥99%", "hibernation 15–30 phút" cần định lượng rõ trong AC.

### Recommended Next Steps

1. **Quyết định phạm vi Epic 21–22:** Cập nhật PRD hoặc loại bỏ khỏi sprint hiện tại.
2. **Dọn dẹp tài liệu trùng lặp:** Mark archive/delete cho sharded PRD deprecated; merge `epics-full.md` vào `epics.md` nếu `epics-full` chỉ là nguồn cũ.
3. **Cập nhật UX:** Nâng `DESIGN.md` lên canonical/final, bổ sung mockups cho QR/CDP/Multi-platform; thêm personas cho Epic 21–22 nếu giữ lại.
4. **Hoàn thiện deprecation plan:** Đảm bảo mỗi AC trong 13.2/13.3/15.1/19.4 có mục "xác nhận legacy code deprecated" và 20.2 có rollback checklist.
5. **Tái review Epic 19:** Cân nhắc tách thành 2 epic nếu team size cho phép; nếu không, giữ nguyên nhưng theo dõi closely.
6. **Đo lường readiness cho Phase 4 (Epics 10–20):** Khi 4 issues trên được giải quyết, readiness có thể chuyển sang **READY**.

### Final Note

Assessment này xác định **7 vấn đề chính** trên **5 hạng mục**: tài liệu (duplicates), PRD (scope gap), UX (outdated/missing), Epic quality (21–22), và Architecture alignment. Các vấn đề đều có thể khắc phục nhanh nếu được quyết định rõ ràng. Báo cáo này được lưu tại `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-26.md`.
