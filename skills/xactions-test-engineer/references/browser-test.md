---
name: browser-test
description: Pilot a live browser via Playwright or Chrome DevTools MCP to verify UI behavior and generate resilient E2E test scripts.
code: BT
added: 2026-08-28
type: prompt
---

# Browser / E2E Test — Pilot the UI and Generate Scripts

The outcome is either a live verification report (what the UI did, what evidence was captured, whether it passed) or a production-ready Playwright/Vitest E2E spec under `tests/e2e/`. The consumer is a developer or CI pipeline that needs UI behavior to be provable and repeatable.

The bar: every claim is backed by a snapshot, screenshot, console log, or network payload. Selectors use `getByRole`, `getByText`, or `data-testid` before falling back to CSS. Tests handle async transitions and never rely on `waitForTimeout`. Real responses only; mock only for fault injection.

## Before piloting

Confirm the context:
- Target base URL: `http://localhost:3000` (Express server) or `http://localhost:4998` (dashboard).
- Login required? Use saved `storageState` or seed a test user and log in through the UI once.
- Browser MCP available? Prefer Playwright MCP (`browser_navigate`, `browser_snapshot`, `browser_click`, etc.) or Chrome DevTools MCP if that is configured.
- Is this a one-off live check or a script to keep?

## Live verification loop

1. **Observe.** Take `browser_snapshot` (A11y tree) and check `browser_console_messages` / `browser_network_requests`.
2. **Analyze.** Map DOM state to the target scenario. Identify semantic locators.
3. **Execute.** Navigate, click, fill, or press keys using exact locators.
4. **Verify.** Capture the next snapshot and assert the expected state change.

Repeat for each step. For async flows (SSE, WebSockets, loading skeletons):
- Wait for visible state, not arbitrary time.
- Intercept network requests and confirm stream headers (`text/event-stream`, `Connection: keep-alive`).
- Confirm incremental UI updates as chunks arrive.
- Test cancel/reconnect paths.

## Generating an E2E script

Write to `tests/e2e/{feature}.test.js`:
- Use Playwright (`import { test, expect } from '@playwright/test'`).
- One `test.describe` per feature; use `test.step` for readability.
- `test.beforeEach` navigates and, if needed, loads `storageState`.
- Locator hierarchy: `page.getByRole(...)` > `getByText` > `getByTestId` > CSS.
- Assert with auto-waiting: `toBeVisible({ timeout: 10000 })`, `toHaveText`, `toHaveURL`.
- Include a boundary test: error state, empty state, or 401 redirect.
- No hardcoded `page.waitForTimeout`. Use `expect.poll` only when necessary.

## After piloting or scripting

If live: report the URL, the actions, the evidence, and the pass/fail. If scripted: run `npx playwright test tests/e2e/{feature}.test.js` or `vitest run` if it is a Vitest E2E file. Iterate on selectors or timing until stable. Capture flaky selectors in MEMORY.md for future sessions.
