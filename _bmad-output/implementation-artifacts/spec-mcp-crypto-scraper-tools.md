---
title: 'MCP Coverage Gap Fix — crawlerModuleMap + Crypto Dedicated Tools'
type: 'feature'
created: '2026-10-01'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a53e92fa9ae6cd42b9903ad06feda455beb021f8'
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** 4 platforms (dexscreener, telegram, github, gravatar) thiếu trong `crawlerModuleMap` — không có early arg validation. Crypto platforms (dexscreener, pumpfun) chỉ accessible qua `x_scrape` generic tool, không có dedicated named tools. `github`/`gravatar` còn thiếu trong `CANONICAL_PLATFORMS`/`crawlerLoaders`/`PLATFORM_CATEGORIES` — invisible cho `x_actions_list` self-discovery.

**Approach:** (1) Thêm 4 entries vào `crawlerModuleMap` để pre-validation hoạt động. (2) Thêm `github`+`gravatar` vào `CANONICAL_PLATFORMS`, `PLATFORM_CATEGORIES`, `crawlerLoaders`. (3) Tạo dedicated MCP tools cho `dexscreener` và `pumpfun` theo pattern `x_dexscreener_*` và `x_pumpfun_*` — mỗi tool là thin wrapper gọi `x_scrape` internally.

## Boundaries & Constraints

**Always:**
- `crawlerModuleMap` entries follow existing pattern: `platform_key: 'relative/path/to/crawler.js'`
- `CANONICAL_PLATFORMS`/`PLATFORM_CATEGORIES`/`crawlerLoaders` in `actions-list.js` updated atomically
- Dedicated MCP tools delegate to `scrape()` — never implement scraping logic inline
- Tool names: `x_dexscreener_<action>`, `x_pumpfun_<action>` — snake_case, platform prefix
- Tool definitions include `inputSchema` with proper `type: 'object'`, `properties`, `required`
- Each tool handler calls `executeScrapeTool({ platform, action, args: {...} })` — reuse, don't duplicate

**Never:**
- Không modify crawler/client/descriptor/normalizer — chỉ wiring layer
- Không tạo tools cho telegram (skeleton, transport deferred), github/gravatar (identity lookup, not scraper tools)
- Không bypass `executeScrapeTool` — dedicated tools are thin wrappers, not parallel implementations

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| DEX_LOOKUP | `x_dexscreener_token_lookup({ chainId:'solana', tokenAddress:'...' })` | pair data via scrape() | `XACT_4002` if missing args |
| DEX_MISSING_ARGS | `x_dexscreener_token_lookup({})` | early validation error | `XACT_4002` from crawlerModuleMap |
| PUMPFUN_SOCIAL | `x_pumpfun_mint_social({ mintAddress:'...' })` | social signals via scrape() | `XACT_4002` if invalid mint |
| PUMPFUN_COIN | `x_pumpfun_coin_meta({ mintAddress:'...' })` | coin metadata | `XACT_4002` if invalid mint |
| LIST_ACTIONS | `x_actions_list({ platform:'dexscreener' })` | 5 actions listed | returns actions |
| UNKNOWN_PLATFORM | `x_scrape({ platform:'dexscreener2' })` | error listing available | `XACT_4001` |

</intent-contract>

## Code Map

- `src/mcp/server.js` line 4081 — `crawlerModuleMap` object: add `dexscreener`, `telegram`, `github`, `gravatar` entries
- `src/scrapers/social/actions-list.js` line 13 — `CANONICAL_PLATFORMS` array: add `'github'`, `'gravatar'`
- `src/scrapers/social/actions-list.js` line 43 — `PLATFORM_CATEGORIES` map: add `github: 'identity'`, `gravatar: 'identity'`
- `src/scrapers/social/actions-list.js` line 100 — `crawlerLoaders` array: add github + gravatar loaders
- `src/scrapers/social/actions-list.js` line 85 — `CATEGORY_MAP` map: add `identity: 'identity'`
- `src/mcp/server.js` — add 5 `x_dexscreener_*` + 10 `x_pumpfun_*` tool definitions after existing tools
- `src/mcp/server.js` — add routing in tool handler to dispatch dedicated tools → `executeScrapeTool`

## Tasks & Acceptance

**Execution:**
- `src/mcp/server.js` — add 4 missing entries to `crawlerModuleMap` (dexscreener, telegram, github, gravatar) — fixes early arg validation
- `src/scrapers/social/actions-list.js` — add `github`+`gravatar` to `CANONICAL_PLATFORMS`, `PLATFORM_CATEGORIES`, `crawlerLoaders`, `CATEGORY_MAP` — fixes `x_actions_list` visibility
- `src/mcp/server.js` — add `x_dexscreener_token_socials`, `x_dexscreener_token_legitimacy`, `x_dexscreener_token_lookup`, `x_dexscreener_latest_boosted`, `x_dexscreener_latest_profiles` tool definitions — each with proper inputSchema
- `src/mcp/server.js` — add `x_pumpfun_mint_social`, `x_pumpfun_coin_meta`, `x_pumpfun_resolve_user`, `x_pumpfun_feed`, `x_pumpfun_chat`, `x_pumpfun_my_profile`, `x_pumpfun_user_following`, `x_pumpfun_livestream_clips`, `x_pumpfun_post_reply`, `x_pumpfun_mint_comments` tool definitions — each with proper inputSchema
- `src/mcp/server.js` — add tool dispatch routing so `x_dexscreener_*` → `executeScrapeTool({platform:'dexscreener', action:..., args:...})` and `x_pumpfun_*` → `executeScrapeTool({platform:'pumpfun', action:..., args:...})`

**Acceptance Criteria:**
- Given `crawlerModuleMap` has `dexscreener` entry, when `x_scrape({platform:'dexscreener', action:'token_lookup', args:{}})` is called, then early validation throws `XACT_4002` listing missing `chainId`/`tokenAddress`
- Given `github` in `CANONICAL_PLATFORMS`, when `x_actions_list({platform:'github'})` is called, then it returns `profile` action
- Given `x_dexscreener_token_lookup` tool registered, when invoked with `{chainId:'solana', tokenAddress:'...'}`, then it delegates to `scrape('dexscreener','token_lookup',...)` and returns normalized result
- Given `x_pumpfun_mint_social` tool registered, when invoked with `{mintAddress:'...'}`, then it delegates to `scrape('pumpfun','fetch_mint_social',...)` and returns normalized result

## Design Notes

Dedicated tool pattern follows Facebook's `x_facebook_*` tools but simpler — no auth resolution needed since dexscreener/pumpfun are keyless/unauthenticated. Each tool is a thin wrapper that maps friendly param names to scrape() args.

The `crawlerModuleMap` fix is a 4-line addition — no structural changes needed. For `x_actions_list` visibility, `github`+`gravatar` need both `CANONICAL_PLATFORMS` AND `crawlerLoaders` entries.

## Verification

**Commands:**
- `node -e "const {DESCRIPTORS} = await import('./src/scrapers/index.js'); console.log(Object.keys(DESCRIPTORS))"` — expected: includes dexscreener, github, gravatar, telegram
- `node -e "import('./src/scrapers/social/actions-list.js').then(m => m.executeActionListTool({platform:'dexscreener'})).then(r => console.log(r.length))"` — expected: ≥5
- `node -e "import('./src/scrapers/social/actions-list.js').then(m => m.executeActionListTool({platform:'github'})).then(r => console.log(r.length))"` — expected: ≥1
- `vitest run` — expected: no regressions

## Review Triage Log

### 2026-10-01 — Review pass
- verdicts: 8 findings — high 0, medium 0, low 2, false 4, maybe-false 0, patch 2
- findings:
  - `[false]` `[reject]` blind-hunter: x_pumpfun_chat durationMs buffering vs streaming — streamMintChat collects messages via websocket for durationMs and returns buffered output safely.
  - `[false]` `[reject]` blind-hunter: x_pumpfun_resolve_user @ prefix — resolveUserWallet in crawler already strips @ prefix via regex.
  - `[false]` `[reject]` blind-hunter: DEDICATED_SCRAPE_TOOLS dryRun stripping — executeScrapeTool properly accepts top-level dryRun option.
  - `[low]` `[reject]` blind-hunter: x_dexscreener_latest_boosted pagination args — upstream Dexscreener API returns top tokens only without cursor pagination. Limit is sufficient.
  - `[low]` `[patch]` blind-hunter: x_actions_list schema description missing identity/crypto categories — updated description enum in src/mcp/server.js:2961.
  - `[medium]` `[patch]` verification-gap: missing test for dryRun handling in dedicated tools — added executeTool dryRun test asserting preview envelope in tests/mcp/x-scrape-tool.test.js.
  - `[low]` `[patch]` verification-gap: missing test for telegram requiredArgs pre-validation — added telegram test asserting XACT_4002 in tests/mcp/x-scrape-tool.test.js.
  - `[false]` `[reject]` edge-case-hunter: no unhandled edge cases identified (`[]`).

## Auto Run Result

Status: done
Blocking condition: none

### Summary of Implemented Change
1. Fixed `crawlerModuleMap` in `src/mcp/server.js` by adding 4 missing entries (`dexscreener`, `telegram`, `github`, `gravatar`) enabling early `requiredArgs` pre-validation and structured `XACT_4002` error handling.
2. Extended `src/scrapers/social/actions-list.js` with `github` and `gravatar` across `CANONICAL_PLATFORMS`, `PLATFORM_CATEGORIES`, `CATEGORY_MAP`, and `crawlerLoaders`, enabling `x_actions_list` self-discovery.
3. Created 15 dedicated MCP tools:
   - 5 Dexscreener tools: `x_dexscreener_token_socials`, `x_dexscreener_token_legitimacy`, `x_dexscreener_token_lookup`, `x_dexscreener_latest_boosted`, `x_dexscreener_latest_profiles`
   - 10 Pump.fun tools: `x_pumpfun_mint_social`, `x_pumpfun_coin_meta`, `x_pumpfun_resolve_user`, `x_pumpfun_feed`, `x_pumpfun_chat`, `x_pumpfun_my_profile`, `x_pumpfun_user_following`, `x_pumpfun_livestream_clips`, `x_pumpfun_post_reply`, `x_pumpfun_mint_comments`
4. Added `DEDICATED_SCRAPE_TOOLS` routing table in `executeTool` to dispatch dedicated tools directly through `executeScrapeTool`.
5. Updated `x_actions_list` category description to document `crypto` and `identity`.

### Files Changed
- `src/mcp/server.js` — Added 15 tool definitions to `TOOLS`, `DEDICATED_SCRAPE_TOOLS` dispatch mapping in `executeTool`, 4 missing `crawlerModuleMap` entries, and updated category docs.
- `src/scrapers/social/actions-list.js` — Added `github` and `gravatar` to platforms, categories, category map, and crawler loaders.
- `tests/mcp/x-scrape-tool.test.js` — Added test suites for newly mapped crawlers validation, dedicated tools schema registration, required args enforcement, dryRun preview envelopes, and action discovery.

### Verification Performed
- All 79 tests passed across 5 test suites (`tests/mcp/x-scrape-tool.test.js`, `tests/mcp/actions-list-complete.test.js`, `tests/mcp/osint-github-gravatar.test.js`, `tests/scrapers/crypto/dexscreener/dexscreener.test.js`, `tests/scrapers/social/pumpfun/pumpfun.test.js`).
- Manual CLI verification of action discovery confirmed 5 dexscreener actions, 1 github action, and 1 gravatar action.
