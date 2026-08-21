---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: 2026-08-21T14:38:55+07:00
storyId: '11.7'
storyKey: '11-7-crawler-governor-integration-validator-contract'
storyFile: '_bmad-output/implementation-artifacts/11-7-crawler-governor-integration-validator-contract.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-7-crawler-governor-integration-validator-contract.md'
generatedTestFiles:
  - tests/core/crawler-governor.test.js
  - tests/scrapers/twitter/validator.test.js
  - tests/scrapers/facebook/validator.test.js
---

# ATDD Checklist: Story 11.7 — Crawler-Governor Integration & Platform Response Validator Contract

## TDD Green Phase (Completed)

✅ **Green-phase implementation verified**
- **Test Files:**
  - `tests/core/crawler-governor.test.js` (9/9 unit & contract tests passing)
  - `tests/scrapers/twitter/validator.test.js` (7/7 unit & contract tests passing)
  - `tests/scrapers/facebook/validator.test.js` (6/6 unit & contract tests passing)
- **Total Tests:** 22/22 tests passing (100% green, zero mocks)
- **Status:** TDD GREEN Phase Verified (Ready for code review via `/bmad-code-review`)

## Acceptance Criteria Coverage

| Criterion | Target Behavior | Test Scenario in Test Suites | Status |
|---|---|---|---|
| **AC-1 & AC-2** | `AbstractCrawler` Governor & Account Admission | `should accept governor and accountPool in constructor or inherit from client`<br>`should throw INVALID_ARGS before governor checks when action is unknown`<br>`should throw HIBERNATION (XACT_4291) when account is hibernating`<br>`should fallback to accountPool.getNextAvailable when accountId is omitted in auth crawler`<br>`should throw PROXY_EXHAUSTED (XACT_5030) when governor throughput is 0`<br>`should record request under synthetic noauth key for no-auth crawler` | ✅ PASS |
| **AC-3 & AC-4** | `AbstractApiClient` Response Validator Integration | `should throw RateLimitError when 200 response contains rate-limit payload`<br>`should throw BotChallengeError when 200 response contains hidden challenge`<br>`should throw INVALID_ARGS when response payload is invalid/corrupted` | ✅ PASS |
| **AC-5 & AC-7** | `TwitterPlatformResponseValidator` GraphQL & HTML | `should recognize valid UserByScreenName GraphQL response payload`<br>`should recognize valid UserTweets timeline response instructions`<br>`should recognize valid TweetDetail response payload`<br>`should detect rate limit from GraphQL errors array with code 88 or message`<br>`should detect bot challenge from Cloudflare or Incapsula HTML response body`<br>`should detect rate limit from HTTP 429 status code`<br>`should not treat not-found errors as bot challenge` | ✅ PASS |
| **AC-6 & AC-7** | `FacebookPlatformResponseValidator` HTML & Payloads | `should recognize valid mbasic real post HTML page structure`<br>`should identify short login-wall page as invalid payload`<br>`should identify checkpoint redirect URL as bot challenge`<br>`should identify security check / identity confirmation in body as bot challenge`<br>`should identify temporarily blocked message as rate limit`<br>`should recognize normalized post array or profile object as valid payload` | ✅ PASS |
| **AC-8** | No regressions across existing scrapers | Verified across all test suites | ✅ PASS |
| **AC-9** | Zero-mock and zero-leak contracts | In-memory fixtures, real class instances | ✅ PASS |
| **AC-10** | TypeScript Type Declarations | `types/core.d.ts` strict types (`requiresAuth`, `governor`, `accountPool`, `responseValidator`) | ✅ PASS |
