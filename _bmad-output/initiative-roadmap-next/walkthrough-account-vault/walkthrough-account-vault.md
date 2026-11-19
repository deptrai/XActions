# Walkthrough: Multi-platform account vault (commit 92894ae3)

Current block: **Done — all 6 blocks accepted.**

## [x] Intent

> **Problem:** XActions stores only one X session (`~/.xactions/cookies.json`) and a Twitter-only pool (`accounts.db`) that no CLI/MCP surface can manage — agents (e.g. Hermes) calling the MCP server cannot add, list, switch or check accounts, and nothing stores Bluesky/Mastodon credentials at all.
>
> **Approach:** Add `accountVault` — a SQLite table (`vault_accounts` in the existing `accounts.db`) holding per-platform accounts (`platform`, `name`, credentials JSON, `proxy`) — plus `xactions accounts add|list|remove|use|test` CLI subcommands and `x_accounts_add|list|remove|use|test` MCP tools, so any agent manages its own multi-platform accounts.

*Source: plan intent (human-frozen) — [story-multiplatform-account-vault-plan.md](../../backlog/story-multiplatform-account-vault-plan.md)*

## [x] Broad strokes

Entry points in reading order:
1. [src/vault/accountVault.js](../../../src/vault/accountVault.js) — the vault core: `vault_accounts` table, credential normalization/masking, `add/get/list/remove/use/test`.
2. [src/cli/commands/accounts.js](../../../src/cli/commands/accounts.js) — the `xactions accounts …` commander surface.
3. [src/mcp/local-tools.js](../../../src/mcp/local-tools.js) — five `x_accounts_*` handlers in toolMap.
4. [src/mcp/server.js](../../../src/mcp/server.js) — TOOLS registration + early dispatch branch (works in remote mode too).
5. [tests/accountVault.test.js](../../../tests/accountVault.test.js) — 28 vitest cases covering all of it offline.

## [x] Slice — storage & credential safety

Vault keeps credentials in `vault_accounts` (new table in existing `accounts.db`, PK `platform+name`). Every output path goes through [`maskRow`](../../../src/vault/accountVault.js) — name, platform, proxy host and flags only; secrets never leave the process. The db file plus its WAL/SHM sidecars are chmod 0600. Inputs are normalized via the existing [`parseCookieInput`](../../../src/client/auth/cookieImport.js) (string / cookies.txt / Cookie-Editor JSON / Playwright storageState), and the MCP `add` prefers a **file path** (`cookies_file`/`credentials_file`) over inline secrets so tokens never enter the MCP conversation log.

See [`src/vault/accountVault.js`](../../../src/vault/accountVault.js) and the handlers in [`src/mcp/local-tools.js`](../../../src/mcp/local-tools.js).

## [x] Slice — activation: `use` writes the live session

`use` is twitter-only: it reads the stored credentials and writes the session jar to [`~/.xactions/cookies.json`](../../../src/vault/accountVault.js) — the exact path every CLI command reads (hardcoded `os.homedir()/.xactions`, deliberately not `$XACTIONS_HOME`), backing the previous jar up to `.bak` first. It also mirrors `authToken`/`csrfToken` into `config.json`, matching `login --cookies-file` semantics so no stale-account fallback survives. Bluesky/mastodon rows are stored but `use` reports them dormant — wiring them into scrapers is a deferred goal. See [`use()` + `mirrorSessionTokens()`](../../../src/vault/accountVault.js) in accountVault.js.

## [x] Slice — input surfaces (CLI + MCP)

One vault, two doors: the commander surface in [`src/cli/commands/accounts.js`](../../../src/cli/commands/accounts.js) (`xactions accounts …`, listed under "Account management" in help) and five MCP tools `x_accounts_*`. On the MCP side the tools live in the `TOOLS` list plus `local-tools.js` handlers, grouped under `accounts` via the `x_accounts_` prefix — deliberately NOT in `WRITE_TOOLS`, since they are local operations (no X call, no draft gate). `executeTool` gained an early `x_accounts_` branch so they dispatch in remote mode too instead of falling through to the remote server. See [`src/mcp/server.js`](../../../src/mcp/server.js) and [`src/mcp/local-tools.js`](../../../src/mcp/local-tools.js).

## [x] Periphery

- [`tests/accountVault.test.js`](../../../tests/accountVault.test.js) — 28 offline vitest cases: normalization, masking, `use` path isolation, MCP handlers, CLI e2e. Worth a look for concrete contracts.
- `src/cli/index.js` — two mechanical lines (import + register). Safe to skip.
- `src/cli/help-groups.js` — adds the "Account management" help group. Safe to skip.
- `src/mcp/tool-groups.js` — adds the `x_accounts_` → `accounts` prefix rule. Safe to skip.
- [`_bmad-output/deferred-work.md`](../../deferred-work.md) — deferral entry: AGENTS.md tool counts now stale (154→159).

## Outcome

All six blocks accepted on first pass — intent, broad strokes, and three slices plus periphery. One live demo exercised the full account lifecycle (add ×3 platforms, masked list, test failure, use with session mirror, threads rejection, remove) in an isolated HOME; transcript at `demo-transcript.txt`. No defects found during the walkthrough. Implementation lives in commit `92894ae3` on `upstream-main`.
