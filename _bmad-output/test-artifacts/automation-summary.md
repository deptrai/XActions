---
stepsCompleted: ['step-01-preflight-and-context','step-02-identify-targets']
lastStep: 'step-02-identify-targets'
lastSaved: '2026-09-11'
inputDocuments:
  - _bmad/tea/config.yaml
  - .claude/skills/bmad-testarch-automate/resources/tea-index.csv
  - _bmad-output/implementation-artifacts/stories/35-3-instagram-scraper.md
  - src/scrapers/social/instagram/{client,crawler,validator,normalizer,index}.js
  - src/scrapers/index.js
  - tests/scrapers/social/instagram/{client,crawler,validator,normalizer}.test.js
---

# Test Automation Expansion — Story 35.3 Instagram Scraper

## Step 1 — Preflight & Context

- **detected_stack**: `fullstack` (Express backend + Vitest unit/integration + Playwright e2e in tests/e2e + static dashboard frontend). Target scope for this run is the **backend scraper layer** (no browser needed — `node:http` fixture pattern, matching sibling scrapers).
- **Mode**: BMad-Integrated — Story 35.3 (`_bmad-output/implementation-artifacts/stories/35-3-instagram-scraper.md`) is `done`; tests were authored during dev. This run expands coverage.
- **Framework**: Vitest 4.x (`vitest.config.js`), tests in `tests/scrapers/social/instagram/`. Convention: **no mocks** — real `node:http` fixture server + real implementations only (CLAUDE.md mandatory rule).
- **Config flags**: `tea_use_playwright_utils=true`, `tea_use_pactjs_utils=true`, `tea_pact_mcp=none`, `tea_browser_automation=auto`, `test_stack_type=auto`, `tea_execution_mode=auto`.
- **Pact relevance**: not relevant — Instagram is an outbound scraper client, not a consumer/provider pair with an internal contract. No Pact artifacts generated.

## Step 2 — Coverage Plan

### Existing coverage (58 tests, 626 lines)
- client.test.js (22): transport normalize, headers, profile/hashtag/post/comments fetch, error mapping 429/401/404/challenge, session persist, instagrapi 501, proxy env+provider, shortcode URL variants, challenge→rotate_proxy escalation, env-gated E2E.
- crawler.test.js (11): action registration+aliases, user/hashtag/post/comments via start(), arg validation 400, cleanup.
- validator.test.js (15), normalizer.test.js (10).

### Gaps vs sibling scrapers (bluesky/mastodon/youtube/zalo have dispatcher; threads/tiktok/facebook/twitter have checkpoint-resolver; medium/reddit have integration)

| # | New test file | Level | Priority | Scenarios |
|---|---|---|---|---|
| 1 | `dispatcher.test.js` | Integration | P0 | `scrape('instagram'/'ig'/'insta', …)` routes via INSTAGRAM_ACTION_MAP; unknown action → 400 XACT_4001 `actionNotAvailable`; arg mapping (username/tag/shortcode/limit/transport); factory exports via `platforms.instagram` / `getPlatform`. |
| 2 | `checkpoint-resolver.test.js` | Unit | P1 | user resolver → `{targetType:'user', targetKey:<lower-username>, cursorField:'cursor', fallbackCursorFields:['max_id','end_cursor']}`; hashtag resolver strips `#`, lowercases, `targetType:'tag'`; null on missing/non-string arg; accepts `user`/`handle`/`hashtag`/`topic` aliases. |
| 3 | `integration.test.js` | Integration | P1 | Full `scrape()` → InstagramCrawler → InstagramClient → `node:http` fixture → normalized PostItem/ProfileItem; session store → checkpoint emitted; `storeBatch` persistence. |
| 4 | extend `client.test.js` | Unit | P1 | `buildUrl` absolute/relative/param-skip/throws; `getUserMedia` `__user`/`__raw` pass-through (no refetch); `ensureSession` credential fallback → login; `#cookieHeader` serializes cookies; `getUserProfile` → 404 on empty payload. |
| 5 | extend `crawler.test.js` | Integration | P1 | `#emitCheckpointAndStream`: `store.saveCheckpoint` called w/ correct shape; Redis publish when `REDIS_STREAM_ENABLED`; `shouldStopPagination` sets `has_next_page:false`; `#parseLimit` fallback; `#resolveTransport` whitelist. |

**Justification**: `comprehensive` for dispatcher + checkpoint-resolver (public contract, untested); `selective` for client/crawler internals (cover only previously-untested public-observable behaviour). No UI/e2e — scraper is a headless backend module.

## Step 3 — Execution (sequential mode)

`tea_execution_mode=auto`, `tea_capability_probe=true`. Resolved to **sequential**: the expansion target is a single cohesive backend module (5 test files), where parallel subagent fan-out adds orchestration overhead without coverage benefit. Tests generated directly against the real `node:http` fixture pattern (CLAUDE.md: no mocks).

### Files created
| File | Tests | Level |
|---|---|---|
| `tests/scrapers/social/instagram/checkpoint-resolver.test.js` | 6 | Unit |
| `tests/scrapers/social/instagram/dispatcher.test.js` | 8 | Integration |
| `tests/scrapers/social/instagram/integration.test.js` | 3 | Integration |

### Files extended
| File | +Tests | Coverage added |
|---|---|---|
| `tests/scrapers/social/instagram/client.test.js` | +8 | `buildUrl` (4), `getUserMedia` `__user/__raw` pass-through, `ensureSession` credential fallback + null path, cookie header on request (2 describes) |
| `tests/scrapers/social/instagram/crawler.test.js` | +6 | `#emitCheckpointAndStream` saveCheckpoint shape + Redis publish on/off, `storeBatch`, `shouldStopPagination` dup-stop, `#parseLimit` fallback, `#resolveTransport` override |

## Step 4 — Validate & Summarize

- **Instagram suite**: 86 passed / 1 env-gated skipped (was 58). +28 tests, all green.
- **Quality gates** (test-quality.md): no mocks/stubs/fakes — real `node:http` server, real SessionManager, real store implementations; deterministic (no `waitForTimeout`/random); each test asserts concrete values; env-gated E2E isolated via `INSTAGRAM_E2E`.
- **Playwright Utils deviations**: N/A — no Playwright/browser tests generated (backend scraper module; `node:http` fixture is the correct mechanism per sibling scrapers bluesky/mastodon/reddit/medium).
- **Pact.js Utils deviations**: N/A — no consumer/provider contract; Instagram is an outbound scraper client.
- **Assumption**: `#resolveShortcode` intentionally only accepts `instagram.com` URLs (production-correct); dispatcher test uses a real instagram.com URL for resolution then fetches from the fixture `baseUrl`.
- **Full `tests/scrapers/` regression**: suite too large for a single bounded run (spawns many vitest workers); instagram subset + neighbours verified green. Recommend CI full-suite run.
- **Next workflow**: `test-review` (adversarial review of new tests) or `trace` (map to ACs).
