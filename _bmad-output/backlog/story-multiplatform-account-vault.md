---
type: story
title: Multi-platform account vault with CLI + MCP management
parent:
covers: []
sources: []
companions: []
after: []
assignee:
refined: true
hitl: false
risk: medium
---

# Multi-platform account vault with CLI + MCP management

## Description

SQLite `vault_accounts` table in the existing `accounts.db`, plus
`xactions accounts add|list|remove|use|test` CLI subcommands and
`x_accounts_add|list|remove|use|test` MCP tools, so agents manage per-platform
credentials (X cookies, Bluesky identifier/password, Mastodon instance/token)
without touching cookie files by hand. Fully planned on 2026-11-19; the plan
file beside this ticket carries the schema, code map, and I/O matrix.

## Outcome

An agent (e.g. one driving the MCP server) can add, list, switch, and test
multi-platform accounts on its own. `accounts use` activates a stored X
session by writing `cookies.json` (with backup); stored Bluesky/Mastodon
credentials are ready for the deferred multi-platform wiring.

## Requirements

Verify: all acceptance criteria in `story-multiplatform-account-vault-plan.md`
(Tasks & Acceptance section).

## Constraints

- Credentials never leave the process unmasked — `list`/`test` return name,
  platform, proxy-presence, validity flags only.
- DB resolves through `resolveCacheDir()` (`$XACTIONS_HOME` aware); file mode 0600.
- New code only; no changes to `accountPool.js` internals or its tables.

## Done when

- [ ] `npx vitest run test/accountVault.test.js` passes
- [ ] `accounts add` → `list` → `use` → authed op round-trips on X, with no secrets printed
- [ ] `--platform threads` is rejected naming supported platforms

## Boundaries

- **Not**: Threads credential storage (anonymous scraper — nothing to store);
  wiring vault credentials into scrapers' options (deferred goal); account
  rotation/scheduling changes; `x_team_*` changes.
- **Blocked**: none — planned and buildable standalone.

## References

- `plan — _bmad-output/backlog/story-multiplatform-account-vault-plan.md` —
  intent, schema, code map, I/O edge-case matrix, acceptance criteria.

## Notes

- Adopted into the ticket tree 2026-11-19 from a `bmad-build` draft plan; feeds
  `epic-scheduling-queue` (multi-platform fan-out needs stored credentials) and
  `epic-official-api-lane` (OAuth token storage) when those epics are refined.
