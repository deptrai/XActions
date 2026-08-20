---
story: "11.3 — 429/403 Auto-Quarantine, Standby Backoff & Exponential Replay Interceptor"
reviewer: "BMad Code Reviewer"
date: 2026-08-21
status: "CHANGES_REQUESTED"
---

# Story 11.3 Code Review

## Files Reviewed

- `src/core/base-client.js` (`AbstractApiClient`)
- `tests/core/base-client-request.test.js`
- `src/proxy/providers.js`
- `src/proxy/proxy-pool.js`
- `src/core/account-pool.js`
- `src/core/adaptive-governor.js`
- `src/core/error-envelope.js`

## Test Execution

```bash
npx vitest run tests/core/base-client-request.test.js
```

**Result:** 11 passed, 0 failed, 1 test file passed.

## Positive Findings

1. **Request pipeline implements the AC-1..AC-7 flow** — governor pre-check, proxy resolution, quarantine, exponential backoff with jitter, account rotation, standby backoff.
2. **Error envelope uses `PlatformError` consistently** with `code`, `type`, `suggestedAction`, `retryAfterMs`, `accountId`, `platform`.
3. **Proxy provider contract is respected** — `getProxy`, `getStickyProxy`, `getNext`, `quarantine`, `isAllQuarantined`, `getProxyAgent` are used correctly.
4. **No direct connection fallback** — `resolveProxy` throws `XACT_5030` when proxy is missing/exhausted.
5. **Retry-After header parsing** is correct and clamped to `maxBackoffMs`.
6. **Impact radius is large** — 500+ nodes across 234 files; this is a core module and the implementation is consistent with the call graph.

## Required Changes

### 1. Tests use `vi.fn()` mocks — violates project "No mocks, stubs, or fakes" rule

**Location:** `tests/core/base-client-request.test.js` lines 44, 70, 97, 139, 235, 289, 317, 334.

**Problem:** The test file replaces the real `httpClient` with `vi.fn()` mock functions. The project `AGENTS.md` and `CLAUDE.md` state:

> Never mock, stub, or fake anything. Real implementations only.

The Story 11.3 artifact AC-11 also says:

> Tests pass with zero mocks.

**Fix:** Replace `mockHttpClient` with a small local HTTP server (e.g. `node:http.createServer`) or `undici` mock socket, so the request pipeline actually dispatches through `undici.ProxyAgent` or a real fetch. Keep in-memory `ProxyIpPool`, `AccountPool`, and `AdaptiveRateGovernor` — they are not mocks, they are real implementations.

### 2. No-auth platforms do not record requests

**Location:** `src/core/base-client.js` lines 304-311.

**Problem:** The success path only records requests in `accountPool` and `governor` when `currentAccountId` is set. For no-auth platforms, `currentAccountId` is undefined, so per-platform velocity is never tracked. The Story 11.3 technical requirements (line 253-256) specify:

> No-auth: track under a synthetic per-platform no-auth account key.

**Fix:** In the success branch, add an `else` for no-auth:

```js
if (this.platform) {
  const key = this.requiresAuth && currentAccountId ? currentAccountId : 'noauth';
  if (this.accountPool) this.accountPool.recordRequest(key, this.platform);
  if (this.governor) this.governor.recordRequest(key, this.platform);
}
```

Ensure `accountPool.recordRequest('noauth', platform)` does not crash on a missing account (or add `noauth` registration when the platform is no-auth).

### 3. Test does not cover `DynamicTunnelProvider`

**Problem:** All tests use `StaticProxyProvider`. The 11.3 ACs and the 11.2 review findings emphasize that `DynamicTunnelProvider` quarantine keys are session URLs, not the gateway. Without a test, a regression where the gateway is quarantined is not caught.

**Fix:** Add at least one test with `DynamicTunnelProvider` and a fake gateway URL.

### 4. `handleError` default implementation is a generic `INTERNAL` throw

**Location:** `src/core/base-client.js` lines 412-420.

**Problem:** The base `handleError` throws `ErrorTypes.INTERNAL`. This is acceptable for subclasses to override, but the `PlatformError` is missing a `code` field. Consider defaulting to `XACT_5000` to keep consistency.

**Fix (optional):**

```js
handleError(response, platform) {
  throw new PlatformError({
    type: ErrorTypes.INTERNAL,
    code: 'XACT_5000',
    message: 'Request failed',
    platform,
    suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
    details: response,
  });
}
```

## Minor / Style Notes

- Test descriptions label the suite `(ATDD Red Phase)`. After 11 tests pass, this label is misleading — remove or rename to `(ATDD Green Phase)` when fixes land.
- The `request()` outer `while` loop uses `accountRotationCount++` and a final `throw` that is unreachable when `PlatformError` is thrown from inside. This is harmless but the final fallback throw could be reached if `maxAccountRotations` is 0 and all proxies fail without throwing. Confirm via mutation test if possible.

## Recommendation

**Do not mark Story 11.3 as `done` until required changes 1 and 2 are addressed.** Change 3 is strongly recommended. Change 4 is optional.

Once the test file is rewritten without mocks and no-auth request tracking is added, re-run:

```bash
npx vitest run tests/core/base-client-request.test.js
npm test
```

Then set `sprint-status.yaml`:

```yaml
  11-3-429-403-auto-quarantine-exponential-backoff-replay-interceptor: done
```
