# Epic 50 Context: Public Scrape Gateway — Unified Service Contract

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn `POST /api/platform/:platform/scrape` into the full public machine-consumer contract: a service-auth lane (Bearer→consumer derivation), sync/async dispatch on the same route, a unified response envelope, per-consumer quota isolation, x402 paid access, self-discovery surfaces, an observability dashboard, an interactive playground, and a consumer migration quickstart. The trigger was jev-trading forking `PumpFunCrawler` in-repo because every existing path was user-JWT-gated or forced queue+poll; this epic makes any backend consumer (jev, Nowing, ChainLens, third-party) integrate with no session cookie, no MCP-only path, and no mandatory Bull hop.

## Stories

- Story 50.1: Service-Auth Lane — Bearer→Consumer Derivation
- Story 50.2: Sync/Async Mode Dispatch + 202 Degrade Contract
- Story 50.3: Unified Envelope + Request-Id Propagation + ErrorEnvelope
- Story 50.4: Per-Consumer Rate-Limit Bucket + Anonymous Free Tier + x402 Route Config + Observability Dashboard
- Story 50.5: Self-Discovery — `GET /api/actions` + openapi.json + x_actions_list + Public Catalog UI + Playground
- Story 50.6: pumpfun `fetch_coin_meta` Lightweight Action
- Story 50.7: `crypto/dexscreener` Platform Descriptor
- Story 50.8: `social/telegram` Platform Descriptor (skeleton — transport deferred)
- Story 50.9: Reddit Search E2E Validation + Contract Test Suite + Migration Quickstart

## Requirements & Constraints

- **One canonical entry.** All consumer calls go through `POST /api/platform/:platform/scrape` with `{action, options, mode}` → the descriptor dispatcher. No consumer-named or one-off routes; adding capability = registering a descriptor.
- **Server-derived identity.** `consumer_id` derives from the Bearer credential via env map (`XACTIONS_SERVICE_KEYS`), not headers. `X-Consumer-Id` is an observability hint only — spoofing it must never change identity or bypass quota (contract-tested). Legacy shared Bearer tokens resolve to `internal`. `VALID_CONSUMER_IDS` stays frozen at `['nowing','chainlens','internal']`; new named consumers are env config, never code. `internal` is unmetered/trusted.
- **Sync hard ceiling 1.5s** — never extend. Breach degrades to `202 + {operationId, mode:'async', degraded_reason, retry_after_ms}` + `Retry-After` header; never `200 + error`, never silent hang. `degraded_reason` is a closed enum: `upstream_timeout | cf_challenge | upstream_rate_limit | queue_fallback`. Degrade does NOT re-enqueue Bull (in-flight work continues via detached tracking; no double upstream execution). Requesting `mode:'sync'` on a non-syncCapable action is `400` (contract violation), not `202`. Async polling is only `/api/ai/action/status/:id` — descriptors never ship their own status routes.
- **Unified envelope** on every call: `{success, mode, metadata{request_id, platform, action, consumer_id, duration_ms, sync_capable,...}, stream{enabled,name,cursor}, preview, data}`. `preview` is a verbatim `data.slice(0,10)` — summaries live in `metadata`. `X-Request-Id` honored/generated and propagated end-to-end; W3C `traceparent` propagated.
- **ErrorEnvelope** for all failures: `{success:false, error:{code, kind, message, status, request_id, retryable, retry_after_ms?}}` — never raw scraper stack. `error.kind` closed enum: `auth | validation | consumer_quota | upstream_rate_limit | proxy_ip_block | upstream_error | internal` — consumers pick retry strategy off `kind`; `retryable:true` requires `retry_after_ms`.
- **Quota isolation.** Bucket key `{consumer_id}:{platform}:{action}` on `DistributedTokenBucket`. Named consumers get free quotas via `XACTIONS_CONSUMER_QUOTAS`; `internal` unmetered; anonymous callers get a tight IP-bucketed free tier (~10/min per IP+platform+action). Exhaustion → `429` + `kind:'consumer_quota'` + `Retry-After`.
- **x402 paid lane.** `buildRouteConfig` must explicitly cover the scrape route family, per-action pricing. x402 engages when anonymous quota is exhausted or the action is tagged premium. Sync calls settle post-response; a `202` degrade settles on accept (pay-per-call, not per-result).
- **Batch dispatch.** `platform:'all'|string[]` fans out per platform in parallel; the 1.5s ceiling applies per-platform; per-platform failure does not fail the batch — `results[]` carries per-platform status. Async batch returns `operationIds[]`.
- **Self-discovery.** `GET /api/actions` returns the full `{platform, action, syncCapable, required_args[], category, description}` manifest unauthenticated in <100ms — identical payload to the MCP `x_actions_list`. openapi.json documents the route, `mode` enum, Bearer + x402 security schemes, and annotates `X-Consumer-Id` as hint-only.
- **Success signal:** a Bearer-authenticated consumer calls `reddit/search` with `mode:'sync'` and gets a populated envelope in <1.5s — no cookie, no queue, no MCP.
- **Out of scope:** sub-second real-time data plane (WS streams, RPC, trade tape stay consumer-owned); Telegram MTProto-vs-Bot transport choice (deferred — skeleton only); SLA/billing tiers beyond x402; consumer-managed quota admin; per-platform status endpoints; generic Swagger UI; log-streaming/tracing UI.

## Technical Decisions

- **Single-Gateway Facade paradigm:** auth and mode are cross-cutting seams applied uniformly — consumers are identified, never special-cased, and the contract shape never varies by caller.
- **Two auth lanes, mutually exclusive:** `eitherAuth` tries user-JWT `authenticate` first, then `serviceAuth` — never both; `req.consumer` is populated either way. `serviceAuth` tokens are all-or-nothing per consumer (no scoped tokens/authz matrix).
- **`syncCapable` manifest is the mode source of truth:** each platform descriptor declares `syncCapableActions: string[]`; unlisted actions default async. Caller may override sync→async, never async→sync. Reuse the existing `identifyConsumer`/`extractBearerToken` consumer seam, `DistributedTokenBucket`, Bull `jobQueue`, and `x402` middleware — no new auth stack or queue migration.
- **Shared schema stays platform-agnostic:** domain fields (`bonding_curve`, `dev_paid_order`, etc.) live in `data`/`context` only; `category:'crypto'` discriminates. Action naming is snake_case `verb_noun` with shorthand aliases in `actionMap`. Consumers normalize shapes in their own adapters.
- **Batch fan-out happens at the gateway** via `Promise.allSettled` semantics — not through the write-oriented `UniversalActionDispatcher`.
- **Observability backend:** new admin-authed `GET /api/admin/gateway/metrics` aggregates bucket stats + Bull stats + a ring buffer of the last 1000 calls.
- **New platform work:** pumpfun `fetch_coin_meta` wraps `client.getCoin(mint)` alone (~300ms, syncCapable; mint 404 → `XACT_4004`). Dexscreener is a new keyless-upstream platform with 5 actions, all syncCapable, optional proxy pool. Telegram ships a transport-shim skeleton (`TELEGRAM_TRANSPORT`, throws 'transport not implemented', `syncCapableActions=[]`, `coming_soon:true` — no MTProto/TDLib dependency).

## UX & Interaction Patterns

- **Three frontend surfaces under `apps/web`:** read-only observability dashboard at `/gateway/monitor/` (consumer×platform×action quota table, 24h degrade-rate chart colored by `degraded_reason`, upstream p50/p95/p99 health, anonymous-vs-named-vs-x402 split, request-id trace lookup; 10s auto-refresh, pause-on-blur, 1h/6h/24h ranges — quota tuning stays env ops, never UI); public unauthenticated catalog at `/actions/` (grouped by category, syncCapable/status badges, deep-linkable `?platform=&action=`, SEO static params — browse ≠ call); interactive playground at `/gateway/` (manifest-driven selectors, mode picker with eligibility hints, auth simulator where `X-Consumer-Id` is labeled "hint only", JSON options editor, envelope tree render, color-coded `error.kind` badges, amber degrade banner on 202, Copy-as-curl, localStorage recent-calls replay, buttons that auto-fill requests to trigger specific error kinds).
- **Migration quickstart** ships as `docs/consumer-quickstart.md` AND an interactive `/gateway/quickstart/` page with the same content: before/after client diff (drop sessionCookie → add Bearer), sync-vs-async decision tree, `error.kind`→retry-strategy mapping, plus a jev-specific section referencing real jev-trading paths.

## Cross-Story Dependencies

- Serial chain: **50.1 + existing authenticate → 50.2 → 50.3 → 50.4 → 50.5** (each builds on the previous seam).
- Parallel after 50.3: **50.6** (needs 50.2+50.3), **50.7** (needs 50.2+50.3), **50.8** (needs 50.3 only).
- **50.9** is the integration gate — requires all backend stories (50.1–50.8); its contract suite covers all four auth combinations, degrade shapes, spoofed-header rejection, quota isolation, and manifest parity.
- Cross-epic deps: Epic 20 (ThinEvent + envelope), Epic 25 (descriptor dispatcher), Epic 32 (token bucket). Telegram real transport lands in a later spec — only the seam ships here.
