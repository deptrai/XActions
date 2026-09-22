---
title: 'Story 44.2: jev-crm-sentiment'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_revision: 'd2ac8a4b'
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

**Problem:** `src/analytics/sentiment.js` và `api/routes/ai/sentiment.js` dựa vào từ điển tĩnh AFINN và regex đơn giản. Phương pháp này hoàn toàn bất lực trước:
1. Sarcasm / mỉa mai ("Tuyệt vời, lại thêm một scam nữa!" -> lexicon đếm chữ "tuyệt vời" và cho điểm positive).
2. Thuật ngữ / lóng Crypto & Web3 ("ngmi", "paper hands", "lùa gà", "đu đỉnh").
3. Không thể đánh giá tác động danh tiếng (Reputation Impact) hoặc phân loại thái độ chi tiết (`enthusiastic`, `positive`, `neutral`, `skeptical`, `hostile`).
Đồng thời, `src/analytics/followerCRM.js` chấm điểm `autoScore` hoàn toàn bằng số học tĩnh (follower count, log10), thiếu chiều sâu đánh giá chất lượng và thái độ của follower.

**Approach:**
Thêm module semantic sentiment `src/analytics/jevSentiment.js`:
1. `analyzeJevSentiment(text, options)`:
   - Jev `Choice`: 5 sắc thái (`enthusiastic`, `positive`, `neutral`, `skeptical`, `hostile`).
   - Jev `Score`: Reputation impact / sentiment intensity (0 đến 3).
   - Jev `Noul`: Sarcasm probability (noul >= 0.5 nghĩa là mỉa mai / châm biếm).
   - Mapping score chuẩn hóa về thang `[-1, 1]` tương thích với hệ thống analytics hiện có.
   - Degraded fallback: Khi Jev mất mạng / thiếu key, fallback tự động về `analyzeRuleBased(text)` của `sentiment.js` mà không gây crash.
2. `tagContactSentiment(username, bioOrTweet, options)` trong `src/analytics/followerCRM.js`:
   - Phân loại follower và tự động gắn tag phù hợp (`advocate`, `positive`, `skeptic`, `critic`, `sarcastic`) kèm điểm `reputationScore`.
   - Giới hạn concurrency & batch size (tối đa 50 contact/batch theo khuyến nghị kiến trúc của Winston) để tránh cạn daily budget.
3. Mở rộng `api/routes/ai/sentiment.js`:
   - Thêm mode `jev` cho `POST /analyze`.

## Boundaries & Constraints

**Always:**
- Jev routing bắt buộc qua `JevBrain` singleton (tuân thủ Invariant AD-48).
- Trả về cấu trúc `{ score: number, label: string, confidence: number, details: object, source: 'jev'|'rules' }` tương thích với `analyzeSentiment`.
- Degraded mode: fallback về rule-based lexicon mà không throw error.
- Giới hạn batch: mỗi batch không quá 50 items.
- ESM, JSDoc, `// by nichxbt`.

**Never:**
- Không gọi trực tiếp `api.typesafe.ai`.
- Không phá vỡ chữ ký và các test cũ của `sentiment.js`.
- Không cho phép batch không giới hạn nuốt sạch $10 daily budget.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Sarcastic praise | "Wow amazing project, rugpull incoming" | `label: 'hostile'` / `'skeptical'`, `sarcasm: true`, `score < 0` | none |
| Web3 high praise | "This team is shipping 24/7, absolute chads! WAGMI" | `label: 'enthusiastic'`, `score > 0.8`, `reputationImpact >= 2` | none |
| Neutral statement | "The update is scheduled for tomorrow at 3pm" | `label: 'neutral'`, `score: 0` | none |
| Empty text | `""` | `{ score: 0, label: 'neutral', confidence: 0 }` (no Jev call) | none |
| Degraded (no key) | Any text | `{ ...rulesResult, source: 'rules', degraded: true }` | none |

</intent-contract>

## Code Map

- `src/analytics/jevSentiment.js` — NEW: Module phân tích cảm xúc ngữ nghĩa qua Jev.
- `src/analytics/sentiment.js` — UPDATE: Tích hợp mode `'jev'` vào `analyzeSentiment`.
- `src/analytics/followerCRM.js` — ADD: `tagContactWithJev(username, text, options)`.
- `api/routes/ai/sentiment.js` — UPDATE: Thêm mode `'jev'` vào route `/analyze`.
- `tests/analytics/jevSentiment.test.js` — NEW: Unit tests cho Jev sentiment & CRM tagging.

## Tasks & Acceptance

**Execution:**
- Tạo `src/analytics/jevSentiment.js` chứa logic phân tích Jev (Choice + Score + Noul).
- Tích hợp `mode: 'jev'` vào `src/analytics/sentiment.js`.
- Thêm helper `tagContactWithJev` vào `src/analytics/followerCRM.js`.
- Hỗ trợ `mode: 'jev'` trong `api/routes/ai/sentiment.js`.
- Viết test suite `tests/analytics/jevSentiment.test.js`.

**Acceptance Criteria:**
- Given câu mỉa mai, Jev phát hiện sarcasm noul >= 0.5 và phân loại nhãn tiêu cực (thay vì positive như lexicon cũ).
- Given lóng web3/crypto, Jev phân loại đúng `enthusiastic` hoặc `skeptical`.
- Given Jev degraded, hệ thống tự động fallback về rule-based lexicon, không throw exception.
- Batch tagging không vượt quá 50 items/batch.
- Toàn bộ test cũ của `tests/analytics/sentiment.test.js` tiếp tục pass 100%.

## Review Triage Log

**Auto Run Result (2026-09-22)**
- `src/analytics/jevSentiment.js`: Tạo mới `analyzeJevSentiment(text, options)` tích hợp Jev Choice (5 sắc thái cảm xúc), Jev Score (reputation impact 0-3), và Jev Noul (sarcasm detection). Khi phát hiện sarcasm trên câu khen, tự động đảo chiều điểm số sang negative. Hỗ trợ batch analysis với giới hạn cứng tối đa 50 item/batch (`analyzeJevBatch`) để bảo vệ budget hạn ngạch theo khuyến nghị của Winston. Fallback an toàn về rule-based lexicon khi degraded.
- `src/analytics/sentiment.js`: Tích hợp mode `'jev'` vào `analyzeSentiment(text, options)`.
- `src/analytics/followerCRM.js`: Bổ sung `tagContactWithJev(username, bioOrText, options)` tự động gắn tag thông minh (`advocate`, `supporter`, `skeptic`, `critic`, `sarcastic`, `high_impact`) cho follower trong SQLite.
- `api/routes/ai/sentiment.js`: Thêm nhánh xử lý `mode: 'jev'` cho route `/api/ai/sentiment/analyze`.
- `tests/analytics/jevSentiment.test.js`: 10 unit test cases bao quát toàn diện sarcasm, enthusiastic praise, hostile FUD, graceful degraded fallback, batch limit và CRM tagging.
- Kiểm thử hồi quy: Toàn bộ 174/174 tests của `tests/analytics/` pass 100%.

