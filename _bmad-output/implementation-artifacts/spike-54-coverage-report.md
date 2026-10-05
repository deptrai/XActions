# Spike 54.0 — Ingestion Coverage Report

> Generated: 2026-10-05T01:38:50.839Z
> Runner: `scripts/spike-54-coverage.mjs` (phases: search)
> Auth path: **auth_session (~/.xactions/cookies.json fallback)** (cookie=false, csrf=false)

## Verdicts (per story)

| Story | Verdict |
|---|---|
| 54.1 TokenEntityExtractor | GO — search returns data for ≥50% of probe queries |
| 54.2 TokenMentionPipeline | GO — global search path viable |
| 54.3 Hype-vs-Liquidity | GO — 100% of watchlist has liquidity_usd |
| 54.4 Token Mindshare | GO — cashtag coverage 1.00 supports watchlist-share mindshare |
| Poll ceiling | Poll ceiling ≈ 106.3 queries/10min (sent 12, degraded=false) — feed to setPlatformLimit('twitter') |

## M1 — X Search coverage (9/10 non-empty, 0 auth errors)

| Type | Query | Status | Count | UniqAuthors | FullText | Recency | ms | Error |
|---|---|---|---|---|---|---|---|---|
| cashtag | `$PEPE` | ok | 25 | 25 | yes | 2026-10-04→2026-10-05 | 1909 |  |
| cashtag | `$WIF` | ok | 20 | 20 | yes | 2026-10-04→2026-10-05 | 920 |  |
| cashtag | `$BONK` | ok | 25 | 25 | yes | 2026-10-04→2026-10-05 | 1596 |  |
| contract | `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pP` | ok | 20 | 20 | yes | 2026-10-04→2026-10-05 | 717 |  |
| contract | `EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65` | ok | 20 | 20 | yes | 2026-10-04→2026-10-05 | 786 |  |
| contract | `So11111111111111111111111111111111111111` | ok | 20 | 20 | yes | 2026-09-30→2026-10-04 | 792 |  |
| tokenname | `Pepe coin` | ok | 20 | 20 | yes | 2026-10-04→2026-10-05 | 977 |  |
| tokenname | `dogwifhat` | ok | 20 | 20 | yes | 2026-10-02→2026-10-04 | 986 |  |
| kol_timeline | `from:VitalikButerin` | ok | 20 | 20 | yes | 2026-09-21→2026-10-04 | 831 |  |
| kol_timeline | `from:aeyakovenko` | ok | 0 | 0 | no | — | 754 |  |

Hit rates: cashtag=1.00 contract=1.00 tokenname=1.00 kol=0.50

## M2 — Dexscreener watchlist (5/5 lookups ok)

| Token | Contract | Status | liquidityUsd | volume24h | ms |
|---|---|---|---|---|---|
| BONK | `DezXAZ8z7PnrnRJj…` | ok | 445449.37 | 404968.13 | 433 |
| WIF | `EKpQGSJtjMFqKZ9K…` | ok | 6974456.43 | 387848.14 | 113 |
| WSOL | `So11111111111111…` | ok | 30580506.4 | 69704820.19 | 69 |
| POPCAT | `7GCihgDB8fe6KNjn…` | ok | 4189223.32 | 206946.98 | 172 |
| MEW | `MEW1gQWJ3nEXg2qg…` | ok | 10881571.61 | 247456.87 | 63 |

Coverage: liquidity=100% volume24h=100%  (threshold: ≥50% for 54.3 GO)

## M3 — Poll ceiling

Sent **12** queries in 68s → **≈106.3 queries/10min** sustainable. Degraded at: never (hit CEILING_MAX or window end). Recommendation: `setPlatformLimit('twitter', { safeRequestsPerMinute: 10 })` pending confirmation.

## Decision forks (verbatim from epic)

- contract-address search blind → 54.2 switches to "KOL-timeline monitor + token extraction" instead of global search: **not triggered**
- cashtag coverage <30% for small tokens → mindshare scoped to watched-token share: **not triggered**

## Raw data

`scripts/spike-54-coverage-results/results.json`
