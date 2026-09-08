---
title: 'Epic 34: Scraper Benchmark & Reliability Suite'
type: 'epic'
created: '2026-09-08'
status: 'backlog'
epic_number: 34
priority: 'high'
sprint_estimate: '4-5 sprints'
parent_epic: null
related_epics:
  - epic-27 (Anti-Detection & Session Resilience)
  - epic-28 (Schema Drift & Selector Resilience)
  - epic-20 (Nowing Cutover)
dependencies:
  - abstract-crawler (src/core/base-crawler.js)
  - abstract-api-client (src/core/base-api-client.js)
  - redis-stream (Bull queue infrastructure)
  - prisma-schema (PostgreSQL)
spec_reference: '_bmad-output/specs/spec-scraper-benchmark/'
architecture_spine: '_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md'
change_proposal: '_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-08-benchmark-v2.md'
---

## Business Context

Nowing (B2B Lead Hub) depends on XActions to scrape 15+ platform sources (Twitter, Facebook, Threads, Shopee, TikTok Shop, TopCV, Masothue, F&B, Healthcare, etc.). Without a benchmark suite, there's no objective way to measure:
- **Stability**: Which scrapers fail silently (False 200s, login walls, Cloudflare challenges)?
- **Quality**: Which scrapers return incomplete or schema-invalid data?
- **Noise**: Which scrapers produce duplicates, spam, or false leads?
- **Cost**: Which scrapers burn proxies/accounts inefficiently?

Nowing needs a **Health Score (0-100)** and **Tier (A/B/C)** per scraper to prioritize maintenance, allocate proxy budgets, and gate ingestion from degraded sources.

## Scope

**In Scope:**
- CAP-1: Synthetic Canary Probes (hourly health checks per platform)
- CAP-2: Production Telemetry Hooks (AbstractCrawler emits per-run telemetry to Redis Stream)
- CAP-3: Benchmark Scoring Engine (4-pillar scoring: Stability 35%, Quality 30%, Noise 20%, Cost 15%)
- CAP-4: Operator Scorecard CLI + Dashboard + Nowing `benchmark_health` flag (Tier C = alert-only, human-in-the-loop)
- CAP-5: Noise & Relevance Metrics (duplicate ratio, spam detection, contact accuracy)

**Out of Scope:**
- No auto-remediation or self-healing (Epic 27/28 handles this)
- No external telemetry/APM (runs within existing Node.js/Prisma/Redis/Bull stack)
- No standalone billing or customer-facing API (internal Nowing operations only)

## Architecture Decisions

- **AD-23**: Two-Tier Telemetry Architecture (Redis Stream raw → PostgreSQL aggregated)
- **AD-24**: Non-Blocking Telemetry Emission (setImmediate, circuit breaker drops at >1,000 buffer)
- **AD-25**: Centralized Instrumentation (zero platform crawler touch)
- **AD-26**: Hard Knock-Out Gates (True Success <80% OR Field Fill <85% OR False 200 >15% → force Tier C)
- **AD-27**: Alert-Only Tier C (human-in-the-loop, no auto-cutoff)
- **AD-28**: Category-Aware Metrics (social/ecommerce/directory/registry/fnb/healthcare/legal profiles)

## Stories

| Story | Title | Phase | Estimate |
|-------|-------|-------|----------|
| 34.1 | Benchmark Telemetry Schema & Storage | MVP | 1 sprint |
| 34.2 | Production Telemetry Hooks in AbstractCrawler | MVP | 1 sprint |
| 34.3 | Platform-Specific Validators & False-200 Detection | MVP | 1 sprint |
| 34.4 | Benchmark Scoring Engine | MVP | 1 sprint |
| 34.5 | Operator Scorecard CLI & Dashboard | MVP | 1 sprint |
| 34.6 | Nowing Integration Health Flag & Stream Events | MVP | 0.5 sprint |
| 34.7 | Synthetic Canary Probe Scheduler | Hardening | 0.5 sprint |
| 34.8 | Active Alerting & Re-qualification Workflow | Hardening | 0.5 sprint |

**Total:** 8 stories, ~5 sprints

## Success Metrics

- All 15+ platform scrapers graded Tier A/B/C with defensible Health Score
- Nowing receives thin events with `benchmark_health` + `benchmark_alert` fields
- Tier C scrapers trigger operator alerts (Telegram/Slack) but Nowing ingestion continues under human oversight
- Benchmark telemetry overhead <1% latency (NFR-19)
- Canary probes run hourly per platform (NFR-20)

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Telemetry write amplification (DB bloat) | Two-tier: Redis Stream raw → PostgreSQL aggregated rollups only |
| Latency overhead violates NFR-19 (<1%) | Fire-and-forget `setImmediate`, in-memory ring buffer, batch flush |
| False 200 detection misses edge cases | Platform-specific validators in `src/core/platform-validator.js`, canary tests |
| Compensatory masking (weak scraper scores Tier B) | Hard knock-out gates: True Success <80% OR Field Fill <85% → force Tier C |
| Low-volume scrapers (Masothue, Muasamcong) divide-by-zero | Story 34.7 canary probes + `safeRatio()` fallback |

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md`
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md`
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md`
- Change Proposal: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-09-08-benchmark-v2.md`
- Review Synthesis: `_bmad-output/planning-artifacts/review-epic34-synthesis-2026-09-08.md`
