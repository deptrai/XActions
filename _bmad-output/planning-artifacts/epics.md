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
* **FR84 (Multi-Consumer Service Contract & Decommissioning):** Biến `scrape()` dispatcher thành service-to-service contract cho multi-consumer (Nowing, ChainLens, AI agents) qua MCP `x_scrape` + Redis Stream `stream:social:raw_posts` + `x_actions_list` discovery. Gỡ bỏ 20+ scraper cũ khỏi Nowing backend sau shadow-run ≥99% parity. (Epic 20)
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
* **And** `AbstractCrawler.start(command)` kiểm tra `ActionDescriptor.checkpointResolver` và tự động gọi `store.getCheckpoint(platform, targetType, targetKey)` khi caller không truyền `cursor`/`after`/`max_id`.
* **And** `ActionDescriptor` hỗ trợ trường tùy chọn `checkpointResolver?: (args) => { targetType, targetKey, cursorField, fallbackCursorFields }`.
* **And** `AbstractCrawler.start()` đảm bảo cursor từ caller luôn được ưu tiên (không ghi đè).
* **And** `AbstractCrawler` cung cấp `shouldStopPagination(items): Promise<boolean>` helper để crawler con dừng sớm khi tất cả items đã tồn tại.
* **And** `GovernorStatusApi` định nghĩa shape `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.
* **And** `node src/core/index.js` parse thành công và `npx prisma validate` pass.

### Story 10.2: prisma-post-comment-relational-schema-migration
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
* **And** `storeBatch()` trả về object `{ insertedCount, duplicateCount, totalCount, schemaValid }`.
* **And** `AbstractStore` / `PrismaStore` implement `findExistingIds(ids): Promise<string[]>` để kiểm tra danh sách items đã tồn tại trước khi lưu.

### Story 10.3: ai-dataset-export-utility-streaming-jsonl-csv
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

### Story 11.1: proxyippool-accountpool-sticky-round-robin
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

### Story 11.3.429: 403-auto-quarantine-exponential-backoff
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

### Story 11.4: adaptive-rate-limiter-account-protection-governor
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

### Story 11.5: end-to-end-request-pipeline-two-mode-ip
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

### Story 11.6: rate-limit-bot-challenge-defense
As a **Reliability Engineer**,
I want **hệ thống tự động xử lý 429/403 và WAF/captcha bằng cách cách ly proxy, retry với proxy mới, và đưa tài khoản vào hibernation**,
So that **hệ thống không die hàng loạt khi nền tảng kích hoạt bảo vệ**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` pipeline đã chạy
* **When** nhận `isRateLimit` hoặc HTTP 429/403
* **Then** throw `RateLimitError`, `proxyPool.quarantine(proxy)`, retry tối đa 3 lần với proxy mới và exponential backoff 1s, 2s, 4s.
* **And** khi `isBotChallenge` hoặc WAF/captcha → throw `BotChallengeError`, `proxyPool.quarantine(proxy, 5 phút)`, `governor.hibernateAccount(accountId, 'bot_challenge', 15–30 phút)`, `accountPool.markUnavailable(accountId)` và chuyển sang account/proxy tiếp theo.
* **And** toàn bộ proxy bị quarantine → chuyển Standby Backoff 30s thay vì loop vô tận.

### Story 11.7: crawler-governor-integration-validator-contract
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

### Story 11.9: dual-pool-consumer-quota
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

### Story 12.1: terminal-ascii-qr-code-login-module
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

### Story 12.2: cdp-remote-attach-mode-chrome-devtools-protocol
As a **Power User**,
I want **kết nối XActions trực tiếp vào Chrome thật của tôi qua cổng 9222 với helper tự mở Chrome và độ trễ ngẫu nhiên Gaussian**,
So that **hệ thống sử dụng nguyên vẹn profile và fingerprint thật của tôi để cào LinkedIn/TopCV mà không bị phát hiện automation**.

**Acceptance Criteria:**
* **Given** lệnh `unfollowx auth --launch-chrome` hoặc Chrome đang mở cổng 9222
* **When** gọi `launchBrowserWithCdp('http://localhost:9222')` trong `src/core/base-crawler.js`
* **Then** Playwright kết nối thành công tới browser instance đang mở mà không spawn process mới
* **And** áp dụng độ trễ phân phối ngẫu nhiên Gaussian Jitter (3–7s) giữa các thao tác cào.

### Story 12.3: terminal-qr-full-backfill
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

### Story 13.1: tiered-signer-architecture-token-ring-worker-pool
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

### Story 13.4: facebook-browser-as-signer-bridge
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

### Story 13.11: marketplace-advanced-filters-sort-condition
- **Phase:** Post-retro hardening (appended 2026-09-19, completes FUTURE-WORK "Marketplace Advanced Filters" remainder)
- **Estimate:** 0.5 sprint
- **File:** [stories/13-11-marketplace-advanced-filters-sort-condition.md](../implementation-artifacts/stories/13-11-marketplace-advanced-filters-sort-condition.md)
- **Scope:** `marketplace()` đã có `minPrice/maxPrice/category/categoryId/radiusKm/lat/lng/cursor` (Story 13.8); story này thêm `sortBy` (`relevance|price_asc|price_desc|date_listed`), `condition` (`new|used`), và expose đầy đủ `radiusKm/latitude/longitude/categoryId/sortBy/condition` vào MCP `x_facebook_marketplace` inputSchema + CLI flags.

---


### Story 13.12: graphql-replay-engine-conditional
- **Status:** `backlog-blocked`. Capture `doc_id` + `fb_dtsg`/`lsd`/`__dyn`/`__csr` từ Puppeteer request, replay bằng HTTP client với replay cache + DOM/hydration fallback khi doc_id rotate.
- **Activation:** ≥80% `doc_id` mapping ổn định 30 ngày production-like traffic + replay cache storage + Product Council approve Phase 3.
- **Stub:** [stories/13-12-graphql-replay-engine-conditional.md](../implementation-artifacts/stories/13-12-graphql-replay-engine-conditional.md)


## Epic 14: Deep Conversation Scraper, MCP Daemon & Nowing Event Stream

### Story 14.1: hierarchical-comment-tree-extraction-algorithm
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
* **Then** hệ thống thực hiện tokenize, lọc stopwords đa ngôn ngữ (hỗ trợ Tiếng Việt & Tiếng Anh từ `src/analytics/stopwords/vi.txt` và `en.txt`, load vào `Set`; ngôn ngữ không có list thì bỏ qua bước lọc)
* **And (Vietnamese tokenization)** Tiếng Việt là ngôn ngữ đơn âm/ghép — whitespace tokenize cho ra âm tiết chứ không phải từ (`thị trường` là một từ, hai âm tiết). Spec phải ghi rõ chiến lược: dùng compound-aware segmenter, hoặc document rõ fallback "bigram-of-syllables" để khôi phục từ ghép; NFC-normalize và lowercase toàn bộ token trước khi đếm.
* **And (return shape)** hàm trả về `{ unigrams: [{ term, count }], bigrams: [{ term, count }], hashtags: [{ tag, count }], totalTokens, lang }`; sắp xếp deterministic `count` giảm dần rồi `term` tăng dần.
* **And (n-gram boundary)** bigram tính trên token stream đã lọc; không bao giờ span qua stopword, dấu câu, hoặc ranh giới item.
* **And (hashtag)** trích xuất `tag` bỏ ký tự `#`, NFC-normalize + lowercase, loại trừ fragment trong URL/email và `#` theo sau toàn số (regex `#(?=[\p{L}])[\p{L}\p{N}_]+`).
* **And (input source)** MCP tool `x_analytics_buzzwords` và CLI `xactions analytics buzzwords` nhận đầu vào `{ items? | scrapeId? | source }`; CLI đọc `PostItem[]`/`CommentItem[]` từ file/stdin hoặc truy vấn lại một scrape đã lưu — không yêu cầu caller truyền object sống qua boundary MCP.
* **And (edge cases)** `minLength` clamp về `>= 1`; `topN = max(0, floor(topN ?? 10))`; với `items` rỗng/null, item thiếu `content`, hoặc `content` không phải string → bỏ qua item đó và trả `{ unigrams: [], bigrams: [], hashtags: [], totalTokens: 0, lang }` thay vì throw.
* **And (cost & default)** `includeBuzzwords` là opt-in (mặc định **tắt**) trong `AbstractCrawler` options; khi bật, `summary.buzzwords` chứa kết quả `extractKeywordFrequency` trên tối đa 500 item đầu để giới hạn chi phí O(n); khi crawl không có text thì `summary.buzzwords` là mảng rỗng chứ không phải `undefined`.
* **And (tests)** thêm unit test thật (không mock) trong `tests/analytics/word-frequency.test.js` cover: loại stopword vi+en, bigram không span stopword/item boundary, hashtag case-fold + bỏ URL fragment, và input rỗng/invalid trả về zero-result.

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

### Story 15.1.3: threads-hybrid-docid-hardening-search-comments
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

### Story 15.2: tiktok-video-hashtag-comment-scraper
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

### Story 16.1: shopee-search-product-review-scraper-tls-spoofing
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

### Story 18.3: linkedin-b2b-lead-job-scraper-via-cdp-remote-attach
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

### Story 19.10: admin-mcp-tools
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

## Epic 20: Multi-Consumer Scraping Platform Service Contract

> **Restructured 2026-09-15** — Kiến trúc kết nối thay đổi từ custom adapter sang MCP `x_scrape` + Redis Stream. Nowing đã wire phía mình; XActions cần expose service contract. Xem `sprint-change-proposal-2026-09-15-multi-consumer-scraping-platform.md`.

### Story 20.1: multi-consumer-service-contract-x-scrape-x-actions

As a **XActions Platform Engineer**,
I want **expose `scrape()` dispatcher thành service-to-service contract qua MCP `x_scrape` tool, mở rộng `x_actions_list` cho toàn bộ 24 platforms, và generate canonical action matrix doc**,
So that **Nowing, ChainLens, và bất kỳ consumer nào đều gọi được XActions qua cùng một contract — control plane qua MCP, discovery qua `x_actions_list`**.

**Acceptance Criteria:**

* **Given** `scrape()` dispatcher đã có sẵn (Epic 25)
* **When** implement `x_scrape` MCP tool trong `src/mcp/server.js`
* **Then** `x_scrape` nhận input:
  - `platform` (required), `action` (required), `args` (object, nested), `context` (`Record<string, unknown>` — mở cho multi-tenant: `targetId`, `workspaceId`, `traceId`...), `accountId`, `proxyUrl`, `dryRun` (default `false`), `artifactFormat`
  - Forward `args` → `scrape(platform, action, args)` qua `descriptor.mapArgs` (đảm bảo alias resolution như `taxCode → q`)
* **And** `x_scrape` trả unified envelope cùng shape cả stream và non-stream mode:
  ```
  { success, mode: 'stream'|'direct', metadata: {platform, action, durationMs, totalRecords},
    stream: {enabled, name, cursor: lastEventId}, preview: [...≤10 items], data: [...] }
  ```
  - `mode='stream'` khi `REDIS_STREAM_ENABLED=true` → preview ≤10 items + stream cursor
  - `mode='direct'` khi disabled → data = full result
* **And** `dryRun=true` KHÔNG emit stream events
* **And** Pre-validate `requiredArgs` → trả `XACT_4002` + `missing[]` + `example` khi thiếu args
* **And** "Did You Mean?" suggestion khi action không tồn tại (dùng `DEPRECATED_ACTIONS` + `availableActions` trong `XACT_4001`)
* **And** `context.workspaceId` missing khi stream enabled → WARN log `[StreamPublisher:MissingWorkspaceId]`

* **When** mở rộng `src/scrapers/social/actions-list.js`
* **Then** `x_actions_list` enumerate toàn bộ 24 platform descriptors (thêm fnb, healthcare, legal, automotive, b2b-registry-extended, tiktokShop)
* **And** verify mỗi platform có Crawler class với `listActions()` — platform nào chưa có → flag `"no_crawler": true` trong output, KHÔNG silent-skip
* **And** lọc bỏ `checkpointResolver` khỏi `ActionDescriptor` trước khi trả (function ref, không serialize)
* **And** filter theo `category` + `detailLevel: 'summary'|'full'`
* **And** `b2b-registry-extended` dùng `index.js` (không phải `crawler.js`) — loader cần xử lý

* **When** generate canonical action/arg matrix
* **Then** `npm run docs:matrix` auto-generate `docs/canonical-action-matrix.md` (human-readable) + `docs/canonical-action-matrix.json` (machine-readable cho Nowing CI validation)

* **And** `src/mcp/envelope.js` `extractRecords()` thêm `'listings'`, `'products'`, `'jobs'` vào key list (fix VN crawler envelope)

### Story 20.2: universal-stream-publish-hook-snake-case-thin-event

As a **XActions Platform Engineer**,
I want **thêm universal stream-publish hook vào `AbstractCrawler` sau `entry.handler()` trong `start()`, normalize sang snake_case ThinEvent, và gỡ bỏ per-crawler direct emit**,
So that **tất cả 23+ crawlers tự động emit thin events vào Redis Stream `stream:social:raw_posts` — zero per-crawler code**.

**Acceptance Criteria:**

* **Given** `AbstractCrawler.start()` gọi `entry.handler()` rồi return result
* **When** thêm stream-publish hook sau `entry.handler()` trong `start()`
* **Then** extract items từ result (`posts`, `products`, `listings`, `jobs`, `items`), chạy qua `mapToThinEvent(item, context)`, emit qua `RedisStreamPublisher`
* **And** `formatPayload()` trong `redis-stream-publisher.js` sửa để map snake_case + hỗ trợ `content_snippet`, `target_id`, `workspace_id`, `schema_version` (hiện hardcode camelCase whitelist)

* **When** định nghĩa `mapToThinEvent(item, context)` trong base hook
* **Then** normalize sang snake_case ThinEvent schema:
  ```
  { id, platform, external_post_id, category, author_id, author_name,
    post_url, crawled_at, storage_ref, scraper_id, content_snippet,
    target_id, workspace_id, schema_version: 1 }
  ```
* **And** per-category field mapping:
  - `PostItem` → `content_snippet` = text (truncate ≤4000), `author_id` = authorId
  - `ProductItem` → `content_snippet` = title + description, `author_id` = shop_id
  - `CompanyItem` → `content_snippet` = name + industry + address, `author_id` = taxCode
  - `JobItem` → `content_snippet` = title + company + location, `author_id` = companyId
  - `ListingItem` → `content_snippet` = title + price + area, `author_id` = sellerId
* **And** `content_snippet` BẮT BUỘC — Nowing consumer drop nếu thiếu
* **And** `target_id`/`workspace_id` từ `session.context` — forward nguyên vẹn
* **And** `workspace_id` dùng `??` không `||` (vì `0` là falsy)
* **And** Dual-emit camelCase + snake_case fields trong transition period (không break existing consumers)

* **When** decommission per-crawler direct emit
* **Then** gỡ bỏ `FacebookCrawler.#saveCheckpoint` direct `xAdd` → delegate sang base hook
* **And** gỡ bỏ `ThreadsCrawler`, `Medium`, `Reddit`, `YouTube`, `Zalo` `#emitCheckpointAndStream` → delegate sang base hook
* **And** gate bởi `REDIS_STREAM_ENABLED`, `MAXLEN ~200K` (khuyến nghị hạ từ 1M do `content_snippet` tăng event size ~4KB)

* **When** `entry.handler()` completes và stream publish fails
* **Then** log warn, KHÔNG crash crawler (non-blocking)
* **And** `result.__streamCursor` = lastEventId (cho `x_scrape` trả về consumer)
* **And** `x_scrape` response include `stream_delivery: 'ok'|'failed'` flag

---

> **External Milestones** (tracked ở Nowing repo, KHÔNG block Epic 20):
> - **20.3** — Nowing Shadow-Run Validation: `x_scrape` + stream consumer parity ≥99% trong 7 ngày. Parity = `fields_matched/total_fields` trên matched records; volatile fields (`likesCount`, `viewsCount`, `publishedAt`, `crawledAt`) excluded.
> - **20.4** — Nowing Legacy Decommissioning: xóa 20+ scraper dirs + Chromium/Selenium khỏi Dockerfile. Blocked by 20.3.

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
Epic 20.2 (Stream-publish hook) ───┐
                                    ├──→ Epic 26 (Final legacy removal)
Epic 23 (Bluesky/Mastodon) ─────────┤
Epic 24 (Utility/Adapters) ─────────┤
                                    │
                                    ↓
                            Epic 25 (Unified dispatcher)
```

- **Epic 23** and **Epic 24** can run in parallel after Epic 13.1 (Tiered Signer) and 13.3 (Facebook hybrid) are done.
- **Epic 25** depends on 23, 24, and Phase 4 integration stories (13.2.12, 13.10, 15.1.4).
- **Epic 26** depends on 25 and Epic 20 external milestone 20.3 (Nowing shadow-run parity ≥ 99% for 7 days).

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
* **And** dispatcher truyền `args` trực tiếp; `AbstractCrawler.start()` tự động xử lý checkpoint resume
* **And** caller có thể truyền `args.resume: false` để tắt auto checkpoint lookup
* **And** `options.cursor` từ caller luôn được ưu tiên so với checkpoint (backward compatible)

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

### Story 25.5: core-checkpoint-resume-engine
As a **Nowing Integrator**,  
I want **`AbstractCrawler` to automatically resume scraping from the last saved checkpoint and stop early when all page items already exist in DB**,  
So that **we save proxy cost and avoid duplicate full re-crawls on every scheduled run**.

**Acceptance Criteria:**
* **Given** `CrawlCheckpoint` table exists with `(platform, targetType, targetKey, lastCursor)`
* **When** `AbstractCrawler.start({ action, args: { groupId: '123' } })` is called without `cursor`
* **Then** it looks up checkpoint by `ActionDescriptor.checkpointResolver` and injects `lastCursor` into `args` before calling handler
* **And** if no checkpoint exists, it starts from the beginning without error
* **And** caller-provided `cursor`/`after` is never overwritten
* **And** `AbstractCrawler` exposes `shouldStopPagination(items)` helper
* **And** `PrismaStore.storeBatch()` returns `{ insertedCount, duplicateCount, totalCount, schemaValid }`
* **And** existing benchmark telemetry is not broken

### Story 25.6: checkpoint-resolvers-top-platforms
As a **Platform Engineer**,  
I want **each major platform crawler to define a stable `checkpointResolver` for its paginated actions**,  
So that **auto resume works correctly and consistently across platforms**.

**Acceptance Criteria:**
* **Given** Facebook, Twitter, TikTok, Threads, Shopee, Batdongsan crawlers extend `AbstractCrawler`
* **When** their paginated actions are registered via `registerAction()`
* **Then** each action has an optional `checkpointResolver` returning `{ targetType, targetKey, cursorField, fallbackCursorFields }`
* **And** `targetKey` is stable (sorted key-value pairs, trimmed, lowercased, no pagination params)
* **And** resolvers cover at least: `group_posts`, `page_posts`, `search`, `marketplace` (Facebook); `search`, `hashtag`, `followers`, `following` (Twitter); `search`, `hashtag_feed` (TikTok); `search`, `get_user_feed` (Threads); `search_products` (Shopee); `search_listings` (Batdongsan)

### Story 25.7: early-termination-pagination-loops
As a **Reliability Engineer**,  
I want **crawler pagination loops to stop as soon as a full page of already-stored items is detected**,  
So that **scheduled re-scrapes do not waste proxy requests on data we already have**.

**Acceptance Criteria:**
* **Given** `storeBatch()` returns insertion metadata
* **When** a crawler fetches a page where all items are duplicates
* **Then** `shouldStopPagination()` returns `true` and the loop breaks
* **And** the behavior is implemented for Facebook, Twitter, TikTok in first pass
* **And** no existing test or benchmark telemetry regresses

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

### Story 27.4: obscura-public-scraping-backend-watch-gate
As a **Scraping Reliability Engineer**,  
I want **a pluggable browser backend in `stealthBrowser.js` where `obscura` (CDP) serves guest-visible scraping while `chrome` stays default for post-auth automation, plus a watch gate that promotes `obscura-for-auth` only after spike-verify**,  
So that **we cut ~85% browser RAM on public scrapes without risking React-hydration failures on logged-in automation**.

**Acceptance Criteria:**
* **Given** `PuppeteerAdapter.launch/connect` (`src/scrapers/adapters/puppeteer.js`) and `launchStealthBrowser(options)`
* **When** `options.backend` or `XACTIONS_BROWSER_BACKEND` selects `obscura`
* **Then** it `puppeteer-core.connect({browserWSEndpoint})` to `options.wsEndpoint || OBSCURA_WS_ENDPOINT || ws://127.0.0.1:9222`; `chrome`/unset → `puppeteer.launch()` unchanged; `browser.__backend` recorded; teardown reads `__backend` (`obscura`→`disconnect()`, `chrome`→`close()`)
* **And** a public scraper bridge (e.g. reddit/medium) threads `options.backend`/`requiresAuth` into `adapter.launch()` so backend reaches the scraper — not only `launchStealthBrowser`
* **And** post-auth actions (`requiresAuth===true`, resolved per base-crawler.js:177) reject `backend==='obscura'` with `PlatformError{ type: INVALID_ARGS }` (no silent fallback, no separate registry)
* **And** primary/fallback via `XACTIONS_BROWSER_BACKEND` + `XACTIONS_BROWSER_BACKEND_FALLBACK` (default `chrome`): `obscura→chrome` always allowed; `chrome→obscura` only on public-scraping path (post-auth still throws via guard)
* **And** `XACTIONS_BROWSER_BACKEND_METRICS=1` tags each real browser launch/probe with `browserBackend` (Epic 34 `emitRun`); per-backend latency/success comparison runs via `obscura-spike.mjs BACKEND=both` — default OFF, `CanaryRunner` unchanged (it probes HTTP, not browser)
* **And** all `obscura` navigation uses `waitUntil:'networkidle0'`/`load`/`domcontentloaded` — never `networkidle2` (hangs on 0.2.2)
* **And** `scripts/obscura-spike.mjs BACKEND=both` verifies chrome vs obscura on example/cloudflare/sannysoft/x-guest, skips cleanly when no `obscura serve`
* **And** `docs/obscura-backend.md` (install, `obscura serve --stealth`, env vars, fit matrix) + `docs/obscura-watch.md` (issue watch list, promote gate requiring `/home` `data-testid` mount green) exist
* **And** `puppeteer-core` is a direct dependency; zero other new deps

> Full spec: `implementation-artifacts/spec-27-4-obscura-public-scraping-backend-watch.md`

---

### Story 27.5: canvas-webgl-audio-fingerprint-spoofing-conditional
- **Status:** `backlog-blocked`. Inject noise động vào `HTMLCanvasElement.toDataURL`/`getImageData`, WebGL buffer readback, `AudioContext`/`AnalyserNode` cho bot-challenge targets. `stealthBrowser.js` hiện chỉ spoof WebGL vendor/renderer tĩnh.
- **Activation:** FR-40..FR-54 stable + checkpoint rate vẫn > 5%.
- **Stub:** [stories/27-5-canvas-webgl-audio-fingerprint-spoofing-conditional.md](../implementation-artifacts/stories/27-5-canvas-webgl-audio-fingerprint-spoofing-conditional.md)


## Epic 28: Schema Drift & Selector Resilience

> **Epic grouping note:** This epic hardens data quality. It does not replace existing crawlers; it wraps them with validation, drift detection, and self-healing selector fallback so silent data degradation is impossible.

### Story 28.1: SchemaDriftGuard — Runtime Contract Validation & Completeness Classification
As a **Data Quality Engineer**,  
I want **runtime validation of crawler output against a platform/action schema and automatic classification as `complete`, `degraded`, or `corrupted`**,  
So that **downstream consumers never receive silently empty or malformed data**.

**Acceptance Criteria:**
* **Given** `MetadataSchemaRegistry` and `validateSchemaNode()` already exist in `src/core/metadata-schema-registry.js`
* **When** wiring `SchemaDriftGuard` (`src/core/schema-drift-guard.js`) into `AbstractCrawler.validateItem`
* **Then** each crawler registers a `PostItem`/`ProfileItem`/`CommentItem` schema per action
* **And** `SchemaDriftGuard.validate(platform, action, data)` returns `{ classification, missingFields, typeErrors, score }`
* **And** score is computed deterministically as `score = max(0, 100 − 35×missingRequired − 15×typeErrors − 5×missingOptional)`
* **And** `classification` is `complete` (no missing required, no type errors, score ≥ 95), `degraded` (no missing required, score ≥ 70), or `corrupted` (any missing required field, or score < 70)
* **And** `corrupted` results trigger a `PlatformError` with `ErrorTypes.DEGRADED_DATA` (new enum in `src/core/error-envelope.js`) and suggested action `RETRY_WITH_DIFFERENT_ACCOUNT`
* **And** degraded-but-acceptable results are stored with a `dataQuality.score` and `dataQuality.missingFields` metadata
* **And** validation reuses the existing `validateSchemaNode()` JSON-Schema evaluator — **no Zod, no Ajv, zero new dependencies** (pure ESM)

### Story 28.2: SelectorCanary — Periodic DOM Probe & Drift Alert
As a **Scraping Operations Engineer**,  
I want **a canary job that periodically probes live DOM selectors and reports when a selector success rate drops**,  
So that **we know about breaking UI changes before production scrapers fail silently**.

**Acceptance Criteria:**
* **Given** `docs/agents/selectors.md` and `docs/case-studies/robust-dom-extraction.md` document fallback selector chains
* **When** implementing `SelectorCanary` (`src/services/selector-canary.js`)
* **Then** it runs as a scheduled job (Bull repeatable job via existing `api/services/jobQueue.js`, or standalone `setInterval` when no Redis) against a declared set of public test targets per platform stored in `config/canary-targets.json` (twitter/facebook/youtube/threads — public profiles & feeds only)
* **And** for each target it tries the primary selector and then the documented fallback chain
* **And** it records `successRate`, `usedFallback`, `driftDetected`, and `lastWorkingSelector`
* **And** if `successRate` drops below `0.8` for two consecutive runs, it emits an alert via the existing notification dispatch (Telegram/webhook channel already used by the platform) and exposes `platformDrift[platform] = { alert, successRate, lastProbe }` through `AdaptiveRateGovernor.getStatus()` / `status-api`
* **And** canary results are viewable on `dashboard/admin.html` as a drift-status badge per platform (green ok / red drift)

### Story 28.3: AutoSelectorFallback — Assisted Selector Re-Discovery
As a **Scraping Developer**,  
I want **a tool that, given a broken selector, suggests candidate replacements from the current live page**,  
So that **I can recover from DOM drift without manually inspecting every UI change**.

**Acceptance Criteria:**
* **Given** `SelectorCanary` has flagged a drift
* **When** running `AutoSelectorFallback.investigate(platform, pageUrl, expectedShape)` (`src/core/auto-selector-fallback.js`)
* **Then** it fetches a live snapshot of the page (via Puppeteer `createStealthPage` or HTTP)
* **And** it searches the DOM for elements whose text/attributes/children structurally match the expected output shape (e.g., tweet text, like count)
* **And** it returns a ranked list of candidate selectors with `confidenceScore` (0.0–1.0), **preferring stable attributes in order `data-testid` → `role`/`aria-*` → semantic tag+structure, and rejecting obfuscated hash-only class selectors**
* **And** the tool is CLI-accessible via the existing commander wiring in `src/cli/commands/`: `xactions tools suggest-selector --platform twitter --url https://x.com/elonmusk --field tweet_text`

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

### Story 33.3: zalo-personal-messaging-research-spike-conditional
- **Status:** `backlog-blocked` — research-gated. Cào Zalo cá nhân (tin nhắn, nhóm, friend list) qua reverse-engineered private mobile/Web API.
- **Activation:** research spike 2 tuần + Nowing concrete need + legal/compliance approve.
- **Stub:** [stories/33-3-zalo-personal-messaging-research-spike-conditional.md](../implementation-artifacts/stories/33-3-zalo-personal-messaging-research-spike-conditional.md)

### Story 33.4: youtube-vn-advanced-data-conditional
- **Status:** `backlog-blocked`. Live stream chat, Shorts deep analytics, subscriber history qua InnerTube/extended API.
- **Activation:** Epic 33.2 stable production ≥2 tuần + YouTube API quota optimization.
- **Stub:** [stories/33-4-youtube-vn-advanced-data-conditional.md](../implementation-artifacts/stories/33-4-youtube-vn-advanced-data-conditional.md)

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
| PasGo/Foody/Riviu | ✅ Ready (probed) | 22.1 | F&B |
| Medpro/YouMed/Long Chau | ✅ Ready (probed) | 22.2 | Healthcare |
| Thuocsi | 🟡 Auth-gated (deferred to Epic 24) | 22.2 | Healthcare |
| IP Vietnam | ✅ Ready (probed) | 22.3 | Legal |
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

---

# Epic 34: Scraper Benchmark & Reliability Suite

## Business Context

Nowing (B2B Lead Hub) depends on XActions để scrape 15+ nền tảng. Không có benchmark suite, không thể đo lường khách quan:
- **Stability**: scraper nào thất bại âm thầm (False 200, login wall, Cloudflare)?
- **Quality**: scraper nào trả về dữ liệu thiếu hoặc sai schema?
- **Noise**: scraper nào sinh duplicate, spam, lead sai?
- **Cost**: scraper nào đốt proxy/account không hiệu quả?

Nowing cần **Health Score (0-100)** và **Tier (A/B/C)** cho mỗi scraper để ưu tiên bảo trì, phân bổ proxy budget, và đánh dấu nguồn kém cho con người xem xét.

## Scope

**Trong scope:**
- CAP-1: Synthetic Canary Probes (kiểm tra sức khỏe định kỳ)
- CAP-2: Production Telemetry Hooks (tích hợp vào `AbstractCrawler`)
- CAP-3: Benchmark Scoring Engine (4 trụ cột: Stability 35%, Quality 30%, Noise 20%, Cost 15%)
- CAP-4: Operator Scorecard CLI + Dashboard + Nowing `benchmark_health` flag
- CAP-5: Noise & Relevance Metrics (duplicate, spam, contact accuracy)

**Ngoài scope:**
- Không auto-remediation (Epic 27/28)
- Không telemetry/APM bên ngoài
- Không API khách hàng bên ngoài

## Architecture Decisions

- **AD-23**: Two-Tier Telemetry Architecture (Redis Stream raw → PostgreSQL aggregated)
- **AD-24**: Non-Blocking Telemetry Emission
- **AD-25**: Centralized Instrumentation (không sửa platform crawlers)
- **AD-26**: Hard Knock-Out Gates (True Success <80% OR Field Fill <85% OR False 200 >15% → Tier C)
- **AD-27**: Alert-Only Tier C (không auto-cutoff)
- **AD-28**: Category-Aware Metrics (social/ecommerce/directory/registry/fnb/healthcare/legal)

## Stories

## Stories

### Story 34.1: Benchmark Telemetry Schema & Storage

- Phase: MVP | Estimate: 1 sprint
- File: stories/34-1-benchmark-telemetry-schema-storage.md

### Story 34.2: Production Telemetry Hooks

- Phase: MVP | Estimate: 1 sprint
- File: stories/34-2-production-telemetry-hooks.md

### Story 34.3: Platform Validators False-200

- Phase: MVP | Estimate: 1 sprint
- File: stories/34-3-platform-validators-false-200.md

### Story 34.4: Benchmark Scoring Engine

- Phase: MVP | Estimate: 1 sprint
- File: stories/34-4-benchmark-scoring-engine.md

### Story 34.5: Operator Scorecard CLI & Dashboard

- Phase: MVP | Estimate: 1 sprint
- File: stories/34-5-operator-scorecard-cli-dashboard.md

### Story 34.6: Nowing Integration Health Flag

- Phase: MVP | Estimate: 0.5 sprint
- File: stories/34-6-nowing-integration-health-flag.md

### Story 34.7: Synthetic Canary Probe Scheduler

- Phase: Hardening | Estimate: 0.5 sprint
- File: stories/34-7-synthetic-canary-probe-scheduler.md

### Story 34.8: Active Alerting Requalification Workflow

- Phase: Hardening | Estimate: 0.5 sprint
- File: stories/34-8-active-alerting-requalification-workflow.md


**Tổng:** 8 stories, ~5 sprints

## Success Metrics

- Tất cả 15+ scraper được đánh giá Tier A/B/C với Health Score.
- Nowing nhận thin events có `benchmark_health` + `benchmark_alert`.
- Tier C gửi alert cho operator nhưng ingestion vẫn tiếp tục.
- Telemetry overhead <1% latency (NFR-19).
- Canary probe chạy hàng giờ mỗi platform (NFR-20).

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Write amplification (DB bloat) | Two-tier: Redis Stream raw → PostgreSQL rollups |
| Latency overhead | Fire-and-forget, in-memory buffer, batch flush |
| False 200 miss | Platform validators + canary tests |
| Weak scraper masked as Tier B | Hard knock-out gates |
| Low-volume scraper divide-by-zero | Story 34.7 canary + `safeRatio()` |

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md`
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md`
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md`
- Change Proposal: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-08-benchmark-v2.md`
- Review Synthesis: `_bmad-output/planning-artifacts/review-epic34-synthesis-2026-09-08.md`
- Backlog File: `_bmad-output/planning-artifacts/backlog-epic-34.md`

---

# Epic 35: Reddit, Medium & Instagram Scraper Expansion

## Business Context

XActions hiện hỗ trợ 10+ nền tảng social nhưng thiếu ba nguồn nội dung quan trọng: **Reddit** (community + discussion data), **Medium** (long-form content), và **Instagram** (visual social + influencer data). Nowing AI Lead Hub cần đa dạng hóa nguồn lead generation và content intelligence. Technical research 2026-09-08/09 cho thấy:

- **Reddit** — official REST API + read-only mode feasible, but public `.json` endpoints often return HTTP 403 from non-residential/unauthenticated IPs; RSS fallback (`/r/{sub}/new.rss`) and optional Puppeteer stealth bridge are required for resilient public scraping.
- **Medium** — official API deprecated; RSS feed still accessible without auth; low complexity.
- **Instagram** — high complexity; private API via `instagrapi` or Puppeteer needed; proxy + session management required.

## Scope

**Trong scope:**
- Reddit hybrid scraper (`src/scrapers/social/reddit/`) with OAuth2 read-only, public `.json` endpoints, RSS fallback, and optional Puppeteer stealth bridge.
- Medium RSS/HTML scraper (`src/scrapers/social/medium/`) without auth.
- Instagram hybrid scraper (`src/scrapers/social/instagram/`) with private API bridge or Puppeteer.
- Unified proxy support: all new clients accept `ProxyProvider` / `proxy` option.
- Normalizers to `PostItem`, `ProfileItem`, `CommentItem`, `CommunityItem`.
- Validators and tests for each platform.
- `SocialAccount`/`SocialAccountHealth` Prisma schema + migration.

**Ngoài scope:**
- Paid Reddit API tier (start with read-only).
- Medium member-only content scraping.
- Instagram private API without proxy/session management.
- Cross-platform analytics / aggregation layer.

## Architecture Decisions

- **AD-35**: Reddit dùng **HTTP-first với RSS fallback + Puppeteer stealth bridge** cho public endpoints; Medium dùng RSS-first với HTML/Puppeteer fallback.
- **AD-36**: Instagram dùng hybrid — `instagrapi` Python bridge hoặc Puppeteer public scraping.
- **AD-37**: Tất cả platform mới phải inject `ProxyProvider` từ `src/proxy/`; default fallback là `PROXY_URL` env.
- **AD-38**: Proxy cho US-resident platforms (Reddit/Medium/Instagram) nên dùng `country-us` hoặc residential proxy, không dùng `country-vn` default.
- **AD-39**: `SocialAccount`/`SocialAccountHealth` là canonical storage cho session/cookie/proxy của mọi social platform; `FacebookAccount` sẽ được migrate trong epic kế tiếp.

## Stories

### Story 35.1: Reddit Scraper (Client + Crawler + Validator + Tests)
- **Phase:** MVP
- **Estimate:** 1 sprint
- **File:** [stories/35-1-reddit-scraper.md](../implementation-artifacts/stories/35-1-reddit-scraper.md)

### Story 35.2: Medium Scraper (Client + Crawler + Validator + Tests)
- **Phase:** MVP
- **Estimate:** 1 sprint
- **File:** [stories/35-2-medium-scraper.md](../implementation-artifacts/stories/35-2-medium-scraper.md)

### Story 35.3: Instagram Scraper (Client + Crawler + Session/Proxy + Tests)
- **Phase:** MVP
- **Estimate:** 1.5 sprints
- **File:** [stories/35-3-instagram-scraper.md](../implementation-artifacts/stories/35-3-instagram-scraper.md)

### Story 35.4: unified-proxy-docs
- **Phase:** Hardening
- **Estimate:** 0.5 sprint
- **File:** [stories/35-4-unified-proxy-docs.md](../implementation-artifacts/stories/35-4-unified-proxy-docs.md)

### Story 35.5: instagram-session-persistence-live-verify
- **Phase:** Post-retro verification (appended 2026-09-19)
- **Estimate:** 0.5 sprint
- **File:** [stories/35-5-instagram-session-persistence-live-verify.md](../implementation-artifacts/stories/35-5-instagram-session-persistence-live-verify.md)
- **Resolves:** action item `epic-35-retro-item-4` — live-verify `InstagramClient` session ≥10 requests without challenge under stable residential proxy.

**Tổng:** 4 stories, ~4 sprints

## Success Metrics

- `RedditClient` returns `PostItem[]` for `subreddit`, `user`, `search` actions within 5s per request.
- `MediumClient` returns `PostItem[]` from RSS feed within 3s per request.
- `InstagramClient` maintains session for ≥10 requests without challenge under stable proxy.
- All new clients accept `ProxyProvider` in constructor.
- `src/scrapers/social/index.js` exports `reddit`, `medium`, `instagram` modules.
- `vitest` tests pass for all new `client.js`, `crawler.js`, `normalizer.js`, `validator.js`.
- When proxy fails, client falls back to direct connection within 2s.
- Instagram has contingency plan: if private API fails, document external service recommendation.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Reddit API pricing change | Start with read-only mode; monitor `r/redditdev` |
| Medium RSS deprecation | Fallback sang HTML scraping; no auth required |
| Instagram account ban | Stable proxy per account, session persistence, random delays |
| `instagrapi` Python dependency | Provide Node.js bridge or port; keep optional |
| Proxy `country-vn` blocking | Use `country-us` or residential proxy for US platforms |

## References

- Research: `_bmad-output/planning-artifacts/research/technical-scraping-reddit-medium-instagram-2026-09-08/research.md`
- PRD: `_bmad-output/planning-artifacts/prd.md` (FR-98, FR-99, FR-100)
- Proxy module: `src/proxy/index.js`, `src/proxy/providers.js`, `src/proxy/proxy-pool.js`
- Scraper pattern: `src/scrapers/social/*/index.js`, `src/scrapers/adapters/base.js`

---

# Epic 36: Unified Person OSINT & Identity Harvesting Dispatcher

## Business Context
Nowing Lead Hub và ChainLens Research cần một điểm chạm tập trung để tìm kiếm dấu chân số của một cá nhân đồng thời trên 10+ nền tảng mạng xã hội và kênh tuyển dụng/doanh nghiệp. Tuân thủ quyết định kiến trúc Option D (`PROPOSAL-person-reconnaissance-osint.md`), XActions đóng vai trò Data Harvesting thuần túy: thực hiện fan-out truy vấn, thu thập dữ liệu thô (`ProfileItem[]`) và trả về caller mà không lưu trữ thực thể hay PII trong cơ sở dữ liệu.

## Scope
**Trong scope:**
- MCP Tool `x_social_find_profiles` với input schema giàu ngữ nghĩa (`query`, `queryType`, `locale`, `platforms`, `timeoutMs`).
- Tự động chuẩn hoá định dạng số điện thoại Việt Nam trước khi cào dữ liệu qua Chợ Tốt, Zalo, Masothue.
- Tận dụng `src/scrapers/index.js` (`scrape(platform, action, args)`) để kích hoạt các scraper đã có.
- Điều phối fan-out bằng `Promise.allSettled()` với deadline timeout độc lập per-platform.
- Circuit breaker tự động cách ly platform lỗi liên tiếp.

**Ngoài scope:**
- Viết mới các scraper Việt Nam (đã tồn tại 100%).
- Thuật toán Entity Resolution (Jaro-Winkler, Levenshtein, pHash) trong Node.js.
- Tạo bảng thực thể người (`PersonEntity`, `GoldenContact`) trong Prisma.

## Stories
### Story 36.1: mcp-tool-x-social-find-profiles
### Story 36.2: osint-fault-isolation-and-circuit-breaker

---

# Epic 38: Crawler Lifecycle Unification & CloudEvents Standardization

## Business Context
Hệ thống xuất hiện nợ kỹ thuật Split-Brain Publishing: crawler con và crawler cha cùng xuất bản sự kiện lên Redis Stream, dẫn đến việc phải dùng cờ tạm `__streamEmitted` làm bẩn domain payload. Epic này giải quyết triệt để vấn đề trên bằng cách chuyển toàn bộ trách nhiệm phát sự kiện về Template Method của `AbstractCrawler.execute()`.

## Scope
**Trong scope:**
- Xoá bỏ hoàn toàn cờ `__streamEmitted` khỏi toàn bộ codebase (`base-crawler.js`, `threads/crawler.js`, `facebook/crawler.js`, `instagram/crawler.js`).
- Xoá bỏ tất cả các lệnh gọi `publisher.publish(...)` trong các crawler con.
- Chuẩn hoá Template Method `execute()` trong `AbstractCrawler` với điểm phát sự kiện duy nhất `emitStreamBatch()`.
- Quản lý `Set<string> emittedItemIds` trong từng phiên chạy để chống duplicate sự kiện tại nguồn.
- Đóng gói sự kiện theo chuẩn CloudEvents v1.0 kèm thuộc tính `idempotencyKey`.

**Ngoài scope:**
- Xây dựng Event Lake hay Parquet Export nội bộ trong XActions (đã giao cho downstream consumer).

## Stories
### Story 38.1: crawler-lifecycle-cleanup-and-stream-unification
### Story 38.2: cloudevents-compliance-and-idempotent-publishing

---

# Epic 37: Lightweight Zero-Browser Engine (Platform-Static Routing)

## Business Context
Các tác vụ cào dữ liệu công khai trên các nền tảng nhẹ (như Masothue, Batdongsan, RSS feed) không đòi hỏi môi trường trình duyệt Chromium hoàn chỉnh. Việc dùng Headless Browser ngốn 250MB+ RAM/tab và làm chậm thời gian phản hồi.

## Scope
**Trong scope:**
- Cấu hình phân tầng tĩnh `engineTier` cho từng platform: Tier 0 (`got-jsdom`) cho static/SSR targets; Tier 1 (CDP/Puppeteer stealth) cho complex social targets.
- Sử dụng `src/scrapers/adapters/got-jsdom.js` để parse DOM ảo, cắt giảm 85% RAM và đưa độ trễ về dưới 800ms.
- Phản hồi minh bạch metadata trong response: `engineUsed` và `durationMs`.

**Ngoài scope:**
- Universal 3-tier escalation dây chuyền gây trễ 16 giây.
- Nhúng native C++ TLS binaries (như curl-impersonate) vào Node.js.

## Stories
### Story 37.1: static-http-first-routing-lightweight-targets

---

# Epic 40: Cost-Aware Proxy Escalation & Budget Ceiling (Rescoped)

## Business Context
Residential và Mobile 4G proxy có chi phí rất đắt ($3–$15/GB). Việc cào diện rộng mà không phân tầng chi phí dẫn đến nguy cơ lạm chi nghiêm trọng.

> **⚠️ Rescope Note (2026-09-18):** Sau duplication review, ~40% Epic 40 đã được implement (quarantine, dual-pool partitioning, sticky map, `DistributedTokenBucket`). Phần còn lại chỉ là **`tier` metadata + cost-aware escalation + budget ceiling** — net-new implementation.

## Scope (Rescoped)
**Trong scope:**
- `tier` metadata (`free`/`datacenter`/`residential`/`mobile_4g`) vào `NormalizedProxy`; migration `residential: boolean` → `tier` enum.
- `ProxyBudgetGovernor` enforces `PROXY_DAILY_BUDGET_USD` ceiling via `DistributedTokenBucket`.
- Cost-aware escalation: default `datacenter` → `residential` on 403/Captcha challenge detection.
- `BUDGET_CEILING_REACHED` soft degradation — trả degraded result thay vì throw `PROXY_EXHAUSTED`.
- `mobile_4g` tier available only when `PROXY_ESCALATION_ENABLED=1`.

**Ngoài scope (rejected):**
- Per-request byte-level cost accounting (estimation ~50MB/request is sufficient).
- Multi-day budget tracking (daily reset only).
- Proxy provider API integration for real-time pricing.
- Automatic proxy purchasing / top-up.
- Re-implementing `DistributedTokenBucket`, quarantine, dual-pool, sticky map (đã có sẵn).

## Stories (Rescoped)
### Story 40.1: cost-aware-proxy-escalation-in-proxy-pool

---

# Epic 39: GitOps Selector Healing Assistant (Rescoped)

## Business Context
Giao diện các mạng xã hội thường xuyên thay đổi khiến CSS/XPath selectors bị trôi dạt (DOM Drift). Để đảm bảo tính bất biến của mã nguồn và an toàn dữ liệu, hệ thống phát hiện selector hỏng và sinh bản vá qua Pull Request thay vì tự ý nạp code động vào Redis production.

> **⚠️ Rescope Note (2026-09-18):** Sau duplication review, ~70% Epic 39 đã được implement trong Stories 28.2 (`SelectorCanary`) và 28.3 (`AutoSelectorFallback`). Phần còn lại chỉ là **GitOps Patch Assistant** — CLI orchestration layer.

## Scope (Rescoped)
**Trong scope:**
- `xactions canary heal` CLI orchestrating: drift status → `AutoSelectorFallback.investigate()` → `SelectorSandbox` validation → `unified-diff` → GitHub Draft PR.
- `SelectorSandbox` validates candidates against `expectedShape` in isolated page context.
- `CanaryHealer` service coordinating the full healing pipeline.
- `expectedShape` field added to `canary-targets.json` for validation.

**Ngoài scope (rejected):**
- Auto-heal on drift detection (violates Invariant #4 — requires human review).
- LLM-based selector generation (non-deterministic).
- Runtime hot-patching into Redis (rejected — selectors immutable in source control).
- Re-implementing `SelectorCanary` or `AutoSelectorFallback` (already exist).

## Stories (Rescoped)
### Story 39.1: selector-canary-expansion-heuristic-drift
### Story 39.2: gitops-patch-assistant-cli

---

# Epic 41: OSINT Enhancement — Developer Registries & Entity Resolution (Rescoped)

## Business Context
Live verification của `x_social_find_profiles` (Epic 36) với query thực tế `deptraidapxichlo` đã lộ ra 2 gap: (1) các developer/identity registries công khai (GitHub, Gravatar) chưa có trong platform matrix dù là nguồn dữ liệu mở giàu metadata nhất và không tốn proxy; (2) kết quả trả về là danh sách phẳng `profiles[]` — caller không biết được profile nào trên platform nào thuộc cùng một người thật.

> **⚠️ Boundary Note (2026-09-19):** Sau duplication audit với Mr.Holmes (`docs/proposals/PROPOSAL-person-reconnaissance-osint-v1-xactions-only.md`), Epic 41 chỉ port **thuật toán** (Jaro-Winkler similarity) chứ không port code Python. Các khả năng thuộc domain điều tra của Mr.Holmes bị loại khỏi scope: Google/Yandex Dorking, breach/leak check (HIBP/Shodan), BFS Recursive Profiler, Mindmap/LLM Report, quét 2500 sites (Maigret). Nếu cần các khả năng này, operator orchestrate qua MCP của Mr.Holmes — không duplicate trong XActions.

## Scope
**Trong scope:**
- GitHub adapter: direct fetch `https://api.github.com/users/{username}`, đăng ký vào `PROFILE_ACTION_MAP` với queryType `username`. Rate limit 60 req/h (unauthenticated) qua `DistributedTokenBucket`; optional `GITHUB_TOKEN` → 5000 req/h.
- Gravatar adapter: direct fetch `https://api.gravatar.com/v3/profiles/{sha256(email)}`, đăng ký với queryType `email`.
- `EntityResolver` module (pure JS): Jaro-Winkler similarity + confidence scoring, gộp `profiles[]` thành `identityClusters[]`.
- Output contract mở rộng: `identityClusters[]` bổ sung cạnh `profiles[]` (backward compat).

**Ngoài scope (rejected — thuộc Mr.Holmes domain):**
- Google/Yandex Dorking (`Core/Dork.py`).
- Breach/leak check (HIBP, Shodan, LeakLookup, IntelX).
- BFS Recursive Profiler (`autonomous_agent.py`).
- Mindmap HTML + LLM Report (`mindmap_generator.py`, `llm_synthesizer.py`).
- Quét 2500 sites (Maigret-style scan pipeline).
- Persist PII / PersonEntity trong Prisma (Option D — in-memory per-request only).

## Stories
### Story 41.1: github-gravatar-adapters
### Story 41.2: entity-resolver-identity-clusters
### Story 41.3: avatar-perceptual-hashing-entity-resolver

---

## Epic 42: Agentic Decision Plane — Jev Typed-Decision Integration

## Business Context
Mọi quyết định "có nên like/reply/follow không" trong XActions hiện đi qua generative LLM (`LLMBrain`, `callLLM`) hoặc heuristic thô (`Math.random()`, ngưỡng cứng `score>60/>80`). Điều này gây 3 vấn đề: (1) **tốn chi phí** — trả tiền token sinh text chỉ để `parseInt` vứt đi; (2) **không tin cậy** — `JSON.parse`/`regex` parse rác, `catch → return default`; (3) **không tự chủ được** — không có confidence calibrated để biết "khi nào không chắc" → escalate, buộc phải giám sát. Epic này đưa **TypeSafe Jev** (System One model) vào làm **Decision Plane** riêng (xem `docs/architecture.md` §2.8, AD-48): Jev trả typed verdict `{choice|score|noul, probabilities, confidence}`, LLM chỉ giữ vai trò sinh prose. Verified trên corpus 40 tweet (`scripts/jev-verify/`): relevance 85%, spam 98%, vi 92%/mixed 100%/en 79%, ~$0.024/1000 tweet.

## Scope
**Trong scope:**
- `src/agents/jevBrain.js` — module gateway duy nhất tới `POST https://api.typesafe.ai/v1/systemone` (REST `fetch`, reuse retry/rate-limit shell của `LLMBrain`; né `@typesafe-ai/sdk` dep). API: `decide(state, questions)` → typed answers + confidence.
- **Confidence gate** — per-action, user-tunable thresholds (không hardcode): `conf ≥ hi → act · mid → queue-review · lo → skip`.
- **LLM fallback** — khi `TYPESAFE_API_KEY` vắng hoặc Jev lỗi → degrade sang `LLMBrain` judgment, không hard-fail (invariant §5.6).
- Adopt vào `thoughtLeaderAgent` (action router thay `>60/>80/random`), `checkPersonaConsistency` (Noul), safety `Noul` trước mỗi write, `xspace-agents DecisionEngine` (Choice), `xeepy` batch (spam/targeting Score/Choice).
- Verify harness `scripts/jev-verify/` chạy được như CI regression trên corpus.
- **Bề mặt mở rộng (Expanded Decision Surfaces):**
  1. Chẩn đoán Bot Challenge & Soft-200 đa nền tảng (`src/core/error-envelope.js`, `crawler-governor.js`).
  2. So khớp Bio ngữ nghĩa trong OSINT Entity Resolution (`src/mcp/osint-find-profiles.js`, `EntityResolver`).
  3. Phân loại Niche & Brand Safety Gate cho Trending Monitor (`src/trendingTopicMonitor.js`).
  4. Đánh giá Khách hàng Tiềm năng (B2B Lead Qualification & ICP Scoring) tốc độ cao (`api/routes/ai/leads.js`).
  5. Dọn dẹp Follower nhận thức (Cognitive Unfollow & giữ quan hệ VIP) (`src/unfollowback.js`).
  6. Trọng tài biến thể nội dung (Jev-as-a-Judge cho Tweet Generator & Cringe Filter) (`src/ai/tweetGenerator.js`).

**Ngoài scope (rejected):**
- Jev sinh prose/reply/post (Jev không generate text — đó là `LLMBrain`).
- Jev đọc media/avatar/rate-limit (state text-only; không chữa trực tiếp X-flag vì hành vi).
- Thay `llmBrain` hoàn toàn — Jev là decision plane *song song*, không phải provider thay thế.
- Hardcode threshold — mọi ngưỡng phải config được (persona/env/config).

## Stories
### Story 42.1: jevBrain-core-decision-plane — `src/agents/jevBrain.js` (REST client `systemOne`, primitives Choice/Score/Noul, confidence gate per-action, `LLMBrain` fallback)
  - AC: sole gateway — mọi Jev call qua `jevBrain`; không module nào gọi `api.typesafe.ai` trực tiếp.
  - AC: degrade-trigger rõ — `TYPESAFE_API_KEY` vắng | HTTP 5xx | timeout >5s | HTTP 429 → fallback `LLMBrain` judgment (không hard-fail).
  - AC: cost governance — meter `jev:*` qua `DistributedTokenBucket` + `JEV_DAILY_BUDGET_USD` ceiling (mirror AD-42 proxy budget); `BUDGET_CEILING_REACHED` → degrade, không throw.
  - AC: confidence threshold per-action load từ config/env — không hardcode.
### Story 42.2: agentic-adoption — cắm `jevBrain` vào `thoughtLeaderAgent` action router + `algorithmBuilder`/`personaEngine` decisions + `checkPersonaConsistency` + safety `Noul` trước write + `xspace DecisionEngine` (Choice) + `xeepy` spam/targeting batch
  - AC: `xspace DecisionEngine` — Jev chạy **non-blocking**, song song với rule-engine; nếu Jev >500ms hoặc lỗi → dùng keyword/turn rule hiện có (voice loop không được khựng).
  - AC: `thoughtLeaderAgent` — thay `score>60/>80`/`Math.random()<0.4` bằng `jevBrain` Choice + per-action confidence; mỗi action có threshold riêng.
  - AC: safety `Noul` chạy trước MỌI write (reply/post/DM) — `safeToSend < threshold` → skip + log.
### Story 42.3: jev-verify-regression-guard — nâng `scripts/jev-verify/` thành CI regression (corpus ≥50, accuracy floor vi≥85%/spam≥95%, drift alert khi accuracy tụt dưới ngưỡng)
### Story 42.4: jev-challenge-diagnostics — Soft-200 & Bot Challenge Diagnostics
  - AC: Khi scraper nhận HTTP 200 nhưng trích xuất được 0 records hoặc body nghi ngờ checkpoint/soft-block, trích xuất 500 ký tự text và gọi `jevBrain.decide(snippet, { pageStatus: Choice(...) })`.
  - AC: Nếu `pageStatus.choice` là `bot_challenge` hoặc `login_wall` với `confidence >= 0.8` → ném `BotChallengeError` (XACT_5030) và kích hoạt `AdaptiveRateGovernor.hibernateAccount()`.
  - AC: Giảm thiểu sự phụ thuộc vào các chuỗi regex HTML tĩnh dễ gãy trên 26 nền tảng.
### Story 42.5: jev-osint-bio-matcher — Semantic Bio Matching for EntityResolver (Epic 41 / Option D)
  - AC: Trong `EntityResolver.scorePair()`, khi so khớp 2 profile khác platform có bio text mà URL/exact username không match, gọi `jevBrain.decide({ bio1, bio2 }, { samePerson: Score(...) })`.
  - AC: Nếu `samePerson.score >= 2` và `confidence >= 0.85` → cộng +35 điểm match vào pairwise score, giúp merge cluster những người có bio khác câu chữ nhưng cùng thực thể.
  - AC: Tuân thủ nghiêm ngặt Option D (AD-45): tính toán in-memory per-request, tuyệt đối không lưu bio/cluster vào cơ sở dữ liệu.
### Story 42.6: jev-trend-brand-safety — Trending Topic Semantic Monitor & Brand Safety Gate
  - AC: Thay thế từ điển `NICHE_KEYWORDS` tĩnh bằng Jev `Choice` phân loại vertical (`tech_ai`, `crypto_web3`, `politics`, v.v.).
  - AC: Kiểm tra Brand Safety bằng `Noul("Is this trend related to tragic events, scams, or controversy?")` trước khi đề xuất comment.
  - AC: Đánh giá cơ hội tương tác bằng `Score("thought-leader comment opportunity", ["avoid", "neutral", "good_hook", "must_post"])`.
### Story 42.7: jev-lead-icp-scoring — High-Throughput Batch Lead Qualification
  - AC: Cung cấp endpoint batch qualification xử lý danh sách user profile (bio + recent tweets) qua Jev.
  - AC: Trả về `buyerIntent` (Choice: `not_a_lead`, `problem_aware`, `solution_seeking`, `decision_maker`) và `leadScore` (Score: 0-3 ICP fit).
  - AC: Đạt throughput xử lý batch lớn với chi phí tối ưu (~$0.024 / 1.000 users).
### Story 42.8: jev-cognitive-unfollow — Relationship Preservation & Audience Pruning
  - AC: Trước khi unfollow một account không follow lại, gọi Jev `Choice` đánh giá mối quan hệ (`unfollow_dead`, `unfollow_spam`, `keep_high_value_influencer`, `keep_active_peer`).
  - AC: Tự động giữ lại các account VIP/influencer trong ngành ngay cả khi họ không follow-back, ngăn chặn việc bot unfollow nhầm đối tác quan trọng.
  - AC: Tự động loại bỏ các account đổi hướng sang spam/airdrop/nsfw.
### Story 42.9: jev-variant-judge — Jev-as-a-Judge Post Variant Selector & Cringe Filter
  - AC: Khi sinh bài viết, cho LLM sinh 3 biến thể (variants), sau đó ném cả 3 vào Jev `Choice` để chọn biến thể tự nhiên nhất, ít sặc mùi AI corporate hype nhất.
  - AC: Kèm `Noul` kiểm tra "cringe factor" (chứa sáo ngữ AI như 'game-changer', 'buckle up', 'delve') — nếu `cringeFactor > 0.3` thì reject hoặc yêu cầu re-roll.

---

## Epic 43: Jev Decision Surface — Semantic Conditions & Write-Path Gate

## Business Context
Epic 42 đặt nền `jevBrain` (Decision Plane). Epic 43 mở rộng bề mặt Jev sang 4 điểm quyết định *trước khi hành động* còn đang dùng rule/keyword/lexicon thô — vì chúng cùng một mục tiêu: **quyết định bằng semantics, giảm action ngu, giảm X-flag (volume reducer)** và tăng chất lượng engage. Tất cả đi qua `jevBrain` (invariant §5.6 — không module nào gọi `api.typesafe.ai` trực tiếp), threshold confidence per-action config được, `LLMBrain` fallback.

## Scope
**Trong scope:**
- **`workflows/conditions.js`**: thêm condition type `jev` — `evaluateCondition` chấp nhận `{ jev: { question, state, type: 'noul'|'choice'|'score', threshold } }` gọi `jevBrain.decide`, cho workflow branch trên *semantics* thay vì chỉ field-value. Giữ deterministic conditions cũ nguyên vẹn (invariant §4).
- **DM / notification triage**: `api/routes/ai/messages.js`, `notifications.js`, `src/advancedDM.js` — `Choice` intent (spam/lead/support/friend/ignore) + `Noul` toxic; route reply/ignore/escalate theo confidence *(depends on 42.1)*.
- **Moderation / toxicity**: `api/routes/ai/moderation.js`, `xspace examples/plugins/moderation.ts:isBlocked`, `xeepy sentiment_analyzer._calculate_toxicity` — thay keyword/lexicon bằng `Noul`/`Score` có confidence.
- **Content pre-flight**: `src/ai/contentOptimizer.js:predictPerformance`, `api/routes/ai/optimizer.js`, `viral.js` — `Score` (virality/clarity/on-brand) + `Noul` (safe-to-post) trước khi tốn write slot.

**Ngoài scope (rejected):**
- Deterministic gates: `benchmark/scoring-engine.js` knock-out gates, `auto-selector-fallback` ranking, `EntityResolver.scorePair`, `rankTopTweets`, `selectBestNetwork`, `alerts._checkSentimentThreshold`, scheduler, `antiDetection` timing — rule/numeric, cấm AI trong critical path (§4).
- A2A routing (`orchestrator`/`skillRegistry`), CRM/sentiment tagging, `xspace detectSentiment` — Tier 2, để backlog khi có nhu cầu thật.
- Jev sinh prose, đọc media/avatar, hay chống X-flag trực tiếp — như Epic 42.

## Stories
### Story 43.1: jev-workflow-conditions — condition type `jev` trong `src/workflows/conditions.js` + `engine.js`, branch on `jevBrain.decide`, giữ deterministic conditions *(depends on 42.1)*
### Story 43.2: jev-write-path-gate — `Noul`/`Score`/`Choice` trước mọi write: content-preflight (`contentOptimizer`/`optimizer`/`viral`) + moderation (`moderation.js`, `xspace isBlocked`, `xeepy _calculate_toxicity`) *(depends on 42.1)*
### Story 43.3: jev-inbox-triage — DM/notification `Choice` intent + `Noul` toxic trong `messages.js`/`notifications.js`/`advancedDM.js`, route reply/ignore/escalate theo confidence


---

## Epic 44: Jev Tier-2 — Semantic Agent Routing, CRM Tagging & Voice Sentiment

## Business Context
Sau khi hoàn thành Epic 42 (Decision Plane) và Epic 43 (Decision Surface), Epic 44 kích hoạt 3 tính năng Tier-2 từ `FUTURE-WORK.md`: A2A multi-agent routing khi có truy vấn/task mập mờ, CRM follower sentiment tagging vượt qua giới hạn của lexicon truyền thống (bắt được sarcasm, lóng web3, và ngữ cảnh tiếng Việt/Anh), và real-time sentiment detection trong XSpace voice rooms với cơ chế non-blocking (<500ms race) giúp voice agent điều chỉnh phong thái giao tiếp tự nhiên mà không làm trễ pipeline giọng nói.

## Scope
**Trong scope:**
- **A2A intent routing**: `src/a2a/orchestrator.js`, `src/a2a/skillRegistry.js` — thêm semantic intent routing qua Jev `Choice` khi task/query trùng khớp hoặc mập mờ giữa nhiều agent/skill capabilities.
- **CRM / sentiment tagging**: `src/analytics/followerCRM.js`, `src/analytics/reputation.js`, `src/analytics/sentiment.js`, `api/routes/ai/sentiment.js` — semantic tagging thay lexicon/regex: `Choice` sentiment (`enthusiastic`, `positive`, `neutral`, `skeptical`, `hostile`) + `Score` (influence/intent 0-3), xử lý sarcasm và context phức tạp.
- **xspace `detectSentiment`**: `xspace-agents/packages/core/src/intelligence/sentiment.ts` — Jev sentiment evaluation chạy non-blocking song song lexicon (`Promise.race` với timeout 500ms), giúp voice agent nhận biết cảm xúc người nói để đổi tông giọng (eager/reserved/sympathetic).

**Ngoài scope:**
- Thay đổi cấu trúc core protocol A2A (A2A JSON-RPC spec giữ nguyên).
- Block voice loop bằng synchronous Jev call (bắt buộc Promise.race với timeout 500ms).
- Jev sinh text hoặc prose (chỉ trả Choice/Score/Noul).

## Stories
### Story 44.1: jev-a2a-routing — A2A Intent Disambiguation & Semantic Skill Routing
  - AC: Khi query hoặc task description mập mờ giữa ≥2 skills/agents, `A2AOrchestrator` / `skillRegistry` gọi Jev `Choice` để phân loại intent và chọn target skill/agent phù hợp nhất.
  - AC: Có confidence gate: nếu `confidence < 0.7`, trả về yêu cầu làm rõ (disambiguation) thay vì route bừa bãi.
  - AC: Degraded fallback: khi Jev degraded hoặc thiếu key, fallback về exact string/regex match hiện có của `skillRegistry`.

### Story 44.2: jev-crm-sentiment — CRM Semantic Sentiment & Follower Tagging
  - AC: Thay thế từ điển sentiment/keyword tĩnh trong CRM bằng Jev `Choice` (sentiment: `enthusiastic`, `positive`, `neutral`, `skeptical`, `hostile`) + `Score` (reputation impact 0-3).
  - AC: Nhận diện chính xác sarcasm, lóng crypto/web3, và ngữ cảnh tiếng Việt/Anh mập mờ mà lexicon bỏ sót.
  - AC: Batch tagging endpoint hoặc helper trong `followerCRM.js` xử lý danh sách tương tác/follower với chi phí tối ưu qua `JevBrain`.

### Story 44.3: jev-xspace-sentiment — XSpace Real-Time Non-Blocking Sentiment Detection
  - AC: Tích hợp `jevBrain` vào luồng phân tích sentiment của XSpace agent; chạy song song (`Promise.race` với timeout 500ms) với rule-based/lexicon hiện có.
  - AC: Trả về phân loại cảm xúc (`positive`, `excited`, `neutral`, `skeptical`, `frustrated`) kèm confidence score.
  - AC: Nếu Jev timeout >500ms hoặc lỗi mạng, fallback về lexicon sentiment ngay lập tức mà không làm trễ voice pipeline.


---

## Epic 45: jev-corpus-miner — Universal Viral DNA Mining & Content Intelligence

Epic 45 mở ra khả năng "reverse-engineer" viral DNA ở quy mô lớn trên **mọi nền tảng**: scrape corpus posts từ niche → Jev batch classification với platform-specific questions → aggregate thành viral stats → feed vào content generation pipeline → backtest validate. Biến XActions từ "automation tool" thành "cross-platform content intelligence platform" với data-backed viral patterns.

**Nguồn:** Phân tích từ FB article về Jev corpus mining (100k tweets / 20.4s / $0.67 / 14 questions per tweet).

## Scope

**Trong scope:**
- **Universal Viral Corpus Miner**: `src/analytics/jevViralMiner.js` — scrape N posts từ niche trên **18 platforms** (dùng existing scrapers), Jev batch classification với platform-specific question sets.
- **Viral Stats Store**: `src/analytics/viralStatsStore.js` — aggregate Jev answers + engagement metrics → `data/viral-stats/{category}-{platform}-{niche}.json` với schema chuẩn.
- **Content Intelligence Feed**: `src/ai/tweetGenerator.js`, `src/ai/jevVariantJudge.js`, `src/filters/jevFilter.js` — inject viral stats vào prompt để LLM viết content theo proven patterns per platform.
- **Backtest Engine**: `src/analytics/jevBacktest.js` — compare predicted-viral vs actual performance trên own posts per platform.
- **Viral Dashboard UI**: `dashboard/viral-miner.html` — web interface để run mining, view stats, backtest results.

**Ngoài scope:**
- Thay đổi core scraper architecture (Epic 34 đã stable).
- Jev sinh text/prose (chỉ classification).
- Real-time streaming viral detection (batch mode only, không phải live).
- Video/image content analysis (chỉ text metadata + engagement).

## Platform Registry

### Social Platforms (11)

| Platform | Scraper Class | Search Method | Content Type | Key DNA Questions |
|----------|---------------|---------------|--------------|-------------------|
| twitter | `TwitterCrawler` | `search()` | tweets | hookType, hasNumbers, evidenceType, curiosityGap, emotionalTrigger, formatType, hasCTA, urgencyLevel, specificityLevel, controversiality |
| threads | `ThreadsCrawler` | `search()` | posts | Same as Twitter + threadDepth, metaReference |
| facebook | `FacebookCrawler` | `search()` | posts | emotionalTrigger (family/community/outrage), shareability, groupRelevance, nostalgiaFactor |
| tiktok | `TikTokCrawler` | `search()` | videos | visualHookType (textOverlay/faceReveal/transition), trendingSound, hashtagStrategy, pacingSpeed, callToActionType |
| youtube | `YouTubeVNCrawler` | `search()` | videos | titleHookType, thumbnailTextMatch, curiosityGap, keywordDensity, lengthOptimization |
| reddit | `RedditCrawler` | `search()` | posts | authenticityLevel, communityFit, controversyLevel, nicheJargon, storyDepth, askType (advice/opinion/discussion) |
| instagram | `InstagramCrawler` | `search()` | posts | visualAesthetic, hashtagDensity, influencerSignal, lifestyleCategory |
| bluesky | `BlueskyCrawler` | `search()` | posts | Same as Twitter (early adopter culture) |
| mastodon | `MastodonCrawler` | `search()` | posts | communityFit, technicalDepth, antiCommercial, nicheJargon |
| medium | `MediumCrawler` | `search()` | articles | headlineHook, readability, thoughtLeadership, dataSupport, narrativeStructure |
| zalo | `ZaloCrawler` | `search()` | posts | localRelevance, communityTrust, personalConnection, vietnameseContext |

### Recruitment Platforms (3)

| Platform | Scraper Class | Search Method | Content Type | Key DNA Questions |
|----------|---------------|---------------|--------------|-------------------|
| linkedin | `LinkedInCrawler` | `searchJobs()` | jobs | hookType (professional), credibilityType (data/caseStudy/authority/personalStory), industryRelevance, careerLevel, buzzwordDensity |
| topcv | `TopCvCrawler` | `searchJobs()` | jobs | salaryTransparency, companyReputation, urgencyLevel, skillMatch, locationAppeal |
| vietnamworks | `VietnamWorksCrawler` | `searchJobs()` | jobs | salaryCompetitiveness, companyBrand, benefitsClarity, careerGrowth, workLifeBalance |

### Real Estate Platforms (2)

| Platform | Scraper Class | Search Method | Content Type | Key DNA Questions |
|----------|---------------|---------------|--------------|-------------------|
| chotot | `ChototCrawler` | `searchListings()` | listings | priceCompetitiveness, urgencyType (hotDeal/motivated/regular), locationDesirability, photoQuality, descriptionCompleteness |
| batdongsan | `BatdongsanCrawler` | `searchListings()` | listings | pricePerM2, legalStatus, projectReputation, investmentPotential, urgencyLevel |

### E-Commerce Platforms (2)

| Platform | Scraper Class | Search Method | Content Type | Key DNA Questions |
|----------|---------------|---------------|--------------|-------------------|
| shopee | `ShopeeCrawler` | `searchProducts()` | products | priceHook, urgencyType (flashSale/limitedStock), socialProofLevel, discountDepth, keywordOptimization, sellerReputation |
| tiktok-shop | `TikTokShopCrawler` | `searchProducts()` | products | viralPotential, influencerEndorsement, priceCompetitiveness, trendAlignment, urgencyLevel |

## Stories

### Story 45.1: jev-viral-miner — Universal Corpus Scraping & Jev Batch Classification

As a growth hacker / content strategist / market analyst,
I want to scrape a large corpus of posts from my niche on any supported platform and classify each post's viral DNA attributes via Jev,
So that I can discover which content patterns actually drive virality per platform instead of guessing.

**Acceptance Criteria:**

**Given** I have configured XActions scrapers and a niche keyword (e.g., "web3", "saas", "fitness", "apartment-hanoi")
**When** I run `xactions viral-mine --platform {platform} --niche {niche} --count {count}`
**Then** the system detects platform category and uses appropriate scraper:
  - Social: `twitter`, `threads`, `facebook`, `tiktok`, `youtube`, `reddit`, `instagram`, `bluesky`, `mastodon`, `medium`, `zalo`
  - Recruitment: `linkedin`, `topcv`, `vietnamworks`
  - Real Estate: `chotot`, `batdongsan`
  - E-Commerce: `shopee`, `tiktok-shop`
**And** calls the platform's search method (see Platform Registry table)
**And** scrapes up to {count} posts matching the niche
**And** for each post, calls Jev with platform-specific question set (10-14 questions from Platform Registry)
**And** joins Jev answers with engagement metrics (likes, shares, views, comments, applies, saves, price) into `PostViralProfile[]`
**And** processes with concurrency control (default 10 concurrent Jev calls)
**And** logs progress every 100 posts processed
**And** tracks estimated cost per batch using formula: `posts × 14 questions × $0.00000048/question`, warns if projected cost > $0.10 per 10k posts
**And** saves raw output to `data/viral-corpus/{category}-{platform}-{niche}-{timestamp}.json`

**Given** Jev API is unavailable or degraded
**When** the batch classification runs
**Then** the system falls back to heuristic scoring (engagement rate, completeness, keyword density) and marks records as `jevDegraded: true`

**Given** the scrape returns fewer posts than requested
**When** processing completes
**Then** the system reports actual count scraped and processes all available posts

**Given** platform is not supported or scraper unavailable
**When** mining is attempted
**Then** the system returns error: "Platform '{platform}' not supported. Available: {list}"

---

### Story 45.2: jev-viral-stats — Stats Aggregation & Storage

As a data analyst,
I want the raw viral profiles aggregated into actionable statistics per platform,
So that I can query "which hook type performs best on LinkedIn for SaaS niche" or "what price range works best for Chợ Tốt listings" without re-processing raw data.

**Acceptance Criteria:**

**Given** a `PostViralProfile[]` corpus has been generated (from Story 45.1)
**When** I run the stats aggregation (auto-triggered after mining OR via `xactions viral-stats --platform {platform} --niche {niche}`)
**Then** the system computes `ViralStats`:
  - platform: string (18 supported platforms)
  - category: string (social|recruitment|realestate|ecom)
  - niche: string
  - sampleSize: number
  - generatedAt: ISO timestamp
  - hookTypeDistribution: { [hookType]: { count, avgEngagement, viralRate } }
  - viralRateThreshold: number (top 10% engagement)
  - topPerformingPatterns: Array<{ attributes: {}, avgEngagement, count }>
  - attributeCorrelations: { [attribute]: correlationScore }
  - platformSpecificMetrics: { [platformAttr]: { distribution, avgEngagement } }
  - categoryInsights: cross-platform comparison within same category
**And** validates output against Zod schema `ViralStatsSchema`
**And** persists to `data/viral-stats/{category}-{platform}-{niche}-{date}.json`
**And** maintains a `data/viral-stats/latest-{platform}-{niche}.json` symlink for easy access

**Given** the corpus file is missing or corrupted
**When** stats aggregation runs
**Then** the system throws descriptive error and exits gracefully

**Given** multiple mining runs exist for the same platform+niche
**When** stats are generated
**Then** the system uses the most recent corpus file by default

---

### Story 45.3: jev-content-intel — Feed Stats vào Content Generation

As a content creator using XActions,
I want content generation to leverage viral DNA stats from my niche on the target platform,
So that generated content follows proven viral patterns rather than generic templates.

**Acceptance Criteria:**

**Given** `viralStats` exists for platform+niche and `USE_VIRAL_INTEL=true`
**When** `tweetGenerator.generate({ platform: "linkedin", niche: "saas", topic: "AI agents" })` is called
**Then** the system loads latest `viral-stats-recruitment-linkedin-saas.json`
**And** injects into prompt context: "Viral DNA insights for LinkedIn/SaaS: data-driven hooks (3.1% viral), personalStory (1.8%), buzzword-heavy (0.4%). Top pattern: {attributes}. Optimize for these patterns."
**And** LLM generates content informed by platform-specific viral stats

**Given** `jevVariantJudge` evaluates multiple content variants
**When** `viralStats` is provided for the target platform
**Then** variants matching top-performing patterns get +0.2 score boost in evaluation

**Given** `jevFilter` processes live timeline/feed on any platform
**When** `viralStats` is available for that platform
**Then** posts matching high-viral-rate patterns are ranked higher in reply/engage priority queue

**Given** `USE_VIRAL_INTEL=false` or no viral stats exist for platform+niche
**When** any content generation runs
**Then** the system falls back to default behavior without viral intel injection

---

### Story 45.4: jev-backtest — Validate Predictions vs Actual Performance

As a data-driven growth operator,
I want to validate whether viral DNA predictions actually correlate with real engagement per platform,
So that I can trust (or calibrate) the viral stats before relying on them for content strategy.

**Acceptance Criteria:**

**Given** viral stats exist and I have posted content in the target platform+niche
**When** I run `xactions backtest --platform {platform} --niche {niche} --days {days}`
**Then** the system fetches my posts from the last {days} days via platform-appropriate scraper
**And** for each post, extracts viral DNA attributes (via cached Jev results or re-classification)
**And** compares predicted viral potential (from stats match) vs actual engagement
**And** calculates metrics:
  - precision: of posts predicted "high viral", what % actually hit top quartile engagement
  - recall: of actual top-performing posts, what % were predicted "high viral"
  - accuracyByHookType: { [hookType]: { predicted, actual, accuracy } }
  - platformBreakdown: { [platform]: { precision, recall, sampleSize } }
  - categoryBreakdown: { [category]: { precision, recall } }
**And** outputs report to `data/backtest-reports/{platform}-{niche}-{date}.json`
**And** prints summary: "Backtest complete: 73% precision, 45% recall. Assertion hooks: 89% accurate on Twitter."

**Given** insufficient own posts for backtest (<10 in period)
**When** backtest runs
**Then** the system warns and suggests extending `--days` or mining competitor posts for calibration

---

### Story 45.5: jev-viral-dashboard — Web UI for Universal Viral DNA Mining

As a non-technical growth operator,
I want a web dashboard to run viral mining across all platforms, view stats, and see backtest results,
So that I don't need to use CLI commands.

**Acceptance Criteria:**

**Given** Epic 45 backend stories (45.1-45.4) are complete
**When** I navigate to `/dashboard/viral-miner.html`
**Then** I see a "Viral DNA Miner" page with:
  - Category selector: Social | Recruitment | Real Estate | E-Commerce
  - Platform selector: dropdown filtered by category (11 social + 3 recruitment + 2 realestate + 2 ecom)
  - Niche input: text field with autocomplete suggestions per category
  - Count slider: 100-10000
  - "Run Mining" button
  - Progress indicator: posts processed (X/N), Jev calls made, estimated cost ($X.XX), elapsed time
  - Results table: viral stats by hook type (count, avgEngagement, viralRate%), top performing patterns
  - Platform comparison view: side-by-side stats across platforms for same niche
  - Category insights: which category has highest viral potential for niche
  - Export button: download `viral-stats-{platform}-{niche}.json`

**Given** viral mining is running
**When** I view the progress section
**Then** I see real-time updates via polling (every 5s)
**And** a "Cancel" button to abort the mining job

**Given** mining is complete
**When** results load
**Then** I see a bar chart of `hookTypeDistribution` (hook types on X-axis, viralRate% on Y-axis)
**And** a "Top Patterns" list showing top 5 attribute combinations with avgEngagement
**And** a "Run Backtest" button
**And** a "Compare Platforms" tab showing cross-platform stats

**Given** backtest results exist
**When** I click "View Backtest Report"
**Then** I see precision/recall metrics, accuracy by hook type, platform breakdown, and recommendation text

**Given** no viral stats exist for the selected platform+niche
**When** I load the page
**Then** I see a "No data yet" state with CTA to run first mining job

---

## API Endpoints (for Dashboard + External Access)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/viral/mine` | Trigger mining job `{ platform, niche, count }` |
| GET | `/api/viral/mine/:jobId` | Get mining job status/progress |
| DELETE | `/api/viral/mine/:jobId` | Cancel running job |
| GET | `/api/viral/stats/:platform/:niche` | Get latest viral stats |
| GET | `/api/viral/stats` | List all available stats |
| POST | `/api/viral/backtest` | Run backtest `{ platform, niche, days }` |
| GET | `/api/viral/backtest/:reportId` | Get backtest report |
| GET | `/api/viral/corpus/:platform/:niche` | Download raw corpus |
| GET | `/api/viral/platforms` | List supported platforms + categories |

---

## FR Coverage Map

FR-97: Story 45.1 - Universal Viral Corpus Miner (Jev batch classification, 18 platforms)
FR-98: Story 45.2 - Viral Stats Store (aggregation + persistence per platform)
FR-99: Story 45.3 - Content Intelligence Feed (prompt enrichment per platform)
FR-100: Story 45.4 - Backtest Engine (validation loop per platform)
FR-101: Story 45.3 - Live Feed Prioritizer (jevFilter ranking per platform)
FR-102: Story 45.5 - Viral Dashboard UI (web interface for mining/stats/backtest, 18 platforms)

## NFRs Addressed

- **NFR-Jev-Cost**: Budget cap enforced in Story 45.1 (cost tracking + warn threshold per platform).
- **NFR-Jev-Latency**: Batch mode async, no real-time constraint; target ≤60s per 10k items.
- **NFR-Jev-Degraded**: JevBrain degraded → fallback to heuristic engagement scoring.
- **NFR-Data-Persist**: File-based JSON storage in `data/viral-stats/`.
- **NFR-Platform-Scale**: Support 18 platforms via existing scrapers (Epic 34).


## Implementation Notes

### New Modules Created

| File | Purpose | Status |
|------|---------|--------|
| `src/analytics/jevViralMiner.js` | Corpus scraping + Jev batch classification | ✅ Created |
| `src/analytics/viralStatsStore.js` | Stats aggregation + persistence | ✅ Created |
| `src/analytics/platformQuestions.js` | Platform-specific Jev questions (18 platforms) | ✅ Created |
| `src/analytics/jevBacktest.js` | Backtest validation engine | ✅ Created |
| `src/filters/jevFilter.js` | Live feed prioritizer | ✅ Created |
| `api/routes/viral.js` | API endpoints (9 routes) | ✅ Created |
| `src/agents/jevBrain.js` | Added `batchDecide()` method | ✅ Updated |

### Still Needed

| File | Purpose | Story |
|------|---------|-------|
| `dashboard/viral-miner.html` | Web UI | 45.5 |
| `dashboard/js/viral-miner.js` | Frontend logic | 45.5 |
| `src/cli/index.js` | Add `viral-mine`, `viral-stats`, `backtest` commands | 45.1-45.4 |
| `src/ai/tweetGenerator.js` | Integrate viral stats injection | 45.3 |
| `src/ai/jevVariantJudge.js` | Add viral score boost | 45.3 |

### Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| `batchDecide()` in JevBrain | Reusable for other epics, keeps concurrency logic centralized |
| File-based storage | Consistent with XActions persistence pattern, no DB dependency |
| Polling for dashboard | Simpler than WebSocket, sufficient for batch operations |
| Platform questions as config | Easy to update per platform without code changes |
| Niche normalization | Prevents file path collisions, consistent naming |

## Dependencies
## Resolved Gaps (Dev Review)

| Gap | Resolution |
|-----|------------|
| LinkedIn scraper | ✅ Found: `src/scrapers/recruitment/linkedin/crawler.js` (LinkedInCrawler class) |
| jevFilter.js | ✅ Created: `src/filters/jevFilter.js` — live feed prioritizer |
| CLI registration | ⏳ Pending: Add `viral-mine`, `viral-stats`, `backtest` commands to `src/cli/index.js` |
| API routes | ✅ Created: `api/routes/viral.js` — all endpoints defined |
| Platform questions schema | ✅ Created: `src/analytics/platformQuestions.js` — 18 platforms defined |
| Cost estimation | ✅ Formula: `posts × 14 × $0.00000048` = ~$0.067 per 10k posts |
| Dashboard real-time | ✅ Decision: Use polling (5s interval), not WebSocket |

## File Map

| File | Purpose | Status |
|------|---------|--------|
| `src/analytics/jevViralMiner.js` | Corpus scraping + Jev batch classification | 📝 Story 45.1 |
| `src/analytics/viralStatsStore.js` | Stats aggregation + persistence | 📝 Story 45.2 |
| `src/analytics/platformQuestions.js` | Platform-specific Jev questions | ✅ Created |
| `src/analytics/jevBacktest.js` | Backtest validation engine | 📝 Story 45.4 |
| `src/filters/jevFilter.js` | Live feed prioritizer | ✅ Created |
| `api/routes/viral.js` | API endpoints | ✅ Created |
| `dashboard/viral-miner.html` | Web UI | 📝 Story 45.5 |
| `dashboard/js/viral-miner.js` | Frontend logic | 📝 Story 45.5 |



- **Requires:** Epic 34 (scrapers stable), Epic 42 (JevBrain gateway), existing `tweetGenerator`, `jevVariantJudge`.
- **New modules needed:** `src/filters/jevFilter.js` (create), `src/analytics/jevViralMiner.js`, `src/analytics/viralStatsStore.js`, `src/analytics/jevBacktest.js`, `api/routes/viral.js`.
- **Enables:** Future Epic 46+ (auto-post với viral DNA optimization), Epic 47+ (competitor viral pattern analysis), Epic 48+ (cross-platform content adaptation).

---

# Epic 46: Chuẩn Hóa Bộ Hợp Đồng API & Tài Liệu Tương Tác OpenAPI 3.1 / Swagger

**Goal:** Chuẩn hóa toàn bộ API routes của backend Express (scope định nghĩa tại Route Inventory — Phụ lục A) sang OpenAPI 3.1 được generate từ Zod schemas, cung cấp Swagger UI self-hosted tại `/api-docs` và script sinh TypeScript API client (`@xactions/api-client`) để frontend Next.js (Epic 47) gọi API type-safe.

**Requirements Covered:** FR-116, FR-117, FR-118, FR-119, NFR-22, NFR-23 (prd.md §7.1/§7.2).

**Phạm vi & Phụ thuộc (Dependencies / Non-goals):**

- **Spec source of truth:** OpenAPI document được generate từ Zod schemas qua `@asteasolutions/zod-to-openapi`. `api/openapi.js` hiện hữu (4.6k dòng, phục vụ `/api/ai/*`) được refactor thành builder dùng chung — **không** duy trì spec thủ công song song.
- **Bảo toàn contract x402 (bắt buộc):** spec mới phải giữ nguyên `x-payment-info`, `x-bazaar`, `securitySchemes.x402Payment` và `GET /.well-known/x402` — đây là discovery contract của x402scan, phá vỡ = paid AI endpoints mất pricing/discovery.
- **Exclusions (không áp dụng validation/envelope):** `POST /webhooks/*` (raw Buffer body cho Stripe signature), các endpoint streaming/binary/SSE/redirect (`/api/video/download`, `/metrics/stream`), và `/api/plugins/*` (mount runtime qua `mountPluginRoutes` — plugin tự đăng ký schema nếu muốn vào spec). Envelope chỉ áp dụng cho JSON endpoints.
- **Deployment:** spec/UI đầy đủ chỉ bắt buộc trên `api/server.js`. `api/serverless.js` (Vercel) serve spec cùng document nhưng `info.description` phải ghi rõ một số paths trả 503 trên serverless.
- **Epic 47** consume `@xactions/api-client`. Epic này chỉ deliver client package; migrate fetch calls cũ trong dashboard/frontend thuộc Epic 47.
- **Build order:** `46.2 → 46.1 → 46.3` — spec cần Zod schemas (46.2) trước khi `paths` coverage của 46.1 verify được; client gen (46.3) chạy trên artifact ổn định cuối cùng.
- **Envelope chuẩn (định nghĩa tại đây, dùng xuyên epic):** success `{ success: true, data: T }`; error `{ success: false, error: { code: string, message: string, type?: string, details?: unknown } }`. Pagination dùng `PaginatedResponse<T> = { success: true, data: T[], page: { cursor: string | null, limit: number, total?: number } }`.

---

### Story 46.1: Tích hợp Swagger UI & Endpoint Xuất Bản OpenAPI 3.1 JSON

As a **Frontend Developer / AI Agent Integrator**,  
I want **truy cập Swagger UI self-hosted tại `/api-docs` và endpoint `/openapi.json`**,  
So that **tôi xem được danh mục toàn bộ API theo Route Inventory, thử request an toàn trên trình duyệt và nạp spec vào các công cụ phát triển**.

**Acceptance Criteria:**

**Given** backend Express đang chạy  
**When** người dùng gửi `GET /openapi.json`  
**Then** server trả `200 OK` với `content-type: application/json`, root object khai báo `openapi: 3.1.0`, giữ nguyên `x-payment-info`/`x-bazaar` extensions và CORS `origin: '*'` như hiện tại.  
**And** `paths` liệt kê đủ operations của từng nhóm thuộc scope trong Phụ lục A; mỗi operation có `operationId` duy nhất (bắt buộc cho codegen).  
**And** Swagger UI serve self-hosted qua `swagger-ui-express` (không CDN — Helmet CSP hiện tại chặn) tại `/api-docs`, mount trước các handler `/docs/:slug`; `GET /api-docs` trả Swagger UI HTML, không phải `dashboard/docs/*.html`.  
**And** UI khai báo `servers` (localhost + production) và hỗ trợ `authorize()` cho `bearerAuth` (JWT). Các endpoint mutation trên tài khoản thật (tweet/unfollow/DM/auto-*) và endpoint x402 trả 402 được đánh dấu không executable (vd `x-tryitout: false` hoặc `supportedSubmitMethods` tương đương) — Try-it-out chỉ thực thi request thật trên read-only endpoints.

---

### Story 46.2: Khai Báo Zod Schemas & Quy Chuẩn Response Envelopes

As a **Backend Developer**,  
I want **định nghĩa Zod schemas cho request/response của mọi route thuộc scope trong Route Inventory**,  
So that **input được validate chặt trước handler, response theo một envelope thống nhất, và OpenAPI spec tự động đồng bộ từ cùng một source of truth — giảm thiểu lỗi runtime do malformed I/O**.

**Acceptance Criteria:**

**Given** contract layer foundation (`api/schemas/**`, `api/middleware/{validate,envelope}.js`, session-cookie shim, registry→spec builder) và pilot mounts `/api/viral`, `/api/crm`, `/api/optimizer`, `/api/checkpoints`, `/api/session`, `/api/auth`  
**When** request được gửi lên các pilot routes  
**Then** middleware validate `body`, `query`, `path params` và các header đã khai báo (`x-session-cookie`, `x-payment`) qua Zod schema tương ứng, theo thứ tự `authenticate → validate → handler`; input không hợp lệ trả `400` theo error envelope chuẩn.  
**And** mọi JSON endpoint trong pilot scope trả success/error theo envelope đã định nghĩa ở Epic header — bao gồm lỗi sinh từ middleware (rate-limit `429`, `404` route-not-found, body-parser `413`/`415`, global error handler).  
**And** mỗi operation khai báo `securitySchemes` tương ứng với thực tế route đó: `bearerAuth` (JWT), `sessionCookie` (apiKey — header `x-session-cookie` canonical, legacy `body.sessionCookie` normalize qua shim), `x402Payment`, hoặc optional-auth (`{}` union cho endpoint trả khác nhau giữa anon/authed).  
**And** CI chạy spec lint (redocly hoặc spectral) + contract test tối thiểu 1 endpoint mỗi nhóm trong scope, fail khi response thật lệch schema.  
**And** `express-validator` ở `routes/session-auth.js` và `routes/auth.js` được migrate sang Zod — không còn hai validation system song song.

*Scope note: story này giao foundation + pilot mounts. Rollout các mounts còn lại trong Route Inventory thuộc Stories 46.4–46.5 (chia batch để PR review được).*

---

### Story 46.3: Generator Sinh TypeScript API Client (`@xactions/api-client`)

As a **Frontend Developer**,  
I want **chạy `npm run generate:api-client` ở `package.json` gốc để sinh client TypeScript từ spec**,  
So that **tôi gọi API trong Next.js (Epic 47) với gợi ý code (IntelliSense) và kiểm tra kiểu tại compile-time**.

**Acceptance Criteria:**

**Given** `package.json` gốc có script `"generate:api-client"` và `workspaces` đã khai báo `packages/*`  
**When** chạy `npm run generate:api-client`  
**Then** tool đọc spec từ artifact đã commit (`openapi.json` được sinh bởi script build) hoặc import spec builder trực tiếp — **không** fetch HTTP từ server đang chạy; fail loudly nếu spec thiếu/không parse được.  
**And** output vào `packages/api-client/` (path duy nhất, import được dưới tên `@xactions/api-client`), types sinh qua `openapi-typescript` + fetch wrapper mỏng viết tay.  
**And** export một type per schema trong spec (e.g., `ViralStats`, `PostItem`, `CRMContact`, `OptimizeTweetRequest`) cộng `PaginatedResponse<T>`; generated types được namespace/dedupe để không đụng các component `Error`/`SuccessResponse`/`PaymentRequired` hiện có.  
**And** fetch wrapper inject auth (Bearer token hoặc `x-session-cookie`) và trả typed error union (`400 | 401 | 402 | 429 | 500`) thay vì `any` — consumer không phải tự xử lý auth/error lại.

---

### Story 46.4: Rollout Zod & Envelope — Batch Social/User-Facing

As a **Backend Developer**,  
I want **áp dụng contract layer (schemas + validate + envelope) cho các mount social và user-facing còn lại**,  
So that **toàn bộ surface người dùng tương tác trực tiếp tuân thủ contract thống nhất**.

**Acceptance Criteria:**

**Given** contract foundation từ Story 46.2 đã merged  
**When** áp dụng cho các mount: `/api/twitter`, `/api/facebook`, `/api/facebook/accounts`, `/api/platform`, `/api/posting`, `/api/messages`, `/api/engagement`, `/api/thread`, `/api/spaces`, `/api/unfollowers`, `/api/graph`, `/api/profile`, `/api/settings`, `/api/user`, `/api/creator`, `/api/discovery`, `/api/bookmarks`  
**Then** mọi route trong các mount này có Zod request schema + response schema đăng ký vào registry, validate theo `authenticate → validate → handler`, và trả canonical envelope.  
**And** mutations trên tài khoản thật (`posting`, `messages`, `engagement`...) được đánh `x-tryitout: false` trong spec.  
**And** nếu diff của batch vượt ngưỡng review được, batch được chia nhỏ thêm theo mount-group — mỗi PR giữ nguyên invariant envelope/validation.

---

### Story 46.5: Rollout Zod & Envelope — Batch Data/Ops/Admin

As a **Backend Developer**,  
I want **áp dụng contract layer cho các mount data, operations và admin còn lại**,  
So that **Route Inventory được coverage hoàn chỉnh và Epic 46 đạt AC tổng thể**.

**Acceptance Criteria:**

**Given** Stories 46.2 và 46.4 đã merged  
**When** áp dụng cho các mount: `/api/a2a`, `/api/license`, `/api/workflows`, `/api/scripts`, `/api/billing`, `/api/operations`, `/api/admin`, `/api/admin/webhooks`, `/api/datasets`, `/api/schemas`, `/api/proxies`, `/api/proxy/budget`, `/api/osint`, `/api/schedule`, `/api/tweet-schedule`, `/api/notifications`, `/api/teams`, `/api/benchmark`, `/api/automations`, `/api/streams`, `/api/analytics`, `/api/governor`, `/api/video`, `/api/agent`  
**Then** mọi route trong các mount này có Zod schemas + canonical envelope + spec registration, theo cùng convention của 46.2.  
**And** các ngoại lệ Phụ lục A được tôn trọng: `/api/analytics` dedupe paths giữa hai router + operationId duy nhất; `/api/governor` chỉ document mount `/api/governor`; `/api/video/download` exempt envelope (stream `video/mp4`); `/api/agent` mutations `x-tryitout: false`.  
**And** sau story này, Route Inventory đạt coverage hoàn chỉnh — mọi ✅/⚠️ mount đều có spec entry từ registry hoặc section tĩnh đã merge.

---

### Phụ lục A — Route Inventory (source of truth cho scope Epic 46)

Mount table trích từ `api/server.js`. ✅ = Zod validate + envelope + spec. ⚠️ = in spec, ngoại lệ ghi trong Notes. ❌ = ngoài scope.

| Mount | Route file | Scope | Notes |
|---|---|---|---|
| `/api/viral` | `routes/viral.js` | ✅ | Mutations → Try-it-out off |
| `/api/crm` | `routes/crm.js` | ✅ | |
| `/api/optimizer` | `routes/optimizer.js` | ✅ | |
| `/api/a2a` | `routes/a2a.js` | ✅ | |
| `/api/license` | `routes/license.js` | ✅ | |
| `/api/workflows` | `routes/workflows.js` | ✅ | |
| `/api/ai` | `routes/ai.js` + `routes/ai/*` | ⚠️ | x402-paid; đã có spec — merge, giữ extensions; Try-it-out off (402) |
| `/api/agent` | `routes/agent.js` | ⚠️ | Paid automation mutations — Try-it-out off |
| `/api/posting` | `routes/posting.js` | ⚠️ | Mutations trên tài khoản thật — Try-it-out off |
| `/api/messages` | `routes/messages.js` | ⚠️ | DM mutations — Try-it-out off |
| `/api/analytics` | `routes/analytics.js` + `routes/history.js` | ⚠️ | Hai router share một mount — dedupe paths, operationId duy nhất |
| `/api/governor` | `routes/governor.js` | ⚠️ | Dual-mount với `/governor`; chỉ document path `/api/governor` |
| `/api/video` | `routes/video.js` | ⚠️ | `download` stream `video/mp4` — exempt envelope cho endpoint đó |
| `/api/session` | `routes/session-auth.js` | ⚠️ | Hiện dùng express-validator — migrate hoặc coexist, ghi rõ trong spec |
| `/api/scripts` | `routes/scripts.js` | ✅ | |
| `/api/billing` | `routes/billing.js` | ✅ | |
| `/api/auth` | `routes/auth.js` | ✅ | |
| `/api/user` | `routes/user.js` | ✅ | |
| `/api/operations` | `routes/operations.js` | ✅ | |
| `/api/twitter` | `routes/twitter.js` | ✅ | |
| `/api/facebook/accounts` | `routes/facebookAccounts.js` | ✅ | |
| `/api/facebook` | `routes/facebook.js` | ✅ | |
| `/api/platform` | `routes/platform.js` | ✅ | |
| `/api/admin/webhooks` | `routes/webhook-admin.js` | ✅ | Admin auth |
| `/api/admin` | `routes/admin.js` | ✅ | Admin auth |
| `/api/profile` | `routes/profile.js` | ✅ | |
| `/api/engagement` | `routes/engagement.js` | ✅ | |
| `/api/discovery` | `routes/discovery.js` | ✅ | |
| `/api/bookmarks` | `routes/bookmarks.js` | ✅ | |
| `/api/creator` | `routes/creator.js` | ✅ | |
| `/api/spaces` | `routes/spaces.js` | ✅ | |
| `/api/settings` | `routes/settings.js` | ✅ | |
| `/api/portability` | `routes/portability.js` | ✅ | |
| `/api/graph` | `routes/graph.js` | ✅ | |
| `/api/unfollowers` | `routes/unfollowers.js` | ✅ | |
| `/api/thread` | `routes/thread.js` | ✅ | |
| `/api/schedule` | `routes/schedule.js` | ✅ | |
| `/api/tweet-schedule` | `routes/tweetSchedule.js` | ✅ | |
| `/api/datasets` | `routes/datasets.js` | ✅ | |
| `/api/checkpoints` | `routes/checkpoints.js` | ✅ | |
| `/api/schemas` | `routes/schemas.js` | ✅ | |
| `/api/proxies` | `routes/proxies.js` | ✅ | |
| `/api/proxy/budget` | `routes/proxy-budget.js` | ✅ | |
| `/api/osint` | `routes/osint.js` | ✅ | |
| `/api/notifications` | `routes/notifications.js` | ✅ | |
| `/api/teams` | `routes/teams.js` | ✅ | |
| `/api/benchmark` | `routes/benchmark.js` | ✅ | |
| `/api/automations` | `routes/automations.js` | ✅ | |
| `/api/streams` | `routes/streams.js` | ✅ | REST control plane; stream data đi qua socket.io |
| `/webhooks` | `routes/webhooks.js` | ❌ | Stripe raw Buffer body — exclusion |
| `/metrics/stream` | inline (`server.js`) | ❌ | SSE — exclusion |
| `/api/plugins/*` | `mountPluginRoutes()` runtime | ❌ | Không có static schema; plugin tự đăng ký nếu muốn vào spec |

---

# Epic 47: Ứng Dụng Web Hiện Đại Next.js & Bảng Điều Khiển Trí Tuệ Hợp Nhất

**Goal:** Xây dựng ứng dụng web Next.js 15 (App Router, Tailwind CSS, Shadcn/UI) hiện đại, gom toàn bộ 51 file HTML rời rạc thành một Single Page Application đẳng cấp, trực quan hóa Follower CRM, Viral DNA Analytics Canvas, AI Tweet Optimizer Playground và Universal Data Explorer.

**Requirements Covered:** FR-120, FR-121, FR-122, FR-123, FR-124, FR-125, FR-126, NFR-24, NFR-25, NFR-26 (prd.md §7.1/§7.2).

---

### Story 47.1: Khởi Tạo Dự Án Next.js 15 App Router & Universal Layout

As a **Người dùng XActions**,  
I want **truy cập giao diện web Next.js mượt mà với Sidebar điều hướng thông minh, Dark/Light Mode và thanh trạng thái kết nối Backend**,  
So that **tôi có thể điều hướng giữa các công cụ nhanh chóng mà trang không bị tải lại từ đầu**.

**Acceptance Criteria:**

**Given** thư mục `apps/web/` được cấu hình với Next.js 15, TypeScript, Tailwind CSS, Shadcn/UI, Lucide Icons  
**When** chạy `npm run dev` trong frontend  
**Then** ứng dụng khởi động thành công tại `http://localhost:3000` với thời gian tải trang < 1.0 giây.  
**And** Sidebar có thể thu gọn (Collapsible), hiển thị đầy đủ các phân hệ chức năng.  
**And** thanh Header hỗ trợ chuyển đổi Dark/Light mode và huy hiệu trạng thái kết nối Backend (`http://localhost:3001`).

---

### Story 47.2: Màn Hình Viral DNA Miner Dashboard & Biểu Đồ Trực Quan (`/viral-miner`)

As a **Growth Hacker / Marketer**,  
I want **sử dụng màn hình Viral DNA Miner được xây dựng bằng React Components**,  
So that **tôi có thể cào bài viết, theo dõi thanh tiến trình realtime và xem biểu đồ phân bố Hook Type, Top Patterns sắc nét**.

**Acceptance Criteria:**

**Given** người dùng chọn Category, Platform (18 nền tảng), nhập Niche và điều chỉnh Post Count  
**When** bấm nút **Run Mining**  
**Then** giao diện gọi `api.viral.mine()` và hiển thị thẻ tiến trình thời gian thực (`Scraped`, `Classified`, `Est. Cost`, `Elapsed`).  
**And** tab Overview hiển thị biểu đồ Recharts BarChart tỷ lệ phần trăm của từng Hook Type có tooltip chi tiết.  
**And** tab Top Patterns và Compare Platforms hiển thị ma trận đối chiếu trực quan đa nền tảng.

---

### Story 47.3: Màn Hình Follower CRM & Quản Trị Khách Hàng Tiềm Năng (`/crm`)

As a **Kinh doanh / Chuyên viên phát triển cộng đồng**,  
I want **quản lý danh bạ người theo dõi trong bảng tương tác TanStack Table, lọc theo phân khúc và gán tag**,  
So that **tôi có thể phân loại khách hàng VIP và chăm sóc tệp người theo dõi có giá trị cao nhất**.

**Acceptance Criteria:**

**Given** trang `/crm`  
**When** nạp dữ liệu từ `/api/crm/search`  
**Then** bảng TanStack Table hiển thị danh sách Contact với Avatar, Username, Bio, Số followers, Điểm Lead Score và Tags.  
**And** người dùng có thể gán tag mới và cập nhật tức thì trên giao diện qua API `POST /api/crm/tag`.  
**And** bộ lọc phân khúc tự động lọc danh sách theo nhóm đối tượng định trước.

---

### Story 47.4: Màn Hình AI Content Optimizer Playground (`/optimizer`)

As a **Nhà sáng tạo nội dung**,  
I want **một không gian soạn thảo thông minh có nút phân tích và tối ưu hóa bằng AI**,  
So that **bài viết của tôi được AI chấm điểm, gợi ý hashtags và viết lại hấp dẫn hơn trước khi đăng**.

**Acceptance Criteria:**

**Given** ô nhập nội dung bài viết tại `/optimizer`  
**When** nhập văn bản và bấm **Predict Score**  
**Then** hệ thống gọi `POST /api/optimizer/predict` và hiển thị đồng hồ đo điểm Viral Potential Score kèm gợi ý cải thiện.  
**And** khi chọn mục tiêu và bấm **Rewrite with AI**, hệ thống gọi `POST /api/optimizer/optimize` và hiển thị bài viết được viết lại dạng side-by-side kèm nút Copy 1-click.  
**And** nút **Generate Hashtags** tự động sinh và hiển thị 5 hashtags phù hợp nhất.

---

### Story 47.5: Màn Hình Cổng Tra Cứu Dữ Liệu Đa Ngành Universal Data Explorer (`/explorer`)

As a **Data Analyst / Chuyên viên nghiên cứu thị trường**,  
I want **tìm kiếm và trích xuất dữ liệu đa ngành từ 25 crawlers (Việc làm, BĐS, Mã số thuế, Mạng xã hội)**,  
So that **tôi có thể xem trước dữ liệu dạng bảng và xuất file CSV phục vụ công việc nghiên cứu**.

**Acceptance Criteria:**

**Given** giao diện `/explorer`  
**When** người dùng chọn ngành (`Việc làm: VietnamWorks/TopCV`, `Bất động sản: Chợ Tốt`, `Doanh nghiệp: MaSoThue`, `Social: Reddit/Threads`)  
**Then** các ô nhập liệu thích ứng linh hoạt theo ngữ cảnh tìm kiếm.  
**And** bảng kết quả hiển thị chi tiết tiêu đề, giá/lương, công ty/tác giả, ngày đăng và đường dẫn gốc.  
**And** nút **Export CSV** cho phép tải xuống file dữ liệu chuẩn UTF-8 chỉ với 1 cú click.


---

# Epic 48: Nền Tảng Web API (BFF) & Hoàn Tất Migration Frontend Next.js

**Goal:** Biến `apps/web` thành ứng dụng deploy được thật sự: BFF same-origin proxy + httpOnly cookie session thay thế raw `fetch('http://localhost:3001')`, typed client consumption đúng FR-126, rồi migrate toàn bộ ~28 màn app còn lại từ `dashboard/*.html` — đóng FR-125 đúng nghĩa.

**Requirements Covered:** FR-125 (completion), FR-126 (remediation), FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, NFR-27, NFR-28 (prd.md §7.1/§7.2).

**Phạm vi & Phụ thuộc (Dependencies / Non-goals):**

- **Architecture spine:** `architecture/xactions-web-foundation-epic48/ARCHITECTURE-SPINE.md` — 8 ADs (AD-1 BFF proxy, AD-2 cookie session, AD-3 realtime deferred, AD-4 hand-rolled components, AD-5 app-router only, AD-6 app-screens-only scope, AD-7 parallel-run, AD-8 test infra).
- **Marketing/static pages excluded (AD-6):** ~20 file (index, about, blog, faq, pricing, terms, privacy, features, team, tutorials…) không phải app screens — giữ ở `dashboard/` hoặc tách static site sau.
- **Backend `api/` không đổi trong 48.1–48.3** — ngoại lệ duy nhất: socket auth extension (AD-3) được phép sửa `api/realtime/socketHandler.js` trong story 48.4.
- **Realtime auth gap đã biết (AD-3):** `io.use` chỉ đọc `socket.handshake.auth.token` (`socketHandler.js:88`) — quyết (a) parse cookie hoặc (b) socket-token endpoint khi làm màn realtime đầu tiên. Deferred: `deferred-work.md` 2026-09-24.
- **Ordering:** 48.1 → 48.2 → waves 48.3–48.9 → gate 48.10. Screen waves có thể reorder/parallel sau khi 48.1+48.2 xong; 48.10 blocking cuối.
- **Story 48.1 spec:** `implementation-artifacts/spec-48-1-web-api-foundation-bff.md` — `ready-for-dev` (đã qua review loop, 15 findings resolved).

---

### Story 48.1: Nền Tảng API — BFF Proxy, Typed Client & Session Transport

As a **Developer**,  
I want **BFF catch-all proxy + typed `lib/api.ts` + httpOnly session cookies**,  
So that **mọi màn Next.js gọi API same-origin, không hardcode origin, credential không lộ ra browser, và contract Epic 46 được tiêu thụ đúng**.

**Acceptance Criteria:**

**Given** `apps/web` với `API_INTERNAL_URL` server-only  
**When** một page gọi `apiFetch('/api/viral/platforms')`  
**Then** request đi qua `app/api/[...path]/route.ts` → `lib/proxy.ts` raw-fetch tới backend, verbatim streaming (SSE/binary), inject `xa_bearer`→`Authorization`/`xa_session`→`x-session-cookie`, không reshape envelope.  
**And** `app/session/route.ts` POST/GET/DELETE quản lý httpOnly cookies (`SameSite=Lax`, `Secure` prod), login exchange `{email,password}`→`xa_bearer`.  
**And** 4 màn API-using (`viral-miner`, `optimizer`, `crm`, `admin`) + `backend-status.tsx` migrate hết raw fetch; `app/api-docs/[[...path]]` proxy Swagger same-origin; `pages/` shim xóa; `next build` xanh; vitest ephemeral-upstream + playwright e2e qua BFF thật.  
*(Chi tiết đầy đủ: spec file — single source of truth cho story này.)*

---

### Story 48.2: Màn Hình Đăng Nhập & Session Connect (`/login`)

As a **Operator**,  
I want **màn login trong `apps/web` gọi `POST /session` và trạng thái phiên hiển thị ở header**,  
So that **tôi authenticate một lần và mọi màn sau hoạt động với credentials thật — không còn dev-fallback che 401**.

**Acceptance Criteria:**

**Given** màn `/login` port từ `dashboard/login.html` (form email/password + X session cookie input)  
**When** submit credentials  
**Then** `POST /session` exchange thành httpOnly cookies; `GET /session` drive trạng thái "connected" ở `header.tsx`; `DELETE /session` làm logout.  
**And** 401 từ BFF được hiển thị rõ (không silent fallback); unauthenticated pages redirect về `/login` khi endpoint yêu cầu auth.  
**And** playwright spec: login → gọi 1 endpoint cần JWT (vd `/api/crm/tag` flow) → logout → 401 hiển thị đúng.

---

### Story 48.3: Nhóm Màn Ops & Realtime (`/monitor`, `/status`, `/run`, `/benchmark`)

As a **Operator**,  
I want **các màn giám sát tiến trình/scrape/benchmark migrate sang Next.js với realtime chuẩn**,  
So that **tôi theo dõi job runs, canary checks và system status trực tiếp trong app mới**.

**Acceptance Criteria:**

**Given** `lib/realtime.ts` (socket.io-client, direct connect `NEXT_PUBLIC_SOCKET_URL`, AD-3)  
**When** mở `/monitor`  
**Then** progress bars + event feeds cập nhật realtime tương đương `dashboard/monitor.html` (socket.io CDN hiện tại); `/run` trigger + theo dõi command runner; `/status` hiển thị `/api/health`, socket status, hibernation status; `/benchmark` hiển thị kết quả benchmark suite (Epic 34).  
**And** socket auth decision (AD-3 option a/b) được implement và ghi vào spine addendum; mỗi màn có playwright happy-path spec.

---

### Story 48.4: Màn Admin Console (`/admin` full parity)

As a **Admin**,  
I want **màn admin 3119-dòng (`dashboard/admin.html`) migrate với đầy đủ checkpoint controls + socket events**,  
So that **tôi pause/resume/retry checkpoints và giám sát admin surfaces không cần dashboard cũ**.

**Acceptance Criteria:**

**Given** `/api/checkpoints*` + admin mounts đã có contract (Epic 46)  
**When** mở `/admin`  
**Then** toàn bộ sections của `admin.html` (checkpoint list, pause/resume/retry — đã migrate sơ trong 48.1 — + các panels còn lại) parity với legacy; socket.io admin channel hoạt động qua `lib/realtime.ts`.  
**And** legacy `dashboard/admin.html` được đánh dấu superseded trong sidebar config sau verify.

---

### Story 48.5: Fleet & Account Manager (`/accounts`, `/proxies`, `/sessions`)

As a **Operator quản nhiều tài khoản**,  
I want **UI quản lý account pool, proxy pool và session state trong Next.js**,  
So that **tôi thêm/xóa/kiểm tra sức khỏe accounts + proxies mà không phải gọi API thủ công**.

**Acceptance Criteria:**

**Given** `/api/proxies`, `/api/admin`, `/api/facebook/accounts` mounts + hibernation endpoints (Epic 11/27/34 đã done)  
**When** mở `/accounts`  
**Then** danh sách accounts + health/warmup status hiển thị; add/remove account flow hoạt động; `/proxies` quản lý proxy pool (add, health check, rotation stats); `/sessions` hiển thị session expiry/hibernation state per account.  
**And** hấp thụ FUTURE-WORK deferred item "Multi-Account & Proxy Fleet Manager UI" — điều kiện reactivate (Epic 19 done + pool stable) đã thỏa.

---

### Story 48.6: Nhóm Màn Intelligence (`/osint`, `/graph`, `/analytics`, `/price-correlation`)

As a **Analyst**,  
I want **các màn OSINT/graph/analytics migrate**,  
So that **tôi tra cứu identity clusters, quan hệ graph và analytics trong app mới**.

**Acceptance Criteria:**

**Given** `x_social_find_profiles`, identity clusters (Epic 36/41), `/api/analytics/*` mounts  
**When** mở `/osint`  
**Then** profile lookup + cluster visualization hoạt động; `/graph` render graph view; `/analytics` + `analytics-dashboard` + `price-correlation` port với charts tương đương; mỗi màn ≥1 playwright spec.

---

### Story 48.7: Nhóm Màn Automation (`/workflows`, `/automations`, `/scheduler`, `/calendar`, `/a2a`, `/jev-test`)

As a **Operator**,  
I want **workflow builder, automation rules, scheduler/calendar và A2A/Jev consoles trong Next.js**,  
So that **tôi quản lý automation pipeline end-to-end trong app mới**.

**Acceptance Criteria:**

**Given** `dashboard/js/workflow-builder.js` (573d), `scheduler.js` (161d), `a2a.html` EventSource  
**When** mở `/workflows`  
**Then** builder UI parity; `/automations` rule CRUD; `/scheduler`+`/calendar` port; `/a2a` SSE stream qua BFF (verbatim streaming AD-1); `/jev-test` Jev console parity.

---

### Story 48.8: Nhóm Màn Content & Media (`/thread`, `/thread-composer`, `/tweet-schedule`, `/video`, `/ai`, `/ai-api`, `/playground`)

As a **Content creator**,  
I want **thread composer, video downloader UI, AI playground trong Next.js**,  
So that **tôi soạn/tải/test nội dung không rời app mới**.

**Acceptance Criteria:**

**Given** x402 `paymentModal.js` + ai/ai-api mounts  
**When** mở `/thread-composer`  
**Then** composer + schedule parity; `/video` download flow qua BFF binary streaming; `/ai`/`/ai-api`/`/playground` port, x402 payment modal port cẩn thận (payment flow không đổi semantics).

---

### Story 48.9: Nhóm Màn Account & Misc (`/facebook`, `/unfollowers`, `/mcp`, `/extension`, `/platform`, `/agent`, `/security`)

As a **User**,  
I want **các màn còn lại migrate**,  
So that **không còn màn app nào chỉ sống ở dashboard cũ**.

**Acceptance Criteria:**

**Given** các màn tương ứng trong `dashboard/`  
**When** migrate  
**Then** mỗi màn parity với legacy equivalent; `/security` hiển thị security/status surfaces; `/mcp` MCP inspector; `/extension` extension status; `/agent` agent surfaces; mỗi màn ≥1 playwright spec hoặc gộp smoke spec.

---

### Story 48.10: Decommission Gate — Đóng FR-125

As a **Maintainer**,  
I want **xóa phần app còn sót trong `dashboard/` sau khi parity đầy đủ**,  
So that **không còn hai frontend song song và FR-125 đóng đúng nghĩa**.

**Acceptance Criteria:**

**Given** 48.3–48.9 đã verify parity  
**When** gate chạy  
**Then** `dashboard/*.html` app-screens + `dashboard/js/` tương ứng được xóa (marketing/static giữ lại theo AD-6); `api/server.js` static mounts cập nhật; sidebar/routes không còn link legacy; `grep -r "dashboard/"` trong `apps/web` = 0 refs.

---

# Epic 49: Platform Hardening Sweep

**Goal:** Dọn sạch nợ kỹ thuật P1/P2 đã tích lũy trong `deferred-work.md` trước khi scale — tách quick-wins (không cần spec) khỏi design work thật (có spec riêng).

**Requirements Covered:** FR-136, FR-137, FR-138, FR-139, FR-140 (prd.md §7.1).

**Phạm vi & Phụ thuộc:**

- **Source of truth:** `implementation-artifacts/deferred-work.md` (~10 P1/P2 open) + `planning-artifacts/FUTURE-WORK.md`.
- **Split rule (Winston):** quick wins = story 49.1 gộp; các item cần quyết định kiến trúc (Redis quota, webhook worker) = stories riêng có spec — không "sweep" chung.
- **Không phụ thuộc Epic 48** — có thể chạy song song như hygiene track; ưu tiên sau 48.1 để nền web ổn trước.

---

### Story 49.1: Quick Wins — Route Order, CORS, Lockfile, Session Hygiene

As a **Maintainer**,  
I want **dọn các deferred items cơ học trong một pass**,  
So that **nợ nhỏ không tích lũy thành bug lớn**.

**Acceptance Criteria:**

**Given** deferred items: plugin routes mount sau 404 handler (`api/server.js` — hiện unreachable), CORS preflight allowlist worker (`worker/index.js:45-53`), `pnpm-lock.yaml` stale (cần pnpm 9.15.4), session credential nằm trong `miningJobs` map  
**When** sweep chạy  
**Then** mỗi item có fix + test chứng minh (plugin route reachable, CORS preflight đúng allowlist, lockfile regen sạch, credentials tách khỏi job map); mỗi fix reference deferred-work entry và entry được mark resolved.

---

### Story 49.2: CommentTreeExtractor Concurrency Hardening (P1, deferred 2 lần)

As a **Maintainer**,  
I want **fix race condition trong comment tree extraction** (đã defer qua 2 chu kỳ),  
So that **concurrent extractions không corrupt state**.

**Acceptance Criteria:**

**Given** `deferred-work.md` P1 entry + reproduction case  
**When** implement  
**Then** spec ngắn mô tả race + fix (lock/queue/snapshot — chọn qua spec), test chứng minh concurrent runs đúng; deferred entry resolved.

---

### Story 49.3: Redis-Backed Consumer Quota (Multi-Worker)

As a **Operator chạy multi-worker**,  
I want **consumer quota store dùng chung qua Redis**,  
So that **quota enforcement đúng khi scale >1 worker (hiện in-memory → sai semantics)**.

**Acceptance Criteria:**

**Given** spec riêng (Redis fixture, fallback single-worker in-memory)  
**When** implement  
**Then** quota counts share qua Redis khi `REDIS_URL` set; tests với Redis fixture thật (NFR-20); single-worker mode không đổi behavior.

---

### Story 49.4: Webhook Delivery Worker (HOL Blocking Fix)

As a **Maintainer**,  
I want **webhook delivery qua queue worker riêng**,  
So that **một endpoint chậm không block deliveries sau nó (head-of-line blocking)**.

**Acceptance Criteria:**

**Given** spec riêng (queue + retry + dead-letter semantics)  
**When** implement  
**Then** per-endpoint delivery isolation, retry/backoff policy ghi trong spec, tests chứng minh slow endpoint không chặn fast endpoint.

---

### Story 49.5: Checkpoint Optimistic Locking + P2 Sweep

As a **Maintainer**,  
I want **optimistic locking cho checkpoint mutations + dọn P2 còn lại**,  
So that **concurrent pause/resume không ghi đè và ledger sạch**.

**Acceptance Criteria:**

**Given** deferred-work P2 entries + checkpoint locking item  
**When** implement  
**Then** version check trên checkpoint mutations (409 trên conflict); P2 sweep list trong spec story; mỗi entry resolved hoặc explicit re-defer với lý do.
