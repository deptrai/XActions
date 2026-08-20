# Triage Results: Story 11.1

1. **id**: 1
   **source**: blind+auditor+edge
   **title**: `getBrowserArgs` drops `--proxy-server` when given string URL
   **detail**: `ProxyIpPool.getBrowserArgs` directly reads `proxy?.server` without normalization. String inputs cause `--proxy-server` to be omitted, leaking real client IP.
   **location**: `src/proxy/proxy-pool.js:207`
   **severity**: high
   **route**: patch

2. **id**: 2
   **source**: blind+auditor
   **title**: `AccountPool.markAvailable` desyncs with `AdaptiveRateGovernor`
   **detail**: Waking an account via `markAvailable` clears internal unavailable set but fails to un-hibernate in the governor, leaving the account blocked.
   **location**: `src/core/account-pool.js:96`
   **severity**: medium
   **route**: patch

3. **id**: 3
   **source**: blind+auditor+edge
   **title**: SOCKS5 support in `getProxyAgent` for `undici` / `socks-proxy-agent`
   **detail**: `undici.ProxyAgent` only supports HTTP/HTTPS. SOCKS5 proxy strings throw runtime errors when client is `undici` instead of using `SocksProxyAgent` or proper handling.
   **location**: `src/proxy/providers.js:170`
   **severity**: medium
   **route**: patch

4. **id**: 4
   **source**: blind
   **title**: AccountPool lacks platform namespacing for account IDs
   **detail**: `#accountRecords` and `#unavailableAccounts` key on raw `accountId`, causing collisions across platforms for common IDs (e.g. `admin`, `bot1`).
   **location**: `src/core/account-pool.js:51`
   **severity**: medium
   **route**: patch

5. **id**: 5
   **source**: blind
   **title**: Residential rotating proxy collision in `ProxyIpPool.#key`
   **detail**: `#key` only uses `host:port` ignoring `username`, causing multiple rotating sessions on the same gateway to be quarantined together.
   **location**: `src/proxy/proxy-pool.js:82`
   **severity**: medium
   **route**: patch

6. **id**: 6
   **source**: edge
   **title**: Edge-case guards in proxy parsing and options handling
   **detail**: Handle URIError on malformed percent-encoding, NaN ports, null options in `getProxyAgent`, and null options in `registerAccounts`.
   **location**: `src/proxy/providers.js:63`
   **severity**: low
   **route**: patch

7. **id**: 7
   **source**: blind
   **title**: Missing TypeScript declarations for `AccountPool`
   **detail**: `AccountPool`, `AccountRecord`, and its methods are not declared in `types/proxy.d.ts` or `types/index.d.ts`.
   **location**: `types/proxy.d.ts`
   **severity**: low
   **route**: patch

8. **id**: 8
   **source**: blind+auditor
   **title**: Unit test hardening for velocity, SOCKS5 agent, and invalid schemes
   **detail**: Strengthen tests for sliding window velocity tracking, SOCKS5 proxy with undici, and remove bare try/catches in tests.
   **location**: `tests/proxy/proxy-pool.test.js` & `tests/core/account-pool.test.js`
   **severity**: low
   **route**: patch
