---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: 2026-08-20T01:15:30+07:00
storyId: '11.2'
storyKey: '11-2-static-dynamic-residential-tunnel-proxy-providers'
storyFile: '_bmad-output/implementation-artifacts/11-2-static-dynamic-residential-tunnel-proxy-providers.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-2-static-dynamic-residential-tunnel-proxy-providers.md'
generatedTestFiles:
  - tests/proxy/providers-tunnel.test.js
---

# ATDD Checklist: Story 11.2 — Static & Dynamic Residential Tunnel Proxy Providers

## TDD Red Phase (Current)

✅ **Red-phase test scaffolds generated**
- **Test File:** `tests/proxy/providers-tunnel.test.js`
- **Total Tests:** 22 unit & integration tests (all scaffolded with `test.skip()`)
- **Status:** TDD RED Phase Verified (Tests assert real target behaviors and will fail if unskipped before implementation)

## Acceptance Criteria Coverage

| Criterion | Target Behavior | Test Scenario in `providers-tunnel.test.js` |
|---|---|---|
| **AC-1** | `StaticProxyProvider` contract & wrap `ProxyIpPool` | `should instantiate with a list of proxy strings and wrap an internal ProxyIpPool`<br>`should accept an existing ProxyIpPool instance in options`<br>`should return sticky proxy for accountId and round-robin when accountId is omitted`<br>`should provide getStickyProxy, getNext, and quarantine methods adhering to contract`<br>`should generate Playwright proxy config, agents, and browser launch args` |
| **AC-2** | Gateway URL parsing & provider auto-detection | `should parse gateway URL and auto-detect provider presets from hostname`<br>`should allow explicit provider override regardless of gateway hostname`<br>`should throw PlatformError XACT_4001 on missing or invalid gatewayUrl` |
| **AC-3** | Per-request residential IP rotation | `should generate unique per-request session tag and credentials on each getProxy() call`<br>`should provide getNext() as an alias for per-request rotation` |
| **AC-4** | Sticky session per account & time-bucket expiry | `should maintain deterministic session credentials for the same accountId within session window`<br>`should automatically roll over to a new session tag when sessionDurationMs elapses`<br>`should immediately invalidate session tag on rotateSession(accountId) or quarantine(proxy)` |
| **AC-5** | Geo-targeting presets & custom formatting | `should format BrightData username with country, city, and session correctly`<br>`should format Smartproxy and IPRoyal with underscore delimited tags`<br>`should format Kuaidaili with user and session tags`<br>`should render custom template pattern string accurately`<br>`should cleanly omit optional geo segments without creating dangling delimiters` |
| **AC-6** | Unified provider factory (`createProxyProvider`) | `should instantiate DynamicTunnelProvider when type is dynamic or gatewayUrl is provided`<br>`should instantiate StaticProxyProvider when type is static or proxies list is provided`<br>`should throw PlatformError XACT_4001 on unknown provider type or invalid configuration` |
| **AC-7** | Anti-leak browser launch args & agents | `should create valid undici ProxyAgent / Socks5ProxyAgent and anti-leak Chromium flags` |
| **AC-8** | TypeScript strict typings | Verified via `types/proxy.d.ts` & `types/index.d.ts` definitions |

---

## Next Steps (Task-by-Task Implementation & Green Phase)

During implementation with `/bmad-dev-story`:

1. **Task 1 (DynamicTunnelProvider & Presets):** Unskip AC-2, AC-3, AC-4, AC-5 tests in `tests/proxy/providers-tunnel.test.js` → implement logic in `src/proxy/providers.js` → verify tests turn green.
2. **Task 2 (StaticProxyProvider):** Unskip AC-1 tests → implement `StaticProxyProvider` wrapping `ProxyIpPool` → verify tests turn green.
3. **Task 3 (Unified Factory & Exports):** Unskip AC-6 tests → implement `createProxyProvider` and export classes in `src/proxy/index.js` → verify tests turn green.
4. **Task 4 (Anti-Leak & Types):** Unskip AC-7 tests → verify browser args and undici agent resolution → update `types/proxy.d.ts` and `types/index.d.ts`.
5. Run full test suite: `npx vitest run tests/proxy/` (expect 100% GREEN, zero mocks).
