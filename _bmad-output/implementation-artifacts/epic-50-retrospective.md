# Epic 50 Retrospective — Public Scrape Gateway

> Date: 2026-09-27
> Scope: Stories 50.1–50.9 (9 stories, all done)
> Branch: main · tags v3.5.1 → v3.5.7
> Status: **COMPLETE** — shipped end-to-end

## Story ledger

| Story | Tag | Deliverable |
|---|---|---|
| 50.1 serviceAuth lane | v3.5.1 | Bearer-derived consumer, `X-Consumer-Id` observability hint |
| 50.2 sync/async mode dispatch | v3.5.1 | `SYNC_BUDGET_MS=1500`, 202 degrade + `degraded_reason` |
| 50.3 unified envelope + request_id | v3.5.1 | AD-5 envelope + C-10 error envelope + trace plumbing |
| 50.4 quota + x402 + metrics | v3.5.2 | per-consumer token bucket, anonymous IP bucket, `/api/admin/gateway/metrics`, trace lookup |
| 50.5 self-discovery catalog | v3.5.3 | `GET /api/actions` REST ≡ `x_actions_list` MCP, `/actions` catalog, `/gateway` playground |
| 50.6 pumpfun fetch_coin_meta | v3.5.4 | lightweight sync action |
| 50.7 crypto/dexscreener | v3.5.5 | new platform — 5 keyless REST actions, all sync-capable |
| 50.8 social/telegram skeleton | v3.5.6 | transport deferred, `coming_soon` marker, XACT_4001 stubs |
| 50.9 e2e + quickstart | v3.5.7 | contract suite + docs/consumer-quickstart + `/gateway/quickstart` page |

## What worked

- **Descriptor-driven dispatch** paid off repeatedly — adding dexscreener
  (50.7) and telegram (50.8) platforms was ~150 LOC each because
  aliases/actionMap/mapArgs/factories were already a thin seam.
- **Anonymous-vs-presented-invalid split** (50.4 patch over 50.1) was the
  cleanest way to keep both contracts: missing Authorization → anonymous
  lane; malformed Bearer → 401 fail-closed.
- **Token-bucket seams** (`_setTokenBucket`) made quota tests deterministic
  without mocks of upstream — same shape verified live in `live-probe-results.md`.
- **Sync ceiling + 202 degrade** absorbed slow upstreams gracefully —
  pump.fun/reddit crossing 1.5s degraded to async instead of failing.

## What didn't

- **Upstream shape drift**: `/tokens/v1` actually returns pair payload
  (info.socials nested inside `pair.info`), `/orders/v1` returns `{orders,
  boosts}` envelope not a bare array. Initial spec assumed simpler shapes;
  live probes caught both. **Fix**: probe upstreams before freezing
  normalizer shape.
- **`CATEGORIES` enum** didn't include `crypto` — first real platform in a
  new category required patching `src/core/types.js`.
- **Stale contract tests** in 50.5/50.6 era asserted `fetch_coin_meta` was
  unimplemented — after 50.6 landed they failed. Needed an assertion lift
  when each story landed; consider tagging "pending contract" tests to auto-
  relax on implementation.
- **Pre-existing test debt** carried across the whole epic:
  `session-cookie-shim` ×3, `admin`, `layout`, `mcp-bridge` failures were
  verified pre-existing on baseline — never introduced by epic-50 work.

## Metrics

- 9 stories landed across 7 tags (v3.5.1 → v3.5.7)
- Actions manifest: 224 → 233 entries; platforms: 26 → 27 (+dexscreener, +telegram coming_soon)
- Test delta: +35 new tests (50.4 ×13, 50.5 ×10, 50.6 ×7, 50.7 ×11, 50.8 ×7,
  50.9 ×10 — overlap counted once); epic-end regression **189/189 green**
- Upstream probe timings: dexscreener p50 ≈ 274–437 ms sync; pumpfun/
  reddit >1.5 s → clean async degrade

## Carried defer items (for next epic)

- Pre-existing failures not owned by epic-50 (verified on baseline):
  - `tests/session-cookie-shim.test.js` ×3
  - `tests/api/admin.test.js`
  - `apps/web` layout test
  - `tests/mcp-bridge.test.js`
- Telegram real impl — D4 spec picks transport (`mtproto` | `bot` | `web`),
  then lands `TelegramClient#getChannelMessages`/`getChannelInfo`/
  `searchChannels`/`resolveUser` + flips `coming_soon` off and populates
  `syncCapableActions`.

## Action items

1. Telegram transport D4 spec — pick + land impl; flip `coming_soon` → `stable`.
2. Pre-existing test debt — triage `session-cookie-shim`/`admin`/`layout`/
   `mcp-bridge` failures; they're outside Epic 50 scope but still red.
3. Add "upstream-shape-first" rule to future platform specs — live-probe
   before freezing normalizer contracts (catches the /tokens/v1 pair-payload
   surprise early).
