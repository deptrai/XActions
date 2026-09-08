---
title: 'Story 34.2: Production Telemetry Hooks in AbstractCrawler'
type: 'feature'
created: '2026-09-08'
status: 'backlog'
epic: 34
story_number: 34.2
phase: 'MVP'
priority: 'high'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - src/core/base-crawler.js
  - src/core/base-client.js
  - src/store/prisma-store.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Each of the 15+ platform scrapers currently emits no benchmark telemetry. Modifying every platform crawler individually is error-prone and violates encapsulation. Centralizing telemetry in `AbstractCrawler` and `AbstractApiClient` gives all scrapers benchmark coverage automatically.

**Approach:**
1. Instrument `AbstractCrawler.start(command)` — create a `TelemetryContext` (`runId`, `scraperId`, `platform`, `category`, `action`), attach to `session.telemetry`, and capture start/duration/itemCount/error in a `finally` block. `itemCount` uses `extractItemCount(result)` per AD-33.
2. Instrument `AbstractApiClient.request()` (`src/core/base-client.js`) to record `latencyMs`, `httpStatus`, `proxyBytes`, `retries`, `proxyQuarantined`, `isFalse200`, `isCheckpoint` into `session.telemetry` (or `options.telemetryContext`) when present.
3. Integrate `PrismaStore.storeBatch()` to capture `duplicate` count and `schema_valid` per batch.
4. Emit one `telemetry:run` event plus one `telemetry:request` event per recorded transport attempt via `telemetryEmitter.emit()` (fire-and-forget, flat `Record<string,string>` per AD-29).

## Boundaries & Constraints

**Always:**
- Zero modification to platform crawler subclasses (AD-25).
- Non-blocking emission: wrap in `setImmediate` exclusively (`queueMicrotask` is forbidden — microtasks starve the event loop under high concurrency and violate NFR-19) with `.catch(() => {})`.
- `proxy_bytes` derived from transport layer (`content-length` or buffer length), never re-serialize response.
- `duplicate` computed from `createMany skipDuplicates` delta, not a separate `SELECT`.

**Ask First:**
- If changing `AbstractCrawler.start()` signature or return shape.

**Never:**
- Do NOT modify `src/scrapers/*/{client,crawler}.js` files.
- Do NOT block the scraper return path on telemetry failure.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Crawl success | `crawler.start({action:'search',args:{...}})` | Telemetry emitted with `itemCount`, `latency_ms`, `true_success: true` | Emitter crash → logged, not thrown |
| Crawl error | Exception thrown in handler | Telemetry emitted with `error`, `true_success: false` | Same as above |
| API request | `client.request(url, opts)` | Telemetry emitted with `latency_ms`, `http_status`, `proxy_bytes`, `retries` | Network error → `http_status: 0` |
| Batch store | `store.storeBatch(items)` | Telemetry emits `duplicate_rate`, `schema_valid` count | Dedup conflict count from `skipDuplicates` |

</frozen-after-approval>

## Code Map

- `src/core/base-crawler.js` — `AbstractCrawler.start()` instrumentation
- `src/core/base-client.js` — `AbstractApiClient.request()` instrumentation
- `src/core/telemetry-emitter.js` — emitted-to-Redis helper
- `src/store/prisma-store.js` — deduplication and schema validation counters
- `src/core/types.js` — type definitions for `BenchmarkTelemetry` payload

## Technical Notes

### AbstractCrawler.start() Hook

```javascript
// Within AbstractCrawler.prototype.start(command)
const startTime = Date.now();
let error = null;
let result = null;

try {
  result = await entry.handler(command.args, session);
  return result;
} catch (err) {
  error = err;
  throw err;
} finally {
  const durationMs = Date.now() - startTime;
  this.emitTelemetry({
    action: command.action,
    durationMs,
    itemCount: Array.isArray(result) ? result.length : (result ? 1 : 0),
    error,
    session,
  }).catch(() => {}); // Non-blocking fire-and-forget
}
```

### AbstractApiClient.request() Metrics

- `latency_ms`: `Date.now() - requestStart`
- `http_status`: response.status
- `proxy_bytes`: `response.headers.get('content-length')` or `Buffer.byteLength(responseBody)`
- `retries`: retry counter
- `proxy_quarantined`: `true` if 429/403 governor quarantine
- `checkpoint`: `true` if login/ban checkpoint detected

### PrismaStore Batch Metrics

- `duplicate_rate`: `totalItems - actuallyInserted` (via `createMany` `skipDuplicates: true`)
- `schema_valid`: count of items passing `MetadataSchemaRegistry.validateMetadata()` in `PrismaStore.storeBatch()` (Post.metadata validation — not thin-event schema)

## Acceptance Criteria

- [ ] `AbstractCrawler.start()` emits telemetry for all platform crawlers (zero platform files changed).
- [ ] `AbstractApiClient.request()` emits per-request telemetry with latency, status, proxy bytes, retries.
- [ ] `PrismaStore.storeBatch()` reports duplicate ratio and schema validity per batch.
- [ ] Telemetry overhead <1% of scrape latency (NFR-19), verified by `tests/benchmark/nfr-performance.test.js`.
- [ ] Integration test: run any scraper through `AbstractCrawler` and verify a telemetry event reaches Redis Stream.

## Dependencies

- Depends on: Story 34.1 (telemetry schema & storage), `AbstractCrawler`, `AbstractApiClient`
- Blocks: Story 34.4 (scoring engine), Story 34.6 (Nowing flag)

## Test Strategy

- **Unit tests**: `tests/benchmark/abstract-crawler-telemetry.test.js`, `tests/benchmark/abstract-api-client-telemetry.test.js`
- **NFR tests**: `tests/benchmark/nfr-performance.test.js` (measure overhead)
- **Integration tests**: `tests/benchmark/telemetry-pipeline.test.js`

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` (CAP-2)
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (Pillar 1-4 metrics)
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md` (AD-24, AD-25)
