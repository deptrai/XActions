---
id: SPEC-12-8-social-enrichment
story: 12-8-xactions-social-enrichment-parallel-scrape-cross-repo-spec
epic: 12
companions: []
sources:
  - ../../jev-trading/_bmad-output/implementation-artifacts/stories/12-8-xactions-social-enrichment-parallel-scrape-cross-repo-spec.md
---

> **Contract addendum.** Additive-only extension to `spec-xactions-public-scrape-gateway`. Nothing here removes or renames an existing field; a gateway that ships this spec still answers old jev-trading builds bit-for-bit identically.

# Social Enrichment & Parallel Scrape

## Why

jev-trading Story 12.8 needs three things the current gateway does not emit: per-author quality signals (`follower_quality`, `is_new_account`, `account_age_days`), a per-post `engagement_velocity`, and a caller-tunable `concurrency` for parallel scrape threads. All are additive: absent fields on older responses must remain absent (never zero-filled), and unknown body keys must be ignored — the client already relies on this contract for additive rollout.

## Capabilities

- **CAP-1 — New channels**
  - **intent:** `POST /api/platform/:platform/scrape` accepts `platforms[]` containing `telegram`, `tiktok`, and `4chan`, each mapping to its descriptor.
  - **success:** `platforms: ['x','reddit','telegram','tiktok','4chan']` returns a `channels` envelope keyed by each requested name; channels the dispatcher has no descriptor for return `{status:'unsupported'}` rather than failing the batch.

- **CAP-2 — Author enrichment fields**
  - **intent:** Each post's `author` object may carry `account_age_days` (snake_case preferred, camelCase `accountAgeDays` accepted), `follower_quality` (0..1), and `is_new_account` (bool). Absent fields stay absent — never `0`/`false`/`null` placeholders.
  - **success:** For an enriched gateway build, a post with `{author:{handle:'x',followers:50,account_age_days:12,follower_quality:0.83,is_new_account:true}}` normalizes onto jev's `Post.author` with the same values; a legacy post with none of those fields deserializes with `follower_quality === undefined` and `is_new_account === undefined`.

- **CAP-3 — Engagement velocity**
  - **intent:** Each post may carry `engagement_velocity` (interactions/minute, float). Optional end-to-end: old payloads omit it, new payloads may still omit it per-post.
  - **success:** `{text:'x', engagement_velocity:4.5}` round-trips onto `Post.engagement_velocity === 4.5`; posts without the field deserialize `undefined`, never `0`.

- **CAP-4 — Parallel scrape controls**
  - **intent:** The scrape request body accepts `concurrency` (positive int) and `proxy_rotate` (bool). `concurrency` bounds the number of parallel scrape threads the dispatcher fans out to per platform; `proxy_rotate` asks the proxy pool to rotate egress per thread. Both keys are optional and ignored by older gateway builds.
  - **success:** `{"action":"search","query":"x","platforms":["x","reddit"],"concurrency":6,"proxy_rotate":true}` queues a batch whose internal dispatcher runs ≤6 parallel workers per platform, honoring the proxy-rotation flag; a request without either key behaves exactly as today.

## Constraints

- **C-1** — Additive only. No renames, removals, or type changes to existing post/author fields. New keys arrive only when computed; absence is a signal, not an error.
- **C-2** — `concurrency` is clamped server-side to the gateway's per-platform ceiling (existing `MAX_BATCH_PLATFORMS` / dispatcher limits). A client asking for `concurrency:999` gets the ceiling, not a new failure mode.
- **C-3** — `proxy_rotate` is best-effort: when the proxy pool is empty the flag is a no-op, not a 500.
- **C-4** — Channel names in `platforms[]` must normalize through the existing `PLATFORM_ALIASES` path (`tg` → `telegram`, etc.) before descriptor lookup.
- **C-5** — `4chan` is a reserved channel name, not a descriptor today: the gateway should accept the name, return `{status:'unsupported'}` for it, and log it as `channel_coming_soon` until a descriptor lands — never 400 the whole batch.

## Non-goals

- **NG-1** — Server-side transport choice for Telegram (MTProto vs Bot API) — deferred to the D4 spec; this spec only names the channel contract.
- **NG-2** — A new `engagement_velocity` formula across every platform; each descriptor computes it from its own native counters.
- **NG-3** — Persisting `concurrency`/`proxy_rotate` per consumer; they are per-request knobs.

## jev-trading consumer mapping (already shipped)

The jev side maps these fields verbatim:

| Gateway field | jev `Post`/`Author` field | Notes |
|---|---|---|
| `author.account_age_days` / `author.accountAgeDays` | `author.account_age_days` | snake_case preferred; both accepted |
| `author.follower_quality` / `author.followerQuality` | `author.follower_quality` | 0..1; absent → `undefined` |
| `author.is_new_account` / `author.isNewAccount` | `author.is_new_account` | bool; absent → `undefined` |
| `engagement_velocity` / `engagementVelocity` | `post.engagement_velocity` | float; absent → `undefined` |

`corpus_snapshot` gains two derived columns populated from these fields:
- `new_account_pct` — share of posts whose `author.is_new_account === true`.
- `avg_engagement_velocity` — mean `post.engagement_velocity` over posts where present; `NULL` when none carried it.
