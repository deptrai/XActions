---
title: 'Story 50.3: Unified Envelope + Request-Id Propagation + ErrorEnvelope'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
followup_review_recommended: false
epic: 50
story_number: 50.3
phase: 'Epic 50 — Public Scrape Gateway'
priority: 'high'
baseline_commit: '431d07c02b21e22b291f912cf819fe8a1a564d62'
warnings: ['oversized']
deferred:
  - summary: >-
      tests/api/contract/session-cookie-shim.test.js failures on viral pilot endpoint
    evidence: |-
      Pre-existing failure on baseline 431d07c0 where storedSession(res) returns undefined due to viral/mine in-process handling.
    location: >-
      tests/api/contract/session-cookie-shim.test.js:77
    severity: medium (unverified)
context:
  - _bmad-output/implementation-artifacts/epic-50-context.md
  - _bmad-output/specs/spec-xactions-public-scrape-gateway/SPEC.md
  - _bmad-output/planning-artifacts/architecture/architecture-xactions-public-scrape-gateway-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/implementation-artifacts/stories/50-1-service-auth-lane-bearer-consumer-derivation.md
  - _bmad-output/implementation-artifacts/spec-50-2-sync-async-mode-dispatch-202-degrade.md
  - api/routes/platform.js
  - api/services/scrapeDispatch.js
  - api/middleware/envelope.js
  - api/middleware/serviceAuth.js
  - src/utils/redis-stream-publisher.js
---

<intent-contract>

## Intent

**Problem:** `POST /api/platform/:platform/scrape` (sau 50.2) trả 3 dialect khác nhau — sync `{ok:true,result}`, 202 `{success:true,operationId,...}`, error `{ok:false,error:<string>,code}` — và không có request-id end-to-end, nên consumer (jev, Nowing, ChainLens) không viết được adapter platform-agnostic, không trace được call, và không phân biệt được quota/upstream nào fail (mọi error giống nhau → consumer phải guess retry strategy).

**Approach:** Chuẩn hóa MỌI response của route `/scrape` (single + batch + degrade + error + auth-fail) về unified envelope của AD-5 — `{success, mode, metadata{request_id, platform, action, consumer_id, duration_ms, sync_capable, ...}, stream{enabled,name?,cursor?}, preview[≤10 verbatim], data[]}` — và mọi error về `ErrorEnvelope` `{success:false, error:{code, kind, message, status, request_id, retryable, retry_after_ms?}}` với `error.kind` closed enum (C-10). Thêm `requestId` middleware trước `eitherAuth` để `X-Request-Id`/`traceparent` chảy end-to-end kể cả khi auth fail. Một module mới `api/services/gatewayEnvelope.js` sở hữu toàn bộ shape; dispatch vẫn trả outcome descriptors, route vẫn sở hữu mọi `res` write.

## Boundaries & Constraints

**Always:**
- Mọi response 2xx của `/scrape` (sync 200, 202 queued, 202 degraded, batch 200/202) mang đủ `{success:true, mode, metadata, stream, preview, data}` + field lane-specific top-level (`operationId`/`statusUrl`/`degraded_reason`/`retry_after_ms`/`results`/`operationIds`). `preview` = `data.slice(0,10)` VERBATIM — không summary, không derive (AD-5); summary/stats nếu cần đi vào `metadata`.
- `data` LUÔN là array: `Array.isArray(result) ? result : (result == null ? [] : [result])`. Sync-200 dual-emit thêm `result:<verbatim>` + `ok:true` (deprecated mirror cho in-repo consumer `apps/web` — convention superset 50.2; removal không thuộc story này). `metadata.dry_run` giữ cờ dryRun cũ.
- `metadata` = `{request_id, platform, action, consumer_id, duration_ms, sync_capable, traceparent?}` — `platform` = canonical (batch → `metadata.platforms:[canonical...]` thay `platform`); `consumer_id` = effective consumer (`consumerCtx.consumerId`, JWT/anon → `'internal'`); `duration_ms` đo tại dispatch-level; `sync_capable` = bool `isSyncCapable` đã resolve — **chỉ single-dispatch emit; batch top-level omit** (entries giữ shape 50.2); `traceparent` chỉ khi inbound header có.
- `X-Request-Id` inbound được honor verbatim (sanitize: chỉ `[A-Za-z0-9_\-:.]` ≤128 chars, vi phạm → generate mới); absent → generate `req_${Date.now()}_${rand8hex}`; echo qua response header `X-Request-Id` + `metadata.request_id` + `error.request_id` + `logGatewayLine`.
- `traceparent` inbound (W3C) → `metadata.traceparent` khi present.
- Mọi error trên route `/scrape` (guard 400, validation, auth fail, scrape error, 503 unavailable, per-entry batch error) funnel qua ErrorEnvelope: `{success:false, error:{code, kind, type, message, status, request_id, retryable, retry_after_ms?}}` — không raw scraper stack, không `{ok:false,error:<string>}` dialect cũ.
- `error.kind` closed enum `auth|validation|consumer_quota|upstream_rate_limit|proxy_ip_block|upstream_error|internal` (C-10) — reuse `errorKind(type)` mapping (move sang gatewayEnvelope, re-export). Untyped `Error` từ scrape lane → `kind:'upstream_error'` (không phải `internal` — đó là upstream fail, không phải bug của ta). Dual-emit `type` (codebase taxonomy) cùng `kind` (contract enum) — giữ parity 50.2.
- `retryable:true` BẮT BUỘC kèm `retry_after_ms` (C-10) — derive từ `err.retryAfterMs`, default `RETRY_AFTER_DEFAULT_MS`. 503 `unavailable` → `retryable:true` + `retry_after_ms` + `Retry-After` header. 429-reserved (`consumer_quota`) chưa emit — Story 50.4.
- `stream` block: `{enabled: isEnvTruthy(REDIS_STREAM_ENABLED), name?: publisher.streamKey, cursor?: last-entry-id}` — `name`/`cursor` chỉ khi enabled; `cursor` = last entry id của stream lấy best-effort SAU sync completion (consumer XREAD-forward được); async/degrade → `{enabled, name}` không cursor (chưa emit). Mọi failure khi đọc cursor → omit field, KHÔNG fail response.
- Route `platform.js`: mount `requestId` middleware TRƯỚC `eitherAuth` (`router.post('/:platform/scrape', requestId, eitherAuth, handler)`) để auth-fail 401 cũng mang `request_id`; handler truyền `{requestId: req.requestId, traceparent: req.traceparent}` vào `dispatch()`.
- `errorMiddleware`/`sendErrorEnvelope` mở rộng CÓ ĐIỀU KIỆN: chỉ khi `req.requestId` truthy mới append `kind`, `status`, `request_id`, `retryable`, `retry_after_ms?` — request không qua gateway context (mọi route khác) output byte-identical (envelope.test.js `toEqual` exact-match phải giữ xanh).
- Batch entry giữ shape 50.2 (`{platform, success, status, data?|operationId+statusUrl+degraded_reason?|error?}`); entry `error` thêm `retryable` khi derivable; top-level batch mang envelope đầy đủ + `results[]` + (`operationIds[]` khi async 202) + `data` = concat các entry `completed` (normalized) + `preview` slice.
- `logGatewayLine` thêm `request_id` vào structured line (SPINE observability: `consumer_id, platform, action, mode, duration_ms, upstream_status` + request_id).
- Contract test `tests/gateway/unified-envelope.test.js` assert cùng key-set trên `reddit/search`, `pumpfun/fetch_coin_meta`, `x/search` + `error.kind` enum coverage.

**Never:**
- KHÔNG route/endpoint mới; KHÔNG regen openapi.json (Story 50.5); KHÔNG implement `fetch_coin_meta` crawler action (Story 50.6 — inert, contract test chỉ assert error-envelope path của nó); KHÔNG quota/x402/per-consumer bucket (Story 50.4 — `consumer_quota` chỉ là enum member reserved).
- KHÔNG đổi canonical `{success:true, data}` envelope hay error shape của routes KHÁC (`sendData`/`sendPage`/`sendErrorEnvelope` default path) — extension là conditional-on-`req.requestId` only.
- KHÔNG bỏ `results[]`/`operationIds[]`/per-entry `status`/`success` (pins của 50.2); KHÔNG bỏ `ok`/`result` mirror trong story này (apps/web pumpfun page đọc `env.result`; removal là cleanup story riêng).
- KHÔNG để `api()` BFF unbox gateway envelope — `apps/web/lib/api.ts` `isEnvelope` check hiện unbox MỌI `{success,data}`: 202 body có `data:[]` sẽ unbox thành `[]` → `isAsyncAccepted` fail → async polling chết. Guard: skip unbox khi `mode`/`operationId`/`metadata` key present.
- KHÔNG để request-id middleware đọc body hay chạy sau `eitherAuth` (auth 401 phải có request_id); KHÔNG log secret/credential; request-id chỉ từ header/generate — không từ body field.
- KHÔNG fail response vì stream-cursor read (Redis hiccup → omit cursor); KHÔNG block response chờ stream publish (publish là fire-and-forget của crawler, Epic 20.2).
- KHÔNG dùng `vi.mock`/stub module trong tests — injected seams (`_setScrapeImpl`/`_setEnqueueImpl`/`_setOperationStore`/`_setSyncBudgetMs`, `_resetServiceKeyMap`) + supertest + real express như `tests/gateway/mode-dispatch.test.js`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| HAPPY_SYNC | `POST /reddit/scrape {action:'search'}` completes <1.5s | `200 {success:true, ok:true, mode:'sync', metadata{request_id,platform:'reddit',action:'search',consumer_id,duration_ms,sync_capable:true,dry_run}, stream{...}, preview:data.slice(0,10), data:[...], result:<verbatim>}` | N/A |
| HAPPY_ASYNC | `{action:'followers', mode:'async'}` enqueue ok | `202 {success:true, mode:'async', operationId, statusUrl, metadata{request_id,...}, stream{enabled,name?}, preview:[], data:[]}` | N/A |
| HAPPY_DEGRADE | `mode:'sync'` breach 1.5s | `202` như async + `degraded_reason`, `retry_after_ms`, `Retry-After` header, `metadata.request_id` | N/A |
| HAPPY_REQID_INBOUND | header `X-Request-Id: abc-123` | `metadata.request_id==='abc-123'` + response header `X-Request-Id: abc-123` + logGatewayLine.request_id | N/A |
| HAPPY_REQID_GEN | no header | `request_id` match `/^req_\d+_[0-9a-f]{8}$/` + header echo | N/A |
| HAPPY_TRACEPARENT | header `traceparent: 00-<32hex>-<16hex>-01` | `metadata.traceparent` === inbound verbatim | N/A |
| ERR_VALIDATION | `{action:'x', mode:'turbo'}` | `400 {success:false, error:{code:'XACT_4001', kind:'validation', type:'validation', message, status:400, request_id, retryable:false}}` + header echo | 400 |
| ERR_AUTH | Bearer unknown → serviceAuth fail | `401` qua errorMiddleware: `{success:false, error:{code:'XACT_4001', kind:'auth', type:'auth', status:401, request_id, retryable:false}}` — vì requestId mw chạy trước eitherAuth | 401 |
| ERR_UPSTREAM | sync scrape throw untyped `Error('boom')` trong budget | `500 {success:false, error:{code: err.code || 'XACT_5000', kind:'upstream_error', status:500, request_id, retryable:false}}` — không raw stack | 500 |
| ERR_TYPED_NOTFOUND | scrape throw `PlatformError{type:'not_found'}` | `404 error:{kind:'validation', retryable:false}` | 404 |
| ERR_UNAVAILABLE | explicit async + store+enqueue fail | `503 {error:{code:'XACT_5000', kind:'internal', status:503, request_id, retryable:true, retry_after_ms:2000}}` + `Retry-After: 2` | 503 |
| ERR_AUTH_MW_INTERNAL | serviceAuth throws internally | `500` qua errorMiddleware với `kind:'internal'` + `request_id` | 500 |
| BATCH_200 | `{platform:['reddit','pumpfun'], action:'search'}` mixed | `200 {success:true, mode:'sync', metadata{request_id, action, consumer_id, platforms:['reddit','pumpfun']}, results[], data:<concat completed>, preview}` | per-entry |
| EDGE_NONARRAY_RESULT | scrape trả object (`fetch_my_profile`) | `data:[result]`, `preview:[result]`, `result` mirror verbatim | N/A |
| EDGE_NULL_RESULT | scrape trả `null`/`undefined` | `data:[]`, `preview:[]`, `result:null` | N/A |
| EDGE_BAD_REQID | `X-Request-Id` chứa newline/>128 chars | Generate mới `req_*` (không honor header độc) | N/A |
| EDGE_STREAM_OFF | `REDIS_STREAM_ENABLED` unset | `stream:{enabled:false}` — không name/cursor | N/A |
| EDGE_STREAM_ON_NO_CURSOR | enabled + Redis down/empty | `stream:{enabled:true, name:'stream:social:raw_posts'}` omit cursor — không fail | N/A |
| EDGE_429_RESERVED | (chưa emit — 50.4) | `kind:'consumer_quota'` reserved trong enum, không code-path nào emit | N/A |
| EDGE_BFF_UNBOX | web `api()` nhận gateway envelope | `{success,data,mode,metadata}` KHÔNG bị unbox — `res.data` = full envelope | N/A |
| EDGE_NONSCRAPE_ERROR | route khác (không requestId) throw ApiError | errorMiddleware output giữ nguyên `{success:false,error:{code,message,type?,details?}}` — không field mới | unchanged |

</intent-contract>

## Code Map

- `api/services/gatewayEnvelope.js` — **NEW FILE, sole owner của contract shape**. Exports: `ERROR_KINDS` (frozen closed enum), `generateRequestId()`, `sanitizeRequestId(v)` (allowlist `[A-Za-z0-9_\-:.]` ≤128 → else null), `normalizeData(result)`, `buildMetadata({requestId,traceparent,platform,platforms,action,consumerId,durationMs,syncCapable,dryRun})` (snake_case fields, omit absent), `buildStreamBlock({withCursor})` (env gate + `defaultRedisStreamPublisher.streamKey` + best-effort XREVRANGE/XINFO last-id, async→no cursor), `successEnvelope({mode,metadata,stream,data,extra})` (→ `{success:true, ok:true, mode, metadata, stream, preview, data, ...extra}`), `errorBody({code,type,kind,message,status,requestId,retryable,retryAfterMs})` (→ `{success:false,error:{...}}`), `errorKind(type)` (**move từ scrapeDispatch.js:226** — giữ mapping hiện tại + callers import lại), `scrapeErrorKind(err)` (typed → `errorKind(err.type)`; untyped → `'upstream_error'`).
- `api/middleware/requestId.js` — **NEW FILE** `requestId(req,res,next)`: `req.requestId = sanitizeRequestId(req.get('x-request-id')) || generateRequestId()`; `req.traceparent = req.get('traceparent')` (verbatim khi string); `res.setHeader('X-Request-Id', req.requestId)`; `next()`. Không đọc body, không async.
- `api/middleware/envelope.js` — **EXTEND conditional**: `sendErrorEnvelope(res, {...}, req?)` hoặc `errorMiddleware` đọc `req.requestId` — khi truthy append vào `error` object: `kind` (err.kind || map err.type qua closed enum, default `'internal'`), `status` (=HTTP status), `request_id`, `retryable` (`isRetryableType(err.type)` || status∈{429,503} || err.isRetryable), `retry_after_ms` (khi retryable: `err.retryAfterMs` ?? `err.details?.retry_after_ms` ?? `RETRY_AFTER_DEFAULT_MS`). `req.requestId` absent → output y nguyên. serviceAuth 401 (`ApiError type:'auth'`) tự động được `kind:'auth'` vì requestId mw mount trước.
- `api/middleware/serviceAuth.js` — **VERIFY only**: 401/500 qua `next(ApiError)` — không đổi code; envelope mới đến từ errorMiddleware conditional path.
- `api/services/scrapeDispatch.js` — **EXTEND**: `dispatch({...args, requestId, traceparent})`; thread `requestId`/`traceparent`/startedAt vào outcome builders; `validationOutcome`/`unavailableOutcome`/`scrapeErrorOutcome` → `errorBody` shape (`validationOutcome`: status 400, retryable:false; `unavailableOutcome`: 503 + retryable:true + retry_after_ms + `Retry-After` header; `scrapeErrorOutcome`: `scrapeErrorKind(err)` + status err.statusCode||500 + retryable/retry_after_ms khi typed-retryable); `queuedOutcome`/`degradedOutcome`/`completed`/`batch top-level` → `successEnvelope` (queued/degraded: `data:[], preview:[], stream{enabled,name}` không cursor; completed: `data`,`preview`,`result` verbatim,`ok:true`,`stream` + cursor best-effort); batch: top-level envelope + `metadata.platforms[]` + aggregated `data`/`preview` + giữ `results[]`/`operationIds[]`; entry error + `retryable` khi derivable; `logGatewayLine` + `request_id` (thread qua mọi call site); `entryError`/`errorKind` import từ gatewayEnvelope.
- `api/routes/platform.js` — **PATCH**: mount `requestId` trước `eitherAuth` (`router.post('/:platform/scrape', requestId, eitherAuth, handler)`); 2 guard 400 (`action is required`, `accountIds` guards :435-460) → `errorBody` shape; catch block (:479-488) → `errorBody` (`scrapeErrorKind`, status, request_id, retryable khi 5xx/typed); truyền requestId/traceparent vào `dispatch()`.
- `src/utils/redis-stream-publisher.js` — **PATCH**: thêm `get streamKey()` public getter (đọc `#streamKey`) — envelope `stream.name` lấy từ đây (default `'stream:social:raw_posts'`).
- `apps/web/lib/api.ts` — **PATCH (bắt buộc, regression gate)**: `isEnvelope` unbox chỉ chạy khi KHÔNG phải gateway envelope — skip khi `'mode' in parsed || 'operationId' in parsed || 'metadata' in parsed`. Nếu không sửa: 202 `{data:[]}` unbox → `[]` → `isAsyncAccepted` fail → `pollOperation` chết (pumpfun page async path).
- `tests/gateway/unified-envelope.test.js` — **NEW**: contract tests theo matrix — envelope shape trên `reddit/search` (sync 200 qua `_setScrapeImpl`), `x/search` (default-async 202 — twitter không syncCapable), `pumpfun/fetch_coin_meta` (inert → 400 error envelope — assert error shape + kind enum); identical top-level keys; request_id inbound/gen/echo/sanitize; traceparent; stream on/off/cursor-omit; preview verbatim ≤10; non-array→`[r]`; 503 retryable+retry_after_ms+Retry-After; batch envelope+results+aggregated data; auth-401 kind:'auth'+request_id; non-gateway route unchanged (negative guard cho conditional middleware).
- `tests/web/scrape-poll.test.js` / `tests/web/api-envelope-guard.test.js` — **NEW/EXTEND**: api() không unbox khi `mode`/`metadata` present; pumpfun `scrape()` helper vẫn nhận đúng `env.result` trên envelope mới (regression D-1).
- `api/routes/platform.js:407-489` — handler hiện tại (post-50.2): validation/guards/catch cần migrate shape.
- `api/services/scrapeDispatch.js:174-275` — outcome builders hiện tại (`jsonOutcome`, `validationOutcome`, `unavailableOutcome`, `scrapeErrorOutcome`, `entryError`, `degradedOutcome`, `queuedOutcome`); `:909-951` sync-completed emit `{ok:true,result}`; `:1154-1161` batch top-level.
- `src/core/error-envelope.js` — `PlatformError`/`ErrorTypes`/`RETRYABLE_TYPES` (`isRetryableType` không export — export hoặc re-derive `err.isRetryable`/`retryAfterMs` từ instance fields; pin: dùng `err.isRetryable === true || RETRYABLE_TYPES.has(err.type)` qua import ErrorTypes).
- `api/services/jobQueue.js` — VERIFY only (202 path giữ nguyên).

## Tasks & Acceptance

**Execution:**
- [x] `api/services/gatewayEnvelope.js` -- CREATE -- toàn bộ builders + `ERROR_KINDS` + `errorKind` (move) + `scrapeErrorKind` + `generateRequestId`/`sanitizeRequestId` + `normalizeData` + `buildMetadata` + `buildStreamBlock` + `successEnvelope` + `errorBody`
- [x] `api/middleware/requestId.js` -- CREATE -- `requestId` middleware (req.requestId/req.traceparent/`X-Request-Id` res header)
- [x] `api/middleware/envelope.js` -- EXTEND -- conditional gateway fields trong `errorMiddleware`/`sendErrorEnvelope` khi `req.requestId` set (kind/status/request_id/retryable/retry_after_ms)
- [x] `api/services/scrapeDispatch.js` -- EXTEND -- thread requestId/traceparent; migrate mọi outcome builders sang envelope; `logGatewayLine` + request_id; entry error + retryable
- [x] `api/routes/platform.js` -- PATCH -- mount `requestId` trước `eitherAuth`; migrate guards + catch; pass requestId/traceparent vào dispatch
- [x] `src/utils/redis-stream-publisher.js` -- PATCH -- `get streamKey()` getter
- [x] `apps/web/lib/api.ts` -- PATCH -- unbox guard (`mode`/`operationId`/`metadata` → skip unbox)
- [x] `tests/gateway/unified-envelope.test.js` -- CREATE -- full matrix coverage (sync/async/degrade/error/batch/request-id/stream/preview)
- [x] `tests/web/` -- CREATE/EXTEND -- api() unbox guard + pumpfun helper regression

**Acceptance Criteria:**
- Given `POST /api/platform/reddit/scrape {action:'search'}` sync completes <1.5s, when response lands, then body là `{success:true, mode:'sync', metadata{request_id,platform,action,consumer_id,duration_ms,sync_capable,dry_run}, stream{enabled,...}, preview===data.slice(0,10), data:[...]}` — same keys trên mọi platform (CAP-4).
- Given `X-Request-Id: my-trace-9` inbound, when any `/scrape` response lands (kể cả 202/400/401/503), then `metadata.request_id`/`error.request_id` === `'my-trace-9'` VÀ response header `X-Request-Id` echo lại.
- Given không có `X-Request-Id`, when request lands, then `request_id` generated dạng `req_<ts>_<rand>` + header echo.
- Given inbound `traceparent` header, when response lands, then `metadata.traceparent` mang giá trị verbatim.
- Given `mode:'turbo'` (invalid), when request lands, then `400 {success:false, error:{code:'XACT_4001', kind:'validation', status:400, request_id, retryable:false}}`.
- Given Bearer invalid → serviceAuth fail, when request lands, then `401` với `error.kind==='auth'` + `request_id` (requestId mw chạy trước auth).
- Given sync scrape throw untyped Error, when error path, then `500` với `error.kind==='upstream_error'` + không raw stack leak.
- Given explicit async + enqueue infra fail, when dispatch returns, then `503` với `error{kind:'internal', retryable:true, retry_after_ms}` + `Retry-After` header.
- Given `platform:['reddit','pumpfun']` batch mixed outcome, when response lands, then `200` envelope đầy đủ + `results[]` (50.2 shape giữ) + `data` concat các entry completed + `metadata.platforms`.
- Given `REDIS_STREAM_ENABLED` unset, when sync response lands, then `stream:{enabled:false}`; khi set + Redis hiccup → `stream:{enabled:true, name}` không cursor, response vẫn 200.
- Given route KHÔNG qua requestId mw (vd `/api/ai/*` ApiError), when errorMiddleware emits, then body giữ nguyên `{success:false,error:{code,message,type?,details?}}` — zero field mới (regression guard envelope.test.js).
- Given web `api()` nhận `202 {success:true, mode:'async', operationId, data:[]}`, when parsed, then KHÔNG unbox — `isAsyncAccepted`/`pollOperation` hoạt động (regression gate D-1).
- Given `pumpfun/fetch_coin_meta` (inert tới 50.6), when contract test calls, then `400` error envelope giống shape mọi error khác — `kind:'validation'`, `request_id` present.

## Spec Change Log

## Review Triage Log

### 2026-09-27 — Review pass
- verdicts: 4 findings — high 0, medium 1, low 2, false 1, maybe-false 0
- findings:
  - `[false]` `[reject]` Intent alignment layer noted dual-emission of legacy fields (`ok`, `result`) as deviation from strict canonical envelope — intentional per spec Reading 2 (backward compatibility with in-repo apps/web pumpfun page).
  - `[low]` `[reject]` Traceparent validation is pass-through without strict W3C format regex verification — harmless since invalid strings are forwarded as-is and not evaluated.
  - `[low]` `[patch]` Variable name shadowing of `body` in `api/routes/platform.js:478` catch block — renamed to `errBody` for clarity and clean scope isolation.
  - `[medium]` `[defer]` Pre-existing failure in `tests/api/contract/session-cookie-shim.test.js` where `storedSession` returns undefined — verified pre-existing on baseline `431d07c0`, not caused by story 50.3 changes.

## Auto Run Result

- **Status**: done
- **Summary**: Implemented the unified AD-5 envelope and C-10 ErrorEnvelope for `POST /api/platform/:platform/scrape`. Added `requestId` middleware mounted before `eitherAuth` for end-to-end `X-Request-Id` and `traceparent` propagation. Migrated single, async, degraded, batch, and error responses to the canonical structure while maintaining transitional backwards compatibility for internal `apps/web` consumers via an unbox guard in `api.ts`.
- **Files Changed**:
  - `api/services/gatewayEnvelope.js` (NEW): Central definition of unified envelope shapes, closed `error.kind` enum, `normalizeData`, `buildMetadata`, `buildStreamBlock`, and request-id helpers.
  - `api/middleware/requestId.js` (NEW): Middleware capturing and generating `X-Request-Id` and `traceparent`.
  - `api/middleware/envelope.js`: Conditional extension to append contract fields (`kind`, `status`, `request_id`, `retryable`, `retry_after_ms`) when `req.requestId` is present.
  - `api/services/scrapeDispatch.js`: Migrated outcome descriptors to `successEnvelope` and `errorBody`, threaded `requestId` and `traceparent`, added `request_id` to `logGatewayLine`.
  - `api/routes/platform.js`: Mounted `requestId` before `eitherAuth`, mapped input validation guards and catch handler to `errorBody`.
  - `src/utils/redis-stream-publisher.js`: Added `streamKey` public getter.
  - `apps/web/lib/api.ts`: Added guard to prevent unboxing of gateway responses (`mode`/`operationId`/`metadata`).
  - `src/core/error-envelope.js`: Exported `isRetryableType`.
  - `tests/gateway/unified-envelope.test.js` (NEW): Exhaustive contract tests across all platforms and edge cases.
  - `tests/web/api-envelope-guard.test.js` (NEW): Regression tests for `api()` unbox guard.
  - `tests/gateway/mode-dispatch.test.js` & `tests/gateway/service-auth.test.js`: Updated assertions to match unified ErrorEnvelope.
- **Review Findings Breakdown**:
  - Patches applied: 1 (renamed shadowed `body` variable in route catch block).
  - Items deferred: 1 (pre-existing `session-cookie-shim.test.js` failure).
  - Rejected: 2 (intentional dual-emission mirror, non-breaking traceparent passthrough).
- **Follow-up Review Recommendation**: false (0 high, 0 medium patched; converged).
- **Verification Performed**:
  - `npx vitest run tests/gateway/unified-envelope.test.js tests/web/api-envelope-guard.test.js` → 39/39 passed.
  - `npx vitest run tests/gateway/mode-dispatch.test.js tests/gateway/service-auth.test.js tests/api/contract/envelope.test.js tests/web/scrape-poll.test.js` → 156/156 passed.


## Design Notes

- **Conditional middleware extension**: `errorMiddleware` chỉ append `kind/status/request_id/retryable/retry_after_ms` khi `req.requestId` truthy — request không qua gateway context thì output byte-identical. Đây là cách duy nhất để auth-fail (serviceAuth → `next(ApiError)`) mang đủ contract fields mà không fork serializer hay phá `envelope.test.js` `toEqual` asserts (lines 98,165).
- **Dual-emit `ok`/`result` trên sync-200**: `apps/web/app/pumpfun/page.tsx` `scrape()` đọc `env.result`; removing mirror = breaking in-repo consumer giữa epic. Mirror đánh dấu deprecated trong JSDoc, removal defer sang cleanup story sau khi web migrate sang `data`/`preview`.
- **`api.ts` unbox guard là bắt buộc, không optional**: thêm `data:[]` vào 202 body kích hoạt `isEnvelope` unbox → `res.data=[]` → async path của pumpfun page chết. Guard theo discriminator `mode`/`operationId`/`metadata` (canonical envelope `{success,data,page?}` không bao giờ có các key này).
- **`stream.cursor` = last-entry id post-completion**: consumer có thể `XREAD STREAMS <name> <cursor>` để lấy các event từ call này trở đi. Best-effort vì (a) stream publish là fire-and-forget của crawler — gateway không sở hữu emission timing; (b) Redis hiccup không được fail response. Async lane omit cursor: job chưa chạy, cursor vô nghĩa.
- **`kind` vs `type` dual-emit**: `type` là codebase taxonomy (`PlatformError.type`, ApiError.type); `kind` là contract enum C-10. Giữ cả hai (50.2 đã pin pattern này trong 400/202 bodies) — `type` chi tiết hơn, `kind` là retry-strategy discriminator.
- **`data` array-always + `result` verbatim**: AC pin `data:[]`; non-array result wrap `[r]` giữ `preview` slice semantics thống nhất; `result` mirror loại bỏ ambiguity singleton-object cho in-repo consumer.
- **Entry-level batch errors**: giữ `{code,kind,type,message}` + thêm `retryable` khi derivable — entries không phải HTTP response nên không có `status`/`request_id` (top-level request_id đủ cho trace).

## Verification

**Commands:**
- `npx vitest run tests/gateway/unified-envelope.test.js` — expected: all pass (envelope contract matrix)
- `npx vitest run tests/gateway/mode-dispatch.test.js tests/gateway/service-auth.test.js` — expected: all pass (50.1/50.2 regression — request_id/fields additive không phá contract cũ; **lưu ý**: các assert exact-shape cũ trên `{ok:true,result}` cần update sang superset match nếu fail — giữ assertion intent)
- `npx vitest run tests/api/contract/envelope.test.js` — expected: all pass (non-gateway byte-identical)
- `npx vitest run tests/web/` — expected: api() guard + scrape-poll pass
- `npm run worker` sanity optional — job processor path unchanged

**Manual checks:**
- `curl -i -X POST localhost:PORT/api/platform/reddit/scrape -H 'X-Request-Id: t1' ...` → `X-Request-Id: t1` response header + `metadata.request_id` match + morgan/logGatewayLine line có `request_id`.
