---
title: 'Story 34.7: Synthetic Canary Probe Scheduler'
type: 'feature'
created: '2026-09-08'
status: 'backlog'
epic: 34
story_number: 34.7
phase: 'Hardening'
priority: 'medium'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - api/services/benchmark/canary-runner.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Low-volume scrapers (Masothue, Muasamcong, directory platforms) may not produce production telemetry often enough for meaningful scoring. Canary probes provide a consistent baseline of health signals independent of traffic.

**Approach:**
1. Create `api/services/benchmark/canary-runner.js` — `node-cron` hourly scheduler (existing `retentionScheduler.js` pattern; Bull cannot consume Redis Streams and is not needed here).
2. Run hourly probes per platform against fixed test URLs.
3. Execute the same `AbstractCrawler.start()` flow with `session.isCanary = true` and telemetry `source: "canary"` — governor bypasses account velocity/quota accounting for canary traffic (AD-33).
4. On auth-required platforms, use **dedicated probe accounts** tagged `probe: true` in `AccountPool`, routed with `consumerId: "internal"` and `pool: "bulk"` so canary does not consume the AD-20 realtime partition (AD-35).
5. Record results in `ScraperCanaryRun` and feed into scoring engine.

## Boundaries & Constraints

**Always:**
- Canary URLs must be stable, public, and representative of the platform's data shape.
- Probes run hourly (NFR-20).
- Canary results count toward True Success Rate and False 200 Rate.
- Probe accounts must be isolated from production accounts; if none are available, canary logs `isSuccess: false` and does not fall back to customer accounts (AD-35).
- Canary probes use the same validators and telemetry path as production runs, tagged `source: "canary"` and with `session.isCanary = true` so they never consume production account velocity (AD-33).

**Ask First:**
- Before adding authentication or paid API calls to canary runs.

**Never:**
- Do NOT use canary runs to bypass rate limits or quotas.
- Do NOT run canary probes on every scrape — schedule only.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Canary run | `canaryRunner.probe('twitter-hybrid')` | `ScraperCanaryRun` row + telemetry event | Timeout → `isSuccess: false` |
| False 200 | Cloudflare challenge page | `false200Detected: true`, `isSuccess: false` | Log reason |
| Checkpoint | Login wall | `checkpointDetected: true`, `isSuccess: false` | Alert |
| Valid response | Expected data structure | `isSuccess: true`, `latencyMs` recorded | Continue |
| Zero platforms | No configured canary URLs | Skip scheduling | Warning log |

</frozen-after-approval>

## Code Map

- `api/services/benchmark/canary-runner.js` — probe scheduler + executor
- `src/benchmark/canary-config.js` — per-platform test URL list
- `src/core/telemetry-emitter.js` — `type: "canary"` flag
- `tests/benchmark/canary-runner.test.js` — probe execution and results

## Technical Notes

### Canary Config Example

```javascript
const CANARY_URLS = {
  'twitter-hybrid': [
    'https://x.com/nasa',           // stable public profile
    'https://x.com/search?q=news',  // stable search
  ],
  'pasgo-merchant': [
    'https://pasgo.vn/nha-hang',    // stable category page
  ],
  'masothue': [
    'https://masothue.com/',        // stable homepage
  ],
};

const PROBE_ACCOUNTS = {
  'twitter-hybrid': 'probe-twitter-001',
  'facebook-hybrid': 'probe-facebook-001',
  // One dedicated probe account per auth-required platform (AD-35)
};
```

### Canary Run Flow

1. Bull worker triggers `canaryRunner.probeAll()` every hour.
2. For each platform, iterate `CANARY_URLS`.
3. Call `AbstractCrawler.start({ action: 'canary', url: canaryUrl })`.
4. Capture result via `telemetryEmitter.emit({ type: 'canary', ... })`.
5. Write to `ScraperCanaryRun` and `stream:benchmark:telemetry`.

### Scheduling

- Cron: `0 * * * *` (hourly).
- Timeout per probe: 30s.
- Retry: once on timeout, then mark `isSuccess: false`.

## Acceptance Criteria

- [ ] `canaryRunner` executes hourly for all configured platforms.
- [ ] `ScraperCanaryRun` rows record `isSuccess`, `latencyMs`, `httpStatus`, `false200Detected`, `checkpointDetected`.
- [ ] Canary telemetry events flow into `stream:benchmark:telemetry` and are scored.
- [ ] `tests/benchmark/canary-runner.test.js` covers success, timeout, False 200, checkpoint, and probe-account fallback behavior (AD-35).
- [ ] NFR-20: at least 24 canary runs per platform per day.

## Dependencies

- Depends on: Story 34.1, Story 34.3 (validators)
- Blocks: Story 34.4 (scoring engine uses canary data), Story 34.8 (re-qualification needs canary history)

## Test Strategy

- **Unit tests**: `tests/benchmark/canary-runner.test.js` (probe execution, result recording)
- **Integration tests**: `tests/benchmark/telemetry-pipeline.test.js` (canary events in stream)
- **NFR tests**: `tests/benchmark/nfr-performance.test.js` (probe completes <30s)

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` (CAP-1)
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (True Success Rate, P95 Latency)
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md` (AD-23)
