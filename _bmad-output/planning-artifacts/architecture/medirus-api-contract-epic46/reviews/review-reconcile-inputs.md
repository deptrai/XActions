# INPUT-RECONCILE Review — xactions-api-contract-epic46 Spine

**Reviewer role:** INPUT-RECONCILE (BMad architecture spine gate)
**Spine under review:** `_bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md`
**Inputs reconciled:** Epic 46 spec (`epics.md` ~L2838-2965), parent spine AD-14 (`xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` L284-296), repo reality (`api/server.js`, `api/openapi.js`, `src/core/error-envelope.js`)
**Verdict:** **PASS WITH GAPS** — the spine is broadly faithful: all 3 exclusion classes, mount-before-`/docs/:slug`, CORS `*`, optional-auth union, contract-test minimum, no-live-fetch codegen, typed error union, and the serverless 503 caveat all landed. However, several quiet requirements were dropped or weakened — most materially the `servers` AC, the `PaginatedResponse<T>` named export, and an AD-3 field allowlist that contradicts its own "không bỏ field" rule and the repo's actual envelope.

---

## 1. Epic 46 spec → spine reconciliation

### 1.1 Items fully covered (verified)

| Input requirement (epics.md) | Spine location | Status |
|---|---|---|
| Zod → `@asteasolutions/zod-to-openapi`, `api/openapi.js` refactored to shared builder, no parallel hand-maintained spec (L2846) | AD-1 | ✅ |
| Preserve `x-payment-info`, `x-bazaar`, `securitySchemes.x402Payment`, `/.well-known/x402` (L2847) | AD-7 | ✅ |
| 3 exclusion classes: `POST /webhooks/*`, streaming/binary/SSE/redirect (`/api/video/download`, `/metrics/stream`), `/api/plugins/*`; envelope JSON-only (L2848) | AD-4 | ✅ |
| serverless.js serves same doc with 503 caveat in `info.description` (L2849) | Deferred § | ✅ (see §1.4 for a nuance) |
| Legacy fetch migration → Epic 47 (L2850) | Deferred § | ✅ |
| Envelope `{success,data}` / `{success,error:{code,message,details?}}` (L2851) | AD-2 | ✅ |
| `GET /openapi.json` → 200, `openapi: 3.1.0`, CORS `origin:'*'` (L2865) | AD-7 + paradigm | ✅ |
| Unique `operationId` per operation (L2866) | AD-9 + conventions | ✅ |
| Swagger UI self-hosted via `swagger-ui-express`, mount **before** `/docs/:slug` (L2867) | AD-7 | ✅ |
| `authorize()` for `bearerAuth` (L2868) | AD-6 binds | ✅ |
| Try-it-out off on mutations (tweet/unfollow/DM/auto-*) and x402-paid ops (L2868) | AD-7 (`x-tryitout: false` / `supportedSubmitMethods`) | ✅ |
| Validate `body`/`query`/path params/declared headers (`x-session-cookie`, `x-payment`), order `authenticate → validate → handler`, 400 envelope (L2882) | AD-5 | ✅ |
| Envelope covers middleware errors: 429, 404, 413/415, global error handler (L2883) | AD-2 binds + AD-5 | ✅ |
| Four securitySchemes incl. `sessionCookie` dual mechanism + optional-auth `{}` union (L2884) | AD-6 | ✅ |
| CI: spec lint + contract test ≥1 endpoint per group (L2885) | AD-9 | ✅ (spine pins `@redocly/cli`; spec allowed "redocly hoặc spectral" — acceptable narrowing) |
| Codegen reads committed `openapi.json` or imports builder — **no HTTP fetch from live server**, fail loudly (L2899) | AD-8 | ✅ |
| Output `packages/api-client/` → `@xactions/api-client` via root workspaces (L2900) | AD-8 | ✅ |
| Component dedupe vs `Error`/`SuccessResponse`/`PaymentRequired` (L2901) | AD-8 | ✅ (confirmed: `Error` L1041 and `PaymentRequired` L1052 exist in `api/openapi.js`) |
| Typed error union `400 | 401 | 402 | 429 | 500`, auth injection (L2902) | AD-8 | ✅ |
| `/api/analytics` dual-router dedupe, `/api/governor` documented / `/governor` not (L2922-2923) | AD-9 | ✅ |
| `/api/session` express-validator coexist (L2925) | AD-1 | ✅ (but see §1.3-e) |

### 1.2 DROPPED — `servers` declaration (Story 46.1 AC)

- **Input:** epics.md L2868 — *"UI khai báo `servers` (localhost + production)"*.
- **Spine:** no mention of `servers` anywhere — not in AD-1, AD-7, AD-9, or conventions.
- **Repo reality:** `api/openapi.js:1002-1004` currently declares only `{ url: 'https://xactions.app', description: 'Production' }` — so the AC requires **adding** a localhost entry, and the spine carries no rule guaranteeing either entry survives the Zod-to-OpenAPI refactor. Silent drop of an explicit AC clause.

### 1.3 WEAKENED / PARTIAL items

**a) `PaginatedResponse<T>` named export + per-schema type export — partially dropped.**
- Input: epics.md L2851 defines `PaginatedResponse<T> = { success: true, data: T[], page: { cursor?, limit, total? } }`; L2901 requires the client to *"export một type per schema trong spec (e.g., `ViralStats`, `PostItem`, `CRMContact`, `OptimizeTweetRequest`) cộng `PaginatedResponse<T>`"*.
- Spine: AD-2 defines the pagination **shape** inline but never names `PaginatedResponse<T>`; AD-8 says "Types qua openapi-typescript" but never requires per-schema type exports nor the named generic. `PaginatedResponse<T>` is a hand-maintained generic wrapper around the envelope — it will not fall out of `openapi-typescript` automatically unless the envelope is modeled as a component. The spine should pin the named export.

**b) `/api/session` coexistence — "ghi rõ trong spec" dropped.**
- Input: epics.md L2925 — *"migrate hoặc coexist, **ghi rõ trong spec**"*.
- Spine AD-1: "express-validator chains hiện hữu (`session-auth.js`) coexist; route mới/touch lại dùng Zod" — picks coexist but drops the requirement that the choice/mechanism be recorded in the spec. Minor.

**c) `GET /api-docs` positive assertion weakened.**
- Input: L2867 — *"`GET /api-docs` trả Swagger UI HTML, không phải `dashboard/docs/*.html`"*.
- Spine AD-7 only encodes the mount-order constraint ("mount trước `/docs/:slug` handlers") and frames the prevented failure as "Swagger UI 404". The positive/negative assertion (correct HTML, not a docs page) is implicit. Acceptable, but the contract test convention could have pinned it.

**d) "byte-compatible" overclaim.**
- Spine AD-7 requires extensions be *"byte-compatible với generator hiện tại"*. A spec regenerated via `zod-to-openapi` cannot be literally byte-identical to the hand-written 4.6k-line `api/openapi.js` (key order, whitespace, component ordering all differ). Intent (semantic preservation of the 4 enumerated contracts) is clear, but as written the rule is unverifiable — should read "semantically equivalent for the enumerated extensions".

**e) Serverless caveat framing — slight ambiguity.**
- Input L2849: `info.description` "*phải* ghi rõ một số paths trả 503 trên serverless" — mandatory.
- Spine Deferred: "hiện serve cùng document với caveat trong `info.description`; spec rút gọn theo deployment chờ khi có nhu cầu thật." The deferred item is the *per-deployment reduced spec*; the caveat reads as retained current behavior. Verify the caveat is treated as in-scope work, not deferred.

### 1.4 Inventory (Phụ lục A) coverage

- Spine AD-4 makes the inventory source of truth and AD-9 covers the two dedupe cases. ✅
- Not individually carried: `/api/streams` note "stream data đi qua socket.io" (informational only — mount is still ✅ in scope), `/api/agent` "paid automation" (covered by the x402/auto-* Try-it-out rule), `/api/ai` "merge, giữ extensions" (covered AD-1+AD-7). No scope item lost. ✅

---

## 2. Parent AD-14 → spine AD-3 reconciliation

Parent (xactions-hybrid-scraping-spine L288-292): envelope `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }` flat; `type` enum of 7; `suggestedAction` enum of 8.

### 2.1 Field preservation

Spine AD-3 maps: `error.code` = domain code, `error.type` = AD-14 type, `error.details` = `{ retryAfter?, suggestedAction?, accountId?, platform? }`, `message` → `error.message`. All 7 AD-14 fields are preserved by name — the flat→nested restructure is an explicit, documented transform (HTTP layer reshapes; domain layer untouched), not a silent drop. ✅ with caveats below.

### 2.2 CONTRADICTION — AD-3's details allowlist drops real envelope fields

- `PlatformError.toEnvelope()` (`src/core/error-envelope.js:95-110`) actually emits **more** than AD-14's 7 fields: `statusCode`, `isRetryable`, `retryAfterMs`, plus conditional `consumerId` (AD-20 quota identity, L107-108) and `details` (free-form `Record`, L68/L85/L109).
- Spine AD-3's copy list is exactly `{ retryAfter?, suggestedAction?, accountId?, platform? }` while its own rule text claims *"copy nguyên vẹn ... không bỏ field"*. As written, the mapping **does** drop `statusCode`, `isRetryable`, `retryAfterMs`, `consumerId`, and the domain `details`. `consumerId` is load-bearing for AD-20 multi-consumer quota errors — dropping it at the HTTP boundary is a real regression risk, not a nit.
- **Name collision:** spine reuses `error.details` as the HTTP container for mapped fields while `PlatformError.details` is a distinct free-form field. The spine never says where the domain `details` goes — collision or silent loss.

### 2.3 WEAKENED — required fields marked optional

- AD-14 makes `retryAfter`, `suggestedAction`, `platform` **required** (only `accountId?` is optional). Repo agrees: `toEnvelope()` always emits `retryAfter` (L103) and `suggestedAction` (L104, defaults to `contact_support` L81).
- Spine AD-3 marks all four copied fields optional (`retryAfter?`, `suggestedAction?`, `accountId?`, `platform?`). Weakens the parent's requiredness contract.

### 2.4 Internal inconsistency — `error.type` absent from base envelope

- AD-2 defines Error = `{ success: false, error: { code, message, details? } }` — **no `type` field**. AD-3 then requires `error.type` for domain errors. A spec generated strictly from AD-2's shape produces an Error schema without `type`, so domain errors carry an undeclared field (and codegen'd clients won't type it). AD-2's error shape should declare `type?: string` (or AD-3 should be noted as extending the envelope).

### 2.5 Enum lists — no contradiction introduced, but drift unacknowledged

- Spine does not restate the enums ("`error.type` = AD-14 type"; "không suy ra `suggestedAction` mới") — no violation. ✅
- However the parent's lists are already stale vs repo: `ErrorTypes` has **12** values (error-envelope.js:10-23 adds `not_found`, `target_not_found`, `deprecated`, `degraded_data`, `budget_ceiling_reached`), `SuggestedActions` has **12** (L25-38 adds `rate_limit_backoff`, `use_x_actions_list`, `verify_url`, `retry_with_different_account`). If "AD-14 type" is read as the 7-value enum, five repo-real types are non-compliant. The spine doesn't resolve or acknowledge this drift — worth an explicit "enum sets = repo `ErrorTypes`/`SuggestedActions`, superset of AD-14" note.
- Minor: spine says domain code = "`FB_*`/`XACT_*`" — matches repo default `XACT_0000` (L76), but parent AD-14 examples use numeric codes (`42901`, `42902`). Spine narrows the parent's documented examples; consistent with repo reality, but note the doc-vs-code discrepancy lives in the parent.

---

## 3. Repo reality spot-check

- **`api/server.js`:** `/openapi.json` with `cors({origin:'*'})` at L282-286, `/.well-known/x402` at L288-291 — both confirmed; AD-7's CORS `*` claim is accurate. Docs handlers are actually **three** routes — `/docs/:section/:subsection/:slug` (L451), `/docs/:section/:slug` (L458), `/docs/:slug` (L465) — spine's "trước `/docs/:slug` handlers" loosely covers all three. Note the earlier `express.static(dashboard)` mounts at L308-309 sit *before* the docs handlers: safest mount point for `/api-docs` is before ~L300, not merely before L465 — the spine's constraint is necessary but not fully sufficient as written.
- **`api/openapi.js`:** confirmed `servers` (production only, L1002-1004), `securitySchemes.x402Payment` + `sessionCookie` (L1026-1038), per-op `x-payment-info`/`x-bazaar`, top-level `security: [{x402Payment:[]}]` (L1097). **Gap neither spec nor spine enumerates:** the top-level **`x-x402`** discovery block (L1007-1022: `enabled`, `version`, `facilitator`, `payTo`, `acceptedTokens`, `networks`, `defaultNetwork`). The spec's preserve-list names only `x-payment-info`/`x-bazaar`/`securitySchemes.x402Payment`/`/.well-known/x402`, and the spine copies that list verbatim — `x-x402` survives only via the (overclaimed) "byte-compatible" clause. Recommend explicitly adding `x-x402` to AD-7's preserve list.
- **`src/core/error-envelope.js`:** field names verified — envelope keys are `code`, `type`, `message`, `statusCode`, `isRetryable`, `retryAfterMs`, `retryAfter`, `suggestedAction`, `accountId`, `platform`, `consumerId?`, `details?`. Spine AD-3's field names (`code`, `type`, `retryAfter`, `suggestedAction`, `accountId`, `platform`) all exist; the issue is the omitted fields (§2.2), and `retryAfter` units (seconds, L90-92) which the spine never pins vs `retryAfterMs`.

---

## 4. Findings summary (severity-ordered)

| # | Severity | Finding | Input location | Spine gap |
|---|---|---|---|---|
| F1 | **High** | AD-3 details allowlist drops `statusCode`, `isRetryable`, `retryAfterMs`, `consumerId` (AD-20), domain `details` — contradicts own "không bỏ field" claim; `error.details` name collides with `PlatformError.details` | error-envelope.js:95-110; parent AD-14 L288 | AD-3 (L62) |
| F2 | **Medium** | `servers` (localhost + production) AC dropped entirely | epics.md:2868 | absent from all ADs |
| F3 | **Medium** | `PaginatedResponse<T>` named export + "type per schema" AC not pinned; AD-2 has shape but no named type in AD-8 | epics.md:2851, 2901 | AD-2/AD-8 |
| F4 | **Medium** | AD-2 base error shape lacks `type`, but AD-3 requires `error.type` for domain errors → undeclared field in generated spec | spine-internal | AD-2 (L56) vs AD-3 (L62) |
| F5 | **Low** | AD-14 required fields (`retryAfter`, `suggestedAction`, `platform`) marked optional in AD-3 copy | parent L288 vs spine L62 | AD-3 |
| F6 | **Low** | Top-level `x-x402` extension not enumerated in preserve list; only covered by unverifiable "byte-compatible" clause | openapi.js:1007-1022 | AD-7 (L86) |
| F7 | **Low** | `/api/session` "ghi rõ trong spec" clause dropped; enum drift (12 vs 7/8) unacknowledged; `/api-docs` mount should precede static dashboard mount (~L300), not just docs handlers | epics.md:2925; error-envelope.js:10-38; server.js:308 | AD-1, inherited-invariants table, AD-7 |

**Bottom line:** No wholesale requirement was silently deleted, and every headline AC has a home. But F1 (AD-3 field loss incl. AD-20 `consumerId`), F2 (`servers`), and F3 (`PaginatedResponse<T>`) should be patched into AD-3/AD-7/AD-8 before the spine is promoted from `draft`, since each is a testable contract element a downstream implementer could legally omit today.
