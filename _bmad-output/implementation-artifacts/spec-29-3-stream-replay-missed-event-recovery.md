---
title: 'Story 29.3 — Stream Replay & Missed-Event Recovery'
type: 'feature'
created: '2026-09-16'
status: 'done'
route: 'dispatch'
baseline_commit: '0e22a72b'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Consumers who disconnect or experience downtime lose real-time events. `streamManager.getStreamHistory()` only returns recent events for polling streams (max 200). Redis Stream history exists but there's no API to replay from a specific point.

**Approach:** Add replay support: `GET /api/streams/:id/replay` endpoint that reads events from Redis Stream by cursor/timestamp range, MCP tool `x_stream_replay`, and optional delivery via the outbound webhook dispatcher (Story 29.2).

## Boundaries & Constraints

**Always:**
- Read from `stream:social:raw_posts` Redis Stream using `XRANGE` / `XREAD` with start/end IDs
- Support `since` (ISO 8601 timestamp → converted to stream ID) and `cursor` (exact stream entry ID) params
- Return events in chronological order (oldest first)
- Cap replay at configurable `limit` (default 100, max 1000)
- `X-XActions-Replay: true` header when replaying via webhook (so consumers can distinguish live vs replay)
- Redis Stream `MAXLEN` / `MINID` trimming already configured in `RedisStreamPublisher`

**Never:**
- KHÔNG store separate replay log — use Redis Stream as the source of truth
- KHÔNG replay events that have been trimmed from the stream (return error if requested range is before stream's first entry)
- KHÔNG modify `getStreamHistory` — replay is a separate API
- KHÔNG block replay on active consumer group — replay is read-only via XRANGE/XREAD (not XREADGROUP)

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Replay by time | `GET /api/streams/:id/replay?since=2026-09-16T00:00:00Z` | Events from that timestamp onward | Convert ISO → ms epoch → stream ID |
| Replay by cursor | `GET /api/streams/:id/replay?cursor=1725911162329-0` | Events after that entry ID | Use as XRANGE start (exclusive) |
| Replay with limit | `GET /api/streams/:id/replay?since=...&limit=50` | Max 50 events | Default 100, max 1000 |
| Replay empty | No events in range | `{ events: [], hasMore: false }` | N/A |
| Replay trimmed data | `since` before stream MINID | `{ events: [], warning: 'Requested range partially trimmed' }` | Return what's available |
| Replay + webhook | `?deliver=webhook&subscriptionId=xxx` | Events delivered via outbound dispatcher | Uses Story 29.2 dispatcher |
| MCP tool | `x_stream_replay { streamId, since, limit }` | Same as API | N/A |
| Invalid stream | `GET /api/streams/:id/replay` for unknown stream | 404 | N/A |
| Invalid cursor | Malformed cursor string | 400 | N/A |
| Pagination | More events than limit | `{ events: [...], nextCursor: "...", hasMore: true }` | Client uses nextCursor |

</frozen-after-approval>

## Code Map

- `src/streaming/stream-replay.js` — **NEW**: `getStreamReplay()` — reads events from Redis Stream by range
- `api/routes/streams.js` — MODIFY: Add `GET /api/streams/:id/replay` endpoint
- `src/mcp/server.js` — MODIFY: Add `x_stream_replay` tool
- `src/streaming/index.js` — MODIFY: Export replay function
- `src/streaming/outbound-webhook-dispatcher.js` — READ-ONLY: reuse for webhook delivery of replays (Story 29.2)
- `tests/streaming/stream-replay.test.js` — **NEW**: Tests

## Tasks & Acceptance

**Execution:**
- [x] `src/streaming/stream-replay.js` — `getStreamReplay({ streamKey, since, cursor, limit })` function
- [x] `api/routes/streams.js` — `GET /api/streams/:id/replay` endpoint
- [x] `src/mcp/server.js` — `x_stream_replay` MCP tool
- [x] `src/streaming/index.js` — Export `getStreamReplay`
- [x] `tests/streaming/stream-replay.test.js` — Tests

**Acceptance Criteria:**
- Given events in `stream:social:raw_posts`, when `GET /api/streams/:id/replay?since=<ISO>`, then return matching events in order
- Given `cursor` param, when replaying, then resume from exact entry ID
- Given `hasMore: true` + `nextCursor`, when paginating, then client can fetch next page
- Given replay via webhook, when `deliver=webhook`, then events POSTed through outbound dispatcher with `X-XActions-Replay: true` header
- Given `x_stream_replay` MCP tool, when called, then return events matching criteria

## Implementation Notes

- Implemented `getStreamReplay({ streamKey, streamId, since, cursor, limit, deliver, subscriptionId, streamMeta, redisClient, dispatcher, subscriptionStore })` in `src/streaming/stream-replay.js`.
- Implemented XRANGE range querying without advancing consumer group offset, dual-client parsing (ioredis RESP arrays & node-redis object formats), exclusive cursor resuming, and stream trimming detection (`warning: 'Requested range partially trimmed'`).
- Integrated webhook replay delivery via `OutboundWebhookDispatcher` injecting `X-XActions-Replay: true` header alongside HMAC signature verification.
- Added REST endpoint `GET /api/streams/:id/replay` in `api/routes/streams.js` with full validation and error status code mapping (400, 404, 200).
- Registered MCP tool `x_stream_replay` in `src/mcp/server.js`.
- Exported functions and types in `src/streaming/index.js` and `src/streaming/index.d.ts`.
- Created comprehensive test suite with 25 passing tests in `tests/streaming/stream-replay.test.js` using real Redis stream, real HTTP webhook server, real Express router, and real MCP tool execution.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log


- **patch / medium** — negative `since` → Redis invalid stream ID — `ms < 0` rejected as INVALID_SINCE.
- **patch / medium** — cursor/`lastBatchId` without dash → NaN seq — `Number.isFinite` fallback seq=1.
- **false** — NaN `limit` bypass — `Number.isFinite(rawLimit)` already defaults to 100.
- **patch / medium** — webhook delivery throw aborts replay — try/catch per event + `dispatchReplay`.
- **false / spec** — empty stream omits trim warning — matrix says return empty; warning only when firstEntry exists.
- **false / spec** — trim returns 200+warning not error — Design Notes / matrix: "Return what's available".
- **patch / medium** — Redis client per request — shared singleton client, no quit-per-call.
- **patch / medium** — unbounded filtered XRANGE scan — `maxScan = 50_000`.
- **patch / medium** — hasMore false after dropping cursor — treat `rawEntries.length > limit` as hasMore.
- **patch / medium** — `matchesStream` drops follower/mention/cdc — mapped to twitter/x/cdc/postgres.
- **patch / low** — username vs handle — also checks `author_handle`/`handle`/`username`.
- **false / spec** — 404 for unknown stream id — AC requires 404; use `id=all` for shared-stream recovery.
- **defer / low** — same-ms trim sequence — warning is best-effort; XRANGE still returns remaining entries.
- **defer / low** — empty `?since=` treated as omitted — empty query params are omitted in HTTP; malformed non-empty still 400.
- **patch / low** — invalid `deliver` silently ignored — 400 INVALID_DELIVER.
- **defer / low** — missing `sendCommand` XREVRANGE fallback — node-redis/ioredis helpers cover production clients.
- **defer / low** — `parseStreamEntry`/`matchesStream` not barrel-exported — internals; tests import module directly.
- **defer / medium** — unauthenticated replay route — same as other `/api/streams` GETs; auth is server-level.
- **patch (VG)** — REST `deliver=webhook` error mapping untested — 400/404 tests added.
- **defer (VG)** — registered-stream metadata REST test — library `matchesStream` + 404 unknown covered; createStream coupling is heavy for unit.


## Design Notes

**Stream ID format:** Redis Stream entry IDs are `<ms_timestamp>-<sequence>`. ISO 8601 `since` is converted to `<ms_epoch>-0` for XRANGE start.

**Replay vs Live:** Replay uses `XRANGE` (read-only, doesn't consume) vs live consumption which uses `XREADGROUP` (consumer group). They can coexist — replay doesn't interfere with live consumers.

**Key decision:** Replay reads from `stream:social:raw_posts` (the shared stream), not per-stream history lists. This is because:
1. Per-stream history is limited to 200 entries
2. The shared stream has configurable MAXLEN/MINID (much larger retention)
3. Push adapters (29.1) publish to the shared stream, not per-stream history

For per-stream replay, we filter the shared stream by `scraper_id` or `target_id` fields in the event data.

**Response format:**
```json
{
  "events": [
    { "id": "1725911162329-0", "data": { ...ThinEvent fields... } }
  ],
  "hasMore": true,
  "nextCursor": "1725911170000-0",
  "count": 50,
  "streamInfo": {
    "streamKey": "stream:social:raw_posts",
    "firstEntry": "1725910000000-0",
    "lastEntry": "1725911200000-0",
    "length": 15000
  }
}
```

## Verification

**Commands:**
- `node --check src/streaming/stream-replay.js` — expected: no syntax errors
- `node --check api/routes/streams.js` — expected: no syntax errors
- `npm run typecheck` — expected: 0 errors in new files
- `vitest run tests/streaming/stream-replay.test.js` — expected: all tests pass
