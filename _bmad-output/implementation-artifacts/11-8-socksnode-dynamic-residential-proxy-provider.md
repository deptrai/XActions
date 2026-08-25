# Story 11.8 — SocksNode Dynamic Residential Proxy Provider

**Story ID:** 11.8  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** ready-for-dev  
**Owner:** DEV  
**Source:** `epics.md` Story 11.8, `ARCHITECTURE-SPINE.md` AD-3, AD-13, AD-14, `11-2-static-dynamic-residential-tunnel-proxy-providers.md`, current `src/proxy/**`, `types/proxy.d.ts`, `src/core/base-client.js`, SocksNode public docs (https://socksnode.com, 2026-08-24).

---

## Story

As a **Scale-Out Scraper & Network Engineer**,  
I want **first-class SocksNode residential and 4G/5G mobile proxy support inside the existing `DynamicTunnelProvider` preset system**,  
So that **XActions can route traffic through the SocksNode gateway (`premium.socksnode.com:9000`) using their public username-token grammar (`user-<baseUser>-country-<cc>-city-<city>...`) without hand-crafting proxy URLs, while still supporting sticky sessions for auth-required platforms and per-request rotation for no-auth platforms.**

---

## Acceptance Criteria

### AC-1: SocksNode preset in `DynamicTunnelProvider`
* **Given** a SocksNode gateway URL such as `http://user:pass@premium.socksnode.com:9000` or `socks5://user:pass@socksnode.gateway.example.com:1080`
* **When** `new DynamicTunnelProvider({ gatewayUrl })` is instantiated
* **Then** `#autoDetectProvider` identifies the host as `socksnode` when the SLD is `socksnode` and the TLD is `com` (or any `*.socksnode.com` hostname)
* **And** `PROVIDER_PRESETS` in `src/proxy/providers.js:27` includes the string `'socksnode'`
* **And** `ProviderPreset` in `types/proxy.d.ts:11` includes the literal `'socksnode'`
* **And** `SUPPORTED_PROXY_SCHEMES` in `src/proxy/providers.js:13` remains `['http', 'https', 'socks5']` — `socks5h` is **not** a valid input scheme and does not need to be added
* **And** an explicit `provider: 'socksnode'` is accepted even when the gateway hostname is not auto-detected
* **And** `provider: 'notreal'` or an unknown preset continues to throw `PlatformError` (`XACT_4001`, `invalid_args`)

### AC-2: SocksNode credential formatting
* **Given** a `DynamicTunnelProvider` with `provider === 'socksnode'`
* **When** `getProxy({ country, state, city, asn, sessionId, sid, sessionduration, lifetime, const })` is called
* **Then** `#formatCredentials` (around `src/proxy/providers.js:848-930`) builds a username using SocksNode's public grammar:
  - Base prefix: `user-<baseUser>` (reuse `#baseUsername` at `src/proxy/providers.js:745-755`; it already prefixes `user-` when the raw username does not start with `user-`, `brd-`, or `lum-`)
  - Append `-country-<cc>` if `country` is present (two-letter lowercase ISO code)
  - Append `-state-<state>` if `state` is present
  - Append `-city-<city>` if `city` is present (lowercased, whitespace removed)
  - Append `-asn-<asn>` if `asn` is present
  - Append `-session-<sessionId>` if a validated session ID is present
  - Append `-ttl-<lifetimeValue>` if a sticky lifetime is present
  - Append `-const` if `req.const === true`
* **And** the lifetime value is resolved in this priority order:
  1. `options.lifetime` (a string such as `"600"` or `"30m"`) → append `ttl-${options.lifetime}`
  2. `options.sessionduration` (a positive number in **minutes**) → append `ttl-${options.sessionduration * 60}`
  3. Neither → omit the `ttl` token entirely
* **And** the password remains the raw gateway password, unchanged
* **And** the final proxy URL is normalized by `normalizeProxy` and returned as a `NormalizedProxy`
* **And** tokens are omitted entirely when their value is empty, with no trailing delimiters

### AC-3: Sticky and rotating session behavior
* **Given** a `DynamicTunnelProvider` configured with `provider: 'socksnode'`
* **When** `getProxy({ accountId })` is called for an auth-required platform
* **Then** it generates a deterministic, provider-compatible session ID for the account using the existing `hashBase36` path (`src/proxy/providers.js:476-481`)
* **And** repeated calls within the same `sessionDurationMs` window return the **same** credentials and exit IP mapping
* **And** calling `rotateSession(accountId)` or `quarantine(proxy)` on the returned proxy invalidates the cached session and returns a new one
* **And** when no `accountId` is provided and `rotatePerRequest: true` (default), each `getProxy()` / `getNext()` call returns a fresh session tag, producing a fresh residential IP

### AC-4: Proxy health validation before return
* **Given** the SocksNode preset
* **When** `getProxy()` is called
* **Then** "health validation" is performed synchronously through the existing `DynamicTunnelProvider` pipeline:
  - Request options are resolved and sanitized by `#resolveRequestOptions`
  - A session ID is generated or validated by `#resolveSessionId`
  - Credentials are built by `#formatCredentials`
  - The result is passed through `normalizeProxy` and `formatProxyUrl` to guarantee a well-formed proxy URL
  - The generated URL is checked against the provider's quarantine map; if quarantined, the provider rotates the session once and tries again (existing behavior at `src/proxy/providers.js:979-1012`)
  - If a healthy session cannot be allocated, it throws `PlatformError` (`XACT_5030`, `proxy_exhausted`, `suggestedAction: 'wait'`, `retryAfterMs: standbyBackoffMs`)
* **And** `getProxy` itself remains synchronous to preserve the `ProxyProviderContract` used by `AbstractApiClient.resolveProxy` (`src/core/base-client.js:165-171`)
* **And** no network I/O is performed inside `getProxy`; real reachability is verified by the request pipeline in Stories 11.3/11.5/11.6 through retry + quarantine on 429/403

### AC-5: Integration with `ProxyIpPool`, `AbstractApiClient`, and Playwright
* **Given** any `NormalizedProxy` returned by the SocksNode preset
* **When** `toPlaywrightProxy(proxy)`, `getBrowserArgs(proxy)`, or `getProxyAgent(proxy, { client })` is called
* **Then** `toPlaywrightProxy` returns `{ server, username?, password? }` with credentials correctly split (reuses `ProxyIpPool.toPlaywrightProxy` / `normalizeProxy`)
* **And** `getBrowserArgs` returns at minimum the anti-leak flags:
  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `--proxy-server=<scheme://[host]:port>`
  - `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE <proxyHost>`
* **And** `getProxyAgent(proxy, { client: 'undici' | 'got' })` returns:
  - `undici.Socks5ProxyAgent` when `scheme === 'socks5'` — this agent performs remote DNS resolution, so `socks5://` input is sufficient; do **not** require or generate `socks5h://`
  - `undici.ProxyAgent` when `scheme === 'http' | 'https'`
  - a correctly formatted proxy URL string for `got-scraping`
* **And** `AbstractApiClient.resolveProxy()` continues to call `proxyProvider.getProxy({ accountId })` without any SocksNode-specific code

### AC-6: Tests pass with zero mocks
* **Given** the implementation and `tests/proxy/providers-tunnel.test.js`
* **When** running `npx vitest run tests/proxy/providers-tunnel.test.js`
* **Then** all new SocksNode tests pass alongside the existing provider tests
* **And** the new tests cover:
  - auto-detection of `premium.socksnode.com:9000` (HTTP) and `socks5://user:pass@socksnode.com:1080`
  - explicit `provider: 'socksnode'` with a custom gateway hostname
  - username token formatting for `country`, `state`, `city`, `asn`, `session`, `ttl`, and `const`
  - `lifetime` string and `sessionduration` (minutes) both mapping to `ttl`
  - sticky session determinism and rotation for the same `accountId`
  - quarantine, session invalidation, and standby backoff
  - `getBrowserArgs` and `getProxyAgent` (HTTP and SOCKS5)
  - `PlatformError` for unknown preset and missing gateway

---

## Previous Story Intelligence (from 11.2)

### Core implementation patterns to preserve

| Pattern | Source in 11.2 / current code | Why it matters for 11.8 |
|---|---|---|
| `PROVIDER_PRESETS` is a `Set` | `src/proxy/providers.js:27` | Add `'socksnode'`; do not replace existing entries. |
| `ProviderPreset` union type | `types/proxy.d.ts:11` | Add `'socksnode'` to keep TS strict and in sync with runtime. |
| `#autoDetectProvider` maps SLD/TLD to preset | `src/proxy/providers.js:609-633` | Add `sld === 'socksnode' && tld === 'com'`. |
| `targetSessionLength(provider)` | `src/proxy/providers.js:448-452` | Add `socksnode` returning `8` (SocksNode supports sticky sessions; short tags keep usernames readable). |
| `isValidSessionId` / `PROVIDER_SID_LIMITS` | `src/proxy/providers.js:30-35, 460-468` | Add `socksnode: { max: 20, regex: /^[a-zA-Z0-9]+$/ }`. Public docs do not enforce an exact length; keep alphanumeric. |
| `#formatCredentials` branches | `src/proxy/providers.js:848-930` | Add a `socksnode` branch. Password stays raw; all targeting/session tokens live in `username`. |
| `DynamicTunnelProvider.getProxy` | `src/proxy/providers.js:937-1023` | Keep synchronous. It already handles quarantine/rotation/standby. |
| `getProxyAgent` factory | `src/proxy/providers.js:300-331` | Reuse for HTTP/HTTPS/SOCKS5; no new dependency. |
| `getBrowserArgs` | `src/proxy/providers.js:1066-1085`, `src/proxy/proxy-pool.js:309-329` | Reuse to ensure anti-leak flags. |

### 11.2 code-review findings that directly shape 11.8

1. **Quarantine key must include credentials.** For a shared gateway like `premium.socksnode.com:9000`, quarantining the bare host would disable the whole provider. Quarantine must target the exact `username:password@host:port` string. `DynamicTunnelProvider` already does this via `formatProxyUrl(normalized)`. [`11-2` review finding]
2. **Never return `null` and continue unproxied.** `AbstractApiClient.resolveProxy` throws `proxy_exhausted` when `getProxy` cannot allocate. The SocksNode preset must do the same. [`11-2` review finding]
3. **IPv6 bracketing is mandatory.** `formatProxyUrl` already wraps IPv6 hosts. Build credentials through the existing helpers, not by manual string concatenation. [`11-2` review finding]
4. **Credentials in `AccountPool.getAccount` are redacted.** If a proxy is stored on an `AccountRecord`, the returned view must strip `username` and `password`. `DynamicTunnelProvider.toPlaywrightProxy` does not leak the raw password. [`11-2` review finding]
5. **Session time buckets depend on `Date.now()`.** Document the limitation; do not use `process.hrtime` in this story. [`11-2` deferred finding]
6. **No transaction between proxy selection and request use.** In multi-worker usage the session could be quarantined between `getProxy` and the actual HTTP call. This is an accepted gap solved by the request pipeline in Stories 11.3 / 11.5 / 11.7. [`11-2` deferred finding]

### 11.2 test approach to mirror

- Real in-memory providers; no `vi.fn()` or stubbed `undici`.
- Use `beforeEach` to reset provider state.
- For time-based behavior, use `vi.useFakeTimers()` and `vi.advanceTimersByTime(...)`.
- For invalid input, assert `PlatformError` with `code === 'XACT_4001'`.
- For agent output, assert `instanceof undici.ProxyAgent` / `undici.Socks5ProxyAgent` or exact `proxyUrl` string.

---

## Architecture Compliance

### AD-3 — Centralized Proxy IP Pool with Auto-Quarantine, Anti-Leak & Proxy Strategy by Auth Mode
* **Binds:** `src/proxy/**`, all network interceptors
* **Relevant rules:**
  1. Every browser session must enable `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` and remote DNS resolution.
  2. Auth-required platforms use sticky IP; no-auth platforms use rotating residential IP.
  3. `ProxyIpPool` supports `getStickyProxy(accountId)` and `getNext()`.
  4. 429/403 → quarantine 5 minutes, retry 3 times with exponential backoff.
  5. 100% proxy quarantined → Standby Backoff 30s.
  6. SOCKS5 requires `undici.Socks5ProxyAgent`; no fallback to direct connection.

**11.8 compliance:**
- The SocksNode preset uses `DynamicTunnelProvider`'s existing sticky/rotation logic and `getBrowserArgs` / `getProxyAgent` to satisfy AD-3.
- For SOCKS5 gateways the normalized scheme is `socks5`; `undici.Socks5ProxyAgent` performs remote DNS resolution. The `--host-resolver-rules` in `getBrowserArgs` ensures Chrome does not leak local DNS.

### AD-13 — Adaptive Infrastructure-Aware Dynamic Rate Limiting & Account Protection Governor
* **Binds:** `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js`, `src/scrapers/**`
* **Relevant rules:**
  1. Inputs: `healthyProxyCount`, `totalProxyCount`, `accountVelocity`, `redisConsumerLag`, `PlatformRateLimit`.
  2. `maxReqPerSecond = healthyProxyCount × baseReqPerSecondPerProxy × throttleFactor`.
  3. Account token bucket; challenge/Captcha → hibernation 15–30 minutes.
  4. `AccountPool.getNextAvailable(platform)` rotates accounts.
  5. Consumer lag > 10,000 → -75% throughput.
  6. No direct IP leak.

**11.8 compliance:**
- `DynamicTunnelProvider.healthyCount` / `totalCount` / `isAllQuarantined()` remain accurate after adding the SocksNode preset, so `AdaptiveRateGovernor` can compute throughput and pause when the healthy ratio is low.
- Auth-required usage triggers sticky session allocation per `accountId`; on `429/403` the session is quarantined and the request pipeline in Story 11.3/11.6 invokes `AccountPool.markUnavailable` / `governor.hibernateAccount`.

### AD-14 — Operational Status & Error Envelope for Consumers
* **Binds:** `src/mcp/**`, `src/api/**`, `src/cli/**`, `src/core/error-envelope.js`, `src/core/status-api.js`
* **Relevant rules:**
  1. Error envelope `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
  2. `type` and `suggestedAction` enums.
  3. Governor status API.
  4. Legacy CLI mapping.

**11.8 compliance:**
- All provider failures throw `PlatformError` with `code`, `type`, `retryAfterMs`, and `suggestedAction`.
- Invalid config → `invalid_args` / `XACT_4001` / `suggestedAction: 'use_x_actions_list'`.
- Pool/gateway exhausted → `proxy_exhausted` / `XACT_5030` / `suggestedAction: 'wait'` / `retryAfterMs: 30000`.
- The `DynamicTunnelProvider` status getters are sufficient for `GovernorStatus` without changing `src/core/status-api.js`.

---

## Technical Requirements

### Files to modify

| File | Why it changes |
|---|---|
| `src/proxy/providers.js` | Add `socksnode` to `PROVIDER_PRESETS`, `PROVIDER_SID_LIMITS`, `#autoDetectProvider`, `targetSessionLength`, and `#formatCredentials`. |
| `types/proxy.d.ts` | Add `'socksnode'` to `ProviderPreset` union. |
| `src/proxy/providers.d.ts` | Generated/loose declarations; no change required unless the generator re-runs. |
| `tests/proxy/providers-tunnel.test.js` | Add a new `describe` block for SocksNode AC coverage. |
| `tests/proxy/providers.test.js` | If `ProviderPreset` or `PROVIDER_PRESETS` is tested there, update the positive list. |
| `src/proxy/index.js` | No change needed unless a new standalone class is created (not recommended). |

### Files that must be read but NOT modified (unless a regression is found)

- `src/proxy/proxy-pool.js` — understand `getNext`, `getStickyProxy`, `quarantine`, `getBrowserArgs`, `getProxyAgent`.
- `src/core/base-client.js` — `resolveProxy` is synchronous; do not break it.
- `src/core/account-pool.js` — `setAssignedProxy` / `getAccount` redaction rules.
- `src/core/adaptive-governor.js` — how `healthyCount` / `totalCount` are consumed.

### No new package dependencies expected

- `undici` (v7.29.0) already provides `ProxyAgent` and `Socks5ProxyAgent`.
- `socks-proxy-agent` exists in `package.json` for legacy paths; do **not** use it in this story. The provider factory must continue to use `undici` agents.

### SocksNode public docs summary (fetched 2026-08-24)

- **Gateway:** `premium.socksnode.com:9000` (HTTP example on the homepage).
- **Protocols:** HTTP, HTTPS, SOCKS5.
- **Auth:** username + password, standard proxy Basic auth.
- **Grammar:** everything (country, city, ASN, session lifetime) is passed inline in the username.
- **Homepage example:** `curl -x premium.socksnode.com:9000 -U "user-acme-country-us-city-losangeles:..." https://api.ipify.org?format=json`
- **Implied proxy URL:** `http://user-acme-country-us-city-losangeles:password@premium.socksnode.com:9000`
- **Sticky sessions:** up to 24h.
- **Rotation:** per-request when no session token is supplied.

---

## Latest Tech Information

- **Provider grammar similarity:** SocksNode's username-token grammar is functionally similar to BrightData and Smartproxy, where targeting/session parameters are hyphen-appended to the username. This means the `DynamicTunnelProvider` preset model is the correct extension point.
- **Token uncertainty:** The public homepage only shows `user-`, `country-`, and `city-` tokens. Additional tokens (`state-`, `asn-`, `session-`, `ttl-`, `const`) are inferred from the documentation line "Country, state, city, a specific ISP by ASN, or the device OS — set it in the dashboard or pass it inline in the username." The implementation must omit any token whose value is empty, and a `template` fallback must remain available for private/custom SocksNode gateways with a different grammar.
- **Scheme support:** The same gateway can speak HTTP, HTTPS, and SOCKS5. The `scheme` is taken from the gateway URL; `getProxyAgent` dispatches to the correct `undici` agent. For SOCKS5 the scheme is `socks5` (not `socks5h`); `undici.Socks5ProxyAgent` resolves DNS through the proxy, and `getBrowserArgs` adds `--host-resolver-rules` to keep Chromium from making direct DNS lookups.
- **Port:** The homepage example uses `9000`. Residential/SOCKS5 ports may differ per account; always use the port from the supplied `gatewayUrl`.
- **Sticky lifetime:** Docs say sticky sessions up to 24h. Use `options.lifetime` (free-form string) or `options.sessionduration` (minutes) to produce a `ttl-` token in seconds. If neither is set, omit `ttl-` and rely on `sessionDurationMs` for the local cache window.

---

## Implementation Sketch

### `src/proxy/providers.js` changes

Add to `PROVIDER_PRESETS`:
```js
const PROVIDER_PRESETS = new Set(['brightdata', 'smartproxy', 'iproyal', 'kuaidaili', 'socksnode', 'custom']);
```

Add to `PROVIDER_SID_LIMITS`:
```js
socksnode: { max: 20, regex: /^[a-zA-Z0-9]+$/ },
```

Add to `targetSessionLength`:
```js
if (provider === 'socksnode') return 8;
```

Add to `#autoDetectProvider` (after the `kuaidaili` branch, before `return 'custom'`):
```js
if (sld === 'socksnode' && tld === 'com') {
  return 'socksnode';
}
```

Add a `socksnode` branch in `#formatCredentials` (after `kuaidaili` or before `custom`):
```js
if (preset === 'socksnode') {
  const baseUser = this.#baseUsername(rawUser);
  const parts = [baseUser];
  if (req.country) parts.push(`country-${req.country}`);
  if (req.state) parts.push(`state-${req.state}`);
  if (req.city) parts.push(`city-${req.city}`);
  if (req.asn) parts.push(`asn-${req.asn}`);

  let lifetimeValue = '';
  if (req.lifetime) {
    lifetimeValue = String(req.lifetime);
  } else if (typeof req.sessionduration === 'number' && req.sessionduration > 0) {
    lifetimeValue = String(req.sessionduration * 60);
  }
  if (lifetimeValue) parts.push(`ttl-${lifetimeValue}`);

  const sid = req.sid || req.sessionId;
  if (sid) parts.push(`session-${sid}`);

  if (req.const) parts.push('const');
  return { username: parts.filter((p) => p !== '').join('-'), password: rawPass };
}
```

### `types/proxy.d.ts` changes

```ts
export type ProviderPreset = 'brightdata' | 'smartproxy' | 'iproyal' | 'kuaidaili' | 'socksnode' | 'custom';
```

---

## Testing Requirements

- Add a new `describe('SocksNode Dynamic Tunnel Provider')` block to `tests/proxy/providers-tunnel.test.js`.
- Do **not** make real outbound network calls in unit tests.
- Use in-memory provider assertions, fake timers for session windows, and `formatProxyUrl` / `normalizeProxy` for key/quarantine checks.
- Include at least one test that verifies `getBrowserArgs` and `getProxyAgent` return non-null, correct values for both `http` and `socks5` SocksNode URLs.
- Include tests for invalid input (`PlatformError` `XACT_4001`) and exhausted/quarantined session (`PlatformError` `XACT_5030`).
- Run the proxy test suite before committing:
  ```bash
  npx vitest run tests/proxy/providers-tunnel.test.js
  npx vitest run tests/proxy/providers.test.js
  npx vitest run tests/proxy/proxy-pool.test.js
  ```
- Then run the full suite: `npx vitest run`.

---

## Dev Notes

- **Epic 11.8 mentions `SocksNodeProvider`.** The existing architecture does not have a separate class per provider; it has a `provider` preset string inside `DynamicTunnelProvider`. Implement 11.8 as a `socksnode` preset. If the product team later wants a standalone `SocksNodeProvider` wrapper, it can be a thin module that instantiates `new DynamicTunnelProvider({ provider: 'socksnode', ... })` and delegates all calls.
- **Health check nuance.** The epic AC says "kiểm tra tính khả dụng của proxy (health check) trước khi trả về." The existing `getProxy` is synchronous and cannot perform network I/O without changing the `ProxyProviderContract` and every caller (`AbstractApiClient`, `ProxyIpPool`, tests). Therefore the health check in this story is defined as the existing synchronous validation pipeline (option sanitization → session ID validation → credential formatting → URL normalization → quarantine check → one rotation attempt → `proxy_exhausted` if still quarantined). Real network reachability is verified by the request pipeline's retry + quarantine logic in Stories 11.3/11.5/11.6.
- **Session ID source.** `#resolveSessionId` resolves `req.sessionId` first (or `req.sid` as a fallback for `kuaidaili`); for `socksnode` use `req.sessionId || req.sid` and pass the validated result into `#formatCredentials` as `sessionId`.
- **Session length.** SocksNode docs do not specify a max session tag length. Use the same 8-char default as IPRoyal to keep usernames compact and URL-safe. Allow user-supplied `sessionId` up to 20 chars if it passes the alphanumeric regex.
- **City normalization.** City names must be lowercased and have whitespace removed before being appended, matching the `#resolveRequestOptions` behavior at `src/proxy/providers.js:768-770`.
- **Password unchanged.** Unlike IPRoyal, which appends targeting tokens to the password, SocksNode keeps the password as the raw gateway password and puts all targeting in the username.
- **No `socks5h` support.** `SUPPORTED_PROXY_SCHEMES` only contains `http`, `https`, `socks5`. Users must provide a `socks5://` gateway URL. Remote DNS is achieved by `undici.Socks5ProxyAgent` (for Node HTTP) and `--host-resolver-rules` (for Chromium). Do not attempt to add `socks5h` to the supported scheme list or to the normalized proxy URL.

---

## Story Completion Status

**Status:** ready-for-dev

Ultimate context engine analysis completed — comprehensive developer guide created.
