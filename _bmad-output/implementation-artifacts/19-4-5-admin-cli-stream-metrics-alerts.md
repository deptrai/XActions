---
story_id: "19.4.5"
epic: 19
story_key: "19-4-5-admin-cli-stream-metrics-alerts"
status: "ready-for-dev"
phase: "Phase 5"
created: "2026-09-04"
updated: "2026-09-04"
owner: "DEV"
reviewed: "Pending"
baseline_commit: "6a4135374a48f2b3cbaf1f76f7c21d0026b5b9a8"
---

# Story 19.4.5: Admin CLI — Stream Metrics & Alerts

Status: ready-for-dev

## ⚠️ Critical Constraints / Architecture Variance

1. **Extend Existing `xactions admin stream` Group** — `xactions admin stream metrics` and `xactions admin stream alerts` already exist in `src/cli/commands/admin.js` (Story 14.3 / 19.3). This story adds the missing `test` subcommand (`xactions admin stream test`) to trigger a synthetic alert from the CLI.
2. **REST-First with In-Process Fallback**:
   - For `test`: Call `POST /api/admin/stream/alerts/test` with optional body. If remote API is unreachable and no explicit `--url` was provided, fall back to in-process `defaultStreamAlertEngine.testAlert(customPayload)`.
3. **Preserve Existing `metrics` and `alerts` Commands** — Do NOT rename, move, or break the existing `xactions admin stream metrics` and `alerts` commands. The dashboard, docs, and existing tests depend on them.
4. **Dual Output Modes (CLI Formatted + Raw JSON)**:
   - Human-readable: Clean terminal messages with `chalk` and emojis (✅, ⚠️, ❌), showing whether the test alert was delivered to webhook/email.
   - Machine-readable: Valid JSON output via `JSON.stringify(..., null, 2)` when `--json` is supplied.
5. **Standard Option Flags**:
   - `--url <url>`: Base API URL (defaults to `http://localhost:3001` or `resolveBaseUrl`).
   - `--token <token>`: Bearer token for admin authentication (`headers: { Authorization: 'Bearer ...' }`).
   - `--json`: Output raw JSON.
6. **No Direct DB Access & No Browser / Puppeteer**: CLI only invokes REST API or `StreamAlertEngine` singleton.
7. **No Mocks in Tests**: Test against real `Command` and real `stream-alerts.js` singleton.

[Source: `_bmad-output/planning-artifacts/epics.md` lines 1108–1117; `api/routes/admin.js:299–360`; `src/utils/stream-alerts.js:258–320`; `src/cli/commands/admin.js:68–164`]

---

## Story

As an **Internal Automation Operator**,  
I want **the command `xactions admin stream test` (alongside existing `metrics` and `alerts`)**,  
so that **I can verify that alert channels (webhook/email) are configured correctly and will fire when `pendingMessages > 50,000` or `lastAckTime > 60s`**.

---

## Acceptance Criteria

### AC-1: CLI Command Registration & Help Contract

- **Given** the `xactions admin` command group
- **When** the operator runs `xactions admin stream --help`
- **Then** the output lists:
  - `metrics`: Display real-time stream metrics
  - `alerts`: Display recent stream alerts and threshold status
  - `test`: Send a synthetic test alert to configured channels
- **And** `test` supports options `--url <url>`, `--token <token>`, `--json`

### AC-2: Send Test Alert via REST or In-Process Engine

- **Given** a running admin daemon or local in-process environment
- **When** the operator runs `xactions admin stream test` (or `xactions admin stream test --json`)
- **Then** the command attempts `POST /api/admin/stream/alerts/test` with optional Bearer token
- **And** on success, prints a confirmation with delivery status (`webhookDelivered`, `emailDelivered`)
- **And** if `--json` is passed, outputs `{ success: true, message: "Test alert sent", result: { ... } }`
- **And** if the remote API is unreachable and no explicit `--url` was given, falls back to in-process `defaultStreamAlertEngine.testAlert()`

### AC-3: Preserve Existing Stream Metrics and Alerts Commands

- **Given** the existing `xactions admin stream` tree
- **When** this story is implemented
- **Then** `xactions admin stream metrics` continues to display stream metrics as before
- **And** `xactions admin stream alerts` continues to display alert status as before
- **And** their option flags (`--url`, `--token`, `--json`) and output formatting are preserved

### AC-4: Error Handling & Validation

- **Given** the API server returns 4xx/5xx or the alert engine is unavailable
- **When** the operator runs `xactions admin stream test`
- **Then** the command prints the error cleanly with `printCliError(err, { json: options.json })`
- **And** it does not crash or leak internal stack traces

---

## Developer Context & Implementation Guidance

### Key Files & Locations

| Component | File Path | Role |
|---|---|---|
| CLI Command Entry | `src/cli/commands/admin.js` | Add `test` subcommand under `streamCmd` (existing `stream` group at line 30) |
| CLI Error Formatter | `src/cli/shared.js` | Uses `printCliError`, `resolveBaseUrl`, `fetchAdminJson` |
| Stream Alert Engine | `src/utils/stream-alerts.js` | `defaultStreamAlertEngine.testAlert(customPayload)` and `getAlertStatus()` |
| Admin REST Routes | `api/routes/admin.js:350–360` | `POST /api/admin/stream/alerts/test` |
| Integration Tests | `tests/cli/admin-stream.test.js` | Existing test suite for stream CLI commands |

---

## Testing Plan

1. **Unit & CLI Verification (`tests/cli/admin-stream.test.js`)**:
   - Verify `xactions admin stream --help` lists `metrics`, `alerts`, and `test`.
   - Verify `test` subcommand exposes `--url`, `--token`, and `--json` options.
   - Test in-process fallback for `test` and verify the result contains `webhookDelivered`/`emailDelivered` fields.
   - Test `--json` flag formats valid JSON output for `test`.
   - Test error handling when the alert engine is unavailable (or test returns a warning).
2. **Regression Check**:
   - Run all existing admin test suites (`admin-unified`, `admin-status`, `admin-stream`, `admin-proxies`, `admin-accounts`, `admin-checkpoints`).

---

## Completion Status

- **Status**: `ready-for-dev`
- **Notes**: Master implementation guide for Story 19.4.5 Admin CLI Stream Metrics & Alerts.
