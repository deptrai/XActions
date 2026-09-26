---
title: 'market research: crypto scraping expansion for XActions'
type: 'market'
topic: 'Crypto/blockchain data source expansion for XActions multi-domain scraping platform'
decision: 'Which crypto/blockchain data sources should XActions add as scraping domains?'
source: 'native run'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-09-26'
updated: '2026-09-26'
---

# Market Research: Crypto Scraping Domain Expansion for XActions

**Decision:** Which crypto/blockchain data sources should XActions add as scraping domains to serve downstream consumers (Nowing, ChainLens, Jev Trading)?

**Scope correction:** XActions is a **data scraping infrastructure platform**, not an end-user product. Features proposed are **new scraping domains/pipelines**, not user-facing features. Downstream consumers (Nowing, ChainLens, Jev Trading) consume via `x_scrape` MCP tool + Redis Stream ThinEvents.

---

## Executive Summary

**Verdict: After deduplicating against `jev-trading`'s own implementation, XActions' crypto expansion scope is *narrower but sharper* than it first appeared — the real gaps are Reddit search routing, pump.fun coin metadata, a Dexscreener platform, and Telegram.**

XActions currently has **25 canonical platforms**. In crypto it has **only pump.fun**. But the naive conclusion — "scrape everything crypto" — collapses on inspection: **jev-trading already self-serves most crypto data directly** (pumpportal WS, Solana RPC/Helius/Triton gRPC, kolscan, Dexscreener TP-fallback, Telegram alerts). XActions' value is only in what jev *can't or shouldn't* scrape itself: **social-platform scraping with auth/anti-bot** (its core moat) and **shared multi-consumer sources** (ChainLens, Nowing also consume).

**Three findings drive the recommendation:**

1. **jev-trading already owns the latency-critical crypto data.** `src/` connects directly to `wss://pumpportal.fun`, `api.mainnet-beta.solana.com`, `mainnet.helius-rpc.com`, `api.helius.xyz` (Triton), `api.telegram.org`, `kolscan.io`. Jev's <5s decision NFR means on-chain/trade data *can't* route through XActions anyway — too slow. Building these in XActions = pure duplication.

2. **The real gap is wiring + one missing platform.** jev's `searchReddit()` returns [] because XActions' reddit `search` action has no reachable route; pump.fun `/coins/{mint}` is live-but-unscraped; and **Telegram — crypto's primary comms platform — is explicitly deferred in jev Epic 2 because "XActions chưa có TelegramCrawler."**

3. **Dexscreener is the only new platform with cross-consumer pull.** Verified free (5 endpoints, no key), multi-chain, unique token→social-links map + paid-order legitimacy signal. jev uses it only as a narrow TP fallback — a canonical scraper serves ChainLens + Nowing too, *if* jev routes through `x_scrape`.

**Biggest caveat:** The dedup finding itself is the risk — jev already reimplemented `PumpFunCrawler` in-repo rather than consuming XActions' canonical one (`src/social/pumpFunCrawler.ts` vs `x_scrape`). If consumers keep bypassing XActions, even well-built scrapers go unused. **Before building D3/D4, confirm consumers will actually route through `x_scrape`/REST.**

**Top recommendation (deduped against jev-trading repo):** After reading `jev-trading`'s epics + source, most crypto data sources are **already self-served by jev directly** (pumpportal WS, Solana RPC/Helius/Triton, kolscan, Dexscreener TP-fallback, Telegram alerts). The real gaps XActions should fill:

1. **D1 — Reddit content-search route** (1 day): jev's `searchReddit()` returns [] today — the crawler's `search` action exists but isn't reachable via the REST/MCP surface jev calls. Pure wiring, unblocks jev Story 2.1 immediately.
2. **D2 — pump.fun `fetch_coin_meta` action** (1 day): `/coins/{mint}` verified live (CF session); feeds jev Story 1.2's deployer/social-link checks.
3. **D3 — `crypto/dexscreener` platform** (2-3 days): only new platform worth building — 5 free endpoints, token→social-links map, paid-order legitimacy signal. **Gate:** confirm jev consumes via `x_scrape` instead of its own fallback, else justify on ChainLens alone.
4. **D4 — Telegram channel monitor** (1-2 weeks): strategic unlock — deferred in jev Epic 2 precisely because "XActions chưa có TelegramCrawler"; also Nowing's biggest missing corpus.

**Anti-duplicate list (do NOT build):** pumpportal WS, Solana RPC/Helius/Triton, kolscan, pump.fun trade tape, CoinGecko — all already inside jev-trading's own pipeline.

---

## 1. Current Crypto Coverage

### Existing Crypto Platform

| Platform | Category | Actions | Data Types | Status |
|---|---|---|---|---|
| **pump.fun** | social | 8 actions | mint social signals, positions, theses, comments, KOL wallets, livestream, user resolve | ✅ Live (Epic 20) |

### What pump.fun Already Scrapes
- `fetch_mint_social` — theses, comment velocity, top holders, KOL activity, livestream status
- `resolve_user_wallet` — username → Solana wallet + profile
- `fetch_platform_feed` — koth, graduating, new_creations, last_trade, currently_live feeds
- `stream_mint_chat` — real-time livechat WebSocket stream
- `fetch_my_profile` — authenticated user profile
- `fetch_user_following` — user's following list
- `fetch_livestream_clips` — HLS livestream clips
- `post_mint_reply` — authenticated comment posting

### What's Missing (Pump.fun v3 endpoints not yet scraped)
- `GET /coins/{mint}` — full coin metadata (market cap, bonding curve, creator, social links, ATH)
- RSC-rendered pages: `/explore`, `/leaderboard`, `/live`, `/mayhem`, `/holder-rewards`

---

## 2. Crypto Data Source Landscape

### Layer 1: Market Data APIs (Aggregators) — LIVE-PROBE VERIFIED 2026-09-26

| Source | Free Tier | Verified Endpoints | Data | Scraping Fit |
|---|---|---|---|---|
| **Dexscreener** | ✅ No key | `/latest/dex/search`, `/latest/dex/tokens/{addr}`, `/token-profiles/latest/v1`, `/token-boosts/latest/v1`, `/orders/v1/{chain}/{token}` — all 200 | DEX pairs all chains, liquidity, volume, priceChange, txns m5/h1/h6/h24, **token social links**, **paid-order detection** | **HIGHEST** — 5 free endpoints, unique boost/order signals |
| **CoinGecko** | ✅ 10K/mo, ~100/min | `/ping`, `/search/trending` (15+7+6), `/coins/{id}/market_chart/range` — all 200 | Prices, market cap, OHLCV, trending | HIGH — already in priceCorrelation.js |
| **GeckoTerminal** | ✅ No key | `/networks/{net}/tokens/{addr}` (price_usd, fdv_usd), `/pools/{pool}/ohlcv/hour` — 200 | DEX pool OHLCV, token price per chain | MEDIUM — DEX-pool granularity, complements CoinGecko |
| **Birdeye** | ⚠️ Key required | `public-api.birdeye.so/defi/price` → `Unauthorized` without key | Solana tokens, whale tracking | MEDIUM — free key tier exists but gated |
| **CoinMarketCap** | ⚠️ Key required | Not probed | Market data, trending | MEDIUM — paid tiers expensive |
| **Jupiter** | ❌ v6 deprecated | `quote-api.jup.ag/v6/quote` → dead; migrated to `lite-api.jup.ag` | Solana swap routes | RE-PROBE — endpoint surface changed |

### Layer 2: On-Chain Data (Solana)

| Source | Access | Data | Scraping Fit |
|---|---|---|---|
| **Solana RPC** (public) | Free, no key | Accounts, transactions, blocks, token balances | HIGH — direct on-chain reads |
| **solana-mainnet.pump.fun** | Free RPC proxy | Solana RPC via pump.fun | HIGH — already discovered endpoint |
| **Helius** | API key free tier | Enhanced Solana APIs, webhooks, NFT data | MEDIUM — API key required |
| **Arkham** | Limited free | Entity labels, wallet tracking | LOW — expensive, but high value |
| **Nansen** | Very limited free | Smart money labels, wallet tracking | LOW — very expensive |

### Layer 3: Token Launchpads

| Platform | Chain | Scraping Status | Data |
|---|---|---|---|
| **pump.fun** | Solana | ✅ Scraped | Mint social, positions, chat, livestream |
| **pumpportal.fun** | Solana | ❌ Not scraped | Free WS `wss://pumpportal.fun/api/data` — newToken/trade/account stream (WS-only, GET 404) |
| **letsbonk** | Solana | ❌ Not scraped | Social trading, copy-trading, trader profiles |
| **moonshot** | Solana | ❌ Not scraped | AI-powered trading signals, AUM |
| **Believe** | Solana | ❌ Not scraped | Alternative launchpad |
| **Raydium** | Solana | ❌ Not scraped | DEX liquidity, pools, swaps — coverable indirectly via Dexscreener `dexId=raydium` |
| **Orca** | Solana | ❌ Not scraped | DEX pools — coverable indirectly via Dexscreener `dexId=orca` (already returns Orca pairs) |
| **Kolscan** | Solana | ⚠️ SPA | kolscan.io 200 but SPA — internal API needs browser probe |
| **GMGN** | Multi | ⚠️ CF-gated | Cloudflare challenge — needs got-jsdom/curl transport like pump.fun |

### Layer 4: Crypto Social Platforms

| Platform | Scraping Status | Data | Crypto Relevance |
|---|---|---|---|
| **Twitter/X** | ✅ Scraped (core platform) | Posts, profiles, followers, trends | Crypto Twitter is the main social layer |
| **Telegram** | ❌ Not scraped | Crypto group chats, channels, bots | PRIMARY crypto communication platform |
| **Discord** | ❌ Not scraped | Crypto community servers, alpha channels | Major crypto community platform |
| **Farcaster** | ❌ Not scraped | Crypto-native social protocol | Growing crypto social graph |
| **Lens Protocol** | ❌ Not scraped | Decentralized social graph | Web3-native social |
| **Reddit** | ✅ Scraped | r/cryptocurrency, r/solana, r/memecoins | Crypto community discussions |
| **Bluesky** | ✅ Scraped | Crypto Twitter refugees | Growing crypto presence |

### Layer 5: Trading/Alpha Tools (Scrapable Dashboards)

| Tool | Type | Scrapable Data |
|---|---|---|
| **GMGN** | Sniper bot | Token alerts, snipe results, market data |
| **Axiom** | AI research | Sentiment reports, market summaries |
| **BullX** | Trading terminal | Price alerts, trade signals |
| **Kolscan** | KOL tracker | Top trader wallets, positions, PnL |

---

## 3. Gap Analysis — Deduped Against Consumer Repos

**Critical boundary finding (from reading jev-trading's epics + source):** jev-trading already scrapes several crypto sources **directly**, bypassing XActions. Building a scraper in XActions for a source jev already connects to = pure duplication. The dedup matrix below separates "genuinely missing" from "jev does it itself."

### 3a. What jev-trading Already Scrapes DIRECTLY (do NOT duplicate in XActions)

Verified in `jev-trading/src/` + `epics.md`:

| Source | Jev's own implementation | Evidence |
|---|---|---|
| **pumpportal.fun WS** | `Story 1.1` — `wss://pumpportal.fun/api/data` `subscribeNewToken` in worker_thread | `epics.md`, `src/` connect log `wss://pumpportal.fun` |
| **Pump.fun social** | `src/social/pumpFunCrawler.ts` — own class, direct `frontend-api-v3` fetch (NOT via x_scrape) | file exists, `PUMP_API = 'https://frontend-api-v3.pump.fun'` |
| **kolscan.io** | `refreshKolWallets()` — fetches `kolscan.io/api/top-traders` every 10min | `KOLSCAN_API` const in pumpFunCrawler.ts |
| **Solana RPC** | `api.mainnet-beta.solana.com` + `mainnet.helius-rpc.com` — `getTokenLargestAccounts`, bonding-curve reads | connect log, Story 1.2/5.1 |
| **Helius + Triton gRPC** | `api.helius.xyz` — trade stream, smart-money radar (Story 4.4) | connect log, FR-20 |
| **Dexscreener REST** | TP Monitor **fallback** — `tpMonitor.ts` uses Dexscreener when Triton stale >5s (FR-19, C3 fix) | `tpMonitor.ts`, FR-19 |
| **Telegram** | `src/alerts/telegram.ts` — bot token, entry/exit/panic alerts | connect log `api.telegram.org`, Story 6.4/7.5 |
| **X search** | `xactionsClient.ts` → `POST /api/ai/discovery/search` → XActions queue | **This IS the XActions consumption path** |

→ **Jev self-serves:** on-chain (RPC/Helius/Triton), launch stream (pumpportal), price/TP fallback (Dexscreener), KOL list (kolscan), alerts (Telegram). These are **jev's domain — XActions should NOT rebuild them.**

### 3b. What XActions Owns That Jev Already Consumes (the real contract)

| XActions surface | Jev usage | Gap |
|---|---|---|
| `POST /api/ai/discovery/search` (X search job) | `xactionsClient.searchTwitter()` | Works, but returns [] without `XACTIONS_SESSION_COOKIE` — session-dependent |
| `PumpFunCrawler` (theses, comment velocity, kolscan, livestream) | Jev's Story 2.2 spec'd it BUT reimplemented in-repo instead of calling `x_scrape` | **Divergence**: jev's own copy vs XActions' canonical crawler — drift risk |
| `RedditCrawler.search` | `xactionsClient.searchReddit()` **returns []** — jev notes "no public reddit-search route in XActions" | **Real gap**: jev wants Reddit content search, XActions `reddit` crawler HAS `search` action but no REST route jev can reach |
| Telegram channels | Deferred v2 in jev — "XActions chưa có TelegramCrawler" | **Real gap**: jev wants Telegram crypto channels, XActions has none |

### 3c. Genuinely Missing — Worth XActions Building

After removing jev's self-served sources and XActions' existing coverage:

| Data | Consumer need | Why XActions (not jev) |
|---|---|---|
| **Reddit content search route** | jev `searchReddit()` returns [] today | Reddit crawler exists (`search` action) but isn't exposed on the REST/MCP surface jev calls — wiring gap, not new scrape |
| **Telegram crypto channel monitor** | jev Epic 2 deferred: "cần TelegramCrawler"; Nowing needs crypto corpus | Nowhere in either repo; Telegram = crypto's primary comms platform |
| **Dexscreener as canonical scraper** | jev uses it ad-hoc as TP fallback; ChainLens needs DEX data generally | jev's usage is narrow (price fallback); a platform scraper serves ALL consumers — but ONLY if jev would actually route through it |
| **Farcaster / Lens crypto social** | Nowing (new social graphs), jev (crypto sentiment beyond X) | Neither repo touches it; unique crypto-native social data |

### 3d. NOT Worth Building (already covered elsewhere)

| Rejected | Why |
|---|---|
| pumpportal WS scraper | jev Story 1.1 already runs it in worker_thread — duplicating = two consumers of same free stream, no added value |
| Solana RPC crawler | jev calls RPC/Helius/Triton directly for latency-critical paths (<5s NFR); routing via XActions adds latency jev can't tolerate |
| kolscan scraper | jev refreshes `kolscan.io/api/top-traders` every 10min already |
| pump.fun trade stream | jev's PumpPortal + Triton already cover real-time trades; XActions' pump.fun niche is *social* (theses/comments), not trade tape |
| CoinGecko price scraper | jev doesn't need it (has Dexscreener fallback + on-chain); ChainLens could want it but it's a thin REST wrapper — low moat |

---

## 4. Recommended Crypto Scraping Expansions

### Tier 1: Immediate — Fill Real Gaps (Deduped)

After removing jev-trading's self-served sources, the highest-value items for XActions are **wiring existing capability to consumers** + **the one big missing social platform**:

| # | Item | Type | Data | Effort | Consumer Value |
|---|---|---|---|---|---|
| D1 | **Reddit content-search on `x_scrape`/REST** | Wiring (not new scrape) | `reddit` crawler HAS `search` action but jev's `searchReddit()` returns [] — no reachable route | 1 day | Jev: Story 2.1 explicitly wants it; Nowing: crypto subreddit corpus |
| D2 | **pump.fun `/coins/{mint}` action** | New action on existing crawler | Full coin metadata: market_cap_usd, bonding_curve, creator, twitter/telegram/website, image, ATH — verified 200 via CF session (crawler already passes CF) | 1 day | Jev: deployer/social-link checks (Story 1.2 uses `user-created-coins`); ChainLens: token metadata |
| D3 | **Dexscreener `crypto/dexscreener` platform** | New platform crawler | search pairs w/ `info.socials[]`, token→pairs, token-profiles, token-boosts, `/orders` paid-listing signal — 5 endpoints free, no key, multi-chain | 2-3 days | ChainLens: DEX market data generally; jev: could replace ad-hoc TP fallback + get social links — **conditional on jev routing through it** |

### Tier 2: The Big Missing Social Platform

| # | Item | Type | Data | Effort | Consumer Value |
|---|---|---|---|---|---|
| D4 | **Telegram crypto channel monitor** | New platform | Public channel/group messages (Bot API `getUpdates` for channels where bot is member; or MTProto user-client for public channels) | 1-2 weeks | jev Epic 2 Story 2.1 **deferred specifically because XActions lacks it**; Nowing: largest missing crypto corpus |
| D5 | **Farcaster** | New platform | Crypto-native casts/channels via Hub API or Neynar | 3-5 days | Nowing: Web3 social graph; jev: sentiment beyond X |

### Tier 3: Watch / Conditional

| # | Item | Note |
|---|---|---|
| D6 | **Discord crypto servers** | Similar to Telegram but gated by server membership/invite; probe feasibility first |
| D7 | **Kolscan deeper scrape** | jev self-serves top-traders; only worth it if consumers need per-wallet PnL pages (SPA, browser-gated) |
| D8 | **letsbonk/moonshot** | Social-trading copy-signals; low public API surface — probe before estimating |

### Rejected After Dedup (jev already owns / low marginal value)

| Rejected | jev's existing coverage |
|---|---|
| pumpportal WS in XActions | jev Story 1.1 runs `subscribeNewToken` in worker_thread directly |
| Solana RPC / Helius / Triton | jev calls directly — latency-critical (<5s NFR), can't route through XActions |
| kolscan top-traders | jev `refreshKolWallets()` every 10min already |
| pump.fun trade tape | jev's PumpPortal + Triton cover real-time trades; XActions' pump.fun value is *social* only |
| CoinGecko price scraper | jev doesn't need it; ChainLens marginal — thin REST wrapper, low moat |
| Jupiter swap routes | deprecated endpoint + jev executes swaps itself in Phase 2 — not a scrape need |

### Priority Scoring (deduped)

| Item | Data Value | Effort Inv | Consumer Demand | Uniqueness | **Total** |
|---|---|---|---|---|---|
| D1 Reddit search route | 4 | 5 | 5 (jev blocked today) | 4 | **18** |
| D2 pumpfun coin meta | 5 | 5 | 4 | 4 | **18** |
| D3 Dexscreener platform | 5 | 4 | 4 | 5 | **18** |
| D4 Telegram monitor | 5 | 2 | 5 | 5 | **17** |
| D5 Farcaster | 3 | 3 | 3 | 5 | **14** |
| D6 Discord | 4 | 2 | 4 | 4 | **14** |

### Top Recommendations (post-dedup)

**Ship D1 + D2 first (2 days total)** — both are near-zero-risk: D1 wires an existing crawler action to a route jev is already trying to call; D2 adds one action to the live pump.fun crawler for an endpoint already probed live.

**Then D3 (Dexscreener)** — the only genuinely new *platform* worth building now: free, multi-chain, and the only source providing token→social-links map + paid-boost legitimacy signal. **Gate condition:** confirm jev will consume it via `x_scrape` rather than keep its own Dexscreener fallback — otherwise ChainLens alone may not justify the platform.

**D4 (Telegram)** is the strategic unlock — the only platform both jev (deferred) and Nowing (missing corpus) want that exists in neither repo. Biggest effort but also biggest moat.

**Explicitly dropped:** C4 CoinGecko (low moat, jev doesn't need), C5 pumpportal (jev owns it), C8 Solana RPC (jev owns it), C6 Birdeye (key-gated, overlaps Helius jev already pays for), C11 Jupiter (endpoint churn + jev's own concern).

---

## 4b. Live-Probe Verified Findings (Round 2)

### Dexscreener — Hidden Gem Signals
Probe `api.dexscreener.com` trả 5 endpoint families miễn phí không cần key [10]:

1. **`/latest/dex/search?q=`** — 30 pairs/query, mỗi pair có `info.socials[]` (twitter/telegram/website) + `info.imageUrl`. Đây là **token→social-handle map miễn phí** — downstream consumers map token → X/Telegram handles không cần scrape riêng.
2. **`/latest/dex/tokens/{addr}`** — mọi DEX pair cho 1 token (Orca, Raydium, Meteora...) với liquidity.usd + priceUsd + txns.
3. **`/token-profiles/latest/v1`** — token profiles với description + links — phát hiện token mới có marketing effort.
4. **`/token-boosts/latest/v1`** — tokens đang được boost (paid ads) = interest signal.
5. **`/orders/v1/{chain}/{token}`** — lịch sử dev trả tiền cho Dexscreener listing (status + paymentTimestamp) — **"dev đầu tư marketing" legitimacy signal** mà chỉ Dexscreener expose.

→ Một crawler `crypto/dexscreener` với ~5 actions cover phần lớn nhu cầu "token market data" của Jev Trading + ChainLens, miễn phí.

### Corrections Applied (live probe debunked assumptions)
- ~~Jupiter `quote-api.jup.ag/v6`~~ → deprecated; migrate `lite-api.jup.ag` — chưa estimate effort được tới khi re-probe.
- ~~Birdeye free no-key~~ → `public-api.birdeye.so` trả `Unauthorized` — cần registered key (miễn phí nhưng phải register).
- ~~GMGN REST scrape~~ → Cloudflare HTML challenge — phải dùng got-jsdom/curl transport (đã có trong XActions từ pump.fun Epic 20).
- ~~pump.fun `/coins/{mint}` là public REST~~ → 404 qua curl thuần, 200 qua in-browser fetch → **yêu cầu CF session**, crawler XActions đã handle.
- ~~Raydium/Orca scrapers riêng~~ → Dexscreener `dexId` field đã cover — không cần platform mới.

## 5. Architecture Notes

### Pattern: Adding a New Crypto Platform

Each new crypto source follows the existing descriptor contract:

```
src/scrapers/crypto/{platform}/
├── descriptor.js    → aliases, actionMap, mapArgs, createClient, createCrawler
├── client.js        → AbstractApiClient subclass (rate limits, proxy, dedup)
├── crawler.js       → AbstractCrawler subclass (registerAction per action)
├── normalizer.js    → map raw API response → ThinEvent-compatible items
└── index.js         → barrel export
```

Registration: add descriptor to `DESCRIPTORS` in `src/scrapers/index.js` + `CANONICAL_PLATFORMS` + `PLATFORM_CATEGORIES` (category: `'crypto'`) + `crawlerLoaders` in `actions-list.js`.

### New Category: `crypto`

Add `crypto` to `PLATFORM_CATEGORIES` and `CATEGORY_MAP` — distinct from `social` since crypto sources produce market data, not just social posts. This enables `x_scrape` filtering by `category: 'crypto'`.

### Streaming vs Batch

Crypto data is time-sensitive (seconds, not hours). Prioritize:
- **WebSocket streams** where available (pumpportal, pump.fun livechat, Telegram)
- **REST polling** with short intervals for APIs without WS (Dexscreener, CoinGecko)
- **ThinEvent emission** into Redis Streams for all — same pattern as existing crawlers

---

## 6. Cross-Dimension Insights (post-dedup)

### The Drift Risk Is the Real Finding
jev-trading **reimplemented `PumpFunCrawler` in its own repo** (`src/social/pumpFunCrawler.ts`) rather than calling XActions' canonical crawler — direct `frontend-api-v3` fetch, own rate limiter, own kolscan cache. Two copies of the same scraper now drift independently. Any XActions expansion plan must first answer: *why did jev fork instead of consume?* Likely: (a) latency — jev needs <5s/token, XActions' queue+poll is ~45s; (b) `x_scrape` MCP wasn't the integration path at Epic-2 spec time; (c) session-cookie requirement for X search. **The moat isn't the scraper — it's making consumers prefer `x_scrape` over DIY.**

### Latency Is the Unspoken Filter
Crypto trading data bifurcates cleanly by latency budget. **Sub-second** (mint events, trade tape, TP triggers): jev must own it — gRPC/WS direct; can't route through a scraping service. **Seconds-to-minutes** (social sentiment, Reddit, Telegram, token metadata, KOL flagging): XActions' model fits fine. This latency line is the real boundary between what jev self-serves and what it should consume — and it explains why Dexscreener is borderline (jev uses it as a *slow-path* fallback → could consume via XActions) while Triton/pumpportal are not.

### Social/Auth-Gated Scraping Is XActions' Actual Domain
On-chain and market data are commoditized (free RPC, free Dexscreener). What jev *can't* easily self-serve is **auth-gated, anti-bot social scraping** — Telegram crypto channels, Discord alpha servers, Reddit search, pump.fun CF-protected endpoints. That's precisely XActions' existing competency (proxy pools, CF bypass via got-jsdom/curl transport, session management). Crypto expansion should play to that moat, not chase commodity API wrappers jev can fetch with one `fetch()`.

---

## 7. Source Appendix

| [n] | Claim/Finding | Publisher | Pub Date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | Crypto API landscape, pricing, rate limits | chainlens_ask deep/quality | 2026-09 | 2026-09-26 | MED |
| [2] | Tool comparison matrix (8 tools) | chainlens_ask deep/quality | 2026-09 | 2026-09-26 | MED |
| [3] | Solana ecosystem metrics | chainlens_ask deep/quality | 2026-09 | 2026-09-26 | LOW-MED |
| [4] | pump.fun API surface — live/removed endpoints | Live browser probe | 2026-09 | 2026-09-25 | HIGH |
| [5] | XActions codebase capability inventory | Internal analysis | 2026-09 | 2026-09-26 | HIGH |
| [6] | Pump.fun crawler actions + descriptor contract | `src/scrapers/social/pumpfun/` | 2026-09 | 2026-09-26 | HIGH |
| [7] | Canonical platforms + categories | `src/scrapers/social/actions-list.js` | 2026-09 | 2026-09-26 | HIGH |
| [8] | ThinEvent + Redis Stream format | `src/core/types.js`, `src/utils/redis-stream-publisher.js` | 2026-09 | 2026-09-26 | HIGH |
| [9] | Epic 20 sprint status + context | `_bmad-output/implementation-artifacts/` | 2026-09 | 2026-09-26 | HIGH |
| [10] | Dexscreener 5 endpoints verified free (search, tokens, token-profiles, token-boosts, orders) | Live curl probe `api.dexscreener.com` | 2026-09 | 2026-09-26 | HIGH |
| [11] | CoinGecko ping + trending verified; GeckoTerminal token price verified | Live curl probe | 2026-09 | 2026-09-26 | HIGH |
| [12] | Solana public RPC `getHealth`/`getLatestBlockhash` verified | Live curl probe `api.mainnet-beta.solana.com` | 2026-09 | 2026-09-26 | HIGH |
| [13] | Birdeye rejects no-key; GMGN CF-gated; Jupiter v6 deprecated; pumpportal WS-only | Live curl probes | 2026-09 | 2026-09-26 | HIGH |
| [14] | jev-trading self-serves pumpportal WS, Solana RPC, Helius/Triton, kolscan, Dexscreener-fallback, Telegram | `jev-trading/src/` connect log + `epics.md` Stories 1.1/4.4/6.4/7.5 | 2026-09 | 2026-09-26 | HIGH |
| [15] | jev reimplemented PumpFunCrawler in-repo (`src/social/pumpFunCrawler.ts`) rather than consuming `x_scrape` — drift risk | `jev-trading/src/social/pumpFunCrawler.ts`, `xactionsClient.ts` | 2026-09 | 2026-09-26 | HIGH |
| [16] | jev `searchReddit()` returns [] — "no public reddit-search route in XActions"; Telegram deferred v2 | `jev-trading/src/social/xactionsClient.ts` | 2026-09 | 2026-09-26 | HIGH |
| [17] | jev latency NFR <5s/token + <1s mint-to-queue — on-chain data can't route through XActions | `jev-trading` PRD NFR-1/NFR-5, epics Story 1.1 | 2026-09 | 2026-09-26 | HIGH |

---

## 8. Staleness Map

| Claim | Class | Pub Date | Re-check By | Notes |
|---|---|---|---|---|
| API rate limits (CoinGecko, Dexscreener, Birdeye) | technical | 2026-09 | 2026-12 | Rate limits change quarterly |
| Pump.fun API endpoints | technical | 2026-09 | 2026-10 | API surface changes frequently |
| Crypto platform landscape | market | 2026-09 | 2026-12 | New platforms emerge monthly |
| XActions platform registry | technical | 2026-09 | 2026-12 | New platforms added each epic |

**Earliest re-check**: 2026-10 for pump.fun API stability.

