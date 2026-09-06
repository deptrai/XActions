---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - 'planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md'
  - 'planning-artifacts/research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md'
  - 'planning-artifacts/archive/epics-1-9-legacy.md'
  - 'prisma/schema.prisma'
  - '../nowing/_bmad-output/planning-artifacts/architecture/architecture-xactions-social-integration-2026-08-15/ARCHITECTURE-SPINE.md'
---

# XActions Universal Hybrid Scraping & Automation Engine — Epic Breakdown (Epics 10–20)

## Overview

Tài liệu phân rã chi tiết Epics và User Stories cho toàn bộ hệ thống **XActions Universal Hybrid Scraping & Automation Microservice** (tiếp nối Epics 1–9 trong `archive/epics-1-9-legacy.md`). Hệ thống được thiết kế theo chuẩn **Hexagonal Architecture + Tiered Hybrid Signer Engine + Dual-Channel Microservice Daemon + Adaptive Rate Limiter**, hợp nhất 100% cơ sở dữ liệu trên **PostgreSQL (Prisma ORM với JSONB GIN Indexes)** và đóng vai trò là Scraping Engine toàn năng cho hệ sinh thái **Nowing (AI Lead & Research Hub)** cũng như nền tảng SaaS/CLI/AI MCP độc lập.

## Backlog Status & Legacy Code Overlap (Audit 2026-08-21)

> Được cập nhật sau khi so sánh toàn bộ backlog Epics 12–20 với source code hiện có.

### Consolidated / Absorbed
- **Story 11.5** (End-to-End Request Pipeline) và **Story 11.6** (Rate-Limit/Bot-Challenge Defense) đã được hấp thụ vào **Story 11.3** (End-to-End Request Pipeline with 429/403 Auto-Quarantine, Exponential Backoff & Two-Mode IP Strategy). Xem `src/core/base-client.js`.
- **Story 11.4** được thu nhỏ thành "Governor Surface & Backpressure" vì core `AdaptiveRateGovernor` đã implement trong `src/core/adaptive-governor.js`.

### Partial Overlap — Refactor / Wrap Recommended
| Story | Existing Code | Gap |
|---|---|---|
| 12.1 | `src/utils/qrcode.js` (`renderTerminalQr`, `isTty`) | countdown, `checkLoginState`, CLI flags, non-TTY fallback |
| 13.1 | `src/core/signer-pool.js` (`PreSignedTokenRing`) | `SignerWorkerPagePool.init/evaluate/close` + 3s timeout |
| 13.2 | `src/scrapers/twitter/index.js`, `src/scrapers/twitter/http/`, `src/client/Scraper.js`, `src/scrapers/index.js` | `TwitterCrawler extends AbstractCrawler` in `src/scrapers/social/twitter/` |
| 13.3 | `src/scrapers/facebook/index.js`, `src/scrapers/facebook/graphql.js` | `FacebookCrawler extends AbstractCrawler` in `src/scrapers/social/facebook/` |
| 14.1 | `src/scrapers/twitter/http/thread.js` (conversation/thread) | topological sort + Prisma batch save by depth |
| 14.2 | `package.json` `mcp:daemon`, `src/mcp/server.js` `startHttpTransport()` (port 3001) | 3-layer JSON envelope, `x_crawl_*`, `x_actions_list`, artifact export |
| 14.3 | `src/streaming/streamManager.js` (Redis/Bull/Socket.IO) | `stream:social:raw_posts` thin events, metrics endpoint, alerts |
| 15.1 | `src/scrapers/threads/index.js` (Puppeteer) | `ThreadsCrawler extends AbstractCrawler` in `src/scrapers/social/threads/` |
| 19.1–19.3 | `/api/checkpoints`, `/api/proxies`, `/api/streams` routes exist | dashboard views in `dashboard/admin.html` |
| 19.5 | `xactions checkpoints list/show/resume/pause/retry` | done |
| 19.6 | `xactions stream start/stop/list/history/pause/resume` | Nowing `stream:social:raw_posts` metrics + alerts |
| 19.7 | `/api/proxies`, `/api/streams`, `/api/checkpoints` | mount under `/admin/*` with admin auth |

### New / No Code in Repo
| Epic | Stories | Note |
|---|---|---|
| 12.2 | CDP attach | no `launchBrowserWithCdp` or Playwright CDP connect |
| 15.2 | TikTok scraper | no code |
| 16.x | Shopee, TikTok Shop | legacy lives in Nowing repo, not here |
| 17.x | Chotot, Batdongsan | legacy lives in Nowing repo |
| 18.1–18.2 | TopCV, VietnamWorks | no code |
| 18.3 | LinkedIn via CDP | blocked by 12.2 |
| 19.4, 19.8 | `xactions admin` CLI, `x_admin_*` MCP tools | no code |

### Decommission Plan (Epic 20.1)
After new hybrid crawlers (Epics 13–18) are stable, the following legacy modules will be removed:
- `src/client/Scraper.js` and `src/client/`
- `src/scrapers/twitter/index.js` and `src/scrapers/twitter/http/`
- `src/scrapers/facebook/index.js`
- `src/scrapers/threads/index.js`

`src/scrapers/index.js` will be refactored to delegate to `AbstractCrawler` instances rather than legacy function modules.

---

## Cross-Epic Dependency & Sequence Map

| Epic/Story | Cần output từ | Lý do | Rủi ro nếu chưa xong |
|---|---|---|---|
| Epic 13-18 (crawlers) | Epic 10.1, 10.2, 10.5 | `AbstractCrawler`, `PrismaStore`, `metadata-schema` là nền tảng | Crawler không có interface/storage/schema để kế thừa. |
| Epic 13-18 (crawlers) | Epic 11.3, 11.4, 11.7 | `AbstractApiClient`, `AdaptiveRateGovernor`, `Crawler-Governor Integration` | Không có proxy/retry/governor/validator. |
| Epic 15.2 | Epic 13.1 | `SignerWorkerPagePool` để giải mã `a_bogus`/`msToken` | Không thể sign TikTok request. |
| Epic 18.3 | Epic 12.2 | CDP Remote Attach cho LinkedIn | **Blocked** — 12.2 còn backlog. |
| Epic 19 (admin) | Epic 10.4, 11.4, 14.3 | Checkpoints, governor, stream metrics | Dashboard/CLI không có dữ liệu để hiển thị. |
| Epic 20 | Epics 13-18 | Tất cả crawler đa nền tảng phải stable trước khi decommission | Không thể shadow-run hoặc xóa scraper cũ an toàn. |

**Quy tắc dependency:** Không có forward reference theo số epic (Epic N không cần Epic N+1), nhưng **Epic 13–18 phải đợi Epic 10, 11 hoàn thành** và **Epic 20 phải đợi 13–18**. Epic 12.2 cần ưu tiên trước Epic 18.3.

---

## Cross-Epic Dependency & Sequence Map

| Epic/Story | Cần output từ | Lý do | Rủi ro nếu chưa xong |
|---|---|---|---|
| Epic 13-18 (crawlers) | Epic 10.1, 10.2, 10.5 | `AbstractCrawler`, `PrismaStore`, `metadata-schema` là nền tảng | Crawler không có interface/storage/schema để kế thừa. |
| Epic 13-18 (crawlers) | Epic 11.1, 11.2, 11.3, 11.4 | `ProxyIpPool`, `AbstractApiClient`, `AdaptiveRateGovernor` | Không có proxy/retry/governor. |
| Epic 15.2 (TikTok) | Epic 13.1 | `SignerWorkerPagePool` để giải mã `a_bogus`/`msToken` | Không thể sign TikTok request. |
| Epic 18.3 (LinkedIn) | Epic 12.2 | CDP Remote Attach cho LinkedIn | **Unblocked** — 12.2 done; có thể lên lịch sau khi proxy pool & signer stable. |
| Epic 19 (admin) | Epic 10.4, 11.4, 14.3 | Checkpoints, governor, stream metrics | Dashboard/CLI không có dữ liệu để hiển thị. |
| Story 20.1 | Epics 13-18 | Crawler đa nền tảng phải stable trước shadow-run | Không có dữ liệu để đối soát. |
| Story 20.2 | Story 20.1 | Shadow-run parity ≥ 99% trong 7 ngày | Xóa scraper cũ gây mất dữ liệu. |

**Quy tắc dependency:** Không có forward reference theo số epic (Epic N không cần Epic N+1), nhưng **Epic 13–18 phải đợi Epic 10, 11 hoàn thành** và **Epic 20 phải đợi 13–18 + 20.1**. Epic 12.2 đã hoàn thành, Epic 18.3 không còn bị blocked.

## Requirements Inventory

### Functional Requirements

* **FR64 (Core Abstraction):** Hệ thống phải cung cấp các cổng trừu tượng chuẩn hóa (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) làm khung cơ sở cho mọi nền tảng.
* **FR65 (Tiered Hybrid Scraping Engine):** Hệ thống phải hỗ trợ cơ chế thực thi lai kết hợp Pre-Signed Token Ring Buffer O(1) và Worker Page Pool cho chữ ký động (`page.evaluate()` với timeout 3s) cùng Async HTTP Client (`got-scraping`/`undici`) với TLS/JA4 Spoofing.
* **FR66 (Resilient Anti-Leak Proxy Pool):** Hệ thống phải quản lý tập trung danh sách Proxy (Static & Dynamic Tunnel) với cờ chống rò rỉ WebRTC/DNS, tự động validate, tính buffer expiration, và tự động cách ly (quarantine) IP lỗi 5 phút.
* **FR66B (Adaptive Infrastructure Rate Limiter & Account Protection Governor):** Hệ thống phải tự động điều tốc nhịp cào theo tỷ lệ Proxy sống (`Max Throughput = Healthy Proxies * SafeRatePerIP`), áp dụng Leaky Bucket và đưa tài khoản vào chế độ Ngủ đông (Hibernation) 15–30 phút khi gặp thử thách bảo vệ để giảm nguy cơ die tài khoản hàng loạt (không đảm bảo 100%).
* **FR67 (Namespaced PostgreSQL Storage & JSONB GIN Indexes):** Hệ thống phải lưu trữ toàn bộ bài viết (`Post`) và cây bình luận phân cấp (`Comment`) tập trung vào PostgreSQL qua Prisma ORM với quy ước Namespaced ID `${platform}:${externalId}`, cột `metadata Json?` có GIN Index và hỗ trợ batch transaction chunked 500 records.
* **FR68 (Terminal QR Login):** Hệ thống CLI/MCP phải hỗ trợ hiển thị mã QR ASCII chuẩn 1:1 trên Terminal console qua `qrcode-terminal` có countdown 60s, timeout 120s và polling cookie ngầm.
* **FR69 (CDP Remote Attach):** Hệ thống phải hỗ trợ kết nối trực tiếp vào trình duyệt Chrome thật của người dùng qua cổng `--remote-debugging-port=9222` kèm Gaussian jitter (3–7s) để triệt tiêu nguy cơ checkpoint (LinkedIn, TopCV, Twitter).
* **FR70 (Topological Comment Tree):** Hệ thống phải hỗ trợ trích xuất cây bình luận đa tầng, chống tham chiếu vòng và thực hiện Topological Sort (lưu Root trước, Sub-replies sau theo depth) để tránh Deadlock và Foreign Key violation.
* **FR71 (Twitter Crawler Refactor):** Tái cấu trúc bộ cào Twitter trong `src/scrapers/social/twitter/` tuân thủ kiến trúc `AbstractCrawler` và `BaseHybridClient`.
* **FR72 (Facebook Crawler Refactor):** Tái cấu trúc bộ cào Facebook trong `src/scrapers/social/facebook/` tuân thủ kiến trúc `AbstractCrawler` và GraphQL DocID dispatch.
* **FR73 (MCP Daemon & CLI Integration):** Chạy MCP Server dưới dạng Daemon HTTP/SSE (Port 3001), tích hợp CLI (`unfollowx`) và 80+ MCP tools cho AI Agent với 3-Layer JSON Envelope và Auto-Artifact generation.
* **FR74 (Threads Scraper Adapter):** Cào bài viết, timeline, search keywords và replies trên Threads thông qua Meta GraphQL internal endpoints (LSD token + DocID).
* **FR75 (TikTok Video & Comment Scraper):** Cào video trending, hashtag feeds và comments trên TikTok thông qua Playwright Signer Bridge giải mã chữ ký `a_bogus` & `msToken` có kiểm tra mã chặn False 200 OK.
* **FR76 (Shopee Product & Review Scraper):** Cào danh sách sản phẩm, giá bán, flash sale và đánh giá người mua trên Shopee VN qua Web API kết hợp TLS Spoofing và Anti-Bot Validation.
* **FR77 (TikTok Shop E-Commerce Scraper):** Cào sản phẩm bán chạy, doanh số ước tính và đánh giá shop trên TikTok Shop.
* **FR78 (Chợ Tốt Multi-Category Scraper):** Cào tin đăng BĐS, việc làm trên Chợ Tốt bóc tách số điện thoại chính chủ (loại bỏ SĐT masked `***` và validate regex VN).
* **FR79 (Batdongsan.com.vn Scraper):** Cào tin bất động sản chính chủ, dự án và biến động giá trên Batdongsan.com.vn qua HTTP Client.
* **FR80 (TopCV Recruitment Scraper):** Cào tin tuyển dụng, JD chi tiết, mức lương và thông tin công ty trên TopCV.
* **FR81 (VietnamWorks Job Scraper):** Cào tin tuyển dụng IT và Executive trên VietnamWorks qua API public / HTML parser.
* **FR82 (LinkedIn Lead & Job Scraper):** Cào thông tin ứng viên, công ty và bài đăng tuyển dụng trên LinkedIn qua CDP Attach Port 9222.
* **FR83 (Nowing Thin Event Stream Ingest):** Phát luồng dữ liệu cào dạng Thin Event Pointers (`{ id, platform, externalId, category, authorId, crawledAt, storageRef }`) vào Redis Stream `stream:social:raw_posts` (`MAXLEN ~ 1000000` hoặc `MINID` theo thời gian, configurable) cho Nowing AI Hub.
* **FR84 (Nowing Scrapers Cutover & Decommissioning):** Nâng cấp adapter Nowing sang Daemon MCP HTTP/SSE (Port 3001) và dọn dẹp, loại bỏ toàn bộ 20+ scraper cũ cùng browser dependencies khỏi Nowing backend. (Epic 20)
* **FR85 (Internal Operator Dashboard & Admin CLI):** Cung cấp dashboard nội bộ và CLI `xactions admin` để giám sát jobs/checkpoints, proxy pool, account hibernation, stream metrics và alerts. (Epic 19)
* **FR86 (Metadata Schema Contract for Consumers):** Mỗi platform/category publish JSON Schema cho `Post.metadata` và API/CLI/MCP discovery. (Story 10.5)
* **FR87 (Data Retention Policy):** Dữ liệu raw crawl TTL 30 ngày; leads/processed output vĩnh viễn; checkpoints/audit logs 90 ngày. (Story 10.2, Epic 19)
* **FR88 (3-Tier Incremental Gap-Filling):** Cào theo mô hình full seed → delta/gap fill → on-demand refresh; 0% duplication; 90% proxy cost saving. (Epic 10, 11)
* **FR89 (Bluesky AT Protocol Scraper):** Cào profile, followers, following, user feed, search, và custom feeds trên Bluesky qua public AT Protocol API với `AbstractCrawler` + `AbstractApiClient`; hỗ trợ optional auth. (Epic 23)
* **FR90 (Mastodon REST API Scraper):** Cào profile, followers, following, timeline, search, hashtag, và trending trên bất kỳ Mastodon instance nào qua public REST API với `AbstractCrawler` + `AbstractApiClient`; hỗ trợ optional `accessToken`. (Epic 23)
* **FR91 (Utility Scripts & Adapters Consolidation):** Audit và quyết định deprecation cho `src/scrapers/*.js` độc lập và `src/scrapers/adapters/`; convert tính năng hữu ích thành `CrawlerCommand` action hoặc archive; thu gọn adapter layer. (Epic 24)
* **FR92 (Unified Dispatcher & Backward Compatibility):** `src/scrapers/index.js` trở thành thin dispatcher duy nhất qua `scrape(platform, action, args)`; tất cả caller gọi `CrawlerCommand`; giữ `package.json` exports backward-compatible. (Epic 25)
* **FR93 (Legacy Decommission):** Xóa legacy modules sau khi đạt shadow-run parity ≥ 99% trong 7 ngày. (Epic 26)

### NonFunctional Requirements

* **NFR11 (Resource Optimization):** Giảm ít nhất 85% RAM và 70% CPU so với mô hình Full Headless Browser khi cào khối lượng lớn (> 1,000 bài viết/bình luận).
* **NFR12 (High Throughput & Latency):** Tăng tốc độ thu thập dữ liệu lên ít nhất 5x–10x so với việc render DOM từng trang qua Puppeteer/Playwright; độ trễ RPC <2ms qua Daemon HTTP/SSE.
* **NFR13 (Resilience & Auto-Failover):** Tự động phát hiện proxy die hoặc rate-limit và chuyển đổi IP tức thì, replay request tối đa 3 lần với exponential backoff.
* **NFR14 (Zero-Credential Security):** Bảo mật tuyệt đối thông tin phiên của người dùng; hỗ trợ đăng nhập không cần mật khẩu trực tiếp qua QR Code hoặc CDP Attach.
* **NFR15 (Clean Architecture & Extensibility):** Tách biệt 100% giữa Core domain contracts và Implementation adapters; việc thêm nền tảng mới không làm thay đổi core logic.
* **NFR16 (License & Backward Compatibility):** 100% mã nguồn tuân thủ giấy phép tự do (MIT / Apache 2.0); giữ nguyên khả năng tương thích ngược với CLI `unfollowx` và toàn bộ 80+ MCP tools hiện có.
* **NFR17 (Operational Observability):** Hệ thống expose real-time metrics qua `GET /governor/status`, `GET /metrics/stream`, dashboard SSE/polling 5–30s, và alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`.
* **NFR18 (Universal Architecture Compliance):** 100% nền tảng và crawler trong XActions phải kế thừa `AbstractCrawler` và `AbstractApiClient`, được gọi thống nhất qua `CrawlerCommand`. Không còn module scraper nào sử dụng API surface riêng hoặc nằm ngoài `src/scrapers/social/<platform>/` sau khi Epic 26 hoàn thành.

---

## Epic 10: Data & Platform Foundation for Universal Scraping

> **Foundation Enabler Epic:** This epic delivers the shared contracts, storage, and schema that all platform-specific scrapers (Epics 13–18), operational surfaces (Epic 19), and downstream consumers (Nowing, AI agents, CLI users) depend on. The direct users are platform engineers, data scientists, operators, and integrators; the end-user value is realized through faster, more reliable, and consistent multi-platform scraping.

### Story 10.1: Core Domain Interfaces & Error Hierarchy Definition
As a **Scraper Developer / Platform Engineer**,
I want **định nghĩa các abstract class `AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore` cùng cây lỗi chuẩn (`PlatformError`, `RateLimitError`, `AuthSessionExpiredError`, `ProxyDeadError`)**,
So that **tôi có thể thêm nền tảng mới (Shopee, LinkedIn, v.v.) mà không vi phạm core logic, và AI agent / operator nhận được actionable errors khi gặp sự cố**.

**Acceptance Criteria:**
* **Given** repo XActions ở trạng thái sau architecture r3
* **When** kiểm tra `package.json` và `src/core/`
* **Then** `got-scraping`, `qrcode-terminal`, `socks-proxy-agent`, và `undici` phải có trong `dependencies` (hoặc xác nhận đã có)
* **And** thư mục `src/core/` là 100% Pure ESM, no external npm dependencies
* **And** module `src/core/base-crawler.js`, `base-client.js`, `base-store.js`, `base-login.js`, `error-envelope.js`, `signer-pool.js`, `status-api.js`, `session-manager.js`, `adaptive-governor.js`, và `index.js` được tạo
* **Then** các class phải định nghĩa đầy đủ phương thức trừu tượng:
  - `AbstractCrawler`: `init()`, `start()`, `search()`, `getPostDetail()`, `getComments()`, `cleanup()`
  - `AbstractApiClient`: `request()`, `sign()`, `updateCookies()` (đảm bảo immutable context cho từng tác vụ)
  - `AbstractStore`: `init()`, `storeContent(post)`, `storeBatch(posts)`, `storeComment(comment)`, `storeCommentBatch(comments)`, `close()`
  - `AbstractCrawler.listActions(): ActionDescriptor[]` để AI/CLI khám phá action theo platform.
* **And** ném lỗi `Method not implemented` nếu lớp con chưa override khi khởi tạo qua `new.target`
* **And** toàn bộ error classes kế thừa từ `PlatformError` cung cấp các trường: `statusCode`, `platform`, `isRetryable` (boolean), `retryAfterMs` (number), `suggestedAction`.
* **And** `AbstractErrorEnvelope` / `PlatformError.toEnvelope()` chuẩn hóa shape trả về: `{ code, type, message, statusCode, isRetryable, retryAfterMs, retryAfter, suggestedAction, accountId?, platform }`.
* **And** `AbstractCrawler` tự động đăng ký action vào `ActionRegistry`, validate `category` trước khi lưu, và đảm bảo `action` là snake_case.
* **And** `ActionDescriptor` hỗ trợ trường tùy chọn `requiresAuth?: boolean`; `AbstractCrawler.start(command)` tính `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth` và dùng giá trị này cho account resolution (rút `AccountPool`, throw `XACT_4010`, governor account check).
* **And** action có `requiresAuth: false` chạy với `accountId = null` khi caller không truyền accountId: không rút `AccountPool`, không kiểm tra `governor.canAccountRequest`; `listActions()` trả về `requiresAuth` đã phân giải cho từng action.
* **And** `GovernorStatusApi` định nghĩa shape `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.
* **And** `node src/core/index.js` parse thành công và `npx prisma validate` pass.

### Story 10.2: Prisma Post & Comment Schema with Namespaced ID, JSONB GIN & Batch Chunking
As a **Data Platform Engineer / Nowing Integrator**,
I want **mở rộng `prisma/schema.prisma` với model `Post` và `Comment` (hỗ trợ Namespaced ID `${platform}:${externalId}`, cột `metadata Json?`), đồng thời triển khai `PrismaStore`**,
So that **toàn bộ dữ liệu cào đa ngành được lưu trữ tập trung, không bị collision ID, và cho phép Nowing query lọc giá/sđt/lương nhanh bằng GIN/expression indexes**.

> **NFR:** Query lọc `metadata` phải đạt <10ms trên tập dữ liệu test 1M rows; benchmark thực hiện trong chuyên mục NFR audit.

**Acceptance Criteria:**

#### Post model
* **Given** file `prisma/schema.prisma` của dự án XActions
* **When** định nghĩa model `Post` với `id` Namespaced `${platform}:${externalId}`, `platform`, `externalId`, `category`, `authorId`, `authorName`, `content`, `mediaUrls String[]`, `likesCount`, `repostsCount`, `repliesCount`, `viewsCount`, `metadata Json?`, `publishedAt`, `crawledAt`
* **Then** `@@unique([platform, externalId])` tồn tại trên `Post` và migration sinh ra hợp lệ

#### Comment model
* **Given** schema `Post` đã tồn tại
* **When** định nghĩa model `Comment` với `id` Namespaced, `platform`, `externalId`, `postId`, `parentCommentId`, `depth`, `authorId`, `authorName`, `content`, `metadata Json?`, và quan hệ tự tham chiếu `@relation("CommentReplies")`
* **Then** `@@unique([platform, externalId, postId])` tồn tại trên `Comment` và migration sinh ra hợp lệ

#### Indexes
* **Given** migration đã được tạo
* **When** chạy raw SQL migration
* **Then** GIN index trên `metadata` và Expression Index trên `phone`/`price`/`salary` được tạo

#### CrawlCheckpoint model
* **Given** schema `Post` và `Comment` đã tồn tại
* **When** định nghĩa model `CrawlCheckpoint` với `@@unique([platform, targetType, targetKey])` và các trường `status`, `errorCount`, `lastCrawledAt`, `nextScheduledAt`
* **Then** migration sinh ra hợp lệ

#### PrismaStore batch writer
* **Given** models `Post` và `Comment` đã tồn tại
* **When** triển khai `src/store/prisma-store.js`
* **Then** insert bài viết và bình luận theo batch chunk 500 bản ghi; mặc định dùng `createMany` + `skipDuplicates`, hỗ trợ `upsert` qua option `{ upsert: true }`, và insert comment theo từng `depth` level để tránh self-referencing FK violation.

### Story 10.3: AI Dataset Export Utility (Streaming JSONL & CSV with Sanitization)
As an **AI Engineer / Data Scientist**,
I want **một utility xuất dữ liệu từ PostgreSQL ra định dạng JSON Lines (`.jsonl`) và CSV dạng stream có xử lý Backpressure và sanitize ký tự xuống dòng**,
So that **tôi có thể trích xuất dataset theo filter (`platform`, `keyword`, `dateRange`) phục vụ huấn luyện LLM hoặc Vector DB RAG mà không bị lỗi format hay tràn RAM**.

**Acceptance Criteria:**
* **Given** database PostgreSQL chứa dữ liệu `Post` và `Comment`
* **When** gọi hàm `exportDataset({ platform, keyword, fromDate, format: 'jsonl'|'csv', outputPath, compress: boolean })` trong `src/utils/exporter.js`
* **And** `keyword` mặc định tìm kiếm full-text trên trường `content` (Post.content ILIKE và Comment.content ILIKE)
* **Then** hệ thống đọc dữ liệu tuần tự theo cursor / stream từ Prisma và ghi vào file đích qua `fs.createWriteStream`
* **And** tự động làm sạch ký tự xuống dòng (`\r\n`) trong trường `content` thành khoảng trắng trước khi ghi dòng JSONL
* **And** kiểm soát Backpressure an toàn bằng cách lắng nghe event `'drain'` khi stream buffer đầy, RAM duy trì < 50MB.

### Story 10.4: CrawlCheckpoint Operational API (Resume / Pause / Retry)
As a **Platform Operator**,
I want **API và CLI để xem, resume, pause, retry từng checkpoint cào**,
So that **tôi có thể quản lý tiến độ crawl khi container restart hoặc target bị lỗi**.

**Acceptance Criteria:**
* **Given** model `CrawlCheckpoint` đã tồn tại
* **When** triển khai `src/api/checkpoints.js` và `src/cli/commands/checkpoints.js`
* **Then** có endpoint `GET /checkpoints`, `GET /checkpoints/:id`, `POST /checkpoints/:id/resume`, `POST /checkpoints/:id/pause`, `POST /checkpoints/:id/retry`
* **And** các thao tác resume/pause/retry yêu cầu operator đã xác thực với quyền `checkpoint:manage` (hoặc admin tương đương)
* **And** CLI `xactions checkpoints list/show/resume/pause/retry` hoạt động
* **And** `CrawlCheckpoint.status` chuyển đổi đúng giữa `running`, `paused`, `failed`, `completed`, `stalled`.

### Story 10.5: Metadata Schema Contract & Registry for Consumers
As a **Nowing Integrator**,
I want **mỗi platform/category publish JSON Schema cho `Post.metadata` và API discovery**,
So that **consumer biết trước field nào tồn tại và kiểu dữ liệu chuẩn hóa**.

**Acceptance Criteria:**
* **Given** dữ liệu `Post` với `metadata Json?`
* **When** triển khai `src/core/metadata-schema-registry.js` và `src/api/schemas.js`
* **Then** hệ thống hỗ trợ đăng ký JSON Schema từ file `schemas/<platform>/<category>.json` (hoặc TypeScript type)
* **And** ít nhất 2 pilot schema được publish: `schemas/twitter/social.json` và `schemas/shopee/ecom.json`
* **And** API `GET /schemas`, `GET /schemas/:platform/:category` trả về JSON Schema
* **And** MCP tool `x_schema_get` và CLI `xactions schema get <platform> <category>` hoạt động
* **And** `PrismaStore` validate `metadata` against schema khi ghi, trả `invalid_args` error nếu mismatch; các schema ngoài pilot có thể được thêm trong epic chuyên biệt sau.

---

## Epic 11: Resilient Network & Proxy Pool Management

> **Implementation Order:** Story 11.1 (Proxy/AccountPool) → 11.2 (Providers) → 11.4 (Governor) → 11.7 (Crawler-Governor + Validator) → 11.5 (End-to-End Pipeline) → 11.6 (Rate-Limit/Bot-Challenge Defense) → 11.3 (429/403 Interceptor). Story 11.3 đã được thu nhỏ scope và có thể được hấp thụ bởi 11.5/11.6 nếu cần; hiện tại giữ riêng để theo dõi interceptor unit.

### Story 11.1: ProxyIpPool & AccountPool for Sticky/Round-Robin IP and Multi-Account Rotation
As an **Automation Operator**,
I want **hệ thống quản lý tập trung proxy (sticky IP cho tài khoản, round-robin IP cho no-auth) và một account pool để xoay tài khoản khi gặp rate-limit hoặc hibernation**,
So that **request gửi đi luôn sử dụng IP sống, an toàn, không bị lộ IP gốc, và tài khoản auth-required không bị die hàng loạt**.

**Acceptance Criteria:**

#### ProxyIpPool
* **Given** danh sách proxy đầu vào (HTTP/HTTPS/SOCKS5)
* **When** khởi tạo `ProxyIpPool` (`src/proxy/proxy-pool.js`)
* **Then** tự động cấu hình `remote DNS resolution` và cờ browser `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
* **And** hỗ trợ hai chế độ lấy proxy:
  - `getStickyProxy(accountId)` — trả về cùng một proxy cho một tài khoản (auth-required platforms).
  - `getNext()` — round-robin trên các proxy khỏe (no-auth platforms, residential rotation).
* **And** tự động làm mới IP nếu thời gian sống còn lại dưới 30 giây (buffer window) hoặc proxy bị quarantine.

#### AccountPool
* **Given** nhiều tài khoản cho cùng một platform
* **When** khởi tạo `AccountPool` (`src/core/account-pool.js`)
* **Then** hệ thống lưu trữ account với `platform`, `accountId`, `credentials`, `assignedProxy`, `hibernatingUntil`, `velocity`
* **And** `getNextAvailable(platform)` trả về account khả dụng tiếp theo theo round-robin
* **And** `markUnavailable(accountId, reason, duration)` đánh dấu account hibernating hoặc rate-limited
* **And** `getAccountVelocity(accountId)` trả về số request trong sliding window.

### Story 11.2: Static & Dynamic Residential Tunnel Proxy Providers
As a **Scale-Out Scraper**,
I want **hỗ trợ cả Static Proxy list và Dynamic Residential Tunnel Proxy (xoay IP per-request)**,
So that **tôi có thể linh hoạt sử dụng các nhà cung cấp proxy phổ biến như BrightData, IPRoyal, Kuaidaili, Smartproxy**.

**Acceptance Criteria:**
* **Given** chuỗi cấu hình proxy dạng URL `http://user:pass@host:port`
* **When** khởi tạo `StaticProxyProvider` hoặc `DynamicTunnelProvider` trong `src/proxy/providers.js`
* **Then** hệ thống parse chính xác hostname, port, username, password và scheme
* **And** `StaticProxyProvider` phù hợp cho auth-required platforms (sticky IP per account) hoặc nhóm proxy cố định.
* **And** `DynamicTunnelProvider` phù hợp cho no-auth platforms (residential IP xoay per-request) hoặc khi cần đổi IP mỗi request.
* **And** tích hợp tương thích với `undici.ProxyAgent` và `playwright.chromium.launch({ proxy })`.

### Story 11.3: End-to-End Request Pipeline with 429/403 Auto-Quarantine, Exponential Backoff & Two-Mode IP Strategy
As a **Reliability Engineer**,
I want **`AbstractApiClient` wire `ProxyIpPool`/`ProxyProvider`, `AdaptiveRateGovernor` và `AccountPool` thành một pipeline rõ ràng: sticky IP cho tài khoản auth-required và rotating IP cho no-auth platforms, tự động cách ly proxy bị chặn và replay request với exponential backoff**,
So that **mọi request đều đi qua proxy đúng chế độ, pipeline không bao giờ bị crash khi nền tảng kích hoạt bảo vệ diện rộng, và không bao giờ fallback về direct connection**.

> **Scope consolidation:** Story này đã hấp thụ Story 11.5 (Two-Mode IP Strategy) và Story 11.6 (Rate-Limit/Bot-Challenge Defense) vì cả hai đều là một phần của pipeline `AbstractApiClient.request()`. Toàn bộ logic quarantine, retry, exponential backoff, account hibernation, standby backoff, governor record/check nằm trong `src/core/base-client.js`.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` được khởi tạo với `proxyPool`/`proxyProvider`, `governor`, `accountPool`, `sessionManager`, `platform`, `requiresAuth`, pluggable `httpClient`
* **When** gọi `request(method, url, options)`
* **Then** hệ thống thực hiện tuần tự:
  1. Xác định `requiresAuth` của platform. Nếu `true` → lấy `accountId`; kiểm tra `governor.canAccountRequest(accountId, platform)`; nếu hibernation thì chuyển account.
  2. Nếu `requiresAuth` → `resolveProxy(accountId)` dùng sticky IP (hoặc `proxyProvider.getProxy({ accountId })`). Nếu `!requiresAuth` → rotating IP (`getNext()` / `getProxy()`).
  3. Gửi request qua proxy agent (`undici.ProxyAgent` / `socks-proxy-agent` / Playwright browser context tùy platform) — không bao giờ direct fallback.
  4. Trả về response 2xx/3xx; ghi nhận `accountPool.recordRequest()` và `governor.recordRequest()`.
  5. Khi gặp HTTP 429 hoặc 403 → `proxyPool.quarantine(proxy, 5 phút)`, exponential backoff (1s, 2s, 4s...) với jitter, retry tối đa `maxProxyRetries`.
  6. Nếu retry hết và platform auth-required → `accountPool.markUnavailable(..., 'rate_limit', ...)` + `governor.hibernateAccount(...)`, sau đó xoay account và retry với account mới (tối đa `maxAccountRotations`).
  7. Nếu toàn bộ proxy bị cách ly → Standby Backoff 30s và throw `ProxyDeadError` thay vì loop vô tận.
* **And** `types/core.d.ts` đồng bộ với constructor/options/properties của `AbstractApiClient`.

### Story 11.4: Adaptive Infrastructure-Aware Rate Limiter & Account Protection Governor (Surface & Backpressure)
As a **Platform Governor & Account Security Engineer**,
I want **hệ thống tự động tính toán Throughput cào dựa trên số lượng Proxy sống, đưa tài khoản vào trạng thái Ngủ đông khi gặp thử thách bảo vệ, và expose trạng thái governor qua API/CLI**,
So that **hệ thống không bị quá tải khi Proxy xoay không kịp và triệt tiêu 100% nguy cơ die tài khoản hàng loạt**.

> **Scope consolidation:** Core `AdaptiveRateGovernor`, `PlatformRateLimit`, `StatusApi`, `AccountPool` integration đã được implement trong `src/core/adaptive-governor.js` và `src/core/account-pool.js`. Story 11.4 còn lại chủ yếu là lớp surface: REST API, CLI, và Redis lag backpressure wiring.

**Acceptance Criteria:**
* **Given** module `AdaptiveRateGovernor` trong `src/core/adaptive-governor.js`
* **When** số lượng Proxy khả dụng trong `ProxyIpPool` thay đổi hoặc tài khoản gặp cảnh báo WAF
* **Then** tự động điều chỉnh tốc độ cào toàn cục: `maxReqPerSecond = healthyProxyCount * platform.baseReqPerSecondPerProxy * platform.throttleFactor` (giảm nhịp 50% nếu proxy sống giảm 50%)
* **And** nếu Proxy sống rơi vào mức báo động (< 5 IPs) ➔ Tự động tạm dừng cào bulk, ưu tiên on-demand queries
* **And** cho auth-required platforms: mỗi tài khoản có token bucket `safeRequestsPerMinute`; tự động đưa tài khoản vào Hibernation 15–30 phút khi gặp Captcha/WAF; `AccountPool` tự động chuyển sang tài khoản tiếp theo khi account hiện tại đạt giới hạn hoặc hibernation
* **And** cho no-auth platforms: tốc độ giới hạn theo proxy/IP, không cần hibernation account; nếu IP bị ban, quarantine và rotate proxy
* **And** hãm tốc độ cào khi hàng đợi Redis Stream `stream:social:raw_posts` vượt quá 10,000 unread messages (Consumer Lag Backpressure)
* **And** cung cấp `GET /governor/status` và CLI `xactions status` trả về `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.

### Story 11.5: End-to-End Request Pipeline (Two-Mode IP Strategy)
As a **Reliability Engineer**,
I want **`AbstractApiClient` wire `ProxyIpPool`, `AdaptiveRateGovernor` và `AccountPool` thành một pipeline rõ ràng: sticky IP cho tài khoản auth-required và rotating IP cho no-auth platforms**,
So that **mọi request đều đi qua proxy đúng chế độ mà không bao giờ fallback về direct connection**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` được khởi tạo với `proxyPool`, `governor`, `accountPool`, `sessionManager` và platform-specific `PlatformResponseValidator`
* **When** gọi `request(method, url, options)`
* **Then** hệ thống thực hiện tuần tự:
  1. Xác định `requiresAuth` **hiệu dụng của action** (`ActionDescriptor.requiresAuth ?? crawler.requiresAuth`). Nếu `true` → lấy `accountId` từ `accountPool.getNextAvailable(platform)`; kiểm tra `governor.canAccountRequest(accountId, platform)`; nếu hibernation thì chuyển account. Nếu `false` → `accountId = null`, bỏ qua `AccountPool` và account velocity check (caller truyền accountId rõ ràng vẫn được tôn trọng — opt-in auth).
  2. Nếu `requiresAuth` hiệu dụng của action → `proxyPool.getStickyProxy(accountId)` (sticky IP cho tài khoản). Nếu `!requiresAuth` → `proxyPool.getNext()` (round-robin / residential rotation per request).
  3. Nếu proxy bị quarantine hoặc `isAllQuarantined()` → Standby Backoff 30s và throw `ProxyDeadError`.
  4. Gửi request qua proxy agent (`undici.ProxyAgent` / `socks-proxy-agent` / Playwright browser context tùy platform).
  5. `governor.recordRequest(accountId)` — ghi nhận request vào sliding window.
  6. `PlatformResponseValidator.isValidPayload(response)` / `isBotChallenge(response)` / `isRateLimit(response)` — parse body dù HTTP status là 200.
* **And** Auth-required requests (theo action-level — ví dụ Facebook `group_posts`/social actions — hoặc platform mặc định như TikTok, Shopee, X, Threads, LinkedIn, TopCV, VietnamWorks) sử dụng sticky IP; no-auth requests (Batdongsan, Chotot, và các action public như Facebook `marketplace`/`search`/`page_posts`/`profile`) sử dụng rotating residential proxy.
* **And** không bao giờ fallback về direct connection khi proxy fail; mọi request phải qua `ProxyIpPool`.

### Story 11.6: Rate-Limit & Bot-Challenge Defense (Quarantine, Retry, Hibernation)
As a **Reliability Engineer**,
I want **hệ thống tự động xử lý 429/403 và WAF/captcha bằng cách cách ly proxy, retry với proxy mới, và đưa tài khoản vào hibernation**,
So that **hệ thống không die hàng loạt khi nền tảng kích hoạt bảo vệ**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` pipeline đã chạy
* **When** nhận `isRateLimit` hoặc HTTP 429/403
* **Then** throw `RateLimitError`, `proxyPool.quarantine(proxy)`, retry tối đa 3 lần với proxy mới và exponential backoff 1s, 2s, 4s.
* **And** khi `isBotChallenge` hoặc WAF/captcha → throw `BotChallengeError`, `proxyPool.quarantine(proxy, 5 phút)`, `governor.hibernateAccount(accountId, 'bot_challenge', 15–30 phút)`, `accountPool.markUnavailable(accountId)` và chuyển sang account/proxy tiếp theo.
* **And** toàn bộ proxy bị quarantine → chuyển Standby Backoff 30s thay vì loop vô tận.

### Story 11.7: Crawler-Governor Integration & Platform Response Validator Contract
As a **Platform Scraper Developer**,
I want **`AbstractCrawler` kiểm tra governor trước mỗi action và một `AbstractPlatformResponseValidator` contract để scraper con tự implement logic nhận diện bot**,
So that **mỗi platform có thể định nghĩa riêng payload hợp lệ, WAF, và rate-limit mà không làm rối core**.

**Acceptance Criteria:**
* **Given** `AbstractCrawler` kế thừa `base-crawler.js`
* **When** gọi `start(command)`
* **Then** crawler gọi `governor.recordRequest()` và kiểm tra `governor.canAccountRequest()` / `governor.getMaxThroughput(platform)` trước mỗi action.
* **And** `src/core/platform-validator.js` định nghĩa `AbstractPlatformResponseValidator` với `isValidPayload(response)`, `isBotChallenge(response)`, `isRateLimit(response)`.
* **And** ít nhất 2 scraper con (Twitter, Facebook) implement `PlatformResponseValidator` riêng.

### Story 11.8: SocksNode Dynamic Residential Proxy Provider
As a **Scale-Out Scraper**,
I want **tích hợp nhà cung cấp proxy SocksNode để lấy residential / 4G-5G mobile proxy theo yêu cầu và xoay IP mỗi request hoặc giữ sticky session**,
So that **tôi có thể dùng SocksNode trong `ProxyIpPool` / `DynamicTunnelProvider` như BrightData/IPRoyal mà không cần tự ghép proxy URL**.

**Acceptance Criteria:**
* **Given** tài khoản SocksNode với `apiKey` hoặc thông tin xác thực
* **When** khởi tạo `SocksNodeProvider` trong `src/proxy/providers.js` (hoặc `src/proxy/providers/socksnode.js`)
* **Then** hệ thống hỗ trợ lấy proxy từ SocksNode (qua API hoặc gateway tĩnh `socks5h://user:pass@gateway.socksnode.io:port`)
* **And** `getProxy({ country, city, session, sticky })` trả về proxy URL hợp lệ
* **And** tương thích với `DynamicTunnelProvider` (xoay IP mỗi request) và `ProxyIpPool.getNext()` / `getStickyProxy(accountId)` (sticky IP)
* **And** sử dụng `socks5h://` để remote DNS resolution
* **And** tự động refresh / rotate session khi proxy bị quarantine
* **And** kiểm tra tính khả dụng của proxy (health check) trước khi trả về.

### Story 11.9: Proactive Proxy TTL Buffer & Auto-Refresh Interceptor
As a **Reliability Engineer**,
I want **`ProxyIpPool` chủ động kiểm tra TTL `expiresAt` và tự động đổi proxy trước khi hết hạn 30s (`expiresAt` buffer)**,
So that **triệt tiêu 100% tình trạng đứt gãy kết nối `ECONNRESET` giữa chừng khi cào dữ liệu lớn**.

**Acceptance Criteria:**
* **Given** cấu trúc `NormalizedProxy` trong `src/proxy/providers.js`
* **When** nhận thông tin proxy từ các dynamic/residential providers
* **Then** bổ sung trường `expiresAt: number | null` (timestamp hết hạn của IP proxy)
* **And** `ProxyIpPool` cung cấp phương thức `isExpired(proxy, bufferMs = 30000)` trả về `true` nếu thời gian sống còn lại $\le 30\text{s}$
* **And** `ProxyIpPool` cung cấp phương thức `getOrRefreshProxy(accountId, options)` tự động lấy IP mới nếu IP hiện tại sắp hết hạn
* **And** `AbstractApiClient` trong `src/core/base-client.js` gọi `getOrRefreshProxy()` trước khi dispatch request
* **And** kiểm tra và xoá sạch bộ đệm proxy đã hết hạn qua `pruneExpiredProxies()`.

---

## Epic 12: Frictionless Authentication (Terminal QR & CDP Attach)

### Story 12.1: Terminal ASCII QR Code Login Module with Countdown & Timeout
As a **CLI User**,
I want **mã QR đăng nhập hiển thị trực tiếp bằng ký tự ASCII chuẩn 1:1 trên Terminal console kèm countdown timer 60s**,
So that **tôi có thể dùng app điện thoại quét mã đăng nhập tức thì mà không bị tràn màn hình hay treo process**.

**Acceptance Criteria:**
* **Given** URL hoặc base64 image của mã QR đăng nhập
* **When** gọi `displayTerminalQrCode(data)` trong `src/utils/qrcode.js`
* **Then** mã QR hiển thị gọn gàng (`small: true` hoặc tự động nhỏ lại khi terminal width < 80 cols) kèm thanh đếm ngược 60s
* **And** vòng lặp nền `checkLoginState()` tự động kiểm tra cookie mỗi 1 giây và tự động hủy timer sau 120s timeout nếu không quét
* **And** phát hiện `process.stdout.isTTY`; nếu non-TTY, in URL + short code và hướng dẫn quét trên thiết bị khác
* **And** hỗ trợ CLI flags `--qr-url`, `--push` (webhook/notification), và `--cdp`
* **And** thông báo lỗi rõ ràng: `[QR EXPIRED] ...`, `[ACCOUNT CHECKPOINTED] ...`
* **And** tự động lưu cookie vào session storage khi đăng nhập thành công và dọn dẹp terminal.

### Story 12.2: CDP Remote Attach Mode with Launch Helper & Gaussian Jitter
As a **Power User**,
I want **kết nối XActions trực tiếp vào Chrome thật của tôi qua cổng 9222 với helper tự mở Chrome và độ trễ ngẫu nhiên Gaussian**,
So that **hệ thống sử dụng nguyên vẹn profile và fingerprint thật của tôi để cào LinkedIn/TopCV mà không bị phát hiện automation**.

**Acceptance Criteria:**
* **Given** lệnh `unfollowx auth --launch-chrome` hoặc Chrome đang mở cổng 9222
* **When** gọi `launchBrowserWithCdp('http://localhost:9222')` trong `src/core/base-crawler.js`
* **Then** Playwright kết nối thành công tới browser instance đang mở mà không spawn process mới
* **And** áp dụng độ trễ phân phối ngẫu nhiên Gaussian Jitter (3–7s) giữa các thao tác cào.

### Story 12.3: Multi-Browser Path Resolution & Advanced Anti-Automation Flags
As a **Power User / Automation Engineer**,
I want **`src/core/cdp-launcher.js` tự động nhận diện Microsoft Edge, Brave, Chromium Canary, Snap Chromium trên Windows, macOS, Linux kèm các cờ bypass anti-bot**,
So that **XActions có thể khởi chạy và kết nối CDP thành công trên mọi máy trạm của người dùng mà không bị WAF phát hiện automation control**.

**Acceptance Criteria:**
* **Given** môi trường hệ điều hành Windows, macOS hoặc Linux
* **When** gọi `resolveBrowserExecutablePath(customPath)` trong `src/core/cdp-launcher.js`
* **Then** tự động quét và kiểm tra tính khả thi của:
  - macOS: `/Applications/Google Chrome.app`, `/Applications/Microsoft Edge.app`, `/Applications/Brave Browser.app`, `/Applications/Google Chrome Canary.app`
  - Windows: `%PROGRAMFILES%`, `%LOCALAPPDATA%` của Chrome, Edge, Brave, Canary
  - Linux: `/usr/bin/google-chrome-stable`, `/usr/bin/chromium-browser`, `/snap/bin/chromium`, `/usr/bin/microsoft-edge-stable`
* **And** tự động quét tìm port debug rảnh từ `startPort = 9222` đến `9322` nếu port 9222 đã bị chiếm
* **And** thêm các cờ khởi chạy anti-detection:
  `--disable-blink-features=AutomationControlled`, `--exclude-switches=enable-automation`, `--disable-infobars`, `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--headless=new`
* **And** dọn dẹp tiến trình an toàn khi có tín hiệu `SIGINT`/`SIGTERM` hoặc process exit.

**Acceptance Criteria:**
* **Given** lệnh `unfollowx auth --launch-chrome` hoặc Chrome đang mở cổng 9222
* **When** gọi `launchBrowserWithCdp('http://localhost:9222')` trong `src/core/base-crawler.js`
* **Then** Playwright kết nối thành công tới browser instance đang mở mà không spawn process mới
* **And** áp dụng độ trễ phân phối ngẫu nhiên Gaussian Jitter (3–7s) giữa các thao tác cào.

---

## Epic 13: High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)

> **Epic grouping note:** This epic is a *platform suite*. Stories 13.2 + 13.2.1–13.2.12 (Twitter) and Stories 13.3–13.10 (Facebook) are independent sub-threads that share the same Tiered Signer foundation (Story 13.1). Each sub-thread can be implemented, tested, and shipped independently; they are grouped here because they both validate the hybrid engine.

### Story 13.1: Tiered Signer Architecture (Pre-Signed Token Ring & Worker Page Pool)
As a **Scraper Architect**,
I want **hệ thống Tiered Signer gồm Pre-Signed Token Ring cho session tokens và Worker Page Pool cho dynamic signatures có timeout 3s**,
So that **các request cần chữ ký mã hóa phức tạp đạt throughput >500 req/s mà không bị nghẽn đơn luồng hay crash process**.

**Acceptance Criteria:**
* **Given** các endpoint yêu cầu dynamic signature (TikTok `a_bogus`, Twitter `x-client-transaction-id`)
* **When** gọi `client.requestWithSign(method, url, payload)` trong `src/core/base-client.js`
* **Then** client lấy token phiên O(1) từ `PreSignedTokenRing` hoặc phân phối tác vụ ký tới `SignerPagePool`
* **And** mọi lệnh evaluate bọc trong `Promise.race()` với timeout 3,000ms
* **And** dispatch HTTP request bằng `got-scraping` (TLS Spoofing) hoặc `undici.fetch()`.

### Story 13.1.2: Tier 0 Pure-Algorithm Crypto Signer Bridge
As a **Scraper Architect / Core Developer**,
I want **bổ sung tầng ký chữ ký thuần thuật toán (Tier 0 Zero-Browser Pure Crypto) vào `src/core/signer-pool.js`**,
So that **các request Twitter, Facebook, Bilibili có thể sinh chữ ký trực tiếp bằng Node.js với tốc độ gấp 100 lần và không tốn RAM chạy headless browser**.

**Acceptance Criteria:**
* **Given** `SignerWorkerPagePool` và `PreSignedTokenRing` trong `src/core/signer-pool.js`
* **When** `AbstractApiClient.requestWithSign` nhận `signType: 'pure_algorithm'` (hoặc auto-detected)
* **Then** hệ thống ưu tiên gọi pure crypto functions viết bằng `node:crypto` / WebAssembly mà không dispatch tới Worker Page
* **And** tích hợp thuật toán sinh `x-client-transaction-id` thuần cho Twitter và hash token thuần cho Facebook
* **And** tự động fallback về Tier 2 (Worker Page Pool) nếu thuật toán pure crypto không hỗ trợ hoặc trả về null
* **And** độ trễ sinh chữ ký Tier 0 đạt $<0.1\text{ms}$ và không tiêu tốn thêm RAM.

### Story 13.2: Refactor Twitter Scraper to Hybrid Architecture
As a **Twitter Growth Marketer**,
I want **cào profile, timeline tweets, và kết quả tìm kiếm Twitter với tốc độ cao**,
So that **tôi có thể thu thập hàng ngàn tweet trong vài giây với lượng RAM tiêu thụ tối thiểu**.

**Acceptance Criteria:**
* **Given** `TwitterCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/social/twitter/index.js`
* **When** thực hiện `search(query)` hoặc `getTimeline(username)`
* **Then** scraper sử dụng `TwitterHttpClient` kết hợp `SignerPagePool` để lấy GraphQL data
* **And** chuẩn hóa dữ liệu trả về theo model `PostItem` với ID Namespaced `twitter:${tweetId}`
* **And** tự động ghi vào `PrismaStore` lưu vào PostgreSQL.
* **And (Deprecation Marker)** gắn `@deprecated` cho toàn bộ `src/client/Scraper.js`, `src/scrapers/twitter/http/index.js`, và `src/scrapers/twitter/index.js` (legacy); ghi nhận trong `docs/deprecation-plan.md` chi tiết từng tính năng được thay thế ở Story 13.2 hoặc Story 13.2.1–13.2.12 để xoá ở Epic 20.2.

### Story 13.2.1: Twitter Hybrid Profile & Relationships
As a **Twitter Growth Marketer**,
I want **cào hồ sơ, followers, following, likers, retweeters, non-followers và thành viên list bằng `TwitterClient`/`TwitterCrawler` kiến trúc hybrid**,
So that **tôi có thể xây dựng audience graph và phân tích mối quan hệ mà không cần mở Puppeteer tab mới**.

**Acceptance Criteria:**
* **Given** `TwitterCrawler` đã có action `profile`, `followers`, `following`, `likers`, `retweeters`, `list_members`
* **When** gọi action với `username`, `tweetId`, `listUrl` tương ứng
* **Then** `TwitterCrawler` dispatch GraphQL request qua `TwitterClient` (HTTP hoặc Signer Page Pool) với sticky proxy
* **And** dữ liệu trả về chuẩn hóa theo `ProfileItem` / `PostItem` với ID Namespaced `twitter:${externalId}`
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing` trong `src/scrapers/twitter/index.js` và các hàm tương ứng trong `src/scrapers/twitter/http/relationships.js`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.2: Twitter Hybrid Thread, Likes & Bookmarks
As a **Twitter Content Researcher**,
I want **cào chi tiết một thread (conversation), danh sách likes của tweet, và bookmarks của tài khoản bằng kiến trúc hybrid**,
So that **tôi có thể phân tích nội dung tweet, engagement và nội dung người dùng đã lưu**.

**Acceptance Criteria:**
* **Given** `TwitterCrawler` đã đăng ký action `thread`, `likes`, `bookmarks`
* **When** gọi `thread({ tweetId/url })`, `likes({ tweetId })`, hoặc `bookmarks({ username, limit })`
* **Then** crawler trích xuất conversation tree, likers, hoặc bookmarked tweets qua GraphQL/HTTP
* **And** thread được chuẩn hóa thành `PostItem[]` với `parentId` đúng; likes/bookmarks trả về `PostItem[]` hoặc `ProfileItem[]`
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeThread`, `scrapeLikes`, `scrapeBookmarks` trong `src/scrapers/twitter/index.js`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.3: Twitter Hybrid Search, Hashtag & Trending
As a **Twitter Market Researcher**,
I want **tìm kiếm toàn cục, theo hashtag, và trending topics bằng kiến trúc hybrid**,
So that **tôi có thể theo dõi xu hướng và tìm nội dung theo keyword/hashtag với độ trễ thấp**.

**Acceptance Criteria:**
* **Given** `TwitterCrawler` đã có `search(args)` (từ Story 13.2) và action `hashtag`, `trending`
* **When** gọi `search({ query, filter, limit })`, `hashtag({ hashtag, filter, limit })`, hoặc `trending({ limit })`
* **Then** crawler sử dụng Twitter GraphQL endpoints với `filter` và pagination cursor
* **And** dữ liệu trả về `PostItem[]` với `metadata.trending` / `metadata.hashtag` khi cần
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `searchTweets`, `scrapeHashtag`, `scrapeTrending` trong `src/scrapers/twitter/index.js`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.4: Twitter Hybrid Media Scraper
As a **Twitter Media Collector**,
I want **cào media (ảnh, video, GIF) từ profile hoặc tweet và tải xuống video Twitter bằng kiến trúc hybrid**,
So that **tôi có thể thu thập và lưu trữ media mà không cần render timeline**.

**Acceptance Criteria:**
* **Given** `TwitterCrawler` đã đăng ký action `media`, `download_video`
* **When** gọi `media({ username, tweetId, type, limit })` hoặc `download_video({ tweetId, quality })`
* **Then** crawler trích xuất media URLs từ GraphQL/HTTP response và hỗ trợ tải về qua stream
* **And** dữ liệu trả về `PostItem[]` với `metadata.media` chứa `type`, `url`, `variants`
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeMedia`, các hàm `downloadMedia`/`getVideoUrl` trong `src/scrapers/twitter/http/media.js`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.5: Twitter Hybrid Lists, Communities & Spaces
As a **Twitter Community Researcher**,
I want **cào thành viên list, thành viên community và danh sách Spaces bằng kiến trúc hybrid**,
So that **tôi có thể theo dõi nhóm người dùng và nội dung audio trực tiếp**.

**Acceptance Criteria:**
* **Given** `TwitterCrawler` đã đăng ký action `list_members`, `community_members`, `spaces`
* **When** gọi `list_members({ listUrl, limit })`, `community_members({ communityUrl, limit })`, `spaces({ query, limit })`
* **Then** crawler dispatch GraphQL request với pagination và chuẩn hóa `ProfileItem[]` / `PostItem[]`
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeListMembers`, `scrapeCommunityMembers`, `scrapeSpaces` trong `src/scrapers/twitter/index.js`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.6: Twitter Hybrid Content Composition (Post, Reply, Quote)
As a **Twitter Content Operator**,
I want **đăng tweet, reply, và quote nội dung qua `TwitterClient` kiến trúc hybrid**,
So that **tôi có thể tự động hóa nội dung mà không cần browser**.

**Acceptance Criteria:**
* **Given** `src/scrapers/social/twitter/` có `TwitterClient` action methods cho `post`, `reply`, `quote`
* **When** gọi `post({ text, mediaIds })`, `reply({ tweetId, text })`, hoặc `quote({ tweetId, text })`
* **Then** mỗi action đi qua `TwitterClient` với `Signer Page Pool` hoặc HTTP GraphQL, tuân thủ delay floor (write: 3–7s) và governor
* **And** dry-run gate mặc định `dryRun=true` cho mọi write action; cookie/token không bị log
* **And** error trả về `PlatformError` với `suggestedAction` (`hibernate_account`, `relogin`, `reduce_rate`)
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `postTweet`, `postThread`, `postReply` trong `src/client/Scraper.js` và `src/scrapers/twitter/http/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.7: Twitter Hybrid Content Scheduling
As a **Twitter Content Operator**,
I want **schedule tweet để đăng tự động trong tương lai qua `TwitterClient` kiến trúc hybrid**,
So that **tôi có thể lập lịch nội dung mà không cần giữ trình duyệt mở**.

**Acceptance Criteria:**
* **Given** `TwitterClient` đã hỗ trợ `post` (Story 13.2.6)
* **When** gọi `schedule({ text, mediaIds, publishAt })`
* **Then** `TwitterClient` tạo draft tweet với lịch đăng, trả về `scheduledAt` và `tweetId` dự kiến
* **And** tuân thủ delay floor (write: 3–7s) và governor
* **And** dry-run gate mặc định `dryRun=true`; cookie/token không bị log
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scheduleTweet` trong `src/client/Scraper.js` và `src/scrapers/twitter/http/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.8: Twitter Hybrid Engagement (Like & Retweet)
As a **Twitter Growth Operator**,
I want **thực hiện like, retweet, undoRetweet, và unlike qua `TwitterClient` kiến trúc hybrid**,
So that **tôi có thể tự động hóa tương tác cơ bản với nội dung theo chiến lược growth**.

**Acceptance Criteria:**
* **Given** `TwitterClient` hỗ trợ action `like`, `unlike`, `retweet`, `undoRetweet`
* **When** gọi các action với `targetId`/`username` và tùy chọn `dryRun`
* **Then** mỗi action đi qua `TwitterClient` với delay floor (engagement: 1–3s giữa các tác vụ), sticky proxy và governor
* **And** dry-run gate mặc định `dryRun=true`; cookie/token không bị log
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `likeTweet`, `retweetTweet` trong `src/client/Scraper.js` và `src/scrapers/twitter/http/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.9: Twitter Hybrid Social Graph (Follow, Block, Mute, Bookmark)
As a **Twitter Growth Operator**,
I want **quản lý mối quan hệ tài khoản (follow, unfollow, block, unblock, mute, unmute, bookmark) qua `TwitterClient` kiến trúc hybrid**,
So that **tôi có thể tự động hóa growth và moderation tài khoản mà không cần browser**.

**Acceptance Criteria:**
* **Given** `TwitterClient` hỗ trợ action `follow`, `unfollow`, `block`, `unblock`, `mute`, `unmute`, `bookmark`
* **When** gọi các action với `targetId`/`username` và tùy chọn `dryRun`
* **Then** mỗi action đi qua `TwitterClient` với delay floor (social: 2–5s giữa các tác vụ), sticky proxy và governor
* **And** `follow`/`unfollow` tuân thủ daily limit (configurable) và anti-chain policy (không follow/unfollow cùng user trong 24h)
* **And** dry-run gate mặc định `dryRun=true`; cookie/token không bị log
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `followUser`, `blockUser`, `muteUser`, `bookmarkTweet` trong `src/client/Scraper.js` và `src/scrapers/twitter/http/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.10: Twitter Hybrid Direct Messaging
As a **Twitter Community Manager**,
I want **gửi và đọc direct message qua `TwitterClient` kiến trúc hybrid**,
So that **tôi có thể tự động hóa outreach một cách an toàn**.

**Acceptance Criteria:**
* **Given** `TwitterClient` hỗ trợ action `sendDM`, `getConversations`
* **When** gọi `sendDM({ userId, text })` hoặc `getConversations({ limit })`
* **Then** DM sử dụng HTTP GraphQL với delay floor 5–15s
* **And** `sendDM` kiểm tra recipient cho phép tin nhắn từ陌生人 trước khi gửi, trả về `PlatformError` với `code: TWITTER_DM_NOT_ALLOWED` nếu bị chặn
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho DM helpers trong `src/client/Scraper.js`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.11: Twitter Hybrid List Management
As a **Twitter Community Manager**,
I want **tạo và quản lý list membership qua `TwitterClient` kiến trúc hybrid**,
So that **tôi có thể tự động hóa list curation mà không cần browser**.

**Acceptance Criteria:**
* **Given** `TwitterClient` hỗ trợ action `createList`, `addListMembers`, `removeListMembers`, `list_members`
* **When** gọi `createList({ name, description })`, `addListMembers({ listId, userIds })`, hoặc `removeListMembers({ listId, userIds })`
* **Then** list actions sử dụng GraphQL với batch chunking 100 userIds
* **And** dry-run gate mặc định `dryRun=true` cho write actions; cookie/token không bị log
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho list helpers trong `src/client/Scraper.js`; cập nhật `docs/deprecation-plan.md`.

### Story 13.2.12: Twitter Hybrid Integration & Caller Migration
As a **XActions Platform Engineer**,
I want **`scrape('twitter'|'x', ...)`, MCP/CLI tools và `src/client/Scraper.js` chuyển sang dùng `TwitterCrawler`/`TwitterClient` mới**,
So that **người dùng cuối và các service không còn phụ thuộc legacy Twitter modules**.

**Acceptance Criteria:**
* **Given** `TwitterCrawler` hỗ trợ đủ action (`profile`, `timeline`, `search`, `followers`, `following`, `thread`, `likes`, `bookmarks`, `hashtag`, `trending`, `media`, `list_members`, `community_members`, `spaces`, và social actions)
* **When** kiểm tra `src/scrapers/index.js`
* **Then** platform `twitter`/`x` import từ `src/scrapers/social/twitter/index.js` thay vì `src/scrapers/twitter/index.js`
* **And** `package.json` exports thêm `./scrapers/social` hoặc `./scrapers/twitter` để consumer truy cập `TwitterClient`/`TwitterCrawler`
* **And** `src/client/Scraper.js` được đánh dấu `@deprecated` hoặc redirect sang `TwitterClient`; các hàm legacy trong `src/scrapers/twitter/http/` và `src/scrapers/twitter/index.js` được ghi `@deprecated` toàn bộ
* **And** `tests/scrapers/twitter-*.test.js` chuyển sang test `TwitterCrawler` tương ứng hoặc được đánh dấu `@deprecated`
* **And (Scope & Deprecation Marker)** cập nhật `docs/deprecation-plan.md` status tracker sang `deprecated-planned` cho toàn bộ Twitter legacy và ghi rõ dependency vào Story 13.2.12.

### Story 13.3: Refactor Facebook Scraper to Hybrid Architecture
As a **Facebook Community Marketer**,
I want **cào bài viết nhóm và trang Facebook qua DocID GraphQL requests và Proxy Pool**,
So that **tôi có thể theo dõi cộng đồng với độ trễ thấp và không bị checkpoint IP**.

**Acceptance Criteria:**
* **Given** `FacebookCrawler` kế thừa `AbstractCrawler` trong `src/scrapers/social/facebook/index.js`
* **When** thực hiện `getGroupPosts(groupId)` hoặc `getPagePosts(pageId)`
* **Then** scraper dispatch request qua GraphQL endpoints với `ProxyIpPool`
* **And** chuẩn hóa dữ liệu trả về theo model `PostItem` với ID Namespaced `facebook:${postId}`
* **And** tương thích hoàn toàn với session cookie đã mã hóa trong database.
* **And** action `group_posts` khai báo `requiresAuth: true` (nhóm kín — account từ pool + Sticky Residential Proxy cố định suốt session); action `page_posts` khai báo `requiresAuth: false` (fanpage public — guest token `lsd`/`jazoest` từ Pre-Signed Ring + Rotating Residential Proxy xoay per-request, không rút account pool).
* **And (Scope & Deprecation Marker)** story này chỉ làm group/page posts; các tính năng còn lại (search, comments, marketplace, messenger, profile/followers/group-members, automation) sẽ được chuyển sang kiến trúc hybrid trong Story 13.5–13.10. Gắn `@deprecated` cho `src/scrapers/facebook/` (legacy) và ghi nhận trong `docs/deprecation-plan.md` để xoá ở Epic 20.2.

### Story 13.4: Facebook Browser-as-Signer Integration
As a **Facebook Scraper Operator**,  
I want **`FacebookClient` to extract `lsd`, `fb_dtsg`, `jazoest`, and `spin` tokens from a real Chrome browser instead of only HTML regex**,  
So that **token extraction is resilient to Facebook DOM/script changes, supports authenticated user profiles, and falls back to the existing HTTP path when no browser signer is configured**.

**Acceptance Criteria:**
* **Given** `FacebookClient` accepts `signerPool`, `tokenRing`, `cdpUrl`, and `adapterName`
* **When** `ensureTokens()` is called with a browser bridge configured
* **Then** it attaches or launches Chrome (Playwright by default, Puppeteer via `XACTIONS_SCRAPER_ADAPTER`) using CDP, navigates to `https://www.facebook.com/`, and extracts tokens via `page.evaluate()`
* **And** it caches tokens with a 5-minute TTL and supports refresh 30 seconds before expiry
* **And** `requestGraphQl()` builds the GraphQL body using tokens from the signer bridge
* **And** it falls back to HTTP-only regex extraction when `signerPool`/`cdpUrl` is not configured
* **And** it launches Chrome with the per-account sticky proxy and anti-leak browser args
* **And (Scope Marker)** all changes remain inside `src/scrapers/social/facebook/` and `src/core/cdp-launcher.js`; `src/core/base-client.js` and `src/core/signer-pool.js` are not modified.

### Story 13.5: Facebook Hybrid Profile, Followers & Group Members
As a **Facebook Growth Marketer**,
I want **cào thông tin hồ sơ, danh sách followers, và thành viên nhóm Facebook qua kiến trúc hybrid mà không cần mở Puppeteer tab mới cho mỗi yêu cầu**,
So that **tôi có thể thu thập dữ liệu cá nhân/cộng đồng với tốc độ cao và tiêu thụ tài nguyên thấp**.

**Acceptance Criteria:**
* **Given** `FacebookCrawler` đã kế thừa `AbstractCrawler` trong `src/scrapers/social/facebook/index.js`
* **When** thực hiện các action `profile`, `followers`, `group_members`
* **Then** `FacebookCrawler` dispatch request qua `FacebookClient` (HTTP GraphQL) hoặc `FacebookBrowserBridge` (CDP) tùy theo endpoint ổn định
* **And** dữ liệu trả về được chuẩn hóa theo model `PostItem` (profile) / `CommentItem` / `ProfileItem` với ID Namespaced `facebook:${externalId}`
* **And** các tham số `url`/`username`/`groupUrl` được parse thành `targetKey` cho `CrawlerCommand`
* **And** action `profile` (public) khai báo `requiresAuth: false` — chạy guest token + rotating residential proxy xoay per-request; `group_members` và `followers`/`following` giữ `requiresAuth: true` (fallback platform) — account từ pool + sticky residential proxy.
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeGroupMembers` trong `src/scrapers/facebook/legacy.js` (hoặc file tương ứng); cập nhật `docs/deprecation-plan.md`.

### Story 13.6: Facebook Hybrid Search (Global + Group Search)
As a **Facebook Market Researcher**,
I want **tìm kiếm toàn cục (posts/people/pages/groups) và tìm kiếm trong nhóm bằng kiến trúc hybrid**,
So that **tôi có thể thu thập nhiều loại đối tượng với cùng một contract `search()` nhất quán trên mọi nền tảng**.

**Acceptance Criteria:**
* **Given** `FacebookCrawler` đã có `search(args)` và `registerAction('group_search')`
* **When** gọi `search({ query, type, location, limit })` với `type ∈ ['posts','people','pages','groups','all']` hoặc `group_search({ groupUrl, query, limit })`
* **Then** `FacebookCrawler` chọn DocID GraphQL hoặc browser fallback phù hợp với từng `type`
* **And** dữ liệu trả về được chuẩn hóa qua `normalizeSearchResult`, `normalizePostSearchResult`, `normalizePeopleSearchResult`, `normalizePageSearchResult`, `normalizeGroupSearchResult` (hoặc tương đương mới) với ID Namespaced
* **And** hỗ trợ `limit` và pagination cursor như `AbstractCrawler` action output
* **And** action `search` (global) khai báo `requiresAuth: false` — guest token + rotating residential proxy xoay per-request; `group_search` giữ `requiresAuth: true` (ngữ cảnh nhóm kín, fallback platform).
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `searchFacebook`, `scrapeFacebookGroupSearch` trong `src/scrapers/facebook/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.7: Facebook Hybrid Post & Group Comments
As a **Facebook Sentiment Researcher**,
I want **cào cây bình luận từ bài viết cá nhân/trang và bài viết nhóm bằng kiến trúc hybrid**,
So that **tôi có thể phân tích sentiment và cấu trúc hội thoại với dữ liệu đầy đủ, không bị mất reply lồng nhau**.

**Acceptance Criteria:**
* **Given** `FacebookCrawler` đã đăng ký action `post_comments` và `group_comments`
* **When** gọi `post_comments({ url, maxDepth, maxComments, includeReplies })` hoặc `group_comments({ url, maxDepth, maxComments, includeReplies })`
* **Then** crawler trích xuất `postId`/`feedbackId` từ URL, gọi `FacebookClient` GraphQL hoặc `FacebookBrowserBridge` nếu cần
* **And** dữ liệu trả về theo `CommentItem` với `parentCommentId` đúng, hỗ trợ topological sort và lưu batch qua `PrismaStore`
* **And** `includeReplies` bật/tắt được xử lý đúng
* **And** `post_comments` và `group_comments` giữ `requiresAuth: true` (fallback platform — use case chính là bài viết trong nhóm kín): account từ pool + sticky residential proxy.
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeFacebookComments`, `scrapeFacebookGroupComments` trong `src/scrapers/facebook/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.8: Facebook Hybrid Marketplace
As a **Facebook Marketplace Researcher**,
I want **tìm kiếm và cào danh sách sản phẩm trên Facebook Marketplace qua kiến trúc hybrid**,
So that **tôi có thể theo dõi giá, sản phẩm và seller mà không bị giới hạn bởi Puppeteer rendering**.

**Acceptance Criteria:**
* **Given** `FacebookCrawler` đã đăng ký action `marketplace`
* **When** gọi `marketplace({ query, location, category, priceMin, priceMax, limit })`
* **Then** crawler sử dụng `FacebookClient` hoặc `FacebookBrowserBridge` để lấy listing data
* **And** dữ liệu được chuẩn hóa theo `PostItem`/`MarketplaceItem` với `metadata` JSON (price, location, seller, category)
* **And** hỗ trợ `limit` và pagination
* **And** action `marketplace` khai báo `requiresAuth: false`: chỉ dùng guest token `lsd`/`jazoest` từ Pre-Signed Token Ring + Rotating Residential Proxy xoay per-request (`DynamicTunnelProvider` sinh session ngẫu nhiên cho từng request); KHÔNG rút tài khoản từ `AccountPool`, không kiểm tra `governor.canAccountRequest` cho action này.
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeMarketplace` trong `src/scrapers/facebook/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.9: Facebook Hybrid Social Actions (Write & Messenger)
As a **Facebook Automation Operator**,
I want **thực hiện các hành động viết (like, comment, post, share, messenger-share) trên Facebook thông qua kiến trúc hybrid thay vì legacy Puppeteer**,
So that **các hành động tương tác được quản lý bởi `FacebookClient`, sticky proxy, governor và error envelope chuẩn**.

**Acceptance Criteria:**
* **Given** `src/scrapers/social/facebook/` có thêm `FacebookActions` (hoặc `FacebookClient` action methods) cho các thao tác viết
* **When** gọi các action `like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`
* **Then** mỗi action đi qua `FacebookClient` với `cdpUrl`/`launchChrome` (nếu cần DOM) hoặc HTTP GraphQL (nếu endpoint ổn định)
* **And** tất cả write action tuân thủ dry-run gate, delay floor, và `AdaptiveGovernor`
* **And** cookie/token không bị log; error trả về `PlatformError` với `suggestedAction`
* **And** toàn bộ social actions (`like`, `comment`, `post`, `share`, `messenger_share`, `share_link_uid`, `join_group`, `send_friend_request`) khai báo/tự fallback `requiresAuth: true`: BẮT BUỘC account từ `AccountPool` + Sticky Residential Proxy cố định theo accountId trong suốt session (chống checkpoint do IP nhảy); thiếu account trả error envelope `XACT_4010` với `suggestedAction: 'relogin'`.
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `shareLinkByUid.js`, `messengerQueue.js`, `messengerShare.js`, `graphqlSend.js` trong `src/scrapers/facebook/`; cập nhật `docs/deprecation-plan.md`.

### Story 13.10: Facebook Hybrid Integration & Caller Migration
As a **XActions Platform Engineer**,
I want **`scrape('facebook', ...)` public API, MCP/CLI tools, và `api/services/*` chuyển sang sử dụng `FacebookCrawler`/`FacebookClient` mới**,
So that **người dùng cuối và các service nội bộ không còn phụ thuộc `src/scrapers/facebook/` legacy**.

**Acceptance Criteria:**
* **Given** `FacebookCrawler` hỗ trợ đủ action (`profile`, `posts`, `followers`, `search`, `marketplace`, `group_posts`, `group_comments`, `post_comments`, `group_search`, `group_members`, và social actions)
* **When** kiểm tra `src/scrapers/index.js`
* **Then** platform `facebook`/`fb` import từ `src/scrapers/social/facebook/index.js` (hoặc adapter tương đương) thay vì `src/scrapers/facebook/index.js`
* **And** `package.json` exports thêm `./scrapers/social` hoặc `./scrapers/facebook` để consumer truy cập `FacebookClient`/`FacebookCrawler`
* **And** `api/services/facebookScrape.js`, `facebookAutomation.js`, `facebookAccountPool.js`, `facebookHealth.js` được refactor để gọi `FacebookCrawler.start()` / `FacebookClient` thay vì các hàm legacy
* **And** `api/routes/facebook.js` validation vẫn chấp nhận cùng action set; response shape không đổi với consumer
* **And** action discovery qua `FacebookCrawler.listActions()`, MCP `x_actions_list` và CLI `xactions actions --platform facebook` trả về `requiresAuth` đã phân giải cho từng action (additive, không break consumer hiện có).
* **And** toàn bộ test `tests/scrapers/facebook-index.test.js`, `tests/scrapers/facebook-*.test.js` chuyển sang test `FacebookCrawler` tương ứng hoặc được đánh dấu `@deprecated`
* **And (Scope & Deprecation Marker)** `src/scrapers/facebook/` được đánh dấu `@deprecated` toàn bộ; `docs/deprecation-plan.md` status tracker cập nhật sang `deprecated-planned` và ghi rõ dependency vào Story 13.10.

---

## Epic 14: Deep Conversation Scraper, MCP Daemon & Nowing Event Stream

### Story 14.1: Hierarchical Comment Tree Extraction with Topological Sort
As an **AI Persona / Sentiment Researcher**,
I want **cào toàn bộ cây bình luận phân cấp và lưu vào PostgreSQL theo thứ tự Topological Sort**,
So that **tôi nắm bắt trọn vẹn ngữ cảnh tranh luận mà không bị lỗi Foreign Key violation hay Deadlock CSDL**.

**Acceptance Criteria:**
* **Given** một `postId` từ Twitter hoặc Facebook
* **When** gọi `getComments(postId, { maxDepth: 3, maxComments: 500 })`
* **Then** scraper cào tuần tự root comments và đệ quy phân trang lấy toàn bộ sub-replies
* **And** kiểm tra chống tham chiếu vòng (`parentCommentId !== id`)
* **And** thực hiện Topological Sort: Lưu toàn bộ RootComments trước, sau đó lưu SubComments theo tầng `depth` tăng dần vào PostgreSQL qua `PrismaStore`.

### Story 14.2: MCP Tool Exporters & Daemon HTTP/SSE Server
As an **AI Agent (Claude / Antigravity / Cursor)**,
I want **XActions MCP Server chạy thường trực dạng Daemon HTTP/SSE (Port 3001) trả về 3-Layer JSON Envelope và tự động xuất File Artifact khi dữ liệu >100 records**,
So that **Nowing và AI Agent có thể gọi tool với độ trễ <2ms mà không phải spawn subprocess `node`**.

**Acceptance Criteria:**

#### Daemon server
* **Given** `src/mcp/server.js` đã có HTTP transport trên port 3001 với `/health` endpoint
* **When** bổ sung 3-Layer JSON Envelope, action discovery, và auto-artifact vào cùng một server
* **Then** không tạo thêm daemon process riêng; `src/mcp/server.js` tiếp tục lắng nghe trên `http://localhost:3001/mcp` và `GET /health` vẫn trả về 200
* **And** script `npm run mcp` (nếu cần) khởi động HTTP transport khi `MCP_TRANSPORT=http`

#### JSON Envelope & Artifact
* **Given** Daemon MCP Server đang chạy
* **When** AI Agent hoặc Nowing gọi tool `x_crawl_post`, `x_crawl_comments_tree` qua HTTP/SSE
* **Then** response trả về JSON Envelope chuẩn: `{ success, platform, meta, data (top 20-30), summary, error? }` với độ trễ phản hồi < 2ms
* **And** nếu tổng số records > 100 ➔ Tự động lưu file dataset JSONL và trả về trường `meta.datasetArtifactPath` để AI đọc chọn lọc.

#### Action discovery
* **Given** `AbstractCrawler.listActions()` đã tồn tại
* **When** gọi tool `x_actions_list`
* **Then** trả về `ActionDescriptor[]` với `{ action, description, requiredArgs, optionalArgs, example, outputType, requiresAuth }`.

#### Error envelope
* **Given** bất kỳ tool nào gặp lỗi
* **When** hệ thống trả response
* **Then** error envelope chuẩn hóa: `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.

#### CLI daemon commands & legacy mapping
* **Given** CLI `xactions` và legacy `unfollowx`
* **When** gọi `xactions daemon status/start/stop`
* **Then** CLI quản lý vòng đời daemon MCP
* **And** legacy CLI commands `unfollowx` được map vào `CrawlerCommand` hoặc trả error `suggestedAction: 'use_x_actions_list'`.

### Story 14.3: Realtime Thin Event Redis Stream for Nowing AI Lead Hub
As a **Nowing Platform Orchestrator**,
I want **dữ liệu cào từ XActions được phát tức thì dưới dạng Thin Event Pointer vào Redis Stream `stream:social:raw_posts`**,
So that **Nowing backend có thể chạy background NLP Intent Extractor theo thời gian thực mà không làm tràn bộ nhớ Redis**.

**Acceptance Criteria:**
* **Given** cấu hình `REDIS_STREAM_ENABLED=true`
* **When** bất kỳ crawler nào hoàn tất cào một batch bài viết/bình luận
* **Then** phát event `XADD stream:social:raw_posts MAXLEN ~ 1000000 * payload <json>` (hoặc `MINID` theo thời gian, configurable)
* **And** payload chỉ chứa Thin Event: `{ id, platform, externalId, category, authorId, crawledAt, storageRef }`.
* **And** `GET /metrics/stream` trả về `{ eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, minId }`.
* **And** cảnh báo khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s` qua webhook/email.
* **And** log `throttle_reason: redis_lag` khi governor giảm nhịp do consumer lag.

### Story 14.4: Real-Time N-Gram Keyword & Hashtag Frequency Analytics Engine
As an **AI Agent / Market Researcher**,
I want **module `src/analytics/word-frequency.js` và MCP tool `x_analytics_buzzwords`**,
So that **tôi nhận được ngay bảng phân tích Top từ khóa/hashtag thịnh hành từ các bài viết và bình luận vừa cào mà không cần chờ downstream NLP pipeline**.

**Acceptance Criteria:**
* **Given** tập dữ liệu `PostItem[]` hoặc `CommentItem[]` vừa được trích xuất
* **When** gọi `extractKeywordFrequency(items, { minLength, topN, lang, removeStopwords })`
* **Then** hệ thống thực hiện tokenize, lọc stopwords đa ngôn ngữ (hỗ trợ Tiếng Việt & Tiếng Anh từ `src/analytics/stopwords/`)
* **And** tính toán phân phối tần suất N-gram (Unigram, Bigram) và trích xuất danh sách Hashtags
* **And** cung cấp MCP tool `x_analytics_buzzwords` và CLI `xactions analytics buzzwords` trả về Top N keywords/hashtags có số lần xuất hiện cao nhất
* **And** tích hợp tùy chọn `includeBuzzwords: true` trong `AbstractCrawler` output summary.

---

## Epic 15: Vietnam Viral Social — Threads & TikTok Scraper Engine

> **Epic grouping note:** This epic is a *platform suite*. Stories 15.1 + 15.1.1–15.1.4 (Threads) and Story 15.2 (TikTok) are independent sub-threads in the Vietnam viral-social domain. They share operational patterns (anti-bot, TLS/JA4 spoofing, PrismaStore) but can be implemented and shipped independently.

### Story 15.1: Threads Scraper Adapter (Meta Internal GraphQL)
As a **Viral Marketer & Trend Researcher**,
I want **cào bài viết, timeline và bình luận trên mạng xã hội Threads**,
So that **tôi có thể nắm bắt các chủ đề nóng và drama thịnh hành của giới trẻ Việt Nam**.

**Acceptance Criteria:**
* **Given** `ThreadsCrawler` trong `src/scrapers/social/threads/index.js` kế thừa `AbstractCrawler`
* **When** gọi `search(query)` hoặc `getUserFeed(username)`
* **Then** crawler sử dụng `ThreadsClient` dispatch request GraphQL với token `lsd` từ Token Ring và `doc_id` của Meta
* **And** trích xuất danh sách bài viết chuẩn hóa theo schema `PostItem` (`platform: 'threads'`, `id: 'threads:${id}'`)
* **And** lưu trữ thành công vào PostgreSQL.
* **And (Scope & Deprecation Marker)** story này làm `getUserFeed(username)`, `search(query)` (với SSR fallback), và `get_post_comments(postId)`; profile/followers/following, post detail, search/comments doc_id thực, và dispatcher/service migration sẽ được chuyển sang Story 15.1.1–15.1.4. Gắn `@deprecated` cho `src/scrapers/threads/index.js` (Puppeteer legacy); ghi nhận trong `docs/deprecation-plan.md` để xoá ở Epic 20.2.

### Story 15.1.1: Threads Hybrid Profile & Followers/Following
As a **Threads Trend Researcher**,
I want **cào hồ sơ, followers và following của một tài khoản Threads bằng `ThreadsCrawler` kiến trúc hybrid**,
So that **tôi có thể phân tích mạng lưới người dùng và tìm influencer mà không cần Puppeteer**.

**Acceptance Criteria:**
* **Given** `ThreadsCrawler` đã đăng ký action `profile`, `followers`, `following`
* **When** gọi `profile({ username })`, `followers({ username, count })`, hoặc `following({ username, count })`
* **Then** crawler sử dụng `ThreadsClient` GraphQL (hoặc HTTP SSR fallback nếu doc_id chưa có) để lấy dữ liệu
* **And** dữ liệu trả về chuẩn hóa theo `ProfileItem` với ID Namespaced `threads:${userId}`
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing` trong `src/scrapers/threads/index.js`; cập nhật `docs/deprecation-plan.md`.

### Story 15.1.2: Threads Hybrid Post Detail & Comment Tree
As a **Threads Content Analyst**,
I want **cào chi tiết một thread (nội dung + cây trả lời) bằng kiến trúc hybrid**,
So that **tôi có thể phân tích toàn bộ conversation mà không bị mất reply lồng nhau**.

**Acceptance Criteria:**
* **Given** `ThreadsCrawler` đã đăng ký action `post_detail` và `get_post_comments` (đã có từ 15.1)
* **When** gọi `post_detail({ postId/url, includeReplies, maxDepth, maxComments })`
* **Then** crawler trích xuất post content, thread chain và replies qua `ThreadsClient` GraphQL/HTTP
* **And** dữ liệu trả về `PostItem` cho root post và `CommentItem[]` cho cây trả lời, với `parentCommentId` đúng
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho logic `scrapeThread` trong `src/scrapers/threads/index.js`; cập nhật `docs/deprecation-plan.md`.

### Story 15.1.3: Threads Hybrid DocID Hardening for Search & Comments
As a **Threads Platform Engineer**,
I want **thay thế SSR fallback của `search` và `get_post_comments` bằng GraphQL `doc_id` ổn định**,
So that **crawler không phụ thuộc HTML parsing dễ vỡ và đạt throughput cao hơn**.

**Acceptance Criteria:**
* **Given** `ThreadsCrawler` đang sử dụng `DEFAULT_THREADS_DOC_IDS` với `SEARCH_POSTS`, `COMMENT_ROOTS`, `COMMENT_REPLIES` là `null`
* **When** reverse-engineer hoặc cập nhật các doc_id từ Meta GraphQL endpoints
* **Then** `searchPosts` ưu tiên GraphQL khi `SEARCH_POSTS` có giá trị; SSR fallback chỉ dùng khi GraphQL fail/quarantine
* **And** `getPostComments` ưu tiên `COMMENT_ROOTS`/`COMMENT_REPLIES`; `POST_DETAIL` làm fallback cuối
* **And** thêm test để xác nhận GraphQL path trả về kết quả đầy đủ, không rỗng
* **And (Scope & Deprecation Marker)** cập nhật `docs/deprecation-plan.md` ghi rõ `search` và `comments` đã harden.

### Story 15.1.4: Threads Hybrid Integration & Package Exports
As a **XActions Platform Engineer**,
I want **`scrape('threads', ...)`, MCP/CLI tools và các caller cũ chuyển sang `ThreadsCrawler`/`ThreadsClient` mới**,
So that **người dùng cuối không còn phụ thuộc `src/scrapers/threads/` legacy**.

**Acceptance Criteria:**
* **Given** `ThreadsCrawler` hỗ trợ đủ action (`get_user_feed`, `search`, `post_detail`, `get_post_comments`, `profile`, `followers`, `following`)
* **When** kiểm tra `src/scrapers/index.js`
* **Then** platform `threads` import từ `src/scrapers/social/threads/index.js` thay vì `src/scrapers/threads/index.js`
* **And** `package.json` exports thêm `./scrapers/threads` hoặc `./scrapers/social` để consumer truy cập `ThreadsClient`/`ThreadsCrawler`
* **And** `tests/scrapers/threads-*.test.js` chuyển sang test `ThreadsCrawler` tương ứng hoặc được đánh dấu `@deprecated`
* **And (Scope & Deprecation Marker)** cập nhật `docs/deprecation-plan.md` status tracker sang `deprecated-planned` cho toàn bộ Threads legacy và ghi rõ dependency vào Story 15.1.4.

### Story 15.2: TikTok Video, Hashtag & Comment Scraper with Anti-Bot Payload Validation
As a **Short-Form Content Creator / E-commerce Researcher**,
I want **cào video trending và hàng ngàn bình luận trên TikTok có kiểm tra mã chặn False 200 OK**,
So that **tôi có thể phân tích xu hướng video mà không lưu phải dữ liệu rỗng khi bị chặn ngầm**.

**Acceptance Criteria:**
* **Given** `TikTokCrawler` trong `src/scrapers/social/tiktok/index.js`
* **When** gọi `getHashtagFeed(tag)` hoặc `getVideoComments(videoId)`
* **Then** crawler sử dụng `SignerPagePool` để sinh dynamic query params `a_bogus` và `msToken`
* **And** kiểm tra payload: Nếu `error !== 0` hoặc feed rỗng bất thường ➔ Throw `RateLimitError` để xoay IP
* **And** lưu trữ video và bình luận vào PostgreSQL.

---

## Epic 16: E-Commerce Multi-Platform Scrapers (Shopee & TikTok Shop)

> **Epic grouping note:** This epic is a *platform suite*. Stories 16.1 (Shopee) and 16.2 (TikTok Shop) are independent e-commerce platform crawlers. They are grouped under one epic because they share the same e-commerce domain and operational rollout for Vietnam market intelligence.

### Story 16.1: Shopee Search, Product & Review Scraper with TLS Spoofing
As an **E-Commerce Merchant / Data Analyst**,
I want **cào danh mục sản phẩm, flash sale, giá bán và đánh giá từ Shopee Việt Nam qua TLS Spoofing**,
So that **tôi có thể phân tích đối thủ cạnh tranh mà không bị chặn bởi Akamai WAF**.

**Acceptance Criteria:**
* **Given** `ShopeeCrawler` trong `src/scrapers/ecom/shopee/index.js`
* **When** gọi `searchProducts(keyword)` hoặc `getProductReviews(itemid, shopid)`
* **Then** scraper gọi Shopee Web Search API qua `got-scraping` (TLS/JA4 Spoofing) và `ProxyIpPool`
* **And** kiểm tra anti-bot captcha code (`90309999`) ➔ Tự động xoay proxy nếu bị challenge
* **And** lưu trữ chuẩn hóa theo `PostItem` (`platform: 'shopee'`, `category: 'ecom'`, `metadata: { price, soldCount, rating }`).

### Story 16.2: TikTok Shop Product & Sales Scraper
As a **TikTok Affiliate & Merchant**,
I want **cào dữ liệu sản phẩm bán chạy và hoa hồng affiliate trên TikTok Shop**,
So that **tôi có thể phát hiện các sản phẩm Winning Products để chạy quảng cáo**.

**Acceptance Criteria:**
* **Given** `TikTokShopCrawler` trong `src/scrapers/ecom/tiktok-shop/index.js`
* **When** gọi `getTopSellingProducts(category)`
* **Then** crawler cào dữ liệu qua Web API kết hợp dynamic signing từ Signer Pool
* **And** trích xuất giá, doanh số, shop rating và lưu vào PostgreSQL.

---

## Epic 17: Real Estate & Procurement Intelligence (Chợ Tốt & Batdongsan)

> **Epic grouping note:** This epic is a *platform suite*. Stories 17.1 (Chợ Tốt) and 17.2 (Batdongsan) are independent real-estate crawlers. They are grouped because both serve the Vietnam real-estate lead-intelligence domain.

### Story 17.1: Chợ Tốt Multi-Category Scraper with Phone Mask Detector
As a **Real Estate Broker / Lead Generator**,
I want **cào tin đăng BĐS trên Chợ Tốt kèm giải mã số điện thoại và loại bỏ số masked (`***`)**,
So that **Nowing AI Lead Hub nhận được 100% số điện thoại chính chủ chất lượng cao**.

**Acceptance Criteria:**
* **Given** `ChototCrawler` trong `src/scrapers/realestate/chotot/index.js`
* **When** gọi `searchListings({ category: 'nha-dat', region: 'tp-ho-chi-minh' })`
* **Then** scraper gọi API gateway của Chợ Tốt lấy tin đăng và gọi endpoint giải mã SĐT
* **And** kiểm tra SĐT: Nếu chứa ký tự `*` hoặc không khớp regex SĐT Việt Nam ➔ Bỏ qua số masked và xoay account
* **And** lưu tin đăng kèm SĐT vào `Post.metadata` trong PostgreSQL và phát Thin Event tới Nowing.

### Story 17.2: Batdongsan.com.vn Property Scraper
As an **Investor**,
I want **cào tin rao BĐS dự án và giá đất trên Batdongsan.com.vn**,
So that **tôi có thể theo dõi biến động thị trường theo từng quận/huyện**.

**Acceptance Criteria:**
* **Given** `BatdongsanCrawler` trong `src/scrapers/realestate/batdongsan/index.js`
* **When** gọi `scrapeCategory(url)`
* **Then** scraper cào dữ liệu qua HTTP Client với User-Agent rotation và Proxy Pool
* **And** bóc tách diện tích, mức giá/m2, vị trí và lưu vào `Post.metadata` trong PostgreSQL.

---

## Epic 18: HR & B2B Recruitment Crawlers (TopCV, VietnamWorks & LinkedIn)

> **Epic grouping note:** This epic is a *platform suite*. Stories 18.1 (TopCV), 18.2 (VietnamWorks), and 18.3 (LinkedIn) are independent recruitment crawlers. They are grouped because they serve the Vietnam HR and B2B lead-intelligence domain, but each platform can be implemented and shipped independently.

### Story 18.1: TopCV Job & Company Scraper
As an **HR Tech Recruiter**,
I want **cào tin tuyển dụng, kỹ năng yêu cầu và dải lương trên TopCV**,
So that **tôi có thể nắm bắt xu hướng tuyển dụng thị trường IT và tài chính tại Việt Nam**.

**Acceptance Criteria:**
* **Given** `TopCvCrawler` trong `src/scrapers/recruitment/topcv/index.js`
* **When** gọi `searchJobs(keyword)`
* **Then** crawler cào tin tuyển dụng, parse an toàn dải lương (xử lý trường hợp "Thỏa thuận")
* **And** lưu trữ chuẩn hóa theo `PostItem` (`platform: 'topcv'`, `category: 'recruitment'`, `metadata: { salaryMin, salaryMax, skills }`).

### Story 18.2: VietnamWorks Job Scraper
As a **Headhunter**,
I want **cào tin tuyển dụng cấp trung và cao cấp trên VietnamWorks**,
So that **tôi có thể tìm kiếm cơ hội tuyển dụng cho ứng viên**.

**Acceptance Criteria:**
* **Given** `VietnamWorksCrawler` trong `src/scrapers/recruitment/vietnamworks/index.js`
* **When** gọi `searchJobs({ keyword, city })`
* **Then** scraper gọi API public của VietnamWorks lấy danh sách công việc và JD chi tiết
* **And** tự động làm mới public guest token nếu nhận mã 401.

### Story 18.3: LinkedIn B2B Lead & Job Scraper (via CDP Remote Attach & Gaussian Jitter)
As a **B2B Sales Director**,
I want **cào thông tin công ty và nhân sự chủ chốt trên LinkedIn qua CDP Attach với độ trễ Gaussian Jitter (3–7s)**,
So that **tôi có thể tạo danh sách khách hàng doanh nghiệp B2B chất lượng cao mà không bị khóa tài khoản**.

**Acceptance Criteria:**
* **Given** `LinkedInCrawler` trong `src/scrapers/recruitment/linkedin/index.js`
* **When** kết nối qua CDP Remote Attach (Port 9222) vào Chrome thật của người dùng
* **Then** crawler sử dụng phiên đăng nhập LinkedIn có sẵn để cào thông tin profile, title, company
* **And** áp dụng Gaussian delay ngẫu nhiên (3–7s) và kiểm tra màn hình checkpoint challenge
* **And** lưu trữ vào PostgreSQL.

---

## Epic 19: Internal Operator Dashboard, Admin CLI & Operational Observability

### Story 19.1: Dashboard Jobs & Checkpoints View
As an **Operations Manager**,
I want **một dashboard view hiển thị toàn bộ jobs crawl, checkpoints, trạng thái resume/pause/failed và tiến độ last cursor/timestamp**,
So that **tôi có thể giám sát và điều khiển pipeline cào mà không cần gõ lệnh terminal**.

**Acceptance Criteria:**
* **Given** internal operator dashboard Express server (`dashboard/` hoặc route `/admin`)
* **When** mở view "Jobs & Checkpoints"
* **Then** hiển thị bảng checkpoints với cột `platform`, `targetKey`, `status`, `lastCrawledAt`, `lastCursor`, `errorCount`
* **And** hỗ trợ actions `resume`, `pause`, `retry` mỗi checkpoint qua API `POST /checkpoints/:id/{action}`
* **And** cập nhật real-time mỗi 30s (SSE hoặc polling).

### Story 19.2: Dashboard Proxies & Accounts View
As an **Automation Operator**,
I want **một dashboard view hiển thị sức khỏe proxy pool, danh sách tài khoản đang hibernation, và tốc độ cào hiện tại**,
So that **tôi biết khi nào cần thêm proxy, rotate account, hoặc chờ hibernation kết thúc**.

**Acceptance Criteria:**
* **Given** view "Proxies & Accounts"
* **When** load trang
* **Then** hiển thị `healthyProxyCount / totalProxyCount`, `currentReqPerSecond`, `redisConsumerLag`, `throttleLevel`
* **And** hiển thị danh sách `hibernatingAccounts` với `remainingTime` và `reason`
* **And** hỗ trợ actions `quarantine/release` proxy và `wake` account (manual override)
* **And** cập nhật real-time mỗi 5s.

### Story 19.3: Dashboard Stream Metrics & Alerts View
As a **Reliability Engineer**,
I want **một dashboard view hiển thị Redis Stream throughput, consumer lag, dropped events và alerts**,
So that **tôi phát hiện sớm khi Nowing consumer chậm hoặc stream bị drop dữ liệu**.

**Acceptance Criteria:**
* **Given** view "Stream Metrics & Alerts"
* **When** load trang
* **Then** hiển thị chart `eventsPerSecond`, `pendingMessages`, `consumerLag`, `droppedEvents`, `lastAckTime`
* **And** hiển thị danh sách cảnh báo đang active với ngưỡng `pendingMessages > 50,000` hoặc `lastAckTime > 60s`
* **And** cập nhật real-time mỗi 5s.
* **And** hỗ trợ cấu hình alert channel (`ALERT_WEBHOOK`, `ALERT_EMAIL`).

### Story 19.4: Admin CLI — Unified Command Group
As an **Internal Automation Operator**,
I want **một nhóm lệnh CLI `xactions admin` tổng hợp để vận hành hệ thống từ terminal**,
So that **tôi có thể tra cứu governor status, quản lý proxy/account/checkpoint, và xem stream metrics mà không cần mở dashboard**.

**Acceptance Criteria:**
* **Given** `xactions admin` command group
* **When** chạy `xactions admin --help`
* **Then** liệt kê các sub-commands: `status`, `proxies`, `accounts`, `checkpoints`, `stream`
* **And** tất cả commands yêu cầu permission `admin` hoặc `checkpoint:manage` (cho checkpoint-only).

### Story 19.4.1: Admin CLI — Status
As an **Internal Automation Operator**,
I want **lệnh `xactions admin status` hiển thị tổng quan governor, proxy pool, và hibernating accounts**,
So that **tôi nắm nhanh tình trạng hệ thống từ terminal**.

**Acceptance Criteria:**
* **Given** `xactions admin` group
* **When** chạy `xactions admin status`
* **Then** in ra `healthyProxyCount / totalProxyCount`, `currentReqPerSecond`, `redisConsumerLag`, `throttleLevel`, danh sách `hibernatingAccounts`.

### Story 19.4.2: Admin CLI — Proxy Management
As an **Internal Automation Operator**,
I want **lệnh `xactions admin proxies ...` để liệt kê, cách ly và bỏ cách ly proxy**,
So that **tôi có thể kiểm soát proxy pool từ CLI khi phát hiện IP bị chặn hoặc cần bảo trì**.

**Acceptance Criteria:**
* **Given** `xactions admin` group
* **When** chạy `xactions admin proxies list`
* **Then** liệt kê proxy với trạng thái `healthy` / `quarantined` / `expiryAt`
* **And** `xactions admin proxy quarantine <proxyKey>` và `xactions admin proxy release <proxyKey>` cách ly / bỏ cách ly proxy thủ công.

### Story 19.4.3: Admin CLI — Account Management
As an **Internal Automation Operator**,
I want **lệnh `xactions admin accounts ...` để liệt kê, đánh thức, và xoay account đang hibernation**,
So that **tôi quản lý vòng đời tài khoản auth-required mà không cần restart crawler**.

**Acceptance Criteria:**
* **Given** `xactions admin` group
* **When** chạy `xactions admin accounts list --platform <platform>`
* **Then** liệt kê account, `velocity`, `hibernatingUntil`, `assignedProxy`
* **And** `xactions admin account wake <accountId>` đánh thức account từ hibernation
* **And** `xactions admin account rotate <accountId> <platform>` đổi account khác trong `AccountPool`.

### Story 19.4.4: Admin CLI — Checkpoint Management
As an **Internal Automation Operator**,
I want **lệnh `xactions admin checkpoints ...` để liệt kê, resume, pause, và retry checkpoint**,
So that **tôi điều khiển pipeline cào từ terminal khi một target bị lỗi**.

**Acceptance Criteria:**
* **Given** `xactions admin` group
* **When** chạy `xactions admin checkpoints list/resume/pause/retry`
* **Then** gọi `api/routes/checkpoints.js` tương ứng và cập nhật trạng thái `CrawlCheckpoint`.

### Story 19.4.5: Admin CLI — Stream Metrics & Alerts
As an **Internal Automation Operator**,
I want **lệnh `xactions admin stream ...` để xem metrics và kích hoạt test alert**,
So that **tôi phát hiện khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s` từ CLI**.

**Acceptance Criteria:**
* **Given** `xactions admin` group
* **When** chạy `xactions admin stream metrics/alerts/test`
* **Then** hiển thị stream metrics và kích hoạt test alert.

> **Note:** Các lệnh `xactions checkpoints ...` và `xactions stream ...` hiện có (`src/cli/commands/checkpoints.js`, `src/cli/commands/stream.js`) sẽ được giữ lại dưới dạng alias hoặc redirect đến `xactions admin ...` trong quá trình chuyển đổi, và bị xoá ở Epic 20.2.

> **Note:** Story 19.4 đã được tách thành 5 sub-stories 19.4.1–19.4.5. Các vị trí 19.5 và 19.6 không còn được sử dụng; NFR traceability đã được cập nhật để tham chiếu 19.4.5 thay vì 19.6.

### Story 19.7: Admin REST API — Proxy Management
As an **Internal Operator & CLI Developer**,
I want **các endpoint REST `/admin/proxies` để quản lý proxy pool**,
So that **admin surface không truy cập DB trực tiếp và có thể cách ly/khôi phục proxy kịp thời**.

**Acceptance Criteria:**
* **Given** route `api/routes/proxies.js` đã tồn tại
* **When** mount `GET /admin/proxies` và `POST /admin/proxies/:key/quarantine|release` trong `api/server.js`
* **Then** các endpoint wrap `api/routes/proxies.js`, trả về danh sách proxy, health, và kết quả quarantine/release
* **And** không viết lại business logic; endpoint cũ vẫn hoạt động song song cho backward compatibility
* **And** tất cả endpoints yêu cầu `admin` permission; auth dùng internal admin API key hoặc A2A token.

### Story 19.8: Admin REST API — Account & Checkpoint Management
As an **Internal Operator & CLI Developer**,
I want **các endpoint REST `/admin/accounts` và `/admin/checkpoints` để quản lý account lifecycle và checkpoints**,
So that **operator có thể đánh thức, xoay account và quản lý checkpoint mà không cần DB access**.

**Acceptance Criteria:**
* **Given** các route `api/routes/checkpoints.js` và account logic đã tồn tại
* **When** mount `GET /admin/accounts?platform=...`, `POST /admin/accounts/:id/wake|rotate`, và `GET/POST /admin/checkpoints/...`
* **Then** các endpoint wrap account lifecycle và `api/routes/checkpoints.js`, trả về status/wake/rotate và checkpoint CRUD
* **And** `POST /admin/accounts/:id/wake` chỉ hoạt động với account đang `hibernating`; trả về `409 Conflict` nếu account không đủ điều kiện
* **And** tất cả endpoints yêu cầu `admin` permission hoặc `checkpoint:manage` (cho checkpoint-only); auth dùng internal admin API key hoặc A2A token.

### Story 19.9: Admin REST API — Stream Metrics & Alerts
As an **Internal Operator & CLI Developer**,
I want **các endpoint REST `/admin/stream/metrics` và `/admin/stream/alerts` để giám sát Redis stream và governor**,
So that **operator nhận cảnh báo khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`**.

**Acceptance Criteria:**
* **Given** route `api/routes/streams.js` và governor metrics reader đã tồn tại
* **When** mount `GET /admin/stream/metrics` và `GET /admin/stream/alerts` trong `api/server.js`
* **Then** các endpoint wrap `api/routes/streams.js` và trả về `pendingMessages`, `lastAckTime`, throughput, và alert flags
* **And** alert tự động bật khi vượt ngưỡng (`pendingMessages > 50,000` hoặc `lastAckTime > 60s`) và gửi webhook/email nếu configured
* **And** tất cả endpoints yêu cầu `admin` permission; auth dùng internal admin API key hoặc A2A token.

### Story 19.10: Admin MCP Tools for AI Agents
As an **AI Agent Operator**,
I want **các MCP tool `x_admin_*` để AI agents có thể kiểm tra status và thực hiện vận hành cơ bản**,
So that **Claude/Cursor/Antigravity có thể hỏi "tình trạng proxy pool thế nào" hoặc "đánh thức account fb:123"**.

**Acceptance Criteria:**
* **Given** MCP daemon đang chạy
* **When** gọi `x_admin_status`
* **Then** trả về governor status, proxy health, hibernating accounts
* **And** `x_admin_proxies_list`, `x_admin_accounts_list`, `x_admin_account_wake`, `x_admin_proxy_quarantine`, `x_admin_checkpoints_list`, `x_admin_checkpoint_action` hoạt động tương tự CLI.
* **And** yêu cầu permission `admin`.

---

## Epic 20: Nowing Cutover & Legacy Scraper Decommissioning

### Story 20.1: Nowing Shadow-Run Adapter over XActions Daemon
As a **Nowing Integration Lead**,
I want **nâng cấp adapter `nowing_backend/app/proprietary/platforms/xactions/adapter.py` để gọi XActions MCP Daemon HTTP/SSE (Port 3001) qua HTTP Keep-Alive Connection Pool**,
So that **Nowing bắt đầu nhận dữ liệu từ XActions song song với scraper cũ để so sánh (shadow run) trước khi thay thế hoàn toàn**.

**Pre-condition:** Epics 13–18 (crawler Social, Ecom, BĐS, Tuyển dụng) đã ổn định.

**Acceptance Criteria:**
* **Given** repository Nowing tại `/Users/luisphan/Documents/GitHub/nowing`
* **When** cập nhật `adapter.py` gọi sang `http://xactions-service:3001`
* **Then** Nowing nhận đủ 100% dữ liệu qua kiểm thử đối soát (Shadow Run) trong môi trường staging
* **And** adapter ghi log diff (field-level) giữa dữ liệu cũ và mới cho từng platform

### Story 20.2: Legacy Scraper Code Decommissioning
As a **Nowing Maintainer**,
I want **xóa bỏ an toàn các thư mục scraper cũ trong `nowing_backend/app/proprietary/platforms/`**,
So that **codebase không còn chứa code cũ đã được thay thế, giảm rủi ro bảo trì và độ phức tạp**.

**Pre-condition:** Story 20.1 shadow-run đạt ≥ 99% field parity trong 7 ngày liên tiếp.

**Acceptance Criteria:**
* **Given** shadow-run đạt ≥ 99% field parity trong 7 ngày liên tiếp
* **When** xóa các thư mục legacy trong Nowing repo (`shopee/`, `chotot/`, `batdongsan/`, `topcv/`, `vietnamworks/`, `linkedin/`, v.v.)
* **And** xóa các file/thư mục legacy trong XActions repo (`src/client/Scraper.js`, `src/scrapers/twitter/http/`, `src/scrapers/twitter/index.js`, `src/scrapers/facebook/`, `src/scrapers/threads/index.js`)
* **Then** CI tests pass, Nowing Docker image < 500MB
* **And** gỡ bỏ `selenium`, `playwright-python`, Chromium binaries khỏi Dockerfile Nowing
* **And** XActions bundle size và dependency count giảm đáng kể

---

> **Epic 21 & 22 đã được reactivate:** `_bmad-output/planning-artifacts/backlog-epics-21-22.md`.  
> Lý do: Vietnam market pivot approved 2026-09-05 — Product Council (Luisphan) approved. PRD FR-94→96 added. Spec sẵn trong backlog file. Feasibility research verified (`research/domain-vietnam-2026-08-21.md` + live probes all 200 OK).  
> **Epic 33 added:** Zalo OA + YouTube VN — net-new platforms for VN market.  
> **Epics 23–26 là Phase 4 extension:** universal AbstractCrawler migration, dispatcher unification, và legacy decommission.

---

## Phase 4 Extension — Epics 23–26: Universal AbstractCrawler Migration

> **Scope:** hoàn thiện kiến trúc `AbstractCrawler` cho toàn bộ XActions (Bluesky, Mastodon, utility scripts, adapters, dispatcher, legacy decommission).


## Cross-Epic Dependency Map

```
Epic 20.2 (Legacy decommission) ─┐
                                 ├──→ Epic 26 (Final legacy removal)
Epic 23 (Bluesky/Mastodon) ──────┤
Epic 24 (Utility/Adapters) ──────┤
                                 │
                                 ↓
                         Epic 25 (Unified dispatcher)
```

- **Epic 23** and **Epic 24** can run in parallel after Epic 13.1 (Tiered Signer) and 13.3 (Facebook hybrid) are done.
- **Epic 25** depends on 23, 24, and Phase 4 integration stories (13.2.12, 13.10, 15.1.4).
- **Epic 26** depends on 25 and the original Epic 20.2 decommission conditions (shadow-run parity ≥ 99% for 7 days).

---

## Epic 23: Bluesky & Mastodon on AbstractCrawler

> **Epic grouping note:** This is a *platform suite* for two HTTP-only, no-JS platforms. Both use public REST/AT Protocol APIs and require no Puppeteer, making them ideal candidates to validate the `AbstractApiClient` + `AbstractCrawler` pattern for lightweight platforms.

### Story 23.1: Bluesky AT Protocol Client
As a **Platform Scraper Developer**,  
I want **a `BlueskyClient` in `src/scrapers/social/bluesky/client.js` that extends `AbstractApiClient`**,  
So that **all Bluesky HTTP calls go through the same resilient request pipeline (proxy, governor, 429/403 handling, TLS spoofing) as Twitter and Facebook**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` in `src/core/base-client.js`
* **When** implementing `BlueskyClient extends AbstractApiClient`
* **Then** `BlueskyClient` sets `name = 'bluesky'`, `platform = 'bluesky'`, `requiresAuth = false`
* **And** default `service = 'https://public.api.bsky.app'`
* **And** supports optional auth (`identifier`/`password`) for non-public data
* **And** all `request()` calls pass through `governor.recordRequest()` and proxy rotation
* **And** response is validated by a `BlueskyPlatformResponseValidator` (Story 23.5)
* **And** reuses `ProxyIpPool` and `AccountPool` contracts without platform-specific side-loading

### Story 23.2: Bluesky Hybrid Crawler
As a **Bluesky Growth Marketer**,  
I want **cào profile, followers, following, user feed, search, và feed của Bluesky qua `BlueskyCrawler` kiến trúc hybrid**,  
So that **tôi có thể phân tích audience và nội dung trên Bluesky với cùng một `CrawlerCommand` interface như Twitter/X**.

**Acceptance Criteria:**
* **Given** `BlueskyCrawler` in `src/scrapers/social/bluesky/crawler.js` extends `AbstractCrawler`
* **When** gọi `profile({ username })`, `followers({ username, limit })`, `following({ username, limit })`, `get_user_feed({ username, limit })`, `search({ query, limit })`, `scrape_feed({ feedUri, limit })`
* **Then** crawler dispatches through `BlueskyClient` and paginates with `cursor`
* **And** dữ liệu trả về chuẩn hóa theo `ProfileItem` / `PostItem` với ID Namespaced `bluesky:${uri|handle}`
* **And** supports `onProgress` callback
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing`, `scrapeTweets`, `searchTweets`, `scrapeFeed` trong `src/scrapers/bluesky/index.js` (legacy); cập nhật `docs/deprecation-plan.md`.

### Story 23.3: Mastodon REST API Client
As a **Platform Scraper Developer**,  
I want **a `MastodonClient` in `src/scrapers/social/mastodon/client.js` that extends `AbstractApiClient`**,  
So that **Mastodon scraping uses the same governor, proxy, and retry pipeline as every other platform**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` in `src/core/base-client.js`
* **When** implementing `MastodonClient extends AbstractApiClient`
* **Then** `MastodonClient` sets `name = 'mastodon'`, `platform = 'mastodon'`, `requiresAuth = false`
* **And** default `instance = 'https://mastodon.social'` nhưng configurable
* **And** supports optional `accessToken` cho authenticated endpoints
* **And** all REST calls pass through `governor.recordRequest()` and proxy rotation
* **And** response is validated by a `MastodonPlatformResponseValidator` (Story 23.5)
* **And** HTML-to-plain-text decoding logic (`toPlainText`) is moved to `MastodonClient` normalization helper, not duplicated

### Story 23.4: Mastodon Hybrid Crawler
As a **Mastodon Instance Analyst**,  
I want **cào profile, followers, following, timeline, search, hashtag, và trending của Mastodon qua `MastodonCrawler` kiến trúc hybrid**,  
So that **tôi theo dõi nội dung và mối quan hệ trên bất kỳ Mastodon instance nào từ một interface thống nhất**.

**Acceptance Criteria:**
* **Given** `MastodonCrawler` in `src/scrapers/social/mastodon/crawler.js` extends `AbstractCrawler`
* **When** gọi `profile({ username, instance })`, `followers({ username, limit, instance })`, `following({ username, limit, instance })`, `get_user_feed({ username, limit, instance })`, `search({ query, limit, instance })`, `hashtag({ hashtag, limit, instance })`, `trending({ limit, instance })`
* **Then** crawler dispatches through `MastodonClient` với `instance` parameter
* **And** dữ liệu trả về chuẩn hóa theo `ProfileItem` / `PostItem` với ID Namespaced `mastodon:${instance}:${id}`
* **And** supports `onProgress` callback
* **And (Scope & Deprecation Marker)** gắn `@deprecated` cho `scrapeProfile`, `scrapeFollowers`, `scrapeFollowing`, `scrapeTweets`, `searchTweets`, `scrapeHashtag`, `scrapeTrending` trong `src/scrapers/mastodon/index.js` (legacy); cập nhật `docs/deprecation-plan.md`.

### Story 23.5: Bluesky & Mastodon Response Validators
As a **Reliability Engineer**,  
I want **`BlueskyPlatformResponseValidator` và `MastodonPlatformResponseValidator` implement `AbstractPlatformResponseValidator`**,  
So that **crawler biết phân biệt lỗi mạng, rate-limit, auth failure, và payload không hợp lệ cho từng platform**.

**Acceptance Criteria:**
* **Given** `AbstractPlatformResponseValidator` trong `src/core/platform-validator.js`
* **When** tạo `BlueskyPlatformResponseValidator` và `MastodonPlatformResponseValidator`
* **Then** mỗi validator implement `isValidPayload(response)`, `isBotChallenge(response)`, `isRateLimit(response)`, `isAuthExpired(response)`
* **And** Mastodon validator nhận diện HTTP 401/403/429 và JSON error body
* **And** Bluesky validator nhận diện `error` field trong AT Protocol response
* **And** cả hai trả về `SuggestedActions` phù hợp (`ROTATE_PROXY`, `WAIT`, `RELOGIN`, `SKIP`)

### Story 23.6: Bluesky & Mastodon Integration & Caller Migration
As a **XActions Platform Engineer**,  
I want **`scrape('bluesky'|'mastodon', ...)` và tất cả caller chuyển sang `BlueskyCrawler`/`MastodonCrawler` mới**,  
So that **người dùng cuối không còn phụ thuộc `src/scrapers/bluesky/index.js` và `src/scrapers/mastodon/index.js` cũ**.

**Acceptance Criteria:**
* **Given** `BlueskyCrawler` và `MastodonCrawler` hỗ trợ đủ action (profile, followers, following, feed, search, hashtag, trending)
* **When** kiểm tra `src/scrapers/index.js`
* **Then** platform `bluesky`/`mastodon` import từ `src/scrapers/social/bluesky/index.js` / `src/scrapers/social/mastodon/index.js` thay vì legacy
* **And** `package.json` exports thêm `./scrapers/social` hoặc cập nhật `./scrapers/bluesky` / `./scrapers/mastodon` để consumer truy cập `BlueskyClient`/`BlueskyCrawler` / `MastodonClient`/`MastodonCrawler`
* **And** MCP tools / CLI commands gọi `scrape('bluesky'|'mastodon', action, args)` thay vì import trực tiếp
* **And** `tests/scrapers/bluesky-*.test.js` và `tests/scrapers/mastodon-*.test.js` chuyển sang test `BlueskyCrawler`/`MastodonCrawler`
* **And (Scope & Deprecation Marker)** cập nhật `docs/deprecation-plan.md` status tracker sang `deprecated-planned` cho Bluesky/Mastodon legacy.

---

## Epic 24: Utility Scripts & Adapters Migration

> **Epic grouping note:** This epic is a *cleanup & consolidation* epic. It does not add user-facing features; it removes technical debt and aligns leftover `src/scrapers/` modules with the single architecture.

### Story 24.1: Inventory & Deprecation Decision for Standalone Scripts
As a **Platform Scraper Developer**,  
I want **một inventory đầy đủ các file `src/scrapers/*.js` độc lập và `src/scrapers/adapters/`**,  
So that **team quyết định rõ ràng: convert thành action, archive, hoặc xoá từng file**.

**Acceptance Criteria:**
* **Given** các file: `bookmarkExporter.js`, `showMoreExpander.js`, `threadUnroller.js`, `videoDownloader.js`, `viralTweets.js`, `index.js`, `index.d.ts`, và toàn bộ `src/scrapers/adapters/`
* **When** chạy audit
* **Then** đầu ra là `docs/utility-script-audit-23-24.md` với bảng:
  - Tên file
  - Mô tả chức năng
  - Context dùng (browser console / Node.js / CLI / MCP)
  - Quyết định: `convert-to-action` / `archive` / `delete` / `keep`
  - Story chịu trách nhiệm (24.2 hoặc 24.4)

### Story 24.2: Browser Utility Features as Crawler Actions
As a **Content Operator**,  
I want **các tính năng từ `videoDownloader.js`, `bookmarkExporter.js`, `threadUnroller.js` có sẵn dưới dạng `CrawlerCommand` trong `TwitterCrawler`**,  
So that **tôi có thể gọi chúng từ CLI/MCP thay vì dán script vào console**.

**Acceptance Criteria:**
* **Given** quyết định từ Story 24.1
* **When** triển khai
* **Then** `TwitterCrawler` thêm các action: `download_video({ tweetId, quality })`, `export_bookmarks({ username, limit })`, `unroll_thread({ tweetId })`
* **And** mỗi action trả về `PostItem[]` hoặc `Buffer`/`ReadableStream` cho download
* **And** legacy file được gắn `@deprecated` với ghi chú thay thế
* **And** CLI/MCP expose `xactions download video <tweetId>` và `xactions export bookmarks <username>`

### Story 24.3: Adapter Layer Consolidation
As a **Platform Scraper Developer**,  
I want **`src/scrapers/adapters/` được thu gọn thành adapter provider cho `AbstractApiClient`**,  
So that **không còn 7 adapter khác nhau mà chỉ còn những cái thực sự cần cho CDP/HTTP/Playwright**.

**Acceptance Criteria:**
* **Given** `src/scrapers/adapters/` gồm: `base.js`, `cheerio.js`, `crawlee.js`, `got-jsdom.js`, `http.js`, `playwright.js`, `puppeteer.js`, `selenium.js`
* **When** audit từ Story 24.1
* **Then** giữ lại tối đa 3 adapter: `http.js` (`undici`/`got-scraping` + TLS spoofing), `playwright.js`/`puppeteer.js` (CDP attach), `base.js` (contract)
* **And** `AbstractApiClient` chọn adapter qua config `adapter: 'http' | 'playwright' | 'puppeteer'`
* **And** các adapter cũ (`selenium`, `cheerio`, `crawlee`, `got-jsdom`) được chuyển vào `archive/` hoặc xoá nếu không còn import
* **And** `npm run typecheck` pass sau khi xoá

### Story 24.4: Archive or Remove Unused Scraper Modules
As a **Codebase Maintainer**,  
I want **các file được đánh dấu `archive` trong audit đã được chuyển ra khỏi `src/scrapers/`**,  
So that **`src/scrapers/` chỉ còn `social/` dispatcher và platform crawlers**.

**Acceptance Criteria:**
* **Given** `docs/utility-script-audit-23-24.md`
* **When** thực hiện Story 24.4
* **Then** các file được chuyển vào `archive/scrapers/` hoặc `scripts/`
* **And** `package.json` exports không còn trỏ tới các file đã archive
* **And** `README.md` cập nhật vị trí mới của các script dán console
* **And** `npm test` pass; không còn dead imports

---

## Epic 25: Unified Dispatcher & Public API Finalization

> **Epic grouping note:** This is the *glue* epic. It makes `scrape(platform, action, args)` the single entry point for all internal and external callers.

### Story 25.1: Universal `scrape()` Dispatcher
As a **XActions Platform Engineer**,  
I want **`src/scrapers/index.js` trở thành một thin dispatcher duy nhất cho mọi platform**,  
So that **không còn logic scraper nào nằm ngoài `src/scrapers/social/<platform>/`**.

**Acceptance Criteria:**
* **Given** các crawler trong `src/scrapers/social/twitter/`, `src/scrapers/social/facebook/`, `src/scrapers/social/threads/`, `src/scrapers/social/bluesky/`, `src/scrapers/social/mastodon/`
* **When** gọi `scrape('twitter'|'facebook'|'threads'|'bluesky'|'mastodon', action, args)`
* **Then** dispatcher resolve platform → `AbstractCrawler` instance → gọi `.start({ action, args })`
* **And** dispatcher hỗ trợ dependency injection (`client`, `store`, `governor`, `accountPool`, `proxyPool`)
* **And** legacy `import twitter from './twitter/index.js'` trong `src/scrapers/index.js` bị xoá
* **And** `src/scrapers/social/index.js` export all platform crawlers/clients/validators

### Story 25.2: `package.json` Exports v2
As a **Library Consumer**,  
I want **mọi `package.json` export trỏ tới `src/scrapers/social/` thay vì legacy platform folders**,  
So that **tôi import một kiến trúc ổn định dù tên file legacy đã bị xoá**.

**Acceptance Criteria:**
* **Given** `package.json` hiện tại có `./scrapers/twitter`, `./scrapers/bluesky`, `./scrapers/mastodon`, `./scrapers/threads`
* **When** cập nhật
* **Then** `./scrapers` trỏ tới `src/scrapers/index.js` (dispatcher)
* **And** `./scrapers/social` trỏ tới `src/scrapers/social/index.js`
* **And** `./scrapers/<platform>` redirect tới `src/scrapers/social/<platform>/index.js` (nếu giữ tên export)
* **And** `./scrapers/twitter/http` bị xoá hoặc redirect sang `./scrapers/social/twitter/client.js`
* **And** `npm run typecheck` pass

### Story 25.3: MCP / CLI / API Caller Migration
As a **XActions Platform Engineer**,  
I want **tất cả MCP tools, CLI commands, và API routes gọi `scrape()` hoặc `CrawlerCommand` thay vì import scraper cụ thể**,  
So that **không còn coupling trực tiếp với legacy modules**.

**Acceptance Criteria:**
* **Given** `src/mcp/server.js`, `src/cli/commands/`, `api/routes/`
* **When** grep/import audit
* **Then** không còn `import` từ `src/client/Scraper.js`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/`, `src/scrapers/bluesky/`, `src/scrapers/mastodon/`
* **And** tất cả caller gọi `scrape(platform, action, args)` hoặc `CrawlerCommand`
* **And** `unfollowx` commands được map vào `CrawlerCommand` hoặc trả `suggestedAction` (NFR-16)
* **And** tests E2E cho MCP/CLI pass với dispatcher mới

### Story 25.4: Backward Compatibility & Error Mapping
As a **Library Consumer**,  
I want **mã cũ gọi `scrape('twitter', ...)` vẫn hoạt động với `suggestedAction` rõ ràng khi action không còn hỗ trợ**,  
So that **migrations không gây breaking change đột ngột**.

**Acceptance Criteria:**
* **Given** dispatcher mới
* **When** gọi action đã bị loại bỏ hoặc tên platform cũ
* **Then** trả `PlatformError` với `type: ErrorTypes.DEPRECATED`, `suggestedAction` chỉ rõ action/platform thay thế
* **And** `package.json` exports giữ mapping cho ít nhất 1 release cycle
* **And** `docs/deprecation-plan.md` liệt kê mapping đầy đủ từ legacy API → new API

---

## Epic 26: Legacy Decommission Final

> **Epic grouping note:** This is the *decommission* epic. It should only start after shadow-run parity is proven for all migrated platforms.

### Story 26.1: Pre-Decommission Parity & Rollback Preparation
As a **Reliability Engineer**,  
I want **một parity report đầy đủ cho Bluesky/Mastodon/Adapters trước khi xóa legacy code**,  
So that **decommission không gây regression cho consumer cũ**.

**Acceptance Criteria:**
* **Given** Epic 23, 24, 25 done
* **When** chạy shadow-run trong 7 ngày
* **Then** field-level diff giữa legacy (`src/scrapers/bluesky/`, `src/scrapers/mastodon/`, utility scripts) và hybrid (`src/scrapers/social/`) ≤ 1%
* **And** `npm test` pass trên toàn bộ test suite
* **And** `npm run typecheck` pass
* **And** tạo git tag `pre-decommission-YYYY-MM-DD` từ `main`
* **And** `docs/decommission-plan-26.md` ghi rõ danh sách file sẽ xóa và rollback conditions

### Story 26.2: Final Legacy Removal
As a **Codebase Maintainer**,  
I want **xoá toàn bộ legacy scraper modules sau khi parity đạt**,  
So that **XActions chỉ còn một kiến trúc `AbstractCrawler` duy nhất**.

**Acceptance Criteria:**
* **Given** parity ≥ 99% và tag backup đã tạo
* **When** chạy Story 26.2
* **Then** xóa:
  - `src/client/Scraper.js`
  - `src/scrapers/twitter/` (toàn bộ)
  - `src/scrapers/twitter/http/` (toàn bộ)
  - `src/scrapers/facebook/` (toàn bộ)
  - `src/scrapers/threads/index.js` (legacy)
  - `src/scrapers/bluesky/index.js` (legacy)
  - `src/scrapers/mastodon/index.js` (legacy)
  - `src/scrapers/adapters/` (nếu đã consolidate)
  - các utility scripts đã archive
* **And** `package.json` exports cập nhật
* **And** `docs/deprecation-plan.md` status tracker chuyển sang `removed`
* **And** `npm test` pass, `npm run typecheck` pass
* **And** `unfollowx` CLI smoke test pass
* **And** Nowing shadow-run vẫn duy trì parity trong 24h sau merge

---

## Conditions to Start / Reactivate

1. **Epic 13.1 (Tiered Signer)** và **Epic 13.3 (Facebook hybrid)** đã ổn định — `AbstractApiClient` + `AbstractCrawler` pattern đã chứng minh.
2. **Epic 20.1 (Nowing shadow-run)** đang chạy — để có môi trường so sánh parity cho Bluesky/Mastodon.
3. Product Council phê duyệt scope expansion sang Bluesky/Mastodon hoặc chấp nhận để ở backlog.
4. Architecture review xác nhận `AbstractCrawler` không cần thay đổi core để hỗ trợ nền tảng HTTP-only.
5. Legal/compliance review xác nhận public data scraping trên Bluesky/Mastodon tuân thủ Terms of Service.

## Definition of Done for Epics 23–26

- `src/scrapers/social/` chứa tất cả platform crawlers.
- `src/scrapers/index.js` chỉ là dispatcher.
- `src/client/Scraper.js` không còn tồn tại.
- `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/`, `src/scrapers/bluesky/`, `src/scrapers/mastodon/`, `src/scrapers/adapters/` không còn legacy code.
- `package.json` exports ổn định, backward-compatible.
- `npm test` + `npm run typecheck` pass.
- `bmad-check-implementation-readiness` re-run → **READY**.

## NFR Traceability Matrix

| NFR | Description | Primary Stories | Validation Approach |
|---|---|---|---|
| NFR11 | Resource Optimization (85% RAM, 70% CPU) | 10.2, 13.1, 13.2, 13.3, 15.2, 16.1, 16.2, 17.1, 17.2, 18.1, 18.2, 18.3, 20.2 | Benchmark `process.memoryUsage()` vs legacy headless; Nowing Docker image <500MB |
| NFR12 | High Throughput (>500 req/s, <2ms RPC) | 13.1, 13.2, 13.3, 14.2, 15.2, 16.1, 16.2, 17.1, 17.2, 18.1, 18.2, 18.3 | Load test with `autocannon`/`k6`; measure req/s and MCP response latency |
| NFR13 | Resilience & Auto-Failover (proxy retry 3x) | 11.1, 11.3, 11.4, 11.5, 11.6, 11.7 | Simulated 429/403/ProxyDead; verify quarantine, backoff, replay |
| NFR14 | Zero-Credential Security | 12.1, 12.2 | No plain-text password in DB; QR/CDP auth flows only |
| NFR15 | Clean Architecture & Extensibility | 10.1, 10.5, 11.1, 14.2 | `src/core/` has zero npm deps; new platform adds only `src/scrapers/<platform>/index.js` |
| NFR16 | License & Backward Compatibility | 14.2, 20.1, 20.2 | License headers present; `unfollowx` commands mapped or return actionable error |
| NFR17 | Operational Observability | 11.4, 14.3, 19.1, 19.2, 19.3, 19.4.5 | Verify endpoints return metrics; alert fires when thresholds exceeded |
| NFR18 | Universal Architecture Compliance | 23.1, 23.3, 25.1, 25.3, 26.2 | 100% platforms on `AbstractCrawler`/`AbstractApiClient`; zero legacy imports; `npm run typecheck` and `unfollowx` smoke tests pass |

---

## Epic 27: Anti-Detection & Session Resilience

> **Epic grouping note:** This is an *infrastructure hardening* epic. It builds on top of the existing `AdaptiveRateGovernor`, `AccountPool`, `ProxyIpPool`, and `StealthBrowser` layers. The goal is to make anti-detection and session resilience proactive, continuous, and self-healing rather than reactive.

### Story 27.1: FingerprintManager — TLS/JA4 Spoofing & Geo-Consistent Profiles
As a **Scraping Reliability Engineer**,  
I want **a `FingerprintManager` that rotates per-session fingerprints and binds them to a geo-consistent proxy region**,  
So that **platforms cannot detect XActions via TLS/JA4 signatures, inconsistent timezone/locale, or proxy-UA mismatches**.

**Acceptance Criteria:**
* **Given** `src/agents/antiDetection.js` and `src/scraping/stealthBrowser.js` already generate UA/viewport/WebGL
* **When** implementing `FingerprintManager`
* **Then** it manages a pool of *complete* fingerprints: UA, viewport, timezone, locale, colorDepth, platform, WebGL vendor/renderer, fonts, `navigator.hardwareConcurrency`, `navigator.deviceMemory`
* **And** it derives proxy region from proxy IP and selects a timezone/locale that matches the region
* **And** it optionally integrates with a TLS/JA4/JA3 spoofing mechanism (system proxy, custom `tls` agent, or external tool) so outbound handshake matches the chosen OS/Browser
* **And** `launchStealthBrowser()` consumes `FingerprintManager.getForAccount(accountId)` to ensure fingerprint + proxy + timezone are consistent per account
* **And** fingerprints are persisted per account to avoid rapid rotation that triggers re-auth flows

### Story 27.2: SessionHealthOrchestrator — Continuous Health Score & Circuit Breaker
As a **Reliability Engineer**,  
I want **a continuous health score per account and an automatic circuit breaker with recovery probe**,  
So that **a dying or challenged account is taken out of rotation before it poisons downstream data, and recovers only when safe**.

**Acceptance Criteria:**
* **Given** `AdaptiveRateGovernor.hibernateAccount()` and `AccountPool.markUnavailable()` already exist
* **When** implementing `SessionHealthOrchestrator`
* **Then** it computes a health score per `platform:accountId` from: consecutive errors, rate-limit frequency, bot-challenge frequency, average latency, response payload completeness, proxy health
* **And** score is in `[0, 100]`; below `30` → circuit breaker opens, account is moved to `sick` state and excluded from rotation
* **And** circuit breaker enters `half-open` after cooldown and sends a *recovery probe* (cheap, read-only action such as `profile`) using a fresh proxy
* **And** if probe succeeds with a *complete* payload and no challenge, breaker closes; if it fails, account goes back to `sick` with exponential backoff
* **And** `governor.getStatus()` includes `healthScores` and `circuitBreakerStates`
* **And** `dashboard/admin.html` shows a health column next to each account (green/yellow/red) and a wake/probe action

### Story 27.3: ChallengeSignatureDetector — Automated Bot-Detection Page Detection
As a **Platform Scraper Developer**,  
I want **a `ChallengeSignatureDetector` that scans HTTP responses and DOM for Cloudflare, Arkose, and platform-specific challenge pages**,  
So that **the crawler can record `bot_challenge` hibernation immediately instead of misclassifying the payload as empty data**.

**Acceptance Criteria:**
* **Given** `AbstractPlatformResponseValidator` and per-platform validators already exist
* **When** implementing `ChallengeSignatureDetector`
* **Then** it runs as a separate detector used by both `AbstractApiClient` (HTTP response body) and `AbstractCrawler` (Puppeteer page content)
* **And** it matches known signatures: `cf-challenge`, `cf-turnstile`, `__cf_chl`, `arkose`, `captcha`, `challenge-running`, `data-testid="challenge"`, `window.__初始状态`, Facebook `checkpoint`, Twitter `unusual-login`
* **And** it returns a normalized `{ detected, type, confidence, suggestedHibernationMs }` object
* **And** on detection, `AbstractApiClient` calls `governor.recordBotChallenge()` automatically
* **And** the detector is unit-tested with real HTML/JSON samples from each platform

---

## Epic 28: Schema Drift & Selector Resilience

> **Epic grouping note:** This epic hardens data quality. It does not replace existing crawlers; it wraps them with validation, drift detection, and self-healing selector fallback so silent data degradation is impossible.

### Story 28.1: SchemaDriftGuard — Runtime Contract Validation & Completeness Classification
As a **Data Quality Engineer**,  
I want **runtime validation of crawler output against a platform/action schema and automatic classification as `complete`, `degraded`, or `corrupted`**,  
So that **downstream consumers never receive silently empty or malformed data**.

**Acceptance Criteria:**
* **Given** `MetadataSchemaRegistry` and `validateSchemaNode()` already exist in `src/core/metadata-schema-registry.js`
* **When** wiring `SchemaDriftGuard` into `AbstractCrawler`
* **Then** each crawler registers a `PostItem`/`ProfileItem`/`CommentItem` schema per action
* **And** `SchemaDriftGuard.validate(platform, action, data)` returns `{ classification, missingFields, typeErrors, score }`
* **And** `classification` is `complete` (all required, no type errors), `degraded` (some optional missing, minor type issues, score ≥ 70), or `corrupted` (required missing, major type issues, score < 70)
* **And** `corrupted` results trigger a `PlatformError` with `ErrorTypes.DEGRADED_DATA` and suggested action `RETRY_WITH_DIFFERENT_ACCOUNT`
* **And** degraded-but-acceptable results are stored with a `dataQuality.score` and `dataQuality.missingFields` metadata
* **And** Zod or JSON-Schema is used (pure ESM, no extra heavy dependencies)

### Story 28.2: SelectorCanary — Periodic DOM Probe & Drift Alert
As a **Scraping Operations Engineer**,  
I want **a canary job that periodically probes live DOM selectors and reports when a selector success rate drops**,  
So that **we know about breaking UI changes before production scrapers fail silently**.

**Acceptance Criteria:**
* **Given** `docs/agents/selectors.md` and `docs/case-studies/robust-dom-extraction.md` document fallback selector chains
* **When** implementing `SelectorCanary`
* **Then** it runs as a scheduled job (Bull or cron) against a known set of public test targets per platform
* **And** for each target it tries the primary selector and then the documented fallback chain
* **And** it records `successRate`, `usedFallback`, `driftDetected`, and `lastWorkingSelector`
* **And** if `successRate` drops below `0.8` for two consecutive runs, it emits an alert to the configured channel (email/Slack/Webhook) and sets the platform `driftDetected` flag in governor status
* **And** canary results are viewable on `dashboard/admin.html`

### Story 28.3: AutoSelectorFallback — Assisted Selector Re-Discovery
As a **Scraping Developer**,  
I want **a tool that, given a broken selector, suggests candidate replacements from the current live page**,  
So that **I can recover from DOM drift without manually inspecting every UI change**.

**Acceptance Criteria:**
* **Given** `SelectorCanary` has flagged a drift
* **When** running `AutoSelectorFallback.investigate(platform, pageUrl, expectedShape)`
* **Then** it fetches a live snapshot of the page (via Puppeteer or HTTP)
* **And** it searches the DOM for elements whose text/attributes/children structurally match the expected output shape (e.g., tweet text, like count)
* **And** it returns a ranked list of candidate selectors with confidence scores
* **And** the tool is CLI-accessible: `xactions tools suggest-selector --platform twitter --url https://x.com/elonmusk`

---

## Epic 29: Real-Time Social Event Streaming & Webhook Engine

> **Epic grouping note:** This epic upgrades the existing polling-based `streamManager` to support push-based real-time sources and outbound webhooks. It does not replace `streamManager`; it adds adapters and dispatchers.

### Story 29.1: Jetstream/SSE/CDC Adapters for Push-Based Social Streams
As a **Real-Time Data Consumer**,  
I want **adapters for Bluesky Jetstream, Mastodon SSE, and generic CDC sources**,  
So that **XActions can receive events in real time instead of polling every N seconds**.

**Acceptance Criteria:**
* **Given** `src/streaming/streamManager.js` already polls tweets/followers/mentions via Bull queue
* **When** adding `src/streaming/adapters/` (jetstream.js, mastodon-sse.js, cdc.js)
* **Then** `JetstreamAdapter` connects to `wss://bsky.network/xrpc/app.bsky.jetstream.subscribe*` and emits `PostItem`/ProfileItem events
* **And** `MastodonSSEAdapter` connects to `https://<instance>/api/v1/streaming/public` and normalizes statuses to `PostItem`
* **And** `CDCAdapter` reads from PostgreSQL logical replication or an external Redis stream and emits change events
* **And** all adapters produce the same `ThinEvent` shape and publish via `RedisStreamPublisher` to `stream:social:raw_posts`
* **And** adapters support reconnect, cursor/bookmark persistence, and exponential backoff
* **And** stream types are extended to include `jetstream`, `mastodon_sse`, `cdc`

### Story 29.2: Outbound Webhook Dispatcher with HMAC Signing & Retry
As a **XActions Operator**,  
I want **an outbound webhook dispatcher that signs and retries delivery to subscriber endpoints**,  
So that **Nowing and external consumers can subscribe to real-time events reliably**.

**Acceptance Criteria:**
* **Given** only inbound webhooks exist in `src/scheduler/webhookTrigger.js`
* **When** implementing `src/streaming/outbound-webhook-dispatcher.js`
* **Then** it consumes `ThinEvent` from Redis Stream or Bull queue
* **And** it supports webhook registration with `url`, `events[]`, `secret`, `active` status
* **And** it signs each POST body with `X-XActions-Signature` (HMAC-SHA256)
* **And** it retries with exponential backoff (3 attempts) and moves permanent failures to a dead-letter queue
* **And** delivery metrics (attempts, latency, success/failure) are persisted
* **And** API routes `/api/admin/webhooks/subscriptions` and `/api/admin/webhooks/delivery-logs` are added

### Story 29.3: Stream Replay & Missed-Event Recovery
As a **XActions Consumer**,  
I want **the ability to replay events from a specific time window or cursor**,  
So that **my downstream system can recover from downtime without losing data**.

**Acceptance Criteria:**
* **Given** `streamManager.getStreamHistory()` exists for polling streams
* **When** adding replay support
* **Then** Redis Stream history is retained with configurable `MAXLEN` / `MINID` (already partially supported by `RedisStreamPublisher`)
* **And** `GET /api/streams/:id/replay?since=ISO8601&cursor=...` returns events in order
* **And** replay can be delivered through the same outbound webhook dispatcher
* **And** consumers can request replay from the API or MCP (`x_stream_replay`)

---

## Epic 30: Cross-Platform Action Replay & Content Syndication

> **Epic grouping note:** This is the first *write-side* cross-platform epic. Existing `x_post_tweet`, `x_like`, etc. are X-only. Existing `*_multiplatform` MCP tools are read-only. This epic adds unified publish and interaction dispatch.

### Story 30.1: UniversalActionDispatcher — Cross-Platform Write Actions
As a **Cross-Platform Publisher**,  
I want **a single `post --sync-all` or `like` call that executes on X, Bluesky, Mastodon, and Threads**,  
So that **I do not have to script each platform separately**.

**Acceptance Criteria:**
* **Given** `AbstractCrawler` supports `registerAction` and per-platform crawlers already implement read actions
* **When** adding `src/scrapers/social/actions/` (or extending each `Crawler` with write actions)
* **Then** the dispatcher accepts a `CrawlerCommand` like `{ platform: 'all', action: 'post', args: { text, media } }`
* **And** it resolves the target platforms, validates credentials per account, and dispatches in parallel
* **And** supported actions: `post`, `like`, `reply`, `retweet/repost`, `follow`, `unfollow`
* **And** per-platform implementations are isolated in `src/scrapers/social/<platform>/actions.js`
* **And** failures on one platform do not block others; results are aggregated with `suggestedAction` per failure
* **And** MCP tools `x_publish_all`, `x_like_all`, `x_follow_all` are added to `src/mcp/local-tools.js`

### Story 30.2: ContentTransformer — Thread Splitter, Media Adapter, Character Limit Handler
As a **Cross-Platform Content Creator**,  
I want **automatic content adaptation when posting across platforms with different limits and media rules**,  
So that **a single source post becomes valid posts on every target platform**.

**Acceptance Criteria:**
* **Given** `UniversalActionDispatcher` accepts a unified post
* **When** implementing `ContentTransformer`
* **Then** it splits long threads into platform-specific thread chains (X ≤ 280, Bluesky ≤ 300, Mastodon ≤ 500, Threads ≤ 500)
* **And** it handles media format conversion rules (image count, video duration, file size, aspect ratio)
* **And** it attaches platform-specific metadata such as alt text, hashtags, and mentions formatting
* **And** it returns a `TransformedPost[]` array that the dispatcher can execute in order

---

## Epic 31: Universal Media & Asset Extraction Pipeline

> **Epic grouping note:** This epic generalizes the existing Twitter-only `videoDownloader` and `normalize-media` into a multi-platform media pipeline.

### Story 31.1: UniversalMediaPipeline — Audio, Carousel, HLS on All Platforms
As a **Media Archivist**,  
I want **a pipeline that extracts and normalizes media (photos, videos, audio, carousels) from any platform**,  
So that **I can download and archive multi-platform content with consistent metadata**.

**Acceptance Criteria:**
* **Given** `src/scrapers/social/twitter/normalize-media.js` already handles Twitter photos/videos/HLS
* **When** creating `src/scrapers/social/media-pipeline.js`
* **Then** it defines a `MediaObject` schema with `type`, `url`, `thumbnailUrl`, `width`, `height`, `durationMs`, `bitrate`, `contentType`, `variants[]`
* **And** it has per-platform adapters: `twitter`, `bluesky`, `mastodon`, `threads`, `facebook`, `tiktok`
* **And** each adapter selects the best-quality URL and falls back to HLS/DASH playlists when MP4 is not available
* **And** it supports audio extraction (voice posts, Spaces) and carousel/slide posts
* **And** `x_download_media` MCP tool supports `platform` and `postUrl` and returns `MediaObject[]`
* **And** `src/scrapers/videoDownloader.js` is refactored to delegate to the pipeline for Twitter and other platforms

---

## Epic 32: Operational Rate-Budget & Queue Governance

> **Epic grouping note:** This epic upgrades existing rate governance from in-memory, backend-only metrics into a visible, controllable, distributed queue system.

### Story 32.1: RateBudgetDashboard — Visual Quota Allocator & Panic Stop
As a **XActions Operator**,  
I want **a dashboard that shows live quota usage, drag-drop priority queues, and a panic stop button**,  
So that **I can manage platform risk visually during spikes or incidents**.

**Acceptance Criteria:**
* **Given** `dashboard/admin.html` already shows `healthy-proxies-count` and `governor/status`
* **When** adding a dedicated rate-budget view (or expanding `dashboard/admin.html`)
* **Then** it displays per-consumer RPM usage (`chainlens`, `nowing`, `internal`) and per-account RPM
* **And** it shows a real-time gauge for `throttleLevel` (`normal`, `reduced`, `backpressure`, `critical`)
* **And** it allows drag-and-drop reordering of queued jobs by priority
* **And** it has a `🛑 Panic Stop` button that pauses all non-essential streams and hibernates all accounts for a platform
* **And** it persists layout/priority in `localStorage` and/or backend

### Story 32.2: DistributedTokenBucket — Redis-Backed Quota with Header Parsing
As a **Scraping Platform Engineer**,  
I want **per-consumer and per-account rate limits synchronized across multiple XActions instances**,  
So that **horizontal scaling does not break the existing quota model**.

**Acceptance Criteria:**
* **Given** `AdaptiveRateGovernor` currently keeps `consumerRequestTimestamps` and `accountRequestTimestamps` in memory
* **When** implementing `DistributedTokenBucket`
* **Then** it uses Redis (e.g., `redis.call('CL.THROTTLE', ...)` or Lua scripts) to track token buckets per `consumerId` and `accountId`
* **And** it parses `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers when present
* **And** it exposes `canConsume(key, tokens)` and `consume(key, tokens)` with configurable refill rate, burst, and capacity
* **And** `AdaptiveRateGovernor` can optionally delegate to `DistributedTokenBucket` when `REDIS_TOKEN_BUCKET=1`
* **And** it is tested under multi-process contention

---

## Epic 33: Vietnam Social & Video Platform Expansion

> **Epic grouping note:** This is a *net-new* epic added for Vietnam market pivot. Zalo and YouTube are the two largest VN platforms not yet covered. Spec is new — no prior code or research exists for these platforms.

### Story 33.1: Zalo OA & Public Content Crawler
As a **Vietnam Market Intelligence Analyst**,  
I want **a `ZaloCrawler` in `src/scrapers/social/zalo/index.js` that extends `AbstractCrawler`**,  
So that **Nowing AI can monitor Zalo Official Accounts, public posts, and Zalo Marketplace listings for VN lead generation**.

**Acceptance Criteria:**
* **Given** Zalo Official Account API (`openapi.zalo.me`) provides public OA content endpoints
* **When** calling `scrape('zalo', 'oa_posts', { oaId })` or `scrape('zalo', 'oa_followers', { oaId })`
* **Then** crawler calls Zalo OA API v3.0 via `AbstractApiClient` with `accessToken` from `AccountPool`
* **And** normalizes OA posts to `PostItem` (`platform: 'zalo'`, `category: 'social'`)
* **And** extracts: post ID, OA name, content, images, likes, comments, shares, `publishedAt`
* **And** persists via `PrismaStore` and publishes `ThinEvent` to `stream:social:raw_posts`
* **And** public Zalo Marketplace listings can be searched via `zalo_marketplace_search` action
* **Note:** Zalo personal messaging scrape is deferred — OA API only covers business/public content. Personal Zalo requires mobile API reverse engineering (future work).

### Story 33.2: YouTube VN Channel & Video Crawler
As a **Vietnam Content Intelligence Analyst**,  
I want **a `YouTubeVNCrawler` in `src/scrapers/social/youtube/index.js` that extends `AbstractCrawler`**,  
So that **Nowing AI can monitor trending VN YouTube channels, video comments, and channel metadata for influencer marketing and content analysis**.

**Acceptance Criteria:**
* **Given** YouTube Data API v3 (`googleapis.com/youtube/v3`) provides search, channel, video, comment endpoints
* **When** calling `scrape('youtube', 'search', { query, regionCode: 'VN' })` or `scrape('youtube', 'channel_videos', { channelId })` or `scrape('youtube', 'video_comments', { videoId })`
* **Then** crawler calls YouTube Data API v3 via `AbstractApiClient` with API key from env `YOUTUBE_API_KEY`
* **And** normalizes videos to `PostItem` (`platform: 'youtube'`, `category: 'video'`)
* **And** extracts: video ID, channel name, title, description, viewCount, likeCount, commentCount, `publishedAt`, tags, thumbnailUrl
* **And** comments normalized to `CommentItem` with parent-child threading
* **And** HTML fallback via `yt-dlp` or `invidious` when API quota exhausted (10k units/day free tier)
* **And** VN-specific: `regionCode: 'VN'` filter, VN trending via `chart=mostPopular&regionCode=VN`
* **And** persists via `PrismaStore` and publishes `ThinEvent` to `stream:social:raw_posts`

---

## Revised Epic Priority & Execution Order (Vietnam Market Pivot — 2026-09-05)

> **Rationale:** XActions serves Nowing AI Lead Hub for the Vietnam market. VN-specific platforms (Epic 21–22, 33) deliver direct business value immediately. Infrastructure hardening (Epic 27–32) follows once VN crawlers are stable.

```
Phase A — Vietnam Core (NEXT):
  Epic 21 → B2B tender, company registry, automotive     [reactivated from backlog]
  Epic 22 → F&B, healthcare, legal/IP                  [reactivated from backlog]
  Epic 33 → Zalo OA + YouTube VN                       [net-new]

Phase B — Infrastructure Hardening:
  Epic 27 → Anti-detection & session resilience
  Epic 28 → Schema drift & selector resilience
  Epic 29 → Real-time streaming & webhooks

Phase C — Advanced Features:
  Epic 30 → Cross-platform action sync
  Epic 31 → Universal media pipeline
  Epic 32 → Rate budget & queue governance

Phase D — Finalization:
  Epic 20 → Nowing cutover & decommission
  Epic 24 → Utility/adapters migration
  Epic 25 → Unified dispatcher final
  Epic 26 → Legacy removal
```

**VN Platform Coverage Matrix (post-pivot):**

| Platform | Status | Epic | Category |
|---|---|---|---|
| Shopee | ✅ Done | 16.1 | E-commerce |
| TikTok Shop | ✅ Done | 16.2 | E-commerce |
| Chợ Tốt | ✅ Done | 17.1 | Real estate |
| Batdongsan | ✅ Done | 17.2 | Real estate |
| TopCV | ✅ Done | 18.1 | Recruitment |
| VietnamWorks | ✅ Done | 18.2 | Recruitment |
| LinkedIn | ✅ Done | 18.3 | B2B |
| Facebook | ✅ Done | 13.3–13.10 | Social |
| TikTok | ✅ Done | 15.2 | Social |
| Threads | ✅ Done | 15.1 | Social |
| MaSoThue | ✅ Feasible (HTTP-only) | 21.1 | B2B registry |
| HoSoCongTy/MuaSamCong | 🟡 Blocked (Cloudflare/SPA) | 21.3 | B2B registry |
| Oto/Bonbanh/ChototXe | 📋 Spec ready | 21.2 | Automotive |
| PasGo/Foody/Riviu | 📋 Spec ready | 22.1 | F&B |
| Medpro/YouMed/Thuocsi | 📋 Spec ready | 22.2 | Healthcare |
| IP Vietnam | 📋 Spec ready | 22.3 | Legal |
| **Zalo OA** | ❌ Net-new | 33.1 | Social/messaging |
| **YouTube VN** | ❌ Net-new | 33.2 | Video |

---

## Conditions to Start / Reactivate Epic 27–32

1. **Epic 20, 24, 25, 26** (cleanup, dispatcher, decommission) must be stable; new infrastructure must sit on top of a single `AbstractCrawler`/`AbstractApiClient` contract.
2. **Epic 23** (Bluesky/Mastodon) should be in production long enough to validate that lightweight platforms work on the new architecture.
3. Architecture review confirms `FingerprintManager`, `SessionHealthOrchestrator`, `SchemaDriftGuard`, `JetstreamAdapter`, `UniversalActionDispatcher`, `UniversalMediaPipeline`, and `DistributedTokenBucket` fit within the existing `src/core/` + `src/scrapers/social/` layout without major core rewrites.
4. Product Council approves the expanded PRD/UX for the new operator dashboards and cross-platform write features.

## Definition of Done for Epic 27–32

- Each story has tests in `tests/core/`, `tests/scrapers/`, or `tests/admin/`.
- No duplicate implementation of existing `AdaptiveRateGovernor`, `AccountPool`, `ProxyIpPool`, `StealthBrowser`, `streamManager`, `webhookTrigger`, or `metadataSchemaRegistry`.
- No scope overlap with **Nowing** (CDP operator, CRM, lead scoring, outbound) or **ChainLens** (deep research).
- All new UI additions are reflected in `dashboard/admin.html` or new dedicated HTML files.
- `npm run typecheck` and `vitest run` pass.
- `docs/` updated: `architecture.md`, `stealth-scraping.md`, `streaming.md`, `api-reference.md`.
