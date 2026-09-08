---
id: SPEC-scraper-benchmark
companions:
  - metrics-catalog.md
sources:
  - conversation:benchmark-framework-4-pillars
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# XActions Scraper Benchmark Suite

## Why

A dedicated scraping microservice for Nowing cannot be trusted until its output is measurable. XActions currently runs 15+ platform scrapers without a unified standard for reliability, data quality, noise, or cost. Every downstream decision — Nowing lead ingestion, proxy budget allocation, scraper maintenance priority — depends on knowing which scraper is healthy, which is degraded, and which is silently failing. This spec exists to close the measurement gap before any further feature development proceeds.

## Capabilities

- **CAP-1**
  - **intent:** Every scraper is probed on a schedule with fixed test URLs to measure operational health independent of production traffic.
  - **success:** Canary probes run hourly per platform; each probe records True Success Rate, P95 latency, checkpoint/ban rate, and proxy quarantine rate; results are stored in a queryable benchmark table.

- **CAP-2**
  - **intent:** Production scraper runs emit structured telemetry so benchmark scoring reflects real-world conditions, not just synthetic probes.
  - **success:** AbstractCrawler emits per-run telemetry (field-fill rate, schema integrity, data freshness, latency, proxy bandwidth, account burn, deduplication noise) to Redis Stream or a benchmark table with < 1% overhead.

- **CAP-3**
  - **intent:** A scoring engine aggregates raw telemetry and canary results into a single Health Score per scraper.
  - **success:** Each scraper receives a 0-100 score using the formula 0.35×Stability + 0.30×Quality + 0.20×Noise + 0.15×Cost; scores are persisted with timestamp and platform for trend analysis.

- **CAP-4**
  - **intent:** Operators and Nowing see scraper health at a glance, and Tier C scrapers emit `benchmark_health: "C"` and operator alerts; Nowing feed continues with a warning flag (human-in-the-loop, no automatic ingestion cutoff).
  - **success:** CLI command `xactions benchmark` returns per-scraper scores; dashboard health matrix shows Tier A/B/C color coding; thin events to Nowing carry `benchmark_health` and `benchmark_alert` fields; Tier C scrapers trigger operator alerts but ingestion is NOT halted automatically.

- **CAP-5**
  - **intent:** Deduplication and contact-accuracy metrics quantify how clean incoming leads are before they reach Nowing.
  - **success:** Duplicate ratio and phone/email validation rate are computed per platform and included in the Noise pillar score.

## Constraints

- XActions is a dedicated scraping microservice for Nowing (B2B Lead Hub), not a standalone SaaS product — all metrics and thresholds must serve Nowing data-pipeline quality.
- Benchmark must not require external paid telemetry or APM service — runs within existing Node.js/Prisma/Redis/Bull stack.
- Must distinguish True Success from False 200 OK (Cloudflare/Arkose/login-walled responses) via platform-specific validators and artifact fingerprinting.

## Non-goals

- No standalone billing or external customer-facing benchmark API — this spec targets internal Nowing operations and XActions operator dashboards.
- No live auto-remediation or self-healing in this scope — benchmark reports and gates, it does not fix selector drift or re-enable quarantined scrapers.
- No competitive or market-facing DaaS benchmarking — keep focus on Nowing ingestion health, not external platform ranking.

## Success signal

An operator runs `xactions benchmark` and sees every platform scraper graded Tier A/B/C with a defensible Health Score; Nowing receives a feed where Tier C scrapers are tagged `benchmark_health: "C"` and `benchmark_alert: true`, with operator alerts firing, but ingestion continues under human oversight until manual cutoff is decided.

## Assumptions

- Canary probes run hourly on a representative sample of URLs per platform, telemetry collected continuously during production runs.

## Open Questions

*(resolved in memlog; see .memlog.md)*

- Does Nowing want the benchmark score to pause ingestion automatically (Tier C cutoff) or only raise operator alerts (human-in-the-loop)?
- Should benchmark include scraping of production data or only dedicated canary URLs to avoid inflating proxy cost?
