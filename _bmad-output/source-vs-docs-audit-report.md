# Báo Cáo Audit Đối Chiếu Source Code và Tài Liệu Canonical — XActions Hybrid Scraping Spine

**Ngày thực hiện:** 2026-09-01  
**Kho lưu trữ:** `/Users/luisphan/Documents/GitHub/XActions`  
**Nhánh Git:** `develop`  
**Git Commit ID:** `745db53726a045fd6c4dea6a97eb0bac6f0cfeac`

---

## 1. Executive Summary

### 1.1. Phạm vi kiểm toán
Đợt kiểm toán read-only toàn diện đối chiếu source code XActions với 5 tài liệu canonical:

1. **PRD:** `_bmad-output/planning-artifacts/prd.md` (Epics 10–20, 23–26)
2. **Epics Breakdown:** `_bmad-output/planning-artifacts/epics.md`
3. **Architecture Spine:** `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (21 AD)
4. **UX / Design:** `_bmad-output/planning-artifacts/ux/DESIGN.md` + `EXPERIENCE-UNIVERSAL-2026-08-21.md`
5. **Readiness Report gần nhất:** `_bmad-output/planning-artifacts/implementation-readiness-report-2026-08-26-r5.md`

### 1.2. Tổng quan
- Dự án đã hoàn thành xuất sắc lớp nền tảng kiến trúc Hexagonal (`src/core/`), Proxy Pool, Adaptive Rate Governor, PostgreSQL/Prisma schema với Namespaced IDs, GIN indexes, comment tree, và gần như toàn bộ 10 hybrid crawler adapters cho 4 domain (Social, E-com, Real Estate, Recruitment).
- Epic 19 (Operator Dashboard) đã hoàn thành dashboard UI 19.1–19.3; admin CLI 19.4.1–19.4.5 và REST API mở rộng 19.7–19.10 còn backlog.
- Epic 20, 23, 24, 25, 26 vẫn trong backlog theo roadmap.

---

## 2. Architecture Compliance Matrix (AD-1 đến AD-21)

| AD | Source files kỳ vọng | Source files thực tế | Trạng thái | Bằng chứng & Ghi chú |
|---|---|---|---|---|
| **AD-1 — Tiered Hybrid Signer Engine** | `src/core/signer-pool.js` | `src/core/signer-pool.js` | **FULLY_IMPLEMENTED** | `PreSignedTokenRing` (capacity 50, round-robin O(1)) và `SignerWorkerPagePool` (min 4, max 8, timeout 3000ms mặc định / 8000ms warmup) tại `src/core/signer-pool.js:19-120`. |
| **AD-2 — Unified Base Scraper & Client Interfaces** | `src/core/base-crawler.js`, `base-client.js`, `base-store.js`, `base-login.js` | `src/core/base-crawler.js`, `base-client.js`, `base-store.js`, `base-login.js` | **FULLY_IMPLEMENTED** | `AbstractCrawler` đăng ký action snake_case, `listActions()`, `start()` tính `actionRequiresAuth` và resolve account/proxy/governor tại `src/core/base-crawler.js:72-253`. `AbstractApiClient` tại `src/core/base-client.js:43-...` bọc proxy/retry/hibernation. `AbstractStore` đơn giản hóa tại `src/core/base-store.js`. `src/client/` vẫn tồn tại là legacy theo AD-2 rule 3. |
| **AD-3 — Centralized Proxy IP Pool with Quarantine, Anti-Leak & Proxy Strategy by Auth Mode** | `src/proxy/proxy-pool.js`, `src/proxy/providers.js` | `src/proxy/proxy-pool.js`, `src/proxy/providers.js` | **FULLY_IMPLEMENTED** | `ProxyIpPool` hỗ trợ `getStickyProxy(accountId)`, `getNext()`, quarantine 5 phút, release, `antiLeakFlags = ['remote-dns', 'disable-non-proxied-udp']` tại `src/proxy/proxy-pool.js:14-477`. `formatProxyUrl`, `normalizeProxy`, `getProxyAgent` tại `src/proxy/providers.js`. |
| **AD-4 — Namespaced PostgreSQL Storage & JSONB GIN Indexing** | `prisma/schema.prisma`, `prisma/migrations/...`, `src/store/prisma-store.js` | `prisma/schema.prisma`, `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql`, `src/store/prisma-store.js` | **FULLY_IMPLEMENTED** | `Post.id`, `Comment.id` namespaced `${platform}:${externalId}` và `${platform}:${postExternalId}:${commentExternalId}`; `@@unique([platform, externalId])`, `@@unique([platform, externalId, postId])`; `metadata Json?`; GIN/expression indexes raw migration tại `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql:1-9`. |
| **AD-5 — Non-Invasive Authentication via Terminal QR & CDP Attach** | `src/core/base-login.js`, `src/utils/qrcode.js`, `src/core/cdp-launcher.js`, `src/core/session-manager.js` | `src/core/base-login.js` (contract), `src/utils/qrcode.js`, `src/core/cdp-launcher.js`, `src/core/session-manager.js` | **PARTIALLY_IMPLEMENTED** | `src/utils/qrcode.js` có `renderTerminalQr`, `isTty` nhưng thiếu countdown 60s, polling cookie, non-TTY URL fallback, `--qr-url`, `--push` theo AD-15. `cdp-launcher.js` implement CDP attach nhưng Gaussian jitter chỉ kích hoạt trong `AbstractCrawler.delayWithJitter()` tại `base-crawler.js:279`. `base-login.js` chỉ là skeleton. |
| **AD-6 — Hierarchical Comment Tree Normalization & Topological Insertion** | `src/scrapers/social/comment-tree.js`, `src/store/prisma-store.js` | `src/scrapers/social/comment-tree.js`, `src/store/prisma-store.js` | **FULLY_IMPLEMENTED** | `Comment.depth` trong `prisma/schema.prisma:367`; `topologicalSortByDepth` / `validateNoCycle` tại `src/scrapers/social/comment-tree.js`. `PrismaStore` lưu theo depth tại `src/store/prisma-store.js`. |
| **AD-7 — Dual-Channel Microservice Protocol for Nowing** | `src/mcp/server.js`, `src/streaming/event-stream.js`, `src/streaming/redis-client.js` | `src/mcp/server.js`, `src/streaming/event-stream.js` | **FULLY_IMPLEMENTED** | MCP HTTP/SSE transport `startHttpTransport()` tại `src/mcp/server.js:5303-5400` lắng nghe port 3001 `/mcp`. Redis Stream `stream:social:raw_posts` tại `src/streaming/event-stream.js`. MAXLEN có thể cấu hình. `CrawlCheckpoint` ghi trước khi phát event. |
| **AD-8 — Multi-Domain Expansion Blueprint** | `src/scrapers/**` | `src/scrapers/social/{twitter,facebook,threads,tiktok}`, `src/scrapers/ecom/{shopee,tiktok-shop}`, `src/scrapers/realestate/{chotot,batdongsan}`, `src/scrapers/recruitment/{topcv,vietnamworks,linkedin}` | **FULLY_IMPLEMENTED** | 10 crawler adapters triển khai đúng cấu trúc domain. Bluesky/Mastodon vẫn ở `src/scrapers/bluesky/` và `src/scrapers/mastodon/` dạng cũ (Epic 23 backlog). |
| **AD-9 — Anti-Bot Payload Validation & Data Sanitization** | `src/scrapers/**/validator.js`, `src/utils/exporter.js` | `src/scrapers/social/{twitter,facebook,threads,tiktok}/validator.js`, `src/scrapers/realestate/chotot/`, `src/utils/exporter.js` | **FULLY_IMPLEMENTED** | Mỗi platform có `validator.js` với `isValidPayload`, `isBotChallenge`, `isRateLimit`. Chợ Tốt lọc SĐT `***`. `src/utils/exporter.js` sanitize `\r\n` trong `content` trước khi ghi JSONL. |
| **AD-10 — 3-Tier Incremental Gap-Filling & Retention** | `src/store/checkpoint-manager.js`, `src/mcp/**`, `src/scrapers/**` | `src/store/checkpoint-manager.js`, `prisma/schema.prisma` | **PARTIALLY_IMPLEMENTED** | `CrawlCheckpoint` có `lastCursor`, `lastTimestamp`, `status`, `errorCount`, `nextScheduledAt` tại `prisma/schema.prisma:389-407`. `src/store/checkpoint-manager.js` quản lý pause/resume/retry. Retention 30 ngày chưa thấy background job cụ thể. |
| **AD-11 — CrawlerCommand & ActionRegistry** | `src/core/base-crawler.js`, `src/core/action-registry.js` | `src/core/base-crawler.js`, `src/core/action-registry.js` | **FULLY_IMPLEMENTED** | `AbstractCrawler` sử dụng private `#registry`; `ActionDescriptor` có `requiresAuth` resolved; `globalActionRegistry` tại `src/core/action-registry.js`. |
| **AD-12 — CrawlCheckpoint State for Idempotent Resume** | `prisma/schema.prisma`, `src/store/checkpoint-manager.js`, `src/scrapers/**` | `prisma/schema.prisma`, `src/store/checkpoint-manager.js` | **FULLY_IMPLEMENTED** | `CrawlCheckpoint` với `@@unique([platform, targetType, targetKey])`, `status` enum, CRUD/resume/pause/retry tại `src/store/checkpoint-manager.js` và `api/routes/checkpoints.js`. |
| **AD-13 — Adaptive Infrastructure-Aware Dynamic Rate Limiting & Account Protection Governor** | `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js` | `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js` | **FULLY_IMPLEMENTED** | `AdaptiveRateGovernor` tính `maxReqPerSecond` theo healthy proxy, platform limits, Redis consumer lag, hibernation 15–30 phút, account rotation tại `src/core/adaptive-governor.js`. `AccountPool` quản lý velocity/hibernation/rotation tại `src/core/account-pool.js`. |
| **AD-14 — Operational Status & Error Envelope for Consumers** | `src/core/error-envelope.js`, `src/core/status-api.js`, `src/mcp/**`, `src/api/**`, `src/cli/**` | `src/core/error-envelope.js`, `src/core/status-api.js`, `src/mcp/server.js`, `api/routes/governor.js` | **FULLY_IMPLEMENTED** | `PlatformError` envelope chuẩn `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }` tại `src/core/error-envelope.js:1-120`. `GET /governor/status` tại `api/routes/governor.js`. `x_actions_list` và `x_crawl_*` tại `src/mcp/server.js:2649-2693`. Legacy CLI `unfollowx` mapping còn giữ. |
| **AD-15 — Terminal QR Login with Non-TTY Fallback & Clear Auth Feedback** | `src/core/base-login.js`, `src/utils/qrcode.js`, `src/cli/login.js` | `src/core/base-login.js`, `src/utils/qrcode.js`, `src/cli/commands/login.js` | **PARTIALLY_IMPLEMENTED** | `src/utils/qrcode.js` có ASCII QR (`qrcode-terminal`) nhưng thiếu countdown 60s, timeout 120s, non-TTY URL fallback, `--qr-url`, `--push` theo spec. `login.js` CLI chưa có các flags này. |
| **AD-16 — CrawlCheckpoint Operational API** | `src/store/checkpoint-manager.js`, `src/api/**`, `src/cli/**`, `prisma/schema.prisma` | `src/store/checkpoint-manager.js`, `api/routes/checkpoints.js`, `src/cli/commands/checkpoints.js` | **FULLY_IMPLEMENTED** | `GET /checkpoints`, `GET /checkpoints/:id`, `POST /checkpoints/:id/resume|pause|retry` tại `api/routes/checkpoints.js`. CLI `xactions checkpoints list/show/resume/pause/retry` tại `src/cli/commands/checkpoints.js`. Status values `running|paused|failed|completed|stalled` tại `prisma/schema.prisma:394`. |
| **AD-17 — Redis Stream Metrics & Backpressure Observability** | `src/utils/stream-metrics*.js`, `src/utils/stream-alerts.js`, `api/routes/streams.js` | `src/utils/stream-metrics.js`, `src/utils/stream-metrics-collector.js`, `src/utils/stream-alerts.js`, `api/routes/streams.js` | **FULLY_IMPLEMENTED** | `GET /metrics/stream` tại `api/routes/streams.js`; `StreamMetricsCollector` tại `src/utils/stream-metrics-collector.js`; alert thresholds 50.000 / 60s tại `src/utils/stream-alerts.js`. |
| **AD-18 — Metadata Schema Contract for Consumers** | `src/core/metadata-schema-registry.js`, `src/api/schemas.js`, `src/store/prisma-store.js`, `schemas/**` | `src/core/metadata-schema-registry.js`, `api/routes/schemas.js`, `src/store/prisma-store.js`, `schemas/**` | **FULLY_IMPLEMENTED** | Registry tại `src/core/metadata-schema-registry.js`; API `GET /schemas`, `GET /schemas/:platform/:category` tại `api/routes/schemas.js`; 9 pilot schemas tại `schemas/{twitter,facebook,threads,tiktok,shopee,tiktokshop,realestate,recruitment}/*.json`. |
| **AD-19 — Internal Operator Dashboard, Admin CLI & MCP Surface** | `dashboard/admin.html`, `api/routes/admin.js`, `src/cli/commands/admin.js`, `src/mcp/server.js` | `dashboard/admin.html`, `api/routes/admin.js`, `src/cli/commands/admin.js` | **PARTIALLY_IMPLEMENTED** | Dashboard UI 19.1–19.3 hoàn thành (`dashboard/admin.html`), admin REST routes 19.2/19.3 tại `api/routes/admin.js`. CLI `admin` chỉ có `stream metrics/alerts` (`src/cli/commands/admin.js:24-125`) — thiếu `status`, `proxies`, `accounts`, `checkpoints` (19.4.1–19.4.5). MCP `x_admin_*` chưa tìm thấy trong `src/mcp/server.js`. |
| **AD-20 — Dual-Pool Resource Isolation & Multi-Consumer Quota** | `src/core/adaptive-governor.js`, `src/mcp/**`, `src/proxy/proxy-pool.js` | `src/core/adaptive-governor.js`, `src/proxy/proxy-pool.js` | **PARTIALLY_IMPLEMENTED / DIVERGENT** | Không tìm thấy phân chia 30% Realtime / 70% Bulk Pool hay quota theo header `X-Consumer-Id` trong `AdaptiveRateGovernor` hay `ProxyIpPool`. Đây là divergence nghiêm trọng so với AD-20. |
| **AD-21 — HTTP-Only Public API Platform Pattern (Bluesky & Mastodon)** | `src/scrapers/social/bluesky/`, `src/scrapers/social/mastodon/`, `src/core/base-client.js` | `src/scrapers/bluesky/`, `src/scrapers/mastodon/`, `src/core/base-client.js` | **NOT_FOUND / BACKLOG** | Bluesky/Mastodon hiện nằm ở `src/scrapers/bluesky/` và `src/scrapers/mastodon/` dạng cũ, chưa chuyển sang `src/scrapers/social/` kế thừa `AbstractCrawler`/`AbstractApiClient` theo AD-21. Thuộc Epic 23 backlog. |

---

## 3. Epic / Story Implementation Status (Epics 10–26)

| Epic | Trạng thái | Key Source Files | Ghi chú & Divergence |
|---|---|---|---|
| **Epic 10: Data & Platform Foundation** | **DONE** | `src/core/*`, `prisma/schema.prisma`, `src/store/prisma-store.js`, `src/utils/exporter.js`, `src/core/metadata-schema-registry.js` | 10.1–10.5 hoàn thành. Schema, GIN indexes, batch store, metadata schema registry đều có. |
| **Epic 11: Resilient Network & Proxy Pool** | **DONE** | `src/proxy/proxy-pool.js`, `src/proxy/providers.js`, `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/core/base-client.js` | 11.1–11.8 hoàn thành. Proxy pool, providers (SOCKS5, `undici`/`got`), governor, account pool, retry/hibernation pipeline đều implement. |
| **Epic 12: Frictionless Authentication** | **PARTIAL** | `src/utils/qrcode.js`, `src/core/cdp-launcher.js`, `src/core/base-login.js` | QR module cơ bản có nhưng thiếu countdown, non-TTY fallback, CLI flags `--qr-url`/`--push` theo AD-15. CDP attach có. |
| **Epic 13: High-Throughput Hybrid Scraping (Twitter & Facebook)** | **DONE** | `src/scrapers/social/twitter/`, `src/scrapers/social/facebook/`, `src/core/signer-pool.js` | Hybrid crawlers, signer bridge, action registry, validators hoàn thành. |
| **Epic 14: Deep Conversation, MCP Daemon & Nowing Stream** | **DONE** | `src/scrapers/social/comment-tree.js`, `src/mcp/server.js`, `src/streaming/event-stream.js` | Comment tree topological sort, Redis thin events, MCP HTTP/SSE daemon hoàn thành. |
| **Epic 15: Threads & TikTok** | **DONE** | `src/scrapers/social/threads/`, `src/scrapers/social/tiktok/` | Threads DocID/GQL, TikTok signer bridge (`a_bogus`/`msToken`), crawlers hoàn thành. |
| **Epic 16: Shopee & TikTok Shop** | **DONE** | `src/scrapers/ecom/shopee/`, `src/scrapers/ecom/tiktok-shop/` | Hoàn thành. |
| **Epic 17: Chợ Tốt & Batdongsan** | **DONE** | `src/scrapers/realestate/chotot/`, `src/scrapers/realestate/batdongsan/` | Hoàn thành, bao gồm lọc SĐT masked. |
| **Epic 18: TopCV, VietnamWorks & LinkedIn** | **DONE** | `src/scrapers/recruitment/topcv/`, `src/scrapers/recruitment/vietnamworks/`, `src/scrapers/recruitment/linkedin/` | Hoàn thành. LinkedIn qua CDP attach. |
| **Epic 19: Operator Dashboard, Admin CLI & Observability** | **IN-PROGRESS** | `dashboard/admin.html`, `api/routes/admin.js`, `src/utils/stream-alerts.js`, `src/cli/commands/admin.js` | Dashboard 19.1–19.3 done; REST routes cơ bản done. CLI `admin` thiếu 19.4.1–19.4.4 (status, proxies, accounts, checkpoints), MCP `x_admin_*` chưa có. |
| **Epic 20: Nowing Cutover & Legacy Decommission** | **BACKLOG** | `src/client/`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/` | Legacy code vẫn giữ song song. Shadow run chưa thực hiện. |
| **Epics 21–22** | **FUTURE_WORK** | `backlog-epics-21-22.md` | Không thuộc scope hiện tại. |
| **Epic 23: Bluesky & Mastodon on AbstractCrawler** | **BACKLOG** | `src/scrapers/bluesky/`, `src/scrapers/mastodon/` | Chưa refactor theo `AbstractCrawler`/`AbstractApiClient`. |
| **Epic 24: Utility Scripts & Adapters Migration** | **BACKLOG** | `src/automation/`, `src/scrapers/adapters/` | Standalone browser scripts chưa quy hoạch vào Action Registry. |
| **Epic 25: Unified Dispatcher & Public API Finalization** | **BACKLOG** | `src/scrapers/index.js`, `package.json` | `package.json` exports có subpaths nhưng chưa hoàn thiện unified dispatcher. |
| **Epic 26: Legacy Decommission Final** | **BACKLOG** | `src/client/`, `src/scrapers/twitter/`, `src/scrapers/facebook/` | Chờ Epic 20. |

---

## 4. UX / Dashboard Compliance

- **Theme:** `dashboard/admin.html` tuân thủ dark mode, monospace badges, metric cards, canvas charts không phụ thuộc CDN bên ngoài.
- **Tab Checkpoints (19.1):** Hiển thị bảng checkpoints với platform, targetType, status, lastCrawledAt, lastCursor, errorCount; actions pause/resume/retry tương tác với `CheckpointManager`.
- **Tab Proxies & Accounts (19.2):** Hiển thị healthy/total proxies, req/s, consumer lag, throttle level; danh sách hibernating accounts với remaining time/reason; buttons quarantine/release proxy, wake/rotate account.
- **Tab Stream Metrics & Alerts (19.3):** events/sec, pending messages, consumer lag, dropped events, last ACK time; alert config panel; test alert.
- **UX Divergence:** Dashboard cập nhật bằng polling 5s–30s thay vì SSE (AD-19 rule 4 yêu cầu SSE/polling; hiện tại chỉ polling). Thiếu panel cấu hình dual-pool quota theo AD-20.

---

## 5. Data Model / Prisma Compliance

- **Namespaced IDs:**
  - `Post.id = "${platform}:${externalId}"` (`prisma/schema.prisma:329`)
  - `Comment.id = "${platform}:${postExternalId}:${commentExternalId}"` (`prisma/schema.prisma:362`)
  - `CrawlCheckpoint` có `@@unique([platform, targetType, targetKey])` (`prisma/schema.prisma:404`)
- **GIN / Expression Indexes:** raw migration `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql:4-9` tạo `idx_post_metadata_gin`, `idx_comment_metadata_gin`, `idx_post_metadata_price`, `idx_post_metadata_phone`, `idx_post_metadata_salary`.
- **Comment Tree:** `Comment.parentCommentId`, `depth` (`prisma/schema.prisma:366-367`), self-relation `CommentReplies` (`prisma/schema.prisma:380-381`), `onDelete: SetNull` cho parent.
- **Metadata validation:** `src/store/prisma-store.js` và `src/core/metadata-schema-registry.js` validate metadata trước khi ghi.

---

## 6. Testing Coverage vs Docs

- Framework: **Vitest 4.x** (`vitest.config.js`), 255 test files.
- Phân bổ:
  - `tests/core/`: base-crawler, base-client, signer-pool, adaptive-governor, error-envelope, metadata-schema-registry.
  - `tests/proxy/`: proxy-pool, providers, sticky hash, quarantine.
  - `tests/store/`: prisma-store, batch, schema validation.
  - `tests/scrapers/`: twitter, facebook, threads, tiktok, shopee, tiktok-shop, chotot, batdongsan, topcv, vietnamworks, linkedin.
  - `tests/streaming/`: event-stream, stream-alerts.
  - `tests/api/`: admin-routes.
  - `tests/dashboard/`: admin-checkpoints, admin-proxies-accounts, admin-stream-metrics (21/21 passed).
- Divergence: E2E Playwright tests `tests/e2e/admin-*.e2e.test.js` thiếu `@playwright/test` dependency, chưa chạy được. Một số AD chưa có test trực tiếp (AD-20 dual-pool, AD-15 QR countdown).

---

## 7. Top 10 Divergences (Xếp theo mức độ nghiêm trọng)

1. **[HIGH] AD-20 — Thiếu Dual-Pool Resource Isolation (30% Realtime / 70% Bulk):**
   Không có cơ chế phân chia proxy/signer pool cho realtime MCP/API vs bulk crawl. `ProxyIpPool` và `AdaptiveRateGovernor` quản lý 1 pool duy nhất.

2. **[HIGH] AD-20 — Thiếu Multi-Consumer Quota (`X-Consumer-Id`):**
   `AdaptiveRateGovernor` chỉ rate limit theo `platform` và `accountId`, không có quota riêng cho Nowing/ChainLens consumer.

3. **[MEDIUM] Epic 19 — Admin CLI incomplete (19.4.1–19.4.5):**
   `src/cli/commands/admin.js` chỉ có `stream metrics/alerts`. Thiếu `admin status`, `admin proxies`, `admin accounts`, `admin checkpoints`.

4. **[MEDIUM] Epic 19 — Admin REST API chưa đầy đủ 19.7–19.10:**
   `api/routes/admin.js` có `/proxies`, `/accounts`, `/stream/metrics`, `/stream/alerts`, `/governor/status`, licenses nhưng thiếu `/admin/checkpoints/*` CRUD đầy đủ và admin MCP tools `x_admin_*`.

5. **[MEDIUM] AD-15 — Terminal QR Login thiếu chi tiết:**
   `src/utils/qrcode.js` chưa có countdown 60s, timeout 120s, non-TTY URL fallback, và CLI flags `--qr-url`/`--push`.

6. **[MEDIUM] Tồn tại song song scraper cũ và mới:**
   `src/client/`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/` legacy còn tồn tại cùng `src/scrapers/social/*`. Cần Epic 20/26 để dọn.

7. **[LOW] Epic 23 — Bluesky & Mastodon chưa theo AbstractCrawler:**
   Nằm ở `src/scrapers/bluesky/` và `src/scrapers/mastodon/` dạng cũ, chưa chuyển sang `AbstractCrawler` + `AbstractApiClient` theo AD-21.

8. **[LOW] Epic 24 — Browser automation scripts chưa quy hoạch:**
   `src/automation/` và nhiều file `src/*.js` chạy console paste chưa bọc thành `CrawlerCommand` actions.

9. **[LOW] Dashboard real-time dùng polling thay vì SSE:**
   `dashboard/admin.html` poll 5s–10s; backend chưa expose SSE endpoint `/admin/events` theo AD-19 rule 4.

10. **[LOW] AD-10 — Data retention 30 ngày chưa có background job:**
    Schema `Post`/`Comment` có `crawledAt` nhưng chưa thấy cron/job dọn dữ liệu >30 ngày.

---

## 8. Recommendations

1. **Hoàn thiện Epic 19 (Admin CLI & REST API):**
   - Bổ sung `xactions admin status/proxies/accounts/checkpoints` trong `src/cli/commands/admin.js`.
   - Bổ sung `/admin/checkpoints` CRUD trong `api/routes/admin.js`.
   - Thêm `x_admin_*` MCP tools trong `src/mcp/server.js`.

2. **Hiện thực AD-20 (Resource Isolation & Quota):**
   - Tách `ProxyIpPool` thành `realtimePool` (30%) và `bulkPool` (70%) với logic yield.
   - Thêm middleware đọc `X-Consumer-Id` và quota per consumer trong `AdaptiveRateGovernor`.

3. **Củng cố AD-15 (Terminal QR Login):**
   - Bổ sung countdown, timeout, non-TTY URL fallback, `--qr-url`, `--push`, terminal width adaptation.

4. **Chuẩn bị Epic 20/26 (Nowing Shadow Run & Legacy Decommission):**
   - Thiết lập shadow-run parity checker.
   - Sau 7 ngày ≥99% parity, xoá `src/client/`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/`.

5. **Lên lịch Epic 23, 24, 25:**
   - Refactor Bluesky/Mastodon sang `src/scrapers/social/bluesky/` và `src/scrapers/social/mastodon/`.
   - Bọc browser scripts thành `CrawlerCommand` actions.
   - Hoàn thiện `package.json` subpath exports v2.
