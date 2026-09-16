---
title: 'Story 30.2 — ContentTransformer: Thread Splitter, Media Adapter, Character Limit Handler'
type: 'feature'
created: '2026-09-17'
status: 'done'
route: 'dispatch'
baseline_commit: 'cf17f10a'
review_loop_iteration: 0
context:
  - _bmad-output/implementation-artifacts/epic-30-context.md
  - _bmad-output/implementation-artifacts/spec-30-1-universalactiondispatcher-cross-platform-write-actions.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `UniversalActionDispatcher` (Story 30.1) gửi cùng một nội dung gốc tới mọi nền tảng, nhưng mỗi nền tảng có giới hạn ký tự khác nhau (X ≤ 280, Bluesky ≤ 300, Mastodon ≤ 500, Threads ≤ 500) và quy tắc media khác nhau (số ảnh tối đa: X/Bluesky/Mastodon 4 ảnh, Threads 10 ảnh). Một bài viết dài 1.000 ký tự hiện tại sẽ bị từ chối (`XACT_4001`) trên X/Bluesky dù có thể đăng trên Mastodon/Threads, và người dùng hoặc AI agent phải tự cắt chuỗi bài (thread) thủ công cho từng nền tảng.

**Approach:** Xây dựng `ContentTransformer` tại `src/scrapers/social/content-transformer.js` — nhận bài đăng gốc (text + media) và sinh ra `TransformedPost[]` cho từng nền tảng đích: tự động tách thread thông minh theo giới hạn ký tự (ngắt đoạn → ngắt câu → ngắt từ, không bao giờ cắt giữa URL/mention/hashtag), đánh số `i/n`, áp dụng quy tắc media (giới hạn số ảnh theo platform, batch media nếu vượt), và đính kèm metadata (altText, hashtags). Tích hợp vào `UniversalActionDispatcher`: khi `args.autoThread !== false`, dispatcher tự động biến đổi nội dung trước khi dispatch, và nếu kết quả là thread nhiều phần thì đăng tuần tự (bài gốc dùng `post`, các bài sau dùng `reply` móc xích).

## Boundaries & Constraints

**Always:**
- Giới hạn ký tự chuẩn: `twitter: 280`, `bluesky: 300`, `mastodon: 500`, `threads: 500` (export hằng số `PLATFORM_LIMITS` để test và tái sử dụng).
- Thuật toán tách thread ưu tiên: ngắt đoạn (`\n\n`) → ngắt câu (`. `, `? `, `! `, `\n`) → ngắt từ (space); không bao giờ cắt giữa URL (`http...`), mention (`@user`), hoặc hashtag (`#tag`).
- Mỗi chunk khi tách thread phải chừa headroom ~20 ký tự cho tiền tố đánh số `i/n` ở đầu (ví dụ `2/5 `) khi thread có nhiều hơn 1 phần.
- `TransformedPost` shape: `{ platform, index, total, text, media, altText?, hashtags?, metadata: { charCount, sourceLength, splitMethod } }`.
- Media rules: `twitter: 4 ảnh`, `bluesky: 4 ảnh`, `mastodon: 4 ảnh`, `threads: 10 ảnh` — nếu số media vượt giới hạn, chia media thành các post tuần tự.
- `ContentTransformer.transform(source, platform)` và `ContentTransformer.transformForAll(source, platforms)` là API công khai.
- Khi thread có nhiều phần: dispatcher đăng phần đầu bằng action `post`, các phần sau đăng tuần tự bằng action `reply` trỏ vào ID bài liền trước (mỗi platform tự xử lý định danh: `tweetId` / `parentUri`+`parentCid` / `in_reply_to_id` / `postId`).

**Never:**
- KHÔNG sửa các write actions đã hoàn thành ở Story 30.1 trong crawler — chỉ thêm tầng transform phía trên.
- KHÔNG dùng LLM để tách nội dung — splitting thuần thuật toán xác định (deterministic regex + string tokenizer).
- KHÔNG thay đổi các read action hiện có.
- KHÔNG vượt quá giới hạn ký tự của bất kỳ nền tảng nào — nếu 1 từ/URL đơn lẻ dài hơn limit, throw `XACT_4001` với thông báo rõ ràng.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Text ngắn hơn limit | `{ text: "Hello", platform: 'twitter' }` | `[{ index: 1, total: 1, text: "Hello" }]` — không đánh số, không tách | N/A |
| Text dài vượt limit X | Text 1000 ký tự, `platform: 'twitter'` | Tách thành ~4 chunks ≤ 260 ký tự, đánh số `1/4..4/4` | N/A |
| Text dài vượt limit Mastodon | Text 1000 ký tự, `platform: 'mastodon'` | Tách theo limit 500, ít chunks hơn X | N/A |
| URL không bị cắt | Text chứa URL dài gần limit | Ngắt tại khoảng trắng trước URL, URL giữ nguyên vẹn trong 1 chunk | N/A |
| Mention/hashtag không bị cắt | `@user` hoặc `#tag` nằm tại biên chunk | Token giữ nguyên, ngắt trước token | N/A |
| Từ đơn dài hơn limit | URL dài 500 ký tự, platform twitter | Throw `XACT_4001` "single token exceeds platform limit" | InvalidArgs với suggestedAction |
| Vượt số ảnh cho phép | 8 ảnh, `platform: 'twitter'` (max 4) | 2 TransformedPost, mỗi post 4 ảnh | N/A |
| Media vượt limit Threads | 12 ảnh, `platform: 'threads'` (max 10) | 2 TransformedPost (10 + 2) | N/A |
| autoThread bật, text ngắn | `{ text: "Hi", autoThread: true }` | Dispatcher vẫn transform nhưng ra 1 post duy nhất | N/A |
| autoThread tắt | `{ text: <1000 chars>, autoThread: false }` | Bỏ qua transform — hành vi Story 30.1 cũ (platform tự throw nếu vượt limit) | Platform XACT_4001 |
| Thread nhiều phần qua dispatcher | `dispatchAction({ platform:'all', action:'post', args:{ text:<1000>, autoThread:true } })` | Mỗi platform: post phần 1 → reply phần 2..n tuần tự; lỗi 1 phần không chặn phần sau | Lỗi ghi vào errors, fault isolation giữ nguyên |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/dispatcher.js` — `UniversalActionDispatcher.dispatch`: điểm cắm transform — sau khi resolve credentials, trước khi gọi `scrape()`. Thêm nhánh xử lý thread nhiều phần (post → reply tuần tự) trong vòng lặp per-platform.
- `src/scrapers/social/content-transformer.js` — file MỚI: class `ContentTransformer`, hàm `splitText`, `transform`, `transformForAll`, `chunkMedia`.
- `src/mcp/local-tools.js` — `x_publish_all`: passthrough `autoThread` arg vào dispatcher.
- `src/mcp/server.js` — TOOLS schema `x_publish_all`: thêm property `autoThread` vào inputSchema.
- `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes.INVALID_ARGS`, `SuggestedActions` để throw lỗi chuẩn.

## Tasks & Acceptance

**Execution:**
- [x] `src/scrapers/social/content-transformer.js` — Tạo class `ContentTransformer`: `PLATFORM_LIMITS`, `splitText` (paragraph → sentence → word, bảo vệ URL/mention/hashtag), `chunkMedia`, `transform`, `transformForAll`
- [x] `src/scrapers/social/dispatcher.js` — Tích hợp: khi action `post`/`reply` và `autoThread !== false`, gọi `transformForPlatform`; nếu `total > 1`, đăng tuần tự post → reply chuỗi per platform
- [x] `src/mcp/local-tools.js` & `src/mcp/server.js` — Thêm passthrough `autoThread` vào `x_publish_all` (schema + handler)
- [x] `tests/scrapers/social/content-transformer.test.js` — Unit test: giới hạn từng platform, bảo vệ URL/mention/hashtag, token quá limit, media chunking, đánh số i/n
- [x] `tests/scrapers/social/universal-dispatcher.test.js` — Thêm test tích hợp: thread dài dispatch qua `all` với dryRun, mỗi platform ra đúng số phần, fault isolation giữ nguyên khi 1 phần lỗi

**Acceptance Criteria:**
- Given text 1.000 ký tự và `platform: 'twitter'`, when `transform` chạy, then trả về các chunk ≤ 260 ký tự (280 − headroom), đánh số `i/n`, không chunk nào cắt giữa URL/mention/hashtag.
- Given 8 ảnh và `platform: 'twitter'` (max 4), when `transform` chạy, then trả về 2 post với 4 ảnh mỗi post.
- Given URL đơn lẻ dài hơn limit của platform, when `transform` chạy, then throw `XACT_4001` với message nêu rõ token quá giới hạn.
- Given `dispatchAction({ platform: 'all', action: 'post', args: { text: <1000 chars>, autoThread: true, dryRun: true } })`, when thực thi, then mỗi platform nhận thread đúng số phần (`results[platform].thread.length` khớp kỳ vọng) và không có chunk nào vượt limit.
- Given `autoThread: false`, when dispatch chạy, then hành vi y hệt Story 30.1 (không transform).

## Implementation Notes

- Created `src/scrapers/social/content-transformer.js` implementing deterministic hierarchical text splitting (`splitText`), atomic token protection for URLs/mentions/hashtags, media chunking (`chunkMedia`), and unified transformation (`ContentTransformer.transform`, `transformForAll`).
- Integrated `ContentTransformer` into `UniversalActionDispatcher.dispatch()`: automatically adapts posts per platform limits when `autoThread !== false`, chaining thread parts via sequential `post` -> `reply` with platform-specific tracking IDs (`prevTwitterId`, `parentUri`/`parentCid`, `in_reply_to_id`, `prevThreadsId`).
- Updated `resolveTweetId` in `src/scrapers/social/twitter/client.js` to support dry-run synthetic tweet IDs (`dry-run-*`) during thread simulation.
- Updated MCP tools in `src/mcp/local-tools.js` and `src/mcp/server.js` to support `autoThread` parameter on `x_publish_all`.
- Re-exported `ContentTransformer`, `PLATFORM_LIMITS`, `PLATFORM_MEDIA_LIMITS` from `src/scrapers/index.js` and `src/scrapers/social/dispatcher.js`.
- Created comprehensive test suite in `tests/scrapers/social/content-transformer.test.js` (16 tests) and added end-to-end multi-platform thread dispatch test in `tests/scrapers/social/universal-dispatcher.test.js`. All 33/33 tests passing.

## Spec Change Log

## Review Triage Log

- **patch / medium** — `resolveTweetId` rejected synthetic tweetId (`dry-run-post-...`) on Twitter thread replies. Fixed by allowing `dry-run` prefixed IDs in `src/scrapers/social/twitter/client.js`.
- **verified** — 33/33 tests passing across `content-transformer.test.js` and `universal-dispatcher.test.js`. All acceptance criteria satisfied.
