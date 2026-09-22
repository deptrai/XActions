---
title: 'Story 43.2: jev-write-path-gate'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_revision: '74f5f117'
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

**Problem:** Trước mọi write (post/reply/DM), XActions hiện chỉ có `persona.validateContent` (rule-based) + `checkPersonaConsistency` (LLM call) + Story 42.2 `safeToSend` Noul (chỉ trong `_createContent`). Còn thiếu: (1) `api/routes/ai/optimizer.js /predict` — heuristic keyword scoring thô, không semantic; (2) `api/routes/ai/moderation.js` — block-bots chỉ dùng `threshold` numeric, không có Jev toxic gate; (3) `xspace moderation.ts isBlocked` — regex pattern thô.

**Approach:** Thêm `src/ai/jevWriteGate.js` — `writeGate(content, options)` trả `{verdict: 'send'|'block'|'review', scores: {virality, clarity, onBrand, safeToPost}, toxicNoul}`. Cắm vào: (1) `api/routes/ai/optimizer.js /predict` — Jev semantic scores thay heuristic; (2) `api/routes/ai/moderation.js` — thêm `POST /jev-check` sync endpoint cho content moderation; (3) `xspace moderation.ts` — inject `jevChecker` optional thay regex.

## Boundaries & Constraints

**Always:**
- Jev qua `JevBrain` instance — không module nào gọi `api.typesafe.ai` trực tiếp.
- `writeGate(content, {brain, icp?})` — 1 call với 4 questions: `virality` Score(0-3), `clarity` Score(0-3), `onBrand` Score(0-3), `toxic` Noul.
- Verdict: `toxic.noul >= 0.5` → `'block'`; `virality+clarity+onBrand` avg >= 2 → `'send'`; else `'review'`.
- `optimizer.js /predict` — giữ heuristic scores làm fallback; Jev scores override khi available; degraded → heuristic only.
- `moderation.js` — thêm `POST /jev-check` sync endpoint: `{text}` → `{verdict, scores, toxic}` — session optional (không queueOp).
- `xspace moderation.ts` — `isBlocked` giữ regex sync; thêm `jevChecker` optional async — nếu configured thì `isBlockedAsync(text)` trả `toxic.noul >= 0.5`.
- Degraded → graceful fallback: heuristic-only cho optimizer, regex-only cho xspace moderation, `verdict:'review'` cho writeGate.
- Test: vitest, `vi.stubGlobal('fetch')` + direct function calls + supertest cho route.
- ESM, JSDoc, `// by nichxbt`.

**Never:**
- `queueOp` cho jev-check endpoint — sync.
- Đụng `block-bots` / `mass-block` queue endpoints — giữ nguyên.
- Đụng `predictPerformance` heuristic internals — chỉ thêm Jev layer trên.
- Hardcode thresholds — dùng `confidenceThresholds` của `JevBrain`.
- Đụng `xeepy _calculate_toxicity` (Python — separate concern, không có bridge).

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Error |
|----------|-------|----------|-------|
| Safe high-quality | text='Great AI automation insight' | `verdict:'send'`, virality>=2, toxic<0.5 | none |
| Toxic content | text='hate speech / slur' | `toxic.noul>=0.5` → `verdict:'block'` | none |
| Low quality | text='lol ok' | `virality<=1` → `verdict:'review'` | none |
| Degraded | no API key | `verdict:'review'`, `scores:null`, `toxic:null` | none |
| optimizer /predict with Jev | healthy Jev | `prediction.jev={virality,clarity,onBrand}` override heuristic label | none |
| optimizer /predict degraded | no key | `prediction.jev=null`, heuristic label only | none |
| moderation /jev-check | `{text:'toxic text'}` | `{verdict:'block', toxic.noul>=0.5}` | none |
| moderation /jev-check empty | `{text:''}` | `{verdict:'block'}` (empty = unsafe) | none |

</intent-contract>

## Code Map

- `src/ai/jevWriteGate.js` — NEW: `writeGate(content, {brain})` → `{verdict, scores, toxic}` + `checkToxic(text, {brain})` → `noul`.
- `api/routes/ai/optimizer.js` — MODIFY `/predict`: after heuristic scoring, call `writeGate` → add `prediction.jev` field.
- `api/routes/ai/moderation.js` — ADD `POST /jev-check` sync endpoint.
- `xspace-agents/examples/plugins/moderation.ts` — ADD optional `jevChecker` to `ModerationOptions` + `isBlockedAsync(text)`.
- `tests/ai/jevWriteGate.test.js` — NEW: unit tests for writeGate + checkToxic.
- `tests/api/jev-moderation.test.js` — NEW: route test for /jev-check.
- `tests/api/optimizer.test.js` — check existing, add jev field tests.

## Tasks & Acceptance

**Execution:**
- `src/ai/jevWriteGate.js` — NEW: writeGate + checkToxic.
- `api/routes/ai/optimizer.js` — MODIFY /predict to include Jev semantic scores.
- `api/routes/ai/moderation.js` — ADD /jev-check sync endpoint.
- `xspace-agents/examples/plugins/moderation.ts` — ADD isBlockedAsync + jevChecker option.
- `tests/ai/jevWriteGate.test.js` — NEW.
- `tests/api/jev-moderation.test.js` — NEW.

**Acceptance Criteria:**
- Given `writeGate('safe quality text')` Jev healthy → `{verdict:'send'}`.
- Given `writeGate('toxic text')` Jev returns toxic.noul=0.8 → `{verdict:'block'}`.
- Given `writeGate('meh text')` Jev returns low scores → `{verdict:'review'}`.
- Given degraded Jev → `{verdict:'review', scores:null}`.
- Given `POST /api/ai/moderation/jev-check {text:'toxic'}` → `{verdict:'block'}`.
- Given `POST /api/ai/optimizer/predict {text:'good tweet'}` Jev healthy → `prediction.jev` present with scores.
- Given `npx vitest run tests/ai/jevWriteGate.test.js tests/api/jev-moderation.test.js` → pass.

## Spec Change Log

## Review Triage Log

**Auto Run Result (2026-09-22)**
- `src/ai/jevWriteGate.js` (new): `writeGate(content)` — 1-call/4-questions (virality+clarity+onBrand Score 0-3 + toxic Noul); verdict matrix toxic≥0.5→block, avg>=2→send, else→review; degraded→review/null-scores. `checkToxic(text)` — lightweight Noul-only check for xspace moderation; degraded→not-blocked (conservative).
- `api/routes/ai/optimizer.js /predict`: after heuristic scoring, calls `writeGate` → `prediction.jev` field; degraded → heuristic-only (backward compat).
- `api/routes/ai/moderation.js`: `POST /jev-check` sync endpoint — `{text}` → `{verdict, scores, toxic, degraded}`; session optional.
- `xspace-agents/examples/plugins/moderation.ts`: `ModerationOptions.jevChecker` optional + `isBlockedAsync(text)` — regex first (fast), then Jev check; degraded→false (don't block).
- `tests/ai/jevWriteGate.test.js` (new, 9 tests), `tests/api/jev-moderation.test.js` (new, 5 tests).
- Verify: 14/14 new tests pass + 19/19 jevBrain regression pass.


## Design Notes

- **4 questions per call:** `virality` + `clarity` + `onBrand` Score(0-3) + `toxic` Noul — 1 Jev decide, ~$0.000024/write check.
- **Verdict matrix:** toxic≥0.5→block (absolute); avg(virality,clarity,onBrand)>=2→send; else→review.
- **Optimizer /predict layering:** heuristic scores giữ nguyên làm `prediction.factors`; Jev scores thêm vào `prediction.jev`; label nâng lên khi Jev virality>=2.
- **xspace moderation:** `isBlocked` sync giữ regex; `isBlockedAsync` thêm Jev check — plugin dùng async khi `jevChecker` configured.
- **Degraded semantics:** `writeGate` → `verdict:'review'` (không block, không auto-send — an toàn cho caller).

## Verification

**Commands:**
- `npx vitest run tests/ai/jevWriteGate.test.js tests/api/jev-moderation.test.js` -- expected: all pass.
- `npx vitest run tests/agents/jevBrain.test.js` -- regression.
