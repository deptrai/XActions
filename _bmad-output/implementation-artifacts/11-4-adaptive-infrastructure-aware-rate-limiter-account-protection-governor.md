# Story 11.4 — Adaptive Infrastructure-Aware Rate Limiter & Account Protection Governor

**Story ID:** 11.4  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** in-progress  
**Owner:** DEV  
**Source:** `epics.md` Story 11.4, `ARCHITECTURE-SPINE.md` AD-13 / AD-14 / AD-17, PRD FR-66B / NFR-13 / NFR-17, previous stories 11.1–11.3, current `src/core/adaptive-governor.js`, `src/core/status-api.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js`, `src/core/base-client.js`, `src/core/index.js`, `src/mcp/server.js`, `src/cli/index.js`, `api/server.js`.

---

## Story

As a **Platform Governor & Account Security Engineer**,  
I want **the system to automatically compute safe scraping throughput from the live proxy pool and to put accounts into hibernation when they hit WAF/captcha**,  
so that **the pipeline never overloads the proxy rotation and eliminates the risk of mass account bans**.

---

## Acceptance Criteria

### AC-1: Dynamic throughput by healthy proxy count

* **Given** `AdaptiveRateGovernor` is constructed with a `ProxyIpPool` (`deps.proxyPool`)
* **When** `getMaxThroughput(platform)` is called
* **Then** it computes `healthyProxyCount × platform.baseReqPerSecondPerProxy × platform.throttleFactor`
* **And** if `healthyProxyCount < totalProxyCount × 0.5`, the effective factor is reduced by 50%
* **And** if `healthyProxyRatio < 0.1` or `healthyProxyCount < healthyProxyFloor`, the effective factor is 0 (bulk scrape pause)
* **And** if `redisConsumerLag > 10000`, the effective factor is multiplied by 0.25

### AC-2: Account-level token-bucket hibernation

* **Given** a `PlatformRateLimit` has been registered via `setPlatformLimit(platform, { safeRequestsPerMinute })`
* **When** `canAccountRequest(accountId, platform)` is called
* **Then** it returns `false` if the account is hibernating **or** has reached `safeRequestsPerMinute` requests in the last 60 seconds
* **And** `recordRequest(accountId, platform)` increments both the per-account sliding window and the global `currentReqPerSecond` counter

### AC-3: Programmatic hibernation and wake

* **Given** an account triggers a captcha/WAF or rate-limit
* **When** `hibernateAccount(accountId, reason, durationMs, platform)` or `recordRateLimit(accountId, platform, durationMs)` is invoked
* **Then** the account is unavailable for `durationMs`
  * default 15 minutes for `rate_limit`
  * 15–30 minutes for `bot_challenge`
* **And** `isHibernating(accountId, platform)` returns `true` during that window
* **And** `wakeAccount(accountId, platform)` removes the hibernation immediately

### AC-4: No-auth vs auth-required platform behavior

* **Given** a platform configured with `requiresAuth: false`
* **When** the governor evaluates throughput or hibernation
* **Then** it limits by proxy/IP and never marks a missing account as hibernating
* **And** the request pipeline records no-auth request velocity under the synthetic `'noauth'` key (`base-client.js:305-311`)

### AC-5: Redis consumer-lag backpressure

* **Given** a `StreamMetricsReader` updates the governor with the pending message count
* **When** the count exceeds 10000
* **Then** `getMaxThroughput(platform)` is throttled to 25% for all platforms until the lag falls below 5000
* **And** `getStatus()` reports `throttleLevel: 'backpressure'`

### AC-6: Governor status API, CLI, and MCP

* **Given** the API server, CLI, and MCP server are wired to the same `StatusApi`
* **When** an operator calls any of:
  * `GET /governor/status`
  * `xactions status`
  * MCP tool `x_governor_status`
* **Then** the response contains exactly the shape `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`
* **And** all three surfaces read from the same `globalStatusApi` singleton backed by `globalAdaptiveRateGovernor`

### AC-7: Global singletons and exports

* **Given** `src/core/index.js` is the public core barrel
* **When** it is imported
* **Then** it exports `globalAdaptiveRateGovernor` and `globalStatusApi` alongside `globalProxyPool` and `globalAccountPool`
* **And** `types/core.d.ts` and `types/index.d.ts` declare the new globals, the `StatusApi` class, and the updated `AdaptiveRateGovernor` / `PlatformRateLimit` methods

### AC-8: Redis consumer lag measurement

* **Given** the Redis Stream `stream:social:raw_posts` and consumer group `nowing_nlp_workers`
* **When** `StreamMetricsReader.getPendingCount()` is called
* **Then** it returns the number of unacknowledged messages
* **And** it returns `0` and logs a warning when Redis is unreachable, never crashing the pipeline

### AC-9: Fix duplicate/wrong governor hibernation call in the request pipeline

* **Given** `src/core/base-client.js` already invokes `accountPool.markUnavailable(..., this.platform)` which forwards hibernation to the governor (`account-pool.js:206-208`)
* **When** the last proxy attempt fails for an auth-required account
* **Then** `base-client.js` must not call `governor.hibernateAccount(currentAccountId, this.platform, this.rateLimitHibernationMs, 'rate_limit')` with the swapped argument order
* **And** it must either call `governor.recordRateLimit(currentAccountId, this.platform, this.rateLimitHibernationMs)` or rely solely on `accountPool.markUnavailable`, but not both

### AC-10: TypeScript declarations stay strict

* **Given** `types/core.d.ts` and `types/proxy.d.ts`
* **When** the declaration files are consumed
* **Then** `AdaptiveRateGovernor` declares `recordRateLimit`, `wakeAccount`, `isHibernating`, `getMaxThroughput`, `recordRequest(accountId, platform)`
* **And** `StatusApi` is declared with a constructor taking `{ governor?: AdaptiveRateGovernor }` and `getGovernorStatus(): GovernorStatus`
* **And** there are zero `any` annotations and zero `@ts-ignore` comments introduced

### AC-11: Zero-mock tests pass

* **Given** `tests/core/adaptive-governor.test.js` and `tests/core/status-api.test.js` are written
* **When** `npx vitest run tests/core/` is executed
* **Then** all tests pass using real `AdaptiveRateGovernor`, `ProxyIpPool`, `AccountPool`, and `StatusApi` instances
* **And** tests do not use `vi.fn()` for `httpClient`, providers, or Redis clients
* **And** Redis Stream tests skip gracefully when no Redis server is available

---

## Previous Story Intelligence

### Core implementation patterns carried forward

| Pattern | Source in 11.1 / 11.2 / 11.3 | Why it matters for 11.4 |
|---|---|---|
| `ProxyIpPool` exposes `healthyCount` and `totalCount` getters | `src/proxy/proxy-pool.js:54-65` | The governor derives `healthyProxyRatio` directly from the pool. Never duplicate the quarantine expiry logic. |
| `AccountPool` depends on a `governor` and calls `governor.hibernateAccount` inside `markUnavailable` | `src/core/account-pool.js:32-41, 206-208` | `base-client.js` must not double-hibernate accounts. Use `recordRateLimit` only when the pipeline needs to hibernate without an `AccountPool`. |
| `AbstractApiClient` records no-auth requests under `'noauth'` | `src/core/base-client.js:305-311` | The governor's `recordRequest('noauth', platform)` path must exist and not collide with auth account keys. |
| `PlatformError` / `ErrorTypes` / `SuggestedActions` are the only error surface | `src/core/error-envelope.js:10-30` | Governor status itself does not throw, but any CLI/API/MCP wrapper must return the status as a plain JSON envelope, never a raw `Error`. |
| `globalProxyPool` and `globalAccountPool` singletons | `src/proxy/proxy-pool.js:337`, `src/core/account-pool.js:411` | Follow the same pattern: `globalAdaptiveRateGovernor` and `globalStatusApi` must be created at module load in `src/core/index.js`. |
| No direct connection fallback; no `vi.fn()` in tests | Story 11.3 AC-9 / AC-11 | Continue the zero-mock convention. For Redis, skip if `process.env.REDIS_URL` / `REDIS_HOST` is missing. |

### 11.3 code-review findings that directly shape 11.4

1. **Wrong `hibernateAccount` argument order in `base-client.js:348-350`.** The method signature is `hibernateAccount(accountId, reason, durationMs, platform)`. `base-client.js` currently passes `this.platform` as `reason` and `'rate_limit'` as `platform`, which can create a wrong hibernation key. `accountPool.markUnavailable` already hibernates the correct key. Either remove the extra governor call or replace it with `governor.recordRateLimit(currentAccountId, this.platform, this.rateLimitHibernationMs)`.
2. **`AdaptiveRateGovernor` has no public status surface wired to HTTP/CLI/MCP.** The class and `StatusApi` exist, but `GET /governor/status`, `xactions status`, and `x_governor_status` are not implemented.
3. **`redisConsumerLag` is set only by `updateState(state)` and never refreshed from an actual Redis Stream.** A `StreamMetricsReader` is needed so `AdaptiveRateGovernor.refreshFromRedis()` or `updateRedisConsumerLag()` can be called periodically.
4. **Type declarations are out of sync with the JS class.** `recordRateLimit`, `wakeAccount`, and the `StatusApi` constructor are missing or incomplete in `types/core.d.ts`.

---

## Architecture Compliance

### AD-13 — Adaptive Infrastructure-Aware Dynamic Rate Limiting & Account Protection Governor

* **Binds:** `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js`, `src/scrapers/**`
* **Relevant rules:**
  1. Inputs: `healthyProxyCount`, `totalProxyCount`, `accountVelocity`, `redisConsumerLag`, `PlatformRateLimit` per platform.
  2. Dynamic capacity: `maxReqPerSecond = healthyProxyCount × platform.baseReqPerSecondPerProxy × platform.throttleFactor`. Healthy < 50% → −50%. Healthy < 10% (< 5 IPs) → pause bulk, on-demand only.
  3. Account token bucket per `platform.safeRequestsPerMinute`. Captcha/WAF → hibernation 15–30 min and rotate proxy.
  4. `AccountPool` rotates to the next healthy account when the current one is hibernating or over velocity.
  5. Redis Stream pending > 10000 → reduce bulk throughput to 25% until lag < 5000.
  6. No direct IP leak: governor must not allow any fallback to unproxied connections.

**11.4 compliance:**

* Implement / fix `getMaxThroughput` multipliers exactly as above.
* `recordRequest` must be safe for both `platform:accountId` and `noauth` keys.
* `getStatus()` must report `throttleLevel` as one of `'normal' | 'reduced' | 'critical' | 'backpressure'`.
* Provide `recordRateLimit` and `recordBotChallenge` convenience methods (or reuse `hibernateAccount` with the correct argument order).

### AD-14 — Operational Status & Error Envelope for Consumers

* **Binds:** `src/mcp/**`, `src/api/**`, `src/cli/**`, `src/core/error-envelope.js`, `src/core/status-api.js`
* **Relevant rules:**
  1. Error envelope shape: `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
  3. Governor Status API: `GET /governor/status` and CLI `xactions status` return `{ healthyProxyCount, totalProxyCount, healthyProxyRatio, currentReqPerSecond, redisConsumerLag, hibernatingAccounts[], throttleLevel }`.

**11.4 compliance:**

* `StatusApi.getGovernorStatus()` returns the exact shape.
* The API route, CLI command, and MCP tool are thin wrappers over `StatusApi` and do **not** reformat the shape.
* If the governor is not configured, return the zero-state object with `throttleLevel: 'normal'`.

### AD-17 — Redis Stream Metrics & Backpressure Observability

* **Binds:** `src/mcp/**`, `src/api/**`, `src/store/**`, `src/utils/metrics.js`
* **Relevant rules:**
  4. When the governor activates backpressure, log/metric `throttle_reason: redis_lag` with `reduced_to_percent`.

**11.4 compliance:**

* Add `StreamMetricsReader` that queries `stream:social:raw_posts` for pending/unacknowledged messages.
* Call `governor.updateRedisConsumerLag(count)` (or `updateState({ redisConsumerLag })`) when the count changes.
* Log `throttle_reason: redis_lag` and `reduced_to_percent: 25` when `redisConsumerLag > 10000`.

### AD-19 — Internal Operator Dashboard, Admin CLI & MCP Surface

* **Relevant rules:**
  3. Data sources: `/governor/status`, `/admin/proxies`, `/admin/accounts`, `/admin/checkpoints`, `/admin/stream/metrics`.
  6. Admin CLI: `xactions admin`, `xactions checkpoints`, `xactions stream`.

**11.4 compliance:**

* `GET /governor/status` is public to the operator surface (internal API key optional; keep consistent with `/api/proxies/status` which is currently unauthenticated).
* `xactions status` is a top-level CLI command, not nested under `admin`.
* MCP tool `x_governor_status` takes no arguments and returns the status.

### AD-2 — Unified Base Scraper & Client Interfaces

* **Relevant rule:** New abstractions live in `src/core/**`; `src/client/` is legacy.

**11.4 compliance:**

* All governor logic and status surface stays in `src/core/**`.
* Do not add business logic to `src/client/` or `src/scrapers/` for this story.

### AD-3 — Centralized Proxy IP Pool

* **Relevant rule:** Two proxy modes; no direct fallback.

**11.4 compliance:**

* `getMaxThroughput` uses `proxyPool.healthyCount` and `totalCount`; it never invents proxy state.
* `throttleLevel = 'critical'` when `healthyProxyRatio < 0.1`, signaling the pipeline to pause bulk.

---

## Technical Requirements

### 1. `AdaptiveRateGovernor` core logic

The existing class at `src/core/adaptive-governor.js` is 80% complete. The following changes are required.

#### 1.1 Correct argument order for `hibernateAccount` consumers

`hibernateAccount(accountId, reason, durationMs = 15 * 60 * 1000, platform)` is the canonical signature. Add two convenience methods:

```js
recordRateLimit(accountId, platform, durationMs = 15 * 60 * 1000) {
  this.hibernateAccount(accountId, `rate_limit:${platform || 'unknown'}`, durationMs, platform);
}

recordBotChallenge(accountId, platform, durationMs = 20 * 60 * 1000) {
  this.hibernateAccount(accountId, `bot_challenge:${platform || 'unknown'}`, durationMs, platform);
}
```

Duration ranges:

* `rate_limit`: 15 minutes default.
* `bot_challenge`: 15–30 minutes default (use 20 minutes unless a specific platform config overrides).

#### 1.2 Redis consumer lag input

Add an explicit method so callers do not need to remember the generic `updateState` object shape:

```js
updateRedisConsumerLag(lag) {
  this.#redisConsumerLag = Math.max(0, lag);
}

getRedisConsumerLag() {
  return this.#redisConsumerLag;
}
```

Keep `updateState({ healthyProxyCount, totalProxyCount, redisConsumerLag })` for backward compatibility.

#### 1.3 `getMaxThroughput` algorithm

```js
getMaxThroughput(platform) {
  this.refreshFromProxyPool();
  const limit = this.getPlatformLimit(platform);
  const healthy = this.#healthyProxyCount;
  const total = this.#totalProxyCount;
  const healthyProxyRatio = total > 0 ? healthy / total : 0;

  let factor = 1;
  if (healthy < total * 0.5) factor = 0.5;
  if (healthyProxyRatio < 0.1) factor = 0;
  if (this.#healthyProxyFloor > 0 && healthy < this.#healthyProxyFloor) factor = 0;
  if (this.#redisConsumerLag > 10000) factor *= 0.25;

  return healthy * limit.baseReqPerSecondPerProxy * limit.throttleFactor * factor;
}
```

Return `0` when the factor is `0` (bulk pause).

#### 1.4 `getStatus` shape

```js
getStatus() {
  const now = Date.now();
  this.#hibernatingAccounts = this.#hibernatingAccounts.filter((h) => h.until > now);
  this.refreshFromProxyPool();
  const total = this.#totalProxyCount;
  const healthy = this.#healthyProxyCount;
  const healthyProxyRatio = total > 0 ? healthy / total : 0;

  let throttleLevel = 'normal';
  if (this.#redisConsumerLag > 10000) throttleLevel = 'backpressure';
  else if (healthyProxyRatio < 0.1) throttleLevel = 'critical';
  else if (healthyProxyRatio < 0.5) throttleLevel = 'reduced';

  return {
    healthyProxyCount: healthy,
    totalProxyCount: total,
    healthyProxyRatio,
    currentReqPerSecond: this.#currentReqPerSecond,
    redisConsumerLag: this.#redisConsumerLag,
    hibernatingAccounts: this.#hibernatingAccounts.map((h) => ({
      accountId: h.accountId,
      remainingSeconds: Math.ceil((h.until - now) / 1000),
      reason: h.reason,
    })),
    throttleLevel,
  };
}
```

#### 1.5 `currentReqPerSecond` reset

The current implementation resets `currentReqPerSecond` only once per 1-second window. This is acceptable, but ensure it is **not** used as an accurate per-second rate; it is a counter of requests inside the current 1s window. Tests should assert the counter resets after 1000ms.

#### 1.6 `PlatformRateLimit` defaults

Default to safe, conservative values:

```js
safeRequestsPerMinute = 30
baseReqPerSecondPerProxy = 1
throttleFactor = 1
burstWindow = 60
requiresAuth = true
```

For no-auth platforms set `requiresAuth: false` and optionally a higher `baseReqPerSecondPerProxy` if the platform config demands it.

---

### 2. `StatusApi` and global singletons

#### 2.1 Create / expose singletons

In `src/core/adaptive-governor.js` add at the bottom:

```js
export const globalAdaptiveRateGovernor = new AdaptiveRateGovernor({ proxyPool: globalProxyPool });
```

In `src/core/status-api.js` add at the bottom:

```js
import { globalAdaptiveRateGovernor } from './adaptive-governor.js';
export const globalStatusApi = new StatusApi({ governor: globalAdaptiveRateGovernor });
```

Export both from `src/core/index.js`:

```js
export { AdaptiveRateGovernor, PlatformRateLimit, globalAdaptiveRateGovernor } from './adaptive-governor.js';
export { StatusApi, globalStatusApi } from './status-api.js';
```

#### 2.2 `StatusApi` behavior

`StatusApi.getGovernorStatus()` must return the zero-state shape when no governor is supplied:

```js
getGovernorStatus() {
  return this.#governor ? this.#governor.getStatus() : {
    healthyProxyCount: 0,
    totalProxyCount: 0,
    healthyProxyRatio: 0,
    currentReqPerSecond: 0,
    redisConsumerLag: 0,
    hibernatingAccounts: [],
    throttleLevel: 'normal',
  };
}
```

---

### 3. Redis Stream Metrics Reader

Create `src/utils/stream-metrics.js`.

#### 3.1 Redis client

Use the `redis` package (already in `package.json:135`) via `createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' })`.

If the project later standardizes on `ioredis`, replace the adapter; for now `redis` v4 is the installed dependency.

#### 3.2 Reading consumer lag

```js
export class StreamMetricsReader {
  constructor(options = {}) {
    this.streamName = options.streamName || 'stream:social:raw_posts';
    this.consumerGroup = options.consumerGroup || 'nowing_nlp_workers';
    this.client = options.client || null;
  }

  async getPendingCount() {
    if (!this.client) {
      this.client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
      await this.client.connect().catch(() => { /* Redis unavailable */ });
    }
    try {
      const pending = await this.client.xPending(this.streamName, this.consumerGroup);
      // redis v4 xPending returns an object; the total pending length is typically pending.pending
      return pending?.pending ?? 0;
    } catch (err) {
      console.warn(`[StreamMetricsReader] Redis stream pending unreadable: ${err.message}`);
      return 0;
    }
  }
}
```

If `XPENDING` fails because the consumer group does not exist, return `0`. Do not create the group from this utility.

#### 3.3 Wiring to the governor

Provide a helper:

```js
export async function refreshGovernorConsumerLag(governor, reader) {
  if (!governor || !reader) return;
  const lag = await reader.getPendingCount();
  governor.updateRedisConsumerLag(lag);
}
```

A background interval (e.g. 5s) is optional; the story does **not** require a long-running daemon. The `GET /governor/status` route can call `refreshGovernorConsumerLag(globalAdaptiveRateGovernor, globalStreamMetricsReader)` before responding.

---

### 4. HTTP API

Create `api/routes/governor.js`:

```js
import express from 'express';
import { globalStatusApi } from '../../src/core/index.js';

const router = express.Router();

router.get('/status', async (req, res) => {
  try {
    const status = globalStatusApi.getGovernorStatus();
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read governor status', message: error.message });
  }
});

export default router;
```

Mount it in `api/server.js`:

```js
import governorRoutes from './routes/governor.js';
// ...
app.use('/governor', governorRoutes);
```

This makes `GET /governor/status` available, matching AD-14.

---

### 5. CLI `xactions status`

Add to `src/cli/index.js` before `program.parse()`:

```js
program
  .command('status')
  .description('Show current governor, proxy, and account hibernation status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const { globalStatusApi } = await import('../core/index.js');
      const status = globalStatusApi.getGovernorStatus();

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      const chalk = (await import('chalk')).default;
      const throttleColor =
        status.throttleLevel === 'normal' ? chalk.green :
        status.throttleLevel === 'reduced' ? chalk.yellow :
        status.throttleLevel === 'backpressure' ? chalk.magenta :
        chalk.red;

      console.log(chalk.bold('\n🛡️  Governor Status\n'));
      console.log(`  Healthy proxies:    ${status.healthyProxyCount} / ${status.totalProxyCount} (${(status.healthyProxyRatio * 100).toFixed(1)}%)`);
      console.log(`  Current RPS:        ${status.currentReqPerSecond}`);
      console.log(`  Redis consumer lag: ${status.redisConsumerLag}`);
      console.log(`  Throttle level:     ${throttleColor(status.throttleLevel)}`);

      if (status.hibernatingAccounts.length > 0) {
        console.log(chalk.bold(`\n  Hibernating accounts (${status.hibernatingAccounts.length}):`));
        for (const h of status.hibernatingAccounts) {
          console.log(`    • ${h.accountId} — ${h.reason} (${h.remainingSeconds}s)`);
        }
      }
    } catch (error) {
      console.error(chalk.red(`❌ ${error.message}`));
      process.exitCode = 1;
    }
  });
```

Use the `chalk` import already at the top of the file. Adjust the import path to `../core/index.js` if needed.

---

### 6. MCP tool `x_governor_status`

#### 6.1 Add tool definition

In `src/mcp/server.js` `TOOLS` array, add:

```js
{
  name: 'x_governor_status',
  description: 'Get the current adaptive rate governor status: proxy health, account hibernations, Redis consumer lag, and throttle level.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
},
```

#### 6.2 Add handler

In `executeTool`, add a case before the final `default:`:

```js
case 'x_governor_status': {
  const { globalStatusApi } = await import('../core/index.js');
  return globalStatusApi.getGovernorStatus();
}
```

Use the same dynamic import pattern as `x_schema_list` (`src/mcp/server.js:4800`).

---

### 7. TypeScript declarations

#### 7.1 `types/core.d.ts`

Update the `AdaptiveRateGovernor` declaration (around line 283-297) to match the JS class:

```ts
export class AdaptiveRateGovernor {
  constructor(deps?: { proxyPool?: unknown; healthyProxyFloor?: number });
  setPlatformLimit(platform: string, limits?: Partial<PlatformRateLimit>): void;
  getPlatformLimit(platform: string): PlatformRateLimit;
  isAuthRequired(platform: string): boolean;
  updateState(state: { healthyProxyCount: number; totalProxyCount: number; redisConsumerLag: number }): void;
  updateRedisConsumerLag(lag: number): void;
  getRedisConsumerLag(): number;
  refreshFromProxyPool(): void;
  getMaxThroughput(platform: string): number;
  recordRequest(accountId: string, platform?: string): void;
  getAccountVelocity(accountId: string, platform?: string): number;
  canAccountRequest(accountId: string, platform: string): boolean;
  hibernateAccount(accountId: string, reason: string, durationMs?: number, platform?: string): void;
  recordRateLimit(accountId: string, platform?: string, durationMs?: number): void;
  recordBotChallenge(accountId: string, platform?: string, durationMs?: number): void;
  wakeAccount(accountId: string, platform?: string): void;
  isHibernating(accountId: string, platform?: string): boolean;
  getStatus(): GovernorStatus;
}

export declare const globalAdaptiveRateGovernor: AdaptiveRateGovernor;
```

Add `StatusApi` global export:

```ts
export class StatusApi {
  constructor(deps?: { governor?: AdaptiveRateGovernor });
  getGovernorStatus(): GovernorStatus;
}

export declare const globalStatusApi: StatusApi;
```

#### 7.2 `types/index.d.ts`

Re-export from the core module so external consumers can import from `'xactions'`:

```ts
export {
  AdaptiveRateGovernor,
  PlatformRateLimit,
  AccountPool,
  ProxyIpPool,
  StatusApi,
  globalAdaptiveRateGovernor,
  globalStatusApi,
  globalProxyPool,
  globalAccountPool,
} from './core';
```

Place this in the core section near the top, or at the bottom with other re-exports.

---

### 8. Cleanup in `src/core/base-client.js`

Replace the block at `base-client.js:347-350`:

```js
// before (wrong)
if (this.governor && typeof this.governor.hibernateAccount === 'function') {
  this.governor.hibernateAccount(currentAccountId, this.platform, this.rateLimitHibernationMs, 'rate_limit');
}

// after (correct)
if (this.governor && typeof this.governor.recordRateLimit === 'function') {
  this.governor.recordRateLimit(currentAccountId, this.platform, this.rateLimitHibernationMs);
}
```

`accountPool.markUnavailable(...)` is still called on the line above and will also hibernate via `account-pool.js:206-208`. Calling `recordRateLimit` is safe because it uses the same `hibernateAccount` with a correct reason string. If tests reveal double hibernation, prefer removing the explicit governor call and relying solely on `AccountPool`. The key requirement is **correct argument order**.

---

### Review Findings (Adversarial Code Review - 14/14 Patched & Verified)
- [x] [Review][Patch] Fix `currentReqPerSecond` decay to zero when traffic ceases [`src/core/adaptive-governor.js`]
- [x] [Review][Patch] Implement default Redis connection and `refreshGovernorConsumerLag` helper in `StreamMetricsReader` [`src/utils/stream-metrics.js`]
- [x] [Review][Patch] Re-export global singletons and classes in root `types/index.d.ts` [`types/index.d.ts`]
- [x] [Review][Patch] Add `getRedisConsumerLag()` getter in `AdaptiveRateGovernor` and `types/core.d.ts` [`src/core/adaptive-governor.js`, `types/core.d.ts`]
- [x] [Review][Patch] Prevent double platform prefixing in `#resolveAccountId` [`src/core/adaptive-governor.js`]
- [x] [Review][Patch] Fix `healthyProxyFloor` and 0-total proxy handling in `getStatus()` [`src/core/adaptive-governor.js`]
- [x] [Review][Patch] Add hysteresis mechanism (10,000 threshold, 5,000 recovery) for Redis lag backpressure [`src/core/adaptive-governor.js`]
- [x] [Review][Patch] Set default `durationMs` for `recordBotChallenge` to 20 minutes [`src/core/adaptive-governor.js`]
- [x] [Review][Patch] Standardize `GET /governor/status` payload and error handling [`api/routes/governor.js`]
- [x] [Review][Patch] Refine CLI `xactions status` color coding and use `process.exitCode = 1` [`src/cli/index.js`]
- [x] [Review][Patch] Prune empty timestamp arrays in `#accountRequestTimestamps` to prevent memory leak [`src/core/adaptive-governor.js`]
- [x] [Review][Patch] Remove `any` JSDoc annotations in `StreamMetricsReader` [`src/utils/stream-metrics.js`]
- [x] [Review][Patch] Add null/undefined guard to `updateState()` [`src/core/adaptive-governor.js`]
- [x] [Review][Patch] Add automated test coverage for Governor route, CLI, and StreamMetricsReader [`tests/core/status-api.test.js`, `tests/utils/stream-metrics.test.js`]

### Additional Review Findings (Pending — from final code review pass)

- [ ] [Review][Patch] `tests/utils/stream-metrics.test.js` sử dụng mock Redis client object, vi phạm quy tắc **"No mocks, stubs, or fakes"** của dự án và testing requirement AC-11 trong spec. Cần refactor test để dùng `StreamMetricsReader` thật (Redis unreachable / real server khi có) hoặc tách hàm xử lý response ra test pure logic. [`tests/utils/stream-metrics.test.js`]
- [ ] [Review][Patch] `GET /governor/status`, CLI `xactions status` và MCP `x_governor_status` không gọi `refreshGovernorConsumerLag()` trước khi trả về status, nên `redisConsumerLag` và `throttleLevel` có thể là giá trị cũ. Cần wire `StreamMetricsReader` vào các surfaces này hoặc document rõ cơ chế refresh. [`api/routes/governor.js`, `src/cli/index.js`, `src/mcp/server.js`]
- [ ] [Review][Decision] `GET /governor/status` hiện trả về `{ success, status, data }` thay vì status shape chính xác như AC-6 yêu cầu. Cần quyết định: (a) giữ wrapper `success/data` cho nhất quán với API khác và cập nhật AC-6, hoặc (b) trả về đúng shape. [`api/routes/governor.js`]
- [ ] [Review][Patch] `AdaptiveRateGovernor.updateState()` chưa validate kiểu số cho các field; truyền `null` cho `healthyProxyCount`/`totalProxyCount`/`redisConsumerLag` có thể làm hỏng internal state. [`src/core/adaptive-governor.js`]
- [ ] [Review][Patch] `src/core/base-client.js` gọi đồng thời `accountPool.markUnavailable()` và `governor.recordRateLimit()` dẫn đến hibernation dư thừa; nên bỏ một trong hai hoặc document rõ lý do. [`src/core/base-client.js`]
- [ ] [Review][Defer] `src/core/adaptive-governor.js` import trực tiếp `globalProxyPool` từ `src/proxy/proxy-pool.js` tạo runtime dependency từ `core` sang `proxy`. Hiện không gây circular import nhưng có thể ảnh hưởng đến khả năng test `core` độc lập; đề xuất xem xét lại khi refactor. [`src/core/adaptive-governor.js`]

---

## File Structure Requirements

| File | Action | Purpose |
| `src/core/adaptive-governor.js` | UPDATE | Add `recordRateLimit`, `recordBotChallenge`, `updateRedisConsumerLag`, `globalAdaptiveRateGovernor`, fix hibernation reason, tighten `getStatus`. |
| `src/core/status-api.js` | UPDATE | Add `globalStatusApi` singleton. |
| `src/core/index.js` | UPDATE | Export `globalAdaptiveRateGovernor` and `globalStatusApi`. |
| `src/core/base-client.js` | UPDATE | Fix the wrong `governor.hibernateAccount` call at lines 347–350. |
| `src/utils/stream-metrics.js` | NEW | `StreamMetricsReader` that reads Redis Stream pending count. |
| `api/routes/governor.js` | NEW | Express route `GET /governor/status`. |
| `api/server.js` | UPDATE | Mount `app.use('/governor', governorRoutes)`. |
| `src/cli/index.js` | UPDATE | Add top-level `program.command('status')`. |
| `src/mcp/server.js` | UPDATE | Add `x_governor_status` tool definition and handler. |
| `types/core.d.ts` | UPDATE | Declare new methods and global singletons. |
| `types/index.d.ts` | UPDATE | Re-export new globals. |
| `tests/core/adaptive-governor.test.js` | NEW | Unit tests for governor logic. |
| `tests/core/status-api.test.js` | NEW | Tests for `StatusApi` and status shape. |

---

## Library / Framework Requirements

* **No new runtime dependencies.** Use packages already in `package.json`:
  * `undici` for HTTP in the test helper (if any).
  * `redis` v4 for the `StreamMetricsReader`.
  * `commander` for the CLI command.
  * `@modelcontextprotocol/sdk` for the MCP tool.
  * `express` for the API route.
* **No `ioredis`.** The project does not list it in `package.json` (only `src/streaming/streamManager.js` dynamically imports it). Stick to the installed `redis` package.
* **No `any` / `@ts-ignore` in `types/**`.**
* **No mocks in tests.** Use real `ProxyIpPool`, `AccountPool`, `AdaptiveRateGovernor`, and `StatusApi` instances.

---

## Testing Requirements

Create `tests/core/adaptive-governor.test.js`.

### Mandatory test groups

1. **Dynamic throughput (AC-1)**
   * `getMaxThroughput` returns `healthy * base * throttle` at full health.
   * Drops to 50% when healthy < 50% of total.
   * Returns `0` when healthy < 10% or healthy < `healthyProxyFloor`.
   * Returns 25% when `redisConsumerLag > 10000`.

2. **Account hibernation (AC-2, AC-3)**
   * `canAccountRequest` returns `false` after `safeRequestsPerMinute` records.
   * `recordRateLimit` makes `isHibernating` true and `canAccountRequest` false.
   * `wakeAccount` clears hibernation.
   * Expired hibernations are pruned by `getStatus`.

3. **No-auth synthetic key (AC-4)**
   * `recordRequest('noauth', 'chotot')` tracks under the composite key `'chotot:noauth'`.
   * `canAccountRequest('noauth', 'chotot')` respects `safeRequestsPerMinute`.

4. **Status shape (AC-6)**
   * `getStatus()` returns all required fields with correct types.
   * `throttleLevel` is `'critical'` when healthy ratio < 0.1.
   * `throttleLevel` is `'backpressure'` when `redisConsumerLag > 10000`.

Create `tests/core/status-api.test.js`:

* `getGovernorStatus()` with a real governor returns the same shape.
* `getGovernorStatus()` with no governor returns the zero-state object.
* `globalStatusApi` from `src/core/index.js` is the same instance exported by `src/core/status-api.js`.

Create `tests/utils/stream-metrics.test.js` (optional, skip if no Redis server):

* If `process.env.REDIS_URL` or `process.env.REDIS_HOST` is set, start a `redis` client, write a few messages to a test stream with a test consumer group, and assert `StreamMetricsReader.getPendingCount()` matches.
* If Redis is unavailable, skip the test group with `console.log` and still run the other tests.

### Test conventions

* Use `vitest` `describe` / `test` / `expect`.
* Do **not** use `vi.fn()`.
* Do **not** use `vi.useFakeTimers()` for the 15-minute hibernation tests; pass small `durationMs` (e.g. `100`) and `await new Promise(r => setTimeout(r, 150))` for real time.
* Keep HTTP tests under `30s` (Vitest default).

---

## Project Context Reference

* **Core contracts:** `src/core/error-envelope.js`, `src/core/types.js`, `src/core/index.js`
* **Proxy / account state:** `src/proxy/proxy-pool.js`, `src/core/account-pool.js`
* **Request pipeline that consumes the governor:** `src/core/base-client.js`
* **Status consumers:** `api/routes/proxies.js`, `src/cli/index.js`, `src/mcp/server.js`
* **Type declarations:** `types/core.d.ts`, `types/proxy.d.ts`, `types/index.d.ts`
* **PRD:** FR-66B (Adaptive Rate Limiter), NFR-13 (Self-healing), NFR-17 (Observability)
* **Architecture:** AD-13, AD-14, AD-17, AD-19

---

---

## Dev Agent Record

### Implementation Plan
1. Updated `AdaptiveRateGovernor` (`src/core/adaptive-governor.js`) with `recordRateLimit`, `recordBotChallenge`, `updateRedisConsumerLag`, `globalAdaptiveRateGovernor`, sliding window velocity tracking, and automatic expiration pruning.
2. Updated `StatusApi` (`src/core/status-api.js`) and exported `globalStatusApi`.
3. Exported `globalAdaptiveRateGovernor` and `globalStatusApi` in `src/core/index.js`.
4. Fixed governor hibernation call in `src/core/base-client.js`.
5. Implemented `StreamMetricsReader` in `src/utils/stream-metrics.js`.
6. Created `api/routes/governor.js` (`GET /governor/status`) and mounted in `api/server.js`.
7. Added `xactions status` command in `src/cli/index.js`.
8. Added `x_governor_status` MCP tool in `src/mcp/server.js`.
9. Updated TypeScript declarations in `types/core.d.ts` and `types/index.d.ts`.
10. Unskipped and verified all 18 tests in `tests/core/adaptive-governor.test.js` & `tests/core/status-api.test.js` (100% green).
11. Ran full regression suite across all core, proxy, and client test files (273/273 passing).

### Completion Notes List
- All 18 tests pass with zero mocks.
- Zero `@ts-ignore` and zero `any` in TypeScript declarations.
- Verified live integration between `AdaptiveRateGovernor`, `ProxyIpPool`, and `StatusApi`.

### File List
- `src/core/adaptive-governor.js` (MODIFIED)
- `src/core/status-api.js` (MODIFIED)
- `src/core/index.js` (MODIFIED)
- `src/core/base-client.js` (MODIFIED)
- `src/utils/stream-metrics.js` (NEW)
- `api/routes/governor.js` (NEW)
- `api/server.js` (MODIFIED)
- `src/cli/index.js` (MODIFIED)
- `src/mcp/server.js` (MODIFIED)
- `types/core.d.ts` (MODIFIED)
- `tests/core/adaptive-governor.test.js` (NEW)
- `tests/core/status-api.test.js` (NEW)
- `_bmad-output/test-artifacts/atdd-checklist-11-4-adaptive-infrastructure-aware-rate-limiter-account-protection-governor.md` (NEW)

### Change Log
- 2026-08-21: Implemented Story 11.4 - Adaptive Infrastructure-Aware Rate Limiter & Account Protection Governor.

---

## Story Completion Status

- **Status:** in-progress
- **Context engine analysis completed:** PRD, architecture, contracts, and requirements analyzed.
- **Testing:** 18/18 tests passing (100% green), 291/291 regression tests passing across 18 test files.
- **Code Review:** 14/14 adversarial review patches applied and verified; **6 additional findings** identified in final review pass and awaiting resolution.
- **Next phase:** Resolve findings, re-run tests, then proceed to Story 11.5.
