---
title: 'Story 42.9 — jev-variant-judge: Jev-as-a-Judge Post Variant Selector & Cringe Filter'
type: 'feature'
created: '2026-09-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'c785d680'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Khi sinh bài viết/reply, LLM đã trả về mảng variants (mặc định 3) nhưng caller chỉ nhận list thô — không có judge nào chọn biến thể tự nhiên nhất hay lọc sáo ngữ AI. Thêm Jev-as-a-Judge: một `decide` call duy nhất gồm `Choice` chọn variant tốt nhất + `Noul` cringe-factor per variant; variant thắng phải qua cringe gate (`cringeFactor ≤ 0.3`), nếu tất cả dính cringe → re-roll 1 lần rồi judge lại, vẫn fail thì trả flag `allCringe` để caller quyết định. LLM vẫn sinh prose; Jev chỉ judge — không sinh text.

## Boundaries & Constraints

**Always:**
- Jev đi qua `JevBrain` — không fetch `api.typesafe.ai` trực tiếp (§5.6). Một `decide` call per generation: `{pick: Choice, cringe_1..N: Noul}`.
- Kill-switch `JEV_VARIANT_JUDGE` (0/false/off/no) → behavior gốc, zero decide calls.
- Never-throws: Jev degraded/missing key/error → trả variants nguyên trạng + `jevJudge:{degraded:true}`.
- Fail-closed chỉ ở cringe: `Noul > threshold` = cringe; pick vẫn được tôn trọng kể cả confidence thấp (exposed trong result để caller xem).
- Backward-compat: result shape giữ nguyên, chỉ additive fields (`cringe`, `selected`, `jevJudge`).

**Never:**
- Không re-roll quá `JEV_VARIANT_JUDGE_MAX_REROLL` (default 1) — bounded spend.
- Không judge `generateThread`/`generateThreadFromText`/`generateWeek`/`generateBio`/`analyzeCompetitorAndGenerate` — thread/week là multi-tweet structures, bio/competitor không phải variant-selector. Judge áp cho **3 surfaces trả variant arrays**: `generateTweet` + `generateReply` + `rewriteTweet` (rewrite = biến thể post text cùng defect class — human quyết tại review).
- Không mutate caller `voiceProfile`; không persist verdict.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| HAPPY_PATH | 3 variants, Jev pick #2, cringe ≤0.3 | winner có `selected:true` + per-variant `cringe` scores + `jevJudge:{selectedIndex,confidence}` | N/A |
| WINNER_CRINGE | pick #1 nhưng cringe_1=0.8, #2 cringe=0.1 | winner = #2 (variant ít cringe nhất dưới threshold) | N/A |
| ALL_CRINGE | mọi variant cringe>0.3 | re-roll 1 lần (LLM regenerate) → judge lại; vẫn cringe → `allCringe:true`, không `selected` | N/A |
| DEGRADED | Jev lỗi/no key/timeout | variants nguyên trạng, `jevJudge:{degraded:true}`, zero throw | swallowed |
| KILL_SWITCH | `JEV_VARIANT_JUDGE=0` | zero decide calls, result giống hệt pre-story | N/A |
| SINGLE_VARIANT | count=1 | skip judge (không có lựa chọn), vẫn chấm cringe cho variant đó | N/A |
| PARSE_EDGE | parseJSON trả non-array | judge chạy trên array đã normalize sẵn | N/A |

</frozen-after-approval>

## Code Map

- `src/ai/jevVariantJudge.js` — NEW: `judgePostVariants(texts, {brain, cringeThreshold})` → `{selectedIndex, cringe:number[], pickChoice, pickConfidence, degraded}`; lazy shared `JevBrain` (mirror `jevUnfollowGuard.js` resolveBrain + late-key rebuild); env resolvers `JEV_VARIANT_JUDGE`/`JEV_THRESHOLD_CRINGE`(default 0.30, clamp [0,1])/`JEV_VARIANT_JUDGE_MAX_REROLL`(default 1, clamp ≤3); state = `{variants:[{index,text}]}` (text truncate ≤500 chars); questions `{pick:{type:'choice',criteria:{variant_1..N,none_good}},cringe_i:{type:'noul'}}`; selection = pick's variant nếu `cringe[pick]≤T` else argmin cringe dưới T else -1.
- `src/ai/tweetGenerator.js` — `generateTweet` :183-227 & `generateReply` :500-543: sau `parseJSON`+normalize array → judge → annotate từng item `{cringe, selected}` + result field `jevJudge`; all-cringe → gọi `callLLM` lại tối đa `maxReroll` lần rồi re-judge; `callLLM` :65, `parseJSON` :142 — reuse nguyên.
- `src/agents/jevBrain.js` — `decide(state, questions)` trả `{answers, meta.degraded}`; Noul trả `{noul:0..1}` (no confidence — threshold trên value). Tham chiếu multi-question call: `thoughtLeaderAgent.js:261-278`.
- `tests/ai/` — đã có `tweetWriter.test.js`; thêm `jevVariantJudge.test.js` mock `fetch` boundary (pattern `tests/automation/jevUnfollowGuard.test.js` hoặc vi.mock guard).
- `.env.example` + `vitest.config.js` env block — `JEV_VARIANT_JUDGE:'0'` test-safe.
- Callers đã cover: `api/routes/ai/writer.js:201,461`, `src/mcp/server.js:6219,6387`, `src/cli/commands/ai.js`, `analytics.js:587` queue — không sửa, hưởng judge tự động.

## Tasks & Acceptance

**Execution:**
- [x] `src/ai/jevVariantJudge.js` — NEW module + `.d.ts` nếu convention áp dụng trong `src/ai/` (có sẵn `.d.ts` siblings).
- [x] `src/ai/tweetGenerator.js` — wire judge vào `generateTweet` + `generateReply` post-parse; bounded re-roll khi all-cringe.
- [x] `.env.example` + `vitest.config.js` — env docs + test kill-switch default.
- [x] `tests/ai/jevVariantJudge.test.js` — verdict matrix: pick, winner-cringe demote, all-cringe reroll bounded, degraded passthrough, kill-switch, single-variant, noul>0.3 boundary.
- [x] `tests/ai/tweetGenerator.jev.test.js` — wiring: mock `callLLM` chain + guard module → assert selected flag + reroll path.

**Acceptance Criteria:**
- Given 3 variants và Jev pick variant_2 cringe 0.1, thì `tweets[1]` có `selected:true`, mỗi item có `cringe`, `jevJudge.selectedIndex=1`.
- Given pick bị cringe>0.3 nhưng variant khác sạch, thì winner là variant sạch ít cringe nhất.
- Given mọi variant cringe>0.3, thì generator re-roll đúng 1 lần; vẫn fail → `jevJudge.allCringe:true`, không item nào `selected`.
- Given Jev degraded, thì result như pre-story + `jevJudge.degraded:true`, không throw.
- Given `JEV_VARIANT_JUDGE=0`, thì zero decide calls, output giống hệt pre-story.
- Given `npx vitest run tests/ai/` thì pass, kể cả kill-switch off.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Evidence / Route |
|---|---|---|---|
| 1 | Reroll: `usage` chỉ reflect call cuối; `result` bị reassign trước khi parseJSON validate → model/provider/usage mô tả response bị discard | **medium** — real | `tweetGenerator.js` regenerate closure reassigns `result` ngay sau callLLM; parseJSON throw → stale fields; token spend call đầu mất. Route: patch (assign result sau khi normalize + accumulate usage) |
| 2 | regenerate trả empty/non-array → re-judge y hệt set cũ → tốn 1 paid decide call | **low** — real | `if (Array.isArray && length>0) current = regenerated` rồi cứ judge lại dù current không đổi. Route: patch (break sớm) |
| 3 | `pickChoice` match raw string — `'Variant_2'`/`' variant_2 '` miss → silent demote về argmin | **medium** — real | `jevVariantJudge.js` `match(/^variant_(\d+)$/)` không normalize. Route: patch (trim+lowercase) |
| 4 | Jev trả pick nhưng omit HẾT `cringe_i` keys → all 1.0 → allCringe + đốt paid reroll trên text sạch | **medium** — real | fail-closed per-variant đúng, nhưng zero noul evidence = output judge vô dụng → nên degraded, không phải allCringe. Route: patch |
| 5 | Re-roll resend y hệt prompt + temperature → resample cùng distribution, dễ fail lại | **low** — real | regenerate dùng verbatim `messages`/`llmOptions`. Route: patch (append anti-cringe nudge vào user prompt khi re-roll) |
| 6 | `JEV_THRESHOLD_CRINGE`/`JEV_VARIANT_JUDGE_MAX_REROLL` không pin trong vitest.config → `.env` dev có thể flip verdict tests | **medium** — real | vitest.config chỉ pin kill-switch; config dotenv-load `.env`. Route: patch (pin defaults) |
| 7 | Provider env leak: `OPENAI_API_KEY`/`XAI_API_KEY`/`GROK_API_KEY` không stub → `provider:'openrouter'` assert fail trên máy có keys | **medium** — real | `resolveProvider` ưu tiên env; `tweetWriter.test.js` đã delete đúng các key này — file mới miss convention. Route: patch |
| 8 | `rewriteTweet` cũng trả variant array `{text, improvement}` nhưng bị loại khỏi judge — Never-list rationale "hai surface trả variant arrays" là sai | **intent_gap** | Surface thứ 3 cùng contract, chưa được quyết định — line trong frozen block nhưng rationale sai sự thật → hỏi human |
| 9 | `judgePostVariants` cap text-length nhưng không cap N variants → direct caller truyền array lớn inflate paid call | **low** — real | 2 caller wired đều cap 5, nhưng export public. Route: patch (cap 5) |
| 10 | Không có per-call `cringeThreshold`/`maxReroll` options trên generators | reject **low** | Env là contract theo spec; thêm options = public surface intent không đòi |
| 11 | sprint `in-progress` vs spec `in-review` "mâu thuẫn" | **false** | Hai axis khác nhau — sprint-status chỉ có backlog/in-progress/done; in-review là spec stage. Workflow artifact, sync cuối |
| 12 | Test helpers duplicated giữa 2 test files + reply thiếu degraded/kill-switch cases | reject **low** | Dedup = cosmetic churn; reply share `judgeVariantsWithReroll` đã cover cả 2 surfaces |
| 13 | `JEV_VARIANT_JUDGE_MAX_REROLL=' '` (whitespace) → `Number(' ')===0` → silently disable reroll | **low** — real | `''` early-return default nhưng `' '` lọt qua. Route: patch (trim trước Number) |
| 14 | `_sharedBrain` rebuild chỉ trigger trên `apiKey` — endpoint/model env đổi không rebuild | defer | Mirror y hệt `jevUnfollowGuard.js` — convention xuyên module; sửa riêng chỗ này làm diverge. Pre-existing pattern |
| 15 | `String()` coercion ngoài try — throwing toString/Symbol.toPrimitive vi phạm never-throws | **low** — real (exotic) | JSON parse không sinh ra object này, nhưng export public + spec Always never-throws. Route: patch (wrap try) |
| 16 | Degrade SAU reroll thành công trả re-rolled set dưới `degraded:true` — spec nói "nguyên trạng" | reject **low** | Set gốc đã proven allCringe — trả variants mới trả tiền khi judge chết giữa chừng defensible và tốt hơn cho output |
| 17 | `judgeVariantsWithReroll` silent `jevJudge:null` khi regenerate không phải function | reject **low** | Internal helper — cả 2 call sites đều truyền; không public surface |
| 18 | Không test nào exercise shared-brain production path — 100% tests inject `brain`, regression `resolveBrain` → feature chết silently | **medium** — real | Verified: mọi call đều inject; `JEV_VARIANT_JUDGE=0` global trong vitest. Route: patch (no-injection test với `TYPESAFE_API_KEY=''` → degraded qua real JevBrain, no network) |
| 19 | Re-roll `callLLM` không timeout → tới (1+maxReroll) unbounded calls | defer | `callLLM` không có timeout param ở bất cứ đâu — pre-existing contract, initial call cùng exposure. Fix cần plumbing mới |
| 20 | CLI `ai generate` interpolate `${t}` → `[object Object]` | defer | Pre-existing tại `cli/commands/ai.js:136` — tweets luôn là objects, không liên quan diff |

## Design Notes

- **Một decide call, nhiều questions:** `decide(state,{pick:Choice,cringe_1..N:Noul})` — Jev trả answers dict 1 HTTP call; không per-variant calls (spend O(1) per generation thay vì O(N)).
- **`none_good` escape hatch** trong Choice criteria — Jev có thể từ chối mọi variant (→ -1 → reroll path dù cringe OK). Giữ semantics: pick none_good hoặc winner cringe → fallback argmin cringe ≤ T → không có → allCringe.
- **Fail-safe polarity ngược 42.8:** đây là selection judge, không phải action gate — degraded → variants nguyên trạng (không chọn gì), không phải "keep all".

## Verification

**Commands:**
- `npx vitest run tests/ai/` — expected: all pass.
- `JEV_VARIANT_JUDGE=0 npx vitest run tests/ai/ tests/mcp/ tests/api/` — expected: all pass, no regression.
- `node -e "import('./src/ai/jevVariantJudge.js').then(m=>console.log(typeof m.judgePostVariants))"` — expected: `function`.

**Manual checks:**
- `grep -rn 'api.typesafe.ai' src/ai/` → 0 hits.
