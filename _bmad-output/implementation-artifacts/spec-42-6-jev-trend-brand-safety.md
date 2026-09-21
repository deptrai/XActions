---
title: 'Story 42.6: jev-trend-brand-safety'
type: 'feature'
created: '2026-09-21'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
baseline_revision: '9c1434b7'
context:
  - '_bmad-output/implementation-artifacts/epic-42-context.md'
  - 'CLAUDE.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `src/trendingTopicMonitor.js` dùng từ điển `NICHE_KEYWORDS` tĩnh (8 niche hardcoded, substring match) để phân loại trend — dễ sai với trend mới/chồng lấn ("Tesla" → Tech nhưng nếu context là stock scandal thì Business). `ThoughtLeaderAgent._createContent` đưa `trends.slice(0,5)` thẳng vào `generateContent` mà không có brand-safety gate — agent có thể "ride" trend liên quan thảm kịch/scam/controversy, và không có signal nào đánh giá "đây có phải cơ hội tốt để comment không".

**Approach:** Thêm Node-side module `src/trending/jevTrendAnalyzer.js` — `analyzeTrend(topic, options)` trả `{vertical, brandSafe, opportunity}` qua 1 Jev `decide()` call (Choice + Noul + Score). Cắm vào `_createContent` để filter `trends` trước khi `generateContent`: (1) unsafe (`brandSafe.noul < 0.7`) → loại; (2) `opportunity.score` (0-3, legend avoid/neutral/good_hook/must_post) ≥ 2 → giữ lại làm "good hook". Trending topic monitor browser script giữ `NICHE_KEYWORDS` như pre-filter client-side (tốn ít call) — Jev xử lý semantic ở Node-side cho mỗi trend được đề xuất comment/post.

## Boundaries & Constraints

**Always:**
- Jev qua `JevBrain` instance — không module nào gọi `api.typesafe.ai` trực tiếp.
- `analyzeTrend` gọi `jevBrain.decide` 1 lần/trend với 3 questions: `vertical` Choice, `brandSafe` Noul, `opportunity` Score.
- `vertical` criteria bằng map `tech_ai | crypto_web3 | politics | sports | entertainment | business | gaming | science | culture_meme | other` (vẫn trả nhãn 10 vertical thay vì 8 như cũ).
- `brandSafe.noul` = "this trend is related to tragic events, scams, ongoing controversy, or topics brands should not associate with" — **noul cao = unsafe**.
- `opportunity` Score 0-3 với legend `['avoid', 'neutral', 'good_hook', 'must_post']`.
- `_createContent`: sau khi `getTrendingTopics` và trước `generateContent`, lọc `trends` — loại unsafe (`brandSafe.noul ≥ 0.5`) và chỉ giữ những trend `opportunity.score ≥ 2` (good_hook hoặc must_post) nếu có ít nhất 1; nếu tất cả đều <2 hoặc Jev degraded → giữ nguyên `trends` (không block content creation).
- Cache: `analyzeTrend` nhớ kết quả trong 15 phút (trend topic string → result) để batch không tốn call trùng.
- Degraded (no key/budget/error) → `analyzeTrend` trả `null`; caller fallback giữ nguyên `trends` cũ (không đổi hành vi).
- Test: vitest, `vi.stubGlobal('fetch')` — mirror `tests/agents/jevBrain.test.js`.
- ESM, `const`, emoji logs, `// by nichxbt`, JSDoc.

**Never:**
- Đụng `NICHE_KEYWORDS` trong `trendingTopicMonitor.js` — nó chạy trong browser console, không gọi Node modules được.
- Block `_createContent` hoàn toàn khi Jev degraded — degraded phải giữ hành vi cũ (không filter).
- Hardcode threshold 0.5/0.7 — dùng `confidenceThresholds.brandSafety` (default 0.5) và `confidenceThresholds.trendOpportunity` (default 2 = "good_hook").
- Gọi Jev riêng lẻ nhiều lần cho 1 trend — 1 call với 3 questions.
- Đụng `llmBrain.generateContent` signature.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error |
|----------|-------|----------------|-------|
| Safe good-hook trend | topic='AI agents shipped 100x faster' | `{vertical:'tech_ai', brandSafe:{noul:0.05}, opportunity:{score:2}}` → giữ trong trends | none |
| Tragic event trend | topic='Earthquake death toll rises' | `brandSafe.noul=0.9` → loại khỏi trends | none |
| Neutral trend | topic='Monday motivation' | `opportunity.score=1` → loại (not a hook) | none |
| Mixed batch | 5 trends: 2 safe hook, 2 unsafe, 1 neutral | Chỉ 2 safe-hook trends giữ lại vào `generateContent` | none |
| Jev degraded | `meta.degraded=true` | `analyzeTrend` → null; `_createContent` dùng `trends` gốc (không filter) | none |
| Empty trends | `[]` | `[]` vào `generateContent` — unchanged | none |
| All trends low opportunity | all `score < 2` | `_createContent` giữ trends gốc (không over-filter) | none |
| Cache hit | same topic trong 15min | trả result cũ, không call fetch | none |

</intent-contract>

## Code Map

- `src/agents/jevBrain.js` -- `decide(state, questions)` → `{answers, usage, meta}`; thresholds `confidenceThresholds` configurable.
- `src/trending/jevTrendAnalyzer.js` -- NEW: `analyzeTrend(topic, {jevBrain, ttlMs})` — cache Map `topic → {result, expiresAt}`; returns `{vertical, brandSafe, opportunity}` or `null` degraded.
- `src/agents/thoughtLeaderAgent.js` -- `_createContent` (~dòng 18500-19500): sau `getTrendingTopics` trước `generateContent` — lọc trends qua `jevTrendAnalyzer.analyzeTrends(topics, this.jev)` (batch helper).
- `src/trendingTopicMonitor.js` -- READ-ONLY: NICHE_KEYWORDS giữ nguyên (browser-side pre-filter).
- `tests/trending/jevTrendAnalyzer.test.js` -- NEW: mock fetch + JevBrain, cover I/O matrix.
- `tests/agents/thoughtLeaderAgent.jev.test.js` -- thêm describe `_createContent trend filter` — verify unsafe trend bị loại, good-hook giữ lại, degraded giữ nguyên.

## Tasks & Acceptance

**Execution:**
- `src/trending/jevTrendAnalyzer.js` -- NEW: `analyzeTrend(topic, {brain})` 1-call/3-questions + 15min cache + `analyzeTrends(topics, {brain})` batch helper trả `{filtered, analyses}` -- deliverable chính.
- `src/agents/thoughtLeaderAgent.js` -- sửa `_createContent`: sau `getTrendingTopics` lọc qua `analyzeTrends`; log emoji summary; degraded → giữ nguyên.
- `tests/trending/jevTrendAnalyzer.test.js` -- NEW: 6-8 tests covering matrix.
- `tests/agents/thoughtLeaderAgent.jev.test.js` -- thêm 3 tests: unsafe filtered, all-safe passes, degraded unchanged.

**Acceptance Criteria:**
- Given `analyzeTrend('Earthquake kills 500')` Jev trả `brandSafe.noul=0.9` → result.brandSafe=false → trend loại.
- Given `analyzeTrend('AI agents beat benchmark')` Jev trả `brandSafe.noul=0.05, opportunity.score=3` → giữ lại, vertical='tech_ai'.
- Given `analyzeTrends` với 5 trends mixed, thì chỉ trends `brandSafe.noul<0.5 && opportunity.score>=2` giữ lại.
- Given Jev degraded, thì `analyzeTrend` trả `null` và `_createContent` dùng trends gốc.
- Given `_createContent` với `trends=['Earthquake', 'AI agents']`, thì `generateContent` chỉ nhận `['AI agents']`.
- Given `npx vitest run tests/trending/ tests/agents/thoughtLeaderAgent.jev.test.js` thì pass.

## Spec Change Log

## Review Triage Log

**Auto Run Result (2026-09-21)**
- `src/trending/jevTrendAnalyzer.js` (new): `analyzeTrend(topic, {brain,ttlMs})` 1-call/3-questions (vertical Choice 10 options + brandSafe Noul + opportunity Score 0-3) + 15min cache; `analyzeTrends(topics)` batch helper trả `{filtered, analyses, degraded}`; null-on-degraded contract.
- `src/agents/thoughtLeaderAgent.js`: `_createContent` lọc `trends` qua `analyzeTrends` sau `getTrendingTopics` — unsafe (`brandSafe.noul≥0.5`) + low-opportunity (`score<2`) loại; degraded → giữ nguyên `trends`; `filteredTrends.slice(0,5)` vào `generateContent`.
- `tests/trending/jevTrendAnalyzer.test.js` (new, 8 tests): classify, unsafe flag, degraded null, cache TTL, invalid input, batch filter, all-degraded, empty input.
- `tests/agents/thoughtLeaderAgent.jev.test.js` (+3 tests): unsafe trend filtered before generateContent, all-degraded keeps raw trends, empty trends skip filter.
- Verify: `npx vitest run tests/trending/` → 8/8; `tests/agents/thoughtLeaderAgent.jev.test.js` → 16/16; regression `jevBrain + algorithmBuilder` → 33/33 pass.


## Design Notes

- **brandSafe noul semantics:** Noul ≥ 0.5 → unsafe (tragic/scam/controversy). Threshold thấp hơn `safeToSend` (0.8) vì trend association ít risk hơn authored content — nhưng vẫn chặn sớm.
- **Opportunity Score legend:** `['avoid','neutral','good_hook','must_post']` — numeric score 0-3; chỉ `score>=2` (good_hook+) được "ride".
- **Cache key:** `topic.toLowerCase().trim()` → `{result, expiresAt: Date.now()+15*60*1000}`. Export `clearTrendCache()` cho tests.
- **Degraded semantic:** `analyzeTrend` trả `null` (không phải result giả) để caller phân biệt "không có ý kiến" vs "ý kiến xấu" — quan trọng cho fallback không over-filter.
- **Batch helper `analyzeTrends`:** loop `analyzeTrend` tuần tự (Jev ~300ms/call → 10 trends = ~3s, chấp nhận được trong background job), log per-trend verdict emoji.

## Verification

**Commands:**
- `npx vitest run tests/trending/jevTrendAnalyzer.test.js` -- expected: all pass.
- `npx vitest run tests/agents/thoughtLeaderAgent.jev.test.js` -- expected: existing + new tests pass.
- `npx vitest run tests/agents/jevBrain.test.js` -- regression check.
