# UX Review — XActions Public Scrape Gateway (Developer Experience Audit)

**Reviewer:** Sally (UX Designer)
**Date:** 2026-09-26
**Lens:** Machine-consumer DX — the "user" is a backend service integrating XActions. Every design decision below is judged on *time-to-first-successful-call* and *error-debuggability*.

---

## Verdict: PASS — with 5 DX-critical observations that SPEC + Spine under-serve

The contract is architecturally sound but its *developer experience surface* has gaps that will produce integration friction identical to what made jev fork. UX issues here are not visual — they're **discoverability, error affordance, and migration-path clarity**.

---

## UX-1 (HIGH): The Discovery Problem That Caused the Fork Isn't Fully Closed

**What the spec promises:** `openapi.json` + `x_actions_list` self-discovery.

**The actual gap:** jev's `xactionsClient.ts` calls `POST /api/ai/discovery/search` because *that's the endpoint they found*. `POST /api/platform/:platform/scrape` exists already but is invisible — jev's code comments literally say "Reddit has no public search route in XActions (platform.ts is account management, not content search)". They looked at the route, saw `router.use(authenticate)` (user-JWT), and concluded it wasn't for them.

**UX fix needed:** Discovery isn't just "openapi.json exists" — it's that the consumer *finds the contract before guessing*. Recommendations:

- Add `GET /api/platform/:platform/scrape` **OPTIONS** or `GET /api/platform/:platform/scrape/schema` returning the action manifest + `syncCapable` + `requiredArgs` — so a consumer can introspect without reading openapi.
- `x_actions_list` output should be callable via **REST GET** too, not only MCP — jev's client doesn't speak MCP; forcing MCP for discovery defeats the point.
- `openapi.json` should be reachable at `/api/openapi.json` (top-level, conventional path) not buried — and reference `platform/*/scrape` explicitly with `mode` enum so codegen tools pick it up.

**Story 50.5 AC hint:** add "consumer can curl `GET /api/actions` and receive the manifest in <100ms without auth".

---

## UX-2 (HIGH): Error Envelope Doesn't Distinguish "Your Fault" vs "Our Fault" vs "Retry-able"

**What the spec promises:** `ErrorEnvelope{XACT_4xxx, XACT_5xxx, code, message, status}`.

**The actual gap:** A consumer hitting `XACT_4029` (rate-limit) needs to know *which* quota died — their own per-consumer bucket, the upstream platform's rate-limit, or the proxy pool's IP budget. Three different causes, three different retry strategies:
- consumer-quota → back off per `Retry-After`, it's their own budget
- upstream 429 → degrade to async and retry with jitter — XActions' pool is hot
- proxy-IP-block → switch session, escalate to XActions ops

**UX fix needed:** `ErrorEnvelope` needs a `kind` discriminator beyond `code`:
```
{success:false, error:{code:'XACT_4029', kind:'consumer_quota'|'upstream_rate_limit'|'proxy_ip_block'|'auth'|'validation', retryable:true|false, retry_after_ms, ...}}
```

A consumer reading `kind:'consumer_quota'` knows to slow their own request rate. `kind:'upstream_rate_limit'` knows XActions' pool is hot and they should degrade to async. Without this, every 429 looks identical and consumers guess.

**Story 50.3 AC hint:** envelope `error.kind` is a closed enum; `retry_after_ms` required when `retryable:true`.

---

## UX-3 (MEDIUM): `sync → async` Degrade Needs a Consumer-Visible Transition Reason

**What the spec promises:** 202 + operationId + Retry-After on sync timeout.

**The actual gap:** When jev's call returns `mode:'async'` after they asked for `mode:'sync'`, they can't tell *why* — was it a CF challenge (transient), or is this action just not syncCapable today (permanent), or did the proxy pool exhaust (capacity)?

jev's `holderConcentration` uses a 2s timeout and is non-fatal — they're built for bounded failure. But they also need to log *why* it fell back, or they'll misdiagnose their own latency budget.

**UX fix needed:** 202 response adds a `degraded_reason` field:
```
{operationId, mode:'async', degraded_reason:'upstream_timeout'|'cf_challenge'|'not_sync_capable'|'upstream_rate_limit', retry_after, ...}
```

`not_sync_capable` should actually be a **400 not a 202** — consumer asked for something the action can't do; that's not a degrade, it's a contract violation. Only actual runtime degrades (timeout, upstream slow) should be 202.

**Story 50.2 AC hint:** separate "async-mode request" (client chose) from "sync-degraded" (server forced) — the two `mode:'async'` responses are distinguishable by `degraded_reason` presence.

---

## UX-4 (MEDIUM): Migration Path for jev Is Unclear — First-Run Experience Missing

**What the spec promises:** contract exists, consumers can call.

**The actual gap:** jev's `xactionsClient.ts` is already wired to `POST /api/ai/discovery/search` + polling. Switching them to `POST /api/platform/reddit/scrape` requires:
1. Drop `sessionCookie` plumbing (Twitter cookie no longer needed for service calls)
2. Add `Authorization: Bearer ${XACTIONS_SERVICE_KEY}`
3. Rewrite `searchReddit()` from `return []` to a real call
4. Optionally collapse `searchTwitter` to sync-mode for fast queries

None of this is documented as a **migration recipe**. The spec says "consumers normalize in their own adapter" but doesn't give jev a template.

**UX fix needed:** A `docs/migration-jev.md` (or `docs/consumer-quickstart.md`) companion showing before/after `xactionsClient.ts` — specifically the diff of searchTwitter + searchReddit methods. This turns "spec says it's possible" into "jev sees the 20-line change they need".

**Story 50.9 AC hint:** include a migration guide in the deliverable — jev's diff is the acceptance.

---

## UX-5 (LOW): `X-Consumer-Id` Hint vs Authoritative Distinction Is Subtle

**What the spec promises:** Bearer→consumer_id server-side, header is hint only.

**The actual gap:** A consumer reading the contract sees `X-Consumer-Id` in the request docs and assumes it matters. They'll send `X-Consumer-Id: jev` expecting it to do something. It does — for observability/logging — but they might think it affects routing or quota attribution. The spec needs to **name the asymmetry** explicitly in docs: "You send this header for observability only. Your Bearer is what counts. Sending a different `X-Consumer-Id` won't break anything but also won't do anything."

This is a documentation issue, not a spec issue — but worth flagging in 50.5's openapi annotations.

---

## UX Summary — What to Fix

| # | Severity | Fix goes in |
|---|---|---|
| UX-1 Discovery affordance (REST introspection endpoint) | HIGH | Story 50.5 — add `GET /api/actions` route |
| UX-2 Error kind discriminator | HIGH | Story 50.3 — extend ErrorEnvelope |
| UX-3 `degraded_reason` on 202 | MEDIUM | Story 50.2 — pin degrade contract |
| UX-4 jev migration recipe doc | MEDIUM | Story 50.9 — companion doc deliverable |
| UX-5 Hint-vs-authoritative docs | LOW | Story 50.5 — openapi annotation |

The contract is buildable as-is; these 5 are polish, not blockers. UX-1 + UX-2 are the two that will actually hurt if missed — they're the difference between "spec compliant" and "jev actually migrates".

---

## What the Spec Got Right (UX-wise)

- **Single endpoint** (`POST /api/platform/:platform/scrape`) — consumer learns one URL, not a per-platform matrix. The uniformity IS the DX.
- **`mode` flag on same route** — beats "call /api/scrape-sync vs /api/scrape-async" — caller doesn't switch URLs, just a field.
- **`internal` consumer as unmetered** — gives dev-mode callers a zero-friction on-ramp; they graduate to Bearer when they need metering.
- **Preview field** (`preview[≤10]`) — lets consumer verify shape without paging through `data[]`.
- **Snake_case action naming convention** — predictable; consumer can guess `fetch_coin_meta` without docs.

The UX philosophy is right — these are the right affordances for a machine API. The 5 findings above are about making the affordances *discoverable and debuggable*, not about adding more.
