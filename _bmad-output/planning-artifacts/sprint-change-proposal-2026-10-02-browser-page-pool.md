---
title: 'Sprint Change Proposal — Browser Page Pool (Epic 53 / AD-24)'
type: 'sprint-change-proposal'
created: '2026-10-02'
author: 'Winston (System Architect)'
trigger_artifact: '_bmad-output/implementation-artifacts/spike-browser-page-pool.md'
mode: 'batch'
scope_classification: 'moderate'
status: 'approved'
---

# Sprint Change Proposal — Browser Page Pool (Epic 53 / AD-24)

## Section 1 — Issue Summary

**Problem.** XActions' scrape execution model is **launch-per-job**: every Bull job calls `adapter.launch()` → a dedicated browser process (~300–500MB Chrome, ~30MB Obscura). Bull `scrapeQueue.process('scrape', 2)` caps concurrency at 2 not because of logic but because each job carries a full browser's RAM. This caps throughput and directly undercuts **NFR-11 (≥85% RAM reduction)** and **NFR-12 (5–10x speed)** — goals that are unreachable while the unit of work is a whole browser process.

**Discovery.** Spike `spike-browser-page-pool.md` (2026-10-02) measured the alternative: **one shared browser process serving N jobs via per-job pages/contexts**. Evidence (`scripts/browser-pool-spike-results/`):

| Mode | Wall (4 jobs) | ΔRSS | nav p95 | page-acquire p50 | State leak |
|---|---|---|---|---|---|
| launch-per-job (current) | 4061 ms | +33 MB | 314 ms | 1558 ms | n/a |
| pool-shared-context | 2022 ms | +2 MB | 54 ms | **70 ms** | **leaks** |
| pool-isolated-context | 4988 ms | +9 MB | 295 ms | 392 ms | **clean** |

**Contention sweep (chrome, isolated-context):** knee at N=8 (nav p95 437→1659 ms); bottleneck is `createBrowserContext()` serialization, not nav.
**Obscura sweep:** `createBrowserContext` is near-free (23–78ms) but nav/render is the bottleneck (nav p95 6342ms @ N=16) → Obscura's scaling axis is **more processes**, not more pages-per-connection.

**Trigger type:** Technical limitation discovered during implementation — not a new requirement.

## Section 2 — Impact Analysis

**Epic Impact.**
- `epic-35` (in-progress): story `35.5` is verification-only (live Instagram run, no code change) → **no conflict**.
- No existing epic is invalidated; pool is a new layer between Bull worker and adapter.

**New epic required:** **Epic 53 — Browser Page Pool (Sharded, Backend-Aware)**.

**Artifact conflicts / updates needed:**
- **PRD**: add **FR-146** (Browser Page Pool) — explicit traceability for the NFR-11/NFR-12 enabler. No scope cut.
- **Architecture spine** (`xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`): add **AD-24 — Browser Page Pool & Backend-Aware Sharding**. Must respect AD-23 (pluggable backend, `__backend` teardown contract, `requiresAuth` guard) and AD-3 (proxy-per-auth-mode).
- **UI/UX**: none.
- **Code surfaces**: `src/scraping/browserPool.js` (new), `src/scraping/stealthBrowser.js` (`pooled` opt), `src/scrapers/adapters/puppeteer.js` (`launch` pooled), `api/services/jobQueue.js` (thread `pooled`), telemetry `browserBackend`+`pooled` dim.

**Technical risk:** state-leak between jobs (mitigated by isolated `browserContext`), blast radius of one browser crash across N jobs (mitigated by respawn + job retry), Obscura ceiling divergence (handled by per-backend sharding policy).

## Section 3 — Recommended Approach

**Option 1 — Direct Adjustment (selected).** Add Epic 53 as a net-new, opt-in capability gated by `XACTIONS_BROWSER_POOL_SIZE` (default 0 = off). No modification to in-flight epic-35; no rollback; no MVP change.

- **Effort:** Medium (BrowserPool class + adapter hook + jobQueue thread + tests + docs).
- **Risk:** Medium — contained by opt-in flag, isolated-context default, and respawn-on-crash.
- **Timeline:** no impact on current sprint; runs parallel to epic-35 closeout.

**Rationale:** additive, reversible (flag off = current behavior), evidence-backed by spike, and the only viable path to NFR-11/12 targets that launch-per-job cannot reach.

## Section 4 — Detailed Change Proposals

### 4.1 Architecture Spine — new AD-24

```
### AD-24 — Browser Page Pool & Backend-Aware Sharding [PROPOSED]
* Binds: src/scraping/browserPool.js, src/scraping/stealthBrowser.js,
        src/scrapers/adapters/puppeteer.js, api/services/jobQueue.js
* Prevents: per-job browser launch RAM blowup; Chromium IPC single-process
  bottleneck when many concurrent scrape jobs share one engine.

Rules:
 1. Pool is opt-in: XACTIONS_BROWSER_POOL_SIZE (default 0 = launch-per-job,
    preserving current behavior). Off-flag → zero change to existing paths.
 2. Isolation default: each job acquires an isolated browserContext
    (incognito-equivalent) — no cross-job cookie/storage leak. Shared-context
    mode is allowed ONLY for anonymous public scraping via explicit opt-in.
 3. Backend-aware ceiling (from spike):
      - chrome → sharded-pool: few isolated contexts per browser (≈4–6),
        spawn a second browser process past ceiling.
      - obscura → pool-of-processes: many `obscura serve` (≈30MB each),
        few pages per CDP connection (≈4). Do NOT pack many pages into one
        Obscura connection (nav/render is the bottleneck, not context-create).
 4. Teardown contract preserved: release(page) closes the context/page, never
    the shared browser; browser lifecycle owned by the pool, not the job.
 5. Post-auth guard unchanged: requiresAuth===true still rejects obscura
    (AD-23); pooled post-auth uses isolated chrome context per account.
 6. Crash containment: pool detects dead browser, respawns, and fails only the
    in-flight jobs on that browser (Bull retry re-queues them) — never silently.
 7. Telemetry: emitRun gains `pooled` + `poolBackend` + `poolWaitMs` dims when
    XACTIONS_BROWSER_BACKEND_METRICS=1.
```

### 4.2 PRD — new FR-146

```
FR-146 (Browser Page Pool — Sharded, Backend-Aware): Scrape jobs acquire a
page/context from a shared BrowserPool instead of launching a browser per job.
Opt-in via XACTIONS_BROWSER_POOL_SIZE; isolated browserContext per job by
default (no cross-job state leak); backend-aware ceiling — chrome shards across
few contexts/browser, obscura shards across multiple `obscura serve` processes.
Enables NFR-11 (≥85% RAM) and NFR-12 (5–10x) at the worker layer.
```

### 4.3 Epic 53 — Browser Page Pool (stories)

```
Epic 53: Browser Page Pool — Sharded, Backend-Aware
  53.1  BrowserPool core (acquire/release/drain/stats + isolated contexts)
  53.2  Adapter + stealthBrowser 'pooled' opt (respect __backend teardown)
  53.3  jobQueue scrape processor thread 'pooled' + Bull retry on pool crash
  53.4  Obscura pool-of-processes shard strategy + per-conn page ceiling
  53.5  Crash containment + respawn + job re-queue
  53.6  Telemetry dims (pooled/poolBackend/poolWaitMs) + spike verify gate
```

### 4.4 Code touch-points (for handoff)

| File | Change |
|---|---|
| `src/scraping/browserPool.js` | NEW — BrowserPool, ShardedPool, acquire/release/drain/stats, respawn |
| `src/scraping/stealthBrowser.js` | `pooled` option → return pooled page handle; keep teardown contract |
| `src/scrapers/adapters/puppeteer.js` | `launch()` accepts `options.pooled`; delegate to pool |
| `api/services/jobQueue.js` | scrape processor reads `job.data.pooled` / env; pass through |
| `api/services/scrapeDispatch.js` | clamp + propagate `pooled`/pool size hints |
| `scripts/browser-pool-spike.mjs` | promote to verify gate for release |
| telemetry `emitRun` | add `pooled`, `poolBackend`, `poolWaitMs` |

## Section 5 — Implementation Handoff

**Scope classification: MODERATE** — new epic + new AD + multi-file code, but opt-in and reversible; no in-flight work disturbed.

**Route to:** Product Owner (backlog: add Epic 53 to epics.md + sprint-status) → Developer agent (implement stories 53.1–53.6) → Architect (ratify AD-24 into spine).

**Success criteria:**
- `XACTIONS_BROWSER_POOL_SIZE=N>0` runs scrape jobs through the pool; flag unset → byte-identical launch-per-job behavior.
- Chrome isolated-context mode: no cross-job cookie leak (spike `isoLeak=false`).
- Obscura mode: sharded across processes; no single-connection nav collapse.
- RAM/job reduced toward NFR-11 target; `pool-spike` report captured as evidence.

**Dependencies/sequencing:** independent of epic-35.5 (verification-only). Requires AD-23 teardown contract to remain stable. Gate: AD-24 must be ratified in spine before 53.1 merges.

---

## Decision requested

Approve this Sprint Change Proposal to add Epic 53 + AD-24 + FR-146, routed PO → Dev → Architect? (yes / edit / no)
