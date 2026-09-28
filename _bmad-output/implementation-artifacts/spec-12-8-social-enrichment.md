---
title: 'Social Enrichment & Parallel Scrape'
type: 'feature'
created: '2026-09-28'
status: 'implemented'
baseline_revision: '9964f5899b4bcbd56e1f47457d48ff5688f41ffa'
implemented_revision: '8a3a7086'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '_bmad-output/specs/spec-12-8-social-enrichment/SPEC.md'
warnings: []
deferred: []
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

_None._

## Design Notes

- **`account_age_days` calculation**: `Math.floor((Date.now() - new Date(joined).getTime()) / (1000 * 60 * 60 * 24))`.
- **`is_new_account` threshold**: `account_age_days <= 30`.
- **`follower_quality` heuristic**: `Math.min(1.0, followers / Math.max(1, following)) * (verified ? 1.0 : 0.8)`.
- **`engagement_velocity`**: `((likesCount + repostsCount + repliesCount) / Math.max(1, ageMinutes))`.

## Verification

**Commands:**
- `npx vitest run tests/gateway/social-enrichment.test.js` -- expected: 100% tests pass.
- `npx vitest run tests/scrapers/social/twitter` -- expected: all 19 twitter test suites pass without regression.
