---
title: 'Story 44.3: jev-xspace-sentiment'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_revision: 'fa790cb3'
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

**Problem:** Trong phòng XSpace voice room, `detectSentiment(text)` trong `xspace-agents/packages/core/src/intelligence/sentiment.ts` chỉ dùng regex cứng (`POSITIVE_PATTERN`, `NEGATIVE_PATTERN`, `FRUSTRATED_PATTERN`). Nhược điểm:
1. Hoàn toàn bỏ lỡ sarcasm / mỉa mai, ẩn ý hoặc ngữ cảnh giọng nói tự nhiên của người tham gia.
2. Không thể gán confidence score cho cảm xúc.
3. Nếu biến `detectSentiment` thành async đơn thuần và await Jev trực tiếp, voice audio loop sẽ bị khựng (dead air / lag > 300ms) nếu mạng chậm.

**Approach:**
Áp dụng mô hình **Dual-Speed Emotional State Machine** (khuyến nghị của Winston):
1. Giữ nguyên `detectSentiment(text): Sentiment` đồng bộ (fast-path 0ms) làm baseline và fallback.
2. Thêm `detectSentimentAsync(text, options)`:
   - Nhận diện các cảm xúc chuẩn của `Sentiment`: `'positive' | 'negative' | 'excited' | 'frustrated' | 'question' | 'neutral'`.
   - Cho phép inject `jevClassifier?: (text: string) => Promise<{ sentiment: Sentiment; confidence: number } | null>`.
   - Raced non-blocking: `Promise.race([jevClassifier(text), timeout(400ms)])`.
   - Nếu Jev hoàn thành trong <400ms với `confidence >= 0.65` -> Trả về kết quả Jev.
   - Nếu Jev quá 400ms, lỗi hoặc confidence thấp -> Fallback ngay lập tức về synchronous `detectSentiment(text)`.
   - Voice loop không bao giờ bị block hay ném ngoại lệ.

## Boundaries & Constraints

**Always:**
- `detectSentiment(text)` đồng bộ giữ nguyên 100% chữ ký và hoạt động.
- `detectSentimentAsync` có hard timeout <= 400ms.
- Fallback an toàn về regex khi timeout, lỗi mạng, hoặc degraded.
- TypeScript types đầy đủ, tương thích với kiểu `Sentiment` hiện có của xspace-agents.

**Never:**
- Không await Jev vô hạn định làm gián đoạn pipeline audio.
- Không ném exception ra ngoài turn coordinator.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Latency & Fallback |
|----------|-------|-----------------|-------------------|
| Question detection | "What do you think?" | `'question'` | Instant regex catch (0ms) |
| Fast Jev classifier | "Amazing talk, learned a lot" | `{ sentiment: 'positive', confidence: 0.92, source: 'jev' }` | Jev wins (<400ms) |
| Slow Jev (>400ms) | "Interesting point" (delay 600ms) | `{ sentiment: 'neutral', source: 'rules' }` | Timeout 400ms wins -> fallback regex |
| Jev error / rejection | Any text (throw error) | Regex output, `source: 'rules'` | Catch -> fallback regex |
| No classifier provided | "Great job" | Regex output, `source: 'rules'` | 0ms direct regex |

</intent-contract>

## Code Map

- `xspace-agents/packages/core/src/intelligence/sentiment.ts` — ADD: `detectSentimentAsync(text, options)` & types.
- `xspace-agents/packages/core/src/intelligence/index.ts` — EXPORT: `detectSentimentAsync`.
- `xspace-agents/packages/core/src/__tests__/intelligence.test.ts` — ADD: test suite cho `detectSentimentAsync`.

## Tasks & Acceptance

**Execution:**
- Bổ sung `detectSentimentAsync` vào `sentiment.ts`.
- Xuất hàm trong `intelligence/index.ts`.
- Viết các test case kiểm chứng fast-path, Jev win, Jev timeout race, Jev error fallback.

**Acceptance Criteria:**
- Given Jev trả kết quả nhanh (<400ms), cảm xúc từ Jev được áp dụng.
- Given Jev bị delay >400ms, hệ thống tự động ngắt và trả về kết quả regex, không làm khựng luồng.
- Toàn bộ test cũ trong `intelligence.test.ts` tiếp tục pass 100%.

## Review Triage Log

**Auto Run Result (2026-09-22)**
- `xspace-agents/packages/core/src/intelligence/sentiment.ts`: Bổ sung `detectSentimentAsync(text, options)` với mô hình Dual-Speed Emotional State Machine theo chỉ đạo kiến trúc của Winston. Hàm chạy song song fast-path regex với Jev classifier injection được bảo vệ bởi timeout 400ms (`Promise.race`). Nếu Jev vượt quá ngân sách độ trễ hoặc gặp lỗi/confidence thấp -> Tự động fallback về synchronous `detectSentiment(text)` (0ms) mà không bao giờ làm khựng voice audio pipeline.
- `xspace-agents/packages/core/src/intelligence/index.ts`: Re-export `detectSentimentAsync`, `JevSentimentOptions`, và `SentimentAnalysisResult`.
- `xspace-agents/packages/core/src/__tests__/intelligence.test.ts`: Bổ sung test suite cho `detectSentimentAsync` kiểm chứng 5 kịch bản: default regex fallback, Jev fast win (<400ms), Jev timeout fallback (>400ms), Jev throw error fallback, và low confidence fallback.
- Kiểm thử: Toàn bộ 58/58 tests của `intelligence.test.ts` pass 100%.

