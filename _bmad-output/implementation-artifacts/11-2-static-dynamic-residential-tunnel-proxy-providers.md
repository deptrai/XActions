# Story 11.2 — Static & Dynamic Residential Tunnel Proxy Providers

**Story ID:** 11.2  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 11.2, `ARCHITECTURE-SPINE.md` AD-3, AD-13, AD-14, AD-2, AD-8, Story 11.1 implementation patterns

---

## Story

As a **Scale-Out Scraper & Network Engineer**,  
I want **`StaticProxyProvider` and `DynamicTunnelProvider` supporting leading residential gateway providers (BrightData, IPRoyal, Smartproxy, Kuaidaili, and Custom)**,  
So that **I can seamlessly switch between static dedicated IPs for authenticated accounts and rotating residential IPs per-request or per-session for high-volume anonymous scraping**.

---

## Acceptance Criteria

### AC-1: StaticProxyProvider Implementation & Unified Contract
* **Given** a list of static proxies (strings or objects) or an existing `ProxyIpPool` instance
* **When** `new StaticProxyProvider(options)` is instantiated with `{ proxies, pool }`
* **Then** it implements the standard `ProxyProviderContract`:
  - `getProxy({ accountId, platform, country })`: returns sticky proxy for `accountId`, or round-robin proxy if `accountId` is omitted
  - `getStickyProxy(accountId)`: returns deterministic sticky proxy from internal pool
  - `getNext()`: returns next healthy proxy in round-robin order
  - `quarantine(proxy, durationMs)`: quarantines proxy and drops account bindings in pool
  - `toPlaywrightProxy(proxy)`: converts proxy to `{ server, username, password }` Playwright format
  - `getProxyAgent(proxy, options)`: returns `undici.ProxyAgent`, `SocksProxyAgent`, or got proxy string without direct fallback
  - `getBrowserArgs(proxy)`: returns anti-leak Chromium launch arguments
* **And** getters `healthyCount`, `totalCount`, and `isAllQuarantined()` accurately reflect underlying pool state.

### AC-2: DynamicTunnelProvider Gateway Parsing & Auto-Detection
* **Given** a dynamic residential gateway URL (e.g. `http://user:pass@gate.smartproxy.com:7000`, `http://brd.superproxy.io:22225`, or `socks5://geo.iproyal.com:12321`)
* **When** `new DynamicTunnelProvider(options)` is instantiated
* **Then** it parses and validates the gateway URL using `parseProxyUrl`
* **And** automatically auto-detects `provider` preset from gateway hostname if not explicitly passed:
  - `*.superproxy.io` ➔ `'brightdata'`
  - `*.smartproxy.com` ➔ `'smartproxy'`
  - `*.iproyal.com` ➔ `'iproyal'`
  - `*.kdlapi.com` ➔ `'kuaidaili'`
  - otherwise defaults to `'custom'`
* **And** throws `PlatformError` (`XACT_4001`, `invalid_args`, `statusCode: 400`) if `gatewayUrl` is missing, empty, or invalid.

### AC-3: Per-Request Residential IP Rotation
* **Given** a `DynamicTunnelProvider` configured with `rotatePerRequest: true` (default)
* **When** `getProxy()` is called without an `accountId`
* **Then** it generates a unique per-request session tag (random hex string/timestamp)
* **And** injects the session tag into proxy credentials according to the provider preset format
* **And** returns a canonical `NormalizedProxy` pointing to the gateway with session credentials
* **And** successive calls return different session credentials, ensuring a new residential exit IP per request.

### AC-4: Sticky Residential Session per Account & Expiration Lifecycle
* **Given** a `DynamicTunnelProvider` configured with `sessionDurationMs` (default: 600,000ms / 10 minutes)
* **When** `getProxy({ accountId })` is called with a specific `accountId`
* **Then** it deterministically generates a session ID bound to `accountId` using time-bucket hashing (`Math.floor(Date.now() / sessionDurationMs)`)
* **And** returns the same session credentials for repeated calls within the session duration window
* **And** automatically rolls over to a new session tag when the time bucket elapses
* **And** calling `rotateSession(accountId)` or `quarantine(proxy)` for that account immediately invalidates the current session tag and generates a fresh residential exit node.

### AC-5: Geo-Targeting Formatting Presets & Custom Template
* **Given** provider configuration or call options specifying `country`, `city`, `sessionId`
* **When** constructing authentication credentials for a dynamic proxy request
* **Then** it formats username/credentials according to the selected provider preset:
  - `brightdata`: `user-${baseUser}-country-${country}-city-${city}-session-${sessionId}`
  - `smartproxy`: `user-${baseUser}_country-${country}_city-${city}_session-${sessionId}`
  - `iproyal`: `user-${baseUser}_country-${country}_city-${city}_session-${sessionId}`
  - `kuaidaili`: `user-${baseUser}_session-${sessionId}`
  - `custom`: uses configurable template pattern string (e.g. `{username}:country={country}:session={sessionId}`)
* **And** omits `country`/`city` segments cleanly when they are not specified without adding extra dashes or underscores.

### AC-6: Unified Provider Factory (`createProxyProvider`)
* **Given** a provider configuration object
* **When** `createProxyProvider(config)` is called
* **Then** it returns a `DynamicTunnelProvider` instance if `config.type === 'dynamic'` or `config.gatewayUrl` is present
* **And** returns a `StaticProxyProvider` instance if `config.type === 'static'` or `config.proxies` is present
* **And** throws `PlatformError` (`XACT_4001`) if the configuration is invalid or provider type is unknown.

### AC-7: Anti-Leak Browser & Protocol Compatibility
* **Given** a proxy returned from either `StaticProxyProvider` or `DynamicTunnelProvider`
* **When** `getProxyAgent(proxy, options)` or `toPlaywrightProxy(proxy)` is called
* **Then** it creates valid HTTP/HTTPS/SOCKS5 agents via `undici.ProxyAgent` or `SocksProxyAgent` without falling back to direct connection
* **And** `getBrowserArgs(proxy)` includes anti-leak flags:
  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `--proxy-server=<server>`.

### AC-8: TypeScript Type Declarations & Strict Typings
* **Given** `types/proxy.d.ts` and `types/index.d.ts`
* **When** consuming `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`, `DynamicTunnelOptions`, `StaticProxyOptions`, and `ProxyProviderContract` in TypeScript
* **Then** full type declarations are available with zero `any` and zero `@ts-ignore`.

---

## Previous Story Intelligence (Story 11.1 Learnings)

1. **Proxy `#key` Generation with Password**:
   - Rotating residential proxy gateways share the identical `host:port` (e.g. `gate.smartproxy.com:7000`) and differentiate exit nodes via `username` or `password`. When tracking/quarantining proxies, the identification key must include credentials: `${scheme}://${username}:${password}@${host}:${port}` to avoid quarantine collisions across unrelated sessions.
2. **RFC 3986 IPv6 Brackets Formatting**:
   - IPv6 hosts (e.g. `2001:db8::1`) must always be wrapped in square brackets `[2001:db8::1]:port` when formatting URLs.
3. **Zero Fallback to Direct Connection**:
   - If a proxy fails to resolve or is null/invalid, never fall back to direct HTTP connection; throw `PlatformError` (`XACT_4001`) immediately to prevent real IP leaks.
4. **Pure In-Memory Testing (No Mocks)**:
   - All tests must run against real in-memory objects and local HTTP/SOCKS5 instances with Vitest fake timers (`vi.useFakeTimers()`).

---

## Git Intelligence Summary

- `b69625c` — `feat(api): add live REST API endpoints for ProxyIpPool and AccountPool (/api/proxies)`
- `b81a542` — `test(automate): expand test automation coverage for proxy providers and client proxy routing (92 passing tests)`
- `061725b` — `fix(proxy): address round 2 code review findings (IPv6 format, proxy key with password, account merge)`
- `6d85ba9` — `feat(proxy): complete story 11.1 ProxyIpPool and AccountPool with review patches`

---

## File Modification Analysis

| File | Action | Purpose & Preserved Behavior |
|---|---|---|
| `src/proxy/providers.js` | **UPDATE** | Add `DynamicTunnelProvider`, `StaticProxyProvider`, `createProxyProvider`. **MUST PRESERVE** existing `parseProxyUrl`, `normalizeProxy`, `formatProxyUrl`, `getProxyAgent`, `SUPPORTED_PROXY_SCHEMES`. |
| `src/proxy/index.js` | **UPDATE** | Re-export `DynamicTunnelProvider`, `StaticProxyProvider`, `createProxyProvider`. |
| `types/proxy.d.ts` | **UPDATE** | Add TypeScript type definitions for `ProxyProviderContract`, `StaticProxyOptions`, `DynamicTunnelOptions`, and classes. |
| `types/index.d.ts` | **UPDATE** | Export new types from `types/proxy.d.ts`. |
| `tests/proxy/providers-tunnel.test.js` | **NEW** | ATDD test suite covering AC-1 through AC-8. |

---

## Technical Specifications & Provider Presets Matrix

| Provider Preset | Hostname Patterns | Username Format |
|---|---|---|
| `brightdata` | `*.superproxy.io`, `*.luminati.io` | `user-${user}-country-${country}-city-${city}-session-${sessionId}` |
| `smartproxy` | `*.smartproxy.com`, `*.smartproxy.io` | `user-${user}_country-${country}_city-${city}_session-${sessionId}` |
| `iproyal` | `*.iproyal.com`, `*.royalproxy.io` | `user-${user}_country-${country}_city-${city}_session-${sessionId}` |
| `kuaidaili` | `*.kdlapi.com`, `*.kuaidaili.com` | `user-${user}_session-${sessionId}` |
| `custom` | Any other hostname | Evaluates `template` (e.g. `{username}:country={country}:session={sessionId}`) |

---

## Tasks & Subtasks

- [ ] **Task 1: Implement Dynamic Tunnel Provider & Geo-Preset Formatter (`src/proxy/providers.js`)**
  - [ ] Implement `DynamicTunnelProvider` class.
  - [ ] Implement auto-detection and presets for `brightdata`, `smartproxy`, `iproyal`, `kuaidaili`, `custom`.
  - [ ] Implement per-request random session generator (`rotatePerRequest`).
  - [ ] Implement account sticky session with time-bucket expiration (`sessionDurationMs`).
  - [ ] Implement `rotateSession(accountId)` and `quarantine(proxy)` instant session invalidation.

- [ ] **Task 2: Implement Static Proxy Provider (`src/proxy/providers.js`)**
  - [ ] Implement `StaticProxyProvider` class wrapping `ProxyIpPool`.
  - [ ] Implement `getProxy({ accountId })` routing sticky vs round-robin.
  - [ ] Expose pool getters (`healthyCount`, `totalCount`, `isAllQuarantined`).

- [ ] **Task 3: Implement Unified Factory & Standard Contract (`src/proxy/providers.js`)**
  - [ ] Implement `createProxyProvider(config)`.
  - [ ] Export `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider` from `src/proxy/index.js` and `src/proxy/providers.js`.

- [ ] **Task 4: Update TypeScript Declarations (`types/proxy.d.ts` & `types/index.d.ts`)**
  - [ ] Define `ProxyProviderContract` interface.
  - [ ] Define `StaticProxyOptions` and `DynamicTunnelOptions`.
  - [ ] Export `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`.

- [ ] **Task 5: ATDD Test Suite (`tests/proxy/providers-tunnel.test.js`)**
  - [ ] Write ATDD acceptance tests for `StaticProxyProvider`.
  - [ ] Write ATDD acceptance tests for `DynamicTunnelProvider` (Per-request rotation, Sticky session with time expiry, Geo formatting presets for BrightData/Smartproxy/IPRoyal/Kuaidaili/Custom).
  - [ ] Write ATDD acceptance tests for `createProxyProvider` factory.
  - [ ] Verify 100% tests passing in Vitest with zero mocks.

---

## Story Completion Status

- **Status:** `ready-for-dev`
- **Checklist Verified:** 100% Validated against BMad Checklist
- **Next Phase:** ATDD Scaffolding via `/bmad-testarch-atdd 11.2` or implementation via `/bmad-dev-story`.
