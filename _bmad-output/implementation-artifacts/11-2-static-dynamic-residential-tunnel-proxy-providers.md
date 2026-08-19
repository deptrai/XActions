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

### AC-1: StaticProxyProvider Implementation & Contract
* **Given** a list of static proxies (strings or objects) or an existing `ProxyIpPool` instance
* **When** `new StaticProxyProvider(options)` is instantiated with `{ proxies, pool }`
* **Then** it implements the standard `ProxyProviderContract`:
  - `getProxy({ accountId })`: returns sticky proxy for `accountId`, or round-robin proxy if `accountId` is omitted
  - `getStickyProxy(accountId)`: returns sticky proxy from internal pool
  - `getNext()`: returns next healthy proxy in round-robin order
  - `quarantine(proxy, durationMs)`: quarantines proxy and drops account bindings
  - `toPlaywrightProxy(proxy)`: converts proxy to `{ server, username, password }` Playwright format
  - `getProxyAgent(proxy, options)`: returns `undici.ProxyAgent`, `SocksProxyAgent`, or got proxy string
  - `getBrowserArgs(proxy)`: returns anti-leak Chromium launch arguments
* **And** getters `healthyCount`, `totalCount`, and `isAllQuarantined()` accurately reflect underlying pool state.

### AC-2: DynamicTunnelProvider Gateway Parsing & Validation
* **Given** a dynamic residential gateway URL (e.g. `http://user:pass@gate.smartproxy.com:7000` or `http://brd.superproxy.io:22225`)
* **When** `new DynamicTunnelProvider(options)` is instantiated
* **Then** it validates and parses the gateway URL using `parseProxyUrl`
* **And** extracts scheme, host, port, base username, and password
* **And** throws `PlatformError` (`XACT_4001`, `invalid_args`) if `gatewayUrl` is missing, empty, or invalid.

### AC-3: Per-Request Residential IP Rotation
* **Given** a `DynamicTunnelProvider` configured with `rotatePerRequest: true` (default)
* **When** `getProxy()` is called without an `accountId`
* **Then** it generates a unique per-request session tag and injects it into the proxy authentication credentials
* **And** returns a canonical `NormalizedProxy` pointing to the gateway with session credentials
* **And** successive calls return different session credentials ensuring a new residential exit IP per request.

### AC-4: Sticky Residential Session per Account
* **Given** a `DynamicTunnelProvider` configured with `sessionDurationMs` (default: 600,000ms / 10 minutes)
* **When** `getProxy({ accountId })` is called with a specific `accountId`
* **Then** it deterministically generates a session ID bound to `accountId` (e.g. `session-acc_<hash>`)
* **And** returns the same session credentials for repeated calls within the session duration window
* **And** automatically expires and generates a fresh session ID after `sessionDurationMs` elapses, or when `rotateSession(accountId)` is explicitly called
* **And** calling `quarantine(proxy)` for a dynamic tunnel proxy immediately rotates that account's session tag to a new exit node.

### AC-5: Geo-Targeting Formatting (Presets for Major Providers)
* **Given** provider configuration or options specifying `provider`, `country`, `city`, `sessionId`
* **When** constructing authentication credentials for a dynamic proxy request
* **Then** it formats username/credentials according to the selected provider preset:
  - `brightdata`: `user-${baseUser}-country-${country}-city-${city}-session-${sessionId}`
  - `smartproxy`: `user-${baseUser}_country-${country}_city-${city}_session-${sessionId}`
  - `iproyal`: `user-${baseUser}_country-${country}_city-${city}_session-${sessionId}`
  - `kuaidaili`: supports secret token channel auth or user-session formatting
  - `custom`: uses configurable template pattern string (e.g. `{username}:country={country}:session={sessionId}`)
* **And** omits `country`/`city`/`session` segments when they are not specified.

### AC-6: Unified Provider Factory (`createProxyProvider`)
* **Given** a provider configuration object
* **When** `createProxyProvider(config)` is called
* **Then** it returns a `DynamicTunnelProvider` instance if `config.type === 'dynamic'` or `config.gatewayUrl` is present
* **And** returns a `StaticProxyProvider` instance if `config.type === 'static'` or `config.proxies` is present
* **And** throws `PlatformError` (`XACT_4001`) if the configuration is invalid or provider type is unknown.

### AC-7: Proxy Agent & Playwright Anti-Leak Integration
* **Given** a proxy returned from either `StaticProxyProvider` or `DynamicTunnelProvider`
* **When** `getProxyAgent(proxy, options)` or `toPlaywrightProxy(proxy)` is called
* **Then** it creates valid, direct HTTP/HTTPS/SOCKS5 agents via `undici.ProxyAgent` or `SocksProxyAgent` without falling back to direct connection
* **And** `getBrowserArgs(proxy)` includes anti-leak flags:
  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `--proxy-server=<server>`.

### AC-8: TypeScript Type Declarations & Strict Typings
* **Given** `types/proxy.d.ts` and `types/index.d.ts`
* **When** consuming `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`, `DynamicTunnelOptions`, `StaticProxyOptions`, and `ProxyProviderContract` in TypeScript
* **Then** full type declarations are available with zero `any` and zero `@ts-ignore`.

---

## Tasks & Subtasks

- [ ] **Task 1: Implement Dynamic Tunnel Provider & Geo-Preset Formatter (`src/proxy/providers.js`)**
  - [ ] Implement `DynamicTunnelProvider` class.
  - [ ] Implement provider presets: `brightdata`, `smartproxy`, `iproyal`, `kuaidaili`, `custom`.
  - [ ] Implement per-request random session generator.
  - [ ] Implement account sticky session cache with sliding expiry (`sessionDurationMs`).
  - [ ] Implement `rotateSession(accountId)` and `quarantine(proxy)` session refresh.

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

## Dev Notes & Technical Guardrails

### 1. Architecture Compliance
- **File Location:** `src/proxy/providers.js` and `src/proxy/index.js`.
- **Runtime:** Pure ESM (`import`/`export`), Node >= 18.
- **Dependencies:** `undici` (for `ProxyAgent`), `socks-proxy-agent` (for `SocksProxyAgent`), and internal `src/core/error-envelope.js`.
- **Error Handling:** All invalid configs or missing gateways MUST throw `PlatformError` (`XACT_4001`, `invalid_args`, `statusCode: 400`).

### 2. Session ID Generation & Residential Gateways
Residential proxy gateways typically accept session IDs embedded in the proxy username:
- BrightData: `user-lum-customer-hl_123456-zone-residential-country-vn-session-sess12345`
- Smartproxy: `user-customer123-country-vn-session-sess12345`
- IPRoyal: `user-royal123_country-vn_session-sess12345`

For `DynamicTunnelProvider`:
- When `rotatePerRequest: true` without `accountId`: session ID is generated using `crypto.randomBytes(4).toString('hex')`.
- When `accountId` is passed: session ID is `acc_${hash(accountId)}_${epochBucket}` where `epochBucket = Math.floor(Date.now() / sessionDurationMs)`. When time moves to the next bucket, the session tag automatically updates to a new residential exit IP!

---

## Story Completion Status

- **Status:** `ready-for-dev`
- **Checklist Verified:** Yes
- **Next Phase:** ATDD Scaffolding via `/bmad-testarch-atdd 11.2` or implementation via `/bmad-dev-story`.
