---
title: 'Story 50.2: Sync/Async Mode Dispatch + 202 Degrade Contract'
type: 'feature'
created: '2026-09-26'
updated: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
epic: 50
story_number: 50.2
phase: 'Epic 50 — Public Scrape Gateway'
priority: 'high'
baseline_commit: 'ee2517f7'
context:
  - _bmad-output/implementation-artifacts/epic-50-context.md
  - _bmad-output/specs/spec-xactions-public-scrape-gateway/SPEC.md
  - _bmad-output/planning-artifacts/architecture/architecture-xactions-public-scrape-gateway-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/implementation-artifacts/stories/50-1-service-auth-lane-bearer-consumer-derivation.md
  - api/routes/platform.js
  - api/services/jobQueue.js
  - src/scrapers/index.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `POST /api/platform/:platform/scrape` chạy sync-only — mọi call đều await `scrape()` tới cùng, không giới hạn thời gian. Caller không có cách nào chọn fast-lane (sub-second reads) hay queue-lane (heavy jobs): lightweight reads không có sync contract rõ ràng, heavy calls silent-hang, và anti-bot challenge lạnh không có degrade path. Đây là lý do jev fork `PumpFunCrawler` thay vì gọi gateway.

**Approach:** Thêm `mode: 'sync'|'async'|undefined` vào request body của cùng route — một dispatch flag, không phải endpoint mới (AD-3). `mode` absent → resolve theo per-action manifest `syncCapableActions` trong từng `descriptor.js` (default `async` cho action không được liệt kê). Sync chạy in-process với ceiling 1.5s cứng: breach → `202 + operationId + degraded_reason + Retry-After`, job tiếp tục background, consumer poll `GET /api/ai/action/status/:id`. `mode:'sync'` trên action không syncCapable → `400` contract violation (`not_sync_capable`), KHÔNG phải degrade. Batch `platform:'all'|string[]` fan-out `Promise.allSettled`, ceiling áp dụng per-platform.

## Boundaries & Constraints

**Always:**
- `mode` là optional body field, chỉ nhận `'sync'|'async'` — giá trị khác → `400` validation. `mode`, `platform` (body override), `accountIds` và credential keys (`sessionCookie`/`authCookie`/`clientSecret`/`cookies`/`password`) bị strip khỏi `options` trước khi gọi `scrape()` — `platform.js:414` hiện leak toàn bộ body trừ `action`.
- `mode` absent → manifest `syncCapableActions` quyết định: action trong list → sync; không trong list → async (enqueue ngay, trả 202). Check cả requested action lẫn `mappedAction`: `descriptor.mapAction` là **function** `(options, ctx)` (`index.js:302-310`) — `isSyncCapable` phải build `ctx={platform,platformName,action}` rồi gọi nó; descriptors chỉ có `dispatch` không `mapAction` (facebook) chỉ match được requested action. Check mapped → alias như reddit `posts`→`subreddit` cũng sync-capable (intended).
- Sync ceiling = **1500ms cứng** (C-2) — không env override, không per-caller exception. Race phải `clearTimeout` khi scrape win (không leak handle). Breach → 202 degrade, không bao giờ `200 + error`, không silent timeout. Bound thực tế = ceiling + bookkeeping (operation create RTT) — không claim "~1.5s total".
- `mode:'sync'` + action không syncCapable → `400 + {success:false, error:{code:'XACT_4001', kind:'validation', type:'validation', message:'action not sync-eligible'}}`. Body này **hand-rolled tại route**: generic catch (`platform.js:455-464`) flatten error thành `{ok:false, error:<string>, code}` và sẽ phá contract nếu dispatch throw; `kind` không tồn tại trong `sendErrorEnvelope` taxonomy nên phải emit trực tiếp.
- 202 degrade body (flat, theo AC): `{success:true, mode:'async', operationId, degraded_reason, retry_after_ms, statusUrl}` + header `Retry-After` (giây, ceil của retry_after_ms/1000). `degraded_reason` closed enum: `upstream_timeout|cf_challenge|upstream_rate_limit|queue_fallback` (C-11).
- Explicit `mode:'async'` (caller chủ động) → `202 + {success:true, mode:'async', operationId, statusUrl}` — không có `degraded_reason`.
- Mọi async path phải tạo `prisma.operation` row để `GET /api/ai/action/status/:id` resolve được — không dùng `queueJob` (không tạo row → status 404). Timeout-continuation → detached tracking row; explicit-async + typed-error degrade → Bull job. Status endpoint **unauthenticated theo thiết kế** (skip session gate): holder của operationId đọc được result — accepted, pre-existing cho mọi operation type.
- Degrade classify theo **`err.type`** (PlatformError taxonomy — `RETRYABLE_TYPES = rate_limit|bot_challenge|proxy_exhausted|hibernation`), KHÔNG theo code list: `bot_challenge`→`cf_challenge`; `rate_limit`→`upstream_rate_limit` (XACT_4291 = local stream-cap nhưng vẫn type `rate_limit` — đúng semantic). Propagate `err.retryAfterMs` vào `retry_after_ms`/`Retry-After` **và** `delay` của Bull job enqueued — worker không retry vào giữa upstream rate-limit window. `queue_fallback` trigger duy nhất: timeout-degrade mà tracking-row create throw (transient prisma) nhưng `addJob('scrape')` thành công → `202 degraded_reason:'queue_fallback'`; cả hai fail → `503`. Non-retryable error → error path hiện tại, không degrade.
- Batch `'all'` **chỉ được admit trên path `/scrape`** — KHÔNG thêm vào `VALID_PLATFORMS` (param handler scope-check `req.path` kết thúc `/scrape`; `/all/automate`, `/all/accounts` vẫn 400 — xem Design Notes tại sao whitelist router-wide là lỗ hổng write fan-out). Body `platform` override path: `string` → single target thay path (body wins, documented); `'all'` → all canonical descriptor platforms (D-3); `string[]` → explicit list, cap **25**; type khác (`number`/`object`/`''`/`true`) → `400`; `[]` → `400`. Dedupe sau normalize (`['x','twitter']` → 1 platform). Canonical name = `descriptor.aliases[0]` cho 'all'-expansion và per-entry label.
- Per-platform batch entry: `{platform, success:boolean, status:'completed'|'degraded'|'queued'|'failed', data?|operationId+statusUrl+degraded_reason?|error?}` — emit **cả** `success` (epic pin `{platform,success,data|error}`) lẫn `status` enum (CAP-6 `results[]`). Per-entry error dùng cùng contract shape `{code,kind,type,message}` — not_sync_capable entry = `code:'XACT_4001'` (không dùng literal `'not_sync_capable'` làm code).
- `mode:'async'` batch → `202 {success:true, mode:'async', results:[{platform,success:true,status:'queued',operationId,statusUrl}…], operationIds:[…]}` — `operationIds` derived top-level (epic AC pin `operationIds[]`; CAP-6 pin `results[]` — emit cả hai).
- Mixed/default-mode batch → `200`; top-level `mode` phản ánh HTTP response lane (`'sync'` khi 200, `'async'` khi 202); per-entry `status` là truth.
- **Route sở hữu mọi res write** — `scrapeDispatch` trả outcome descriptors (`{kind:'json', status, body, headers?}`), KHÔNG throw contract errors, KHÔNG touch `res`; detached continuations không bao giờ touch `res`. Một request = một response.
- **Secrets không persist vào queue/DB**: enqueued job data = `{platform, action, options(sanitized), userId|null, consumerId|null, accountIds?}` — cookie/secret keys đã strip trước enqueue; processor re-resolve qua `resolveAccountCookie(userId, accountIds, platform)` khi `userId`+`accountIds` có. Detached continuation giữ options trong process memory (không serialize — không cần strip cho path đó). Async `options` phải JSON-serializable — circular/non-serializable (`transport`/`page`/`store`/`session`…) → `400` trước enqueue.
- Sync 200 giữ shape hiện tại + `mode:'sync'` — `{ok:true, platform, action, mode:'sync', dryRun, result}` (unified envelope = Story 50.3, không migrate sớm). `{ok}` vs `{success}` hai dialect tồn tại song song đến 50.3 — test không được giả định uniform.
- Worker processor `operationsQueue.process('scrape', ...)` → restore `runWithConsumerContext(consumerCtx từ job data)` + re-resolve cookies + `scrape(platform, action, options)`; completed-handler hiện có ghi `operation.result` — phải `JSON.stringify` (column `String?`).
- `getJob` normalize: Bull `failed` mà `attemptsMade < attempts` → báo `processing` (retry flap không phải terminal — poll loop của consumer không stop giữa chừng); detached ops (bullJob=null) fallback `operation.status`, và Redis error → fallback DB state (status poll không 500 khi Redis hiccup).
- `addJob` null-safe: `userId: data.userId ? String(data.userId) : null` — `String(undefined)` hiện tại tạo literal `'undefined'` → P2003 FK crash (a2a.js:168 đã gọi `addJob` không userId — pre-existing crash story này fix). `queue.add` fail sau row-create → mark operation `failed` trước khi throw — không để orphan `queued` row được poll mãi.

**Decisions (Open Questions resolved 2026-09-26):**
- **D-1 (OQ-1 — dashboard compat):** Update scrape helper của `apps/web` trong story này — nhận `202` thì poll `statusUrl` mỗi ~2s tới `completed|failed` rồi trả result như sync shape. Poll cap **~130s** (không phải 60s — `stream_mint_chat` `durationMs` lên tới 120s, cap 60s sẽ timeout mid-job). Giữ UI hoạt động; mode-absent→async cho unlisted actions áp dụng đồng nhất mọi caller.
- **D-2 (OQ-2 — service attribution):** Additive migration: `Operation.userId` → `String?` nullable + thêm `consumerId String?` + `@@index([consumerId])`. JWT lane ghi `userId`; service lane ghi `consumerId` (từ `req.consumer.consumerId` — map-derived, unbounded string), `userId=null`. Hệ quả chấp nhận: service-lane ops (userId=null) invisible cho `getHistory`/`getRecentJobs`/admin views filter theo userId.
- **D-3 (OQ-3 — bare 'all'):** `platform:'all'` không kèm list = tất cả canonical descriptor platforms (dedupe aliases qua `DESCRIPTORS` registry — superset của `VALID_PLATFORMS`, intended: descriptor platform như github/masothue reachable qua 'all' dù không có trong whitelist param). Heavy fan-out — bounded bởi per-platform ceiling + allSettled; documented footgun.
- **D-4 (OQ-4 — timeout continuation):** Sync breach → giữ in-flight promise chạy, tạo Operation row `status:'processing'` + ghi result/error khi settle (detached continuation). KHÔNG re-enqueue Bull — tránh double upstream execution. Settle handler **attach synchronously tại race time** (trước mọi `await` của tracking-row create) — rejection trong window create-row mà chưa attach = unhandledRejection crash process (Node ≥15). Trade-off chấp nhận: API process chết mid-flight → row kẹt 'processing'.
- **D-5 (review — dispatcher bypass):** Batch gateway **không** đi qua `UniversalActionDispatcher.dispatch` — dispatcher inject `resolvePlatformCredentials`/`${platform}-account` defaults/ContentTransformer và `'all'`→write-platforms (phù hợp automate, không phù hợp read gateway). AC "triggers UniversalActionDispatcher.dispatch (Promise.allSettled)" được interpret là **allSettled semantics**, giữ nguyên per-platform isolation.
- **D-6 (review — AC amendment):** AC `epics.md:3632` nói "Job continues in background via Bull" — D-4 supersede mechanism (detached in-flight tracking), observable contract giữ nguyên (202 + operationId + statusUrl resolve được). Recorded là deliberate AC amendment; `epics.md` cần cập nhật wording ở wrap-up.

**Never:**
- KHÔNG tạo route/endpoint mới (`/api/platform/scrape-sync`, per-platform status...) — mode là dispatch flag trên cùng route (AD-1/AD-3).
- KHÔNG cho override async→sync (action async-default + `mode:'sync'` → 400 `not_sync_capable`, không im lặng chạy sync).
- KHÔNG implement unified envelope/request_id/stream/preview — Story 50.3 scope.
- KHÔNG implement quota/x402/per-consumer bucket — Story 50.4 scope.
- KHÔNG re-enqueue Bull cho scrape đang in-flight sau timeout (double upstream execution, burn rate-limit/proxy budget) — D-4.
- KHÔNG whitelist `'all'` router-wide trong `VALID_PLATFORMS` — nó mở `POST /all/automate` → `UniversalActionDispatcher` write fan-out (twitter/bluesky/mastodon/threads + env-resolved creds) và literal `all:` account labels trên `/accounts`.
- KHÔNG persist credential keys vào Bull payload/Redis hay `Operation.config` (Bull retain 100 completed jobs — secrets sẽ nằm plaintext trong Redis+DB).
- KHÔNG attach settle-handler của detached promise sau một `await` — unhandledRejection window (xem D-4).
- KHÔNG để `mode`/`platform`/`accountIds`/credential keys leak vào `options` của `scrape()`.
- KHÔNG giả định sync lane tách event-loop khỏi Bull — `jobQueue.js` đã được ~11 routes static-import → processors chạy in-process trong API hôm nay (topology hiện có, không thay đổi story này); ceiling 1.5s là bound thật sự của sync lane.
- KHÔNG dùng `vi.mock`/stub module trong tests (repo mandate "real implementations") — dùng injected seams thay thế.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| HAPPY_SYNC | `POST /reddit/scrape {action:'search', mode:'sync'}` — `search` syncCapable, completes <1.5s | `200 {ok:true, mode:'sync', result}` | N/A |
| HAPPY_ASYNC_EXPLICIT | `{action:'search', mode:'async'}` (sync→async override allowed) | `202 {success:true, mode:'async', operationId, statusUrl}` + Bull job enqueued | N/A |
| HAPPY_DEFAULT_SYNC | `{action:'search'}` no mode, `search` in syncCapableActions | Sync path, `200` như HAPPY_SYNC | N/A |
| HAPPY_DEFAULT_ASYNC | `{action:'followers'}` no mode, unlisted → default async | `202 + operationId` như explicit async | N/A |
| DEGRADE_TIMEOUT | `mode:'sync'` + syncCapable, scrape() pending >1.5s | `202 {degraded_reason:'upstream_timeout', operationId, retry_after_ms, statusUrl}` + `Retry-After`; in-flight promise tracked vào Operation row (`processing`→settle ghi result/error) | N/A — job tiếp tục background |
| DEGRADE_CF | `mode:'sync'`, scrape throws `BotChallengeError` (type `bot_challenge`) <1.5s | `202 {degraded_reason:'cf_challenge'}` + Bull job enqueued (retry trong worker) | N/A |
| DEGRADE_429 | `mode:'sync'`, scrape throws `RateLimitError` (type `rate_limit`, retryAfterMs=8000) | `202 {degraded_reason:'upstream_rate_limit', retry_after_ms:8000}` + `Retry-After: 8` + Bull job `delay:8000` | N/A |
| ERR_NOT_SYNC_CAPABLE | `{action:'full_scrape', mode:'sync'}` — unlisted action | `400 {success:false, error:{code:'XACT_4001', kind:'validation', type:'validation', message:'action not sync-eligible'}}` | 400, không enqueue |
| ERR_BAD_MODE | `{action:'search', mode:'turbo'}` | `400` validation — `mode` chỉ nhận sync\|async | 400 |
| ERR_NONRETRYABLE_SYNC | `mode:'sync'`, scrape throws `XACT_4001` validation | Error response hiện tại (`{ok:false,error,code}` + statusCode) — không degrade | statusCode của error |
| BATCH_SYNC | `POST /all/scrape {action:'search', mode:'sync', platform:['x','reddit']}` | `200 {ok:true, mode:'sync', results:[{platform:'x',success:true,status:'completed',data},{platform:'reddit',success:true,status:'degraded',operationId,degraded_reason,statusUrl}]}` — bound = ceiling + bookkeeping | per-platform entries, không fail batch |
| BATCH_ASYNC | `{platform:['x','reddit'], action:'search', mode:'async'}` | `202 {success:true, mode:'async', results:[{platform,success:true,status:'queued',operationId,statusUrl}×2], operationIds:[id1,id2]}` | N/A |
| BATCH_ALL | `POST /all/scrape {action:'search', mode:'async'}` (no body.platform) | 202, results[]+operationIds[] cho MỌI canonical descriptor platform (dedupe alias, canonical=`aliases[0]`, D-3) | N/A |
| BATCH_MIXED_DEFAULT | `{platform:['reddit','pumpfun'], action:'search'}` no mode | reddit sync + pumpfun default-async → `200`, results[] mix `{status:'completed'}` + `{status:'queued',operationId}`; top-level `mode:'sync'` | per-platform |
| BATCH_PARTIAL_CAPABLE | `{platform:['reddit','pumpfun'], mode:'sync'}` + pumpfun action không capable | `200`, results[]: reddit ok/degraded, pumpfun `{success:false, status:'failed', error:{code:'XACT_4001', kind:'validation', type:'validation', message:'action not sync-eligible'}}` | per-platform, không whole-400 |
| EDGE_EMPTY_ARRAY | `{platform:[]}` | `400` validation — empty list không có gì để dispatch | 400 |
| EDGE_BAD_PLATFORM_TYPE | `{platform:42}` / `{platform:{}}` / `{platform:''}` / `{platform:true}` | `400` validation — platform chỉ nhận string\|'all'\|string[] | 400 |
| EDGE_PLATFORM_MISMATCH | path `/reddit/scrape` + body `{platform:'x'}` | Body wins — scrape `x` (documented override, khớp array semantics) | N/A |
| EDGE_INVALID_IN_ARRAY | `{platform:['reddit','bogus']}` | Per-platform entry cho `bogus` = `{success:false, status:'failed', error:{code:'XACT_4001', kind:'validation', message:'Unknown platform'}}` | per-platform |
| EDGE_BATCH_CAP | `{platform:[26 explicit platforms]}` | `400` validation — explicit array cap 25 (không áp cho 'all'-expansion) | 400 |
| EDGE_BATCH_DUPES | `{platform:['x','x','twitter']}` | Dedupe sau normalize → 1 entry cho `x` | N/A |
| EDGE_ACCOUNTIDS_BATCH | `accountIds:['acc-1']` + `platform:['x','reddit']` + userJWT | Resolve cookie per-platform trong từng task (`resolveAccountCookie(reqUser.id, id, platform)`) | per-platform failure entry |
| EDGE_SECRETS_ASYNC | `{mode:'async', accountIds:['a1'], sessionCookie:'abc'}` JWT | Job data mang `{userId, accountIds}` — KHÔNG chứa cookie; processor re-resolve `resolveAccountCookie`. `Operation.config` không có plaintext secret | N/A |
| EDGE_NONSERIAL_OPTIONS | `{mode:'async', options chứa circular/function}` | `400` validation trước enqueue — async options phải JSON-serializable | 400 |
| EDGE_LATE_SETTLE | scrape rejects tại T>ceiling trong lúc tracking-row create đang await | Settle handler đã attach sync tại race time → không unhandledRejection; row settle `failed` | detached ghi error vào row |
| EDGE_QUEUE_DOWN | sync timeout + tracking-row create throws (prisma down) | Fallback `addJob('scrape')` → success → `202 degraded_reason:'queue_fallback'`; cũng fail → `503 {success:false,error:{code:'XACT_5000',kind:'internal'}}` — không 202 khi không có operationId | 503 |
| EDGE_QUEUE_ADD_FAIL | explicit async, row created rồi `queue.add` throws (Redis down) | Row marked `failed`, `503` — không orphan `queued` row | 503 |
| EDGE_STATUS_FLAP | Bull job attempt 1 fail, `attemptsMade < attempts` | `getJob` báo `processing` (không `failed`) — consumer poll không stop giữa retry window | N/A |
| EDGE_OP_USER | serviceAuth caller (no `req.user`) + mode:'async' | Operation row: `userId=null, consumerId=<derived>` (D-2); invisible cho getHistory (accepted) | N/A |
| EDGE_DRYRUN_ASYNC | `{mode:'async', dryRun:true}` | Allowed-inert — job chạy với `dryRun`, result là dryRun payload | N/A |
| EDGE_ACCOUNTIDS_SERVICE | serviceAuth + `accountIds` + mode bất kỳ | `400` (guard `!req.user && accountIds` chạy TRƯỚC mode dispatch — kể cả batch) | 400 |
| EDGE_DUP_REQUEST | 2 request giống nhau concurrent | Double execution — không idempotency (accepted footgun, documented) | N/A |

</frozen-after-approval>

## Code Map

- `api/routes/platform.js:400-465` — handler `POST /:platform/scrape` (`eitherAuth` đã mount ở 50.1): thêm parse `mode`/`platform` body, strip keys, delegate `scrapeDispatch.dispatch()` → render outcome descriptor. Contract bodies (400/202/503) hand-rolled tại route; generic catch `:455-464` chỉ còn xử lý non-contract throws. Guard `accountIds && !req.user` (`:426-436`) chạy trước dispatch.
- `api/routes/platform.js:28-47,232-241` — `VALID_PLATFORMS` + `normalizePlatform` + `platformParamHandler`: `VALID_PLATFORMS` **không đổi**; param handler admit `'all'` chỉ khi `req.path` kết thúc `/scrape` (scope-checked, các route khác vẫn reject).
- **NEW** `api/services/scrapeDispatch.js` — `resolveMode`, `runSyncWithCeiling` (Promise.race + `clearTimeout` + settle handler attach sync tại race time), `classifyDegrade(err)` (`err.type`-based), `dispatchSingle`/`dispatchBatch` (allSettled, cap 25 explicit), `enqueueScrapeJob` (sanitized job data + `delay:err.retryAfterMs`), `trackDetachedOperation`, `sanitizeOptions`/`assertSerializableOptions`, `canonicalPlatforms()` (DESCRIPTORS → aliases[0] dedupe), seams `_setSyncBudgetMs`/`_setScrapeImpl`/`_setEnqueueImpl`/`_setOperationStore`/`_resetDispatch` (pattern `_resetServiceKeyMap` của 50.1 — KHÔNG `vi.mock`), consts `DEGRADED_REASONS`/`MAX_BATCH_PLATFORMS`/`RETRY_AFTER_DEFAULT_MS`/`SYNC_BUDGET_MS`.
- `api/services/jobQueue.js:67-94` — `addJob(type,data,opts)`: `userId` null-safe + `consumerId` + `config` chỉ chứa sanitized payload; `queue.add` fail → mark row `failed` rồi throw. `:287+` thêm `operationsQueue.process('scrape', 2, handler)`: restore `runWithConsumerContext`, re-resolve `resolveAccountCookie` khi `userId`+`accountIds`, `scrape()`. `:113-151` `getJob`: normalize `failed&&attemptsMade<attempts`→`processing`; Redis error → fallback `operation.status` (detached ops đã tolerate bullJob=null).
- `src/scrapers/index.js:214-249,274-327` — `DESCRIPTORS` registry (mọi alias là key — `'x'`→twitter, `'pump'`→pumpfun) + `scrape()` (nhận array/'all' qua UniversalActionDispatcher — write-oriented, gateway tự fan-out, D-5). Thêm export `isSyncCapable(platform, action, options)`: resolve descriptor, build `ctx={platform,platformName,action}`, gọi `mapAction(options,ctx)` hoặc tra `actionMap`; check cả requested lẫn mapped name.
- `src/scrapers/social/reddit/descriptor.js:13-30` — thêm `syncCapableActions:['search','subreddit','post_comments']` (đều là public actionMap keys; mapped-check làm `posts`/`comments`/`thread` cũng capable — document trong comment).
- `src/scrapers/social/pumpfun/descriptor.js` — thêm `syncCapableActions:['fetch_coin_meta']` (action chưa có trong actionMap — inert tới 50.6).
- `src/core/error-envelope.js:10-23,41-46,56-112` — `ErrorTypes`/`RETRYABLE_TYPES` + `PlatformError` fields: `type`/`code`/`statusCode`/`isRetryable`/`retryAfterMs` (property :80; `retryAfter` seconds getter :90) → classify theo `err.type` trước, `code` chỉ là documentation.
- `prisma/schema.prisma:61-81` — `Operation` model: `userId String?` + `user User? @relation(...)` + `consumerId String?` + `@@index([consumerId])` (D-2).
- `api/routes/ai/actions.js:1145-1188` — status endpoint; `:97-101` skip session gate cho `/status/` → consumer poll không auth (accepted, pre-existing).
- `api/routes/a2a.js:176-194` — 202+poll precedent (`polling:{endpoint,recommendedIntervalMs}`); gateway dùng flat `statusUrl` theo AC — chỉ là style reference.
- `apps/web/lib/api.ts:38-110` + `apps/web/app/pumpfun/page.tsx:141-147` — `api()` trả `{ok,status,data}` raw khi body không có `data` key (202 body pass-through) → helper detect `res.data?.mode==='async' && res.data.statusUrl` rồi poll; cap ~130s (`CHAT_DURATIONS` tới 120s ở `page.tsx:110`).
- `tests/gateway/service-auth.test.js` — pattern test: supertest + real express + env snapshot + reset hooks; test file này KHÔNG `vi.mock`.
- `src/mcp/osint-find-profiles.js:190-203` — `withTimeout` race pattern reference (`.finally(clearTimeout)`).
- `api/routes/ai/discovery.js:45-63` — ANTI-PATTERN: `queueJob` không tạo Prisma row → status 404 — không copy.

## Tasks & Acceptance

**Execution:**
- [x] `api/services/scrapeDispatch.js` -- CREATE -- `resolveMode`, `runSyncWithCeiling`, `classifyDegrade`, `dispatchSingle`, `dispatchBatch`, `enqueueScrapeJob`, `trackDetachedOperation`, `sanitizeOptions`, `assertSerializableOptions`, `canonicalPlatforms`, seams `_setSyncBudgetMs`/`_setScrapeImpl`/`_setEnqueueImpl`/`_setOperationStore`/`_resetDispatch`, consts. Dispatch trả outcome descriptors — không throw contract errors, không touch `res`.
- [x] `api/routes/platform.js` -- PATCH -- param handler admit `'all'` chỉ cho `/scrape`; `/scrape` handler: parse+validate `mode`/`platform` body, strip `mode`/`platform`/`accountIds`/credential keys khỏi options, delegate dispatch, render outcome (status + body + `Retry-After` header). Guard accountIds chạy trước dispatch.
- [x] `src/scrapers/index.js` -- EXTEND -- export `isSyncCapable(platform, action, options)` (function-mapAction call + actionMap fallback + requested check).
- [x] `src/scrapers/social/reddit/descriptor.js` -- PATCH -- `syncCapableActions:['search','subreddit','post_comments']`.
- [x] `src/scrapers/social/pumpfun/descriptor.js` -- PATCH -- `syncCapableActions:['fetch_coin_meta']`.
- [x] `api/services/jobQueue.js` -- EXTEND -- `addJob` null-safe userId + `consumerId` + sanitized `config` + add-fail mark-failed; `process('scrape',2)` processor (consumerCtx restore + cookie re-resolve + `scrape()`); `getJob` failed-flap normalize + Redis-error fallback.
- [x] `prisma/schema.prisma` + `prisma/migrations/<ts>_operation_consumer_attribution/migration.sql` -- MIGRATE -- `Operation.userId` → `String?` (relation optional), `+ consumerId String?` + `@@index([consumerId])` (D-2). Migration phải apply lên test DB trước khi chạy route tests có operation-row assertions.
- [x] `apps/web/app/pumpfun/page.tsx` (hoặc `apps/web/lib/api.ts`) -- PATCH -- scrape helper nhận `202 {mode:'async', statusUrl}` → poll `statusUrl` mỗi ~2s tới `data.status==='completed'|'failed'` (cap ~130s), trả `{result: data.result}` tương thích shape hiện tại (D-1).
- [x] `tests/gateway/mode-dispatch.test.js` -- CREATE -- unit tests (`resolveMode`, `classifyDegrade`, `_setSyncBudgetMs(50)` race timeout) + supertest route tests qua **injected seams** (`_setScrapeImpl`/`_setEnqueueImpl`/`_setOperationStore` — KHÔNG `vi.mock` theo repo mandate): 200 sync, 202 explicit async + operationId + statusUrl, 202 timeout + Retry-After + degraded_reason, late-settle no-crash, 400 not_sync_capable (`kind:'validation'`), 400 bad mode, 400 bad platform type, batch results[]+operationIds[] per-platform isolation + partial-capable + dedupe + cap, 'all' scope (chỉ /scrape admit), secrets strip khỏi job data, options strip (mode/platform/accountIds không leak), service-lane async attribution (`consumerId`).

**Acceptance Criteria:**
- Given `POST /api/platform/reddit/scrape {action:'search', mode:'sync'}` completes <1.5s, when request lands, then `200 {ok:true, mode:'sync', result}` — fast-lane works.
- Given `{action:'search'}` no mode trên syncCapable action, when request lands, then sync path như trên (manifest default).
- Given `{action:'followers'}` no mode trên unlisted action, when request lands, then `202 {success:true, mode:'async', operationId, statusUrl}` và Bull job `scrape` enqueued — manifest default async.
- Given `{action:'followers', mode:'sync'}` trên unlisted action, when request lands, then `400 {error:{code:'XACT_4001', kind:'validation'}}` — contract violation, không phải degrade.
- Given `mode:'sync'` scrape pending >1.5s, when ceiling breach, then `202 + degraded_reason:'upstream_timeout' + operationId + retry_after_ms` + `Retry-After` header, và `GET /api/ai/action/status/:operationId` resolve được operation (không 404).
- Given `mode:'sync'` scrape throws `BotChallengeError` trong budget, when error lands, then `202 degraded_reason:'cf_challenge'` + Bull retry job enqueued — không 200+error.
- Given `mode:'async'` explicit, when request lands, then `202 {mode:'async', operationId}` không `degraded_reason` — caller chủ động async không phải degrade.
- Given `POST /api/platform/all/scrape {platform:['x','reddit'], action:'search', mode:'sync'}` với reddit timeout, when batch completes (ceiling + bookkeeping), then `200 results[]` mang reddit `{status:'degraded',operationId}` + x `{status:'completed',data}` — per-platform ceiling, failure không fail batch.
- Given batch `mode:'async'`, when request lands, then `202` + `results[]` per-platform + top-level `operationIds[]` — consumer poll từng id.
- Given `{action:'search', mode:'sync', platform:['x'], sessionCookie, accountIds}` , when scrape() được gọi, then `options` KHÔNG chứa `mode`/`platform`/`accountIds`/credentials — không leak dispatch fields hay secrets.
- Given `{mode:'async', accountIds:['a1']}` JWT, when job data được persist, then Bull payload + `Operation.config` KHÔNG chứa cookie plaintext — processor re-resolve.
- Given serviceAuth caller (no req.user) + `mode:'async'`, when enqueue, then Operation row tạo thành công `userId=null, consumerId=<derived>` — không FK crash.
- Given `GET /api/ai/action/status/:operationId` của scrape job completed, when polled, then `{success:true, data:{status:'completed', result}}` chứa scrape payload — single status surface (NG-5); Bull retry flap báo `processing` không `failed`.
- Given `mode:'turbo'` hoặc `platform:42`/`[]`, when request lands, then `400` validation — closed enums enforced.
- Given `POST /api/platform/all/automate`, when request lands, then `400` — 'all' KHÔNG leak sang routes khác.
- Given JWT dashboard call không `mode` trên unlisted action, when request lands, then `202` — behavior mới áp dụng đồng nhất mọi caller (D-1).

## Implementation Notes

- **2026-09-26 — Story 50.2 implemented:**
  - Created `api/services/scrapeDispatch.js` — `resolveMode`, `runSyncWithCeiling` (Promise.race + `clearTimeout` + synchronous noop-catch + settle-handler attach at race time per D-4), `classifyDegrade` (`err.type`-based), `dispatchSingle`/`dispatchEntry`/`dispatch` (Promise.allSettled fan-out, explicit-array cap 25, canonical = `aliases[0]`), `enqueueScrapeJob` (sanitized payload + `delay: retryAfterMs`), `trackDetachedOperation` (settle buffered until `bindOperation`), `sanitizeOptions`/`assertSerializableOptions`, `canonicalPlatforms`, seams `_setSyncBudgetMs`/`_setScrapeImpl`/`_setEnqueueImpl`/`_setOperationStore`/`_resetDispatch`, consts `SYNC_BUDGET_MS=1500`/`MAX_BATCH_PLATFORMS=25`/`RETRY_AFTER_DEFAULT_MS=2000`/`DEGRADED_REASONS`. Dispatch returns outcome descriptors only — never touches `res`, never throws contract errors.
  - `api/routes/platform.js` — param handler admits `'all'` only when `req.path` ends `/scrape` (VALID_PLATFORMS unchanged); `/scrape` handler validates `action`, runs the `accountIds && !req.user` guard before dispatch, delegates to `dispatch()`, renders outcome status/body/`Retry-After` headers; generic catch handles only non-contract throws.
  - `src/scrapers/index.js` — exported `isSyncCapable(platform, action, options)` (calls function-form `mapAction(options, ctx)` with `ctx={platform,platformName,action}`, falls back to `actionMap`, checks requested + mapped action).
  - `src/scrapers/social/reddit/descriptor.js` — `syncCapableActions:['search','subreddit','post_comments']` (aliases `posts`/`comments`/`thread` inherit via mapped check).
  - `src/scrapers/social/pumpfun/descriptor.js` — `syncCapableActions:['fetch_coin_meta']` (inert until 50.6).
  - `api/services/jobQueue.js` — `addJob` null-safe `userId` + `consumerId` + sanitized `config`; `queue.add` failure marks row `failed` before throwing (no orphan `queued`); `operationsQueue.process('scrape', 2)` restores `runWithConsumerContext` + re-resolves `resolveAccountCookie` (secrets never in Bull payload); `getJob` normalizes `failed && attemptsMade < attempts` → `processing` and falls back to `operation.status` on Redis error; completed-handler serializes `result` via `safeStringify`.
  - `prisma/schema.prisma` + migration `20260927000000_operation_consumer_attribution` — `Operation.userId` → `String?`, `+ consumerId String?` + `@@index([consumerId])` (D-2). Applied to test DB (`xactions_test`); `prisma generate` re-run.
  - `apps/web/app/pumpfun/page.tsx` — `scrape()` helper detects `202 {mode:'async', statusUrl}` and polls `statusUrl` every ~2s until `completed|failed|cancelled` (cap ~130s to cover `stream_mint_chat` `durationMs` 120s), returning `{result}` in the same shape as a sync call (D-1).
  - `tests/gateway/mode-dispatch.test.js` — unit (`resolveMode`, `classifyDegrade`, `sanitizeOptions`, `assertSerializableOptions`, `canonicalPlatforms`, `isSyncCapable`, `runSyncWithCeiling` timeout/late-settle/queue_fallback) + supertest route tests via injected seams (no `vi.mock`): 200 sync, 202 explicit async, 202 timeout + `Retry-After`, CF/rate-limit degrade with `retryAfterMs` → Bull `delay`, 400 not_sync_capable/bad mode/bad platform type, batch results[]+operationIds[]+partial-capable+dedupe+cap+'all' expansion+'all' scope exclusion, secrets strip, service-lane `consumerId` attribution.
  - `_bmad-output/planning-artifacts/epics.md` — 50.2 AC wording updated for D-5 (allSettled semantics, not dispatcher) and D-6 (detached tracking, not Bull continuation).
- **2026-09-26 — matrix coverage follow-up (4 previously uncovered rows):**
  - `api/services/jobQueue.js` — extracted exported `normalizeBullState(bullState, attemptsMade, maxAttempts, fallbackStatus)` (getJob uses it); added `_setOperationsQueue`/`_resetOperationsQueue` seam scoped to `addJob`/`queueJob`/`getJob` only — processors stay bound to the real `operationsQueue` (same injected-seam pattern as `_setServiceKeyMap`/`_resetDispatch`, no `vi.mock`).
  - `tests/gateway/mode-dispatch.test.js` — added: EDGE_DRYRUN_ASYNC (202 + `options.dryRun` preserved in job payload), EDGE_ACCOUNTIDS_BATCH (JWT + seeded `reddit:` FacebookAccount row → cookie resolved per-platform inside the entry task; bogus accountId → per-entry `failed` while sibling entry still queues — never whole-400), EDGE_QUEUE_ADD_FAIL (real `addJob` + throwing queue seam + real prisma read asserting `status:'failed'`/`error`/`completedAt` — no orphan `queued` row; plus route-level explicit-async → 503), EDGE_STATUS_FLAP (`normalizeBullState` unit + `getJob` seam-level: mid-retry `failed`→`processing`, exhausted→`failed`, Redis error→DB fallback).
  - Correction recorded: the BATCH_SYNC matrix row's example used `x` as the completed entry, but twitter ships no `syncCapableActions` — tests use pumpfun as the completed platform (same contract: mixed completed+degraded entries in one 200 batch). Canonical entry labels are `descriptor.aliases[0]` (e.g. `x`→`twitter`).
- **2026-09-26 — code review loop 2 (findings C1–C39 applied):**
  - `api/services/scrapeDispatch.js` — `queue_fallback` is settle-aware (rejected scrape → Bull retry + `queue_fallback`; resolved → normal outcome; still in-flight → `unavailable`, never re-enqueued — no double upstream execution); tracking-row create bounded ~2s; `row.id` verified before statusUrl emit; `CREDENTIAL_KEYS` expanded (authToken/accessToken/token/apiKey/clientId/sessionid/csrftoken/auth_token/ct0/c_user/xs/identifier/redditClientSecret/redditClientId/session + originals) stripped from every persisted copy (detached config, Bull job data, `Operation.config`) while run options keep them — async lane + creds → `400` 'credentials not allowed for queued execution — use sync or accountIds'; unknown action rejected pre-enqueue (`400` `XACT_4001` single, per-entry `failed` batch); `applyAccountCookie` moved inside the raced `run()` (prisma+decrypt counts against the 1.5s ceiling); detached settle clears settled only after write, retries once, conditional `updateMany(status:'processing')` never clobbers `cancelled`, typed error persisted to `config.lastError`; batch targets normalize→alias→canonicalize, dedupe-before-cap, circular-safe dedupeKey, non-string members fail per-entry; entry enqueue-fail → `XACT_5000`; async batch with zero operationIds → `503`; `assertSerializableOptions` uses ancestor tracking (diamonds accepted; cycles/Map/Set/Date/RegExp/non-finite rejected); `dispatch()` defaults `body={}`; structured `console.info` on degrade/queue paths.
  - `api/services/jobQueue.js` — scrape processor honors `cancelledJobs` (cancel → `cancelled`, not `completed`); completed/failed handlers try/catch prisma + never overwrite `cancelled`; job data carries caller lane (`apiKeyRequired:false` + `consumerId:null` JWT; derived consumer + `true` serviceAuth); `normalizeBullState` requires numeric attempts metadata before remap (terminal Bull states preserved); `callbackUrl` hoisted to `config.callbackUrl`.
  - `api/routes/platform.js` — `'all'` admission normalizes `req.path` (lowercase + strip trailing slash — `/all/scrape/`, `/all/SCRAPE` admitted); truthy non-array `accountIds` → `400`.
  - `apps/web/lib/scrape-poll.ts` (new) — `isAsyncAccepted` + `pollOperation` with injected seams (`_setPollApiImpl`/`_setPollIntervalMs`/`_resetPollSeams`); transient 5xx tolerated (gives up after 3 consecutive); `retry_after_ms` honored as first-poll delay; ~130s cap. `apps/web/app/pumpfun/page.tsx` consumes it.
  - `tests/gateway/mode-dispatch.test.js` — now 78 tests (additions incl. shared-ref diamonds/lossy-type serialization, settle-aware queue_fallback ×4 + missing row.id, cancel-safe detached settle + `config.lastError` typed fields, sync body-cookie reaches `scrape()` while persisted config stays clean, async+creds → 400, unknown action 400 single/per-entry batch, JWT `consumerId:null` vs service `'jev'`, body `platform:'all'` + `'all'+mode:'sync'` + non-string member isolation, all-async-enqueue-fail → 503, `callbackUrl` hoist, route-level timeout+tracking-fail+enqueue-fail → 503, real `operationsQueue` completed/failed emit → `getJob` + `GET /api/ai/action/status` round-trip, cancelled row survives late completed event).
  - `tests/web/scrape-poll.test.js` — new, 8 tests via injected seams.
  - Correction recorded (C31): the Design Notes claim "Detached continuation giữ options trong process memory (không serialize)" is wrong — the detached tracking row persists **sanitized** options into `Operation.config` (the row is the poll surface); only credential keys are excluded, and async+creds is rejected at the door.

## Spec Change Log

- **2026-09-26 review loop 1** — 3-reviewer pass (contract-fidelity / code-reality / edge-case), ~21 findings triaged. Contract amendments recorded:
  - **AC amendment (D-6):** epics.md `50.2` AC "Job continues in background via Bull" superseded bởi D-4 detached in-flight tracking (user-approved OQ-4). Observable contract giữ nguyên. `epics.md` wording cần update ở wrap-up.
  - **Async batch shape:** emit cả `results[]` (CAP-6) lẫn `operationIds[]` top-level (epics AC) — hai authority conflict, superset thỏa cả hai.
  - **Per-entry shape:** emit cả `success:boolean` (epics pin) lẫn `status` enum (CAP-6) — superset.
  - **`'all'` admission:** scope-check tại param handler theo path `/scrape` — KHÔNG thêm `VALID_PLATFORMS` (ngăn `/all/automate` write fan-out qua UniversalActionDispatcher + `all:` account labels).
  - **Secrets:** enqueued job data không chứa credentials — strip + re-resolve trong processor (Redis/Bull retain 100 completed jobs → plaintext risk).
  - **Timing:** bound = ceiling + bookkeeping (không "~1.5s total").
  - **`kind` field:** epic pin `kind:'validation'` trong 400 body nhưng codebase taxonomy không có → hand-rolled tại route, `sendErrorEnvelope` không dùng được cho contract bodies.
  - **Contract bodies ownership:** route sở hữu res writes; dispatch trả descriptors (generic catch phá shape nếu dispatch throw).
  - **Degrade classify:** theo `err.type` không code list; `queue_fallback` trigger defined; retryAfterMs → Bull `delay`.
  - **getJob:** failed-flap normalize + Redis-error fallback cho detached ops.
  - **Tests:** injected seams thay `vi.mock` (repo mandate); `_setScrapeImpl`/`_setEnqueueImpl`/`_setOperationStore`/`_setSyncBudgetMs`.
  - **Batch:** explicit-array cap 25, dedupe normalized, canonical=`aliases[0]`, body.platform type-validation + body-wins-mismatch.
  - **FE poll cap:** 60s→130s (stream_mint_chat durationMs tới 120s).
  - **a2a.js pre-existing crash:** `addJob` không userId → `String(undefined)` FK crash — story này fix (null-safe).
  - Minor: status endpoint unauthenticated acknowledged; service-lane ops invisible cho getHistory (accepted); dryRun+async allowed-inert; concurrent duplicate requests = double execution (accepted); Bull processors đã chạy in-process (topology hiện có — "sync lane tách event loop" boundary đã sửa cho đúng thực tế).

## Review Triage Log

### Code review loop 1 (blind-hunter / edge-case-hunter / verification-gap on diff)

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| C1 | `queue_fallback` re-enqueues Bull while scrapeP still in-flight → double upstream execution, contradicts D-4/Never (BH1, EC2, VG5) | high — real; Never forbids re-enqueue of *in-flight*, fallback legal only after settle-failed | patch — settled-aware fallback (resolved→return result; rejected→enqueue 202 queue_fallback; in-flight→503) + bounded create await |
| C2 | CREDENTIAL_KEYS under-inclusive — accessToken/authToken/token/apiKey/clientId/sessionid/csrftoken/auth_token/ct0/c_user/xs/identifier leak to Redis+Operation.config (BH2, EC1) | high — verified descriptors consume these option keys | patch — expanded CREDENTIAL_KEYS on persist paths only; run-options keep creds (legacy body-cookie sync flow); async+creds → 400 |
| C3 | Unknown action → 202 + guaranteed-failing job (was sync 400 XACT_4001 before) (VG2) | high — silent contract regression, burns 3 retries/row | patch — action-existence check pre-enqueue → 400/per-entry failed |
| C4 | Async lane never verified end-to-end (processor→completed→getJob→status) (VG1) | high — post-202 half of contract unexecuted | patch — real operationsQueue emit + getJob/status round-trip test |
| C5 | pollOperation/scrape 202-branch untested; wrong field name = silent 130s timeouts on all pumpfun actions (VG3) | high — only in-repo consumer unverified | patch — extract to testable lib + unit tests |
| C6 | Cancel clobbered: detached settle overwrites 'cancelled'; processor never checks cancelledJobs (EC19, VG4) | medium — real, misleading terminal state | patch — conditional updateMany(status='processing') + processor consults cancelledJobs + completed-handler respects it |
| C7 | `apiKeyRequired=Boolean(consumerId)` — JWT-lane jobs get true, diverges from sync ctx (EC16) | medium — real divergence | patch — carry lane source in job data |
| C8 | normalizeBullState: missing attemptsMade/attempts → failed+0<1 reports 'processing' (EC17) | medium — terminal masquerades | patch — require both numerics before remap |
| C9 | retryAfterMs negative/non-finite → Bull delay negative (EC18) | medium | patch — clamp `Number.isFinite && >0` |
| C10 | applyAccountCookie (prisma+decrypt) runs BEFORE race → outside 1.5s ceiling (EC5) | medium — hung prisma stalls 'sync' request | patch — move cookie resolve inside raced run() |
| C11 | Tracking-row create await unbounded → request can hang post-breach (EC4) | medium | patch — race create vs ~2s timeout |
| C12 | 'all' admission `endsWith('/scrape')` misses `/all/scrape/` + `/all/SCRAPE` (BH7, EC14) | medium | patch — normalize path (strip trailing slash, lower) |
| C13 | Body platform skips PLATFORM_ALIASES ('tiktok-shop' 400s body, works path); 'ALL'/' all ' literal (BH3, EC9, EC8) | medium | patch — normalize raw + apply aliases pre-compare |
| C14 | Batch all-entries-enqueue-fail still returns 202 success:true, operationIds:[] (EC12) | medium — caller gets nothing trackable | patch — zero operationIds → 503 |
| C15 | Batch entry enqueue-fail fallback code XACT_4001 while kind internal (BH6, EC13, VG6) | medium | patch — fallback 'XACT_5000' |
| C16 | cap-25 checked before dedupe — 26 dupes → 400 though resolves to 1 (BH12, EC11) | medium | patch — dedupe then cap |
| C17 | dedupeKey JSON.stringify throws on circular member → dispatch throws → 500 (EC10) | medium | patch — try/catch fallback key |
| C18 | assertSerializableOptions: diamond refs falsely rejected; Map/Set/Date/RegExp/NaN/Infinity pass silently (BH11, EC6, EC7) | medium | patch — ancestor-tracking + explicit type rejection |
| C19 | accountIds non-array truthy silently ignored → scrape runs unresolved (EC15) | medium | patch — !isArray → 400 |
| C20 | detached settle write drops code/type/statusCode/isRetryable → bare message (BH15) | medium — post-hoc discrimination lost | patch — typed error into config.lastError |
| C21 | writeSettle clears settled before update + swallows failure → row stuck 'processing' (EC3) | medium | patch — clear only on success |
| C22 | degradedOutcome emits row.id unverified → statusUrl 'undefined' (EC21) | low | patch — throw → fallback branch |
| C23 | Single path echoes raw 'rdt' while batch canonicalizes 'reddit' (BH16) | low | patch — canonical aliases[0] both paths |
| C24 | callbackUrl in body lands in options, never fires for scrape jobs (BH13) | medium — feature silently dead | patch — hoist into job config top-level |
| C25 | SPINE operational log envelope unimplemented (upstream_status etc.) (BH14) | medium — spec Design Notes required | patch — structured console.info on degrade/queue |
| C26 | JWT ops write consumerId:'internal' — conflates with service lane in attribution column (BH10) | low | patch — consumerId only for serviceAuth lane |
| C27 | completed handler no try/catch — unhandledRejection, now hotter via scrape lane (BH9) | medium — real crash risk | patch — wrap |
| C28 | dispatch() body=null → TypeError → 500 not 400 (BH19a) | low | patch — default body={} |
| C29 | pollOperation aborts on first 5xx blip; ignores retry_after_ms cadence (BH19b) | medium — transient prisma blip abandons live job | patch — consecutive-fail tolerance + first-poll delay hint |
| C30 | Layering wart: scrapeDispatch + jobQueue import ../routes/platform.js for helpers (BH19d) | medium — service→route dependency, pulls router into worker | defer — late dynamic `import()` keeps the cycle out of load-time module graph; shared-module extraction deferred to a cleanup story |
| C31 | Spec claim "detached options không serialize" false — sanitized options ARE persisted to config (EC20) | spec wording bug (frozen) | reject — finding's fix edits spec; Implementation Notes corrected instead |
| C32 | proxy_exhausted/hibernation retryable types never degrade (BH5) | false — closed degraded_reason enum has no value for them; error path is contract-correct | reject — behavior is per-contract |
| C33 | Single-string body platform bypasses VALID_PLATFORMS superset (BH4) | low — intended: descriptor-membership is the scrape capability check; path whitelist is legacy guard | reject — documented in Implementation Notes |
| C34 | accountIds[0] reused across batch platforms — cross-platform mis-resolve (BH8) | false — matrix row EDGE_ACCOUNTIDS_BATCH pins exactly this semantics; per-entry isolation works | reject — enhancement {platform→accountId} noted as defer |
| C35 | Test gaps: body {platform:'all'}, 'all'+sync, non-string members, detached-config secrets, route-level 503-timeout-both-fail (BH18) | real coverage gaps | patch — add tests |
| C36 | sprint-status 'done' vs spec 'in-review'; impl notes "49 tests" vs 55 (BH17, EC23) | artifact drift | patch — fixed artifacts |
| C37 | pumpfun helper can't detect batch 202 (results[] no top-level statusUrl) (EC22) | low — pumpfun never sends platform[]; batch results don't fit single-result return type | defer — needs API surface change, documented |
| C38 | Deterministic scrape failures retry 3× in worker (VG7) | defer — consistent with all existing job types; pre-enqueue validation removes the main offender | defer — noted |
| C39 | 'all' check method-agnostic — future GET /all/.../scrape routes would admit (BH7b) | maybe-false | defer — no such route exists; noted |

### Pre-implementation spec review (loop 0)

| # | Finding (reviewer) | Severity | Resolution |
|---|--------------------|----------|------------|
| 1 | 'all' in VALID_PLATFORMS mở write fan-out /automate + all: labels (code-reality #1, edge-case #3) | HIGH | Scoped 'all' → path `/scrape` only tại param handler; VALID_PLATFORMS không đổi; Never + AC + matrix row |
| 2 | UnhandledRejection window trong detached continuation (edge-case #1) | HIGH | D-4 amended: attach settle handler sync tại race time; matrix EDGE_LATE_SETTLE |
| 3 | Secrets persist vào Redis + Operation.config (edge-case #2) | HIGH | Strip credential keys + accountIds khỏi options; job data mang accountIds+userId; processor re-resolve; EDGE_SECRETS_ASYNC + AC |
| 4 | Generic catch phá contract shapes {ok:false,error:string} (code-reality #4) | HIGH | Route owns res writes; dispatch trả descriptors; contract bodies hand-rolled |
| 5 | `addJob` `String(undefined)` FK crash; a2a đã hit (code-reality #3, edge-case #16) | HIGH | null-safe `data.userId ? String : null`; add-fail → mark row failed |
| 6 | "Sync lane tách event loop khỏi Bull" sai — jobQueue static-imported 11 routes (code-reality #2) | HIGH | Never boundary sửa thành topology-fact; ceiling 1.5s là bound thật |
| 7 | Test plan vi.mock vi phạm repo mandate (edge-case #4) | HIGH | Injected seams `_setScrapeImpl`/`_setEnqueueImpl`/`_setOperationStore` thay vi.mock |
| 8 | Async batch thiếu `operationIds[]` theo epic AC (contract #1) | HIGH→resolved | Emit cả results[] + operationIds[] (superset, thỏa CAP-6 + epics) |
| 9 | Per-entry thiếu `success` boolean theo epics pin (contract #2) | MED | Emit cả success + status |
| 10 | D-4 supersede AC "via Bull" không record (contract #3) | MED | D-6 recorded AC amendment; epics.md update ở wrap-up |
| 11 | Per-entry code 'not_sync_capable' ≠ XACT_4001 (contract #4) | MED | Per-entry error = XACT_4001 + kind/type/message đồng nhất |
| 12 | Bull `failed` flap giữa retries → poll stop sớm (edge-case #6) | MED | getJob normalize `failed&&attemptsMade<attempts`→processing |
| 13 | Orphan queued row khi queue.add fail sau create (edge-case #7) | MED | mark failed trước throw; EDGE_QUEUE_ADD_FAIL |
| 14 | retryAfterMs không propagate vào Bull job delay (edge-case #9) | MED | `delay:err.retryAfterMs` vào addJob opts |
| 15 | Classify theo code list sai (XACT_4291 = local cap) (edge-case #8) | MED | Classify theo `err.type`; queue_fallback trigger defined |
| 16 | platform body type/precedence gaps (edge-case #10) | MED | Type-check rows (EDGE_BAD_PLATFORM_TYPE, EDGE_PLATFORM_MISMATCH body-wins) |
| 17 | Batch unbounded + dupes + canonical name undefined (edge-case #11) | MED | Cap 25 explicit; dedupe; canonical=aliases[0]; 'all'⊋VALID_PLATFORMS intended (D-3) |
| 18 | Async options non-serializable divergence (edge-case #12) | MED | `assertSerializableOptions` → 400; EDGE_NONSERIAL_OPTIONS |
| 19 | isSyncCapable phải call mapAction function với ctx (code-reality #8) | MED | Amended — build ctx + call function; dispatch-only descriptors match requested only |
| 20 | FE poll cap 60s < stream_mint_chat 120s (code-reality #7) | MED | D-1 amended → ~130s |
| 21 | Mixed batch top-level mode unspecified (contract #11) | LOW | Pinned: mode = HTTP response lane ('sync'@200 / 'async'@202) |
| 22 | Timer hygiene + result JSON.stringify + budget-hook reset (edge-case #14) | LOW | clearTimeout on win; JSON.stringify cho Operation.result String?; `_resetDispatch` seam |
| 23 | "~1.5s total" unverifiable (edge-case #15) | LOW | Bound = ceiling + bookkeeping; test slack budget+500ms |
| 24 | EDGE_QUEUE_DOWN dead-code + queue_fallback output unstated (contract #6,8) | LOW | Trigger defined; 202 queue_fallback branch stated |
| 25 | Frozen-block trivia (contract #10); a2a mirror claim (contract #8); index justification (contract #9); service-lane ops invisible (edge-case #16); status endpoint unauthenticated (edge-case #17c); dryRun+async (17a); resume ordering (17b); dup requests (11); Redis-down status (17d); SPINE retryAfter drift (12); upstream_status log field (12) | LOW | Trivia moved/kept contract-level; a2a → style ref; accepted footguns documented; getJob Redis-fallback; log line thêm `upstream_status` ở impl note |

## Design Notes

**Tại sao dispatch module riêng (`api/services/scrapeDispatch.js`):** handler platform.js hiện ~65 dòng; mode resolution + ceiling race + degrade classify + batch fan-out + tracking sẽ phình lên 200+. Route giữ thin: auth → parse → dispatch → shape. Module mới cũng là seam testable (unit tests không cần boot server) và là chỗ duy nhất chứa injected seams cho route tests.

**Route owns res — dispatch trả outcome descriptors:** generic catch `platform.js:455-464` flatten mọi throw thành `{ok:false, error:<string>, code}` — nếu dispatch throw contract errors (not_sync_capable/bad-mode) shape bị phá (`error` string thay vì object, `ok` thay vì `success`). Contract bodies cần `error:{code,kind,type,message}` + `Retry-After` header → route render descriptor `{kind:'json',status,body,headers}`; catch chỉ xử lý non-contract throws (infra crash thật).

**`'all'` scope-check thay vì whitelist:** `platformParamHandler` guard MỌI `/:platform/*` route. Whitelist `'all'` router-wide → `POST /all/automate` đi qua → `scrape('all',action)` → `UniversalActionDispatcher` resolve 'all' thành `DEFAULT_WRITE_PLATFORMS` (twitter/bluesky/mastodon/threads) chạy write actions với env creds — write fan-out qua path param. `/all/accounts` cũng tạo literal `all:` labels. Fix: param handler admit `'all'` chỉ khi `req.path` ends `/scrape` — batch là scrape-only contract.

**Secrets sanitization cho async lane:** options hiện chở `sessionCookie`/`authCookie`/`clientSecret`/`accountIds`; `addJob` JSON.stringify vào `Operation.config` + Bull data (retained 100 jobs) = plaintext credentials trong Redis+DB. Fix: `sanitizeOptions` strip credential keys trước enqueue; job data chỉ mang `{platform,action,options,userId,consumerId,accountIds}`; processor re-resolve cookie qua `resolveAccountCookie(userId,accountIds,platform)` — cùng code path với sync handler hiện tại. Detached (in-flight) continuation giữ options trong memory — không persist nên không cần sanitize.

**Detached continuation sequencing:** `Promise.race([scrapeP, timeout])` — attach `scrapeP.then(onOk,onErr)` NGAY khi tạo race (trước `await prisma.operation.create`): rejection trong window await-DB mà chưa attach = unhandledRejection → uncaught exception Node ≥15. Settle handler cần operationId → tạo row trước rồi chain update vào handler đã attach (handler closure đọc biến operationId gán sau — hoặc attach noop-catch sync + chain settle sau). Timeout win → return 202 descriptor; detach tiếp tục ghi row. `clearTimeout` trong finally của win-path.

**isSyncCapable replicate `scrape()` semantics:** `scrape()` gọi `descriptor.mapAction(options, ctx)` (function, `index.js:302-310`) chứ không phải lookup — isSyncCapable phải build `ctx={platform,platformName,action}` giống hệt rồi gọi. Descriptor chỉ có `dispatch` (facebook) không có mapAction → chỉ check được requested action. Check `[requested, mapped]` against `syncCapableActions` → alias variants capable (intended: `posts`→`subreddit`).

**Bull topology reality:** `jobQueue.js` được ~11 routes static-import → `operationsQueue.process(...)` đã chạy trong API process hôm nay (Bull split jobs giữa API + worker process). Thêm `process('scrape',2)` kế thừa topology này — không phải regression mới. Sync lane được bound bởi ceiling 1.5s chứ không bởi process isolation; nếu cần tách sau này là enqueue-only client + env-gated processor registration (out of scope).

**getJob normalize:** Bull `failed` giữa retries (`attemptsMade < attempts`) → báo `processing` — consumer poll-until-terminal không stop giữa retry window. Detached ops (bullJob=null) đã fallback `operation.status`; thêm Redis-error → fallback DB (status poll sống sót Redis hiccup — detached ops không cần Redis).

**Dispatcher bypass = deliberate (D-5):** AC epics pin `UniversalActionDispatcher.dispatch` cho batch — nhưng dispatcher là write-oriented: inject `resolvePlatformCredentials`, `${platform}-account` default, ContentTransformer, và `'all'`→write-platforms (`index.js:280-283`). Gateway batch tự fan-out `Promise.allSettled` trên descriptor platforms — giữ AC semantics (per-platform isolation + allSettled), bypass mechanism.

**Accepted footguns (documented, không fix story này):** concurrent duplicate requests → double execution (không idempotency); `dryRun:true`+async → allowed-inert; service-lane ops invisible cho `getHistory`/`getRecentJobs` (filter userId); status endpoint unauthenticated (holder-of-id đọc result — pre-existing cho mọi operation); API crash mid-flight → detached row kẹt `processing`; `'all'` ⊋ VALID_PLATFORMS (descriptor platforms như github/masothue reachable — D-3 intended).

**Degrade log envelope:** khi implement, degrade/queue paths log theo SPINE operational envelope (`platform, action, consumer_id, mode, degraded_reason, retry_after_ms, upstream_status, duration_ms`) — `upstream_status` bắt buộc per SPINE L117 dù chưa có trong AC text.
