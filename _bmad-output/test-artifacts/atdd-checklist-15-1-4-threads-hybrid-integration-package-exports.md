---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-29'
workflowType: 'testarch-atdd'
storyId: '15.1.4'
storyKey: '15-1-4-threads-hybrid-integration-package-exports'
storyFile: '_bmad-output/implementation-artifacts/15-1-4-threads-hybrid-integration-package-exports.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-15-1-4-threads-hybrid-integration-package-exports.md'
generatedTestFiles:
  - 'tests/scrapers/social/threads/caller-migration.test.js'
inputDocuments:
  - '_bmad-output/implementation-artifacts/15-1-4-threads-hybrid-integration-package-exports.md'
  - 'src/scrapers/index.js'
  - 'src/scrapers/social/threads/crawler.js'
  - 'src/scrapers/social/threads/client.js'
  - 'src/scrapers/social/threads/index.js'
  - 'package.json'
---

# ATDD Checklist - Story 15.1.4: Threads Hybrid Integration & Package Exports

## 2. Generation Mode

- **Selected Mode:** AI Generation
- **Rationale:** Project stack is Node.js backend with Vitest. Story 15.1.4 is a caller migration / integration cutover: no new browser UI, no complex DOM interactions. Tests verify `scrape('threads', ...)` dispatch, package.json exports, MCP/CLI routing, and deprecation markers. All scenarios can be scaffolded from source code and architecture invariants.

## 3. Test Strategy & Acceptance Criteria Mapping

| ID | Acceptance Criterion | Test Scenario | Level | Priority | Red Phase Status |
|---|---|---|---|---|---|
| **SCN-1** | AC-1: No Puppeteer launch | `scrape('threads', 'profile', { username })` does not call `puppeteer.launch`, `createBrowser`, or `createPage` | Integration | **P0** | 🔴 RED (expected fail) |
| **SCN-2** | AC-2: Action mapping matrix | `scrape('threads', action, ...)` maps all legacy aliases (`tweets`, `timeline`, `feed`, `user_feed`, `posts`, `post`, `post_detail`, `comments`, `post_comments`, `profile`, `followers`, `following`, `search`) to `ThreadsCrawler` action registry | Integration | **P0** | 🔴 RED (expected fail) |
| **SCN-3** | AC-1: Session pass-through | `scrape('threads', ...)` builds `session: { accountId, cookies }` from `options.accountId` / `options.authCookie` / `options.cookies` and passes into `crawler.start()` | Integration | **P0** | 🔴 RED (expected fail) |
| **SCN-4** | AC-1: `crawler.cleanup()` called | `scrape('threads', ...)` invokes `crawler.cleanup()` when `options.autoClose !== false` | Integration | **P1** | 🔴 RED (expected fail) |
| **SCN-5** | AC-3: Package.json exports | `package.json` contains `"./scrapers/social/threads"` and `"./scrapers/social"` exports resolving to correct source files | Unit / Contract | **P0** | 🔴 RED (expected fail) |
| **SCN-6** | AC-3: Public symbol exports | `xactions/scrapers/social/threads` exports `DEFAULT_THREADS_DOC_IDS`, `ThreadsCrawler`, `ThreadsClient`, `ThreadsPlatformResponseValidator`, `threadsNamespacedProfileId`, `normalizeThreadsProfile`, `profileItemToPostItem` | Unit / Contract | **P0** | 🔴 RED (expected fail) |
| **SCN-7** | AC-4: Deprecation markers | `src/scrapers/threads/index.js` contains top-level `// LEGACY` comment and `@deprecated` JSDoc on each legacy function | Unit / Contract | **P1** | 🔴 RED (expected fail) |
| **SCN-8** | AC-4: Deprecation plan status | `docs/deprecation-plan.md` lists Threads legacy status as `deprecated-planned` with Story 15.1.4 reference | Unit / Contract | **P1** | 🔴 RED (expected fail) |
| **SCN-9** | AC-5: Integration suite presence | `tests/scrapers/social/threads/caller-migration.test.js` exists and is discoverable by Vitest | Integration | **P0** | 🔴 RED (expected fail) |
| **SCN-10** | Negative: Unknown action | `scrape('threads', 'unknown_action', ...)` throws clear error listing available Threads actions | Integration / Negative | **P2** | 🔴 RED (expected fail) |

## 4. Generated Test Scaffolds

- **Test File:** `tests/scrapers/social/threads/caller-migration.test.js`
- **Total Test Cases:** 13 scenarios across 1 test suite
- **Mocking Policy:** 100% Mock-free (using Node.js `http.createServer` for realistic GraphQL & SSR endpoints, `vi.spyOn` to assert no Puppeteer launch).
- **Red Phase Verification:** `npx vitest run tests/scrapers/social/threads/caller-migration.test.js` reports `1 skipped` file and `13 skipped` tests — all scaffolds are red-phase and will fail once un-skipped.

## 5. Implementation Checklist

### Task T1: `src/scrapers/index.js` hybrid dispatch branch
- [ ] Import `ThreadsCrawler` from `./social/threads/crawler.js` and `ThreadsClient` from `./social/threads/client.js`
- [ ] Add `if (platformName === 'threads')` branch before `needsPuppeteer` logic
- [ ] Define `THREADS_ACTION_MAP` mapping legacy aliases to crawler action names
- [ ] Instantiate `ThreadsCrawler` with `client`, `accountPool`, `proxyPool`, `governor`, `store`
- [ ] Build `session: { accountId, cookies }` from `options`
- [ ] Call `await crawler.start({ action: mappedAction, args: mappedArgs, session })`
- [ ] Call `await crawler.cleanup()` when `options.autoClose !== false`
- [ ] Remove `threads` from `needsPuppeteer` array
- [ ] Remove `threads` legacy dispatch from `actionMap` / `platformActionMap` or point to hybrid
- [ ] Run `npx vitest run tests/scrapers/social/threads/caller-migration.test.js -t "AC-1"` → green

### Task T2: `package.json` exports
- [ ] Add `"./scrapers/social/threads": "./src/scrapers/social/threads/index.js"`
- [ ] Keep `"./scrapers/social"` and `"./scrapers/threads"` (legacy)
- [ ] Run `npx vitest run tests/scrapers/social/threads/caller-migration.test.js -t "AC-3"` → green

### Task T3: `src/mcp/server.js` & `src/mcp/local-tools.js`
- [ ] Verify `x_crawl_post` and `x_crawl_comments_tree` dispatch `scrape('threads', ...)` correctly
- [ ] Add `x_get_profile_multiplatform`, `x_get_tweets_multiplatform`, `x_search_tweets_multiplatform` in `local-tools.js` for `platform === 'threads'`
- [ ] Ensure `x_actions_list` instantiates `ThreadsCrawler` and calls `cleanup()`

### Task T4: Deprecation markers
- [ ] Update `docs/deprecation-plan.md` Threads row to `deprecated-planned`, reference Story 15.1.4
- [ ] Add `// LEGACY — see docs/deprecation-plan.md` to top of `src/scrapers/threads/index.js`
- [ ] Add `@deprecated` JSDoc to legacy functions
- [ ] Run `npx vitest run tests/scrapers/social/threads/caller-migration.test.js -t "AC-4"` → green

### Task T5: Integration test suite activation
- [ ] Remove `describe.skip` from `tests/scrapers/social/threads/caller-migration.test.js` once T1–T4 complete
- [ ] Run `npx vitest run tests/scrapers/social/threads/caller-migration.test.js` → all green
- [ ] Run `npx vitest run tests/scrapers/social/threads` → all green

## 6. Running Tests

```bash
# Run all activated tests for this story
npx vitest run tests/scrapers/social/threads/caller-migration.test.js

# Run all Threads tests
npx vitest run tests/scrapers/social/threads

# Type check
npm run typecheck
```

## 7. Red-Green-Refactor Workflow

### RED Phase (Complete) ✅

- ✅ All 13 tests written as red-phase scaffolds with `describe.skip()`
- ✅ Local `node:http` server returns realistic GraphQL/SSR responses
- ✅ No mocks / stubs / fakes for HTTP client
- ✅ Implementation checklist created

**Verification:**

- All generated tests are present and marked skipped
- Activation guidance is clear and actionable
- Any activated test will fail due to missing implementation, not test bugs

### GREEN Phase (DEV Team - Next Steps)

1. **Pick one task** from the implementation checklist (start with T1)
2. **Remove `describe.skip()`** for the relevant test block and confirm it fails
3. **Implement minimal code** to make that test pass
4. **Run the test** to verify green
5. **Check off the task** and move to the next

### REFACTOR Phase (After All Green)

1. Verify all tests pass
2. Review `src/scrapers/index.js` for duplication with `facebook` hybrid branch
3. Extract shared helper if appropriate
4. Ensure `npm run typecheck` passes

## 8. Next Steps

1. Link this checklist and `caller-migration.test.js` into the story file `Dev Notes` / `ATDD Artifacts` section.
2. Run `/bmad-dev-story _bmad-output/implementation-artifacts/15-1-4-threads-hybrid-integration-package-exports.md` for implementation.
3. Activate one scaffold at a time by removing `skip`.
4. When all green, update `sprint-status.yaml` from `ready-for-dev` → `done`.

## 9. Test Execution Evidence

### Initial Scaffold Review / RED Verification

**Command:** `npx vitest run tests/scrapers/social/threads`

**Results:**

```
Test Files  7 passed | 1 skipped (8)
     Tests  57 passed | 13 skipped (70)
  Duration  4.60s
```

- 57 existing Threads tests continue to pass (regression-safe).
- 13 new `caller-migration` scaffolds are skipped (RED phase).
- `npm run typecheck` passes.

**Summary:**

- Total tests: 13
- Skipped: 13 (expected before activation)
- Activated RED tests: 0
- Passing: 0
- Status: ✅ Red-phase scaffolds verified

## 10. Notes

- `src/scrapers/index.js` currently imports legacy `threads` from `./threads/index.js` at line 41 and lists `threads` in `needsPuppeteer` array at line 218. This is the expected red-phase failure target.
- `package.json` currently lacks `"./scrapers/social/threads"` export. This is the expected red-phase failure target.
- `src/scrapers/threads/index.js` has top-level `@deprecated` JSDoc but is missing `// LEGACY — see docs/deprecation-plan.md` comment and per-function `@deprecated` JSDoc. This is the expected red-phase failure target.
- Known live-test issue: `LSD_REGEXES` in `src/scrapers/social/threads/client.js` may not match real Meta HTML pattern `["LSD",[],{"token":"..."},<integer>]`. Dev agent should verify if running `scripts/test-threads-live.js`.

