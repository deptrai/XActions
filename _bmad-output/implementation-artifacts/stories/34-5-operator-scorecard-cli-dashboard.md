---
title: 'Story 34.5: Operator Scorecard CLI & Dashboard'
type: 'feature'
created: '2026-09-08'
status: 'backlog'
epic: 34
story_number: 34.5
phase: 'MVP'
priority: 'medium'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - src/cli/index.js
  - dashboard/
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Operators and Nowing analysts need a simple way to see scraper health at a glance, identify Tier C scrapers, and drill into per-metric breakdowns.

**Approach:**
1. Implement `xactions benchmark` CLI command via `registerBenchmarkCommand` in `src/cli/commands/benchmark.js` (existing `register*Command` pattern).
2. Add Dashboard view at `dashboard/benchmark/index.html` or extend existing dashboard.
3. Health matrix: rows = scrapers, columns = Stability / Quality / Noise / Cost / Health Score / Tier.
4. Tier color coding: A = green, B = yellow, C = red.
5. Drill-down: show per-metric snapshot and recent trend.

## Boundaries & Constraints

**Always:**
- CLI must work without a running dashboard server (read from PostgreSQL + Redis directly).
- Dashboard must be static HTML served by Express backend (existing pattern).
- Sub-millisecond health tier lookup from `hash:scraper:health_tier` (do not query PostgreSQL per row).

**Ask First:**
- Before adding write endpoints (pause/resume scraper) — out of scope for Epic 34.

**Never:**
- Do NOT add auto-remediation controls (Epic 27/28).
- Do NOT require dashboard for CLI to function.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| CLI summary | `xactions benchmark` | Table: scraper, healthScore, tier, 4 pillars | No data → message "No scores yet" |
| CLI filter | `xactions benchmark --tier C` | Only Tier C scrapers | No matches → empty table |
| CLI detail | `xactions benchmark --scraper twitter-hybrid` | Full metrics snapshot | Unknown scraper → 404 message |
| Dashboard health matrix | GET `/dashboard/benchmark` | HTML with color-coded table | Same fallback |
| Dashboard detail | Click row | Modal with per-metric chart | Missing snapshot → placeholder |

</frozen-after-approval>

## Code Map

- `src/cli/commands/benchmark.js` — `xactions benchmark` command
- `src/cli/index.js` — register command
- `dashboard/benchmark/index.html` — health matrix view
- `dashboard/benchmark/detail.html` or modal — per-scraper drill-down
- `api/routes/benchmark.js` (if needed) — REST endpoint for dashboard
- `src/benchmark/scoring-engine.js` — query `ScraperHealthScore` and `hash:scraper:health_tier`

## Technical Notes

### CLI Output Example

```
Scraper              Health   Tier   Stability   Quality   Noise   Cost   Sample
------------------- -------- ------ ----------- --------- ------- ------ -------
twitter-hybrid       94.2     A      95.3        92.1      96.0    92.0   1,240
facebook-hybrid      88.7     B      90.0        85.0      91.0    89.0   980
pasgo-merchant       62.1     C      70.0        80.0      40.0    50.0   320   ⚠️ ALERT
```

### Dashboard Columns

1. **Scraper ID**
2. **Platform**
3. **Health Score (bar)**
4. **Tier (badge color)**
5. **Stability, Quality, Noise, Cost (mini bars)**
6. **Sample Count**
7. **Last Evaluated**
8. **Alert Flag**

### Data Sources

- Primary: `ScraperHealthScore` (latest row per scraper)
- Cache: `hash:scraper:health_tier` (Redis hash)
- Fallback: default Tier `B` if missing

## Acceptance Criteria

- [ ] `xactions benchmark` returns a table with all scrapers, scores, tiers, and alert flags.
- [ ] `--tier` and `--scraper` filters work.
- [ ] Dashboard health matrix renders with color-coded Tier badges.
- [ ] Tier C scrapers show warning icon/alert state.
- [ ] Drill-down view shows 4-pillar breakdown and latest `metricsSnapshot`.
- [ ] Tests in `tests/benchmark/scorecard.test.js` verify CLI output and dashboard route.

## Dependencies

- Depends on: Story 34.1, Story 34.4
- Blocks: Story 34.6 (Nowing integration needs scorecard data)

## Test Strategy

- **Unit tests**: `tests/benchmark/scorecard.test.js` (CLI formatting, filters)
- **Integration tests**: `tests/benchmark/dashboard.test.js` (route returns HTML/JSON)
- **E2E tests**: `tests/benchmark/nowing-integration.test.js` (health flag in stream)

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` (CAP-4)
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (Tier Classification)
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md` (AD-27)
