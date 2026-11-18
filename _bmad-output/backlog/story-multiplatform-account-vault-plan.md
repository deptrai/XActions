---
title: 'Multi-platform account vault with CLI + MCP management'
type: feature
ticket: 'story-multiplatform-account-vault'
created: '2026-11-19'
status: in-progress
baseline_revision: '61f24dddf69ffc59ee2bb9881400db56bb758b3e'
route: full
route_source: auto
risk: medium
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** XActions stores only one X session (`~/.xactions/cookies.json`) and a Twitter-only pool (`accounts.db`) that no CLI/MCP surface can manage — agents (e.g. Hermes) calling the MCP server cannot add, list, switch or check accounts, and nothing stores Bluesky/Mastodon credentials at all.

**Approach:** Add `accountVault` — a SQLite table (`vault_accounts` in the existing `accounts.db`) holding per-platform accounts (`platform`, `name`, credentials JSON, `proxy`) — plus `xactions accounts add|list|remove|use|test` CLI subcommands and `x_accounts_add|list|remove|use|test` MCP tools, so any agent manages its own multi-platform accounts.

## Boundaries & Constraints

**Always:**
- Credentials never leave the process unmasked: `list`/`test` return name, platform, proxy-presence and validity flags only — never raw tokens/cookies.
- DB resolves through `resolveCacheDir()` (honours `$XACTIONS_HOME`, not the CLI's hardcoded `~/.xactions`).
- Twitter cookies normalized through the existing `parseCookieInput` (accepts string, cookies.txt, Cookie-Editor JSON, Playwright storageState) — same shapes `login --cookies-file` accepts.
- MCP tools are local-only (registered in `local-tools.js` toolMap), grouped under a new `accounts` group via `x_accounts_` prefix, and NOT added to `WRITE_TOOLS` (local state ops, no X action charge, no draft approval).
- New code only; no changes to `accountPool.js` internals or its `accounts`/`rate_limits` tables.

**Never:**
- No credential storage for Threads (its scraper is anonymous — nothing to store).
- No wiring of vault credentials into scrapers' `options` or the broken `x_*_multiplatform` tools — deferred goal.
- No account rotation/scheduling changes, no changes to `x_team_*` (teams store metadata, not credentials).
- No plaintext credential echo in any output (CLI, MCP, logs, errors).
- No secrets through MCP arguments by default: `x_accounts_add` accepts credential inputs as file paths (`cookies_file` for twitter, `credentials_file` for bluesky/mastodon) that the server reads itself; inline secret params are permitted but file-path is the preferred, documented form — secrets should never enter the MCP conversation log.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| add twitter | name + cookies file/string + optional proxy | row upserted in `vault_accounts`; cookies normalized | missing `auth_token` → clear error, no write |
| add bluesky | name + identifier + password (+optional service, proxy) | row upserted | missing identifier/password → error listing required fields |
| add mastodon | name + instance + accessToken (+optional proxy) | row upserted | missing instance → error |
| add threads | --platform threads | rejected up front | "threads has no credentials to store" error |
| duplicate add | same platform+name | upsert: replace credentials+proxy, keep `added_at` | n/a |
| list | any | platform, name, proxy host only, added_at; secrets masked | empty pool → friendly "no accounts" message |
| remove | platform + name | row deleted | not found → exit code != 0 + message |
| use twitter | name exists | backs up existing `cookies.json` (→ `.bak`) then writes new (0600) = active session | not found / non-twitter platform → clear error |
| test | platform + name | light authed check → `ok: true/false` + reason, never credentials | invalid creds → `ok:false`, do NOT lock row |
| unknown platform | --platform xyz | rejected | list valid platforms in error |
| add via MCP file path | name + `cookies_file`/`credentials_file` path | server reads the file itself; vault row written; response contains no credential material | unreadable/invalid file → error, no write |

</frozen-after-approval>

## Code Map

- `src/vault/accountVault.js` -- NEW: `createAccountVault()` → `{add, get, list, remove, use, test, close}`; `better-sqlite3` on `path.join(resolveCacheDir(),'accounts.db')`, table `vault_accounts(platform,name,credentials TEXT JSON,proxy,locked,added_at,last_used, PK(platform,name))`; `chmod 0600` on db file
- `src/scrapers/twitter/http/accountPool.js` -- REUSE: `normalizeCookies`/`resolveCacheDir` patterns; the `:393` error string already promises `xactions accounts add` — this plan fulfils it
- `src/client/auth/cookieImport.js` -- REUSE: `parseCookieInput` for all cookie file formats
- `src/cli/commands/accounts.js` -- NEW: `registerAccountsCommand(program)`; mirror `doctor.js:467`/`skills.js:424` commander pattern
- `src/cli/index.js` -- import after :33, register call after :310 (before "Auth Commands" banner)
- `src/mcp/local-tools.js` -- add 5 handlers to `toolMap` (:1781): `x_accounts_add|list|remove|use|test`
- `src/mcp/server.js` -- append 5 entries to `TOOLS` (:79) with inputSchemas
- `src/mcp/tool-groups.js` -- `GROUP_RULES` (:42): add `{group:'accounts', prefixes:['x_accounts_']}` BEFORE rules matching `x_account_report` etc. (plural prefix is collision-free)
- `src/scrapers/bluesky/index.js:29` -- credential shape `{service?, identifier, password}`
- `src/scrapers/mastodon/index.js:27` -- credential shape `{instance, accessToken}`
- `src/scrapers/index.js:102-110` -- `platforms` map: canonical platform names to accept
- `test/accountVault.test.js` -- NEW vitest file; vault over tmp `$XACTIONS_HOME`

## Tasks & Acceptance

**Execution:**
- [ ] `src/vault/accountVault.js` -- implement vault (schema above; `use(twitter)` writes cookies.json; `test` does a light authed call per platform — twitter: any authed op other than `UserByRestId` (currently 403-blocked upstream); bluesky: login; mastodon: verify_credentials) -- core store
- [ ] `src/cli/commands/accounts.js` + `src/cli/index.js` -- `accounts add|list|remove|use|test` with `--platform` (required on all but `list`), `--cookies-file`, `--cookies`, `--proxy`, `--identifier`, `--password`, `--service`, `--instance`, `--access-token` -- user/agent CLI surface
- [ ] `src/mcp/server.js` + `src/mcp/local-tools.js` + `src/mcp/tool-groups.js` -- 5 `x_accounts_*` tools, `accounts` group, handlers delegate to vault -- agent self-management surface
- [ ] `test/accountVault.test.js` -- cover I/O matrix: upsert, mask, remove-miss, use writes cookies.json, threads rejection, per-platform required-field errors -- edge-case coverage

**Acceptance Criteria:**
- Given an X cookies file, when `xactions accounts add --platform twitter --name a1 --cookies-file f.json --proxy http://p:8080`, then `accounts list` shows `a1` with proxy host and no secrets, and `accounts use a1` activates that session.
- Given valid Bluesky creds in vault, when an MCP client calls `x_accounts_list`, then the response contains the account's name/platform/proxy-presence and never password/token values.
- Given `--platform threads` on `add`, when invoked, then the call fails with a message naming supported platforms.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

One store, two roles: `vault_accounts` (new, all platforms, credential JSON) lives in the same `accounts.db` file as the twitter `accounts` pool table but is managed independently — no schema migration, no coupling. `use` bridges vault→active session only where a live session concept exists (twitter → cookies.json); Bluesky/Mastodon rows are stored credentials ready for the deferred multiplatform-wiring goal. Threads is rejected at input validation because its scraper is anonymous by design.

## Verification

**Commands:**
- `npx vitest run test/accountVault.test.js` -- expected: all pass
- `node src/cli/index.js accounts add --platform twitter --name t1 --cookies-file <cookies.json> && node src/cli/index.js accounts list` -- expected: `t1` listed, no cookie values printed
- `node src/cli/index.js accounts use t1 && node src/cli/index.js profile nasa` -- expected: profile returned using activated session
- `node src/cli/index.js accounts add --platform threads --name z --cookies x` -- expected: error naming supported platforms
