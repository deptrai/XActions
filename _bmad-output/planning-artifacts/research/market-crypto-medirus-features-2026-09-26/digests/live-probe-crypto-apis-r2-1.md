# DIGEST: Live API probe — crypto data sources verified (r2, 2026-09-26)

**Method:** direct curl probes từ local, ghi nhận endpoints thật sự trả data vs dead/auth-gated.

## ✅ VERIFIED FREE, NO KEY

### Dexscreener (api.dexscreener.com) — RICHEST free source
| Endpoint | Status | Data |
|---|---|---|
| `GET /latest/dex/search?q={q}` | 200 | 30 pairs: chainId, dexId, pairAddress, baseToken, quoteToken, priceNative/Usd, txns (m5/h1/h6/h24 counts+buys/sells), volume, priceChange, liquidity, fdv, marketCap, pairCreatedAt, info (image/socials/websites!) |
| `GET /latest/dex/tokens/{addr}` | 200 | 30 pairs per token — Orca/Raydium/etc, priceUsd, liquidity.usd, fdv |
| `GET /token-profiles/latest/v1` | 200 | Latest 30 token profiles: url, chainId, tokenAddress, icon, header, openGraph, description, links[] |
| `GET /token-boosts/latest/v1` | 200 | Boosted tokens (paid promotion = interest signal) |
| `GET /orders/v1/{chain}/{token}` | 200 | Paid order history: tokenAd/tokenProfile status + paymentTimestamp — **detects when dev pays for Dexscreener listing = legitimacy signal** |
- Rate limit: behind CF (cf-cache-status HIT); public docs ~300 req/min. CF challenge on /token-profiles/latest (non-v1 path) — dùng `/v1` suffix.
- **Gold**: search trả `info.socials[]` (twitter/telegram/website) — map token → social handles FREE.

### CoinGecko (api.coingecko.com/api/v3)
| Endpoint | Status | Data |
|---|---|---|
| `/ping` | 200 | alive |
| `/search/trending` | 200 | 15 coins + 7 NFTs + 6 categories trending |
| `/coins/{id}/market_chart/range` | 200 | historical OHLCV (đã dùng trong priceCorrelation.js) |
- 10K calls/mo, ~100 req/min, no key. x-request-id trả về, không có explicit rate headers.

### GeckoTerminal (api.geckoterminal.com/api/v2)
| Endpoint | Status | Data |
|---|---|---|
| `/networks/{net}/tokens/{addr}` | 200 | name, symbol, price_usd, fdv_usd, total_supply |
| `/networks/{net}/pools/{pool}/ohlcv/...` | 200 | hourly OHLCV (đã dùng trong priceCorrelation.js) |
- Free, no key. Multi-chain (solana, eth, bsc...). DEX-pool granularity vs CoinGecko coin granularity.

### Solana public RPC (api.mainnet-beta.solana.com)
| Method | Status |
|---|---|
| `getHealth` | ok |
| `getLatestBlockhash` | ok |
- Free JSON-RPC — blockhash, lastValidBlockHeight 428533638. Rate-limited nhưng usable. `solana-mainnet.pump.fun` cũng là RPC proxy (từ prior digest).

## ⚠️ NEEDS KEY / DEPRECATED / BLOCKED

| Source | Result | Note |
|---|---|---|
| pumpportal.fun | root 200, `/api/data` GET 404 | WS-only endpoint `wss://pumpportal.fun/api/data` — cần WS connect, không phải GET |
| Birdeye `public-api` | `{"success":false,"message":"Unauthorized"}` | cần API key thật — free tier có nhưng phải register |
| GMGN | Cloudflare HTML challenge | browser-gated — cần got-jsdom/curl transport như pump.fun |
| kolscan.io | 200 HTML | SPA — data qua internal API, cần probe sâu hơn |
| Jupiter quote-api v6 | dead/empty | Jupiter đã migrate sang `lite-api.jup.ag` (v1) — endpoint cũ deprecated |
| tokens.jup.ag | HTTP 000 | timeout/dead — Jupiter API surface đã đổi |
| `frontend-api-v3.pump.fun/coins/{mint}` | 404 curl | CẦN CF browser session — in-browser fetch trả 200 (prior digest), plain curl bị chặn. XActions crawl qua browser/CF-passing transport = OK |
| `frontend-api-v3.pump.fun/coins/currently-live` | ✅ 200 với UA+Origin headers | không cần auth cho feed endpoint, chỉ cần browser-like headers |

## Key insight: Dexscreener = highest-value add

Dexscreener free API cover: **multi-chain DEX data (solana/eth/bsc/base...) + token social links + boost/paid-order signals** — 3 data classes in 1 source, no key. Tương đương pump.fun's `fetch_mint_social` nhưng cho MỌI DEX token, mọi chain.

`/orders/v1` endpoint là unique signal: khi dev trả tiền boost/profile trên Dexscreener → đó là "dev đầu tư marketing" signal mà Jev Trading có thể dùng đánh giá legitimacy.
