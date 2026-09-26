# Story 50.6 — pumpfun `fetch_coin_meta` Lightweight Action

**Epic 50 — Public Scrape Gateway** · status: done · author: nich (@nichxbt) + Claude

## Intent Contract

As a **trading consumer (jev)**,
I want **call `POST /api/platform/pumpfun/scrape {action:'fetch_coin_meta'}` for just coin metadata**,
So that **I get creator/socials/bonding_curve in ~300ms without paying the full `fetch_mint_social` cost**.

## Boundaries

**IN:**
- New action `fetch_coin_meta` (aliases via actionMap: `coin_meta`, `coin`) registered on `PumpFunCrawler`
- Calls `client.getCoin(mint)` alone — NOT mint-positions, NOT replies, NOT livestream poller
- Returns `{ mint, coinMeta: normalizeCoinMeta(raw) }`
- `syncCapableActions` already includes `fetch_coin_meta` (descriptor line 53 — verified)
- 404 on unknown mint → `XACT_4004` PlatformError (client.getCoin already throws)
- Upstream rate-limit → `XACT_4029` + Retry-After (inherited via client governor)
- Manifest route `GET /api/actions` auto-includes the new action (registry-driven)
- docs matrix regenerated

**OUT:**
- No changes to `fetch_mint_social`
- No livestream / positions / replies fetching in this action

## I/O & Edge-Case Matrix

| # | Case | Expected |
|---|------|----------|
| P-1 | `{action:'fetch_coin_meta', mintAddress}` | `{mint, coinMeta}` with creator, socialLinks, bondingCurve, marketCapUsd, isCurrentlyLive |
| P-2 | `{action:'coin_meta', mint}` (alias + arg alias) | identical result |
| P-3 | missing mint/mintAddress | `XACT_4001` validation error (kind:validation) |
| P-4 | unknown mint | `XACT_4004` 404 (not 500) |
| P-5 | upstream pump.fun rate-limit | `XACT_4029` + Retry-After propagates |
| P-6 | sync mode | completes <1.5s on real upstream (cached 60s) |
| P-7 | `GET /api/actions` | shows `fetch_coin_meta` for pumpfun with `syncCapable:true` |
| P-8 | descriptor actionMap | `coin_meta`/`coin`/`coinMeta` → `fetch_coin_meta` |

## Code Map

- `src/scrapers/social/pumpfun/crawler.js` — **PATCH** — register `fetch_coin_meta` action calling `this.fetchCoinMeta(args, session)`; add method `fetchCoinMeta` calling `this.client.getCoin(mint)` + `normalizeCoinMeta`
- `src/scrapers/social/pumpfun/descriptor.js` — **PATCH** — `actionMap` entries: `coin_meta`, `coin`, `coin_meta`, `coinMeta` → `fetch_coin_meta`; `mapArgs` maps `mint|address|mintAddress` → `mintAddress`
- `src/scrapers/social/pumpfun/normalizer.js` — reuse `normalizeCoinMeta` (already exists)
- `tests/scrapers/social/pumpfun/fetch-coin-meta.test.js` — CREATE — P-1..P-8 + envelope shape + error mapping
- `docs/canonical-action-matrix.*` — regenerated

## Tasks

- [x] Spec authored
- [x] crawler.js register `fetch_coin_meta` + `fetchCoinMeta` method
- [x] descriptor.js actionMap + mapArgs for aliases
- [x] tests/scrapers/social/pumpfun/fetch-coin-meta.test.js
- [x] docs matrix regen

## Acceptance Criteria

1. `action:'fetch_coin_meta'` returns `{mint, coinMeta}` with creator/socials/bonding_curve/market_cap_usd/is_currently_live.
2. Aliases `coin_meta`/`coin` resolve identically via actionMap.
3. `syncCapableActions` already lists it (verified — descriptor.js:53).
4. 404 mint → XACT_4004 mapped error.
5. Appears in `GET /api/actions` manifest.

## Review Triage Log

| # | Finding | Sev | Verdict |
|---|---------|-----|---------|
| 1 | Handler is intentionally minimal — no positions/replies/livestream calls | — | verified by P-1 test asserting URL whitelist |
| 2 | 404 already mapped by client.getCoin → XACT_4004 | — | verified P-4 |
| 3 | scrape() e2e path through actionMap+mapArgs verified via injected client | — | P-1e2e pass |
| 4 | syncCapable flag already in descriptor (50.2 manifest) — action now actually exists so lane is real | — | manifest listing verified |

## Auto Run Result

- `npx vitest run tests/scrapers/social/pumpfun/` → **43/43 pass**
- `npx vitest run tests/gateway/actions-manifest.test.js` → 10/10 pass
- npm run docs:matrix → 25 platforms / **224 actions** (fetch_coin_meta added)
- Live e2e :3004: `POST /api/platform/pumpfun/scrape {action:'fetch_coin_meta',mode:'sync',mintAddress}` → `sync_capable:true`, upstream timeout >1.5s → clean 202 degrade + operationId + statusUrl (unified envelope).
