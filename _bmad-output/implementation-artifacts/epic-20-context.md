# Epic 20 Context: Multi-Consumer Scraping Platform Service Contract

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Expose `scrape()` dispatcher (Epic 25) thành service-to-service contract cho multi-consumer (Nowing, ChainLens, AI agents, trading bots). Control plane qua MCP `x_scrape`, data plane qua Redis Stream `stream:social:raw_posts` (snake_case ThinEvent), discovery qua `x_actions_list`. Epic cũng mở rộng sang các nền tảng social-native mới (pump.fun) để consumer ingest tín hiệu social real-time.

## Stories

- Story 20.1: Multi-Consumer Service Contract (x_scrape + x_actions_list + Action Matrix)
- Story 20.2: Universal Stream-Publish Hook (snake_case ThinEvent + mapToThinEvent)
- Story 20.3: [EXTERNAL — Nowing repo] Shadow-Run Validation
- Story 20.4: [EXTERNAL — Nowing repo] Legacy Decommissioning
- Story 20.5: PumpFun Native Social Crawler (theses, comments, top holders, KOL activity, livestream)

## Requirements & Constraints

- `x_scrape` nhận: platform, action, args (nested object), context (Record mở), accountId, proxyUrl, dryRun (default false), artifactFormat; trả unified envelope `{ success, mode: 'stream'|'direct', metadata, stream: {enabled, name, cursor}, preview: [...≤10], data: [...] }`. `dryRun=true` → KHÔNG emit stream events.
- `x_actions_list` enumerate toàn bộ platform descriptors; platform chưa có crawler → flag `"no_crawler": true`, không silent-skip; lọc bỏ `checkpointResolver` khỏi descriptor trước khi trả.
- Mọi platform/crawler mới phải kế thừa `AbstractCrawler` + `AbstractApiClient`, đăng ký action vào `globalActionRegistry` (snake_case action, category hợp lệ), và đi qua `CrawlerCommand`/`scrape(platform, action, options)` dispatcher thống nhất.
- Rate limit & resilience: sticky proxy per logical target, auto-quarantine proxy khi HTTP 429/403, exponential backoff với jitter, replay tối đa 3 lần; `DistributedTokenBucket` cho quota phân tán (Redis atomic Lua, fallback in-memory).
- Anti-bot: khi HTTP client dính Cloudflare TLS fingerprint block (HTTP 403) → fallback `createCurlTransport(platform)`; khi HTTP 200 nhưng body rỗng → `JevChallengeDiagnoser` xác minh silent block/captcha trước khi trả dữ liệu rỗng.
- NFR: tối ưu latency (mục tiêu <300ms round-trip cho single-target social fetch), giảm RAM/CPU so với headless browser, unauthenticated HTTP/2 REST ưu tiên hơn browser automation.
- Pump.fun social: unauthenticated REST `frontend-api-v3.pump.fun`; in-flight request deduplication; KOL matching qua cache 2 tầng (Redis TTL + file seed `config/kol-wallets-seed.json`); livestream status qua background poller (in-memory set, 0ms per-request latency); Phase 1 không duy trì WebSocket chat.

## Technical Decisions

- `scrape()` dispatcher: thin data-driven qua per-platform `descriptor.js` (`aliases`, `actionMap`/`mapAction`, `mapArgs`, `createClient`, `createCrawler`, optional `createSession`/`dispatch`); mọi descriptor import tập trung ở `src/scrapers/index.js` DESCRIPTORS map.
- `x_scrape` tách: `args` (nested) chứa action args; top-level chứa execution opts (accountId, proxyUrl, dryRun, artifactFormat, context). `context` forward vào `CrawlerCommand` → stream events (targetId, workspaceId, traceId).
- Response shape: `REDIS_STREAM_ENABLED=true` → `mode='stream'`, preview ≤10, `cursor = result.__streamCursor`; false → `mode='direct'`, data = full result. `workspaceId` missing → WARN `[StreamPublisher:MissingWorkspaceId]`.
- Stream-publish hook (Story 20.2) nằm trong `AbstractCrawler.start()` sau `entry.handler()`; `mapToThinEvent(item, context)` normalize snake_case `ThinEvent` + dual-emit camelCase; `formatPayload()` map `content_snippet`/`target_id`/`workspace_id`/`schema_version`.
- Action discovery: `src/scrapers/social/actions-list.js` giữ `CANONICAL_PLATFORMS`, `PLATFORM_CATEGORIES`, và `crawlerLoaders` (lazy `import().then(new …Crawler())`) — platform mới phải đăng ký cả 3 chỗ + descriptor trong `src/scrapers/index.js`.
- `extractRecords()` (`envelope.js`) nhận `comments/posts/items/data/listings/products/jobs`.
- `AbstractApiClient` cung cấp: request pipeline, 429/403 auto-quarantine, exponential backoff, account rotation, proxy pool integration (`getStickyProxy`), transport override (`curl`), `skipResponseValidation`/`raw` options.
- `ProxyIpPool` (`src/proxy/proxy-pool.js`): `getStickyProxy(accountId, requiresResidential, options)`, `quarantine(proxy, durationMs)`, `getProxy({pool:'realtime'|'bulk'})`.
- `DistributedTokenBucket.consume(key, tokens, options)` → Redis Lua atomic, fallback in-memory; `parseRateLimitHeaders()` cho x-ratelimit-* / RFC 6585.
- `SchemaDriftGuard` (`globalSchemaDriftGuard`) normalize/classify metadata drift; `JevChallengeDiagnoser` (`globalJevChallengeDiagnoser.diagnose({snippet, platform, accountId})`, `extractSnippet(body)`).

## Cross-Story Dependencies

- Story 20.1 và 20.2 **BẮT BUỘC atomic release** — 20.1 trước 20.2 → `x_scrape` trả preview rỗng cho platforms chưa có stream hook (data loss âm thầm).
- Story 20.2 phụ thuộc `redis-stream-publisher.js` `formatPayload()` và `AbstractCrawler.start()` hook đặt sau `entry.handler()`.
- Story 20.5 độc lập với 20.1/20.2 về implementation nhưng PHẢI tuân thủ cùng contract (AbstractCrawler, action registry, descriptor dispatch, ThinEvent emission) để consumer ingest thống nhất.
- Story 20.3/20.4 (external, Nowing repo) KHÔNG block các story XActions; 20.4 blocked by 20.3.
