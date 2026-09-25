---
title: 'Story 20.5 — PumpFun Native Social Crawler'
type: 'feature'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a42033fad6308a279df34c54e31602d4dd200bee'
followup_review_recommended: true
context:
  - _bmad-output/implementation-artifacts/epic-20-context.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Chưa có crawler nào ingest tín hiệu social của pump.fun (theses, comment velocity, top holders, KOL activity, livestream status) — consumer trading (jev-trading, bot, analytics) không có nguồn dữ liệu social real-time cho Solana mint token mà không dùng headless browser.

**Approach:** Thêm `PumpFunCrawler` kế thừa `AbstractCrawler` + `PumpFunClient` kế thừa `AbstractApiClient`, gọi `frontend-api-v3.pump.fun` unauthenticated HTTP/2 REST, đăng ký action `fetch_mint_social` và wire vào dispatcher + actions-list như mọi platform khác.

## Boundaries & Constraints

**Always:**
- `PumpFunCrawler extends AbstractCrawler` (`src/core/base-crawler.js`); `PumpFunClient extends AbstractApiClient` (`src/core/base-client.js`); action snake_case `fetch_mint_social` đăng ký qua `registerAction()` → `globalActionRegistry`; category `'social'`, `requiresAuth: false`.
- Validate Solana mint address bằng Base58 regex `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/` tại client trước khi request — mint sai → `PlatformError(XACT_4002)` không gửi request, không tốn token.
- In-flight request deduplication: nhiều caller query cùng 1 mint trong cửa sổ ≤3s → tái sử dụng 1 Promise in-flight.
- Thực thi `Promise.allSettled` 2 requests trên cùng 1 sticky proxy IP: `GET /mint-positions/{mint}?sortBy=TOP&withThesis=true` + `GET /replies/{mint}?offset=0&limit=50`. Mục tiêu <300ms round-trip.
- Sticky proxy theo mint address qua `ProxyIpPool.getStickyProxy()`; auto-quarantine khi HTTP 429; `DistributedTokenBucket` trần 40 req/phút/IP (Redis Lua, fallback in-memory).
- HTTP 403 (Cloudflare TLS fingerprint block) → fallback `createCurlTransport('pumpfun')`; HTTP 200 body rỗng → `JevChallengeDiagnoser` xác minh silent block trước khi trả rỗng.
- KOL matching đối chiếu cache 2 tầng `kolscan.io` (Redis TTL 10m) + file seed `config/kol-wallets-seed.json`; kolscan unreachable → dùng seed file, không gián đoạn luồng.
- Livestream status qua background poller 30s quét `/coins/currently-live` vào in-memory set; `fetchMintSocial` check set với 0ms per-request latency.
- `commentVelocity` tính từ mẫu ≤50 replies (1 request duy nhất, không pagination) → `{ last1m, last5m }`.
- Error mapping: mint không tồn tại → `XACT_4004`; rate limit → `XACT_4029` + backoff.
- Đăng ký đủ 4 chỗ: `descriptor.js` + `src/scrapers/index.js` DESCRIPTORS + `actions-list.js` (`CANONICAL_PLATFORMS` + `PLATFORM_CATEGORIES` + `crawlerLoaders`) + `types/index.d.ts`.

**Never:**
- Không dùng headless browser / Puppeteer / Playwright.
- Không duy trì WebSocket streaming chat (Phase 1).
- Không pagination replies vượt 1 request (tránh cạn rate-limit).
- Không emit stream events khi `dryRun=true` (tuân thủ base hook Story 20.2).
- Không bypass `scrape()` dispatcher bằng API surface riêng.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `fetch_mint_social({ mintAddress: <valid Base58> })` | `{ theses[], commentVelocity:{last1m,last5m}, kolActivity, livestream }` normalized | No error expected |
| INVALID_MINT | `mintAddress: 'bad!'` | throw trước khi request | `PlatformError(XACT_4002)` |
| MINT_NOT_FOUND | mint hợp lệ nhưng pump.fun 404 | — | `PlatformError(XACT_4004)` |
| RATE_LIMIT | upstream 429 | proxy quarantine + backoff | `XACT_4029` + retryAfterMs |
| TLS_BLOCK | HTTP/2 bị Cloudflare 403 | fallback `createCurlTransport('pumpfun')` retry | retry qua curl |
| EMPTY_200 | HTTP 200 body rỗng | `JevChallengeDiagnoser` xác minh trước khi trả rỗng | diagnoser gate |
| KOLSCAN_DOWN | kolscan.io unreachable | dùng `config/kol-wallets-seed.json` | graceful fallback, no throw |
| DEDUP | 3 caller cùng mint trong ≤3s | 1 upstream request, 3 caller nhận chung Promise | shared in-flight |
| LIVESTREAM_OFF | mint không trong `/coins/currently-live` set | `livestream.isActive=false` | no extra request |

</intent-contract>

## Code Map

- `src/core/base-crawler.js` — `AbstractCrawler`; `registerAction({action,handler,...descriptor})` (line ~447, snake_case enforced, tự đăng `globalActionRegistry`); `start(command)` dispatch + stream hook; `listActions()`.
- `src/core/base-client.js` — `AbstractApiClient`; `request(method,url,options)` (line ~740); `client='curl'` → `#getDefaultHttpClient()` dùng `createCurlTransport` (line ~431); `RequestOptions` có `proxyPool`, `consumerId`, `pool`, `skipResponseValidation`, `raw`.
- `src/core/curl-transport.js` — `createCurlTransport(platform)` trả async `(reqOpts)=>{status,headers,data}`; fallback khi 403.
- `src/core/distributed-token-bucket.js` — `globalDistributedTokenBucket.consume(key, tokens, options)` (line ~222); `parseRateLimitHeaders(headers)` (line ~74).
- `src/core/jev-challenge-diagnoser.js` — `globalJevChallengeDiagnoser.diagnose({snippet,platform,accountId})` (line ~223); `extractSnippet(body)` (line ~103).
- `src/core/schema-drift-guard.js` — `globalSchemaDriftGuard` classify/normalize thesis metadata drift.
- `src/core/action-registry.js` — `globalActionRegistry.registerPlatformActions(platform, descriptors)` — tự gọi bởi `registerAction`.
- `src/proxy/proxy-pool.js` — `ProxyIpPool.getStickyProxy(accountId, requiresResidential, options)` (line ~437) — sticky key theo mint; `quarantine(proxy, durationMs)` (line ~496); `getProxy({pool})`.
- `src/scrapers/index.js` — DESCRIPTORS map (line ~213); thêm `import pumpfunDescriptor` + đăng ký trong mảng for-loop.
- `src/scrapers/social/actions-list.js` — `CANONICAL_PLATFORMS` + `PLATFORM_CATEGORIES` + `crawlerLoaders` — thêm `'pumpfun'` cả 3 chỗ.
- `src/scrapers/social/reddit/` — **reference implementation** (client/crawler/descriptor/normalizer/index) gần nhất về pattern social-native unauthenticated REST.
- `config/kol-wallets-seed.json` — **new** KOL wallet seed file (fallback khi kolscan.io down).
- `types/index.d.ts` — thêm declaration cho `PumpFunCrawler`, `createPumpFunCrawler`, `PumpFunMintSocialResult`.

## Tasks & Acceptance

**Execution:**
- `src/scrapers/social/pumpfun/client.js` — `PumpFunClient extends AbstractApiClient` (`name='pumpfun'`, `requiresAuth=false`, `client='undici'` default); `assertValidMint()` Base58 check → `XACT_4002`; `getMintPositions(mint)` + `getReplies(mint)` qua `request()`; 403 → `createCurlTransport('pumpfun')` fallback; 200-rỗng → `globalJevChallengeDiagnoser`; 429 → `XACT_4029`+backoff; 404 → `XACT_4004`.
- `src/scrapers/social/pumpfun/crawler.js` — `PumpFunCrawler extends AbstractCrawler` (`name='pumpfun'`, `category='social'`); `registerAction('fetch_mint_social')`; handler `fetchMintSocial(mintAddress)` orchestrate: sticky proxy per mint → `Promise.allSettled` 2 calls → dedupe ≤3s → normalize → trả `PumpFunMintSocialResult`; `createPumpFunCrawler()` factory.
- `src/scrapers/social/pumpfun/velocity.js` — `computeCommentVelocity(replies)` time-delta nội suy `{last1m,last5m}` từ ≤50 replies.
- `src/scrapers/social/pumpfun/kolscan.js` — `matchKols(wallets)` cache 2 tầng: `fetch kolscan.io` (Redis TTL 10m) → fallback `config/kol-wallets-seed.json`; trả `{isKolPresent,kolCount,matchedKols[]}`.
- `src/scrapers/social/pumpfun/livestream.js` — `LivestreamPoller` background interval 30s → `GET /coins/currently-live` → in-memory `Set`; `isLive(mint)` → `{isActive,viewers,roomId?}` 0ms.
- `src/scrapers/social/pumpfun/comments.js` — normalize raw replies → `CommentItem[]`/thesis shapes (dùng cho velocity + theses extraction).
- `src/scrapers/social/pumpfun/normalizer.js` — `normalizeThesis()`, `normalizeHolder()`, `namespacedPumpfunId()` → `pumpfun:${mint}`; chuẩn hóa thesis metadata qua `globalSchemaDriftGuard`.
- `src/scrapers/social/pumpfun/descriptor.js` — `aliases:['pumpfun','pump']`, `actionMap` (`mint_social`/`social`→`fetch_mint_social`), `mapArgs` (mintAddress/mint/address→mintAddress), `createClient`, `createCrawler`.
- `src/scrapers/social/pumpfun/index.js` — barrel export `PumpFunCrawler`, `createPumpFunCrawler`, `PumpFunClient`.
- `src/scrapers/index.js` — import `pumpfunDescriptor` + thêm vào DESCRIPTORS for-loop array.
- `src/scrapers/social/actions-list.js` — thêm `'pumpfun'` vào `CANONICAL_PLATFORMS`, `pumpfun:'social'` vào `PLATFORM_CATEGORIES`, thêm `crawlerLoaders` entry `import("./pumpfun/crawler.js").then(m=>new m.PumpFunCrawler())`.
- `config/kol-wallets-seed.json` — seed file KOL wallets (Solana Base58 → name?).
- `types/index.d.ts` — `PumpFunCrawler`, `PumpFunClient`, `createPumpFunCrawler`, `PumpFunMintSocialResult`, `Thesis`, `KolActivity`, `LivestreamStatus`, `CommentVelocity`.
- `tests/scrapers/social/pumpfun/pumpfun.test.js` — unit tests I/O matrix: invalid mint → 4002 no-request; dedup ≤3s; velocity math; KOL seed fallback; livestream set check; 404→4004; 429→4029; mock + live probe.

**Acceptance Criteria:**
- Given `new PumpFunCrawler()`, when `listActions()`, then trả `fetch_mint_social` với `category='social'`, `requiresAuth=false`, `requiredArgs=['mintAddress']`.
- Given mint sai Base58, when `fetchMintSocial`, then throw `XACT_4002` và `client.request` không được gọi.
- Given mint hợp lệ, when `fetchMintSocial`, then `Promise.allSettled` gọi đúng 2 endpoint `/mint-positions/{mint}?sortBy=TOP&withThesis=true` + `/replies/{mint}?offset=0&limit=50` trên cùng sticky proxy.
- Given 3 caller cùng 1 mint trong ≤3s, when fetch, then chỉ 1 upstream round-trip, cả 3 nhận cùng kết quả.
- Given 50 replies mẫu, when tính velocity, then `{last1m,last5m}` đúng time-delta nội suy; không request pagination thứ 2.
- Given kolscan.io down, when `matchKols`, then dùng `kol-wallets-seed.json`, trả `matchedKols` không throw.
- Given livestream poller đã quét, when `fetchMintSocial`, then `livestream.isActive` đọc từ in-memory set (0ms), không request riêng.
- Given HTTP 403, when request, then fallback `createCurlTransport('pumpfun')`; given 200-rỗng, then `JevChallengeDiagnoser` được gọi trước khi trả rỗng.
- Given `scrape('pumpfun','fetch_mint_social',{mintAddress})`, when dispatch, then descriptor resolve đúng crawler và trả result qua unified envelope.
- Given `executeActionListTool()`, when enumerate, then `pumpfun` xuất hiện với action `fetch_mint_social`, không `no_crawler` flag.
- Given `vitest run tests/scrapers/social/pumpfun`, then 100% pass.

## Spec Change Log

## Review Triage Log

### 2026-09-25 — Review pass
- verdicts: 3 findings — high 2, medium 1, low 0, false 0, maybe-false 0
- findings:
  - `[high]` `[patch]` kolscan seed path resolved to `src/config/` instead of repo root `config/` (`../../../` needed `../../../../`) — patched DEFAULT_SEED_PATH to use `../../../../config/kol-wallets-seed.json`, verified loads 1 wallet.
  - `[high]` `[patch]` DistributedTokenBucket rate gate was not wired in PumpFunClient (spec required 40 req/min/IP) — patched `#consumeRateToken` into `#apiGet` before request using `globalDistributedTokenBucket` (capacity=40, refillRate=40/60).
  - `[medium]` `[patch]` `src/mcp/server.js` `crawlerModuleMap` missing `'pumpfun'` — patched mapping in `executeScrapeTool`, ensuring `x_scrape` pre-validates `mintAddress` and surfaces `XACT_4002` with `missing[]` and `example`.


## Design Notes

**Output shape `PumpFunMintSocialResult`:**
```javascript
{
  mint: string,                       // namespaced externalId pumpfun:{mint}
  theses: Array<{ user, wallet, content, timestamp, holdings, pnlSol?, isKol }>,
  commentVelocity: { last1m: number, last5m: number },
  kolActivity: { isKolPresent, kolCount, matchedKols: [{name?, wallet}] },
  livestream: { isActive, viewers, roomId? },
  topHolders?: Array<{ wallet, balance, percent }>,
}
```

**In-flight dedup:** `Map<mint, {promise, expiresAt}>` — entry TTL ≤3s; concurrent caller `await` cùng promise; xóa sau settle + TTL.

**Livestream poller:** singleton per-process; `start()` trên crawler init; `stop()` trong `cleanup()`; failures backoff, không crash crawler. `/coins/currently-live` trả array coin objects — extract `mint` vào Set; `viewers`/`roomId` từ coin object khi có (field optional, có thể absent → undefined).

**Live API probe (2026-09-25) — điều chỉnh quan trọng so với epics.md:**
- `GET /mint-positions/{mint}?sortBy=TOP&withThesis=true` → 200 `{positions[],totalCount,hasMore}`. Position fields: `coinMint,userId,userName,profileImage,walletAddress,isVerified,accountKind,amountHeld,pnlUsd,pnlPercentage,realizedPnlUsd,costBasisUsd,...`. `pnlUsd`/`pnlPercentage` thay cho `pnlSol` trong spec gốc — map `pnlSol`←`pnlUsd` (hoặc expose cả hai, giữ `pnlUsd` canonical).
- `GET /replies/{mint}` → **404 Cannot GET** trên `frontend-api-v3` (cùng `/comments`, `/coins/{mint}/comments`, `/coins/{mint}/replies`, `/threads`, `/feed`, `/chat` đều 404). Endpoint comments/replies theo mint KHÔNG tồn tại trên v3. Implementer: `getReplies()` PHẢI graceful-degrade — khi upstream trả 404 cho replies path, coi như `replies=[]` và `commentVelocity={last1m:0,last5m:0}` thay vì throw `XACT_4004` (4004 chỉ cho mint-positions 404 = mint không tồn tại). Nếu resolve được endpoint comments thật khác (probe `coins/{mint}` trước khi commit), dùng nó; nếu không, giữ graceful-empty và ghi chú trong code.
- `GET /coins/currently-live` → 200 array `{mint,name,symbol,description,image_uri,bonding_curve,creator,...}`.
- Host alternates (`frontend-api`, `frontend-api-v2`, `advanced-api`, `swap-api`) → 530/503/404 — KHÔNG dùng; chỉ `frontend-api-v3.pump.fun`.
- Rate-limit thật: sau ~10 req nhanh → 429 `{statusCode:429,message:"Rate limit exceeded",retryAfterMs:98}` — xác nhận cần `DistributedTokenBucket` + backoff.

**Theses data flow (quan trọng):** `theses` KHÔNG đến từ `/replies` — `withThesis=true` embed `callout` object trong mỗi position: `position.callout = {calloutId, calledOutAtMcap, multiple, thesis, mediaUrl, calloutTimestamp, likes, hasLiked, updates[]}`. Map `theses[]` từ positions có `callout.thesis` non-empty: `{user:userName, wallet:walletAddress, content:callout.thesis, timestamp:callout.calloutTimestamp, holdings:amountHeld, pnlSol←pnlUsd, isKol←matchKols(walletAddress)}`. `/replies` (nếu resolve được) chỉ dùng cho `commentVelocity`; nếu 404 → velocity `{last1m:0,last5m:0}` graceful.

## Verification

**Commands:**
- `node -e "import('./src/scrapers/social/pumpfun/index.js').then(m=>console.log(new m.PumpFunCrawler().listActions()))"` — expected: in action `fetch_mint_social` snake_case.
- `vitest run tests/scrapers/social/pumpfun` — expected: 100% pass.
- `node -e "import('./src/scrapers/social/actions-list.js').then(m=>m.executeActionListTool({platform:'pumpfun'}).then(r=>console.log(r)))"` — expected: pumpfun action listed.
- `node src/core/index.js` — expected: parse OK.

## Auto Run Result

### Summary
Implemented `PumpFunCrawler` and `PumpFunClient` as a native social crawler for pump.fun Solana mint tokens under Story 20.5 (Epic 20). Provides `fetch_mint_social` action extracting theses (from position callouts), comment velocity (interpolated from reply samples), top holders, KOL activity (two-tier cache: Redis TTL 10m + static seed fallback), and livestream status (0ms in-memory set via 30s background poller) over unauthenticated HTTP/2 REST (`frontend-api-v3.pump.fun`) with zero headless browser usage. Wires into `scrape()` dispatcher via descriptor and `x_actions_list` discovery.

### Files Changed
- `src/scrapers/social/pumpfun/client.js` — `PumpFunClient extends AbstractApiClient` with Base58 validation, in-flight dedup ≤3s, 40 req/min/IP DistributedTokenBucket gate, curl transport fallback on 403, and JevChallengeDiagnoser on 200-empty.
- `src/scrapers/social/pumpfun/crawler.js` — `PumpFunCrawler extends AbstractCrawler` registering `fetch_mint_social`, orchestrating sticky proxy per mint + parallel `Promise.allSettled` calls.
- `src/scrapers/social/pumpfun/velocity.js` — `computeCommentVelocity` time-delta interpolation `{last1m, last5m}` from ≤50 replies.
- `src/scrapers/social/pumpfun/kolscan.js` — `KolscanResolver` two-tier cache (Redis TTL 10m → kolscan.io → `config/kol-wallets-seed.json` static seed).
- `src/scrapers/social/pumpfun/livestream.js` — `LivestreamPoller` background 30s poller on `/coins/currently-live` providing 0ms `isLive(mint)`.
- `src/scrapers/social/pumpfun/normalizer.js` — `normalizeThesis`, `normalizeHolder`, `namespacedPumpfunId` (`pumpfun:{mint}`).
- `src/scrapers/social/pumpfun/comments.js` — `normalizePumpfunReply` helper.
- `src/scrapers/social/pumpfun/descriptor.js` — scrape() descriptor (`aliases: ['pumpfun', 'pump', 'pump.fun']`, `actionMap`, `mapArgs`, factories).
- `src/scrapers/social/pumpfun/index.js` — barrel exports.
- `src/scrapers/index.js` — import `pumpfunDescriptor` and register in `DESCRIPTORS` map.
- `src/scrapers/social/actions-list.js` — register `'pumpfun'` in `CANONICAL_PLATFORMS`, `PLATFORM_CATEGORIES`, and `crawlerLoaders`.
- `src/mcp/server.js` — register `'pumpfun'` in `crawlerModuleMap` for `x_scrape` requiredArgs pre-validation.
- `config/kol-wallets-seed.json` — static seed file for KOL matching.
- `types/index.d.ts` — TypeScript declarations for `PumpFunCrawler`, `PumpFunClient`, `PumpFunMintSocialResult`, etc.
- `tests/scrapers/social/pumpfun/pumpfun.test.js` — 13 unit tests covering I/O matrix (100% pass).

### Review Findings Breakdown
- Patches applied: 3
  1. `[high]` Corrected kolscan seed path resolution (`../../../../config/kol-wallets-seed.json`).
  2. `[high]` Wired `DistributedTokenBucket` 40 req/min/IP gate into client `#apiGet`.
  3. `[medium]` Registered `pumpfun` in `src/mcp/server.js` `crawlerModuleMap`.
- Items deferred: 0
- Rejected findings: 0

### Follow-up Review Recommendation
`followup_review_recommended: true` — 2 high-severity findings were patched in the review pass (kolscan seed path + DistributedTokenBucket rate gate). While both were verified with unit tests and live execution, another review pass is recommended per the workflow rule.

### Verification Performed
- `vitest run tests/scrapers/social/pumpfun` — 13/13 passed (441ms).
- `listActions()` runtime check — surfaces `fetch_mint_social` (snake_case).
- `executeActionListTool({ platform: 'pumpfun' })` — surfaces pumpfun action, no `no_crawler` flag.
- `scrape('pumpfun', 'fetch_mint_social', { mintAddress: ... })` — live probe against real Solana mint returned 50 theses, 50 top holders, velocity, livestream, and kolActivity.
- Invalid mint Base58 check — throws `XACT_4002` before upstream request.
- `node src/core/index.js` — passes with exit 0.

### Residual Risks
- `frontend-api-v3.pump.fun` comments/replies endpoint returns 404 on current live probe; code handles this gracefully by defaulting to empty replies and velocity `{0, 0}`. If pump.fun restores or exposes an official comments path, `getReplies()` can be updated without breaking callers.

### Post-Story Update (2026-09-25) — Livechat comments resolved

The residual risk above is now **resolved**: pump.fun v3 moved coin comments/replies off REST onto a Socket.IO livechat service (`wss://livechat.pump.fun`). Reverse-engineered from the pump.fun web bundle:

- **Transport**: Engine.IO v4 over WebSocket (`/socket.io/?EIO=4&transport=websocket`); rooms keyed by mint address.
- **Events**: `joinRoom { roomId, username? }` → ack `{ authenticated, isCreator, roomConfig }`; `getMessageHistory { roomId, before?, limit }` → ack `{ messages[], nextCursor }`. Read access needs no auth token; `tokenGateEnabled` only gates *posting*.
- **Message shape**: `{ id, roomId, message, username, userAddress, profile_image, timestamp, messageType, expiresAt, isModerator, isCreator, userId, replyToId?, replyPreview? }`.

**Implementation:**
- `src/scrapers/social/pumpfun/livechat.js` — `PumpFunLivechat`, a minimal Socket.IO v4 client over `ws` (no `socket.io-client` dep): `connect()`, `joinRoom(mint)`, `getMessageHistory(mint, { before?, limit })`, `close()`.
- `src/scrapers/social/pumpfun/client.js` — `getReplies()` now: (1) tries REST `/replies/{mint}` (cheap, in case the route returns), (2) on 404/empty falls back to `livechat.getMessageHistory`. Messages normalized to `{ timestamp }` so `computeCommentVelocity` works unchanged. `client.livechat` is injectable for tests.
- `src/scrapers/social/pumpfun/crawler.js` — `fetchMintSocial` output gains `comments[]` (the livechat messages); `cleanup()` closes `client.livechat`.

**Scope note:** This exceeds the spec's original "Phase 1 không duy trì WebSocket chat" constraint — that rule targeted *persistent* streaming; the implemented client is connect→join→fetch-history→close (one-shot read), not a maintained stream. A persistent-stream variant (subscribe to `newMessage`) remains future work if real-time ingestion is needed.

**Live verification (2026-09-25):** `fetchMintSocial` on a real live mint returned `comments: 50` (e.g. `deeggnn: "73k lfg"`, `DJHEATMOBILE: "LFGGGG"`) plus `commentVelocity { sampleSize: 50 }` computed from real timestamps.

**Tests:** 14/14 pass in `tests/scrapers/social/pumpfun/pumpfun.test.js`, including a new case asserting the livechat fallback path (injected fake `livechat`, no real ws in tests).

### Review Findings

Code review pass 2026-09-25 (3/4 layers completed; `edge-case-hunter` failed). Verdicts assigned at triage.

- [x] [Review][Patch] Preserve rate-limit/upstream errors in `getReplies` — `catch {}` swallows `RateLimitError(XACT_4029)` and `#getRepliesViaLivechat` `catch → []` turns upstream 429/connection failures into a silent empty `comments`/`commentVelocity`. [src/scrapers/social/pumpfun/client.js:313-366]
- [x] [Review][Patch] Don't auto-start `LivestreamPoller` on discovery — `new PumpFunCrawler()` in `actions-list.js` `crawlerLoaders` constructs a poller that `start()`s a 30s `setInterval` just to enumerate actions. Defer polling until `fetchMintSocial` or wire `autoStart:false` for discovery instances. [src/scrapers/social/pumpfun/livestream.js:32, src/scrapers/social/actions-list.js:130]
- [x] [Review][Patch] Surface unexpected `getMintPositions` statuses — only 404 is handled; other non-2xx (5xx/403) fall through to `{positions:[],totalCount:0}` looking like a successful-but-empty scrape. [src/scrapers/social/pumpfun/client.js:276-296]
- [x] [Review][Patch] `pnlSol` ← `pnlUsd` mislabels USD as SOL — spec maps `pnlSol`←`pnlUsd` for schema continuity, but consumers reading `pnlSol` get a USD value. Keep `pnlUsd` canonical; set `pnlSol` only when a real SOL conversion exists, else `null`. [src/scrapers/social/pumpfun/normalizer.js:52]
- [x] [Review][Patch] Honor `args.limit` end-to-end — `optionalArgs:['mint','address','limit']` advertises `limit` but `fetchMintSocial` never passes it to `getReplies`; REST fixed at 50, livechat uses its own default. [src/scrapers/social/pumpfun/crawler.js:105,151-155]
- [x] [Review][Patch] `timestamp` fallback uses `callout.calledOutAtMcap` (market-cap value, not a time) when `calloutTimestamp` is absent — use a real time field or `null`. [src/scrapers/social/pumpfun/normalizer.js:46]
- [x] [Review][Patch] Add `comments` to `PumpFunMintSocialResult` — crawler returns `comments[]` but the public type omits it. [types/index.d.ts:1012]
- [x] [Review][Patch] Normalize `comments` with `normalizePumpfunReplies` — raw livechat/REST records exposed without the comment shape (inconsistent author/id/timestamp fields). [src/scrapers/social/pumpfun/crawler.js:167, src/scrapers/social/pumpfun/comments.js]
- [x] [Review][Patch] Assign `options.webSocketImpl` in `PumpFunLivechat` constructor — JSDoc advertises it but `connect()` uses imported `WebSocket` since `_WSImpl` is never set from options. [src/scrapers/social/pumpfun/livechat.js:52,80]
- [x] [Review][Patch] `dedup` expiry is anchored to request-start — a request pending past `dedupWindowMs` can be duplicated; share the in-flight promise until it settles, then apply the settled window. [src/scrapers/social/pumpfun/client.js:387-410]
- [x] [Review][Patch] `livestream.isLive` can report `isActive:false` before the first poll completes — `start()` fires `#tick()` without awaiting; add an initial-poll barrier or await readiness before `fetchMintSocial` reads it. [src/scrapers/social/pumpfun/livestream.js:36-42]
- [x] [Review][Defer] Livechat protocol lacks a real-`ws` handshake/ack test — only an injected fake exercises the fallback; add a local WebSocket protocol test using the project's real `ws`. — deferred: test-infra addition, not a defect fix [src/scrapers/social/pumpfun/livechat.js, tests/scrapers/social/pumpfun/pumpfun.test.js]
- [x] [Review][Defer] Broaden `config/kol-wallets-seed.json` — 1-wallet seed gives near-empty KOL coverage when kolscan.io is down; user chose to expand the seed list. — deferred: needs a curated KOL wallet list (external data) [config/kol-wallets-seed.json]

**Rejected:**
- `false` — Full `tests/scrapers` run fails: the 6 failures are all `tests/scrapers/social/instagram/client.test.js` proxy-resolution AC-4 (story 35.3, env/network-dependent), unrelated to this change — pre-existing.
