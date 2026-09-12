# Epic 25 Context: Unified Dispatcher & Public API Finalization

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic này là epic "glue" của Phase 4 extension (Epics 23–26): biến `scrape(platform, action, args)` trong `src/scrapers/index.js` thành entry point duy nhất cho mọi caller nội bộ và bên ngoài, hoàn thiện `package.json` exports trỏ về `src/scrapers/social/`, migrate toàn bộ MCP/CLI/API caller sang `CrawlerCommand`, và đảm bảo tương thích ngược qua error mapping rõ ràng. Epic còn mang theo phạm vi mở rộng từ sprint change proposal: engine **Auto Checkpoint Lookup (ACL) + Early Termination (ET)** trong `AbstractCrawler` — tự động resume từ `CrawlCheckpoint` và dừng pagination khi toàn bộ item trong page đã tồn tại trong DB, nhằm tiết kiệm chi phí proxy và tránh re-crawl trùng lặp mỗi scheduled run.

## Stories

- Story 25.1: Universal `scrape()` Dispatcher
- Story 25.2: `package.json` Exports v2
- Story 25.3: MCP / CLI / API Caller Migration
- Story 25.4: Backward Compatibility & Error Mapping
- Story 25.5: Core Checkpoint Resume & Early Termination Engine
- Story 25.6: Checkpoint Resolvers for Top Platforms
- Story 25.7: Early Termination in Crawler Pagination Loops

## Requirements & Constraints

- `src/scrapers/index.js` trở thành thin dispatcher duy nhất qua `scrape(platform, action, args)`; không còn logic scraper nào nằm ngoài `src/scrapers/social/<platform>/` (FR-92, NFR-18).
- `package.json` exports phải giữ backward-compatible ít nhất 1 release cycle: `./scrapers` → dispatcher, `./scrapers/social` → social index, `./scrapers/<platform>` redirect sang `src/scrapers/social/<platform>/index.js`; `./scrapers/twitter/http` bị xoá hoặc redirect sang social twitter client.
- Mọi MCP tool, CLI command (`unfollowx`), và API route phải gọi `scrape()` / `CrawlerCommand` — zero legacy imports từ `src/client/Scraper.js`, `src/scrapers/twitter/`, `facebook/`, `threads/`, `bluesky/`, `mastodon/` (NFR-18).
- 100% tương thích ngược với CLI `unfollowx` và 80+ MCP tools hiện có (NFR-16): lệnh cũ được map vào `CrawlerCommand`, hoặc trả error envelope có `suggestedAction` actionable.
- Action đã bị loại bỏ hoặc tên platform cũ phải trả `PlatformError` với `type: ErrorTypes.DEPRECATED` và `suggestedAction` chỉ rõ thay thế; `docs/deprecation-plan.md` liệt kê đầy đủ mapping legacy API → new API.
- `npm test`, `npm run typecheck`, `unfollowx` smoke test, và tests E2E MCP/CLI phải pass; benchmark telemetry hiện có không được regression.
- Auto resume + Early Termination phục vụ mục tiêu 3-Tier Gap-Filling: cào delta thay vì full re-crawl, ~90% tiết kiệm proxy cost, 0% duplication (FR-88).

## Technical Decisions

- **Hexagonal / Ports & Adapters:** contracts platform-agnostic (`AbstractCrawler`, `AbstractApiClient`, `AbstractStore`) sống trong `src/core/` (zero npm deps); implementation platform-specific sống trong `src/scrapers/social/<platform>/`.
- **`CrawlerCommand` + `ActionRegistry`:** `AbstractCrawler.start({ action, args, session })` lookup registry ánh xạ action snake_case (`search`, `post_detail`, `group_posts`, `profile`, `followers`, …) sang handler. CLI/MCP chỉ gọi `crawler.start(command)`, không gọi method cụ thể.
- **Dispatcher giữ thin:** `scrape()` truyền `args` trực tiếp vào `AbstractCrawler.start()`; hỗ trợ dependency injection (`client`, `store`, `governor`, `accountPool`, `proxyPool`). `src/scrapers/social/index.js` export tất cả platform crawlers/clients/validators.
- **Auto Checkpoint Lookup (ACL) trong `AbstractCrawler.start()`, KHÔNG trong dispatcher:** `ActionDescriptor` hỗ trợ `checkpointResolver?: (args) => { targetType, targetKey, cursorField, fallbackCursorFields }`. Khi caller không truyền `cursor`/`after`/`max_id`, `start()` gọi `store.getCheckpoint(platform, targetType, targetKey)` và inject `lastCursor` vào `args` trước khi gọi handler. Caller-supplied cursor luôn được ưu tiên, không bao giờ bị ghi đè; `args.resume === false` tắt auto lookup.
- **`CrawlCheckpoint` model:** unique trên `(platform, targetType, targetKey)`, giữ `lastCursor`, `lastTimestamp`, `status`, `errorCount`, `nextScheduledAt`. `targetKey` phải stable: sorted key-value pairs, trimmed, lowercased, loại bỏ pagination params (rủi ro chính: targetKey mismatch và checkpoint stale).
- **Early Termination:** `PrismaStore.storeBatch()` trả `{ insertedCount, duplicateCount, totalCount, schemaValid }`; `AbstractStore` thêm signature `storeBatch` mới + `findExistingIds(ids)` dùng indexed `id IN (...)` query. `AbstractCrawler` expose `shouldStopPagination(items)` — crawler con break pagination loop khi cả page là duplicates. Triển khai first pass cho Facebook, Twitter, TikTok.
- **Error Envelope chuẩn:** `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`; `suggestedAction ∈ { retry_after_delay, rotate_proxy, rotate_account, hibernate_account, relogin, wait, reduce_rate, contact_support }`.
- **Checkpoint resolver coverage tối thiểu:** Facebook (`group_posts`, `page_posts`, `search`, `marketplace`); Twitter (`search`, `hashtag`, `followers`, `following`); TikTok (`search`, `hashtag_feed`); Threads (`search`, `get_user_feed`); Shopee (`search_products`); Batdongsan (`search_listings`).

## UX & Interaction Patterns

- **Action Discovery Contract:** mỗi crawler implement `listActions(): ActionDescriptor[]` với shape cố định `{ action, description, requiredArgs, optionalArgs, example, outputType, requiresAuth }` — consumer (CLI/MCP/AI agent) parse theo `requiredArgs` + `example`; không cho phép tên trường `args`/`params`/`inputs`. Surface: MCP tool `x_actions_list`, CLI `xactions actions --platform <platform>`.
- **Legacy CLI mapping:** lệnh `unfollowx` cũ (`x_get_followers`, `x_unfollow_non_followers`, …) map vào `CrawlerCommand { platform: 'twitter', action: '<mapped>' }`; lệnh không còn hỗ trợ trả error envelope với `suggestedAction: 'use_x_actions_list'`.

## Cross-Story Dependencies

- **Epic 25 phụ thuộc:** Epic 23 (Bluesky/Mastodon crawlers), Epic 24 (utility scripts & adapters audit/consolidation), và Phase 4 integration stories 13.2.12 (Twitter hybrid caller migration), 13.10 (Facebook hybrid caller migration), 15.1.4 (Threads package exports) — dispatcher chỉ unify được khi các platform đã nằm trong `src/scrapers/social/`.
- **Epic 26 (Legacy Decommission Final) phụ thuộc Epic 25:** xoá legacy modules chỉ sau khi dispatcher + exports v2 ổn định và shadow-run parity ≥ 99% trong 7 ngày.
- **Trong epic:** 25.1 (dispatcher) là nền cho 25.2–25.4; 25.5 (core ACL/ET engine trong `AbstractCrawler` + `PrismaStore`) là nền cho 25.6 (per-platform resolvers) và 25.7 (ET trong pagination loops). Stories 25.5–25.7 được thêm bởi sprint change proposal checkpoint-resume — không conflict với AD-10/AD-12/AD-16, chỉ cần cập nhật AD-11 (`ActionDescriptor` + `checkpointResolver`).
