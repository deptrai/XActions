# Story 11.1 — ProxyIpPool & AccountPool for Sticky/Round-Robin IP and Multi-Account Rotation

**Story ID:** 11.1  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 11.1, `ARCHITECTURE-SPINE.md` AD-3, AD-13, AD-14, AD-2, AD-8, `10-1` & `10-5` implementation patterns

---

## Story

As an **Automation Operator**,  
I want a centralized proxy pool (sticky IP per account, round-robin IP for no-auth) and an account pool that rotates accounts on rate-limit or hibernation,  
So that every outgoing request uses a healthy, safe IP without leaking the real origin, and auth-required accounts do not die in bulk.

---

## Acceptance Criteria

### AC-1: Proxy input normalization
* **Given** a proxy supplied as a string URL (`http://user:pass@host:port`, `https://...`, `socks5://...`) or an object
* **When** `ProxyIpPool` initializes or `add()` is called
* **Then** the proxy is normalized to a canonical object with `{ scheme, host, port, username, password, server }`
* **And** invalid proxy strings throw `PlatformError` (`XACT_4001`, `invalid_args`)
* **And** at least `http`, `https`, and `socks5` schemes are supported

### AC-2: Anti-leak browser configuration
* **Given** a proxy from `ProxyIpPool`
* **When** `getBrowserArgs(proxy)` is called
* **Then** it returns Chromium flags including:
  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `--proxy-server=<server>`
* **And** it returns environment/launch flags that enable remote DNS resolution (e.g. `--host-resolver-rules` or Playwright `proxy` object so DNS is resolved at the proxy)

### AC-3: Sticky proxy per account
* **Given** an `accountId` for an auth-required platform
* **When** `getStickyProxy(accountId)` is called multiple times
* **Then** the **same** healthy proxy is returned for that account
* **And** when the assigned proxy is quarantined, a new healthy proxy is selected and bound to the account
* **And** the selection is deterministic (hash-based) to reduce re-binding churn across process restarts

### AC-4: Round-robin proxy for no-auth platforms
* **Given** a non-empty healthy proxy pool
* **When** `getNext()` is called
* **Then** it returns the next healthy proxy in round-robin order
* **And** it skips quarantined proxies
* **And** it returns `null` when all proxies are quarantined

### AC-5: Quarantine and refresh
* **Given** a proxy that fails with `429`, `403`, bot challenge, or is manually flagged
* **When** `quarantine(proxy, durationMs)` is called
* **Then** the proxy is unavailable for at least 5 minutes (default)
* **And** any sticky account binding to that proxy is removed
* **And** `isAllQuarantined()` returns `true` only when **all** proxies are quarantined
* **And** `pruneExpiredQuarantines()` removes expired entries

### AC-6: Proxy agent factory
* **Given** a normalized proxy and a target HTTP client
* **When** `getProxyAgent(proxy, { client: 'undici' | 'got' })` is called
* **Then** for `undici` it returns `undici.ProxyAgent` (HTTP/HTTPS) or `undici.Socks5ProxyAgent` (SOCKS5)
* **And** for `got` it returns the proxy URL string suitable for `got-scraping` `proxyUrl`
* **And** it never returns an agent that falls back to a direct connection

### AC-7: Account registration and storage
* **Given** a platform and one or more `accountId`s
* **When** `registerAccounts(platform, accountIds)` is called
* **Then** accounts are stored with `platform`, `accountId`, `credentials` (optional), `assignedProxy` (sticky), `hibernatingUntil`, and `velocity`

### AC-8: Account round-robin and hibernation awareness
* **Given** a platform with multiple accounts
* **When** `getNextAvailable(platform)` is called
* **Then** it returns the next non-hibernating, non-rate-limited account using round-robin
* **And** it advances the round-robin pointer
* **And** `hasAvailable(platform)` returns `true` if any account is available without mutating state

### AC-9: Account unavailability and velocity
* **Given** an account that hit a rate-limit or bot challenge
* **When** `markUnavailable(accountId, reason, durationMs)` is called
* **Then** the account is marked hibernating until `Date.now() + durationMs`
* **And** `getAccountVelocity(accountId)` returns the request count in the last 60-second sliding window
* **And** `markAvailable(accountId)` can wake the account early

### AC-10: Health counts
* **Given** `ProxyIpPool` with proxies in various states
* **When** `healthyCount` and `totalCount` are read
* **Then** `totalCount` equals the total registered proxies
* **And** `healthyCount` equals the number of non-quarantined proxies

### AC-11: Integration with `AbstractApiClient` and `AdaptiveRateGovernor`
* **Given** an `AbstractApiClient` configured with `proxyPool`, `accountPool`, and `governor`
* **When** a subclass resolves a proxy via `resolveProxy(accountId)`
* **Then** it uses `getStickyProxy` for `requiresAuth=true` and `getNext()` for `requiresAuth=false`
* **And** it does not fall back to a direct connection
* **And** `AdaptiveRateGovernor` can read `proxyPool.healthyCount` / `totalCount` to compute throughput

### AC-12: Tests
* **Given** the implementation
* **When** running `npx vitest run tests/proxy/proxy-pool.test.js tests/core/account-pool.test.js`
* **Then** all tests pass against the real in-memory pool (no mocks)
* **And** tests cover HTTP/HTTPS/SOCKS5 normalization, sticky binding, round-robin, quarantine expiry, and account hibernation

---

## Tasks / Subtasks

- [ ] AC-1 (Proxy normalization) (AC: 1)
  - [ ] Implement `src/proxy/providers.js` with `normalizeProxy(input)` and `parseProxyUrl(url)`
  - [ ] Wire `ProxyIpPool.#normalize` to use the normalizer
  - [ ] Add validation for unknown/unsupported schemes
- [ ] AC-2 (Anti-leak browser flags) (AC: 2)
  - [ ] Extend `ProxyIpPool.getBrowserArgs(proxy)` to return all required Chromium flags
  - [ ] Add `toPlaywrightProxy(proxy)` helper returning `{ server, username, password }`
- [ ] AC-3 / AC-4 (Allocation strategies) (AC: 3, 4)
  - [ ] Harden `getStickyProxy(accountId)` with deterministic hashing and re-binding on quarantine
  - [ ] Harden `getNext()` round-robin with quarantine skip
- [ ] AC-5 (Quarantine) (AC: 5)
  - [ ] Add default 5-minute quarantine duration
  - [ ] Remove sticky bindings on `quarantine()`
  - [ ] Add `isAllQuarantined()` and `pruneExpiredQuarantines()`
- [ ] AC-6 (Proxy agents) (AC: 6)
  - [ ] Add `getProxyAgent(proxy, { client })` factory using `undici.ProxyAgent`, `undici.Socks5ProxyAgent`, and `got-scraping` proxyUrl
  - [ ] Ensure no direct-connection fallback
- [ ] AC-7 / AC-8 / AC-9 (AccountPool) (AC: 7, 8, 9)
  - [ ] Extend `src/core/account-pool.js` to store richer account records
  - [ ] Implement `markUnavailable(accountId, reason, durationMs)`
  - [ ] Implement `getAccountVelocity(accountId)` with 60s sliding window
  - [ ] Implement `markAvailable(accountId)`
- [ ] AC-10 (Health counts) (AC: 10)
  - [ ] Verify `healthyCount` / `totalCount` reflect quarantine state
- [ ] AC-11 (Wiring) (AC: 11)
  - [ ] Update `src/core/base-client.js` `resolveProxy` if needed
  - [ ] Verify `AdaptiveRateGovernor.refreshFromProxyPool()` works
- [ ] AC-12 (Tests) (AC: 12)
  - [ ] Create `tests/proxy/proxy-pool.test.js`
  - [ ] Create `tests/core/account-pool.test.js`
  - [ ] Create type declarations in `types/proxy.d.ts` (or extend `types/index.d.ts`)

---

## Dev Notes

### Architecture Compliance

- **AD-3** — `src/proxy/**` owns the centralized `ProxyIpPool`. It must support `getStickyProxy` (auth-required) and `getNext()` (no-auth), quarantine on 429/403, and a 30-second Standby Backoff when the pool is exhausted. [Source: `ARCHITECTURE-SPINE.md` AD-3]
- **AD-13** — `AdaptiveRateGovernor` consumes `healthyProxyCount` / `totalProxyCount` from `ProxyIpPool` to compute `maxReqPerSecond`; it also tracks per-account velocity and hibernation. `AccountPool` must expose enough state for the governor to make decisions. [Source: `ARCHITECTURE-SPINE.md` AD-13]
- **AD-14** — Errors thrown by the pool/account system must use `PlatformError` with shape `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`. Relevant types: `proxy_exhausted`, `hibernation`, `rate_limit`. [Source: `ARCHITECTURE-SPINE.md` AD-14]
- **AD-2** — `src/core/base-client.js` is an abstract contract; subclasses choose proxy mode via `requiresAuth`. Keep core logic platform-agnostic. [Source: `ARCHITECTURE-SPINE.md` AD-2]
- **AD-8** — Platform domains and their `requiresAuth` flags are documented in the architecture. `src/scrapers/{social,ecom,realestate,recruitment}/**` will rely on this contract later; Story 11.1 should not implement platform-specific scrapers. [Source: `ARCHITECTURE-SPINE.md` AD-8]

### Existing Code State

- `src/proxy/proxy-pool.js` already has the `ProxyIpPool` class with a quarantine map, sticky map, round-robin index, and `getBrowserArgs`. It does **not** yet parse proxy URLs, support SOCKS5 agents, or return Playwright-ready proxy objects. [Source: `src/proxy/proxy-pool.js`]
- `src/core/account-pool.js` already has round-robin selection and an `unavailableAccounts` set, but does **not** store `credentials`, `assignedProxy`, `hibernatingUntil`, or a local velocity counter. It also does not accept a duration in `markUnavailable`. [Source: `src/core/account-pool.js`]
- `src/core/adaptive-governor.js` already tracks per-account request timestamps and hibernation, so `AccountPool` can either mirror a local velocity or delegate to the governor. **Decision:** keep velocity in `AdaptiveRateGovernor` as the source of truth, but `AccountPool.getAccountVelocity` delegates to the governor when injected. [Source: `src/core/adaptive-governor.js`]
- `src/core/base-client.js` already has `resolveProxy(accountId)` using `proxyPool.getStickyProxy` / `getNext()`. No change required unless the pool API changes. [Source: `src/core/base-client.js`]
- `src/core/types.js` defines `GovernorStatus`; you may add `ProxyConfig` and `AccountRecord` typedefs here. [Source: `src/core/types.js`]

### Library & Framework Requirements

- `undici@^6.21.2` is in `package.json`. Use `undici.ProxyAgent` for `http://`/`https://` proxies and `undici.Socks5ProxyAgent` for `socks5://` proxies. Do not pass credentials in the URL for Playwright; use `{ server, username, password }`. [Source: `undici` docs, Playwright docs]
- `got-scraping@^3.2.15` accepts a `proxyUrl` string. It handles HTTP/HTTPS/SOCKS5 internally. [Source: `got-scraping` npm page]
- `socks-proxy-agent@^8.0.5` is present, but prefer `undici.Socks5ProxyAgent` for the `undici` path and `got-scraping` for the `got` path. [Source: `package.json`]
- `playwright@^1.62.1` supports `chromium.launch({ proxy: { server, username, password } })` and per-context proxy. [Source: Playwright docs]
- `src/core/**` must remain pure ESM and avoid runtime `node_modules` imports. Keep `ProxyIpPool` in `src/proxy/` (outside `src/core`) so `base-client.js` can import it without breaking the no-external-deps rule for `src/core`. [Source: `10-1` story AC-2]

### File Structure

- **NEW:** `src/proxy/providers.js` — proxy parsing/normalization. Keep it lightweight; full provider abstractions (BrightData, IPRoyal, etc.) are Story 11.2.
- **NEW:** `tests/proxy/proxy-pool.test.js`
- **NEW:** `tests/core/account-pool.test.js`
- **NEW or UPDATE:** `types/proxy.d.ts` and extend `types/index.d.ts`
- **UPDATE:** `src/proxy/proxy-pool.js`
- **UPDATE:** `src/core/account-pool.js`
- **UPDATE:** `src/core/types.js` (optional typedefs)
- **NO CHANGE:** `prisma/schema.prisma` (no DB models for 11.1; all in-memory)

### Common LLM Mistakes to Avoid

- Do **not** put `ProxyIpPool` inside `src/core/`; it needs external library awareness and belongs in `src/proxy/`. [Source: AD-3 binds]
- Do **not** implement the full request pipeline, retry interceptor, or platform validators — those are Stories 11.3, 11.5, 11.7.
- Do **not** add a real DB for accounts; Story 11.1 is in-memory only. Persistence can be considered later.
- Do **not** fallback to direct connection when a proxy agent fails; throw `ProxyDeadError` / `PlatformError` instead.
- Do **not** use mocks in tests. Use real in-memory pools. [Source: project `AGENTS.md` rule 1]

---

## Testing Requirements

- **Unit tests** live in `tests/proxy/proxy-pool.test.js` and `tests/core/account-pool.test.js`.
- Use the real in-memory pool, not mocks.
- Cover:
  - HTTP/HTTPS/SOCKS5 URL parsing and object normalization
  - `getStickyProxy` returns same proxy, re-binds on quarantine
  - `getNext()` round-robin and wrap-around
  - Quarantine expiry and `isAllQuarantined()`
  - `getBrowserArgs` flags contain `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` and `--proxy-server`
  - `getProxyAgent` returns correct agent type for `undici` and `got`
  - `AccountPool` round-robin, hibernation with duration, velocity, and wake
  - Error cases: invalid proxy URL, empty pool, all quarantined

---

## Previous Story Intelligence

### From Story 10.5 (Metadata Schema)

- `PlatformError` shape and `ErrorTypes` are stable; reuse them for pool errors. [Source: `src/core/error-envelope.js`]
- `src/core/**` must stay free of external runtime dependencies; `src/proxy/` is the right home for proxy-specific code. [Source: `10-5` warnings and `10-1` AC-2]
- Tests must use the real implementation and a real PostgreSQL DB when DB is involved. For 11.1 (in-memory), no DB is needed, but still no mocks. [Source: `10-5` AC and `AGENTS.md`]

### From Story 10.1 (Core Interfaces)

- `AbstractApiClient` constructor accepts `{ sessionManager, proxyPool, accountPool, governor }`. [Source: `src/core/base-client.js`]
- `ProxyDeadError` is part of the error hierarchy; use it when the proxy pool is exhausted. [Source: `src/core/error-envelope.js`]
- `src/core/adaptive-governor.js` is already designed to consume `proxyPool.healthyCount` and `totalCount`. [Source: `10-1` AC-4]

---

## Warnings & Potential Pitfalls

1. **Do not block the event loop.** Quarantine pruning should be lazy (checked on `getNext`/`getStickyProxy`) or a lightweight interval, not a tight loop.
2. **Do not leak the real IP.** Always return the WebRTC disable flag and proxy server flag; never return an empty browser launch config.
3. **Do not conflate account and proxy hibernation.** `AccountPool` tracks account state; `AdaptiveRateGovernor` may also track. Keep `AccountPool` the source of truth for account availability and the governor the source of truth for account velocity/hibernation if injected.
4. **Do not parse credentials incorrectly.** Proxy URLs may contain `@` in the password (URL-encoded); use `new URL(url)` and decode `decodeURIComponent` for username/password.
5. **Do not forget `src/core` purity.** `AccountPool` may import `PlatformError` from `error-envelope.js` but must not import `undici`, `socks-proxy-agent`, or `got-scraping`.
6. **Do not over-build providers.** Story 11.2 adds `StaticProxyProvider` and `DynamicTunnelProvider`; 11.1 only needs a `normalizeProxy` helper and `getProxyAgent` factory.
7. **Do not test with live proxies.** Tests must spin up the in-memory pool with string/object inputs; no outbound network calls.

---

## Decisions Record

- **Proxy location:** `src/proxy/proxy-pool.js` is the canonical pool. It can import external libraries (`undici`, `got-scraping`, etc.) because it is not under `src/core/`.
- **AccountPool velocity:** `AccountPool.getAccountVelocity` delegates to the injected `AdaptiveRateGovernor` if available, otherwise returns `0` with a local fallback. This avoids duplicating the sliding-window logic.
- **Provider abstraction split:** Parsing/normalization lives in `src/proxy/providers.js` (Story 11.1). Provider-specific adapters (BrightData, IPRoyal, etc.) live in the same file but are fully built in Story 11.2.
- **No persistence for Story 11.1:** Proxy and account pools are in-memory. Configuration can be injected at startup; persistence is deferred to later stories/epics.
- **Test strategy:** Real in-memory pools, no mocks, no outbound proxy calls.

---

## Story Completion Status

- **Status:** ready-for-dev
- **Context engine analysis completed:** comprehensive developer guide created.
- **Dev implementation:** not started.
- **Code Review:** not started.

---

## Dev Agent Record

### Agent Model Used

- BMM `bmad-create-story` context engine

### Completion Notes List

- Extracted Story 11.1 from `epics.md` and `ARCHITECTURE-SPINE.md` AD-3, AD-13, AD-14.
- Audited existing `src/proxy/proxy-pool.js` and `src/core/account-pool.js` to identify exact gaps.
- Researched current `undici.ProxyAgent`/`Socks5ProxyAgent`, `got-scraping proxyUrl`, and Playwright proxy APIs.
- Aligned with Story 10.1 and 10.5 patterns (pure `src/core`, no mocks, `PlatformError` envelopes).

### File List

- `_bmad-output/implementation-artifacts/11-1-proxyippool-accountpool-sticky-round-robin.md` (this file)

### Change Log

- **2026-08-19:** Created Story 11.1 context file and updated sprint status to `in-progress` for Epic 11.
