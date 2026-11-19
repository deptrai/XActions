---
title: 'Fix x_schedule_add / xactions schedule add arg mismatch (action → command)'
type: bugfix
ticket: 'bug-x-schedule-add-broken'
created: '2026-11-19'
status: built
baseline_revision: '58692b45'
route: oneshot
route_source: auto
risk: low
review: 'quick'
review_source: 'pinned'
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `xactions schedule add` (CLI) and `x_schedule_add` (MCP) pass `action:` to `Scheduler.addJob`, which requires `command:` — every add throws "Job requires: name, cron, command" and never persists. Only the two adapters are wrong; the scheduler itself is sound.

**Approach:** Rename the key to `command:` at both call sites. Keep the public surface unchanged — MCP input field `action` and CLI `-c/--command` flag stay as-is; only the internal call to `addJob` is fixed. Add regression tests covering both adapters.

## Boundaries & Constraints

**Always:**
- `scheduler.addJob` receives `{ name, cron, command, ... }`.
- MCP tool input schema keeps field name `action` (public API contract) — map `args.action` → `command` at the call site.
- Keep CLI default command `'echo "Job: <name>"'` and MCP default `args.name` when no command supplied.

**Never:**
- No changes to `src/scheduler/scheduler.js` internals (sound store).
- No rename of the public `action` input field on `x_schedule_add` (breaking MCP API).
- No new flags (`--every`, `--at`) — the ticket's aspirational CLI grammar stays out of scope; file separately if wanted.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CLI add with -c | `schedule add n1 "0 9 * * *" -c "echo hi"` | Job persisted in scheduler.json with command `echo hi` | none expected |
| CLI add without -c | `schedule add n2 "0 9 * * *"` | Job persisted with default `echo "Job: n2"` | none expected |
| CLI add missing cron | `schedule add n3` | commander usage error, no write | exit non-zero |
| MCP add with action | `{name:"m1", cron:"0 9 * * *", action:"echo hi"}` | Job persisted, command = `echo hi` | none expected |
| MCP add without action | `{name:"m2", cron:"0 9 * * *"}` | Job persisted, command = `m2` | none expected |
| add missing name/cron | either lane | `addJob` throws → CLI prints error line, MCP returns error | job not written |

</frozen-after-approval>

## Code Map

- `src/cli/index.js:2854` — CLI adapter; `action:` → `command:` key fix only.
- `src/mcp/server.js:3974` — MCP `x_schedule_add` case; `action:` → `command:` key fix only.
- `src/mcp/server.js:1743-1752` — `x_schedule_add` inputSchema (`action` field stays; description wrongly says "tweet queue" — may correct to generic job text, cosmetic only).
- `src/scheduler/scheduler.js:56-75` — `addJob` contract: `{name, cron, command, args, enabled, maxRetries, timeout}`; throws when `command` falsy. DO NOT CHANGE.
- `tests/scheduler/scheduler.test.js` — existing scheduler-store tests; add adapter regression coverage here or a new file beside it.

## Tasks & Acceptance

**Execution:**
- [x] `src/cli/index.js` — change `action:` key to `command:` at line 2854 — the bug.
- [x] `src/mcp/server.js` — change `action:` key to `command:` at line 3974 — the bug; optionally fix misleading "tweet queue" description at :1744-1753.
- [x] `tests/scheduler/` — add regression test: CLI add via commander invocation (or direct `addJob`-shape assertion through the adapter path) and MCP `executeTool('x_schedule_add', ...)` both produce a job with `command` set and write scheduler.json — use temp HOME.

**Acceptance Criteria:**
- Given temp HOME, when `xactions schedule add t1 "0 9 * * *" -c "echo hi"` runs, then `schedule list` shows t1 and `~/.xactions/scheduler.json` contains the job with `command: "echo hi"`.
- Given temp HOME, when `x_schedule_add` is invoked via MCP dispatch with `{name:"t2",cron:"* * * * *",action:"echo hi"}`, then the job persists with `command: "echo hi"`.

## Implementation Notes

Oneshot: bug is two wrong key names; fix is a rename plus tests. No investigation cost beyond the two call sites and the `addJob` signature, all in the Code Map.

**2026-11-19 implementation:** renamed `action:`→`command:` at `src/cli/index.js:2854` and `src/mcp/server.js:3974`. While testing, a second adapter bug surfaced: no caller ever invoked `scheduler.load()`, so every CLI `add` overwrote `scheduler.json` with only the newest job and `list`/`remove`/`run` always saw an empty map. Added `await scheduler.load()` to all 7 adapter sites (CLI add/list/remove/run + MCP add/list/remove) — `load()` re-registers by name so repeated calls are idempotent. Also fixed the `x_schedule_*` tool descriptions (they said "tweet queue" — the scheduler is a generic cron runner). Files: `src/cli/index.js`, `src/mcp/server.js`, `tests/scheduler/adapters.test.js` (new, 6 cases incl. clobber regression pin). `npx vitest run tests/scheduler/` = 13/13 pass; live smoke on temp HOME: add+add+list all work, both jobs persisted on disk.

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run tests/scheduler/` — expected: all pass incl. new regression tests.
- `HOME=$(mktemp -d) node src/cli/index.js schedule add t1 "0 9 * * *" -c "echo hi" && HOME=that node src/cli/index.js schedule list` — expected: job added, visible in list; `cat $HOME/.xactions/scheduler.json` shows `"command": "echo hi"`.
- MCP smoke via `executeTool` path in the regression test — expected: job persisted.

## Review Triage Log

| # | Finding | File | Verdict | Route |
|---|---|---|---|---|
| F1 | API lane `api/routes/schedule.js` has same bug: 4 routes without `load()` — list always empty, add clobbers, delete/run report false success | api/routes/schedule.js | high | patch |
| F2 | `scheduler.load()`/`addJob` use `console.log` → corrupts stdio JSON-RPC now that the paths are reachable | src/mcp/server.js | high | patch (console.log→stderr in stdio transport) |
| F3 | `_registerJob` overwrites `jobs.set` without stopping prior cronTask — task leak on repeated `load()` in long-lived MCP server | src/scheduler/scheduler.js | medium | patch |
| F4 | `removeJob`/`runJobNow` return `{error}` not throw — adapters report success on missing job | src/cli/index.js, src/mcp/server.js, api/routes/schedule.js | medium | patch |
| F5 | `x_schedule_list` description promises "next run" but `listJobs()` returns no nextRun | src/mcp/server.js | low | patch (description) |
| F6 | Cross-process write race: no lock/atomic write on `scheduler.json` — CLI vs MCP concurrent add still loses updates | src/scheduler/scheduler.js | medium | defer → `../../deferred-work.md` |
| F7 | New test file missing `@author` header (house style) | tests/scheduler/adapters.test.js | low | patch |
| F8 | Plan task checkboxes unchecked | this file | low | patch |

Patches applied (same commit): API routes `load()` + 404-on-error; stdio transport redirects `console.log` to stderr; `_registerJob` stops replaced task; CLI/MCP/API honor `{error}` returns; `x_schedule_list` description lists real fields; `@author` header; checkboxes ticked.
