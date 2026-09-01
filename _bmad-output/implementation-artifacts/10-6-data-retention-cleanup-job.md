---
story_id: 10.6
story_key: 10-6-data-retention-cleanup-job
epic: 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces
status: in-progress
baseline_commit: d9363ea9b4a45051d9544db7e1f40ffb6f50536c
related_ads:
  - AD-10
  - AD-4
  - FR-87
---

# 10.6 — Data Retention Cleanup Job (Raw Crawl TTL 30 Ngày & Checkpoint Purge)

| | |
|---|---|
| **Story ID** | 10.6 |
| **Story Key** | `10-6-data-retention-cleanup-job` |
| **Epic** | 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces |
| **Status** | in-progress |
| **Author** | nich (@nichxbt) |
| **Related ADs & FRs** | AD-10 (3-Tier Incremental Gap-Filling & Retention Policy), AD-4 (Namespaced Storage & Indexes), FR-87 (Data Retention Policy) |

---

## User Story

**As a** Data Platform Engineer / System Operator,  
**I want** một background retention cleanup service tự động cùng các trigger CLI/API để dọn dẹp dữ liệu raw crawl (`Post` và `Comment`) đã quá hạn 30 ngày và các checkpoint hoàn tất quá 90 ngày theo từng batch an toàn,  
**So that** dung lượng PostgreSQL luôn được tối ưu, query scan duy trì tốc độ cao, ngăn ngừa phình to ổ đĩa và tuân thủ chặt chẽ chính sách lưu trữ dữ liệu (AD-10 / FR-87) mà không gây khóa bảng (table lock) hay ảnh hưởng đến pipeline cào dữ liệu thời gian thực.

---

## Business & Architecture Context

- **Bối cảnh kiến trúc (AD-10 & FR-87):** XActions đóng vai trò là Universal Scraping Microservice cho hệ sinh thái Nowing và các AI Agents. Dữ liệu thô (raw crawl posts và comments) thu thập về `Post` và `Comment` có vòng đời hữu hạn (TTL = 30 ngày). Nowing chịu trách nhiệm trích xuất và lưu trữ vĩnh viễn các Enriched Leads, Verified Contacts, và Vector Embeddings. XActions chỉ đóng vai trò data lake đệm tạm thời.
- **Vấn đề hiện tại:** Sau khi triển khai Story 10.2 (`Post`, `Comment`, `CrawlCheckpoint` schema), các bảng này đã có cột `crawledAt DateTime @default(now())` cùng các index `@@index([crawledAt])`, nhưng hệ thống chưa có background job, cron worker hay API/CLI nào định kỳ quét và xóa dữ liệu `crawledAt < NOW() - 30 days`. Nếu không có cơ chế dọn dẹp, database sẽ nhanh chóng phình to hàng chục triệu bản ghi, gây suy giảm hiệu năng query và tốn chi phí hạ tầng.
- **Giải pháp:**
  1. Xây dựng module lõi `RetentionCleaner` trong `src/store/retention-cleaner.js` hỗ trợ purge dữ liệu theo chunk/batch (ví dụ 1,000 bản ghi/lô), có delay giữa các batch để giải phóng lock và CPU.
  2. Quản lý dọn dẹp an toàn cho mối quan hệ `Post` ↔ `Comment`: Dù `Comment.postId` có `onDelete: Cascade`, việc xóa lượng lớn `Post` cùng lúc có thể gây cascade lock và deadlock. Module sẽ hỗ trợ cơ chế xóa chunked `Comment` trước hoặc xóa `Post` theo ID chunked có giới hạn transaction nhỏ.
  3. Dọn dẹp `CrawlCheckpoint` đã kết thúc (`completed` hoặc `failed` có `errorCount >= threshold`) sau 90 ngày (`DATA_RETENTION_DAYS_CHECKPOINT=90`), giữ nguyên các checkpoint đang hoạt động (`running`, `paused`).
  4. Hỗ trợ chế độ `--dry-run` để ước tính số lượng bản ghi hết hạn mà không thực hiện thao tác xóa vật lý.
  5. Tích hợp background cron job trong `api/services/retentionScheduler.js` (hoặc khởi chạy trong `api/server.js`), đồng thời cung cấp REST API endpoint `/api/admin/retention/cleanup` và CLI command `xactions retention run`.

---

## Acceptance Criteria

### AC1 — Core Retention Cleaner Service (`src/store/retention-cleaner.js`)
- **Given** cơ sở dữ liệu PostgreSQL chứa các bản ghi trong bảng `Post` và `Comment`
- **When** gọi `RetentionCleaner.cleanRawCrawlData(options)` với các options:
  - `retentionDays` (mặc định: `30`, hoặc lấy từ env `DATA_RETENTION_DAYS_RAW`)
  - `batchSize` (mặc định: `1000`, max `5000`)
  - `batchDelayMs` (mặc định: `50ms`, khoảng nghỉ giữa các batch)
  - `dryRun` (boolean, mặc định: `false`)
  - `platform` (optional, filter theo nền tảng cụ thể nếu muốn dọn dẹp cục bộ)
  - `cutoffDate` (optional Date, mặc định: `new Date(Date.now() - retentionDays * 86400000)`)
- **Then** service xác định chính xác mốc thời gian `cutoffDate`
- **And** ở chế độ `dryRun: true`:
  - Trả về số lượng `postsEligible` và `commentsEligible` mà không chạy bất kỳ câu lệnh `DELETE` nào.
- **And** ở chế độ `dryRun: false`:
  - Thực hiện xóa tuần tự theo từng batch không vượt quá `batchSize` cho đến khi không còn bản ghi nào có `crawledAt < cutoffDate`.
  - Trả về kết quả tổng hợp: `{ success: true, postsDeleted: number, commentsDeleted: number, batchesExecuted: number, durationMs: number, cutoffDate: string, dryRun: false }`.

### AC2 — Safe Batch Deletion & Foreign Key / Lock Prevention
- **Given** bảng `Post` có hàng chục nghìn bài viết cũ và bảng `Comment` có hàng trăm nghìn bình luận tương ứng
- **When** `RetentionCleaner` thực thi dọn dẹp
- **Then** hệ thống **không** gọi một lệnh `deleteMany` đơn lẻ trên toàn bộ tập dữ liệu (tránh Table-level lock, Replication lag và Connection timeout)
- **And** áp dụng chiến lược xóa ID-based chunking:
  1. Query lấy danh sách `id` của batch `Post` cũ (`select id from "Post" where "crawledAt" < cutoffDate limit batchSize`).
  2. Nếu danh sách rỗng, kết thúc vòng lặp.
  3. Xóa các `Comment` liên quan đến batch ID đó trước (hoặc dựa vào Prisma transaction xóa theo mảng IDs đã giới hạn), sau đó xóa batch `Post` theo `where: { id: { in: batchIds } }`.
  4. Chờ `batchDelayMs` trước khi thực hiện batch tiếp theo để hệ thống cơ sở dữ liệu xử lý I/O và GC (PostgreSQL VACUUM).
- **And** nếu xảy ra lỗi giữa chừng trong một batch, log lỗi chi tiết, không làm crash tiến trình chính và trả về trạng thái partial success cùng số lượng đã xóa trước đó.

### AC3 — Checkpoint Lifecycle & Audit Purge
- **Given** bảng `CrawlCheckpoint` chứa các checkpoint từ các tác vụ cào cũ
- **When** gọi `RetentionCleaner.cleanCheckpoints(options)` với:
  - `checkpointRetentionDays` (mặc định: `90`, hoặc lấy từ env `DATA_RETENTION_DAYS_CHECKPOINT`)
  - `statuses` (mặc định: `['completed', 'failed']`)
  - `dryRun` (boolean)
- **Then** service chỉ xóa các checkpoint thỏa mãn đồng thời:
  - `status` nằm trong danh sách `statuses` (mặc định `completed` hoặc `failed`).
  - `updatedAt < NOW() - checkpointRetentionDays`.
- **And** tuyệt đối **không** xóa các checkpoint có trạng thái `running`, `paused`, hoặc `stalled` (đảm bảo không làm mất state cào gap-filling đang active).

### AC4 — Automated Daily Scheduler (`api/services/retentionScheduler.js`)
- **Given** API server khởi chạy trong môi trường production hoặc development có cấu hình `ENABLE_RETENTION_SCHEDULER=true` (mặc định: `true`)
- **When** server khởi động (`api/server.js`)
- **Then** `startRetentionScheduler(options)` được đăng ký qua `node-cron` chạy định kỳ hàng ngày (mặc định: `0 3 * * *` — 03:00 AM UTC, hoặc theo env `RETENTION_CRON_SCHEDULE`)
- **And** có cờ `isProcessing` ngăn chặn việc chạy chồng lấn (overlapping runs) nếu lần chạy trước chưa hoàn thành
- **And** cung cấp hàm `stopRetentionScheduler()` để dừng cron gracefully khi nhận tín hiệu shutdown (`SIGTERM`/`SIGINT`).
- **And** ghi log chuẩn định dạng: `[RetentionScheduler] Starting daily cleanup...`, thống kê số bản ghi đã dọn và thời gian thực thi.

### AC5 — REST API Endpoint (`POST /api/admin/retention/cleanup` & `GET /api/admin/retention/stats`)
- **Given** Express API server đang chạy
- **When** gửi request tới:
  - `POST /api/admin/retention/cleanup`: Trigger dọn dẹp thủ công hoặc dry-run với body `{ retentionDays?, batchSize?, dryRun?, cleanCheckpoints? }`.
  - `GET /api/admin/retention/stats`: Lấy thống kê dung lượng và số lượng bản ghi cũ sắp tới hạn bị dọn dẹp theo các ngưỡng 7, 14, 30, 90 ngày.
- **Then** endpoint yêu cầu xác thực Admin (hoặc secret API key / middleware `adminAuth`)
- **And** trả về mã HTTP `200` kèm kết quả JSON chuẩn:
  ```json
  {
    "success": true,
    "data": {
      "postsDeleted": 1250,
      "commentsDeleted": 4320,
      "checkpointsDeleted": 15,
      "batchesExecuted": 2,
      "durationMs": 420,
      "cutoffDate": "2026-08-02T03:00:00.000Z",
      "dryRun": false
    }
  }
  ```
- **And** nếu người dùng không có quyền admin, trả về `403 Forbidden` hoặc `401 Unauthorized`.

### AC6 — CLI Operational Command (`xactions retention run` & `xactions retention status`)
- **Given** công cụ dòng lệnh `unfollowx` / `xactions` CLI
- **When** chạy các lệnh CLI:
  - `xactions retention run [--days <n>] [--batch-size <n>] [--dry-run] [--include-checkpoints]`: Thực thi dọn dẹp trực tiếp từ terminal.
  - `xactions retention status`: Hiển thị bảng tóm tắt số lượng bản ghi `Post`, `Comment`, `CrawlCheckpoint` quá hạn 30 ngày / 90 ngày.
- **Then** CLI in ra kết quả trực quan, hiển thị tiến độ từng batch hoặc kết quả dry-run rõ ràng, exit code `0` khi thành công và non-zero khi thất bại.

### AC7 — Zero Regression & Unit / Integration Test Coverage
- **Given** bộ test suite của XActions
- **When** chạy `npm run test` hoặc `vitest run tests/store/retention-cleaner.test.js`
- **Then** tất cả các test cases pass 100%:
  - Test xóa `Post` và `Comment` cũ đúng mốc thời gian `crawledAt`.
  - Test giữ nguyên các bài viết và bình luận mới hơn `cutoffDate`.
  - Test cơ chế batch chunking nhiều vòng lặp.
  - Test `dryRun` không làm thay đổi DB.
  - Test dọn `CrawlCheckpoint` đúng status và ngày.
  - Test Scheduler khởi động, chạy đúng interval và dừng an toàn.

---

## Tasks / Subtasks Checklist

- [x] **Task 1: Core Retention Cleaner Service (`src/store/retention-cleaner.js`)**
  - [x] 1.1 Khởi tạo class/module `RetentionCleaner` kế thừa hoặc tương thích với `PrismaStore` / singleton `prisma`.
  - [x] 1.2 Triển khai hàm `cleanRawCrawlData({ retentionDays, batchSize, batchDelayMs, dryRun, platform, cutoffDate, prisma })`.
  - [x] 1.3 Triển khai hàm `cleanCheckpoints({ checkpointRetentionDays, statuses, dryRun, prisma })`.
  - [x] 1.4 Triển khai hàm `getRetentionStats({ rawDays, checkpointDays, prisma })` thống kê số bản ghi sắp hết hạn.
  - [x] 1.5 Xây dựng thuật toán xóa an toàn: fetch IDs batch ➔ xóa Comment batch ➔ xóa Post batch ➔ sleep `batchDelayMs` ➔ lặp lại.
  - [x] 1.6 Export module trong `src/store/index.js`.

- [x] **Task 2: Retention Background Scheduler Service (`api/services/retentionScheduler.js`)**
  - [x] 2.1 Tạo `api/services/retentionScheduler.js` sử dụng `node-cron`.
  - [x] 2.2 Đặt lịch mặc định `0 3 * * *` (3:00 AM hàng ngày), hỗ trợ cấu hình qua env `RETENTION_CRON_SCHEDULE` và `ENABLE_RETENTION_SCHEDULER`.
  - [x] 2.3 Quản lý cờ `isProcessing` tránh race condition khi task trước kéo dài.
  - [x] 2.4 Cung cấp `startRetentionScheduler(io)` và `stopRetentionScheduler()`.
  - [x] 2.5 Hook vào `api/server.js` trong khối khởi động server cùng các scheduler hiện có (`startScheduler`, `startTweetScheduler`, v.v.).

- [x] **Task 3: REST API Admin Endpoints (`api/routes/admin.js` hoặc `api/routes/retention.js`)**
  - [x] 3.1 Thêm route `POST /api/admin/retention/cleanup` nhận parameters `retentionDays`, `batchSize`, `dryRun`, `cleanCheckpoints`.
  - [x] 3.2 Thêm route `GET /api/admin/retention/stats` trả về số lượng bản ghi thỏa mãn điều kiện cleanup.
  - [x] 3.3 Áp dụng middleware kiểm tra quyền `isAdmin` hoặc API key hợp lệ.
  - [x] 3.4 Bọc response bằng chuẩn PlatformError / ErrorEnvelope nếu có exception.

- [x] **Task 4: CLI Command Extension (`src/cli/commands/retention.js` & `src/cli/index.js`)**
  - [x] 4.1 Tạo file `src/cli/commands/retention.js` với Commander.js.
  - [x] 4.2 Định nghĩa subcommand `xactions retention run [options]` với `--days`, `--batch-size`, `--dry-run`, `--checkpoints`.
  - [x] 4.3 Định nghĩa subcommand `xactions retention status` hiển thị bảng dữ liệu.
  - [x] 4.4 Đăng ký subcommand vào `src/cli/index.js`.

- [x] **Task 5: Unit & Integration Tests (`tests/store/retention-cleaner.test.js` & `tests/api/retention-routes.test.js`)**
  - [x] 5.1 Viết unit tests cho `RetentionCleaner` (mock Prisma hoặc in-memory / real test db instance):
    - Test tính toán đúng `cutoffDate`.
    - Test xóa đúng batch posts và comments cũ.
    - Test `dryRun: true` không làm xóa dữ liệu.
    - Test `cleanCheckpoints` không xóa checkpoint `running`/`paused`.
    - Test xử lý lỗi DB graceful.
  - [x] 5.2 Viết integration tests cho API routes (`POST /api/admin/retention/cleanup` và `GET /api/admin/retention/stats`).
  - [x] 5.3 Viết tests cho `retentionScheduler.js` (start / stop / tick simulation).

---

## Dev Notes & Technical Guardrails

### 1. Phân Tích Hiện Trạng Codebase (Current State)
- **Model `Post` (`prisma/schema.prisma` lines 328-359):**
  - `id`: `${platform}:${externalId}`
  - `crawledAt`: `DateTime @default(now())`
  - Đã có index: `@@index([crawledAt])`, `@@index([platform, crawledAt(sort: Desc)])`, `@@index([category, crawledAt(sort: Desc)])`.
- **Model `Comment` (`prisma/schema.prisma` lines 361-387):**
  - `id`: `${platform}:${postExternalId}:${commentExternalId}`
  - `crawledAt`: `DateTime @default(now())`
  - `post`: `Post @relation(fields: [postId], references: [id], onDelete: Cascade)`
  - Đã có index: `@@index([crawledAt])`, `@@index([postId, parentCommentId])`.
- **Model `CrawlCheckpoint` (`prisma/schema.prisma` lines 389-407):**
  - `status`: `'running' | 'paused' | 'failed' | 'completed' | 'stalled'`
  - `updatedAt`: `DateTime @updatedAt`
  - `@@index([status, nextScheduledAt])`.
- **Scheduler hiện tại trong repo:**
  - `api/services/unfollowerScheduler.js`: Dùng `setInterval` polling mỗi 60s.
  - `api/services/tweetScheduler.js`: Dùng `node-cron` tick 1 phút.
  - `api/services/facebookScheduler.js`: Dùng `node-cron`.
  - `node-cron` đã có sẵn trong `node_modules` và `package.json`.

### 2. So Sánh Chiến Lược: PostgreSQL Table Partitioning vs Batch Background Deletion
- **Table Partitioning (Range by `crawledAt`):**
  - *Ưu điểm:* Xóa partition cũ bằng `DROP TABLE` cực nhanh (O(1)), zero IO overhead.
  - *Nhược điểm:* Prisma ORM 5.x không hỗ trợ Declarative Table Partitioning out-of-the-box. Foreign key relations (`Comment.postId -> Post.id`) trên partitioned tables trong Postgres đòi hỏi partition key phải nằm trong mọi Unique/Foreign Key constraints. Điều này làm vỡ format `${platform}:${externalId}` hiện tại và yêu cầu migration DDL rất phức tạp.
- **Batch Background Deletion (Được chọn theo AD-10):**
  - *Ưu điểm:* 100% tương thích với Prisma schema hiện tại, tận dụng index `crawledAt` sẵn có, dễ cấu hình thời gian chạy ban đêm (3:00 AM), có thể điều chỉnh linh hoạt batch size và delay.
  - *Kỹ thuật chống Table Lock:*
    ```javascript
    // Pseudo-code batch deletion
    while (true) {
      const expiredPosts = await prisma.post.findMany({
        where: { crawledAt: { lt: cutoffDate } },
        select: { id: true },
        take: batchSize,
      });
      if (expiredPosts.length === 0) break;
      const postIds = expiredPosts.map(p => p.id);

      // Xóa comments trước để tránh trigger cascade lock lớn trên Post
      await prisma.comment.deleteMany({
        where: { postId: { in: postIds } },
      });

      // Xóa posts
      await prisma.post.deleteMany({
        where: { id: { in: postIds } },
      });

      batchesExecuted++;
      postsDeleted += postIds.length;
      if (batchDelayMs > 0) {
        await new Promise(r => setTimeout(r, batchDelayMs));
      }
    }
    ```

### 3. Cấu Hình Environment Variables Mặc Định
| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `DATA_RETENTION_DAYS_RAW` | `30` | Số ngày lưu trữ tối đa cho `Post` và `Comment` |
| `DATA_RETENTION_DAYS_CHECKPOINT` | `90` | Số ngày lưu trữ tối đa cho checkpoint đã `completed`/`failed` |
| `DATA_RETENTION_BATCH_SIZE` | `1000` | Số lượng bản ghi xử lý trong mỗi batch deletion |
| `DATA_RETENTION_BATCH_DELAY_MS` | `50` | Thời gian nghỉ (ms) giữa các batch |
| `ENABLE_RETENTION_SCHEDULER` | `true` | Bật/tắt tự động chạy retention cron job |
| `RETENTION_CRON_SCHEDULE` | `0 3 * * *` | Biểu thức cron chạy dọn dẹp hàng ngày (03:00 AM UTC) |

### 4. Files Cần Tạo Mới & Chỉnh Sửa
- **Files tạo mới:**
  - `src/store/retention-cleaner.js` (Core retention engine)
  - `api/services/retentionScheduler.js` (Cron scheduler)
  - `src/cli/commands/retention.js` (CLI command definition)
  - `tests/store/retention-cleaner.test.js` (Unit & Integration tests)
- **Files cần chỉnh sửa:**
  - `src/store/index.js` (Re-export `RetentionCleaner`)
  - `api/server.js` (Import và start `startRetentionScheduler`)
  - `api/routes/admin.js` (Mount endpoints `/retention/cleanup` và `/retention/stats`)
  - `src/cli/index.js` (Đăng ký command `retention`)

---

## Dev Agent Record

### Implementation Plan
1. [x] **Step 1:** Tạo `src/store/retention-cleaner.js` thực hiện core logic dọn dẹp `Post`, `Comment` và `CrawlCheckpoint` theo batch có delay và dryRun.
2. [x] **Step 2:** Cập nhật `src/store/index.js` để export module.
3. [x] **Step 3:** Tạo `api/services/retentionScheduler.js` bọc cron job với cờ `isProcessing` và graceful shutdown.
4. [x] **Step 4:** Cập nhật `api/server.js` để gọi `startRetentionScheduler()` khi server listen.
5. [x] **Step 5:** Thêm admin routes vào `api/routes/admin.js`.
6. [x] **Step 6:** Thêm CLI command vào `src/cli/commands/retention.js` và nối vào `src/cli/index.js`.
7. [x] **Step 7:** Viết bộ test đầy đủ trong `tests/store/retention-cleaner.test.js` và xác minh toàn bộ test pass.

### Debug Log
- Đã kiểm tra PostgreSQL test database, các câu lệnh raw SQL và Prisma queries hoạt động trơn tru.
- Đã xác thực cơ chế batch chunking với Post và Comment, đảm bảo xóa comments theo batch post IDs trước để tránh cascading locks.
- Đã bảo vệ các status checkpoints (`running`, `paused`, `stalled`) không bao giờ bị xóa.

### Completion Notes
- Đã tạo hoàn thiện toàn bộ các file theo spec:
  - `src/store/retention-cleaner.js`: RetentionCleaner module với `cleanRawCrawlData`, `cleanCheckpoints`, `getRetentionStats`, `runRetentionPipeline`.
  - `api/services/retentionScheduler.js`: Daily cron service với cờ mutex `isProcessing` và graceful start/stop.
  - `src/cli/commands/retention.js`: CLI subcommands `xactions retention run` và `xactions retention status`.
  - `tests/store/retention-cleaner.test.js`: 10 integration test cases pass 100%.
  - `src/store/index.js`, `api/server.js`, `api/routes/admin.js`, `src/cli/index.js` đã được tích hợp đầy đủ.

---

## File List

- `src/store/retention-cleaner.js` (NEW)
- `api/services/retentionScheduler.js` (NEW)
- `src/cli/commands/retention.js` (NEW)
- `tests/store/retention-cleaner.test.js` (NEW)
- `src/store/index.js` (UPDATE)
- `api/server.js` (UPDATE)
- `api/routes/admin.js` (UPDATE)
- `src/cli/index.js` (UPDATE)

---

## Change Log

- **2026-09-01:** Khởi tạo story `10-6-data-retention-cleanup-job` backfill AD-10 / Story 10.2 cho Data Retention Lifecycle (raw data 30 ngày, checkpoints 90 ngày).
- **2026-09-01 (post code review):** Fix `PlatformError` constructor signature; thêm `SUPPORTED_PLATFORMS` validation; sửa orphan comment logic không dùng `post: { is: null }`; đổi checkpoint cutoff sang `lastCrawledAt` với fallback `updatedAt`; thêm `acquireRetentionLock` / `runGuardedRetention` để admin API, scheduler và CLI chia sẻ mutex chống overlapping runs; thêm graceful shutdown trong `api/server.js`; thêm `tests/api/admin-retention.test.js` và `tests/cli/retention.test.js`; tất cả 30 test cases pass.
