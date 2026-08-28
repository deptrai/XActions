---
story_id: "14.3"
epic: 14
story_key: "14-3-realtime-thin-event-redis-stream-for-nowing-ai-lead-hub"
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-27
updated: 2026-08-28
owner: "DEV"
reviewed: "Pending"
baseline_commit: 1c0c9abe
---

# Story 14.3: Realtime Thin Event Redis Stream for Nowing AI Lead Hub

<!-- Context engine analysis completed 2026-08-27. Ready for dev-story / bmad-dev-auto. -->

## Story

As a **Nowing Platform Orchestrator**,  
I want **scraped data from XActions to be emitted in real time as Thin Event Pointers into the Redis Stream `stream:social:raw_posts`**,  
so that **Nowing backend can run the background NLP Intent Extractor in near real time without overflowing Redis memory**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 14, Story 14.3]  
[Context: `_bmad-output/implementation-artifacts/epic-14-context.md` — Epic 14 goal & constraints]  
[Architecture: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-7, AD-10, AD-12, AD-13, AD-17, AD-SOC-4]

## Acceptance Criteria

### AC-1: Thin event emitted after every persisted batch
- **Given** `REDIS_STREAM_ENABLED=true` and any crawler action has just persisted a batch of `PostItem` or `CommentItem` records
- **When** the crawler invokes its checkpoint/stream helper after `storeBatch` / `storeCommentBatch` succeeds
- **Then** it emits one `XADD stream:social:raw_posts * <fields>` per item, where the payload is a thin pointer:
  ```ts
  {
    id: string,              // namespaced id, e.g. "facebook:123" or "threads:abc:456"
    platform: string,        // e.g. "facebook" | "threads"
    externalId: string,      // platform-native id
    category: string,        // e.g. "social" | "ecom" | "realestate" | "recruitment" | "b2b"
    authorId: string,
    crawledAt: string,       // ISO 8601
    storageRef: string,      // same as `id` — pointer to the PostgreSQL row
  }
  ```
- **And** the emission is non-blocking: any Redis error is caught and logged as a `[<platform> TELEMETRY]` warning; the crawl result is still returned to the caller
- **Ref:** FacebookCrawler helper `src/scrapers/social/facebook/crawler.js:2441-2498` (emits but currently omits `storageRef`); ThreadsCrawler helper `src/scrapers/social/threads/crawler.js:114-152` (already emits `storageRef`); AbstractCrawler persistence contract `src/core/base-crawler.js:151-252`

### AC-2: Checkpoint saved before stream event
- **Given** a crawler with an `AbstractStore` that supports `saveCheckpoint`
- **When** the batch finishes
- **Then** the helper first calls `store.saveCheckpoint({ platform, targetType, targetKey, lastCursor, lastTimestamp, lastCrawledAt, status, storageRef })` and only then calls `XADD`
- **And** the checkpoint contains the `storageRef` of the first item in the batch (or the item id for single-record actions)
- **Ref:** `PrismaStore.saveCheckpoint` at `src/store/prisma-store.js:312-348`; `AbstractStore` contract at `src/core/base-store.js:67-69`

### AC-3: Stream capped with configurable trimming
- **Given** `REDIS_STREAM_ENABLED=true`
- **When** the crawler calls `XADD`
- **Then** the stream is capped by default with `MAXLEN ~ 1000000` (configurable via `REDIS_STREAM_MAXLEN`)
- **And** when `REDIS_STREAM_TRIM_STRATEGY=minid`, the stream is capped with `MINID ~ <threshold>` (configurable via `REDIS_STREAM_MINID`)
- **And** the publisher supports both the `node-redis` `xAdd(..., { TRIM: ... })` API and the `ioredis` flat `xadd` API
- **Ref:** Architecture AD-7 rule 3; `isEnvTruthy` / `toIsoDate` helpers at `src/scrapers/social/facebook/crawler.js:42-59`

### AC-4: Stream metrics endpoint
- **Given** the MCP daemon or the XActions API is running
- **When** a client calls `GET /metrics/stream`
- **Then** it returns `200 OK` with a JSON body:
  ```ts
  {
    eventsPerSecond: number,   // new entries per second over the last refresh interval
    pendingMessages: number,   // total entries in the stream (XLEN)
    consumerLag: number,       // unacknowledged messages in the nowing_nlp_workers group (XPENDING)
    droppedEvents: number,     // cumulative trimmed / dropped events (entries-added - length or best-effort)
    lastAckTime: number,       // seconds since the last consumer ack (or consumer idle)
    maxLen: number,            // configured MAXLEN / MINID threshold
    minId: string | null,      // id of the oldest entry currently in the stream
  }
  ```
- **And** the same metrics are also exposed at `GET /admin/stream/metrics` for the operator dashboard (Epic 19)
- **Ref:** `src/mcp/server.js:startHttpTransport()` at `src/mcp/server.js:5316-5337` (`/health` exists; `/metrics/stream` does not yet); `api/routes/governor.js:14-39`; `api/server.js:350-353`

### AC-5: Alerts and governor backpressure logging
- **Given** the metrics reader is refreshing on a 5–30s cadence
- **When** `pendingMessages > 50,000` **or** `consumerLag > 50,000` **or** `lastAckTime > 60s`
- **Then** the system triggers an alert via `ALERT_WEBHOOK` (POST JSON) and/or `ALERT_EMAIL` if either is configured
- **And** the alert includes the metric snapshot, threshold crossed, and a timestamp
- **And** the `AdaptiveRateGovernor` logs `throttle_reason: redis_lag` with `reduced_to_percent: 25` whenever `redisConsumerLag > 10,000` and bulk throughput is reduced
- **Ref:** `AdaptiveRateGovernor.updateRedisConsumerLag` / `getMaxThroughput` at `src/core/adaptive-governor.js:150-196`; `StreamMetricsReader` at `src/utils/stream-metrics.js:25-135`; `nodemailer` in `package.json:127`

### AC-6: Store and Redis client wired into all production callers
- **Given** a `PrismaStore` (or decorated `AbstractStore`) initialized with a Redis client
- **When** `FacebookCrawler`, `ThreadsCrawler`, or future `AbstractCrawler` subclasses are constructed
- **Then** `crawler.store.redis` is a connected Redis client with `xAdd` / `xadd` capability
- **And** `src/scrapers/index.js:217-226`, `api/services/facebookScrape.js:51-102`, and `src/mcp/server.js:3475-3519` pass the store to the crawler by default so that production MCP / API / CLI calls emit events
- **Ref:** `PrismaStore` constructor at `src/store/prisma-store.js:29-37` (currently has no redis property); `AbstractCrawler` constructor at `src/core/base-crawler.js:50-63`; `scrape()` dispatcher at `src/scrapers/index.js:439-494`

### AC-7: Every batch action emits
- **Given** `FacebookCrawler` or `ThreadsCrawler` runs any registered action that persists data
- **When** the action handler returns the result
- **Then** the corresponding checkpoint/stream helper has been called exactly once for the batch
- **And** all FacebookCrawler actions that persist batches call `#saveCheckpoint`, including `page_posts` and `group_posts` (currently missing at `src/scrapers/social/facebook/crawler.js:1121-1225`)
- **Ref:** FacebookCrawler actions at `src/scrapers/social/facebook/crawler.js:300-450`; ThreadsCrawler actions at `src/scrapers/social/threads/crawler.js:71-102`

### AC-8: Tests and typecheck pass with no mocks
- **Given** `npm run typecheck` and `npm test`
- **When** the new tests run
- **Then** `tsc --noEmit` passes
- **And** Vitest tests use real Redis or gracefully skip when no Redis server is available (never `vi.fn`, mock, stub, or fake)
- **And** the project does not use `any` or `@ts-ignore`

## Tasks / Subtasks

- [ ] T1: Add `ThinEvent` type and `RedisStreamEvent` shape
  - [ ] T1.1: Add JSDoc typedef `ThinEvent` to `src/core/types.js`
  - [ ] T1.2: Add JSDoc typedef `StreamMetrics` to `src/core/types.js` (eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, minId)
  - [ ] T1.3: Add a `RedisClientLike` typedef in `src/core/types.js` so `this.store.redis` and the publisher have a typed contract without `any`
- [ ] T2: Create a reusable `RedisStreamPublisher`
  - [ ] T2.1: Create `src/utils/redis-stream-publisher.js` (or `src/store/redis-stream-publisher.js`) with `connect(options)`, `publish(key, thinEvent, opts)`, `xlen(key)`, `xinfo(key)`, `xgroupEnsure(key, groupName)`
  - [ ] T2.2: Support both `redis` (`xAdd` with `TRIM`) and `ioredis` (`xadd` flat args)
  - [ ] T2.3: Support `MAXLEN ~ <n>` and `MINID ~ <id>` via `REDIS_STREAM_TRIM_STRATEGY` / `REDIS_STREAM_MAXLEN` / `REDIS_STREAM_MINID`
  - [ ] T2.4: Never throw on publish; log warning and return `{ ok: false }` on error
- [ ] T3: Wire Redis client into the store layer
  - [ ] T3.1: Add `storageRef String?` to the `CrawlCheckpoint` model in `prisma/schema.prisma` and create a migration so `saveCheckpoint` can persist it
  - [ ] T3.2: Extend `PrismaStore` constructor to accept an optional `redisClient` and expose `this.redis` (or create a `RedisStoreDecorator` if keeping `PrismaStore` pure)
  - [ ] T3.3: Update `PrismaStore.saveCheckpoint` to write `checkpoint.storageRef` into the Prisma `data` object
  - [ ] T3.4: Create a singleton `defaultStore` in `src/store/index.js` (or `src/core/index.js`) that combines `PrismaStore` + `RedisStreamPublisher`
  - [ ] T3.5: Ensure `this.store.saveCheckpoint` and `this.store.redis` are both available to crawlers
- [ ] T4: Update `FacebookCrawler` stream emission
  - [ ] T4.1: Add `storageRef: items[0]?.id` to the `saveCheckpoint` call and `storageRef: item.id` to each thin-event `XADD` payload in `#saveCheckpoint`
  - [ ] T4.2: Call `#saveCheckpoint` from `pagePosts` and `groupPosts` after `storeBatch` (currently only `storeBatch` is called at `src/scrapers/social/facebook/crawler.js:1159-1167` / `1217-1225`)
  - [ ] T4.3: Use `isEnvTruthy` consistently (replace `process.env.REDIS_STREAM_ENABLED === 'true'` if present, but current code already uses `isEnvTruthy`)
  - [ ] T4.4: Route all `#saveCheckpoint` calls through the new `RedisStreamPublisher` so `xAdd`/`xadd` differences are handled in one place
- [ ] T5: Update `ThreadsCrawler` stream emission
  - [ ] T5.1: Use the shared `RedisStreamPublisher` (or `this.store.redis`) instead of raw `redisClient.xadd`
  - [ ] T5.2: Use `isEnvTruthy(process.env.REDIS_STREAM_ENABLED)` instead of `=== 'true'` to support `1` / `yes`
  - [ ] T5.3: Keep `storageRef` already present in the payload
  - [ ] T5.4: Apply `MAXLEN ~ 1000000` / `MINID` trimming through the shared publisher (current raw `xadd` is un-capped)
- [ ] T6: Implement `StreamMetricsCollector`
  - [ ] T6.1: Create `src/utils/stream-metrics-collector.js` that wraps `StreamMetricsReader` and adds `getMetrics()` returning the full `StreamMetrics` shape
  - [ ] T6.2: Read `XLEN` for `pendingMessages`, `XPENDING` for `consumerLag`, `XINFO STREAM` / `XINFO GROUPS` for `lastAckTime`, `first-entry` for `minId`, and cache previous `entries-added` to compute `eventsPerSecond`
  - [ ] T6.3: Create the `nowing_nlp_workers` consumer group idempotently with `XGROUP CREATE ... MKSTREAM` if it does not exist
  - [ ] T6.4: Expose `droppedEvents` as best-effort: `entries-added - length` when `XINFO STREAM` supports it, otherwise `null`
- [ ] T7: Add `/metrics/stream` endpoint
  - [ ] T7.1: Add `GET /metrics/stream` in `src/mcp/server.js:startHttpTransport()` next to `/health`
  - [ ] T7.2: Add `GET /metrics/stream` and `GET /admin/stream/metrics` in the API (new or existing `api/routes/streams.js` / `api/routes/governor.js`)
  - [ ] T7.3: Cache metrics for 5s to avoid hammering Redis; refresh on demand if stale
- [ ] T8: Implement stream alert engine
  - [ ] T8.1: Create `src/utils/stream-alerts.js` with `checkAndAlert(metrics, config)`
  - [ ] T8.2: Trigger when `pendingMessages > 50,000` or `consumerLag > 50,000` or `lastAckTime > 60s`
  - [ ] T8.3: Send `ALERT_WEBHOOK` via `fetch` and `ALERT_EMAIL` via `nodemailer`
  - [ ] T8.4: Implement cooldown (e.g., 5 minutes) and per-threshold state to avoid spam
  - [ ] T8.5: Add `GET /admin/stream/alerts` that returns current alert status and last alert timestamp
- [ ] T9: Add governor throttle logging
  - [ ] T9.1: In `AdaptiveRateGovernor.getMaxThroughput` or `getStatus`, when backpressure is active due to `redisConsumerLag > 10,000`, log a structured warning: `{ throttle_reason: 'redis_lag', reduced_to_percent: 25, redisConsumerLag, platform }`
  - [ ] T9.2: Ensure `refreshGovernorConsumerLag` is called from the metrics collector or metrics endpoint so the governor stays current
- [ ] T10: Wire store into production callers
  - [ ] T10.1: Update `src/scrapers/index.js` `createFacebookCrawler` and `dispatchFacebookHybrid` to use the singleton `defaultStore` when no `store` is passed
  - [ ] T10.2: Update `api/services/facebookScrape.js` to pass `store` through `browserOptions`/`crawlerOptions`
  - [ ] T10.3: Update `src/mcp/server.js` `executeFacebookScrapeTool` / `executeCrawlPostTool` / `executeCrawlCommentsTreeTool` to pass `store`
  - [ ] T10.4: Update `src/scrapers/index.js` generic `scrape()` to accept `store` and forward it to platform-specific crawlers
  - [ ] T10.5: Update `api/routes/facebook.js` to construct or receive a `store` and pass it to `FacebookScrapeService`
- [ ] T11: Tests
  - [ ] T11.1: `tests/store/redis-stream-publisher.test.js` — publish thin event, verify `xadd` / `xAdd` works, trim cap, env toggle
  - [ ] T11.2: `tests/utils/stream-metrics-collector.test.js` — metrics shape, fallback to 0 when Redis down
  - [ ] T11.3: `tests/utils/stream-alerts.test.js` — threshold crossing, webhook call, cooldown
  - [ ] T11.4: `tests/scrapers/social/facebook/redis-stream.test.js` — `page_posts` / `group_posts` call checkpoint, payload contains `storageRef`
  - [ ] T11.5: `tests/mcp/metrics-stream.test.js` (or `tests/api/metrics-stream.test.js`) — `GET /metrics/stream` returns expected shape
  - [ ] T11.6: `npm run typecheck` passes
- [ ] T12: Update `src/cli/commands/stream.js` or create `src/cli/commands/admin.js` for `xactions stream metrics` / `xactions stream alerts`
  - [ ] T12.1: Resolve command name collision with the existing Twitter Socket.IO `stream` group (see Outstanding Items)
  - [ ] T12.2: Implement `xactions stream metrics` and `xactions stream alerts` (or `xactions admin stream metrics`/`alerts` if chosen)
  - [ ] T12.3: CLI calls `GET /metrics/stream` and `/admin/stream/alerts` with `fetch`

## Dev Notes

### Current state of stream emission

- `FacebookCrawler.#saveCheckpoint` at `src/scrapers/social/facebook/crawler.js:2441-2498` already emits to `stream:social:raw_posts` when `this.store.redis` or `this.sessionManager.redis` is present and `REDIS_STREAM_ENABLED` is truthy.
- The Facebook payload is missing `storageRef`; add it as `storageRef: item.id`.
- The `saveCheckpoint` call in `FacebookCrawler.#saveCheckpoint` is also missing `storageRef` in its `data` object and the `CrawlCheckpoint` Prisma schema has no `storageRef` column; add both.
- `ThreadsCrawler.#emitCheckpointAndStream` at `src/scrapers/social/threads/crawler.js:114-152` already emits `storageRef` and uses `xadd`, but it checks `process.env.REDIS_STREAM_ENABLED === 'true'` literally and has no stream trimming; switch to `isEnvTruthy` and route through the shared `RedisStreamPublisher`.
- Both crawlers rely on a `redis` property being present on the store or session manager; `PrismaStore` does not expose one yet.
- `pagePosts` and `groupPosts` in `FacebookCrawler` (`src/scrapers/social/facebook/crawler.js:1121-1225`) call `storeBatch` but do **not** call `#saveCheckpoint`, so they will not emit events.

### Redis client choices

- The project has `redis: ^4.6.11` in `package.json:138`.
- `src/streaming/streamManager.js` dynamically imports `ioredis` for the legacy Socket.IO stream manager, but `ioredis` is **not** declared in `package.json` dependencies (it is likely a transitive dep of `bull`).
- Use the `redis` package for all new Nowing stream code. Do **not** add `ioredis` to `package.json`; the `RedisStreamPublisher` should expose a `RedisClientLike` interface and normalize both `xAdd` (node-redis) and `xadd` (ioredis) shapes internally.
- Refactor `ThreadsCrawler` to call `publisher.publish()` so it does not depend on raw `xadd`.

### Store wiring strategy (Dev Agent decision)

Two valid options; pick one and document it. **Prerequisite for both:** add `storageRef String?` to `prisma/schema.prisma` `CrawlCheckpoint` and run `npx prisma migrate dev` so `PrismaStore.saveCheckpoint` can persist it.

1. **Extend `PrismaStore`**: add `redisClient` to the constructor and expose `this.redis`; update `saveCheckpoint` to write `storageRef`. This is the smallest change.
2. **Decorator pattern**: keep `PrismaStore` pure and create a `PersistentStoreWithStream` wrapper that owns a `PrismaStore` + a `RedisStreamPublisher`, implements `saveCheckpoint` (including `storageRef`), `storeBatch`, `storeCommentBatch`, and exposes `this.redis`.

The singleton used by production callers (`FacebookScrapeService`, `src/scrapers/index.js`, `src/mcp/server.js`) should be created once and reused.

### Metrics implementation details

- `consumerLag` should come from `XPENDING` on the `nowing_nlp_workers` consumer group.
- `pendingMessages` should come from `XLEN` of `stream:social:raw_posts`.
- `eventsPerSecond` requires caching the previous `XINFO STREAM` `entries-added` value and timestamp.
- `droppedEvents` is best-effort: `entries-added - length` from `XINFO STREAM`; older Redis versions may not expose `entries-added`, in which case the field can be `null`.
- `lastAckTime` is also best-effort: use the consumer group's `last-delivered-id` and the stream's entry time, or the consumer `idle` value from `XINFO CONSUMERS`; document the chosen algorithm.

### Alert engine details

- Use `ALERT_WEBHOOK` (HTTP POST) and `ALERT_EMAIL` (SMTP via `nodemailer`) from environment variables.
- Maintain in-memory alert state with a cooldown (suggested `ALERT_COOLDOWN_MS=300000`).
- Primary thresholds per AD-17: `pendingMessages > 50,000` or `lastAckTime > 60s`. The dev agent may also react to `consumerLag > 50,000` as an additional signal.
- Alert payload shape:
  ```ts
  {
    alert: 'redis_stream_lag' | 'redis_stream_ack',
    threshold: number,
    value: number,
    timestamp: string,
    metrics: StreamMetrics,
  }
  ```

### 3-Layer Envelope compatibility

- This story does not change the MCP envelope; `src/mcp/envelope.js` continues to wrap tool results.
- If an MCP tool returns a large batch, the envelope handles artifact export (Story 14.2). The Redis stream emission is a side effect inside the crawler, not part of the tool response.

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 18, JSDoc + `npm run typecheck` (`tsc --noEmit`).
- **No `any` / `@ts-ignore`**: TypeScript strict mode.
- **Redis package:** `redis: ^4.6.11` (primary). Do not add `ioredis` to `package.json`; the `RedisStreamPublisher` normalizes both `xAdd` and `xadd` callers.
- **Email library:** `nodemailer: ^9.0.3` (`package.json:127`) for `ALERT_EMAIL`.
- **HTTP:** built-in `node:fetch` / `undici` for webhook alerts and CLI calls.
- **Testing:** Vitest, no mocks, real Redis or graceful skip when unavailable.
- **Environment variables:**
  - `REDIS_STREAM_ENABLED` — `true` | `1` | `yes` to enable stream emission
  - `REDIS_STREAM_TRIM_STRATEGY` — `maxlen` (default) | `minid`
  - `REDIS_STREAM_MAXLEN` — default `1000000`
  - `REDIS_STREAM_MINID` — default `0`
  - `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` (existing)
  - `ALERT_WEBHOOK` — optional webhook URL
  - `ALERT_EMAIL` — optional comma-separated email addresses
  - `ALERT_EMAIL_FROM`, `ALERT_SMTP_HOST`, `ALERT_SMTP_PORT`, `ALERT_SMTP_USER`, `ALERT_SMTP_PASS` — optional SMTP config for `nodemailer`
  - `ALERT_COOLDOWN_MS` — default `300000`
  - `NOWING_CONSUMER_GROUP` — default `nowing_nlp_workers`

## Architecture Compliance

| AD | Rule | Implementation |
|----|------|----------------|
| AD-7 | Dual-Channel: MCP HTTP/SSE (port 3001) + Redis Stream (`stream:social:raw_posts`) thin pointers | Emission in crawler helpers; metrics endpoint on MCP daemon; `storageRef` points to PostgreSQL |
| AD-10 | 3-Tier incremental: read checkpoint, crawl delta, write checkpoint, then emit event | `saveCheckpoint` called before `XADD` in `#saveCheckpoint` and `#emitCheckpointAndStream` |
| AD-12 | `CrawlCheckpoint` with `platform,targetType,targetKey,lastCursor,lastTimestamp,status` | Persist via `PrismaStore.saveCheckpoint`; include `storageRef` |
| AD-13 | Governor reduces bulk throughput 25% when `pending > 10,000` and logs `throttle_reason: redis_lag` | Extend `AdaptiveRateGovernor` to log structured throttle reason when backpressure active |
| AD-17 | `GET /metrics/stream` returns `{ eventsPerSecond, pendingMessages, consumerLag, droppedEvents, lastAckTime, maxLen, minId }`; alerts at 50k/60s | New `StreamMetricsCollector` + alert engine + endpoint |
| AD-SOC-4 | Decoupled Redis Stream event buffer — thin pointers only | Payload must contain only id, platform, externalId, category, authorId, crawledAt, storageRef; no raw post/comment content |

## Library & Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| `redis` | `^4.6.11` (existing) | Redis client for `XADD`, `XLEN`, `XPENDING`, `XINFO`, `XGROUP CREATE` |
| `nodemailer` | `^9.0.3` (existing) | Email alerts when `ALERT_EMAIL` is configured |
| `@prisma/client` | existing | `PrismaStore` persistence and checkpoint storage |
| `vitest` | existing | Test framework |

## File Structure Requirements

### CREATE

| File | Description |
|------|-------------|
| `src/utils/redis-stream-publisher.js` | Thin `XADD` publisher supporting `redis` / `ioredis` and `MAXLEN` / `MINID` trim |
| `src/utils/stream-metrics-collector.js` | Collects full `StreamMetrics` from Redis with caching and consumer-group creation |
| `src/utils/stream-alerts.js` | Alert engine: thresholds, webhook, email, cooldown |
| `src/store/store-with-redis.js` | New singleton `defaultStore` combining `PrismaStore` + `RedisStreamPublisher` (or decorator) |
| `api/routes/streams.js` | REST routes for `GET /admin/stream/metrics` and `GET /admin/stream/alerts` (or extend `governor.js` if it already owns admin routes) |
| `src/cli/commands/admin.js` | `xactions admin stream metrics|alerts` command surface; can alias under existing `stream.js` later |
| `tests/store/redis-stream-publisher.test.js` | Test publisher with real Redis or graceful skip |
| `tests/utils/stream-metrics-collector.test.js` | Test metrics shape and fallbacks |
| `tests/utils/stream-alerts.test.js` | Test threshold, webhook, email, cooldown |
| `tests/scrapers/social/facebook/redis-stream.test.js` | Test `page_posts` / `group_posts` emit thin events |
| `tests/mcp/metrics-stream.test.js` or `tests/api/metrics-stream.test.js` | Test `GET /metrics/stream` endpoint |

### UPDATE

| File | Description |
|------|-------------|
| `prisma/schema.prisma` | Add `storageRef String?` to `CrawlCheckpoint` model |
| `prisma/migrations/` | New migration for `CrawlCheckpoint.storageRef` |
| `src/core/types.js` | Add `ThinEvent`, `StreamMetrics`, and `RedisClientLike` typedefs |
| `src/store/prisma-store.js` | Accept `redisClient` and expose `this.redis`, OR become a decorator target; persist `storageRef` in `saveCheckpoint` |
| `src/scrapers/social/facebook/crawler.js` | Add `storageRef`; call `#saveCheckpoint` in `pagePosts`/`groupPosts`; use shared publisher |
| `src/scrapers/social/threads/crawler.js` | Use `isEnvTruthy`; use shared publisher |
| `src/scrapers/index.js` | `createFacebookCrawler` / `scrape()` default to the singleton `store` |
| `api/services/facebookScrape.js` | Forward `store` to `createFacebookCrawler` |
| `api/routes/facebook.js` | Pass `store` through `browserOptions` if needed |
| `src/mcp/server.js` | Add `GET /metrics/stream`; pass `store` in Facebook / crawl tools |
| `api/server.js` | Mount `GET /metrics/stream` and `/admin/stream/metrics` / `/admin/stream/alerts` |
| `src/core/adaptive-governor.js` | Log `throttle_reason: redis_lag` with `reduced_to_percent` when backpressure active |
| `src/cli/commands/admin.js` (new) or `src/cli/commands/stream.js` | Add `xactions admin stream metrics|alerts` (recommended); only overload `stream` if aliases are acceptable |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Set `14-3` to `ready-for-dev` and update `last_updated` |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/core/base-crawler.js` | `AbstractCrawler.start()` account/governor resolution is already correct; only `store` wiring changes externally |
| `src/core/base-store.js` | Do not change the `AbstractStore` contract unless adding an optional `redis` accessor |
| `src/core/action-registry.js` | Action discovery is stable |
| `src/mcp/envelope.js` | 3-Layer envelope is complete from Story 14.2 |
| `src/streaming/streamManager.js` | Legacy Socket.IO/Twitter stream manager is unrelated to the Nowing Redis Stream |
| `src/utils/stream-metrics.js` | Keep existing `StreamMetricsReader` and `extractPendingCount`; build the collector around it |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test`.
- **No mocks:** No `vi.fn`, mock, stub, or fake. Use real Redis operations or graceful skip when Redis is not running.
- **Real Redis helper:** Use a Redis client pointed at `REDIS_URL` or `redis://localhost:6379`; create a test stream key (e.g. `stream:test:raw_posts`) and clean it up in `afterAll`.
- **Coverage expectations:**
  - Thin event payload shape matches AC-1 (including `storageRef`)
  - `page_posts` and `group_posts` emit checkpoint + stream event
  - `GET /metrics/stream` returns all 7 fields
  - Alert engine triggers when `pendingMessages > 50000` or `consumerLag > 50000` or `lastAckTime > 60s` and respects cooldown
  - Governor logs `throttle_reason: redis_lag` when `redisConsumerLag > 10000`
  - `npm run typecheck` passes

## Previous Story Intelligence

### Story 14.1 — Hierarchical Comment Tree Extraction (Done, baseline `923466f9`)

- `CommentTreeExtractor` at `src/scrapers/social/comment-tree.js:32-239` provides BFS by depth and topological sort.
- `PrismaStore.storeCommentBatch` at `src/store/prisma-store.js:271-298` inserts comments by `depth` level to avoid FK violations.
- FacebookCrawler `post_comments` / `group_comments` and ThreadsCrawler `get_post_comments` produce `CommentItem[]` and then call their stream helpers.

### Story 14.2 — MCP Tool Exporters & Daemon HTTP/SSE Server (Done, baseline `1c0c9abe`)

- `src/mcp/server.js` runs an Express HTTP transport on port 3001 with `GET /health` at `src/mcp/server.js:5327-5329` and `POST/GET/DELETE /mcp`.
- 3-Layer JSON Envelope is in `src/mcp/envelope.js`.
- `x_actions_list`, `x_crawl_post`, and `x_crawl_comments_tree` are wired at `src/mcp/server.js:2858-2868`.
- Auto-artifact exporter is `src/mcp/artifact-exporter.js`.
- `xactions daemon start/status/stop` is in `src/cli/commands/daemon.js`.

### Story 13.10 — Facebook Hybrid Integration & Caller Migration (Done, baseline `9c40ce3f`)

- `scrape('facebook', action, options)` dispatcher at `src/scrapers/index.js:439-494` calls `dispatchFacebookHybrid`.
- `FacebookScrapeService` at `api/services/facebookScrape.js:51-102` is the single source of truth for REST and MCP Facebook scrape calls.
- `FacebookCrawler` registers all Facebook actions and persists to `PrismaStore`.

## Git Intelligence

Recent commits (greatest to oldest):
- `1c0c9abe fix(mcp): apply review findings for 14.2 envelope, artifact, and daemon`
- `488529ca fix(review): apply 10 code review patches for story 14.2`
- `b98fc89b docs(spec): record final revision for 14.2`
- `bc39efd6 feat(mcp): 14.2 MCP tool exporters, envelope, daemon CLI, and action discovery`
- `272e17b8 refactor(story): validate and tighten 14.2 story`

Patterns:
- Commit messages follow `type(scope): description`.
- No mocks in tests.
- Baseline branch: `feat/14-3-realtime-thin-event-redis-stream-for-nowing-ai-lead-hub`.

## Latest Tech Information

- Redis Streams commands (`XADD`, `XLEN`, `XPENDING`, `XINFO STREAM`, `XINFO GROUPS`, `XINFO CONSUMERS`, `XGROUP CREATE`) are available in Redis >= 5.0.
- `XADD` with `MAXLEN ~ <n>` or `MINID ~ <id>` caps the stream; `~` makes trimming approximate and faster.
- `node-redis` v4 supports `xAdd(key, '*', fields, { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 1000000 } })`.
- `ioredis` uses flat arguments: `xadd(key, 'MAXLEN', '~', 1000000, '*', ...Object.entries(fields).flat())`.
- `XINFO STREAM` `entries-added` is available in Redis 7.0+; use `XLEN` and careful caching for older servers.
- `XGROUP CREATE key group $ MKSTREAM` creates a consumer group and the stream atomically if either does not exist.

## Project Context Reference

- Epic 14 context: `_bmad-output/implementation-artifacts/epic-14-context.md`
- Epic 14 stories: `_bmad-output/planning-artifacts/epics.md#epic-14-deep-conversation-scraper-mcp-daemon-nowing-event-stream`
- Architecture AD-7 / AD-10 / AD-12 / AD-13 / AD-17: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`
- `AbstractCrawler` store wiring: `src/core/base-crawler.js:50-63`
- `FacebookCrawler.#saveCheckpoint`: `src/scrapers/social/facebook/crawler.js:2441-2498`
- `FacebookCrawler.pagePosts` / `groupPosts`: `src/scrapers/social/facebook/crawler.js:1121-1225`
- `ThreadsCrawler.#emitCheckpointAndStream`: `src/scrapers/social/threads/crawler.js:114-152`
- `PrismaStore`: `src/store/prisma-store.js:29-37`, `storeBatch:180-228`, `saveCheckpoint:312-348`
- `AbstractStore`: `src/core/base-store.js:11-75`
- `StreamMetricsReader`: `src/utils/stream-metrics.js:25-135`
- `AdaptiveRateGovernor`: `src/core/adaptive-governor.js:150-196`
- `MCP HTTP transport /health`: `src/mcp/server.js:5316-5337`
- `Governor status API`: `api/routes/governor.js:14-39`
- `scrape()` dispatcher: `src/scrapers/index.js:439-494`
- `FacebookScrapeService`: `api/services/facebookScrape.js:51-102`

## Edge Cases & Validation Notes

- **Redis unavailable:** Publisher must never throw; metrics collector returns 0/null defaults; endpoints return `success: true` with zeros, not 500.
- **REDIS_STREAM_ENABLED=false:** No `XADD`, no connection attempts from the publisher. Metrics endpoint may still read if Redis is configured, but alerts only fire when metrics are non-zero.
- **No consumer group yet:** `StreamMetricsCollector` should create `nowing_nlp_workers` with `MKSTREAM` before `XPENDING`.
- **Empty batch:** No checkpoint/stream call if `items.length === 0`.
- **Single record:** `storageRef` is the item's `id`; the thin event is emitted exactly once.
- **Mixed Redis clients:** Publisher must support `xAdd` (node-redis) and `xadd` (ioredis) by inspecting the client API.
- **Trim strategy mismatch:** If `MINID` is requested but `REDIS_STREAM_MINID` is missing, fall back to `MAXLEN ~ REDIS_STREAM_MAXLEN` and log a warning.
- **StorageRef for comments:** For `CommentItem` the `id` already includes the post id (`platform:postExternalId:commentExternalId`), so `storageRef` can equal `id`.
- **Checkpoint before stream:** If `saveCheckpoint` throws, do not call `XADD`; log the error and continue returning the crawl result.
- **Stream XADD failure:** If `XADD` fails, do not roll back the checkpoint; log and continue.
- **Alert spam:** Alert engine must use a cooldown (default 5 minutes) and per-threshold last-fired timestamp.
- **CrawlCheckpoint `storageRef`:** Must be added to the Prisma model and persisted in `PrismaStore.saveCheckpoint`; without it the `storageRef` field in `saveCheckpoint` calls is dropped.
- **Typecheck:** No `any` or `@ts-ignore`; use the new `RedisClientLike` typedef and JSDoc `@type` imports for `RedisClientType`.

### Review Findings

<!-- Empty until code review workflow is run. -->

## Outstanding Items (Dev Agent Owned)

1. Choose the store wiring pattern: extend `PrismaStore` with `redisClient` or create a `PersistentStoreWithStream` decorator.
2. Decide whether `/metrics/stream` lives on the MCP daemon (`src/mcp/server.js`) only, the API only, or both. Recommendation: both, sharing the same collector.
3. Decide the exact algorithm and fallback for `droppedEvents` and `lastAckTime` based on the Redis server version available in the target environment.
4. Decide the CLI command surface for stream metrics/alerts. Existing `xactions stream` is used for Twitter Socket.IO streams, so a name collision exists. **Recommended:** Use `xactions admin stream metrics|alerts` (matches Story 19.4.5 and `src/cli/commands/admin.js`) and optionally add `xactions stream metrics|alerts` as deprecated aliases in Epic 20.
5. Decide how to provide the store/redis to non-Facebook crawlers in `src/scrapers/index.js:439-494` generic `scrape()` without breaking backward compatibility for callers that pass `page`.
6. Confirm Redis client strategy. `ioredis` is **not** a declared dependency; the `RedisStreamPublisher` should use the `redis` package and expose a `RedisClientLike` interface. `ThreadsCrawler` should be refactored to call `publisher.publish()` instead of raw `redisClient.xadd`; do NOT add `ioredis` to `package.json`.
7. Confirm the alert email transport: use direct `nodemailer` SMTP or a preconfigured `ALERT_SMTP_*` env set.

## File List

### New files
- `src/utils/redis-stream-publisher.js` — thin `XADD` publisher with MAXLEN/MINID and client normalization.
- `src/utils/stream-metrics-collector.js` — full `StreamMetrics` collector with caching and consumer-group creation.
- `src/utils/stream-alerts.js` — threshold alert engine (webhook/email).
- `src/store/store-with-redis.js` — singleton/default store with Redis (re-export from `src/store/index.js`).
- `api/routes/streams.js` — `/admin/stream/metrics` and `/admin/stream/alerts` route handlers (or extend `governor.js`).
- `src/cli/commands/admin.js` — `xactions admin stream metrics|alerts`.
- `tests/store/redis-stream-publisher.test.js`
- `tests/utils/stream-metrics-collector.test.js`
- `tests/utils/stream-alerts.test.js`
- `tests/scrapers/social/facebook/redis-stream.test.js`
- `tests/mcp/metrics-stream.test.js` or `tests/api/metrics-stream.test.js`

### Updated files
- `prisma/schema.prisma` — add `storageRef` to `CrawlCheckpoint`.
- `prisma/migrations/` — new migration for `CrawlCheckpoint.storageRef`.
- `src/core/types.js` — `ThinEvent` + `StreamMetrics` + `RedisClientLike` typedefs.
- `src/store/prisma-store.js` — optional `redisClient` / `this.redis`; persist `storageRef`.
- `src/store/index.js` — re-export `defaultStore` from `store-with-redis.js`.
- `src/scrapers/social/facebook/crawler.js` — add `storageRef`, emit from `pagePosts`/`groupPosts`, use shared publisher.
- `src/scrapers/social/threads/crawler.js` — `isEnvTruthy` + shared publisher.
- `src/scrapers/index.js` — default store wiring.
- `api/services/facebookScrape.js` — pass store.
- `api/routes/facebook.js` — pass store if needed.
- `src/mcp/server.js` — `GET /metrics/stream` + store injection.
- `api/server.js` — mount metrics/admin stream routes.
- `src/core/adaptive-governor.js` — `throttle_reason: redis_lag` log.
- `src/cli/commands/admin.js` — `xactions admin stream metrics|alerts` (new; can alias under `stream.js` in Epic 20).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status update.
