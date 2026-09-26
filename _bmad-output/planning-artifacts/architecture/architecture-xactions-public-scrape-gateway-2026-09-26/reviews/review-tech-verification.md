# Review: Tech-Currency Verification (inline, gate blocker)

Reviewer: Winston (inline substitute — parallel subagent blocked on tool access)
Date: 2026-09-26
Verdict: PASS-WITH-FIXES — all codebase claims verified; ONE material gap on x402 route coverage.

## Claims verified against codebase

| # | Spine claim | Result | Evidence |
|---|---|---|---|
| C1 | `POST /api/platform/:platform/scrape` exists, sync | ✅ | `api/routes/platform.js:389` `router.post('/:platform/scrape', ...)` calls `scrape()` direct, `res.json({ok:true,...})` |
| C2 | `router.use(authenticate)` JWT-gates the route | ✅ | `api/routes/platform.js:219` applies to all `/api/platform/*` routes |
| C3 | `VALID_CONSUMER_IDS=['nowing','chainlens','internal']`, `identifyConsumer`, `extractBearerToken`, timingSafeEqual | ✅ | `src/mcp/consumer-context.js:24,54,78,83` — unknown→`internal` confirmed (line 45) |
| C4 | `api/middleware/x402.js` exists w/ `paidRoute` | ✅ | `api/middleware/x402.js:69` `paidRoute(price,description)`; SDK `@x402/express` mounted at `api/server.js:279` `app.use(x402Middleware)` |
| C5 | `scrape(platform,action,options)` + `UniversalActionDispatcher` | ✅ | `src/scrapers/index.js:274` + `:281-283` batch dispatch |
| C6 | `DistributedTokenBucket` + `ProxyIpPool` | ✅ | `src/core/distributed-token-bucket.js`, `src/proxy/proxy-pool.js`, `src/core/proxy-budget-governor.js` |
| C7 | Reddit crawler has `search` action | ✅ | `src/scrapers/social/reddit/crawler.js:155-177` `registerAction({action:'search',...})` → `searchReddit()` `:483` |
| C8 | PumpFunCrawler exists w/ actions | ✅ | `src/scrapers/social/pumpfun/` 14 files; `fetch_mint_social` already bundles `coinMeta` via `client.getCoin(mint)` + `normalizeCoinMeta` (`crawler.js:270-288`) |
| C9 | Bull+Redis jobQueue | ✅ | `api/services/jobQueue.js:3` `import Queue from 'bull'`, `:43` `new Queue('operations',...)` |
| C10 | VALID_PLATFORMS incl. reddit+pumpfun | ✅ | `api/routes/platform.js:26-34` + `PLATFORM_ALIASES['pump','pump.fun']→'pumpfun'` |

## Material finding — HIGH

**F-TECH-1 (HIGH): x402 middleware does NOT currently cover `/api/platform/:platform/scrape`.**
`x402Middleware` mounts globally at `api/server.js:279`, but `buildRouteConfig()` (x402.js:88-115) only iterates `AI_OPERATION_PRICES` (`POST /api/ai/{category}/{action}`) and `SCRIPT_PRICES` (`GET /api/scripts/*`, `POST /api/scripts/run`). No `POST /api/platform/*/scrape` entry exists.

The spine's AD-2 + OQ-3 claim "x402 (already implemented in `api/middleware/x402.js`)" is technically true but **misleading** — the paid-route map does not include the gateway route. To make x402 actually engage for third-party scrape calls, `buildRouteConfig` (or an equivalent route-config extension) must add explicit `POST /api/platform/:platform/scrape` entries per platform+action.

**Fix**: clarify in spine that x402 needs a *config extension* (not "already wired"), OR add a Structural Seed row: `api/middleware/x402.js — EXTEND route config to cover /api/platform/:platform/scrape`.

## Currency check (2026)

- Express 4 API still current — `router.use`, `router.post`, `req/res/next` — ✅
- `@x402/express` v2 (`@x402/core/server` types referenced at x402.js:46) — current package name ✅
- Bull (not BullMQ) in jobQueue — noted; Bull maintenance-mode → BullMQ migration is a deferred concern, not a spine blocker ✅
- pump.fun `frontend-api-v3.pump.fun/coins/{mint}` — confirmed live via `src/scrapers/social/pumpfun/client.js:406` `getCoin` ✅
- Redis Streams (`stream:social:raw_posts`) — exists per `src/utils/redis-stream-publisher.js` ✅
- Telegram MTProto vs Bot API — correctly deferred (matches OQ/deferred table) ✅

## Lower findings

- F-TECH-2 (LOW): `fetch_coin_meta` does not exist as a separate registered action — `fetch_mint_social` already returns `coinMeta` inline. Spine should clarify D2 means "expose coin-meta-only lightweight action" (e.g. `fetch_coin_meta` wrapping `client.getCoin` alone, ~300ms) NOT a heavy full-social call.
- F-TECH-3 (LOW): `identifyConsumer` is **only bound to the MCP bridge** (`api/routes/mcp-bridge.js:14,52`), NOT to `/api/platform/*` REST. Spine correctly calls this out via "serviceAuth lane (NEW)" — confirmed accurate.

## Recommendation

PASS-WITH-FIXES. Apply F-TECH-1 (HIGH) fix in spine; note F-TECH-2 wording.
