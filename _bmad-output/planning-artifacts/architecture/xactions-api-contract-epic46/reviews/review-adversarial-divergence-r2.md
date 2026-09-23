# Adversarial-Divergence Review — ROUND 2 (re-check after revision)

**Subject:** `ARCHITECTURE-SPINE.md` (xactions-api-contract-epic46), updated 2026-09-24
**Prior round:** `review-adversarial-divergence.md` — FAIL, 9 surviving pairs (3 fatal)
**Method:** same lens — construct two units one level down (Stories 46.1/46.2/46.3, Epic 47 consumer) that obey every AD to the letter yet build incompatibly. Verify each round-1 finding against the revised text; then re-run the pair-construction pass on the *new* clauses the revision added.

**Verdict: FAIL — but categorically improved.** All three fatal pairs are dead. However one round-1 finding (F8, error union) was left **completely untouched**, the F6 fix left a same-class residual (auth.js's own self-emitted shapes), and the revision's own fixes introduced three new compliant-yet-incompatible pairs (N1–N3). None are fatal to the epic's thesis; all are closable with single sentences. Recommend one more targeted pass rather than re-architecture.

Grounding this round: `src/core/error-envelope.js:95-111` (`toEnvelope()` field set), `api/middleware/auth.js` (full file), `api/routes/session-auth.js:60-110`, `api/routes/ai/{actions,sentiment,messages,optimizer,moderation}.js` credential reads, root `package.json` (no `workspaces`), repo root (`package-lock.json` **and** `pnpm-lock.yaml`, no `pnpm-workspace.yaml`).

---

## Part 1 — Round-1 findings re-verified

### F1 (FATAL) — sessionCookie dual transport → **CLOSED, with residual N1/N2**

AD-6 now pins the header `x-session-cookie` as "transport canonical duy nhất", names the normalization mechanism ("auth middleware normalize legacy `req.body.sessionCookie` thành header-equivalent trước khi validate"), and states the spec never declares body transport. The Conventions table repeats it. The fatal pair — spec physically unable to express the body transport while a Zod schema requires it — is dead: schemas never declare it, the client injects the header, the shim keeps legacy body callers working.

The round-1 second branch (header-only canonical request dying on a legacy `body('sessionCookie')` validator) turns out to be **moot on the auth-credential routes**: the only `body('sessionCookie').notEmpty()` chain in the repo is `session-auth.js:64`, where the field is *payload* (see N1), not transport. No legacy validator gates the credential. Good.

**Residuals (new findings below):** the normalize shim's *scope* is unpinned — `sessionCookie` is also a payload field on JWT-authed routes (N1); and Zod unknown-key strictness is unpinned against the legacy body transport the shim exists to preserve (N2).

### F2 (FATAL) — byte-compat preserves non-envelope `Error`/`SuccessResponse`/`PaymentRequired` → **CLOSED**

AD-7 now scopes preservation to *extension semantics* ("semantics preserved") and explicitly un-freezes components: "`$ref` trong extensions được re-point sang canonical components mới (không byte-freeze component names — x402scan đọc extension fields, không đọc tên component)". AD-2 adds the explicit exemption: "x402 `402` bodies (protocol-fixed bởi x402 spec)". AD-8's "generated types namespace/dedupe khỏi `Error`/`SuccessResponse`/`PaymentRequired` components" implies those names persist as **canonical** components (i.e. `Error` now *is* the AD-2 error shape) — so the spec carries one error contract, not two. The constructed pair (legacy components preserved alongside the envelope) is dead.

**Two residual notes, neither a surviving pair:**
- The claim "x402scan đọc extension fields, không đọc tên component" is a *factual assertion about an external consumer*, not a rule. If x402scan resolves `$ref`s into component content (e.g. reads fields off `SuccessResponse`), re-pointing to the canonical component (which has no `meta`) silently changes semantics — the exact revenue regression AD-7 exists to prevent. The decision is reasonable; it should be verified against x402scan behavior during Story 46.1, not assumed. One line: "verify x402scan field-level consumption before re-pointing refs."
- The 402 exemption creates a knock-on in AD-8's error union — see F8 (now worse).

### F3 — envelope ownership / double-wrap / "response schema" ambiguity → **CLOSED at runtime; spec-emission half survives as R-3a**

Runtime side fully pinned: AD-2 "Single owner: chỉ `api/middleware/envelope.js` serialize envelope — handler trả payload `T` qua `res.sendData(t)` / throw error; handler không tự `res.json({success:true,...})`"; AD-1 "response payload `T` — schema mô tả payload, envelope là wrapper của pipeline chứ không nằm trong schema"; Seed "SOLE owner". Double-wrap and no-wrap are both dead.

**Residual R-3a (medium):** the *spec-side* composition step is still implicit. AD-1 pins that schemas describe `T` and that "spec generate từ schemas qua `@asteasolutions/zod-to-openapi`" — but nothing states that the builder **composes** `T` into the canonical `SuccessResponse<T>`/error components when emitting operation responses. Unit A (46.1 builder author) registers declared response schemas 1:1 → spec documents `T` as the 200 body → spec lies about the wire by construction (AD-9's own pathology). Unit B composes the envelope in the builder. Both satisfy the letters of AD-1/AD-2; AD-9 forces B's *outcome* but the mechanism is unpinned, and a 1:1 generator is the natural reading of "generate từ schemas". One line closes it: "spec builder wraps mọi declared response schema `T` trong canonical envelope components khi emit; error responses reference canonical `Error` component — response schema trong spec luôn là enveloped shape."

**Residual R-3b (low):** `res.sendData(t)` cannot carry the pagination `page` sibling (AD-2 pins `{success,data:T[],page:{…}}` with `page` *outside* `data`). Wire shape is pinned so wire converges, but the helper signature can't express it — implementers will each invent the channel (`sendData(t,{page})`? `res.paginate()`? `res.locals.page`?). Pin the signature.

### F4 — AD-3 lossy field list → **CLOSED**

"`error.details` = `toEnvelope()` output nguyên vẹn … copy verbatim, không allowlist" with the full field enumeration. Verified against `error-envelope.js:95-111`: the emitted set is `{code,type,message,statusCode,isRetryable,retryAfterMs,retryAfter,suggestedAction,accountId,platform,consumerId?,details?}` — verbatim copy is deterministic, so `error.details.details` and the duplicated `code`/`type`/`message`/`statusCode` inside `details` are now *defined outcomes*, not divergence. `error.type` reconciled via `type?: string` in the AD-2 shape + "optional trên non-domain errors" in Conventions. Closed.

**Nit (not a pair):** `error.details` will echo `code`/`type`/`message` already present at `error.*` — redundant but deterministic; consumers must be told to read the top level. One clause in AD-8's error-union fix could note it.

### F5 — `authenticate` undefined → **CLOSED core; same-class residual on auth.js shapes (R-5)**

AD-5 now defines the step: "security scheme đã khai báo của route đó (AD-6 — JWT, sessionCookie, x402Payment, hoặc optional) chạy trước → Zod validate → handler. Không có global JWT gate — `/api/ai/*` authenticate qua `x402Payment`, không phải `auth.js`." The fatal reading (JWT on every route) is dead.

**Residual R-5 (medium):** auth.js's *own* self-emitted shapes still have no named interception mechanism. AD-5 names three funnels: express-rate-limit `handler`, body-parser `err.type === 'entity.*'`, the 404 handler. But `auth.js` — which AD-5 explicitly Binds — emits `{error:'No token provided'}` (401, `auth.js:34,44,49,58,66,69`), `requireSubscription` emits `{error,requiredTier,currentTier,upgradeUrl}` (403, `auth.js:152-157`), `checkUsageLimit` emits `{error:'Daily limit reached',limit,used,…}` — a **second, mechanism-less 429 source** (`auth.js:208-214`) that the named rate-limit `handler` option does not cover — and `requireAdmin` emits 401/403 (`auth.js:233,237`). Unit A converts only the three named mechanisms → `GET /api/x` can return an enveloped 429 from express-rate-limit and a non-enveloped 429 from `checkUsageLimit` on the *same endpoint* — the exact two-shapes-on-one-endpoint pathology from round 1, relocated. Unit B also rewrites auth.js to `next(err)`/throw. Both comply with the named-mechanism list as written. Fix: extend the funnel list — "auth.js family (`authenticate`, `optionalAuth`, `requireSubscription`, `checkUsageLimit`, `requireAdmin`) emit via the envelope error path (throw/`next(err)`), không tự `res.json`" — or explicitly list auth.js as a migration target.

### F6 — interception mechanisms unnamed → **PARTIALLY CLOSED**

The three cited escape paths now have named mechanisms (rate-limit `handler`, `entity.*`, 404 handler) and "không cái nào tự `res.json` shape riêng". What remains unowned: (a) the auth.js family above — same class, bigger blast radius than the ones named; (b) x402 SDK **non-402** responses — AD-2 exempts only `402` bodies; SDK-emitted 500s (`middleware/x402.js`) are neither exempted nor assigned a shim. Unit A exempts all SDK output; Unit B wraps SDK errors in a shim. Both defensible. One line: "x402 SDK non-402 error responses funnel qua envelope shim" or "exempt all x402 SDK-emitted responses".

### F7 — "coexist" vs envelope universality (`{errors:[]}`) → **CLOSED by composition**

Not reworded, but the composition now forecloses it: AD-2 binds "mọi JSON endpoint thuộc scope, kể cả lỗi sinh từ middleware" *and* pins that handlers emit only via `res.sendData(t)`/throw — so `session-auth.js:73`'s `res.status(400).json({errors: array})` is a non-compliant emission under any reading; "coexist" can only mean the *validator* stays while its output routes through the envelope (handler throws a `VALIDATION_FAILED` carrying the array into `details`). The pair is technically dead. Still worth one explicit clause — "coexist = validator stays, output MUST map qua envelope" — because the surviving reading requires combining two ADs and a story implementer working only from AD-1 could still ship the legacy shape. Low residual.

### F8 — typed error union vs reachable status set → **STILL OPEN — text untouched, now with a second defect**

AD-8 still reads "trả typed error union (`400 | 401 | 402 | 429 | 500`)" verbatim — the revision did not touch it. The round-1 arithmetic is unchanged and re-grounded: `requireSubscription`/`requireAdmin` 403 (`auth.js:152,237`), `BotChallengeError` 403 (`error-envelope.js:130`), 404 (route-not-found + domain `NOT_FOUND`), body-parser 413/415, `ProxyDeadError` 503 (`error-envelope.js:154`). AD-3 passes `statusCode` through verbatim inside `error.details`, so the status set is open-ended by design while AD-8 keeps a closed 5-member union — the two ADs remain arithmetically incompatible.

**New twist introduced by the F2 fix:** AD-2 now exempts x402 `402` bodies from the envelope. So the union's `402` member, if typed as the `ApiError` envelope, *lies about the one status it lists* — a real 402 body is `PaymentRequired` (`{x402Version, accepts:[…]}`), not `{success:false,error:{…}}`. Unit A types all union members as `ApiError` → the 402 branch's type is wrong; Unit B types 402 as `PaymentRequired` → different union shape than AD-8's letter implies. Both compliant; incompatible client error-handling.

Fix (unchanged, now covering both defects): type the union on `error.code` (stable taxonomy) with `status: number` as data, or enumerate the reachable set; and declare `402 → PaymentRequired` as a separate branch of the result type.

### F9 — workspaces pinned, package manager not → **CLOSED enough; one residual note**

AD-8 now adds the install-audit gate: "bắt buộc install-audit step (verify `packages/xactions-mcp` + phantom deps trước khi commit lockfile)" and all scripts are `npm run …`. npm is effectively pinned. Residual note only: `pnpm-lock.yaml` still sits beside `package-lock.json` in the repo root — a pnpm-invoking contributor still silently loses `workspaces`. One clause ("package manager = npm; `pnpm-lock.yaml` removed in the workspaces PR") makes it airtight. Low.

### Round-1 minor observations

- **Dual-mount rate-limit asymmetry** (`/governor` skipped by limiter, `/api/governor` not): AD-9 now pins "chỉ `/api/governor` được document (`/governor` legacy mount không vào spec)" — the *spec* is honest about the documented twin; the runtime delta is real but now consistently out-of-spec. Adequately resolved at spine level.
- **operationId group ownership on shared mounts**: AD-9 requires dedupe ("hai router trên `/api/analytics` không emit trùng path") — collision handled, namespace *ownership* still unassigned (last-writer-wins during parallel story work). Same as round 1 — low.
- **`/openapi.json` + `/.well-known/x402` outside inventory**: resolved by pin — AD-7 preserves `/.well-known/x402` semantics; AD-8 pins `GET /openapi.json` serves the artifact (raw doc, since Swagger UI/x402scan consume it byte-level). The res.sendData-only emission model also means these routes simply never opt into the envelope.

---

## Part 2 — NEW pairs introduced or exposed by the revision

### N1 (medium) — `sessionCookie` is payload on JWT routes: normalize scope unpinned

The repo gives `sessionCookie` two incompatible roles, and the revision's normalize clause doesn't scope which one it means:

- On `/api/ai/*` it is an **auth credential** — handlers dual-read `req.body.sessionCookie || req.headers['x-session-cookie']` (`ai/actions.js:54`, `ai/sentiment.js:68`, `ai/moderation.js:45`).
- On `POST /api/session/save-session` it is **payload** — the X/Twitter `auth_token` being encrypted and stored, on a route authed by `authenticate` = **JWT** (`session-auth.js:62`), with the field required by `body('sessionCookie').notEmpty()` (`session-auth.js:64`).

**The pair:** Unit A implements the normalize shim globally (or per `api/` mount): `req.headers['x-session-cookie'] ||= req.body.sessionCookie`. On `save-session`, the *payload* (a Twitter cookie) is now also injected as an `x-session-cookie` auth header — harmless only as long as no auth resolver on that route ever honors the sessionCookie scheme; the moment `optional-auth` or a shared credential-resolver consults the header first, a JWT-authed save request mis-resolves identity against a Twitter cookie. Unit B scopes the shim to operations whose *declared scheme* is `sessionCookie` — `save-session` untouched, correct. Both satisfy AD-6's letter ("auth middleware normalize legacy `req.body.sessionCookie`" — neither scope is excluded).

Fix: "normalize chỉ chạy trên operations mà declared security scheme = `sessionCookie`; trên routes khác `sessionCookie` là payload, không phải credential."

### N2 (medium) — Zod unknown-key policy unpinned vs the legacy body transport the shim preserves

AD-6 keeps body-transport sessionCookie working via normalization, which runs *before* validate. But nothing pins Zod schema unknown-key behavior. Unit A authors `z.strictObject`/`z.object().strict()` bodies (the natural zod-to-openapi default for clean specs) → after the shim copies the cookie to the header, strict validation still sees `sessionCookie` as an unknown body key → `400 VALIDATION_FAILED` → the legacy clients the shim exists to keep alive are killed one step later. Unit B uses default strip/passthrough → they survive. Both comply with every AD; opposite outcomes for the same legacy request, and the *spec cannot tell consumers which*.

Fix: pin unknown-key policy — e.g. "request body schemas dùng non-strict objects (strip unknown keys) để giữ legacy field tolerance" or explicitly whitelist `sessionCookie` in ai/* body schemas as deprecated-optional.

### N3 (low-medium) — `optional-auth` invalid-credential semantics unpinned

AD-6 defines optional-auth as `security: [{}, {scheme}]` — anonymous OR authenticated. Nothing says what happens when credentials are *present but invalid*. The repo's existing `optionalAuthMiddleware` treats bad/expired tokens as anonymous (`auth.js:109-111`: `req.user = null; next()`). Unit A preserves that (invalid creds → anonymous). Unit B reads "authenticate chạy trước" strictly and 401s on present-but-invalid creds. On the same endpoint, one emits 200-anonymous and the other 401 — different wire, both compliant.

Fix: "optional-auth: credentials present-but-invalid → treat as anonymous (không 401); only missing-on-required → 401" — or the reverse, but pick one.

### N4 (low) — `"type để trống"` is omit-vs-empty-string ambiguous

AD-3: non-domain errors "`type` để trống". AD-2 shape has `type?: string`. Unit A omits the field; Unit B emits `type: ""`. Both satisfy `type?: string`; snapshot/contract tests and strict-equal consumers diverge. Fix: "non-domain errors omit `type` (field absent, not empty string)."

---

## Summary table

| # | Round-1 finding | Status | Residual |
|---|---|---|---|
| F1 | sessionCookie dual transport (FATAL) | **Closed** | Scope of normalize shim (N1); strictness kills legacy transport (N2) |
| F2 | byte-compat vs envelope (FATAL) | **Closed** | x402scan ref-resolution is asserted, not verified; feeds F8's 402 defect |
| F3 | envelope ownership / double-wrap | **Closed (runtime)** | Spec-emission composition unpinned (R-3a); `res.sendData` can't carry `page` (R-3b) |
| F4 | AD-3 lossy field list | **Closed** | `details` duplicates code/type/message — deterministic, note for consumers |
| F5 | `authenticate` undefined | **Closed (core)** | auth.js family self-emits non-envelope 401/403/429 — no named mechanism (R-5) |
| F6 | interception mechanisms | **Partially closed** | auth.js family + x402-SDK non-402 responses unowned |
| F7 | `{errors:[]}` coexist | **Closed (by composition)** | Worth one explicit clause |
| F8 | error union vs real statuses | **OPEN — untouched** | Now double: missing 403/404/413/415/503 *and* 402's body is PaymentRequired not ApiError |
| F9 | package manager unpinned | **Closed enough** | `pnpm-lock.yaml` still present; say "npm only" |
| N1–N4 | new this round | — | See Part 2 |

## Required closes before PASS (all single-sentence-class)

1. **F8:** rewrite AD-8's error typing — union on `error.code` (or full reachable status set) + `402 → PaymentRequired` branch.
2. **R-5/F6:** extend AD-5's named funnel list to the auth.js family (`authenticate`, `optionalAuth`, `requireSubscription`, `checkUsageLimit`, `requireAdmin`) and decide x402-SDK non-402 responses (shim or exempt).
3. **R-3a:** pin that the spec builder composes declared `T` into canonical envelope components when emitting operation responses.
4. **N1:** scope the sessionCookie normalize shim to sessionCookie-scheme operations.
5. **N2:** pin Zod unknown-key policy (or whitelist `sessionCookie` in affected body schemas).
6. N3/N4 + R-3b + pnpm note: one line each.
