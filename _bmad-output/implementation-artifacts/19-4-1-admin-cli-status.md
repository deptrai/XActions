---
story_id: "19.4.1"
epic: 19
story_key: "19-4-1-admin-cli-status"
status: "ready-for-dev"
phase: "Phase 5"
created: "2026-09-02"
updated: "2026-09-02"
owner: "DEV"
reviewed: "Pending"
baseline_commit: "dc20f62de72ba55ae429d806591b0331741444f6"
---

# Story 19.4.1: Admin CLI — Status

Status: ready-for-dev

## ⚠️ Critical Constraints / Architecture Variance

The following decisions are non-negotiable and override any earlier language in this story or external references:

1. **Backends Already Exist** — `GET /api/admin/governor/status` (`api/routes/admin.js:363`) and `src/core/status-api.js` already expose the full `GovernorStatus` contract. This story only adds a **CLI renderer** inside `src/cli/commands/admin.js`.
2. **No Code Duplication with `xactions status`** — `src/cli/commands/info.js` already has a top-level `xactions status` command with the same rendering. Move the rendering logic to a shared helper or add `admin status` as a thin wrapper, but do not copy/paste `console.log` blocks.
3. **Pure CLI / No Puppeteer or Browser** — This is a CLI-only story. Do not import puppeteer or touch browser code.
4. **Real API First, In-Process Fallback** — Follow the pattern in `src/cli/commands/admin.js` (`stream metrics`, `stream alerts`): try calling the HTTP/REST endpoint, fall back to in-process `globalStatusApi` when running locally.
5. **No Mocks in Tests** — CLI tests must call real code or a real local server fixture. No `vi.fn` stubs for `fetch` or `console.log`.
6. **No Inline Epic/Story References in Source Code** — Do not add comments like `# Epic 19, # Story 19.4.1` to source files. Comments explain why, not what.

[Source: `epics.md` Epic 19, Story 19.4.1, lines 1065-1074; `src/cli/commands/admin.js`; `src/cli/commands/info.js`]

## Story

As an **Internal Automation Operator**,  
I want **a command `xactions admin status` that displays an overview of the governor, proxy pool, and hibernating accounts**,  
so that **I can quickly grasp system health and operational status directly from the terminal**.

## Acceptance Criteria

### AC-1: `xactions admin status` command exists

- **Given** the `xactions admin` command group
- **When** the operator runs `xactions admin status --help`
- **Then** the help text explains the command, its `--json` flag, and optional `--url` / `--token` parameters
- **And** the command is listed under `xactions admin --help`

[Source: `epics.md` Epic 19, Story 19.4, lines 1059-1063; `src/cli/commands/admin.js`]

### AC-2: Fetches governor status from REST or in-process source

- **Given** a running API server at `http://localhost:3001`
- **When** the operator runs `xactions admin status`
- **Then** it first attempts `GET /api/admin/governor/status` (or `/governor/status`) with an optional Bearer token
- **And** on HTTP 200 it extracts the nested status from the success envelope: `const status = (await res.json()).status`
- **And** if the HTTP call fails, it falls back to `globalStatusApi.getGovernorStatus()` after refreshing consumer lag via `refreshGovernorConsumerLag(globalAdaptiveRateGovernor, globalStreamMetricsReader)`

[Source: `src/core/status-api.js`; `src/utils/stream-metrics.js`; `api/routes/admin.js:363`]

### AC-3: Prints human-readable status summary

- **Given** a successful status fetch
- **When** the operator runs `xactions admin status` without `--json`
- **Then** it prints:
  - `Throttle Level` with color-coded status (`normal` green, `reduced` yellow, `backpressure` magenta, `critical` red)
  - `Healthy Proxies` as `healthyProxyCount / totalProxyCount` with percentage
  - `Current Req/Sec` as `currentReqPerSecond`
  - `Redis Consumer Lag` as `redisConsumerLag`
  - `Hibernating Accounts` count and, if non-empty, a list with `accountId`, remaining seconds, and `reason`
  - Optional `Dual-Pool` summary (`realtime` / `bulk` healthy/total) if present
  - Optional `Consumer Quotas` if present

[Source: `src/cli/commands/info.js:46-100`]

### AC-4: Supports `--json` flag for machine-readable output

- **Given** the operator needs scripted or machine-readable output
- **When** they run `xactions admin status --json`
- **Then** the command prints the raw `GovernorStatus` JSON with `JSON.stringify(status, null, 2)`
- **And** it includes all fields from the status contract: `healthyProxyCount`, `totalProxyCount`, `healthyProxyRatio`, `currentReqPerSecond`, `redisConsumerLag`, `hibernatingAccounts`, `throttleLevel`, `dualPool`, `consumerQuotas`

[Source: `src/core/types.js` GovernorStatus; `epics.md` Story 19.4.1, lines 1071-1074]

### AC-5: Reuses existing terminal formatting conventions

- **Given** the CLI output
- **When** rendered
- **Then** it uses `chalk` for colors and `chalk.bold` for labels, consistent with `src/cli/commands/admin.js` and `src/cli/commands/info.js`
- **And** it does not print raw object dumps, stack traces, or unredacted credentials

[Source: `src/cli/shared.js`; `src/cli/commands/admin.js:58-65`]

### AC-6: Handles offline and error states gracefully

- **Given** no server is running and in-process singletons are not initialized
- **When** the operator runs `xactions admin status`
- **Then** it displays a helpful error message using `printCliError()` and exits with non-zero status
- **And** it does not crash or leak internal error details beyond a generic message

[Source: `src/cli/shared.js`; `src/cli/commands/admin.js:66-68`]

## Tasks / Subtasks

- [ ] Task 1: Extract shared status rendering helper (AC: #3, #5)
  - [ ] 1.1 Create or update `src/cli/shared.js` with `formatGovernorStatus(status, { json })` or `printGovernorStatus(status, options)`
  - [ ] 1.2 Move the formatting logic from `src/cli/commands/info.js` status command into the shared helper
  - [ ] 1.3 Ensure the helper supports both terminal and JSON output
- [ ] Task 2: Refactor `xactions status` to use the shared helper (AC: #1, #3)
  - [ ] 2.1 Update `src/cli/commands/info.js` to import and call the shared formatter
  - [ ] 2.2 Verify `xactions status --json` and `xactions status` still produce identical output
- [ ] Task 3: Add `xactions admin status` command in `src/cli/commands/admin.js` (AC: #1, #2, #3, #4, #6)
  - [ ] 3.1 Register `adminCmd.command('status')` with `--url`, `--token`, and `--json` options
  - [ ] 3.2 Implement HTTP-first fetch to `/api/admin/governor/status` or `/governor/status`
  - [ ] 3.3 Implement in-process fallback: `refreshGovernorConsumerLag(...)` then `globalStatusApi.getGovernorStatus()`
  - [ ] 3.4 Call shared formatter; handle errors with `printCliError()`
- [ ] Task 4: Add CLI tests (AC: #1, #2, #3, #4, #6)
  - [ ] 4.1 Create `tests/cli/admin-status.test.js` that spawns `xactions admin status --json` and asserts on the JSON shape
  - [ ] 4.2 Verify in-process fallback works when API server is not reachable
  - [ ] 4.3 Verify color/non-JSON output includes required fields
  - [ ] 4.4 Verify `xactions admin status --help` and `xactions admin --help` include the `status` command
- [ ] Task 5: Run validations
  - [ ] 5.1 Run `vitest run tests/cli/admin-status.test.js`
  - [ ] 5.2 Run `vitest run tests/core/status-api.test.js` and any existing status CLI tests to ensure no regression
  - [ ] 5.3 Run `npm run typecheck` if configured
  - [ ] 5.4 Manual smoke test: `node src/cli/index.js admin status` and `node src/cli/index.js admin status --json` (or `npx xactions admin status` if package is linked)

## Dev Notes

### What Already Exists (Do Not Rebuild)

- **Status Contract**: `GovernorStatus` returned by `StatusApi.getGovernorStatus()` in `src/core/status-api.js`. Shape includes:
  - `healthyProxyCount`, `totalProxyCount`, `healthyProxyRatio`, `currentReqPerSecond`, `redisConsumerLag`
  - `hibernatingAccounts: Array<{ accountId, remainingSeconds, reason }>`
  - `throttleLevel: 'normal' | 'reduced' | 'backpressure' | 'critical'`
  - `dualPool: { realtime, bulk, yieldedCount }`
  - `consumerQuotas: Record<string, ConsumerStatus>`
- **Backend Endpoint**: `GET /api/admin/governor/status` in `api/routes/admin.js:363` (also accessible at `/governor/status`), guarded by `authenticateToken, requireAdmin`.
- **Lag Refresh**: `src/utils/stream-metrics.js` exports `refreshGovernorConsumerLag(governor, reader)` and `globalStreamMetricsReader`.
- **Top-level `xactions status`**: `src/cli/commands/info.js:46-100` already implements the exact color formatting and `--json` output this story requires.
- **CLI patterns**: `src/cli/commands/admin.js` (`stream metrics`, `stream alerts`) already demonstrate HTTP-first + in-process fallback, `--url`, `--token`, and `--json` options.

[Source: `src/core/status-api.js`; `src/core/adaptive-governor.js:562-577`; `api/routes/admin.js:360-385`; `src/utils/stream-metrics.js`; `src/cli/commands/info.js`; `src/cli/commands/admin.js`]

### Files to Modify

1. **`src/cli/commands/admin.js`** — add `admin status` command and register it under the `admin` group.
2. **`src/cli/shared.js`** — add a shared `formatGovernorStatus` / `printGovernorStatus` helper (recommended) or keep formatting inline if duplicating minimally.
3. **`src/cli/commands/info.js`** — refactor `xactions status` to use the shared formatter (avoid duplication).
4. **`_bmad-output/implementation-artifacts/sprint-status.yaml`** — update `19-4-1-admin-cli-status` to `ready-for-dev`.

### Files to Read but Not Modify

- `src/core/status-api.js` — governor status contract.
- `src/core/adaptive-governor.js` — source of status fields and dual-pool/consumer quota data.
- `src/utils/stream-metrics.js` — lag refresh helper.
- `api/routes/admin.js` — REST endpoint and auth guards.
- `src/cli/shared.js` — error formatting helpers.

### Architecture Compliance

- **No new backend endpoints** — reuse `GET /api/admin/governor/status`.
- **No new dependencies** — `chalk` and `commander` already available.
- **Shared formatter** — avoid duplicating the console rendering between `info.js` and `admin.js`.
- **Error handling** — use `printCliError()` and set `process.exitCode = 1` on failures.
- **Auth** — CLI uses optional `--token` as Bearer header. If running locally with in-process fallback, auth is implicitly bypassed because the caller has shell access.

### UX Requirements

- Output must match existing `xactions status` style for consistency.
- Color coding:
  - `normal` → green
  - `reduced` → yellow
  - `backpressure` → magenta
  - `critical` → red
- Throttle label aligned, metrics indented, hibernating accounts as bullet list.
- JSON mode must produce the full object exactly as `globalStatusApi.getGovernorStatus()` returns.

### Testing Notes

- Prefer tests that spawn the real CLI (`node bin/unfollowx admin status --json`) and assert on stdout.
- For in-process fallback, import `registerAdminCommand` and call the action directly with a `program` fixture (see `src/cli/commands/admin.js` test patterns).
- Do not mock `fetch` — either run against a real local API server fixture or test the fallback path.
- If testing direct action, set `NODE_ENV` or inject `globalStatusApi` / `globalAdaptiveRateGovernor` via the existing `src/core/index.js` exports.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Debug Log References

- Sprint status updated to `ready-for-dev` for `19-4-1-admin-cli-status` in `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- Existing status command located at `src/cli/commands/info.js:46-100`.
- Existing admin CLI stream commands located at `src/cli/commands/admin.js`.

### Completion Notes List

- TBD

### File List

- `src/cli/commands/admin.js` (update)
- `src/cli/shared.js` (update — add shared formatter)
- `src/cli/commands/info.js` (update — reuse shared formatter)
- `tests/cli/admin-status.test.js` (new)
- `_bmad-output/implementation-artifacts/19-4-1-admin-cli-status.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (update)

### Change Log

- 2026-09-02: Created comprehensive story context for Story 19.4.1 — Admin CLI Status.

## Suggested Review Order

1. `src/cli/shared.js` — shared `formatGovernorStatus` helper (if added)
2. `src/cli/commands/info.js` — refactored `xactions status` to use shared helper
3. `src/cli/commands/admin.js` — new `admin status` command and HTTP/in-process fallback
4. `tests/cli/admin-status.test.js` — real CLI or action-level tests
