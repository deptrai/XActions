---
title: 'Story 34.6: Nowing Integration Health Flag & Stream Events'
type: 'feature'
created: '2026-09-08'
status: 'backlog'
epic: 34
story_number: 34.6
phase: 'MVP'
priority: 'high'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - src/utils/redis-stream-publisher.js
  - src/store/prisma-store.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing consumes thin events from `stream:social:raw_posts` but has no visibility into which scraper produced the data or whether the scraper is healthy. Tier C scrapers should still feed Nowing but must be clearly flagged so operators can intervene manually.

**Approach:**
1. Extend `ThinEvent` in `src/core/types.js` with `scraperId?`, `benchmark_health`, `benchmark_alert`; `RedisStreamPublisher.publish()` merges `healthTierCache.get(scraperId)` into the payload before `XADD` (keeps `formatPayload` synchronous).
2. Read health tier from `HealthTierCache` (in-memory Map warmed from PostgreSQL, refreshed via `HGETALL` every 30s) — never an async `HGET` inside `formatPayload`.
3. Tier C scrapers: `benchmark_health: "C"`, `benchmark_alert: true` — alert fires but ingestion continues (AD-27).
4. Non-Tier C scrapers: `benchmark_health: "A"` or `"B"`, `benchmark_alert: false`.

## Boundaries & Constraints

**Always:**
- Tier C = alert-only, NOT auto-cutoff (human-in-the-loop).
- Health tier lookup from in-memory `HealthTierCache` (sync, O(1), refreshed every 30s from `hash:scraper:health_tier`) — not per-event `HGET`.
- Resolve missing tier to `"UNKNOWN"` (never `"B"`) — `"B"` masks un-benchmarked scrapers; if PostgreSQL has a Tier C record within 24h, resolve to `"C"` (fail-safe per AD-32).
- Emit thin event regardless of health tier.

**Ask First:**
- Before changing Nowing consumer contract or adding automatic cutoff logic.

**Never:**
- Do NOT drop or delay thin events based on health tier.
- Do NOT query PostgreSQL per event for health tier.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Tier A scraper | `benchmark_health: "A"` | Thin event tagged | No alert |
| Tier B scraper | `benchmark_health: "B"` | Thin event tagged | No alert |
| Tier C scraper | `benchmark_health: "C"` | Thin event tagged + `benchmark_alert: true` | Alert fires |
| Missing tier | `benchmark_health: "B"` | Thin event tagged | Fallback |
| Cache failure | `benchmark_health: "B"` | Thin event tagged | Log warning |

</frozen-after-approval>

## Code Map

- `src/utils/redis-stream-publisher.js` — `formatPayload()` enrichment with health fields
- `src/benchmark/health-tier-cache.js` — `getHealthTier(scraperId)` helper
- `src/store/prisma-store.js` — thin event publishing path
- `tests/benchmark/nowing-integration.test.js` — end-to-end thin event verification

## Technical Notes

### Payload Enrichment

```javascript
// In RedisStreamPublisher.publish(item, scraperId) — async, before XADD; formatPayload stays sync
const healthTier = await this.getHealthTier(scraperId); // Redis hash lookup
const payload = {
  ...item,
  benchmark_health: healthTier,
  benchmark_alert: healthTier === 'C',
  benchmark_ts: new Date().toISOString(),
};
```

### Cache Structure

- Key: `hash:scraper:health_tier`
- Field: `scraperId` (e.g., `twitter-hybrid`)
- Value: `A`, `B`, or `C`
- Default: `B` if missing

### Nowing Consumer Contract

Nowing receives thin events with:
```json
{
  "post_id": "...",
  "platform": "twitter",
  "benchmark_health": "C",
  "benchmark_alert": true,
  ...
}
```

Nowing should:
- Continue ingestion for all tiers.
- Surface `benchmark_alert` in lead scoring or operator dashboard.
- NOT auto-block Tier C (human decides cutoff).

## Acceptance Criteria

- [ ] Every thin event emitted to `stream:social:raw_posts` includes `benchmark_health` and `benchmark_alert`.
- [ ] Tier C scrapers trigger `benchmark_alert: true` but event is still emitted.
- [ ] Health tier lookup adds <1ms overhead per event.
- [ ] `tests/benchmark/nowing-integration.test.js` verifies payload fields.
- [ ] Missing/unranked scrapers default to `benchmark_health: "B"`.

## Dependencies

- Depends on: Story 34.1, Story 34.4, Story 34.5
- Blocks: Story 34.8 (alerting needs benchmark_alert field)

## Test Strategy

- **Unit tests**: `tests/benchmark/nowing-integration.test.js` (payload structure, tier lookup, alert flag)
- **Integration tests**: `tests/benchmark/telemetry-pipeline.test.js` (end-to-end)
- **E2E tests**: Verify Nowing receives flagged thin events for Tier C scraper

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` (CAP-4, Success Signal)
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (Tier Classification)
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md` (AD-27)
