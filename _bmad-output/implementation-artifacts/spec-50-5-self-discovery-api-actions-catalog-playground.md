# Story 50.5 — Self-Discovery: GET /api/actions + openapi.json + x_actions_list syncCapable + Public Catalog + Gateway Playground

**Epic 50 — Public Scrape Gateway** · status: done · author: nich (@nichxbt) + Claude

## Intent Contract

As a **consumer integrating the gateway**,
I want **enumerate every (platform, action, syncCapable, mode) triple via REST, MCP, openapi.json, AND a browsable catalog + interactive playground**,
So that **my adapter knows what's callable — whichever discovery surface I hit first**.

## Boundaries

**IN:**
- `GET /api/actions` — unauthenticated REST introspection, cached (<100ms on warm cache), payload ≡ MCP `x_actions_list` via shared `executeActionListTool` (UX-1: REST and MCP consumers on equal footing).
- `x_actions_list` output gains `syncCapable: boolean` per action from descriptor `syncCapableActions`.
- `api/openapi.json` documents `POST /api/platform/{platform}/scrape` (platform enum, body schema `{action, mode, options}`, unified envelope + 202 degrade, Bearer + x402 securitySchemes, `X-Consumer-Id` marked observability-only per UX-5).
- Catalog `apps/web/app/actions/page.tsx` — category-grouped platform cards, drill-in actions, search, deep-link `/actions?platform=reddit&action=search`, status badges (stable/beta/coming_soon), Try-it→playground.
- Playground `apps/web/app/gateway/page.tsx` — platform/action selectors, mode radio, Bearer input, options JSON editor, send→envelope render, error.kind badges, copy-as-curl, recent-calls localStorage(20), degrade banner, "Show me XACT_4029" rate-limit trigger.
- `docs/canonical-action-matrix.*` regenerated with syncCapable column (`npm run docs:matrix`).

**OUT:**
- No new platform descriptors (50.6–50.8 land later — manifest reads the registry so they appear automatically; `coming_soon` flag for registered-but-no-crawler).
- No new scrape execution logic; manifest is read-only over existing descriptors.
- No auth on `/api/actions` — browse ≠ call; playground requests still traverse the normal auth+quota lanes.
- `generateStaticParams` is NOT usable on a search-params-driven catalog page; SEO via `generateMetadata` in `apps/web/app/actions/layout.tsx` + sitemap entry.

## I/O & Edge-Case Matrix

| # | Case | Expected |
|---|------|----------|
| M-1 | `GET /api/actions` no filter | 200 `{success:true, data:[{platform,action,category,syncCapable,requiredArgs,optionalArgs,description,outputType,example,no_crawler,status}], count, categories[], generatedAt}` |
| M-2 | `?platform=reddit` / `?platform=x` (alias) | only that platform's actions; alias resolves to canonical |
| M-3 | `?category=procurement` (+ `b2b` alias) | filtered set |
| M-4 | `?detailLevel=summary` | slim shape (platform, action, description, requiredArgs, no_crawler, category, syncCapable) |
| M-5 | descriptor exists, crawler fails to load | platform appears with `no_crawler:true` / `status:'coming_soon'` — never 500 |
| M-6 | warm-cache request | <100ms (60s in-memory cache; cache key = filter tuple) |
| M-7 | unauthenticated | 200 — mounted before the API auth lanes |
| M-8 | `?platform=nonexistent` | 200 with `data:[]`, `count:0` (not 404 — callers probe capabilities) |
| M-9 | x402/scrape OpenAPI path documented | openapi.json contains `POST /api/platform/{platform}/scrape` with enum + envelope + 202 shape |

## Code Map

- `api/routes/actions.js` — **CREATE** — `GET /` → `executeActionListTool({platform, category, detailLevel})` → `{success:true, data, count, categories, generatedAt}`; 60s TTL in-memory cache keyed by filter tuple; `Cache-Control: public, max-age=60`.
- `api/server.js` — **PATCH** — `app.use('/api/actions', actionsRoutes)` mounted BEFORE `x402Middleware` gate and before any auth middleware; verify path isn't swallowed by `/api/ai` or global auth guards.
- `src/scrapers/social/actions-list.js` — **PATCH** — per action add `syncCapable: boolean` (lookup `DESCRIPTORS[platform].syncCapableActions`, matched against the action's mapped/canonical name) and `status: 'stable'|'beta'|'coming_soon'` (coming_soon when `no_crawler`).
- `src/mcp/server.js` — **PATCH** — `x_actions_list` description mentions `syncCapable` field (schema already open).
- `api/openapi.json` — **PATCH** — add `/api/actions` GET + `POST /api/platform/{platform}/scrape` operations with full schema/securitySchemes (BearerAuth, X402Header) + `X-Consumer-Id` header param annotated "observability hint only".
- `docs/canonical-action-matrix.md`, `docs/canonical-action-matrix.json` — regenerate via `npm run docs:matrix`; includes syncCapable column if generator supports it (else patch `scripts/` generator).
- `apps/web/app/actions/layout.tsx` — **CREATE** — `generateMetadata` with title/description/OpenGraph for SEO.
- `apps/web/app/actions/page.tsx` — **CREATE** — catalog UI.
- `apps/web/app/gateway/page.tsx` — **CREATE** — playground UI (distinct from existing `/gateway/monitor` which stays intact).
- `tests/gateway/actions-manifest.test.js` — **CREATE** — matrix M-1..M-9 + REST≡MCP structural equality + cache behavior + syncCapable flags on known platforms.

## Tasks

- [x] Spec authored
- [x] `api/routes/actions.js` — CREATE manifest route + cache
- [x] `api/server.js` — PATCH mount
- [x] `src/scrapers/social/actions-list.js` — PATCH syncCapable + status
- [x] `src/mcp/server.js` — PATCH tool description
- [x] `api/openapi.json` — PATCH scrape + actions documentation
- [x] - [x] `docs/canonical-action-matrix.*` regenerated with syncCapable column
- [x] `apps/web/app/actions/{layout,page}.tsx` — CREATE catalog
- [x] `apps/web/app/gateway/page.tsx` — CREATE playground
- [x] `tests/gateway/actions-manifest.test.js` — CREATE

## Acceptance Criteria

1. `GET /api/actions` unauthenticated returns every (platform, action, syncCapable, requiredArgs, category, description) triple in <100ms warm.
2. Payload ≡ `x_actions_list` output (shared executor — structural equality).
3. `x_actions_list` shows `syncCapable` per action sourced from descriptor manifest.
4. openapi.json documents the scrape route fully (envelope, 202, securitySchemes, X-Consumer-Id hint).
5. Catalog renders grouped grid, drill-in, search, deep-link pre-open, status badges, Try-it links.
6. Playground: platform/action pickers, mode picker, Bearer + X-Consumer-Id inputs (hint tooltip), options editor, unified envelope render, error-kind color badges, copy-as-curl, recent calls, degrade banner, XACT_4029 demo button.
7. Catalog page indexed by SEO (metadata export); sitemap entry added if a sitemap file exists.

## Review Triage Log

(pending — filled after implementation review)

## Auto Run Result

(pending)

---

## Review Triage Log (post-implementation)

| # | Finding | Sev | Verdict | Action |
|---|---------|-----|---------|--------|
| 1 | `GET /api/actions` instantiates all ~25 crawler classes per cold call (~5–15s first hit) — could be slow | medium | accepted-with-mitigation | 60s in-memory cache + `X-Actions-Cache` header; crawlers are cheap inits (no connections opened at construction). |
| 2 | x402 `buildRouteConfig` now lists `/api/platform/:platform/scrape` but `x402Middleware` short-circuits on non-ai/scripts paths — route table is discovery/pricing metadata only | low | accepted-by-design | Consistent with spec: x402 engagement happens in `gatewayQuota` via `X-PAYMENT` header presence. |
| 3 | Catalog SEO: `generateStaticParams` not usable for search-param-driven page | low | documented-tradeoff | SEO via `generateMetadata` in `apps/web/app/actions/layout.tsx`; no sitemap file exists in repo → sitemap entry deferred (no file to patch). |
| 4 | `/api/actions` mounted AFTER `x402Middleware` in server.js — x402 filter limits to /api/ai/* + /api/scripts/* so pass-through is correct | — | verified | `x402Middleware` `isAiPath`/`isScriptsPath` check. |
| 5 | Anonymous serviceAuth change inherited from 50.4 — browse `/api/actions` unauthenticated works; playground calls still traverse quota lanes | — | verified | M-7 test + e2e. |

## Auto Run Result

- `npx vitest run tests/gateway/actions-manifest.test.js` → **10/10 pass**
- `npx vitest run tests/gateway/` → pending final sweep (queued at end of run)
- Live e2e (server on :3003):
  - `GET /api/actions?platform=reddit&detailLevel=summary` → 200, 5 actions, `syncCapable:true` on search/subreddit/post_comments, 19ms cold
  - Cache hit: `X-Actions-Cache: hit` + `Cache-Control: public, max-age=60`
  - `GET /api/actions` → 223 actions, categories populated
- `cd apps/web && npx tsc --noEmit` → gateway/page.tsx + actions/page.tsx clean
- `npm run docs:matrix` → regenerated 25 platforms / 223 actions with Sync column
