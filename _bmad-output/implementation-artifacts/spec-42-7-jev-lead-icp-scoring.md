---
title: 'Story 42.7: jev-lead-icp-scoring'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_revision: 'f142ac20'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '_bmad-output/implementation-artifacts/epic-42-context.md'
  - 'CLAUDE.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `api/routes/ai/leads.js` có `POST /leads/qualify` và `POST /leads/score` nhưng chỉ `queueOp` — không có processor `leadQualify`/`leadScore` trong `jobQueue.js` → jobs bị xếp hàng nhưng không bao giờ chạy. Không có hệ thống qualification nào thực sự chấm lead theo ICP semantic.

**Approach:** Thêm **synchronous** `POST /api/ai/jev/lead-icp` endpoint trên Jev router — nhận `{profiles: [{username, bio, recentTweets[]}]}` và `icp` description; mỗi profile → 1 Jev `decide()` với 2 questions: `buyerIntent` Choice (4 options) + `leadScore` Score (0-3 ICP fit). Trả `{qualified: [{username, buyerIntent, intentConfidence, leadScore, scoreConfidence}], stats}`. Degraded → trả tất cả profiles với `qualified=false`, `meta.degraded=true` — không throw.

## Boundaries & Constraints

**Always:**
- Jev qua `JevBrain` instance (`getBrain()` singleton trong `jev.js`).
- Endpoint là **synchronous** — trả kết quả trực tiếp (không `queueOp`), vì Jev ~300ms/call và batch 100 profiles ≈ 30s — chấp nhận được cho một HTTP request; async queue có thể bổ sung sau nếu cần >500 profiles.
- `buyerIntent` criteria: `{not_a_lead, problem_aware, solution_seeking, decision_maker}` — Jev trả 1 trong 4.
- `leadScore` Score 0-3 legend `['no_fit', 'weak_fit', 'good_fit', 'ideal_customer']`.
- Profiles được xử lý tuần tự (rate-limit-friendly); log emoji per-profile.
- Response shape: `{success, qualified: [...], stats: {total, qualified, avgScore, degraded}, usage}`.
- `qualified` = profiles có `leadScore.score >= 2` (good_fit+) và `buyerIntent != 'not_a_lead'`.
- `stats.degraded = true` khi tất cả results degraded.
- ESM, JSDoc, `// by nichxbt`.

**Never:**
- `queueOp` cho endpoint này — sync response.
- Throw khi Jev degraded — trả `qualified: []` với `stats.degraded: true`.
- Gọi `api.typesafe.ai` trực tiếp.
- Đụng `leads.js` hiện có (queued stubs giữ nguyên — endpoint mới là `/jev/lead-icp`).

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Error |
|----------|-------|----------|-------|
| Qualified lead | bio='CTO at startup, looking for automation' | `buyerIntent='decision_maker'`, `leadScore=3` → qualified | none |
| Non-lead | bio='sports fan, memes' | `buyerIntent='not_a_lead'`, `leadScore=0` → not qualified | none |
| Problem-aware | bio='struggling with manual engagement' | `buyerIntent='problem_aware'`, `leadScore=2` → qualified | none |
| Missing bio | `{username, bio: ''}` | still processes (Jev works on what's given) | none |
| Empty profiles | `[]` | `{qualified: [], stats: {total: 0}}` | 400 |
| Missing icp | no `icp` field | use default "AI/tech automation tools" | none |
| Jev degraded | no API key | all profiles `qualified: []`, `stats.degraded: true` | none |
| Large batch | 100 profiles | sequential processing, ~30s | none |

</intent-contract>

## Code Map

- `api/routes/ai/jev.js` — ADD `POST /lead-icp` endpoint; reuses `getBrain()` singleton.
- `src/leads/jevLeadScorer.js` — NEW: `scoreProfile(profile, icp, {brain})` → `{username, buyerIntent, intentConfidence, leadScore, scoreConfidence}` or null degraded; `scoreProfiles(profiles, icp, {brain})` batch → `{qualified, all, stats}`.
- `tests/api/jev-lead-icp.test.js` — NEW: vitest + supertest OR direct route handler test (check existing API test pattern first).
- `api/routes/ai/index.js` — already mounts `jevRoutes` at `/jev` — no change needed.

## Tasks & Acceptance

**Execution:**
- `src/leads/jevLeadScorer.js` — NEW: `scoreProfile` + `scoreProfiles` — 1-call/2-questions per profile.
- `api/routes/ai/jev.js` — ADD `POST /lead-icp`: validate `{profiles: [{username, bio, recentTweets}], icp?}` → `scoreProfiles` → `{success, qualified, stats, usage}`.
- `tests/leads/jevLeadScorer.test.js` — NEW: unit tests for scorer (mock fetch).
- `tests/api/jev-lead-icp.test.js` — NEW: route-level test with mocked fetch + express app (mirror existing API test pattern if one exists, else use supertest or direct handler call).

**Acceptance Criteria:**
- Given `POST /api/ai/jev/lead-icp` với `{profiles: [{username:'cto', bio:'looking for automation'}], icp:'AI tools'}`, khi Jev healthy, thì trả `{qualified: [{username:'cto', buyerIntent:'decision_maker', leadScore:3}]}`.
- Given profile bio 'memes and cats', thì `buyerIntent='not_a_lead'` và không xuất hiện trong `qualified`.
- Given `profiles: []`, thì trả 400 `INVALID_ARGS`.
- Given Jev degraded, thì `{qualified: [], stats: {degraded: true}}`.
- Given `npx vitest run tests/leads/ tests/api/jev-lead-icp.test.js` thì pass.

## Spec Change Log

## Review Triage Log

**Auto Run Result (2026-09-21)**
- `src/leads/jevLeadScorer.js` (new): `scoreProfile` 1-call/2-questions (buyerIntent Choice 4 options + leadScore Score 0-3); `scoreProfiles` batch sequential, emoji per-profile verdict; `qualified` = `buyerIntent !== 'not_a_lead' && leadScore >= 2`; `stats.degraded` = all-null.
- `api/routes/ai/jev.js`: `POST /lead-icp` — sync endpoint (không queueOp), validate `profiles` non-empty, `scoreProfiles(profiles, icp || DEFAULT_ICP, {brain})` → `{success, qualified, all, stats}`.
- `tests/leads/jevLeadScorer.test.js` (new, 8 tests): decision-maker, not_a_lead, degraded null, missing bio, filter qualified vs non-qualified, all-degraded, empty input, DEFAULT_ICP in request body.
- `tests/api/jev-lead-icp.test.js` (new, 5 tests): qualified result shape, not_a_lead excluded, 400 empty/missing profiles, degraded → `qualified:[]` + `stats.degraded:true`.
- Verify: 13/13 lead tests + 27/27 regression (jevBrain + trending) pass.


## Design Notes

- **Per-profile call:** 1 `decide()` với `{buyerIntent: Choice, leadScore: Score}` — ~300ms → 100 profiles ≈ 30s sync.
- **Default ICP:** `'B2B companies and founders who would benefit from AI-powered Twitter/X automation — content scheduling, smart engagement, lead generation'` — dùng khi `icp` absent.
- **Qualified filter:** `buyerIntent !== 'not_a_lead' && leadScore >= 2` — cả 2 điều kiện phải đạt.
- **Stats:** `{total, qualified, avgScore, degraded, totalTokens}` — `avgScore` = mean của non-null leadScore.

## Verification

**Commands:**
- `npx vitest run tests/leads/ tests/api/jev-lead-icp.test.js` -- expected: all pass.
- `curl -s -X POST http://localhost:3001/api/ai/jev/lead-icp -H 'Content-Type: application/json' -d '{"profiles":[{"username":"test","bio":"CTO looking for dev tools"}]}'` -- expected: qualified result.
