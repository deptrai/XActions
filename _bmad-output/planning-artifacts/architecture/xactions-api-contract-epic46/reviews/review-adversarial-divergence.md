# Adversarial-Divergence Review — xactions-api-contract-epic46 Spine

**Reviewer lens:** construct two units one level down (Story 46.1 spec+UI, Story 46.2 Zod+envelopes, Story 46.3 client codegen, Epic 47 consumer) that each obey every AD to the letter yet still build incompatibly. Every surviving pair = a hole.

**Verdict: FAIL — do not pass the gate.** Nine constructed pairs survive the current AD text, three of them fatal to the epic's own goal (the spec lying about the very envelope it mandates).

Grounding: `api/server.js`, `api/openapi.js` (4647 lines), `api/middleware/auth.js`, `api/middleware/x402.js`, `api/routes/session-auth.js`, `api/routes/ai/*`, `src/core/error-envelope.js`, `package.json`, `epics.md` Epic 46 + Phụ lục A.

---

## Finding 1 — FATAL: `sessionCookie` dual transport is unexpressible in OpenAPI; generated client and validator diverge on auth transport

**The pair:**

- **Unit A (Story 46.2)** writes Zod schemas per AD-1/AD-5. For `/api/session/*` and `/api/ai/*` ops, `sessionCookie` is a declared **body field** — AD-6 explicitly allows "header `x-session-cookie` **hoặc** body field `sessionCookie`". Existing code proves body transport is real: `api/routes/session-auth.js:64` enforces `body('sessionCookie').notEmpty()` via express-validator; every `api/routes/ai/*.js` reads `req.body.sessionCookie || req.headers['x-session-cookie']` (e.g. `ai/teams.js:68`, `ai/grok.js:68`).
- **Unit B (Story 46.3)** generates the client per AD-8: "fetch wrapper mỏng viết tay inject auth". The only machine-readable auth mechanism in the spec is `securitySchemes.sessionCookie` = apiKey `in: header` name `X-Session-Cookie` (`api/openapi.js:1033-1038`). The wrapper therefore injects the `x-session-cookie` **header**.

**Concrete incompatibility:** OpenAPI 3.1 apiKey `in` admits only `query | header | cookie` — a **body field cannot be a securityScheme**, period. So the spec can only encode the header; the body mechanism survives only as prose ("mechanism ghi rõ per-operation" is human-readable, not codegen-readable; `openapi-typescript` emits types, not per-op transport logic). Two compliant outcomes, both broken:

- If Unit A's body schema marks `sessionCookie` required (the literal reading of AD-6's "hoặc"), Unit B's header-only client gets a Zod `400 VALIDATION_FAILED` on every call.
- If Unit A validates only the header, then `/api/session/*` — whose legacy validator demands the body field — 400s Unit B's compliant requests.

**AD text that permits it:** AD-6 "header `x-session-cookie` hoặc body field `sessionCookie`; mechanism ghi rõ per-operation" — the "hoặc" delegates a machine-critical decision to prose. AD-8 "inject auth (Bearer token hoặc `x-session-cookie`)" names only the header.

**Fix:** AD-6 must designate ONE canonical transport (header) as what `securitySchemes` declares and the client sends; declare body-field acceptance a legacy alias that routes may additionally read but schemas never require. If body transport must remain first-class, add a spec extension (e.g. `x-auth-body-field: sessionCookie`) that Story 46.3's wrapper is required to honor.

---

## Finding 2 — FATAL: AD-7 byte-compat forces the spec to advertise a different `Error` than AD-2 emits — the spec lies by construction

**The pair:**

- **Unit A (Story 46.1)** refactors `api/openapi.js` per AD-7: "spec phải giữ nguyên `x-payment-info`, `x-bazaar`, `securitySchemes.x402Payment` … byte-compatible với generator hiện tại." The `x-bazaar` extensions `$ref` `#/components/schemas/SuccessResponse` and `#/components/schemas/Error` (`api/openapi.js:55`, `:64`). To keep those refs resolving byte-compatibly, Unit A preserves the existing components — including `Error: {success:false, error: string, message, retryable, retryAfterMs, timestamp}` (`openapi.js:1041-1051`) and `SuccessResponse` with its `meta` field (`openapi.js:1071-1084`).
- **Unit B (Story 46.2)** implements AD-2: `error` is an **object** `{code, message, details?}`; success is `{success:true, data:T}` with **no `meta`**.

**Concrete incompatibility:** the merged spec contains two contradictory error contracts. `components.schemas.Error` (legacy, kept for x-bazaar refs) declares `error: string`; the runtime emits `error: {code,...}`. x402scan/SDK consumers generated from the spec parse `error` as a string and get an object; Epic 47's client reads `meta` which the server no longer sends. AD-9's raison d'être ("spec nói một đằng runtime làm một nẻo") is violated while every AD's letter is obeyed — AD-1 only forbids hand-editing `paths`, not `components.schemas`, so injecting the legacy components is legal.

Companion sub-hole — **the 402 body is not the AD-2 envelope.** `PaymentRequired` is `{x402Version, accepts:[...]}` (`openapi.js:1052-1070`), protocol-fixed by x402. AD-2 binds "mọi JSON endpoint … kể cả lỗi sinh từ middleware" and AD-4's exclusion list does not mention x402 402s. One implementer wraps 402s in `{success:false,error:{code:'PAYMENT_REQUIRED',…}}` → breaks every x402 client; another passes the SDK shape through → violates AD-2's letter and makes AD-8's "typed error union" wrong (a 402 is not an ApiError envelope).

**AD text that permits it:** AD-7 "byte-compatible với generator hiện tại" (unscoped — does it cover components, extension values, or both?); AD-2 "mọi JSON endpoint thuộc scope" (no x402 exemption); AD-1 "hand-edit `paths` … là vi phạm" (components exempt).

**Fix:** scope AD-7's byte-compat to the *extension keys and their values* only; require `x-bazaar` `$ref`s to point at Zod-derived components; explicitly reserve/rename the legacy `Error`/`SuccessResponse`/`PaymentRequired` components (they are *not* the AD-2 envelope) and state that AD-2's error shape is the only `Error` in the spec. Add an explicit exemption: "x402 402 challenge bodies follow the x402 protocol shape, not AD-2."

---

## Finding 3 — Envelope ownership undefined: double-wrap or no-wrap; "response schema" means two different things

**The pair:**

- **Unit A (Story 46.2, middleware author)** reads the Structural Seed (`middleware/envelope.js` = "success/error formatter") as a `res.json` interceptor that wraps raw handler output. Handlers return `T`; the middleware emits `{success:true, data:T}`.
- **Unit B (Story 46.2, route author)** reads AD-2 as binding on what the handler returns: the route declares a Zod response schema `{success:true, data:T}` and `res.json()`s it directly — existing code already does this (`api/routes/viral.js:177` `res.json({ success: true, job })`).

**Concrete incompatibility:** A's middleware wraps B's handler output → `{success:true, data:{success:true, data:T}}`. Or, symmetrically, if the spec builder wraps declared response schemas in the envelope while schema authors already declared the enveloped shape, the spec documents a double envelope; if the builder doesn't wrap and schemas are raw `T`, the spec omits the envelope entirely and the generated client types `data` wrong. AD-1's "khai báo Zod request/response schemas" never says whether "response schema" describes the payload `T` or the wire envelope `{success,data}` — the single most consequential shared-data-shape decision in the epic.

**AD text that permits it:** AD-2 fixes the *shape* but not the *emission point*; the Seed lists `envelope.js` without saying it owns wrapping; AD-1 says "request/response schemas" without defining the term.

**Fix:** pin one convention: Zod response schemas describe payload `T` only; `envelope.js` is the sole owner of wrapping (handlers MUST return `T` via a `res.ok(data)` helper or the middleware wraps `res.json`); the spec builder wraps every 2xx response schema in the envelope component. Forbid handlers emitting `{success:…}` themselves.

---

## Finding 4 — AD-3's "copy nguyên vẹn" list is lossy and ambiguous: `retryAfterMs`, `isRetryable`, `consumerId`, and the domain's own `details` have no pinned destination

**The pair:**

- **Unit A** copies exactly the enumerated fields: `error.details = {retryAfter?, suggestedAction?, accountId?, platform?}`. This drops `statusCode`, `isRetryable`, `retryAfterMs`, `consumerId`, and the domain's own `details` payload — all of which `PlatformError.toEnvelope()` emits (`src/core/error-envelope.js:95-111`). Note the domain envelope carries **both** `retryAfter` (seconds, getter line 90) and `retryAfterMs` (line 102); AD-3 names only `retryAfter`.
- **Unit B** copies `toEnvelope()` wholesale into `error.details` → produces `error.details.retryAfterMs`, `error.details.isRetryable`, `error.details.statusCode`, `error.details.consumerId`, and — since the domain envelope has its own `details` field (line 109) — **`error.details.details`**.

**Concrete incompatibility:** AD-3's own "Prevents" clause says flattening breaks MCP/CLI consumers parsing `suggestedAction`/`retryAfter`. Under Unit A, a consumer reading `retryAfterMs` or `isRetryable` (both present in every `toEnvelope()` output today) silently gets `undefined`; under Unit B, a consumer reading `details.retryAfter` works but one reading `details.details` for domain context collides with the mapper's own `details` container. Also unresolved: AD-3 puts `type` at `error.type`, but AD-2's error object is `{code, message, details?}` — a strict AD-2 reader strips `type` as a non-conforming field; a lenient one keeps it. Two Zod response schemas for the error component, both "correct".

**AD text that permits it:** AD-3 "`error.details` = `{ retryAfter?, suggestedAction?, accountId?, platform? }` copy nguyên vẹn" — an explicit 4-field list followed by "copy verbatim", leaving the other five `toEnvelope()` fields undecided, and saying nothing about `error.type` vs AD-2's closed shape.

**Fix:** enumerate the exact mapped set (include `retryAfterMs`, `isRetryable`, `consumerId`, and define where the domain's `details` lands — e.g. `error.details.domainDetails`), state explicitly that `error.type` is a permitted additional field beyond AD-2's minimum, and decide once whether domain fields nest under `error.details` or flatten into `error`.

---

## Finding 5 — "authenticate" is undefined per-route: literal AD-5 mounts JWT auth on `/api/ai/*` and kills every x402 agent

**The pair:**

- **Unit A (Story 46.2)** reads AD-5 literally: order cố định `authenticate → validate → handler`, and AD-5 binds `api/middleware/auth.js` — so `authenticate` = `authMiddleware`, which 401s any request without `Authorization: Bearer` (`auth.js:33-35`). Applied to all in-scope routes including `/api/ai/*` → every x402 agent call dies with 401 before payment/session logic runs. Bonus violation: auth.js emits `{error:'No token provided'}` — a legacy shape — so Unit A must also decide whether AD-2 forces rewriting auth.js, which no AD states.
- **Unit B** reads AD-6 instead: "per-route mapping nằm trong spec" — `/api/ai/*` ops declare `x402Payment`/`sessionCookie`, not `bearerAuth`, so Unit B's "authenticate" step resolves the session cookie (as `ai/*.js` handlers already do) and skips JWT entirely.

**Concrete incompatibility:** identical ADs, opposite pipelines — A returns 401 for the entire paid-AI surface; B never runs auth.js there. The spine never defines what `authenticate` denotes when a route's security scheme is not JWT, nor whether auth.js's `{error:string}` 401s must be re-enveloped (AD-2 says middleware errors use the envelope; auth.js is named in AD-5's Binds but is not listed for migration).

**AD text that permits it:** AD-5 "Order cố định `authenticate → validate → handler`" + Binds `api/middleware/auth.js`; AD-6 "Per-route mapping nằm trong spec, không suy ra từ middleware" — the two ADs never reconcile which one defines the authenticate step.

**Fix:** AD-5 must define `authenticate` as "the credential resolution implied by the operation's declared security scheme" (JWT via auth.js, sessionCookie via header/body extraction, x402 via the x402 middleware which already runs globally at `server.js:248`), and state that all auth-failure responses — including auth.js 401/403/500 — pass through the envelope formatter.

---

## Finding 6 — "Cùng envelope formatter" is a mechanism Express doesn't give for free; rate-limit, x402-SDK, and 404 errors escape it

**The pair:**

- **Unit A** implements `envelope.js` as an Express error-handling middleware (the natural reading). This catches `next(err)` errors — body-parser 413/415, thrown handler errors. But `express-rate-limit` never calls `next(err)` — it sends `options.message` directly (`server.js:174,185,194,203,212,220` all configure `message: {error:'Too many…'}`), and the `@x402/express` SDK writes its own 402/500 responses (`middleware/x402.js:357,382`). The 404 handler (`server.js:713` `{error:'Route not found'}`) is a plain handler, not an error. All three escape the formatter; Unit A still satisfies AD-5's letter because nothing in the AD assigns ownership of wrapping limiters, the 404 handler, or the x402 SDK.
- **Unit B** configures `handler:` on each of the ~6 limiter instances, rewrites the 404 handler, and wraps the x402 SDK — more work, different file ownership (server.js vs middleware/), and still can't intercept SDK-internal responses without a shim.

**Concrete incompatibility:** under A, `GET /api/ai/*` over the limit returns `{error:'Too many requests…'}` while a validation failure returns `{success:false,error:{code:'RATE_LIMITED'…}}` — two error shapes on the same endpoint, the exact pathology AD-2 exists to kill. Contract tests (AD-9: "tối thiểu 1 endpoint mỗi inventory group") won't catch it — nobody tests a 429.

**AD text that permits it:** AD-2/AD-5 "đi qua cùng envelope formatter — không escape ra shape riêng" states an outcome without naming the mechanism or the owner for non-`next()` error paths.

**Fix:** enumerate the interception points and owners: `envelope.js` exports the error middleware AND `limiterHandler()` used by every `rateLimit()` call site, the 404 handler, and an x402 error shim — or explicitly exempt x402 SDK responses (see Finding 2).

---

## Finding 7 — AD-1's coexist clause vs AD-2's universality: `/api/session` can legally keep `{errors:[]}`

**The pair:**

- **Unit A** reads AD-1 "express-validator chains hiện hữu (`session-auth.js`) coexist" plus the inventory note "migrate hoặc coexist" (`epics.md:2925`) as license to leave `session-auth.js` untouched → its 400s keep returning `{ errors: errors.array() }` (`session-auth.js:73`) and its 401 `{success:false, error:'…' , message}` (`session-auth.js:86-91`).
- **Unit B** reads AD-2 "mọi JSON endpoint thuộc scope" — `/api/session` is ⚠️-in-scope — and either rewrites the route (violating "coexist"?) or documents the legacy shape in the spec, producing a second sanctioned error shape that AD-8's typed error union can't represent.

**Concrete incompatibility:** whichever way B resolves it, the two units disagree on whether `{errors:[]}` is a legal response in scope — and if B documents it, Epic 47's client must hand-parse a non-envelope error, defeating "consumer không phải tự xử lý auth/error".

**AD text that permits it:** AD-1 "coexist" (unqualified) vs AD-2 "mọi JSON endpoint … kể cả lỗi sinh từ middleware" (unqualified). Neither scopes the other.

**Fix:** state that "coexist" means express-validator may remain the *validator* but its output MUST map through the envelope formatter — or move `/api/session` to the AD-4 exclusion list explicitly.

---

## Finding 8 — AD-8's typed error union `400|401|402|429|500` cannot represent the server's real status set

**The pair:**

- **Unit A (Story 46.3)** implements exactly the listed union `400 | 401 | 402 | 429 | 500`.
- **Unit B (the server, per AD-3 + existing middleware)** legitimately returns 403 (`requireSubscription` upgrade, `auth.js:152`; `requireAdmin`, `auth.js:237`; `BotChallengeError` statusCode 403, `error-envelope.js:130`), 404 (route-not-found, domain `NOT_FOUND`), 413/415 (body-parser), 503 (`ProxyDeadError`, `error-envelope.js:154`).

**Concrete incompatibility:** every 403/404/413/503 falls outside A's union → the wrapper must either widen the union (violating AD-8's letter), collapse them into `500` (lying), or leak `unknown` — which is the `any` the AD was written to prevent. Note AD-3 deliberately passes `statusCode` through from domain errors, so the status set is open-ended by design — the two ADs are arithmetically incompatible.

**AD text that permits it:** AD-8 "typed error union (`400 | 401 | 402 | 429 | 500`)" — a closed list vs AD-3's pass-through `statusCode`.

**Fix:** type the union on `error.code` (the stable taxonomy) with `status: number` kept as data, or enumerate the full reachable set including 403/404/413/415/503.

---

## Finding 9 — `workspaces` mechanism pinned, package manager not: npm vs pnpm divergence on `@xactions/api-client` resolution

**The pair:**

- **Unit A** adds `"workspaces": ["packages/*"]` to root `package.json` and runs `npm run generate:api-client` — satisfies AD-8's letter.
- **Unit B** notices the repo also carries `pnpm-lock.yaml` beside `package-lock.json` and uses pnpm — where the `workspaces` field is silently **ignored** (pnpm requires `pnpm-workspace.yaml`, which does not exist). `@xactions/api-client` doesn't resolve; Epic 47 can't import it.

Root `package.json` currently has **no `workspaces` field at all**, and the only existing package (`packages/xactions-mcp`) is named `xactions-mcp`, not `@xactions/*` — so even the naming precedent is unestablished. Additionally `apps/` already contains `api/` and `web/` skeletons, which a third implementer may read as the intended monorepo root — putting the client in `packages/` while apps resolve differently.

**AD text that permits it:** AD-8 "resolve thành `@xactions/api-client` qua root `workspaces`" pins npm semantics without pinning the package manager; AD-9's CI doesn't require an install-time check that `@xactions/api-client` resolves.

**Fix:** name the package manager (npm, matching `package-lock.json`), require adding `workspaces` in the same PR, and add a CI smoke check `node -e "require.resolve('@xactions/api-client')"`. Or drop the workspaces mechanism and use a tsconfig path alias — but say which.

---

## Minor observations (not full pairs, still worth closing)

- **Dual-mount rate-limit asymmetry:** the limiter skips `/governor` (`server.js:166`) but `/api/governor` does not match that prefix → the documented twin is rate-limited, the undocumented twin is not. AD-9 documents only `/api/governor`; nobody owns the behavior delta.
- **`operationId` group ownership on shared mounts:** `/api/analytics` is served by `analytics.js` + `history.js` (`server.js:354,362`). Both can legitimately emit group `analytics_*` operationIds; AD-9's uniqueness lint catches collisions but assigns no group-namespace owner — last-writer-wins during parallel story work.
- **`/openapi.json` and `/.well-known/x402` are JSON GET endpoints outside the inventory.** A strict AD-2 reader could wrap them in `{success:true,data:{spec}}`, breaking x402scan byte-compat; AD-4 bounds scope to the inventory, so they escape — but only because the inventory omits them, not because anyone decided it.

---

## Summary of holes to close

| # | Hole | ADs involved | Severity |
|---|---|---|---|
| 1 | sessionCookie transport unexpressible + client/validator mismatch | AD-5, AD-6, AD-8 | **Fatal** |
| 2 | Byte-compat preserves legacy `Error`/`SuccessResponse`/`PaymentRequired`; spec advertises non-envelope errors; 402 body conflicts with envelope | AD-1, AD-2, AD-7, AD-9 | **Fatal** |
| 3 | Envelope emission point + "response schema" undefined → double-wrap / spec omits envelope | AD-1, AD-2, Seed | High |
| 4 | AD-3 field list drops `retryAfterMs`/`isRetryable`/`consumerId`/`details`; `error.type` vs AD-2 shape | AD-2, AD-3, AD-14 | High |
| 5 | `authenticate` undefined → JWT mounted on x402 routes; auth.js legacy shapes unowned | AD-5, AD-6, AD-2 | High |
| 6 | Rate-limit/404/x402-SDK errors can't reach a formatter without named mechanism+owner | AD-2, AD-5 | High |
| 7 | session-auth "coexist" vs envelope universality → `{errors:[]}` legally survives | AD-1, AD-2, AD-4 | Medium |
| 8 | Error union `400|401|402|429|500` vs real 403/404/413/503 | AD-8, AD-3 | Medium |
| 9 | `workspaces` pinned but package manager (npm vs pnpm) not | AD-8 | Medium |
