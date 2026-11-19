- source_plan: `_bmad-output/backlog/story-multiplatform-account-vault-plan.md`
  summary: AGENTS.md tool counts stale after adding 5 `x_accounts_*` tools ("152 MCP tools"/"60 KB" no longer accurate).
  evidence: AGENTS.md self-declares "single source of truth, kept current"; diff adds 5 tools to TOOLS in src/mcp/server.js. Deferred because the fix edits an agent-context file.

## Scheduler: cross-process write race on scheduler.json

- **Source plan**: `bug-x-schedule-add-broken-plan.md` (quick lens finding)
- **Summary**: `Scheduler._save` uses plain `writeFileSync` with no lock or atomic rename; CLI, MCP server, and API server are separate processes — a CLI `add` racing an MCP `x_schedule_add` still loses the other writer's job (read-modify-write), only the same-process clobber is fixed.
- **Evidence**: `src/scheduler/scheduler.js` `_save` (~line 315). Atomic tmp+rename would fix torn writes but not lost updates — needs a file lock or single-writer design; sized beyond a oneshot.
