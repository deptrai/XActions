# Epic 50 Context: Public Scrape Gateway — Unified Service Contract

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn `POST /api/platform/:platform/scrape` into the single public scrape contract for every machine consumer (jev-trading, Nowing, ChainLens, third-party). Auth and sync/async are cross-cutting seams — never per-consumer or per-platform branches. Trigger: jev forked `PumpFunCrawler` in-repo because no sync REST surface + service-auth existed; they only knew the `POST /api/ai/discovery/search` queue+poll path (~40s). Gateway fixes this with a real contract: Bearer-derived consumer_id, `mode:'sync'|async'` dispatch on the same route, 202 degrade contract, unified envelope with `error.kind` enum, per-consumer quota, public self-discovery + interactive playground + observability dashboard.

## Stories

- Story 50.1: Service-Auth Lane — Bearer→Consumer Derivation
- Story 50.2: Sync/Async Mode Dispatch + 202 Degrade Contract
- Story 50.3: Unified Envelope + Request-Id Propagation + ErrorEnvelope
- Story 50.4: Per-Consumer Rate-Limit Bucket + Anonymous Free Tier + x402 Route Config + Observability Dashboard
- Story 50.5: Self-Discovery — `GET /api/actions` + openapi.json + x_actions_list + Public Catalog UI + Playground
- Story 50.6: pumpfun `fetch_coin_meta` Lightweight Action
- Story 50.7: `crypto/dexscreener` Platform Descriptor
- Story 50.8: `social/telegram` Platform Descriptor (Skeleton — Transport Deferred)
- Story 50.9: Reddit Search E2E Validation + Contract Test + Migration Quickstart

## Requirements & Constraints

- **Consumer identity crypt-bound**: `consumer_id` derived server-side from Bearer credential (env `XACTIONS_SERVICE_KEYS` map or lookup table). `X-Consumer-Id` header is a hint, never authoritative — spoofing must not bypass quota.
- **Sync ceiling 1.5s hard**: sync calls auto-degrade to `202 + operationId + degraded_reason + Retry-After`. `not_sync_capable` is **400**, not 202 — contract violation, not degrade. Never extend the window.
- **Batch parallel**: `platform:'all'|string[]` uses `Promise.allSettled` (existing `UniversalActionDispatcher` semantics); 1.5s ceiling applies per-platform; per-platform failure doesn't fail batch.
- **Unified envelope**: `{success, mode, metadata{request_id,traceparent,...}, stream, preview[≤10 verbatim slice of data], data[]}`. `error.kind` is closed enum `auth|validation|consumer_quota|upstream_rate_limit|proxy_ip_block|upstream_error|internal`; `retryable:true` requires `retry_after_ms`.
- **Quota keys**: `DistributedTokenBucket` keyed `{consumer_id}:{platform}:{action}`; `internal` unmetered; anonymous callers get IP-bucketed tight free tier; x402 engages on anonymous-quota exhaustion or premium actions.
- **Bearer all-or-nothing**: no scoped tokens (`consumer=X&actions=Y`); untrusted-scoped access becomes a new consumer class via env config, not Bearer parsing.
- **x402 post-response settle**: verify pre-handler, settle after 200 (or after 202 for async accept). Pay-per-call, not pay-per-result.
- **Frozen consumer list**: `VALID_CONSUMER_IDS` stays `['nowing','chainlens','internal']`; new named consumers via env config only.
- **Domain fields in payload only**: `dev_paid_order`, `bonding_curve`, `realized_pnl` etc. live in `data`/`context`, never ThinEvent core.
- **Frontend read-only**: playground invokes real contract but never mutates; observability is admin-auth GET; catalog is public read. No quota-admin UI, no generic Swagger, no log streaming.

## Technical Decisions

- **Reuse `identifyConsumer` seam** from `src/mcp/consumer-context.js` for the REST lane — but swap consumer_id source from `X-Consumer-Id` header to Bearer credential lookup.
- **`serviceAuth` is alternative, not replacement**: `eitherAuth` tries `authenticate` (user JWT) first, falls back to `serviceAuth`; never both on one request.
- **`syncCapable` manifest lives in descriptor.js**: each platform declares `syncCapableActions: string[]`; default mode resolves per-action, caller may override sync→async never async→sync.
- **Single status endpoint**: `/api/ai/action/status/:id` is the ONLY async polling surface; descriptors never ship their own.
- **Action naming**: snake_case `verb_noun` (`fetch_coin_meta`, `token_socials`, `search`); descriptor `actionMap` exposes shorthand aliases.
- **Dexscreener covers Raydium + Orca** via `pair.dexId` — no separate DEX scrapers needed.
- **Telegram transport deferred**: descriptor scaffolds stubs with `transport:'mtproto'|'bot'|'web'` env switch — throws `XACT_4001` until D4 spec picks.
- **Bull+Redis substrate stays**: no queue migration; sync calls never share worker event loop with queued jobs.

## UX & Interaction Patterns

- **Discovery affordance**: `GET /api/actions` is the canonical introspection endpoint (REST, unauthenticated, <100ms) — fixes the "jev couldn't find the route" gap that caused the original fork.
- **Degrade UX**: 202 response shows `degraded_reason` enum (`upstream_timeout|cf_challenge|upstream_rate_limit|queue_fallback`) so consumer logs the *why*.
- **Error affordance**: `error.kind` enum tells consumer which retry strategy — `consumer_quota`=slow down, `upstream_rate_limit`=degrade to async, `proxy_ip_block`=escalate ops.
- **Migration recipe**: `docs/consumer-quickstart.md` + interactive quickstart page show before/after `xactionsClient.ts` diff — jev upgrades in <30 min.

## Cross-Story Dependencies

- Stories 50.6–50.8 depend on 50.2+50.3 only (parallelizable after envelope lands).
- Story 50.9 needs all backend stories (1-8) — it's the integration gate.
- Frontend surfaces bundled inside 50.4 (dashboard), 50.5 (catalog+playground), 50.9 (quickstart) — ship with backend story, not separate.
- Epic 50 builds on Epic 20 (ThinEvent+envelope), Epic 25 (descriptor dispatcher), Epic 32 (`DistributedTokenBucket`) — uses them, doesn't modify them.
