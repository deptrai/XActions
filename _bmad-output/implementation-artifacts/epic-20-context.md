# Epic 20 Context: Multi-Consumer Scraping Platform Service Contract

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Expose `scrape()` dispatcher (Epic 25) thành service-to-service contract cho multi-consumer (Nowing, ChainLens, AI agents). Control plane qua MCP `x_scrape` tool, data plane qua Redis Stream `stream:social:raw_posts` (snake_case ThinEvent), discovery qua `x_actions_list`. Nowing đã wire phía mình nhưng bị block bởi 4 gaps trong XActions (REQ-X1..X4).

## Stories

- Story 20.1: Multi-Consumer Service Contract (x_scrape + x_actions_list + Action Matrix)
- Story 20.2: Universal Stream-Publish Hook (snake_case ThinEvent + mapToThinEvent)
- Story 20.3: [EXTERNAL — Nowing repo] Shadow-Run Validation
- Story 20.4: [EXTERNAL — Nowing repo] Legacy Decommissioning

## Requirements & Constraints

- `x_scrape` nhận: platform, action, args (nested object), context (Record<string, unknown> mở), accountId, proxyUrl, dryRun (default false), artifactFormat
- `x_scrape` trả unified envelope: `{ success, mode: 'stream'|'direct', metadata, stream: {enabled, name, cursor}, preview: [...≤10], data: [...] }`
- `dryRun=true` → KHÔNG emit stream events
- Pre-validate requiredArgs → trả `XACT_4002` + `missing[]` + `example`
- "Did You Mean?" suggestion khi action không tồn tại
- `x_actions_list` enumerate toàn bộ 24 platform descriptors; platform chưa có crawler → flag `"no_crawler": true`, không silent-skip
- Lọc bỏ `checkpointResolver` khỏi `ActionDescriptor` trước khi trả (function ref, không serialize)
- Filter theo `category` + `detailLevel: 'summary'|'full'`
- `b2b-registry-extended` dùng `index.js` không phải `crawler.js` — loader cần xử lý
- `envelope.js` `extractRecords()` thêm `'listings'`, `'products'`, `'jobs'` vào key list
- Canonical matrix doc auto-generated qua `npm run docs:matrix` → `.md` + `.json`

## Technical Decisions

- `scrape()` dispatcher signature: `scrape(platform, action, options)` — `options` là flat object chứa cả action args và execution opts
- `x_scrape` phân tách: `args` (nested) chứa action args; top-level chứa execution opts (accountId, proxyUrl, dryRun, artifactFormat, context)
- `context` envelope forward vào `CrawlerCommand` → stream events (multi-tenant: targetId, workspaceId, traceId...)
- Response shape: khi `REDIS_STREAM_ENABLED=true` → `mode='stream'`, preview ≤10 items, cursor = `result.__streamCursor` (lastEventId từ Redis xAdd)
- Khi `REDIS_STREAM_ENABLED=false` → `mode='direct'`, data = full result
- `workspaceId` missing khi stream enabled → WARN log `[StreamPublisher:MissingWorkspaceId]`
- `extractRecords()` hiện chỉ nhận `comments/posts/items/data` — phải thêm `listings`, `products`, `jobs` cho VN crawlers
- Platform registry: 24 descriptors trong `src/scrapers/index.js` DESCRIPTORS map
- `actions-list.js` hiện hardcode 18 crawler loaders — thiếu fnb, healthcare, legal, automotive, b2b-registry-extended, tiktokShop

## Cross-Story Dependencies

- Story 20.1 và 20.2 **BẮT BUỘC atomic release** — nếu 20.1 release trước 20.2, `x_scrape` trả preview rỗng cho platforms chưa có stream hook (data loss âm thầm)
- Story 20.2 phụ thuộc `redis-stream-publisher.js` `formatPayload()` — hiện hardcode camelCase whitelist, phải sửa sang snake_case + `content_snippet`/`target_id`/`workspace_id`/`schema_version`
- Story 20.2 phụ thuộc `AbstractCrawler.start()` — hook đặt sau `entry.handler()`, KHÔNG phải sau `storeBatch` (AbstractCrawler không có `storeBatch`)
