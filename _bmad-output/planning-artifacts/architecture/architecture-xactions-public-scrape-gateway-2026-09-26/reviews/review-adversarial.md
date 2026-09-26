# Review: Adversarial Divergence (inline, gate blocker)

Reviewer: Winston (inline substitute — parallel subagent blocked on tool access)
Date: 2026-09-26
Verdict: PASS-WITH-FIXES — 4 divergence holes found, 2 critical.

## Divergence scenarios (each: two units both AD-compliant yet incompatible)

### F-ADV-1 (CRITICAL): Two implementers pick different sync-degradation contracts

**Unit A (reddit)**: `mode:'sync'` always returns 200 with `data[]`; on anti-bot timeout it returns `{success:false, mode:'sync', error:{...}}` — satisfies AD-3's letter ("auto-degrades") only by NOT degrading.
**Unit B (pumpfun)**: on CF timeout returns `202 Accepted` + `{operationId, retryAfter}` and `mode:'async'` per OQ-2.
Both claim AD-3 compliance; consumers can't write one client.

**Why AD-3 fails**: "degrade to `async` automatically and return `mode:'async'`" doesn't pin the HTTP status code or the shape of the degraded response. 200-with-error vs 202-with-ticket are both valid readings.

**Fix**: tighten AD-3 or OQ-2 — pin `202 + operationId + Retry-After` as THE degrade contract, never `200 + error`.

### F-ADV-2 (CRITICAL): `X-Consumer-Id` spoofing defeats per-consumer rate-limit isolation (AD-7)

`identifyConsumer` accepts **arbitrary** `X-Consumer-Id` strings and maps unknown→`internal` (unmetered). If AD-7 keys `DistributedTokenBucket` on `consumer_id:platform:action`, an attacker sets `X-Consumer-Id: internal` (or any new string each call) and either (a) bypasses quota entirely if `internal` is unmetered, or (b) gets a fresh bucket per forged id.

**Why AD-7 fails**: assumes consumer_id is trustworthy after `serviceAuth`, but AD-2 allows `serviceAuth OR user-JWT`, and `identifyConsumer` doesn't verify the header matches the authenticated principal.

**Fix**: AD-2 must pin "Bearer token cryptographically binds to consumer_id" — the consumer_id is *derived from* the Bearer credential (or a server-side map), never taken from the caller-supplied header unauthenticated. `X-Consumer-Id` is a hint, not the key source.

### F-ADV-3 (HIGH): Two platforms disagree on action naming convention

Spine references `fetch_coin_meta`, `fetch_mint_social`, `search`, `token_socials`, `token_legitimacy`. No convention pins snake_case vs camelCase vs verb_noun.

**Unit A (reddit)**: `search` (verb only).
**Unit B (pumpfun)**: `fetch_mint_social` (verb_noun).
**Unit C (dexscreener, future)**: `tokenSocials` (camelCase) or `socials`.
All AD-1 compliant; consumers can't guess.

**Fix**: add convention row — "Action names are snake_case verb_noun (`fetch_coin_meta`, `token_socials`, `search`). `syncCapable` manifest is the source of truth; alias table per descriptor maps shorthand."

### F-ADV-4 (HIGH): Envelope `data` shape is platform-agnostic per AD-5/6 but consumers diverge on `preview` semantics

AD-5 says `preview[≤10]` but doesn't pin *what* goes in preview vs `data`. Two implementers:
- Unit A puts first 10 items of `data` in `preview` (mirror).
- Unit B puts a *summary object* in `preview` (e.g. `{counts, top_author, sentiment}`).
Both comply; consumers can't rely on preview.

**Fix**: pin — "preview is a verbatim slice `data[0..10]`, not a derived summary. Summary stats go in `metadata`."

### F-ADV-5 (MEDIUM): Async status endpoint — `/api/ai/action/status/:id` vs per-platform status route

Spine names `/api/ai/action/status/:id` for async polling. If a new platform descriptor registers its own status route, two endpoints diverge.

**Fix**: pin in Consistency Conventions — async polling is *always* `/api/ai/action/status/:id`; platform descriptors never expose their own status route.

## Lower findings

- F-ADV-6 (MED): Telegram deferred transport (MTProto vs Bot API) — if two implementers pick differently, the auth/session story diverges. Currently deferred correctly; needs an AD before impl.
- F-ADV-7 (LOW): `internal` consumer bypasses metering — spine doesn't pin whether `internal` consumers still log usage for observability. Minor.

## Recommendation

PASS-WITH-FIXES. Apply F-ADV-1..4 fixes to the spine before finalizing; F-ADV-5..7 to Conventions or Deferred.
