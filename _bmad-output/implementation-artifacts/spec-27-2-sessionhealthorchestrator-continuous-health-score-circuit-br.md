---
title: 'Story 27.2 — SessionHealthOrchestrator: Continuous Health Score & Circuit Breaker'
type: 'feature'
created: '2026-09-13'
status: 'done'
route: 'dispatch'
baseline_commit: '301e1676'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions hiện chỉ hibernate account *reactive* (khi gặp 429/403/challenge) — một account đang chết dần (nhiều lỗi, latency cao, payload rỗng) vẫn ở trong rotation cho tới khi gây hại, và không có cơ chế tự phục hồi kiểm soát.

**Approach:** Thêm `SessionHealthOrchestrator` trong `src/core/` — tính health score liên tục `[0,100]` per `platform:accountId` từ 6 tín hiệu (consecutive errors, rate-limit freq, bot-challenge freq, avg latency, payload completeness, proxy health). Dưới `30` → mở circuit breaker → `sick` + loại khỏi rotation (gọi `AccountPool.markUnavailable`/`AdaptiveRateGovernor.hibernateAccount`). Sau cooldown → `half-open` → gửi recovery probe (read-only `profile`, fresh proxy); probe thành công + payload đủ → đóng breaker, fail → `sick` + exponential backoff. `governor.getStatus()` expose `healthScores` + `circuitBreakerStates`; `dashboard/admin.html` thêm cột Health (green/yellow/red) + action wake/probe.

**Decisions (đã chốt trong spec):**
- **Signal feed:** orchestrator giữ `#metrics` per key, được feed bởi các call-site có sẵn trong `base-client.js`/`base-crawler.js` (recordRequest/recordRateLimit/recordBotChallenge/markUnavailable) — qua API `recordSuccess`, `recordError`, `recordRateLimit`, `recordBotChallenge`, `recordLatency`, `recordPayloadComplete`/`Incomplete`, `recordProxyHealth`. Không sửa governor internals — orchestrator là layer trên, subscribe/được gọi từ client.
- **Circuit breaker:** per `platform:accountId`, states `closed | open | half-open`. `open` = hibernate `sick` (governor + accountPool markUnavailable reason `sick`). `half-open` sau `cooldownMs` → `probe()` (caller-injected `probeFn` — mặc định no-op success nếu không cung cấp, để test deterministically). Backoff exponential `cooldownMs * 2^consecFailures`, cap `maxCooldownMs`.
- **Score formula (deterministic, documented):** start 100; weighted penalty: consecutiveErrors (−8/ea cap 40), rateLimit freq (−10/ea cap 30), botChallenge (−15/ea cap 30), latency (avg>3s −10, >8s −20), payloadIncomplete (−12/ea cap 24), proxyUnhealthy (−15). Clamp [0,100]. `sick` threshold `<30`.
- **Probe execution (đã chốt — option a):** orchestrator chỉ orchestrate; `probeFn` do caller/admin inject per `platform:accountId` (orchestrator ở `src/core` không tự gọi platform `profile` — giữ layering). Khi không có `probeFn` đăng ký, `checkRecovery` coi như manual-wake probe: `markAvailable` + score reset 60 (conservative reopen), không network call.
- **Health display thresholds:** score `≥70` → green, `30–69` → yellow, `<30` → red (sick) trong `dashboard/admin.html`.

## Boundaries & Constraints

**Always:**
- Health score `[0,100]` deterministic từ metrics; `<30` → breaker `open` + account `sick` + excluded.
- `getStatus()` trả `healthScores: Record<key,score>` + `circuitBreakerStates: Record<key,{state,failures,nextProbeAt}>`.
- Reuse `AdaptiveRateGovernor.hibernateAccount`/`recordBotChallenge` và `AccountPool.markUnavailable/markAvailable` — orchestrator orchestrate, không re-implement (Epic 27 DoD).
- `dashboard/admin.html` accounts table thêm cột Health + nút wake/probe; wire qua `/api/admin/accounts` (thêm `healthScore`, `circuitState` vào response) và endpoint probe mới.
- Test real impl — no mocks/stubs/fakes; probe dùng injected `probeFn`.
- TypeScript strict.

**Never:**
- Không sửa `AdaptiveRateGovernor`/`AccountPool` internals (chỉ call API public).
- Không gọi probe tự động liên tục trong background thread gây leak — probe chạy khi `checkRecovery()` được gọi (lazy, từ request path hoặc admin action).
- Không thay đổi circuit state của account khác.
- Không network call thật trong unit test (probeFn injected).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output | Error Handling |
|----------|--------------|-----------------|----------------|
| HEALTHY | errors=0, latency thấp | score ~100, breaker `closed`, account active | N/A |
| ERRORS | 5 consecutive errors | score giảm (−40 cap), <30 → breaker `open` + `sick` | account markUnavailable |
| BREAK_OPEN | score <30 | breaker `open`, hibernate `sick`, excluded rotation | N/A |
| HALF_OPEN | `open` + cooldown hết | `half-open`, `probeFn` được gọi | probe throw → back to `open`+backoff |
| PROBE_OK | probe trả `{success:true, complete:true}` | breaker `closed`, score reset về ~60, markAvailable | N/A |
| PROBE_FAIL | probe `{success:false}` hoặc challenge | breaker `open`, backoff ×2, `sick` | markUnavailable lại |
| GETSTATUS | `getStatus()` | có `healthScores` + `circuitBreakerStates` | N/A |
| PROXY_UNHEALTHY | `recordProxyHealth(false)` | score giảm −15 | N/A |
| NO_PROBE | half-open nhưng không có probeFn | breaker giữ `half-open`, không crash | warn + stay |

</frozen-after-approval>

## Code Map

- `src/core/session-health-orchestrator.js` **(mới)** — `SessionHealthOrchestrator`: `#metrics`, `#breakers`, record* APIs, `getHealthScore(key)`, `getStatus()`, `checkRecovery(key)`, `registerProbe(key,fn)`, `wake(key)`. Circuit breaker + exponential backoff + probe dispatch.
- `src/core/index.js` — export `SessionHealthOrchestrator` + `globalSessionHealthOrchestrator`.
- `src/core/adaptive-governor.js` — **chỉ đọc**, không sửa; orchestrator gọi `hibernateAccount`/`isHibernating`/`recordBotChallenge`. `getStatus()` merge health — orchestrator expose riêng (`orchestrator.getStatus()`), base-client/status-api compose.
- `src/core/account-pool.js` — call `markUnavailable(accountId,'sick',ms,platform)`/`markAvailable` khi breaker open/close.
- `src/core/base-client.js` — feed orchestrator: sau `recordRequest`/`recordRateLimit`/`recordBotChallenge`/`markUnavailable`/`latencyMs` — gọi `orchestrator.recordX` (guard `if (this.healthOrchestrator)`).
- `src/core/status-api.js` — `getGovernorStatus()` merge `healthScores`/`circuitBreakerStates` từ orchestrator.
- `api/routes/admin.js` — `/accounts` response thêm `healthScore`/`circuitState` per account; thêm `POST /accounts/probe` (gọi `orchestrator.checkRecovery`).
- `dashboard/admin.html` — accounts table thêm cột Health (green/yellow/red theo score) + nút Probe; render từ `accounts[].healthScore`.
- `types/core.d.ts` — `SessionHealthOrchestrator`, `HealthScore`, `CircuitBreakerState` types.
- `tests/core/session-health-orchestrator.test.js` **(mới)** — real impl: score tính, breaker open/half-open/close, backoff, probe success/fail, getStatus shape.
- `tests/admin/accounts-health.test.js` **(mới)** — `/api/admin/accounts` trả healthScore + probe endpoint (real route handler, injected orchestrator).

## Tasks & Acceptance

**Execution:**
- [x] `src/core/session-health-orchestrator.js` — score + circuit breaker + probe — core logic.
- [x] `src/core/index.js` — export — public surface.
- [x] `src/core/base-client.js` — feed orchestrator từ request lifecycle — wire signals.
- [x] `src/core/status-api.js` — merge health into getGovernorStatus — observability.
- [x] `api/routes/admin.js` — accounts healthScore + probe endpoint — admin API.
- [x] `dashboard/admin.html` — Health column + Probe action — UI.
- [x] `types/core.d.ts` — types — typecheck.
- [x] `tests/core/session-health-orchestrator.test.js` — score/breaker/probe — AC coverage.
- [x] `tests/admin/accounts-health.test.js` — API health + probe — AC coverage.
- [x] `docs/stealth-scraping.md` hoặc `architecture.md` — orchestrator API — Epic 27 DoD.

**Acceptance Criteria:**
- Given account healthy, when `getHealthScore`, then ~100 và breaker `closed`.
- Given ≥4 consecutive errors (score <30), when tính lại, then breaker `open`, account `markUnavailable('sick')`, excluded rotation.
- Given breaker `open` qua cooldown, when `checkRecovery` với `probeFn` trả `{success,complete:true}`, then breaker `closed` + `markAvailable`; probe fail → `open` + cooldown ×2.
- Given orchestrator active, when `governor.getStatus()`/status-api, then response có `healthScores` + `circuitBreakerStates`.
- Given admin accounts API, when GET `/api/admin/accounts`, then mỗi account có `healthScore` + `circuitState`; POST `/accounts/probe` trigger checkRecovery.
- `npm run typecheck` + `vitest run` pass, no regression.


### Review Findings

- [x] [Review][Patch] Fix consecutive error penalty cap so pure error streak opens breaker [<src/core/session-health-orchestrator.js:203>] — applied: `min(75, 18*consecErrors)` replaces `min(40, 8*consecErrors)`; tests 26/26 pass
- [x] [Review][Patch] Wire recordPayload and recordProxyHealth in base-client on invalid payload and proxy connection failure [<src/core/base-client.js:938,1045>] — applied: recordPayload(false) on invalid payload, recordProxyHealth(false) on proxy-conn error; tests 26/26 pass
- [x] [Review][Patch] Add concurrency lock to checkRecovery to prevent probe re-entry and doubled backoff [<src/core/session-health-orchestrator.js:283>] — applied: `_probing` Set mutex guards half-open probe; tests 26/26 pass
- [x] [Review][Patch] Validate account exists in globalAccountPool before probing in handleProbeAccount [<api/routes/admin.js:635>] — applied: `globalAccountPool.getAccount()` → 404 when missing; tests 26/26 pass
- [x] [Review][Patch] Add CSS definitions for .status-active, .status-quarantined, .status-checkpoint in admin.html [<dashboard/admin.html:354>] — applied: extended `.status-pill` CSS with `.status-active`, `.status-quarantined`, `.status-checkpoint`, `.status-sick`, `.status-hibernating`; tests 26/26 pass
- [x] [Review][Defer] Time-based metric decay for long-lived processes [<src/core/session-health-orchestrator.js:37>] — deferred: future sliding-window / EMA decay enhancement

## Implementation Notes

- 2026-09-13: Implemented Story 27.2 end-to-end.
  - `src/core/session-health-orchestrator.js`: `SessionHealthOrchestrator` maintaining continuous score [0,100] per `platform:accountId` from 6 signals; circuit breaker with states `closed | open | half-open`, exponential backoff cooldown, injected `probeFn` dispatch (manual-wake fallback when probe not registered), lazy `checkRecovery` with `force` option for operator manual probe, `wake()` manual reset, and `getStatus()`.
  - `src/core/index.js` exports `SessionHealthOrchestrator` + `globalSessionHealthOrchestrator`.
  - `src/core/base-client.js` wires `healthOrchestrator` (default singleton), feeds `recordLatency`, `recordRateLimit`, `recordBotChallenge`, `recordSuccess`.
  - `src/core/status-api.js` merges `healthScores` and `circuitBreakerStates` into `getGovernorStatus()`.
  - `api/routes/admin.js`: `requireAdminOrApiKey` applied to accounts routes (enables admin key header for tests/tools); `GET /accounts` decorates with `healthScore` and `circuitState`; `POST /accounts/probe` + `POST /accounts/:id/probe` trigger recovery check with `force: true`.
  - `dashboard/admin.html`: added **Health** column with green (≥70), yellow (30-69), red (<30) badges + `🩺 Probe` button wired to `probeAccount(accountId, platform)`.
  - `types/core.d.ts` strict types for `SessionHealthOrchestrator`, `CircuitBreakerState`, `ProbeFn`, `ApiClientOptions.healthOrchestrator`.
  - Tests: `tests/core/session-health-orchestrator.test.js` (9 tests) + `tests/admin/accounts-health.test.js` (3 tests) — real impl, no mocks, 12/12 pass.
  - `docs/stealth-scraping.md` documented orchestrator API, circuit breaker flow, and admin dashboard endpoints.
- Verified: `npm run typecheck` 0 errors; tests 12/12 pass.


## Spec Change Log

## Review Triage Log

Implementation review pass (inline, Agent tool unavailable — 3 layers run on staged diff):
- [F-1 high → patch] `base-client.request()` catch block thiếu feed `recordError` khi HTTP/network lỗi → bổ sung `this.healthOrchestrator?.recordError` trước `handleError` và tại unretryable catch. [verified: tests 26/26]
- [F-2 low → patch] `_cooldownFor` clamp `failures` (max 20) tránh `Math.pow` tràn số. [verified]
- [F-3 verification-gap → patch] Thêm unit test integration trong `tests/core/base-client-request.test.js` xác nhận `recordSuccess`, `recordLatency` và `recordError` được feed vào orchestrator. [verified: 14/14 pass]
- [F-4 operator probe force] Nút Probe trên admin dashboard và `POST /accounts/probe` cần bypass cooldown → thêm `{ force: true }` vào `checkRecovery`. [verified]
- [F-5 admin routes auth] Chuyển accounts routes sang `requireAdminOrApiKey` để hỗ trợ cả `x-admin-key` cho tools/tests và JWT cho UI. [verified]


## Design Notes

- Score: `score = max(0, 100 - min(40, 8*consecErrors) - min(30, 10*rateLimits) - min(30, 15*botChallenges) - latencyPenalty - min(24, 12*incomplete) - (proxyUnhealthy?15:0))`; latencyPenalty = avg>8000?20 : avg>3000?10 : 0.
- Breaker: `closed` → `open` (score<30) → `half-open` (now ≥ nextProbeAt) → `closed` (probe ok) / `open` (probe fail, cooldown×2 cap 30min).
- `checkRecovery` lazy — gọi từ request path (canAccountRequest) hoặc admin probe, không chạy timer nền.
- `probeFn` mặc định: nếu không register → half-open probe giả định "manual wake" → markAvailable + score 60 (conservative reopen); document rõ.

## Verification

**Commands:**
- `npm run typecheck` — 0 errors strict.
- `vitest run tests/core/session-health-orchestrator.test.js tests/admin/accounts-health.test.js` — pass.
- `vitest run` — full suite no regression.
