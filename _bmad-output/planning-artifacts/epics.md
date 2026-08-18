---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - 'planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md'
  - 'planning-artifacts/research/technical-mediacrawler-architecture-for-xactions-research-2026-08-18.md'
  - 'planning-artifacts/epics-full.md'
  - 'prisma/schema.prisma'
  - '../nowing/_bmad-output/planning-artifacts/architecture/architecture-xactions-social-integration-2026-08-15/ARCHITECTURE-SPINE.md'
---

# XActions Universal Hybrid Scraping & Automation Engine — Epic Breakdown (Epics 10–19)

## Overview

Tài liệu phân rã chi tiết Epics và User Stories cho toàn bộ hệ thống **XActions Universal Hybrid Scraping & Automation Microservice** (tiếp nối Epics 1–9 trong `epics-full.md`). Hệ thống được thiết kế theo chuẩn **Hexagonal Architecture + Tiered Hybrid Signer Engine + Dual-Channel Microservice Daemon + Adaptive Rate Limiter**, hợp nhất 100% cơ sở dữ liệu trên **PostgreSQL (Prisma ORM với JSONB GIN Indexes)** và đóng vai trò là Scraping Engine toàn năng cho hệ sinh thái **Nowing (AI Lead & Research Hub)** cũng như nền tảng SaaS/CLI/AI MCP độc lập.

---

## Requirements Inventory

### Functional Requirements

* **FR64 (Core Abstraction):** Hệ thống phải cung cấp các cổng trừu tượng chuẩn hóa (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) làm khung cơ sở cho mọi nền tảng.
* **FR65 (Tiered Hybrid Scraping Engine):** Hệ thống phải hỗ trợ cơ chế thực thi lai kết hợp Pre-Signed Token Ring Buffer O(1) và Worker Page Pool cho chữ ký động (`page.evaluate()` với timeout 3s) cùng Async HTTP Client (`got-scraping`/`undici`) với TLS/JA4 Spoofing.
* **FR66A (Resilient Anti-Leak Proxy Pool):** Hệ thống phải quản lý tập trung danh sách Proxy (Static & Dynamic Tunnel) với cờ chống rò rỉ WebRTC/DNS, tự động validate, tính buffer expiration, và tự động cách ly (quarantine) IP lỗi 5 phút.
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
* **FR84 (Nowing Scrapers Cutover & Decommissioning):** Nâng cấp adapter Nowing sang Daemon MCP HTTP/SSE (Port 3001) và dọn dẹp, loại bỏ toàn bộ 20+ scraper cũ cùng browser dependencies khỏi Nowing backend.

### NonFunctional Requirements

* **NFR11 (Resource Optimization):** Giảm ít nhất 85% RAM và 70% CPU so với mô hình Full Headless Browser khi cào khối lượng lớn (> 1,000 bài viết/bình luận).
* **NFR12 (High Throughput & Latency):** Tăng tốc độ thu thập dữ liệu lên ít nhất 5x–10x so với việc render DOM từng trang qua Puppeteer/Playwright; độ trễ RPC <2ms qua Daemon HTTP/SSE.
* **NFR13 (Resilience & Auto-Failover):** Tự động phát hiện proxy die hoặc rate-limit và chuyển đổi IP tức thì, replay request tối đa 3 lần với exponential backoff.
* **NFR14 (Zero-Credential Security):** Bảo mật tuyệt đối thông tin phiên của người dùng; hỗ trợ đăng nhập không cần mật khẩu trực tiếp qua QR Code hoặc CDP Attach.
* **NFR15 (Clean Architecture & Extensibility):** Tách biệt 100% giữa Core domain contracts và Implementation adapters; việc thêm nền tảng mới không làm thay đổi core logic.
* **NFR16 (License & Backward Compatibility):** 100% mã nguồn tuân thủ giấy phép tự do (MIT / Apache 2.0); giữ nguyên khả năng tương thích ngược với CLI `unfollowx` và toàn bộ 80+ MCP tools hiện có.

---

## Epic 10: Unified PostgreSQL Storage (Prisma) & Core Interfaces

### Story 10.0: Dev Blocker Prep & Core Scaffold
As a **Core Developer**,
I want **giải quyết các blocker cơ sở (dependencies, src/core/, src/proxy/, src/store/, Prisma schema, MCP daemon script) trước khi viết business logic**,
So that **Story 10.1 và các story sau có thể compile, chạy, và test mà không bị thiếu contract hay dependency**.

**Acceptance Criteria:**
* **Given** repo XActions ở trạng thái sau architecture r3
* **When** kiểm tra `package.json`, `src/core/`, `src/proxy/`, `src/store/`, `prisma/schema.prisma`, `package.json` scripts
* **Then** `got-scraping`, `qrcode-terminal`, `socks-proxy-agent` phải có trong `dependencies` (hoặc xác nhận đã có), script `mcp:daemon` phải tồn tại
* **And** `src/core/` chứa `base-crawler.js`, `base-client.js`, `base-login.js`, `base-store.js`, `error-envelope.js`, `action-registry.js`, `session-manager.js`, `status-api.js`, `adaptive-governor.js`, `index.js`
* **And** `src/proxy/proxy-pool.js` và `src/store/prisma-store.js` tồn tại dưới dạng stub
* **And** `prisma/schema.prisma` chứa `Post`, `Comment`, `CrawlCheckpoint` models cùng ràng buộc `@@unique`
* **And** `prisma/migrations/YYYYMMDDHHMMSS_universal_scraping_schema/migration.sql` tạo GIN index và expression indexes
* **And** `node src/core/index.js` parse thành công, `npx prisma validate` pass, `npm run mcp:daemon` trả về `GET /health` 200

### Story 10.1: Core Domain Interfaces & Error Hierarchy Definition
As a **Core Developer**,
I want **định nghĩa các abstract class `AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore` cùng cây lỗi chuẩn (`PlatformError`, `RateLimitError`, `AuthSessionExpiredError`, `ProxyDeadError`)**,
So that **mọi platform crawler và adapter trong tương lai đều có kiến trúc nhất quán, chuẩn mực và tự động phân loại lỗi retry**.

**Acceptance Criteria:**
* **Given** thư mục `src/core/` (100% Pure ESM, no external npm dependencies)
* **When** module `src/core/base-crawler.js`, `base-client.js`, `base-store.js`, `base-login.js`, `error-envelope.js`, `signer-pool.js`, `status-api.js`, `session-manager.js`, và `action-registry.js` được nạp
* **Then** các class phải định nghĩa đầy đủ phương thức trừu tượng:
  - `AbstractCrawler`: `init()`, `start()`, `search()`, `getPostDetail()`, `getComments()`, `cleanup()`
  - `AbstractApiClient`: `request()`, `sign()`, `updateCookies()` (đảm bảo immutable context cho từng tác vụ)
  - `AbstractStore`: `init()`, `storeContent(post)`, `storeBatch(posts)`, `storeComment(comment)`, `storeCommentBatch(comments)`, `close()`
  - `AbstractCrawler.listActions(): ActionDescriptor[]` để AI/CLI khám phá action theo platform.
* **And** ném lỗi `Method not implemented` nếu lớp con chưa override khi khởi tạo qua `new.target`
* **And** toàn bộ error classes kế thừa từ `PlatformError` cung cấp các trường: `statusCode`, `platform`, `isRetryable` (boolean), `retryAfterMs` (number), `suggestedAction`.
* **And** `AbstractErrorEnvelope` / `PlatformError.toEnvelope()` chuẩn hóa shape trả về: `{ code, type, message, statusCode, isRetryable, retryAfterMs, retryAfter, suggestedAction, accountId?, platform }`.
* **And** `AbstractCrawler` tự động đăng ký action vào `ActionRegistry`, validate `category` trước khi lưu, và đảm bảo `action` là snake_case.
* **And** `GovernorStatusApi` định nghĩa shape `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.

### Story 10.2: Prisma Post & Comment Schema with Namespaced ID, JSONB GIN & Batch Chunking
As a **Backend & Platform Engineer**,
I want **mở rộng `prisma/schema.prisma` với model `Post` và `Comment` (hỗ trợ Namespaced ID `${platform}:${externalId}`, cột `metadata Json?`), đồng thời triển khai `PrismaStore`**,
So that **toàn bộ dữ liệu cào đa ngành được lưu trữ tập trung, không bị collision ID, và cho phép Nowing query lọc giá/sđt/lương nhanh bằng GIN/expression indexes**.

> **NFR:** Query lọc `metadata` phải đạt <10ms trên tập dữ liệu test 1M rows; benchmark thực hiện trong Story 10.2b (Post-Merge Benchmark) hoặc chuyên mục NFR audit.

**Acceptance Criteria:**
* **Given** file `prisma/schema.prisma` của dự án XActions
* **When** định nghĩa model `Post` (gồm `id` Namespaced, `platform`, `externalId`, `category`, `authorId`, `authorName`, `content`, `mediaUrls String[]`, `likesCount`, `repostsCount`, `repliesCount`, `viewsCount`, `metadata Json?`, `publishedAt`, `crawledAt`), `Comment` (gồm `id` Namespaced, `platform`, `externalId`, `postId`, `parentCommentId`, `depth`, `authorId`, `authorName`, `content`, `metadata Json?`, quan hệ tự tham chiếu `@relation("CommentReplies")`), và `CrawlCheckpoint` (`@@unique([platform, targetType, targetKey])`)
* **Then** migration được sinh hợp lệ, tạo ràng buộc `@@unique([platform, externalId])` trên `Post`, `@@unique([platform, externalId, postId])` trên `Comment`, GIN index trên `metadata` (raw SQL migration), và Expression Index trên `phone`/`price`/`salary`
* **And** `PrismaStore` (`src/store/prisma-store.js`) thực hiện insert bài viết và bình luận theo batch chunk 500 bản ghi; mặc định dùng `createMany` + `skipDuplicates`, hỗ trợ `upsert` qua option `{ upsert: true }`, và insert comment theo từng `depth` level để tránh self-referencing FK violation.
* **And** `CrawlCheckpoint` model có đầy đủ trường `status`, `errorCount`, `lastCrawledAt`, `nextScheduledAt`.

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

### Story 11.1: ProxyIpPool with Anti-Leak Flags, Auto-Validation & Expiry Buffer
As an **Automation Operator**,
I want **hệ thống tự động kiểm tra chất lượng proxy, ngăn chặn rò rỉ WebRTC/DNS và phát hiện proxy sắp hết hạn trước 30 giây**,
So that **request gửi đi luôn sử dụng IP sống, an toàn và không bị lộ IP gốc của máy chủ**.

**Acceptance Criteria:**
* **Given** danh sách proxy đầu vào (HTTP/HTTPS/SOCKS5)
* **When** khởi tạo `ProxyIpPool` (`src/proxy/proxy-pool.js`)
* **Then** tự động cấu hình `remote DNS resolution` và cờ browser `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
* **And** hỗ trợ hai chế độ lấy proxy:
  - `getStickyProxy(accountId)` — trả về cùng một proxy cho một tài khoản (auth-required platforms).
  - `getNext()` — round-robin trên các proxy khỏe (no-auth platforms, residential rotation).
* **And** tự động làm mới IP nếu thời gian sống còn lại dưới 30 giây (buffer window) hoặc proxy bị quarantine.

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

### Story 11.3: 429/403 Auto-Quarantine, Standby Backoff & Exponential Replay Interceptor
As a **Reliability Engineer**,
I want **hệ thống tự động cách ly proxy bị chặn và replay request với proxy mới kèm cơ chế Standby Backoff khi toàn bộ pool bị rate-limit**,
So that **toàn bộ pipeline không bao giờ bị crash khi nền tảng kích hoạt bảo vệ diện rộng**.

**Acceptance Criteria:**
* **Given** một HTTP request trả về mã trạng thái `429 Too Many Requests` hoặc `403 Forbidden`
* **When** interceptor bắt được lỗi
* **Then** proxy hiện tại bị đưa vào `failedProxies` cách ly trong 5 phút
* **And** cho no-auth platforms: rút proxy mới từ pool (`getNext()`) và retry request tối đa 3 lần với exponential backoff (1s, 2s, 4s)
* **And** cho auth-required platforms: giữ nguyên account, lấy proxy mới (`getStickyProxy(accountId)` với proxy fallback), hoặc nếu rate-limit do account thì chuyển `AccountPool.getNextAvailable(platform)` và retry với account mới
* **And** nếu toàn bộ proxy trong pool bị cách ly ➔ Chuyển sang trạng thái Standby Backoff (chờ 30s) và cảnh báo thay vì loop vô tận.

### Story 11.4: Adaptive Infrastructure-Aware Rate Limiter & Account Protection Governor
As a **Platform Governor & Account Security Engineer**,
I want **hệ thống tự động tính toán Throughput cào dựa trên số lượng Proxy sống và đưa tài khoản vào trạng thái Ngủ đông khi gặp thử thách bảo vệ**,
So that **hệ thống không bị quá tải khi Proxy xoay không kịp và triệt tiêu 100% nguy cơ die tài khoản hàng loạt**.

**Acceptance Criteria:**
* **Given** module `AdaptiveRateGovernor` trong `src/core/adaptive-governor.js`
* **When** số lượng Proxy khả dụng trong `ProxyIpPool` thay đổi hoặc tài khoản gặp cảnh báo WAF
* **Then** tự động điều chỉnh tốc độ cào toàn cục: `maxReqPerSecond = healthyProxyCount * platform.baseReqPerSecondPerProxy * platform.throttleFactor` (giảm nhịp 50% nếu proxy sống giảm 50%)
* **And** nếu Proxy sống rơi vào mức báo động (< 5 IPs) ➔ Tự động tạm dừng cào bulk, ưu tiên on-demand queries
* **And** cho auth-required platforms: mỗi tài khoản có token bucket `safeRequestsPerMinute`; tự động đưa tài khoản vào Hibernation 15–30 phút khi gặp Captcha/WAF; `AccountPool` tự động chuyển sang tài khoản tiếp theo khi account hiện tại đạt giới hạn hoặc hibernation
* **And** cho no-auth platforms: tốc độ giới hạn theo proxy/IP, không cần hibernation account; nếu IP bị ban, quarantine và rotate proxy
* **And** hãm tốc độ cào khi hàng đợi Redis Stream `stream:social:raw_posts` vượt quá 10,000 unread messages (Consumer Lag Backpressure)
* **And** cung cấp `GET /governor/status` và CLI `xactions status` trả về `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.

### Story 11.5: End-to-End Anti-Bot & Rate-Limit Defense Pipeline
As a **Reliability Engineer**,
I want **wire `AbstractApiClient`, `ProxyIpPool`, `AdaptiveRateGovernor`, `AccountPool` và `PlatformResponseValidator` thành một pipeline duy nhất, với 2 chiến lược rõ ràng: sticky IP cho tài khoản và rotating IP cho no-auth platforms**,
So that **hệ thống scrape nhanh nhất có thể mà không bị nền tảng detect bot, ban IP, hoặc die tài khoản hàng loạt**.

**Acceptance Criteria:**
* **Given** `AbstractApiClient` được khởi tạo với `proxyPool`, `governor`, `accountPool`, `sessionManager` và platform-specific `PlatformResponseValidator`
* **When** gọi `request(method, url, options)`
* **Then** hệ thống thực hiện tuần tự:
  1. Xác định `requiresAuth` của platform. Nếu `true` → lấy `accountId` từ `accountPool.getNextAvailable(platform)`; kiểm tra `governor.canAccountRequest(accountId, platform)`; nếu hibernation thì chuyển account.
  2. Nếu `requiresAuth` → `proxyPool.getStickyProxy(accountId)` (sticky IP cho tài khoản). Nếu `!requiresAuth` → `proxyPool.getNext()` (round-robin / residential rotation per request).
  3. Nếu proxy bị quarantine hoặc `isAllQuarantined()` → Standby Backoff 30s và throw `ProxyDeadError`.
  4. Gửi request qua proxy agent (`undici.ProxyAgent` / `socks-proxy-agent` / Playwright browser context tùy platform).
  5. `governor.recordRequest(accountId)` — ghi nhận request vào sliding window.
  6. `PlatformResponseValidator.isValidPayload(response)` / `isBotChallenge(response)` / `isRateLimit(response)` — parse body dù HTTP status là 200.
* **And** nếu `isRateLimit` hoặc HTTP 429/403 → throw `RateLimitError`, `proxyPool.quarantine(proxy)`, retry tối đa 3 lần với proxy mới và exponential backoff 1s, 2s, 4s.
* **And** nếu `isBotChallenge` hoặc WAF/captcha → throw `BotChallengeError`, `proxyPool.quarantine(proxy, 5 phút)`, `governor.hibernateAccount(accountId, 'bot_challenge', 15–30 phút)`, `accountPool.markUnavailable(accountId)` và chuyển sang account/proxy tiếp theo.
* **And** `AbstractCrawler.start(command)` gọi `governor.recordRequest()` và kiểm tra `governor.canAccountRequest()` / `governor.getMaxThroughput(platform)` trước mỗi action.
* **And** Auth-required platforms (Facebook, TikTok, Shopee, X, Threads, LinkedIn, TopCV, VietnamWorks) sử dụng sticky IP; no-auth platforms (Batdongsan, Chotot, v.v.) sử dụng rotating residential proxy.
* **And** không bao giờ fallback về direct connection khi proxy fail; mọi request phải qua `ProxyIpPool`.
* **And** tạo `src/core/account-pool.js`, cập nhật `src/core/platform-validator.js` với `AbstractPlatformResponseValidator` để các scraper con implement `isValidPayload`, `isBotChallenge`, `isRateLimit`.

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

---

## Epic 13: High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)

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
* **Given** Daemon MCP Server `src/mcp/server.js` lắng nghe trên cổng `http://localhost:3001/mcp`
* **When** AI Agent hoặc Nowing gọi tool `x_crawl_post`, `x_crawl_comments_tree`, `x_actions_list` qua HTTP/SSE
* **Then** response trả về JSON Envelope chuẩn: `{ success, platform, meta, data (top 20-30), summary, error? }` với độ trễ phản hồi < 2ms
* **And** nếu tổng số records > 100 ➔ Tự động lưu file dataset JSONL và trả về trường `meta.datasetArtifactPath` để AI đọc chọn lọc.
* **And** `x_actions_list` trả về `ActionDescriptor[]` với `{ action, description, requiredArgs, optionalArgs, example, outputType }`.
* **And** error envelope chuẩn hóa: `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
* **And** health check endpoint `GET /health` và CLI `xactions daemon status/start/stop`.
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

### Story 14.4: Nowing Daemon Client Cutover & Legacy Scrapers Decommissioning
As a **Lead System Architect**,
I want **nâng cấp adapter bên Nowing kết nối sang XActions Daemon HTTP/SSE (Port 3001) và gỡ bỏ toàn bộ 20+ scraper cũ trong `nowing_backend/app/proprietary/platforms/`**,
So that **Nowing backend được tinh gọn 100%, giảm kích thước Docker từ 4GB xuống <500MB và thống nhất hạ tầng cào duy nhất về XActions**.

**Acceptance Criteria:**
* **Given** repository Nowing tại `/Users/luisphan/Documents/GitHub/nowing`
* **When** XActions hoàn thành các crawler đa nền tảng (Social, Ecom, BĐS, Tuyển dụng)
* **Then** cập nhật `nowing_backend/app/proprietary/platforms/xactions/adapter.py` sử dụng HTTP Keep-Alive Connection Pool gọi sang `http://xactions-service:3001`
* **And** thực hiện kiểm thử đối soát (Shadow Run) xác nhận Nowing nhận đủ 100% dữ liệu
* **And** xóa bỏ an toàn các thư mục scraper cũ trong `nowing_backend/app/proprietary/platforms/` (`shopee/`, `chotot/`, `batdongsan/`, `topcv/`, `vietnamworks/`, `linkedin/`, v.v.)
* **And** gỡ bỏ các dependency trình duyệt nặng (`selenium`, `playwright-python`, Chromium binaries) khỏi Dockerfile của Nowing.

---

## Epic 15: Vietnam Viral Social — Threads & TikTok Scraper Engine

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

## Epic 19: Web SaaS Dashboard, Admin CLI & Operational Observability

### Story 19.1: Dashboard Jobs & Checkpoints View
As an **Operations Manager**,
I want **một dashboard view hiển thị toàn bộ jobs crawl, checkpoints, trạng thái resume/pause/failed và tiến độ last cursor/timestamp**,
So that **tôi có thể giám sát và điều khiển pipeline cào mà không cần gõ lệnh terminal**.

**Acceptance Criteria:**
* **Given** dashboard Express server (`dashboard/` hoặc route `/dashboard`)
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

### Story 19.4: Admin CLI — Governor, Proxies & Accounts
As an **Automation Operator**,
I want **một nhóm lệnh CLI `xactions admin` để xem governor status, proxy pool, hibernating accounts, và thực hiện manual override**,
So that **tôi có thể vận hành hệ thống từ terminal mà không cần mở dashboard**.

**Acceptance Criteria:**
* **Given** CLI command `xactions admin status`
* **When** chạy
* **Then** in ra `healthyProxyCount / totalProxyCount`, `currentReqPerSecond`, `redisConsumerLag`, `throttleLevel`, danh sách `hibernatingAccounts`
* **And** `xactions admin proxies list` liệt kê proxy với trạng thái `healthy` / `quarantined` / `expiryAt`
* **And** `xactions admin accounts list --platform <platform>` liệt kê account, `velocity`, `hibernatingUntil`, `assignedProxy`
* **And** `xactions admin proxy quarantine <proxyKey>` cách ly proxy thủ công
* **And** `xactions admin proxy release <proxyKey>` bỏ cách ly proxy thủ công
* **And** `xactions admin account wake <accountId>` đánh thức account từ hibernation thủ công
* **And** `xactions admin account rotate <accountId> <platform>` đổi account khác trong `AccountPool`.

### Story 19.5: Admin CLI — Checkpoints
As a **Platform Operator**,
I want **nhóm lệnh CLI `xactions checkpoints` để liệt kê, resume, pause, retry checkpoint từ terminal**,
So that **tôi có thể quản lý tiến độ cào nhanh chóng khi target bị lỗi hoặc container restart**.

**Acceptance Criteria:**
* **Given** lệnh `xactions checkpoints list --platform <platform> --status running|paused|failed|completed`
* **When** chạy
* **Then** in ra bảng checkpoints với `platform`, `targetKey`, `status`, `lastCrawledAt`, `lastCursor`, `errorCount`
* **And** `xactions checkpoints resume <id>`, `xactions checkpoints pause <id>`, `xactions checkpoints retry <id>` gọi API tương ứng và cập nhật trạng thái
* **And** yêu cầu permission `checkpoint:manage` hoặc `admin`.

### Story 19.6: Admin CLI — Stream Metrics & Alerts
As a **Reliability Engineer**,
I want **lệnh CLI `xactions stream` để xem throughput, consumer lag, và kích hoạt test alert**,
So that **tôi debug kỹ thuật nhanh mà không cần dashboard**.

**Acceptance Criteria:**
* **Given** lệnh `xactions stream metrics`
* **When** chạy
* **Then** in ra `eventsPerSecond`, `pendingMessages`, `consumerLag`, `droppedEvents`, `lastAckTime`
* **And** `xactions stream alerts` hiển thị active alerts với ngưỡng vượt
* **And** `xactions stream alert test` gửi test alert qua `ALERT_WEBHOOK` hoặc `ALERT_EMAIL`.

### Story 19.7: Admin REST API for Proxy, Account & Checkpoint Management
As a **Dashboard & CLI Developer**,
I want **các endpoint REST `/admin/*` để dashboard và CLI lấy dữ liệu + thực hiện actions vận hành**,
So that **admin surface không truy cập DB trực tiếp và sử dụng chung data source**.

**Acceptance Criteria:**
* **Given** API `/admin/proxies` (GET) trả về danh sách proxy + trạng thái
* **And** POST `/admin/proxies/:key/quarantine` và `/admin/proxies/:key/release`
* **And** GET `/admin/accounts?platform=...` trả về account + velocity + hibernation status
* **And** POST `/admin/accounts/:id/wake` và POST `/admin/accounts/:id/rotate`
* **And** GET/POST `/admin/checkpoints/...` wrap lại Story 10.4
* **And** GET `/admin/stream/metrics` và `/admin/stream/alerts`
* **And** tất cả endpoints yêu cầu `admin` permission hoặc `checkpoint:manage` (cho checkpoint-only).

### Story 19.8: Admin MCP Tools for AI Agents
As an **AI Agent Operator**,
I want **các MCP tool `x_admin_*` để AI agents có thể kiểm tra status và thực hiện vận hành cơ bản**,
So that **Claude/Cursor/Antigravity có thể hỏi "tình trạng proxy pool thế nào" hoặc "đánh thức account fb:123"**.

**Acceptance Criteria:**
* **Given** MCP daemon đang chạy
* **When** gọi `x_admin_status`
* **Then** trả về governor status, proxy health, hibernating accounts
* **And** `x_admin_proxies_list`, `x_admin_accounts_list`, `x_admin_account_wake`, `x_admin_proxy_quarantine`, `x_admin_checkpoints_list`, `x_admin_checkpoint_action` hoạt động tương tự CLI.
* **And** yêu cầu permission `admin`.
