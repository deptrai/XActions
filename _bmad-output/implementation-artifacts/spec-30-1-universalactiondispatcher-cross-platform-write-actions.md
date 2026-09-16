---
title: 'Story 30.1 — UniversalActionDispatcher: Cross-Platform Write Actions'
type: 'feature'
created: '2026-09-16'
status: 'in-progress'
route: 'dispatch'
baseline_commit: '4b2f8a5e2d3dc255e36711c01cb8bfc752910dd8'
review_loop_iteration: 0
context:
  - _bmad-output/implementation-artifacts/epic-30-context.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Hiện tại các write action (post, like, reply, follow, unfollow) chỉ được hỗ trợ phân tán hoặc riêng lẻ trên từng nền tảng (ví dụ Twitter hoặc Facebook), chưa có cơ chế điều phối thống nhất cho phép một lệnh gọi duy nhất thực thi đồng bộ hoặc song song qua nhiều nền tảng xã hội (X/Twitter, Bluesky, Mastodon, Threads). Người dùng và AI agent buộc phải gọi thủ công từng crawler riêng biệt.

**Approach:** Xây dựng `UniversalActionDispatcher` tại `src/scrapers/social/dispatcher.js` nhận lệnh dạng `CrawlerCommand` (ví dụ: `{ platform: 'all', action: 'post', args: { text, media } }`), giải quyết danh sách nền tảng mục tiêu, kiểm tra credentials và điều phối song song qua `Promise.allSettled`. Bổ sung các write action còn thiếu cho Bluesky, Mastodon, Threads, tích hợp vào `scrape()` dispatcher và expose qua các MCP tools `x_publish_all`, `x_like_all`, `x_follow_all`.

## Boundaries & Constraints

**Always:**
- Hỗ trợ các action: `post`, `like`, `reply`, `retweet` (repost), `follow`, `unfollow`.
- Khi `platform: 'all'`, tự động giải quyết các social platforms hỗ trợ write: `['twitter', 'bluesky', 'mastodon', 'threads']`. Cho phép truyền mảng cụ thể các platform (ví dụ `platform: ['twitter', 'bluesky']`).
- Thực thi độc lập (Fault Isolation): Lỗi trên một nền tảng không chặn các nền tảng khác; kết quả trả về cấu trúc tổng hợp `{ success, results, errors, summary: { total, succeeded, failed } }`.
- Mỗi lỗi nền tảng phải kèm mã lỗi và `suggestedAction`.
- Thêm các công cụ MCP `x_publish_all`, `x_like_all`, `x_follow_all` vào `src/mcp/local-tools.js` và `src/mcp/server.js`.
- Bổ sung mock/dryRun hoặc credential validation rõ ràng để đảm bảo an toàn khi gọi mà không có credentials.

- Credentials resolution: Tự động phân giải thông tin xác thực từ biến môi trường (ENV) hoặc AccountPool/session khả dụng của từng platform, đồng thời cho phép caller tùy chọn ghi đè bằng cách truyền trực tiếp `options.credentials[platform]`.

**Never:**
- KHÔNG throw unhandled exception làm crash toàn bộ batch khi một nền tảng fail (ví dụ token hết hạn hoặc rate limit).
- KHÔNG thay đổi các read action hiện có trong `scrape()` hoặc các crawler descriptors.
- KHÔNG đưa logic cắt thread phức tạp vào Story này (được xử lý ở Story 30.2 - ContentTransformer).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Publish to all platforms | `dispatchAction({ platform: 'all', action: 'post', args: { text: 'Hello world' } })` | Đăng bài song song lên các nền tảng có cấu hình | Trả kết quả từng platform trong `results` |
| Like post across platforms | `dispatchAction({ platform: ['twitter', 'bluesky'], action: 'like', args: { targetId: '...' } })` | Like trên các platform được chỉ định | Lưu lỗi vào `errors[platform]` nếu thất bại |
| Partial failure (Missing auth) | 1 platform thiếu credentials hoặc token invalid | Các platform khác vẫn chạy bình thường | Ghi nhận lỗi của platform đó, tổng thể trả về partial success |
| Unsupported action on platform | Action không được hỗ trợ trên platform cụ thể | Bỏ qua hoặc báo lỗi rõ ràng `UNSUPPORTED_ACTION` | Kèm `suggestedAction` |
| MCP tool `x_publish_all` | `{ text: 'Hello', platforms: ['twitter', 'bluesky'] }` | Envelope trả về kết quả từng platform | Chuẩn hóa theo MCP envelope |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/dispatcher.js` -- Trình điều phối `UniversalActionDispatcher` chính
- `src/scrapers/social/bluesky/client.js` & `crawler.js` -- Bổ sung các write methods (post, like, follow)
- `src/scrapers/social/mastodon/client.js` & `crawler.js` -- Bổ sung các write methods (post, like, follow)
- `src/scrapers/social/threads/crawler.js` -- Bổ sung các write handler tương ứng
- `src/scrapers/index.js` -- Export `UniversalActionDispatcher` và tích hợp `platform: 'all'`
- `src/mcp/local-tools.js` & `src/mcp/server.js` -- Đăng ký tools `x_publish_all`, `x_like_all`, `x_follow_all`
- `tests/scrapers/social/universal-dispatcher.test.js` -- Bộ test kiểm thử dispatch đa nền tảng và error isolation

## Tasks & Acceptance

**Execution:**
- [ ] `src/scrapers/social/dispatcher.js` -- Tạo `UniversalActionDispatcher` với hỗ trợ `Promise.allSettled`, credential check, và failure aggregation
- [ ] `src/scrapers/social/bluesky/client.js` & `crawler.js` -- Bổ sung XRPC write mutations cho Bluesky (`post`, `like`, `repost`, `follow`, `unfollow`)
- [ ] `src/scrapers/social/mastodon/client.js` & `crawler.js` -- Bổ sung REST write endpoints cho Mastodon (`post`, `like`, `reblog`, `follow`, `unfollow`)
- [ ] `src/scrapers/index.js` -- Tích hợp dispatcher vào entry point và exports
- [ ] `src/mcp/local-tools.js` & `src/mcp/server.js` -- Thêm các tool `x_publish_all`, `x_like_all`, `x_follow_all`
- [ ] `tests/scrapers/social/universal-dispatcher.test.js` -- Viết unit test & mock test cho các trường hợp all/partial success/error isolation

**Acceptance Criteria:**
- Given lệnh gọi `dispatchAction` với `platform: 'all'` và `action: 'post'`, when thực thi, then các nền tảng X, Bluesky, Mastodon, Threads được kích hoạt song song.
- Given một nền tảng bị lỗi xác thực hoặc rate limit, when dispatch chạy, then các nền tảng còn lại vẫn hoàn thành thành công và output trả về tổng hợp đầy đủ lỗi kèm `suggestedAction`.
- Given người dùng gọi MCP tool `x_publish_all`, when cung cấp text và platforms, then lệnh gọi được ủy quyền tới `UniversalActionDispatcher` và trả về envelope hợp lệ.

## Implementation Notes

## Spec Change Log

## Review Triage Log
