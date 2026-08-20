---
stepsCompleted: [1, 2, 3, 4, 5, 6]
documentsIncluded:
  prd:
    - _bmad-output/planning-artifacts/prd.md
    - _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-08/prd.md
    - _bmad-output/planning-artifacts/prds/prd-XActions-2026-06-10-epic4/prd.md
    - _bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/prd.md
    - _bmad-output/planning-artifacts/prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md
  architecture:
    - _bmad-output/planning-artifacts/architecture.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-DEV-REVIEW-2026-08-18.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-EPIC10-PM-REVIEW-2026-08-18.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UPDATE-GATE-2026-08-18.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UPDATE-GATE-2026-08-18-R3.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/EPIC10-DECISION-LOG-2026-08-18.md
    - _bmad-output/planning-artifacts/architecture/architecture-ecosystem-manus-killer-2026-08-20/ARCHITECTURE-SPINE.md
    - _bmad-output/planning-artifacts/research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md
  epics:
    - _bmad-output/planning-artifacts/epics-full.md
    - _bmad-output/planning-artifacts/epics.md
  ux:
    - _bmad-output/planning-artifacts/ux/DESIGN.md
    - _bmad-output/planning-artifacts/ux/EXPERIENCE.md
    - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md
pendingDuplicates:
  - prd_multiple_versions
  - architecture_whole_vs_sharded
  - epics_two_files
  - ux_review_file_classification
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-21
**Project:** XActions

---

## Step 1: Document Discovery

### PRD Documents

**Whole Documents:**
- `prd.md` (15K, 2026-08-15)
- `prds/prd-XActions-2026-06-08/prd.md` (20K, 2026-06-27)
- `prds/prd-XActions-2026-06-10-epic4/prd.md` (18K, 2026-06-27)
- `prds/prd-XActions-2026-08-14-epic7/prd.md` (16K, 2026-08-15)
- `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` (13K, 2026-08-18)

**Sharded Documents:**
- Không tìm thấy thư mục `prd/` với `index.md`.

⚠️ **CRITICAL: Nhiều phiên bản PRD tồn tại.** Cần xác định PRD canonical trước khi đánh giá.

---

### Architecture Documents

**Whole Documents:**
- `architecture.md` (45K, 2026-08-15)

**Sharded Documents:**
- Thư mục `architecture/xactions-hybrid-scraping-spine/`:
  - `ARCHITECTURE-SPINE.md` (37K, 2026-08-19)
  - `ARCHITECTURE-DEV-REVIEW-2026-08-18.md` (10K)
  - `ARCHITECTURE-EPIC10-PM-REVIEW-2026-08-18.md` (8.0K)
  - `ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md` (12K)
  - `ARCHITECTURE-UPDATE-GATE-2026-08-18.md` (4.3K)
  - `ARCHITECTURE-UPDATE-GATE-2026-08-18-R3.md` (2.9K)
  - `ARCHITECTURE-UX-REVIEW-2026-08-18.md` (7.9K)
  - `EPIC10-DECISION-LOG-2026-08-18.md` (6.7K)
- Thư mục `architecture/architecture-ecosystem-manus-killer-2026-08-20/`:
  - `ARCHITECTURE-SPINE.md` (10K, 2026-08-20)

**Tài liệu tham khảo:**
- `research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md` (27K)

⚠️ **CRITICAL: Architecture tồn tại cả dạng `architecture.md` (whole) và `ARCHITECTURE-SPINE.md` (sharded).** Có thể trùng lặp hoặc lỗi thời.

---

### Epics & Stories Documents

**Whole Documents:**
- `epics-full.md` (46K, 2026-08-15) — Epics 1–9 (Facebook)
- `epics.md` (53K, 2026-08-20) — Epics 10–20 (Universal Hybrid Scraping)

**Sharded Documents:**
- Không tìm thấy thư mục `epics/` với `index.md`.

ℹ️ Hai file epic bổ sung nhau theo pha, chưa merge thành 1 file duy nhất.

---

### UX Design Documents

**Whole Documents:**
- `ux/DESIGN.md`
- `ux/EXPERIENCE.md`

**Review / liên quan:**
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md`

---

### Vấn đề duplicate chưa giải quyết

| # | Vấn đề | Mô tả |
|---|---|---|
| 1 | `prd_multiple_versions` | 5 PRD khác nhau; chưa xác định canonical. |
| 2 | `architecture_whole_vs_sharded` | `architecture.md` vs `ARCHITECTURE-SPINE.md`; cần chọn 1. |
| 3 | `epics_two_files` | `epics-full.md` (1–9) và `epics.md` (10–20) là 2 file riêng, có thể cần merge. |
| 4 | `ux_review_file_classification` | `ARCHITECTURE-UX-REVIEW` nên thuộc UX hay Architecture? |

---

### Các tài liệu / config còn thiếu

- `_bmad/bmm/config.yaml` — file cấu hình BMAD module không tồn tại trong XActions.
- `project-context.md` — context dự án cho AI chưa có (persistent fact từ skill customize).

---

## Step 3: Epic Coverage Validation

### Epic Documents Read

- `epics-full.md` (Epics 1–9, Facebook platform) — có `Requirements Inventory` FR1–FR54 + PCR1–PCR7 và `FR Coverage Map`.
- `epics.md` (Epics 10–20, Universal Hybrid Scraping Engine) — có `Requirements Inventory` FR64–FR88 + NFR11–NFR17 và `NFR Traceability Matrix`.

### Epic FR Coverage Map

#### Epics 1–9 (`epics-full.md`)

| FR Range | Epic | Status |
|---|---|---|
| FR1–FR7 | Epic 1: Facebook Data Reading | ✅ Done |
| FR12–FR14 | Epic 2: Facebook Automation | ✅ Done |
| FR8–FR11 | Epic 3: Multi-Surface & Persistence | ✅ Done |
| FR15–FR22 | Epic 4: Growth Automation | ✅ Done |
| FR23–FR27 | Epic 5: Messenger Port | ✅ Done |
| FR28–FR39 | Epic 5b: Marketplace/Share/Headless | ✅ Done |
| FR40–FR54 | Epic 6: Anti-Detection | 🟡 4 done, 13 backlog |
| FR55–FR61, FR63 | Epic 7: Advanced Scraping & Multi-Account | ✅ Done |
| FR62 | Epic 7 (deferred to Phase 3) | 🔄 Deferred |
| PCR2, PCR6, PCR7 | Epic 8: Backend Reliability | 🟡 In progress |
| PCR1, PCR3–PCR5 | Epic 9: Live Data & Behavioral Hardening | 🟡 Ready-for-dev |

#### Epics 10–20 (`epics.md` Requirements Inventory)

| FR | Mapped Location | Status |
|---|---|---|
| FR64 | Epic 10 (Story 10.1) | ✅ Done |
| FR65 | Epic 13 | 🟡 In progress |
| FR66 | Epic 11 | ✅ Done |
| FR66B | Epic 11 (Story 11.4) | 🟡 Ready-for-dev |
| FR67 | Epic 10 (Story 10.2) | ✅ Done |
| FR68 | Epic 12 (Story 12.1) | 🟡 Ready-for-dev |
| FR69 | Epic 12 (Story 12.2) | 🔴 Backlog |
| FR70 | Epic 14 (Story 14.1) | 🟡 Ready-for-dev |
| FR71 | Epic 13 (Story 13.2) | 🟡 Ready-for-dev |
| FR72 | Epic 13 (Story 13.3) | 🟡 Ready-for-dev |
| FR73 | Epic 14 (Story 14.2) | 🟡 In progress |
| FR73A | Epic 10 (Story 10.3) | ✅ Done |
| FR73B | Epic 14 (Story 14.2) | 🟡 In progress |
| FR74 | Epic 15 (Story 15.1) | 🟡 Ready-for-dev |
| FR75 | Epic 15 (Story 15.2) | 🔴 Backlog |
| FR76 | Epic 16 (Story 16.1) | 🟡 Ready-for-dev |
| FR77 | Epic 16 (Story 16.2) | 🟡 Ready-for-dev |
| FR78 | Epic 17 (Story 17.1) | 🟡 Ready-for-dev |
| FR79 | Epic 17 (Story 17.2) | 🟡 Ready-for-dev |
| FR80 | Epic 18 (Story 18.1) | 🟡 Ready-for-dev |
| FR81 | Epic 18 (Story 18.2) | 🟡 Ready-for-dev |
| FR82 | Epic 18 (Story 18.3) | 🔴 Backlog |
| FR83 | Epic 14 (Story 14.3) | 🟡 In progress |
| FR84 | Epic 20 (Story 20.1) | 🔴 Backlog |
| FR85 | Epic 19 | 🟡 In progress |
| FR86 | Epic 10 (Story 10.5) | ✅ Done |
| FR87 | Epic 10 (Story 10.2) / Epic 19 | ✅ Done |
| FR88 | Epic 10 / Epic 11 | 🟡 In progress |

### FR Coverage Analysis

#### ✅ Covered

- **FR-1..FR-23** từ PRD được `epics-full.md` bao phủ đầy đủ.
- **FR-55..FR-61, FR-63** từ PRD Epic 7 được bao phủ; FR-62 được ghi rõ *deferred*.
- **FR-64..FR-88** từ PRD Epics 10–20 được `epics.md` bao phủ, với mapping rõ ràng sang epic/story.

#### ⚠️ Inconsistency / Gaps

| FR | Issue | Mô tả |
|---|---|---|
| **FR-24..FR-54** | **Có trong epics, KHÔNG có trong PRD** | `epics-full.md` định nghĩa FR24–FR54 (Epic 5b Messenger Share/Headless, Epic 6 Anti-Detection), nhưng không PRD nào đề cập. Đây là dải FR "mồ côi" so với tài liệu PRD. |
| **FR-62** | **Có trong PRD, KHÔNG có trong epic scope** | Epic 7 PRD liệt kê FR-62 (GraphQL replay) nhưng ghi "out of scope / defer". Epics cũng ghi deferred. PRD vẫn coi đó là FR dù không được epic nhận. |
| **FR-73A, FR-73B** | **Epic phân tách, PRD gộp** | `epics.md` tách FR-73 thành FR-73 (MCP daemon), FR-73A (dataset exporter), FR-73B (tool envelope). PRD chỉ có FR-73 + FR-73A (appendix). Cần align để tránh duplicate story. |
| **FR-66 / FR-66A / FR-66B** | **PRD gộp, Epic tách** | PRD FR-66 bao gồm cả proxy pool và rate limiter; `epics.md` tách thành FR-66 và FR-66B. Hiện tại 2 story (11.3 và 11.4) bao phủ cả hai. |
| **FR-83 / FR-84** | **Tên khác nhau giữa PRD và Epic** | PRD: "Realtime Thin Event Redis Stream Ingest" (FR-83) và "Nowing Adapter Cutover" (FR-84). Epic: "Nowing Thin Event Stream Ingest" (FR-83) và "Nowing Scrapers Cutover & Decommissioning" (FR-84). Nội dung tương đương. |

#### 🔴 Missing FR Coverage

1. **FR-24..FR-54 — Không có PRD**
   - **Impact:** Các yêu cầu Anti-Detection, Messenger Share V2, Marketplace, Headless/Chrome path tồn tại trong epic nhưng không được PRD nào phê duyệt. Rủi ro scope creep và thiếu cơ sở pháp lý/sản phẩm.
   - **Recommendation:** Viết PRD bổ sung cho Epics 5b–6 hoặc gộp FR24–54 vào PRD canonical hiện tại (`prd.md`).

2. **FR-62 — GraphQL replay deferred**
   - **Impact:** PRD Epic 7 vẫn liệt kê FR-62 như một functional requirement nhưng không có epic/story nào nhận. Nếu không cần, nên xóa khỏi PRD hoặc chuyển thành "assumption/won't do".
   - **Recommendation:** Quyết định chính thức: implement trong Epic 13/14 (hybrid engine) hay loại bỏ khỏi PRD.

### NFR Coverage

- `epics.md` có `NFR Traceability Matrix` cho NFR11–NFR17, map sang story và validation approach.
- `epics-full.md` có NFR1–NFR10 và PCRs nhưng **không có NFR Traceability Matrix** cho Epics 1–9.
- **NFR numbering conflict** vẫn chưa giải quyết (NFR10 có 2 nghĩa, NFR11–NFR15 bị dùng lại).

### Coverage Statistics

- **Total PRD FRs:** 67 (FR-1..23, 55..63, 64..88)
- **FRs covered in epics:** 66/67 (98.5%)
- **FRs missing/deferred:** FR-62 (deferred), FR-24..54 (không có trong PRD nhưng có trong epics)
- **NFRs with traceability matrix:** NFR11–NFR17 (Epics 10–20); NFR1–NFR10 + PCRs (Epics 1–9) **không có matrix**.

### Epic Completeness Assessment

| Criterion | Finding |
|---|---|
| **FR→Epic mapping** | ✅ Có mapping cho cả hai file epic. `epics-full.md` có `FR Coverage Map` dạng bảng. `epics.md` có ghi chú (Epic/Story) trong Requirements Inventory. |
| **FR numbering continuity** | ❌ Gián đoạn nghiêm trọng: FR-24..54 tồn tại trong epics nhưng không trong PRD; FR-62 trong PRD nhưng deferred khỏi epics. |
| **NFR traceability** | 🟡 Epics 10–20 có matrix đầy đủ. Epics 1–9 chỉ liệt kê NFR, không có matrix. |
| **Duplicate/overlapping FRs** | ⚠️ FR-66/66B và FR-73/73A/73B là sự phân tách hợp lý nhưng cần update PRD. FR-83/84 tên khác nhau giữa PRD và epic. |
| **Open questions resolved** | ✅ Epic 7 đã resolve open questions. Epic 4 vẫn còn open questions (runGuardedBatch path, Schedule model, batchLimit test). |

---

## Step 2: PRD Analysis

### PRD Documents Read

- `prd.md` (2026-08-19, approved, Epics 10–20) — bản xuyên suốt mới nhất, bao gồm appendix FR-85..88 và NFR-17.
- `prds/prd-XActions-2026-06-08/prd.md` (Epics 1–3: Facebook scrape, automate, MCP/CLI/REST/Prisma).
- `prds/prd-XActions-2026-06-10-epic4/prd.md` (Epic 4: Facebook growth automation).
- `prds/prd-XActions-2026-08-14-epic7/prd.md` (Epic 7: advanced Facebook scraping + multi-account).
- `prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md` (Epics 10–18, nội dung tương đương `prd.md` nhưng thiếu appendix).

### Functional Requirements Extracted

#### FR-1 – FR-14 (Epics 1–3, từ `prd-XActions-2026-06-08`)

| ID | Requirement |
|---|---|
| FR-1 | Scrape Facebook profile công khai, trả về `name, username, bio, avatar, followers, url, platform: 'facebook'`. |
| FR-2 | Scrape posts gần đây của profile/page với `limit`, scroll + bounded retry, delay 1–3s. |
| FR-3 | Scrape followers khi công khai; nếu bị giấu thì trả `note`, không ném lỗi. |
| FR-4 | Search posts theo query với `limit` và bounded retry. |
| FR-5 | Đăng ký `facebook`/`fb` vào `platforms` registry và dispatch `scrape()`. |
| FR-6 | Like post với `dryRun` mặc định `true`, delay 1–3s, bounded batch, Operation record. |
| FR-7 | Comment trên post với `dryRun` mặc định `true`. |
| FR-8 | Tạo post text/media với `dryRun` mặc định `true`, trả URL/ID. |
| FR-9 | Guardrail chung: dry-run mặc định, delay, bounded batch/retry, stop condition, account risk warning. |
| FR-10 | Login bằng cookie `c_user` + `xs`. |
| FR-11 | MCP tool Facebook cùng schema các nền tảng khác. |
| FR-12 | CLI `--platform facebook` cho scrape/automate. |
| FR-13 | REST API + Dashboard cho Facebook. |
| FR-14 | Persistence Operation qua Prisma + Socket.IO. |

#### FR-15 – FR-23 (Epic 4, từ `prd-XActions-2026-06-10-epic4`)

| ID | Requirement |
|---|---|
| FR-15 | Lên lịch post Facebook tại `scheduledAt` với `Schedule` record và worker ±2 phút. |
| FR-16 | Auto-share post URL lên timeline. |
| FR-17 | View boost (scroll simulation) với `durationSeconds` cap 300s. |
| FR-18 | Tham gia nhóm tự động theo URL hoặc keyword. |
| FR-19 | Đăng bài vào nhiều nhóm với `batchLimit=10`, delay 30–90s. |
| FR-20 | Scrape thành viên nhóm với bounded scroll, không thu PII. |
| FR-21 | Gửi kết bạn tự động 3 mode, `batchLimit ≤ 20`, delay 60–180s. |
| FR-22 | Hủy lời mời kết bạn đang chờ. |
| FR-23 | Newsfeed farming / account warming với `reactProbability` cap 0.2. |

#### FR-55 – FR-63 (Epic 7, từ `prd-XActions-2026-08-14-epic7`)

| ID | Requirement |
|---|---|
| FR-55 | Account health check (HTTP GET, parse `fb_dtsg`, TTL 5 phút, lưu `FacebookAccountHealth`). |
| FR-56 | Account pool & parallel runner với `maxConcurrency` 4–8, proxy affinity, round-robin. |
| FR-57 | Search Facebook multi-type (`posts, people, pages, groups, all`). |
| FR-58 | Scrape post comments với `includeReplies`, `parentId`. |
| FR-59 | Scrape group posts qua mobile UA. |
| FR-60 | Scrape group comments, cùng logic FR-58. |
| FR-61 | Hydration JSON extraction từ `data-content-len` script tags. |
| FR-62 | GraphQL replay (capture `doc_id`, replay `POST /api/graphql/`). |
| FR-63 | Unified Facebook scrape service dùng chung cho API và MCP. |

#### FR-64 – FR-88 (Epics 10–20, từ `prd.md` / `prd-XActions-2026-08-18`)

| ID | Requirement |
|---|---|
| FR-64 | Core domain interfaces (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) thuần ESM, Zero-Dependency. |
| FR-65 | Tiered Hybrid Signer Engine (Pre-Signed Token Ring Buffer O(1) + Signer Worker Page Pool + `got-scraping`). |
| FR-66 | Proxy Pool & Auto-Quarantine (WebRTC/DNS leak prevention, 429/403 quarantine 5 phút, retry 3, Standby Backoff 30s). |
| FR-66A | Anti-Leak Proxy Pool (buffer expiration 30s). |
| FR-66B | Adaptive Rate Limiter / 429-403-Auto-Quarantine & Standby Backoff. |
| FR-67 | Namespaced PostgreSQL Storage & JSONB GIN Indexes (`${platform}:${externalId}`, `metadata Json?`, batch 500). |
| FR-68 | Terminal ASCII QR Code Login (countdown 60s, timeout 120s, polling). |
| FR-69 | CDP Remote Attach Mode (port 9222, Gaussian Jitter 3–7s). |
| FR-70 | Topological Comment Tree Extraction (`maxDepth: 3`, `maxComments: 500`, topological sort). |
| FR-71 | Twitter Crawler Refactor sang GraphQL + Signer Page Pool + PrismaStore. |
| FR-72 | Facebook Crawler Refactor qua GraphQL DocID dispatch + Proxy Pool. |
| FR-73 | MCP Daemon & CLI Integration + Streaming Dataset Exporter (JSONL/CSV, backpressure, Gzip). |
| FR-73A | AI Streaming Dataset Exporter (JSONL/CSV stream, backpressure, sanitize, Gzip). |
| FR-73B | Standardized MCP Tool Envelope & CLI Crawl (80+ tools, 3-Layer JSON Envelope, Auto-Artifact >100 records). |
| FR-74 | Threads Meta GraphQL Scraper (LSD token + DocID). |
| FR-75 | TikTok Video, Hashtag & Comment Scraper (`a_bogus` Signer Bridge, False 200 OK detection). |
| FR-76 | Shopee Product, Price & Review Scraper (TLS Spoofing, Anti-Bot Validation). |
| FR-77 | TikTok Shop Winning Products Scraper. |
| FR-78 | Chợ Tốt Multi-Category Scraper with Phone Extractor (loại bỏ SĐT masked `***`). |
| FR-79 | Batdongsan.com.vn Property Scraper. |
| FR-80 | TopCV Recruitment Scraper (dải lương "Thỏa thuận"). |
| FR-81 | VietnamWorks Job Scraper (API public, refresh guest token on 401). |
| FR-82 | LinkedIn B2B Lead & Job Scraper (CDP Remote Attach 9222). |
| FR-83 | Realtime Thin Event Redis Stream Ingest (`stream:social:raw_posts`, `MAXLEN ~ 20000`). |
| FR-84 | Nowing Adapter Cutover & Legacy Scraper Decommissioning. |
| FR-85 | Internal Operator Dashboard & Admin CLI (jobs, proxies, accounts, stream metrics, alerts). |
| FR-86 | Metadata Schema Contract for Consumers (`GET /schemas/:platform/:category`, MCP `x_schema_get`, CLI `xactions schema get`, PrismaStore validate). |
| FR-87 | Data Retention Policy (raw crawl TTL 30 ngày, checkpoints/audit 90 ngày, Nowing lead permanent). |
| FR-88 | 3-Tier Incremental Gap-Filling (full seed → delta/gap → on-demand refresh, 0% duplication). |

**Total FRs extracted: 67 distinct IDs** (FR-1..23, FR-55..63, FR-64..88). Khoảng **FR-24..FR-54 không xuất hiện trong bất kỳ PRD nào** — đây là lỗ hổng traceability.

### Non-Functional Requirements Extracted

#### NFR từ `prd-XActions-2026-06-08` (Cross-Cutting, chưa được đánh số nhất quán)

- Rate-limit safety: delay 1–3s, bounded retry, stop condition.
- Anti-detection: puppeteer-extra-plugin-stealth, delay rộng hơn.
- Security: cookie `c_user`/`xs` không log/echo, record scope `userId`.
- Selector resilience: ưu tiên `role`/`aria-label`/text, tập trung ở `docs/agents/selectors-facebook.md`.
- Consistency: output khớp normalized shape, entrypoint chỉ orchestrate/validate/format.
- Testability: unit parser, smoke test, contract test.

#### NFR-6 – NFR-10 (từ `prd-XActions-2026-06-10-epic4`)

| ID | Requirement |
|---|---|
| NFR-6 | Delay sàn cho write action: Cluster 1 delay 30–90s; Cluster 2 delay 60–180s. |
| NFR-7 | `runGuardedBatch` bắt buộc cho mọi vòng lặp ghi hàng loạt. |
| NFR-8 | Cảnh báo account risk không thể tắt. |
| NFR-9 | Giới hạn throughput scheduling: ≤ 5 scheduled posts/giờ/user. |
| NFR-10 | Không thu thập PII nhạy cảm (số điện thoại, email, địa chỉ). |

#### NFR-10 – NFR-15 (từ `prd-XActions-2026-08-14-epic7`)

| ID | Requirement |
|---|---|
| NFR-10 | Không lưu trữ kết quả scrape trong XActions; chỉ trả JSON. |
| NFR-11 | Health check nhanh < 2 giây, không mở browser. |
| NFR-12 | Concurrency cap mặc định 4, tối đa 8 browsers. |
| NFR-13 | Privacy: cookie/token không log hay echo. |
| NFR-14 | Resilience: luôn có DOM fallback khi hydration/GraphQL fail. |
| NFR-15 | Read velocity: delay 1–3s, giới hạn 50 scroll/task. |

#### NFR-11 – NFR-17 (từ `prd.md` / `prd-XActions-2026-08-18`)

| ID | Requirement |
|---|---|
| NFR-11 | Tối ưu tài nguyên: giảm ≥ 85% RAM, 70% CPU so với full headless browser. |
| NFR-12 | Băng thông & tốc độ: tăng 5–10x, > 500 requests/giây. |
| NFR-13 | Tự phục hồi & chống chặn: quarantine 5 phút, retry 3 lần exponential backoff. |
| NFR-14 | Bảo mật phi mật khẩu: QR/CDP attach, không lưu plaintext password. |
| NFR-15 | Kiến trúc sạch & mở rộng: `src/core/` zero-dependency; thêm nền tảng chỉ cần adapter. |
| NFR-16 | Bản quyền & tương thích ngược: MIT/Apache 2.0, giữ CLI `unfollowx` + 80+ MCP tools. |
| NFR-17 | Operational Observability: expose metrics `GET /governor/status`, `GET /metrics/stream`, dashboard SSE/polling 5–30s, alert `pendingMessages > 50,000` hoặc `lastAckTime > 60s`. |

**NFR numbering conflicts detected:**
- `NFR-10` được định nghĩa 2 lần với ý nghĩa khác nhau (PII protection vs. no storage).
- `NFR-11..NFR-15` được dùng lại ở Epic 7 (health/concurrency/privacy/resilience/velocity) và ở Universal PRD (resource/throughput/self-heal/security/scalability/license) — hoàn toàn khác nhau.
- Tổng cộng có **~22 NFR statements** nhưng chỉ **~17 unique ID slots**, gây xung đột traceability.

### Additional Requirements / Constraints

- **Data Retention Policy:** raw crawl TTL 30 ngày trong XActions, Nowing lead data permanent, checkpoints/audit logs 90 ngày.
- **3-Tier Incremental Gap-Filling:** full seed → delta/gap fill → on-demand refresh, 0% duplication.
- **Data Lake vs. Knowledge Hub split:** XActions giữ raw data; Nowing giữ leads, vector embeddings, intent tags.
- **Nowing Cutover:** thay 20+ scraper cũ bằng XActions MCP/Redis Stream, giảm Docker image từ 4GB xuống < 500MB.
- **Phasing:** 5 phases (Foundation, Hybrid/Stream, Social/E-com, Local/B2B, Ops/Cutover).
- **Assumptions:** pool account đã nuôi; `runGuardedBatch` tồn tại; Prisma `Schedule` model tồn tại; cookie `c_user`/`xs` xử lý nhạy cảm.

### PRD Completeness Assessment

| Criterion | Finding |
|---|---|
| **FR coverage** | ✅ FR-1..23, 55..63, 64..88 được phủ. ⚠️ Khoảng **FR-24..54 mất tích** — khả năng PRD cho Epic 5–6 hoặc trung gian chưa được viết hoặc bị xóa. |
| **NFR numbering** | ❌ Xung đột nghiêm trọng: NFR-10 và NFR-11–15 trùng lặp với nghĩa khác nhau giữa Epic 4/7 và Universal PRD. |
| **PRD versioning** | ⚠️ 5 PRD tồn tại. `prd.md` (2026-08-19) là bản mới nhất và đầy đủ nhất (có appendix FR-85..88), nên được chọn làm canonical. Các PRD trong `prds/` cần được đánh dấu deprecated hoặc archive nếu không còn dùng. |
| **Cross-references** | ✅ Mỗi PRD có `prd_ref` rõ ràng. Nhưng `prd-XActions-2026-08-14-epic7` kế thừa từ FR-54 mà không định nghĩa FR-54 ở bất kỳ đâu. |
| **Open questions** | ⚠️ Epic 4 vẫn còn blocker `runGuardedBatch` path và `Schedule` model; Epic 7 không còn open question. Universal PRD không liệt kê open questions. |

---

## Step 4: UX Alignment

### UX Documents Found

| File | Type | Scope | Updated |
|---|---|---|---|
| `_bmad-output/planning-artifacts/ux/DESIGN.md` | Visual design tokens + component specs | Unified dashboard (X/Twitter + Facebook) | 2026-06-19 |
| `_bmad-output/planning-artifacts/ux/EXPERIENCE.md` | Information architecture + user flows | Facebook dashboard actions/growth/scrape/monitor | 2026-06-19 |
| `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md` | UX review of architecture spine | Universal hybrid scraping engine | 2026-08-18 |

### UX ↔ PRD Alignment

| PRD Requirement | UX Coverage | Status |
|---|---|---|
| FR-13 / FR-85 — Dashboard/Admin CLI | `EXPERIENCE.md` cover Facebook dashboard nhưng chỉ 4 tab cơ bản (Actions/Growth/Scrape/Monitor). `DESIGN.md` cung cấp tokens/components. | 🟡 Partial |
| FR-68 — Terminal QR Login | `DESIGN.md`/`EXPERIENCE.md` không đề cập QR terminal. `ARCHITECTURE-UX-REVIEW` F2 chỉ ra thiếu non-TTY fallback. | 🟡 Partial |
| FR-69 — CDP Remote Attach | Không có UX doc nào đề cập flow CDP attach (`--launch-chrome`). | 🔴 Missing |
| FR-73 / FR-73B — MCP Daemon 80+ tools | `ARCHITECTURE-UX-REVIEW` F1 chỉ ra thiếu hướng dẫn vận hành daemon (start/status/stop), F5 chỉ ra thiếu action discovery. | 🟡 Partial |
| FR-83 / NFR-17 — Redis Stream metrics | `ARCHITECTURE-UX-REVIEW` F7 yêu cầu dashboard panel cho stream lag/drop. `EXPERIENCE.md` tab Monitor chỉ "Active operations" partial. | 🟡 Partial |
| FR-86 — Metadata Schema Contract | `ARCHITECTURE-UX-REVIEW` F8 chỉ ra `metadata` là "túi đen" với consumer, yêu cầu schema discovery UX. | 🟡 Partial |
| FR-87 — Data Retention / Checkpoints | `ARCHITECTURE-UX-REVIEW` F4 yêu cầu checkpoint visibility (`GET /checkpoints`, dashboard table). Không có trong `EXPERIENCE.md`. | 🟡 Partial |
| NFR-8 / NFR-11 — Account risk warning, observability | `EXPERIENCE.md` có dry-run toggle, result states, warning banner. `ARCHITECTURE-UX-REVIEW` F3 yêu cầu governor status UX. | 🟡 Partial |
| NFR-16 — Backward compatibility `unfollowx` | `ARCHITECTURE-UX-REVIEW` F10 chỉ ra cần map legacy CLI commands sang `CrawlerCommand`. Không có trong `EXPERIENCE.md`. | 🟡 Partial |

### UX ↔ Architecture Alignment

| Architecture Concern | UX Doc Support | Gap |
|---|---|---|
| MCP HTTP/SSE daemon (Port 3001) | `ARCHITECTURE-UX-REVIEW` F1 — thiếu startup/status/stop UX. | Cần CLI command + dashboard tile. |
| Terminal QR (AD-5) | `ARCHITECTURE-UX-REVIEW` F2 — thiếu non-TTY fallback (server/Docker/CI). | Cần URL/short code hoặc push notification. |
| Adaptive Rate Governor (AD-13) | `ARCHITECTURE-UX-REVIEW` F3 — silent throttle/hibernation sẽ gây confusion. | Cần `GET /governor/status`, dashboard/CLI thông báo rõ. |
| CrawlCheckpoint (AD-10/12) | `ARCHITECTURE-UX-REVIEW` F4 — checkpoint hoàn toàn ẩn với user. | Cần checkpoint list + pause/resume/retry UI. |
| Multi-platform action registry (AD-11) | `ARCHITECTURE-UX-REVIEW` F5 — user không biết action nào khả dụng. | Cần `listActions()` + `x_actions_list` tool/CLI. |
| Error taxonomy (AD-9) | `ARCHITECTURE-UX-REVIEW` F6 — lỗi chưa friendly cho AI/operator. | Cần error envelope `{ code, type, message, retryAfter, suggestedAction }`. |
| Redis Stream (AD-7) | `ARCHITECTURE-UX-REVIEW` F7 — thiếu monitoring UI. | Cần metrics panel `eventsPerSecond`, `pendingMessages`, `droppedEvents`. |
| `metadata` JSON (AD-4) | `ARCHITECTURE-UX-REVIEW` F8 — consumer không biết schema. | Cần `x_schema_get` + schema publish UX. |
| Internal Operator Dashboard | `ARCHITECTURE-UX-REVIEW` F9 — chưa định nghĩa dashboard views. | Cần 5 views: Jobs, Proxies, Accounts, Checkpoints, Stream Metrics. |
| Legacy CLI compatibility (AD-2) | `ARCHITECTURE-UX-REVIEW` F10 — người dùng cũ `unfollowx` có thể bị lỗi. | Cần command mapping + actionable error. |

### Warnings

1. **UX docs lỗi thời theo kiến trúc mới.** `DESIGN.md` và `EXPERIENCE.md` được cập nhật 2026-06-19, trước khi Epics 10–20 (hybrid engine) được phê duyệt. Chúng chỉ cover Facebook/X dashboard cũ, không cover admin dashboard, multi-platform CLI, CDP attach, Redis stream metrics.
2. **Thiếu UX cho 4 persona mới trong PRD.** PRD Universal đề cập Nowing AI Platform, SaaS marketers, Developers, AI Agents — nhưng UX docs chỉ tập trung Facebook power-user marketer, không có journey cho operator kỹ thuật hay AI agent.
3. **F3/F4/F7 ảnh hưởng đến NFR-17 (Operational Observability).** PRD yêu cầu metrics SSE/polling và alert, nhưng UX docs chưa định nghĩa alert channel và dashboard layout.
4. **P0 UX gaps từ Architecture UX Review (F3, F5, F6)** nên được bổ sung vào Epic 11/12 trước khi bắt đầu implementation, vì chúng tác động đến MCP/CLI contract và Nowing integration.

---

## Step 5: Epic Quality Review

### Review Scope

- `epics-full.md` — Epics 1–9 (Facebook platform) + Epic 5b/3 Extension/7/8/9.
- `epics.md` — Epics 10–20 (Universal Hybrid Scraping Engine).
- Tiêu chuẩn: create-epics-and-stories best practices (user value, independence, no forward dependencies, story sizing, testable ACs).

### Epic User-Value & Structure Summary

| Epic | Title | User-Value Assessment | Story Count | Main Issues |
|---|---|---|---|---|
| 1 | Facebook Data Reading | ✅ User-centric (scrape FB data) | 5 | Minor: `scrapeTweets` naming mismatch with Twitter. |
| 2 | Facebook Automation | ✅ User-centric (post/like/comment) | 4 | Minor: depends on Epic 1 browser/cookie. |
| 3 | Multi-Surface & Persistence | ⚠️ Technical-ish (CLI/MCP/API) but user value via surfaces | 4 | None major. |
| 4 | Growth Automation | ✅ User-centric (schedule, groups, friends) | 9 | None major. |
| 5 | Messenger Port | ⚠️ Technical (port tool, GraphQL layer) but enables user share | 5 | None major. |
| 5b | Marketplace & Infrastructure | 🟡 Heavily technical (headless, Chrome path) | 4 | Minor: retroactive spec. |
| 6 | Anti-Detection | 🟡 Technical countermeasures; value is implicit (avoid bans) | 17 | **Major:** 13 stories still backlog; velocity controls overlap with Epic 11 governor. |
| 7 | Advanced FB Scraping | ✅ User-centric (multi-type search, parallel) | 4+ | FR-62 deferred; story 7.6 reuses function without signature. |
| 8 | Facebook Backend Reliability | 🔴 **Technical milestone** (DB connection pool, auth token) | 0 backlog | **Critical:** no user outcome; should be PCRs in Epic 3/9. |
| 9 | Live Data & Behavioral Hardening | 🟡 User value is indirect (bug fixes from regression) | 4+ | **Major:** stories are PCR-driven, not user stories. |
| 10 | Unified PostgreSQL Storage & Core Interfaces | 🔴 **Technical foundation epic** | 5 | **Critical:** "Core Developer"/"Backend Engineer" as user; stories 10.1 & 10.2 are setup/implementation, not user stories. |
| 11 | Resilient Network & Proxy Pool | 🟡 Technical infrastructure; value via resilience | 5 | **Major:** story 11.7 (Crawler-Governor Integration) is a cross-cutting contract needed by later epics; if not done, 13–18 cannot run. |
| 12 | Frictionless Authentication | ✅ User-centric (QR, CDP) | 2 | **Major:** 12.2 (CDP attach) is backlog and blocks 18.3. |
| 13 | High-Throughput Hybrid Engine | ✅ User-centric (Twitter/FB refactor) | 3 | **Major:** all stories rely on 10.1/10.2/11.x; not independently completable. |
| 14 | Deep Conversation Scraper, MCP Daemon & Stream | ⚠️ Mixed technical/user; one epic bundles 3 concerns | 3 | **Major:** Epic bundles comment tree, MCP daemon, Redis stream — violates single-focus. |
| 15 | Vietnam Viral Social | ✅ User-centric (Threads/TikTok) | 2 | **Major:** 15.2 depends on 13.1 signer pool; currently no code. |
| 16 | E-Commerce Multi-Platform | ✅ User-centric (Shopee/TikTok Shop) | 2 | **Major:** no code in repo; legacy in Nowing; cross-epic dependencies on 11/13. |
| 17 | Real Estate Intelligence | ✅ User-centric (Chợ Tốt/Batdongsan) | 2 | **Major:** no code in repo; legacy in Nowing. |
| 18 | HR & B2B Recruitment | ✅ User-centric (TopCV/VietnamWorks/LinkedIn) | 3 | **Major:** 18.3 explicitly blocked by 12.2; 18.x no code except maybe LinkedIn legacy. |
| 19 | Internal Operator Dashboard | ✅ User-centric (operator) | 8 | **Major:** 8 stories for one epic; some are API, some CLI, some MCP — could split into 2 epics. |
| 20 | Nowing Cutover | ⚠️ Business/technical migration; user is maintainer | 1 | **Critical:** one story (20.1) is enormous; cannot be independently completed; depends on all 13–18. |

### Dependency Analysis

#### Cross-Epic Backward Dependencies (allowed but risky if prerequisites backlog)

| Dependent | Prerequisite | Risk |
|---|---|---|
| Epic 13/14/15/16/17/18 | Epic 10 (core interfaces, Prisma store) | High — 10.1/10.2 are in progress but DB migration not necessarily merged. |
| Epic 13/15/16/17/18 | Epic 11 (proxy pool, governor, base client) | High — 11.4 is in progress; 11.7 needed by crawlers. |
| Epic 18.3 | Epic 12.2 (CDP attach) | High — 12.2 is backlog, so 18.3 cannot start. |
| Epic 19.1–19.8 | Epic 10.4 (checkpoints), 11.4 (governor) | Medium — admin surface wraps prior work. |
| Epic 20.1 | Epics 13–18 (all hybrid crawlers stable) | High — decommission cannot finish until all platforms work. |

#### Cross-Epic Forward Dependencies (violations)

- **None found** where a lower-numbered epic depends on a higher-numbered epic. However, the architecture explicitly says Epic 11.7 must complete *before* Epics 13–18; this is a schedule dependency, not a forward reference.

#### Within-Epic Dependencies

- `epics-full.md` has an `FR Coverage Map` showing within-epic coverage; no obvious forward references.
- `epics.md` stories are ordered 10.1 → 10.5, 11.1 → 11.7, etc. Generally previous stories enable later ones.
- **Story 11.7** depends on 11.3/11.4 and 10.1 — within-epic + cross-epic; acceptable but must be sequenced after 11.4.

### Story Quality Issues

#### 🔴 Critical Violations

1. **Epic 8 is a pure technical milestone.**
   - Title: "Facebook Backend Reliability"
   - Goal: "Harden backend infrastructure: database connection pooling, MCP error contract, auth token handling."
   - No user outcome; these are PCRs/defects from regression testing, not an epic. **Recommendation:** dissolve into Epics 3/9 as defect stories.

2. **Epic 10 contains technical "As a Core Developer" stories.**
   - Story 10.1: "As a Core Developer, I want to define abstract classes..."
   - Story 10.2: "As a Backend & Platform Engineer, I want to extend Prisma schema..."
   - These are technical setup/implementation, not user stories. **Recommendation:** rewrite with user value (e.g., "As a Data Scientist, I want data stored consistently...") or split Epic 10 into "Core Contracts" and "Storage" foundation epics, clearly marked as enablers.

3. **Epic 20.1 is an epic-sized story.**
   - Title: "Nowing Daemon Client Cutover & Legacy Scrapers Decommissioning"
   - ACs require all hybrid crawlers (Epics 13–18) to be stable and Nowing repo to be updated, then delete 20+ scrapers and dependencies.
   - Cannot be independently completed. **Recommendation:** split into shadow-run, adapter rewrite, dependency removal, Docker image cleanup, validation.

#### 🟠 Major Issues

1. **Epic 14 bundles 3 unrelated concerns.**
   - Deep conversation scraper, MCP daemon, and Redis stream ingest are all in one epic. Each could be its own epic.
   - Story 14.2 is especially large (MCP daemon + 80+ tools + HTTP/SSE).

2. **Epic 19 has 8 stories covering UI, CLI, REST, MCP.**
   - Could split into Epic 19a (Dashboard UI) and Epic 19b (Admin CLI/MCP).

3. **Anti-Detection (Epic 6) overlaps with Epic 11 governor/proxy controls.**
   - FR40–54 (fingerprint, behavioral simulation, velocity limits) partially duplicate NFR-13/NFR-11 in Epic 11.

4. **Many scraper epics (15–18) have no code in repo and depend on Nowing legacy or earlier epics.**
   - These are ports, not greenfield; each is essentially a migration epic and should explicitly include a "port from Nowing" story.

5. **Epic 7 PRD FR-62 is deferred but still listed; epic scope excludes it without clear traceability.**

#### 🟡 Minor Concerns

1. **Story naming inconsistency:** some use `scrapeTweets` for Facebook (Epic 1) — leftover from Twitter.
2. **Status emojis and terminology differ** between `epics-full.md` and `epics.md` (✅ Done vs. ✅ done, 🆕 backlog vs. 🔴 Backlog).
3. **Epic 5b** is labeled "retroactive spec" — a sign that it was added after implementation.
4. **Missing per-story AC in many Epic 6 backlog items** (only titles/FRs, no Given/When/Then).

### Best Practices Compliance Checklist

| Criterion | Score | Notes |
|---|---|---|
| Epics deliver user value | 🟡 | Epics 8, 10, 11, 20 are technical/business-value; need reframing. |
| Epics function independently | 🟡 | No forward references, but many cross-epic dependencies. |
| Stories appropriately sized | 🟡 | Stories 20.1, 14.2, 13.1, 11.7 are large. |
| No forward dependencies | ✅ | No Epic N requires Epic N+1. |
| Database tables created when needed | 🟡 | Epic 10.2 creates all core tables; justified for foundation but violates incremental rule. |
| Clear acceptance criteria | 🟡 | Most have G/W/T; Epic 6 backlog items lack ACs. |
| Traceability to FRs | ✅ | `epics-full.md` has FR Coverage Map; `epics.md` Requirements Inventory maps FR64–88. |

### Remediation Recommendations

1. **Refactor or reframe Epic 8 and Epic 10** to deliver user value, or move them to a dedicated "Foundation/Architecture" track with non-user stories clearly marked as enablers.
2. **Split Epic 20.1** into smaller, independently completable stories.
3. **Add explicit dependency/sequence notes** in `epics.md` for Epics 13–18 needing 10.1/10.2/11.3/11.4/11.7.
4. **Resolve CDP attach (12.2) before scheduling LinkedIn (18.3)**.
5. **Remove or properly defer FR-62** from Epic 7 PRD and update traceability.

---

## Step 6: Final Assessment

### Overall Readiness Status

**🟡 NEEDS WORK — not ready for Phase 4 implementation as-is.**

Mặc dù tài liệu đã phong phú và hầu hết FR/NFR được traceability, có 5 nhóm vấn đề nghiêm trọng cần giải quyết trước khi bắt đầu implementation quy mô lớn:

1. **PRD canonical chưa được chọn và NFR/FR numbering conflicts.**
2. **Epic 8, Epic 10, và Story 20.1 là technical milestones / epic-sized stories**, vi phạm create-epics-and-stories best practices.
3. **Nhiều cross-epic dependencies chưa rõ ràng**: Epics 13–18 cần 10.1/10.2/11.3/11.4/11.7; 18.3 bị block bởi 12.2; 20.1 phụ thuộc toàn bộ 13–18.
4. **UX docs lỗi thời và thiếu góc nhìn mới**: admin dashboard, MCP daemon, CDP attach, stream metrics, metadata schema, AI/operator persona chưa có UX.
5. **Architecture tồn tại cả dạng whole (`architecture.md`) và sharded (`ARCHITECTURE-SPINE.md`)**, chưa chọn canonical.

### Critical Issues Requiring Immediate Action

1. **Chọn PRD canonical:** `prd.md` (2026-08-19) là bản mới nhất. Đánh dấu các PRD trong `prds/` là deprecated hoặc archive.
2. **Giải quyết FR/NFR numbering conflicts:** Re-number hoặc prefix (e.g., `NFR-E7-10` vs `NFR-U-10`) để tránh xung đột.
3. **Viết PRD cho FR-24..FR-54** (Epics 5b–6) hoặc gộp vào PRD canonical; đảm bảo mọi FR trong `epics-full.md` có nguồn PRD.
4. **Tái cấu trúc Epic 8 / Epic 10 / Story 20.1** thành user stories nhỏ hơn hoặc chuyển sang foundation track.
5. **Hoàn thành 12.2 (CDP Remote Attach) trước khi lập lịch 18.3 (LinkedIn)**.
6. **Chọn architecture canonical** và cập nhật ADR/UX review findings thành story/epic cụ thể.

### Recommended Next Steps

1. **Tổ chức review meeting** với John (PM), Winston (Architect), Sally (UX) để chốt PRD/Architecture/UX canonical và xử lý FR-24..54.
2. **Tạo `project-context.md`** và `_bmad/bmm/config.yaml` để AI agents có persistent context.
3. **Split/refactor Epic 8, 10, 20** theo create-epics-and-stories standards.
4. **Bổ sung UX stories** cho MCP daemon, CDP attach, governor status, checkpoint visibility, metadata schema, admin dashboard, AI agent flows.
5. **Cập nhật `epics.md` dependency map** với rõ ràng prerequisites cho mỗi epic.
6. **Chạy lại Implementation Readiness** sau khi critical issues được giải quyết.

### Final Note

This assessment identified **21+ issues** across **6 categories**: PRD versioning, FR/NFR numbering, epic quality, dependencies, UX alignment, and architecture consolidation. Address the critical issues before proceeding to implementation. These findings can be used to improve the artifacts or you may choose to proceed as-is with accepted risks.

**Assessor:** BMad Product Manager (AI facilitator)  
**Date:** 2026-08-21

### UX Alignment Assessment

| Criterion | Finding |
|---|---|
| **UX docs existence** | ✅ Tìm thấy 3 tài liệu UX. |
| **UX ↔ PRD alignment** | 🟡 Cơ bản khớp với Facebook dashboard cũ; thiếu coverage cho hybrid engine, admin dashboard, CDP, MCP daemon, stream metrics, metadata schema. |
| **UX ↔ Architecture alignment** | 🟡 `ARCHITECTURE-UX-REVIEW` là cầu nối tốt nhưng 10 findings chưa được chuyển thành epic/story cụ thể. F3/F5/F6 là P0 và cần thêm story trong Epic 11/12. |
| **UX for new personas** | 🔴 Không có journey/screen cho AI Agent, Operator, Nowing consumer. |
| **Accessibility** | ✅ `EXPERIENCE.md` có accessibility floor (keyboard, ARIA, color+icon, focus, aria-live). |
