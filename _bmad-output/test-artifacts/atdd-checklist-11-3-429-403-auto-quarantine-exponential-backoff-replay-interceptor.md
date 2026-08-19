---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: 2026-08-20T02:55:20+07:00
storyId: '11.3'
storyKey: '11-3-429-403-auto-quarantine-exponential-backoff-replay-interceptor'
storyFile: '_bmad-output/implementation-artifacts/11-3-429-403-auto-quarantine-exponential-backoff-replay-interceptor.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-3-429-403-auto-quarantine-exponential-backoff-replay-interceptor.md'
generatedTestFiles:
  - tests/core/base-client-request.test.js
---

# ATDD Checklist: Story 11.3 — 429/403 Auto-Quarantine, Standby Backoff & Exponential Replay Interceptor

## TDD Red Phase (Current)

✅ **Red-phase test scaffolds generated**
- **Test File:** `tests/core/base-client-request.test.js`
- **Total Tests:** 11 unit & contract tests (all scaffolded with `test.skip()`)
- **Status:** TDD RED Phase Verified (Asserts concrete expected request pipeline behaviors; will fail until feature is implemented)

## Acceptance Criteria Coverage

| Criterion | Target Behavior | Test Scenario in `base-client-request.test.js` |
|---|---|---|
| **AC-1 & AC-2** | 429/403 Detection & Auto-Quarantine | `should auto-quarantine proxy on HTTP 429 response and retry with next healthy proxy`<br>`should auto-quarantine proxy on HTTP 403 bot challenge response` |
| **AC-3** | No-Auth Platforms: Rotation & Exponential Replay | `should replay up to maxProxyRetries with exponential backoff delays`<br>`should stop retrying immediately and throw XACT_5030 when all proxies are quarantined` |
| **AC-4** | Auth-Required Platforms: Sticky Proxy & Account Rotation | `should attempt new sticky proxy first, then rotate account on repeated 429s` |
| **AC-5** | Standby Backoff on Full Pool Exhaustion | `should throw XACT_5030 with standbyBackoffMs and mark account unavailable on full pool quarantine` |
| **AC-6** | `Retry-After` Header Parsing & Clamping | `should parse Retry-After header in seconds and use it for backoff delay` |
| **AC-7** | AdaptiveRateGovernor Integration | `should block requests from hibernating accounts via governor check`<br>`should record successful requests in both governor and accountPool` |
| **AC-8 & AC-9** | Pluggable Transport & No Direct Fallback | `should pass correct proxy agent to httpClient without direct fallback`<br>`should throw proxy_exhausted when proxyProvider is missing and proxy is required` |
| **AC-10** | TypeScript Type Declarations | Verified through strict type declarations in `types/core.d.ts` & `types/proxy.d.ts` |

---

## Next Steps (Task-by-Task Implementation & Green Phase)

During implementation with `/bmad-dev-story`:

1. **Task 1 & 2 (`src/core/base-client.js` & `error-envelope.js`):** Implement `request()` with error classification (429/403), auto-quarantine, exponential backoff with full jitter, account rotation, and standby backoff.
2. **Task 3 (`src/proxy/providers.js`):** Ensure `getProxyAgent` handles `{ client: 'undici' | 'got' }` consistently.
3. **Task 4 (`types/core.d.ts` & `types/proxy.d.ts`):** Update TypeScript definitions for `AbstractApiClientOptions`, `HttpClientFn`, and request pipeline options.
4. **Task 5 (Green Phase):** Unskip all tests in `tests/core/base-client-request.test.js` and verify 100% pass with zero mocks.
5. **Task 6 (Regression):** Run full test suite across `tests/core/`, `tests/proxy/`, `tests/client/`.
