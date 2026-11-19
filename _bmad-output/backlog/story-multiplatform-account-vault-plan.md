---
title: 'Multi-platform account vault with CLI + MCP management'
type: feature
ticket: 'story-multiplatform-account-vault'
created: '2026-11-19'
status: built
baseline_revision: '61f24dddf69ffc59ee2bb9881400db56bb758b3e'
route: full
route_source: auto
risk: medium
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
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
- [x] `src/vault/accountVault.js` -- implement vault (schema above; `use(twitter)` writes cookies.json; `test` does a light authed call per platform — twitter: any authed op other than `UserByRestId` (currently 403-blocked upstream); bluesky: login; mastodon: verify_credentials) -- core store
- [x] `src/cli/commands/accounts.js` + `src/cli/index.js` -- `accounts add|list|remove|use|test` with `--platform` (required on all but `list`), `--cookies-file`, `--cookies`, `--proxy`, `--identifier`, `--password`, `--service`, `--instance`, `--access-token` -- user/agent CLI surface
- [x] `src/mcp/server.js` + `src/mcp/local-tools.js` + `src/mcp/tool-groups.js` -- 5 `x_accounts_*` tools, `accounts` group, handlers delegate to vault -- agent self-management surface
- [x] `test/accountVault.test.js` (implemented at `tests/accountVault.test.js` — vitest only includes `tests/**`) -- cover I/O matrix: upsert, mask, remove-miss, use writes cookies.json, threads rejection, per-platform required-field errors -- edge-case coverage

**Acceptance Criteria:**
- Given an X cookies file, when `xactions accounts add --platform twitter --name a1 --cookies-file f.json --proxy http://p:8080`, then `accounts list` shows `a1` with proxy host and no secrets, and `accounts use a1` activates that session.
- Given valid Bluesky creds in vault, when an MCP client calls `x_accounts_list`, then the response contains the account's name/platform/proxy-presence and never password/token values.
- Given `--platform threads` on `add`, when invoked, then the call fails with a message naming supported platforms.

## Implementation Notes

## Plan Change Log

- 2026-11-19 (implementation): Tasks 1-4 complete. Deviations from plan text, all deliberate:
  - Test file lives at `tests/accountVault.test.js` (plan said `test/`); `vitest.config.js` only includes `tests/**/*.test.js`, so the plan path would never run.
  - `--platform` is optional on `use`/`remove`/`test` (plan said "required on all but list"): the plan's own verification command `accounts use t1` carries no `--platform`. When omitted, the name is resolved across platforms; an ambiguous name errors listing the candidates. `add` and bare-name-less calls still require it.
  - `accounts add` accepts the name both positionally (`accounts add t1`) and via `--name` (plan's acceptance syntax); `--cookies <string>` added alongside `--cookies-file`.
  - MCP `x_accounts_add` accepts `credentials_file`/`cookies_file` path params in addition to inline fields — the file-path form keeps secrets out of tool args (coordinator security requirement).
  - CLI `use` writes `cookies.json` under `resolveCacheDir()` (honours `$XACTIONS_HOME`, default `~/.xactions`), matching the rest of the stack; the CLI's own `COOKIE_FILE` constant is hardcoded to `~/.xactions` and was left untouched.

## Review Triage Log

- quick lens — `src/mcp/server.js` remote mode advertises `x_accounts_*` but never dispatches them (localTools only populated in local mode; falls to `remoteClient.execute` → error). Verified at server.js:2489-2490,2726. **medium → patch**
- quick lens — `use` writes `cookies.json` to `resolveCacheDir()` but CLI reads `os.homedir()/.xactions` (cli/index.js:41,66); under `$XACTIONS_HOME` activation silently doesn't reach reads. **medium → patch** (grouped with next row: `use` diverges from canonical session-write path)
- quick lens — `use` doesn't mirror `auth_token`/`ct0` into `config.json` like `saveImportedSession` (cli/index.js:70-72); `loadSavedSession` falls back to stale `config.json` tokens (savedSession.js:69-75) → mixed-session risk if jar removed. **low → patch** (same root cause as row above)
- quick lens — `accounts.db-wal`/`-shm` sidecars not chmod 0600; credentials sit in WAL until checkpoint, world-readable on multi-user machines. Verified: only main db file chmod'd in vault open. **low → patch**
- quick lens — `test` calls `touch()` before connectivity outcome → `last_used` lies on failed checks. **low → patch**
- quick lens — `AGENTS.md` "152 tools / 60 KB" now stale. Fix edits agent-context file. **defer**
- quick lens — `tests/accountVault.test.js` sets `process.env.HOME` without restore → env leak across same-worker tests. **low → patch**
- quick lens — `src/cli/commands/accounts.js` header says `~/.xactions/accounts.db`, actual default is `resolveCacheDir()/accounts.db`. Cosmetic comment fix. **low → patch**

## Design Notes

One store, two roles: `vault_accounts` (new, all platforms, credential JSON) lives in the same `accounts.db` file as the twitter `accounts` pool table but is managed independently — no schema migration, no coupling. `use` bridges vault→active session only where a live session concept exists (twitter → cookies.json); Bluesky/Mastodon rows are stored credentials ready for the deferred multiplatform-wiring goal. Threads is rejected at input validation because its scraper is anonymous by design.

## Verification

**Commands:**
- `npx vitest run test/accountVault.test.js` -- expected: all pass
- `node src/cli/index.js accounts add --platform twitter --name t1 --cookies-file <cookies.json> && node src/cli/index.js accounts list` -- expected: `t1` listed, no cookie values printed
- `node src/cli/index.js accounts use t1 && node src/cli/index.js profile nasa` -- expected: profile returned using activated session
- `node src/cli/index.js accounts add --platform threads --name z --cookies x` -- expected: error naming supported platforms

## Code Review

### 2026-11-19 — thorough review (4 lenses) — 1 decision-needed, 9 patch, 1 deferred, 1 rejected

- [x] [Review][Decision] Approval-gate scope for `x_accounts_use`/`x_accounts_remove` — both bypass the `WRITE_TOOLS` approval gate by design, yet `use` replaces the live session and `remove` irreversibly deletes credentials; under `XACTIONS_MCP_REQUIRE_APPROVAL=1` an agent could still do both silently. Options: (a) add `use`/`remove` to `WRITE_TOOLS` so the gate holds them; (b) document the exception in the tool descriptions. Recommended: (a) — destructive local ops deserve the same gate as remote writes.
- [x] [Review][Patch] `use()` writes the session jar only to `os.homedir()/.xactions`, missing `resolveCacheDir()` readers under `$XACTIONS_HOME` (savedSessionCookie/sessionFetch) — activated account silently doesn't reach the HTTP-scraper lane [src/vault/accountVault.js:215]
- [x] [Review][Patch] No validation at credential boundaries — service/instance accepts explicit `http://`, proxy string never parsed at add, array-form cookies skip `parseCookieInput` domain/charset checks (name injection into outbound Cookie header), `test()` returns raw `error.message` that can embed URLs/hosts [src/vault/accountVault.js]
- [x] [Review][Patch] `test()` ignores the stored proxy on all three platforms — `defaultTwitterTest` discards its `_proxy` arg; bsky/masto fns take no proxy [src/vault/accountVault.js]
- [x] [Review][Patch] File-permission coverage gaps — vault dir mkdir without mode 0700, `-journal` sidecar not chmod'd, `cookies.json.bak` inherits the old file's (possibly lax) mode, no mode assertions in tests [src/vault/accountVault.js]
- [x] [Review][Patch] `use()` ordering/atomicity — `mirrorSessionTokens` runs after the jar swap (throw → half-applied session), corrupt `config.json` gets clobbered to just token keys, `.bak` is single-generation and the jar write is non-atomic [src/vault/accountVault.js:540]
- [x] [Review][Patch] Secrets through CLI argv — `--cookies`/`--identifier`/`--password`/`--access-token` land in `ps` and shell history; add `--credentials-file` for all platforms and mark inline flags non-preferred [src/cli/commands/accounts.js]
- [x] [Review][Patch] Behavior-assertion coverage gaps — `last_used` untouched on failed test, `added_at` preserved on upsert, CLI exit-code-1 on failed `test`, `csrfToken`-delete branch — all unverified [tests/accountVault.test.js]
- [x] [Review][Patch] Surface-coverage gaps — remote-mode `x_accounts_` dispatch, reverse-check of the 5 TOOLS declarations, `use`/`remove`/`test` MCP handlers, authed-op leg (manual-only) untested [tests/]
- [x] [Review][Patch] Small guards — `':memory:'` dbPath uncaught, stale `~/.xactions/accounts.db` string in an MCP tool description, dead `locked` column never set, unvalidated account name (control chars), `JSON.parse(row.credentials)` outside try → raw SyntaxError [src/vault/accountVault.js, src/mcp/server.js]
- [x] [Review][Defer] AGENTS.md stale tool counts — deferred: already logged in deferred-work.md (edits agent-context file)

Rejected: R17 — `test()` "can hang forever" is false; `withTestTimeout` races the whole call at 20s regardless of inner fetch state.
