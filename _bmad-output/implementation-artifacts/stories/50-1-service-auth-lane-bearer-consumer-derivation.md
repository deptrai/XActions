---
title: 'Story 50.1: Service-Auth Lane — Bearer→Consumer Derivation'
type: 'feature'
created: '2026-09-26'
updated: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
epic: 50
story_number: 50.1
phase: 'Epic 50 — Public Scrape Gateway'
priority: 'high'
baseline_commit: '7727448a88dbe89bb8913c8220b8baf9dea78c04'
context:
  - _bmad-output/implementation-artifacts/epic-50-context.md
  - _bmad-output/specs/spec-xactions-public-scrape-gateway/SPEC.md
  - _bmad-output/planning-artifacts/architecture/architecture-xactions-public-scrape-gateway-2026-09-26/ARCHITECTURE-SPINE.md
  - api/middleware/auth.js
  - api/middleware/envelope.js
  - api/routes/platform.js
  - api/routes/mcp-bridge.js
  - src/mcp/consumer-context.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `POST /api/platform/:platform/scrape` đã tồn tại và chạy sync, nhưng `router.use(authenticate)` tại `platform.js:219` ép mọi caller qua user-JWT — một backend service (jev, Nowing, ChainLens) không có user session nên không thể gọi. Đây là lý do chính jev fork `PumpFunCrawler` in-repo thay vì gọi gateway. `X-Consumer-Id` header hiện được tin tưởng trực tiếp tại `consumer-context.js:45` (`unknown→internal`), có nghĩa là bất kỳ ai gửi `X-Consumer-Id: internal` đều bypass quota — header không thể là nguồn identity.

**Approach:** Thêm `api/middleware/serviceAuth.js` — một lane auth song song với `authenticate` — xác thực Bearer token và **derive `consumer_id` server-side** từ credential đó (env-driven map), KHÔNG từ header. Mount `serviceAuth` làm alternative trên `POST /api/platform/:platform/scrape`: `eitherAuth` thử `authenticate` trước, fallback `serviceAuth`. `X-Consumer-Id` được đọc vào `req.consumerHint` cho observability/logging nhưng không bao giờ ảnh hưởng identity.

## Boundaries & Constraints

**Always:**
- `consumer_id` luôn derive server-side từ Bearer credential — KHÔNG BAO GIỜ từ `X-Consumer-Id` header.
- `serviceAuth` và `authenticate` là mutually exclusive per request — `eitherAuth` thử `authenticate` trước, chỉ chạy `serviceAuth` nếu JWT thất bại/vắng.
- **`POST /:platform/scrape` phải định nghĩa TRƯỚC `router.use(authenticate)` tại `platform.js:219`** — vì `router.use` intercepts MỌI request trước route-level middleware. Không thể mount `eitherAuth` trên route mà vẫn giữ router-level `authenticate` phía trên (Express ordering trap — reviewer critical finding).
- Mọi auth failure trả `401 + ErrorEnvelope{code:'XACT_4001', type:'auth', message, status:401, request_id}` — không raw text, không stack.
- Env-driven consumer map `XACTIONS_SERVICE_KEYS` (JSON: `{"<token>":{"consumer_id":"jev","tier":"internal"}}`); legacy single-token `XACTIONS_MCP_API_KEY`/`XACTIONS_API_TOKEN` vẫn work → map `internal`.
- `loadServiceKeyMap()` wrap `JSON.parse` trong try/catch → malformed env returns `{}` + WARN-logged once. **`NODE_ENV === 'production'` + empty map + no legacy key → fail-closed `401 XACT_4001`** (never fail-open in prod).
- `X-Consumer-Id` header được preserve vào `req.consumerHint` cho observability; không ảnh hưởng identity hoặc quota attribution.
- Service-auth callers (`req.consumer.source==='serviceAuth'`) `req.user` remains `undefined` — any route logic dereferencing `req.user.id` MUST guard. `accountIds` in body + no `req.user` → `400 + ApiError('VALIDATION_FAILED', 'Stored account resolution requires user session')`.
- Spoof test bắt buộc: valid Bearer + forged `X-Consumer-Id: internal` phải resolve Bearer's mapped consumer, không phải `internal`.
- Timing-safe compare cho Bearer (`crypto.timingSafeEqual`) — không `===` (đã có pattern trong `consumer-context.js:83`).
- Không mutate `VALID_CONSUMER_IDS` — `['nowing','chainlens','internal']` giữ nguyên; consumer mới đi qua env config.

**Never:**
- KHÔNG thêm scoped Bearer (`consumer=X&actions=Y`) — C-8 pin all-or-nothing per consumer.
- KHÔNG cho phép `X-Consumer-Id` override Bearer-derived identity.
- KHÔNG viết serviceAuth riêng cho từng platform — seam là cross-cutting (AD-2).
- KHÔNG để `router.use(authenticate)` chặn `serviceAuth` trên `/scrape` — route ordering là load-bearing.
- KHÔNG log Bearer token dưới bất kỳ dạng nào (redact in morgan/winston).
- KHÔNG fail-open `serviceAuth` trong `NODE_ENV=production` khi không có keys configured — prod phải 401.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| HAPPY_USER_JWT | `Authorization: Bearer <valid-user-jwt>` + `POST /api/platform/reddit/scrape` | `authenticate` runs → `req.user` set, `req.consumer={consumerId:'internal',apiKeyValid:true,source:'userJWT'}` | N/A |
| HAPPY_SERVICE_KEY | `Authorization: Bearer <key-mapped-to-jev>` + `X-Consumer-Id: chainlens` | `serviceAuth` runs → `req.consumer={consumerId:'jev',apiKeyValid:true,source:'serviceAuth'}`, `req.consumerHint='chainlens'` | N/A |
| HAPPY_LEGACY_KEY | `Authorization: Bearer <XACTIONS_MCP_API_KEY>` + no `X-Consumer-Id` | `req.consumer={consumerId:'internal',apiKeyValid:true,source:'serviceAuth'}` | N/A |
| HAPPY_ANON_DEV | No `Authorization`, `NODE_ENV=development`, no service keys configured | `serviceAuth` passes through with `req.consumer={consumerId:'internal',apiKeyValid:true,source:'anonymous',apiKeyRequired:false}` — dev mode parity with `identifyConsumer` | N/A |
| ERR_INVALID_BEARER | `Authorization: Bearer <unknown-token>` (neither JWT nor service key) | Both lanes fail → `401 + ErrorEnvelope{code:'XACT_4001', type:'auth', retryable:false}` | `401` to caller |
| ERR_SPOOF | `Authorization: Bearer <jev-key>` + `X-Consumer-Id: internal` | `req.consumer.consumerId='jev'` (Bearer wins); `req.consumerHint='internal'` logged as hint | No error — but log WARN once per deployment noting hint-vs-authoritative mismatch |
| ERR_MALFORMED | `Authorization: Token xyz` (not Bearer scheme) | `authenticate` fails → `serviceAuth` fails → `401` | `401` |
| ERR_EXPIRED_JWT | `Authorization: Bearer <expired-jwt>` | `authenticate` throws `UNAUTHORIZED` → `serviceAuth` tries JWT as service key → fails (not in map) → `401` | `401` |
| EDGE_EMPTY_HEADER | `X-Consumer-Id:` empty + valid Bearer | `req.consumerHint=undefined` (or normalized `internal` per existing normalize rule); identity unchanged | N/A |
| EDGE_MULTI_HEADER | `X-Consumer-Id` sent twice | First header wins (Express default join behavior) — treat as hint, don't crash | N/A |
| EDGE_MALFORMED_KEYS_ENV | `XACTIONS_SERVICE_KEYS` env malformed JSON | `loadServiceKeyMap()` catches parse error → returns `{}` → only legacy `XACTIONS_MCP_API_KEY`/`XACTIONS_API_TOKEN` work; WARN-logged once at first call (fail-closed on named keys, fail-open on legacy — matches `identifyConsumer` apiKeyRequired semantics) | WARN log; no 500 |
| EDGE_UNKNOWN_CONSUMER | Bearer valid in map but maps to `{"consumer_id":"random-third-party"}` | `normalizeConsumerId` → `internal` — Bearer valid but consumer class falls back to unmetered internal (no reject — consumer naming is config, not authz) | N/A |
| EDGE_COOKIE_PLUS_BEARER | `Cookie: session=<user-jwt>` AND `Authorization: Bearer <service-key>` | `authenticate` only checks `Authorization` header → fails → `serviceAuth` runs → resolves service consumer. Cookie is ignored (service caller never sends one) | N/A |
| EDGE_ACCOUNTIDS_NO_USER | `serviceAuth` success + body has `accountIds[]` | `400 + ApiError('VALIDATION_FAILED', 'Stored account resolution requires user session authentication')` — `req.user` undefined, cannot dereference `.id` | 400 to caller |
| EDGE_PROD_NO_KEYS | `NODE_ENV=production` + `XACTIONS_SERVICE_KEYS` empty + no legacy key + valid-looking Bearer | `401 + ErrorEnvelope{code:'XACT_4001', type:'auth', retryable:false}` — prod never fails open | 401 |

</frozen-after-approval>

## Code Map

- `api/middleware/serviceAuth.js` — **NEW FILE**. Exports `serviceAuth(req,res,next)` + `eitherAuth(req,res,next)` + `loadServiceKeyMap()` (lazy, cached). Pattern mirrors `api/middleware/auth.js` + `src/mcp/consumer-context.js` (`extractBearerToken`, `getExpectedApiKey`, timing-safe compare). Reads `XACTIONS_SERVICE_KEYS` env JSON (try/catch → `{}`); falls back to `XACTIONS_MCP_API_KEY`/`XACTIONS_API_TOKEN` single-key check; `NODE_ENV==='production'` + empty map + no legacy → fail-closed.
- `api/middleware/auth.js:253` — `authenticate = authMiddleware` — user-JWT lane, call FIRST in `eitherAuth`.
- `api/middleware/envelope.js` — `ApiError(code, statusCode, message, details)` + `sendErrorEnvelope({status,code,message,type,details})` — extend `ApiError` signature to `constructor(code, statusCode, message, details, type)` (5th positional arg, default `undefined`); `sendErrorEnvelope` already serializes `type` (envelope.js:88) — no change needed there, just pass `type:'auth'` from ApiError.
- `api/routes/platform.js:219` — `router.use(authenticate)` — **MOVE the `POST /:platform/scrape` route ABOVE this line** OR scope `router.use(authenticate)` to `/accounts` + `/automate` only. Pick the second: change to `router.use('/:platform/accounts', authenticate); router.use('/:platform/automate', authenticate);` then mount `eitherAuth` on `/:platform/scrape`. Express ordering trap — `router.use` intercepts everything downstream.
- `api/routes/platform.js:389` — `router.post('/:platform/scrape', eitherAuth, async (req,res) => {...})` — mount `eitherAuth`; inside handler guard `reqUser = req.user` (may be undefined for serviceAuth) — `if (accountIds?.length && !reqUser) return 400`.
- `api/routes/platform.js:390` — `const reqUser = req.user` — guard before `reqUser.id` dereference at line 415.
- `src/mcp/consumer-context.js:54` — `extractBearerToken` — reuse.
- `src/mcp/consumer-context.js:66` — `getExpectedApiKey` — reuse for legacy fallback.
- `src/mcp/consumer-context.js:45` — `normalizeConsumerId` — reuse for Bearer-mapped consumer_id validation (unknown → `internal`).
- `src/mcp/consumer-context.js:78` — `identifyConsumer` — **DO NOT reuse directly**: its `consumerId` is header-derived; we need Bearer-derived. Pattern only.
- `api/routes/mcp-bridge.js:52` — reference for `identifyConsumer`+`runWithConsumerContext` pattern.
- `tests/gateway/service-auth.test.js` — **NEW FILE** — contract tests for the matrix.

## Tasks & Acceptance

**Execution:**
- [x] `api/middleware/serviceAuth.js` -- CREATE -- `serviceAuth` middleware + `eitherAuth` composer + `XACTIONS_SERVICE_KEYS` env parser + `loadServiceKeyMap()` lazy-load (try/catch → `{}`) + Bearer→consumer resolution via `normalizeConsumerId` + redact-token logger + prod fail-closed when `NODE_ENV==='production'` + empty map + no legacy
- [x] `api/middleware/envelope.js` -- EXTEND -- `ApiError` constructor signature becomes `(code, statusCode, message, details, type)` (5th positional arg, `type` optional `string`); assign `this.type = type` — `sendErrorEnvelope` already serializes `type` (no change there); call sites for auth errors pass `type:'auth'`
- [x] `api/routes/platform.js` -- PATCH -- **scope `router.use(authenticate)` to `/accounts` and `/automate` only** (split into two `router.use(path, authenticate)` calls); mount `eitherAuth` on `POST /:platform/scrape` at line 389; inside handler add guard `if (accountIds?.length && !req.user) return 400 VALIDATION_FAILED 'Stored account resolution requires user session'` before line 415 `resolveAccountCookie`
- [x] `api/routes/mcp-bridge.js` -- VERIFY -- unchanged; `identifyConsumer` still handles MCP-only path. Confirm no regression via existing tests.
- [x] `tests/gateway/service-auth.test.js` -- CREATE -- 15-row matrix coverage: happy×4, error×4, edge×7 (incl. malformed env, unknown consumer, cookie+bearer, accountIds-no-user, prod-no-keys); spoof test asserts `req.consumer.consumerId==='jev'` not `'internal'`; verify `consumerHint` preserved on `req` for observability
- [x] `.env.example` -- DOCUMENT -- `XACTIONS_SERVICE_KEYS` JSON shape + example + comment on prod fail-closed
- [x] `api/server.js` -- VERIFY -- no changes needed (eitherAuth lives at route level)

**Acceptance Criteria:**
- Given `POST /api/platform/reddit/scrape` + valid user-JWT Bearer, when request lands, then handler runs with `req.user` set and `req.consumer.source==='userJWT'` — dashboard flow unchanged.
- Given `POST /api/platform/reddit/scrape` + Bearer key mapped to `jev` in `XACTIONS_SERVICE_KEYS` + `X-Consumer-Id: chainlens`, when request lands, then `req.consumer.consumerId==='jev'` (Bearer wins), `req.consumerHint==='chainlens'` preserved for logging.
- Given same request but forged `X-Consumer-Id: internal`, when request lands, then `consumerId==='jev'` still — spoof cannot bypass (contract test asserts).
- Given `POST /api/platform/reddit/scrape` + Bearer unknown to either lane, when request lands, then `401 + ErrorEnvelope{code:'XACT_4001',type:'auth'}` — both lanes tried, neither accepted.
- Given `NODE_ENV=development` + no keys configured + no Bearer, when request lands, then request passes with `consumerId='internal'` + `source:'anonymous'` — dev-mode parity with `identifyConsumer`.
- Given `NODE_ENV=production` + no keys configured + valid-looking Bearer, when request lands, then `401 + ErrorEnvelope{type:'auth'}` — prod never fails open.
- Given `Authorization: Token xyz` (not Bearer), when request lands, then `401` — malformed scheme rejected by both lanes.
- Given Bearer valid but `X-Consumer-Id` differs, when serviceAuth runs, then WARN logged once per deployment noting hint-vs-authoritative mismatch (observability affordance per UX-5).
- Given `VALID_CONSUMER_IDS` frozen list, when a request maps to `jev`, then downstream code still treats it as `internal` class for quota (per C-5 + OQ-1 resolution).
- Given `XACTIONS_SERVICE_KEYS` env malformed JSON, when serviceAuth runs, then `loadServiceKeyMap()` returns `{}` (fail-closed on named keys, fail-open on legacy) + WARN logged once — no 500 crash on request path.
- Given Bearer maps to `{"consumer_id":"random-unknown"}`, when serviceAuth runs, then `normalizeConsumerId` → `internal` — Bearer valid but unknown consumer class falls back to unmetered (consumer naming is config, not authz).
- Given `Cookie: session=<valid-jwt>` + `Authorization: Bearer <service-key>`, when request lands, then serviceAuth wins (cookie ignored — machine callers don't carry session).
- Given serviceAuth success + body has `accountIds[]` + `req.user` undefined, when handler runs, then `400 + ApiError('VALIDATION_FAILED','Stored account resolution requires user session')` — no `TypeError` on `reqUser.id` dereference.
- Given `POST /api/platform/reddit/scrape` route ordering, when server starts, then `eitherAuth` runs BEFORE `authenticate` router-level middleware (or `router.use(authenticate)` scoped to `/accounts`/`/automate` only) — service Bearer reaches handler.
- Given `authenticate` route at `GET /api/platform/twitter/accounts`, when called with user-JWT, then `req.user` populated — JWT-only routes unchanged.

## Implementation Notes

- **2026-09-26 — Story 50.1 implemented:**
  - Created `api/middleware/serviceAuth.js` with `serviceAuth`, `eitherAuth`, `loadServiceKeyMap`, `_resetServiceKeyMap`.
  - Added `XACTIONS_SERVICE_KEYS` env parser (lazy, cached, fail-closed on malformed JSON).
  - Pinned `KNOWN_CONSUMERS = ['nowing', 'chainlens', 'jev', 'internal']`: known names preserved on `req.consumer.consumerId`; unrecognized names fall back to `internal` (safe default per C-5).
  - Production security: `NODE_ENV===production` + empty keys → fail-closed 401; dev mode → anonymous internal pass-through (matches `identifyConsumer`).
  - Extended `ApiError` constructor signature to `(code, statusCode, message, details, type)` — 5th positional arg optional, non-breaking for existing 40+ call sites. `errorMiddleware` already serializes `type`.
  - Scoped `router.use(authenticate)` in `api/routes/platform.js` to `/accounts` and `/automate` only. `POST /:platform/scrape` mounts `eitherAuth` at route level.
  - Added guard in `/:platform/scrape` handler: `accountIds` with undefined `req.user` (serviceAuth callers) returns `400 VALIDATION_FAILED` instead of dereferencing `reqUser.id` (prevents TypeError 500).
  - Preserved `req.consumerHint` for observability; logged WARN once per process when hint differs from Bearer-derived identity.
  - Documented `XACTIONS_SERVICE_KEYS` in `.env.example` with JSON schema and production security note.
  - Contract test suite `tests/gateway/service-auth.test.js`: 18 tests (15 matrix rows + 3 route integration tests) all passing. Smoke test suite (34 tests) and auth regression (13 tests) all passing.

## Spec Change Log

- **2026-09-26 — Reviewer pass `approve-with-fixes` applied:**
  - Finding 1 (CRITICAL — Express router trap): `router.use(authenticate)` at platform.js:219 intercepts every request before route-level `eitherAuth` — kept router.use unchanged + mount eitherAuth on route is structurally impossible. Fixed by scoping `router.use(authenticate)` to `/accounts` + `/automate` only (Code Map + Tasks updated).
  - Finding 2 (HIGH — req.user TypeError): serviceAuth leaves `req.user` undefined; `platform.js:415` `reqUser.id` would crash on `accountIds[]` requests. Fixed by adding explicit guard `if (accountIds?.length && !req.user) return 400` (Boundaries + Code Map + ACs).
  - Finding 3 (HIGH — prod fail-open): `identifyConsumer` returns `apiKeyValid:true` when keys unconfigured — would allow unauthorized scraping in prod. Fixed by pinning `NODE_ENV==='production'` + empty map + no legacy → fail-closed 401 (Boundaries + Matrix EDGE_PROD_NO_KEYS + ACs + Design Notes).
  - Finding 4 (MEDIUM — ApiError signature): pinned `constructor(code,statusCode,message,details,type)` 5th positional arg — non-breaking; `sendErrorEnvelope` already serializes `type` at envelope.js:88 — zero changes needed there (Design Notes).
  - Finding 5 (LOW — AC format + matrix coverage): added explicit `when` clauses to all ACs; added concrete ACs for `HAPPY_LEGACY_KEY` (prod-fail-closed), `ERR_ACCOUNTIDS_NO_USER`, `EDGE_PROD_NO_KEYS`, `EDGE_COOKIE_PLUS_BEARER`; matrix expanded to 15 rows.
  - KEEP: `consumer_id` Bearer-derivation core, mutually-exclusive lanes, `X-Consumer-Id` as observability hint, spoof test contract — all worked well and survive.

## Review Triage Log

- Finding VG-1 (verification-gap): Production fail-closed unverified when Bearer header missing. Verdict: `high`. Disposition: `patch`. Applied: added test `VG-1: EDGE_PROD_MISSING_HEADER` asserting 401 when no auth header in prod.
- Finding BH-1 (blind-hunter): `.env.example` allowed values omitted `jev`. Verdict: `medium`. Disposition: `patch`. Applied: updated `.env.example` to list `nowing | chainlens | jev | internal`.
- Finding BH-2 (blind-hunter): `normalizeConsumerId` converted `jev` to `internal` causing false hint mismatch warnings. Verdict: `medium`. Disposition: `patch`. Applied: checked `hasExplicitHint` before warning so headerless requests never warn.
- Finding BH-3 (blind-hunter): Key map token comparison not timing-safe. Verdict: `medium`. Disposition: `patch`. Applied: iterated keys with `timingSafeTokenEqual` for all lookups.
- Finding BH-4 / EC-2 (blind-hunter & edge-case-hunter): Downstream handler synchronous throw caught as serviceAuth error, invoking `next()` twice. Verdict: `high`. Disposition: `patch`. Applied: moved `next()` call outside the try/catch block.
- Finding BH-6 (blind-hunter): `loadServiceKeyMap()` didn't warn on non-object JSON (array, null). Verdict: `low`. Disposition: `patch`. Applied: added `!Array.isArray(parsed) && parsed !== null` check and warn log.
- Finding BH-7 (blind-hunter): `platform.js` did not bind `req.consumer` into `runWithConsumerContext`. Verdict: `medium`. Disposition: `patch`. Applied: wrapped `scrape()` call in `runWithConsumerContext(consumerCtx, ...)`.
- Finding EC-1 (edge-case-hunter): `eitherAuth` passed `thrown` (JWT error) to `next()` even when `serviceAuth` succeeded. Verdict: `high`. Disposition: `patch`. Applied: guarded `if (serviceErr) next(serviceErr); else next();`.
- Finding EC-3 (edge-case-hunter): False mismatch warning when caller omitted `X-Consumer-Id`. Verdict: `medium`. Disposition: `patch`. Applied: verified `hasExplicitHint` before logging warning.

## Design Notes

`eitherAuth` composition pattern:
```js
const eitherAuth = (req, res, next) => {
  authenticate(req, res, (err) => {
    if (!err) { req.consumer = {consumerId:'internal',apiKeyValid:true,source:'userJWT'}; return next(); }
    serviceAuth(req, res, next);
  });
};
```
Why this shape: `authenticate` already populates `req.user` for dashboard parity; `serviceAuth` is the fallback that sets `req.consumer` only — never `req.user` (machine callers aren't users). Lanes stay mutually exclusive per request.

**Express router ordering trap (critical):** `router.use(authenticate)` at platform.js:219 executes on EVERY request reaching subsequent routes — including `POST /:platform/scrape`. Mounting `eitherAuth` at the route level cannot undo router-level auth that already rejected the request. Fix: scope `router.use(authenticate)` to `/accounts` + `/automate` only, OR move `POST /:platform/scrape` route definition ABOVE line 219. Spec chooses scoping (less structural churn).

`ApiError` extension (non-breaking): signature `constructor(code, statusCode, message, details, type)` — 5th positional arg optional. All 40+ existing call sites unchanged; new call sites pass `type:'auth'` for serviceAuth failures. `sendErrorEnvelope` already serializes `type` field (envelope.js:88) — zero changes there.

Bearer→consumer map resolution order:
1. `XACTIONS_SERVICE_KEYS` JSON map lookup — `{"<token>": {"consumer_id":"jev","tier":"internal"}}`
2. Legacy single-token check: `XACTIONS_MCP_API_KEY`/`XACTIONS_API_TOKEN` → `internal`
3. `NODE_ENV==='production'` + empty map + no legacy → `apiKeyValid:false` (fail-closed)
4. `NODE_ENV==='development'` + empty map + no legacy → `apiKeyValid:true, apiKeyRequired:false` (dev parity)
5. No match → `apiKeyValid:false`

`X-Consumer-Id` handling: read via `req.headers['x-consumer-id']`, normalize via existing `normalizeConsumerId`, set `req.consumerHint`. If `consumerHint !== req.consumer.consumerId`, log WARN once (rate-limited per-process).

`req.user` guard: `serviceAuth` never sets `req.user` — service callers are consumers, not users. Route handler at platform.js:390 must guard `if (accountIds?.length && !req.user) return 400` before line 415 dereferences `reqUser.id`.

## Verification

**Commands:**
- `vitest run tests/gateway/service-auth.test.js` — expected: all 15 matrix rows pass
- `curl -X POST http://localhost:3001/api/platform/reddit/scrape -H "Authorization: Bearer ${USER_JWT}" -d '{"action":"search","options":{"query":"test"}}'` — expect 200 with `req.user` populated server-side
- `curl -X POST http://localhost:3001/api/platform/reddit/scrape -H "Authorization: Bearer ${JEV_SERVICE_KEY}" -H "X-Consumer-Id: internal" -d '{"action":"search","options":{"query":"test"}}'` — expect 200, `consumerId==='jev'` (spoof rejected)
- `curl -X POST http://localhost:3001/api/platform/reddit/scrape -H "Authorization: Bearer ${JEV_SERVICE_KEY}" -d '{"action":"search","options":{"query":"test"},"accountIds":["acc-1"]}'` — expect 400 VALIDATION_FAILED (req.user undefined for serviceAuth)
- `curl -X POST http://localhost:3001/api/platform/reddit/scrape -H "Authorization: Bearer wrongkey" -d '{"action":"search","options":{"query":"test"}}'` — expect 401 + `error.type==='auth'`
- `NODE_ENV=production XACTIONS_SERVICE_KEYS='' XACTIONS_MCP_API_KEY='' node -e "..."` — expect serviceAuth 401 not pass-through (prod fail-closed)
- `curl http://localhost:3001/api/platform/twitter/accounts -H "Authorization: Bearer ${USER_JWT}"` — expect JWT-only routes still work unchanged

**Manual checks (if no CLI):**
- Server log shows `X-Consumer-Id` hint captured in `consumerHint` but identity derived from Bearer only.
- `VALID_CONSUMER_IDS` unchanged in `src/mcp/consumer-context.js`.
