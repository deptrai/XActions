# Architecture Review: Auto Checkpoint Lookup + Early Termination Universal

**Date:** 2026-09-09  
**Architect:** Winston (bmad-agent-architect)  
**Project:** XActions  
**Status:** Draft — awaiting implementation approval

---

## 1. Executive Summary

Khi **Nowing** gọi API scrape sang XActions mà không truyền `cursor`, hệ thống hiện tại **không tự động nạp `lastCursor` từ `CrawlCheckpoint`**. Điều này dẫn đến việc các crawler phải cào lại từ đầu, tốn kém proxy request và thời gian xử lý mặc dù database đã có dữ liệu cũ (`skipDuplicates: true`).

Đề xuất này triển khai **hai lớp cải tiến** ở lớp cha `AbstractCrawler` để áp dụng **universal** cho tất cả crawler kế thừa:

1. **Auto Checkpoint Lookup (ACL):** Tự động tìm `CrawlCheckpoint` theo `(platform, targetType, targetKey)` và nạp `lastCursor` khi caller không cung cấp `cursor`/`after`.
2. **Early Termination (ET):** Theo dõi tỷ lệ `inserted / total` trong mỗi batch. Nếu toàn bộ items đã tồn tại trong DB, crawler dừng pagination sớm, tránh lãng phí request.

---

## 2. Goals & Non-Goals

### Goals
- Khi Nowing gọi `POST /api/platform/:platform/scrape` không có `cursor`, XActions tự động resume từ checkpoint cũ nếu có.
- Giảm số lượng network request thừa cho các job scrape định kỳ.
- Áp dụng được cho **tất cả crawler kế thừa `AbstractCrawler`** mà không cần sửa từng crawler con (trừ việc đăng ký `checkpointResolver` nếu cần).
- Không phá vỡ Epic 34 (benchmark) hoặc bất kỳ epic nào đang chạy.
- Giữ backward compatibility: caller vẫn có thể override bằng cách truyền `cursor` tường minh.

### Non-Goals
- Không thay đổi schema `CrawlCheckpoint` hiện tại.
- Không tự động resume cho các non-paginated action (profile detail, single video, thread unroller).
- Không triển khai distributed scheduler mới (dùng checkpoint + API route hiện có).
- Không thay đổi cách các crawler con gọi `saveCheckpoint()` — chỉ thêm hành vi ở lớp cha.

---

## 3. Current State Analysis

### 3.1. `AbstractCrawler.start()`
- File: `src/core/base-crawler.js`
- Hiện tại: validate → resolve account → governor → telemetry → gọi `entry.handler(args, session)`.
- **Thiếu:** không có bước nào kiểm tra `CrawlCheckpoint` để tự động nạp `cursor`.

### 3.2. `PrismaStore`
- File: `src/store/prisma-store.js`
- Đã có:
  - `saveCheckpoint({ platform, targetType, targetKey, lastCursor, ... })`
  - `getCheckpoint(platform, targetType, targetKey)`
  - `storeBatch()` trả về `res.count` (số record thực sự được insert)
- **Thiếu:** chưa có cơ chế báo cáo `duplicated ratio` cho caller để quyết định dừng sớm.

### 3.3. `AbstractStore`
- File: `src/core/base-store.js`
- Định nghĩa interface `saveCheckpoint` / `getCheckpoint`.
- **Thiếu:** chưa có `getDuplicateStats()` hoặc `storeBatch()` returning insertion metadata.

### 3.4. `src/scrapers/index.js`
- Unified dispatcher `scrape(platform, action, options)`.
- Mỗi platform branch map args và gọi `crawler.start({ action, args, session })`.
- **Thiếu:** không merge `lastCursor` từ checkpoint trước khi gọi `start()`.

### 3.5. `api/routes/platform.js`
- `POST /:platform/scrape` chỉ đơn thuần truyền `req.body` vào `scrape()`.
- **Thiếu:** không có logic checkpoint resume ở route layer.

### 3.6. Các Crawler Con
- `FacebookCrawler`, `TwitterCrawler`, `TikTokCrawler`, `ThreadsCrawler`, `ShopeeCrawler`, `BatdongsanCrawler`, v.v. đều đã gọi `saveCheckpoint()` ở cuối mỗi trang.
- Mỗi crawler tự định nghĩa `targetType` và `targetKey` theo cách riêng.
- **Rủi ro:** `targetKey` không chuẩn hóa, dễ dẫn đến mismatch khi lookup. Ví dụ: Facebook marketplace dùng `targetKey = [query, location, category, categoryId, minPrice, maxPrice].join(':')`; nếu caller truyền `minPrice` vs `priceMin`, key sẽ khác.

---

## 4. Proposed Architecture

### 4.1. Design Principles
1. **Single responsibility:** `AbstractCrawler` chỉ quyết định có nên resume hay không. Việc tính toán `targetKey` do mỗi action/crawler con cung cấp qua `ActionDescriptor.checkpointResolver`.
2. **Opt-in, safe default:** Nếu `checkpointResolver` không được đăng ký, ACL bị tắt cho action đó (không phá vỡ backward compatibility).
3. **Telemetry-aware:** ET chỉ kích hoạt khi `storeBatch()` trả về đủ metadata. Nếu store không hỗ trợ, crawler tiếp tục như cũ.
4. **Respect explicit cursor:** Nếu caller đã truyền `cursor`/`after`/`max_id`/v.v., **không** ghi đè bằng checkpoint.

### 4.2. Core Data Structures

#### `ActionDescriptor` extension
```js
{
  action: 'group_posts',
  optionalArgs: ['count', 'cursor'],
  checkpointResolver?: (args) => {
    targetType: 'group',
    targetKey: String(args.groupId || args.url),
    cursorField: 'cursor',      // field name to inject
    fallbackCursorFields: ['after']
  }
}
```

#### `CheckpointResumeResult`
```js
{
  resumed: boolean,            // true nếu đã nạp checkpoint
  targetType: string,
  targetKey: string,
  lastCursor: string | null,
  injectedInto: string | null  // tên field được inject
}
```

#### `StoreBatchResult`
```js
{
  insertedCount: number,
  totalCount: number,
  duplicateCount: number,
  schemaValid: boolean
}
```

### 4.3. Lớp 1: Auto Checkpoint Lookup (ACL)

**Vị trí:** `AbstractCrawler.start()` trước khi gọi `entry.handler(args, session)`.

**Thuật toán:**
```text
1. Lấy checkpointResolver từ entry.descriptor.
2. Nếu không có → bỏ qua ACL.
3. Kiểm tra xem args đã có cursorField (hoặc fallback) chưa.
   - Nếu đã có → bỏ qua ACL (caller override).
4. Gọi resolver để lấy (targetType, targetKey, cursorField, fallbackCursorFields).
5. Gọi this.store.getCheckpoint(this.name, targetType, targetKey).
6. Nếu checkpoint.lastCursor tồn tại:
   - args[cursorField] = checkpoint.lastCursor
   - session.resumeFromCheckpoint = true
   - ghi log telemetry
7. Nếu checkpoint.status === 'completed' và hasMore === false:
   - Có thể trả về early với note "checkpoint already completed"
```

**Cách xử lý các alias cursor:**
Mỗi platform dùng tên field khác nhau (`cursor`, `after`, `max_id`, `page`, `offset`). `checkpointResolver` phải khai báo `cursorField` chính và `fallbackCursorFields`. `AbstractCrawler` sẽ ưu tiên field chính, inject vào field đó.

### 4.4. Lớp 2: Early Termination (ET)

**Vị trí:** `AbstractCrawler` + `AbstractStore`/`PrismaStore`.

**Nguyên lý:**
- Sau mỗi lần `storeBatch()` trong crawler con, caller sẽ nhận `StoreBatchResult`.
- Nếu `insertedCount === 0` và `totalCount > 0` (tất cả đã tồn tại), crawler con có thể dừng pagination.
- Tuy nhiên, các crawler con hiện tại gọi `this.store.storeBatch()` nhưng **không kiểm tra return value** (vì `storeBatch()` hiện tại return `undefined`).

**Phương án triển khai an toàn (không phá vỡ crawler con):**

**Option A — Cung cấp helper `shouldStopPagination()` trên `AbstractCrawler`:**
```js
async shouldStopPagination(items, opts = {}) {
  if (!this.store || !items?.length) return false;
  const existingIds = await this.store.findExistingIds(items.map(i => i.id));
  return existingIds.length === items.length;
}
```
- Crawler con gọi `await this.shouldStopPagination(items)` trong vòng lặp pagination.
- **Nhược điểm:** Phải sửa từng crawler con, mất tính universal.

**Option B — Biến `storeBatch()` return metadata + tự động dừng ở `AbstractCrawler` (không khả thi vì crawler con không trả kết quả batch về `start()`):**
- Không khả thi vì các crawler con gọi `store.storeBatch()` trực tiếp và không trả dữ liệu về `start()`.

**Option C — Universal ET qua `PrismaStore.storeBatch()` với callback/hook (khuyến nghị):**
- Thêm `onDuplicateRatio` callback vào `storeBatch()`.
- `AbstractCrawler` đăng ký một callback khi khởi tạo.
- Nếu duplicate ratio > threshold (e.g., 100%), callback đặt `session.shouldStopPagination = true`.
- Crawler con kiểm tra `session.shouldStopPagination` trong vòng lặp.
- **Nhược điểm:** vẫn cần sửa crawler con để kiểm tra flag, nhưng chỉ là thay đổi nhỏ.

**Khuyến nghị của kiến trúc sư:**
- **Đối với Epic này, triển khai ACL trước (100% universal ở `AbstractCrawler`).**
- **Đối với ET, triển khai Option A dưới dạng helper `shouldStopPagination()` và áp dụng tối thiểu cho Facebook/Twitter/TikTok/Threads/Shopee/Batdongsan trong vòng lặp pagination của họ.**
- Đây là trade-off giữa "thực sự universal" và "không phá vỡ behavior hiện tại của 20 crawler".

### 4.5. Chuẩn hóa `targetKey` (rất quan trọng)

Để ACL hoạt động đáng tin cậy, `checkpointResolver` phải tạo `targetKey` ổn định.

**Nguyên tắc:**
- Sử dụng chỉ các tham số **định danh duy nhất** mục tiêu (ID, URL chuẩn hóa, query đã trim + lowercase).
- Sắp xếp các tham số theo thứ tự alphabet để tránh `a:b` vs `b:a`.
- Không bao gồm các tham số phân trang (`cursor`, `limit`, `page`).

**Ví dụ:**
```js
// Facebook marketplace
const targetKey = [
  ['q', rawQuery.toLowerCase().trim()],
  ['location', (location || '').toLowerCase().trim()],
  ['category', category || ''],
  ['categoryId', categoryId || ''],
  ['minPrice', minPrice ?? ''],
  ['maxPrice', maxPrice ?? '']
]
  .filter(([_, v]) => v !== '' && v != null)
  .map(([k, v]) => `${k}=${v}`)
  .join('|');
```

---

## 5. File Changes

### 5.1. Core — `src/core/base-crawler.js`
- Thêm method `resolveCheckpoint(command)`.
- Thêm bước ACL trong `start()`.
- Thêm helper `shouldStopPagination(items)` (ET Option A).
- Cập nhật `TelemetryContext` để ghi `resumeFromCheckpoint`.

### 5.2. Core — `src/core/base-store.js`
- Thêm abstract method `findExistingIds(ids)`.
- Thêm abstract method `getStoreBatchResult()` (hoặc `storeBatch()` trả về metadata).

### 5.3. Store — `src/store/prisma-store.js`
- Implement `findExistingIds(ids)` dùng `prisma.post.findMany({ where: { id: { in: ids } }, select: { id: true } })`.
- Cập nhật `storeBatch()` để return `StoreBatchResult`.

### 5.4. Store — `src/store/index.js` (defaultStore)
- Đảm bảo `defaultStore` (StoreWithRedis) delegate đúng các method mới.

### 5.5. Types — `src/core/types.js` hoặc `types/xactions.d.ts`
- Bổ sung `ActionDescriptor.checkpointResolver` typedef.
- Bổ sung `CrawlerCommand.resumeFromCheckpoint`.

### 5.6. Dispatcher — `src/scrapers/index.js`
- Không cần thay đổi lớn nếu ACL xử lý ở `AbstractCrawler.start()`.
- Tuy nhiên, các `mappedArgs` hiện tại copy `options.cursor` vào `args`. Cần đảm bảo `cursor` từ caller vẫn được ưu tiên.

### 5.7. API Route — `api/routes/platform.js`
- Không bắt buộc thay đổi nếu ACL xử lý ở crawler layer.
- Tùy chọn: thêm query param `?resume=false` để caller có thể tắt ACL.

### 5.8. Crawler con — chọn lọc
- **FacebookCrawler:** đăng ký `checkpointResolver` cho `group_posts`, `page_posts`, `search`, `group_search`, `marketplace`, `post_comments`, `group_comments`, `group_members`, `followers`, `following`.
- **TwitterCrawler:** đăng ký cho `search`, `hashtag`, `followers`, `following`, `likes`, `bookmarks`, `media`, `list_members`, `community_members`.
- **TikTokCrawler:** đăng ký cho `search`, `hashtag_feed`, `get_post_comments`.
- **ThreadsCrawler:** đăng ký cho `search`, `get_user_feed`, `get_post_comments`.
- **ShopeeCrawler:** đăng ký cho `search_products`.
- **BatdongsanCrawler:** đăng ký cho `search_listings`.
- Các crawler khác: opt-in sau.

### 5.9. Tests
- `tests/core/base-crawler.checkpoint.test.js` (mới)
- `tests/store/prisma-store.checkpoint.test.js` (bổ sung)
- `tests/scrapers/facebook/checkpoint-resolver.test.js` (mới)
- `tests/scrapers/twitter/checkpoint-resolver.test.js` (mới)
- Cập nhật `tests/scrapers/index.test.js` nếu cần.

---

## 6. API / Data Flow

### 6.1. Sequence Diagram: Auto Checkpoint Lookup

```
Nowing          API Route         scrape()        AbstractCrawler    PrismaStore      Facebook API
  |                 |                 |                  |                 |                |
  | POST /scrape    |                 |                  |                 |                |
  | {groupId, query}|                 |                  |                 |                |
  |---------------->|                 |                  |                 |                |
  |                 | scrape(platform, action, options)   |                 |                |
  |                 |---------------->|                  |                 |                |
  |                 |                 | crawler.start({action, args, session})            |
  |                 |                 |------------------>|                 |                |
  |                 |                 |                  | checkpointResolver(args)         |
  |                 |                 |                  |-------->| getCheckpoint(...)      |
  |                 |                 |                  |         |<-- {lastCursor}         |
  |                 |                 |                  |<--------|                         |
  |                 |                 |                  | args.cursor = lastCursor          |
  |                 |                 |                  |                                 |
  |                 |                 |                  |-------->| fetch page at cursor    |
  |                 |                 |                  |         |------------------------>|
  |                 |                 |                  |         |<-- posts + next cursor  |
  |                 |                 |                  | storeBatch(posts)                 |
  |                 |                 |                  |         | saveCheckpoint(...)     |
  |                 |                 |<-- result -------|                                 |
  |                 |<-- response ---|                  |                                 |
  |<----------------|                 |                  |                                 |
```

### 6.2. Early Termination Flow

```
Crawler Loop:
  while (hasMore && pageCount < maxPages) {
    const page = await fetchPage(cursor);
    await store.storeBatch(page.items);
    if (await this.shouldStopPagination(page.items)) break;  // ET helper
    cursor = page.pageInfo.end_cursor;
  }
```

---

## 7. Implementation Phases

### Phase 1: Foundation (1 story)
- Sửa `AbstractCrawler`, `AbstractStore`, `PrismaStore`.
- Thêm `checkpointResolver` registry API.
- Thêm `findExistingIds` và `storeBatch` metadata.
- **Story key đề xuất:** `35-1-universal-checkpoint-lookup-core` (hoặc thuộc Epic 25/20).

### Phase 2: Resolvers cho top platforms (1 story)
- Đăng ký `checkpointResolver` cho Facebook, Twitter, TikTok, Threads, Shopee, Batdongsan.
- Viết tests.

### Phase 3: Early Termination (1 story)
- Thêm `shouldStopPagination()`.
- Áp dụng ET cho các vòng lặp pagination của Phase 2.
- **Lưu ý:** Cần xác định xem các crawler con có gọi `storeBatch()` trước hay sau khi kiểm tra `has_next_page`.

### Phase 4: Integration & Rollout (1 story)
- Tích hợp với `api/routes/platform.js` (tùy chọn `?resume=false`).
- E2E test với live Facebook group/page.
- Cập nhật documentation.

---

## 8. Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `targetKey` mismatch do các alias args khác nhau | High | Chuẩn hóa resolver, sắp xếp key-value alphabet, trim + lowercase |
| Crawler con không kiểm tra `session.shouldStopPagination` | Med | Triển khai ET từ từ, bắt đầu với Facebook/Twitter |
| Checkpoint cũ bị stale (nền tảng đổi cursor format) | Med | Lưu `lastTimestamp` cùng `lastCursor`; nếu timestamp quá cũ thì ignore checkpoint |
| Caller cố tình muốn scrape lại từ đầu | Low | Hỗ trợ `?resume=false` hoặc truyền `cursor: null` tường minh |
| Epic 34 telemetry bị ảnh hưởng | Low | Không thay đổi telemetry payload, chỉ thêm `resumeFromCheckpoint` flag |
| Performance khi `findExistingIds` với 10k items | Med | Giới hạn batch size (chunk 500), dùng `id IN (...)` với index PK |

---

## 9. Testing Strategy

### Unit Tests
- `AbstractCrawler.resolveCheckpoint()` returns `resumed=false` khi không có resolver.
- `AbstractCrawler.resolveCheckpoint()` injects `cursor` khi checkpoint tồn tại.
- `AbstractCrawler.resolveCheckpoint()` không ghi đè khi caller đã truyền `cursor`.
- `PrismaStore.findExistingIds()` trả về đúng IDs tồn tại.
- `shouldStopPagination()` trả về `true` khi tất cả items đã có.

### Integration Tests
- Gọi `scrape('facebook', 'group_posts', { groupId: '...' })` lần 1, lần 2 không truyền cursor → lần 2 phải nạp checkpoint.
- Gọi `scrape('twitter', 'search', { query: '...' })` lần 1, lần 2 → tiếp tục từ cursor.

### E2E Tests
- Dùng live API `POST /api/platform/facebook/scrape` với `group_posts`.
- Kiểm tra `CrawlCheckpoint` được tạo sau lần 1.
- Kiểm tra lần 2 nhanh hơn / request ít hơn.

---

## 10. Acceptance Criteria

1. Khi `POST /api/platform/:platform/scrape` không truyền `cursor`/`after`, `AbstractCrawler` tự động tìm và nạp `lastCursor` từ `CrawlCheckpoint` cho các action đã đăng ký resolver.
2. Caller vẫn có thể override bằng cách truyền `cursor` tường minh.
3. Ít nhất 6 platform chính (Facebook, Twitter, TikTok, Threads, Shopee, Batdongsan) có checkpoint resolver.
4. `storeBatch()` trả về metadata `insertedCount` / `duplicateCount`.
5. `shouldStopPagination()` hoạt động đúng cho ít nhất 3 crawler chính.
6. Không có regression ở Epic 34 benchmark hoặc `POST /api/benchmark/probe-all`.
7. 100% unit tests pass.

---

## 11. Story Placement Recommendation

Vì Epic 34 đã `done`, và tính năng này liên quan trực tiếp đến:
- **Epic 25: Unified Dispatcher & Public API Finalization** (vì thay đổi dispatcher behavior)
- **Epic 20: Nowing Cutover** (vì giải quyết gap-fill cho Nowing)

**Khuyến nghị:** Tạo story mới trong **Epic 25** với key `25-1-universal-checkpoint-lookup` (nâng cấp story hiện tại) hoặc `25-5-checkpoint-resume-universal` (story mới). Hoặc tạo epic mới `35` nếu muốn tách riêng.

**Scope ước tính:** 3-4 stories, 1-2 sprints.

---

## 12. Next Steps

1. **Approve architecture** — Luisphan review và quyết định scope (có triển khai ET luôn hay chỉ ACL trước).
2. **Tạo story** trong sprint-status.yaml (Epic 25 hoặc Epic 35 mới).
3. **Chuyển sang `bmad-create-story` → `bmad-dev-story` → implement.**
