---
title: 'Story 46.2 — Zod Schemas & Uniform Response Envelopes (Foundation + Pilot)'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '666e5bfc09a9e079e5ccc90c56f5e4a3fca323a3'
route: 'dispatch'
review_loop_iteration: 1
context:
  - _bmad-output/implementation-artifacts/epic-46-context.md
  - _bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Mỗi route tự trả response theo kiểu riêng (~6 idioms: `{error:string}`, `{errors:[]}`, `{success:false,error:'CODE'}`, nested `suggestedAction`...) và không có request validation thống nhất — spec OpenAPI không thể là source of truth khi runtime nói dối nó.

**Approach:** Xây nền contract layer: `api/schemas/**` (Zod 4) là source of truth cho validation + spec generation; `api/middleware/validate.js` chạy sau authenticate; `api/middleware/envelope.js` expose `res.sendData(t)`/`res.sendPage()` và sở hữu error/404 serialization; registry→spec builder merge section `/api/ai` literal (đã qua normalization pass); CI lint + contract test chống drift.

**Scope decision (2026-09-24):** Story này giao **foundation + pilot mounts** `/api/viral`, `/api/crm`, `/api/optimizer`, `/api/checkpoints`, `/api/session`, `/api/auth`. Rollout ~40 mounts còn lại thuộc Stories 46.4 (social/user-facing) và 46.5 (data/ops/admin) — Epic 46 đã amend tương ứng.

## Boundaries & Constraints

**Always:**
- Thứ tự per-route: `authenticate (scheme đã khai báo) → validate → handler`. Không global JWT gate — `/api/ai/*` qua `x402Payment`.
- **Không wrap `res.json`.** `envelope.js` chỉ thêm `res.sendData(t)` → `{success:true,data:T}` và `res.sendPage(items,page)` → `PaginatedResponse<T>` `{success:true,data:T[],page:{cursor:string|null,limit,total?}}`, cộng error middleware + 404 emit `{success:false,error:{code,message,type?,details?}}`. Pilot handlers đổi sang `sendData`/throw; legacy `res.json` ở mounts khác giữ nguyên shape đến 46.4/46.5.
- Express 4 không forward async throws → error path dùng `next(err)` hoặc wrapper `asyncHandler` trong pilot routes.
- `PlatformError` detect qua `instanceof PlatformError` → `error.code`/`type`/`message` từ domain, `error.details` = `toEnvelope()` verbatim (không allowlist), status từ `statusCode`. Non-domain errors → `ApiError(code,statusCode,message,details?)` (class mới trong envelope.js); taxonomy: `VALIDATION_FAILED` 400, `INVALID_JSON` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `RATE_LIMITED` 429, `PAYLOAD_TOO_LARGE` 413, `UNSUPPORTED_MEDIA_TYPE` 415, `INTERNAL` 500.
- Middleware-originated errors emit envelope **toàn server**: rate-limit `handler` option (tất cả 7 limiters), body-parser `err.type==='entity.*'` (`entity.parse.failed`→`INVALID_JSON`, `entity.too.large`→`PAYLOAD_TOO_LARGE`), 404 handler, auth errors (`auth.js`, `requireAdmin`, `checkUsageLimit` — extras `requiredTier`/`upgradeUrl`/`limit`/`used` map vào `error.details`), `ai-detector` 403s, `x402.js` 500/503 config errors.
- **sessionCookie shim semantics:** middleware `sessionCookieShim` mount per-route cùng chỗ `validate` được khai báo scheme `sessionCookie`. Nó copy `body.sessionCookie` → `req.headers['x-session-cookie']` **chỉ khi header vắng** (body precedence hiện tại được giữ — `viral.js:38` đọc body trước), **không xóa** body field. `POST /api/session/save-session` có `sessionCookie` là payload → không mount shim, body schema validate nó làm string.
- sessionCookie scheme trên pilot = transport normalization + headers schema require `x-session-cookie`; việc kiểm chứng session thật nằm nguyên chỗ cũ (in-handler), story này không thêm auth gate mới.
- Security schemes trong spec: `bearerAuth`, `sessionCookie` (apiKey header `x-session-cookie`), `x402Payment`, **`a2aApiKey`** (apiKey header `X-Agent-API-Key` — cho `checkpoints` `requireCheckpointManage` nhận X-Agent-API-Key/A2A bearer/admin JWT), optional-auth `[{}, {scheme}]` (token sai → anonymous context, không 401).
- Request schemas **không** `.strict()` — strip unknown keys; urlencoded bodies validate all-strings (dùng `z.coerce` khi cần); empty-body POST → `{}` → schema quyết định.
- Bảo toàn x402: `x-payment-info`, `x-bazaar`, `x-x402`, `securitySchemes.x402Payment`, `/.well-known/x402`; `402` body là `PaymentRequired` payload do `@x402/express` SDK emit (không envelope). x402 gate chạy trước routers là behavior hiện hữu — giữ nguyên.
- **Spec merge model:** `generateSpec()`/`generateWellKnown()` export signatures giữ nguyên (callers: `server.js`, `serverless.js`, `worker/index.js`, `x402-discovery.js`). Builder = literal `/api/ai` section + registry paths (populate qua `api/schemas/index.js` barrel — openapi.js import barrel, route files import schema objects riêng cho validate). Merge **normalization pass** trên literal: strip `sessionCookie` khỏi requestBody props, backfill `operationId` deterministic `{method}_{path}` cho op thiếu, re-point `Error`/`SuccessResponse` refs sang canonical components. Builder throw khi `method+path` collision giữa registry và literal. Generated ops luôn emit `security` riêng (global `security:[{x402Payment}]` chỉ còn govern literal ops). `servers` = localhost + production; `info.version` → `2.0.0`.
- Exempt khỏi validate+envelope: `/webhooks/*`, streaming/SSE/binary/redirect (`/api/video/download`...), `/api/plugins/*`. Exempt routes không gọi `sendData` — streams untouched.
- ⚠️ inventory rows = spec-only: `/api/ai/*` giữ in-route validation, không re-author Zod.
- `serverless.js`: thêm envelope error middleware + 404 + authLimiter `handler`; `x402Gate` 402 empty-body giữ nguyên (contract riêng của nó).

**Never:**
- Không re-author spec `/api/ai` bằng Zod; không sửa `ALL_PAID_RESOURCES`/`generateWellKnown()` output shape.
- Không đụng `x402Middleware` payment flow; không wrap `res.json`/`res.send` global.
- Không áp validate cho mounts ngoài pilot list; không thêm `cookie-parser`; không xóa `req.body.sessionCookie`.
- Không `.strict()` request schemas; không drop field khỏi `toEnvelope()`; không sửa semantic `paths` của literal bằng tay (normalization pass thuộc builder code).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Happy validated POST | Pilot route có schema, body hợp lệ | `res.sendData(t)` → `{success:true,data:T}` | N/A |
| Validation fail | Body/query/param/declared header sai | `400` `VALIDATION_FAILED`, `details` = zod issues | validate.js `next(ApiError)` |
| Malformed JSON | Body không parse được | `400` `INVALID_JSON` | entity.parse.failed → envelope |
| Legacy body sessionCookie | Route scheme=`sessionCookie`, chỉ `body.sessionCookie` | Shim copy→header, body giữ nguyên; handler đọc body vẫn pass | N/A |
| Both transports | `body.sessionCookie` + `x-session-cookie` header khác nhau | Header có sẵn → shim no-op; **body wins** trong dual-read handlers (precedence hiện tại) | N/A |
| Payload sessionCookie | `POST /api/session/save-session` | Không shim; body schema require `sessionCookie` string | 400 VALIDATION_FAILED nếu thiếu |
| Domain error | Handler `next(new RateLimitError(...))` | `error.details` = đủ `toEnvelope()` fields; status 429 | envelope.js |
| Auth extras | `requireSubscription` fail | `403` `FORBIDDEN`/`SUBSCRIPTION_REQUIRED`, `details`={requiredTier,currentTier,upgradeUrl} | auth.js throw ApiError |
| Rate limit | Bất kỳ limiter nào trip | `429` `RATE_LIMITED` envelope (thay plain-text/`{error:string}`) | `handler` option |
| Route not found | Unknown path | `404` `NOT_FOUND` envelope (server.js + serverless.js) | 404 handler |
| Body too large | >10kb | `413` `PAYLOAD_TOO_LARGE` | entity.too.large |
| Optional auth | Union security, token sai | anonymous context, không 401 | optionalAuthMiddleware |
| x402 paid | `/api/ai/*` thiếu payment | `402` PaymentRequired SDK shape — không đổi | x402Middleware |
| Offset pagination | `GET /api/checkpoints?limit&offset` | Request giữ `offset` (compat); response `data:T[]` + `page:{cursor:opaqueOffsetToken,limit,total?}` | envelope.sendPage |

</frozen-after-approval>

## Code Map

- `api/server.js` — helmet(126)→compression(144)→cors(155)→7 limiters(163-221)→morgan(235)→10kb parsers(238-242)→aiDetector(245)→x402(248)→routers→error mw(694-710)→404 `app.use`(713-715). `export default app`(836), listen gated test. Wire: envelope mw + shim đặt **trước body parsers** (để `res.sendData` tồn tại kể cả khi parser throw) hoặc error middleware tự emit không qua helper — chọn error middleware emit trực tiếp.
- `api/middleware/auth.js` — JWT-only: `authenticate`/`authMiddleware`(:29), `optionalAuthMiddleware`(:79), `requireSubscription`(:152-157 extras), `checkUsageLimit`(:208-214 extras), `requireAdmin`(:233/:237). Rewrite emits → `next(ApiError)` với extras vào `details`.
- `api/middleware/x402.js` — scope `/api/ai`,`/api/scripts`(:333); 402 do SDK emit — không đụng; 500/503 flat (:357,:382) → `next(ApiError('INTERNAL'/'PAYMENT_UNAVAILABLE'))`.
- `api/middleware/ai-detector.js` — `requireAIAgent`/`requireHuman` 403 (:234,:251) → envelope.
- `src/core/error-envelope.js` — `toEnvelope()`(:95-111): `code,type,message,statusCode,isRetryable,retryAfterMs,retryAfter,suggestedAction,accountId,platform`+conditional `consumerId,details`; subclasses pin status.
- `api/openapi.js` — `generateSpec()` literal(:939-4229); `sessionProp` inject body sessionCookie(:108-113 — normalization pass xử lý); `x-x402`(:1007); securitySchemes(:1026); literal components(:1040); global security(:1097); `ALL_PAID_RESOURCES`+`generateWellKnown`(:4239-4647). Callers khác server.js: `serverless.js:56,60`, `worker/index.js:200`, `api/routes/x402-discovery.js:17`.
- `api/routes/session-auth.js` — express-validator(:8,:64-74); `sessionCookie` payload(`save-session`:61-111, AES encrypt→prisma). Migrate→Zod, không shim.
- `api/routes/auth.js` — express-validator(:7,:13-21 + login block :104-112). Migrate→Zod.
- `api/routes/viral.js` — `requireSession` inline(:37-44, body-first dual read, dev fallback); flat codes(:57,:153,:172); `/mine` hits jobQueue(Bull/Redis)→scraping — không test success path được.
- `api/routes/checkpoints.js` — per-router error mw(:254-280, `error.suggestedAction` nested); `requireCheckpointManage`(:46-97) multi-auth → scheme `a2aApiKey`; offset pagination(:166-183) → `sendPage` cursor-encoded-offset; `next(error)` pattern(:125,:185).
- `api/routes/crm.js` — 5 endpoints, **không** validation, chỉ `{error:string}` 500s. `api/routes/optimizer.js` — 4 endpoints, hand-rolled checks(:17).
- `api/routes/ai/scrape.js` — `errorResponse`/`successResponse` helpers + `pagination:{nextCursor,hasMore}`(:220-225). Spec-only, không migrate; `page` block canonical khác shape này — không reference.
- `src/analytics/viralStatsStore.js:13` — transitive zod 3.x (lockfile `zod@3.25.76`); audit khi pin `zod@4.6.5`.
- `package.json` — ESM, express 4.21.2, vitest 4 + supertest 6.3.4; add `zod@4.6.5`, `@asteasolutions/zod-to-openapi@9.1.0`, `@redocly/cli@2.54.2`(dev).
- `tests/api/checkpoints-routes.test.js` — import app + supertest + **real prisma test DB** (cần Postgres localhost:5434, `DATABASE_URL_TEST`, seeds JWT_SECRET+users).
- `tests/e2e/{viral-miner,api-auth,api-operations}.e2e.test.js` + `tests/api/checkpoints-routes.test.js` — assert legacy shapes (`error` string, `body.errors` array, `data.checkpoints` object) → update trong story.
- Consumer impact (ghi nhận, không fix): `dashboard/*.html` (~45 sites parse `data.error` string — ví dụ `osint.html:169`, `login.html:572`, `config.js:65`) + `src/mcp/remoteFacebook.js:46` sẽ thấy `[object Object]` trên error paths đến khi Epic 47/consumer updates — accepted breaking change của v2.0.0.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` — `zod@4.6.5` deps, `@asteasolutions/zod-to-openapi@9.1.0`+`@redocly/cli@2.54.2` devDeps, script `lint:openapi`; audit/fix `viralStatsStore.js` cho zod4
- [x] `api/schemas/common.js` — canonical components (`ApiSuccess`, `ApiError`, `PaginatedResponse`, `PaymentRequired`), primitives (ISO date, cursor, id)
- [x] `api/schemas/registry.js` — `OpenAPIRegistry` wrapper `registerPath({method,path,operationId?,schemas,security,xTryItOut,xPaymentInfo,xBazaar})` + deterministic operationId fallback
- [x] `api/middleware/envelope.js` — `ApiError` class, `res.sendData`/`res.sendPage`, error middleware + 404 emit envelope; PlatformError→details verbatim; middleware extras→details
- [x] `api/middleware/validate.js` — `validate({body?,query?,params?,headers?})` → `next(ApiError('VALIDATION_FAILED',400,...))`
- [x] `api/middleware/session-cookie-shim.js` — fill header chỉ khi vắng, giữ body
- [x] `api/schemas/{viral,crm,optimizer,checkpoints,session,auth}.js` + `api/schemas/index.js` barrel (openapi.js import barrel; routes import schema objects)
- [x] `api/routes/{viral,crm,optimizer,checkpoints,session-auth,auth}.js` — wire shim+validate, `sendData`/`next(err)`, migrate express-validator
- [x] `api/openapi.js` — builder: literal /api/ai section + normalization pass (strip body sessionCookie, backfill operationId, re-point envelope refs) + registry merge (throw on method+path collision); `servers` localhost+prod; `info.version` 2.0.0; add `a2aApiKey` scheme
- [x] `api/middleware/{auth,x402,ai-detector}.js` — error emits → `next(ApiError)` giữ extras
- [x] `api/server.js` — mount envelope mw trước parsers (helper availability), limiter `handler`→envelope, error+404 handlers rewrite
- [x] `api/serverless.js` — envelope error mw + 404 + authLimiter handler
- [x] `tests/api/contract/` — error-path contract test ≥1 endpoint mỗi pilot group (400/401/404 deterministic) + success-schema validation cho checkpoints/auth (prisma test DB) + shim precedence tests + zod-migration tests
- [x] Update legacy-shape assertions: `tests/e2e/{viral-miner,api-auth,api-operations}`, `tests/api/checkpoints-routes`
- [x] CI config — `lint:openapi` + contract tests gate

**Acceptance Criteria:**
- Given pilot route có schema, when request gửi lên, then body/query/params/declared headers được Zod validate theo `authenticate → validate → handler`; input sai → `400` `VALIDATION_FAILED` envelope.
- Given bất kỳ request nào, when middleware-originated error (429/404/413/400-json/401/403), then response khớp canonical envelope — verify bằng contract test.
- Given regenerated spec, when lint + contract test chạy, then fail nếu pilot runtime lệch schema; mọi operation (kể cả literal /api/ai) có `operationId` duy nhất; spec chứa 5 security schemes.
- Given consumer hiện hữu, when dùng `/.well-known/x402`, `x-payment-info`, `x-bazaar`, `X-PAYMENT`, `body.sessionCookie` (cả khi header cũng có — body wins), then behavior không đổi — `npm run test:x402` pass.
- Given `POST /api/checkpoints?limit&offset`, when gọi, then response là `data:T[]` + `page:{cursor,limit,total?}` canonical.

## Implementation Notes

- Implemented by subagent dispatch (swe-high); verified independently against diff `666e5bfc..03363bd5` (49 files, +3053/−779).
- Envelope emits **directly** in `errorMiddleware`/`notFoundHandler` (never via `res.sendData`) so parser failures before `envelopeMiddleware` still serialize canonically; `envelopeMiddleware` itself mounts before body parsers.
- `composeSpec()` in `api/openapi.js`: literal `/api/ai` section is input artifact → normalization pass (literal ops: strip `sessionCookie` body props + backfill `operationId`; generated ops: strip `sessionCookie` body prop only when op declares `sessionCookie` security — transport alias vs payload) → merge registry paths with method+path collision throw. Legacy `Error`/`SuccessResponse` components kept verbatim (literal ops emit those shapes at runtime — NFR-22 honesty). `generateSpec()`/`generateWellKnown()` signatures unchanged.
- Pilot `sessioned` chain = `sessionCookieShim → requireSession → validate → asyncHandler`; shim copy-only-when-absent, body field kept (dual-read precedence preserved).
- Checkpoints pagination: `?offset`/`?limit` request kept; response `data:T[]` + `page.cursor` = opaque base64url `off:<n>` token; per-router error middleware removed (global `errorMiddleware` owns PlatformError).
- `express-validator` removed from `session-auth.js` + `auth.js`; `save-session` has no shim (payload field).
- Dashboard consumers (`login.html`, `index.html`, `admin.html`, `js/viral-miner.js`) updated to read envelope with legacy fallbacks — prevents `[object Object]` regressions ahead of Epic 47.
- CI: `lint:openapi` step added to `.github/workflows/ci.yml`.
- Deviations noted: 8 pre-existing/environmental test failures in untouched files (proxy creds `.env`, TopCV live-network, Jev drift) — not caused by this diff; no committed `api/openapi.json` artifact yet (deferred — 46.3 may want it committed; `lint:openapi` regenerates on demand).
- Matrix audit: added `413 PAYLOAD_TOO_LARGE` app-level test post-implementation (was the only uncovered row).

## Spec Change Log

- **Loop 1 (review):** frozen merge-model bullet said "re-point `Error`/`SuccessResponse` refs sang canonical" — review caught that literal `/api/ai` ops emit legacy shapes at runtime, so repointing made the spec lie (NFR-22 violated by spec itself). Resolution: keep legacy components + no repoint; generated ops alone reference `ApiError`/`ApiSuccess`. One-reading interpretation of the honesty invariant; recorded here because the frozen text was followed by intent, not letter.
- **Loop 1:** `sessionCookie` body-prop strip scoped — literal ops always (transport alias); generated ops only when `security` declares `sessionCookie` scheme. `save-session` (bearerAuth) keeps the field as required payload.
- **Loop 1:** new upper bounds are contract tightening worth noting — `viral days ≤365`, `hashtags count ≤50`, `variations count ≤20`, `order` enum (previously unbounded/unvalidated; old callers sending e.g. `days=400` now get `400 VALIDATION_FAILED`).

## Review Triage Log

3 layers (blind-hunter, edge-case-hunter, verification-gap) — 30+ findings triaged:

**Patched (code/test fixes applied in loop 1):**
- `@asteasolutions/zod-to-openapi` was devDependency but runtime-imported → moved to `dependencies` (prod `npm ci --omit=dev` would crash).
- `normalizeOperation` stripped `sessionCookie` from generated `save-session` payload → conditional strip by declared security scheme.
- `Error`/`SuccessResponse` repoint deleted → legacy components kept (see Change Log).
- `express-validator` orphaned dep removed; `pnpm-lock.yaml` staleness deferred (pre-existing, needs pnpm).
- `CheckpointListQuery`: `limit` → `.min(1).max(500)`, `offset` `.max(2^31-1)`, `sortBy` enum; `decodeOffsetCursor` safe-integer bound; `nextCursor` only when rows returned.
- `ApiError` statusCode clamped to [400,599] in `errorMiddleware`.
- x402 503 code `INTERNAL` → `PAYMENT_UNAVAILABLE`.
- `brandingMiddleware` skips non-HTML Content-Type (pre-existing `</body>`-in-JSON corruption window).
- `registerPath` throws on duplicate operationId.
- Register `email` preprocess: falsy→absent + normalizeEmail parity (gmail dots/subaddress, googlemail→gmail, outlook/yahoo/icloud subaddress strip).
- `ViralJob`/`AuthUser`/crm/optimizer response schemas model real fields; corpus op summary honest about placeholder.
- `publicJob()` strips `session` credential from all job responses (response-side leak closed; in-memory storage deferred as pre-existing).
- Consumers fixed: `src/cli/commands/admin.js` checkpoints list shape, `dashboard/js/viral-miner.js` error fallback, `dashboard/docs/guides/rest-api.html` auth contract.
- `info.description` documents serverless partial-mount note.
- Tests added: cursor round-trip + garbage/oversized cursor → 400, `count` bounds → 400, live `authLimiter` 429 (isolated file), serverless 404/401 smoke, `requireAIAgent` 403 envelope (mini-app — real `/api/ai` mount is unreachable behind x402 402 + `isAI` path shortcut), job `session` non-leak, generated-vs-literal sessionCookie strip matrix, legacy components retained.

**Deferred (pre-existing, logged in `deferred-work.md`):** dev-fallback makes `requireSession` 401 unreachable; in-memory job session storage; plugin routes mounted after global 404; discovery CORS divergence across serverless/worker; worker preflight missing new canonical headers; `viral-miner.js` sends no session transport; stale `pnpm-lock.yaml`.

**False:** `ViralSessionHeaders` optional is correct — a required header schema would 400 legacy body-transport clients at the validate layer (dual transport ⇒ neither is individually required; the `sessionCookie` security scheme advertises the requirement).

**Loop-1 delta re-review (commit `76f88f33`):** 8 low findings, all patched — shared `safeHttpStatus` for PlatformError branch, normalizeEmail covers full validator.js domain families, `$ref` resolution in `stripSessionCookieBodyProp`, merge loop filters non-method keys (no phantom operationId on pathItem-level keys), `typeof` guard on security entries, cursor test scoped to seeded `targetKey` prefix with cleanup, `viral-miner` error fallback only stringifies strings. Remaining note: `emittedOperationIds` throw-at-load is the intended guard; a future lazy re-registration caller would need a reset hook.

## Design Notes

**`details` verbatim, không allowlist:** `checkpoints.js:263-268` emit `error.suggestedAction` nested mà MCP/CLI parse; `error.details = toEnvelope()` giữ mọi field domain mà không cần biết tên chúng.

**Literal `/api/ai` = input artifact, không phải paths viết tay trong spec mới:** builder transform nó qua normalization pass — giữ 4.6k dòng x402 richness mà không re-author; drift vẫn bị contract tests bắt.

**Tại sao không wrap `res.json`:** `/api/ai` helpers emit `{success:true,data,meta}`, SDK owns 402 body, `brandingMiddleware` đã override `res.send` — wrap global sẽ corrupt cả ba. `sendData` là opt-in mới; legacy giữ nguyên đến rollout stories.

**Pagination checkpoints:** giữ `?offset` request (compat), `page.cursor` encode offset kế tiếp (opaque). `data.checkpoints` object → `data:T[]` là breaking — bundle vào v2.0.0 bump.

## Verification

**Commands:**
- `npm run test -- tests/api/` — expected: contract + envelope + shim tests pass (cần Postgres test DB)
- `npm run test:x402` — expected: x402 regression pass
- `npm run lint:openapi` — expected: spec lint sạch, operationId unique
- `node -e "import('./api/openapi.js').then(m=>{const s=m.generateSpec();console.log(s.openapi,s.info.version,Object.keys(s.paths).length)})"` — expected: `3.1.0 2.0.0` + paths count ≥ literal cũ + pilot ops
