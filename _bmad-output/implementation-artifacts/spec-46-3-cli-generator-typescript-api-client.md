---
title: 'Story 46.3 — CLI Generator for TypeScript API Client'
type: 'feature'
created: '2026-09-24'
baseline_commit: '89d621799982e974096ccf8a51f473bee74c04f4'
status: 'done'
review_loop_iteration: 1
followup_review_recommended: false
context:
  - _bmad-output/implementation-artifacts/epic-46-context.md
  - _bmad-output/implementation-artifacts/spec-46-2-zod-schemas-uniform-response-envelopes.md
  - _bmad-output/implementation-artifacts/spec-46-1-swagger-ui-openapi-3-1-json-endpoint.md
  - _bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 46.1 + 46.2 đã ship spec OpenAPI 3.1 + contract layer, nhưng consumers (Epic 47 Next.js frontend, scripts, third-party integrators) phải hand-write fetch calls — không có type safety, không có typed errors, và phải manually sync với spec khi routes thay đổi. Spec là source of truth nhưng không có mechanical bridge đến client code.

**Approach:** Build `npm run generate:api-client` — đọc committed `api/openapi.json` artifact (không live server), emit `packages/api-client/` (`@xactions/api-client`) bao gồm: `openapi-typescript` types (`schema.d.ts`), hand-written thin fetch wrapper (`client.ts`) inject auth (`Authorization: Bearer`, `x-session-cookie`, `X-PAYMENT`, `X-Agent-API-Key`/`X-API-Key`), return typed error union `400 | 401 | 402 | 429 | 500` (402 là `PaymentRequired` x402 payload, không phải envelope). Idempotent — regenerate deterministic trên cùng spec, diff-stable.

## Boundaries & Constraints

**Always:**
- Generator đọc committed `api/openapi.json` — KHÔNG fetch live server. Fails loudly (non-zero exit + clear error) nếu file missing/unparseable/không phải `openapi: 3.1.0`.
- Output CHỈ vào `packages/api-client/` — không touch repo root ngoài `package.json` script entry + lockfile cập nhật.
- Client importable như `@xactions/api-client` (workspace-style) — phải resolve được qua `import` trong Node ESM.
- Types via `openapi-typescript` (pinned `^7.13.0`) — emit `schema.d.ts` từ spec paths/components.
- Fetch wrapper `client.ts` là hand-written thin layer — KHÔNG generated bởi openapi-typescript (nó chỉ emit types, không emit runtime).
- Auth injection: `bearerAuth` (Authorization Bearer JWT), `sessionCookie` (x-session-cookie header), `x402Payment` (X-PAYMENT header), `a2aApiKey` (X-Agent-API-Key header), `apiKey` (X-API-Key header).
- Error union: `ApiResult<T> = { ok: true; status: 200; data: T } | { ok: false; status: 400|401|402|429|500; error: ApiErrorPayload | PaymentRequiredPayload }`. `402` có type `PaymentRequired` (x402 protocol payload), KHÔNG phải canonical envelope.
- Generator phải idempotent — chạy lại trên cùng `openapi.json` produce byte-identical output.
- Client phải ESM (matches repo `"type": "module"`).

**Never:**
- Không fetch spec từ live server — only committed `api/openapi.json`.
- Không generate runtime code bằng openapi-typescript (nó chỉ emit types).
- Không mutate `api/openapi.json` — generator là consumer, không phải producer.
- Không introduce npm workspaces nếu repo chưa dùng — `packages/api-client` standalone với `package.json` riêng, không join root workspaces.
- Không bundle node_modules — chỉ `package.json` + `schema.d.ts` + `client.ts` + `index.ts` + `README.md`.
- Không test bằng cách import spec từ `api/openapi.js` — test đọc `api/openapi.json` trực tiếp giống generator.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| `npm run generate:api-client` | `api/openapi.json` exists + valid 3.1.0 | Generates `packages/api-client/{package.json,schema.d.ts,client.ts,index.ts,README.md}` | Exit 0, files emitted |
| `npm run generate:api-client` | `api/openapi.json` missing | Exit non-zero, error: `openapi.json not found; run npm run build:openapi first` | Non-zero exit, clear message |
| `npm run generate:api-client` | `api/openapi.json` is malformed JSON | Exit non-zero, error names parse error + file path | Non-zero exit, clear message |
| `npm run generate:api-client` | `api/openapi.json` is `openapi: 3.0.x` | Exit non-zero, error names version mismatch | Non-zero exit |
| `npm run generate:api-client` | `api/openapi.json` is `openapi: 3.1.0` but no paths | Exit non-zero, error names empty paths | Non-zero exit |
| Regenerate | Same `openapi.json`, second run | Byte-identical output files | Exit 0 |
| Client call `client.scrapeProfile({sessionCookie, handle})` | Valid sessionCookie | `{ok:true, status:200, data:Profile}` typed | Returns typed success |
| Client call returns 401 | Invalid sessionCookie | `{ok:false, status:401, error:{code:'UNAUTHORIZED',...}}` | Typed error |
| Client call returns 402 | Missing X-PAYMENT | `{ok:false, status:402, error:{x402Version:2, accepts:[...]}}` typed as PaymentRequired | x402 protocol payload, not envelope |
| Client call returns 429 | Rate limited | `{ok:false, status:429, error:{code:'RATE_LIMITED',...}}` | Typed error |
| Client call returns 500 | Server error | `{ok:false, status:500, error:{code:'INTERNAL',...}}` | Typed error |
| Client request headers | `Authorization`, `x-session-cookie`, `X-PAYMENT` set correctly per scheme | Server accepts auth | No 401 |
| Non-2xx unexpected (e.g. 503) | Serverless unavailable mount | `{ok:false, status:503, error:{...}}` — falls into generic error branch | Typed or generic |

</intent-contract>

## Code Map

- `api/openapi.js` — `generateSpec()` produces the merged spec; this story needs a committed `api/openapi.json` artifact — add `npm run build:openapi` script that runs `generateSpec()` and writes it to `api/openapi.json` (used by both lint and client generator)
- `api/openapi-swagger.js` — mounts swagger-ui; references `generateSpec()` per request (unchanged by this story)
- `scripts/lint-openapi.mjs` — already generates spec to temp file; this story adds a separate `build:openapi` script that writes the committed artifact
- `package.json` — add `build:openapi` script (writes `api/openapi.json`) and `generate:api-client` script (runs generator)
- `packages/api-client/` — NEW directory; sibling to `packages/xactions-mcp/`; must NOT join root `workspaces` field (check root `package.json` — if no `workspaces` field exists, do NOT add one)
- `packages/api-client/package.json` — name `@xactions/api-client`, `type: module`, main `index.ts`, types `index.ts`, deps: `openapi-typescript` (dev, for codegen only — runtime is zero-dep `fetch`)
- `packages/api-client/schema.d.ts` — emitted by `openapi-typescript` from `api/openapi.json`; `paths`, `components`, `operations` types
- `packages/api-client/client.ts` — hand-written thin wrapper:
  ```ts
  export class XActionsClient {
    constructor(opts: { baseUrl?: string; bearerToken?: string; sessionCookie?: string; x402Payment?: string; a2aApiKey?: string; apiKey?: string })
    async request<T>(method, path, opts?): Promise<ApiResult<T>>
    // Typed methods per operationId (e.g. postApiViralMine, getApiViralStats)
  }
  ```
- `packages/api-client/index.ts` — re-exports `XActionsClient`, `ApiResult`, types from `schema.d.ts`
- `packages/api-client/README.md` — usage examples, auth scheme docs, regeneration instructions
- `scripts/generate-api-client.mjs` — generator script: reads `api/openapi.json`, runs `openapi-typescript` programmatically or via `npx`, writes `schema.d.ts`, scaffolds `client.ts`/`index.ts`/`README.md`/`package.json` if missing (idempotent — skip existing files unless `--force`)
- `tests/api/contract/api-client.test.js` — NEW contract test: generator runs against fixture spec (small `openapi.json` fixture in `tests/fixtures/`), emits parseable `schema.d.ts`, `client.ts` compiles (via `tsc --noEmit`), generated client has expected methods for fixture paths, ApiResult union covers all status codes

## Tasks & Acceptance

**Execution:**
- `package.json` — add `build:openapi` script (`node scripts/build-openapi.mjs` writes `api/openapi.json`) and `generate:api-client` script (`node scripts/generate-api-client.mjs`); add `openapi-typescript ^7.13.0` to `devDependencies` if missing
- `scripts/build-openapi.mjs` *(new)* — imports `generateSpec()` from `api/openapi.js`, writes pretty-printed JSON to `api/openapi.json` (2-space indent, trailing newline), exits 0; prints `📋 Wrote api/openapi.json (N paths, M schemas)`; used by lint + client generator
- `scripts/generate-api-client.mjs` *(new)* — reads `api/openapi.json` (fails loudly if missing/unparseable/not 3.1.0/empty paths); invokes `openapi-typescript` programmatically (`import { astToString } from 'openapi-typescript'`) OR via `npx openapi-typescript api/openapi.json -o packages/api-client/schema.d.ts`; scaffolds `client.ts`/`index.ts`/`README.md`/`package.json` if missing (idempotent); emits typed method stubs per `operationId` for all ops in `paths`
- `packages/api-client/package.json` *(new)* — `{"name":"@xactions/api-client","version":"0.1.0","type":"module","main":"./index.ts","types":"./index.ts","exports":{".":"./index.ts","./schema":"./schema.d.ts"},"scripts":{"build":"echo 'no build step — ESM TS source'"},"peerDependencies":{},"devDependencies":{"typescript":"^5.x"}}`
- `packages/api-client/schema.d.ts` *(generated)* — output of `openapi-typescript`; `paths`, `components`, `operations` namespaces
- `packages/api-client/client.ts` *(new, hand-written)* — `XActionsClient` class with constructor opts (baseUrl + 5 auth fields), `request<T>(method, path, opts)` core method, and generated typed method stubs keyed by `operationId` (e.g. `async postApiViralMine(body)` → `this.request('POST', '/api/viral/mine', {body})`); emits typed `ApiResult<T>` union
- `packages/api-client/index.ts` *(new)* — re-exports `XActionsClient`, `ApiResult`, `ApiErrorPayload`, `PaymentRequiredPayload`, and `schema.d.ts` types (`paths`, `components`, `operations`)
- `packages/api-client/README.md` *(new)* — install/import examples, auth scheme table, regeneration command, error union shape
- `tests/api/contract/api-client.test.js` *(new)* — fixture-driven contract test: write a minimal `openapi.json` fixture (3-4 ops covering GET/POST/402/x-tryitout) into `tests/fixtures/openapi-fixture.json`; run generator against it via child_process; assert emitted `schema.d.ts` parses (tsc --noEmit on a tiny test file importing it), `client.ts` contains method stubs matching fixture `operationId`s, ApiResult union type compiles
- `api/openapi.json` *(generated)* — run `npm run build:openapi` to emit the committed artifact; verify it's valid JSON + `openapi: 3.1.0` + has paths
- `vitest.config.js` — ensure `tests/api/contract/api-client.test.js` is picked up (should already match `tests/**/*.test.js` glob)

**Acceptance Criteria:**
- Given `api/openapi.json` exists and is valid, when `npm run generate:api-client` runs, then `packages/api-client/` is populated with `package.json`, `schema.d.ts`, `client.ts`, `index.ts`, `README.md` — all parseable and byte-stable on re-run
- Given `api/openapi.json` is missing, when `npm run generate:api-client` runs, then it exits non-zero with `openapi.json not found` in stderr
- Given `api/openapi.json` is malformed (not JSON, wrong openapi version, empty paths), when `npm run generate:api-client` runs, then it exits non-zero naming the specific problem
- Given a generated `schema.d.ts`, when `import type { paths } from '@xactions/api-client/schema'` is used in a TS file, then `paths['/api/viral/mine']['post']` resolves to a typed operation
- Given a generated `client.ts`, when `new XActionsClient({sessionCookie:'x'}).postApiViralMine({platform:'x',niche:'y'})` is called, then the emitted request hits `POST /api/viral/mine` with `x-session-cookie: x` header and JSON body
- Given the typed client, when server returns 402, then `result.ok === false`, `result.status === 402`, `result.error.x402Version === 2`, `result.error.accepts` is array
- Given the typed client, when server returns canonical error envelope (400/401/429/500), then `result.ok === false`, `result.status` matches, `result.error.code` is the ApiError code
- Given the generator runs twice on the same `openapi.json`, then output files are byte-identical
- Given `npm run build:openapi` runs, then `api/openapi.json` is written, is valid JSON, has `openapi: 3.1.0`, ≥100 paths, 5 securitySchemes
- Given the test suite runs, when `vitest run tests/api/contract/api-client.test.js` completes, then all assertions pass (generator runs on fixture, emitted files parse, method stubs match fixture operationIds)

## Spec Change Log

## Review Triage Log

### 2026-09-24 — Review pass 1
- verdicts: 22 findings — high 4, medium 5, low 4, false 1, maybe-false 0, informational 8
- findings:
  - `[high]` `[patch]` packages/api-client/package.json exported `./schema: ./schema.d.ts` directly — would throw `ERR_UNKNOWN_FILE_EXTENSION` on Node ESM import. Patched: wrapped under `"types"` condition: `"./schema": { "types": "./schema.d.ts" }` and same for `.` and `./client`.
  - `[high]` `[patch]` tests/api/contract/api-client.test.js clobbered production packages/api-client/ with fixture methods and didn't regenerate. Patched: added `--spec` and `--out` CLI flags to generator so tests run in an isolated temp directory; added `afterAll` hook that regenerates production client from committed spec.
  - `[high]` `[patch]` Path param replacement didn't use `encodeURIComponent()` and only replaced first occurrence. Patched: changed to `url.replaceAll('{' + k + '}', encodeURIComponent(String(v)))`.
  - `[high]` `[patch]` Query param serializer stringified `undefined`/`null` to `"undefined"`/`"null"`. Patched: added `Object.entries(opts.query).filter(([_, v]) => v != null)` filtering.
  - `[medium]` `[patch]` `ApiResult<T>` failure status was typed as general `number`, preventing TypeScript from narrowing `error` to `PaymentRequiredPayload` on `status === 402`. Patched: split into `ApiSuccess<T>`, `ApiPaymentRequired` (status: 402), and `ApiFailure` (status: number); added exported `isPaymentRequired(res)` type guard helper.
  - `[medium]` `[patch]` `XActionsClient` didn't accept custom `fetch` implementation — prevented unit testing without network calls. Patched: added `opts.fetch` to `XActionsClientOptions` and constructor.
  - `[medium]` `[patch]` Response status unboxing hardcoded `status: 200` — discarded 201 Created and 204 No Content. Patched: changed to preserve real `status` returned by server.
  - `[medium]` `[patch]` Fallback error extraction did `String(body ?? res.statusText)` which produced `"[object Object]"` on un-enveloped error objects. Patched: inspects `typeof body === 'object' && body !== null` and preserves the object structure.
  - `[medium]` `[patch]` `scripts/build-openapi.mjs` wrote spec without validation. Patched: added guards checking `spec.openapi === '3.1.0'`, `paths.length > 50`, `securitySchemes.length >= 5`.
  - `[low]` `[patch]` Method name derivation didn't handle kebab-case or dots cleanly. Patched: sanitized non-alphanumeric chars to underscores before camelCase splitting.
  - `[low]` `[patch]` Operations omitting `security` didn't inherit top-level `spec.security`. Patched: falls back to top-level security array when op.security is undefined.
  - `[low]` `[patch]` Contract test lacked runtime execution checks. Patched: added 4 runtime tests verifying auth header injection, JSON body transmission, 402 x402 protocol parsing, and canonical 401 error envelope parsing.
  - `[low]` `[patch]` Contract test didn't assert clean compilation via `tsc --noEmit`. Patched: added test executing `tsc --project packages/api-client/tsconfig.json`.
  - `[false]` `[reject]` Generator doesn't emit generic `<T>` parameter on method stubs. Refuted: method stubs now declare `<T = unknown>` so callers can supply their own response models.
  - `[informational]` `[keep]` `client.ts` emitted method stubs keyed by operationId — expected: spec design notes state this is the intended approach (hand-written request core + generated stubs).
  - `[informational]` `[keep]` `openapi.json` committed artifact design — expected: committed file is reviewable in diffs and consumed by both lint and client generator.
  - `[informational]` `[keep]` `packages/api-client` standalone (no npm workspaces) — expected: avoiding repo-wide module resolution disruption mid-sprint.
  - `[informational]` `[reject]` Top-level `specPath` mutating in tests — resolved: tests now pass custom `--spec` and `--out` pointing to isolated temp directories.
  - `[informational]` `[reject]` 402 special casing in ApiResult union — working as designed: x402 protocol payload is intentionally not the canonical envelope.
  - `[informational]` `[reject]` `client.scrapeProfile` method naming in I/O matrix was illustrative — operationId mapping (`postApiAiScrapeProfile`) is the actual contract.
  - `[informational]` `[reject]` Missing 2 security schemes in test fixture — fixture is intentionally minimal for fast unit tests; production generator runs against full spec with all 5 schemes.
  - `[informational]` `[reject]` Custom per-request headers — added `opts.headers?: Record<string, string>` support to all generated method stubs.

## Design Notes

**Why committed `api/openapi.json` (not live server):** the spec must be a build artifact — regenerating from a live server introduces nondeterminism (server state, uptime, env vars affecting x402 networks). A committed file is reviewable in diffs, reproducible in CI, and consumed by both the linter (`lint-openapi.mjs` could be refactored to use it) and the client generator. The tradeoff is drift risk — mitigated by `npm run build:openapi` being a mandatory pre-commit/CI step (documented in README + spec acceptance).

**Why `openapi-typescript` for types + hand-written wrapper (not full codegen):** `openapi-typescript` emits excellent `paths`/`components`/`operations` types but doesn't generate runtime clients (it has a sibling `openapi-fetch` but that's a runtime dep). A thin hand-written `XActionsClient` gives full control over auth injection (5 schemes), the ApiResult union shape, and the x402 `PaymentRequired` special-casing — all things generated clients handle awkwardly. The generator only needs to emit per-`operationId` method stubs; the wrapper core is stable.

**Idempotent output:** the generator must produce byte-identical output on the same input. This means: no timestamps in emitted files, deterministic ordering (sorted keys), stable whitespace. The generator writes via template strings with stable ordering — `Object.keys(paths).sort()`.

**Auth scheme mapping:** the spec's `securitySchemes` names map to constructor opts — `bearerAuth` → `bearerToken`, `sessionCookie` → `sessionCookie`, `x402Payment` → `x402Payment`, `a2aApiKey` → `a2aApiKey`, `apiKey` → `apiKey`. At request time, the client injects the headers for whichever schemes the op declares in its `security` field — resolved statically at codegen time (the generator reads each op's `security` array and emits the right headers into the method stub).

**402 special-casing:** `PaymentRequired` is NOT the canonical envelope — it's the x402 protocol payload (`{x402Version, accepts:[{scheme, network, maxAmountRequired, resource, payTo}], ...}`). The ApiResult union types it separately so consumers can branch on `status === 402` and get x402-typed fields, not envelope fields.

**Why not npm workspaces:** adding `"workspaces": ["packages/*"]` to root `package.json` rewires `node_modules` resolution for the entire repo — risky mid-sprint. `packages/api-client` ships standalone; consumers add `"@xactions/api-client": "file:packages/api-client"` to their own `package.json` (as `xspace-agents/agent-voice-chat` already does for its deps). Epic 47 (Next.js frontend) will add the dep then.

## Verification

**Commands:**
- `npm run build:openapi` — expected: writes `api/openapi.json`, prints path count, exits 0
- `node -e "JSON.parse(require('fs').readFileSync('api/openapi.json','utf8'))"` — expected: no error, parseable
- `npm run generate:api-client` — expected: emits `packages/api-client/{package.json,schema.d.ts,client.ts,index.ts,README.md}`, exits 0
- `ls packages/api-client/` — expected: 5+ files present
- `npx tsc --noEmit packages/api-client/client.ts` — expected: no errors (schema.d.ts + client.ts compile)
- `npx vitest run tests/api/contract/api-client.test.js` — expected: all assertions pass
- `npm run generate:api-client && npm run generate:api-client` then `git diff --stat packages/api-client/` — expected: second run produces no diff (idempotent)
- `mv api/openapi.json api/openapi.json.bak && npm run generate:api-client; mv api/openapi.json.bak api/openapi.json` — expected: exits non-zero with `openapi.json not found`

**Manual checks (if no CLI):**
- `cat packages/api-client/client.ts | grep -c "async post"` — should be >100 method stubs
- `head -30 packages/api-client/schema.d.ts` — should contain `export interface paths` or `export type paths`
- `cat packages/api-client/package.json | grep '"name"'` — `"@xactions/api-client"`

## Auto Run Result

**Status:** done
**Summary:** Built `npm run build:openapi` (writes and validates committed `api/openapi.json` artifact) and `npm run generate:api-client` (emits typed `@xactions/api-client` package with 338 method stubs, `schema.d.ts` types via `openapi-typescript`, and `client.ts` fetch wrapper with 5 auth schemes + `PaymentRequired` 402 typing). Resolved all review findings: fixed package.json exports map for Node ESM (`types` condition), isolated contract tests via `--spec`/`--out` flags, encoded path parameters with `encodeURIComponent`, filtered nullish query parameters, added `isPaymentRequired` type guard, preserved real HTTP status codes, supported custom `fetch` injection, and verified clean `tsc --noEmit` compilation.

**Files changed:**
- `scripts/build-openapi.mjs` *(new)* — exports committed `api/openapi.json` with validation (3.1.0, >50 paths, 5 schemes)
- `scripts/generate-api-client.mjs` *(new)* — CLI generator with `--spec`, `--out`, `--force` support
- `api/openapi.json` *(new, committed)* — 336 paths, 5 securitySchemes, valid 3.1.0
- `packages/api-client/` *(new package)*:
  - `package.json` — `@xactions/api-client@0.1.0`, ESM exports map with `types` conditions
  - `client.ts` — `XActionsClient` class with 338 method stubs, 5 auth schemes, custom fetch support, `isPaymentRequired` guard
  - `schema.d.ts` — generated types from `openapi-typescript`
  - `index.ts` — barrel exporting client, types, schemas
  - `tsconfig.json` — strict NodeNext configuration
  - `README.md` — documentation, auth table, regeneration instructions
- `tests/fixtures/openapi-fixture.json` *(new)* — minimal fixture for isolated testing
- `tests/api/contract/api-client.test.js` *(new)* — 12 contract tests (failure modes, fixture generation, idempotency, runtime execution, 402 parsing, tsc clean compile)
- `package.json` — added `build:openapi` + `generate:api-client` scripts, `openapi-typescript ^7.13.0` devDep
- `_bmad-output/implementation-artifacts/spec-46-3-...md` — this spec

**Review findings:** 22 total — 4 high, 5 medium, 4 low, 1 false, 8 informational. All high/medium/low patched.

**Verification:**
- `vitest run tests/api/contract/api-client.test.js` — 12/12 tests pass
- `cd packages/api-client && npx tsc --noEmit` — 0 errors (clean compilation)
- `npm run lint:openapi` — 0 errors, "✅ OpenAPI lint passed"
- `npm run build:openapi` — writes 336 paths, 5 schemes
- `npm run generate:api-client` — deterministic regeneration (0 diff on second run)

**Follow-up review recommended:** false — all verified findings patched, 12 contract tests pass with full runtime execution assertions.

**Residual risks:**
- `packages/api-client` is a standalone package not yet wired into consumer packages (e.g. Next.js in Epic 47). Consumer adoption is Epic 47 scope; this story delivers the package.
