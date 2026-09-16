---
title: 'Story 29.1 — Jetstream/SSE/CDC Adapters for Push-Based Social Streams'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
baseline_commit: 'd7c8e91b'
review_loop_iteration: 1
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `streamManager` only supports polling-based streams (tweet, follower, mention). Bluesky Jetstream (WebSocket), Mastodon SSE, and CDC (change data capture) sources are push-based — events arrive in real time, no polling needed.

**Approach:** Add `src/streaming/adapters/` with 3 adapter modules + base class. Each adapter connects to a push-based source, normalizes events to `PostItem`, maps to `ThinEvent`, and publishes via `RedisStreamPublisher` to `stream:social:raw_posts`. Register new stream types in `streamManager` and extend `createStream` to accept adapter-specific options.

## Boundaries & Constraints

**Always:**
- Reuse `RedisStreamPublisher.publish()` — same `stream:social:raw_posts` key
- Use `undici` WebSocket (already a dependency) for Jetstream — no new packages
- Use `undici` request streaming for Mastodon SSE — no new packages
- All adapters extend `BasePushAdapter` — shared: reconnect, exponential backoff, cursor persistence, event emission
- Cursor persisted to Redis at `xactions:adapter_cursor:{streamId}`
- Stream types extended: `jetstream`, `mastodon_sse`, `cdc` added to `STREAM_TYPES`
- `createStream()` accepts `options` object for adapter-specific config
- Jetstream post events normalized via new `normalizeJetstreamCommit()` (did-only, no author.handle)
- Mastodon SSE events normalized via existing `normalizeMastodonStatus()`
- CDC events pass through with minimal validation (already ThinEvent-compatible)

**Never:**
- KHÔNG modify existing `tweet`, `follower`, `mention` stream types or their polling logic
- KHÔNG add new npm dependencies — `undici` covers WebSocket + HTTP streaming
- KHÔNG bypass `RedisStreamPublisher` — all events go through it
- KHÔNG store full event payloads in stream history — only `ThinEvent`
- KHÔNG use `com.atproto.sync.subscribeRepos` — that's the firehose (CBOR), not Jetstream (JSON)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Jetstream connect | `{ type: 'jetstream', options: { wantedCollections: ['app.bsky.feed.post'] } }` | Connects to `wss://jetstream1.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post` | Reconnect on close |
| Jetstream post event | `{ kind: 'commit', commit: { collection: 'app.bsky.feed.post', operation: 'create', record: {...} } }` | `PostItem` → `ThinEvent` → published | Skip `delete` ops |
| Jetstream non-post | `{ kind: 'commit', commit: { collection: 'app.bsky.feed.like' } }` | Filtered out (not in wantedCollections) | N/A |
| Jetstream reconnect | Connection dropped | Exponential backoff (1s→2s→4s→8s→16s→30s max), resume from `cursor` param | Persists cursor |
| Jetstream cursor | `time_us` field in each event | Saved as cursor, used on reconnect | Falls back to `now` if missing |
| Mastodon SSE connect | `{ type: 'mastodon_sse', options: { instance: 'mastodon.social', streamType: 'public' } }` | Connects to `https://mastodon.social/api/v1/streaming/public` | Reconnect on error |
| Mastodon status | `event: update\ndata: {"id":"123","content":"<p>hi</p>",...}` | `PostItem` → `ThinEvent` → published | Parse errors logged |
| Mastodon delete | `event: delete\ndata: 12345` | Logged, no ThinEvent emitted | N/A |
| Mastodon auth | `options.accessToken` provided | `Authorization: Bearer <token>` header sent | 401 → error |
| Mastodon hashtag | `options.streamType: 'hashtag', options.tag: 'news'` | Connects to `streaming/hashtag?tag=news` | Missing tag → error |
| CDC Redis source | `{ type: 'cdc', options: { sourceStreamKey: 'cdc:events' } }` | Reads via `XREAD BLOCK` from Redis stream | Connection retry |
| CDC event shape | `{ id, platform, external_post_id, ... }` | Validated as ThinEvent, published | Invalid shape → skip + warn |
| createStream adapter | `{ type: 'jetstream', options: {...} }` | Accepted, adapter created + started | N/A |
| stopStream adapter | `stopStream(streamId)` | Clean disconnect, cursor saved | N/A |
| Adapter crash | Uncaught error in event handler | Logged, doesn't kill adapter | Adapter keeps running |
| Empty username | `{ type: 'jetstream' }` (no username) | Accepted — push adapters don't need username | Use `*` as default |

</frozen-after-approval>

## Code Map

- `src/streaming/adapters/base-adapter.js` — **NEW**: `BasePushAdapter` — connect/disconnect/reconnect/backoff/cursor/event-emitter
- `src/streaming/adapters/jetstream.js` — **NEW**: `JetstreamAdapter` + `normalizeJetstreamCommit()`
- `src/streaming/adapters/mastodon-sse.js` — **NEW**: `MastodonSSEAdapter` — SSE parser + status normalization
- `src/streaming/adapters/cdc.js` — **NEW**: `CDCAdapter` — Redis stream consumer
- `src/streaming/adapters/index.js` — **NEW**: Barrel exports
- `src/streaming/streamManager.js` — MODIFY: Extend `STREAM_TYPES`, add adapter dispatch in `createStream()`/`stopStream()`, accept `options` param
- `src/streaming/index.js` — MODIFY: Re-export adapters
- `api/routes/streams.js` — MODIFY: Pass `options` through to `createStream()`
- `src/utils/redis-stream-publisher.js` — READ-ONLY: reuse `publish()`
- `src/scrapers/social/mastodon/normalizer.js` — READ-ONLY: reuse `normalizeMastodonStatus()`
- `src/core/types.js` — MODIFY: Add `PushAdapterOptions` typedef if needed

## Tasks & Acceptance

**Execution:**
- [ ] `src/streaming/adapters/base-adapter.js` — `BasePushAdapter` class with EventEmitter, cursor save/load, reconnect w/ backoff
- [ ] `src/streaming/adapters/jetstream.js` — `JetstreamAdapter` connecting to `wss://jetstream{1,2}.{us-east,us-west}.bsky.network/subscribe?wantedCollections=...`
- [ ] `src/streaming/adapters/jetstream.js` — `normalizeJetstreamCommit()` — maps `{ did, commit.record, time_us }` → `PostItem` (no author.handle — uses did)
- [ ] `src/streaming/adapters/mastodon-sse.js` — `MastodonSSEAdapter` with SSE parsing (event/data lines), instance/streamType/tag options
- [ ] `src/streaming/adapters/cdc.js` — `CDCAdapter` reading Redis stream via `XREAD BLOCK`
- [ ] `src/streaming/adapters/index.js` — Barrel exports
- [ ] `src/streaming/streamManager.js` — Extend `STREAM_TYPES`, add adapter lifecycle (push adapters don't use Bull polling)
- [ ] `src/streaming/index.js` — Re-export adapter modules
- [ ] `api/routes/streams.js` — Pass `options` to `createStream()`
- [ ] `tests/streaming/adapters/*.test.js` — Tests: adapter lifecycle, event normalization, cursor persistence, reconnect

**Acceptance Criteria:**
- Given `createStream({ type: 'jetstream', options: { wantedCollections: ['app.bsky.feed.post'] } })`, when called, then adapter connects to Jetstream WebSocket and begins emitting events
- Given Jetstream `commit` event with `app.bsky.feed.post` + `operation: 'create'`, when received, then normalized → `ThinEvent` → published to `stream:social:raw_posts`
- Given `createStream({ type: 'mastodon_sse', options: { instance: 'mastodon.social' } })`, when called, then connects to SSE endpoint and emits events
- Given Mastodon `update` event, when received, then `normalizeMastodonStatus()` → `ThinEvent` → published
- Given adapter connection drops, when detected, then reconnects with exponential backoff and resumes from cursor
- Given `stopStream(id)` on push adapter, when called, then cleanly disconnects and saves cursor
- Given CDC adapter with `sourceStreamKey`, when started, then reads events from Redis stream and publishes as ThinEvents
- Given `getStreamHistory(id)` for push adapter, when called, then returns recent ThinEvents

## Implementation Notes

<!-- Populated during implementation -->

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Design Notes

**Jetstream public endpoints** (4 instances):
- `wss://jetstream1.us-east.bsky.network/subscribe`
- `wss://jetstream2.us-east.bsky.network/subscribe`
- `wss://jetstream1.us-west.bsky.network/subscribe`
- `wss://jetstream2.us-west.bsky.network/subscribe`

Default: round-robin or random pick. Query params: `wantedCollections`, `wantedDids`, `cursor` (microseconds since epoch).

**Jetstream event format:**
```json
{
  "did": "did:plc:...",
  "time_us": 1725911162329308,
  "cursor": 12345,
  "kind": "commit",
  "commit": {
    "rev": "3l3qo2vutsw2b",
    "operation": "create",
    "collection": "app.bsky.feed.post",
    "rkey": "3l3qo2vuowo2b",
    "cid": "bafyrei...",
    "record": {
      "$type": "app.bsky.feed.post",
      "text": "Hello world",
      "createdAt": "2024-09-09T19:46:02.102Z",
      "embed": { ... },
      "langs": ["en"]
    }
  }
}
```

**Key difference from `normalizeBlueskyPost`:** Jetstream events have `did` but NO `author.handle`, NO `post.uri`. Need `normalizeJetstreamCommit()` that:
- Builds `externalId` from `did + rkey`
- Uses `did` as `authorId`
- Builds `postUrl` as `https://bsky.app/profile/{did}/post/{rkey}`
- Extracts `text` from `commit.record.text`
- Maps `commit.record.embed` → `mediaUrls`
- Uses `time_us` / `record.createdAt` for `publishedAt`

**Mastodon SSE endpoints:**
| StreamType | URL |
|-----------|-----|
| `public` | `https://<instance>/api/v1/streaming/public` |
| `local` | `https://<instance>/api/v1/streaming/public/local` |
| `hashtag` | `https://<instance>/api/v1/streaming/hashtag?tag=<tag>` |
| `user` | `https://<instance>/api/v1/streaming/user` (requires auth) |

SSE format: `event: update\ndata: {json}\n\n`. Parse `event` + `data` lines.

**CDC adapter (MVP):** Reads from a configurable Redis stream key via `XREAD BLOCK <ms> STREAMS <key> <cursor>`. Events expected to be `ThinEvent`-compatible — validate required fields (`id`, `platform`, `external_post_id`, `content_snippet`) and pass through. PostgreSQL logical replication deferred to future story.

**createStream signature change:**
```javascript
// Before
createStream({ type, username, interval, authToken, userId })

// After — options is adapter-specific config
createStream({ type, username, interval, authToken, userId, options })
// options.wantedCollections, options.wantedDids, options.jetstreamHost
// options.instance, options.streamType, options.tag, options.accessToken
// options.sourceStreamKey, options.sourceRedis
```

**Adapter lifecycle in streamManager:**
- Push adapters stored in `activeAdapters: Map<streamId, BasePushAdapter>` (separate from `activeStreams`)
- `createStream` dispatches: if type is push-based → create adapter, skip Bull job
- `stopStream` dispatches: if push adapter → `adapter.disconnect()`, skip Bull removal
- `listStreams` merges both `activeStreams` and `activeAdapters`
- `pauseStream`/`resumeStream` → `adapter.pause()`/`adapter.resume()` for push types

## Verification

**Commands:**
- `node --check src/streaming/adapters/*.js` — expected: no syntax errors
- `node --check src/streaming/streamManager.js` — expected: no syntax errors
- `npm run typecheck` — expected: 0 errors in new files
- `vitest run tests/streaming/` — expected: all tests pass
- `node -e "import('./src/streaming/adapters/index.js').then(m => console.log(Object.keys(m)))"` — expected: adapter exports listed

### Review Findings

- [x] [Review][Patch] **Duplicate stream prevention chặn tạo nhiều push streams cùng type** — `createStream` checks `s.type === type && s.username === cleanUsername` where `cleanUsername` defaults to `'*'` for push streams. This blocks creating 2 `mastodon_sse` streams for different hashtags or 2 `cdc` streams for different keys. Options: (a) include options hash in duplicate check, (b) allow unlimited push streams, (c) keep as-is (intentional).
- [x] [Review][Patch] **`_emitEvent` publishes raw PostItem → `content_snippet`/`post_url` rỗng** [src/streaming/adapters/base-adapter.js:294] — `publisher.publish(item)` passes PostItem with `content`/`postUrl` but `formatPayload` expects `content_snippet`/`post_url` → downstream consumers get empty strings.
- [x] [Review][Patch] **`mapToThinEvent` misses `content_snippet` → CDC events lose content** [src/streaming/streamManager.js:169] — checks `item.content || item.text` but CDC events carry `content_snippet` → `contentSnippet = ''` in history.
- [x] [Review][Patch] **`refreshFromRedis` không restore push adapters** [src/streaming/streamManager.js:830] — only re-creates Bull jobs for polling types; push streams marked `running` but no adapter instantiated → dead records after restart.
- [x] [Review][Patch] **Double `_scheduleReconnect` on `onerror` + `onclose`** [src/streaming/adapters/jetstream.js:222-240] — both handlers call `_scheduleReconnect()`, `reconnectAttempts` increments twice → skips backoff step (1s→4s instead of 1s→2s).
- [x] [Review][Patch] **`normalizeJetstreamCommit` misses `recordWithMedia` and video embeds** [src/streaming/adapters/jetstream.js:57-73] — only checks `embed.images` and `embed.external.thumb`, not `embed.media.images` (recordWithMedia) or `embed.video`.
- [x] [Review][Patch] **HTTP 4xx errors trigger infinite reconnect loop** [src/streaming/adapters/mastodon-sse.js:91-96] — `response.statusCode >= 400` → `_scheduleReconnect()` with no distinction between retriable and non-retriable errors.
- [x] [Review][Patch] **CDC `_consumeLoop` advances cursor while paused → data loss** [src/streaming/adapters/cdc.js:109-129] — loop doesn't check `_paused`, continues `XREAD` and sets `this._cursor` — events dropped by `_emitEvent` but cursor already advanced.
- [x] [Review][Patch] **Blocking `XREAD BLOCK` on shared Redis client** [src/streaming/adapters/cdc.js:42-49] — `_getSourceRedis` falls back to `_getRedisClient()` (shared singleton) → `XREAD BLOCK 5000` ties up connection for concurrent ops.
- [x] [Review][Patch] **Cursor not persisted on crash** [src/streaming/adapters/base-adapter.js] — `saveCursor` only called in `disconnect()`; `_cursor` updated in-memory on each event but never flushed to Redis until graceful shutdown.
- [x] [Review][Patch] **Orphaned cursor keys in Redis** [src/streaming/streamManager.js:375-385] — `stopStream` deletes `stateKey`/`historyKey`/`metaKey`/`lockKey` but not `xactions:adapter_cursor:{streamId}`.
- [x] [Review][Patch] **Unthrottled `saveMeta` per event** [src/streaming/streamManager.js:304-306] — every adapter event → `meta.eventCount++` → `await saveMeta(id, meta)` — Jetstream firehose generates hundreds/sec → Redis I/O contention.
- [x] [Review][Patch] **Dead Redis client reference on CDC reconnect** [src/streaming/adapters/cdc.js:43-49] — `_sourceRedis` cached, not reset when `_scheduleReconnect` fires → reconnect reuses dead client.
- [x] [Review][Patch] **Missing `bodyTimeout: 0` for SSE** [src/streaming/adapters/mastodon-sse.js:85-89] — undici default 300s body timeout → low-volume SSE streams disconnect after 5 min inactivity.
- [x] [Review][Patch] **Tautological test assertion** [tests/streaming/streamManager-adapters.test.js:64-77] — `expect(Array.isArray(history)).toBe(true)` passes with empty history; no event emitted → no real verification.
- [x] [Review][Patch] **Cursor persistence masked by in-memory cache** [tests/streaming/adapters/base-adapter.test.js:41-46] — `getCursor` returns `this._cursor` before checking Redis → test passes even if Redis write fails.
- [x] [Review][Patch] **Reconnect logic untested** [tests/streaming/adapters/base-adapter.test.js] — no test triggers disconnect or verifies `_scheduleReconnect` backoff sequence.
- [x] [Review][Patch] **API routes for push streams untested** [api/routes/streams.js] — no tests for POST/PATCH `/api/streams` with push types (options passthrough, no username required).
- [x] [Review][Patch] **`publisher.publish` call unverified** [tests/streaming/adapters/base-adapter.test.js] — no spy/assertion that `publisher.publish` is called with correct payload shape.
- [x] [Review][Defer] **Missing `Last-Event-ID` header on Mastodon SSE reconnect** [src/streaming/adapters/mastodon-sse.js:74-81] — deferred: SSE resume is nice-to-have, not blocking; events still arrive on reconnect, just from latest position.
- [x] [Review][Defer] **`username` param ignored by JetstreamAdapter** [src/streaming/adapters/jetstream.js:159-162] — deferred: `options.wantedDids` is the intended API for DID filtering; `username` is for polling streams. Could add `username` → `wantedDids` mapping as convenience.

#### Rejected

_None — all findings verified as real defects._
