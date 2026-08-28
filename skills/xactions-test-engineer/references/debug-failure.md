---
name: debug-failure
description: Diagnose failing API, MCP, or browser tests and produce a minimal fix with verified evidence.
code: DF
added: 2026-08-28
type: prompt
---

# Debug a Failing Test

The outcome is a fixed test, a fixed implementation, or a documented minimal reproduction with a clear next step. The consumer is a developer who can act on the diagnosis without having to reproduce the failure themselves.

The bar: the diagnosis names the failure category, points to the exact file/line, explains why it is happening now, and the fix is verified by rerunning the failing test.

## Evidence collection

- Capture the full test output with `vitest run {path}`.
- For API/MCP: inspect `browser_console_messages` (if browser involved), `api/logs`, or the response body and status.
- For browser: capture `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages(level="error")`, and `browser_network_requests`.
- For TypeScript: run `npx tsc --noEmit` and capture errors.
- For stack traces: identify the first non-test frame.

## Categorize the failure

- **Backend 5xx:** Check the route handler, DB query, and any recent schema changes.
- **Auth failure (401/403):** Check token expiry, JWT secret, user role, or A2A scope.
- **Route/contract drift:** Response shape changed but test did not. Update test or route.
- **Prisma/DB failure:** Migration missing, `cleanupTestDatabase` not called, or row conflict.
- **MCP tool mismatch:** Tool removed, schema changed, or handler throws.
- **Flaky UI:** Race condition, hydration lag, selector drift, or lazy-loaded component. Add resilient assertions or fix the app.
- **Timeout:** Real dependency slow or missing. Check if a server/DB/browser was running.

## Produce the fix

- If the app is wrong, fix the app and update tests if behavior changed.
- If the test is wrong, fix the test.
- If the environment is wrong, document the required setup.
- Keep the fix minimal. Do not refactor unrelated code.

## Verify

Run the failing test in isolation. Then run the related suite. Then run `npx tsc --noEmit` if types were touched. If the failure is intermittent, run the test three times and report stability. Append the failure and fix to the session log and MEMORY.md if the pattern is likely to recur.
