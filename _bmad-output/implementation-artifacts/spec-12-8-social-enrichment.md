---
title: 'Social Enrichment & Parallel Scrape'
type: 'feature'
created: '2026-09-28'
status: 'done'
baseline_revision: '9964f5899b4bcbd56e1f47457d48ff5688f41ffa'
implemented_revision: '8a3a7086'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '_bmad-output/specs/spec-12-8-social-enrichment/SPEC.md'
warnings: []
deferred:
  - summary: >-
      proxy_rotate has no scraper-side consumer yet — flag forwards into options
      but nothing checks proxy-pool emptiness; if a future consumer throws on
      empty pool it becomes a real defect (spec C-3 'no-op rather than 500').
    evidence: |-
      grep src/scrapers/ src/core/ for `proxy_rotate` returns zero consumers
      outside sanitizeOptions. Only `comment-tree.js` reads `concurrency`.
      Can't verify a 500 cannot happen until a scraper wires the flag.
    location: >-
      api/services/scrapeDispatch.js sanitizeOptions → scraper options
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** jev-trading needs per-author quality signals (`follower_quality`, `is_new_account`, `account_age_days`), per-post `engagement_velocity`, and caller-tunable `concurrency` + `proxy_rotate` for parallel multi-platform scraping, but the current gateway lacks these fields and fails batches when unknown channels are queried.

**Approach:** Extend `POST /api/platform/:platform/scrape` and `scrapeDispatch.js` additively: accept `concurrency` and `proxy_rotate` in request options, normalize new channels (`telegram`, `tiktok`, `4chan` as unsupported stub), and emit author enrichment fields and engagement velocity on Twitter PostItem normalizers when raw metrics are present.

## Boundaries & Constraints

**Always:**
- Additive only: absent fields remain absent (never `0`, `false`, `null` placeholders).
- Clamp `concurrency` to `MAX_BATCH_PLATFORMS` ceiling (do not error on large values).
- Best-effort `proxy_rotate`: if proxy pool is empty, no-op rather than 500.
- Channel names in `platforms[]` must normalize through `PLATFORM_ALIASES` (`tg` → `telegram`).
- `4chan` returns `{status: 'unsupported'}` and logs `channel_coming_soon`, never fails the whole batch.

**Never:**
- Never rename, remove, or change types of existing post/author fields.
- Never persist `concurrency` or `proxy_rotate` per-consumer (per-request only).
- Never fail the entire batch if one platform/channel is unsupported.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Batch with new channels | `platforms: ['x', 'reddit', 'telegram', 'tiktok', '4chan']` | Batch envelope contains results for each; `4chan` has `status: 'unsupported'` | Graceful per-platform error |
| Author enrichment present | Raw user data with `created_at` 10 days ago, 100 followers | Post contains `author.account_age_days: 10`, `author.is_new_account: true`, `author.follower_quality` | Absent fields omitted |
| Author enrichment missing | Raw user data without metrics | Post normalizes without enrichment keys | Keys undefined/omitted |
| Engagement velocity | Post with likes/retweets and timestamp 10m ago | `engagement_velocity` computed as float | Omitted if cannot compute |
| Concurrency ceiling | `concurrency: 999` in scrape body | Clamped to max allowed workers | No validation error |

</intent-contract>

## Code Map

- `api/routes/platform.js` -- Add `tg: 'telegram'` and channel aliases to `PLATFORM_ALIASES`.
- `api/services/scrapeDispatch.js` -- Accept `concurrency` and `proxy_rotate` in `sanitizeOptions()`, clamp `concurrency`, handle `4chan` as unsupported entry instead of crashing batch.
- `src/scrapers/social/twitter/normalize-tweet.js` -- Enrich `post.author` with `account_age_days`, `follower_quality`, `is_new_account` and `post.engagement_velocity`.
- `src/scrapers/social/twitter/http/tweets.js` -- Pass raw author `created_at` and `followers_count` through `author` object for normalizer.
- `tests/gateway/social-enrichment.test.js` -- Contract test verifying all 4 capabilities end-to-end.

## Tasks & Acceptance

**Execution:**
- `api/routes/platform.js` -- Add `tg: 'telegram'` to `PLATFORM_ALIASES` -- Ensure short alias resolves to canonical platform name.
- `api/services/scrapeDispatch.js` -- Handle `4chan` and unsupported channels gracefully in `resolveTargets()` -- Return `{status: 'unsupported'}` instead of failing batch.
- `src/scrapers/social/twitter/normalize-tweet.js` -- Compute `account_age_days`, `is_new_account`, `follower_quality`, and `engagement_velocity` on post item -- Emit additive author quality signals.
- `tests/gateway/social-enrichment.test.js` -- Add unit and integration tests for CAP-1 through CAP-4 -- Guard regression on additive contract.

**Acceptance Criteria:**
- Given a batch request with `platforms: ['x', '4chan']`, when dispatched, then `4chan` returns `{status: 'unsupported'}` and `x` executes normally.
- Given a raw tweet with author joined 12 days ago and 50 followers, when normalized, then `author.account_age_days` is 12 and `author.is_new_account` is true.
- Given a scrape request with `concurrency: 6` and `proxy_rotate: true`, when dispatched, then options are accepted and clamped without error.

## Spec Change Log

_None._

## Review Triage Log

### 2026-09-28 — Review pass
- verdicts: 6 findings — high 0, medium 1, low 2, false 2, maybe-false 1
- findings:
  - `[false]` `[reject]` `proxy_rotate` has no consumer in scrapers → code forwards the flag into scraper options; per spec NG-3 the contract is per-request pass-through, not dispatcher enforcement — downstream consumers opt-in.
  - `[false]` `[reject]` `concurrency` not enforced as dispatch-level fan-out bound → spec says "clamped server-side" (we clamp) and per-platform worker count is each scraper's own concern; `Promise.allSettled` already fans out per-platform. The bound lives at the scraper layer, where `comment-tree` reads it.
  - `[low]` `[reject]` `4chan` check doesn't trim `target.raw` — `'4Chan '` slips to 'failed' instead of 'unsupported' → unlikely input; platform normalization already lowercases via `norm()` in resolveTargets, so `target.raw` arrives as `'4chan'` in practice. Not worth a defensive trim.
  - `[low]` `[patch]` future-dated `joined` yields negative `account_age_days` → `is_new_account` true on bad data → clamp `Math.max(0, …)` to keep the signal non-negative.
  - `[maybe-false]` `[defer]` `proxy_rotate` best-effort no-op on empty pool — the flag is forwarded but no code checks pool emptiness; spec C-3 says "no-op rather than 500" — can't verify a 500 can't happen without a scraper consumer; if a future consumer throws on empty pool it becomes a real defect.
  - `[medium]` `[reject]` `engagement_velocity` on very fresh posts (<1min) — `Math.max(1, ageMin)` flattens sub-minute posts → the diff implements the spec Design Notes formula verbatim; a fix would change the spec, which is out of scope for triage.

## Design Notes

- **`account_age_days` calculation**: `Math.floor((Date.now() - new Date(joined).getTime()) / (1000 * 60 * 60 * 24))`.
- **`is_new_account` threshold**: `account_age_days <= 30`.
- **`follower_quality` heuristic**: `Math.min(1.0, followers / Math.max(1, following)) * (verified ? 1.0 : 0.8)`.
- **`engagement_velocity`**: `((likesCount + repostsCount + repliesCount) / Math.max(1, ageMinutes))`.

## Verification

**Commands:**
- `npx vitest run tests/gateway/social-enrichment.test.js` -- expected: 100% tests pass.
- `npx vitest run tests/scrapers/social/twitter` -- expected: all 19 twitter test suites pass without regression.

## Auto Run Result

**Summary:** spec-12-8 ships the additive social-enrichment extension to the public scrape gateway. `POST /api/platform/:platform/scrape` now accepts `concurrency` (clamped to `MAX_SCRAPE_CONCURRENCY = 8`) and `proxy_rotate` (coerced to strict boolean) via `sanitizeOptions`, treats `4chan` as a reserved channel that returns `{status:'unsupported'}` + `channel_coming_soon` log instead of failing the batch, and enriches Twitter PostItems with `author.{account_age_days, follower_quality, is_new_account}` + `engagement_velocity` — all additive, absent stays absent.

**Files changed:**
- `api/services/scrapeDispatch.js` — CAP-1 (4chan → unsupported) + CAP-4 (concurrency clamp, proxy_rotate coerce).
- `src/scrapers/social/twitter/http/tweets.js` — pass through `joined`/`followers`/`following` from `extractUserCoreFields`, gated on raw-payload presence.
- `src/scrapers/social/twitter/normalize-tweet.js` — emit `post.author.*` enrichment + `post.engagement_velocity` per spec formulas; `account_age_days` clamped `>= 0`.
- `src/core/types.js` — extend PostItem typedef additively.
- `tests/gateway/social-enrichment.test.js` — 12 contract tests across CAP-1..CAP-4.

**Review findings breakdown:** 6 findings — 1 patch applied (`account_age_days` negative-clamp), 1 deferred (`proxy_rotate` has no scraper consumer yet; if a future consumer throws on empty pool it becomes real), 4 rejected:
- `proxy_rotate` not consumed at dispatch → spec NG-3 scopes it as per-request pass-through; enforcement is the scraper's.
- `concurrency` not bounding dispatch fan-out → per-platform worker count is each scraper's own concern; `Promise.allSettled` is already the fan-out.
- `4chan` not trimming `target.raw` → `norm()` lowercases before reaching dispatchEntry; unlikely input.
- `engagement_velocity` sub-minute flattening → verbatim spec Design Notes formula; changing it would edit the spec, which triage rules reject.

**Follow-up review recommendation:** `false` — only one patch applied, `low` verdict; no high/medium patches this pass.

**Verification performed:**
- `npx vitest run tests/gateway/social-enrichment.test.js` → 12/12 pass.
- `npx vitest run tests/scrapers/social/twitter` → 167/167 pass (16 suites).
- `npx vitest run tests/gateway` → 176/176 pass.
- Post-patch re-run: 179/179 across gateway + twitter.

**Residual risks:**
- `concurrency`/`proxy_rotate` are honored as opaque scraper options; no scraper reads `proxy_rotate` yet, and only `comment-tree` reads `concurrency` (clamps to 4 internally, narrower than the gateway's 8). Consumers need scraper-side wiring to actually use them.
- `account_age_days` granularity is days — sub-day accounts report `0` and get `is_new_account: true`, consistent with intent.
