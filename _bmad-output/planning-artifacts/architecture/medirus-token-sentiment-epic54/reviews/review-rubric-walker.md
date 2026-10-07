# Review — Rubric Walker (good-spine checklist)

**Scope:** ARCHITECTURE-SPINE.md @ commit 70741da (draft, post-OQ-resolution)
**Verdict: CONDITIONAL PASS** — covers every real divergence point; 4 contract-level gaps found by the adversarial lens are the binding items (see review-adversarial.md).

## Checklist

| # | Criterion | Result |
|---|---|---|
| 1 | Fixes real divergence points for stories 54.0–54.6 | ✅ All 10 review findings mapped to ADs; nothing visible in the epic text is left to taste |
| 2 | ADs enforceable | ⚠️ AD-2 says rollup is "rebuildable materialized cache" but doesn't say who maintains it (incremental vs rebuild script) — two implementers can pick differently |
| 3 | Deferred carries no divergence risk | ✅ All 4 deferred items are genuinely safe to defer (spike output, ops story, second consumer, impossible backfill) |
| 4 | Ratifies brownfield | ✅ Verified against code: historyStore username-keyed exclusion, telegram skeleton seam, governor wiring, dispatcher actions all real |
| 5 | Covers epic capabilities | ✅ Capability map covers 54.0–54.6 including gated stories |
| 6 | No weakening of parent ADs | ✅ AD-5 applies gateway AD-2 pattern rather than contradicting it; AD-6 honors Epic-52 consolidation; degraded contract narrows (not weakens) AD-3 async semantics |
| 7 | All altitude-owned dimensions decided | ⚠️ Observability/side-effects folded into degraded contract (OK); operational envelope for relay explicitly deferred to 54.6 (OK); but TokenMention field ownership (who computes sentimentScore, engagement shape) is underdecided — a convention row suffices |

## Findings

- **HIGH** — TokenMention field ownership unspecified: does the pipeline store `sentimentScore` (which scorer — lexicon or LLM?) or do engines compute? See adversarial F-A.
- **HIGH** — Dedup-vs-re-observation rule missing on append-only log: re-scraped tweet with fresh engagement → drop or upsert? See adversarial F-B.
- **MEDIUM** — Dual-auth wiring order: "authenticate OR serviceAuth" is a seam, not expressible as sequential middleware; needs one-line convention (composite helper). See adversarial F-E.
- **MEDIUM** — AD-6 lists `x_scrape`/`x_crypto` alternatives for telegram; pick one — `x_scrape` matches the platform-descriptor pattern (gateway AD-1: telegram registers like dexscreener, a platform not a crypto-domain action).
- **LOW** — `TokenMention.source` shape `{platform,platformId,channelId?}` vs wire form `x:<tweetId>`: serializer owner unstated (low — convention table covers both forms).
- **LOW** — Weight defaults (0.5/0.3/0.2) location unspecified; recommend shared config owned by tokenRegistry, overridable per call.
