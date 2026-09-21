---
title: 'Story 42.2: agentic-adoption'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_revision: '8b7b808e'
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

**Problem:** Sau Story 42.1, `JevBrain` tồn tại nhưng chưa có subsystem nào dùng nó — `thoughtLeaderAgent._searchAndEngage/_browseHomeFeed/_createContent` vẫn quyết định bằng `scoreRelevance` (parse text rác, catch→default 50) + ngưỡng cứng `>60/>80/>50/>85` + coin-flip `Math.random()<0.4/0.3`; `personaEngine.planSession` phác thảo hoạt động theo ratio ngẫu nhiên không có quality gate; `algorithmBuilder.commentOnTweet` comment mọi tweet đủ likes > 5 không phân biệt spam; không có safety `Noul` nào trước write.

**Approach:** Cắm `JevBrain` vào 4 điểm: (1) `ThoughtLeaderAgent` — khởi tạo `JevBrain` instance, thay action router bằng 1 Jev call `{action: Choice, isSpam: Noul, replyWorthy: Noul}` per tweet với per-action confidence gate; (2) `_createContent` — safety `Noul` safe-to-send trước khi post (song song persona consistency check); (3) `algorithmBuilder` — Jev relevance/spam filter trước `commentOnTweet`/`likeTweet`; (4) `xspace-agents DecisionEngine` — Jev Choice non-blocking song song rule-engine, fallback keyword nếu >500ms. `personaEngine` KHÔNG đổi (plan là volume budget — Jev là quality filter tại execution). Không đụng `python/xeepy` trong story này (Python process riêng — deferred vào story riêng khi có demand).

## Boundaries & Constraints

**Always:**
- Jev qua `JevBrain` instance — không module nào gọi `api.typesafe.ai` trực tiếp (invariant §5.6).
- `xspace DecisionEngine`: Jev chạy **non-blocking** song song rule-engine; nếu Jev >500ms hoặc lỗi → dùng keyword/turn rule hiện có — voice loop KHÔNG khựng.
- Safety `Noul` (`safeToSend`, threshold từ `confidenceThresholds.safeToSend`, default 0.8) chạy trước MỌI write trong `_createContent` và `commentOnTweet` path.
- Per-action thresholds từ config/env (`JEV_THRESHOLD_*`), không hardcode — mirror Story 42.1 pattern.
- Giữ nguyên API surface của `thoughtLeaderAgent`/`algorithmBuilder` — chỉ đổi logic bên trong; constructor thêm `jev` config optional.
- `ThoughtLeaderAgent` giữ `this.llm` cho prose (`generateReply`/`generateContent`) — Jev chỉ replace judgment call sites.
- Test style: vitest, `vi.stubGlobal('fetch')` + mock JevBrain behavior — mirror `tests/agents/jevBrain.test.js` + `tests/agents/thoughtLeaderAgent.test.js`.
- ESM, `const`, emoji logs, `// by nichxbt`, JSDoc.

**Never:**
- Đối với loại câu hỏi Choice fallback — khi Jev suy thoái (no key/budget/error), action router dùng `scoreRelevance`-equivalent fallback đã có sẵn trong JevBrain (trả `{type:'choice', choice:'ignore', confidence:0}`) — caller dùng `meta.degraded` để quyết định act-fallback (like khi score >60 như cũ) thay vì act-skip.
- Jev sinh prose — reply vẫn qua `this.llm.generateReply`.
- Đụng `LLMBrain` internals.
- Xóa các heuristic ngưỡng cũ mà không có fallback path tương đương (degraded mode phải vẫn hoạt động như trước).
- Hardcode threshold mới trong agent code.
- Đụng `python/xeepy/` (Python — story riêng).
- Block voice loop bằng await Jev — luôn `Promise.race` với 500ms timeout.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path — search-engage | Tweet trên-niche, Jev trả `{action:'reply', conf:0.9}` | Like nếu conf≥like-threshold, generate reply qua LLM, safety Noul ≥0.8, rồi post | Không lỗi |
| Spam tweet | Jev `isSpam.noul ≥ 0.6` | Skip hoàn toàn — không like, không reply, log skip | Không lỗi |
| Off-topic tweet | Jev `action.choice='ignore', conf:0.9` | Skip hoàn toàn | Không lỗi |
| Low confidence reply | Jev `action.choice='reply', conf:0.7` (< reply-threshold 0.85, ≥ mid) | Skip reply, vẫn like nếu conf≥like-threshold | Không lỗi |
| Degraded — missing key | `TYPESAFE_API_KEY` vắng | Router dùng LLMBrain fallback (score>60 like, >80 comment như cũ) — hành vi không đổi so với trước | Không throw |
| Degraded — budget cạn | `JEV_DAILY_BUDGET_USD` exhausted | Fallback LLMBrain heuristic path | Không throw |
| Jev trả reply nhưng LLMBrain generateReply fail | reply generation throws | Log warning, vẫn giữ like (đã act), không crash | Không throw |
| Safety Noul chặn post | Content qua persona check nhưng `safeToSend.noul < 0.8` | Không post, log warning | Không lỗi |
| xspace — Jev chậm (>500ms) | Transcription dài | Promise.race thắng bằng rule-engine result | Không block voice loop |
| xspace — Jev lỗi | Network down | Rule-engine result dùng ngay | Không block |

</intent-contract>

## Code Map

- `src/agents/jevBrain.js` -- Sẵn từ 42.1: `decide(state, questions, {model,timeoutMs})` → `{answers, usage, meta:{degraded, reason, source}}`; `gate(answer, {hi,mid,action})` → `'act'|'review'|'skip'`; thresholds qua constructor `confidenceThresholds`.
- `src/agents/thoughtLeaderAgent.js` -- TARGET: constructor (dòng ~64-74 `this.llm = new LLMBrain(...)`) thêm `this.jev = new JevBrain(config.jev || {fallbackLLM: this.llm})`; `_searchAndEngage` (~dòng 225-289) thay `scoreRelevance` + ngưỡng `>60/>80/Math.random()<0.4` bằng Jev decide; `_browseHomeFeed` (~dòng 291-330) thay `>50/>85/<0.3`; `_createContent` (~dòng 360-440) thêm safety Noul sau `checkPersonaConsistency`, trước `postTweet/postThread`.
- `src/agents/persona.js` -- READ-ONLY: `validateContent(text)` + `toJSON()` — giữ nguyên.
- `src/algorithmBuilder.js` -- TARGET: `commentOnTweet(page, persona, tweet)` (~dòng 300) thêm Jev relevance/spam filter trước khi generate; `likeTweet` gọi `extractVisibleTweets` — filter trong session executor case 'like'/'comment' (~dòng 660-720).
- `xspace-agents/packages/core/src/turns/decision-engine.ts` -- TARGET: `decide(input)` — thêm optional `jevDecider` injected qua `DecisionEngineConfig.jevDecider?: (input) => Promise<ResponseDecision|null>`; chạy `Promise.race([jevDecider(input), 500ms timeout → null])`; nếu null → rule path như cũ.
- `xspace-agents/packages/core/src/turns/index.ts` -- export type cho `JevDecider` nếu thêm type mới.
- `tests/agents/jevBrain.test.js` -- reference cho mock JevBrain.
- `tests/agents/thoughtLeaderAgent.test.js` -- test pattern cho agent (mock browser/db/llm).
- `xspace-agents/packages/core/src/__tests__/turns.test.ts` -- test pattern cho DecisionEngine (makeInput helper).
- `scripts/jev-verify/verify.mjs` -- question schema reference (Score/Choice/Noul instructions).

## Tasks & Acceptance

**Execution:**
- `src/agents/thoughtLeaderAgent.js` -- sửa: constructor tạo `this.jev`; `_searchAndEngage` + `_browseHomeFeed` đổi từ score-threshold sang Jev decide (1 call per tweet: action Choice + isSpam Noul + replyWorthy Noul) + per-action gate; `_createContent` thêm safety `safeToSend` Noul trước post; hành vi degraded giữ nguyên heuristic cũ -- adoption chính.
- `src/algorithmBuilder.js` -- sửa: thêm `buildJevQuestions` helper + session executor case 'like'/'comment' filter qua Jev trước khi act; threshold qua persona config -- volume reducer cho algorithm builder.
- `xspace-agents/packages/core/src/turns/decision-engine.ts` -- sửa: `DecisionEngineConfig` thêm `jevDecider`; `decide()` chạy non-blocking race; không break hiện có test -- semantic voice decisions.
- `tests/agents/thoughtLeaderAgent.jev.test.js` -- tạo mới: mock JevBrain + browser + db, cover I/O matrix cho search-engage + create-content safety + degraded mode -- adoption regression tests.
- `tests/agents/algorithmBuilder.jev.test.js` -- tạo mới: mock JevBrain, cover filter behavior cho like/comment cases -- volume reducer tests.
- `xspace-agents/packages/core/src/__tests__/turns.test.ts` -- sửa: thêm describe block cho jevDecider race behavior (fast, slow>500ms, error) -- voice-loop non-blocking tests.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- cập nhật `42-2-agentic-adoption...: done` sau khi verify pass -- tracking sync.

**Acceptance Criteria:**
- Given Jev healthy, khi `_searchAndEngage` chạy với 1 tweet on-niche + Jev trả `{action:'reply', conf:0.9, isSpam:0.05}`, thì like được thực hiện (nếu `_canDo`) và reply được generate qua `this.llm.generateReply` rồi post.
- Given Jev trả `isSpam.noul ≥ 0.6`, thì KHÔNG like/comment xảy ra.
- Given Jev trả `action.choice='ignore'` conf≥hi, thì skip.
- Given Jev trả `action.choice='reply'` conf 0.7 (< reply-threshold), thì chỉ like (không reply).
- Given `TYPESAFE_API_KEY` vắng, thì hành vi giống cũ (score>60 like, >80 comment) qua `meta.degraded` path — regression-safe.
- Given `_createContent` với draft content, thì safety Noul chạy; nếu `safeToSend.noul < 0.8` thì KHÔNG post.
- Given `commentOnTweet` trong algorithmBuilder với spam tweet, thì Jev filter chặn trước khi generate comment.
- Given xspace jevDecider resolve trong 100ms, thì quyết định đến từ Jev; given jevDecider resolve 800ms, thì rule-engine result dùng ngay và jevDecider bị hủy; given jevDecider reject, thì rule-engine result vẫn trả về.
- Given tất cả tests, thì `npx vitest run tests/agents/thoughtLeaderAgent.jev.test.js tests/agents/algorithmBuilder.jev.test.js` pass; xspace suite pass.

## Spec Change Log

## Review Triage Log

**Auto Run Result (2026-09-21)**
- `src/agents/thoughtLeaderAgent.js`: constructor tạo `this.jev` (JevBrain + fallbackLLM=llm); `_searchAndEngage` + `_browseHomeFeed` dùng Jev `decide()` + `gate()` per-action (like 0.60 / reply 0.85 / bookmark 0.50), spam `noul ≥ 0.6` skip, `meta.degraded` → legacy score heuristic giữ nguyên; `_createContent` thêm safety `safeToSend` Noul <0.8 → block post.
- `src/algorithmBuilder.js`: lazy `getJevBrain()` + `jevFilter(text, keywords)` exported; filter cắm vào session executor `case 'like'` (tweetCursor candidate) và `case 'comment'` (target); degraded → pass-through.
- `xspace-agents/packages/core/src/turns/decision-engine.ts`: `DecisionEngineConfig.jevDecider` + `decideWithJev(input)` — `Promise.race` vs 500ms timeout, reject/timeout → sync `decide()` rule path. Voice loop không block.
- `tests/agents/thoughtLeaderAgent.jev.test.js` (new, 11 tests), `tests/agents/algorithmBuilder.jev.test.js` (new, 5 tests), `xspace-agents/.../turns.test.ts` +4 tests (`decideWithJev` describe, makeJevInput local helper).
- `tests/agents/jevBrain.test.js`: fix env-leak — test "missing-key" giờ `delete process.env.TYPESAFE_API_KEY` trước khi tạo JevBrain (`.env` thật đã set key → test trước đó fetch thật, 1 regression discovered và fixed).
- Verify: `npx vitest run tests/agents/` → 155/155 pass; `npx vitest run xspace-agents/packages/core/src/__tests__/turns.test.ts` → 53/53 pass.


## Design Notes

- **Per-action gate mapping:** `gate(answer, {action: 'like'})` dùng `confidenceThresholds.like` (0.6 default); `action:'reply'` → 0.85; safety → `safeToSend` (0.8). Mid = hi*0.6 tự động.
- **1 call per tweet:** cả 3 questions (action Choice, isSpam Noul, replyWorthy Noul) trong MỘT `decide()` call — ~$0.000024/tweet, không tốn thêm latency (300ms/call).
- **Degraded mode = old behavior:** `_searchAndEngage` check `result.meta.degraded` — nếu true, chạy heuristic cũ (score>60 like, >80+random comment) với `this.llm.scoreRelevance`. Điều này giữ regression-safe: no-key deployments không đổi hành vi.
- **xspace non-blocking pattern:**
  ```ts
  const jevResult = this.jevDecider ? await Promise.race([
    this.jevDecider(input).catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 500)),
  ]) : null
  if (jevResult) return jevResult
  // ... existing rule path
  ```
- **Safety Noul question:** `{type:'noul', instructions:'This content is safe to post publicly on X — no harmful claims, no impersonation, no engagement bait, consistent with persona voice'}`.

## Verification

**Commands:**
- `npx vitest run tests/agents/thoughtLeaderAgent.jev.test.js tests/agents/algorithmBuilder.jev.test.js` -- expected: all pass.
- `npx vitest run tests/agents/jevBrain.test.js` -- expected: still pass (regression).
- `cd xspace-agents && npx vitest run packages/core/src/__tests__/turns.test.ts` -- expected: all pass (existing + new).

**Manual checks (nếu cần):**
- `curl -s http://localhost:3001/api/ai/jev/status` (nếu server chạy) — xác nhận plane still configured.
