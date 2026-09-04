---
story_id: "19.4"
epic: 19
story_key: "19-4-admin-cli-unified-command-group"
status: "review"
phase: "Phase 5"
created: "2026-09-03"
updated: "2026-09-04"
owner: "DEV"
reviewed: "Pending"
baseline_commit: "eea21df47d22c333b31682442bd8cfd63f6683dd"
---

# Story 19.4: Admin CLI — Unified Command Group

Status: review

## ⚠️ Critical Constraints / Architecture Variance

1. **Command-Group Skeleton Only** — This story sets up the `xactions admin` command group so that `xactions admin --help` lists all planned subcommands (`status`, `proxies`, `accounts`, `checkpoints`, `stream`). The functional implementation of `status` is in Story 19.4.1 (already `done`) and `stream metrics/alerts` already exists in `src/cli/commands/admin.js`; `proxies`, `accounts`, and `checkpoints` subcommands should be registered as command groups with `--help` descriptions and at least one initial `list` subcommand each to satisfy the help contract, but their full write/operate actions live in Stories 19.4.2–19.4.4.
2. **Do Not Duplicate Existing Commands** — `xactions admin status` and `xactions admin stream [metrics|alerts]` already exist. Only register them once. Do not move or rename them.
3. **Backward Compatibility** — The existing top-level `xactions checkpoints ...` and `xactions stream ...` command trees must remain fully functional and registered in `src/cli/index.js`. Any new `admin` subcommands may reuse or wrap their logic, but must not break existing callers.
4. **Shared Conventions** — All new subcommands must use `--url`, `--token`, `--json` options, the `baseUrl` resolution pattern, `printCliError()` for errors, and HTTP-first/in-process fallback already established by 19.4.1.
5. **No Puppeteer / Browser Code** — This is a CLI-only story. Do not import puppeteer or browser automation modules.
6. **No Inline Epic/Story References in Source** — Do not add comments like `# Story 19.4` to source files.
7. **No Mocks in Tests** — CLI tests must instantiate real `Commander.Command` objects and exercise real registration functions. No `vi.fn` stubs for `fetch` or `console.log`.

[Source: `epics.md` Epic 19, Story 19.4, lines 1054–1063; `src/cli/commands/admin.js`; `src/cli/commands/checkpoints.js`; `src/cli/commands/stream.js`; `src/cli/shared.js`]

## Story

As an **Internal Automation Operator**,  
I want **a unified `xactions admin` command group with clearly listed subcommands for status, proxies, accounts, checkpoints, and stream operations**,  
so that **I can discover all operational controls from a single CLI entry point without reading the dashboard or source code**.

## Acceptance Criteria

### AC-1: `xactions admin --help` lists all planned subcommands

- **Given** the `xactions admin` command group
- **When** the operator runs `xactions admin --help`
- **Then** the output includes subcommands `status`, `proxies`, `accounts`, `checkpoints`, `stream`
- **And** each subcommand has a concise description

[Source: `epics.md` Epic 19, Story 19.4, lines 1059–1062]

### AC-2: Subcommand groups expose their own `--help`

- **Given** the unified admin command group
- **When** the operator runs `xactions admin <subcommand> --help` for any of `proxies`, `accounts`, `checkpoints`, `stream`
- **Then** the help text explains the subcommand and its available actions
- **And** at minimum a `list` action is documented under each group

### AC-3: Existing `xactions admin status` and `xactions admin stream metrics/alerts` remain unchanged

- **Given** the existing `src/cli/commands/admin.js`
- **When** this story is implemented
- **Then** `xactions admin status`, `xactions admin stream metrics`, and `xactions admin stream alerts` continue to work exactly as before
- **And** their option flags (`--url`, `--token`, `--json`) and output formatting are preserved

[Source: `src/cli/commands/admin.js:23–162`; `tests/cli/admin-status.test.js`]

### AC-4: New `list` subcommands for proxies, accounts, checkpoints

- **Given** the operator has admin permissions
- **When** they run `xactions admin proxies list`, `xactions admin accounts list`, or `xactions admin checkpoints list`
- **Then** the command first attempts the appropriate `/api/admin/*` or `/api/checkpoints` REST endpoint with optional Bearer token
- **And** on HTTP 200 it extracts the data from the success envelope (`data.proxies`, `data.accounts`, `data.result || data`)
- **And** if the endpoint is unreachable or returns a non-2xx, it falls back to the equivalent in-process domain call (`globalProxyPool.listProxies()`, `globalAccountPool.listAccountDetails(...)`, `listCheckpoints(...)`)

[Source: `api/routes/admin.js:383–597`; `src/store/checkpoint-manager.js`; `src/cli/shared.js`]

### AC-5: Consistent human-readable and JSON output

- **Given** any new `admin <group> list` command
- **When** the operator runs it without `--json`
- **Then** it prints a concise, aligned summary (count + key fields) using `chalk`
- **And** when run with `--json`, it prints the raw JSON payload with `JSON.stringify(..., null, 2)`

### AC-6: Graceful error handling

- **Given** the API server is down and the in-process singleton is not initialized
- **When** the operator runs any new `admin <group> list` command
- **Then** the command prints a helpful error message via `printCliError()` and exits with non-zero status
- **And** it does not crash or leak internal stack traces

[Source: `src/cli/shared.js`; `src/cli/commands/admin.js`]

## Tasks / Subtasks

- [x] Task 1: Analyze existing admin CLI structure and plan command hierarchy (AC: #1, #2, #3)
  - [x] 1.1 Read `src/cli/commands/admin.js`, `src/cli/commands/checkpoints.js`, `src/cli/commands/stream.js`, `src/cli/index.js`, `src/cli/shared.js`
  - [x] 1.2 Confirm existing `status` and `stream` subcommands are preserved
  - [x] 1.3 Design subcommand hierarchy: `proxies [list]`, `accounts [list]`, `checkpoints [list]`
- [x] Task 2: Add subcommand groups to `xactions admin` (AC: #1, #2, #3)
  - [x] 2.1 Register `adminCmd.command('proxies')` with `.description(...)` and a `list` subcommand
  - [x] 2.2 Register `adminCmd.command('accounts')` with `.description(...)` and a `list` subcommand
  - [x] 2.3 Register `adminCmd.command('checkpoints')` with `.description(...)` and a `list` subcommand
  - [x] 2.4 Ensure `xactions admin --help` and `xactions admin <group> --help` display correctly
- [x] Task 3: Implement `xactions admin proxies list` (AC: #4, #5, #6)
  - [x] 3.1 HTTP fetch to `/api/admin/proxies` with `--url`/`--token`/`--json`
  - [x] 3.2 In-process fallback to `globalProxyPool.listProxies()`
  - [x] 3.3 Print summary table or raw JSON
- [x] Task 4: Implement `xactions admin accounts list` (AC: #4, #5, #6)
  - [x] 4.1 HTTP fetch to `/api/admin/accounts?platform=...` with optional `--platform`
  - [x] 4.2 In-process fallback to `globalAccountPool.listAccountDetails(platform)`
  - [x] 4.3 Print summary table or raw JSON
- [x] Task 5: Implement `xactions admin checkpoints list` (AC: #4, #5, #6)
  - [x] 5.1 HTTP fetch to `/api/checkpoints` with filter/pagination options
  - [x] 5.2 In-process fallback to `listCheckpoints({..., prisma})`
  - [x] 5.3 Print summary table or raw JSON and disconnect Prisma safely
- [x] Task 6: Add CLI tests (AC: #1, #2, #3, #4)
  - [x] 6.1 Create `tests/cli/admin-unified.test.js` asserting command group help lists subcommands
  - [x] 6.2 Add tests for `proxies list`, `accounts list`, `checkpoints list` registration and options
  - [x] 6.3 Verify real `Commander.Command` instances are used (no mocks)
- [x] Task 7: Run validations
  - [x] 7.1 Run `vitest run tests/cli/admin-unified.test.js` — PASS
  - [x] 7.2 Run `vitest run tests/cli/admin-status.test.js` — PASS
  - [x] 7.3 Run `vitest run tests/cli/*.test.js` — PASS
  - [x] 7.4 Manual smoke: `node src/cli/index.js admin --help` and `node src/cli/index.js admin proxies --help`

## Dev Notes

### What Already Exists (Do Not Rebuild)

- **`xactions admin status`**: `src/cli/commands/admin.js:24–58` — full implementation with HTTP/in-process fallback and `printGovernorStatus`.
- **`xactions admin stream metrics` and `xactions admin stream alerts`**: `src/cli/commands/admin.js:60–161` — same pattern.
- **`xactions checkpoints ...`**: `src/cli/commands/checkpoints.js` — existing top-level command group with `list`, `show`, `resume`, `pause`, `retry`.
- **`xactions stream ...`**: `src/cli/commands/stream.js` — existing top-level command group for streaming.
- **REST endpoints**:
  - `GET /api/admin/proxies` → `api/routes/admin.js:387–406`
  - `POST /api/admin/proxies/:key/quarantine|release` → `api/routes/admin.js:427–484`
  - `GET /api/admin/accounts` → `api/routes/admin.js:490–505`
  - `POST /api/admin/accounts/:id/wake|rotate` → `api/routes/admin.js:512–597`
  - `GET /api/checkpoints` → `api/routes/checkpoints.js`
  - `GET /api/checkpoints/:id`, `POST /api/checkpoints/:id/resume|pause|retry` → `api/routes/checkpoints.js`
- **In-process domain APIs**:
  - `globalProxyPool.listProxies()` in `src/proxy/proxy-pool.js`
  - `globalAccountPool.listAccountDetails(platform)` in `src/core/account-pool.js`
  - `listCheckpoints({ ... })` in `src/store/checkpoint-manager.js`
- **Shared CLI helpers**: `printCliError`, `printGovernorStatus`, `parseCliPositiveInt`, `parseCliNonNegativeInt` in `src/cli/shared.js`.

### Files to Modify

1. `src/cli/commands/admin.js` — add `proxies`, `accounts`, `checkpoints` subcommand groups and `list` actions.
2. `src/cli/shared.js` — add or reuse table-formatting helpers for proxy/account/checkpoint lists.
3. `tests/cli/admin-unified.test.js` — new test file for command group structure.
4. `_bmad-output/implementation-artifacts/sprint-status.yaml` — update `19-4-admin-cli-unified-command-group` to `ready-for-dev`.
5. `_bmad-output/implementation-artifacts/19-4-admin-cli-unified-command-group.md` — this story file.

### Files to Read but Not Modify

- `src/cli/index.js` — command registration order.
- `src/cli/commands/checkpoints.js` — existing checkpoint CLI logic to reuse/wrap.
- `src/cli/commands/stream.js` — existing stream CLI logic.
- `api/routes/admin.js` — admin REST endpoints.
- `api/routes/checkpoints.js` — checkpoint REST endpoints.
- `src/proxy/proxy-pool.js` — proxy pool API.
- `src/core/account-pool.js` — account pool API.
- `src/store/checkpoint-manager.js` — checkpoint manager API.

### Architecture Compliance

- **No new backend endpoints** — reuse existing `/api/admin/*` and `/api/checkpoints` endpoints.
- **No new dependencies** — `chalk` and `commander` already available.
- **Shared formatting** — place domain-agnostic renderers in `src/cli/shared.js` to avoid duplication.
- **Error handling** — use `printCliError()` and set `process.exitCode = 1` on failures.
- **Auth** — CLI uses optional `--token` as Bearer header. Local fallback implicitly bypasses auth because the caller has shell access.
- **Prisma cleanup** — when using in-process checkpoint operations, disconnect Prisma with `disconnectPrisma(prisma)` in `finally`.

### UX Requirements

- `xactions admin --help` must read like a single operational dashboard entry point.
- Each `list` output should show a count and a short aligned table of key fields.
- JSON mode must produce the full response object exactly as the REST endpoint returns it.

### Testing Notes

- Prefer tests that instantiate real `Commander.Command` objects and call `registerAdminCommand(program)`.
- For in-process fallback, set `NODE_ENV` or inject singletons via `src/core/index.js` exports.
- Do not mock `fetch`; either run against a real local API server fixture or test the fallback path.
- Help-text tests can capture `program.commands.find(c => c.name() === 'admin').helpInformation()` and assert on substrings.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Debug Log References

- Existing `admin status` implementation: `src/cli/commands/admin.js:24–58`
- Existing `admin stream` commands: `src/cli/commands/admin.js:60–161`
- Existing top-level `checkpoints`: `src/cli/commands/checkpoints.js`
- Existing top-level `stream`: `src/cli/commands/stream.js`
- Admin REST routes: `api/routes/admin.js:360–597`
- Checkpoint REST routes: `api/routes/checkpoints.js`

### Completion Notes List

- 2026-09-04: Added `proxies`, `accounts`, `checkpoints` subcommand groups to `xactions admin` with `list` actions.
- 2026-09-04: Implemented HTTP-first / in-process fallback for `admin proxies list`, `admin accounts list`, `admin checkpoints list`.
- 2026-09-04: Added `tests/cli/admin-unified.test.js` with 10 tests covering command registration, help text, options, and preservation of existing `status`/`stream` commands.
- 2026-09-04: All CLI tests pass: `tests/cli/admin-unified.test.js` (10/10), `tests/cli/admin-status.test.js` (5/5), `tests/cli/*.test.js` (73/73).

### File List

- `src/cli/commands/admin.js` (update)
- `src/cli/shared.js` (update — shared list formatters)
- `tests/cli/admin-unified.test.js` (new)
- `_bmad-output/implementation-artifacts/19-4-admin-cli-unified-command-group.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (update)

### Change Log

- 2026-09-03: Created comprehensive story context for Story 19.4 — Admin CLI Unified Command Group.

## Suggested Review Order

1. `src/cli/shared.js` — new shared list formatters
2. `src/cli/commands/admin.js` — command group registration and `list` subcommands
3. `tests/cli/admin-unified.test.js` — command group structure and help text tests
