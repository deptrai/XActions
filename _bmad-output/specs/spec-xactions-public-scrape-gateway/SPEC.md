---
id: SPEC-xactions-public-scrape-gateway
companions:
  - ../planning-artifacts/architecture/architecture-xactions-public-scrape-gateway-2026-09-26/ARCHITECTURE-SPINE.md
  - ux-review.md
sources:
  - ../planning-artifacts/research/market-crypto-xactions-features-2026-09-26/research.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# XActions Public Scrape Gateway

## Why

jev-trading forked `PumpFunCrawler` in-repo because no callable scrape surface existed for a backend service — every existing path was either user-JWT-gated REST (`POST /api/platform/:platform/scrape`) or queue+poll (`POST /api/ai/discovery/search` → 40s wait). The same gap blocks Nowing and ChainLens from using XActions as a stable scraping substrate, and leaves third-party integrators with no on-ramp. The fix is architectural, not feature: expose one versioned scrape contract that any machine consumer can hit, with auth and sync/async as cross-cutting seams — not per-caller branches. Spine (companion) pins the decisions; this SPEC names the deliverable contract.

## Capabilities

- **CAP-1 — Unified scrape entry**
  - **intent:** Any consumer calls `POST /api/platform/:platform/scrape` with `(action, options, mode)` and reaches the same `scrape(platform, action, options)` dispatcher.
  - **success:** A single integration test hitting `reddit/search`, `pumpfun/fetch_mint_social`, and `x/search` through the same route returns the unified envelope for all three — no consumer-named routes exist.

- **CAP-2 — Service authentication**
  - **intent:** A machine consumer authenticates via Bearer token; the gateway derives `consumer_id` server-side and binds it to every downstream call.
  - **success:** A request with a valid Bearer but a forged `X-Consumer-Id: internal` header resolves to the Bearer's real consumer, not `internal`; quota and logs reflect the real id.

- **CAP-3 — Sync/async dispatch**
  - **intent:** Callers pick `mode: 'sync'` for sub-second-capable reads or `mode: 'async'` for heavy jobs; the manifest declares per-action defaults; sync calls that breach 1.5s degrade cleanly.
  - **success:** `reddit/search` returns in <1.5s sync; a CF-challenged `pumpfun/fetch_coin_meta` degrades to `202 + operationId + Retry-After` and the consumer polls `/api/ai/action/status/:id` — never a silent hang, never `200 + error`.

- **CAP-4 — Unified envelope**
  - **intent:** Every gateway call returns the same shape regardless of platform or consumer.
  - **success:** Response always carries `{success, mode, metadata{request_id,...}, stream{enabled,name,cursor}, preview[≤10 verbatim slice of data], data[]}` — verified by a schema validator against a live response from each platform.

- **CAP-5 — Per-consumer rate-limit isolation + observability**
  - **intent:** Token-bucket keys are `derived_consumer_id : platform : action` so one consumer's volume never starves another's — and an operator dashboard at `apps/web/app/gateway/monitor/` shows quota usage, degrade rate, and upstream health in real time.
  - **success:** Two consumers with independent quotas hit the same platform+action; consumer A exhausting its quota returns 429 for A only. Dashboard renders the same per-consumer quota table + 24h degrade-rate chart + request-id lookup.

- **CAP-6 — Batch dispatch**
  - **intent:** A consumer sends `platform: 'all'` or `platform: ['x','reddit',...]` and gets one envelope with `results[]` per platform.
  - **success:** A single call to `platform:['x','reddit']` returns `{results: [{platform:'x',...},{platform:'reddit',...}]}` in one envelope — no per-platform fan-out in consumer code.

- **CAP-7 — Self-discovery + interactive playground**
  - **intent:** Consumers enumerate every `(platform, action, syncCapable, mode)` triple via `GET /api/actions` (REST introspection), `openapi.json`, `x_actions_list`, AND a browsable catalog + interactive playground UI.
  - **success:** `GET /api/actions` returns the manifest in <100ms unauthenticated; `/actions` catalog renders the same manifest publicly; `/gateway/` playground issues a live `POST /api/platform/reddit/scrape` from the browser with envelope rendered + "Copy as curl".

## Constraints

- **C-1** — `consumer_id` is derived server-side from the Bearer credential. `X-Consumer-Id` header is a hint, never authoritative; spoofing it must not bypass quota (CAP-5).
- **C-2** — Sync mode hard-ceils at 1.5s and degrades to `202`. Never extend the window — a longer sync window is what made jev fork in the first place.
- **C-3** — XActions never proxies sub-second data. pumpportal WS mints, Solana RPC/Helius/Triton, trade tape, TP triggers stay consumer-owned. The gateway documents per-action latency so a caller can tell at call-time what's fast-lane-eligible.
- **C-4** — Domain-specific fields (`dev_paid_order`, `bonding_curve`, `realized_pnl`, etc.) live in the `data`/`context` payload only — never in ThinEvent or the envelope core. `category: 'crypto'` discriminates; the shared schema stays platform-agnostic.
- **C-5** — `VALID_CONSUMER_IDS` stays frozen at `['nowing','chainlens','internal']`. New *named* consumers come from env config (`XACTIONS_MCP_API_KEY` + Bearer→consumer map), never a code change. `internal` is the unmetered trusted class.
- **C-6** — x402 route-config must explicitly cover `POST /api/platform/:platform/scrape`. Today's `buildRouteConfig` only maps `/api/ai/*` and `/api/scripts/*` — the gateway route needs to be added.
- **C-7** — Batch dispatch (`platform:'all'|string[]`) runs platforms in parallel via `Promise.allSettled` (existing `UniversalActionDispatcher` semantics — `dispatcher.js:296`). The 1.5s sync ceiling applies **per-platform**; batch total is bounded by the slowest single platform, not the sum. Per-platform failure does not fail the batch — `results[]` carries per-platform status.
- **C-8** — `serviceAuth` Bearer is **all-or-nothing per consumer**. Scoped tokens (`consumer=X&actions=Y`) add an authz matrix with no current need — every named consumer is trusted. Untrusted-scoped access, if ever needed, becomes a NEW consumer class via env config, not Bearer parsing.
- **C-9** — x402 sync calls settle **post-response** (`@x402/express` verifies the payment header before the handler runs, settles after a successful 200 — README line 111). For async `202` degrade: payment verifies at enqueue, settles when `202` returns — consumer pays for the job accept, not the result. This is pay-per-call, not pay-per-result.
- **C-10** — `error.kind` is a closed enum: `auth | validation | consumer_quota | upstream_rate_limit | proxy_ip_block | upstream_error | internal`. Consumers pick retry strategy off `kind`, never parse `message` text. `retryable:true` requires `retry_after_ms`.
- **C-11** — 202 degrade response carries `degraded_reason` enum: `upstream_timeout | cf_challenge | upstream_rate_limit | queue_fallback`. `not_sync_capable` is **400**, not 202 — it's a contract violation, not a degrade.
- **C-12** — `X-Consumer-Id` hint-vs-authoritative asymmetry is explicitly documented in `openapi.json` and every consumer-facing doc. Header affects observability only; Bearer is authoritative.
- **C-13** — Frontend surfaces stay read-only w.r.t. contract state: playground invokes the real contract but never mutates descriptor state; observability reads `GET /api/admin/gateway/metrics` (admin-auth) and never mutates quotas; catalog renders `GET /api/actions` (public) without auth.

## Non-goals

- **NG-1** — Sub-second real-time data plane (pumpportal WS mints, Helius/Triton gRPC, Solana RPC). Owned by consumers, not XActions.
- **NG-2** — Telegram MTProto vs Bot API transport choice. Deferred to the D4 spec; the gateway contract is transport-agnostic.
- **NG-3** — Per-consumer SLA/billing tiers beyond x402 pay-per-call. Wait for real usage data.
- **NG-4** — Forcing jev to migrate its in-repo `PumpFunCrawler`. That's a consumer-side choice; the gateway only has to make the sync path preferable.
- **NG-5** — Per-platform status endpoints. `/api/ai/action/status/:id` is the only async polling surface; descriptors never ship their own.
- **NG-6** — Consumer-managed quota admin. `apps/web/app/gateway/monitor/` is read-only observability — adjusting quotas stays env-config ops, not a UI concern.
- **NG-7** — Building a general-purpose OpenAPI/Swagger UI. The playground is contract-specific (this gateway only); it doesn't try to become a generic REST client.
- **NG-8** — Real-time log streaming or tracing UI. Observability shows aggregates + request-id lookup; it doesn't try to be Datadog.

## Success signal

A consumer — jev-trading in dev, or any third-party with a valid Bearer — calls `POST /api/platform/reddit/scrape` with `{"action":"search","options":{"query":"solana memecoin"},"mode":"sync"}` and receives a unified envelope with `data[]` populated in under 1.5 seconds, without a session cookie, a Bull queue hop, or an MCP-only path. jev's `searchReddit()` stops returning `[]`.

## Assumptions

- jev-trading tolerates a 1.5s sync ceiling (evidence: `holderConcentration.ts` uses a 2s non-fatal timeout on pump.fun calls).
- Existing `identifyConsumer` seam can be reused for the REST lane with only the consumer-derivation swap (header→credential-bound) — no new auth stack needed.
- Bull + Redis is the async substrate (already in `api/services/jobQueue.js`); no queue migration in scope.
