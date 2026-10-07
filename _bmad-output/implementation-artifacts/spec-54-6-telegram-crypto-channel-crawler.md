---
title: 'Story 54.6 — Telegram Crypto Channel Crawler'
type: 'feature'
created: '2026-10-06'
status: 'in-review'
baseline_revision: '76dd3a85eb510a289d611cbf9c4820071c24426b'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Token sentiment coverage hiện chỉ có X/Twitter — signals thường bùng nổ trên Telegram crypto channels trước X; skeleton `src/scrapers/social/telegram/` (Story 50.8) mọi method đều throw `XACT_4001` vì chưa có transport impl.

**Approach:** Build standalone MTProto relay service `services/telegram-relay/` (GramJS `telegram@2.26.22` + StringSession, copy mmomarket relay pattern) giữ một `TelegramClient` dùng `TELEGRAM_SESSION`; phía XActions lấp seam `TelegramClient` transport `'mtproto'` = HTTP client gọi relay; normalize messages → PostItem feed `TokenMentionPipeline` (platform seam `tg:`) + publish `stream:social:raw_posts`; channel registry config-driven; expose `x_telegram_channels`/`x_telegram_search` qua MCP dispatcher; `tgDegraded` flag riêng khỏi X degraded.

## Boundaries & Constraints

**Always:**
- Relay là service độc lập (`services/telegram-relay/`), package.json riêng, dep duy nhất `telegram@2.26.22` — KHÔNG thêm GramJS vào root package.json.
- Copy nguyên pattern mmomarket `apps/telegram-relay`: `createRelayServer`, token auth `timingSafeEqual` trên SHA-256 digest (Bearer hoặc `x-relay-token`), `readBody` 64KB cap, `isBusy` single-flight, `/liveness` unauthenticated, `/health` 3-state (`healthy`/`cooldown`/`permanently_unhealthy`), server timeouts (headers 10s / request 120s / keepAlive 5s), test seams `server._getState/_setState/_closeClient`, graceful SIGINT/SIGTERM.
- Error taxonomy verbatim: `FLOOD_WAIT_N` → parse seconds → `cooldownUntil = now + sec*1000 + 5000` trả 503; terminal (`USER_DEACTIVATED*`, `AUTH_KEY_UNREGISTERED`, `SESSION_*`) → `SESSION_BANNED`, `permanently_unhealthy`, disconnect, alert log.
- Channel reading: `getEntity(channel)` → `getMessages(entity,{limit,minId})` poll; `iterDialogs()` discovery; `GetFullChannel` cho `member_count`; `NewMessage` event handler cho realtime subscribe.
- `PostItem` shape: `{platform:'telegram', id, author, text, ts, channelId, forwardFrom: msg.fwdFrom}` → `source_id = tg:<channelId>:<msgId>` (AD-4).
- `TELEGRAM_SESSION` là password-grade secret: env-only, không log, dedicated phone/account (không account chính). `RELAY_AUTH_TOKEN` ≥32 hex. Relay bind internal-only.
- Governor: relay tự giới hạn; phía XActions dùng `globalAdaptiveRateGovernor.setPlatformLimit('telegram', ...)` cho poll scheduling — không viết throttle riêng (AD Epic 11).
- MCP exposure theo AD-6: actions qua dispatcher (`x_scrape` platform descriptor + dedicated thin-wrapper nếu cần), KHÔNG tạo standalone tool mới ngoài pattern hiện có.
- `tgDegraded` flag riêng, không đụng vào `degraded` X hiện có.
- TypeScript strict mode; không `any`, không `@ts-ignore`; không mock.

**Never:**
- Không dùng Bot API — crypto channels không add bot lạ; MTProto user-client là duy nhất.
- Không sửa `runUpsert`/schema `token_mentions` (đã có `platform` + `source_id` columns — chỉ cần seam giá trị).
- Không phá `platform:'twitter'` + `x:` namespace hiện tại cho posts X.
- Không join private channels/groups trong MVP — chỉ public.
- Không horizontal scaling — single TelegramClient instance.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH channel_messages | POST /channel/messages `{channel,limit}` → relay healthy | 200 `{messages:[{id,author,text,ts,...}]}` | — |
| FLOOD_WAIT | GramJS throw `FLOOD_WAIT_37` | cooldownUntil=now+37s+5s; request hiện tại 503; /health → `cooldown` + `cooldownMs` | 503 `{error:'FLOOD_WAIT_37'}` |
| SESSION_BANNED | `AUTH_KEY_UNREGISTERED` | `isPermanentlyUnhealthy=true`, disconnect, mọi POST → 503 `SESSION_BANNED`, /health → `permanently_unhealthy` | 503 + alert log |
| BUSY single-flight | POST đến khi `isBusy=true` | 503 `{error:'RELAY_BUSY'}` | 503 |
| AUTH fail | Bearer token sai | 401 trước khi đọc body | 401 |
| /liveness | GET bất kỳ, unauth | `{ok:true,status:'ok'}` | — |
| PostItem→pipeline | PostItem `{platform:'telegram',externalId:'123:456'}` | `source_id='tg:123:456'`, `platform='telegram'` trong token_mentions | skip khi id rỗng |
| Telegram feed poll | channels trong `config/telegram-channels.json` | PostItems → processBatch + stream publish; consecutive empty → `tgDegraded` sau threshold | scrape error = empty batch |
| XACT_4001 fallback | `TELEGRAM_TRANSPORT` unset/bot/web | crawler actions vẫn throw XACT_4001 rõ ràng | XACT_4001 |

</intent-contract>

## Code Map

- `services/telegram-relay/src/main.js` -- MỚI: `createRelayServer`, env `TELEGRAM_API_ID/HASH`, `TELEGRAM_SESSION`, `RELAY_AUTH_TOKEN`, `RELAY_PORT` default 3800, `RELAY_HOST` default 0.0.0.0; lazy `getClient()` GramJS; channel ops endpoints
- `services/telegram-relay/src/login.js` -- MỚI: CLI readline login → in `TELEGRAM_SESSION` (copy mmomarket `login.js` 88 lines)
- `services/telegram-relay/package.json` -- MỚI: `telegram@2.26.22`, `type:module`, scripts `start`=`node --disable-warning=ExperimentalWarning src/main.js`, `login`, `test`=`node --test`
- `services/telegram-relay/Dockerfile` -- MỚI: `node:22-alpine`, chạy main.js
- `/Users/luisphan/Documents/GitHub/mmomarket.org/apps/telegram-relay/src/main.js` -- REFERENCE ONLY (read-only): production-verified `createRelayServer` + error taxonomy
- `src/scrapers/social/telegram/client.js:34-120` -- LẤP SEAM: `transport:'mtproto'` → HTTP client gọi relay (`TELEGRAM_RELAY_URL`, `TELEGRAM_RELAY_TOKEN` envs); `bot`/`web`/null giữ `XACT_4001`
- `src/scrapers/social/telegram/normalizer.js` -- MỞ RỘNG: thêm `normalizeTelegramPostItem(msg, channelId)` → PostItem shape cho pipeline (externalId=`${channelId}:${msg.id}`, platform:'telegram', publishedAt ISO từ `msg.date`)
- `src/analytics/tokenMentionPipeline.js:428-465` -- SEAM: parametrize sourceId namespace + platform theo `post.platform` (`'telegram'` → `tg:` ns + platform 'telegram'; default giữ `x:`/'twitter'); content/followers guards giữ nguyên
- `src/analytics/telegramFeed.js` -- MỚI: poller `createTelegramFeed(opts)` — đọc `config/telegram-channels.json`, mỗi tick gọi `scrape('telegram','channel_messages',{channel,limit})`, normalize→PostItem → `pipeline.processBatch` + `redis-stream-publisher` publish `stream:social:raw_posts`; `tgDegraded` state riêng (degraded/degradedSince/consecutiveEmptyBatches mirror AD-3); `setPlatformLimit('telegram',{safeRequestsPerMinute})`
- `config/telegram-channels.json` -- MỚI: `{channels:[{channelId?,handle,topicTags[],tier,memberCount?}]}` seed curated list
- `src/mcp/server.js:~4427` -- `DEDICATED_SCRAPE_TOOLS`: thêm `x_telegram_channels`→{platform:'telegram',action:'channel_messages'}, `x_telegram_search`→{platform:'telegram',action:'search_channels'} (AD-6 pattern); cập nhật x_scrape action enum nếu cần
- `api/routes/analytics.js:52-149` -- eitherAuth: thêm `GET /telegram-health` trả `{tgDegraded,...feed.getHealth()}` nếu feed enabled (optional — chỉ khi rẻ)
- `src/core/base-client.js` -- AbstractApiClient base (read-only): TelegramClient extends nó
- `src/core/adaptive-governor.js:904` -- `globalAdaptiveRateGovernor.setPlatformLimit` (read-only)
- `src/lib/redis-stream-publisher.js` -- publish keyOrItem → XADD flat record (read-only usage)
- `test/` hoặc `*.test.js` colocated -- vitest + in-memory better-sqlite3 precedent (spec-54-5)

## Tasks & Acceptance

**Execution:**
- `services/telegram-relay/src/main.js` -- implement relay server theo mmomarket pattern + channel ops (`/channel/messages`, `/channel/info`, `/channel/subscribe` NewMessage handler, `/dialogs` discovery) -- relay là nguồn data duy nhất cho transport mtproto
- `services/telegram-relay/src/login.js` -- CLI login in StringSession -- ops cần để tạo TELEGRAM_SESSION
- `services/telegram-relay/package.json`, `Dockerfile`, `src/main.spec.js` (node:test) -- service self-contained, test seams _getState/_setState/_closeClient
- `src/scrapers/social/telegram/client.js` -- mtproto transport = HTTP fetch tới relay endpoints; map errors 503 cooldown/banned → PlatformError phù hợp -- lấp seam 50.8
- `src/scrapers/social/telegram/normalizer.js` -- `normalizeTelegramPostItem` -- cầu nối relay payload → pipeline PostItem
- `src/analytics/tokenMentionPipeline.js` -- platform-parametric `sourceId`/`platform` (x:/tg: ns) -- AD-4 multi-platform dedup
- `src/analytics/telegramFeed.js` -- feed poller + `tgDegraded` + registry load + governor limit -- đưa telegram data vào pipeline + stream
- `config/telegram-channels.json` -- seed registry curated list -- data nguồn cho feed
- `src/mcp/server.js` -- `x_telegram_channels`/`x_telegram_search` dedicated thin wrappers + x_scrape enum -- AC MCP surface
- Test files vitest -- client transport (mocked relay HTTP), normalizer PostItem, pipeline tg: namespace, feed empty-batch→tgDegraded

**Acceptance Criteria:**
- Given relay env hợp lệ + TELEGRAM_SESSION, when `GET /health`, then trả `{ok:true,status:'healthy'}`; khi GramJS throw FLOOD_WAIT_N → status `cooldown` với `cooldownMs≈N*1000+5000`; khi terminal error → `permanently_unhealthy` + mọi POST 503 `SESSION_BANNED`
- Given `TELEGRAM_TRANSPORT=mtproto` + relay chạy, when `scrape('telegram','channel_messages',{channel,limit})`, then trả normalized channel messages (không còn XACT_4001)
- Given PostItem telegram `{platform:'telegram',externalId:'123:456'}`, when `pipeline.processBatch([post])`, then token_mentions có `source_id='tg:123:456'`, `platform='telegram'`; post X vẫn `x:`/`twitter` (không regression)
- Given feed enabled với `config/telegram-channels.json`, when poll tick chạy, then PostItems → processBatch + XADD `stream:social:raw_posts`; 3 empty batch liên tiếp → `tgDegraded=true` (X `degraded` không đổi)
- Given MCP dispatcher, when call `x_telegram_channels`/`x_telegram_search` (hoặc `x_scrape` platform=telegram action tương ứng), then dispatch đúng crawler action
- Given relay startup thiếu env (apiId/hash/session/token), when boot, then `validateStartupEnv` throw rõ ràng

## Spec Change Log

## Review Triage Log

## Design Notes

Quyết định kiến trúc chính: relay standalone thay vì GramJS in-process, vì (a) AC+AD-9 mandate `services/telegram-relay`, (b) TelegramClient stub đã có `transport` seam — 'mtproto' tự nhiên map sang HTTP-call-relay, (c) giữ GramJS khỏi root deps, (d) single-flight/ban-state cô lập trong service riêng.

Pipeline seam tối thiểu: `processBatch` hiện hardcode `'x:'+tweetId` và `platform:'twitter'` — 54.6 chỉ thêm derivation theo `post.platform` (mặc định giữ behavior cũ), không refactor rộng. `externalId` telegram = `${channelId}:${msgId}` để dedup per-channel.

Feed nằm ngoài pipeline (`telegramFeed.js`) giống mô hình pipeline tự poll X — nhưng tách module vì registry + realtime subscribe + tgDegraded riêng; pipeline chỉ nhận posts qua `processBatch` (pure seam đã có).

Relay endpoints khác biệt nhẹ so với mmomarket (step-runner `runInteraction` của mmomarket dùng cho bot-interaction, không phải channel reading) — giữ shell server/state/error-taxonomy, thay runner bằng channel ops (getEntity/getMessages/NewMessage/iterDialogs/GetFullChannel).

`x_telegram_channels`/`x_telegram_search` implement theo `DEDICATED_SCRAPE_TOOLS` precedent (x_dexscreener_*, x_pumpfun_*): thin wrapper → executeScrapeTool; vẫn khả dụng qua `x_scrape` platform=telegram.

## Verification

**Commands:**
- `cd services/telegram-relay && npm test` -- node:test spec pass (auth/health/cooldown/busy/session_banned paths)
- `npx vitest run` trên các test file mới (client transport, normalizer, pipeline tg seam, telegramFeed) -- pass
- `node -e "import('./src/scrapers/social/telegram/client.js').then(m=>m.createTelegramClient({transport:'mtproto'}))"` -- không throw import
- `git status` + lint/typecheck command của repo nếu có (check package.json scripts)

**Manual checks (if no CLI):**
- `npm run login` trong relay (cần env thật) — verify TELEGRAM_SESSION print ra
- Boot relay → `curl localhost:3800/liveness` → `{ok:true}`
