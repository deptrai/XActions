---
title: 'Story 34.8: Active Alerting & Re-qualification Workflow'
type: 'feature'
created: '2026-09-08'
status: 'backlog'
epic: 34
story_number: 34.8
phase: 'Hardening'
priority: 'medium'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - api/services/benchmark/alerting.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Passive dashboards are insufficient for human-in-the-loop operations outside business hours. Tier C scrapers need active alerting, and operators need a re-qualification workflow to promote scrapers back to Tier B/A after fixes.

**Approach:**
1. Implement `api/services/benchmark/alerting.js` — push notifications via Telegram/Slack/Webhook.
2. Alert triggers: `benchmark_alert: true` on thin events, or `tier` drops to `C` in `ScraperHealthScore`.
3. Re-qualification: scraper must produce **5 consecutive** clean `ScraperCanaryRun` rows (`isSuccess` + no `false200Detected`/`checkpointDetected`) to promote Tier C → B → A via `BenchmarkStateManager` — promotion sets `requalifiedAt` so the rolling 24h window ignores pre-promotion failures (AD-31).
4. Store alert history in `ScraperHealthScore` or a dedicated `BenchmarkAlert` table; tier transitions flow through `BenchmarkStateManager` (single writer, `requalifiedAt` epoch) so hourly rollups cannot reverse a promotion (AD-31).

## Boundaries & Constraints

**Always:**
- Alerts are operator notifications only — no automatic scraper shutdown or cutoff.
- Re-qualification requires sustained clean runs, not a single success.
- Alert channels configurable via environment variables.

**Ask First:**
- Before adding PagerDuty or paid alerting services.
- Before changing the Tier C policy from alert-only to auto-cutoff.

**Never:**
- Do NOT auto-pause or auto-delete Tier C scrapers.
- Do NOT send alerts for every single thin event — aggregate alerts per scoring window.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Tier C detected | `ScraperHealthScore.tier = 'C'` | Alert sent via Telegram/Slack/Webhook | Alert channel fail → log, continue |
| Repeated Tier C | Second consecutive C score | Escalated alert | Dedup within 1h |
| Re-qualification | 5 consecutive clean runs | Promote Tier C → B, notify | Reset counter on failure |
| Alert suppression | `BENCHMARK_ALERTS=false` | No outbound alerts | Still record in DB |

</frozen-after-approval>

## Code Map

- `api/services/benchmark/alerting.js` — Telegram/Slack/Webhook dispatcher
- `api/services/benchmark/requalification.js` — promotion logic
- `api/services/benchmark/retention-cleaner.js` — `ScraperHealthScore`/`ScraperCanaryRun` cleanup (AD-36)
- `src/benchmark/state-manager.js` — trigger alerts on tier change
- `src/cli/commands/benchmark.js` — `xactions benchmark alerts` subcommand
- `tests/benchmark/alerting.test.js` — alert dispatch and re-qualification

## Technical Notes

### Alert Channels

```javascript
const ALERT_CHANNELS = {
  telegram: { enabled: !!process.env.TELEGRAM_BOT_TOKEN, send: sendTelegram },
  slack: { enabled: !!process.env.SLACK_WEBHOOK_URL, send: sendSlack },
  webhook: { enabled: !!process.env.BENCHMARK_WEBHOOK_URL, send: sendWebhook },
};
```

### Alert Payload

```json
{
  "alert_id": "uuid",
  "scraper_id": "pasgo-merchant",
  "platform": "pasgo",
  "previous_tier": "B",
  "current_tier": "C",
  "health_score": 62.1,
  "reason": "False 200 Rate > 15%",
  "evaluated_at": "2026-09-08T10:00:00Z",
  "action": "manual_review_required"
}
```

### Re-qualification Rules

- **C → B**: 5 consecutive clean canary/production runs (no False 200, no checkpoint, `true_success >= 0.9`).
- **B → A**: composite score ≥ 90 for 3 consecutive scoring windows.
- **Reset**: any run violating knock-out gates resets the clean-run counter.

### Alert Deduplication

- Do not send more than 1 alert per scraper per hour.
- Aggregate multiple Tier C triggers into a single alert message.

## Acceptance Criteria

- [ ] Tier C detection triggers an outbound alert via configured channels.
- [ ] `benchmark_alert: true` on thin events is counted but does not send individual alerts.
- [ ] Re-qualification workflow promotes scraper after 5 clean runs.
- [ ] `xactions benchmark alerts` shows recent alert history.
- [ ] `tests/benchmark/alerting.test.js` covers dispatch, dedup, and re-qualification.
- [ ] Alert payload includes reason and `action: "manual_review_required"`.

## Dependencies

- Depends on: Story 34.4, Story 34.6, Story 34.7
- Blocks: Epic 34 retrospective (final operational readiness)

## Test Strategy

- **Unit tests**: `tests/benchmark/alerting.test.js`, `tests/benchmark/requalification.test.js`
- **Integration tests**: `tests/benchmark/nowing-integration.test.js` (alert flag in stream)
- **E2E tests**: `tests/benchmark/alerting-e2e.test.js` (mock Telegram/Slack endpoint)

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` (CAP-4, Assumption)
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (Tier Classification)
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md` (AD-27)
