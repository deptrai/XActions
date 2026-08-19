# Story 11.2 — Static & Dynamic Residential Tunnel Proxy Providers

**Story ID:** 11.2  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 11.2, `ARCHITECTURE-SPINE.md` AD-3, AD-13, AD-14, AD-2, AD-8, `prd-XActions-2026-08-18-universal-scraping-engine/prd.md` FR-66A/B, `11-1-proxyippool-accountpool-sticky-round-robin.md` implementation patterns, current `src/proxy/**`, `src/core/**`, `types/**`, 2024–2025 provider documentation.

---

## Story

As a **Scale-Out Scraper & Network Engineer**,  
I want **explicit `StaticProxyProvider` and `DynamicTunnelProvider` abstractions that support dedicated static IP pools and rotating residential tunnel gateways from BrightData, Smartproxy / Decodo, IPRoyal, and Kuaidaili**,  
So that **auth-required platforms can bind a single, persistent exit IP to an account (sticky IP) while no-auth platforms can rotate a new residential IP per request, all without leaking the origin IP and without every consumer hard-coding vendor-specific credential hacks.**

---

## Acceptance Criteria

### AC-1: StaticProxyProvider unified contract and delegation
* **Given** a list of static proxies (`string[]` or `Partial<NormalizedProxy>[]`) **or** an existing `ProxyIpPool` instance
* **When** `new StaticProxyProvider({ proxies, pool, name })` is instantiated
* **Then** it implements the common `ProxyProviderContract`:
  - `getProxy({ accountId, platform, country, city })` — returns `getStickyProxy(accountId)` when `accountId` is provided, otherwise `getNext()`
  - `getStickyProxy(accountId)` — deterministic sticky proxy from the internal pool
  - `getNext()` — round-robin healthy proxy
  - `quarantine(proxy, durationMs)` — forwards to pool, drops sticky bindings
  - `toPlaywrightProxy(proxy)` — `{ server, username?, password? }`
  - `getProxyAgent(proxy, { client })` — `undici.ProxyAgent | undici.Socks5ProxyAgent | string`
  - `getBrowserArgs(proxy)` — anti-leak Chromium flags
* **And** getters `healthyCount`, `totalCount`, and `isAllQuarantined()` reflect the underlying `ProxyIpPool` state.
* **And** no proxy string is accepted if it cannot be normalized by `parseProxyUrl` / `normalizeProxy`; invalid input throws `PlatformError` (`XACT_4001`, `invalid_args`).

### AC-2: DynamicTunnelProvider gateway parsing and provider auto-detection
* **Given** a residential / rotating gateway URL such as `http://user:pass@brd.superproxy.io:22225`, `http://user:pass@gate.smartproxy.com:7000`, `socks5://user:pass@geo.iproyal.com:32325`, or `http://user:pass@tps.kdlapi.com:15818`
* **When** `new DynamicTunnelProvider({ gatewayUrl, provider, baseUser, basePassword, options })` is instantiated
* **Then** it parses and validates the gateway using `parseProxyUrl` (`src/proxy/providers.js:72-139`)
* **And** it auto-detects the `provider` preset from the hostname when not explicitly supplied:
  - `*.superproxy.io` / `*.luminati.io` → `brightdata`
  - `*.smartproxy.com` / `*.decodo.com` / `gate.decodo.com` → `smartproxy`
  - `*.iproyal.com` → `iproyal`
  - `*.kdlapi.com` / `*.kuaidaili.com` → `kuaidaili`
  - otherwise → `custom` (requires an explicit `template`)
* **And** it throws `PlatformError` (`XACT_4001`, `invalid_args`, `statusCode: 400`) when `gatewayUrl` is missing, empty, malformed, uses an unsupported scheme, or `custom` is selected without a `template`.

### AC-3: Per-request residential IP rotation
* **Given** a `DynamicTunnelProvider` configured with `rotatePerRequest: true` (default)
* **When** `getProxy({ platform, country, city })` is called **without** an `accountId`
* **Then** it generates a fresh, unique session tag per call (alphanumeric, provider-compatible length)
* **And** it injects the session tag into the appropriate credential field according to the provider preset
* **And** it returns a canonical `NormalizedProxy` whose `server` points to the gateway and whose `username` / `password` contain the augmented credentials
* **And** successive calls return different session tags, producing different residential exit IPs (modulo provider keep-alive / session affinity).

### AC-4: Sticky residential session per account and expiration lifecycle
* **Given** a `DynamicTunnelProvider` configured with `sessionDurationMs` (default: `600_000` / 10 minutes)
* **When** `getProxy({ accountId, platform, country, city })` is called with a specific `accountId`
* **Then** it deterministically derives a session ID from `accountId` and the current time bucket (`Math.floor(Date.now() / sessionDurationMs)`)
* **And** repeated calls within the same time bucket return the **same** `NormalizedProxy` (same session credentials)
* **And** when the time bucket elapses, the next call silently rolls over to a fresh session tag
* **And** calling `rotateSession(accountId)` immediately invalidates the cached session and returns a new proxy
* **And** calling `quarantine(proxy)` on a proxy returned by this provider breaks the sticky session for the associated `accountId` (if the `accountId` can be resolved from the session tag) and returns a fresh session on the next call.

### AC-5: Geo-targeting and credential formatting presets
* **Given** provider configuration or call options containing `country`, `city`, `state`, `region`, `isp`, `sessionId`, `sessionDuration`, `period`, `sid`, `lifetime`, `template`
* **When** the provider builds a `NormalizedProxy` for a request
* **Then** it formats credentials according to the selected provider preset, **without inventing unsupported parameters** and **without adding extra delimiters when an option is undefined**:

  | Provider | Host / Port examples | Where params live | Default credential format |
  |---|---|---|---|
  | `brightdata` | `brd.superproxy.io:22225` (legacy), `33335` (current HTTPS/HTTP), `22228` (SOCKS5), `44445` | appended to **username** | `${baseUser}[-country-${country}][-state-${state}][-city-${city}][-zip-${zip}][-asn-${asn}][-session-${sessionId}][-const]` |
  | `smartproxy` | `gate.smartproxy.com:7000` (rotating), `10001` (sticky), `gate.decodo.com:7000/10001` | appended to **username** | `user-${baseUser}[-country-${country}][-city-${city}][-session-${sessionId}][-sessionduration-${sessionDurationMin}]` |
  | `iproyal` | `geo.iproyal.com:12321`, `us.proxy.iproyal.com:12321`, `32325` | appended to **password** after an underscore | `${basePassword}[_country-${country}][,_country-${country2}...][_city-${city}][_state-${state}][_region-${region}][_isp-${isp}][_session-${sessionId}][_lifetime-${lifetime}]` |
  | `kuaidaili` | `tps.kdlapi.com:15818` (HTTP), `20818` (SOCKS5) | **normal tunnel**: append `:${sid}` to **password** for 30s IP lock; **Pro tunnel**: append `-period-${min}` / `-sid-${sid}` / `-city-${cityCode}` to **username** | Normal: `${baseUser}:${basePassword}:${sid}`; Pro: `${baseUser}[-period-${period}][-sid-${sid}][-city-${cityCode}]:${basePassword}` |
  | `custom` | any | user-supplied `template` string | `template` rendered with `{username}`, `{password}`, `{country}`, `{city}`, `{state}`, `{sessionId}`, `{sessionDuration}`, `{lifetime}`, `{period}`, `{sid}` |

* **And** city names are lowercased and stripped of spaces (e.g. `sanfrancisco`), country codes are two-letter lowercase ISO-3166-1 alpha-2 (except where provider allows `eu` or multi-value), and session IDs respect provider length / charset rules.

### AC-6: Unified provider factory (`createProxyProvider`)
* **Given** a configuration object `{ type, gatewayUrl, proxies, provider, baseUser, basePassword, ...options }`
* **When** `createProxyProvider(config)` is called
* **Then** it returns a `DynamicTunnelProvider` when `config.type === 'dynamic'` **or** `config.gatewayUrl` is present
* **And** it returns a `StaticProxyProvider` when `config.type === 'static'` **or** `config.proxies` is present
* **And** it throws `PlatformError` (`XACT_4001`) if the configuration is ambiguous (both `gatewayUrl` and `proxies`), `type` is unknown, or required fields are missing.

### AC-7: Anti-leak browser, HTTP client, and Playwright compatibility
* **Given** any `NormalizedProxy` returned by `StaticProxyProvider` or `DynamicTunnelProvider`
* **When** `getBrowserArgs(proxy)` is called
* **Then** it returns at minimum:
  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `--proxy-server=<scheme://[host]:port>`
  - `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE <proxyHost>`
* **And** `toPlaywrightProxy(proxy)` returns `{ server, username?, password? }` with credentials correctly split (no raw `user:pass` embedded in `server`)
* **And** `getProxyAgent(proxy, { client: 'undici' | 'got' })` returns:
  - `undici.ProxyAgent` for `http` / `https`
  - `undici.Socks5ProxyAgent` for `socks5`
  - a correctly formatted `proxyUrl` string for `got-scraping`
* **And** all factories throw `PlatformError` instead of falling back to a direct connection.

### AC-8: TypeScript type declarations (strict, no `any`)
* **Given** `types/proxy.d.ts` and `types/index.d.ts`
* **When** the declarations are consumed or `tsc` type-checked
* **Then** `ProxyProviderContract`, `StaticProxyOptions`, `DynamicTunnelOptions`, `ProviderPreset`, `ProviderCredentialFormat`, `StaticProxyProvider`, `DynamicTunnelProvider`, and `createProxyProvider` are exported
* **And** `getProxyAgent` / `getProxy` return types are `undici.ProxyAgent | undici.Socks5ProxyAgent | string` and `NormalizedProxy | null`
* **And** there are zero `any` annotations and zero `@ts-ignore` comments.

### AC-9: Integration with `ProxyIpPool`, `AbstractApiClient`, and `AccountPool`
* **Given** an `AbstractApiClient` configured with a `proxyProvider` or `proxyPool` and an `AccountPool`
* **When** a subclass calls `resolveProxy(accountId)` (`src/core/base-client.js:56-80`)
* **Then** it uses `proxyProvider.getProxy({ accountId })` / `proxyPool.getStickyProxy(accountId)` for `requiresAuth === true`
* **And** it uses `proxyProvider.getProxy()` / `proxyPool.getNext()` for `requiresAuth === false`
* **And** it throws `PlatformError` (`proxy_exhausted`, `XACT_5030`, 30s standby) instead of returning `null`
* **And** when an `AccountPool` is available, an auth-required account whose sticky proxy is quarantined can be re-bound to a new session/exit IP without changing `accountId`.

### AC-10: Standby backoff and quarantine for dynamic tunnels
* **Given** a `DynamicTunnelProvider` whose gateway is unreachable, rate-limited, or whose session is blocked
* **When** the provider detects a failure (via explicit `quarantine(proxy)` call or via a `429/403` response in Story 11.3 interceptor)
* **Then** the failed session is quarantined for the default 5 minutes
* **And** the provider can still generate new sessions on the **same gateway** for subsequent requests
* **And** if the provider is configured with a `standbyBackoffMs` and cannot allocate any healthy session, it throws `proxy_exhausted` with `retryAfterMs` set to `standbyBackoffMs` (default 30,000ms).

### AC-11: Tests pass with zero mocks
* **Given** the implementation and `tests/proxy/providers-tunnel.test.js`
* **When** running `npx vitest run tests/proxy/providers-tunnel.test.js`
* **Then** all tests pass against real in-memory `StaticProxyProvider`, `DynamicTunnelProvider`, and `createProxyProvider` instances
* **And** tests use `vi.useFakeTimers()` to exercise session expiration
* **And** tests cover every provider preset with sample gateway URLs, verify that `getBrowserArgs` / `getProxyAgent` / `toPlaywrightProxy` never return a direct connection, and assert `XACT_4001` / `XACT_5030` errors for invalid input.

---

## Previous Story Intelligence (from 11.1)

### Core implementation patterns carried forward

| Pattern | Source in 11.1 / current code | Why it matters for 11.2 |
|---|---|---|
| Canonical `NormalizedProxy` object `{ scheme, host, port, username?, password?, server }` | `src/proxy/providers.js:20-27`, `parseProxyUrl` lines 72-139, `normalizeProxy` lines 146-196 | Every provider must return the same shape so `ProxyIpPool`, `AbstractApiClient`, and Playwright can consume it without re-parsing. |
| `formatProxyUrl` with RFC 3986 IPv6 bracketing, `encodeURIComponent`, no empty-username auth segment | `src/proxy/providers.js:207-219` | Provider credential builders must reuse this for quarantine keys and agent strings; prevents double-encoding and malformed `http://:pass@host` URLs. |
| `getProxyAgent` factory with `undici.ProxyAgent` / `Socks5ProxyAgent` and `got` string | `src/proxy/providers.js:229-260` | New providers must delegate here; do **not** return `socks-proxy-agent` `http.Agent` for `undici`. |
| `ProxyIpPool` quarantine keyed by `formatProxyUrl(normalized)` including username + password | `src/proxy/proxy-pool.js:93-104`, `11-1` review finding | For dynamic gateways, the *same* host:port can represent many sessions; quarantine must key on the full credential string, not just the gateway. |
| Copy-on-return and deterministic round-robin / hash over total pool | `src/proxy/proxy-pool.js:140-199` | `StaticProxyProvider` should wrap `ProxyIpPool` and not reimplement allocation; dynamic provider should return shallow copies so callers cannot mutate internal cache. |
| `getBrowserArgs` throws on invalid proxy and adds `--host-resolver-rules` | `src/proxy/proxy-pool.js:293-313` | Every provider proxy must flow through this; never allow Chromium to fall back to direct DNS. |
| `AccountPool` `platform:accountId` namespacing, redacted `getAccount` | `src/core/account-pool.js:49-408` | Sticky session tags may be derived from `platform:accountId` composite key; providers must not leak credentials when `setAssignedProxy` stores a proxy on an account record. |
| `AbstractApiClient.resolveProxy` throws `proxy_exhausted` with 30s standby | `src/core/base-client.js:56-80` | Provider `getProxy` returning `null` is not allowed; consumers must catch `XACT_5030` and throttle. |
| `AdaptiveRateGovernor` healthyProxyRatio & account hibernation | `src/core/adaptive-governor.js:144-275` | `DynamicTunnelProvider` must expose `healthyCount` / `totalCount` so the governor can compute throughput and pause when ratio < 0.1. |

### 11.1 code-review findings that directly shape 11.2

1. **Quarantine key must include credentials.** A residential gateway such as `gate.smartproxy.com:7000` is shared by every session. Quarantining the bare gateway would disable the whole provider; quarantine must target the exact `username:password@host:port` string. [`11-1` review: Residential rotating proxy collision in `ProxyIpPool.#key`]
2. **IPv6 bracketing is mandatory.** `formatProxyUrl` already wraps IPv6 hosts; providers must not build URLs manually. [`11-1` review: IPv6 proxy objects produce unbracketed `server` strings]
3. **Never return `null` then continue unproxied.** `base-client.js` now throws `proxy_exhausted`; providers must do the same if they cannot allocate. [`11-1` review: `resolveProxy` forwards `null` from an exhausted pool]
4. **Credentials in `AccountPool.getAccount` are redacted.** If a provider stores an assigned proxy on an `AccountRecord`, the returned view must strip `username` and `password`. [`11-1` review: `getAccount` exposes raw credentials without redaction`]
5. **Velocity and hibernation state are sensitive to clock skew.** `DynamicTunnelProvider` session time-buckets also use `Date.now()`; document the limitation and do not use `process.hrtime` in this story. [`11-1` deferred: Hibernation and quarantine depend on `Date.now()`]
6. **No transaction between proxy selection and request use.** In multi-worker usage the session could be quarantined between `getProxy` and the actual HTTP call. This is an accepted gap to be solved by the request pipeline checkout in Stories 11.3 / 11.5 / 11.7. [`11-1` deferred: No transaction between proxy selection and actual request use]

### 11.1 test approach to mirror

- Real in-memory pools; no `vi.fn()` or stubbed `undici`.
- Use `beforeEach` to reset `ProxyIpPool` and `AccountPool`.
- For time-based behavior, use `vi.useFakeTimers()` and `vi.advanceTimersByTime(...)`.
- For invalid input, assert `PlatformError` with `code === 'XACT_4001'`.
- For agent output, assert `instanceof undici.ProxyAgent` / `undici.Socks5ProxyAgent` or exact `proxyUrl` string.

---

## Architecture Compliance

### AD-3 — Centralized Proxy IP Pool with Auto-Quarantine, Anti-Leak & Proxy Strategy by Auth Mode
* **Binds:** `src/proxy/**`, toàn bộ Network Interceptors
* **Relevant rules:**
  1. Mọi browser session bắt buộc kích hoạt cờ chống rò rỉ: `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` và cấu hình `remote DNS resolution`.
  2. **Hai chế độ proxy:**
     - Auth-Required Platforms: sticky IP per account.
     - No-Auth Platforms: proxy xoay per-request / per-batch.
  3. `ProxyIpPool` supports `getStickyProxy(accountId)` and `getNext()`.
  4. 429/403 → quarantine 5 phút, retry 3 lần exponential backoff.
  5. 100% proxy quarantined → Standby Backoff 30s.
  6. SOCKS5 proxy yêu cầu `socks-proxy-agent` hoặc `undici` SOCKS agent; không được fallback.

**11.2 compliance:**
- `StaticProxyProvider` is a thin contract over `ProxyIpPool`, preserving sticky / round-robin modes.
- `DynamicTunnelProvider` keeps its own session map so auth-required platforms get a sticky *session* (same exit IP for a duration) while no-auth platforms get a new *session tag* each call.
- Anti-leak browser args are produced by reusing `ProxyIpPool.getBrowserArgs` / `toPlaywrightProxy`.
- SOCKS5 tunnels (IPRoyal, Kuaidaili) use `getProxyAgent` which returns `undici.Socks5ProxyAgent`.
- `createProxyProvider` makes the strategy selection explicit via `type`.

### AD-13 — Adaptive Infrastructure-Aware Dynamic Rate Limiting & Account Protection Governor
* **Binds:** `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js`, `src/scrapers/**`
* **Relevant rules:**
  1. Inputs: `healthyProxyCount`, `totalProxyCount`, `accountVelocity`, `redisConsumerLag`, `PlatformRateLimit`.
  2. `maxReqPerSecond = healthyProxyCount × baseReqPerSecondPerProxy × throttleFactor`; <50% healthy → -50%, <10% → pause.
  3. Account token bucket; challenge/Captcha → hibernation 15–30 minutes.
  4. `AccountPool.getNextAvailable(platform)` rotates accounts.
  5. Consumer lag > 10,000 → -75%.
  6. No direct IP leak.

**11.2 compliance:**
- `StaticProxyProvider.healthyCount` / `totalCount` are delegated from `ProxyIpPool` so `AdaptiveRateGovernor.refreshFromProxyPool()` continues to work.
- `DynamicTunnelProvider` tracks `healthySessionCount` / `totalSessionCount` and treats a quarantined session as unhealthy. If all active sessions for a provider are quarantined, the provider reports `isAllQuarantined() === true` so the governor can pause the platform.
- Auth-required usage with a dynamic provider triggers sticky session allocation per `accountId`; on `429/403` the session is quarantined and `AccountPool.markUnavailable` / `governor.hibernateAccount` are invoked by the Story 11.3 interceptor.

### AD-14 — Operational Status & Error Envelope for Consumers
* **Binds:** `src/mcp/**`, `src/api/**`, `src/cli/**`, `src/core/error-envelope.js`, `src/core/status-api.js`
* **Relevant rules:**
  1. Error envelope `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
  2. `type` values and `suggestedAction` values.
  3. Governor status API.
  4. Legacy CLI mapping.

**11.2 compliance:**
- All provider failures throw `PlatformError` with `code`, `type`, `retryAfterMs`, and `suggestedAction`. Invalid config → `invalid_args` / `XACT_4001` / `suggestedAction: use_x_actions_list`. Pool/gateway exhausted → `proxy_exhausted` / `XACT_5030` / `suggestedAction: wait` / `retryAfterMs: 30000`.
- The new `DynamicTunnelProvider` and `StaticProxyProvider` expose enough status for `GovernorStatus` (`healthyCount`, `totalCount`, `isAllQuarantined`) without changing `src/core/status-api.js`.

### AD-2 — Unified Base Scraper & Client Interfaces
* **Binds:** `src/core/base-crawler.js`, `src/core/base-client.js`, etc.
* **Relevant rules:**
  1. Every module extends `AbstractCrawler` / `AbstractApiClient`.
  2. `start()` receives a `CrawlerCommand`.
  3. `src/client/` is legacy; new abstractions live in `src/core/**`.

**11.2 compliance:**
- The new providers live in `src/proxy/` and are consumed by `AbstractApiClient` via `resolveProxy`. No platform logic is added to `src/core/`; `src/core` stays dependency-free except for `error-envelope`.
- `AbstractApiClient` already supports `proxyPool`; the provider contract (`ProxyProviderContract`) should be duck-typed so either a `ProxyIpPool` or a `StaticProxyProvider` / `DynamicTunnelProvider` can be injected.

### AD-8 — Multi-Domain Expansion Blueprint
* **Binds:** `src/scrapers/**`
* **Relevant rules:**
  - `src/scrapers/social/` (requires auth): Twitter, Facebook, Threads, TikTok.
  - `src/scrapers/ecom/` (requires auth): Shopee, TikTok Shop.
  - `src/scrapers/realestate/` (no auth): Chợ Tốt, Batdongsan.com.vn.
  - `src/scrapers/recruitment/` (mixed; LinkedIn auth, others may be no auth).

**11.2 compliance:**
- `DynamicTunnelProvider` per-request mode is the default for no-auth real-estate scrapers.
- `DynamicTunnelProvider` sticky-session mode is used for auth-required social / ecom / LinkedIn scrapers.
- Provider selection is configured in per-platform crawler constructors (Story 11.7 / 13.x), not hard-coded in the provider layer.

---

## Technical Requirements & Provider Presets Matrix

### Common `ProxyProviderContract`

Every provider (static or dynamic) must implement the following interface:

```ts
interface ProxyProviderContract {
  name: string;
  getProxy(opts?: ProxyRequestOptions): NormalizedProxy | null;
  getNext(): NormalizedProxy | null;
  getStickyProxy(accountId: string): NormalizedProxy | null;
  quarantine(proxy: string | Partial<NormalizedProxy>, durationMs?: number): void;
  isAllQuarantined(): boolean;
  get healthyCount(): number;
  get totalCount(): number;
  toPlaywrightProxy(proxy: string | Partial<NormalizedProxy>): PlaywrightProxyConfig | null;
  getProxyAgent(proxy: string | Partial<NormalizedProxy>, options?: ProxyAgentOptions): ProxyAgent | Socks5ProxyAgent | string;
  getBrowserArgs(proxy: string | Partial<NormalizedProxy>): string[];
}
```

`ProxyRequestOptions`:
```ts
interface ProxyRequestOptions {
  accountId?: string;
  platform?: string;
  country?: string;
  city?: string;
  state?: string;
  region?: string;
  isp?: string;
  sessionId?: string;
  sessionDurationMs?: number;
  rotatePerRequest?: boolean;
}
```

### Provider Presets Matrix

| Preset | Hostname patterns | Typical ports | Scheme | Where targeting lives | Sticky strategy | Per-request strategy | Reference |
|---|---|---|---|---|---|---|---|
| **brightdata** | `*.superproxy.io`, `*.luminati.io` | `22225` (legacy), `33335` (current HTTP/HTTPS), `22228` (SOCKS5), `44445` | `http` / `https` / `socks5` | appended to **username** | `-session-${sid}` in username for 1+ requests; idle 5 min resets; add `-const` for strict single peer | new random `-session-${sid}` each call | [docs.brightdata.com — Config options / Rotate IPs](https://docs.brightdata.com/proxy-networks/config-options) |
| **smartproxy** / **decodo** | `*.smartproxy.com`, `*.decodo.com` | `7000` rotating, `10001` sticky | `http` / `https` | appended to **username**; endpoints may be country-specific (`us.smartproxy.com`) | `user-${baseUser}-country-${cc}-city-${city}-session-${sid}-sessionduration-${min}` | same format with a new `sid` per call | [help.smartproxy.com — IP:Port format](https://help.smartproxy.com/docs/how-to-get-ip-port-format), [decodo.com — Proxy address](https://decodo.com/faq/getting-started/proxy-address) |
| **iproyal** | `*.iproyal.com`, `geo.iproyal.com`, `us.proxy.iproyal.com` | `12321`, `32325`, `7777` | `http` / `https` / `socks5` | appended to **password** with underscore delimiters | `password_country-${cc}_city-${city}_session-${sid}_lifetime-${duration}` | same with new `sid`; `sid` must be 8 chars alphanumeric | [docs.iproyal.com — Residential proxy / Sticky session](https://docs.iproyal.com/proxies/residential/proxy) |
| **kuaidaili** (快代理) | `*.kdlapi.com`, `*.kuaidaili.com` | `15818` (HTTP), `20818` (SOCKS5) | `http` / `https` / `socks5` | **Normal tunnel**: lock IP by appending `:${sid}` to **password** (30s). **Pro tunnel**: append `-period-${min}` / `-sid-${sid}` / `-city-${cityCode}` to **username** | Normal: `user:pass:${sid}`; Pro: `user-period-${min}-sid-${sid}:pass` | Normal: omit `:sid` for new IP each request; Pro: vary `sid` | [kuaidaili.com — 隧道代理开发手册](https://www.kuaidaili.com/doc/dev/tps/), [隧道代理Pro开发手册](https://help.kuaidaili.com/dev/tps_pro/) |
| **custom** | any | any | any | user-supplied `template` string | `template` with `{sessionId}` placeholder | `template` with new `{sessionId}` each call | — |

### Session / targeting format examples

```text
# BrightData (residential, US, San Francisco, session abc123, current port)
http://brd-customer-123-zone-resi-country-us-city-sanfrancisco-session-abc123:zonepass@brd.superproxy.io:33335

# Smartproxy / Decodo (rotating, US, Nashville, session nashville30, 30 min)
http://user-spuser-country-us-city-nashville-session-nashville30-sessionduration-30:sppass@gate.smartproxy.com:7000

# IPRoyal (residential, Brazil, session sgn34f3e, lifetime 10m)
http://username123:password321_country-br_session-sgn34f3e_lifetime-10m@geo.iproyal.com:12321

# Kuaidaili normal tunnel (lock same IP for 30s with :abc)
http://t18725652473456:jkr369ry:abc@tps.kdlapi.com:15818

# Kuaidaili Pro tunnel (30s rotation, channel s01)
http://t2964279696-period-0.5-sid-s01:jkr369ry@tps.kdlapi.com:15818
```

### Session lifecycle rules

| Concern | Rule |
|---|---|
| Session ID generation | Use `crypto.randomUUID()` or `Math.random().toString(36).slice(2)` but clamp to provider limits (BrightData: alphanumeric, no special chars; IPRoyal: exactly 8 chars; Kuaidaili: ≤ 6 chars). |
| Sticky bucket | `bucket = Math.floor(Date.now() / sessionDurationMs)`. Session ID is `hash(accountId + bucket + platform)` truncated to provider length. |
| Rollover | If `Date.now()` crosses into the next bucket, recompute session ID. Old quarantined sessions are removed from the cache. |
| Manual rotation | `rotateSession(accountId)` deletes the cached entry and generates a new session ID independent of time bucket. |
| Quarantine | `quarantine(proxy)` computes the `formatProxyUrl(proxy)` key; if it matches a cached sticky session, that `accountId` entry is removed. If the quarantined proxy is the gateway itself (no session tag), the provider marks the gateway unhealthy for the duration. |
| Default session duration | `600_000` ms (10 minutes). Configurable per provider / per call. |

---

## Library & Framework Requirements

| Package | Version in `package.json` | Role in 11.2 |
|---|---|---|
| `undici` | `^7.29.0` | `ProxyAgent` for `http`/`https` and `Socks5ProxyAgent` for `socks5`. Must be the only agent type passed to `undici.request({ dispatcher })`. |
| `got-scraping` | `^3.2.15` | Receives a `proxyUrl` string (including credentials) for HTTP/HTTPS/SOCKS5; handles TLS/JA4 spoofing internally. |
| `playwright` | `^1.62.1` | `chromium.launch({ proxy: { server, username, password } })` and `browser.newContext({ proxy })`. Credentials must be passed as separate fields, never embedded in `server`. |
| `puppeteer` | `^24.34.0` | Legacy browser automation still used by `src/client/` and Facebook automation; providers should still be usable via `page.authenticate()` but this story does not require explicit Puppeteer support. |
| `socks-proxy-agent` | `^8.0.5` | Present in `package.json` but **not** to be returned for `client: 'undici'`; only acceptable if a future `client: 'http'` (legacy Node `http.Agent`) path is added. |
| `vitest` | `^4.0.18` | Test runner. Use `vi.useFakeTimers()` for session time-bucket tests. |

Do **not** introduce new runtime dependencies in `src/core/**`. `src/proxy/**` may import `undici` / `got-scraping` / `playwright` because it is outside the `src/core` zero-dependency zone.

---

## File Structure Requirements

| File | Action | Why |
|---|---|---|
| `src/proxy/providers.js` | **UPDATE** | Add `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`, and provider-preset helpers. Existing exports `parseProxyUrl`, `normalizeProxy`, `formatProxyUrl`, `getProxyAgent`, `SUPPORTED_PROXY_SCHEMES` must remain unchanged and be reused. |
| `src/proxy/proxy-pool.js` | **UPDATE (minimal)** | Optional: add `setProvider(provider)` or allow `ProxyIpPool` to accept a `provider` so status getters can be unified. No breaking change to `getStickyProxy` / `getNext` / `quarantine`. |
| `src/proxy/index.js` | **UPDATE** | Re-export `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`, `ProxyProviderContract` (as types only) alongside existing `ProxyIpPool`, `globalProxyPool`. |
| `src/core/base-client.js` | **UPDATE (minimal)** | Optionally accept `proxyProvider` in constructor and use it in `resolveProxy` if provided, falling back to `proxyPool`. Must preserve existing `proxyPool` behavior. |
| `src/core/account-pool.js` | **NO CHANGE** | Already supports `setAssignedProxy` and platform namespacing. Story 11.2 should use it, not modify it. |
| `src/core/adaptive-governor.js` | **NO CHANGE** | Already consumes `healthyCount` / `totalCount`. `DynamicTunnelProvider` must implement these getters. |
| `src/proxy/index.js` | already exists (lines 1–8) | Update `src/proxy/index.js` to include new exports. |
| `types/proxy.d.ts` | **UPDATE** | Add `ProxyProviderContract`, `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`, `ProviderPreset`, `DynamicTunnelOptions`, `StaticProxyOptions`, `ProxyRequestOptions`. Use `unknown` / `NormalizedProxy` / `ProxyAgent` / `Socks5ProxyAgent` unions, no `any`. |
| `types/index.d.ts` | **UPDATE (minimal)** | Ensure `export * as proxy from './proxy';` picks up the new declarations. Already present at line 769. |
| `tests/proxy/providers-tunnel.test.js` | **NEW (to be written by implementation, not in this story)** | ATDD suite described in AC-11. This story file defines the contract and test expectations. |
| `api/routes/proxies.js` | **NO CHANGE** | Operational API already exposes `/api/proxies/**` for the global pool. Provider-specific API endpoints belong to Epic 19 (Dashboard/Admin CLI), not Story 11.2. |
| `prisma/`, `dashboard/`, `api/`, `src/scrapers/**` | **NO CHANGE** | Out of scope per rules. |

---

## Testing Requirements

### ATDD approach
1. Write `tests/proxy/providers-tunnel.test.js` **before** or **alongside** implementation.
2. Each AC maps to at least one `describe` block and one or more `test` cases.
3. All tests use **real in-memory** provider instances. No mocked `undici`, no mocked `Math.random`, no stubbed `Date.now`.
4. Use `vi.useFakeTimers()` only to control `Date.now()` for session bucket and quarantine expiry tests; the implementation must still call the real `Date.now()`.

### Test coverage checklist
- [ ] `StaticProxyProvider` delegates to `ProxyIpPool` and supports sticky / round-robin / quarantine.
- [ ] `DynamicTunnelProvider` auto-detects each preset from hostname.
- [ ] `DynamicTunnelProvider` returns a new session per request when `accountId` is omitted.
- [ ] `DynamicTunnelProvider` returns the same session within a time bucket for a given `accountId`.
- [ ] Time-bucket rollover with `vi.advanceTimersByTime(sessionDurationMs + 1)` produces a new session.
- [ ] `rotateSession(accountId)` produces a new session immediately.
- [ ] Provider preset formatting matches the reference examples for BrightData, Smartproxy, IPRoyal, Kuaidaili, and `custom` template.
- [ ] `getBrowserArgs` always includes WebRTC disable, proxy server, and host resolver rules.
- [ ] `toPlaywrightProxy` never leaks credentials into `server`.
- [ ] `getProxyAgent` returns the correct `undici` agent class or `got` URL string for `http`, `https`, `socks5`.
- [ ] `createProxyProvider` returns correct type and throws on ambiguous / invalid config.
- [ ] `AbstractApiClient.resolveProxy` (or a subclass) throws `proxy_exhausted` with 30s `retryAfterMs` when the provider is exhausted.

### Run commands
```bash
npx vitest run tests/proxy/providers-tunnel.test.js
npx vitest run tests/proxy/proxy-pool.test.js tests/proxy/providers.test.js tests/core/account-pool.test.js tests/core/base-client-proxy.test.js
```

---

## Git Intelligence Summary

### Recent 11.1 / proxy-related commits

| Commit | Message | Key changes relevant to 11.2 |
|---|---|---|
| `6d85ba9` | `feat(proxy): complete story 11.1 ProxyIpPool and AccountPool with review patches` | Initial `ProxyIpPool`, `AccountPool`, `providers.js`, `types/proxy.d.ts`, `base-client.js` proxy resolution. |
| `061725b` | `fix(proxy): address round 2 code review findings (IPv6 format, proxy key with password, account merge)` | `formatProxyUrl` uses `encodeURIComponent` and brackets IPv6; `ProxyIpPool.#key` includes password. |
| `b81a542` | `test(automate): expand test automation coverage for proxy providers and client proxy routing (92 passing tests)` | Added `providers.test.js` and `base-client-proxy.test.js`; tests must remain green. |
| `b69625c` | `feat(api): add live REST API endpoints for ProxyIpPool and AccountPool (/api/proxies)` | `api/routes/proxies.js` provides global pool status; no provider API yet. |
| `3312ccd` | `Apply Story 11.1 review patches and decisions` | Final 11.1 state: namespaced accounts, default 15m hibernation, `isAllQuarantined` true for empty pool, healthyProxyRatio, `proxy_exhausted` in `base-client.js`, strict types. |
| `4448f17` | `Record Story 11.1 deferred review findings` | Deferred items: clock skew and proxy selection / request transaction gap. |
| `d8f72af` | `chore(deps): sync package-lock engine field with package.json` | `undici` v7 requires Node `>=20.18.1`. |
| `0665bcf` | `fix(types): getBrowserArgs requires a proxy argument` | `types/proxy.d.ts:67` no longer accepts `null`; providers must never call with `null`. |
| `2c1838b` | `docs(story): create Story 11.2 Static & Dynamic Residential Tunnel Proxy Providers (ready-for-dev)` | Original 11.2 story file created. |
| `67d12b1` | `docs(story): apply all quality checklist improvements to Story 11.2 (ready-for-dev)` | Quality checklist pass. |

### Commit patterns
- 11.1 implementation was done in iterative chunks: core → tests → review patches → types → API.
- The project uses both `Vonic` and `nirholas` as authors; this story should be committed as `nirholas <nirholas@xactions.app>` per project rules.
- No `api/`, `prisma/`, `dashboard/` modifications occurred during 11.1; the same boundary applies to 11.2.

---

## Latest Tech Information from Web Research

### BrightData (`brd.superproxy.io`, `*.luminati.io`)
- **Current ports (2024–2025):** `33335` for HTTP/HTTPS (new SSL CA, expires Sept 2034); `22225` legacy (old CA, expires Sept 2026); `22228` for SOCKS5; `44445` also referenced. Default to `33335`.
- **Username structure:** `brd-customer-<customerID>-zone-<zoneName>` plus optional `-param-value` pairs appended with hyphens.
- **Targeting:** `-country-<cc>` (two-letter), `-state-<xx>` (US state code, requires `-country-us`), `-city-<name>` (lowercase, no spaces, e.g. `sanfrancisco`), `-zip-<5digit>`, `-asn-<number>`, `-os-<windows|macos|android>`.
- **Session / rotation:** `-session-<sid>` keeps same exit IP; `sid` must be alphanumeric; `-const` forces single peer and returns 502 if unavailable; idle time is ~5 minutes, after which session resets.
- **DNS control:** `-dns-local` / `-dns-remote`.
- **Important:** Parameters are appended to the **username**, not the password, and are separated by hyphens. City/state/zip are Residential/Mobile only; Datacenter/ISP only support country.
- **Source:** [docs.brightdata.com — Proxy config options](https://docs.brightdata.com/proxy-networks/config-options), [Bright Data rotate IPs](https://docs.brightdata.com/api-reference/proxy/rotate_ips).

### Smartproxy / Decodo (`gate.smartproxy.com`, `*.decodo.com`)
- **Ports:** `7000` rotating; `10001` sticky (10 min); country-specific endpoints such as `us.smartproxy.com` or `us.decodo.com` may exist.
- **Authentication:** `http://<username>:<password>@gate.smartproxy.com:<port>`.
- **Username modifiers (common pattern):** `user-<BASEUSER>-country-<CC>-city-<CITY>-session-<SID>-sessionduration-<MINUTES>`.
- **Sticky session:** use port `10001` **or** add `-sessionduration-<min>` on port `7000`.
- **Caveat:** Reseller / Decodo documentation also shows `username:password-cc-<CC>-sessid-<SID>-sesstime-<MIN>` in IP:Port list format. Because the exact prefix (`user-` vs. none) depends on the account/sub-user setup, the provider preset must treat `baseUser` as the literal dashboard username and allow a configurable `prefix` (default `user-` for Smartproxy, empty for Decodo).
- **Source:** [help.smartproxy.com — IP:Port format](https://help.smartproxy.com/docs/how-to-get-ip-port-format), [decodo.com — Proxy address](https://decodo.com/faq/getting-started/proxy-address), IPCola / Smartproxy backconnect docs.

### IPRoyal (`geo.iproyal.com`, `*.iproyal.com`)
- **Endpoints:** `geo.iproyal.com` (auto region); `proxy.iproyal.com` (Germany), `us.proxy.iproyal.com`, `sg.proxy.iproyal.com`; ports `12321`, `32325`, `7777` vary by product.
- **Credential placement:** For **Residential proxies**, targeting and session parameters are appended to the **password** with an underscore (`_`) delimiter. For **Web Unblocker**, parameters are appended to the password with a hyphen? Research shows `_country-`, `_city-`, `_state-`, `_session-`, `_lifetime-`.
- **Format:** `password[_country-<CC>][,_country-<CC2>...][_city-<CITY>][_state-<STATE>][_region-<REGION>][_isp-<ISP>][_session-<SID>][_lifetime-<DURATION>]`.
- **Session rules:** `sid` must be exactly 8 alphanumeric characters; `_lifetime-<duration>` (e.g. `10m`, `2h`, `7d`) keeps the IP for the configured lifetime.
- **Example:** `http://username123:password321_country-br_session-sgn34f3e_lifetime-10m@geo.iproyal.com:12321`.
- **Important:** Because parameters live in the password, `toPlaywrightProxy` must put the augmented password in `password`, not `username`.
- **Source:** [docs.iproyal.com — Residential proxy](https://docs.iproyal.com/proxies/residential/proxy), [docs.iproyal.com — Location targeting](https://docs.iproyal.com/proxies/residential/proxy/location).

### Kuaidaili / 快代理 (`*.kdlapi.com`, `*.kuaidaili.com`)
- **Products:** 隧道代理 (tunnel proxy) and 隧道代理Pro.
- **Ports:** `15818` (HTTP/HTTPS), `20818` (SOCKS5) for tunnel endpoints.
- **Normal tunnel:** Username and password are fixed; to **lock an IP for 30 seconds**, append `:${sid}` to the **password**: `user:pass:sid`.
- **Pro tunnel:** Append control parameters to the **username** with hyphens:
  - `-period-<min>` (0.25, 0.5, 1–30) — rotation interval.
  - `-sid-<sid>` (≤ 6 chars) — channel / session id.
  - `-city-<cityCode>` — target city by code.
  - `-area-<code>`, `-prov-<code>`, `-pool-<code>` for advanced forwarding.
- **Example:** `t2964279696-period-0.5-sid-s01:jkr369ry@tps.kdlapi.com:15818` (30s rotation, channel s01).
- **Source:** [kuaidaili.com — 隧道代理开发手册](https://www.kuaidaili.com/doc/dev/tps/), [快代理 — 隧道代理Pro开发手册](https://help.kuaidaili.com/dev/tps_pro/).

### General 2024–2025 conventions
1. **No query-string parameters in proxy URLs.** All providers encode targeting into `username` or `password`.
2. **Session stickiness is opt-in.** Rotation is the default; add a session tag to stay on one exit IP.
3. **Credentials are URL-encoded.** Special characters in usernames/passwords (`@`, `:`, `?`, `#`) must be percent-encoded before being composed into a URL.
4. **City names are usually lowercased and stripped of spaces.** Some providers use city codes instead of names.
5. **SOCKS5 support is common but port differs from HTTP.** Providers may expose a separate SOCKS5 port or endpoint.

---

## Project Context Reference

### Existing source files (current `HEAD`)
- `src/proxy/providers.js:11-260` — `SUPPORTED_PROXY_SCHEMES`, `parseProxyUrl`, `normalizeProxy`, `formatProxyUrl`, `getProxyAgent`.
- `src/proxy/proxy-pool.js:14-337` — `ProxyIpPool` with quarantine, sticky map, round-robin, `toPlaywrightProxy`, `getBrowserArgs`, `getProxyAgent`.
- `src/proxy/index.js:1-8` — currently re-exports only `ProxyIpPool` and `globalProxyPool`.
- `src/core/base-client.js:15-130` — `AbstractApiClient` with `requiresAuth`, `resolveProxy`, `proxyPool`, `accountPool`, `governor` injection.
- `src/core/account-pool.js:13-411` — `AccountPool` with `platform:accountId` namespacing, hibernation, velocity, redaction.
- `src/core/adaptive-governor.js:39-276` — `AdaptiveRateGovernor` with `getMaxThroughput`, `recordRateLimit`, `hibernateAccount`, `wakeAccount`, `isHibernating`, `getStatus`.
- `src/core/error-envelope.js:10-146` — `ErrorTypes`, `SuggestedActions`, `PlatformError`, `ProxyDeadError`.
- `src/core/types.js:74-83` — `GovernorStatus` typedef; `types/proxy.d.ts` — proxy TypeScript declarations.
- `types/index.d.ts:769` — `export * as proxy from './proxy';`
- `api/routes/proxies.js:1-116` — live REST endpoints for the global `ProxyIpPool` and `AccountPool`.

### Existing test files (to keep green)
- `tests/proxy/providers.test.js` — `parseProxyUrl`, `normalizeProxy`, `formatProxyUrl`, `getProxyAgent`.
- `tests/proxy/proxy-pool.test.js` — `ProxyIpPool` AC-1..AC-6, AC-10.
- `tests/core/account-pool.test.js` — `AccountPool` AC-7..AC-9, AC-11.
- `tests/core/base-client-proxy.test.js` — `AbstractApiClient.resolveProxy` sticky / rotating / exhausted.

### Planning artifacts
- `_bmad-output/planning-artifacts/epics.md:189-201` — Story 11.2 source.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:133-145` — AD-3.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:219-229` — AD-13.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:230-241` — AD-14.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:125-132` — AD-2.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:183-191` — AD-8.
- `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md:62-65` — FR-66A/B.

### Current sprint status
- `sprint-status.yaml:46` already marks `11-2-static-dynamic-residential-tunnel-proxy-providers: ready-for-dev`.

---

## Warnings & Potential Pitfalls

1. **Do not embed provider geo/session parameters in the wrong credential field.** BrightData and Smartproxy append to `username`; IPRoyal appends to `password`; Kuaidaili uses both depending on product. Putting a BrightData `-country-us` in the password will silently fail or default to random geo.

2. **Never hard-code provider ports as the only option.** BrightData `22225` is legacy; Smartproxy `7000` and `10001` have different semantics (rotating vs. sticky); IPRoyal has `12321`, `32325`, `7777`. Always allow the user to override the parsed port.

3. **Session IDs are not free-form.** BrightData requires alphanumeric only and rejects `-` / `*` in the `sid`. IPRoyal requires exactly 8 characters. Kuaidaili `sid` is ≤ 6 characters. Validate length and charset before formatting.

4. **Quarantine must not disable an entire gateway for one bad session.** The quarantine key is `formatProxyUrl(normalized)` which includes the full credential string. Quarantining `user:pass:abc@tps.kdlapi.com:15818` only blocks the `abc` session; the gateway remains usable with a different `sid`.

5. **Do not re-use a dynamic session for per-request (no-auth) scraping by accident.** If `accountId` is omitted and `rotatePerRequest` is `true`, every `getProxy()` must generate a new `sid`. Forgetting to reset `sid` will cause the same exit IP to be reused and trigger platform rate limits.

6. **Sticky sessions expire on idle or bucket boundaries.** BrightData sessions reset after ~5 minutes of idle time even if the same `sid` is sent. The `DynamicTunnelProvider` time-bucket approach helps, but a bucket that is too short causes unnecessary IP churn; too long increases ban risk. Default 10 minutes is a starting point and must be tunable per platform.

7. **Avoid HTTP keep-alive causing session stickiness when you intended rotation.** `undici` and `got-scraping` may reuse a TCP connection. To force a new exit IP, generate a new `sid` **and** use a new connection or set `Connection: close` depending on client.

8. **Do not create a `StaticProxyProvider` inside `src/core/`.** `src/core` must remain dependency-free. Keep all provider logic in `src/proxy`.

9. **Do not return `null` and continue unproxied.** If `getProxy()` cannot allocate, throw `PlatformError` (`proxy_exhausted` / `XACT_5030`). This is enforced by `AbstractApiClient.resolveProxy` and must hold for provider implementations.

10. **URL-encoding is a one-way operation.** `formatProxyUrl` uses `encodeURIComponent`. Provider presets must not double-encode the base username/password. Store raw base credentials and encode only during final URL composition.

11. **Playwright and `got-scraping` have different credential expectations.** Playwright needs `{ server, username, password }` with credentials separate; `got-scraping` needs them embedded in the URL. `toPlaywrightProxy` and `getProxyAgent` must produce the correct shape.

12. **TypeScript declarations cannot use `any`.** The project enforces strict mode. Update `types/proxy.d.ts` with concrete unions (`ProxyAgent | Socks5ProxyAgent | string`, `NormalizedProxy | null`).

---

## Decisions Record

| # | Decision | Rationale |
|---|---|---|
| D-1 | `StaticProxyProvider` wraps `ProxyIpPool` rather than re-allocating. | Reuses the hardened 11.1 logic (round-robin, hash, quarantine, copy-on-return) and keeps the provider contract thin. |
| D-2 | `DynamicTunnelProvider` maintains its own `Map<accountId, session>` plus a time-bucket session ID. | Residential gateways have one host:port; session differentiation is done via credentials. Time-bucketing gives deterministic sticky sessions without external state. |
| D-3 | Provider presets know whether to append targeting to `username` or `password`. | Based on 2024–2025 docs: BrightData/Smartproxy → username; IPRoyal → password; Kuaidaili → both. This avoids silent misconfiguration. |
| D-4 | `custom` preset requires a user-supplied `template` string and is the fallback for any unknown hostname. | Keeps the system extensible for new providers without code changes. |
| D-5 | Session tags are generated per call for no-auth and per time-bucket for auth; `rotateSession` invalidates immediately. | Matches AD-3 (auth = sticky, no-auth = rotating) while allowing manual rotation on ban. |
| D-6 | Quarantine key uses `formatProxyUrl(normalized)` including the session credentials. | Prevents quarantining a shared gateway for all sessions; only the failed session is blocked. |
| D-7 | `DynamicTunnelProvider` exposes `healthyCount` / `totalCount` as healthy/total *sessions currently allocated*, not the gateway itself. | Lets `AdaptiveRateGovernor` treat a provider with all quarantined sessions as exhausted. |
| D-8 | Provider formatting lowercases country codes and strips spaces from city names by default. | Matches BrightData and Smartproxy documented conventions. City codes are used where provider expects codes (Kuaidaili). |
| D-9 | No new runtime dependencies in `src/core`; all provider logic stays in `src/proxy`. | Preserves `src/core` zero-dependency rule and AD-2 / AD-3 boundaries. |
| D-10 | `createProxyProvider` selects `dynamic` if `gatewayUrl` is present, `static` if `proxies` is present, and throws on ambiguity. | Makes configuration explicit and prevents accidental mixing of two different allocation models. |
| D-11 | Tests use `vi.useFakeTimers()` for time-bucket tests but no mocks of `undici` or `Math.random`. | Story 11.1 established the no-mock policy; this story continues it while needing deterministic time. |
| D-12 | BrightData `brd.superproxy.io:22225` is supported but `33335` is the recommended default. | `22225` is legacy/deprecated as of 2024–2025 docs. The parser accepts any port. |

---

## Tasks & Subtasks

- [ ] **Task 1: Extend `src/proxy/providers.js` with provider contract and presets**
  - [ ] Add `ProxyProviderContract` JSDoc / types.
  - [ ] Add `StaticProxyProvider` class (wraps `ProxyIpPool` or accepts `pool`).
  - [ ] Add `DynamicTunnelProvider` class with gateway parsing, auto-detection, session cache, and quarantine map.
  - [ ] Add provider-specific credential formatters for `brightdata`, `smartproxy`, `iproyal`, `kuaidaili`, `custom`.
  - [ ] Add `createProxyProvider(config)` factory.
  - [ ] Ensure all new classes reuse `parseProxyUrl`, `normalizeProxy`, `formatProxyUrl`, `getProxyAgent`.

- [ ] **Task 2: Update `src/proxy/index.js` exports**
  - [ ] Re-export `StaticProxyProvider`, `DynamicTunnelProvider`, `createProxyProvider`.
  - [ ] Keep existing `ProxyIpPool`, `globalProxyPool`, provider utilities.

- [ ] **Task 3: Integrate provider contract with `AbstractApiClient` (optional/minimal)**
  - [ ] Allow `proxyProvider` injection in `src/core/base-client.js` constructor.
  - [ ] Prefer `proxyProvider.getProxy({ accountId })` when available; fall back to `proxyPool`.
  - [ ] Preserve existing `proxy_exhausted` behavior.

- [ ] **Task 4: Update TypeScript declarations**
  - [ ] `types/proxy.d.ts`: add `ProxyProviderContract`, `StaticProxyOptions`, `DynamicTunnelOptions`, `ProviderPreset`, `ProxyRequestOptions`, class declarations, factory.
  - [ ] `types/index.d.ts`: ensure re-export is intact (line 769).
  - [ ] Zero `any`, zero `@ts-ignore`.

- [ ] **Task 5: ATDD test suite `tests/proxy/providers-tunnel.test.js`**
  - [ ] `StaticProxyProvider` sticky / round-robin / quarantine / delegation tests.
  - [ ] `DynamicTunnelProvider` auto-detection for each preset.
  - [ ] `DynamicTunnelProvider` per-request rotation (no `accountId`).
  - [ ] `DynamicTunnelProvider` sticky session with `vi.useFakeTimers()` and bucket rollover.
  - [ ] `rotateSession(accountId)` and `quarantine(proxy)` invalidation tests.
  - [ ] Provider credential format tests for BrightData, Smartproxy, IPRoyal, Kuaidaili, `custom`.
  - [ ] `getBrowserArgs`, `toPlaywrightProxy`, `getProxyAgent` no-direct-fallback tests.
  - [ ] `createProxyProvider` factory happy paths and error paths.

- [ ] **Task 6: Integration smoke tests**
  - [ ] Run `npx vitest run tests/proxy/providers-tunnel.test.js tests/proxy/proxy-pool.test.js tests/proxy/providers.test.js tests/core/account-pool.test.js tests/core/base-client-proxy.test.js`
  - [ ] All existing tests must remain green.

- [ ] **Task 7: Update this story file and sprint status**
  - [ ] Mark relevant subtasks done as implementation progresses.
  - [ ] Update `sprint-status.yaml` only if the status changes (currently `ready-for-dev`).

---

### ATDD Artifacts

- **Checklist:** `_bmad-output/test-artifacts/atdd-checklist-11-2-static-dynamic-residential-tunnel-proxy-providers.md`
- **Unit & Integration Tests:** `tests/proxy/providers-tunnel.test.js` (22 red-phase scaffold tests)

---

## Story Completion Status

- **Status:** ready-for-dev
- **Context engine analysis completed:** comprehensive developer guide re-created and verified against source material.
- **Web research completed:** BrightData, Smartproxy/Decodo, IPRoyal, Kuaidaili credential and session conventions documented.
- **Architecture compliance verified:** AD-3, AD-13, AD-14, AD-2, AD-8 mapped.
- **Previous story intelligence imported:** 11.1 implementation, review findings, test patterns, file states.
- **Warnings & potential pitfalls:** 12 specific items.
- **Decisions record:** 12 recorded decisions.
- **Tasks & subtasks:** aligned with AC-1 through AC-11.
- **Next phase:** implementation via `/bmad-dev-story` and ATDD via `/bmad-testarch-atdd 11.2`.
