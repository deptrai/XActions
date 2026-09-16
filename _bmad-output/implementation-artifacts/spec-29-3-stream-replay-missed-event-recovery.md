---
title: 'Story 29.3 — Stream Replay & Missed-Event Recovery'
type: 'feature'
created: '2026-09-16'
status: 'draft'
route: 'dispatch'
baseline_commit: ''
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
- [ ] `src/streaming/stream-replay.js` — `getStreamReplay({ streamKey, since, cursor, limit })` function
- [ ] `api/routes/streams.js` — `GET /api/streams/:id/replay` endpoint
- [ ] `src/mcp/server.js` — `x_stream_replay` MCP tool
- [ ] `src/streaming/index.js` — Export `getStreamReplay`
- [ ] `tests/streaming/stream-replay.test.js` — Tests

**Acceptance Criteria:**
- Given events in `stream:social:raw_posts`, when `GET /api/streams/:id/replay?since=<ISO>`, then return matching events in order
- Given `cursor` param, when replaying, then resume from exact entry ID
- Given `hasMore: true` + `nextCursor`, when paginating, then client can fetch next page
- Given replay via webhook, when `deliver=webhook`, then events POSTed through outbound dispatcher with `X-XActions-Replay: true` header
- Given `x_stream_replay` MCP tool, when called, then return events matching criteria

## Implementation Notes

<!-- Populated during implementation -->

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

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
