# Review — Adversarial Two-Units Lens

**Verdict: CONDITIONAL** — 4 high-severity contract holes where two stories can each obey every AD and still diverge. Fixes proposed inline; all are convention-row or single-clause tightenings, no new ADs needed.

## Constructed incompatible pairs

**F-A · sentimentScore ownership (HIGH).** Implementer-54.2 stores `sentimentScore` on TokenMention at ingest using the lexicon engine (zero-I/O, cheap). Implementer-54.4 computes mindshare reading `sentimentScore` and assumes LLM-grade scores (jevSentiment). Both comply with AD-2 (field lives on the model) yet produce different denominators. → Convention: pipeline computes lexicon score at ingest; `sentimentScoreLLM` is a separate nullable field filled by 54.5 batch only; engines read `sentimentScore` and never re-score inline.

**F-B · Re-observation vs append-only (HIGH).** AD-2 says TokenMention is append-only event log + AD-4 dedup key `(platform,platformId)`. Implementer-A drops re-scraped tweets (dedup wins) → engagement never updates → hype metrics stale. Implementer-B appends a new row (append-only wins) → unique-authors double-counts → unique-source normalization broken. Both letter-compliant. → Tighten AD-4: dedup key is **identity** — first observation inserts; re-observation upserts mutable fields (`engagement`, `lastSeenAt`) in place; TokenMention is append-only *per identity*.

**F-C · Dedup scope across tokens (HIGH).** Tweet mentions $PEPE and $WIF → two TokenMention rows share `platformId`. Implementer dedups on `(platform,platformId)` globally → second token's row dropped → mindshare denominator shrinks. → Tighten: dedup key scoped to `(canonicalId, platform, platformId)` — same source tweet may feed N tokens.

**F-D · Engagement field shape (MEDIUM-HIGH).** `engagement` object `{likes,retweets,replies}` vs scalar? 54.3's weight (0.5 mentions / 0.3 authors / 0.2 engagement) needs a defined normalization. → Convention: `engagement Json` = `{likes,retweets,replies,quotes}` verbatim from source; engines normalize (e.g., `log10(1+sum)`) inside the formula — shape fixed, math engine-owned.

**F-E · Dual-auth wiring (MEDIUM).** "authenticate OR serviceAuth" — sequential `router.use(authenticate, serviceAuth)` rejects everyone (each throws). → Convention: single composite middleware `anyAuth` (`try authenticate → fallback serviceAuth → consumer_id`), one place, both lanes.

**F-F · x_scrape vs x_crypto for telegram actions (MEDIUM).** AD-6 says `x_scrape`/`x_crypto{telegram_*}` — two readings. → Pick `x_scrape`: telegram is a *platform* descriptor (like dexscreener registering under gateway AD-1), not a crypto-domain action. Reserve `x_crypto` for domain metrics.

**F-G · Rollup maintenance mode (MEDIUM).** "Rebuildable materialized cache" — incremental on ingest vs nightly rebuild vs on-read? → Tighten AD-2: incremental update at ingest (single writer = pipeline), plus `rebuildRollups()` script for repair. Event log remains authority.

**F-H · Registry mutation surface (LOW).** Who writes TokenRegistry rows (REST? config? seed?) → Convention: REST admin endpoints under dual-auth; DB seed for bootstrap only.

## Non-findings (checked, held)

- degraded contract is uniform across engines (AD-3) — can't diverge
- canonicalId grammar fully specified (AD-1) — extractor can't fork it
- relay seam placement (AD-9) vs gateway AD-1 — consistent, transport is the only variable
- camelCase dual-emit convention covers envelope divergence (F10 finding already handled)
