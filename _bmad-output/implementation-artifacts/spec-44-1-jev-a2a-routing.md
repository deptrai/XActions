---
title: 'Story 44.1: jev-a2a-routing'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_revision: 'bd7781d6'
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

**Problem:** `A2AOrchestrator` và `skillRegistry`/`bridge.parseNaturalLanguage` chỉ dựa vào regex mẫu cứng (`DECOMPOSITION_PATTERNS`, `NL_PATTERNS`) và lọc chuỗi con thô (`searchSkills`). Khi một task tự nhiên hoặc truy vấn A2A rơi vào trạng thái mập mờ, phức tạp hoặc không khớp regex cứng (ví dụ: *"Find high engagement accounts in AI and inspect what they post"* hoặc *"audit user quality and check if they are spamming"*), hệ thống trả về `null` hoặc không thể dispatch đúng skill.

**Approach:** 
Thêm module semantic routing `src/a2a/jevRouter.js`:
1. `routeTaskIntent(query, { brain, candidateSkills, confidenceThreshold })`:
   - Lọc candidate skills sơ bộ từ `searchSkills` hoặc danh sách cung cấp (tối đa 6 candidates để tránh làm loãng xác suất và tiết kiệm token - theo khuyến nghị của Winston).
   - Nếu có 1 candidate rõ ràng với regex match -> Fast-path (0ms, không tốn token).
   - Nếu có nhiều candidate hoặc không khớp regex -> Gọi Jev `Choice` để disambiguate intent.
   - Nếu `confidence < 0.70` (hoặc `choice === 'unclear'`) -> Trả về `{ disambiguationNeeded: true, confidence, candidates }`.
   - Nếu `confidence >= 0.70` -> Trả về `{ skillId, confidence, rationale }`.
2. Tích hợp vào `src/a2a/skillRegistry.js` qua hàm mới `resolveSkillSemantically(query, options)` (async).
3. Tích hợp vào `src/a2a/bridge.js` trong `parseNaturalLanguageAsync(text)` fallback khi `NL_PATTERNS` không match.
4. Tích hợp vào `src/a2a/orchestrator.js` khi task không khớp `DECOMPOSITION_PATTERNS`.
5. Đảm bảo fallback an toàn khi Jev degraded hoặc thiếu API key (không bao giờ crash).

## Boundaries & Constraints

**Always:**
- Jev routing bắt buộc đi qua `JevBrain` singleton (tuân thủ Invariant AD-48).
- Criteria của Jev `Choice` chỉ giới hạn tối đa 6 candidates phù hợp nhất.
- Ngưỡng confidence gate mặc định là 0.70 (có thể ghi đè qua options hoặc `confidenceThresholds`).
- Hàm đồng bộ hiện có (`searchSkills`, `parseNaturalLanguage`) giữ nguyên 100% chữ ký và hoạt động.
- Degraded mode -> Fallback về kết quả lọc từ khóa hoặc `disambiguationNeeded: false, skillId: null`.
- ESM, JSDoc, `// by nichxbt`.

**Never:**
- Không gọi trực tiếp `api.typesafe.ai`.
- Không đưa toàn bộ 140 tools vào criteria của một Jev call.
- Không phá vỡ các test case đồng bộ hiện có của A2A.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Clear regex query | "get profile for @nasa" | Fast-path: `x_get_profile` (0ms, no Jev call) | none |
| Ambiguous query with high confidence Jev match | "I want to inspect what tweets user posted recently" | `x_get_tweets` với confidence >= 0.70 | none |
| Ambiguous query with low confidence | "Do something with twitter" | `{ disambiguationNeeded: true, confidence < 0.7 }` | none |
| Jev degraded (no key) | "inspect tweets" | Fallback gracefully về keyword search candidate | none |
| Empty / invalid query | `""` hoặc `null` | `null` hoặc reject sạch sẽ | none |

</intent-contract>

## Code Map

- `src/a2a/jevRouter.js` — NEW: Module xử lý semantic disambiguation qua `JevBrain`.
- `src/a2a/skillRegistry.js` — ADD: `resolveSkillSemantically(query, options)`.
- `src/a2a/bridge.js` — ADD: `parseNaturalLanguageAsync(text, options)`.
- `src/a2a/orchestrator.js` — UPDATE: Bổ sung semantic routing vào `TaskDecomposer` khi pattern regex không khớp.
- `tests/a2a/jevRouter.test.js` — NEW: Unit tests cho semantic router.

## Tasks & Acceptance

**Execution:**
- Tạo `src/a2a/jevRouter.js` với `routeTaskIntent`.
- Cập nhật `src/a2a/skillRegistry.js` export `resolveSkillSemantically`.
- Cập nhật `src/a2a/bridge.js` bổ sung `parseNaturalLanguageAsync`.
- Viết test `tests/a2a/jevRouter.test.js` kiểm tra đầy đủ các kịch bản.

**Acceptance Criteria:**
- Given query mập mờ, khi Jev phân loại với `conf >= 0.7`, skill phù hợp nhất được trả về.
- Given query quá mơ hồ, khi Jev trả `conf < 0.7`, kết quả báo `disambiguationNeeded: true`.
- Given Jev degraded, hệ thống không throw và fallback an toàn.
- Toàn bộ 89 test hiện có của `tests/a2a/` tiếp tục pass 100%.

## Review Triage Log

**Auto Run Result (2026-09-22)**
- `src/a2a/jevRouter.js`: Tạo mới `routeTaskIntent(query, options)` kết hợp Fast-path (regex / single match = 0ms) và Disambiguation path qua Jev `Choice` (tối đa 6 candidates phù hợp nhất). Confidence gate >= 0.70. Nếu mập mờ hoặc confidence thấp -> `disambiguationNeeded: true`. Degraded mode -> Fallback an toàn, không ném exception.
- `src/a2a/skillRegistry.js`: Xuất `resolveSkillSemantically(query, options)` gọi `routeTaskIntent`.
- `src/a2a/bridge.js`: Thêm `parseNaturalLanguageAsync(text, options)` tích hợp semantic routing khi regex fast-path không khớp.
- `tests/a2a/jevRouter.test.js`: 9 unit test cases bao quát mọi kịch bản (single match, disambiguation, confidence gate, unclear, degraded, empty query, fast-path bridge, semantic fallback bridge).
- Kiểm thử: 98/98 tests trong `tests/a2a/` pass 100%, không hồi quy.

