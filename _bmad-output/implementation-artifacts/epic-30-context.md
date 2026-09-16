# Epic 30 Context: Cross-Platform Action Replay & Content Syndication

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Thiết lập cơ chế điều phối ghi dữ liệu và tương tác mạng xã hội đa nền tảng (Universal Write & Action Dispatcher). Cho phép một lệnh gọi duy nhất (ví dụ: `post --sync-all` hoặc `like`) có thể đồng bộ thực thi trên Twitter/X, Bluesky, Mastodon, và Threads, loại bỏ việc phải gọi từng crawler/script riêng lẻ và xử lý tự động sự khác biệt về giới hạn ký tự, định dạng media giữa các nền tảng.

## Stories

- Story 30.1: UniversalActionDispatcher — Cross-Platform Write Actions
- Story 30.2: ContentTransformer — Thread Splitter, Media Adapter, Character Limit Handler

## Requirements & Constraints

- Hỗ trợ các action tương tác và đăng bài cốt lõi: `post`, `like`, `reply`, `retweet` (repost), `follow`, `unfollow`.
- Lệnh gọi điều phối nhận đối tượng dạng `CrawlerCommand` (ví dụ: `{ platform: 'all', action: 'post', args: { text, media } }`). Khi `platform: 'all'`, tự động phân giải danh sách các nền tảng mạng xã hội mục tiêu (mặc định X, Bluesky, Mastodon, Threads).
- Xác thực và kiểm tra tài khoản/credentials per platform trước khi dispatch; thực thi dispatch song song giữa các nền tảng đích.
- Tính độc lập lỗi (Fault Isolation): Lỗi trên một nền tảng không được làm gián đoạn hoặc throw unhandled làm sập các nền tảng khác; kết quả tổng hợp trả về danh sách thành công và chi tiết lỗi kèm `suggestedAction` cho từng nền tảng thất bại.
- Surface MCP: Cung cấp các công cụ MCP mới trong `src/mcp/local-tools.js` / `server.js`: `x_publish_all`, `x_like_all`, `x_follow_all`.
- Kiến trúc module hóa: Các logic write cụ thể theo từng nền tảng phải được đặt cô lập tại `src/scrapers/social/<platform>/actions.js` hoặc tích hợp qua `registerAction` của crawler tương ứng.

## Technical Decisions

- Kế thừa mô hình action registration từ `AbstractCrawler` và `scrape()` dispatcher: Tận dụng cơ chế chuẩn hóa command/envelope hiện có.
- Trình điều phối `UniversalActionDispatcher` (đặt tại `src/scrapers/social/dispatcher.js` hoặc `src/scrapers/social/actions/universal-dispatcher.js`) quản lý vòng đời dispatch song song (`Promise.allSettled`).
- Chuẩn hóa kết quả trả về: Tổng hợp dạng `{ success: boolean, results: Record<string, ActionResult>, errors: Record<string, ActionError> }`.
- Tách biệt tầng điều phối (Story 30.1) và tầng biến đổi nội dung/cắt thread (Story 30.2): Story 30.1 tập trung vào hạ tầng dispatch, validation credential, và các MCP tools; Story 30.2 sẽ cắm `ContentTransformer` vào trước bước dispatch post.

## Cross-Story Dependencies

- **Story 30.1 là nền tảng cho Story 30.2**: Story 30.2 (`ContentTransformer`) sẽ nhận input bài đăng đơn lẻ và chuyển đổi thành `TransformedPost[]` phù hợp từng nền tảng trước khi chuyển cho `UniversalActionDispatcher` (Story 30.1) thực thi.
- Phụ thuộc các client/crawler mạng xã hội đã hoàn thành: X/Twitter (`src/scrapers/social/twitter/`), Bluesky (`src/scrapers/social/bluesky/`), Mastodon (`src/scrapers/social/mastodon/`), Threads (`src/scrapers/social/threads/`).
