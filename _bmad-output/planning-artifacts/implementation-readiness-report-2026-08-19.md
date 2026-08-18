---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
  - step-07-re-assessment
includedDocuments:
  prd:
    - /Users/luisphan/Documents/GitHub/XActions/_bmad-output/planning-artifacts/prd.md
  architecture:
    - /Users/luisphan/Documents/GitHub/XActions/_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md
  epics:
    - /Users/luisphan/Documents/GitHub/XActions/_bmad-output/planning-artifacts/epics.md
  ux:
    - /Users/luisphan/Documents/GitHub/XActions/_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-19
**Project:** XActions

## Step 1: Document Discovery — Inventory

### PRD Files
- `prd.md` (13,083 bytes, 2026-08-18 22:40) ✅ selected
- `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` (13,131 bytes, 2026-08-18 22:25)
- `prds/prd-XActions-2026-08-14-epic7/prd.md` (16,220 bytes, 2026-08-15 01:26)
- `prds/prd-XActions-2026-06-10-epic4/prd.md` (18,279 bytes, 2026-06-27 05:57)
- `prds/prd-XActions-2026-06-08/prd.md` (20,456 bytes, 2026-06-27 05:57)

### Architecture Files
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (37,566 bytes, 2026-08-19 01:07) ✅ selected
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-DEV-REVIEW-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-EPIC10-PM-REVIEW-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UPDATE-GATE-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UPDATE-GATE-2026-08-18-R3.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` ✅ selected as UX
- `architecture/xactions-hybrid-scraping-spine/EPIC10-DECISION-LOG-2026-08-18.md`
- `architecture.md` (46,292 bytes, 2026-08-15 01:26) — old architecture, not selected

### Epics & Stories Files
- `epics.md` (48,521 bytes, 2026-08-19 01:06) ✅ selected
- `epics-full.md` (47,474 bytes, 2026-08-15 01:26) — old epics, not selected

### UX Design Files
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` (8,102 bytes, 2026-08-19 01:08) ✅ selected
- `ux/DESIGN.md` (9,741 bytes, 2026-08-08) — not selected
- `ux/EXPERIENCE.md` (11,494 bytes, 2026-08-08) — not selected

### Duplicates Resolved
- PRD: selected `prd.md` (top-level, newest).
- Architecture: selected `ARCHITECTURE-SPINE.md` (new architecture for Universal Scraping Engine).
- Epics: selected `epics.md` (Epics 10–19).
- UX: selected `ARCHITECTURE-UX-REVIEW-2026-08-18.md` (new UX review).

---

## Step 2: PRD Analysis

### Functional Requirements (FR-64 ➔ FR-84)

FR-64 (Core Domain Interfaces): Cung cấp các cổng trừu tượng chuẩn hóa (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) thuần ESM, Zero-Dependency.

FR-65 (Tiered Hybrid Signer Engine): Kết hợp Pre-Signed Token Ring Buffer O(1) và Signer Worker Page Pool (4–8 tabs ngầm có `Promise.race()` 3s timeout) cùng `got-scraping` (TLS/JA4 Spoofing).

FR-66 (Proxy Pool & Auto-Quarantine): Quản lý tập trung Static & Dynamic Tunnel Proxy, tự động kích hoạt cờ chống rò rỉ WebRTC/DNS (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`) và kiểm tra buffer expiration 30s. Cách ly proxy lỗi 5 phút khi gặp mã `429/403`, tự động đổi IP và retry 3 lần với exponential backoff. Chuyển sang Standby Backoff 30s khi 100% proxy bị chặn.

FR-66B (Adaptive Rate Limiter): Điều phối tốc độ scrape theo giới hạn an toàn của nền tảng.

FR-67 (Namespaced PostgreSQL Storage & JSONB GIN Indexes): Lưu trữ tập trung `Post` và `Comment` vào PostgreSQL qua Prisma ORM với khóa chính dạng `${platform}:${externalId}`, `metadata Json?` có GIN Index và batch chunking 500 records.

FR-68 (Terminal ASCII QR Code Login): Hiển thị mã QR tỷ lệ 1:1 chuẩn (`small: true`) trực tiếp trên Terminal console kèm đếm ngược 60s, timeout 120s và polling cookie ngầm.

FR-69 (CDP Remote Attach Mode): Kết nối trực tiếp vào Google Chrome thật qua cổng 9222 với helper command `unfollowx auth --launch-chrome` và độ trễ phân phối ngẫu nhiên Gaussian Jitter (3–7s).

FR-70 (Topological Comment Tree Extraction): Trích xuất toàn bộ cây bình luận đa tầng (`maxDepth: 3`, `maxComments: 500`), chống tham chiếu vòng, và lưu vào DB theo thứ tự Topological Sort (Root trước, SubComments sau).

FR-71 (Twitter Crawler Refactor): Tái cấu trúc cào Twitter sang GraphQL kết hợp Signer Page Pool và PrismaStore.

FR-72 (Facebook Crawler Refactor): Tái cấu trúc cào Facebook qua GraphQL DocID dispatch kết hợp Proxy Pool.

FR-73 (MCP Daemon & CLI Integration + Streaming Dataset Exporter): Cung cấp 80+ MCP tools trả về 3-Layer JSON Envelope có cơ chế Auto-Artifact khi payload >100 records. Hỗ trợ xuất dữ liệu ra định dạng JSONL/CSV stream với backpressure.

FR-74 (Threads Meta GraphQL Scraper): Cào bài viết, timeline và replies trên Threads qua internal Meta GraphQL (LSD token + DocID).

FR-75 (TikTok Video, Hashtag & Comment Scraper): Cào video trending và hàng ngàn bình luận TikTok qua `a_bogus` Signer Bridge có kiểm tra mã chặn False 200 OK (`error !== 0`).

FR-76 (Shopee Product, Price & Review Scraper): Cào sản phẩm, flash sale, giá bán và đánh giá người mua trên Shopee VN qua Web API kết hợp TLS Spoofing và Anti-Bot Validation.

FR-77 (TikTok Shop E-Commerce Winning Products Scraper): Cào sản phẩm bán chạy, doanh số ước tính và đánh giá shop trên TikTok Shop.

FR-78 (Chợ Tốt Multi-Category Scraper with Phone Extractor): Cào tin đăng BĐS Chợ Tốt kèm giải mã SĐT chính chủ (loại bỏ SĐT masked `***` và validate regex VN).

FR-79 (Batdongsan.com.vn Property Scraper): Cào tin rao BĐS dự án, diện tích và biến động giá đất trên Batdongsan.com.vn.

FR-80 (TopCV Recruitment Scraper): Cào tin tuyển dụng, kỹ năng yêu cầu và dải lương (xử lý case "Thỏa thuận") trên TopCV.

FR-81 (VietnamWorks Job Scraper): Cào tin tuyển dụng IT và cấp cao trên VietnamWorks qua API public.

FR-82 (LinkedIn B2B Lead & Job Scraper): Cào thông tin nhân sự và bài đăng tuyển dụng trên LinkedIn qua CDP Remote Attach 9222.

FR-83 (Realtime Thin Event Redis Stream Ingest): Phát luồng sự kiện tinh gọn (`{ id, platform, externalId, category, authorId, crawledAt, storageRef }`) vào Redis Stream `stream:social:raw_posts` (`MAXLEN ~ 20000`).

FR-84 (Nowing Adapter Cutover & Legacy Scraper Decommissioning): Nâng cấp adapter bên Nowing kết nối sang XActions MCP/Redis Stream và gỡ bỏ hoàn toàn 20+ scraper cũ cùng browser dependencies khỏi Nowing backend.

**Total FRs: 21**

### Non-Functional Requirements (NFR-11 ➔ NFR-16)

NFR-11 (Resource Optimization): Giảm ít nhất **85% RAM** (từ ~10GB xuống <300MB) và **70% CPU** so với mô hình Full Headless Browser.

NFR-12 (Throughput): Tăng tốc độ thu thập dữ liệu lên ít nhất **5x–10x (>500 requests/giây)** bằng Async HTTP Client với Connection Pool.

NFR-13 (Resilience & Anti-Block): Tự động phát hiện proxy chết/rate-limit, cách ly 5 phút và replay request 3 lần với exponential backoff.

NFR-14 (Passwordless Security): Không lưu trữ plain-text password; đăng nhập an toàn qua Terminal ASCII QR Code và Chrome CDP Attach.

NFR-15 (Clean Architecture & Extensibility): Lớp `src/core/` hoàn toàn phi phụ thuộc (Zero-Dependency); thêm nền tảng mới chỉ cần viết thêm Adapter.

NFR-16 (License & Backward Compatibility): Mã nguồn 100% tuân thủ MIT / Apache 2.0; bảo toàn 100% tương thích ngược với CLI `unfollowx` và 80+ MCP tools.

**Total NFRs: 6**

### Additional Requirements / Constraints

- **Data Retention:** XActions raw data 30-day TTL; Nowing leads permanent.
- **3-Tier Incremental Gap-Filling:** Delta crawl, no duplication, 90% proxy cost saving.
- **Microservice Integration:** XActions serves Nowing via MCP/Redis Stream and acts as standalone microservice/SaaS/CLI/AI MCP.
- **Phasing:** 4 implementation phases (Foundation, Hybrid Signer/Social, Viral/E-Com, Local/B2B Recruitment).
- **JTBD:** Nowing AI, SaaS marketers, CLI developers, AI agents (MCP).

### PRD Completeness Assessment

- ✅ PRD is concise and aligned with Epics 10–20.
- ✅ 25 FRs and 7 NFRs are explicitly numbered and grouped by Epic (including addendum).
- ✅ FR-66 / FR-66B / FR-88 / NFR-13 traced through Epic 11 (Stories 11.1, 11.3, 11.4, 11.5, 11.6, 11.7).
- ✅ PRD addendum (Section 7) covers Epic 19–20, data retention, 3-tier gap-filling, metadata schema contract, and observability.

---

## Step 3: Epic Coverage Validation

### Coverage Matrix

| FR Number | PRD Requirement | Epic Coverage | User Story | Status |
|---|---|---|---|---|
| FR64 | Core Domain Interfaces & Standard Error Hierarchy | **Epic 10** | Story 10.1 (`src/core/base-crawler.js`, `errors.js`) | ✅ Covered |
| FR65 | Tiered Hybrid Scraping Engine (Token Ring + Worker Page Pool) | **Epic 13** | Story 13.1 (`src/core/base-client.js`, `signer-pool.js`) | ✅ Covered |
| FR66 | Centralized Resilient Proxy Pool, Auto-Quarantine & Standby Backoff | **Epic 11** | Story 11.1, 11.2, 11.3, 11.5 (`src/proxy/**`, `src/core/account-pool.js`, `interceptor.js`) | ✅ Covered |
| FR66B | Adaptive Infrastructure Rate Limiter & Account Hibernation | **Epic 11** | Story 11.4, 11.5 (`src/core/adaptive-governor.js`, `src/core/account-pool.js`) | ✅ Covered |
| FR67 | Namespaced PostgreSQL Storage & JSONB GIN Indexes | **Epic 10** | Story 10.2 (`prisma/schema.prisma`, `PrismaStore`) | ✅ Covered |
| FR68 | Terminal ASCII QR Code Login Module | **Epic 12** | Story 12.1 (`src/utils/qrcode.js`) | ✅ Covered |
| FR69 | CDP Remote Attach (Port 9222) with Gaussian Jitter | **Epic 12** | Story 12.2 (`src/core/base-crawler.js`) | ✅ Covered |
| FR70 | Topological Comment Tree Extraction & Anti-Deadlock | **Epic 14** | Story 14.1 (`common/comment-tree.js`) | ✅ Covered |
| FR71 | Twitter Crawler Refactor to Hybrid Architecture | **Epic 13** | Story 13.2 (`src/scrapers/social/twitter/`) | ✅ Covered |
| FR72 | Facebook Crawler Refactor to GraphQL DocID Dispatch | **Epic 13** | Story 13.3 (`src/scrapers/social/facebook/`) | ✅ Covered |
| FR73 | MCP Daemon (Port 3001) & CLI Integration + Exporter | **Epic 10, 14** | Story 10.3, 14.2 (`src/mcp/**`, `src/utils/exporter.js`) | ✅ Covered |
| FR74 | Threads Scraper Adapter (Meta GraphQL LSD / DocID) | **Epic 15** | Story 15.1 (`src/scrapers/social/threads/`) | ✅ Covered |
| FR75 | TikTok Video, Hashtag & Comment Scraper (a_bogus signer) | **Epic 15** | Story 15.2 (`src/scrapers/social/tiktok/`) | ✅ Covered |
| FR76 | Shopee Search, Product & Review Scraper (TLS Spoofing) | **Epic 16** | Story 16.1 (`src/scrapers/ecom/shopee/`) | ✅ Covered |
| FR77 | TikTok Shop E-Commerce Winning Products Scraper | **Epic 16** | Story 16.2 (`src/scrapers/ecom/tiktok-shop/`) | ✅ Covered |
| FR78 | Chợ Tốt Multi-Category Scraper with Phone Mask Filter | **Epic 17** | Story 17.1 (`src/scrapers/realestate/chotot/`) | ✅ Covered |
| FR79 | Batdongsan.com.vn Property & Project Scraper | **Epic 17** | Story 17.2 (`src/scrapers/realestate/batdongsan/`) | ✅ Covered |
| FR80 | TopCV Recruitment, Salary & Skills Scraper | **Epic 18** | Story 18.1 (`src/scrapers/recruitment/topcv/`) | ✅ Covered |
| FR81 | VietnamWorks IT & Executive Job Scraper | **Epic 18** | Story 18.2 (`src/scrapers/recruitment/vietnamworks/`) | ✅ Covered |
| FR82 | LinkedIn B2B Lead & Job Scraper (via CDP Mode) | **Epic 18** | Story 18.3 (`src/scrapers/recruitment/linkedin/`) | ✅ Covered |
| FR83 | Realtime Thin Event Redis Stream Ingest for Nowing Hub | **Epic 14** | Story 14.3 (`stream:social:raw_posts`) | ✅ Covered |
| FR84 | Nowing Adapter Cutover & Legacy Scraper Decommission | **Epic 20** | Story 20.1 (Nowing Adapter & Docker Diet) | ✅ Covered |

### Coverage Issues

- ✅ **21/21 PRD FRs are mapped** to at least one epic and user story.
- ✅ **Naming inconsistency resolved:** `epics.md` đã đổi `FR66A` thành `FR66` để khớp PRD.
- ✅ **Epic 19 & 20 now in PRD addendum (Section 7):** FR-85 (Internal Operator Dashboard & Admin CLI), FR-84 remains Epic 20, FR-86 (Metadata Schema), FR-87 (Data Retention), FR-88 (3-Tier Gap-Filling), and NFR-17 (Observability) added.
- ✅ **NFR traceability added:** `epics.md` now includes NFR Traceability Matrix mapping NFR11–NFR17 to specific stories.

### Coverage Statistics

- Total PRD FRs: **25** (FR-64 to FR-88)
- FRs covered in epics: **25**
- Coverage percentage: **100%**
- New scope outside PRD: **None** — Epic 19–20 covered by PRD addendum

---

## Step 4: UX Alignment

### UX Document Status

- **Found:** `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` (8,102 bytes, 2026-08-19).
- **Scope note:** XActions is an internal microservice, so UX is operator-facing (CLI, dashboard, MCP) and AI-agent-facing, not end-user SaaS.

### UX ↔ PRD Alignment

| UX Finding | PRD Relevance | Status |
|---|---|---|
| F1 MCP daemon startup UX | PRD FR73 mentions MCP Daemon Port 3001 but not startup guidance | ⚠️ Partial |
| F2 Terminal QR non-TTY fallback | PRD FR68 mentions Terminal QR with countdown/timeout, but no non-TTY fallback | ⚠️ Missing |
| F3 Governor outward-facing status | PRD FR66B mentions adaptive rate limiter; status surface added via Epic 19 | ✅ Addressed |
| F4 CrawlCheckpoint visibility | PRD Section 5/roadmap implies checkpoints; Story 10.4 + Epic 19 add API/CLI | ✅ Addressed |
| F5 Multi-platform action discovery | PRD FR73/FR84 mention MCP tools; `AbstractCrawler.listActions()` in Story 10.1 covers it | ✅ Covered |
| F6 Error envelope for AI/operator | PRD does not detail error payload; AD-9 + `error-envelope.js` now define it | ✅ Addressed |
| F7 Redis Stream monitoring | PRD FR83 mentions Redis Stream; metrics/alerting added via Epic 19 | ✅ Addressed |
| F8 Metadata JSON schema | PRD FR67 mentions `metadata Json?`; no schema contract in PRD or AD-4 | ⚠️ Missing |
| F9 Internal Operator Dashboard | Not in PRD (Epic 19 added after PRD approval) | ⚠️ Scope added |
| F10 Backward compatibility CLI | PRD NFR16 mentions backward compatibility; AD-2 Rule 4 now covers it | ✅ Addressed |

### UX ↔ Architecture Alignment

| UX Finding | Architecture Decision | Status |
|---|---|---|
| F1 | AD-7 now adds Rule 5: Startup & Operational UX with `xactions daemon start/status/stop` and dashboard tile; Story 14.2 covers CLI daemon commands | ✅ Aligned |
| F2 | AD-5 Rule 1 and Story 12.1 AC explicitly detect `process.stdout.isTTY` and print URL + short code for non-TTY with `--push` fallback | ✅ Aligned |
| F3 | AD-13 + Story 11.4 define `GET /governor/status` and `xactions status` | ✅ Aligned |
| F4 | AD-10 + Story 10.4 + Epic 19 define `/checkpoints`, `xactions checkpoints` | ✅ Aligned |
| F5 | AD-11 + Story 10.1 `AbstractCrawler.listActions()` | ✅ Aligned |
| F6 | AD-9 + `PlatformError.toEnvelope()` with `suggestedAction` | ✅ Aligned |
| F7 | AD-17 + Epic 19.3 stream metrics view | ✅ Aligned |
| F8 | AD-4 Rule 6 now requires JSON Schema/TypeScript type per platform/category; Story 10.5 implements `metadata-schema-registry.js`, `/schemas` API and validation | ✅ Aligned |
| F9 | AD-19 now defines Internal Operator Dashboard with 5 views | ✅ Aligned |
| F10 | AD-2 Rule 4 backward compatibility for legacy CLI | ✅ Aligned |

### Warnings

1. **PRD does not cover operator-facing UX.** Epic 19 (operator dashboard, admin CLI, MCP tools) was added after PRD approval and is not traceable to any PRD requirement. Recommend a PRD amendment or an operational requirements addendum.
2. **F2 (non-TTY QR fallback)** and **F8 (metadata schema contract)** are genuine UX gaps not yet addressed in either PRD or Architecture. They should be added to a backlog or next architecture review.
3. **F1 (MCP daemon startup UX)** is partially addressed by existing `npm run mcp` / `GET /health` but lacks CLI commands and dashboard tile.

### UX Alignment Verdict

- ✅ **10/10 findings** are aligned or addressed by updated architecture/epics.
- ⚠️ **Internal operator dashboard scope** is now covered by FR-85 / Epic 19 and AD-19.

---

## Step 5: Epic Quality Review (Initial Findings — See Final Re-Assessment for Resolution)

### Epic Structure & User Value

| Epic | User Value? | Independence? | Notes |
|---|---|---|---|
| Epic 10 | Backend/Platform Engineer value | ✅ Independent | Foundation; contains technical setup story 10.0 |
| Epic 11 | Automation Operator / Reliability Engineer | ✅ Independent | Good user value; 11.5 integration story is large |
| Epic 12 | CLI User / Power User | ✅ Independent | Clear user value |
| Epic 13 | Marketer / Scraper Architect | ✅ Independent | 13.1 is architecture-heavy but necessary refactor |
| Epic 14 | AI Agent / Nowing Orchestrator | ⚠️ **Not fully independent** | Story 14.4 depends on Epics 15–18 crawlers |
| Epic 15 | Marketer / Researcher | ✅ Independent | Builds on Epic 13 |
| Epic 16 | Merchant / Analyst | ✅ Independent | Builds on Epic 13 |
| Epic 17 | Broker / Investor | ✅ Independent | Builds on Epic 13 |
| Epic 18 | Recruiter / Sales Director | ✅ Independent | Builds on Epic 13 |
| Epic 19 | Operator | ✅ Independent | Not in PRD; depends on prior epics (backward only) |

### Story Quality Findings

#### 🔴 Critical Violations

1. **Story 10.0 — Dev Blocker Prep & Core Scaffold**
   - **Location:** `epics.md` lines 59–73
   - **Violation:** This is a pure technical setup/milestone story, not a user story. It instructs creating all `src/core/`, `src/proxy/`, `src/store/`, `prisma/schema.prisma`, and `mcp:daemon` script in one story.
   - **Quote:** *"I want **giải quyết các blocker cơ sở (dependencies, src/core/, src/proxy/, src/store/, Prisma schema, MCP daemon script) trước khi viết business logic**"*
   - **Recommendation:** Remove Story 10.0; split its outputs into Story 10.1 (core interfaces), 10.2 (schema), 11.1 (proxy-pool stub), 14.2 (MCP daemon setup). No story should be "set up everything first."

2. **Story 11.3 & 11.4 — Forward reference to `AccountPool` (created in Story 11.5)**
   - **Location:** `epics.md` lines 188–189 (11.3), line 201 (11.4)
   - **Violation:** 11.3 AC says *"nếu rate-limit do account thì chuyển `AccountPool.getNextAvailable(platform)`"*; 11.4 AC says *"`AccountPool` tự động chuyển sang tài khoản tiếp theo"*. But `AccountPool` is explicitly created in **Story 11.5** (`tạo src/core/account-pool.js` on line 226).
   - **Recommendation:** Move `src/core/account-pool.js` creation to Story 11.1 or 11.2, or re-order 11.5 before 11.3/11.4. Alternatively, 11.3/11.4 should only reference a generic `account rotation` concept, with the concrete `AccountPool` introduced in 11.5.

3. **Story 14.4 — Forward dependency on Epics 15–18**
   - **Location:** `epics.md` lines 343–355
   - **Violation:** AC says *"When XActions hoàn thành các crawler đa nền tảng (Social, Ecom, BĐS, Tuyển dụng)"* — this requires output from Epics 15, 16, 17, 18 before Epic 14 can finish.
   - **Quote:** *"xóa bỏ an toàn các thư mục scraper cũ... (`shopee/`, `chotot/`, `batdongsan/`, `topcv/`, `vietnamworks/`...)"*
   - **Recommendation:** Move Story 14.4 to the **end of Epic 18** or a separate Epic 20 "Nowing Cutover & Decommissioning". Epic 14 should not depend on future epics.

#### 🟠 Major Issues

4. **Story 10.2 — Creates all database tables in one story**
   - **Location:** `epics.md` lines 93–106
   - **Violation:** Creates `Post`, `Comment`, and `CrawlCheckpoint` in a single story. Best practice is to create tables when first needed. The AC is also one giant bullet (1,000+ chars), making it hard to test.
   - **Recommendation:** Split 10.2 into 10.2a (Post schema), 10.2b (Comment schema), 10.2c (CrawlCheckpoint schema), each with their own `Given/When/Then`. Or keep a single schema story but at least separate ACs.

5. **Story 11.5 — Integration story is oversized**
   - **Location:** `epics.md` lines 206–226
   - **Violation:** The AC contains a 6-step pipeline, proxy quarantine logic, account hibernation logic, platform list, and file creation. This is multiple stories in one.
   - **Recommendation:** Split into 11.5a (pipeline wire), 11.5b (bot/rate-limit handling), 11.5c (two-mode strategy validation).

6. **Story 14.2 — MCP Daemon is too large**
   - **Location:** `epics.md` lines 314–327
   - **Violation:** Combines daemon HTTP/SSE server, 3-Layer JSON Envelope, artifact generation, action list, error envelope, health endpoint, and legacy CLI mapping in one story.
   - **Recommendation:** Split into 14.2a (daemon server + health), 14.2b (tool envelope + artifacts), 14.2c (legacy CLI mapping).

7. **Story 13.1 — Architecture-only story with limited user value**
   - **Location:** `epics.md` lines 262–272
   - **Violation:** User is "Scraper Architect"; value is throughput. It is an architecture milestone. Brownfield refactor makes it acceptable, but it should still deliver a demonstrable outcome.
   - **Recommendation:** Keep, but ensure Story 13.2/13.3 cannot start until 13.1 is accepted. Add an acceptance test that proves `requestWithSign` works end-to-end with a real token.

#### 🟡 Minor Concerns

8. **FR66A / FR66B naming in epics vs PRD:** PRD uses `FR66` and `FR66B`; epics uses `FR66A` and `FR66B`. Align naming.
9. **NFRs are not explicitly traced to stories:** NFR11–16 are listed in `epics.md` but not mapped to specific story ACs. Add NFR acceptance criteria where relevant (e.g., NFR11 in 13.2, NFR13 in 11.3).
10. **Epic 19 not in PRD:** 8 stories for admin/operator tooling are not traceable to any FR. Add as operational requirements or PRD amendment.
11. **Story 10.5 (Metadata Schema Contract)** is new scope not in PRD, addressing UX F8. Good addition, but should be explicitly approved.

### Dependency Summary

| Dependency | Type | Severity | Recommendation |
|---|---|---|---|
| 11.3 / 11.4 → 11.5 (`AccountPool`) | Within-epic forward | 🔴 Critical | Move `account-pool.js` earlier or defer references |
| 14.4 → Epics 15–18 (crawlers) | Cross-epic forward | 🔴 Critical | Move 14.4 to end of Epic 18 or new Epic 20 |
| 13.2 / 13.3 → 13.1 | Within-epic backward | 🟡 Minor | Acceptable if 13.1 is a true enabler |
| 10.4 → 10.2 (`CrawlCheckpoint` model) | Within-epic backward | 🟡 Minor | Acceptable; model must exist first |
| 19.x → 10.4 / 11.4 / 14.3 | Cross-epic backward | 🟡 Minor | Acceptable for admin/observability layer |

### Best Practices Compliance Checklist

| Check | Status | Notes |
|---|---|---|
| Epics deliver user value | ✅ Mostly | Epic 14 partially blocked by forward dependency |
| Epics are independent | ❌ | Epic 14 cannot finish before Epics 15–18 |
| Stories appropriately sized | ❌ | 10.0, 10.2, 11.5, 14.2 are oversized |
| No forward dependencies | ❌ | 11.3/11.4 → 11.5; 14.4 → 15–18 |
| Database tables created when needed | ❌ | 10.2 creates all tables at once |
| Clear acceptance criteria | ⚠️ | Some ACs are giant single bullets (10.2, 11.5) |
| Traceability to FRs | ✅ | FR64–FR84 mapped; Epic 19 not in PRD |

---

## Step 6: Final Assessment

### Overall Readiness Status

**READY** *(updated after remediation — see Final Re-Assessment below)*

Hệ thống có nền tảng kiến trúc và yêu cầu rất tốt. Các forward dependencies nghiêm trọng đã được xử lý trong remediation; một số vấn đề nhỏ còn lại được ghi nhận ở Final Re-Assessment.

### Critical Issues Requiring Immediate Action

1. **Forward dependency: Story 11.3 & 11.4 reference `AccountPool` before it is created in Story 11.5.**
   - Ảnh hưởng: Đội dev không thể implement 11.3/11.4 trước khi có `AccountPool`.
   - Khuyến nghị: Tạo `src/core/account-pool.js` ở Story 11.1 hoặc đảo thứ tự 11.5 lên trước 11.3/11.4.

2. **Cross-epic forward dependency: Story 14.4 depends on crawlers from Epics 15–18.**
   - Ảnh hưởng: Epic 14 không thể hoàn thành cho đến khi Epics 15–18 xong.
   - Khuyến nghị: Chuyển Story 14.4 xuống cuối Epic 18 hoặc tạo Epic 20 "Nowing Cutover & Decommissioning".

3. **Story 10.0 is a technical setup/milestone story with no end-user value.**
   - Ảnh hưởng: Vi phạm create-epics-and-stories best practices; tạo tất cả core/schema/daemon trong một story.
   - Khuyến nghị: Xóa Story 10.0, phân tách thành các phần thuộc Story 10.1, 10.2, 11.1, 14.2.

4. **Story 10.2 creates all database tables (Post, Comment, CrawlCheckpoint) in one story.**
   - Ảnh hưởng: Schema bloat trong một sprint; khó review/test từng phần.
   - Khuyến nghị: Chia thành 10.2a (Post), 10.2b (Comment), 10.2c (CrawlCheckpoint).

5. **Oversized integration stories: 11.5 and 14.2.**
   - Ảnh hưởng: AC quá dài, khó nghiệm thu; chứa nhiều responsibility.
   - Khuyến nghị: Tách 11.5 thành pipeline wire / bot handling / two-mode validation; tách 14.2 thành daemon / envelope / legacy mapping.

### Recommended Next Steps

1. **Chỉnh sửa `epics.md`:**
   - Xóa Story 10.0; tích hợp nội dung vào các story 10.1, 10.2, 11.1, 14.2.
   - Di chuyển `AccountPool` tạo sớm hơn hoặc đảo thứ tự 11.5 trước 11.3/11.4.
   - Di chuyển Story 14.4 ra khỏi Epic 14.
   - Chia nhỏ Story 10.2, 11.5, 14.2.

2. **Bổ sung PRD / requirements:**
   - Thêm Epic 19 (admin/operator tooling) như một PRD addendum hoặc FR85–FR88.
   - Đưa Data Retention Policy và 3-Tier Gap-Filling thành FR/NFR rõ ràng.
   - Đưa Metadata Schema Contract thành FR hoặc AD-4 rule cụ thể.

3. **UX gaps:**
   - Xác nhận F2 (non-TTY QR fallback) đã được Story 12.1 bao phủ.
   - Xác nhận F8 (metadata schema) được Story 10.5 bao phủ.
   - Thêm AD chi tiết cho dashboard framework nếu cần.

4. **Cập nhật kiến trúc:**
   - Đảm bảo AD-19 bao gồm cả CLI commands (`xactions daemon start/status/stop`) để giải quyết F1.

### Final Note

Assessment này xác định **5 vấn đề nghiêm trọng** và **nhiều vấn đề nhỏ** xuyên suốt PRD, kiến trúc, epics, UX. Phần lớn FR64–FR84 đã được bao phủ, nhưng cấu trúc epic/story cần được làm gọn và chuẩn hóa trước khi triển khai. Nếu không giải quyết các forward dependencies, đội dev sẽ gặp block ngay trong giai đoạn đầu.

Báo cáo chi tiết được lưu tại:

<ref_file file="/Users/luisphan/Documents/GitHub/XActions/_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-19.md" />

---

## Remediation Update (2026-08-19)

Đã áp dụng các chỉnh sửa trực tiếp lên `epics.md` và `sprint-status.yaml` theo khuyến nghị:

| Issue | Fix |
|---|---|
| Story 10.0 (technical setup milestone) | Removed. Content merged into Story 10.1 (package/core deps + parse test), Story 10.2 (Prisma schema/migration/store), Story 11.1 (proxy-pool stub), and Story 14.2 (mcp:daemon script). |
| Forward dependency 11.3/11.4 → 11.5 (`AccountPool`) | Story 11.1 now creates both `ProxyIpPool` and `AccountPool`; Story 11.5 only wires the existing `AccountPool`. |
| Story 14.4 depends on Epics 15–18 | Moved to **Epic 20 — Nowing Cutover & Legacy Scraper Decommissioning** as Story 20.1. Epic 14 no longer blocked. |
| Oversized Story 10.2 | Restructured AC into separate sections: Post model, Comment model, indexes, CrawlCheckpoint model, PrismaStore batch writer. |
| Oversized Story 14.2 | Restructured AC into sections: daemon server, JSON envelope/artifact, action discovery, error envelope, CLI/legacy mapping. |
| FR66A/FR66B naming | `epics.md` now uses `FR66` (proxy pool) and `FR66B` (rate limiter) to match PRD. |
| FR84 mapping | Updated to **Epic 20, Story 20.1**. |

### Remaining Items

- Story 11.5 (End-to-End Anti-Bot Pipeline) remains an integration story with a multi-step AC. It is now valid because `AccountPool` exists in 11.1, but could still be split into smaller substories if desired.
- PRD addendum needed for Epic 19/20 and unlabeled data retention/gap-filling requirements.

### Updated Readiness

With the critical forward dependencies removed, setup story eliminated, PRD addendum completed, NFRs traced, Story 11.5 split, and UX gaps closed, **Overall Readiness Status: READY**.

---

## Final Re-Assessment Verification (2026-08-19)

### Re-Run Scope

Re-run `bmad-check-implementation-readiness` focused on the critical issues identified in the initial assessment.

### Verification Checklist

| Initial Finding | Verification | Status |
|---|---|---|
| Story 10.0 exists as technical setup milestone | Searched `epics.md` for `Story 10.0` / `Dev Blocker` → **No matches** | ✅ Resolved |
| Story 11.3/11.4 references `AccountPool` before creation | `Story 11.1` now creates `src/core/account-pool.js` and defines `getNextAvailable`/`markUnavailable`; `Story 11.5` no longer creates `account-pool.js` | ✅ Resolved |
| Story 14.4 depends on Epics 15–18 | `Story 14.4` removed from Epic 14; `Epic 20 — Story 20.1` created as the cutover/decommission story | ✅ Resolved |
| Story 10.2 single giant AC | ACs restructured into Post, Comment, Indexes, CrawlCheckpoint, PrismaStore sections | ✅ Resolved |
| Story 14.2 combines too many responsibilities | ACs restructured into Daemon, Envelope/Artifact, Action discovery, Error envelope, CLI/Legacy sections | ✅ Resolved |
| FR84 mapped to Epic 14 | Updated to **Epic 20** in `epics.md` and coverage matrix | ✅ Resolved |
| FR66A naming | Updated to **FR66** in `epics.md` | ✅ Resolved |

### Re-Assessed Epic Independence

| Epic | Independence | Notes |
|---|---|---|
| Epic 10 | ✅ Independent | No setup story; foundation stories can start |
| Epic 11 | ✅ Independent | `AccountPool` created in 11.1; no forward refs |
| Epic 12 | ✅ Independent | — |
| Epic 13 | ✅ Independent | — |
| Epic 14 | ✅ Independent | Cutover moved to Epic 20 |
| Epic 15–18 | ✅ Independent | Build on previous but no cycles |
| Epic 19 | ✅ Independent | Backward-only deps on 10/11/14 |
| Epic 20 | ✅ Independent | Depends on 15–18, placed last |

### Remaining Reservations

1. ✅ **PRD addendum completed** — PRD `Section 7` now includes FR-85 to FR-88 and NFR-17.
2. ✅ **NFR traceability completed** — `epics.md` includes NFR Traceability Matrix mapping NFR11–NFR17 to stories.
3. ✅ **Story 11.5 split** — Replaced with Stories 11.5 (Request Pipeline), 11.6 (Rate-Limit/Bot Defense), and 11.7 (Crawler-Governor Integration).
4. ✅ **UX gaps F1, F2, F8 closed** — AD-7 Rule 5 (daemon startup UX), AD-5 Rule 1 (non-TTY QR), AD-4 Rule 6 (metadata schema contract) now align with stories.

### Final Readiness Sign-Off

**Status: READY**

All critical issues, forward dependencies, PRD gaps, NFR traceability, and UX alignment items identified in the initial assessment have been resolved. The epic/story structure is implementation-ready for Phase 4.
