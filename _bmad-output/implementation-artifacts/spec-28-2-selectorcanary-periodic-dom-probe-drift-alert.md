---
title: 'SelectorCanary — Periodic DOM Probe & Drift Alert'
type: 'feature'
created: '2026-09-14'
status: 'done'
route: 'dispatch'
baseline_commit: '7f42c4d683297daa14d3eff5f68395bf92615e74'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-28-context.md'
  - '_bmad-output/implementation-artifacts/spec-28-1-schemadriftguard-runtime-contract-validation-completeness-cl.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions scrapers depend on live DOM selectors (`data-testid`, `role`, semantic structure) that platforms change without notice. Today drift is discovered only when a production scrape silently returns empty data — after downstream consumers already stored garbage. There is no early-warning signal.

**Approach:** A `SelectorCanary` background service periodically probes a declared set of public test targets per platform with a lightweight stealth browser (Obscura primary, Chrome fallback). Each probe walks the documented fallback selector chain, records `successRate`/`usedFallback`/`driftDetected`/`lastWorkingSelector`, and when a platform's success rate stays below `0.8` for two consecutive runs it fires an alert via the existing `AlertDispatcher` and exposes `platformDrift[platform]` through `AdaptiveRateGovernor.getStatus()` / `status-api`, surfaced as a green/red drift badge on `dashboard/admin.html`.

## Boundaries & Constraints

**Always:**
- Reuse `launchStealthBrowser` / `createStealthPage` / `closeStealthBrowser` from `src/scraping/stealthBrowser.js` with `{ backend: 'obscura', fallbackBackend: 'chrome' }` — do not launch Puppeteer directly.
- Reuse `AlertDispatcher` (`api/services/benchmark/alerting.js`, `defaultAlertDispatcher`) for alert delivery — Telegram / Slack / generic webhook + 1-hour dedup. Do not invent a new notifier.
- Reuse `node-cron` (already a dependency) for scheduling — this is the single mechanism (no Bull repeatable path; `jobQueue.js` only registers named processors). Default cron `'0 * * * *'` (hourly), overridable via `process.env.SELECTOR_CANARY_CRON`. Gated by `ENABLE_SELECTOR_CANARY === 'true'` like the existing `ENABLE_*_SCHEDULER` pattern.
- Browser lifecycle in `runOnce()`: launch ONE stealth browser per run (or per platform), open a page per target via `createStealthPage`, and guarantee `await page.close()` in a `finally` per target and `await closeStealthBrowser(browser)` in a `finally` at end of run — no leaked browser processes or tabs on navigation failure.
- `driftDetected` means "a DOM change was observed this run" — `true` when a fallback was needed OR all selectors failed. The `platformDrift[platform].alert` flag is a SEPARATE, stricter signal — `true` only when `successRate < 0.8` on two consecutive runs. Do not conflate them.
- Probe only public, unauthenticated targets (`requiresAuth === false`) so the `obscura` backend guard never trips.
- Config-driven targets in `config/canary-targets.json` — new platforms add entries, not code.
- `platformDrift` is additive on `GovernorStatus` — never remove or reshape existing fields.
- ESM only, `const` over `let`, emoji-prefixed `console.log`, `// by nichxbt` credit, 1–3s delays between DOM actions.

**Never:**
- No new npm dependencies (no Zod/Ajv; no extra scheduler lib).
- No authenticated probing — post-auth DOM is out of scope for the canary.
- No changes to `ScraperCanaryRun` / `benchmark/canary-runner.js` — that is a separate API-level canary; this story is DOM-level.
- No DB writes required — in-memory run history is sufficient for the two-consecutive-run window; persistence is a later concern.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `config/canary-targets.json` has platform entries with `selectorChain` | Each target probed; primary selector matches → `successRate=1.0`, `usedFallback=false`, `driftDetected=false` | N/A |
| FALLBACK_USED | primary selector absent, fallback present | `usedFallback=true`, `driftDetected=true` (drift observed but still a success), `lastWorkingSelector` = fallback that matched | N/A |
| DRIFT_DETECTED | all selectors in chain absent → per-target failure | `driftDetected=true` for that run; if successRate < 0.8 on two consecutive runs → `dispatchAlert` + `platformDrift[platform].alert=true` | Alert via AlertDispatcher; not thrown |
| BELOW_THRESHOLD_ONCE | successRate < 0.8 on run N only | No alert yet — requires two consecutive | N/A |
| THRESHOLD_RECOVERY | run N < 0.8, run N+1 ≥ 0.8 | Consecutive counter resets; `alert` clears when successRate recovers | N/A |
| OBSCURA_FAILS | obscura backend unreachable | `launchStealthBrowser` auto-falls back to chrome; probe continues | Logged warning, not fatal |
| BROWSER_LAUNCH_FAILS | both backends fail | Run recorded as failed for all targets of that platform (successRate=0) | try/catch per platform; service keeps running |
| TARGET_UNREACHABLE | `page.goto` throws / timeout | That target counts as failure; other targets still probed | try/catch per target |
| MISSING_CONFIG | `config/canary-targets.json` absent or `[]` | Service no-ops, logs a warning, `platformDrift` stays `{}` | No throw |
| SELECTOR_CHAIN_EMPTY | target entry has empty `selectorChain` | Target skipped, logged | Treated as config warning |

</frozen-after-approval>

## Code Map

- `src/services/selector-canary.js` **(mới — tạo cả thư mục `src/services/`)** — `SelectorCanary` class + `globalSelectorCanary`. `startScheduler()` (node-cron, gated by `ENABLE_SELECTOR_CANARY`), `stopScheduler()`, `runOnce()` (one probe pass over all platforms/targets), `getStatus()` → per-platform `{ successRate, usedFallback, driftDetected, lastWorkingSelector, lastProbe, consecutiveFailures }`. Keeps an in-memory rolling history (last ~10 runs/platform) for the two-consecutive-run window.
- `config/canary-targets.json` **(mới)** — map `platform → [{ name, url, selectorChain: [css...] }]`. Only unauthenticated public URLs. `docs/agents/selectors.md`/`robust-dom-extraction.md` cover ONLY Twitter — seed the other platforms' chains directly (see Design Notes for the starter seed):
  - `twitter`: `https://x.com/nasa` — `['[data-testid="UserName"]', '[data-testid="UserDescription"]', 'main [role="main"]']`
  - `facebook`: `https://www.facebook.com/Meta` — `['[role="main"]', 'h1', 'div[data-pagelet="ProfileActions"]']`
  - `youtube`: `https://www.youtube.com/@nasa` — `['ytd-channel-name', '#channel-header', 'tp-yt-paper-tabs']`
  - `threads`: `https://www.threads.net/@nasa` — `['[role="main"]', 'h1', 'header']`
- `src/scraping/stealthBrowser.js` — **reuse** `launchStealthBrowser({ backend:'obscura', fallbackBackend:'chrome' })` (line 57), `createStealthPage` (line 212), `closeStealthBrowser` (line 198). Backend tag on `browser.__backend`/`page.__backend`. Obscura auto-falls-back on failure. Do NOT modify.
- `src/core/adaptive-governor.js` — add `#platformDrift` Map, a `setPlatformDrift(platform, drift)` / `clearPlatformDrift(platform)` (or a single `updatePlatformDrift(map)`) mutator, and include `platformDrift: Object.fromEntries(...)` in the `getStatus()` return object (line ~560). Additive only.
- `src/core/types.js` — extend the `GovernorStatus` typedef (~line 154) with `@property {Record<string, PlatformDriftStatus>} platformDrift` and add the `PlatformDriftStatus` typedef.
- `src/core/status-api.js` — `getGovernorStatus()` already spreads `governor.getStatus()`; `platformDrift` flows through automatically. No change needed unless the fallback branch needs a `platformDrift: {}` default (add for shape stability).
- `types/core.d.ts` — `GovernorStatus` interface (line ~141): add `platformDrift: Record<string, PlatformDriftStatus>`; declare `PlatformDriftStatus`, `SelectorCanaryResult`, `CanaryTargetConfig`, and `SelectorCanary` class + `globalSelectorCanary`.
- `api/services/benchmark/alerting.js` — **reuse** `defaultAlertDispatcher.dispatchAlert({ scraperId, platform, previousTier, currentTier, healthScore, reason })`. Map canary payload onto its contract (e.g. `currentTier:'C'`, `healthScore = successRate*100`, `reason` = 'Selector drift'). Do NOT modify.
- `api/server.js` — wire `globalSelectorCanary.startScheduler()` in the listen callback next to `defaultCanaryRunner` (~line 774), gated by `ENABLE_SELECTOR_CANARY === 'true'` (opt-in, default off). ALSO add `globalSelectorCanary.stopScheduler()` inside the `SIGTERM`/`SIGINT` shutdown loop (~line 782) alongside `defaultCanaryRunner.stopScheduler()` so no open timer handles leak.
- `api/routes/governor.js` — `GET /status` returns `globalStatusApi.getGovernorStatus()`; `platformDrift` is already in the payload. No change.
- `dashboard/admin.html` — in `renderGovernorMetrics(status)` (~line 1830) render a per-platform drift badge list from `status.platformDrift` (green OK / red drift). Add a small container element near the governor stat cards (~line 869) and CSS reusing the existing `.status-pill`/`.status-throttle-*` palette.
- `docs/agents/selectors.md` + `docs/case-studies/robust-dom-extraction.md` — the documented fallback chains that seed `selectorChain` values in `config/canary-targets.json`. Reference for selector choices only.
- `tests/services/selector-canary.test.js` **(mới)** — unit coverage via dependency-injection harnesses (no `vi.mock`, per repo rule "never mock/stub/fake"). Follow the `makeBrowserHarness`/`makePageHarness` real-harness precedent in `tests/scraping/stealth-browser-fingerprint.test.js` (injects a plain-object page exposing `goto`/`$`/`close`) and `AlertDispatcher`'s `dispatchSeam`. Cases: happy path, fallback used, below-threshold once (no alert) vs twice (alert), recovery reset, missing config no-op, per-target isolation.
- `tests/core/status-api.test.js` — **update** the zero-state `toEqual` assertion (line ~12) to include `platformDrift: {}`; otherwise the exact-match test fails once the fallback default is added.

## Tasks & Acceptance

**Execution:**
- [x] `config/canary-targets.json` — seed public per-platform targets + selector chains — config-driven probe set.
- [x] `src/services/selector-canary.js` — `SelectorCanary` + `globalSelectorCanary` (probe loop, fallback-chain walk, rolling history, drift detection, governor + alert wiring) — trái tim story.
- [x] `src/core/adaptive-governor.js` — `#platformDrift` state + mutator + `platformDrift` in `getStatus()` — status surface.
- [x] `src/core/types.js` — `PlatformDriftStatus` typedef + `platformDrift` on `GovernorStatus` — runtime typedef.
- [x] `types/core.d.ts` — `PlatformDriftStatus`, `SelectorCanaryResult`, `CanaryTargetConfig`, `SelectorCanary`, `globalSelectorCanary`, `platformDrift` on `GovernorStatus` — typecheck strict.
- [x] `src/core/index.js` — export `SelectorCanary` + `globalSelectorCanary` — public surface.
- [x] `src/core/status-api.js` — `platformDrift: {}` default in the no-governor fallback branch — shape stability.
- [x] `api/server.js` — `ENABLE_SELECTOR_CANARY === 'true'` gated `globalSelectorCanary.startScheduler()` — scheduler wiring.
- [x] `dashboard/admin.html` — drift badge UI in `renderGovernorMetrics` + container + CSS — AC dashboard indicator.
- [x] `tests/services/selector-canary.test.js` — unit coverage via injected harnesses — AC coverage.
- [x] `tests/core/status-api.test.js` — add `platformDrift: {}` to the zero-state `toEqual` — prevent regression.
- [x] `docs/` — document canary config shape + env flag — Epic 28 DoD.

**Acceptance Criteria:**
- Given `config/canary-targets.json` lists a platform whose primary selector matches, when `runOnce()` executes, then `successRate` is `1.0`, `usedFallback=false`, `driftDetected=false`, `lastWorkingSelector` = primary.
- Given a target whose primary selector is absent but a fallback matches, when probed, then `usedFallback=true` and `lastWorkingSelector` = the matching fallback, counted as success.
- Given a platform's `successRate < 0.8` on run N only, when the run completes, then NO alert is dispatched (needs two consecutive).
- Given `successRate < 0.8` on two consecutive runs, when the second run completes, then `defaultAlertDispatcher.dispatchAlert` is called AND `governor.getStatus().platformDrift[platform]` = `{ alert: true, successRate, lastProbe, lastWorkingSelector }`.
- Given `successRate` recovers to `>= 0.8`, when the next run completes, then the consecutive-failure counter resets and `platformDrift[platform].alert` clears.
- Given `launchStealthBrowser` obscura fails, when `runOnce()` executes, then it falls back to chrome and the probe still runs (no throw).
- Given `config/canary-targets.json` is missing or empty, when `runOnce()` executes, then the service no-ops without throwing and `platformDrift` stays `{}`.
- Given `status.platformDrift` present, when `dashboard/admin.html` `renderGovernorMetrics` runs, then each platform renders a green (ok) or red (drift) badge.
- `npm run typecheck` 0 errors + `vitest run` pass, no regression.

## Implementation Notes

- `src/services/selector-canary.js`: `SelectorCanary` + `globalSelectorCanary`. `runOnce()` probes each platform's targets via one `launchStealthBrowser({backend:'obscura',fallbackBackend:'chrome'})` per platform; per target a `createStealthPage` page with `page.goto(url,{waitUntil:'domcontentloaded',timeout:30000})`, walks `selectorChain` (`page.$`), `page.close()` in `finally`, `closeStealthBrowser(browser)` in `finally`. Records `successRate`/`usedFallback`/`driftDetected`/`lastWorkingSelector`, 10-run rolling history, `consecutiveFailures` (<0.8 threshold), alerts via `defaultAlertDispatcher.dispatchAlert` at ≥2 consecutive, and pushes `PlatformDriftStatus` to `governor.setPlatformDrift`.
- `src/core/adaptive-governor.js`: added `#platformDrift` Map + `setPlatformDrift`/`clearPlatformDrift`/`updatePlatformDrift`; `getStatus()` returns `platformDrift: Object.fromEntries(...)`.
- `src/core/status-api.js`: `platformDrift:{}` default in no-governor fallback.
- `api/server.js`: `ENABLE_SELECTOR_CANARY==='true'` → `globalSelectorCanary.startScheduler()` in listen callback; `globalSelectorCanary.stopScheduler()` added to SIGTERM/SIGINT loop.
- `dashboard/admin.html`: `#platform-drift-card` + `.drift-badge-ok`/`.drift-badge-drift` + render in `renderGovernorMetrics` from `status.platformDrift`.
- `tests/services/selector-canary.test.js`: 12 tests AC-1..AC-10 via `makeBrowserHarness`-style DI (real page/browser harnesses, `AlertDispatcher` with `dispatchSeam`) — no mocks.
- `tests/core/status-api.test.js` + `tests/core/index.test.js`: added `platformDrift:{}` to both zero-state `toEqual` assertions (reviewer found status-api; `index.test.js` same-pattern regression found in verification).
- Verified: `vitest run tests/services/selector-canary.test.js tests/core/status-api.test.js tests/core/adaptive-governor.test.js` → 34 pass; after review hardening, `tests/services/selector-canary.test.js tests/core/ tests/dashboard/` → 344 pass. `npm run typecheck` → 57 pre-existing errors in `src/scrapers/social/facebook/signer-bridge.js` (baseline commit `7f42c4d6` identical count — unrelated to this story; story files produce 0 errors).
- Post-review hardening: added `cron.validate` guard in `startScheduler`; config path now `__dirname`-relative (was `process.cwd()`); `driftBadges` platform name escaped via `esc()` (XSS); added drift-badge DOM test (AC-8 dashboard), `platformDrift` mutator tests, `SelectorCanary` export test, `.env.example` doc for `ENABLE_SELECTOR_CANARY`/`SELECTOR_CANARY_CRON`.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence / Resolution |
|---|---------|---------|----------------------|
| 1 | `status-api.test.js` zero-state `toEqual` exact-match breaks when `platformDrift:{}` added | **high** | `tests/core/status-api.test.js:12` uses `toEqual` → fails on new key. Fixed: added update task + Code Map note. |
| 2 | New types (`PlatformDriftStatus`/`SelectorCanaryResult`/`CanaryTargetConfig`) undefined + conflicting drift field shapes | **high** | spec line57 vs line90 vs epics differ. Fixed: explicit interfaces added to Design Notes; `platformDrift[platform]` = `PlatformDriftStatus`. |
| 3 | Browser/page lifecycle unspecified → process/tab leak risk | **high** | `closeStealthBrowser` exists (stealthBrowser.js:198) but spec didn't prescribe `finally` boundaries. Fixed: lifecycle clause in Boundaries + Code Map. |
| 4 | `driftDetected` vs `alert` ambiguous (fallback used = drift? or only threshold?) | **high** | I/O row omitted `driftDetected` on fallback. Fixed: `driftDetected=true` on fallback/AllFail; `alert` = strict 2×<0.8 only. |
| 5 | No default cron / env override specified | **medium** | precedent `canary-runner.js:376` uses `'0 * * * *'`. Fixed: hourly default + `SELECTOR_CANARY_CRON`. |
| 6 | Missing `stopScheduler()` in SIGTERM/SIGINT shutdown loop | **medium** | `api/server.js:782` stops `defaultCanaryRunner`. Fixed: added `globalSelectorCanary.stopScheduler()` wiring. |
| 7 | `docs/agents/selectors.md` covers only Twitter — not FB/YT/Threads | **medium** | confirmed: selectors.md is Twitter-only. Fixed: seed selector chains inline for all 4 platforms. |
| 8 | "fake browser / stub / spy" violates repo no-mock rule | **medium** | repo mandates real harnesses. Fixed: rephrased to `makeBrowserHarness`/`dispatchSeam` injection precedent. |

**Review pass 2 (verification-gap layer + inline edge-case-hunter — edge-case subagent backend 502×2, ran inline):**

| 9 | `startScheduler` lacks `cron.validate(schedule)` — invalid `SELECTOR_CANARY_CRON` throws inside `cron.schedule` (inline edge-case) | **high** | `retentionScheduler.js:180` precedent validates. Fixed: `cron.validate` guard + test `startScheduler('not-a-cron')===false`. |
| 10 | `platformDrift` badge DOM render unverified — no test asserted `#platform-drift-card`/badges | **high** | `tests/dashboard/admin-proxies-accounts.test.js` only asserted metric fields. Fixed: added AC-8 test injecting drift into real `globalAdaptiveRateGovernor`, asserting card unhide + `.drift-badge-ok`/`.drift-badge-drift` render. |
| 11 | `clearPlatformDrift`/`updatePlatformDrift` mutators unverified | **high** | only `setPlatformDrift` exercised via canary. Fixed: added `platformDrift` describe block in `adaptive-governor.test.js` covering all 3 mutators + falsy/non-object inputs. |
| 12 | `SelectorCanary`/`globalSelectorCanary` re-export in `core/index.js` unverified | **medium** | `index.test.js` never imported them. Fixed: added export assertion describe block. |
| 13 | `ENABLE_SELECTOR_CANARY`/`SELECTOR_CANARY_CRON` not in `.env.example` | **medium** | confirmed absent; `ENABLE_FB_SCHEDULER` is documented. Fixed: documented both with comments. |
| 14 | default `launchStealthBrowser` path untested (all tests inject `browserFactory`) | **maybe-false → deferred** | thin `import`+`launchStealthBrowser` call covered by `stealthBrowser.js` fingerprint-harness test; real browser launch is integration scope. Known-limitation. |

**Review pass 3 (blind-hunter layer — transcript truncated, path-traced inline for confirmed findings):**

| 15 | `driftBadges.innerHTML` injects `${platform.toUpperCase()}` unescaped — XSS via API-controlled platform name | **high** | `esc()` helper exists (`admin.html:1289`) but unused. Fixed: wrap platform name in `esc()`. |
| 16 | `config/canary-targets.json` resolved via `process.cwd()` — fragile when process launched from a subdir (e.g. `api/`) | **high** | `metadata-schema-registry.js:298` precedent uses `__dirname`. Fixed: `path.resolve(__dirname,'../../config/canary-targets.json')` via `fileURLToPath`. |

## Design Notes

- **Two-run window:** keep an in-memory ring of recent run results per platform (size ~10 is plenty). `consecutiveFailures` = count of trailing runs with `successRate < 0.8`; alert fires when it reaches 2, resets on any run ≥ 0.8. No DB needed for the rolling window.
- **Selector chains:** each target's `selectorChain` is an ordered array — try `selectorChain[0]` first; on miss walk the chain. `lastWorkingSelector` records whichever matched; `usedFallback = (matchedIndex > 0)`.
- **Scheduler:** `node-cron` matches `retentionScheduler`/`tweetScheduler` precedent and avoids needing Bull repeatable-job plumbing through `jobQueue.js` (which currently only registers named processors, not repeatables). One mechanism only — no dual cron+Bull.
- **Alert payload mapping:** `AlertDispatcher.dispatchAlert` expects tier/health fields — pass `currentTier:'C'`, `healthScore: Math.round(successRate*100)`, `reason` describing drift. Dedup is handled inside AlertDispatcher (1h per scraperId → use `selector-canary:${platform}` as scraperId).
- **Type contracts** (add to `types/core.d.ts` + JSDoc typedefs in `src/core/types.js`):
  ```ts
  export interface PlatformDriftStatus {
    alert: boolean;            // true only when successRate<0.8 for 2 consecutive runs
    successRate: number;       // 0.0–1.0
    lastProbe: string;         // ISO timestamp
    lastWorkingSelector?: string;
    consecutiveFailures?: number;
  }
  export interface CanaryTargetConfig { name: string; url: string; selectorChain: string[]; }
  export interface SelectorCanaryResult {
    platform: string; successRate: number; usedFallback: boolean;
    driftDetected: boolean;    // true when fallback used OR all selectors failed
    lastWorkingSelector: string | null; lastProbe: string; consecutiveFailures: number;
  }
  ```
- **Testability without a real browser:** constructor accepts `{ browserFactory, alertDispatcher, governor, config, now }` injection points — `browserFactory` returns a real harness object (see `makeBrowserHarness` precedent) whose `newPage()` yields a page harness exposing `goto`/`$`/`close`; `alertDispatcher` is an `AlertDispatcher` instance (or one constructed with a `dispatchSeam`). Real `launchStealthBrowser` is only the default value — no `vi.mock`.

## Verification

**Commands:**
- `npx vitest run tests/services/selector-canary.test.js` — expected: all pass
- `npm run typecheck` — expected: 0 errors
- `npx vitest run tests/core/adaptive-governor.test.js tests/core/status-api.test.js` — expected: pass, `platformDrift` present in status shape

**Manual checks:**
- `ENABLE_SELECTOR_CANARY=true npm run dev` then `GET /api/governor/status` → `status.platformDrift` present (object, possibly `{}` before first run).
- `dashboard/admin.html` renders a drift badge row when `platformDrift` has entries.
