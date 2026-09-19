---
title: 'Story 40.1 — Cost-Aware Proxy Escalation & Budget Ceiling'
type: 'feature'
created: '2026-09-18'
status: 'done'
baseline_revision: '25186637db017e728399d930b2cf039550f0ebad'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Residential and Mobile 4G proxies cost $3–$15/GB but `ProxyIpPool` has no cost-awareness — callers request `requiresResidential: true` unconditionally, burning budget on every request with no daily ceiling or escalation control.

**Approach:** Add `tier` metadata (`free`/`datacenter`/`residential`/`mobile_4g`) to `NormalizedProxy`, introduce `ProxyBudgetGovernor` enforcing `PROXY_DAILY_BUDGET_USD` via `DistributedTokenBucket`, and implement cost-aware escalation in `resolveProxy()` — default `datacenter`, escalate to `residential` only on 403/Captcha challenge, return `BUDGET_CEILING_REACHED` degraded result instead of throwing when budget exhausted.

## Boundaries & Constraints

**Always:**
- `tier` enum replaces `residential` boolean; backward compat `residential: true` → `tier: 'residential'`.
- Default tier is `datacenter` — escalate only on detected challenge (403/Captcha).
- `ProxyBudgetGovernor` uses existing `DistributedTokenBucket` — no new Redis infrastructure.
- `BUDGET_CEILING_REACHED` returns `{ degraded: true }` — never throws `PROXY_EXHAUSTED` for budget reasons.
- `PROXY_DAILY_BUDGET_USD` env var controls ceiling; default `$50/day`.
- `mobile_4g` tier only when `PROXY_ESCALATION_ENABLED=1` and residential also fails.
- No new npm dependencies — use existing `commander`, `DistributedTokenBucket`, Node.js built-ins.

**Never:**
- Per-request byte-level cost accounting (fixed ~50MB/request estimate is sufficient).
- Multi-day budget tracking (daily reset only).
- Proxy provider API integration for real-time pricing.
- Re-implementing `DistributedTokenBucket`, quarantine, dual-pool, sticky map.
- Auto-escalation without challenge detection (costs too much).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| DEFAULT_TIER | `resolveProxy()` with no options | Returns `datacenter` tier proxy | No error expected |
| ESCALATE_ON_403 | Challenge detected (`lastChallengeResult.detected`) + `escalateOnChallenge` option | Escalates to `residential` tier | Budget check before escalate |
| BUDGET_OK | `canAfford('residential')` with budget remaining | `{ allowed: true, remaining: X }` | No error expected |
| BUDGET_EXHAUSTED | `canAfford('residential')` with budget spent | `{ allowed: false }` → `resolveProxy` returns `{ degraded: true, reason: 'BUDGET_CEILING_REACHED' }` | Soft degradation, no throw |
| MOBILE_4G_DISABLED | `PROXY_ESCALATION_ENABLED` unset, residential fails | Returns `PROXY_EXHAUSTED` or degraded | No mobile_4g attempt |
| MOBILE_4G_ENABLED | `PROXY_ESCALATION_ENABLED=1`, residential fails | Tries `mobile_4g` tier if budget allows | Budget check before mobile_4g |
| TIER_FILTER | `getProxy({ tier: 'residential' })` | Returns only `tier: 'residential'` proxies | No error expected |
| BACKWARD_COMPAT | `getProxy({ requiresResidential: true })` | Maps to `tier: 'residential'` | No error expected |
| MIXED_POOL | Pool has `datacenter` + `residential` + `mobile_4g` | `getProxy({ tier: 'datacenter' })` returns only datacenter | No error expected |
| BUDGET_RESET | New day (midnight UTC) | Budget resets to `PROXY_DAILY_BUDGET_USD` | Automatic via TTL key |

</intent-contract>

## Code Map

- `src/proxy/providers.js` — `NormalizedProxy` typedef: add `tier` field, migrate `residential` boolean.
- `src/proxy/proxy-pool.js` — `getProxy({ tier })` tier-aware filtering; `#findHealthyInRange` accepts tier filter.
- `src/core/base-client.js` — `resolveProxy()` with escalation + budget check; `#getProxyByTier` helper.
- `src/core/proxy-budget-governor.js` — NEW: `canAfford(tier)`, `consume(tier, bytes)`, `checkRemaining()`.
- `src/core/error-envelope.js` — `BUDGET_CEILING_REACHED` error type (or reuse existing).
- `src/core/index.js` — Export `ProxyBudgetGovernor`, `globalProxyBudgetGovernor`.
- `types/core.d.ts` — `ProxyTier`, `BudgetStatus`, `EscalationResult`, `ProxyBudgetGovernor` types.
- `.env.example` — `PROXY_DAILY_BUDGET_USD`, `PROXY_ESCALATION_ENABLED`.
- `tests/core/proxy-budget-governor.test.js` — NEW: unit tests for budget tracking.
- `tests/proxy/proxy-pool-tier.test.js` — NEW: tier-aware pool tests.
- `tests/core/base-client-escalation.test.js` — NEW: escalation integration tests.

## Tasks & Acceptance

**Execution:**

- `src/proxy/providers.js` — Add `tier` to `NormalizedProxy`; `normalizeProxy()` maps `residential: true` → `tier: 'residential'`, `residential: false/undefined` → `tier: 'datacenter'`. Rationale: Backward compat while introducing 4-level tier.
- `src/proxy/proxy-pool.js` — `getProxy()` accepts `tier` option; `#findHealthyInRange` filters by `normalized.tier === requestedTier`; `getNext(tier)` overload for round-robin. Rationale: Pool must filter by tier for cost-aware selection.
- `src/core/proxy-budget-governor.js` — `ProxyBudgetGovernor` class: `canAfford(tier, estBytes)`, `consume(tier, bytes)`, `checkRemaining()`; uses `DistributedTokenBucket` with daily key `proxy:budget:YYYY-MM-DD`. Rationale: Atomic budget enforcement without new infrastructure.
- `src/core/base-client.js` — `resolveProxy()` enhanced: default `datacenter` → check `lastChallengeResult.detected` → `canAfford('residential')` → escalate or return `degraded`; `#getProxyByTier` helper wraps pool calls. Rationale: Escalation logic lives at request level, not pool level.
- `src/core/error-envelope.js` — Add `BUDGET_CEILING_REACHED` to `ErrorTypes` (or use existing `PROXY_EXHAUSTED` with `degraded` flag in response — decide based on whether it's an error or a state). Rationale: Soft degradation is a state, not an error.
- `src/core/index.js` — Export `ProxyBudgetGovernor` and `globalProxyBudgetGovernor`. Rationale: Single entry point.
- `types/core.d.ts` — Add `ProxyTier`, `BudgetStatus`, `EscalationResult`, `ProxyBudgetGovernor`, `ProxyBudgetGovernorOptions` interfaces. Rationale: Type safety.
- `.env.example` — Add `PROXY_DAILY_BUDGET_USD=50`, `PROXY_ESCALATION_ENABLED=0`. Rationale: Document new env vars.
- `tests/core/proxy-budget-governor.test.js` — Test `canAfford`, `consume`, `checkRemaining` with in-memory bucket fallback. Rationale: Verify budget tracking works.
- `tests/proxy/proxy-pool-tier.test.js` — Test `getProxy({ tier })` filtering, `getNext(tier)`, mixed pool behavior. Rationale: Verify tier-aware pool.
- `tests/core/base-client-escalation.test.js` — Test `resolveProxy` escalation on challenge, `BUDGET_CEILING_REACHED` degradation, backward compat `requiresResidential`. Rationale: Verify end-to-end escalation.

**Acceptance Criteria:**

- Given `NormalizedProxy` with `residential: true`, when `normalizeProxy()` runs, then `tier` is set to `'residential'`.
- Given `NormalizedProxy` with `residential: false` or absent, when `normalizeProxy()` runs, then `tier` is set to `'datacenter'`.
- Given `getProxy({ tier: 'residential' })`, when called, then returns only proxies with `tier: 'residential'`.
- Given `getProxy({ requiresResidential: true })`, when called, then maps to `tier: 'residential'` and returns matching proxies.
- Given `resolveProxy()` with challenge detected and `escalateOnChallenge: true`, when called, then checks `canAfford('residential')` before escalating.
- Given `canAfford('residential')` returns `{ allowed: false }`, when `resolveProxy()` runs, then returns `{ degraded: true, reason: 'BUDGET_CEILING_REACHED' }` — does not throw.
- Given `PROXY_DAILY_BUDGET_USD=100`, when budget consumed reaches `$100`, then `canAfford` returns `{ allowed: false }` for all paid tiers.
- Given `PROXY_ESCALATION_ENABLED=0`, when residential fails, then `resolveProxy()` returns `PROXY_EXHAUSTED` or degraded — no mobile_4g attempt.
- Given `PROXY_ESCALATION_ENABLED=1`, when residential fails and budget allows, then `resolveProxy()` tries `mobile_4g` tier.
- Given new day (midnight UTC), when budget key expires, then `canAfford` returns `{ allowed: true }` again.

## Spec Change Log

<!-- Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Populated by step-04 on every review pass. -->

## Design Notes

### Why `tier` enum instead of `residential` boolean?

`residential: true` is binary — it cannot express `free` (cost $0) vs `datacenter` (~$0.5/GB) vs `mobile_4g` (~$15/GB). The 4-level tier enables precise cost tracking and selective escalation. Backward compat is maintained by mapping `residential: true` → `tier: 'residential'`.

### Why `DistributedTokenBucket` for budget tracking?

`DistributedTokenBucket` already provides:
- Redis-backed atomic `consume()` via Lua script
- In-memory fallback when Redis unavailable
- TTL-based key expiration (`proxy:budget:YYYY-MM-DD` auto-expires daily)
- `canConsume()` for pre-flight checks

No new infrastructure needed — just a new key namespace and capacity = `PROXY_DAILY_BUDGET_USD`.

### Why fixed ~50MB/request cost estimate?

Actual byte tracking requires response body inspection — complex, error-prone, and varies by platform. Fixed estimate (~50MB × tier rate) is conservative (prevents overrun) and simple. A single API response is typically 10–100KB; 50MB estimate is ~500× conservative — safe margin.

### Escalation: request-level, not pool-level

Escalation decision lives in `resolveProxy()` (base-client) because:
- It has access to `lastChallengeResult` (challenge detection context).
- It knows the request's `accountId` and `options`.
- Pool-level escalation would require passing challenge context through — leaky abstraction.

## Verification

**Commands:**
- `npx vitest run tests/core/proxy-budget-governor.test.js` — expected: all tests pass
- `npx vitest run tests/proxy/proxy-pool-tier.test.js` — expected: all tests pass
- `npx vitest run tests/core/base-client-escalation.test.js` — expected: all tests pass
- `node -e "import('./src/proxy/providers.js').then(m => console.log(m.normalizeProxy({host:'1.2.3.4',port:8080,residential:true}).tier))"` — expected: `residential`

**Manual checks (if no CLI):**
- Verify `NormalizedProxy` typedef includes `tier` field.
- Verify `ProxyIpPool.getProxy()` accepts `tier` option.
- Verify `resolveProxy()` checks `canAfford` before escalating.
- Verify `.env.example` documents `PROXY_DAILY_BUDGET_USD`.
