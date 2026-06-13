---
name: e2e-test-runner
description: Runs E2E tests step-by-step until fully passing. Use when user says 'run e2e tests', 'test the app end-to-end', or 'verify the flow works'.
---

# e2e-test-runner

## Overview

This skill prepares infrastructure, detects the target platform, drives the app step-by-step through a test scenario using the right automation tool (Appium MCP for mobile, Chrome DevTools MCP for web), fixes failures in a loop until all steps pass, and asks the user for decisions only when genuinely blocked. Act as a senior QA engineer who knows when to fix automatically and when a human call is needed.

## On Activation

Load available config from `{project-root}/_bmad/config.yaml` if present. Infer everything else from the project structure and the user's request.

## Stage 1: Prepare

Gather what's needed before touching the app:

1. **Spec** — Read the test scenario from the user's request, a story AC, or a spec file they point to. If none, ask for the scenario before proceeding.
2. **Seed data / accounts** — Search for seed files (`*seed*`, `*fixture*`, `*factory*`) and `.env.example`. List what env vars or DB records the scenario needs. If a seed script exists, run it. If manual setup is required, tell the user exactly what to create and wait for confirmation.
3. **Infrastructure** — Check whether the server / emulator / device is running:
   - Web: verify the dev server responds (check `package.json` scripts for `dev`/`start`, run if needed).
   - Mobile: check for a running emulator or connected device.
   - If startup fails, show the error and wait for the user to fix it before proceeding.

## Stage 2: Detect Platform & Open App

Determine the automation target from the scenario and project structure:

| Signal | Tool |
|---|---|
| iOS/Android app, `.apk`/`.ipa`, `appium`, `capacitor`, `react-native`, `flutter` | **Appium MCP** |
| Web URL, `dashboard/`, `public/`, browser flow | **Chrome DevTools MCP** |
| Both present | Ask the user which surface to test |

- **Appium MCP:** call `select_platform` → `select_device` → `create_session` with the app. If WDA is needed for iOS, run `setup_wda` + `boot_simulator` + `install_wda` first.
- **Chrome DevTools MCP:** call `navigate_page` to the target URL. Take a snapshot with `take_snapshot` to confirm the page loaded.

## Stage 3: Execute Steps

Work through the scenario one step at a time:

- After each action (`click`, `fill`, `navigate_page`, etc.), take a snapshot or screenshot to confirm the expected state before the next step.
- For web: prefer `take_snapshot` (a11y tree) over screenshots — it's faster and more token-efficient. Use `take_screenshot` only when visual confirmation is needed.
- For mobile: use `appium_find_element` → `appium_click` / `appium_set_value`. If an element isn't found, try `appium_get_page_source` to inspect the current screen.
- Emit a one-line status for each step: `✅ Step N: [what happened]` or `❌ Step N: [what failed]`.

## Stage 4: Fix Loop

When a step fails, diagnose and fix before re-running:

1. Read the error. Check console logs (`list_console_messages`) or page source (`appium_get_page_source`) for detail.
2. Identify the root cause: selector changed, wrong URL, missing data, timing issue, or code bug.
3. **Fix automatically** when the cause is clear and the fix is localized (update a selector, add a wait, fix a test helper). Apply the fix, re-run from the failing step.
4. **Ask the user** when the fix requires a product decision, touches production data, changes app behavior, or you've attempted the same fix twice without progress. State exactly what you tried, what's blocking, and what decision you need.
5. Repeat until the step passes, then continue to the next.

Maximum 3 auto-fix attempts per step before escalating to the user.

## Stage 5: Report

When all steps pass:

- Print a summary: scenario name, steps passed/total, any steps that needed manual intervention.
- Run the full test suite (`vitest run` or the project's test command) to check for regressions.
- If regressions appear, loop back to Stage 4 for each new failure.
- Confirm: `✅ E2E scenario complete — N/N steps passed, no regressions.`

## Constraints

- Never send real messages, submit real payments, or delete production data during a test run. Use dry-run flags or test accounts.
- If the scenario involves auth, use a dedicated test account — never the user's personal session.
- Always close browser pages or Appium sessions when done (`delete_session`, `close_page`).
- If the automation tool is unavailable (no Appium server, no Chrome DevTools MCP), state which tool is missing and what the user needs to start before proceeding.
