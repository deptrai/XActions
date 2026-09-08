---
title: 'Story 34.4: Benchmark Scoring Engine'
type: 'feature'
created: '2026-09-08'
status: 'backlog'
epic: 34
story_number: 34.4
phase: 'MVP'
priority: 'high'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - src/benchmark/scoring-engine.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Raw telemetry events are scattered across Redis Stream. Nowing needs a single Health Score (0-100) and Tier (A/B/C) per scraper to make operational decisions.

**Approach:**
1. Build `src/benchmark/scoring-engine.js` — triggered by `node-cron` hourly tick (existing `retentionScheduler.js`/`facebookScheduler.js` pattern) or Bull enqueued job; consumes the Redis Stream via `telemetry-consumer`.
2. Consume `stream:benchmark:telemetry` hourly, compute 1-hour and 24-hour rollups.
3. Apply 4-pillar weighted formula: `0.35×Stability + 0.30×Quality + 0.20×Noise + 0.15×Cost`.
4. Apply hard knock-out gates: True Success <80% OR Field Fill <85% OR False 200 >15% OR Schema Integrity <90% → force Tier C.
5. Persist results to `ScraperHealthScore`; tier transitions go through `BenchmarkStateManager` (single writer) which updates `hash:scraper:health_tier` — the scoring engine never writes the hash directly (AD-31).

## Boundaries & Constraints

**Always:**
- Use linear interpolation `normalized_score_i = clamp(100 * (metric - fail) / (target - fail), 0, 100)` (metrics-catalog.md).
- Exclude N/A metrics from denominator per category profile (social/ecommerce/directory/registry/fnb/healthcare/legal).
- `safeRatio(numerator, denominator, fallback = 1.0)` for division-by-zero.
- Non-compensatory: knock-out gates override composite score.

**Ask First:**
- Before changing weight values or adding new knock-out gates.

**Never:**
- Do NOT let a low score in one pillar be masked by high scores in others if a knock-out gate is triggered.
- Do NOT write every raw telemetry event to PostgreSQL.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Hourly scoring run | Consume 1h of telemetry | `ScraperHealthScore` row per scraper | Zero events → skip scraper |
| Knock-out gate | `true_success < 0.8` | Force Tier C, log reason | Composite score ignored |
| N/A metric | `comment_completeness` on Masothue | Exclude from denominator | Re-normalize weights |
| Zero records | `field_fill_rate = safeRatio(filled, 0, 0)` | Treated as 0 (quality drops) | No crash |
| First-time scraper | No telemetry in window | No score written | Health tier defaults to `B` |

</frozen-after-approval>

## Code Map

- `src/benchmark/scoring-engine.js` — aggregation + scoring + knock-out gates
- `api/services/benchmark/telemetry-consumer.js` — Redis Stream consumer-group reader (`XREADGROUP`/`XACK`)
- `src/utils/safe-ratio.js` — shared utility
- `src/utils/redis-stream-publisher.js` — health tier cache update
- `tests/benchmark/scoring-engine.test.js` — math and edge cases

## Technical Notes

### Scoring Formula (metrics-catalog.md)

```javascript
pillar_score = Σ(weight_i * normalized_score_i) / Σ(weight_i)   // applicable metrics only
normalized_score_i = clamp(100 * (metric - fail) / (target - fail), 0, 100)
```

### Weights

| Pillar | Weight |
|--------|--------|
| Stability | 0.35 |
| Quality | 0.30 |
| Noise | 0.20 |
| Cost | 0.15 |

### Hard Knock-Out Gates

```javascript
const KNOCK_OUT_GATES = [
  { name: 'true_success', condition: v => v < 0.80, reason: 'True Success Rate < 80%' },
  { name: 'field_fill_rate', condition: v => v < 0.85, reason: 'Essential Field Fill Rate < 85%' },
  { name: 'false_200_rate', condition: v => v > 0.15, reason: 'False 200 Rate > 15%' },
  { name: 'schema_integrity_rate', condition: v => v < 0.90, reason: 'Schema Integrity Rate < 90%' },
];
```

### Category-Specific Metric Profiles

| Category | Excluded Metrics |
|----------|------------------|
| `social` | — |
| `ecommerce` | `comment_completeness` |
| `directory` | `comment_completeness`, `contact_accuracy` |
| `registry` | `comment_completeness`, `contact_accuracy`, `data_freshness` |
| `fnb` | `comment_completeness` |
| `healthcare` | `comment_completeness` |
| `legal` | `comment_completeness` |

### Aggregation Windows

- **1-hour**: rolling window, updates every hour.
- **24-hour**: daily rollup, persisted at 00:00 UTC.
- Retention: `ScraperHealthScore` rows retained 90 days.

## Acceptance Criteria

- [ ] `scoring-engine.js` computes Health Score for all platforms using 4-pillar formula.
- [ ] Knock-out gates correctly force Tier C when thresholds are crossed.
- [ ] `safeRatio` prevents division-by-zero crashes on zero-record runs.
- [ ] `hash:scraper:health_tier` in Redis is updated after each scoring run.
- [ ] `tests/benchmark/scoring-engine.test.js` covers math, gates, and edge cases.
- [ ] A 24-hour synthetic dataset produces correct scores per platform.

## Dependencies

- Depends on: Story 34.1 (schema), Story 34.2 (telemetry), Story 34.3 (validators)
- Blocks: Story 34.5 (CLI/dashboard), Story 34.6 (Nowing flag)

## Test Strategy

- **Unit tests**: `tests/benchmark/scoring-engine.test.js` (formulas, interpolation, gates, safeRatio)
- **Integration tests**: `tests/benchmark/telemetry-pipeline.test.js` (end-to-end scoring)
- **NFR tests**: `tests/benchmark/nfr-performance.test.js` (scoring run completes <500ms per scraper)

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` (CAP-3)
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (Normalization & Scoring Math, Hard Knock-Out Gates, Category-Specific Metric Profiles)
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md` (AD-26, AD-28)
