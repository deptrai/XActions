---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: 2026-08-21T04:42:25+07:00
storyId: '11.4'
storyKey: '11-4-adaptive-infrastructure-aware-rate-limiter-account-protection-governor'
storyFile: '_bmad-output/implementation-artifacts/11-4-adaptive-infrastructure-aware-rate-limiter-account-protection-governor.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-4-adaptive-infrastructure-aware-rate-limiter-account-protection-governor.md'
generatedTestFiles:
  - tests/core/adaptive-governor.test.js
  - tests/core/status-api.test.js
---

# ATDD Checklist: Story 11.4 — Adaptive Infrastructure-Aware Rate Limiter & Account Protection Governor

## TDD Red Phase (Current)

✅ **Red-phase test scaffolds generated**
- **Test Files:**
  - `tests/core/adaptive-governor.test.js` (15 unit & contract tests)
  - `tests/core/status-api.test.js` (3 unit & contract tests)
- **Total Tests:** 18 tests (all scaffolded with `test.skip()`)
- **Status:** TDD RED Phase Verified (Asserts concrete expected governor & status behaviors; will fail until feature is implemented)

## Acceptance Criteria Coverage

| Criterion | Target Behavior | Test Scenario in Test Suites |
|---|---|---|
| **AC-1** | Dynamic Throughput by Live Proxy Health | `should compute nominal throughput = healthyCount * baseRps * throttleFactor at 100% health`<br>`should scale throughput down by 50% when healthy proxy count falls below 50% of total`<br>`should return 0 throughput (pause) when healthy proxy ratio is under 10% or below floor`<br>`should throttle throughput to 25% when redis consumer lag exceeds 10,000` |
| **AC-2** | Account-Level Token-Bucket Sliding Window & Velocity | `should reject requests when account request velocity exceeds safeRequestsPerMinute`<br>`should increment global currentReqPerSecond counter on recordRequest` |
| **AC-3** | Programmatic Hibernation, Bot Challenges & Wake | `should put account into hibernation on recordRateLimit and reject requests`<br>`should support recordBotChallenge with custom hibernation window`<br>`should immediately restore account availability on wakeAccount`<br>`should automatically prune expired hibernating accounts in getStatus()` |
| **AC-4** | No-Auth Platform Synthetic Key | `should track and limit no-auth platform requests under synthetic noauth key` |
| **AC-5 & AC-6** | Redis Consumer Lag Backpressure & Status Shape | `should return complete GovernorStatus shape matching schema`<br>`should assign throttleLevel as backpressure when redis lag exceeds threshold`<br>`should assign throttleLevel as critical when healthy proxy ratio is under 10%`<br>`should provide globalAdaptiveRateGovernor singleton instance` |
| **AC-6 & AC-7** | StatusApi Contract & Global Singletons | `should return default zero-state status when constructed without governor`<br>`should delegate getGovernorStatus() to injected AdaptiveRateGovernor instance`<br>`should export globalStatusApi singleton instance` |
| **AC-8** | Redis Consumer Lag Measurement | Handled via `StreamMetricsReader` in `src/utils/stream-metrics.js` |
| **AC-9** | Request Pipeline Governor Call Argument Fix | Verified in `src/core/base-client.js` |
| **AC-10** | TypeScript Type Declarations | Verified in `types/core.d.ts` and `types/index.d.ts` |

---

## Next Steps (Task-by-Task Implementation & Green Phase)

During implementation with `/bmad-dev-story`:

1. **Task 1 (`src/core/adaptive-governor.js`):** Add `recordRateLimit`, `recordBotChallenge`, `updateRedisConsumerLag`, `globalAdaptiveRateGovernor`, and fix expiration pruning.
2. **Task 2 (`src/core/status-api.js` & `src/core/index.js`):** Add `globalStatusApi` singleton and re-export globals.
3. **Task 3 (`src/utils/stream-metrics.js`):** Implement resilient `StreamMetricsReader` reading Redis Stream pending count.
4. **Task 4 (`api/routes/governor.js` & `api/server.js`):** Mount `GET /governor/status`.
5. **Task 5 (`src/cli/index.js` & `src/mcp/server.js`):** Add `xactions status` and `x_governor_status` MCP tool.
6. **Task 6 (`types/core.d.ts` & `types/index.d.ts`):** Update TypeScript declarations.
7. **Task 7 (Green Phase):** Unskip all 18 tests in `tests/core/adaptive-governor.test.js` and `tests/core/status-api.test.js` and verify 100% pass.
8. **Task 8 (Regression):** Run regression suite across all core, proxy, and client test files.
