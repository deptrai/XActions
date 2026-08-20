---
stepsCompleted: [1, 2, 3, 4, 5, 6]
project: XActions
date: 2026-08-21
assessor: BMad Product Manager
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-21
**Project:** XActions
**Assessor:** BMad Product Manager
**Run:** Re-run after remediation (commits dc8a3ed + cbc0c41)

---

## Step 1: Document Discovery

### PRD Documents

**Whole Documents:**
- `prd.md` (canonical, Epics 10–20)
- `prd-facebook-epics-5-6-2026-08-21.md` (canonical, Epics 5/5b/6)
- `prd-canonicalization-addendum-2026-08-21.md` (FR/NFR master register)
- `FUTURE-WORK.md` (deferred scope)

**Sharded/Deprecated PRDs:**
- `prds/prd-XActions-2026-06-08/prd.md` (deprecated, Epic 1–3)
- `prds/prd-XActions-2026-06-10-epic4/prd.md` (deprecated, Epic 4)
- `prds/prd-XActions-2026-08-14-epic7/prd.md` (deprecated, Epic 7)
- `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` (deprecated, Epics 10–18)

### Architecture Documents

**Canonical:**
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (r3)

**Supporting:**
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-DEV-REVIEW-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UPDATE-GATE-2026-08-18-r3.md`

**Deprecated:**
- `architecture.md` (brownfield as-built)

### Epics & Stories Documents

**Whole Documents:**
- `epics.md` (Epics 10–20, cross-epic dependency map, NFR traceability)
- `epics-full.md` (Epics 1–9)

### UX Design Documents

**Whole Documents:**
- `ux/DESIGN.md` (design tokens + new operator dashboard components)
- `ux/EXPERIENCE.md` (Facebook flows, 2026-06-19)
- `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` (operator/AI/CLI/multi-platform flows)
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` (UX → epic/story AC mapping)

### Other Planning Documents

- `CANONICAL-DOCS.md` (canonical document registry)
- `implementation-readiness-report-2026-08-21.md` (previous assessment + remediation)

### Critical Issues Found in Discovery

1. **PRD canonicalization completed** — `prd.md` canonical, 4 deprecated PRDs in `prds/`.
2. **Architecture canonicalization completed** — `ARCHITECTURE-SPINE.md` canonical, `architecture.md` deprecated.
3. **No missing required documents** — PRD, Architecture, Epics, UX all present.
4. **Post-remediation state** — Epics/UX have been updated since the last report.

---

**Document Discovery Complete. Ready to proceed?**

---

## Step 2: PRD Analysis

### Canonical PRDs Loaded

- `prd.md` — Epics 10–20 (Universal Hybrid Scraping Engine)
- `prd-facebook-epics-5-6-2026-08-21.md` — Epics 5, 5b, 6 (Messenger, Marketplace, Anti-Detection)
- `prd-canonicalization-addendum-2026-08-21.md` — FR/NFR master register, prefixes, deferred scope
- `FUTURE-WORK.md` — FUTURE-FR-62, advanced Marketplace filters, canvas/WebGL spoofing
- `epics-full.md` — Epics 1–4, 7 (canonical source for FB-FR-1..FB-FR-63)

### Functional Requirements Extracted

| Range | Canonical ID | Source | Count | Status |
|---|---|---|---|---|
| FB-FR-1..FB-FR-14 | `epics-full.md` | Facebook Platform Extension (Epics 1–3) | 14 | ✅ Approved |
| FB-FR-15..FB-FR-23 | `epics-full.md` | Facebook Growth Automation (Epic 4) | 9 | ✅ Approved |
| FB-FR-24..FB-FR-54 | `prd-facebook-epics-5-6-2026-08-21.md` | Messenger, Marketplace, Anti-Detection (Epics 5, 5b, 6) | 31 | ✅ Approved |
| FUTURE-FR-62 | `FUTURE-WORK.md` | GraphQL replay | 1 | ⏸️ Deferred |
| FB-FR-55..FB-FR-63 | `epics-full.md` | Facebook Advanced Scraping (Epic 7) | 9 | ✅ Approved |
| U-FR-64..U-FR-88 | `prd.md` | Universal Scraping Engine (Epics 10–20) | 25 | ✅ Approved |

**Total FRs tracked:** 88 (87 active + 1 deferred).

### Non-Functional Requirements Extracted

| Range | Canonical ID | Source | Count |
|---|---|---|---|
| FB-NFR-1..FB-NFR-5 | `prds/prd-XActions-2026-06-08/prd.md` | Cross-cutting Facebook NFRs | 5 |
| FB-NFR-6..FB-NFR-10 | `epics-full.md` | Epic 4 NFRs (delay, dry-run, risk, scheduling, no PII) | 5 |
| FB-NFR-11..FB-NFR-15 | `epics-full.md` | Epic 7 NFRs (no storage, health check, concurrency, privacy, resilience, read velocity) | 5 |
| U-NFR-11..U-NFR-16 | `prd.md` | Universal engine NFRs | 6 |
| U-NFR-17 | `prd.md` §7.2 | Operational observability | 1 |

**Total NFRs tracked:** 22.

### Additional Requirements / Constraints

- **PRD canonicalization:** 4 legacy PRDs deprecated, không dùng làm source mới.
- **FR/NFR prefix convention:** `FB-` cho Facebook module, `U-` cho universal engine, `FUTURE-` cho deferred.
- **Sub-labels:** `U-FR-66A`/`U-FR-66B`, `U-FR-73A`/`U-FR-73B` dùng để phân nhánh implementation.
- **Deferred work:** FR-62 (GraphQL replay), advanced Marketplace filters, canvas/WebGL spoofing.

### PRD Completeness Assessment

- **Canonical PRDs cover toàn bộ 88 FRs + 22 NFRs** với rõ ràng scope, personas, user journeys, FR, NFR, AR.
- **FR/NFR conflicts đã được giải quyết** qua master register và prefix convention.
- **FR-62 deferred rõ ràng** với activation conditions trong `FUTURE-WORK.md`.
- **Minor gap:** Các source docs `epics-full.md`, `epics.md`, `prd.md` vẫn dùng source numbering (không prefix) nội bộ. Cần dùng canonical ID từ `prd-canonicalization-addendum` khi traceability chính thức.

**Step 2 hoàn tất. Tiếp tục Epic Coverage Validation.**

---

## Step 3: Epic Coverage Validation

### Epic FR Coverage Extracted

**From `epics-full.md` (Epics 1–9 / FB-FR-1..FB-FR-63):**

| FB-FR Range | Epic | Tên Epic | Trạng thái |
|---|---|---|---|
| FB-FR-1..FB-FR-7 | Epic 1 | Facebook Data Reading | ✅ Done |
| FB-FR-8..FB-FR-11 | Epic 3 | Facebook Multi-Surface & Persistence | ✅ Done |
| FB-FR-12..FB-FR-14 | Epic 2 | Facebook Automation | ✅ Done |
| FB-FR-15..FB-FR-23 | Epic 4 | Facebook Growth Automation | ✅ Done |
| FB-FR-24..FB-FR-27 | Epic 5 | Facebook Messenger Port | ✅ Done |
| FB-FR-28..FB-FR-39 | Epic 5b | Marketplace & Infrastructure Enhancements | ✅ Done |
| FB-FR-40..FB-FR-54 | Epic 6 | Facebook Anti-Detection & Bot Countermeasures | 🔄 13 backlog |
| FB-FR-55..FB-FR-61, FB-FR-63 | Epic 7 | Facebook Advanced Scraping & Multi-Account | ✅ Done (FB-FR-62 deferred) |
| FB-PCR2, FB-PCR6, FB-PCR7 | Epic 8 | Facebook Backend Stability for Operators & MCP Clients | 🆕 backlog |
| FB-PCR1, FB-PCR3–PCR5 | Epic 9 | Facebook Live Data & Behavioral Reliability | 🆕 backlog |

**From `epics.md` (Epics 10–20 / U-FR-64..U-FR-88):**

| U-FR | Epic / Story | Ghi chú |
|---|---|---|
| U-FR-64 | Story 10.1 | Core Domain Interfaces |
| U-FR-65 | Story 13.1 | Tiered Hybrid Signer Engine |
| U-FR-66A | Story 11.1 + 11.2 | Proxy Pool & Auto-Quarantine |
| U-FR-66B | Story 11.4 | Adaptive Rate Limiter & Governor |
| U-FR-67 | Story 10.2 | Namespaced PostgreSQL Storage |
| U-FR-68 | Story 12.1 | Terminal QR Login |
| U-FR-69 | Story 12.2 | CDP Remote Attach |
| U-FR-70 | Story 14.1 | Topological Comment Tree |
| U-FR-71 | Story 13.2 | Twitter Crawler Refactor |
| U-FR-72 | Story 13.3 | Facebook Crawler Refactor |
| U-FR-73B | Story 14.2 | MCP Daemon & CLI Integration |
| U-FR-74 | Story 15.1 | Threads Scraper |
| U-FR-75 | Story 15.2 | TikTok Scraper |
| U-FR-76 | Story 16.1 | Shopee Scraper |
| U-FR-77 | Story 16.2 | TikTok Shop Scraper |
| U-FR-78 | Story 17.1 | Chợ Tốt Scraper |
| U-FR-79 | Story 17.2 | Batdongsan Scraper |
| U-FR-80 | Story 18.1 | TopCV Scraper |
| U-FR-81 | Story 18.2 | VietnamWorks Scraper |
| U-FR-82 | Story 18.3 | LinkedIn Scraper |
| U-FR-83 | Story 14.3 | Redis Stream Ingest |
| U-FR-84 | Story 20.1 | Nowing Shadow-Run Adapter |
| U-FR-85 | Epic 19 | Operator Dashboard & Admin CLI |
| U-FR-86 | Story 10.5 | Metadata Schema Contract |
| U-FR-87 | Story 10.2 + Epic 19 | Data Retention Policy |
| U-FR-88 | Story 10.3 + Epic 11 | 3-Tier Incremental Gap-Filling |

### FR Coverage Analysis

- **FB-FR-24..FB-FR-54:** Giờ đã có PRD source `prd-facebook-epics-5-6-2026-08-21.md` và `epics-full.md` Epic 5/5b/6. ✅ Không còn gap source.
- **FB-FR-62 (GraphQL replay):** Rõ ràng deferred trong `FUTURE-WORK.md`, không còn pending. ✅
- **U-FR-64..U-FR-88:** Tất cả đều có story mapping trong `epics.md`. ✅

### Missing FR Coverage

| FR | Vấn đề | Mức độ | Khuyến nghị |
|---|---|---|---|
| **FB-FR-40..FB-FR-54 (Epic 6)** | 13/18 FR behavioral/fingerprint còn `backlog`, không có story chi tiết. | 🟡 Major | Chuyển Epic 6 sang `in-progress`, chia thành 2–3 stories. |

### Coverage Statistics

- **Tổng FR tracked:** 88 (87 active + 1 deferred).
- **FRs covered ✅:** 74.
- **FRs backlog / missing:** 14 (FB-FR-44–FB-FR-54).
- **FR deferred:** 1 (FB-FR-62).
- **Coverage percentage:** ~84% (tính cả deferred) / ~86% (active only).

**Step 3 hoàn tất. Tiếp tục UX Alignment.**

---

## Step 4: UX Alignment Assessment

### UX Document Status

- `ux/DESIGN.md` — tồn tại, đã bổ sung new components (Admin Status Card, Alert Banner, Data Table, Schema Viewer, Stream Metrics Chart, CLI Output Blocks).
- `ux/EXPERIENCE.md` — tồn tại (draft 2026-06-19), chỉ cover Facebook + X/Twitter cũ.
- `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` — tồn tại, cover operator / AI / CLI / multi-platform flows.
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` — tồn tại, map F1–F10 → epic/story + AC + priority.
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — đã thêm section UX Remediation Alignment.

### UX ↔ PRD Alignment

| PRD Requirement | UX Coverage | Đánh giá |
|---|---|---|
| U-FR-85 / Epic 19 — Operator Dashboard | `DESIGN.md` new components + `EXPERIENCE-UNIVERSAL` Flows O1/O2 | ✅ Đã có components và flows |
| U-FR-68 / Story 12.1 — Terminal QR Login | `EXPERIENCE-UNIVERSAL` Flows C1/C2, `ARCHITECTURE-UX-REMEDIATION` F2 | ✅ Đã cover non-TTY fallback |
| U-FR-73 / Story 14.2 — MCP Daemon | `EXPERIENCE-UNIVERSAL` Flow A1, `ARCHITECTURE-UX-REMEDIATION` F1 | ✅ Đã cover daemon startup UX |
| U-FR-66B / Story 11.4 — Adaptive Governor | `EXPERIENCE-UNIVERSAL` Flow C3, `ARCHITECTURE-UX-REMEDIATION` F3 | ✅ Đã cover governor status |
| U-FR-83 / Story 14.3 — Redis Stream | `EXPERIENCE-UNIVERSAL` Flow O1/C3, `ARCHITECTURE-UX-REMEDIATION` F7 | ✅ Đã cover stream metrics |
| U-FR-86 / Story 10.5 — Metadata Schema Contract | `DESIGN.md` Schema Viewer, `ARCHITECTURE-UX-REMEDIATION` F5/F8 | ✅ Đã cover schema discovery |
| U-FR-87 / U-FR-88 — Data retention / 3-tier gap fill | `EXPERIENCE-UNIVERSAL` Flow O2 (checkpoints) | ✅ Cơ bản cover |
| U-NFR-17 — Operational Observability | `DESIGN.md` Alert Banner, `EXPERIENCE-UNIVERSAL` Flow O1 | ✅ Đã cover |

### UX ↔ Architecture Alignment

| Architecture Decision | UX Implication | Tình trạng sau remediation |
|---|---|---|
| AD-7 MCP HTTP/SSE daemon | Daemon startup/status CLI + dashboard tile | ✅ Mapped vào Story 14.2 (F1) |
| AD-5 QR Login | Non-TTY fallback + timeout message | ✅ Mapped vào Story 12.1 (F2) |
| AD-13 Adaptive Rate Governor | `GET /governor/status`, `xactions status` | ✅ Mapped vào Story 11.4 (F3) |
| AD-10/AD-12 CrawlCheckpoint | `xactions checkpoints list` + dashboard table | ✅ Mapped vào Story 10.4 / 19.1 (F4) |
| AD-11 Action Registry | `listActions()` + discovery CLI/MCP | ✅ Mapped vào Story 10.1 / 10.5 (F5) |
| AD-9 Error Taxonomy | Standard error envelope with `suggestedAction` | ✅ Mapped vào Story 10.1 (F6) |
| AD-7 Redis Stream | `GET /metrics/stream` + dashboard panel | ✅ Mapped vào Story 14.3 / 19.3 (F7) |
| AD-4 `Post.metadata` | Schema registry + validation UX | ✅ Mapped vào Story 10.5 (F8) |
| AD-19 Operator Dashboard | 5 views: Jobs, Proxies, Accounts, Checkpoints, Stream Metrics | ✅ Mapped vào Epic 19 (F9) |
| AD-2 Legacy CLI | `unfollowx` command mapping | ✅ Mapped vào Story 14.2 / 20.1 (F10) |

### Warnings

1. `ux/EXPERIENCE.md` vẫn lỗi thời (2026-06-19), không nên dùng làm source cho Epics 10–20. Đã có `EXPERIENCE-UNIVERSAL-2026-08-21.md` bổ sung.
2. Các new components trong `DESIGN.md` chưa có implement artifacts (chỉ là specs). Cần tạo implementation-artifacts khi dev.
3. UX flows cho Epics 15–18 (multi-platform crawlers) còn sơ lược, cần bổ sung chi tiết hơn khi bắt đầu dev từng platform.

### UX Alignment Verdict

**Đã cải thiện đáng kể.** Mọi F1–F10 đều được map sang epic/story với AC, và kiến trúc r3 đã adopt thành AD-14..AD-19. Còn lại chủ yếu là implementation detail, không còn là planning gap.

**Step 4 hoàn tất. Tiếp tục Epic Quality Review.**

---

## Step 5: Epic Quality Review

### User Value Focus Check

| Epic | Đánh giá user value | Kết quả |
|---|---|---|
| Epic 8 | Reframe thành "Facebook Backend Stability for Operators & MCP Clients" | ✅ Hợp lệ |
| Epic 9 | Reframe thành "Facebook Live Data & Behavioral Reliability" | ✅ Hợp lệ |
| Epic 10 | Reframe thành "Data & Platform Foundation for Universal Scraping" | ✅ Hợp lệ (foundation enabler) |
| Epic 11 | Proxy/Reliability | ✅ Rõ ràng |
| Epic 19 | Operator Dashboard | ✅ Rõ ràng |
| Epic 20 | Nowing Cutover | ✅ Rõ ràng |

### Epic Independence & Dependencies

| Vấn đề | Trạng thái sau remediation | Đánh giá |
|---|---|---|
| Story 20.1 epic-sized + cross-epic dep | Đã split thành 20.1 + 20.2, pre-condition rõ | ✅ Fixed |
| Thiếu Cross-Epic Dependency Map | Đã thêm map vào `epics.md` | ✅ Fixed |
| Epic 18.3 → Epic 12.2 | Đã ghi trong map | ✅ Documented |
| Story 11.5/11.6 forward dep | Thêm implementation order, nhưng AC vẫn tham chiếu `governor`, `PlatformResponseValidator` | 🟡 Mitigated, vẫn cần theo dõi |

### Story Sizing & Structure

| Story | Đánh giá | Khuyến nghị |
|---|---|---|
| 10.1 | AC dài, 10+ items, foundation story | 🟡 Có thể split thành 2 stories nếu team thích nhỏ gọn. |
| 11.5 | Pipeline 6 bước + sticky/rotate/validator | 🟠 Vẫn còn lớn; cân nhắc split khi dev. |
| 11.6 | Chồng lấn 11.3 về quarantine/retry/hibernation | 🟡 Ranh giới cần rõ hơn khi dev. |
| 20.1 / 20.2 | Sizing hợp lý, pre-condition rõ | ✅ Good |

### Best Practices Compliance Checklist

| Tiêu chí | Kết quả |
|---|---|
| Epic delivers user value | ✅ Tất cả epic đã reframe hoặc đã có user value |
| Epic can function independently | ✅ Không có forward cross-epic nào không được document |
| Stories appropriately sized | 🟡 10.1, 11.5, 11.6 vẫn có thể tách nhỏ hơn |
| No forward dependencies | 🟡 11.5/11.6 vẫn forward reference trong epic (có implementation order) |
| Database tables created when needed | ✅ Story 10.2 tạo `Post`, `Comment`, `CrawlCheckpoint` khi cần |
| Clear acceptance criteria | ✅ Các story chính đều có Given/When/Then |
| Traceability to FRs maintained | 🟡 `epics.md` chỉ có NFR matrix, không có FR → story matrix (xem `prd-canonicalization-addendum`) |

### Quality Assessment Summary

#### 🔴 Critical Violations (post-remediation)

*Không còn critical violation mới.* Các critical từ lần đầu đã được khắc phục hoặc giảm xuống major/minor.

#### 🟠 Major Issues

1. **Story 11.5 vẫn epic-sized:** AC là 6 bước pipeline. Cần split hoặc giảm scope khi bắt đầu dev.
2. **Story 11.3 / 11.6 chồng chéo:** Cả hai đều đề cập quarantine/retry/hibernation. Cần ranh giới rõ hoặc merge.
3. **Epic 6 backlog 13 FR mà không có story chi tiết:** FB-FR-44..FB-FR-54 còn ở trạng thái backlog trong `epics-full.md`, chưa có story cụ thể. Cần tạo stories khi Epic 6 được active.

#### 🟡 Minor Concerns

4. **Story 10.1 AC dài:** Có thể tách error hierarchy và interface registry thành 2 stories.
5. **`epics.md` thiếu FR → story matrix:** Chỉ có NFR traceability. Không blocker vì `prd-canonicalization-addendum` đã master register.
6. **`epics-full.md` vẫn dùng source FR numbering (`FR55`)**: Không blocker vì canonical addendum map.

### Epic Quality Verdict

**Từ `NEEDS WORK` đã chuyển sang `MINOR ISSUES REMAIN`.** Không còn critical. Các issue còn lại là sizing/scope nội bộ Epic 6 và 11, có thể xử lý trong sprint planning.

**Step 5 hoàn tất. Tiến hành Final Assessment.**

---

## Step 6: Final Assessment

### Overall Readiness Status

**CONDITIONAL READY**

Các critical issues từ lần đánh giá đầu đã được khắc phục. Còn lại minor/major issues liên quan đến sizing của một số stories và backlog Epic 6, không còn blocker cho Phase 4.

### Critical Issues Requiring Immediate Action

*Không còn critical issue mới.*

### Major Issues Remaining

1. **Story 11.5 / 11.6 cần làm rõ ranh giới hoặc split khi dev Epic 11.**
2. **Epic 6 cần stories cụ thể cho 13 backlog FR (FB-FR-44..FB-FR-54).**
3. **`epics.md` cần FR → story matrix nếu team yêu cầu traceability trực tiếp.**

### Recommended Next Steps

1. **Product Council review** — phê duyệt canonical PRDs, architecture, epics, và UX remediation plan.
2. **Sprint planning Epic 10–11** — bắt đầu với stories 10.1, 10.2, 10.5, 11.1, 11.2, 11.4 (foundation & proxy/governor).
3. **Tạo stories cho Epic 6** — khi Epic 6 được active, chia FB-FR-44..FB-FR-54 thành 2–3 stories.
4. **Refine 11.5/11.6** — merge hoặc split tùy theo implementation order.
5. **Run `docs:check` / `npm test` nếu muốn quality gate trước dev** (project hiện không có `npm run quality`).

### Final Note

Re-run này xác định **0 critical, 3 major, 6 minor** issues. Các tài liệu canonical đã thiết lập, traceability master register hoạt động, UX gaps đã map thành AC, epic quality đã cải thiện đáng kể. Dự án sẵn sàng bước vào Product Council review và Phase 4 implementation.

---

**Implementation Readiness Assessment Complete**

- **Assessor:** BMad Product Manager
- **Date:** 2026-08-21
- **Project:** XActions
- **Report file:** `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-21-rerun.md`

Workflow complete.