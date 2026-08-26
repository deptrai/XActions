---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-27
**Project:** XActions

## Document Discovery

### PRD Documents
- **Whole (canonical):** `_bmad-output/planning-artifacts/prd.md` (187 lines, approved, supersedes archive PRDs)
- **Addendum:** `prd-canonicalization-addendum-2026-08-21.md`
- **Platform-specific:** `prd-facebook-epics-5-6-2026-08-21.md` (FR-23–FR-54)
- **Archive:** `archive/prds/prd-XActions-*/prd.md` (deprecated)

### Architecture Documents
- **Whole / sharded (canonical):** `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`
- **Supplemental alternate:** `architecture/xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md` (not mapped to epics yet)
- **Reviews/updates:** `ARCHITECTURE-UPDATE-GATE-*.md`, `ARCHITECTURE-UX-REVIEW-*.md`, `EPIC10-DECISION-LOG-*.md`
- **Archive:** `archive/architecture-brownfield-2026-08-20.md`

### Epics & Stories Documents
- **Whole (canonical):** `_bmad-output/planning-artifacts/epics.md`
- **Backlog/future:** `backlog-epics-21-22.md`
- **Archive:** `archive/epics-1-9-legacy.md`

### UX Design Documents
- `ux/DESIGN.md`
- `ux/EXPERIENCE.md`
- `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md`

### Issues Flagged
1. **Architecture conflict:** Two competing Facebook architecture documents (`hybrid spine` vs `facebook gateway 2026-08-23`) with no explicit decision in `epics.md` on which to implement.
2. **UX duplicate / overlap:** Three UX experience documents (`DESIGN.md`, `EXPERIENCE.md`, `EXPERIENCE-UNIVERSAL-2026-08-21.md`) with no canonical pointer.
3. **Legacy archive not deprecated consistently:** `archive/prds/` and `archive/epics-1-9-legacy.md` are noted as deprecated but not explicitly excluded in `implementation-readiness-report` scope.

## PRD Analysis

### Functional Requirements (FRs)

1. **FR-64 (Core Domain Interfaces):** Cung cấp các cổng trừu tượng chuẩn hóa (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) thuần ESM, Zero-Dependency.
2. **FR-65 (Tiered Hybrid Signer Engine):** Kết hợp Pre-Signed Token Ring Buffer O(1) và Signer Worker Page Pool (4–8 tabs ngầm có `Promise.race()` 3s timeout) cùng `got-scraping` (TLS/JA4 Spoofing).
3. **FR-66 (Proxy Pool & Auto-Quarantine):** Quản lý tập trung Static & Dynamic Tunnel Proxy, tự động kích hoạt cờ chống rò rỉ WebRTC/DNS, kiểm tra buffer expiration 30s, cách ly proxy lỗi 5 phút khi 429/403, retry 3 lần với exponential backoff, chuyển sang Standby Backoff 30s khi 100% proxy bị chặn.
4. **FR-66B (Adaptive Rate Limiter):** Điều phối tốc độ scrape theo giới hạn an toàn của nền tảng (Story 11.4).
5. **FR-67 (Namespaced PostgreSQL Storage & JSONB GIN Indexes):** Lưu trữ tập trung `Post` và `Comment` vào PostgreSQL qua Prisma ORM với khóa chính dạng `${platform}:${externalId}`, `metadata Json?` có GIN Index và batch chunking 500 records.
6. **FR-68 (Terminal ASCII QR Code Login):** Hiển thị mã QR tỷ lệ 1:1 chuẩn trên Terminal console kèm đếm ngược 60s, timeout 120s và polling cookie ngầm.
7. **FR-69 (CDP Remote Attach Mode):** Kết nối trực tiếp vào Google Chrome thật qua cổng 9222 với helper command `unfollowx auth --launch-chrome` và độ trễ Gaussian Jitter (3–7s).
8. **FR-70 (Topological Comment Tree Extraction):** Trích xuất toàn bộ cây bình luận đa tầng (`maxDepth: 3`, `maxComments: 500`), chống tham chiếu vòng, và lưu vào DB theo thứ tự Topological Sort (Root trước, SubComments sau).
9. **FR-71 (Twitter Crawler Refactor):** Tái cấu trúc cào Twitter sang GraphQL kết hợp Signer Page Pool và PrismaStore.
10. **FR-72 (Facebook Crawler Refactor):** Tái cấu trúc cào Facebook qua GraphQL DocID dispatch kết hợp Proxy Pool.
11. **FR-73 (MCP Daemon & CLI Integration + Streaming Dataset Exporter):** Cung cấp 80+ MCP tools trả về 3-Layer JSON Envelope có Auto-Artifact khi payload >100 records; hỗ trợ xuất dữ liệu ra JSONL/CSV stream với backpressure.
12. **FR-74 (Threads Meta GraphQL Scraper):** Cào bài viết, timeline và replies trên Threads qua internal Meta GraphQL (LSD token + DocID).
13. **FR-75 (TikTok Video, Hashtag & Comment Scraper):** Cào video trending và hàng ngàn bình luận TikTok qua `a_bogus` Signer Bridge có kiểm tra mã chặn False 200 OK (`error !== 0`).
14. **FR-76 (Shopee Product, Price & Review Scraper):** Cào sản phẩm, flash sale, giá bán và đánh giá người mua trên Shopee VN qua Web API kết hợp TLS Spoofing và Anti-Bot Validation.
15. **FR-77 (TikTok Shop E-Commerce Winning Products Scraper):** Cào sản phẩm bán chạy, doanh số ước tính và đánh giá shop trên TikTok Shop.
16. **FR-78 (Chợ Tốt Multi-Category Scraper with Phone Extractor):** Cào tin đăng BĐS Chợ Tốt kèm giải mã SĐT chính chủ, loại bỏ SĐT masked `***`, validate regex VN.
17. **FR-79 (Batdongsan.com.vn Property Scraper):** Cào tin rao BĐS dự án, diện tích và biến động giá đất trên Batdongsan.com.vn.
18. **FR-80 (TopCV Recruitment Scraper):** Cào tin tuyển dụng, kỹ năng yêu cầu và dải lương (xử lý case "Thỏa thuận") trên TopCV.
19. **FR-81 (VietnamWorks Job Scraper):** Cào tin tuyển dụng IT và cấp cao trên VietnamWorks qua API public.
20. **FR-82 (LinkedIn B2B Lead & Job Scraper):** Cào thông tin nhân sự và bài đăng tuyển dụng trên LinkedIn qua CDP Remote Attach 9222.
21. **FR-83 (Realtime Thin Event Redis Stream Ingest):** Phát luồng sự kiện tinh gọn (`{ id, platform, externalId, category, authorId, crawledAt, storageRef }`) vào Redis Stream `stream:social:raw_posts` (`MAXLEN ~ 20000`).
22. **FR-84 (Nowing Adapter Cutover & Legacy Scraper Decommissioning):** Nâng cấp adapter bên Nowing kết nối sang XActions MCP/Redis Stream và gỡ bỏ hoàn toàn 20+ scraper cũ cùng browser dependencies khỏi Nowing backend.
23. **FR-85 (Internal Operator Dashboard & Admin CLI):** Cung cấp giao diện vận hành nội bộ (web dashboard + CLI `xactions admin`) để giám sát jobs/checkpoints, proxy pool, account hibernation, stream metrics và alerts.
24. **FR-86 (Metadata Schema Contract for Consumers):** Mỗi platform/category phải publish JSON Schema hoặc TypeScript type cho `Post.metadata`; consumer lấy schema qua API/MCP/CLI; `PrismaStore` validate `metadata`.
25. **FR-87 (Data Retention Policy):** Dữ liệu raw crawl trong XActions TTL 30 ngày; lead/processed output ở Nowing vĩnh viễn; checkpoints/audit logs 90 ngày.
26. **FR-88 (3-Tier Incremental Gap-Filling):** Cào theo mô hình 3 tầng: full seed, delta/gap fill, on-demand refresh; loại bỏ 100% duplication, tiết kiệm 90% proxy cost.

**Total FRs:** 26 (FR-64 through FR-88, including FR-66B).

### Non-Functional Requirements (NFRs)

1. **NFR-11 (Resource Optimization):** Giảm ít nhất 85% RAM (từ ~10GB xuống <300MB) và 70% CPU so với Full Headless Browser.
2. **NFR-12 (Throughput & Latency):** Tăng tốc độ thu thập 5x–10x (>500 requests/giây) bằng Async HTTP Client với Connection Pool.
3. **NFR-13 (Resilience & Auto-Failover):** Tự động phát hiện proxy chết/rate-limit, cách ly 5 phút, replay 3 lần với exponential backoff.
4. **NFR-14 (Passwordless Security):** Không lưu plain-text password; đăng nhập qua Terminal QR hoặc Chrome CDP Attach.
5. **NFR-15 (Clean Architecture & Extensibility):** `src/core/` Zero-Dependency; thêm nền tảng mới chỉ cần Adapter.
6. **NFR-16 (License & Backward Compatibility):** 100% MIT/Apache 2.0; bảo toàn tương thích ngược với CLI `unfollowx` và 80+ MCP tools.
7. **NFR-17 (Operational Observability):** Expose real-time metrics qua `/governor/status`, `/metrics/stream`, dashboard SSE/polling 5–30s, alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`.

**Total NFRs:** 7 (NFR-11 through NFR-17).

### Additional Requirements / Constraints
- Data Retention Policy (raw 30 days, processed permanent, audit 90 days) — FR-87.
- 3-Tier Incremental Gap-Filling — FR-88.
- Phasing roadmap: Phase 1 (Foundation), Phase 2 (Hybrid Social + Event Stream), Phase 3 (Viral Social + E-Commerce), Phase 4 (Localized Leads + B2B Recruitment), Phase 5 (Operational Observability + Nowing Cutover).
- Open decisions: FR-62 (GraphQL replay) deferred to `FUTURE-WORK.md`; FR-24..FR-54 in `prd-facebook-epics-5-6-2026-08-21.md`.

### PRD Completeness Assessment
- PRD is complete for Epics 10–20 with 26 FRs and 7 NFRs.
- All FRs have traceability to epics in the PRD appendix.
- Two architecture paths exist but PRD does not resolve which to use for Facebook; this is a readiness risk.
- UX documents are not explicitly referenced in the PRD canonical pointer.

## Epic Coverage Validation

### Coverage Matrix

| FR Number | PRD Requirement | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR-64 | Core domain interfaces (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) | Story 10.1 | ✓ Covered |
| FR-65 | Tiered Hybrid Signer Engine (Token Ring + Worker Page Pool + `got-scraping`) | Story 13.1 | ✓ Covered |
| FR-66 | Proxy Pool & Auto-Quarantine (anti-leak, buffer expiration, quarantine) | Epic 11 (Stories 11.1–11.8) | ✓ Covered |
| FR-66B | Adaptive Rate Limiter & Account Protection Governor | Story 11.4, 11.7 | ✓ Covered |
| FR-67 | Namespaced PostgreSQL Storage & JSONB GIN Indexes | Story 10.2 | ✓ Covered |
| FR-68 | Terminal ASCII QR Code Login | Story 12.1 | ✓ Covered |
| FR-69 | CDP Remote Attach Mode | Story 12.2 | ✓ Covered |
| FR-70 | Topological Comment Tree Extraction | Story 14.1 | ✓ Covered |
| FR-71 | Twitter Crawler Refactor | Story 13.2 + 13.2.1–13.2.7 | ✓ Covered |
| FR-72 | Facebook Crawler Refactor | Stories 13.3–13.10 | ✓ Covered |
| FR-73 | MCP Daemon & CLI Integration + Streaming Exporter | Epic 19 (Stories 19.4, 19.7, 19.8) + Story 14.2 | ✓ Covered |
| FR-74 | Threads Meta GraphQL Scraper | Story 15.1 + 15.1.1–15.1.4 | ✓ Covered |
| FR-75 | TikTok Video, Hashtag & Comment Scraper | Story 15.2 | ✓ Covered |
| FR-76 | Shopee Product, Price & Review Scraper | Story 16.1 | ✓ Covered |
| FR-77 | TikTok Shop Winning Products Scraper | Story 16.2 | ✓ Covered |
| FR-78 | Chợ Tốt Multi-Category Scraper with Phone Extractor | Story 17.1 | ✓ Covered |
| FR-79 | Batdongsan.com.vn Property Scraper | Story 17.2 | ✓ Covered |
| FR-80 | TopCV Recruitment Scraper | Story 18.1 | ✓ Covered |
| FR-81 | VietnamWorks Job Scraper | Story 18.2 | ✓ Covered |
| FR-82 | LinkedIn B2B Lead & Job Scraper | Story 18.3 | ✓ Covered |
| FR-83 | Realtime Thin Event Redis Stream Ingest | Story 14.3 | ✓ Covered |
| FR-84 | Nowing Adapter Cutover & Legacy Decommissioning | Epic 20 (Stories 20.1–20.2) | ✓ Covered |
| FR-85 | Internal Operator Dashboard & Admin CLI | Epic 19 (Stories 19.1–19.4, 19.7) | ✓ Covered |
| FR-86 | Metadata Schema Contract for Consumers | Story 10.5 | ✓ Covered |
| FR-87 | Data Retention Policy | Story 10.2 + Epic 19 | ✓ Covered |
| FR-88 | 3-Tier Incremental Gap-Filling | Epic 10 + Epic 11 | ✓ Covered |

### Coverage Statistics

- **Total PRD FRs:** 26
- **FRs covered in epics:** 26
- **Coverage percentage:** 100%

### Missing Requirements

- **No missing FRs** were found in the current `epics.md` against the canonical `prd.md` (FR-64 through FR-88).
- **Deferred/out-of-scope:** FR-62 (GraphQL replay) remains in `FUTURE-WORK.md`; FR-24..FR-54 are in the separate `prd-facebook-epics-5-6-2026-08-21.md`, not in the main PRD scope.

## UX Alignment Assessment

### UX Document Status
- **Found:** `ux/DESIGN.md` (design system, components, tokens), `ux/EXPERIENCE.md`, `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md`.
- **Canonical design system:** `ux/DESIGN.md` is marked `status: final` and updated 2026-08-26.

### Alignment Issues
- `ux/DESIGN.md` focuses on the **Operator Dashboard (Epic 19)** visual design: jobs/checkpoints, proxies/accounts, stream metrics, action cards, dry-run/preview buttons, etc.
- PRD FR-85 (Internal Operator Dashboard & Admin CLI) is directly reflected in Epic 19 stories and `ux/DESIGN.md`.
- `EXPERIENCE.md` and `EXPERIENCE-UNIVERSAL-2026-08-21.md` contain user journeys and experience flows; they align with the `dashboard/` static frontend and `api/routes/admin/*` backend but no explicit canonical pointer exists in `PRD.md`.

### Warnings
- **Multiple UX documents without a canonical register:** `ux/DESIGN.md`, `ux/EXPERIENCE.md`, and `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` may overlap. Recommend adding a `ux/README.md` or a line in `prd.md` pointing to the canonical UX source.
- **UX not deeply tied to CLI flows:** `xactions admin ...` CLI commands are in Epic 19 but UX documents are dashboard-centric; CLI wireframes/flows are not explicitly documented.

## Epic Quality Review

### Epic-by-Epic Quality Findings

#### Epic 10: Data & Platform Foundation for Universal Scraping
- ✅ User value: Shared contracts/storage enable all downstream epics.
- ✅ Independence: Foundational, no forward dependencies.
- ⚠️ `Story 10.2` creates `Post`/`Comment` schema and `PrismaStore` — many later epics (13–18) depend on this schema. It is a necessary foundation, not a user-facing story, but acceptable as a platform enabler.

#### Epic 11: Resilient Network & Proxy Pool Management
- ✅ User value: Operators get reliable, cost-efficient proxy rotation.
- ✅ Independence: Self-contained.
- ⚠️ `Story 11.3` and `11.4` have overlapping scopes (rate-limit/quarantine/governor). Stories 11.3–11.6 are tightly coupled; consider if 11.4 should be merged into 11.3 or 11.6.

#### Epic 12: Frictionless Authentication
- ✅ User value: Login without password via QR or CDP.
- ✅ Independence: Self-contained.
- ✅ AC are specific and testable.

#### Epic 13: High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)
- ⚠️ **Epic combines two distinct platforms (Twitter + Facebook) under one epic.** This is a broad technical container; the title is user-facing but the content is mostly platform-engineer value. **Red flag:** epics should not be catch-alls for unrelated platforms.
- ⚠️ **New sub-stories 13.2.1–13.2.7 depend on 13.2 (base `TwitterCrawler`).** 13.2.1–13.2.7 cannot be completed until 13.2 is done. They are not independent, but the dependency is sequential within the epic and is documented.
- ⚠️ **13.5–13.10 depend on 13.3 and 13.4 (Facebook base).** 13.10 (integration) is an integration story that cannot be done until 13.5–13.9 are implemented. Acceptable as a final migration story.
- ⚠️ **13.2.6 (Twitter Social Actions) is very large:** covers post, reply, quote, like, retweet, follow, DM, schedule. Consider splitting into 2–3 stories (read vs write vs media) or accept as an umbrella story.
- ⚠️ **13.2.7 and 13.10 are integration/deprecation stories, not user-facing value.** They are necessary for the migration but should be the final stories in the epic.

#### Epic 14: Deep Conversation Scraper, MCP Daemon & Nowing Event Stream
- ✅ User value: Extract comment trees and stream to Nowing.
- ✅ `Story 14.1` is specific (topological sort, maxDepth, maxComments).
- ⚠️ `Story 14.2` (MCP Daemon) and `Story 14.3` (Redis Stream) are independent but both depend on `Story 14.1` data model.

#### Epic 15: Vietnam Viral Social — Threads & TikTok Scraper Engine
- ⚠️ **Epic contains two unrelated platforms (Threads + TikTok).** Similar to Epic 13, this is a broad platform bundle. The user value is "viral social monitoring" but the stories are platform-specific.
- ⚠️ **15.1.1–15.1.4 depend on 15.1 (Threads base).** Sequential dependency, acceptable.
- ⚠️ **15.1.3 (DocID Hardening) depends on reverse-engineering Meta endpoints.** AC is clear but the work is exploratory; consider adding a spike/time-box.

#### Epic 16: E-Commerce Multi-Platform Scrapers
- ⚠️ **Combines Shopee and TikTok Shop.** Two different domains in one epic.
- ✅ Stories 16.1 and 16.2 are independent.

#### Epic 17: Real Estate & Procurement Intelligence
- ⚠️ **Combines Chợ Tốt and Batdongsan.** Two BĐS platforms but could be separate epics.
- ✅ Stories 17.1 and 17.2 are independent.

#### Epic 18: HR & B2B Recruitment Crawlers
- ⚠️ **Combines TopCV, VietnamWorks, and LinkedIn.** Three platforms under one epic.
- ✅ Stories 18.1–18.3 are independent.

#### Epic 19: Internal Operator Dashboard, Admin CLI & Operational Observability
- ✅ User value: Operators monitor jobs, proxies, accounts, streams.
- ⚠️ `Story 19.5` and `19.6` merged into `19.4`; the `sprint-status.yaml` correctly skips them, but `epics.md` still lists them as "Reserved." This is a minor documentation inconsistency.
- ⚠️ `Story 19.7` and `19.8` are large (REST API and MCP tools). Consider sub-stories for each admin surface.

#### Epic 20: Nowing Cutover & Legacy Scraper Decommissioning
- ✅ User value: Nowing gets a lighter, unified integration and legacy code is removed.
- ⚠️ `Story 20.2` cannot begin until all hybrid epics (13–18) reach parity. This is a forward dependency across epics — acceptable because it is explicitly decommissioning, but must be tracked.

### Dependency Analysis Summary

- **Within-Epic sequential dependencies:** Epics 13, 15 have sub-stories that depend on a base story (13.2, 15.1). This is acceptable if the base story is implemented first, but the sub-stories are not independently completable.
- **Cross-epic dependencies:** Epic 20.2 depends on Epics 13–18. This is a known decommissioning dependency.
- **No circular dependencies** detected.

### Best Practices Compliance Checklist

| Criterion | Status | Notes |
| --- | --- | --- |
| Epics deliver user value | ⚠️ Mixed | Epics 13, 15, 16, 17, 18 bundle multiple platforms and read more like technical containers. |
| Epics can function independently | ✅ Yes | No epic requires a later epic except 20.2 (explicit). |
| Stories appropriately sized | ⚠️ Mixed | 13.2.6, 19.7, 19.8 are large; 13.2.7/13.10 are integration-only. |
| No forward dependencies | ✅ Yes | Sequential within-epic dependencies are documented. |
| Database tables created when needed | ✅ Yes | Story 10.2 creates schema; others use it. |
| Clear acceptance criteria | ✅ Yes | Most stories have Given/When/Then. |
| Traceability to FRs maintained | ✅ Yes | `epics.md` Requirements Inventory maps FRs to epics. |

## Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK** — The artifacts are functionally complete and traceable, but several structural and scoping issues should be resolved before Phase 4 implementation starts.

### Critical Issues Requiring Immediate Action

1. **Architecture conflict for Facebook:** Two architecture documents (`xactions-hybrid-scraping-spine/` and `xactions-facebook-gateway-2026-08-23/`) are not reconciled. The new sub-stories in Epic 13 assume the hybrid spine, but the gateway spine proposes a different execution model. **Recommendation:** Add an architecture decision record (ADR) or update `epics.md` to explicitly deprecate/supersede the gateway spine, or extract it into an `Epic 23` for evaluation.
2. **Multi-platform epics are too broad:** Epic 13, 15, 16, 17, 18 each contain 2–3 platforms. This risks batching unrelated work and blooting sprint scope. **Recommendation:** Split each into per-platform epics (e.g., Epic 13A Twitter, 13B Facebook; Epic 15A Threads, 15B TikTok) or accept them as "platform suite" epics with clear acceptance that each story still ships independently.
3. **Large umbrella stories:** `Story 13.2.6` (Twitter social actions) and `Story 19.7/19.8` are large. **Recommendation:** Break 13.2.6 into read/like/retweet/post/messenger sub-stories; split 19.7/19.8 into per-endpoint/tool stories.
4. **Integration stories not user-facing:** 13.2.7, 13.10, 15.1.4 are necessary but should be the final stories in their epics and should not be started before their prerequisites.

### Recommended Next Steps

1. Resolve the Facebook architecture conflict (hybrid vs gateway) and document the decision.
2. Decide whether to split multi-platform epics or keep them as suites; update `epics.md` and `sprint-status.yaml` accordingly.
3. Refine `Story 13.2.6`, `19.7`, `19.8` into smaller, independently completable stories.
4. Add a `ux/README.md` or canonical pointer in `prd.md` to disambiguate `DESIGN.md` vs `EXPERIENCE.md`.
5. Re-run `bmad-sprint-planning` once epics are finalized to regenerate `sprint-status.yaml` cleanly.
6. Begin implementation with `Story 13.4` (in-progress branch `feat/13-4-facebook-browser-as-signer-bridge`) or the next ready story after this readiness review is accepted.

### Final Note

This assessment identified **7 issues** across **4 categories** (architecture conflict, epic bundling, story sizing, UX/PRD canonicalization). Coverage of the 26 PRD FRs is 100%, so the content is complete; the remaining concerns are structural and can be resolved with planning edits before implementation accelerates.

## Resolutions Applied (2026-08-27)

The following readiness issues have been resolved since the initial assessment:

1. **Facebook architecture conflict resolved:**
   - `xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` updated to list `xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md` in `supersedes`.
   - `xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md` marked `status: superseded` and a `superseded_by` / `reason` block added. A callout at the top of the document explains that gateway concepts are absorbed into the hybrid engine (`AbstractCrawler` + `BaseHybridClient` + `CrawlerGovernor`) and the active implementation path is `src/scrapers/social/facebook/`.

2. **Multi-platform epics clarified:**
   - Epic 13, 15, 16, 17, 18 each received an **Epic grouping note** explaining they are *platform suites* and that the platform-specific stories are independent sub-threads that can ship independently. No renumbering was done in order to preserve stable `sprint-status.yaml` and branch references.

3. **Large umbrella stories refined:**
   - `Story 13.2.6` (Twitter write & engagement) split into:
     - `13.2.6` — Content Composition & Scheduling
     - `13.2.7` — Engagement & Social Graph Actions
     - `13.2.8` — Direct Messaging & Lists
     - `13.2.9` — Integration & Caller Migration (renumbered from former `13.2.7`)
   - `Story 19.7` (Admin REST API) split into:
     - `19.7` — Proxy Management
     - `19.8` — Account & Checkpoint Management
     - `19.9` — Stream Metrics & Alerts
   - `Story 19.8` (Admin MCP Tools) renumbered to `19.10`.
   - All `sprint-status.yaml`, `deprecation-plan.md`, and `sprint-change-proposal-2026-08-26.md` references updated accordingly.

4. **UX canonical pointer added:**
   - `ux/README.md` created as the canonical register for `DESIGN.md`, `EXPERIENCE.md`, and `EXPERIENCE-UNIVERSAL-2026-08-21.md`.
   - `prd.md` section 7.5 updated to point to `ux/README.md` as the canonical UX register.

### Updated Readiness Status

**NEEDS WORK → READY PENDING VERIFICATION**

All critical structural issues have been addressed. `sprint-status.yaml` has been regenerated/validated against `epics.md` (all 60 stories present) and `bmad-output/implementation-artifacts/sprint-status.yaml` now reflects the renumbered and split stories. The remaining step is to run the standard verification pipeline (lint/typecheck/tests) and then implementation can proceed.
