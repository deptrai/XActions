- source_plan: `_bmad-output/backlog/story-multiplatform-account-vault-plan.md`
  summary: AGENTS.md tool counts stale after adding 5 `x_accounts_*` tools ("152 MCP tools"/"60 KB" no longer accurate).
  evidence: AGENTS.md self-declares "single source of truth, kept current"; diff adds 5 tools to TOOLS in src/mcp/server.js. Deferred because the fix edits an agent-context file.

## Scheduler: cross-process write race on scheduler.json

- **Source plan**: `bug-x-schedule-add-broken-plan.md` (quick lens finding)
- **Summary**: `Scheduler._save` uses plain `writeFileSync` with no lock or atomic rename; CLI, MCP server, and API server are separate processes — a CLI `add` racing an MCP `x_schedule_add` still loses the other writer's job (read-modify-write), only the same-process clobber is fixed.
- **Evidence**: `src/scheduler/scheduler.js` `_save` (~line 315). Atomic tmp+rename would fix torn writes but not lost updates — needs a file lock or single-writer design; sized beyond a oneshot.

---

# [FIXED 2026-11-19] Defect: `x_accounts_use` can clobber the live session with a stale vault row
**Found by:** code review + live incident (2026-11-19)
**Deferred from:** vault walkthrough — real cookies.json was overwritten by a fake credential stored in the vault (`tok-abc` from a demo add), and the single-generation `cookies.json.bak` could only roll back one hop. Recovery required re-importing from the original Playwright export.
**Next step when picked up:** timestamped rotating backups (keep N=5), and/or `use` runs a cheap connectivity `test` on the stored creds before activating — refuse or warn loudly on 401.

# [FIXED 2026-11-19] Defect: MCP browser lane never re-applies session after `x_accounts_use`
**Found by:** live testing (2026-11-19)
**Deferred from:** vault MCP test — `ensureBrowser()` (src/mcp/local-tools.js:95) applies `cookies.json` once at first launch, then caches `{browser, page}` for the process lifetime. After `x_accounts_use` swaps the session file, every browser-lane tool keeps using the stale logged-out page and silently returns `[]`. Only an MCP server restart picks up the new session.
**Next step when picked up:** track session file mtime/hash in ensureBrowser and re-inject on change, or have `x_accounts_use` explicitly disconnect the cached browser so the next call rebuilds it.
