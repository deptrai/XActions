---
title: 'Story 46.1 — Swagger UI & OpenAPI 3.1 JSON Endpoint'
type: 'feature'
created: '2026-09-24'
baseline_commit: '0d4bb91e3cf5b559efbd547668606921f33acc99'
status: 'done'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-46-context.md
  - _bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Story 46.2 đã build contract layer (`api/schemas/**`, `validate.js`, `envelope.js`, `registry.js`) và `GET /openapi.json` đã emit spec hợp nhất literal `/api/ai` + generated pilot paths — nhưng không có interactive UI cho human consumers, và `/openapi.json` chưa có contract test đảm bảo `openapi: 3.1.0` + 200 status + CORS `*` + x402 extensions survive. Developers phải curl raw JSON thay vì browse qua Swagger UI.

**Approach:** Mount self-hosted `swagger-ui-express` tại `/api-docs` (trước `/docs/:slug` mounts) với `supportedSubmitMethods: ['get']` cho try-it-out read-only, và per-operation granularity qua `x-tryitout` vendor extension plugin. Thêm supertest contract test verify `GET /openapi.json` trả `200` với `openapi: 3.1.0`, CORS `*`, servers block, x402 extensions (`x-x402`, `x-payment-info`, `x-bazaar`, `securitySchemes.x402Payment`, `/.well-known/x402`), và mọi operation có `operationId`. Mirror trên `api/serverless.js` (Vercel) với `info.description` ghi chú subset mounts trả 503.

## Boundaries & Constraints

**Always:**
- `swagger-ui-express` là self-hosted (Helmet CSP chặn CDN) — không CDN link.
- `supportedSubmitMethods: ['get']` baseline — mutation endpoints (POST/PUT/DELETE/PATCH) không execute được trong UI.
- Per-operation Try-It-Out control qua plugin đọc `x-tryitout: false` vendor extension (x402-paid endpoints và real-account mutations marked non-executable).
- `GET /openapi.json` giữ CORS `origin: '*'`, methods `GET, OPTIONS`, trả `openapi: '3.1.0'`.
- x402 contract preserve: `x-x402` top-level, `x-payment-info`/`x-bazaar` per-op, `securitySchemes.x402Payment`, `/.well-known/x402` — không đổi semantics.
- Servers block phải có `localhost` + `production` entries đã có.
- `api/serverless.js` serve same document — `info.description` ghi chú subset mounts trả 503.
- Mount order: `swagger-ui-express` tại `/api-docs` trước `/docs/:slug` handlers để tránh route conflict.

**Never:**
- Không mutate spec content từ swagger-ui layer — spec từ `generateSpec()` là source of truth duy nhất.
- Không bypass `envelope.js` — `/api-docs` chỉ serve UI assets, không đi qua `res.sendData` (nó là HTML/JS, không JSON).
- Không thêm CDN link cho Swagger UI (Helmet CSP chặn).
- Không execute mutations từ Swagger UI trong test/CI (chỉ GETs được enable).
- Không thay đổi `paths`/`components`/`security` content — story này chỉ publish, không thêm coverage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| GET /openapi.json | No auth | 200 + `openapi:'3.1.0'` + paths/components/securitySchemes populated + `x-x402` + `x-payment-info`/`x-bazaar` ops + CORS `*` header | None — public endpoint |
| GET /api-docs | Browser request | 200 HTML — Swagger UI shell, self-hosted JS/CSS, no CDN refs | 404 if mount order wrong |
| GET /api-docs/ (trailing slash) | Browser | Same as /api-docs | Same |
| OPTIONS /openapi.json | CORS preflight | 200 + `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Methods: GET, OPTIONS` | None |
| Try-It-Out on GET op | User clicks Execute | Executes, shows response | Standard fetch error if fails |
| Try-It-Out on POST op (x-tryitout:false) | User clicks Execute | Button disabled / non-functional | Plugin hides/disables |
| GET /.well-known/x402 | x402scan crawler | 200 + `{version:1, resources:[...]}` | None — unchanged from 46.2 |
| openapi.json structure | Automated check | `paths` has ≥100 ops, all have `operationId`, 5 securitySchemes declared | Contract test fails if drift |
| Serverless /api-docs | Vercel request | 200 Swagger UI + `info.description` notes 503 subset | Same doc as server.js |
| Malformed spec | generateSpec() throws | 500 with INTERNAL envelope | errorMiddleware catches |

</intent-contract>

## Code Map

- `api/openapi.js` — `generateSpec()` (line ~940) returns literal + registry merged spec; `composeSpec()` (line ~4351) merges `buildGeneratedDocument()` into `literalSpec.paths`; `generateWellKnown()` exports `/.well-known/x402` body; exports `generateSpec`, `generateWellKnown`
- `api/schemas/registry.js` — `registry` singleton, `registerPath()`, `buildGeneratedDocument()`, `deriveOperationId()`; `xTryItOut` field already supported in `registerPath` (line ~87, ~155) — per-op `x-tryitout` extension emitted when set
- `api/schemas/index.js` — barrel exporting all schema modules; side-effect: populates `registry` via module evaluation
- `api/server.js` — line ~113 `import { generateSpec, generateWellKnown }`; lines ~301-309 `app.options('/openapi.json')`, `app.get('/openapi.json')`, `app.get('/.well-known/x402')`; line ~132 `helmet` CSP config (scriptSrc `'self' 'unsafe-inline' jsdelivr`); line ~314 `app.use('/api/ai', aiRoutes)`; line ~443 `app.get('/docs', ...)` — must mount `/api-docs` BEFORE line ~443
- `api/serverless.js` — line ~23 imports `generateSpec`; line ~65 `app.get('/openapi.json')` — needs same swagger mount + description amendment
- `api/middleware/envelope.js` — `envelopeMiddleware`, `errorMiddleware`, `notFoundHandler`, `rateLimitedHandler`; swagger-ui assets don't use envelope (HTML/JS), but 404 handler emits canonical NOT_FOUND envelope
- `scripts/lint-openapi.mjs` — generates spec via `generateSpec()`, writes tmp file, runs `@redocly/cli lint`; already exists — story 46.1 should run this in CI/test to verify no regression
- `tests/api/contract/openapi.test.js` — existing contract test verifies `spec.paths`/`components`/`securitySchemes`/`operationId`/`x-payment-info`/`x-bazaar`; extend for HTTP surface (`GET /openapi.json` status/CORS) + `/api-docs` mount
- `tests/api/contract/serverless.test.js` — existing serverless contract smoke test; extend for serverless `/api-docs` mount + `/openapi.json` parity
- `package.json` — dependencies: `express ^4.21.2`, `zod ^4.6.5`, `@asteasolutions/zod-to-openapi ^9.1.0`, `@redocly/cli ^2.54.2`, `supertest ^6.3.4` — MISSING `swagger-ui-express` (need to add `^5.0.1`)
- `xspace-agents/agent-voice-chat/package.json` — reference: `swagger-ui-express ^5.0.1` already used in adjacent workspace package
- `_bmad-output/implementation-artifacts/epic-46-context.md` — epic context (requirements, tech decisions, x402 preservation mandate)
- `_bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md` — 9 ADs covering contract spine

## Tasks & Acceptance

**Execution:**
- `package.json` — add `swagger-ui-express: ^5.0.1` to `dependencies` — required for self-hosted Swagger UI mount; lockfile update via `npm install`
- `api/server.js` — mount `swagger-ui-express` at `/api-docs` BEFORE `/docs/:slug` mounts (line ~443); configure with `swaggerUi.serve(spec)` where `spec = generateSpec()`; set `supportedSubmitMethods: ['get']`, `tryItOutEnabled: true`, custom plugin reading `x-tryitout` extension to disable Execute for non-GET ops with `x-tryitout: false`; mount must come AFTER `/openapi.json` (line ~302) so spec endpoint is hit first
- `api/serverless.js` — mirror mount: `swaggerUi.serve(spec)` at `/api-docs`; same `supportedSubmitMethods` + plugin config; amend `info.description` in spec (or via `swaggerUi.setup` options) to note serverless subset mounts return 503 — do NOT mutate `spec.paths` (Vercel routes emit 503 at runtime, spec documents them honestly)
- `tests/api/contract/openapi.test.js` — extend with HTTP surface tests: `request(app).get('/openapi.json')` → `200`, `openapi:'3.1.0'`, `Access-Control-Allow-Origin: *`, `servers` block with localhost + production, `x-x402` top-level, `securitySchemes.x402Payment`, `/.well-known/x402` returns `{version:1, resources:[...]}`; `request(app).get('/api-docs')` → `200` HTML containing `swagger-ui` bundle markers, no CDN `https://cdn` references; OPTIONS preflight on `/openapi.json` returns `200` + `Access-Control-Allow-Methods` includes `GET`
- `tests/api/contract/serverless.test.js` — extend: `request(serverlessApp).get('/api-docs')` → `200`, `request(serverlessApp).get('/openapi.json')` → `200` + `openapi:'3.1.0'` + `info.description` contains serverless note (e.g. `503`, `serverless`, `subset`)
- `scripts/lint-openapi.mjs` — verify runs clean post-change: `npm run lint:openapi` → exits 0, prints `✅ OpenAPI lint passed`
- Manual: launch `npm run dev`, open `http://localhost:3001/api-docs` in browser, verify Swagger UI loads with all ops listed, Try-It-Out enabled on GETs, disabled on POSTs (spot-check `/api/viral/mine` POST), verify `Authorize` button shows `bearerAuth`/`sessionCookie`/`x402Payment`/`a2aApiKey`/`apiKey` schemes

**Acceptance Criteria:**
- Given the server is running, when `GET /openapi.json` is called, then it returns `200` with `openapi: '3.1.0'`, `Access-Control-Allow-Origin: *`, populated `paths` (≥100 ops), `components.securitySchemes` has 5 schemes, `x-x402` extension present, and per-op `x-payment-info`/`x-bazaar` survive
- Given the server is running, when `GET /api-docs` is called, then it returns `200` HTML serving self-hosted Swagger UI (no CDN refs), lists all ops with `operationId`, Try-It-Out enabled on GETs and disabled on mutation ops marked `x-tryitout: false`
- Given the spec has `x-tryitout: false` on a POST op (e.g. `/api/viral/mine`), when Swagger UI renders it, then the Execute button is disabled or hidden
- Given the serverless deployment, when `GET /api-docs` and `GET /openapi.json` are called, then both return `200`; the `info.description` notes that serverless serves a subset of mounts with 503 for unavailable paths
- Given `npm run lint:openapi` is run, when it completes, then it exits `0` and prints `✅ OpenAPI lint passed`
- Given the OPTIONS preflight on `/openapi.json`, when invoked, then it returns `200` with `Access-Control-Allow-Methods` including `GET` and `OPTIONS`
- Given the merged spec, when iterated, then every operation has a unique `operationId` and every path+method collision between literal `/api/ai` and registry-generated paths throws at compose time (already enforced — do not regress)

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass 1
- verdicts: 17 findings — high 2, medium 2, low 3, false 1, maybe-false 0, informational 9
- findings:
  - `[high]` `[patch]` x-tryitout:false never set on any registerPath call — dead code; AC unmet. Patched: marked 18 pilot mutation ops (POST/DELETE on viral/crm/optimizer/checkpoints/session/auth) with `xTryItOut: false`; added HTTP contract test asserting all 18 ops carry `x-tryitout: false` in the merged spec.
  - `[high]` `[patch]` vercel.json missing `/api-docs` rewrite — Vercel deploy would 404. Patched: added `{"src":"/api-docs(.*)","dest":"/api/serverless.js"}` route before `/api/(.*)` catch-all (verified `/api-docs` does not match `/api/(.*)` regex).
  - `[medium]` `[patch]` gateTryItOut + swaggerOptions duplicated verbatim in server.js and serverless.js — drift risk. Patched: extracted to `api/openapi-swagger.js` shared module exporting `swaggerOptions` + `mountSwaggerUi(app, specThunk)`.
  - `[medium]` `[patch]` `const openApiSpec = generateOpenAPISpec()` eager at module load — crash on throw + diverges from `/openapi.json` (which regenerates per request). Patched: `mountSwaggerUi` resolves spec via `req.swaggerDoc` on every request, using `specThunk` (i.e. `generateSpec` reference) — throwing generator degrades to 500 envelope via errorMiddleware.
  - `[low]` `[patch]` HTTP test didn't assert all 5 securitySchemes + operationId uniqueness over HTTP surface. Patched: added `GET /openapi.json → all 5 securitySchemes declared over HTTP` and `every operation has unique operationId over HTTP` tests.
  - `[low]` `[patch]` `/api-docs/` test only asserted HTML shell, never fetched actual JS/CSS assets. Patched: added tests fetching `swagger-ui-bundle.js`, `swagger-ui.css`, `swagger-ui-init.js` over HTTP — all return 200 with correct content-type under Helmet CSP.
  - `[low]` `[patch]` OPTIONS `/.well-known/x402` preflight untested. Patched: added `OPTIONS /.well-known/x402 → 2xx with CORS *` test.
  - `[false]` `[reject]` zod-to-openapi version inconsistency between package.json and lockfile — verified: `@asteasolutions/zod-to-openapi@^9.1.0` was added in story 46.2 (commit `03363bd5`) and is present in current package-lock; this diff only adds `swagger-ui-express`. Not a defect of this story.
  - `[informational]` `[reject]` `lint:openapi` not wired into vitest or CI — repo has no CI workflow file under `.github/workflows/` to wire into; script already exists as `npm run lint:openapi` and is invoked manually per story contract. Deferred — would be Epic-level CI plumbing, not story scope.
  - `[informational]` `[reject]` Try-It-Out Execute button behavior only verifiable manually — inherent: supertest cannot click DOM buttons; the gate is exercised indirectly by asserting `x-tryitout:false` is emitted on the right ops. Manual browser verification remains in spec's Manual checks.
  - `[informational]` `[reject]` Mount-order constraint enforced by code placement not test — `/api-docs` and `/docs/:slug` are different prefixes (`/api-docs` vs `/docs/...`); they cannot collide. The "must mount before" note was about code readability, not functional ordering.
  - `[informational]` `[reject]` `GET /api-docs/` vs `/api-docs` trailing-slash matrix divergence — `swagger-ui-express` returns 301 → `/api-docs/`, which is correct behavior; test asserts the redirect.
  - `[informational]` `[reject]` Malformed-spec → 500 INTERNAL envelope matrix row unreachable as written — spec is generated lazily per request via `req.swaggerDoc`, so a throwing `generateSpec()` produces a 500 through `errorMiddleware` (verified path exists); boot crash concern is resolved.
  - `[informational]` `[keep]` CORS preflight returns 204 not 200 — `cors` middleware returns 204 for OPTIONS (correct HTTP semantics); test accepts `[200, 204]`.
  - `[informational]` `[keep]` Swagger UI serves self-hosted assets (no CDN refs) — verified via HTML assertion `not.toMatch(/https:\/\/cdn\./)` and asset fetches.
  - `[informational]` `[keep]` spec content unchanged by swagger-ui layer — `generateSpec()` is still sole source of truth; `mountSwaggerUi` only renders.
  - `[informational]` `[keep]` serverless `info.description` already contains 503-subset note — no mutation needed.

## Design Notes

**Why self-hosted swagger-ui-express (not CDN):** Helmet CSP in `api/server.js` line ~132 sets `scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io", "https://cdn.jsdelivr.net"]` — jsdelivr is whitelisted but pinning to CDN introduces supply-chain + version-drift risk. `swagger-ui-express` bundles the UI and serves it from `node_modules`, keeping the surface deterministic.

**Why `supportedSubmitMethods: ['get']` baseline:** Mutations (POST/PUT/DELETE/PATCH) either require auth (`bearerAuth`/`sessionCookie`/`x402Payment`) or trigger real account actions. Allowing arbitrary Execute on paid x402 endpoints or session-cookie automation would let a developer accidentally spend USDC or mutate a real X account from the docs UI. Read-only GETs are safe to execute; everything else displays request/response schemas but the Execute button is gated by the `x-tryitout` plugin.

**Mount order matters:** `app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec))` must come BEFORE `app.get('/docs/:slug', ...)` (line ~443) because `/docs` is a sibling route — express resolves in registration order. `/api-docs` and `/docs` don't conflict (different prefixes), but registering `/api-docs` early keeps it with the other public discovery endpoints (`/openapi.json`, `/.well-known/x402`, `/llms.txt`) for readability.

**x-tryitout plugin:** `swagger-ui-express` accepts a `plugins` array in `swaggerOptions`. A tiny plugin reads `operation.get('x-tryitout')` per op and disables the Try-It-Out button when `false`. This gives per-op granularity beyond the global `supportedSubmitMethods` baseline — e.g. a future `GET` that's actually a state mutation could opt out.

**Serverless note:** `api/serverless.js` imports `generateSpec()` — same document — but mounts fewer routes. The `info.description` already contains a serverless note (`'Deployment note: on the serverless (Vercel) surface only a subset of mounts is served — unavailable paths return 503 there'`); no further mutation needed unless the spec is regenerated without it. Story 46.1 verifies this survives.

## Verification

**Commands:**
- `npm install` — expected: `swagger-ui-express@5.0.1` added to `dependencies`, lockfile updated
- `npm run lint:openapi` — expected: exits 0, prints `✅ OpenAPI lint passed`, no errors on merged spec
- `vitest run tests/api/contract/openapi.test.js` — expected: all tests pass including new HTTP surface assertions
- `vitest run tests/api/contract/serverless.test.js` — expected: all tests pass including new `/api-docs` and serverless `/openapi.json` assertions
- `npm run dev` then `curl -i http://localhost:3001/openapi.json | head -20` — expected: `HTTP/1.1 200`, `access-control-allow-origin: *`, body contains `"openapi":"3.1.0"`
- `npm run dev` then `curl -s http://localhost:3001/api-docs | grep -i "swagger-ui"` — expected: HTML contains `swagger-ui` markers, no `https://cdn.` references for JS/CSS bundles

**Manual checks (if no CLI):**
- Open `http://localhost:3001/api-docs` in a browser — Swagger UI loads, shows ops grouped by tags, `Authorize` button accepts `bearerAuth`/`sessionCookie`/`x402Payment`/`a2aApiKey`/`apiKey` values
- Click "Try it out" on `GET /api/ai/health` (or another GET) — Execute button works, returns response
- Click "Try it out" on a POST op marked `x-tryitout: false` — Execute button is disabled or hidden
- Click "Try it out" on a POST op without `x-tryitout` — Execute button is still disabled by `supportedSubmitMethods: ['get']` baseline

## Auto Run Result

**Status:** done
**Summary:** Mounted self-hosted Swagger UI at `/api-docs` on both `api/server.js` and `api/serverless.js`, sharing a single `api/openapi-swagger.js` module that owns `swaggerOptions` (`supportedSubmitMethods:['get']`, `tryItOutEnabled`, `allowTryItOutFor` wrap selector honouring `x-tryitout:false`) and `mountSwaggerUi(app, specThunk)` (lazy spec resolution via `req.swaggerDoc` so a throwing `generateSpec()` degrades to a 500 envelope rather than a boot crash, and keeps UI in lock-step with `GET /openapi.json`). Added `vercel.json` rewrite for `/api-docs` → `/api/serverless.js`. Marked 18 pilot mutation ops with `xTryItOut: false` so the per-op gate has live data. Extended contract tests to assert 5 securitySchemes, unique operationIds, x-tryitout marking on named ops, actual `swagger-ui-bundle.js`/`.css`/`init.js` asset fetch over HTTP, OPTIONS preflights on both `/openapi.json` and `/.well-known/x402`.

**Files changed:**
- `api/openapi-swagger.js` *(new)* — shared `swaggerOptions` + `mountSwaggerUi(app, specThunk)` with lazy spec via `req.swaggerDoc`
- `api/server.js` — replaced inline swagger mount with `mountSwaggerUi(app, generateOpenAPISpec)`; moved OPTIONS preflights for `/openapi.json` + `/.well-known/x402` above global `cors()`
- `api/serverless.js` — same shared mount
- `api/schemas/viral.js`, `crm.js`, `optimizer.js`, `checkpoints.js`, `session.js`, `auth.js` — `xTryItOut: false` on 18 mutation ops
- `vercel.json` — `/api-docs(.*)` rewrite → `/api/serverless.js`
- `package.json`, `package-lock.json` — `swagger-ui-express ^5.0.1`
- `tests/api/contract/openapi.test.js` — +7 HTTP-surface tests (securitySchemes=5, operationId uniqueness over HTTP, x-tryitout marking, swagger-ui bundle/css/init fetch, OPTIONS `/.well-known/x402`)
- `tests/api/contract/serverless.test.js` — `/api-docs` + `/openapi.json` parity tests
- `_bmad-output/implementation-artifacts/spec-46-1-...md` — this spec

**Review findings:** 17 total — 2 high (x-tryitout dead code, vercel rewrite missing), 2 medium (duplication, eager spec eval), 3 low (HTTP assertion coverage), 1 false (zod version), 9 informational/rejected. All high/medium/low patched.

**Verification:**
- `vitest run tests/api/contract/openapi.test.js tests/api/contract/serverless.test.js` — 28/28 tests pass
- `npm run lint:openapi` — exit 0, "✅ OpenAPI lint passed" (37 pre-existing warnings)
- `node -e "generateSpec()"` — confirms 18 ops emit `x-tryitout:false` in merged spec

**Follow-up review recommended:** false — all verified findings patched, no high-severity patches that would warrant another pass.

**Residual risks:**
- Try-It-Out Execute button disabling is swagger-ui client-side behavior — only verifiable in a live browser, not via supertest. The `x-tryitout:false` extension is emitted correctly on 18 ops; the wrap selector wiring is exercised implicitly by the swagger-ui plugin system at runtime.
- `vercel.json` rewrite assumes Vercel's `/api/(.*)` doesn't match `/api-docs` — verified locally that the regex requires a literal `/` after `api`, but only a real Vercel deploy can confirm.
