# Spec — Story 50.7: `crypto/dexscreener` Platform Descriptor

> Status: **implemented**
> Epic: 50 — Public Scrape Gateway (unified envelope / quota / self-discovery)
> Depends on: 50.2 (mode dispatch), 50.3 (envelope), 50.4 (per-consumer quota)
> Date: 2026-09-27

## 1. Goal

Create a new platform module `src/scrapers/crypto/dexscreener/` — descriptor + client +
crawler + normalizer — exposing 5 keyless REST read actions against `api.dexscreener.com`:

| Action | Upstream | Purpose |
|---|---|---|
| `token_socials` | `GET /tokens/v1/{chainId}/{tokenAddress}` | `info.socials[]` map + websites |
| `token_legitimacy` | `GET /orders/v1/{chainId}/{tokenAddress}` | dev-paid orders + boost status |
| `token_lookup` | `GET /token-pairs/v1/{chainId}/{tokenAddress}` | pairs, liquidity, priceUsd, dexId |
| `latest_boosted` | `GET /token-boosts/latest/v1` | trending boosted tokens |
| `latest_profiles` | `GET /token-profiles/latest/v1` | newly updated profiles |

Consumers (jev, ChainLens) get Dexscreener token socials + legitimacy signals through the
unified gateway without their own Dexscreener integration. All 5 actions are sub-second
REST reads → `syncCapableActions` = all 5.

## 2. Non-goals

- No authentication layer (Dexscreener API is keyless/free — verified `api.dexscreener.com/latest/dex/*`)
- No WebSocket / streaming (REST-only)
- No write actions — read-only platform
- Proxy pool is OPTIONAL (Dexscreener is permissive); per-consumer quota still applies via Story 50.4
- No separate DEX scrapers — `pair.dexId` covers Raydium/Orca/others

## 3. File layout

```
src/scrapers/crypto/dexscreener/
  client.js       — DexscreenerClient extends AbstractApiClient (keyless, undici)
  crawler.js      — DexscreenerCrawler extends AbstractCrawler (registerAction ×5)
  normalizer.js   — raw → ThinEvent-shaped snake_case records
  descriptor.js   — aliases/actionMap/mapArgs/createClient/createCrawler
tests/scrapers/crypto/dexscreener/
  dexscreener.test.js — unit + dispatch tests
```

`src/scrapers/crypto/` is a NEW top-level directory (platform category namespace).
`src/scrapers/index.js` gains `dexscreenerDescriptor` import + registration.

## 4. Client (`client.js`)

```js
export const DEXSCREENER_API_BASE = 'https://api.dexscreener.com';
export class DexscreenerClient extends AbstractApiClient {
  name = 'dexscreener'; platform = 'dexscreener';
  requiresAuth = false; requiresResidential = false; client = 'undici';
}
```

- `#apiGet(url, options)` → `this.request('GET', url, { skipResponseValidation: true, ...options })`
- Status handling: 404 → PlatformError XACT_4004; 429 → XACT_4029 + retryAfterMs; other non-2xx → XACT_5000
- Distributed token bucket `globalDistributedTokenBucket`, default `reqPerMinute = 30` (Dexscreener
  published limit is ~300rpm but we stay conservative; override via options)
- Methods: `getTokenProfiles(chainId, tokenAddress)`, `getTokenOrders(chainId, tokenAddress)`,
  `getTokenPairs(chainId, tokenAddress)`, `getLatestBoosted()`, `getLatestProfiles()`

### Arg validation
- `chainId` required: non-empty string (e.g. `'solana'`, `'ethereum'`, `'bsc'`). Bad → XACT_4002.
- `tokenAddress` required: non-empty string. For solana, validate Base58 (reuse `SOLANA_MINT_RE` shape);
  for EVM chains accept `0x[0-9a-fA-F]{40}`; unknown chains → only non-empty check (chain-agnostic).

## 5. Crawler (`crawler.js`)

```js
export class DexscreenerCrawler extends AbstractCrawler {
  name = 'dexscreener'; platform = 'dexscreener'; category = 'crypto';
  requiresAuth = false;
  async cleanup() { /* no-op — stateless HTTP client */ }
}
```

Registers 5 actions with `requiredArgs`/`optionalArgs`/`outputType`/`example` + handler:

| action | requiredArgs | optionalArgs | outputType |
|---|---|---|---|
| `token_socials` | `[chainId, tokenAddress]` | `[]` | `{ chainId, tokenAddress, socials[], websites[] }` |
| `token_legitimacy` | `[chainId, tokenAddress]` | `[]` | `{ chainId, tokenAddress, orders[], boosted, boostsActive }` |
| `token_lookup` | `[chainId, tokenAddress]` | `[]` | `{ chainId, tokenAddress, pairs[] }` |
| `latest_boosted` | `[]` | `[limit]` | `BoostedToken[]` |
| `latest_profiles` | `[]` | `[limit]` | `TokenProfile[]` |

Handlers call `client.*` then pass raw through normalizer and return ThinEvent-shaped records.

## 6. Normalizer (`normalizer.js`)

All outputs snake_case; domain fields live in the `data` payload only (envelope stays generic).

- `normalizeTokenSocials(chainId, tokenAddress, raw)` → `{ platform:'dexscreener', category:'crypto', type:'token_socials', data:{ chain_id, token_address, name?, symbol?, description?, image?, socials[], websites[] } }`
  - socials[]: `{ type, url }` from `info.socials[]`; websites[]: `{ label?, url }` from `info.websites[]`
- `normalizeTokenLegitimacy(chainId, tokenAddress, rawOrders)` → `{ platform, category:'crypto', type:'token_legitimacy', data:{ chain_id, token_address, orders[], boosts_active } }`
  - orders[]: `{ type, status, payment_timestamp }`; boosts_active: count of active boosts from orders payload (`type==='tokenProfile'` / `boost` fields)
- `normalizeTokenLookup(chainId, tokenAddress, rawPairs)` → `{ platform, category:'crypto', type:'token_lookup', data:{ chain_id, token_address, pairs[] } }`
  - pairs[]: `{ dex_id, pair_address, price_usd, liquidity_usd, volume_24h, price_change_24h, pair_created_at }`
- `normalizeBoostedToken(raw)` → `{ platform, category:'crypto', type:'boosted_token', data:{ token_address, chain_id, amount?, total_amount?, url?, description?, icon? } }`
- `normalizeTokenProfile(raw)` → `{ platform, category:'crypto', type:'token_profile', data:{ token_address, chain_id, url?, description?, icon?, header?, links[] } }`
- `namespacedDexscreenerId(id)` → `dexscreener:{id}` for id fields when present

## 7. Descriptor (`descriptor.js`)

```js
const DEXSCREENER_ACTION_MAP = {
  token_socials: 'token_socials', socials: 'token_socials', token_social_links: 'token_socials',
  token_legitimacy: 'token_legitimacy', legitimacy: 'token_legitimacy', token_orders: 'token_legitimacy', orders: 'token_legitimacy',
  token_lookup: 'token_lookup', lookup: 'token_lookup', token_pairs: 'token_lookup', pairs: 'token_lookup',
  latest_boosted: 'latest_boosted', boosted: 'latest_boosted', trending_boosted: 'latest_boosted',
  latest_profiles: 'latest_profiles', profiles: 'latest_profiles', new_profiles: 'latest_profiles',
};
export default {
  aliases: ['dexscreener', 'dex', 'dexscreen'],
  actionMap: DEXSCREENER_ACTION_MAP,
  syncCapableActions: ['token_socials','token_legitimacy','token_lookup','latest_boosted','latest_profiles'],
  mapArgs(options) { /* chainId|chain → chainId; tokenAddress|token|address|mint → tokenAddress; limit → Number */ },
  createClient(options) { return options.client instanceof DexscreenerClient ? options.client : new DexscreenerClient({...}); },
  createCrawler({ client, store, options }) { return new DexscreenerCrawler({ client, store, proxyPool: options.proxyPool, governor: options.governor, fetchFn: options.fetchFn }); },
};
```

## 8. Wiring changes

- `src/scrapers/index.js`: `import dexscreenerDescriptor from './crypto/dexscreener/descriptor.js';` + add to DESCRIPTORS array
- `api/routes/platform.js`: VALID_PLATFORMS += `'dexscreener', 'dex', 'dexscreen'`; PLATFORM_ALIASES += `dex→dexscreener, dexscreen→dexscreener`
- `src/scrapers/social/actions-list.js`: CANONICAL_PLATFORMS += `'dexscreener'`; PLATFORM_CATEGORIES += `dexscreener: 'crypto'`; crawler loader `() => import("../crypto/dexscreener/crawler.js").then(m => new m.DexscreenerCrawler())`
- `api/openapi.json`: platform enum += dexscreener/dex/dexscreen

## 9. Tests (`tests/scrapers/crypto/dexscreener/dexscreener.test.js`)

Injected seams only (client.request injection — no network, no mocks of our own code):

- D-1: `token_socials` returns socials map — only `/tokens/v1/` hit, never orders/pairs
- D-2: `token_legitimacy` returns orders + boostsActive — `/orders/v1/` hit
- D-3: `token_lookup` returns pairs with priceUsd/dexId — `/token-pairs/v1/` hit
- D-4: `latest_boosted` → `/token-boosts/latest/v1` array
- D-5: `latest_profiles` → `/token-profiles/latest/v1` array
- D-6: missing chainId/tokenAddress → PlatformError (XACT_4001/4002); unknown token → XACT_4004
- D-7: listActions shows all 5 with category 'crypto', requiredArgs correct
- D-8: actionMap aliases resolve (`socials`→token_socials, `pairs`→token_lookup, `boosted`→latest_boosted…)
- D-9: `scrape('dexscreener','socials',{chain:'solana',token:...})` e2e through real descriptor → envelope-shaped data
- D-10: `isSyncCapable('dexscreener', a)` → true for all 5 actions
- D-11: `GET /api/actions?platform=dexscreener` lists 5 actions, category crypto, syncCapable true (regression on 50.5 manifest)

## 10. Acceptance mapping

| AC | Mechanism |
|---|---|
| token_socials via /tokens/v1 | client.getTokenProfiles → info.socials |
| token_legitimacy via /orders/v1 | client.getTokenOrders → orders[] |
| token_lookup via /token-pairs/v1 | client.getTokenPairs → pairs[] |
| latest_boosted via /token-boosts/latest/v1 | client.getLatestBoosted |
| latest_profiles via /token-profiles/latest/v1 | client.getLatestProfiles |
| category 'crypto' on all events | normalizer + crawler.category |
| domain fields in data payload only | normalizer never writes to envelope |
| syncCapableActions = all 5 | descriptor manifest |
| proxy optional | `proxyPool` passthrough only; no residential requirement |
| Raydium/Orca coverage | pair.dexId surfaced in token_lookup pairs[] |
| snake_case outputs | normalizer emits token_address/chain_id/dex_id/price_usd/socials/boosts/orders |

## 11. Defer items

None new. Pre-existing defer (session-cookie-shim ×3, admin, layout, mcp-bridge test failures —
verified on baseline) rolls to epic-end retrospective.

## Review Triage Log

_(to fill during spec review pass — 4-reviewer pattern from /bmad-build-auto)_

### Findings (self-review, 4 lenses)

- F-1 (contract): `mapArgs` must accept `chain`, `chain_id`, `network` in addition to `chainId` — jev passes `chain:'solana'`. Also `token`/`token_address`/`mint`/`address` → `tokenAddress`. **Applied** to §7.
- F-2 (architecture): Actions-list loader path must be `../crypto/dexscreener/crawler.js` relative to `src/scrapers/social/`. `CANONICAL_PLATFORMS` ordering: append `'dexscreener'` at end (stable insertion). **Confirmed** §8.
- F-3 (testing): `scrape()` dispatch test must pass `client` seam — real upstream is keyless but offline CI can't hit it. Inject `DexscreenerClient` with `client.request` stub via `options.client`. **Applied** to §9 D-9.
- F-4 (security): `tokenAddress` for `latest_boosted`/`latest_profiles` must NOT be required — they take no args beyond `limit`. Guard: reject unexpected mint-shaped garbage by ignoring extras, never erroring. **Confirmed** §5.
- F-5 (contract): `/api/actions?platform=dexscreener` must not break if crawler instantiation throws (missing dep) — loader try/catch already skips; placeholder `coming_soon` entry emitted since dexscreener is in CANONICAL_PLATFORMS. Acceptable; test asserts real crawler loads. **Confirmed** §9 D-11.

### Auto Run Result

- spec: this file
- implement: src/scrapers/crypto/dexscreener/{client,crawler,normalizer,descriptor}.js
- tests: tests/scrapers/crypto/dexscreener/dexscreener.test.js (11 cases)
- wiring: src/scrapers/index.js, api/routes/platform.js, src/scrapers/social/actions-list.js, api/openapi.json
- docs: `npm run docs:matrix` regenerate (dexscreener ×5 with syncCapable ✅)
- e2e: live `POST /api/platform/dexscreener/scrape {action:'token_lookup'}` real solana token → sync path


## Implementation Notes (2026-09-27)

### Upstream shape corrections made during live-probe
- `/tokens/v1/{chain}/{token}` actually returns the **pairs array** (not a
  profile object); token socials live inside `pair.info.socials[]` +
  `info.websites[]`. Normalizer picks the pair with the richest info block.
- `/orders/v1/{chain}/{token}` returns `{orders:[...], boosts:[...]}` — not a
  bare array. Client unwraps; normalizer counts both toward `boosts_active`.
- `/token-pairs/v1/{chain}/{token}` returns a pairs array (correct in spec).
- `/token-boosts/latest/v1` and `/token-profiles/latest/v1` return flat arrays.

### Verified live (api.dexscreener.com)
- `token_socials` BONK (DezXAZ…): 3 socials (twitter/telegram/discord) + 1
  website — 308ms sync lane.
- `token_lookup` BONK: 30 pairs across raydium/orca/meteora.
- `token_legitimacy` boosted token (G6vNKu…): 1 tokenProfile order (approved) +
  1 boost → `boosts_active: 2`.
- `latest_boosted`/`latest_profiles`: real arrays, 200 ok.
- `POST /api/platform/dex/scrape {action:"pairs"}`: alias → canonical
  dexscreener/token_lookup — `metadata.platform=dexscreener`, sync_capable true.
- Validation: `tokenAddress='notreal'` → `XACT_4002` kind=validation status=400.
- `GET /api/actions?platform=dexscreener`: 5 actions, `category=crypto`,
  `syncCapable=true`, `status=stable`; X-Actions-Cache miss → 60s ttl.
- `GET /api/admin/gateway/metrics`: upstreamHealth.dexscreener
  `{p50:274,p95:274,p99:274,errorRate:0}` — Story 50.4 observability chain intact.

### Files
- src/scrapers/crypto/dexscreener/{client,crawler,normalizer,descriptor}.js (new)
- tests/scrapers/crypto/dexscreener/dexscreener.test.js — 11 cases, all pass
- src/core/types.js — `CRYPTO: 'crypto'` added to CATEGORIES
- src/scrapers/index.js — dexscreenerDescriptor registered
- api/routes/platform.js — VALID_PLATFORMS + aliases (dex/dexscreen → dexscreener)
- src/scrapers/social/actions-list.js — canonical platform + crypto category +
  crawler loader
- api/openapi.json — platform enum += dexscreener/dex/dexscreen
- docs/canonical-action-matrix.{md,json} — regenerated (26 platforms, 229 actions)

### Tests run
- `vitest run tests/scrapers/crypto/dexscreener` — 11/11 pass
- `vitest run tests/gateway/actions-manifest.test.js` — 10/10 pass (regression)
- `vitest run tests/scrapers/social/pumpfun/fetch-coin-meta.test.js` — 7/7 pass (regression)
