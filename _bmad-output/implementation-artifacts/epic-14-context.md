# Epic 14 Context: Deep Conversation Scraper, MCP Daemon & Nowing Event Stream

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Chuyển đổi nền tảng cào dữ liệu dùng chung thành bề mặt microservice đa kênh hiệu năng cao: khai thác hội thoại phân cấp sâu (cây bình luận đa tầng lồng nhau), nâng cấp MCP Server thành daemon HTTP/SSE thường trực (port 3001) phục vụ AI agent với độ trễ <2ms và tự động xuất dataset artifact khi kết quả lớn (>100 records), phát luồng sự kiện mỏng (thin event pointer) tức thì qua Redis Stream (`stream:social:raw_posts`) cho Nowing NLP workers, và tích hợp động cơ phân tích tần suất từ khóa/hashtag N-gram thời gian thực (`extractKeywordFrequency`) nhằm trích xuất ngay xu hướng buzzwords từ bài viết và bình luận vừa cào mà không cần chờ downstream NLP pipeline.

## Stories

- Story 14.1: Hierarchical Comment Tree Extraction with Topological Sort
- Story 14.2: MCP Tool Exporters & Daemon HTTP/SSE Server
- Story 14.3: Realtime Thin Event Redis Stream for Nowing AI Lead Hub
- Story 14.4: Real-Time N-Gram Keyword & Hashtag Frequency Analytics Engine

## Requirements & Constraints

- **Hierarchical Comment Tree (Story 14.1):**
  - Trích xuất cây bình luận đa tầng (`maxDepth: 3`, `maxComments: 500`), phân trang đệ quy theo cấp (BFS depth-by-depth).
  - Ngăn ngừa tham chiếu vòng (`parentCommentId !== id` và parent không nằm trong tổ tiên); deduplicate comment ID bằng Map/Set.
  - Lưu trữ theo thứ tự Topological Sort (RootComments `depth = 0` trước, rồi tăng dần theo `depth`) vào PostgreSQL qua `PrismaStore` theo batch 500 records (`skipDuplicates: true`) để triệt tiêu lỗi Foreign Key violation và Deadlock CSDL.
- **MCP HTTP/SSE Daemon & Tool Exporters (Story 14.2):**
  - Chạy MCP server thường trực dạng HTTP/SSE daemon trên cổng 3001 (`http://localhost:3001/mcp`), tái sử dụng HTTP transport trong `src/mcp/server.js`, không tạo tiến trình daemon riêng; duy trì endpoint `GET /health` trả về 200.
  - Đóng gói response trong 3-Layer JSON Envelope: `{ success, platform, meta, data, summary, error? }` với `data` preview tối đa 20–30 records, độ trễ < 2ms.
  - Tự động xuất artifact: Khi tổng số records > 100, tự động stream xuất file dataset JSONL/CSV (loại bỏ ký tự xuống dòng `\r\n|\r|\n` trong `content`) và trả về `meta.datasetArtifactPath` để AI agent đọc chọn lọc.
  - Action Discovery & Error Envelope: Tool `x_actions_list` và CLI `xactions actions list` trả về `ActionDescriptor[]`. Lỗi chuẩn hóa thành `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
  - Quản lý lifecycle qua CLI `xactions daemon start/status/stop`; map lệnh `unfollowx` cũ sang `CrawlerCommand` hoặc trả về error envelope với `suggestedAction: 'use_x_actions_list'`.
- **Realtime Thin Event Redis Stream (Story 14.3):**
  - Phát Thin Event Pointer vào Redis Stream `stream:social:raw_posts` ngay sau khi batch bài viết/bình luận được persist thành công vào PostgreSQL.
  - Payload tinh gọn: `{ id, platform, externalId, category, authorId, crawledAt, storageRef }` (kèm cờ `benchmark_health` nếu có), tuyệt đối không đưa raw JSON nặng vào Redis.
  - Giới hạn stream bằng `MAXLEN ~ 1,000,000` hoặc cơ chế `MINID` theo thời gian (kích hoạt qua `REDIS_STREAM_ENABLED=true`).
  - Giám sát qua `GET /metrics/stream`. Cảnh báo khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`. Backpressure: khi pending messages > 10,000, governor giảm 25% nhịp cào bulk (`throttle_reason: redis_lag`).
- **Real-Time N-Gram Keyword & Hashtag Analytics (Story 14.4):**
  - Hàm `extractKeywordFrequency(items, options)` phân tích tần suất Unigram, Bigram và Hashtag từ `PostItem[]` hoặc `CommentItem[]`.
  - Tokenize và lọc stopwords đa ngôn ngữ (load từ `src/analytics/stopwords/vi.txt` và `en.txt` vào `Set`; bỏ qua lọc nếu thiếu file ngôn ngữ). Tiếng Việt yêu cầu xử lý từ ghép (compound-aware segmenter hoặc fallback "bigram-of-syllables"); NFC-normalize và lowercase token trước khi đếm.
  - Ranh giới N-gram: Bigram chỉ tính trên token stream hợp lệ đã lọc; tuyệt đối không span qua stopword, dấu câu, hoặc ranh giới giữa các item/bình luận.
  - Chuẩn hóa Hashtag: Bỏ ký tự `#`, NFC-normalize, lowercase, lọc theo regex `#(?=[\p{L}])[\p{L}\p{N}_]+` (loại bỏ URL fragment và tag chỉ chứa số).
  - Return Shape: Trả về `{ unigrams: [{ term, count }], bigrams: [{ term, count }], hashtags: [{ tag, count }], totalTokens, lang }`, sắp xếp deterministic theo `count` giảm dần rồi `term` tăng dần.
  - Xử lý biên & Chi phí: `minLength` clamp `>= 1`; `topN = max(0, floor(topN ?? 10))`; items rỗng/null hoặc content không hợp lệ trả về zero-result thay vì throw. `includeBuzzwords` là opt-in (mặc định tắt) trong `AbstractCrawler`; khi bật phân tích tối đa 500 items đầu để chặn chi phí O(n), trả mảng rỗng nếu không có text.
  - Giao diện gọi: MCP tool `x_analytics_buzzwords` và CLI `xactions analytics buzzwords` nhận `{ items? | scrapeId? | source }` (từ file, stdin, hoặc scrape đã lưu).

## Technical Decisions

- **Comments Schema & Identity:** Comment sử dụng quan hệ tự tham chiếu `CommentReplies` trong Prisma (cascade delete, index `(postId, parentCommentId)`). ID namespaced chuẩn: Post là `${platform}:${externalId}`, Comment là `${platform}:${postExternalId}:${commentExternalId}`. Trường `depth` kiểu số nguyên dùng trực tiếp cho Topological insertion.
- **Topological Sorting in Persistence:** Module `CommentTreeExtractor` (`src/scrapers/social/comment-tree.js`) duyệt BFS và trả về danh sách sắp xếp theo `depth` tăng dần. Ghi vào CSDL qua `PrismaStore.storeCommentBatch` theo chunk 500 records kết hợp `skipDuplicates: true`.
- **MCP Daemon Microservice Architecture:** Chạy thường trực trên cổng `PORT` (mặc định 3001) qua `StreamableHTTPServerTransport` với giao thức SSE over HTTP Keep-Alive connection pool, bảo đảm latency < 2ms. Các tool dispatch qua `CrawlerCommand` và `ActionRegistry`.
- **3-Layer JSON Envelope & Auto-Artifact:** Mọi kết quả crawl từ MCP bọc trong 3-Layer Envelope (preview 20–30 records, metadata, summary). Khi dữ liệu > 100 bản ghi, hệ thống stream xuất file JSONL/CSV vào thư mục artifacts và trả `meta.datasetArtifactPath`.
- **Decoupled Durability & Thin Pointer Emission:** Ghi vào PostgreSQL và lưu `CrawlCheckpoint` trước khi gọi `XADD` vào Redis Stream. Thin event chỉ chứa pointer `storageRef`. Consumer `nowing_nlp_workers` xác nhận qua `XACK`.
- **Dual-Pool Resource Isolation:** Phân chia pool proxy (30% on-demand realtime MCP, 70% background bulk crawl) ngăn ngừa starvation cho các truy vấn tương tác tức thời.
- **In-Memory N-Gram Analytics Engine:** Module `src/analytics/word-frequency.js` vận hành độc lập không phụ thuộc thư viện NLP nặng. Stopwords nạp sẵn vào `Set` để tra cứu O(1). Bộ đệm n-gram được reset tại mỗi ranh giới dấu câu và ranh giới item.

## UX & Interaction Patterns

- **Agent Discovery & Execution:** AI agent dùng `x_actions_list` khám phá action và gọi `x_crawl_post`, `x_crawl_comments_tree` qua HTTP/SSE; kết quả lớn nhận `meta.datasetArtifactPath` để truy xuất artifact an toàn cho context window.
- **Actionable Error Feedback:** Lỗi luôn đi kèm typed `suggestedAction` (`RETRY_WITH_DIFFERENT_ACCOUNT`, `ROTATE_PROXY`, `HIBERNATE`, `USE_X_ACTIONS_LIST`) cho phép agent tự động phục hồi.
- **Daemon Lifecycle CLI:** Lệnh `xactions daemon start/status/stop` hiển thị trạng thái daemon, PID, port và endpoint URL.
- **Stream Observability & Alerts CLI:** Lệnh `xactions admin stream metrics` hiển thị số liệu thời gian thực (`pendingMessages`, `consumerLag`, `lastAckTime`). Lệnh `xactions admin stream alerts` hiển thị cảnh báo và hỗ trợ kích hoạt test alert.
- **Buzzwords CLI:** Lệnh `xactions analytics buzzwords --source <file|stdin|scrapeId> [--top 20] [--lang vi]` hiển thị bảng xếp hạng từ khóa và hashtag nổi bật trên terminal.

## Cross-Story Dependencies

- **Story 14.1 (Comment Tree):** Cung cấp `CommentItem[]` phân cấp cho Story 14.2 (tool `x_crawl_comments_tree`), Story 14.3 (thin event pointer cho comment), và Story 14.4 (phân tích buzzwords từ bình luận).
- **Story 14.2 (MCP Daemon):** Cung cấp giao thức HTTP/SSE runtime cho các AI agent gọi action từ Story 14.1 (`get_comments`) và Story 14.4 (tool `x_analytics_buzzwords`).
- **Story 14.3 (Redis Stream):** Phụ thuộc vào `PrismaStore` và `CrawlCheckpoint` để phát thin event sau khi batch ghi CSDL thành công; liên kết với `AdaptiveRateGovernor` để backpressure khi consumer lag.
- **Story 14.4 (N-Gram Buzzwords):** Tích hợp vào `AbstractCrawler` (`includeBuzzwords`) làm giàu `summary` crawl, đồng thời đăng ký MCP tool `x_analytics_buzzwords` trong Story 14.2 và CLI `xactions analytics buzzwords`.
- **Upstream Dependencies:** Phụ thuộc vào Epic 10 (domain models `PostItem`/`CommentItem`, `ActionRegistry`, `PlatformError`), Epic 11 (proxy pool, `AdaptiveRateGovernor`), và Epic 13 (crawlers Facebook/Twitter hybrid).
- **Downstream Consumers:** Phục vụ Epic 19 (Dashboard/CLI hiển thị stream metrics & daemon status), Epic 20 (Nowing cutover adapter), và các crawlers ở Epic 15–18.
