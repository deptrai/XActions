---
title: 'Story 43.1: jev-workflow-conditions'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_revision: '9b9e6225'
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

**Problem:** `src/workflows/conditions.js` chỉ hỗ trợ deterministic conditions (`{left, operator, right}`, `{all}`, `{any}`) — workflow không thể branch trên semantics ("is this tweet relevant to our niche?", "is this user a spammer?"). Epic 43 muốn `evaluateCondition` chấp nhận `{jev: {question, state, type, threshold}}` gọi `jevBrain.decide` → boolean.

**Approach:** Thêm condition type `jev` vào `evaluateCondition` — nhận `{jev: {question: string, state: any, type: 'noul'|'choice'|'score', threshold?: number, choices?: string[]}}`. Noul → `noul >= threshold` (default 0.5). Choice → `choice` ∈ `choices` (default: any non-'ignore'). Score → `score >= threshold` (default 2). **Degraded → `passed: false`** (conservative: semantic condition fail-safe không act khi không có signal). `evaluateCondition` vẫn sync cho deterministic — Jev type cần async: thêm `evaluateConditionAsync` mới export (giữ `evaluateCondition` sync nguyên vẹn); `engine.js` đổi gọi sang `await evaluateConditionAsync` (chỉ 1 call site).

## Boundaries & Constraints

**Always:**
- `evaluateCondition` sync **giữ nguyên** cho tất cả condition types hiện có (deterministic, `all`, `any`) — không break callers.
- Thêm `evaluateConditionAsync` export — `evaluateCondition` internal đổi sang nó; `engine.js` chuyển từ `evaluateCondition` sang `await evaluateConditionAsync`.
- `evaluateConditionAsync` xử lý `jev` condition trước; nếu không phải `jev` → delegate `evaluateCondition` sync.
- Jev qua `JevBrain` instance (lazy singleton — không tạo per call).
- Noul threshold default 0.5 (nhất quán `brandSafe` 0.5); configurable qua `threshold`.
- Choice: trả `passed=true` khi `answer.choice` nằm trong `choices` array (hoặc khi `choices` absent → `choice !== 'ignore'`).
- Score: trả `passed=true` khi `answer.score >= threshold` (default 2 = "clearly relevant" / "good").
- Degraded (`meta.degraded`) → `{passed: false, details: 'Jev degraded: <reason>'}` — conservative, không act khi không có signal.
- `{jev: {question, state}}` nhận `state` là `WorkflowContext` hoặc phần của nó — cho phép `state` là path string ("tweet.text") resolve qua `resolveValue`.
- Test: vitest, `vi.stubGlobal('fetch')` — mirror jevBrain.test.js.

**Never:**
- Đổi `evaluateCondition` sync → async trực tiếp — callers hiện có sẽ vỡ.
- Gọi `api.typesafe.ai` trực tiếp.
- Đụng deterministic conditions — giữ nguyên.
- Throw khi Jev degraded — trả `{passed:false}`.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Error |
|----------|-------|----------|-------|
| Noul pass | `{jev:{question:'is spam', state:'spam text', type:'noul', threshold:0.5}}` Jev noul=0.8 | `{passed:true, details:'jev noul 0.80 >= 0.50'}` | none |
| Noul fail | same, noul=0.3 | `{passed:false}` | none |
| Choice match | `{jev:{question:'intent?', type:'choice', choices:['reply','like']}}` Jev choice='reply' | `{passed:true}` | none |
| Choice no match | choice='ignore' | `{passed:false}` | none |
| Choice default (no choices) | choice='like' (non-ignore) | `{passed:true}` | none |
| Score pass | `{jev:{question:'relevant?', type:'score', threshold:2}}` Jev score=3 | `{passed:true}` | none |
| Score fail | score=1 | `{passed:false}` | none |
| Degraded | no API key | `{passed:false, details:'Jev degraded: missing-key'}` | none |
| Sync condition via async wrapper | `{left:'x',operator:'>',right:5}` | delegates to sync `evaluateCondition` → `{passed: true/false}` | none |
| State path resolution | `{jev:{question:'relevant?',state:'tweet.text'}}` context has tweet | resolves 'tweet.text' → sends resolved string to Jev | none |

</intent-contract>

## Code Map

- `src/workflows/conditions.js` — MODIFY: thêm `evaluateConditionAsync` (async wrapper) + `jev` branch; `evaluateCondition` sync giữ nguyên.
- `src/workflows/engine.js` — MODIFY: `evaluateCondition(step.condition, context)` → `await evaluateConditionAsync(step.condition, context)` (1 call site, inside async `runWorkflow`).
- `src/workflows/conditions.d.ts` — check if exists, add types.
- `src/types/xactions.js` — check WorkflowCondition typedef, add `jev` field.
- `tests/workflows/conditions.jev.test.js` — NEW: mock fetch + JevBrain, cover matrix.
- `tests/workflows/conditions.test.js` — check existing, add async wrapper regression test.

## Tasks & Acceptance

**Execution:**
- `src/workflows/conditions.js` — thêm `evaluateConditionAsync` + `jev` evaluation branch.
- `src/workflows/engine.js` — `await evaluateConditionAsync` thay `evaluateCondition`.
- `src/types/xactions.js` — check/add `jev` to `WorkflowCondition` typedef nếu cần.
- `tests/workflows/conditions.jev.test.js` — NEW: noul/choice/score paths, degraded, state path resolution.
- `tests/workflows/conditions.test.js` — verify sync `evaluateCondition` unchanged + `evaluateConditionAsync` delegates correctly.

**Acceptance Criteria:**
- Given `{jev:{question:'is spam?',type:'noul',threshold:0.5}}` + Jev noul=0.8 → `{passed:true}`.
- Given `{jev:{question:'intent?',type:'choice',choices:['reply']}}` + Jev choice='reply' → `{passed:true}`; choice='ignore' → `{passed:false}`.
- Given `{jev:{question:'relevant?',type:'score',threshold:2}}` + Jev score=3 → `{passed:true}`.
- Given degraded Jev → `{passed:false}`.
- Given `{left:'x',operator:'>',right:5}` via `evaluateConditionAsync` → same result as sync `evaluateCondition`.
- Given `state:'tweet.text'` + context `{tweet:{text:'hello'}}` → resolves 'hello' → sends to Jev.
- Given `npx vitest run tests/workflows/` → all pass.

## Spec Change Log

## Review Triage Log

**Auto Run Result (2026-09-22)**
- `src/workflows/conditions.js`: thêm `evaluateJevCondition` (noul/choice/score semantics, degraded→passed:false) + `evaluateConditionAsync` (async wrapper — delegates non-jev → sync `evaluateCondition`); lazy `_jevBrain` singleton; state path resolution qua `resolveValue`.
- `src/workflows/engine.js`: `await evaluateConditionAsync` thay `evaluateCondition` (1 call site); import cập nhật.
- `src/types/xactions.d.ts`: `WorkflowCondition.jev` field thêm `{question, state?, type?, threshold?, choices?}`.
- `tests/workflows/conditions.jev.test.js` (new, 11 tests): noul pass/fail, choice ∈/∉ choices, choice default non-ignore, score pass/fail, degraded conservative, state path resolution, sync delegation (no fetch), string expression.
- Verify: 148/148 workflow tests pass (137 existing + 11 new jev). Sync `evaluateCondition` API unchanged — zero regression.


## Design Notes

- **Sync/async split:** `evaluateCondition` sync export giữ nguyên (backward compat); `evaluateConditionAsync` là wrapper mới cho jev + delegates deterministic → sync path. `engine.js` dùng `await evaluateConditionAsync`.
- **Lazy JevBrain:** module-level `_jevBrain` singleton — tạo 1 lần, không phải mỗi condition evaluation.
- **State resolution:** `state` có thể là object literal hoặc string path — `resolveValue` hiện có xử lý được nếu ta truyền string path qua nó trước khi gửi Jev.
- **Degraded semantics:** conservative — `passed:false` khi không có Jev signal (không giống `_searchAndEngage` degraded fallback to heuristic — workflow condition không có heuristic tương đương).

## Verification

**Commands:**
- `npx vitest run tests/workflows/` -- expected: all pass (new + existing).
- `npx vitest run tests/agents/jevBrain.test.js` -- regression.
