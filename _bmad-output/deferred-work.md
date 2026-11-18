- source_plan: `_bmad-output/backlog/story-multiplatform-account-vault-plan.md`
  summary: AGENTS.md tool counts stale after adding 5 `x_accounts_*` tools ("152 MCP tools"/"60 KB" no longer accurate).
  evidence: AGENTS.md self-declares "single source of truth, kept current"; diff adds 5 tools to TOOLS in src/mcp/server.js. Deferred because the fix edits an agent-context file.
