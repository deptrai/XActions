# Technical Specification: Epic 40 (Rescoped) — Cost-Aware Proxy Escalation & Budget Ceiling

**Epic:** 40 — Cost-Aware Proxy Escalation & Budget Ceiling  
**Story:** 40.1 — Tích hợp Cost-Aware Proxy Escalation và Soft Degradation vào `ProxyIpPool`  
**Author:** Winston (System Architect)  
**Status:** in-progress  
**Date:** 2026-09-18  
**Scope:** Rescoped after duplication review — ~40% already implemented (quarantine, dual-pool, sticky map, DistributedTokenBucket).

---

## 1. Duplication Review Findings

### 1.1. What Already Exists (No Action Needed)

| Component | Location | Status |
|---|---|---|
| `DistributedTokenBucket` (Redis-backed, Lua atomic) | `src/core/distributed-token-bucket.js` | ✅ Complete |
| `ProxyIpPool` quarantine mechanism | `src/proxy/proxy-pool.js:482-530` | ✅ Complete |
| Dual-pool partitioning (realtime 30% / bulk 70%) | `src/proxy/proxy-pool.js` (AD-20) | ✅ Complete |
| `resolveProxy()` with `requiresResidential` boolean | `src/core/base-client.js:295` | ✅ Complete |
| Sticky proxy per-account mapping | `src/proxy/proxy-pool.js` `#stickyMap` | ✅ Complete |
| 403/429 auto-quarantine | `src/core/base-client.js:965-1000` | ✅ Complete |
| `NormalizedProxy` base structure | `src/proxy/providers.js` | ✅ Complete |

### 1.2. What Is Actually New (Story 40.1 Scope)

| Component | Purpose | Status |
|---|---|---|
| `tier` metadata (4 levels) | `free`/`datacenter`/`residential`/`mobile_4g` | 🔲 Net-new |
| Cost-aware escalation logic | datacenter → residential → mobile_4g on challenge | 🔲 Net-new |
| `ProxyBudgetGovernor` | Daily budget ceiling via `DistributedTokenBucket` | 🔲 Net-new |
| `BUDGET_CEILING_REACHED` flag | Soft degradation when budget exhausted | 🔲 Net-new |
| Cost tracking per tier | Track spend per proxy tier daily | 🔲 Net-new |
| `PROXY_DAILY_BUDGET_USD` env var | Configurable daily ceiling | 🔲 Net-new |

---

## 2. Architecture Decision

### 2.1. Migration: `residential: boolean` → `tier` enum

```javascript
// Current (backward compat maintained):
{ residential: true }   → tier: 'residential'
{ residential: false }  → tier: 'datacenter'
{ }                     → tier: 'datacenter' (default)

// New canonical form:
{ tier: 'free' | 'datacenter' | 'residential' | 'mobile_4g' }
```

**Backward compatibility rule:** `normalizeProxy()` maps `residential: true` → `tier: 'residential'`, all else → `tier: 'datacenter'`. The `residential` field is preserved for 1 release cycle, then deprecated.

### 2.2. Cost-Aware Escalation Flow

```
Request → resolveProxy(accountId, options)
    │
    ▼
[1] Try datacenter tier (default, ~$0.50/GB)
    │
    ├─ Success → return proxy
    │
    ▼
[2] 403 / Captcha detected (lastChallengeResult.detected)
    │
    ▼
[3] Check ProxyBudgetGovernor.canAfford('residential')
    │
    ├─ Budget OK → escalate to residential (~$8/GB), consume budget
    │
    ├─ Budget exhausted → return { degraded: true, reason: 'BUDGET_CEILING_REACHED' }
    │
    ▼
[4] Residential also fails → try mobile_4g (if enabled, ~$15/GB)
    │
    ▼
[5] All tiers exhausted → throw PROXY_EXHAUSTED
```

### 2.3. Soft Degradation (No Job Kill)

```javascript
// In base-client.js — when budget ceiling hit:
if (escalationResult.degraded) {
  return {
    success: false,
    degraded: true,
    reason: 'BUDGET_CEILING_REACHED',
    _metadata: {
      proxyTier: 'none',
      budgetExhausted: true,
      dailyBudgetUsd: process.env.PROXY_DAILY_BUDGET_USD,
      estimatedCostUsd: 0, // no request made
    }
  };
}
```

The job does NOT throw `PROXY_EXHAUSTED` — it returns a degraded result so upstream callers can decide to queue, retry later, or alert.

---

## 3. Implementation Plan

### 3.1. New Files

```
src/core/proxy-budget-governor.js       # Budget ceiling + cost tracking
src/core/proxy-tier-escalator.js        # Escalation logic (optional — can be inline in base-client)
tests/core/proxy-budget-governor.test.js
tests/core/proxy-tier-escalator.test.js
tests/proxy/proxy-pool-tier.test.js      # Tier-aware pool tests
```

### 3.2. Modified Files

```
src/proxy/providers.js                  # NormalizedProxy + tier field, migration logic
src/proxy/proxy-pool.js                # getProxy({ tier }), tier-aware filtering
src/core/base-client.js                # resolveProxy() with escalation + budget check
src/core/error-envelope.js             # BUDGET_CEILING_REACHED error type
types/core.d.ts                        # ProxyTier, BudgetStatus, EscalationResult
.env.example                           # PROXY_DAILY_BUDGET_USD, PROXY_ESCALATION_ENABLED
docs/architecture.md                   # AD-45 (already has AD-42 — update with details)
```

### 3.3. Key Implementation Details

#### `NormalizedProxy` extension (`src/proxy/providers.js`)

```javascript
/**
 * @typedef {Object} NormalizedProxy
 * @property {string} scheme
 * @property {string} host
 * @property {number} port
 * @property {string} [username]
 * @property {string} [password]
 * @property {string} server
 * @property {'free'|'datacenter'|'residential'|'mobile_4g'} [tier='datacenter']
 * @property {boolean} [residential] — DEPRECATED, use tier instead
 */
```

#### `ProxyIpPool.getProxy()` tier-aware (`src/proxy/proxy-pool.js`)

```javascript
getProxy(options = {}) {
  const { pool, requiresResidential, tier, escalateOnChallenge } = options;
  
  // Tier takes precedence over requiresResidential boolean
  const effectiveTier = tier || (requiresResidential ? 'residential' : 'datacenter');
  
  // Find healthy proxy matching tier
  const found = this.#findHealthyInRange(start, end, { tier: effectiveTier }, pool);
  // ... sticky map, yield logic unchanged
}
```

#### `ProxyBudgetGovernor` (`src/core/proxy-budget-governor.js`)

```javascript
const TIER_COST_USD_PER_GB = Object.freeze({
  free: 0,
  datacenter: 0.5,
  residential: 8.0,
  mobile_4g: 15.0,
});

export class ProxyBudgetGovernor {
  #bucket = globalDistributedTokenBucket;
  
  async canAfford(tier, estimatedBytes = 50 * 1024 * 1024) { // ~50MB per request estimate
    const costPerGB = TIER_COST_USD_PER_GB[tier] || 0;
    const cost = (estimatedBytes / 1e9) * costPerGB;
    const dailyKey = `proxy:budget:${new Date().toISOString().slice(0, 10)}`;
    
    return await this.#bucket.canConsume(dailyKey, cost, {
      capacity: parseFloat(process.env.PROXY_DAILY_BUDGET_USD || '50'),
      refillRate: 0, // no refill — daily reset
      ttlSeconds: 86400,
    });
  }
  
  async consume(tier, bytesUsed) {
    const costPerGB = TIER_COST_USD_PER_GB[tier] || 0;
    const cost = (bytesUsed / 1e9) * costPerGB;
    const dailyKey = `proxy:budget:${new Date().toISOString().slice(0, 10)}`;
    
    return await this.#bucket.consume(dailyKey, cost, {
      capacity: parseFloat(process.env.PROXY_DAILY_BUDGET_USD || '50'),
      refillRate: 0,
      ttlSeconds: 86400,
    });
  }
}
```

#### `resolveProxy()` escalation (`src/core/base-client.js`)

```javascript
resolveProxy(accountId, requiresResidential = false, requiresAuth = this.requiresAuth, options = {}) {
  // ... existing code ...
  
  // NEW: Cost-aware escalation on challenge detection
  if (options.escalateOnChallenge && lastChallengeResult?.detected) {
    const nextTier = this.#getNextTier('datacenter'); // → 'residential'
    const budgetCheck = await this.#proxyBudgetGovernor.canAfford(nextTier);
    
    if (!budgetCheck.allowed) {
      return { proxy: null, degraded: true, reason: 'BUDGET_CEILING_REACHED', tier: nextTier };
    }
    
    // Retry with escalated tier
    proxy = this.#getProxyByTier(nextTier, rawAccountId, options);
    if (proxy) {
      proxy._escalatedFrom = 'datacenter';
      proxy._tier = nextTier;
    }
  }
  
  return proxy;
}
```

---

## 4. Acceptance Criteria (Story 40.1)

- [ ] AC-1: `NormalizedProxy` accepts `tier` field; `residential: true` maps to `tier: 'residential'` (backward compat).
- [ ] AC-2: `ProxyIpPool.getProxy({ tier: 'residential' })` returns only residential-tier proxies.
- [ ] AC-3: `resolveProxy()` defaults to `datacenter` tier; escalates to `residential` only when `lastChallengeResult.detected === true`.
- [ ] AC-4: `ProxyBudgetGovernor.canAfford('residential')` returns `{ allowed: false }` when daily budget exhausted.
- [ ] AC-5: `resolveProxy()` returns `{ degraded: true, reason: 'BUDGET_CEILING_REACHED' }` when budget exhausted — does NOT throw.
- [ ] AC-6: `PROXY_DAILY_BUDGET_USD` env var controls ceiling; default `$50/day`.
- [ ] AC-7: `mobile_4g` tier is available but only used when `PROXY_ESCALATION_ENABLED=1` and residential also fails.
- [ ] AC-8: All new code has unit tests (no mocks — use in-memory bucket fallback).

---

## 5. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| `residential: boolean` → `tier` breaks existing proxy configs | 🟡 Medium | `normalizeProxy()` maps `residential: true` → `tier: 'residential'`; all else → `datacenter`. Backward compat for 1 release. |
| Budget tracking inaccurate (bytes estimation) | 🟡 Medium | Fixed cost estimate per request (~50MB × tier rate). Simpler than actual byte tracking; conservative estimate prevents overrun. |
| Escalation loop (datacenter→residential→mobile_4g→fail) | 🔴 High | Max 1 escalation per request. After residential fails, no further escalation — return `PROXY_EXHAUSTED` or degraded. |
| `PROXY_DAILY_BUDGET_USD` unset → unlimited | 🟡 Medium | Default `$50/day` conservative ceiling. Log warning when unset. |
| Soft degradation hides real infrastructure failures | 🟡 Medium | `degraded: true` flag in response + governor `setPlatformDrift` alert. Distinct from `PROXY_EXHAUSTED` error. |
| `DistributedTokenBucket` Redis unavailable → budget tracking fails | 🟡 Medium | In-memory fallback already exists in `DistributedTokenBucket`. Daily key `proxy:budget:YYYY-MM-DD` expires via TTL. |

---

## 6. Out of Scope (Explicitly Rejected)

- Per-request byte-level cost accounting (too complex, estimation is sufficient).
- Multi-day budget tracking (daily reset only — simpler and prevents drift).
- Proxy provider API integration for real-time pricing (static `TIER_COST_USD_PER_GB` map).
- Automatic proxy purchasing / top-up (out of scope — alerting only).
- IPv6/mobile proxy rotation logic (provider-level concern, not pool-level).

---

## 7. Dependencies

- `DistributedTokenBucket` (existing) — Redis-backed atomic budget tracking.
- `ProxyIpPool` (existing) — quarantine, dual-pool, sticky map.
- `base-client.js` (existing) — `resolveProxy()`, challenge detection.
- `error-envelope.js` (existing) — `PlatformError`, `ErrorTypes`.
- `commander` (existing) — no new CLI needed (internal feature).

No new npm dependencies required.
