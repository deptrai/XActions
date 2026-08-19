---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-19T21:56:00.000Z'
storyId: '11.1'
storyKey: '11-1-proxyippool-accountpool-sticky-round-robin'
storyFile: '_bmad-output/implementation-artifacts/11-1-proxyippool-accountpool-sticky-round-robin.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-1-proxyippool-accountpool-sticky-round-robin.md'
generatedTestFiles:
  - 'tests/proxy/proxy-pool.test.js'
  - 'tests/core/account-pool.test.js'
---

## TDD Green Phase (Completed)

🟢 **All acceptance test suites passing 100% (27/27)**
- `tests/proxy/proxy-pool.test.js` (ProxyIpPool Acceptance Tests - 19 passing)
- `tests/core/account-pool.test.js` (AccountPool Acceptance Tests - 8 passing)

## Acceptance Criteria Coverage

- [x] **AC-1: Proxy input normalization** (`tests/proxy/proxy-pool.test.js`)
  - Canonical object `{ scheme, host, port, username, password, server }`
  - Support `http`, `https`, `socks5`
  - Throws `PlatformError` (`XACT_4001`) on invalid strings
- [x] **AC-2: Anti-leak browser configuration** (`tests/proxy/proxy-pool.test.js`)
  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `--proxy-server=<server>`
  - `toPlaywrightProxy` helper `{ server, username, password }`
- [x] **AC-3: Sticky proxy per account** (`tests/proxy/proxy-pool.test.js`)
  - Deterministic hash-based binding
  - Re-binding on quarantine
- [x] **AC-4: Round-robin proxy for no-auth platforms** (`tests/proxy/proxy-pool.test.js`)
  - Healthy proxy rotation & quarantine skipping
  - `null` return on exhausted pool
- [x] **AC-5: Quarantine and refresh** (`tests/proxy/proxy-pool.test.js`)
  - Default 5-minute quarantine duration
  - Sticky binding cleanup
  - `isAllQuarantined()` & `pruneExpiredQuarantines()`
- [x] **AC-6: Proxy agent factory** (`tests/proxy/proxy-pool.test.js`)
  - `undici.ProxyAgent` / `undici.Socks5ProxyAgent`
  - `got-scraping` proxyUrl
  - No fallback to direct connection
- [x] **AC-7: Account registration and storage** (`tests/core/account-pool.test.js`)
  - Register platform accounts & metadata
- [x] **AC-8: Account round-robin and hibernation awareness** (`tests/core/account-pool.test.js`)
  - `getNextAvailable(platform)` & `hasAvailable(platform)`
- [x] **AC-9: Account unavailability and velocity** (`tests/core/account-pool.test.js`)
  - `markUnavailable` with duration
  - `getAccountVelocity` with 60s sliding window
  - `markAvailable` early wake
- [x] **AC-10: Health counts** (`tests/proxy/proxy-pool.test.js`)
  - `healthyCount` & `totalCount` accuracy
- [x] **AC-11: Integration with AdaptiveRateGovernor** (`tests/core/account-pool.test.js`)
  - Respects governor cooldown and limits
- [x] **AC-12: Tests pass in memory without mocks** (`tests/proxy/proxy-pool.test.js`, `tests/core/account-pool.test.js`)

## Next Steps (Task-by-Task Activation)

During implementation via `/bmad-dev-story`:
1. Remove `test.skip()` from the test block for the task being worked on.
2. Run test: `npx vitest run tests/proxy/proxy-pool.test.js tests/core/account-pool.test.js`
3. Verify the test fails (RED), implement code, verify it passes (GREEN).
4. Commit passing code and tests.
