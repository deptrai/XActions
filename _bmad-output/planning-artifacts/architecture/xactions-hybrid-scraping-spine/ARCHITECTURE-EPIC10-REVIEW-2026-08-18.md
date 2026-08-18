# Epic 10 Architecture Review — Core Contracts, Storage & Prisma

**Persona:** Amelia / Senior Software Engineer  
**Scope:** `ARCHITECTURE-SPINE.md` AD-1 → AD-14, `epics.md` Epic 10 (Stories 10.0–10.3), `src/core/**`, `src/proxy/**`, `src/store/**`, `prisma/schema.prisma`, `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql`.  
**Date:** 2026-08-18  
**Verdict:** 🟡 **Cơ sở Epic 10 đã đúng hướng, nhưng có 5 P0 rủi ro triển khai và 7 P1 cần làm rõ trước khi merge Story 10.2/10.3.**

---

## 1. Executive Summary

Story 10.0 (blocker prep) đã hoàn thành: `src/core/`, `src/proxy/`, `src/store/` được scaffold, Prisma schema hợp lệ, MCP daemon chạy được, các stub parse đúng. Tuy nhiên, **một số ràng buộc quan trọng trong AD-4, AD-11, AD-12, AD-14 và AC của Story 10.1/10.2 chưa được đồng bộ hóa giữa kiến trúc, epic, và code**. Nếu không sửa, Story 10.2 sẽ fail khi thực thi batch comment insertion và Story 10.3 sẽ thiếu API checkpoint/schema.

---

## 2. P0 Issues — Must Fix Before Story 10.2

### P0.1 — `PlatformError` shape mismatch between Spine AD-14 and Story 10.1 AC
* **Spine AD-14 Rule 1:** Error envelope là `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }`.
* **Story 10.1 AC:** Yêu cầu `{ statusCode, platform, isRetryable, retryAfterMs, suggestedAction }`.
* **Code (`src/core/error-envelope.js`):** Đang dùng `{ code, type, message, retryAfter, suggestedAction, accountId, platform }` với `retryAfter` là số (giả định ms hoặc s).
* **Hệ quả:** Consumer Nowing phân tích lỗi dựa trên spine sẽ khác với code. `retryAfter` không rõ đơn vị; `statusCode` và `isRetryable` bị thiếu.
* **Đề xuất:**
  - Quyết định một shape duy nhất theo AD-14.
  - Thêm `statusCode` (HTTP status tương ứng) và `isRetryable` (boolean) vào `PlatformError`.
  - Đổi `retryAfter` thành `retryAfterMs` rõ ràng (ms), hoặc ghi chú đơn vị.
  - Update `Story 10.1 AC` để match `error-envelope.js`.

### P0.2 — `Comment.id` format và `@@unique` rủi ro collision
* **Spine AD-4 Rule 1:** `Comment.id = "${platform}:${postExternalId}:${commentExternalId}"`.
* **Code/Schema:** `Comment` có `@id` là `String` tùy ý, `@@unique([platform, externalId, postId])`.
* **Hệ quả:** Nếu `id` không được generate đúng format, các lookup theo `parentCommentId` có thể trỏ đến `Comment.id` sai nền tảng. `postExternalId` có thể trùng với `postId` gây lặp.
* **Đề xuất:**
  - Thêm helper `generateCommentId({ platform, postExternalId, commentExternalId })` trong `src/core/types.js` hoặc `src/core/base-crawler.js`.
  - Hoặc giản lược `Comment.id = "${platform}:${externalId}"` (khuyến nghị) vì `@@unique([platform, externalId, postId])` đã đảm bảo uniqueness. AD-4 nên được cập nhật.

### P0.3 — `PrismaStore.storeCommentBatch` sử dụng `createMany` với self-referencing FK
* **Spine AD-6 Rule 1:** Bắt buộc topological sort root → sub-comment theo `depth`.
* **Code (`src/store/prisma-store.js` lines 73–84):** Sắp xếp theo `depth` rồi gọi `comment.createMany({ data: chunk, skipDuplicates: true })`.
* **Hệ quả:** PostgreSQL `createMany` không đảm bảo insert tuần tự và không bypass FK constraint. Nếu `parentCommentId` trỏ đến một row trong cùng batch chưa insert, transaction sẽ fail với `Foreign Key Violation`.
* **Đề xuất:**
  - Trong `storeCommentBatch`, insert theo từng `depth` level, mỗi level dùng một `createMany` riêng (hoặc `create` tuần tự nếu số lượng nhỏ).
  - Hoặc tạm thời insert root comments trước, đợi xong mới insert depth 1, depth 2, v.v.
  - Đảm bảo `parentCommentId` của sub-comment trỏ đến `Comment.id` đã tồn tại trong DB hoặc trong cùng `depth - 1` batch.

### P0.4 — `CrawlCheckpoint` thiếu các trường trạng thái theo AD-16
* **Spine AD-16 Rule 3:** Status values `running`, `paused`, `failed`, `completed`, `stalled`; fields `lastCrawledAt`, `lastCursor`, `lastTimestamp`, `nextScheduledAt`, `errorCount`.
* **Schema (`prisma/schema.prisma` lines 389–399):** Chỉ có `lastCursor`, `lastTimestamp`, `createdAt`, `updatedAt`.
* **Hệ quả:** Không thể implement checkpoint resume/pause/retry UI/API.
* **Đề xuất:** Thêm `status String @default("running")`, `errorCount Int @default(0)`, `nextScheduledAt DateTime?`, `lastCrawledAt DateTime?` vào `CrawlCheckpoint`.

### P0.5 — Story 10.2 AC gộp quá nhiều deliverables không liên quan
* **Story 10.2 AC** yêu cầu cả `PrismaStore`, `CheckpointApi` (GET/POST /checkpoints, CLI), và `MetadataSchemaRegistry` (JSON Schema publish + API).
* **Hệ quả:** Story 10.2 trở thành "fat story", khó review, khó test, liên quan đến AD-12, AD-16, AD-18 cùng lúc.
* **Đề xuất:** Tách thành 3 story riêng:
  - 10.2a: Prisma `Post`/`Comment` schema + `PrismaStore`.
  - 10.2b: `CrawlCheckpoint` schema + `CheckpointApi` (di chuyển sang Epic 12 hoặc giữ Epic 10).
  - 10.2c: `MetadataSchemaRegistry` (thuộc AD-18, có thể tách thành Epic 18).

---

## 3. P1 Issues — Address in Story 10.1 or 10.2

### P1.1 — Missing `src/core/signer-pool.js` and `src/utils/qrcode.js`
* **Spine AD-1 binds** `src/core/signer-pool.js` (Pre-Signed Token Ring + Signer Worker Page Pool). **AD-5 binds** `src/utils/qrcode.js`.
* **Hệ quả:** Chưa có contract cho Tiered Hybrid Signer, QR login chỉ có `qrcode-terminal` dependency.
* **Đề xuất:** Tạo stub `src/core/signer-pool.js` (hoặc tách `token-ring.js` + `signer-page-pool.js`) và `src/utils/qrcode.js` trước Epic 11/15.

### P1.2 — `ActionRegistry` trùng chức năng với `AbstractCrawler.#registry`
* **Code:** `src/core/action-registry.js` là global registry; `src/core/base-crawler.js` có private registry riêng.
* **Hệ quả:** Hai registry có thể drift. Global registry không tự động cập nhật khi `AbstractCrawler.registerAction()` được gọi.
* **Đề xuất:** Trong `AbstractCrawler.registerAction()`, gọi `globalActionRegistry.registerPlatformActions(this.name, [descriptor])` để đồng bộ. Hoặc loại bỏ per-crawler map và dùng `ActionRegistry` từ `src/core/action-registry.js`.

### P1.3 — `AdaptiveRateGovernor` chưa đọc `accountVelocity` và chưa tích hợp `ProxyIpPool`
* **Spine AD-13 Rule 1:** Governor đọc `accountVelocity` (req/min per account). Rule 2: `maxReqPerSecond` dựa trên `healthyProxyCount`.
* **Code (`src/core/adaptive-governor.js`):** Chỉ đọc `healthyProxyCount`, `totalProxyCount`, `redisConsumerLag`. `getMaxThroughput` nhận state qua `updateState()` chứ không tích hợp `ProxyIpPool` trực tiếp.
* **Hệ quả:** Governor không biết tốc độ thực tế từng account, không lấy tự động từ pool.
* **Đề xuất:** Thêm `accountVelocity` Map vào `AdaptiveRateGovernor`, cho phép cập nhật từ `ProxyIpPool` qua sự kiện hoặc polling.

### P1.4 — `StatusApi` chỉ là stub, chưa có `GET /governor/status`
* **Spine AD-14 Rule 3:** Governor Status API trả về shape đầy đủ qua `GET /governor/status` và CLI `xactions status`.
* **Code:** `src/core/status-api.js` chỉ trả về default object; chưa kết nối `AdaptiveRateGovernor`.
* **Đề xuất:** Truyền `AdaptiveRateGovernor` instance vào `StatusApi` và expose qua `api/routes/` hoặc `src/mcp/server.js` tool.

### P1.5 — `Post.category` dùng `String` mở, dễ typo
* **Spine AD-4:** `category` là `String`.
* **Hệ quả:** Giá trị `'social'`, `'ecom'`, `'realestate'`, `'recruitment'`, `'b2b'` không được validate ở DB.
* **Đề xuất:** Thêm Prisma `enum Category { social ecom realestate recruitment b2b }` hoặc validation ở `AbstractCrawler` trước khi gọi store.

### P1.6 — `PrismaStore` không upsert, chỉ `createMany + skipDuplicates`
* **Story 10.2 AC:** "thực hiện upsert bài viết và bình luận theo batch chunk 500; mặc định dùng `createMany` + `skipDuplicates`, benchmark trước khi dùng 500 upsert".
* **Code:** Dùng `createMany` + `skipDuplicates`; nếu post đã tồn tại và metrics thay đổi (likesCount tăng), dữ liệu không được cập nhật.
* **Đề xuả n:** Cân nhắc `upsert` hoặc `updateMany` cho các trường hợp delta metrics. Hoặc update AC để rõ: `createMany + skipDuplicates` là default cho new insert, `upsert` là tùy chọn sau benchmark.

### P1.7 — `Comment` relation `parentComment` với `onDelete: Cascade` có thể xóa nhầm cây con
* **Schema:** `parentComment Comment? @relation("CommentReplies", fields: [parentCommentId], references: [id], onDelete: Cascade)`.
* **Hệ quả:** Xóa một root comment sẽ cascade xóa toàn bộ sub-replies. Điều này có thể mong muốn, nhưng nếu Nowing lưu leads từ comment thì cascade delete gây mất dữ liệu.
* **Đề xuất:** Cân nhắc `onDelete: SetNull` cho `parentCommentId` hoặc giữ `Cascade` nhưng ghi rõ trong AD-6/AD-4.

---

## 4. P2 / Clarifications

### P2.1 — `AbstractCrawler` `search()`, `getPostDetail()`, `getComments()` vừa là abstract method vừa là action
* **Code:** Các phương thức này throw `Method not implemented`, nhưng `registerAction()` cho phép đăng ký bất kỳ hàm nào.
* **Đề xuất:** Trong constructor tự động `registerAction('search', this.search)` nếu subclass override. Hoặc loại bỏ các abstract method và chỉ dùng action registry để giảm bớt boilerplate.

### P2.2 — `AbstractApiClient` chưa sử dụng `got-scraping`
* **Code:** `base-client.js` chỉ là stub, chưa import `got-scraping`.
* **Đề xuất:** Story 10.2 hoặc 11.1 sẽ implement. Không vội nhưng cần nhắc trong plan.

### P2.3 — `AbstractLogin` chưa hỗ trợ QR/CDP/cookie
* **Code:** `base-login.js` là stub.
* **Đề xuất:** Epic 15 sẽ implement. Không cần sửa ngay.

### P2.4 — Data retention 30 ngày chưa có trong schema
* **Spine AD-10 Rule 2:** Dữ liệu thô `Post`/`Comment` lưu 30 ngày.
* **Hiện tại:** Không có partition/index `crawledAt` cho cleanup.
* **Đề xuất:** Thêm index `@@index([crawledAt])` để cleanup job chạy nhanh; cân nhắc partition by range khi production.

---

## 5. What Looks Good

* **Scaffold structure:** `src/core/`, `src/proxy/`, `src/store/` đúng vị trí, ESM, JSDoc đầy đủ.
* **Namespaced `Post.id` + `@@unique([platform, externalId])`:** Đúng AD-4.
* **`Comment.depth`:** Đúng AD-6.
* **GIN/Expression migration:** Đúng AD-4 Rule 3.
* **MCP daemon script:** `mcp:daemon` đúng AD-7.
* **Error type/suggested action constants:** Đúng AD-14.
* **Topological sort intent:** `storeCommentBatch` đã có sort by depth.

---

## 6. Recommendations

1. **Tổ chức Epic 10 lại:** Tách Story 10.2 thành 2–3 story nhỏ hơn (schema/store, checkpoint API, metadata schema registry).
2. **Sửa `PlatformError` shape:** Thêm `statusCode`, `isRetryable`, `retryAfterMs` (hoặc làm rõ `retryAfter`), đồng bộ với AD-14 và Story 10.1 AC.
3. **Sửa `PrismaStore` comment batch insert:** Insert theo từng `depth` level hoặc dùng `create` tuần tự.
4. **Mở rộng `CrawlCheckpoint` schema:** Thêm `status`, `errorCount`, `nextScheduledAt`, `lastCrawledAt`.
5. **Thêm stub `src/core/signer-pool.js` và `src/utils/qrcode.js` trước Epic 11/15.**
6. **Kết nối `ActionRegistry` global với `AbstractCrawler` để tránh drift.**
7. **Thêm `@@index([crawledAt])` cho `Post` và `Comment` để hỗ trợ retention cleanup.**

---

*Review by Amelia — Epic 10 is on track, but the contract/schema story boundary needs tightening before implementation proceeds.*
