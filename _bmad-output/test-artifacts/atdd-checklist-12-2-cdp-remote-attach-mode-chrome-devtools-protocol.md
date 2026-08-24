---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04c-aggregate
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-08-24T23:45:00.000Z'
storyId: '12.2'
storyKey: '12-2-cdp-remote-attach-mode-chrome-devtools-protocol'
storyFile: '_bmad-output/implementation-artifacts/12-2-cdp-remote-attach-mode-chrome-devtools-protocol.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-12-2-cdp-remote-attach-mode-chrome-devtools-protocol.md'
generatedTestFiles:
  - 'tests/core/cdp-launcher.test.js'
  - 'tests/utils/gaussian-delay.test.js'
  - 'tests/cli/auth.test.js'
---

# ATDD Checklist: Story 12.2 — CDP Remote Attach Mode with Launch Helper & Gaussian Jitter

## 🔴 TDD Red Phase (Current State)

All test scaffolds have been generated with `it.skip()` and `describe.skip()` in accordance with the TDD Red Phase. They assert the expected behaviors defined by Story 12.2 ACs and will fail if activated prior to code implementation.

### Test Scaffolds Generated:
1. **Core & Adapter Tests**: [`tests/core/cdp-launcher.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/.worktrees/story-12-2/tests/core/cdp-launcher.test.js) (6 test cases, all skipped)
2. **Gaussian Jitter Tests**: [`tests/utils/gaussian-delay.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/.worktrees/story-12-2/tests/utils/gaussian-delay.test.js) (5 test cases, all skipped)
3. **CLI Auth Helper Tests**: [`tests/cli/auth.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/.worktrees/story-12-2/tests/cli/auth.test.js) (3 test cases, all skipped)

---

## 📋 Acceptance Criteria & Test Mapping

| Acceptance Criteria | Test File | Test Descriptions | Priority | Status |
| :--- | :--- | :--- | :---: | :---: |
| **AC-1: Chrome Path & CLI Launch Helper** | `tests/core/cdp-launcher.test.js`<br>`tests/cli/auth.test.js` | • macOS / Windows / Linux Chrome path resolution<br>• Custom executable path validation<br>• Remote debugging port & user data dir arg building<br>• `xactions auth --launch-chrome` flag parsing | P0/P1 | 🔴 RED (Skipped) |
| **AC-2: CDP Connect & Profile Preservation** | `tests/core/cdp-launcher.test.js` | • Fetch `/json/version` & parse WebSocket URL<br>• Adapter `connect()` with `preserveProfile: true`<br>• Error envelope wrapping (AD-15) on unreachable CDP | P0/P1 | 🔴 RED (Skipped) |
| **AC-3: Gaussian Jitter (3–7s Delay)** | `tests/utils/gaussian-delay.test.js` | • Strict `[min, max]` bounding<br>• Normal distribution around mean ~5000ms<br>• Async delay resolution | P0/P1 | 🔴 RED (Skipped) |
| **AC-4: AbstractCrawler Integration** | `tests/core/cdp-launcher.test.js` | • `cdpUrl` option support<br>• Non-invasive disconnect on crawler close | P1 | 🔴 RED (Skipped) |
| **AC-5: CLI Login/Auth Dispatch** | `tests/cli/auth.test.js` | • Parse options and output actionable instructions | P1 | 🔴 RED (Skipped) |

---

## 🛠️ Implementation Guidance for `dev-story`

### Files to create / update during implementation:
1. `src/utils/gaussian-delay.js` (NEW): Implement `gaussianRandom(min, max, mean, stdDev)` and `gaussianDelay(min, max)`.
2. `src/core/cdp-launcher.js` (NEW): Implement `getChromeExecutablePath`, `buildChromeArgs`, `fetchCdpWsEndpoint`, `launchChrome`, `launchBrowserWithCdp`.
3. `src/scrapers/adapters/base.js` & `playwright.js` & `puppeteer.js` (UPDATE): Add `preserveProfile` flag handling in `newPage()`.
4. `src/cli/commands/auth.js` (NEW): Register `xactions auth --launch-chrome` command.
5. `src/cli/index.js` (UPDATE): Register `registerAuthCommand`.
6. `src/core/base-crawler.js` (UPDATE): Accept `cdpUrl` in constructor/init options.

---

## 🚀 Activation Flow (Task-by-Task in `dev-story`)

For each task in `dev-story`:
1. Remove `.skip` from the corresponding `it.skip` / `describe.skip` blocks in test files.
2. Run test: `npm test` or `npx vitest run <test-file>`.
3. Verify test **FAILS** with expected error (Red Phase).
4. Implement the module code (Green Phase).
5. Verify test **PASSES**.
6. Commit the working changes.
