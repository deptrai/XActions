# Review: Rubric Walker (inline, gate blocker)

Reviewer: Winston (inline substitute — parallel subagent blocked on tool access)
Date: 2026-09-26
Verdict: PASS-WITH-FIXES — spine covers divergence points well; one whole-dimension gap on operational envelope.

## Checklist pass

- ✅ **Fixes real divergence points**: AD-1 (single route), AD-2 (auth seam), AD-3 (sync/async flag), AD-4 (latency boundary), AD-5/6 (consumer-agnostic envelope), AD-7 (per-consumer rate-limit) each map to observed divergences (jev fork, auth mismatch, latency mismatch).
- ✅ **Rules are enforceable**: each AD has Binds + Prevents + Rule. No wishy-washy "should consider".
- ⚠️ **Deferred items**: 5 entries — MTProto-vs-Bot is correctly deferred (consumer-side transport decision); dexscreener polling cadence correctly deferred (data-driven); `syncCapable` list correctly deferred. None let two units diverge TODAY because they're all "not-yet-built" — but if Telegram gets specced before MTProto-vs-Bot is resolved, two implementers could pick differently. Move Telegram transport to Open Questions instead of Deferred? — *no, Deferred is right; flag for the D4 spec.*
- ✅ **Brownfield ratification**: spine claims verified — every "exists" maps to real file:line (see tech-verification review).
- ✅ **Spec coverage**: D1 (reddit search) AD-1+AD-3, D2 (coin meta) AD-1+AD-3+AD-4, D3 (dexscreener) AD-1+AD-7, D4 (telegram) AD-1+AD-5 — all bound in Capability map.
- ⚠️ **Inherited spine**: standalone feature spine, no parent — N/A.
- ❌ **Whole-dimension gap**: **operational/environmental envelope is silent**. Spine owns deployment + observability surface (it's a public-facing gateway) but never says: which environments the gateway ships to (dev/staging/prod), what infra it needs (Redis version, Postgres, Bull worker count), what metrics/traces a consumer can rely on (request-id propagation, OTel spans, log schema), or what the SLO/error-budget is for sync vs async mode. Two ops teams could run the gateway with different Redis versions and Bull concurrency and get different sync-mode timeout behavior.

**Fix**: add a brief "Operational Envelope" subsection under Consistency Conventions or a new AD-8 — pin minimum Redis version, Bull worker model (separate process), OTel/request-id propagation contract (`X-Request-Id` or W3C traceparent), and the sync-mode SLO (e.g. p99<1.5s means consumer's 2s budget is safe).

## Findings

- **F-RUBRIC-1 (HIGH)**: operational envelope missing — observability contract, infra minimums, SLO pinning.
- **F-RUBRIC-2 (MED)**: Telegram MTProto-vs-Bot deferred correctly but not linked from D4 capability row → easy to miss when D4 spec lands.
- **F-RUBRIC-3 (LOW)**: `preview[≤10]` semantics unpinned — see F-ADV-4.
- **F-RUBRIC-4 (LOW)**: spine doesn't pin whether `mode` is required or optional in the request — implied optional (default per-action) but not explicit.

## Recommendation

PASS-WITH-FIXES. Add Operational Envelope section (F-RUBRIC-1); tighten request contract (F-RUBRIC-4).
