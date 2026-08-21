---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: 2026-08-21T14:29:45+07:00
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

## TDD Red Phase (Current)

✅ **Red-phase test scaffolds generated**
- **Test Files:**
  - `tests/core/crawler-governor.test.js` (9 unit & contract tests)
  - `tests/scrapers/twitter/validator.test.js` (7 unit & contract tests)
  - `tests/scrapers/facebook/validator.test.js` (6 unit & contract tests)
- **Total Tests:** 22 tests (all scaffolded with `test.skip()`)
- **Status:** TDD RED Phase Verified (Asserts concrete crawler admission, governor limits, rate-limit/bot-challenge recognition; ready for Green Phase implementation)

## Acceptance Criteria Coverage

| Criterion | Target Behavior | Test Scenario in Test Suites |
|---|---|---|
| **AC-1 & AC-2** | `AbstractCrawler` Governor & Account Admission | `should accept governor and accountPool in constructor or inherit from client`<br>`should throw INVALID_ARGS before governor checks when action is unknown`<br>`should throw HIBERNATION (XACT_4291) when account is hibernating`<br>`should fallback to accountPool.getNextAvailable when accountId is omitted in auth crawler`<br>`should throw PROXY_EXHAUSTED (XACT_5030) when governor throughput is 0`<br>`should record request under synthetic noauth key for no-auth crawler` |
| **AC-3 & AC-4** | `AbstractApiClient` Response Validator Integration | `should throw RateLimitError when 200 response contains rate-limit payload`<br>`should throw BotChallengeError when 200 response contains hidden challenge`<br>`should throw INVALID_ARGS when response payload is invalid/corrupted` |
| **AC-5 & AC-7** | `TwitterPlatformResponseValidator` GraphQL & HTML | `should recognize valid UserByScreenName GraphQL response payload`<br>`should recognize valid UserTweets timeline response instructions`<br>`should recognize valid TweetDetail response payload`<br>`should detect rate limit from GraphQL errors array with code 88 or message`<br>`should detect bot challenge from Cloudflare or Incapsula HTML response body`<br>`should detect rate limit from HTTP 429 status code`<br>`should not treat not-found errors as bot challenge` |
| **AC-6 & AC-7** | `FacebookPlatformResponseValidator` HTML & Payloads | `should recognize valid mbasic real post HTML page structure`<br>`should identify short login-wall page as invalid payload`<br>`should identify checkpoint redirect URL as bot challenge`<br>`should identify security check / identity confirmation in body as bot challenge`<br>`should identify temporarily blocked message as rate limit`<br>`should recognize normalized post array or profile object as valid payload` |
| **AC-8** | No regressions across existing scrapers | Verified in full regression test suite |
| **AC-9** | Zero-mock and zero-leak contracts | In-memory fixtures, real class instances |
| **AC-10** | TypeScript Type Declarations | `types/core.d.ts` strict types (`requiresAuth`, `governor`, `accountPool`, `responseValidator`) |

---

## Next Steps (Task-by-Task Implementation & Green Phase)

During implementation with `/bmad-dev-story`:

1. **Task 1 (`src/core/base-crawler.js`):** Add `governor` & `accountPool` dependencies, `requiresAuth` property, admission gating in `start()` (check hibernation `XACT_4291`, throughput `XACT_5030`, record request).
2. **Task 2 (`src/core/base-client.js`):** Accept `responseValidator`, implement `#validateResponse()`, call before returning 2xx/3xx response, and update `handleError()` classification.
3. **Task 3 (`src/scrapers/twitter/validator.js`):** Implement `TwitterPlatformResponseValidator` with GraphQL & HTML challenge/rate-limit detection.
4. **Task 4 (`src/scrapers/facebook/validator.js`):** Implement `FacebookPlatformResponseValidator` with mbasic login-wall, checkpoint, and block detection.
5. **Task 5 (`types/core.d.ts`):** Update TypeScript declarations with strict types.
6. **Task 6 (Green Phase):** Unskip all 22 tests in `tests/core/crawler-governor.test.js`, `tests/scrapers/twitter/validator.test.js`, and `tests/scrapers/facebook/validator.test.js`.
7. **Task 7 (Regression):** Run full test suite across all core, proxy, client, and scraper modules.
