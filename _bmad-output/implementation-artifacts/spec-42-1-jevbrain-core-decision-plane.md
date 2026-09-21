---
title: 'Story 42.1: jevBrain-core-decision-plane'
type: 'feature'
created: '2026-09-21'
status: 'ready-for-dev'
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

**Problem:** Mọi judgment trong agentic subsystems (relevance, action, spam, safety) đang đi qua generative LLM (`LLMBrain.scoreRelevance` sinh text rồi `parseInt` — parse lỗi thì im lặng return default 50) hoặc heuristic coin-flip (`Math.random()<0.4`). Không có calibrated confidence → không dám để agent tự chủ; chi phí token sinh text chỉ để vứt; output không typed.

**Approach:** Tạo `src/agents/jevBrain.js` — **module gateway duy nhất** tới TypeSafe Jev (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`). Trả typed answers `{choice|score|noul, probabilities, confidence}`. Confidence gate per-action (user-tunable), LLMBrain fallback trên mọi failure path, cost governance qua `DistributedTokenBucket` + `JEV_DAILY_BUDGET_USD` ceiling. Jev KHÔNG sinh prose — nó chỉ trả judgment.

## Boundaries & Constraints

**Always:**
- `jevBrain.js` là **sole gateway** — không module nào gọi `api.typesafe.ai` trực tiếp (invariant §5.6).
- Mọi failure path degrade sang `LLMBrain` judgment — **không bao giờ throw** lên caller của decision plane (missing key | HTTP 5xx | timeout >5s | HTTP 429 sau retry | budget ceiling).
- Confidence thresholds per-action load từ `config`/`env` — không hardcode.
- Retry shell mirror `LLMBrain._call`: 3 attempts, backoff `2^attempt * 1000 + jitter` ms.
- Meter cost qua `DistributedTokenBucket` key `jev:*` + `JEV_DAILY_BUDGET_USD` (mirror AD-42 pattern); `BUDGET_CEILING_REACHED` → soft-degrade, không throw.
- State gửi Jev là **text-only** (string | object | array của text).
- ESM (`import`/`export`), `const` over `let`, emoji-prefixed console logs, `// by nichxbt` credit — match codebase style.
- JSDoc typedefs cho mọi public type.

**Never:**
- Jev sinh prose/reply/post (đó là `LLMBrain`).
- Dùng `@typesafe-ai/sdk` package (REST `fetch` thuần).
- Đưa Jev vào critical path logic (invariant §4 corollary — Jev advisory).
- Hardcode confidence thresholds.
- Throw lỗi Jev lên caller — mọi error path kết thúc ở fallback.
- Mock/stub trong test (no-mocks convention của repo — dùng local ephemeral server hoặc mock fetch qua `vi.stubGlobal` như `tests/agents/llmBrain.test.js` đã làm).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path — Choice+Score+Noul mix | `decide({tweet,author}, {relevance: Score, action: Choice, isSpam: Noul})` với key hợp lệ | `{answers: {...}, usage: {...}}` — mỗi answer có typed value + confidence (trừ Noul) | Không lỗi |
| Missing API key | env `TYPESAFE_API_KEY` vắng, không `apiKey` option | Không gọi fetch; fallback `LLMBrain` judgment ngay từ đầu; trả `{degraded: true, source: 'llmbrain'}` | Không throw |
| HTTP 5xx | fetch trả status 503 | Retry 3 attempts với backoff; hết → fallback `LLMBrain` | Không throw |
| HTTP 429 | fetch trả 429 | Retry 3 attempts exponential; hết → fallback `LLMBrain` | Không throw |
| Timeout >5s | `AbortController` fire sau 5s | Hủy fetch, fallback `LLMBrain` | Không throw |
| Budget ceiling | `JEV_DAILY_BUDGET_USD` đã cạn qua DistributedTokenBucket | Skip Jev call; fallback `LLMBrain`; log `BUDGET_CEILING_REACHED` | Không throw |
| Redis không khả dụng | DistributedTokenBucket fallback in-memory | Meter vẫn chạy in-memory; Jev vẫn gọi được | Không throw |
| Parse response thiếu `answers` | Jev trả body dị dạng | Coi như lỗi → fallback `LLMBrain` | Không throw |

</intent-contract>

## Code Map

- `src/agents/llmBrain.js` -- READ-ONLY pattern source: `_call()` retry shell (3 attempts, `2^attempt*1000+jitter`), `_checkRateLimit`/`_bumpRateLimit` (Map per model, 10/min), `_recordUsage`/`getUsageToday`/`onUsage` callback. jevBrain mirror shell này nhưng KHÔNG sửa llmBrain.
- `src/core/distributed-token-bucket.js` -- `DistributedTokenBucket.consume(key, tokens, {capacity, refillRate, ttlSeconds})` → `{allowed, remaining, retryAfterMs}`; `globalDistributedTokenBucket` singleton; lazy Redis connect khi `REDIS_TOKEN_BUCKET=1`, in-memory fallback tự động.
- `src/core/adaptive-governor.js` -- example of how core modules consume the bucket singleton; pattern reference only.
- `tests/agents/llmBrain.test.js` -- test pattern để mirror: `vi.stubGlobal('fetch', mockFetch)` + `mockResponse()` helper; describe/it/expect vitest.
- `scripts/jev-verify/verify.mjs` -- reference implementation của `buildQuestions()` (Score 4 levels, Choice 5 options, Noul) + response shapes verified thật.
- `docs/architecture.md` §5.6 -- invariant isolation (không hardcode threshold, sole gateway, never hard-fail).
- `package.json` -- engines `node >=20.18.1` (native fetch OK), ESM.

## Tasks & Acceptance

**Execution:**
- `src/agents/jevBrain.js` -- tạo mới: class `JevBrain` với `decide(state, questions, options)` (POST systemOne, retry 3 attempts, AbortController 5s timeout, parse typed answers), `gate(answer, {hi, mid})` → `'act'|'review'|'skip'`, budget check qua `globalDistributedTokenBucket.consume('jev:daily', ...)`, fallback `_fallbackDecision(state, questions)` dùng `LLMBrain` khi degrade -- core deliverable của story.
- `src/agents/jevBrain.d.ts` -- tạo mới: type declarations (mirror pattern `llmBrain.d.ts`).
- `tests/agents/jevBrain.test.js` -- tạo mới: vitest suite với mock fetch + local ephemeral HTTP server cho timeout/retry cases; cover toàn bộ I/O matrix rows.

**Acceptance Criteria:**
- Given valid API key + healthy mock Jev response, when `decide()` được gọi với mixed questions, then trả `{answers, usage, meta:{degraded:false}}` đúng typed shape.
- Given `TYPESAFE_API_KEY` vắng, when `decide()` được gọi, then KHÔNG có fetch call tới typesafe, kết quả từ `LLMBrain` fallback, `meta.degraded === true`.
- Given fetch trả 503 3 lần liên tiếp, when `decide()` được gọi, then 3 fetch attempts với backoff, sau đó fallback, `meta.degraded === true`.
- Given fetch trả 429 rồi 200, when `decide()` chạy, then retry thành công và kết quả Jev thật (không fallback).
- Given server treo >5s, when `decide()` chạy, then AbortController hủy và fallback `LLMBrain` trong <6s.
- Given `JEV_DAILY_BUDGET_USD=0` (bucket rỗng), when `decide()` chạy, then không fetch call, fallback LLMBrain, warning log có chữ `BUDGET_CEILING_REACHED`.
- Given response body thiếu `answers`, when `decide()` chạy, then fallback LLMBrain, không throw.
- Given `gate()` với thresholds `{hi:0.85, mid:0.6}`, when conf=0.9 → `'act'`, conf=0.7 → `'review'`, conf=0.4 → `'skip'`.

## Spec Change Log

## Review Triage Log

## Design Notes

- **Tại sao không đưa vào LLMBrain:** systemOne không tương thích chat/completions shape (không messages, không streaming). Cố ép vào `_call` làm hỏng cả hai. Module riêng giữ invariant isolation và dễ test.
- **Budget pattern:** `ProxyBudgetGovernor` (AD-42) dùng `consume()` pre-flight trên key daily. jevBrain mirror: `consume('jev:daily', 1, {capacity: budgetCents, refillRate: budgetCents/86400, ttlSeconds: 86400})` — mỗi call consume 1 token; capacity = budget_USD * 100 / avg_cost_per_call_cents. Đơn giản hơn: capacity = số call được phép trong ngày (config `JEV_DAILY_BUDGET_USD` / estimated $0.000024/call).
- **Fallback mapping:** khi degrade, `jevBrain` gọi `LLMBrain` judgment method tương ứng nếu consumer cung cấp (qua constructor option `fallbackLLM`), hoặc trả `null` answers để caller tự quyết — API surface: `decide()` trả `{answers, usage, meta}`; `meta.degraded=true` + `meta.reason` ('missing-key'|'http-5xx'|'timeout'|'http-429'|'budget'|'bad-response').

## Verification

**Commands:**
- `npx vitest run tests/agents/jevBrain.test.js` -- expected: all tests pass, cover every I/O matrix row.
- `node -e "import('./src/agents/jevBrain.js').then(m => console.log(typeof m.JevBrain))"` -- expected: `function`.

**Manual checks (nếu cần):**
- `scripts/jev-verify/verify.mjs --mock` vẫn chạy đúng (không break harness).
