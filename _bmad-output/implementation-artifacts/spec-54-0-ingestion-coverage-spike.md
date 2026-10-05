---
title: 'Story 54.0 — Ingestion Coverage Spike: X Search & Dexscreener Validation'
type: 'chore'
created: '2026-10-05'
status: 'done'
route: 'oneshot'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 54 MVP (54.1–54.4) build trên giả định chưa verify: `x_search_tweets`/`x_scrape` có trả tweets cho crypto queries (cashtag, contract address, token name), và Dexscreener có liquidity/volume cho watchlist. Đây là kill-risk #1 — precedent đã có: jev `searchTwitter()` trả `[]` khi thiếu session cookie.

**Approach:** Viết `scripts/spike-54-coverage.mjs` — live-probe measurement script (không implementation logic) chạy ≥10 query mẫu qua đường gọi production (`local-tools.js` → `x_search_tweets` / `dispatchScrape`), ghi `implementation-artifacts/spike-54-coverage-report.md` với verdict **GO/REDESIGN per story 54.1–54.4**.

**Measurements bắt buộc:**
1. **≥10 queries** theo mix: 3 cashtags (`$PEPE`, `$WIF`, `$BONK` hoặc tương đương), 3 Solana contract addresses, 2 bare token names, 2 KOL-timeline reads. Per-query record: result count, recency spread (newest/oldest ts), unique authors, presence `full_text`.
2. **Dexscreener cross-check** ≥5 watchlist tokens qua `dispatchScrape('dexscreener','token_lookup',...)`: `% có liquidity_usd`, `% có volume_24h`. Nếu <50% → 54.3 `hype_to_liquidity` phải redesign (fallback unique_sources only).
3. **Poll ceiling**: sustainable queries/10min trước khi X search degrade/rate-limit → input cho `setPlatformLimit('twitter')` (OQ-2 resolved: governor meters requests, pipeline owns cadence).
4. **Auth-path detection**: probe phải report rõ đang chạy auth session hay guest path (per-account governor gate chỉ fire với `concreteAccountId` — spike caveat từ spine OQ-2).

**Decision forks đã spec trong epic (ghi verbatim vào report):**
- contract-address search mù → 54.2 đổi strategy sang "KOL-timeline monitor + token extraction" thay vì global search.
- cashtag coverage <30% token nhỏ → mindshare scope về "watched-token share".

## Boundaries & Constraints

**Always:**
- Script đi qua production call path (`local-tools.js` / `dispatchScrape`) — không gọi trực tiếp internal scraper bypass governor.
- Pattern theo `scripts/browser-pool-spike.mjs`: env-driven config, `scripts/spike-54-coverage-results/` output dir, không hardcode secrets; session qua `XACTIONS_SESSION_COOKIE` env nếu có.
- Report phải có verdict GO/REDESIGN **per story 54.1/54.2/54.3/54.4** + raw measurements + decision-fork recommendation.
- Rate-ceiling probe phải graceful: dừng ramp khi phát hiện degrade (lần đầu trả rỗng/lỗi rate-limit), record điểm dừng — không brute-force ban session.

**Never:**
- Không viết production code (`src/analytics/*` thuộc 54.1+); spike chỉ đo, không implement.
- Không mock kết quả — measurement phải là dữ liệu live-probe thật (Mandatory Rule #1).
- Không chạy nếu environment thiếu hoàn toàn browser capability mà không báo cáo trạng thái auth/no-auth rõ ràng — report "cannot measure: no session" là output hợp lệ, nhưng phải nói rõ.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | Session hợp lệ, 10 queries | Report với per-query metrics + verdict | N/A |
| NO_SESSION | Thiếu `XACTIONS_SESSION_COOKIE` | Report ghi auth-path=guest, coverage có thể sparse → verdict có thể REDESIGN hoặc "blocked-needs-auth" | Detect + flag, không crash |
| RATE_LIMIT | Ceiling probe chạm limit | Ghi ceiling queries/10min tại điểm degrade đầu tiên | Dừng probe ngay, record |
| DEX_MISSING | Token không có pair trên Dexscreener | Tính vào coverage %, không throw | Count miss |
| EMPTY_SEARCH | Query trả [] | Record 0 + flag trong verdict calc | Không retry vô hạn |

</frozen-after-approval>

## Implementation Notes

**Files:** `scripts/spike-54-coverage.mjs` (new, ~290 LOC), `scripts/spike-54-coverage-results/results.json` (raw), `_bmad-output/implementation-artifacts/spike-54-coverage-report.md` (verdict report).

**Decisions & surprises:**
- `descriptor.createSession(options)` reads `options.cookies|authCookie|authToken` — NOT `options.session`. Cookie rides on scrape() options directly (first draft passed `session:{cookies}` → auth silently absent; caught and fixed before first real run).
- Dexscreener real response shape = `res.data.pairs[]` with flat `liquidity_usd`/`volume_24h`; liquidity anchor = max-liquidity pair. First draft guessed nested `liquidity.usd` → all-None results; fixed after inspecting live response.
- `~/.xactions/cookies.json` fallback in descriptor means auth works with ZERO env vars — spike detected and reported this path (auth session active via file fallback).
- Results accumulator now merge-loads existing `results.json` so partial-phase runs (search/dex/ceiling separately) accumulate — discovered when ceiling-only run overwrote M1/M2 data.
- `from:aeyakovenko` returned 0 while `from:VitalikButerin` returned 20 — account may be inactive/renamed; treated as sparse-coverage data point, not error.
- Ceiling probe: 12 queries/68s ≈ 106/10min with zero degrade — well above governor default (30/min); real ceiling is governor-side, not X-side at this volume.

**Verdict: GO on all four stories** — see report for per-story verdicts and decision-fork status (both forks NOT triggered: contract search works, cashtag coverage 100%).
