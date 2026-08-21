---
workflowStatus: 'completed'
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-21'
storyId: '12.1'
storyKey: '12-1-terminal-ascii-qr-code-login-module'
storyFile: '_bmad-output/implementation-artifacts/12-1-terminal-ascii-qr-code-login-module.md'
atddChecklistPath: '_bmad-output/implementation-artifacts/atdd-checklist-12-1-terminal-ascii-qr-code-login-module.md'
generatedTestFiles:
  - tests/utils/qrcode.test.js
  - tests/core/login/terminal-qr.test.js
  - tests/cli/login.test.js
---

# ATDD Checklist: Story 12.1 — Terminal ASCII QR Code Login Module with Countdown & Timeout

**Story ID:** 12.1  
**Status:** 🔴 **RED-PHASE SCAFFOLDS CREATED (Ready for Dev Story)**  
**Generated Test Files:**
- [`tests/utils/qrcode.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/tests/utils/qrcode.test.js)
- [`tests/core/login/terminal-qr.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/tests/core/login/terminal-qr.test.js)
- [`tests/cli/login.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/tests/cli/login.test.js)

---

## 1. Acceptance Criteria to Test Mapping

| Criteria | Scenario / Test Description | Test File & Priority | Phase Status |
|---|---|---|:---:|
| **AC-1** | `displayTerminalQrCode(data)` renders 1:1 ASCII block matrix on TTY (`\u2588`, `\u2580`, `\u2584`) | `tests/utils/qrcode.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-1** | Auto-scale to compact matrix when terminal width < 80 cols | `tests/utils/qrcode.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-1** | Show URL option appends plain text URL below QR | `tests/utils/qrcode.test.js` (P1) | 🔴 Red (Skipped) |
| **AC-2** | `TerminalQrLogin.login()` polls `checkLoginState` every 1s and resolves upon receiving cookies | `tests/core/login/terminal-qr.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-2** | Abort and throw `PlatformError [QR EXPIRED]` after 120s timeout | `tests/core/login/terminal-qr.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-2** | Cleanly clear all active timers on completion (0 dangling handles) | `tests/core/login/terminal-qr.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-3** | Non-TTY environment (`isTTY: false`) outputs clean text URL & shortcode without ANSI escape sequences | `tests/utils/qrcode.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-4** | CLI `xactions login` parses flags `--qr`, `--qr-url`, `--push`, `--cdp`, `--platform`, `--timeout` | `tests/cli/login.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-5** | `TerminalQrLogin` extends `AbstractLogin` and generates 6-char short code excluding ambiguous characters | `tests/core/login/terminal-qr.test.js` (P0) | 🔴 Red (Skipped) |
| **AC-7** | Throw `PlatformError [ACCOUNT CHECKPOINTED]` when platform returns checkpoint challenge | `tests/core/login/terminal-qr.test.js` (P1) | 🔴 Red (Skipped) |

---

## 2. Dev Story Readiness Checklist

- [x] Story Spec approved and documented in `_bmad-output/implementation-artifacts/12-1-terminal-ascii-qr-code-login-module.md`
- [x] Test Design and Risk Assessment completed in `_bmad-output/planning-artifacts/test-design-epic-12.md`
- [x] All 10 test scenarios scaffolded in 3 test files with `test.skip()`
- [x] Baseline test suite verified 100% green
- [ ] Next Step: Run `/bmad-dev-story _bmad-output/implementation-artifacts/12-1-terminal-ascii-qr-code-login-module.md` to unskip and implement code to turn tests green.
