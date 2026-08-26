---
title: "PRD Canonicalization & FR/NFR Master Register"
created: 2026-08-21
updated: 2026-08-21
status: approved
---

# PRD Canonicalization & FR/NFR Master Register

Tài liệu này giải quyết xung đột đánh số FR/NFR giữa các phiên bản PRD và thiết lập master register canonical.

---

## 1. PRD Canonical Status

| Phạm vi | Canonical | Deprecated / Reference |
|---|---|---|
| Epics 1–4 (Facebook scrape, automate, growth) | `archive/epics-1-9-legacy.md` | `archive/prds/prd-XActions-2026-06-08/prd.md`, `archive/prds/prd-XActions-2026-06-10-epic4/prd.md` |
| Epics 5, 5b, 6 (Messenger, Marketplace, Anti-Detection) | `prd-facebook-epics-5-6-2026-08-21.md` | — |
| Epic 7 (Facebook advanced scraping) | `archive/epics-1-9-legacy.md` | `archive/prds/prd-XActions-2026-08-14-epic7/prd.md` |
| Epics 10–20 (Universal Scraping Engine) | `prd.md` | `archive/prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` |

---

## 2. FR Numbering Conventions

Từ 2026-08-21, FR trong XActions được đánh số theo phạm vi (scope prefix):

- **FB-** — Facebook module (Epics 1–7). Ví dụ: `FB-FR-55` = Account health check.
- **U-** — Universal Scraping Engine (Epics 10–20). Ví dụ: `U-FR-64` = Core Domain Interfaces.
- **FUTURE-** — Deferred scope. Ví dụ: `FUTURE-FR-62` = GraphQL replay.

### Master FR Register

| Canonical ID | Source ID | Source Document | Description |
|---|---|---|---|
| FB-FR-1..FB-FR-14 | FR-1..FR-14 | `archive/prds/prd-XActions-2026-06-08/prd.md` / `archive/epics-1-9-legacy.md` | Facebook Platform Extension (Epics 1–3) |
| FB-FR-15..FB-FR-23 | FR-15..FR-23 | `archive/prds/prd-XActions-2026-06-10-epic4/prd.md` / `archive/epics-1-9-legacy.md` | Facebook Growth Automation (Epic 4) |
| FB-FR-24..FB-FR-54 | FR-24..FR-54 | `prd-facebook-epics-5-6-2026-08-21.md` | Messenger, Marketplace, Anti-Detection (Epics 5, 5b, 6) |
| FB-FR-55..FB-FR-63 | FR-55..FR-63 | `archive/prds/prd-XActions-2026-08-14-epic7/prd.md` / `archive/epics-1-9-legacy.md` | Facebook Advanced Scraping (Epic 7) |
| FUTURE-FR-62 | FR-62 | `archive/prds/prd-XActions-2026-08-14-epic7/prd.md` | GraphQL replay — deferred to Phase 3 |
| U-FR-64..U-FR-84 | FR-64..FR-84 | `prd.md` | Universal Engine Epics 10–18 |
| U-FR-85..U-FR-88 | FR-85..FR-88 | `prd.md` §7.1 | Operator Dashboard, Metadata Schema, Data Retention, 3-Tier Gap-Filling |
| U-FR-89..U-FR-93 | FR-89..FR-93 | `prd.md` §7.1 | Bluesky/Mastodon, Utility/Adapters, Unified Dispatcher, Legacy Decommission (Phase 4 extension 23–26) |

---

## 3. NFR Numbering Conventions

Tương tự FR, NFR sử dụng prefix phạm vi để tránh xung đột:

- **FB-NFR-** — Facebook module NFRs.
- **U-NFR-** — Universal Engine NFRs.

### Master NFR Register

| Canonical ID | Source ID | Source Document | Description |
|---|---|---|---|
| FB-NFR-1..FB-NFR-5 | (cross-cutting) | `archive/prds/prd-XActions-2026-06-08/prd.md` §7 | Rate-limit, anti-detection, security, selector resilience, consistency |
| FB-NFR-6..FB-NFR-10 | NFR-6..NFR-10 | `archive/prds/prd-XActions-2026-06-10-epic4/prd.md` / `archive/epics-1-9-legacy.md` | Delay floor, runGuardedBatch, risk warning, scheduling cap, no PII |
| FB-NFR-11..FB-NFR-15 | NFR-11..NFR-15 | `archive/prds/prd-XActions-2026-08-14-epic7/prd.md` / `archive/epics-1-9-legacy.md` | No storage, health check <2s, concurrency cap, privacy, resilience, read velocity |
| U-NFR-11..U-NFR-16 | NFR-11..NFR-16 | `prd.md` | Resource optimization, throughput, resilience, security, clean architecture, license |
| U-NFR-17 | NFR-17 | `prd.md` §7.2 | Operational observability |
| U-NFR-18 | NFR-18 | `prd.md` §7.2 | Universal Architecture Compliance |

> **Chú ý:** Trong tài liệu nguồn, `NFR-10..NFR-15` bị dùng lại ở cả Epic 4, Epic 7 và Epics 10–20 với nghĩa khác nhau. Khi traceability, **dùng canonical ID có prefix** (`FB-NFR-10` vs `U-NFR-10` nếu cần) hoặc `FB-NFR-6..10` / `FB-NFR-11..15` / `U-NFR-11..17`.

---

## 4. Sub-Label Conventions

Một số FR trong PRD universal sử dụng suffix `A`/`B` để chỉ phân nhánh:

- `U-FR-66A` (Anti-Leak Proxy Pool) → Story 11.1, 11.2
- `U-FR-66B` (Adaptive Rate Limiter & Governor) → Story 11.4
- `U-FR-73A` (AI Streaming Dataset Exporter) → Story 10.3
- `U-FR-73B` (MCP Tool Envelope & CLI Crawl) → Story 14.2

Cách dùng: Suffix không làm thay đổi số FR chính (`U-FR-66`, `U-FR-73`) mà chỉ phân biệt nhánh implementation.

---

## 5. Deferred Work Register

| ID | Description | Condition to activate |
|---|---|---|
| FUTURE-FR-62 | GraphQL replay | Story 5.1 & 7.1 stable; ≥ 80% `doc_id` mapping stable 30 days; replay cache storage available |
| FUTURE-ADV-MARKETPLACE | Advanced Marketplace filters | FR-28..FR-31 stable |
| FUTURE-CANVAS-SPOOF | Canvas/WebGL spoofing | FR-40..FR-54 stable, checkpoint rate > 5% |

Chi tiết xem `FUTURE-WORK.md`.

---

## 6. Conventions Going Forward

1. Tất cả PRD mới phải dùng canonical ID hoặc ghi rõ `mapsToCanonical` trong frontmatter.
2. Epic/story chỉ nên tham chiếu canonical ID; nếu dùng source ID, phải có note.
3. NFR conflict (cùng số ở nhiều PRD) phải được prefix hoặc renumber khi xuất hiện.

---

*Approved by BMad Product Council, 2026-08-21.*
