# Epic 50 — Live Probe Results (Story 50.9 contract verification)

> Captured: 2026-09-27, against live upstreams on `localhost:3009` via
> `POST /api/platform/{platform}/scrape`. Timings are wall-clock curl/urllib
> total (client → API → upstream → response), so they include overhead on top
> of `metadata.duration_ms`.

## Sync-capable actions

| Platform | Action | Duration | Mode | sync_capable | Outcome |
|---|---|---:|---|---|---|
| dexscreener | `token_lookup` | 437 ms | sync | true | 1 record — pairs[] (raydium/orca/meteora) |
| dexscreener | `token_socials` | 287 ms | sync | true | BONK — 3 socials + 1 website |
| dexscreener | `token_legitimacy` | 330 ms | sync | true | orders[] + boosts[] counts |
| dexscreener | `latest_boosted` | 81 ms | sync | true | 5 records |
| dexscreener | `latest_profiles` | — | sync | true | array ok |
| pumpfun | `fetch_coin_meta` | 1507 ms | async (degrade) | true | `degraded_reason=upstream_timeout` — pump.fun upstream slower than 1500ms ceiling → clean async fallback |
| reddit | `search` | 1509 ms | async (degrade) | true | `degraded_reason=upstream_timeout` — same |

## Non-sync-capable rejection

| Platform | Action | Status | error.code | error.kind |
|---|---|---|---|---|
| telegram | `channel_messages` mode=sync | 400 | XACT_4001 | validation |

## Observability (GET /api/admin/gateway/metrics)

```
total: 4   errors: 1
upstreamHealth:
  dexscreener: {p50:421, p95:421, p99:421, errorRate:0}
  reddit:      {p50:1517, p95:1517, p99:1517, errorRate:0}
  telegram:    {p50:0, errorRate:1}   ← stub rejection counted
```

## Notes

- Dexscreener upstream is FAST (sub-500ms) — comfortably sync-capable.
- pump.fun `frontend-api-v3` and `reddit.com` upstreams cross the 1.5s ceiling
  on this run — gateway correctly degrades to `async` + `operationId` +
  `degraded_reason='upstream_timeout'` (50.2 contract). Consumers should poll
  `statusUrl`; the scrape continues in the background.
- `telegram/*` stubs return deterministic `XACT_4001`/`validation` on
  `mode:'sync'` — no upstream call is made.
