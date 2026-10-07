---
review: rubric-walker
spine: ARCHITECTURE-SPINE.md (xactions-api-contract-epic46)
lens: "Good-spine checklist: real divergence points fixed for the level below, enforceable AD rules, safe Deferreds, verified tech, brownfield ratification, driving-spec coverage, parent-spine inheritance, no silent dimensions."
verdict: FIX — revisions required before story freeze
date: 2026-09-24
---

# Rubric Walker Review — XActions API Contract Spine (Epic 46)

**Reviewer role:** Rubric Walker (BMad architecture spine gate)
**Target:** `_bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md`
**Verified against:**
- Driving spec: `_bmad-output/planning-artifacts/epics.md` Epic 46 (lines 2838–2963, incl. Phụ lục A Route Inventory)
- Parent spine: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (AD-14, AD-16, AD-17, AD-19, AD-20)
- Brownfield: `api/server.js`, `api/openapi.js`, `api/serverless.js`, `api/routes/checkpoints.js`, `api/routes/governor.js`, `api/routes/session-auth.js`, `api/middleware/auth.js`, `src/core/error-envelope.js`, `package.json`
- Sibling review: `reviews/review-reality-check.md` (corroborated where noted)

---

## 1. Verdict

**FIX.** The spine is genuinely strong in places: the dependency-direction rule (`routes → schemas → spec → client`), the fixed exclusion list, the x402 preservation rule, and the operationId/dedupe honesty rules are all correct, grounded, and enforceable. The error-shape-diversity claim in AD-2 is verified against real code (`{error:string}` at `api/server.js:714`, `api/middleware/auth.js:34`; `{error:{message,status}}` at `api/server.js:702-709`; `{errors:[]}` via express-validator).

But it has **one false premise in the inherited-invariants table**, **one AD that contradicts an existing brownfield convention instead of ratifying it**, and **one unpinned cross-story artifact contract**. These are exactly the class of defect a spine exists to prevent. Findings: 2 High, 3 Medium, 4 Low.

---

## 2. Checklist Evaluation

| Rubric item | Status | Summary |
|---|---|---|
| Fixes real divergence points for level below (3 stories + Epic 47) | **PARTIAL** | 9 ADs cover most divergence vectors. Missed: the `openapi.json` committed-artifact contract (path, producing script, regeneration trigger) shared by Story 46.1 (producer) and Story 46.3 (consumer); spec `servers` values required by 46.1 AC; API-layer error-code taxonomy location. |
| Every AD's Rule enforceable & prevents stated divergence | **PARTIAL** | AD-1/2/4/5/6/8/9 enforceable. **AD-3 fails twice**: (a) it prescribes `error.details` nesting that contradicts the flat `error.suggestedAction`/`error.type` mapping already shipping in `api/routes/checkpoints.js:260-269`; (b) its field enumeration omits `isRetryable`/`statusCode`/`retryAfterMs`/`consumerId` that `toEnvelope()` actually emits (`src/core/error-envelope.js:96-111`), making "không bỏ field" unenforceable. AD-7's try-it-out mechanism is not implementable as written. |
| Nothing under Deferred could let two units diverge | **PASS WITH NOTE** | Deferreds are single-owner or single-artifact. Note: the serverless deferral misdescribes current state — `info.description` contains **no** 503/serverless caveat today (`api/openapi.js:949-952`); the caveat is an epic requirement to *add*, not existing behavior. |
| Named tech verified-current | **PASS WITH NOTE** | zod 4.6.5, @asteasolutions/zod-to-openapi 9.1.0 (peer `zod ^4`), swagger-ui-express 5.0.1, openapi-typescript 7.13.0, @redocly/cli 2.54.2 all verified on npm (corroborated by `review-reality-check.md`). Note: `supertest 7.3.0` is an **undeclared major bump** over repo's `^6.3.4` — the Stack table doesn't flag it. |
| Ratifies rather than contradicts brownfield | **FAIL** | Inherited table claims AD-16/AD-19 bind `src/api/**` — **`src/api/` does not exist**; the operational surfaces live in `api/routes/` *inside this spine's own scope*. AD-3 contradicts the existing PlatformError→HTTP mapping in checkpoints.js. `/metrics/stream` is misclassified as SSE (it is plain `res.json`, owned by parent AD-17). |
| Covers driving spec capabilities | **PASS** | All three story ACs and Phụ lục A map onto ADs and the Capability→Architecture map; exclusions match the epic verbatim. `servers` declaration is the one AC fragment with no home. |
| Parent spine inherited correctly (AD-14/16/19) | **FAIL** | AD-14 shape quoted correctly and AD-3's bridging intent is right — but mis-scoping AD-16/AD-19 to a non-existent `src/api/**` hides that `/api/checkpoints`, `/api/governor`, `/api/admin`, `/api/proxies` (all ✅ in Phụ lục A) are AD-14/AD-16/AD-19 contract surfaces whose existing consumers will be re-shaped by Story 46.2 with no preservation rule. |
| Every altitude-owned dimension decided/deferred/open | **PARTIAL** | Silent: committed-artifact path & regeneration trigger; which CI workflow hosts lint+contract tests; spec `servers` values; cursor-vs-offset pagination convention vs existing routes. |

---

## 3. Findings

### HIGH-1 — Inherited-invariant mis-scope: `src/api/**` doesn't exist; AD-16/AD-19 surfaces are inside this spine's scope

**Location:** ARCHITECTURE-SPINE.md "Inherited Invariants" table, row 2 (line 42).

**Finding:** The table states AD-16 + AD-19 "bind `src/api/**` — namespace khác với `api/` Express mà spine này govern; hai surface không được trộn". Reality:

- `src/api/` **does not exist** in the repository (empty `ls`).
- The surfaces those ADs define are implemented in `api/routes/`: AD-16's checkpoint API is `api/routes/checkpoints.js` mounted at `/api/checkpoints` (`api/server.js:367`); AD-19's data sources are `/api/admin`, `/api/governor`, `/api/proxies`, `/metrics/stream` — **every one of them is a ✅/⚠️ row in Phụ lục A**, i.e. inside Epic 46 scope.
- `checkpoints.js` already imports `PlatformError, ErrorTypes, SuggestedActions` from `src/core/error-envelope.js` (line 25) and emits AD-14-flavored errors to HTTP clients today.

**Impact:** The "two surfaces must not mix" framing is vacuous — there is only one surface. Worse, it hides a real constraint: `/api/checkpoints`, `/api/governor`, `/api/admin`, `/api/proxies` are operator/consumer contracts (dashboard, Nowing, `xactions checkpoints` CLI per parent AD-16/AD-19 rules 1-3). Story 46.2's envelope migration will reshape their wire format; the spine gives no rule that AD-16's checkpoint response contract (filters, status enum, resume/pause/retry endpoints) or AD-19's admin data-source contract must be preserved. An implementer reading the table concludes "not my problem — different namespace" and breaks consumers the parent spine explicitly created.

**Fix:** Rewrite the row: "AD-16/AD-19 surfaces are implemented at `api/routes/{checkpoints,governor,admin,proxies}.js` and `GET /metrics/stream` — they are **in scope** and their endpoint contracts (paths, filters, status values, response payloads under `data`) are preserved verbatim; only the envelope wrapper changes per AD-2."

### HIGH-2 — AD-3 contradicts the existing PlatformError→HTTP mapping and under-specifies the field set

**Location:** ARCHITECTURE-SPINE.md AD-3 (line 62).

**Finding:** AD-3 mandates `error.details = { retryAfter?, suggestedAction?, accountId?, platform? }`. But the codebase already contains a working AD-14 bridge with a **different shape** — `api/routes/checkpoints.js:260-269`:

```js
return res.status(err.statusCode || 400).json({
  success: false,
  error: { type: err.type, code: err.code, message: err.message, suggestedAction: err.suggestedAction },
});
```

That is `suggestedAction` **flat under `error`**, not nested in `error.details`. So AD-3 doesn't ratify the brownfield — it creates a second, competing mapping convention inside the same epic. Two route implementers will diverge (one copies the checkpoints pattern, one follows AD-3), which is the exact failure mode a spine exists to kill.

Second defect: `PlatformError.toEnvelope()` (`src/core/error-envelope.js:96-111`) emits `{code, type, message, statusCode, isRetryable, retryAfterMs, retryAfter, suggestedAction, accountId, platform, consumerId?, details?}` — up to 11 fields. AD-3 enumerates only 4 for `details`, then says "không bỏ field". Those statements conflict: an implementer who drops `isRetryable`, `retryAfterMs`, `statusCode`, or `consumerId` (the AD-20 quota field that ChainLens/Nowing consumers key on) can claim compliance with the explicit list. It also doesn't say whether HTTP status = `err.statusCode` — the existing code does this, the AD is silent.

**Impact:** Consumers parsing `error.suggestedAction` (the current wire shape) break silently; `consumerId`/`isRetryable`/`retryAfterMs` silently disappear from HTTP errors that MCP/CLI consumers of the same domain errors rely on — precisely the "vỡ âm thầm" AD-3's Prevents clause claims to stop.

**Fix:** Amend AD-3 to (a) name `checkpoints.js`'s flat shape as the precedent and pick **one** convention — either `error.suggestedAction`/`error.retryAfter` flat (ratifying existing code, simplest) or `error.details` with an explicit full field list; (b) enumerate the complete pass-through set: `type, retryAfter, retryAfterMs, isRetryable, suggestedAction, accountId, platform, consumerId, details`; (c) state `res.status(err.statusCode ?? 500)`.

### MED-1 — The `openapi.json` committed-artifact contract is unpinned (Story 46.1 ↔ 46.3 divergence)

**Location:** AD-8 (line 92), Consistency Conventions (line 107), Structural Seed (lines 122-131).

**Finding:** The spine's whole paradigm is "spec is a committed artifact consumed by codegen", yet nowhere is decided:

- **Path** — repo root `openapi.json`? `api/openapi.json`? `packages/api-client/spec.json`? The structural seed omits it entirely.
- **Producing command** — `generate:api-client` *reads* it; nothing names the script that *writes* it (`generate:spec`? part of `build`?).
- **Serving mode** — `/openapi.json` currently live-generates via `generateOpenAPISpec()` (`api/server.js:284-286`). Does the endpoint keep live-generating, or serve the committed file? If live, the committed artifact and the served spec can drift between regenerations — the "spec rot" AD-9 exists to prevent, reintroduced through the back door.
- **Regeneration trigger** — pre-commit? CI check that artifact == generated? AD-9 mandates contract tests against runtime responses but never pins artifact freshness.

**Impact:** Story 46.1 (producer) and Story 46.3 (consumer) are different units that will each choose a path and a refresh model; Epic 47 then bakes one choice into `apps/web`. This is the single most important cross-story contract in the epic and it is the one thing the spine leaves implicit.

**Fix:** Add to AD-8 or Consistency Conventions: artifact path (e.g. `api/openapi.json`), producing script name, freshness rule (CI fails if `git diff` on artifact after regen), and whether `/openapi.json` serves the artifact or the live builder.

### MED-2 — `/metrics/stream` misclassified as SSE; it is a plain JSON endpoint owned by parent AD-17

**Location:** AD-4 exclusion list (line 68); mirrors Phụ lục A row (`/metrics/stream` — "SSE — exclusion").

**Finding:** `api/server.js:398-408` implements `GET /metrics/stream` as `res.json(metrics)` — a synchronous JSON response, not SSE. Parent AD-17 defines it as the Redis-stream metrics endpoint returning `{eventsPerSecond, pendingMessages, consumerLag, ...}`. The exclusion outcome is defensible (its shape is owned by AD-17's contract), but the stated reason is factually wrong — an implementer hunting for the SSE plumbing will find none, and the endpoint's error branch (`server.js:406`, `{error: msg}`) silently stays non-enveloped under a wrong label.

**Fix:** Change the exclusion rationale to "owned by parent AD-17 stream-metrics contract (shape fixed upstream), excluded from AD-2 envelope" — the exclusion survives, the reasoning becomes checkable.

### MED-3 — AD-7's try-it-out disabling mechanism is not enforceable as written

**Location:** AD-7 (line 86).

**Finding:** "`x-tryitout: false` hoặc `supportedSubmitMethods` tương đương" — corroborated by `review-reality-check.md` Finding 3: `x-tryitout` is not a swagger-ui extension (ignored), and `supportedSubmitMethods` is a *global, method-level* filter — it cannot disable POST `/api/posting/tweet` while leaving POST `/api/auth/login` executable. Per-operation try-it-out gating requires a small swagger-ui plugin wrapping `allowTryItOutFor`, passed via `swagger-ui-express` `swaggerOptions.plugins`. As written, the Rule cannot be implemented and the safety AC in Story 46.1 ("Try-it-out chỉ thực thi request thật trên read-only endpoints") fails silently — mutations on real accounts become clickable.

**Fix:** AD-7 must name the mechanism: "custom swagger-ui plugin wrapping `allowTryItOutFor` driven by a per-operation extension (e.g. `x-tryitout: false` emitted by the spec builder)".

### LOW-1 — `supertest 7.3.0` is an undeclared major bump; repo pins `^6.3.4`

Stack table presents it as neutral ("repo-standard + 7.3.0") but `package.json:188` has `supertest ^6.3.4`. Either flag the bump explicitly or pin `^7.2.2`/repo-current. (Sibling review also flags the `@types/express@^5` vs `express@^4` skew relevant to typed middleware.)

### LOW-2 — Silent operational dimensions

- Spec `servers` values: Story 46.1 AC requires "localhost + production"; existing spec has only `{url: 'https://xactions.app'}` (`api/openapi.js:1003`). Which localhost (PORT 3001)? Undecided.
- Which CI workflow hosts the redocly lint + contract tests (`ci.yml` exists; AD-9 says "CI chạy" without naming it).
- API-layer error-code taxonomy location — "taxonomy của API layer" (AD-3) is referenced but its owning file is never named (`envelope.js`? a constants module?).
- Pagination convention: AD-2 mandates `page:{cursor?,limit,total?}` while existing in-scope routes paginate `limit`/`offset` (`checkpoints.js:166-178`) — reconcile or explicitly grandfather offset params inside `page`.

### LOW-3 — Deferred item misdescribes current state

"Per-deployment spec cho serverless.js — hiện serve cùng document **với caveat trong `info.description`**" — no such caveat exists (`api/openapi.js:949-952`). The epic requires *adding* it. Reword to "serverless.js serves the same document; the 503-caveat in `info.description` is added in Story 46.1; trimmed per-deployment spec deferred".

### LOW-4 — `workspaces` enablement is a topology change, understated

Corroborating `review-reality-check.md` Finding 2: root `package.json` has no `workspaces`; `packages/xactions-mcp` (own package-lock) and `apps/{api,web}` already exist as an unwired pseudo-monorepo. Turning on `workspaces: ["packages/*"]` re-resolves node_modules and sweeps `xactions-mcp` into hoisting. AD-8 treats it as one line; it deserves an explicit "install/lockfile audit" note. Related phantom-dep hazard: `src/analytics/viralStatsStore.js:13` imports `zod` with no declared dep — adding `zod@4` flips it from transitive v3. Spine never mentions it (sibling Finding 1).

---

## 4. What the spine gets right (verified)

- Error-shape diversity claim (AD-2) — verified across `server.js:702-714`, `auth.js:34`, rate-limiter `message:{error}` payloads, express-validator `{errors:[]}`.
- x402 preservation (AD-7) — `x-payment-info`, `x-bazaar`, `x-x402`, `securitySchemes.{x402Payment,sessionCookie}`, `/.well-known/x402`, `openapi:'3.1.0'` all present in `api/openapi.js`; CORS `origin:'*'` on `/openapi.json` verified (`server.js:282-291`).
- Dual mounts AD-9 — `/governor` + `/api/governor` (`server.js:372-373`), dual `/api/analytics` (`server.js:354,362`) verified.
- CSP reasoning — `scriptSrc` allows `'self'` + jsdelivr only (`server.js:126-140`); self-hosted swagger-ui is the right call.
- express-validator coexistence claim — `session-auth.js:8,64-65` verified.
- Dependency-direction rule and exclusion list — correct, enforceable, match epic.
- Partial conformance precedent: `checkpoints.js` already emits `{success:true,data}` / `{success:false,error:{...}}` — the envelope target shape is already proven in-repo (the spine should have *named* it as precedent rather than contradicting it).

---

## 5. Required actions before story freeze

1. Fix Inherited Invariants row 2 per HIGH-1 (AD-16/AD-19 surfaces are in-scope `api/routes/*`; their contracts preserved).
2. Rewrite AD-3 per HIGH-2: one mapping convention (ratify checkpoints.js flat shape or justify the details nest), full field enumeration, explicit status mapping.
3. Pin the `openapi.json` artifact contract per MED-1 (path, producing script, freshness check, serve mode).
4. Correct `/metrics/stream` rationale (MED-2) and AD-7 try-it-out mechanism (MED-3).
5. Address LOW-1..LOW-4 (supertest bump flag, `servers`/CI/taxonomy/pagination notes, serverless caveat wording, workspaces audit + zod phantom-dep step in 46.2).
