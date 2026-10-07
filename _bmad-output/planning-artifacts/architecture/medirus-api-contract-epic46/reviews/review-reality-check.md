---
review: reality-check
spine: ARCHITECTURE-SPINE.md (xactions-api-contract-epic46)
lens: "Verify every committed decision was web-researched or reality-checked rather than asserted from training data: current library/framework versions, that each named technology still exists and fits, and — greenfield — the live defaults of any starter it leans on."
method: npm registry (`npm view` versions + peerDependencies) + direct repo inspection + web search (swagger-ui try-it-out semantics)
verdict: PASS WITH CONDITIONS
---

# Reality-Check Review — XActions API Contract Spine (Epic 46)

## Verdict: PASS WITH CONDITIONS

Every pinned version exists on npm at exactly the pinned version, and every repo claim I checked is true. The flagged risks are not wrongness but **un-flagged interactions**: a phantom zod dependency that will silently flip 3→4, a workspaces enablement that is bigger than the spine admits, and a Swagger UI try-it-out mechanism that doesn't work as written without a custom plugin.

## A. Pinned versions — verified against live npm registry

| Package | Pin | Registry status | Fit |
| --- | --- | --- | --- |
| zod | 4.6.5 | EXISTS (latest 4.x line; 4.6.x published after 4.5.x canaries) | ✅ — but see Finding 1 |
| @asteasolutions/zod-to-openapi | 9.1.0 | EXISTS (9.0.0, 9.1.0 both published) | ✅ **peerDependencies = `zod: ^4.0.0`** — the feared zod4/zto9 incompatibility is FALSE; v9 *requires* zod 4 |
| swagger-ui-express | 5.0.1 | EXISTS (5.0.0, 5.0.1) | ✅ peer `express: >=4.0.0 \|\| >=5.0.0-beta` — fits repo's `express ^4.21.2` |
| openapi-typescript | 7.13.0 | EXISTS (7.x line through 7.13.0) | ✅ supports OpenAPI 3.1 input, which `api/openapi.js` emits (`openapi: '3.1.0'`, line 945) |
| @redocly/cli | 2.54.2 | EXISTS (2.x line real; 2.54.2 is latest) | ✅ |
| supertest | 7.3.0 | EXISTS | ⚠️ repo declares `supertest ^6.3.4` — pin is a major bump, needs devDep update |
| vitest | repo-standard | `vitest ^4.0.18` in devDeps; `test: vitest run` script present | ✅ confirmed |

**zod-to-openapi × zod-4 compatibility: CONFIRMED SAFE.** `npm view @asteasolutions/zod-to-openapi@9.1.0 peerDependencies` → `{ zod: '^4.0.0' }`. The specific breaking-fit risk called out in the review brief does not exist — v9 is the zod-4 line (v8 introduced 4.x support / `OpenApiGeneratorV31`).

## B. Repo claims — verified

| Claim | Result |
| --- | --- |
| `api/openapi.js` exists, serves x402 extensions | ✅ `x-payment-info`, `x-bazaar`, top-level `x-x402`, `securitySchemes.x402Payment`, `openapi: '3.1.0'` all present (lines 945–1106+) |
| `/docs/:slug` mount exists | ✅ `api/server.js:465` (flat variant; also `:section/:slug` at 458 and 3-level at 451) |
| helmet CSP | ✅ `server.js:126–140` — `scriptSrc` = `'self'`, `'unsafe-inline'`, cdn.socket.io, cdn.jsdelivr.net. Spine's "CSP chặn CDN ngoài jsdelivr" is accurate; self-hosted swagger-ui assets fit under `'self'` + `'unsafe-inline'` |
| express-validator in session-auth.js | ✅ `api/routes/session-auth.js:8` imports `body, validationResult` |
| `src/core/error-envelope.js` shape | ✅ `PlatformError` carries `code`, `type`, `message`, `statusCode`, `retryAfterMs`/`retryAfter`, `suggestedAction`, `accountId`, `platform` — matches AD-14 as inherited (toEnvelope() lines 95–111) |
| root package.json lacks workspaces | ✅ CONFIRMED — no `workspaces` field |
| `api/routes/` ~55 files | ✅ 54 files + 1 subdir (`ai/`) = 55 entries |
| `GET /openapi.json` CORS `origin:'*'` | ✅ `server.js:282–286` (`openCors = { origin: '*' }`) |
| `/.well-known/x402` exists | ✅ `server.js:288–291` |
| Component names `Error`/`SuccessResponse`/`PaymentRequired` already in spec | ✅ `openapi.js:1041–1071` — AD-8's dedupe warning is grounded, not hypothetical |
| express version for swagger-ui-express fit | ✅ `express ^4.21.2` (Express 4) — satisfies peer range |
| Route Inventory in epics.md | ✅ Phụ lục A exists (~50 mount rows), consistent with "~50 mount groups" claim in AD-2/AD-4 |

## C. Findings

### Finding 1 (MEDIUM) — Phantom zod dependency will silently flip 3→4
`src/analytics/viralStatsStore.js:13` does `import { z } from 'zod'` but **zod is not declared in package.json** — it resolves to a transitive **zod 3.25.76** (hoisted via abitype/remotion/hono et al.). Adding `zod@4.6.5` as a direct dep flips that file's import to v4 with zero diff in the file itself. The file's surface usage (`z.object`, `z.enum`, two-arg `z.record`, `z.string().datetime()`) is mostly v4-compatible, but this is exactly the class of silent break the spine's AD-1 "single source of truth" story should have caught. **Action for Story 46.2: declare zod, then smoke-test `viralStatsStore` schema parse paths.** Spine does not mention this.

### Finding 2 (MEDIUM) — `workspaces` enablement is a topology change, not a script addition
AD-8 says `@xactions/api-client` resolves "qua root `workspaces`" — true, root has no workspaces field (verified). But the repo is already an *unwired* pseudo-monorepo: `packages/xactions-mcp/` (name `xactions-mcp`) and `apps/{api,web}/` exist as directories; `apps/web` is a scaffold (only `public/`, no package.json). Turning on npm workspaces will re-resolve node_modules, regenerate package-lock, and can surface *other* phantom deps like Finding 1. Spine treats this as one line in AD-8; it's a package-manager topology change deserving an explicit step + install audit.

### Finding 3 (LOW–MEDIUM) — Per-operation try-it-out disabling is not a built-in swagger-ui feature
AD-7 writes "`x-tryitout: false` hoặc `supportedSubmitMethods` tương đương". Web-verified: `supportedSubmitMethods` is a **global** config filtered by HTTP *method* only (swagger-ui PR #4186) — it cannot disable try-it-out for specific operations (e.g. POST tweet while leaving POST auth). `x-tryitout` is **not** a recognized swagger-ui extension; it would be ignored unless a custom plugin wraps the `allowTryItOutFor` selector (the documented `DisableTryItOutPlugin` pattern via `wrapSelectors`). The hedged phrasing saves it from being false, but a reader will assume it's a config toggle. **Reality: needs a small swagger-ui plugin passed via `swagger-ui-express`'s `swaggerOptions.plugins` — write that into Story 46.1 acceptance.**

### Finding 4 (LOW) — `/docs/:slug` collision mechanism is imprecise
`/api-docs` cannot match `/docs/:slug` (different literal prefix). The real mount-order hazard is the global JSON 404 handler at `server.js:712–714` — which, note, returns `{error: 'Route not found'}`, i.e. one of the non-envelope shapes AD-2 exists to kill. Mounting `/api-docs` early is still correct advice; the stated reason is wrong. Trivial fix in wording.

### Finding 5 (LOW) — Pre-existing type/runtime skew
`@types/express ^5.0.0` vs `express ^4.21.2`, and `supertest ^6.3.4` vs pinned `7.3.0`. Not spine-introduced, but Epic 46 adds typed middleware (`validate.js`) — the express-5 types against express-4 runtime can produce false-negative type errors. Worth a devDep hygiene line item.

## D. Things checked and NOT problems

- **No greenfield starter is leaned on** — spine builds inside the existing Express app; nothing to compare against starter defaults. N/A by design.
- **CSP × Swagger UI**: self-hosted bundle needs `script-src 'self'` + inline init (covered by `scriptSrcAttr: 'unsafe-inline'`) — current helmet config suffices; spine's CDN reasoning is correct.
- **openapi-typescript 7.x × OpenAPI 3.1**: 3.1 input supported since the 6.x line; fine.
- **Node engines `>=20.18.1`** (runtime v26.5.0): satisfies vitest 4 / redocly 2 / openapi-typescript 7 minimums.
- **`api/routes/schemas.js` vs proposed `api/schemas/` dir**: different paths, no filesystem collision; cosmetic naming adjacency only.
- **Existing `Error`/`SuccessResponse`/`PaymentRequired` components** (openapi.js:1041–1071): AD-8's dedupe rule is grounded in the real spec.

## E. Bottom line

Nothing in the spine is asserted from stale training data — every pin exists, every repo fact checks out, and the one scary compatibility question (zod-to-openapi 9 × zod 4) resolves cleanly in the spine's favor at the registry level. Conditions before commit: (1) add a zod-declaration + phantom-dep audit step to Story 46.2; (2) spell out that workspaces enablement requires an install/lockfile audit; (3) replace "`x-tryitout`/`supportedSubmitMethods`" with "custom swagger-ui plugin wrapping `allowTryItOutFor`" in Story 46.1; (4) fix the `/docs/:slug` rationale to name the global 404 handler.
