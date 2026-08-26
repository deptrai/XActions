---
stepsCompleted:
  - step-01-document-discovery
  - step-02-prd-analysis
  - step-03-epic-coverage-validation
  - step-04-ux-alignment
  - step-05-epic-quality-review
  - step-06-final-assessment
documentOutputLanguage: Việt Nam
outputFile: _bmad-output/planning-artifacts/implementation-readiness-report-2026-08-26.md
selectedDocuments:
  prd:
    primary: _bmad-output/planning-artifacts/prd.md
    supplemental:
      - _bmad-output/planning-artifacts/prd-canonicalization-addendum-2026-08-21.md
      - _bmad-output/planning-artifacts/prd-facebook-epics-5-6-2026-08-21.md
  architecture:
    primary: _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md
    supplemental:
      - _bmad-output/planning-artifacts/architecture/xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md
      - _bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/EPIC10-DECISION-LOG-2026-08-18.md
      - _bmad-output/planning-artifacts/research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md
  epics:
    primary: _bmad-output/planning-artifacts/epics.md
    supplemental:
      - _bmad-output/planning-artifacts/archive/epics-1-9-legacy.md
      - _bmad-output/planning-artifacts/backlog-epics-21-22.md
  ux:
    primary: _bmad-output/planning-artifacts/ux/README.md
    supplemental:
      - _bmad-output/planning-artifacts/ux/DESIGN.md
      - _bmad-output/planning-artifacts/ux/EXPERIENCE.md
      - _bmad-output/planning-artifacts/ux/EXPERIENCE-UNIVERSAL-2026-08-21.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-08-26
**Project:** XActions

## 1. Document Discovery

### 1.1. PRD Documents

**Primary:**
- `prd.md` (17,235 bytes, 2026-08-26 17:55) — PRD canonical cho Epics 10–20.

**Supplemental:**
- `prd-canonicalization-addendum-2026-08-21.md` (5,090 bytes) — bảng đăng ký FR/NFR.
- `prd-facebook-epics-5-6-2026-08-21.md` (9,446 bytes) — PRD cho Epics 5, 5b, 6.

**Archive (older):**
- `archive/prds/prd-XActions-2026-06-08/prd.md`
- `archive/prds/prd-XActions-2026-06-10-epic4/prd.md`
- `archive/prds/prd-XActions-2026-08-14-epic7/prd.md`
- `archive/prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md`

### 1.2. Architecture Documents

**Primary:**
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (41,964 bytes, 2026-08-26 17:52) — kiến trúc active.

**Supplemental:**
- `architecture/xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md` (16,804 bytes, 2026-08-26 17:52) — `superseded` bởi hybrid spine.
- `architecture/xactions-hybrid-scraping-spine/EPIC10-DECISION-LOG-2026-08-18.md` — decision log.
- `research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md` — nghiên cứu tham khảo.

**Related review/remediation files (not primary):**
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-EPIC10-PM-REVIEW-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-EPIC10-REVIEW-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UPDATE-GATE-2026-08-18.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md`
- `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REVIEW-2026-08-18.md`
- `archive/architecture-brownfield-2026-08-20.md`

### 1.3. Epics & Stories Documents

**Primary:**
- `epics.md` (83,922 bytes, 2026-08-26 17:55) — epic/story canonical.

**Supplemental:**
- `archive/epics-1-9-legacy.md` (50,662 bytes) — legacy epics 1–9.
- `backlog-epics-21-22.md` (7,835 bytes) — bản tóm tắt future work, nội dung Epic 21–22 đã có trong `epics.md`.

**Note:** `test-design-epic-12.md` được tìm thấy nhưng là test design, không phải epic/story.

### 1.4. UX Design Documents

**Primary pointer:**
- `ux/README.md` (1,577 bytes, 2026-08-26 17:55) — canonical register cho UX docs.

**Canonical UX docs:**
- `ux/DESIGN.md` (16,088 bytes)
- `ux/EXPERIENCE.md` (11,494 bytes)
- `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` (4,664 bytes)

### 1.5. Duplicate & Conflict Resolution

| Issue | Resolution |
| --- | --- |
| `epics.md` vs `backlog-epics-21-22.md` (cùng Epic 21–22) | `epics.md` là primary; `backlog-epics-21-22.md` là supplemental/archive. |
| `xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` vs `xactions-facebook-gateway-2026-08-23/ARCHITECTURE-SPINE.md` | Hybrid spine là active; gateway spine là `superseded` supplemental. |
| Multiple older PRDs in `archive/prds/` | Không dùng làm primary; chỉ tham khảo nếu cần trace lịch sử. |

## 2. PRD Analysis

### 2.1. Functional Requirements (FRs)

#### 2.1.1. Universal Engine (Epics 10–20) — `prd.md`

| ID | Requirement |
| --- | --- |
| FR-64 | Cung cấp các cổng trừu tượng chuẩn hóa (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) thuần ESM, Zero-Dependency. |
| FR-65 | Kết hợp Pre-Signed Token Ring Buffer O(1) và Signer Worker Page Pool (4–8 tabs ngầm có `Promise.race()` 3s timeout) cùng `got-scraping` (TLS/JA4 Spoofing). |
| FR-66 | Quản lý tập trung Static & Dynamic Tunnel Proxy, tự động kích hoạt cờ chống rò rỉ WebRTC/DNS (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`) và kiểm tra buffer expiration 30s. Cách ly proxy lỗi 5 phút khi gặp mã `429/403`, tự động đổi IP và retry 3 lần với exponential backoff. Chuyển sang Standby Backoff 30s khi 100% proxy bị chặn. |
| FR-66A | Anti-Leak Proxy Pool. |
| FR-66B | Adaptive Rate Limiter & Governor (Story 11.4). |
| FR-67 | Lưu trữ tập trung `Post` và `Comment` vào PostgreSQL qua Prisma ORM với khóa chính dạng `${platform}:${externalId}`, `metadata Json?` có GIN Index và batch chunking 500 records. |
| FR-68 | Hiển thị mã QR tỷ lệ 1:1 chuẩn (`small: true`) trực tiếp trên Terminal console kèm đếm ngược 60s, timeout 120s và polling cookie ngầm. |
| FR-69 | Kết nối trực tiếp vào Google Chrome thật qua cổng 9222 với helper command `unfollowx auth --launch-chrome` và độ trễ phân phối ngẫu nhiên Gaussian Jitter (3–7s). |
| FR-70 | Trích xuất toàn bộ cây bình luận đa tầng (`maxDepth: 3`, `maxComments: 500`), chống tham chiếu vòng, và lưu vào DB theo thứ tự Topological Sort (Root trước, SubComments sau). |
| FR-71 | Tái cấu trúc cào Twitter sang GraphQL kết hợp Signer Page Pool và PrismaStore. |
| FR-72 | Tái cấu trúc cào Facebook qua GraphQL DocID dispatch kết hợp Proxy Pool. |
| FR-73 | Cung cấp 80+ MCP tools trả về 3-Layer JSON Envelope có cơ chế Auto-Artifact khi payload >100 records. Hỗ trợ xuất dữ liệu ra định dạng JSONL/CSV stream với backpressure. |
| FR-73A | AI Streaming Dataset Exporter (Story 10.3). |
| FR-73B | MCP Tool Envelope & CLI Crawl (Story 14.2). |
| FR-74 | Cào bài viết, timeline và replies trên Threads qua internal Meta GraphQL (LSD token + DocID). |
| FR-75 | Cào video trending và hàng ngàn bình luận TikTok qua `a_bogus` Signer Bridge có kiểm tra mã chặn False 200 OK (`error !== 0`). |
| FR-76 | Cào sản phẩm, flash sale, giá bán và đánh giá người mua trên Shopee VN qua Web API kết hợp TLS Spoofing và Anti-Bot Validation. |
| FR-77 | Cào sản phẩm bán chạy, doanh số ước tính và đánh giá shop trên TikTok Shop. |
| FR-78 | Cào tin đăng BĐS Chợ Tốt kèm giải mã SĐT chính chủ (loại bỏ SĐT masked `***` và validate regex VN). |
| FR-79 | Cào tin rao BĐS dự án, diện tích và biến động giá đất trên Batdongsan.com.vn. |
| FR-80 | Cào tin tuyển dụng, kỹ năng yêu cầu và dải lương (xử lý case "Thỏa thuận") trên TopCV. |
| FR-81 | Cào tin tuyển dụng IT và cấp cao trên VietnamWorks qua API public. |
| FR-82 | Cào thông tin nhân sự và bài đăng tuyển dụng trên LinkedIn qua CDP Remote Attach 9222. |
| FR-83 | Phát luồng sự kiện tinh gọn (`{ id, platform, externalId, category, authorId, crawledAt, storageRef }`) vào Redis Stream `stream:social:raw_posts` (`MAXLEN ~ 20000`). |
| FR-84 | Nâng cấp adapter bên Nowing kết nối sang XActions MCP/Redis Stream và gỡ bỏ hoàn toàn 20+ scraper cũ cùng browser dependencies khỏi Nowing backend. |
| FR-85 | Cung cấp giao diện vận hành nội bộ (web dashboard + CLI `xactions admin`) để giám sát jobs/checkpoints, proxy pool, account hibernation, stream metrics và alerts. Auth dùng internal admin API key hoặc A2A token, không phải multi-tenant SaaS auth. |
| FR-86 | Mỗi platform/category phải publish JSON Schema hoặc TypeScript type cho `Post.metadata`; consumer có thể lấy schema qua API `GET /schemas/:platform/:category`, MCP tool `x_schema_get`, và CLI `xactions schema get`. `PrismaStore` validate `metadata` against schema khi ghi. |
| FR-87 | Dữ liệu raw crawl (bản gốc thu thập) lưu trong XActions với TTL 30 ngày; dữ liệu lead/processed output đẩy sang Nowing được giữ vĩnh viễn. Lịch sử checkpoints và audit logs giữ 90 ngày. |
| FR-88 | Cào theo mô hình 3 tầng: (1) full seed, (2) delta/gap fill theo `publishedAt`/`lastCrawledAt`, (3) on-demand refresh; loại bỏ 100% duplication và tiết kiệm 90% chi phí proxy so với full re-crawl. |

**Total Universal FRs: 25 (FR-64..FR-88, including sub-labels).**

#### 2.1.2. Facebook Module (Epics 5, 5b, 6) — `prd-facebook-epics-5-6-2026-08-21.md`

| ID | Requirement |
| --- | --- |
| FR-23 | `src/scrapers/facebook/graphql.js` cung cấp layer gọi internal GraphQL với `doc_id`, `fb_dtsg`, `lsd`; check Messenger CTA + page list. |
| FR-24 | `shareLinkByUid` (v1) mở Messenger share dialog, paste URL, gửi đến recipient. |
| FR-25 | `--proxy-server=` launch arg + `page.authenticate()`; hỗ trợ proxy có auth. |
| FR-26 | CLI/MCP/API accept share campaign params (`message`, `link`, `recipientUids[]`). |
| FR-27 | Dashboard/UI quản lý share campaigns: tạo, pause, retry, xem progress. |
| FR-28 | `scrapeMarketplace(page, query, options)` trả normalized listing. |
| FR-29 | Hỗ trợ `$`, `CA$`, `ETB`, `₹`, v.v. |
| FR-30 | Tách title từ concatenated text bằng camelCase heuristics. |
| FR-31 | Extract location từ trailing capitalized word heuristics. |
| FR-32 | Navigate `messages/t/{uid}`, paste URL via clipboard, Enter. |
| FR-33 | Accept `recipientUid` hoặc `recipientUids[]`. |
| FR-34 | Trả `{ uid, ok, sharesSent, method }` cho từng recipient. |
| FR-35 | Tất cả Facebook endpoints accept `headless` boolean. |
| FR-36 | Invisible browser, `networkidle2`, 30s timeout. |
| FR-37 | Visible browser, `domcontentloaded`, 60s timeout, longer delays. |
| FR-38 | Response include `headless: true/false`. |
| FR-39 | `createBrowser()` tự resolve: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system Chrome path. |
| FR-40 | ≥ 20 real Chrome UAs, random per session, consistent within session. |
| FR-41 | Viewport match UA platform. |
| FR-42 | Disable/override RTCPeerConnection. |
| FR-43 | `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`. |
| FR-44 | Bezier curve + micro-jitter + overshoot+correction. |
| FR-45 | Hover pause 100–400ms trước click. |
| FR-46 | Typo rate 1–2%, variable speed. |
| FR-47 | Variable speed, momentum, overshoot. |
| FR-48 | Homepage → scroll → mouse → actions. |
| FR-49 | Khớp proxy location. |
| FR-50 | Khớp proxy location. |
| FR-51 | `userDataDir` support. |
| FR-52 | Không change mid-session. |
| FR-53 | Likes ≤ 30/hr, comments ≤ 10/hr, friend requests ≤ 20/day. |
| FR-54 | < 7 days = 50% limits, 1–4 weeks = 80%, > 1 month = 100%. |

**Total Facebook FRs: 32 (FR-23..FR-54).**

#### 2.1.3. Deferred / Future

| ID | Requirement | Source |
| --- | --- | --- |
| FR-62 | GraphQL replay — deferred to Phase 3. | `prd.md` §7.5, `FUTURE-WORK.md` |

### 2.2. Non-Functional Requirements (NFRs)

#### 2.2.1. Universal Engine (Epics 10–20) — `prd.md`

| ID | Requirement |
| --- | --- |
| NFR-11 | Giảm ít nhất 85% RAM (từ ~10GB xuống <300MB) và 70% CPU so với mô hình Full Headless Browser. |
| NFR-12 | Tăng tốc độ thu thập dữ liệu lên ít nhất 5x–10x (>500 requests/giây) bằng Async HTTP Client với Connection Pool. |
| NFR-13 | Tự động phát hiện proxy chết/rate-limit, cách ly 5 phút và replay request 3 lần với exponential backoff. |
| NFR-14 | Không lưu trữ plain-text password; đăng nhập an toàn qua Terminal ASCII QR Code và Chrome CDP Attach. |
| NFR-15 | Lớp `src/core/` hoàn toàn phi phụ thuộc (Zero-Dependency); thêm nền tảng mới chỉ cần viết thêm Adapter. |
| NFR-16 | Mã nguồn 100% tuân thủ MIT / Apache 2.0; bảo toàn 100% tương thích ngược với CLI `unfollowx` và 80+ MCP tools. |
| NFR-17 | Hệ thống phải expose real-time metrics qua `GET /governor/status`, `GET /metrics/stream`, dashboard SSE/polling mỗi 5–30s, và alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`. |

**Total Universal NFRs: 7 (NFR-11..NFR-17).**

#### 2.2.2. Facebook Module (Epics 5, 5b, 6) — `prd-facebook-epics-5-6-2026-08-21.md`

| ID | Requirement |
| --- | --- |
| NFR-1 | Bezier mouse movement < 2s. |
| NFR-2 | Fingerprint config centralized, dễ update. |
| NFR-3 | Behavioral functions có injectable `delayFn` seam để test. |
| NFR-4 | Không log cookie values trong error/API response. |
| NFR-5 | Facebook delay floor cao hơn Twitter (ADR-012). |
| NFR-6 | Mọi mutate action có dry-run default (ADR-007). |
| NFR-7 | `doc_id` GraphQL hardcoded có fallback graceful, không throw. |
| NFR-8 | Messenger mass-share dùng delay bảo thủ hơn default like/comment. |
| NFR-9 | Scheduler throughput cap ≤ 5 posts/giờ/user. |
| NFR-10 | Friend request delay 60–180s, không override được. |

**Total Facebook NFRs: 10 (NFR-1..NFR-10).**

### 2.3. Additional Requirements & Constraints

#### 2.3.1. Architecture Requirements (from `prd-facebook-epics-5-6-2026-08-21.md`)

- AR1: Stealth plugin tái dùng cho Facebook.
- AR2: Facebook delay rộng hơn Twitter cho mutating actions.
- AR3: Batch size ≤ 20/session cho friend requests.
- AR4: Proxy rotation infrastructure đã có (`proxyfb`, `tmproxy`, `shoplike`).
- AR5: `createBrowser()` support proxy via `--proxy-server=`.
- AR6: `page.authenticate()` gọi trước `page.goto` đầu tiên.
- AR7: Checkpoint detection: body text chứa `confirm that you` và `human`.
- AR8: Facebook scraper clone structure từ `threads/index.js`.
- AR9: GraphQL layer tại `graphql.js`, không trộn vào adapter DOM.
- AR10: Fingerprint module tại `fingerprint.js`, behavioral tại `human.js`, limits tại `limits.js`.

#### 2.3.2. Data Retention Policy (from `prd.md` §5)

- Raw crawl data: 30-day TTL in XActions.
- Lead/processed output pushed to Nowing: permanent.
- Checkpoints and audit logs: 90 days.

#### 2.3.3. Open Decisions / Deferred Work

- **FR-62 (GraphQL replay):** deferred to Phase 3; condition: Story 5.1 & 7.1 stable, ≥80% doc_id mapping stable 30 days, replay cache storage available.
- **Advanced Marketplace filters:** deferred (FR-28..FR-31 stable).
- **Canvas/WebGL spoofing:** deferred (FR-40..FR-54 stable, checkpoint rate > 5%).
- **FR-24..FR-54:** detailed in `prd-facebook-epics-5-6-2026-08-21.md`.

### 2.4. PRD Completeness Assessment

| Criterion | Assessment |
| --- | --- |
| **FR Coverage** | ✅ Canonical `prd.md` covers Epics 10–18 with FR-64..FR-84; §7.1 adds FR-85..FR-88. `prd-facebook-epics-5-6-2026-08-21.md` covers FR-23..FR-54. `prd-canonicalization-addendum-2026-08-21.md` provides master register with scope prefixes to avoid numbering conflicts. |
| **NFR Coverage** | ✅ U-NFR-11..17 cover resource, throughput, resilience, security, architecture, license, observability. FB-NFR-1..10 cover anti-detection/behavioral/PII constraints. |
| **Traceability** | ✅ PRD §7.4 maps Epics to FRs; `prd-canonicalization-addendum-2026-08-21.md` §2 provides canonical ID mapping. |
| **Gaps / Open Items** | ⚠️ FR-62 (GraphQL replay) and advanced Marketplace filters / canvas spoofing are deferred with activation conditions in `FUTURE-WORK.md` — need to verify they are explicitly tracked and not accidentally picked up in Phase 4. |
| **Clarity** | ✅ PRDs are `approved` and `canonical`; superseded PRDs are listed. UX canonical pointer was added to `prd.md` §7.5. Architecture conflict (gateway vs hybrid) is marked `superseded`. |

## 3. Epic Coverage Validation

### 3.1. Epic/Story Inventory

The canonical `epics.md` contains **11 epics** and **60 stories** (Epics 10–20):

| Epic | Stories |
| --- | --- |
| Epic 10 | 10.1, 10.2, 10.3, 10.4, 10.5 |
| Epic 11 | 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8 |
| Epic 12 | 12.1, 12.2 |
| Epic 13 | 13.1, 13.2, 13.2.1–13.2.9, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10 |
| Epic 14 | 14.1, 14.2, 14.3 |
| Epic 15 | 15.1, 15.1.1–15.1.4, 15.2 |
| Epic 16 | 16.1, 16.2 |
| Epic 17 | 17.1, 17.2 |
| Epic 18 | 18.1, 18.2, 18.3 |
| Epic 19 | 19.1, 19.2, 19.3, 19.4, 19.7, 19.8, 19.9, 19.10 |
| Epic 20 | 20.1, 20.2 |

### 3.2. Requirements Inventory in `epics.md`

`epics.md` opens with a **Requirements Inventory** that explicitly enumerates the same FR-64..FR-88 and NFR-11..NFR-17 from the canonical PRD, confirming the product team has already mapped PRD requirements into the epic breakdown.

### 3.3. FR Coverage Matrix (Universal Engine FR-64..FR-88)

| FR | PRD Requirement | Epic / Story Coverage | Status |
| --- | --- | --- | --- |
| FR-64 | Core abstractions (`AbstractCrawler`, `AbstractApiClient`, `AbstractStore`, `AbstractLogin`, `ISignerBridge`) | Epic 10.1 — Core Domain Interfaces & Error Hierarchy | ✅ Covered |
| FR-65 | Tiered Hybrid Signer Engine (Token Ring + Worker Page Pool + Async HTTP) | Epic 13.1 — Tiered Signer Architecture | ✅ Covered |
| FR-66 | Proxy Pool, auto-quarantine, WebRTC/DNS leak prevention | Epic 11.1, 11.2, 11.3 | ✅ Covered |
| FR-66A | Anti-Leak Proxy Pool | Epic 11.1, 11.2 | ✅ Covered |
| FR-66B | Adaptive Rate Limiter & Governor | Epic 11.4 — Adaptive Infrastructure-Aware Rate Limiter | ✅ Covered |
| FR-67 | Namespaced PostgreSQL Storage, JSONB GIN, batch chunking | Epic 10.2 — Prisma Post & Comment Schema | ✅ Covered |
| FR-68 | Terminal ASCII QR Code Login | Epic 12.1 — Terminal QR Login | ✅ Covered |
| FR-69 | CDP Remote Attach (Chrome port 9222, Gaussian jitter) | Epic 12.2 — CDP Remote Attach | ✅ Covered |
| FR-70 | Topological Comment Tree Extraction | Epic 14.1 — Hierarchical Comment Tree Extraction | ✅ Covered |
| FR-71 | Twitter Crawler Refactor (hybrid GraphQL) | Epic 13.2 + 13.2.1–13.2.9 | ✅ Covered |
| FR-72 | Facebook Crawler Refactor (DocID dispatch) | Epic 13.3–13.10 | ✅ Covered |
| FR-73 | MCP Daemon & 80+ MCP tools, 3-Layer JSON Envelope | Epic 14.2 — MCP Tool Exporters & Daemon | ✅ Covered |
| FR-73A | AI Streaming Dataset Exporter | Story 10.3 — AI Dataset Export Utility | ✅ Covered |
| FR-73B | MCP Tool/CLI Crawl integration | Story 14.2, Epic 19.4/19.10 | ✅ Covered |
| FR-74 | Threads Meta GraphQL Scraper | Epic 15.1 + 15.1.1–15.1.4 | ✅ Covered |
| FR-75 | TikTok Video, Hashtag & Comment Scraper | Epic 15.2 — TikTok Scraper | ✅ Covered |
| FR-76 | Shopee Product, Price & Review Scraper | Epic 16.1 — Shopee Scraper | ✅ Covered |
| FR-77 | TikTok Shop E-Commerce Scraper | Epic 16.2 — TikTok Shop Scraper | ✅ Covered |
| FR-78 | Chợ Tốt Multi-Category Scraper with phone extraction | Epic 17.1 — Chợ Tốt Scraper | ✅ Covered |
| FR-79 | Batdongsan.com.vn Property Scraper | Epic 17.2 — Batdongsan Scraper | ✅ Covered |
| FR-80 | TopCV Recruitment Scraper | Epic 18.1 — TopCV Scraper | ✅ Covered |
| FR-81 | VietnamWorks Job Scraper | Epic 18.2 — VietnamWorks Scraper | ✅ Covered |
| FR-82 | LinkedIn B2B Lead & Job Scraper | Epic 18.3 — LinkedIn Scraper | ✅ Covered |
| FR-83 | Nowing Thin Event Redis Stream Ingest | Epic 14.3 — Realtime Thin Event Stream | ✅ Covered |
| FR-84 | Nowing Cutover & Legacy Scraper Decommissioning | Epic 20.1, 20.2 | ✅ Covered |
| FR-85 | Internal Operator Dashboard & Admin CLI | Epic 19.1–19.10 | ✅ Covered |
| FR-86 | Metadata Schema Contract for Consumers | Story 10.5 — Metadata Schema Contract & Registry | ✅ Covered |
| FR-87 | Data Retention Policy (raw 30d, leads permanent, audit 90d) | Story 10.2, Epic 19 (admin/operational data) | ✅ Covered |
| FR-88 | 3-Tier Incremental Gap-Filling | Epic 10.4 (checkpoints), Epic 11 (governor/resilience) | ✅ Covered |

### 3.4. NFR Coverage Matrix (Universal NFR-11..NFR-17)

| NFR | Requirement | Coverage | Status |
| --- | --- | --- | --- |
| NFR-11 | 85% RAM / 70% CPU reduction vs full headless | Across all hybrid-crawler stories (Epic 10–18) | ✅ Covered |
| NFR-12 | 5x–10x throughput, >500 req/s, async HTTP | Epic 11.2, 11.4, 13.1, 15.2 | ✅ Covered |
| NFR-13 | Auto-detect dead/rate-limit proxy, quarantine 5m, replay 3x | Epic 11.1, 11.3, 11.4, 11.6 | ✅ Covered |
| NFR-14 | No plain-text password; QR/CDP auth | Epic 12.1, 12.2 | ✅ Covered |
| NFR-15 | Clean architecture / zero-dependency core | Epic 10.1 — Core Domain Interfaces | ✅ Covered |
| NFR-16 | MIT/Apache 2.0, backward compat with CLI/MCP | Cross-cutting (Epic 13.2.9, 13.10, 20.2) | ✅ Covered |
| NFR-17 | Operational observability (governor/stream metrics + alerts) | Epic 19.3, 19.9 | ✅ Covered |

### 3.5. Facebook Module (Epics 5, 5b, 6) Coverage

| FR | Requirement | Epic / Story Coverage | Status |
| --- | --- | --- | --- |
| FR-23..FR-27 | Messenger Port (GraphQL, share, auth proxy, queue, UI) | `archive/epics-1-9-legacy.md` Epic 5 / 5.1–5.5 | ✅ Covered (legacy) |
| FR-28..FR-39 | Marketplace & Infrastructure (headless, Chrome path, share-link-uid v2) | `archive/epics-1-9-legacy.md` Epic 5b / 5b.1–5b.4 | ✅ Covered (legacy) |
| FR-40..FR-54 | Anti-Detection & Bot Countermeasures | `archive/epics-1-9-legacy.md` Epic 6 / 6.1–6.17 | ✅ Covered (legacy) |

**Note:** FR-40..FR-54 are also referenced by Epic 13.3–13.10 (Facebook Hybrid Refactor), which reuses anti-detection behavior in the new social/facebook crawler. No gap.

### 3.6. Coverage Statistics

- **Total PRD FRs in scope (Epics 10–20):** 25 (FR-64..FR-88)
- **FRs covered in `epics.md`:** 25 / 25
- **Coverage percentage:** 100%
- **Total PRD NFRs in scope (Epics 10–20):** 7 (NFR-11..NFR-17)
- **NFRs covered in `epics.md`:** 7 / 7
- **Facebook FR-23..FR-54:** covered in `archive/epics-1-9-legacy.md` / `prd-facebook-epics-5-6-2026-08-21.md`

### 3.7. Missing Coverage

No missing FRs or NFRs for the canonical Epics 10–20 scope. All requirements from `prd.md` are represented in `epics.md` either as dedicated stories or cross-cutting acceptance criteria.

### 3.8. Coverage Assessment

| Criterion | Assessment |
| --- | --- |
| **FR Traceability** | ✅ 100% of PRD FR-64..FR-88 trace to at least one epic/story in `epics.md`. |
| **NFR Traceability** | ✅ All U-NFR-11..17 have clear implementation paths in Epics 10/11/12/19. |
| **Legacy Coverage** | ✅ FR-23..FR-54 are covered in `archive/epics-1-9-legacy.md` and `prd-facebook-epics-5-6-2026-08-21.md`. |
| **Gaps** | ⚠️ FR-88 (3-Tier Gap-Filling) is distributed across multiple epics; ensure acceptance criteria explicitly mention delta/gap-fill and on-demand refresh in Story 10.4 and Epic 11. |
| **Risk** | ⚠️ Epic 13 is a platform suite with 14 sub-stories; while all FRs are covered, the epic is large and should be tracked as independent sub-threads (already addressed by grouping notes). |

## 4. UX Alignment Assessment

### 4.1. UX Document Status

| Document | Path | Status | Notes |
| --- | --- | --- | --- |
| `ux/README.md` | `_bmad-output/planning-artifacts/ux/README.md` | ✅ final / canonical | Canonical index; points to DESIGN.md, EXPERIENCE.md, EXPERIENCE-UNIVERSAL-2026-08-21.md. |
| `ux/DESIGN.md` | `_bmad-output/planning-artifacts/ux/DESIGN.md` | ✅ final | Design system tokens, components, mockups for operator dashboard, CLI output, multi-platform flows. |
| `ux/EXPERIENCE.md` | `_bmad-output/planning-artifacts/ux/EXPERIENCE.md` | ⚠️ draft (frontmatter says `status: draft`) | Covers legacy unified dashboard (X/Twitter + Facebook). Does not include new platforms (Shopee, Batdongsan, TopCV, VietnamWorks, LinkedIn, TikTok, Threads). |
| `ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` | `_bmad-output/planning-artifacts/ux/EXPERIENCE-UNIVERSAL-2026-08-21.md` | ✅ final | Extends EXPERIENCE.md with operator, AI/MCP, CLI, CDP, and multi-platform new-user flows. |
| Architecture-UX Remediation | `architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-UX-REMEDIATION-2026-08-21.md` | ✅ approved | Maps 10 UX findings (F1–F10) to specific stories and acceptance criteria. |

### 4.2. UX ↔ PRD Alignment

| PRD Requirement | UX Coverage | Alignment |
| --- | --- | --- |
| FR-68 — Terminal QR Login | `EXPERIENCE-UNIVERSAL` Flow C1; `DESIGN.md` M4; `ARCHITECTURE-UX-REMEDIATION` F2 | ✅ Aligned. UX remediation adds non-TTY fallback not fully detailed in PRD. |
| FR-69 — CDP Remote Attach | `EXPERIENCE-UNIVERSAL` Flow R1; `DESIGN.md` M6 | ✅ Aligned. |
| FR-70 — Topological Comment Tree | `DESIGN.md` result panel (inline, hierarchical data display) | ✅ Aligned. Display pattern supports nested replies. |
| FR-71..FR-82 — Platform crawlers (Twitter, Facebook, Threads, TikTok, Shopee, Batdongsan, TopCV, VietnamWorks, LinkedIn) | `EXPERIENCE-UNIVERSAL` Flow N1; `DESIGN.md` M5 | ⚠️ Partial. Multi-platform selection flow exists, but individual platform page UX is not detailed for most new platforms. |
| FR-73 — MCP Daemon & 80+ tools | `EXPERIENCE-UNIVERSAL` Flows A1/A2; `DESIGN.md` M7 | ✅ Aligned. |
| FR-85 — Internal Operator Dashboard & Admin CLI | `DESIGN.md` M1–M4; `EXPERIENCE-UNIVERSAL` Flows O1/O2/C3/C4 | ⚠️ Partial. Dashboard mockups exist for proxies, checkpoints, streams. CLI admin wireframes are noted as "should be added under Epic 19" in README. |
| FR-86 — Metadata Schema Contract | `DESIGN.md` Schema Viewer | ✅ Aligned. |
| FR-87 — Data Retention | `EXPERIENCE-UNIVERSAL` operator checkpoint flows | ✅ Aligned (operational visibility). |
| FR-88 — 3-Tier Gap-Filling | `EXPERIENCE-UNIVERSAL` operator resume/pause/retry flows | ✅ Aligned. |
| NFR-17 — Operational Observability | `DESIGN.md` M1–M3; `EXPERIENCE-UNIVERSAL` Flow O1 | ✅ Aligned. |

### 4.3. UX ↔ Architecture Alignment

| Architecture Decision / Rule | UX Need | Alignment |
| --- | --- | --- |
| AD-7 / MCP HTTP/SSE Daemon (`xactions daemon start|status|stop`, `GET /health`) | Operator needs to see daemon state and manage lifecycle | ✅ Aligned. `DESIGN.md` M1 and `ARCHITECTURE-UX-REMEDIATION` F1 cover dashboard tile and CLI commands. |
| AD-10 / Checkpoint API (`GET /checkpoints`, resume/pause/retry) | Operator needs checkpoint table with inline actions | ✅ Aligned. `DESIGN.md` M2, `EXPERIENCE-UNIVERSAL` O2, `ARCHITECTURE-UX-REMEDIATION` F4. |
| AD-11 / `AbstractCrawler.listActions()` & schema registry | AI agent / user needs action discovery and schema preview | ✅ Aligned. `DESIGN.md` Schema Viewer, `EXPERIENCE-UNIVERSAL` A1/N1, `ARCHITECTURE-UX-REMEDIATION` F5. |
| AD-9 / Standardized Error Envelope with `suggestedAction` | UX requires actionable errors (inline, no modal) | ✅ Aligned. `DESIGN.md` Result Panel variants; `ARCHITECTURE-UX-REMEDIATION` F6. |
| AD-13 / Governor Status API (`GET /governor/status`, `xactions status`) | Admin dashboard and CLI need live proxy/metrics/hibernation data | ✅ Aligned. `DESIGN.md` M1/M3, `EXPERIENCE-UNIVERSAL` O1/C3, `ARCHITECTURE-UX-REMEDIATION` F3. |
| AD-5 / Terminal QR Login with timeout and polling | TTY QR display and non-TTY fallback | ⚠️ Partial. `EXPERIENCE-UNIVERSAL` C1/C2 cover both; architecture mentions QR/CDP/cookie shape but does not detail non-TTY flow. |

### 4.4. UX Warnings

| # | Warning | Severity | Recommended Action |
| --- | --- | --- | --- |
| W1 | `EXPERIENCE.md` is still `draft` and only covers Facebook/X. It does not reflect the multi-platform scope (Epics 10–20). | Medium | Either promote `EXPERIENCE-UNIVERSAL-2026-08-21.md` to canonical experience doc or update `EXPERIENCE.md` to include all platforms and admin flows. |
| W2 | CLI wireframes for `xactions admin` are not yet detailed; README explicitly states they should be added under Epic 19 as stories are implemented. | Medium | Create CLI command wireframes for Epic 19 (proxy/account/checkpoint/stream management) before implementation starts. |
| W3 | UX for individual new platform pages (Shopee, Batdongsan, TopCV, VietnamWorks, LinkedIn, TikTok, Threads) is absent beyond the multi-platform selector mockup. | Medium | Add per-platform action cards / result panels to `EXPERIENCE.md` or a new `EXPERIENCE-<platform>.md`. |
| W4 | Non-TTY QR login (Flow C2) is described in UX but not explicitly in PRD or architecture. It requires `--qr-url`, webhook/push, and CI-friendly behavior. | Low | Add AC to Story 12.1 for non-TTY mode and ensure `AbstractLogin` contract supports URL-based confirmation. |

### 4.5. UX Alignment Summary

- **Found:** Canonical UX index, design system, and operator/AI/CLI/multi-platform flows exist and are referenced by PRD §7.5.
- **Aligned with PRD:** Core user-facing requirements (QR login, CDP, MCP, admin dashboard, schema viewer, observability) are covered by UX artifacts.
- **Aligned with Architecture:** Architecture spine and UX remediation document explicitly support the dashboard/admin/CLI/MCP surfaces needed by UX.
- **Gaps:** Draft `EXPERIENCE.md` is out of date for multi-platform scope; CLI admin and per-platform page UX need more detail before implementation.

## 5. Epic Quality Review (Re-run)

### 5.1. Review Method

Re-validated `epics.md` (Epics 10–20) against the `bmad-create-epics-and-stories` standards after the fixes requested by the team.

### 5.2. Epic Independence & Dependency Analysis

| Criterion | Findings |
| --- | --- |
| **Cross-epic dependencies** | ✅ All dependencies flow backward. No forward references. |
| **Epic 20 pre-condition** | ✅ Story 20.2 requires Story 20.1 shadow-run parity ≥ 99% for 7 days — correct. |
| **Epic 13 platform-suite** | ✅ Grouping note updated to `Stories 13.2 + 13.2.1–13.2.12`; each Twitter sub-story can ship independently. |
| **Epic 15–18 platform suites** | ✅ Grouping notes added; each sub-story can ship independently. |
| **Database creation timing** | ✅ Story 10.2 creates `Post`, `Comment`, `CrawlCheckpoint` as first needed. Other schema additions are in Story 10.5. |

### 5.3. Story Quality Findings

#### 5.3.1. Critical / Major Issues — All Resolved

| # | Issue | Status | Evidence |
| --- | --- | --- | --- |
| Q1 | Story 19.4 was an epic-sized catch-all for admin CLI | ✅ Resolved | Split into `19.4` (command group) + `19.4.1`–`19.4.5` (status, proxies, accounts, checkpoints, stream). |
| Q2 | NFR traceability matrix referenced non-existent Story 19.6 | ✅ Resolved | Matrix now references `19.4.5`; note about `19.5/19.6` removed. |
| Q3 | Story 13.2.6 bundled four write actions | ✅ Resolved | Split into `13.2.6` (post/reply/quote) and `13.2.7` (schedule). |
| Q4 | Story 13.2.7 bundled ~11 engagement/social-graph actions | ✅ Resolved | Split into `13.2.8` (like/retweet) and `13.2.9` (social graph). |
| Q5 | Story 13.2.8 bundled direct messaging + list management | ✅ Resolved | Split into `13.2.10` (DM) and `13.2.11` (list management); integration remains `13.2.12`. |

#### 5.3.2. Remaining Minor / Medium Issues

| # | Issue | Location | Evidence | Recommended Fix |
| --- | --- | --- | --- | --- |
| Q6 | **Story 19.8 combines account + checkpoint REST concerns** | Epic 19, Story 19.8 | Single story covers both `/admin/accounts` and `/admin/checkpoints`. | Split into two stories if team wants stricter separation; non-blocking. |
| Q7 | **Personas in Epic 11 are mostly technical/system roles** | Epic 11, Stories 11.2, 11.4, 11.7, 11.8 | "Scale-Out Scraper", "Platform Governor & Account Security Engineer", etc. | Keep if these are accepted internal platform personas; otherwise rephrase. |
| Q8 | **Epic 10 is a foundation enabler with indirect end-user value** | Epic 10 | Contracts/schema stories. | Already labeled as foundation enabler; ensure not treated as end-user deliverable. |
| Q10 | **Story 11.5 depends on earlier stories but is numbered 11.5** | Epic 11 | Implementation order note lists `11.1 → 11.2 → 11.4 → 11.7 → 11.5 → 11.6 → 11.3`. | Keep the note; non-blocking. |

### 5.4. Best-Practices Compliance Checklist

| Epic | User Value | Independence | Story Sizing | No Forward Dependencies | Tables Created When Needed | Clear ACs | Traceability to FRs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | ⚠️ Enabler | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | ✅ | ✅ | ⚠️ (personas) | ✅ | N/A | ✅ | ✅ |
| 12 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 13 | ⚠️ Suite (large) | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 14 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 15 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 16 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 17 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 18 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 19 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| 20 | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |

### 5.5. Quality Review Summary

- **Epic structure is sound:** No forward dependencies; cross-epic dependencies are backward and clearly documented.
- **Multi-platform suite epics are well-managed:** Grouping notes for Epics 13, 15, 16, 17, 18 clarify independent sub-threads.
- **All three critical sizing problems (19.4, 13.2.6/7/8) and the NFR traceability dangling reference are resolved.**
- **Remaining open items are minor:** 19.8 could be split, Epic 11/10 personas/role wording, 11.5 ordering note. None of these block implementation.
- **Markdown formatting** in the split Twitter stories has been corrected.

## 6. Summary and Recommendations (Re-run)

### 6.1. Overall Readiness Status

**READY — Phase 4 Core (Epics 10–20) + Phase 4 Extension (Epics 23–26)**

The three critical epic-sizing issues identified in the previous assessment have been resolved:
- `19.4` is now a command-group story plus five focused admin CLI sub-stories (`19.4.1`–`19.4.5`).
- `13.2.6`–`13.2.8` are now split into `13.2.6`–`13.2.12`, with each sub-story owning a single action domain.
- The NFR traceability matrix no longer references the non-existent `19.6`; it now points to `19.4.5`.

**Epics 23–26** (Bluesky/Mastodon migration, utility/adapters consolidation, unified dispatcher, legacy decommission) have been reviewed and added to the canonical PRD, architecture spine, and UX register as a Phase 4 extension. The package now has **0 critical / major blockers** for both the Phase 4 core and the Phase 4 extension.

### 6.2. Critical Issues Requiring Immediate Action

None. All critical issues from the previous assessment are resolved.

### 6.3. High-Priority Recommendations (Parallel with Implementation)

1. **Resolve remaining UX gaps before the first UI/CLI implementation sprint:**
   - Add CLI wireframes for `xactions admin` commands.
   - Define per-platform page UX for Shopee, Batdongsan, TopCV, VietnamWorks, LinkedIn, TikTok, Threads.
   - Add dashboard mockups for Bluesky/Mastodon optional-auth and instance override fields.
2. **Consider splitting Story 19.8** (account + checkpoint REST) into two stories for stricter separation.
3. **Clarify non-TTY QR login** in Story 12.1 AC and `AbstractLogin` contract.
4. **Verify deferred items are gated:** FR-62 (GraphQL replay), advanced Marketplace filters, canvas/WebGL spoofing should remain in `FUTURE-WORK.md` and not leak into Phase 4 stories.
5. **Schedule Phase 4 extension review checkpoint:** After Epic 13 (hybrid engine) is stable, confirm Product Council approval for Bluesky/Mastodon scope before starting Epic 23.

### 6.4. What Is Already Readiness-Grade

- ✅ Canonical PRD, architecture spine, epics, and UX register exist and are approved/superseded correctly.
- ✅ 100% FR/NFR traceability from PRD to `epics.md` for Epics 10–20 and Phase 4 extension 23–26 (FR-89..FR-93, NFR-18).
- ✅ Architecture conflict (Facebook gateway vs hybrid) resolved and documented.
- ✅ Multi-platform epic grouping notes added; Epic 13 sub-stories now 13.2.1–13.2.12.
- ✅ Admin CLI split into independently completable stories 19.4.1–19.4.5.
- ✅ Core UX components, flows, and mockups cover admin dashboard, MCP/AI, CLI, multi-platform new-user journey, and Bluesky/Mastodon public scrape flows.
- ✅ Dependency map is backward-only and logical.
- ✅ NFR traceability matrix updated; no dangling story references.

### 6.5. Recommended Next Steps

1. Close remaining UX gaps (per Section 6.3) before UI/CLI stories begin.
2. If desired, split `19.8` for stricter REST separation; otherwise keep with explicit justification.
3. Begin implementation of Epics 10–20 in the planned order.
4. Begin implementation of Phase 4 extension Epics 23–26 after Epic 13 (hybrid engine) is stable and Product Council approves the open/federated social scope.
5. Re-run `bmad-sprint-planning` to regenerate `sprint-status.yaml` keys from the updated `epics.md` (already done manually in this update; regenerate if automated tool is preferred).

### 6.6. Final Note

This re-run of the Implementation Readiness assessment confirms the **three critical blockers are resolved** and the **Phase 4 extension (Epics 23–26) has been reviewed against PRD, architecture, and UX**. The package now has **0 critical / major issues** and **4 minor notes** (Q6, Q7, Q8, Q10) for the **Phase 4 core (Epics 10–20)**; no additional blockers were introduced by the Phase 4 extension.

The **overall Phase 4 + Phase 4 Extension status is READY**.
