# Triage Results: Story 11.1 (Round 2)

1. **id**: 1
   **source**: blind
   **title**: Include password in `ProxyIpPool.#key` for session-based residential proxies
   **detail**: Include password alongside username in `#key` so dynamic residential proxies rotating session IDs via password do not collide.
   **location**: `src/proxy/proxy-pool.js:82`
   **severity**: medium
   **route**: patch

2. **id**: 2
   **source**: blind
   **title**: IPv6 host formatting in `formatProxyUrl`
   **detail**: Wrap raw IPv6 host strings in square brackets per RFC 3986.
   **location**: `src/proxy/providers.js:140`
   **severity**: low
   **route**: patch

3. **id**: 3
   **source**: blind+edge
   **title**: Always normalize proxy in `toPlaywrightProxy`
   **detail**: Call `normalizeProxy(proxy)` unconditionally in `toPlaywrightProxy` to catch unnormalized object inputs.
   **location**: `src/proxy/proxy-pool.js:188`
   **severity**: low
   **route**: patch

4. **id**: 4
   **source**: edge
   **title**: Non-string accountId guard in `getStickyProxy`
   **detail**: Safely cast non-string accountId in `#hashAccount` to avoid TypeError.
   **location**: `src/proxy/proxy-pool.js:138`
   **severity**: low
   **route**: patch

5. **id**: 5
   **source**: edge
   **title**: Preserve existing account state in `registerAccounts`
   **detail**: Merge existing account metadata (`assignedProxy`, `hibernatingUntil`) when re-registering an account.
   **location**: `src/core/account-pool.js:51`
   **severity**: low
   **route**: patch

6. **id**: 6
   **source**: auditor+blind
   **title**: Dynamically calculate velocity in `AccountPool.getAccount`
   **detail**: `getAccount(accountId)` returns live velocity via `getAccountVelocity(accountId)`.
   **location**: `src/core/account-pool.js:200`
   **severity**: low
   **route**: patch

7. **id**: 7
   **source**: blind
   **title**: Update TypeScript declaration for `getBrowserArgs`
   **detail**: Allow `string | NormalizedProxy | null` in `types/proxy.d.ts`.
   **location**: `types/proxy.d.ts:47`
   **severity**: low
   **route**: patch
