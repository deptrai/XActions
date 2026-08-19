# Story 11.3 — 429/403 Auto-Quarantine, Standby Backoff & Exponential Replay Interceptor

**Story ID:** 11.3  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 11.3, `ARCHITECTURE-SPINE.md` AD-3, AD-9, AD-13, AD-14, AD-2, AD-8; PRD FR-66B, NFR-13; previous stories 11.1 and 11.2; current `src/core/base-client.js`, `src/proxy/**`, `src/core/account-pool.js`, `src/core/adaptive-governor.js`, `src/core/error-envelope.js`.

---

## Story

As a **Reliability Engineer**,  
I want **the request pipeline to automatically quarantine a proxy that returns 429/403, replay the request with a fresh proxy, and fall back to a Standby Backoff when the whole pool is exhausted**,  
so that **the scraping pipeline never hard-crashes when a platform turns on wide-area rate limiting or bot challenges**.

---

## Acceptance Criteria

### AC-1: 429/403 detection inside the request pipeline
* **Given** `AbstractApiClient` is configured with a `proxyProvider` or `proxyPool`, and `request()` is invoked
* **When** the HTTP response status is `429` or `403`, or the underlying request throws a network/connection error that is classified as `proxy_exhausted` (`ProxyDeadError`)
* **Then** the pipeline throws a `PlatformError` with:
  - `type` = `rate_limit` for HTTP 429 or `BOT_CHALLENGE` for HTTP 403
  - `statusCode` = the HTTP status
  - `code` = a stable `XACT_4290` (rate limit) or `XACT_4030` (bot challenge) or `XACT_5030` (proxy dead) code
  - `suggestedAction` = `ROTATE_PROXY` for 429/403 and `WAIT` for proxy dead
  - `retryAfterMs` parsed from the `Retry-After` header, or computed from the exponential backoff schedule
  - `accountId` and `platform` populated when known

### AC-2: Auto-quarantine on 429/403
* **Given** a proxy returns 429/403
* **When** the interceptor catches it
* **Then** it immediately calls `provider.quarantine(proxy, DEFAULT_QUARANTINE_MS)` (default 5 minutes)
* **And** it breaks any sticky binding that the provider or account pool has for that proxy (for `ProxyIpPool`, this is already done inside `quarantine`; for `DynamicTunnelProvider`, `quarantine` quarantines the exact session key)
* **And** it records the failure on the `AdaptiveRateGovernor` by calling `governor.recordRateLimit(accountId, platform, durationMs)` when an `accountId` is available and the platform is auth-required

### AC-3: No-auth platforms — proxy rotation + exponential replay
* **Given** `requiresAuth === false`
* **When** 429/403 or proxy dead occurs
* **Then** the interceptor draws a new proxy with `provider.getNext()` on every retry attempt
* **And** it replays the same request up to `maxProxyRetries` (default 3) with exponential backoff delays `[1000, 2000, 4000]` ms
* **And** each delay is jittered with **full jitter** (`Math.random() * baseDelay`) to avoid thundering-herd retries across workers
* **And** if `provider.isAllQuarantined()` becomes true at any point, the interceptor stops retrying and throws `proxy_exhausted` (`XACT_5030`) with `retryAfterMs` equal to the provider's `standbyBackoffMs` (default 30,000 ms)

### AC-4: Auth-required platforms — sticky proxy fallback + account rotation
* **Given** `requiresAuth === true` and an `accountId` is available
* **When** 429/403 or proxy dead occurs
* **Then** the interceptor first attempts to keep the same account and obtain a new sticky proxy with `provider.getStickyProxy(accountId)` (or `provider.getProxy({ accountId })`)
* **And** it retries up to `maxProxyRetries` (default 3) with the same account, quarantining each failed proxy and moving to the next sticky assignment
* **And** if all `maxProxyRetries` attempts fail and the platform is auth-required, the interceptor marks the current account unavailable with `accountPool.markUnavailable(accountId, 'rate_limit', rateLimitHibernationMs, platform)` and `governor.recordRateLimit(accountId, platform, rateLimitHibernationMs)`
* **And** it then attempts to rotate the account with `accountPool.getNextAvailable(platform)` (the next account becomes the current `accountId`)
* **And** it resets the proxy retry counter and continues the exponential backoff sequence for the new account, up to one extra full set of `maxProxyRetries`
* **And** if no healthy proxy or no available account exists, it throws `proxy_exhausted` or `hibernation` with `retryAfterMs` set to the longer of `standbyBackoffMs` or the account hibernation duration

### AC-5: Standby Backoff when the whole pool is quarantined
* **Given** the interceptor has quarantined the proxy used by the current request
* **When** `provider.isAllQuarantined()` is `true`
* **Then** the interceptor immediately stops the retry loop and throws `PlatformError`:
  - `type` = `PROXY_EXHAUSTED`
  - `code` = `XACT_5030`
  - `suggestedAction` = `WAIT`
  - `retryAfterMs` = `provider.standbyBackoffMs` or `STANDBY_BACKOFF_MS` (30,000 ms default)
* **And** the error message clearly states the standby state instead of looping infinitely
* **And** if an `accountId` is bound, it calls `accountPool.markUnavailable(accountId, 'proxy_exhausted', STANDBY_BACKOFF_MS, platform)` so the account is not retried while the pool is exhausted

### AC-6: Retry-After header honor
* **Given** an HTTP 429/403 response contains a `Retry-After` header
* **When** the interceptor is deciding the next backoff delay
* **Then** for the first attempt it uses the `Retry-After` value if it is larger than the computed exponential delay (max of parsed header and computed delay)
* **And** it clamps the delay to a configurable `maxBackoffMs` (default 30,000 ms) to avoid multi-hour stalls

### AC-7: Governor integration
* **Given** an `AdaptiveRateGovernor` is configured
* **When** a request starts
* **Then** the pipeline calls `governor.canAccountRequest(accountId, platform)` for auth-required platforms and throws `PlatformError` (`type: HIBERNATION`, `code: XACT_4291`, `suggestedAction: ROTATE_ACCOUNT`) if the account is hibernating or over velocity
* **And** on a successful request, it calls `governor.recordRequest(accountId, platform)` and `accountPool.recordRequest(accountId, platform)`
* **And** on 429/403, it calls `governor.recordRateLimit(accountId, platform, rateLimitHibernationMs)` when an account is known

### AC-8: Request pipeline is implemented inside `AbstractApiClient`
* **Given** `src/core/base-client.js`
* **When** `AbstractApiClient.request(method, url, options)` is called
* **Then** it no longer throws "Method not implemented"
* **And** it performs the proxy/account resolution, HTTP dispatch, error classification, quarantine, retry, and backoff described in AC-1..AC-7
* **And** it delegates the actual HTTP transport to a pluggable `httpClient` (or `requestFn`) so `src/core` does not need to depend on `undici` or `got-scraping` at runtime
* **And** it uses `provider.getProxyAgent(proxy, { client: this.client })` to obtain the correct agent shape (`undici` `ProxyAgent`/`Socks5ProxyAgent` or `got` URL string) before passing it to `httpClient`

### AC-9: No direct connection fallback
* **Given** proxy resolution fails or the pool is exhausted
* **When** `request()` is called
* **Then** it never falls back to a direct (unproxied) connection
* **And** it throws `proxy_exhausted` (`XACT_5030`) with a clear message and `suggestedAction: WAIT`

### AC-10: TypeScript declarations and zero-dependency core
* **Given** `types/proxy.d.ts` and `types/index.d.ts`
* **When** the declarations are consumed
* **Then** `AbstractApiClient` declares `request()`, `client`, `maxProxyRetries`, `backoffBaseMs`, `backoffMultiplier`, `maxBackoffMs`, `rateLimitHibernationMs`, and any new interceptor options
* **And** `ProxyRequestOptions` is extended with `maxProxyRetries`, `backoff`, `retry`, `client` if needed
* **And** there are zero `any` annotations and zero `@ts-ignore` comments
* **And** `src/core/error-envelope.js` receives no new external dependencies

### AC-11: Tests pass with zero mocks
* **Given** the implementation and a new test file `tests/core/base-client-request.test.js`
* **When** running `npx vitest run tests/core/base-client-request.test.js`
* **Then** all tests pass using real in-memory `ProxyIpPool`, `StaticProxyProvider`, `DynamicTunnelProvider`, `AccountPool`, and `AdaptiveRateGovernor` instances
* **And** tests use a small local HTTP server (or `undici` mock socket only if no real server can be started) to simulate 429/403 responses
* **And** tests cover: 429 → quarantine → retry, 403 → quarantine → account hibernation, exhausted pool → standby, `Retry-After` honor, exponential backoff timing, no direct connection fallback

---

## Previous Story Intelligence

### Core implementation patterns carried forward

| Pattern | Source in 11.1 / 11.2 / current code | Why it matters for 11.3 |
|---|---|---|
| `ProxyProviderContract` — `getProxy/getStickyProxy/getNext/quarantine/isAllQuarantined/healthyCount/totalCount` | `types/proxy.d.ts:56-68`, `src/proxy/providers.js:156-258` | The interceptor must only speak this contract so it works with `ProxyIpPool`, `StaticProxyProvider`, and `DynamicTunnelProvider` interchangeably. |
| Quarantine key uses `formatProxyUrl(normalized)` including credentials | `src/proxy/proxy-pool.js:93-104`, `src/proxy/providers.js:559-566` | Quarantine must target the exact session URL, not the gateway, otherwise one bad session disables the whole provider. |
| `DynamicTunnelProvider` session key includes session tag and `quarantine` marks the session, not the gateway | `src/proxy/providers.js:627-653` | 429/403 on a residential session must not block the gateway; the interceptor must pass the exact proxy object returned by `getProxy` to `quarantine`. |
| `AbstractApiClient.resolveProxy` throws `proxy_exhausted` (`XACT_5030`, 30s) when provider is missing or exhausted | `src/core/base-client.js:57-123` | The new `request()` must keep this contract and surface it on standby backoff. |
| `AccountPool` uses `platform:accountId` keys and `markUnavailable` with `governor.hibernateAccount` side effect | `src/core/account-pool.js:182-209` | Account rotation must use the exact key format and must record hibernation on the governor. |
| `AdaptiveRateGovernor` `canAccountRequest`, `recordRequest`, `recordRateLimit` | `src/core/adaptive-governor.js:164-227` | The pipeline must check account velocity before the first request and record rate-limit hibernation after 429. |
| `ErrorTypes` and `isRetryable` set | `src/core/error-envelope.js:10-45` | Only `RATE_LIMIT`, `BOT_CHALLENGE`, `PROXY_EXHAUSTED`, and `HIBERNATION` are retryable. Auth / non-retryable errors stop the loop. |
| `PlatformError.toEnvelope()` standard shape `{ code, type, message, statusCode, isRetryable, retryAfterMs, retryAfter, suggestedAction, accountId, platform }` | `src/core/error-envelope.js:83-97` | Every thrown error in the interceptor must be a `PlatformError` and produce this envelope for MCP/HTTP/CLI consumers. |
| `getProxyAgent(proxy, { client: 'undici' \| 'got' })` returns the right shape per client | `src/proxy/providers.js:229-260`, `types/proxy.d.ts:66` | The interceptor must ask the provider for the agent in the format the selected `httpClient` expects. |

### 11.2 code-review findings that directly shape 11.3

1. **Do not quarantine the gateway for a single session failure.** For `DynamicTunnelProvider`, the `quarantine` key is the full credential URL (e.g. `http://user:pass:abc@tps.kdlapi.com:15818`). Quarantining the bare gateway would block the provider. The interceptor must pass the exact `NormalizedProxy` that was used for the request. [`src/proxy/providers.js:627-653`]
2. **Session IDs are provider-specific.** IPRoyal is exactly 8 chars; Kuaidaili ≤6; BrightData ≤64 alphanumeric; Smartproxy ≤32 with underscores. When a 429 occurs, a newly generated session ID must still respect these rules. [`src/proxy/providers.js:368-412`]
3. **No direct connection fallback.** `AbstractApiClient.resolveProxy` throws if no proxy is available. `request()` must never call an HTTP client without an agent or proxy. [`src/core/base-client.js:57-123`]
4. **Per-request vs. sticky session modes.** Auth-required platforms must use `accountId` to keep a sticky session; no-auth platforms must not pass `accountId`. The interceptor's retry proxy selection must mirror this. [`src/proxy/providers.js:835-921`]
5. **Account hibernation and proxy quarantine are separate but related.** Quarantine is for the proxy (5 minutes). Hibernation is for the account (15 minutes). The interceptor must do both when an auth account hits a rate limit. [`src/core/adaptive-governor.js:212-227`, `src/core/account-pool.js:182-209`]
6. **Clock skew and the proxy-selection/request-use transaction gap remain deferred to 11.5/11.7.** Story 11.3 does not need to solve the multi-worker check-in/check-out gap, but must document it. [`deferred-work.md`]

### 11.2 test approach to mirror

- Real in-memory providers and pools; no `vi.fn()` or stubbed `undici`.
- Use `vi.useFakeTimers()` for quarantine expiry and backoff timing tests.
- Assert `PlatformError` with `code === 'XACT_5030'` for exhausted/standby cases.
- Assert `PlatformError` with `type === 'rate_limit'` or `'bot_challenge'` for 429/403.
- Test both `ProxyIpPool` (static) and `DynamicTunnelProvider` (tunnel) as `proxyProvider`.

---

## Architecture Compliance

### AD-3 — Centralized Proxy IP Pool with Auto-Quarantine, Anti-Leak & Proxy Strategy by Auth Mode
* **Binds:** `src/proxy/**`, toàn bộ Network Interceptors
* **Relevant rules:**
  1. Two proxy modes: auth-required (sticky), no-auth (per-request).
  2. On 429/403: quarantine 5 minutes, retry 3 times with exponential backoff.
  3. 100% quarantined → Standby Backoff 30s, no infinite loop.
  4. SOCKS5 via `Socks5ProxyAgent`; no direct fallback.

**11.3 compliance:**
- `AbstractApiClient.request()` implements the 429/403 detection, quarantine, retry, and standby backoff exactly as specified.
- Proxy selection respects `requiresAuth` and uses `getProxy({ accountId })` / `getStickyProxy(accountId)` vs `getProxy()` / `getNext()`.
- Standby is thrown as `PlatformError` (`proxy_exhausted`, `XACT_5030`) with `retryAfterMs`.

### AD-9 — Anti-Bot Payload Validation & Data Sanitization Defense
* **Binds:** `src/scrapers/**`, `src/utils/exporter.js`
* **Relevant rules:**
  1. `PlatformResponseValidator` with `isValidPayload`, `isBotChallenge`, `isRateLimit` (Story 11.7).
  2. No-auth → throw `RateLimitError`; auth → throw `BotChallengeError`/`RateLimitError`, quarantine, hibernate account, rotate account.

**11.3 compliance:**
- The base `request()` classifies HTTP 429 as `RateLimitError` and HTTP 403 as `BotChallengeError`.
- Auth-required platforms call `accountPool.markUnavailable` and `governor.recordRateLimit` on 429/403 after proxy retries are exhausted.
- The base design is forward-compatible: a `PlatformResponseValidator` can be injected later by `AbstractApiClient` subclasses (e.g. `TwitterHttpClient`) to trigger quarantine on 200-with-challenge body.

### AD-13 — Adaptive Infrastructure-Aware Dynamic Rate Limiting & Account Protection Governor
* **Binds:** `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js`
* **Relevant rules:**
  1. Throttle by `healthyProxyCount`.
  2. Account hibernation 15–30 minutes.
  3. Account rotation.
  4. Consumer lag backpressure.

**11.3 compliance:**
- `request()` calls `governor.canAccountRequest` before first dispatch and `governor.recordRequest` on success.
- `governor.recordRateLimit` is called when an auth account is rate-limited.
- Account rotation uses `accountPool.getNextAvailable`.

### AD-14 — Operational Status & Error Envelope for Consumers
* **Binds:** `src/mcp/**`, `src/api/**`, `src/cli/**`, `src/core/error-envelope.js`
* **Relevant rules:**
  1. Error envelope shape `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.

**11.3 compliance:**
- All interceptor errors are `PlatformError` and produce the full envelope.
- `retryAfterMs` is always set; `suggestedAction` is one of the enum values.

### AD-2 — Unified Base Scraper & Client Interfaces
* **Binds:** `src/core/base-crawler.js`, `src/core/base-client.js`
* **Relevant rule:** New abstractions live in `src/core/**`; `src/client/` is legacy.

**11.3 compliance:**
- Implementation stays inside `src/core/base-client.js` or a new `src/core/request-pipeline.js` helper; no `src/client/` changes.
- `AbstractApiClient.request()` is the canonical extension point; platform subclasses override `sign()` and optionally `handleError()`, not `request()`.

### AD-8 — Multi-Domain Expansion Blueprint
* **Binds:** `src/scrapers/**`
* **Relevant rule:** Platform-specific logic lives in `src/scrapers/{domain}/{platform}/`.

**11.3 compliance:**
- The base interceptor is platform-agnostic. Platform-specific response parsing belongs in `AbstractCrawler` / `PlatformResponseValidator` (11.7).

---

## Technical Requirements

### 1. Request pipeline algorithm

`AbstractApiClient.request(method, url, options = {})` must execute the following pipeline. The exact method can be split into private helpers, but the behavior must be preserved.

```
1. Determine accountId (for requiresAuth):
     a. If options.accountId provided, use it.
     b. Else if accountPool exists, accountId = accountPool.getNextAvailable(this.platform)
     c. Else if no account pool, throw invalid_args (auth platforms require an account pool)
2. If requiresAuth and governor exists:
     if !governor.canAccountRequest(accountId, platform):
        throw PlatformError({ type: HIBERNATION, code: XACT_4291, suggestedAction: ROTATE_ACCOUNT })
3. Resolve proxy:
     proxy = this.resolveProxy(accountId)
4. Build HTTP transport options:
     agent = provider.getProxyAgent(proxy, { client: this.client })
     requestOptions = { method, headers, body, signal, ...options, agent }
5. Dispatch via httpClient:
     response = await this.httpClient(url, requestOptions)
6. If status is 429/403:
     throw RateLimitError / BotChallengeError with accountId, platform, retryAfterMs parsed from Retry-After
7. If status >= 500 or network/connection error:
     throw ProxyDeadError (or platform equivalent) with type PROXY_EXHAUSTED
8. If status is 401:
     throw AuthSessionExpiredError (no retry)
9. Record success:
     governor.recordRequest(accountId, platform)
     accountPool.recordRequest(accountId, platform)
10. Return response
```

### 2. Retry / quarantine loop

```
let accountId = initialAccountId
let proxyRetries = 0
let accountRotations = 0
let lastError = null

while (proxyRetries < maxProxyRetries || accountRotations === 0 for auth):
  try:
    return await executeRequest(accountId)
  catch (error):
    if not error.isRetryable: throw error
    if error is RATE_LIMIT / BOT_CHALLENGE / PROXY_EXHAUSTED:
      quarantine current proxy
    if provider.isAllQuarantined():
      throw proxy_exhausted standby error

    proxyRetries += 1

    if requiresAuth and proxyRetries >= maxProxyRetries and accountRotations < maxAccountRotations:
      accountPool.markUnavailable(accountId, 'rate_limit', rateLimitHibernationMs, platform)
      governor.recordRateLimit(accountId, platform, rateLimitHibernationMs)
      accountId = accountPool.getNextAvailable(platform)
      if !accountId:
        throw hibernation / proxy_exhausted
      proxyRetries = 0
      accountRotations += 1

    delay = computeDelay(proxyRetries, error.retryAfterMs)
    await sleep(delay)

    # get new proxy for next attempt
    if requiresAuth:
      proxy = resolveProxy(accountId)
    else:
      proxy = resolveProxy()

throw lastError
```

### 3. Backoff formula

```
baseDelay = backoffBaseMs * (backoffMultiplier ^ (attempt - 1))
// default: 1000 * (2 ^ (attempt - 1)) => 1000, 2000, 4000
withFullJitter = Math.floor(Math.random() * baseDelay)
withRetryAfter = max(withFullJitter, retryAfterMsFromHeader)
finalDelay = min(withRetryAfter, maxBackoffMs)
```

### 4. Configuration defaults

```ts
interface RequestPipelineOptions {
  maxProxyRetries?: number;        // default 3
  maxAccountRotations?: number;    // default 1
  backoffBaseMs?: number;          // default 1000
  backoffMultiplier?: number;      // default 2
  maxBackoffMs?: number;           // default 30000
  rateLimitHibernationMs?: number; // default 15 * 60 * 1000
  standbyBackoffMs?: number;       // default 30 * 1000
  client?: 'undici' | 'got';       // default 'undici'
  httpClient?: (url, options) => Promise<Response>; // required
}
```

### 5. `AbstractApiClient` constructor changes

- Add `client?: 'undici' | 'got'` (default `'undici'`).
- Add `maxProxyRetries` etc. with defaults.
- Add `httpClient?: (url, options) => Promise<Response>` function. If not provided, `request()` throws `invalid_args`.
- Keep `proxyProvider` / `proxyPool`, `accountPool`, `governor`, `sessionManager`.

### 6. Pluggable HTTP transport

`src/core` must not import `undici` or `got-scraping`. The platform subclass or factory sets `this.httpClient` to a function compatible with the chosen `client`:

- `client: 'undici'`: `httpClient = async (url, { method, headers, body, agent, signal }) => fetch(url, { method, headers, body, dispatcher: agent, signal })` using `undici.fetch` (or `undici.request`). The `agent` is a `ProxyAgent` or `Socks5ProxyAgent`.
- `client: 'got'`: `httpClient = async (url, { method, headers, body, agent, signal }) => gotScraping({ url, method, headers, body, proxyUrl: agent, timeout: { request: 30000 }, signal })` where `agent` is the proxy URL string.

> **Note on Node fetch and dispatcher:** Node's global `fetch` does **not** accept a `dispatcher` option. To use a custom `ProxyAgent` you must use `undici.fetch` or `undici.request`. A helper factory in `src/proxy/` (e.g. `createHttpClient(client, agent)`) can be provided, but the `AbstractApiClient` must receive a ready-to-call `httpClient` so `src/core` stays dependency-free.

### 7. Error classification in `request()`

- `status === 429` → `RateLimitError` (`XACT_4290`, `ROTATE_PROXY`)
- `status === 403` → `BotChallengeError` (`XACT_4030`, `ROTATE_PROXY`)
- `status === 401` → `AuthSessionExpiredError` (`XACT_4010`, `RELOGIN`) — not retried
- `status >= 500` → `ProxyDeadError` (`XACT_5030`, `WAIT`) — retried
- Network/connection error → `ProxyDeadError` (`XACT_5030`, `WAIT`) — retried
- Any other status → call `this.handleError(response, platform)` and throw the result

### 8. Forward compatibility for `PlatformResponseValidator`

`AbstractApiClient` should accept an optional `responseValidator` (or the subclass overrides `handleError`) that can inspect the response body and throw `RateLimitError`/`BotChallengeError` even when the HTTP status is 200. In Story 11.3 this can be a no-op unless a validator is passed.

---

## Library & Framework Requirements

| Package | Version in `package.json` | Role in 11.3 | Notes |
|---|---|---|---|
| `undici` | `^7.29.0` | `ProxyAgent`, `Socks5ProxyAgent`, `undici.request`/`undici.fetch`, retry interceptor. | `src/proxy/**` may use `undici` directly. The base `AbstractApiClient` must receive an `httpClient` function so `src/core` does not depend on `undici`. |
| `got-scraping` | `^3.2.15` | Legacy HTTP client; still used in `src/client/` and `src/scrapers/twitter/`. | **Context7 + web research indicates `got-scraping` is EOL (final release 4.2.1, Feb 2026).** New `AbstractApiClient` subclasses should prefer `undici`. `got-scraping` support in the interceptor is for backward compatibility only. |
| `vitest` | `^4.0.18` | Test runner. | Use `vi.useFakeTimers()` for backoff and quarantine expiry. |

**Do not introduce new runtime dependencies in `src/core/**`.** `src/core` may only import `error-envelope.js` and `types.js` (and JSDoc type-only imports). All HTTP transport and proxy agent construction stays in `src/proxy/` or is injected by platform subclasses.

---

## File Structure Requirements

| File | Action | Why |
|---|---|---|
| `src/core/base-client.js` | **UPDATE** | Implement `AbstractApiClient.request()` with the full retry/quarantine/standby pipeline. Add configuration options (`client`, `maxProxyRetries`, `backoffBaseMs`, etc.). Update `handleError()` to classify 401/403/429/500+ into the correct `PlatformError` types. |
| `src/proxy/providers.js` | **UPDATE (minimal)** | Ensure `StaticProxyProvider.getProxyAgent` and `DynamicTunnelProvider.getProxyAgent` accept `{ client: 'undici' \| 'got' }` and return the right shape (ProxyAgent / Socks5ProxyAgent / string). No breaking change to existing provider logic. |
| `src/proxy/index.js` | **UPDATE (minimal)** | Export any new helper factory (e.g. `createUndiciClient`, `createGotClient`) if added to `src/proxy/**` for platform clients. |
| `src/core/error-envelope.js` | **UPDATE** | Add new codes `XACT_4290`, `XACT_4030`, `XACT_4010` and ensure `RateLimitError`, `BotChallengeError`, `AuthSessionExpiredError` accept them. No new dependencies. |
| `types/proxy.d.ts` | **UPDATE** | Add `client`, `maxProxyRetries`, `backoffBaseMs`, `backoffMultiplier`, `maxBackoffMs`, `rateLimitHibernationMs`, `standbyBackoffMs`, `httpClient` to `AbstractApiClient` constructor and `ProxyRequestOptions` / request options as appropriate. Zero `any`. |
| `types/index.d.ts` | **NO CHANGE** | Re-export is already in place. |
| `tests/core/base-client-request.test.js` | **NEW** | ATDD suite for the request pipeline. Use real providers and `vi.useFakeTimers()`. |
| `tests/core/base-client-proxy.test.js` | **UPDATE (minimal)** | Add tests for `proxyProvider` vs `proxyPool` contract validation if not already covered. |
| `api/`, `prisma/`, `dashboard/`, `src/scrapers/**` | **NO CHANGE** | Out of scope per rules. |

---

## Testing Requirements

### ATDD approach

1. Create `tests/core/base-client-request.test.js` alongside implementation.
2. Each AC maps to at least one `describe` block and one or more `test` cases.
3. All tests use real in-memory `AbstractApiClient` subclass with a fake `httpClient` that returns controllable responses.
4. No mocks of `undici` or `got-scraping`.
5. Use `vi.useFakeTimers()` to test exponential backoff and quarantine expiry deterministically.

### Test coverage checklist

- [ ] `request()` throws `proxy_exhausted` (`XACT_5030`) when no proxy provider is configured.
- [ ] `request()` throws `proxy_exhausted` when `provider.isAllQuarantined()` is true.
- [ ] HTTP 429 triggers `provider.quarantine(proxy, 5m)` and retries up to 3 times with new proxies.
- [ ] HTTP 403 on auth platform triggers account quarantine + `governor.recordRateLimit`.
- [ ] Exponential backoff sequence `1s, 2s, 4s` is observed with `vi.useFakeTimers()`.
- [ ] Jitter keeps each delay <= the unjittered exponential cap.
- [ ] `Retry-After` header overrides the computed delay when larger (and is clamped to `maxBackoffMs`).
- [ ] No-auth platforms use `getNext()` on each retry.
- [ ] Auth-required platforms use `getStickyProxy(accountId)` on proxy retries and `getNextAvailable(platform)` on account rotation.
- [ ] Standby backoff throws `XACT_5030` with `retryAfterMs = 30_000`.
- [ ] `governor.canAccountRequest` blocks hibernating accounts before the first request.
- [ ] Successful requests call `governor.recordRequest` and `accountPool.recordRequest`.
- [ ] `request()` never calls `httpClient` without a resolved proxy.
- [ ] `client: 'got'` path receives a proxy URL string; `client: 'undici'` receives a `ProxyAgent`/`Socks5ProxyAgent`.

### Run commands

```bash
npx vitest run tests/core/base-client-request.test.js
npx vitest run tests/core/base-client-proxy.test.js
npx vitest run tests/proxy/providers-tunnel.test.js tests/proxy/proxy-pool.test.js tests/proxy/providers.test.js tests/core/account-pool.test.js
```

---

## Latest Tech Information

### Undici (current project version `^7.29.0`)

- **ProxyAgent / Socks5ProxyAgent as dispatcher:** Pass the agent in the `dispatcher` option of `undici.request` or `undici.fetch`:
  ```javascript
  import { request, ProxyAgent, Socks5ProxyAgent } from 'undici';
  const agent = new ProxyAgent('http://user:pass@proxy:8080');
  const { statusCode, body } = await request('https://target', { method: 'GET', dispatcher: agent });
  ```
  [Context7: `/nodejs/undici` — Socks5ProxyAgent Per Request]

- **Retry interceptor:** Undici has a built-in `interceptors.retry` that supports `maxRetries`, `minTimeout`, `maxTimeout`, `timeoutFactor`, `statusCodes`, and `errorCodes`:
  ```javascript
  import { Agent, interceptors } from 'undici';
  const agent = new Agent().compose(
    interceptors.retry({
      maxRetries: 5,
      minTimeout: 200,
      maxTimeout: 5000,
      timeoutFactor: 2,
      statusCodes: [429, 502, 503, 504]
    })
  );
  ```
  [Context7: `/nodejs/undici` — Configure retry interceptor in Undici]

- **Interceptor composition:** Custom interceptors can be composed with `Agent#compose`. This is the recommended pattern for adding proxy quarantine without modifying the core transport.

### Got-Scraping

- **Status: EOL.** According to web research, `got-scraping` reached end-of-life in February 2026 (final version 4.2.1). Apify recommends migrating to `impit` for new projects.
- **Current project usage:** `got-scraping` is still in `package.json` and used by legacy `src/client/` and `src/scrapers/twitter/http/client.js`. Story 11.3 should keep `got-scraping` compatibility for the `client: 'got'` path but should not introduce new `got-scraping`-only features.
- **Proxy support:** `got-scraping` accepts `proxyUrl` as a string. The `getProxyAgent(proxy, { client: 'got' })` contract in `src/proxy/providers.js` already returns a full proxy URL string, which is the correct shape.
  [Context7: `/apify/got-scraping` — Configure Proxy Agents, Retry with Exponential Backoff]

### Backoff best practices

- **Full jitter** (AWS recommendation): `delay = Math.floor(Math.random() * baseDelay)` reduces contention and prevents synchronized retries.
- **Retry-After honor:** Parse both integer seconds and HTTP-date formats. Clamp to `maxBackoffMs` to avoid stalls.
- **Retry budget / circuit breaker:** The project does not currently use a global retry budget. Story 11.3 bounds retries with `maxProxyRetries` and `maxAccountRotations`; a global retry budget belongs to Story 11.4/11.5 if needed.

---

## Project Context Reference

### Existing source files (current `HEAD`)

- `src/core/base-client.js:1-173` — `AbstractApiClient` with `resolveProxy`, abstract `request()`, `handleError()`.
- `src/core/error-envelope.js:1-146` — `ErrorTypes`, `SuggestedActions`, `PlatformError`, `RateLimitError`, `BotChallengeError`, `AuthSessionExpiredError`, `ProxyDeadError`.
- `src/core/account-pool.js:1-411` — `AccountPool` with `getNextAvailable`, `markUnavailable`, `recordRequest`, `setAssignedProxy`, `getAccount` (redacted).
- `src/core/adaptive-governor.js:1-276` — `AdaptiveRateGovernor` with `canAccountRequest`, `recordRequest`, `recordRateLimit`, `hibernateAccount`, `getMaxThroughput`, `getStatus`.
- `src/proxy/proxy-pool.js:1-337` — `ProxyIpPool` with `getNext`, `getStickyProxy`, `quarantine`, `isAllQuarantined`, `getProxyAgent`, `getBrowserArgs`.
- `src/proxy/providers.js:1-1031` — `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`, `formatProxyUrl`, `getProxyAgent`.
- `src/proxy/index.js:1-8` — current re-exports.
- `types/proxy.d.ts:1-211` — proxy and provider TypeScript declarations.
- `src/core/types.js:1-100` — `ErrorEnvelope`, `GovernorStatus` typedefs.

### Existing test files (to keep green)

- `tests/proxy/providers-tunnel.test.js` — provider contract tests.
- `tests/proxy/proxy-pool.test.js` — `ProxyIpPool` quarantine and rotation.
- `tests/core/account-pool.test.js` — account hibernation and rotation.
- `tests/core/base-client-proxy.test.js` — `AbstractApiClient.resolveProxy`.

### Planning artifacts

- `_bmad-output/planning-artifacts/epics.md:202-213` — Story 11.3 source.
- `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md:62-65` — FR-66B.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:133-145` — AD-3.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:192-200` — AD-9.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:219-229` — AD-13.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:230-241` — AD-14.
- `_bmad-output/implementation-artifacts/11-2-static-dynamic-residential-tunnel-proxy-providers.md` — previous story with provider contract and quarantine patterns.

### Current sprint status

- `sprint-status.yaml:47` marks `11-3-429-403-auto-quarantine-exponential-backoff-replay-interceptor: backlog` (to be updated to `ready-for-dev`).

---

## Warnings & Potential Pitfalls

1. **Do not import `undici` or `got-scraping` in `src/core/base-client.js`.** The core must stay dependency-free. Use injected `httpClient` and `provider.getProxyAgent`.
2. **Do not call `request()` without a resolved proxy.** Always flow through `resolveProxy()` and pass the returned `agent` to `httpClient`.
3. **Do not quarantine the bare gateway.** For `DynamicTunnelProvider`, pass the exact `NormalizedProxy` returned by `getProxy` to `quarantine`, not `provider.rawGateway`.
4. **Do not confuse proxy quarantine (5m) with account hibernation (15m).** Quarantine is for the proxy; hibernation is for the account. Both may be needed for auth-required 429/403.
5. **Do not retry 401/AuthSessionExpiredError.** 401 means the account session is dead; retrying with a new proxy is futile. Throw and let `AbstractLogin` / `SessionManager` handle re-login.
6. **Do not retry non-retryable `PlatformError` types.** Only `RATE_LIMIT`, `BOT_CHALLENGE`, `PROXY_EXHAUSTED`, and `HIBERNATION` are `isRetryable`.
7. **Jitter must not exceed the exponential cap.** Full jitter is `Math.floor(Math.random() * baseDelay)`. Document and test the cap.
8. **Account rotation resets the proxy retry counter but not the backoff counter.** The backoff schedule continues to grow per attempt to avoid hammering the platform.
9. **Node global `fetch` does not accept `dispatcher`.** If the `httpClient` uses `undici`, make sure it is `undici.fetch` or `undici.request`, not `globalThis.fetch`.
10. **`got-scraping` is EOL.** Avoid building new platform clients on it. The `client: 'got'` path is for legacy compatibility only.
11. **Exponential backoff without jitter can cause thundering herd.** All retry tests must verify jitter is applied.
12. **`handleError()` is currently generic.** It must be updated to classify HTTP status codes so the interceptor can decide whether to retry.

---

## Decisions Record

| # | Decision | Rationale |
|---|---|---|
| D-1 | `AbstractApiClient.request()` is implemented in the base class with a pluggable `httpClient` function. | Keeps `src/core` dependency-free while providing a reusable retry/quarantine/standby pipeline for all platforms. |
| D-2 | Proxy retry uses `provider.getProxyAgent(proxy, { client })` to get the correct agent shape. | `undici` needs a `ProxyAgent`/`Socks5ProxyAgent` object; `got-scraping` needs a proxy URL string. The provider already implements this contract. |
| D-3 | Exponential backoff is `[1000, 2000, 4000]` ms with full jitter by default. | Matches AC-3 and AWS best practices; avoids synchronized retries. |
| D-4 | Auth platforms rotate account only after `maxProxyRetries` proxy attempts fail. | Distinguishes proxy-level 429/403 from account-level rate limit and preserves sticky IP per account as long as possible. |
| D-5 | `request()` classifies 401/403/429/500+ into `AuthSessionExpiredError`/`BotChallengeError`/`RateLimitError`/`ProxyDeadError`. | Gives the interceptor a single, typed error to decide retry behavior and produces the correct operational envelope. |
| D-6 | Standby backoff is a `PROXY_EXHAUSTED` `PlatformError` with `retryAfterMs` instead of an internal state machine. | Consumers (MCP/CLI/dashboard) already understand `XACT_5030` + `WAIT`; no new state model needed. |
| D-7 | `PlatformResponseValidator` is not implemented in Story 11.3. | Story 11.7 owns the validator contract. Story 11.3 is forward-compatible by allowing an optional validator / subclass `handleError`. |
| D-8 | No new runtime dependencies in `src/core`. | Preserves the zero-dependency core boundary from AD-2. |

---

## Tasks & Subtasks

- [ ] **Task 1: Update `src/core/error-envelope.js`**
  - [ ] Add error codes `XACT_4290`, `XACT_4030`, `XACT_4010` to `PlatformError` usage.
  - [ ] Ensure `RateLimitError`, `BotChallengeError`, `AuthSessionExpiredError` can carry custom `code` and `accountId`.

- [ ] **Task 2: Implement `AbstractApiClient.request()` in `src/core/base-client.js`**
  - [ ] Add constructor options: `client`, `maxProxyRetries`, `maxAccountRotations`, `backoffBaseMs`, `backoffMultiplier`, `maxBackoffMs`, `rateLimitHibernationMs`, `standbyBackoffMs`, `httpClient`.
  - [ ] Implement private `#resolveAccountAndProxy(options)` helper.
  - [ ] Implement `#buildAgent(proxy)` using `provider.getProxyAgent`.
  - [ ] Implement `#classifyResponse(response)` and update `handleError()`.
  - [ ] Implement the retry/quarantine/backoff loop with full jitter.
  - [ ] Implement account rotation for auth-required platforms.
  - [ ] Implement standby backoff when `provider.isAllQuarantined()` is true.

- [ ] **Task 3: Ensure providers return correct `getProxyAgent` shape for both clients**
  - [ ] Verify `StaticProxyProvider.getProxyAgent` and `DynamicTunnelProvider.getProxyAgent` honor `{ client: 'undici' \| 'got' }`.
  - [ ] Add tests if missing.

- [ ] **Task 4: Add optional `createUndiciClient` / `createGotClient` helper factory (in `src/proxy/` or `src/utils/`)**
  - [ ] Helper must not be in `src/core`.
  - [ ] Helper is optional; platform clients may set their own `httpClient`.

- [ ] **Task 5: Update TypeScript declarations**
  - [ ] `types/proxy.d.ts`: extend `ProxyRequestOptions` and `AbstractApiClient` constructor options.
  - [ ] Add `client`, `maxProxyRetries`, `backoffBaseMs`, etc.
  - [ ] Zero `any` and zero `@ts-ignore`.

- [ ] **Task 6: ATDD test suite `tests/core/base-client-request.test.js`**
  - [ ] 429 → quarantine → retry with new proxy.
  - [ ] 403 on auth platform → quarantine proxy + hibernate account + rotate account.
  - [ ] Exponential backoff timing with fake timers.
  - [ ] `Retry-After` parsing and clamping.
  - [ ] Standby backoff when all proxies quarantined.
  - [ ] No direct connection fallback.
  - [ ] Governor blocks hibernating account.

- [ ] **Task 7: Regression smoke tests**
  - [ ] Run `npx vitest run tests/core/base-client-request.test.js tests/core/base-client-proxy.test.js tests/proxy/providers-tunnel.test.js tests/proxy/proxy-pool.test.js tests/proxy/providers.test.js tests/core/account-pool.test.js`.
  - [ ] All green before marking done.

- [ ] **Task 8: Update this story file and sprint status**
  - [ ] Mark relevant subtasks done as implementation progresses.
  - [ ] Update `sprint-status.yaml` to `ready-for-dev` now, then to `in-progress` when dev starts, and `done` after code review.

---

## ATDD Artifacts

- **Checklist:** `_bmad-output/test-artifacts/atdd-checklist-11-3-429-403-auto-quarantine-exponential-backoff-replay-interceptor.md` (to be created during implementation)
- **Unit & Integration Tests:** `tests/core/base-client-request.test.js`

---

## Dev Agent Record

### Implementation Plan
1. Implement error-code updates in `src/core/error-envelope.js`.
2. Implement `AbstractApiClient.request()` with the full request pipeline, quarantine, retry, and backoff in `src/core/base-client.js`.
3. Wire in `AccountPool` hibernation and `AdaptiveRateGovernor` calls.
4. Verify provider `getProxyAgent` works for both `undici` and `got` clients.
5. Update `types/proxy.d.ts` with strict types.
6. Write `tests/core/base-client-request.test.js` using real in-memory providers and fake timers.
7. Run regression suite and keep all existing tests green.

### Completion Notes List
- (To be filled by the dev agent.)

### File List
- `src/core/base-client.js` (MODIFIED)
- `src/core/error-envelope.js` (MODIFIED)
- `src/proxy/providers.js` (MINIMAL UPDATE if needed)
- `types/proxy.d.ts` (MODIFIED)
- `tests/core/base-client-request.test.js` (NEW)
- `tests/core/base-client-proxy.test.js` (MINIMAL UPDATE if needed)

### Change Log
- 2026-08-21: Created comprehensive Story 11.3 context file (ready-for-dev).

---

## Open Questions / Clarifications

The following gaps were identified during context analysis. They should be answered before or during implementation:

1. **HTTP transport injection:** Should `AbstractApiClient` receive a full `httpClient` function in the constructor, or should the base class provide a default `undici` client that platform subclasses can override?
   - *Recommendation:* Require an `httpClient` function. Provide an optional `createUndiciClient` helper in `src/proxy/` or `src/utils/`.
2. **Jitter strategy:** Is full jitter (`Math.random() * baseDelay`) acceptable, or should the project use decorrelated or equal jitter?
   - *Recommendation:* Full jitter is the simplest and AWS-recommended default; configurable if needed.
3. **Account rotation retry budget:** How many total attempts are allowed when rotating accounts? AC says "up to 3 retries"; does that mean 3 proxy attempts total, or 3 proxy attempts per account?
   - *Recommendation:* 3 proxy attempts per account, with a default of 1 account rotation (max 6 attempts total per request).
4. **Standby Backoff alert mechanism:** AC says "cảnh báo thay vì loop vô tận". Should the interceptor log, emit an event, or write to a metric?
   - *Recommendation:* Throw the `proxy_exhausted` `PlatformError` with a clear message and `suggestedAction: WAIT`. A future story (11.4/19.x) can add webhook/metric alerts.
5. **`got-scraping` EOL:** Should Story 11.3 migrate existing `src/client/` and `src/scrapers/twitter/` off `got-scraping`?
   - *Recommendation:* No. Story 11.3 keeps `client: 'got'` compatibility. A future decommissioning story can migrate legacy clients.
6. **`PlatformResponseValidator` dependency:** Should `AbstractApiClient` accept a validator in Story 11.3, or wait for Story 11.7?
   - *Recommendation:* Design `request()` to call an optional `responseValidator` / `handleError` override, but do not require it. The 200-with-challenge case is out of scope for 11.3.

---

## Story Completion Status

- **Status:** ready-for-dev
- **Context engine analysis completed:** Epics, PRD, architecture, previous story, and current source code analyzed.
- **Web research completed:** Undici interceptors, `ProxyAgent`/`Socks5ProxyAgent`, retry/backoff best practices, `got-scraping` EOL status documented.
- **Architecture compliance verified:** AD-3, AD-9, AD-13, AD-14, AD-2, AD-8 mapped.
- **Previous story intelligence imported:** 11.1 and 11.2 implementation patterns, test approach, quarantine contract, and deferred items.
- **Next phase:** Implementation via `bmad-dev-story` or direct dev agent; run `code-review` when complete.
