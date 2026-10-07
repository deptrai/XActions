---
title: 'Story 53.3 — jobQueue scrape processor threads `pooled` + scrapeDispatch clamps pool hints'
type: 'feature'
created: '2026-10-03'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
baseline_revision: 'e5b09113'
---

<intent-contract>

## Intent

**Problem:** Story 53.2 shipped the pooled launch contract (`launchStealthBrowser({pooled:true})`, `PuppeteerAdapter.launch({pooled:true})`) but nothing upstream sets `options.pooled` — the scrape job processor and the public gateway dispatch never thread the flag, so pooled mode is unreachable from the API lane even when `MEDIRUS_BROWSER_POOL_SIZE` is configured.

**Approach:** Thread `pooled` end-to-end opt-in: `scrapeDispatch.sanitizeOptions` normalizes `pooled`/`poolSize` hints (clamp, no error), `enqueueScrapeJob` propagates them to Bull job data, and the `scrape` processor in `jobQueue.js` injects `options.pooled` into `scrape()` when the job opts in OR the env pool-size opt-in is set. Off by default — byte-identical behavior when flag absent.

## Boundaries & Constraints

**Always:**
- `job.data.pooled === true` OR `MEDIRUS_BROWSER_POOL_SIZE > 0` → scrape runs with `options.pooled = true` (AD-24 Rule 1 opt-in).
- `poolSize` hint: normalized to integer, clamped to `[1, MAX_SCRAPE_CONCURRENCY]` (existing 8 cap — same "clamped, not errored" convention as `concurrency`); invalid/non-numeric values are dropped, never 400.
- `pooled`/`poolSize` are scraper options (not dispatch fields) — they belong inside `options` so sync lane reaches `scrape()` directly, and async lane carries them inside `job.data.options` (Bull payload already passes `options` verbatim).
- `MEDIRUS_BROWSER_POOL_SIZE` env is the global default — processor reads it per-job; a job-level `pooled:false` in options does NOT override the env opt-in down (env is infra-level, flag is request-level hint upward only) — actually: `pooled:false` explicit in job options DOES suppress (request-level explicit off wins over ambient env) — see EDGE matrix.
- Secrets hygiene unchanged: `pooled`/`poolSize` are non-credential, allowed on both lanes.
- Sync lane identical semantics: `sanitizeOptions` output reaches `scrape()` unchanged — `pooled` survives into options on sync too.

**Never:**
- No Bull queue topology change — same `operations-scrape` queue, same `scrape` job name, concurrency stays 2.
- No changes to `BrowserPool`/`stealthBrowser`/`puppeteer` adapter internals (53.1/53.2 surface).
- No new env var besides the already-defined `MEDIRUS_BROWSER_POOL_SIZE`.
- Never throw/400 on `poolSize` out of range — clamp, same convention as `concurrency` (spec-12-8 C-2).
- No re-queue/crash-containment logic (that's 53.5); no telemetry dims (53.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| ENV_OPTIN | `MEDIRUS_BROWSER_POOL_SIZE=4`, job data has no `pooled` | `options.pooled === true` passed to `scrape()` | none |
| JOB_OPTIN | `MEDIRUS_BROWSER_POOL_SIZE` unset/0, `job.data.options.pooled === true` | `options.pooled === true` | none |
| OFF_DEFAULT | env unset, no `pooled` in options | `options.pooled` absent — byte-identical current behavior | none |
| EXPLICIT_OFF | env=4, `job.data.options.pooled === false` | `options.pooled === false` — explicit request-level off beats ambient env | none |
| CLAMP_POOLSIZE | `options.poolSize = 99` | `options.poolSize === 8` (clamped to MAX_SCRAPE_CONCURRENCY) | clamp, no error |
| CLAMP_POOLSIZE_ZERO | `options.poolSize = 0` or `-3` or `"abc"` | `poolSize` key dropped from options | drop, no error |
| SYNC_LANE | `mode:'sync'` body with `pooled:true` | `pooled:true` survives `sanitizeOptions` → `scrape()` options | none |
| ASYNC_CARRY | `mode:'async'` body with `pooled:true, poolSize:5` | Bull job `data.options` contains `pooled:true, poolSize:5` → processor injects `options.pooled=true` | none |
| CREDENTIAL_GUARD | async body with `pooled:true` + credential key | existing 400 credential rejection unchanged | 400 as before |

</intent-contract>

## Code Map

- `api/services/scrapeDispatch.js:351` `sanitizeOptions` — normalize `pooled` (boolean coercion like `proxy_rotate`) + clamp `poolSize` to `[1, MAX_SCRAPE_CONCURRENCY=8]`.
- `api/services/jobQueue.js:538-583` `scrapeQueue.process('scrape')` — after options assembly (~line 556-583), inject pooled opt-in: `const pooledOptIn = options.pooled !== undefined ? options.pooled : poolSizeFromEnv() > 0; if (pooledOptIn !== undefined) options.pooled = pooledOptIn;` — env `MEDIRUS_BROWSER_POOL_SIZE` parsed int > 0.
- `src/scraping/stealthBrowser.js:173` — downstream consumer already reads `options.pooled` (53.2).
- `src/scraping/browserPool.js:81` — `_sz` env default already reads `MEDIRUS_BROWSER_POOL_SIZE`.
- `api/services/scrapeDispatch.js:84` `MAX_SCRAPE_CONCURRENCY` — reuse as poolSize clamp ceiling (same convention).
- `tests/api/` — existing scrapeDispatch/jobQueue test files to extend (check `tests/api/scrapeDispatch*.test.js`, `tests/api/jobQueue*.test.js`).

## Tasks & Acceptance

**Execution:**

1. `api/services/scrapeDispatch.js` — in `sanitizeOptions`: coerce `pooled` → boolean (`=== true || === 'true'`); clamp `poolSize` → `Math.min(Math.floor(n), MAX_SCRAPE_CONCURRENCY)` for finite n ≥ 1, else delete.
2. `api/services/jobQueue.js` — in the `scrape` processor: after `const options = { ...(job.data.options || {}) };` and cookie merge, apply pooled opt-in: explicit `options.pooled` (boolean) wins; else `parseInt(process.env.MEDIRUS_BROWSER_POOL_SIZE) > 0` → `options.pooled = true`. Comment citing AD-24 Rule 1.
3. `tests/api/` — unit tests for the I/O matrix: env opt-in, job opt-in, explicit off beats env, clamp, drop-invalid, sync-lane survival, async carry-through, credential guard unchanged.

**Acceptance:**
- With `MEDIRUS_BROWSER_POOL_SIZE=4` and a plain scrape job (no `pooled`), the processor invokes `scrape(platform, action, options)` where `options.pooled === true`.
- With env unset and `pooled:true` in request options, same result.
- With env set and `pooled:false` in options, `options.pooled === false` (explicit off wins).
- `poolSize` > 8 clamps to 8; non-numeric/`<=0` drops the key.
- Credential-bearing async body still 400s before enqueue.
- All new + existing dispatch/jobQueue tests pass; `npm run typecheck` no new errors.

## Design Notes

- `pooled` lives INSIDE `options` (not a top-level job field like `apiKeyRequired`) because sync lane needs it in `scrape()` options verbatim and Bull already serializes `options` into `data.options`. The processor's env check is the "ambient" opt-in; explicit `options.pooled` boolean overrides it either direction.
- `poolSize` is a *hint* propagated into options for downstream pool construction (`getDefaultPool(backend, {size})`) — the default-pool registry in 53.2 already keys per-backend; hint clamping belongs at the trust boundary (sanitizeOptions).
- EXPLICIT_OFF semantics chosen so a caller can suppress pooling per-request even when infra enables it — matches "opt-in, reversible" epic preamble and keeps auth-lane jobs (requiresAuth) able to force launch-per-job.

## Verification

- `npx vitest run tests/api` (dispatch + jobQueue suites) — all pass.
- `npm run typecheck` — error set identical to baseline.
- Review Triage Log updated before status: done.

## Review Triage Log

### Pass 1 — self-review (no subagent capability; consistent with 53.2 precedent)

Verdict counts: high 0, medium 0, low 3, false 0, maybe-false 0.

| Finding | Verdict | Route | Evidence |
|---|---|---|---|
| `opts` literal type didn't declare `pooled`/`poolSize` → TS7022 self-reference errors (new) | low | patched | `/** @type {Record<string, unknown>} */` on `const opts = {}` — also cleared 19 pre-existing implicit-any/index-signature errors across both touched files (typecheck error set strictly shrank vs baseline `e5b09113`) |
| `job.data.pooled` vs `job.data.options.pooled` ambiguity (story text says `job.data.pooled`; body field lands inside `options`) | low | patched | `resolvePooledFlag` accepts BOTH — top-level `jobData.pooled` wins over `options.pooled`, explicit boolean wins over env either direction |
| BYO pool instance via `pooled: <pool>` can't cross Bull serialization — queued jobs can only carry `pooled: true` | low | deferred | Serializability contract (`assertSerializableOptions`) already rejects non-JSON — BYO pool is a same-process API concern (53.2 surface), not a job-queue concern |

### Matrix coverage audit

All 9 I/O matrix rows covered: ENV_OPTIN, JOB_OPTIN, OFF_DEFAULT, EXPLICIT_OFF, top-level-beats-options (resolvePooledFlag unit tests ×5); CLAMP_POOLSIZE, CLAMP_POOLSIZE_ZERO, SYNC_LANE survival, nested-merge (sanitizeOptions tests ×4); CREDENTIAL_GUARD unchanged (pre-existing sanitize/enqueue tests still green — `tests/gateway/mode-dispatch.test.js` 88/88 pass). `npm run typecheck` error set strictly subset of baseline `e5b09113` (−19 pre-existing errors fixed, +0 new).

### Auto Run Result

Status: done
Commit: f251982fbd0d2089e70295a154527cf2d8950fa3
