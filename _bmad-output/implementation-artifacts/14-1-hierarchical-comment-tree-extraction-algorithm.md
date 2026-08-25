---
story_id: "14.1"
epic: 14
story_key: "14-1-hierarchical-comment-tree-extraction-algorithm"
status: "ready-for-dev"
phase: "Phase 2"
created: 2026-08-26
updated: 2026-08-26
owner: "DEV"
reviewed: "Pending"
---

# Story 14.1: Hierarchical Comment Tree Extraction with Topological Sort

<!-- Note: Context engine analysis completed 2026-08-26. Ready for dev-story / bmad-dev-auto. -->

## Story

As an **AI Persona / Sentiment Researcher**,  
I want **cào toàn bộ cây bình luận phân cấp và lưu vào PostgreSQL theo thứ tự Topological Sort**,  
so that **tôi nắm bắt trọn vẹn ngữ cảnh tranh luận mà không bị lỗi Foreign Key violation hay Deadlock CSDL**.

[Source: `_bmad-output/planning-artifacts/epics.md` — Epic 14, Story 14.1]

## Acceptance Criteria

### AC-1: Cross-platform `CommentTreeExtractor`
- **Given** `CommentTreeExtractor` được triển khai trong `src/scrapers/social/comment-tree.js` (hoặc `src/core/comment-tree.js` nếu dev chứng minh tái sử dụng đa domain)
- **When** khởi tạo với `fetchPage({ postId, parentCommentId, after, limit })` async callback + `normalizeFn(raw)` + `options = { maxDepth: 3, maxComments: 500 }`
- **Then** extractor duyệt **BFS theo từng tầng depth**, fetch root comments trước, sau đó lần lượt fetch replies của từng depth
- **And** mỗi `CommentItem` được gán `depth` chính xác: `0` cho root, `depth = parent.depth + 1` cho reply
- **And** dừng khi đạt `maxDepth` hoặc `maxComments` (whichever comes first)

### AC-2: Chống tham chiếu vòng & duplicate
- **Given** response chứa comment có `parentCommentId` trỏ ngược về chính nó hoặc một tổ tiên
- **When** `CommentTreeExtractor` xử lý
- **Then** bỏ qua node vi phạm, log warning `⚠️ Comment cycle detected at ${commentId}`, không đệ quy vô hạn
- **And** duplicate comment ID chỉ lưu một lần (Map / Set deduplication)

### AC-3: Topological Sort trước khi persist
- **Given** toàn bộ cây bình luận đã được thu thập
- **When** gọi `extractor.store(comments, store)` hoặc crawler gọi `this.store.storeCommentBatch(comments, { upsert: true })`
- **Then** comments được sắp xếp theo `depth` tăng dần trước khi ghi
- **And** Prisma `Comment` được insert theo lô 500 records, `skipDuplicates: true`, đảm bảo `parentCommentId` đã tồn tại trước khi con được insert

### AC-4: Facebook `get_comments` Action
- **Given** `FacebookCrawler` đã hoàn thiện Story 13.3
- **When** gọi `crawler.start({ action: 'get_comments', args: { postId, maxDepth, maxComments }, session: { accountId } })`
- **Then** crawler gọi GraphQL `https://www.facebook.com/api/graphql/` với `doc_id` tương ứng comment tree
- **And** trích xuất toàn bộ root comments + sub-replies phân trang
- **And** chuẩn hóa thành `CommentItem[]` với `id: 'facebook:${postId}:${commentId}'`, `platform: 'facebook'`, `postId: 'facebook:${postId}'`
- **And** tự động lưu vào `PrismaStore` qua `storeCommentBatch` (nếu `store` được cung cấp)
- **And** `listActions()` trả về `ActionDescriptor` cho `get_comments` với `requiredArgs: ['postId']`, `optionalArgs: ['maxDepth', 'maxComments', 'after']`, `outputType: 'CommentItem[]'`

### AC-5: Token & Cookie Tương Thích
- **Given** session cookies hợp lệ (`c_user`, `xs`)
- **When** `FacebookClient` gửi request lấy comment tree
- **Then** sử dụng cùng token extraction (`lsd`, `fb_dtsg`, `jazoest`, `__spin_r`, `__spin_t`) đã triển khai ở Story 13.3
- **And** không log giá trị cookie/token (NFR-4)

### AC-6: Kiểm thử thực (No Mocks)
- **Given** test suite `tests/scrapers/social/facebook/crawler-comments.test.js` (hoặc tương đương)
- **When** chạy `npm test`
- **Then** không sử dụng `vi.fn`, mock, stub, fake
- **And** dùng local HTTP server + `StaticProxyProvider` + real `got`/`undici`
- **And** test phải cover: root comments, nested replies đến depth 2-3, cycle detection, maxDepth clamp, topological sort ordering
- **And** chạy `npm run typecheck` pass

## Tasks / Subtasks

- [ ] T1: Tạo `CommentTreeExtractor` reusable (AC-1, AC-2, AC-3)
  - [ ] T1.1: Tạo `src/scrapers/social/comment-tree.js` (hoặc `src/core/comment-tree.js`)
  - [ ] T1.2: Implement `fetchLayer({ postId, parentCommentId, after, limit })` callback contract
  - [ ] T1.3: Implement BFS queue, `depth` assignment, ancestor cycle tracking
  - [ ] T1.4: Implement topological sort by `depth` trước khi trả về / lưu
  - [ ] T1.5: Export `CommentTreeExtractor` từ `src/scrapers/social/index.js`
- [ ] T2: Mở rộng `FacebookCrawler` (AC-4, AC-5)
  - [ ] T2.1: Thêm `COMMENT_ROOTS` và `COMMENT_REPLIES` vào `DEFAULT_FB_DOC_IDS` (placeholder, xem Outstanding Items)
  - [ ] T2.2: Đăng ký action `get_comments` trong constructor
  - [ ] T2.3: Implement `getComments(args, session)` handler, wrap `CommentTreeExtractor`
  - [ ] T2.4: Normalize GraphQL comment node thành `CommentItem` theo `src/core/types.js`
  - [ ] T2.5: Gọi `this.store.storeCommentBatch(comments, { upsert: true })` khi có store
  - [ ] T2.6: Update `src/scrapers/social/facebook/index.js` nếu cần export thêm
- [ ] T3: Viết tests (AC-6)
  - [ ] T3.1: Tạo `tests/scrapers/social/facebook/crawler-comments.test.js`
  - [ ] T3.2: Local server trả về JSON GraphQL comment tree với `edges`, `page_info`, `comment_replies`
  - [ ] T3.3: Test `get_comments`, `listActions`, cycle detection, maxDepth, cleanup
- [ ] T4: Chạy verification
  - [ ] T4.1: `npm run typecheck`
  - [ ] T4.2: `npm test -- tests/scrapers/social/facebook/`
  - [ ] T4.3: `npm test -- tests/core/` (regression)

## Dev Notes

### Project Structure Notes

- **Target folder mới:** `src/scrapers/social/comment-tree.js` là nơi đặt logic cây bình luận dùng chung cho các platform.
- **Update folder:** `src/scrapers/social/facebook/crawler.js` để đăng ký `get_comments` và implement `getComments`.
- **Legacy `src/scrapers/facebook/comments.js`:** Puppeteer-based, KHÔNG sửa/xoá. Có thể tham khảo cách normalize comment nhưng không import.
- **Conflict / variance:**
  - `epics.md` AC dùng API `getComments(postId, { maxDepth, maxComments })`. Vì hệ thống mới dùng `AbstractCrawler.start({ action, args, session })` (AD-11), dev cần đăng ký action `get_comments` và implement `getComments(args, session)`.
  - Story chỉ bao gồm **Facebook** trong phạm vi này. Twitter (Story 13.2) vẫn `ready-for-dev`, do đó `CommentTreeExtractor` phải được thiết kế platform-agnostic để `TwitterCrawler` sau này chỉ cần cung cấp callback fetch khác.

### Core Code State to Preserve

- `AbstractCrawler.start()` ở `src/core/base-crawler.js:149-243` tự động resolve `accountId`, kiểm tra `governor`, rồi gọi handler `(args, session)`. Handler `getComments` phải lấy cookies từ `this.sessionManager.get(accountId)` hoặc `session.cookies`.
- `AbstractCrawler.listActions()` tại `src/core/base-crawler.js:106-115` trả về `ActionDescriptor[]` gồm `requiredArgs`, `optionalArgs`, `outputType`, `example`. Đảm bảo `get_comments` descriptor trả về `outputType: 'CommentItem[]'`.
- `PrismaStore.storeCommentBatch()` ở `src/store/prisma-store.js:271-298` đã thực hiện **topological sort theo `depth`**, insert theo lô 500, `skipDuplicates: true`.
- `PrismaStore.#normalizeComment()` ở `src/store/prisma-store.js:101-163` tự động:
  - Sinh `id = '${platform}:${postExternalId}:${commentExternalId}'` (nếu `comment.id` thiếu) qua `generateCommentId`.
  - Chuẩn hóa `postId` thành namespaced id.
  - Gán `depth = 0` nếu không có `parentCommentId`, `depth = 1` nếu có parent mà thiếu depth.
- Do đó, `CommentTreeExtractor` chỉ cần gán `depth` đúng; `PrismaStore` sẽ đảm bảo thứ tự insert.
- `FacebookClient.requestGraphQl()` ở `src/scrapers/social/facebook/client.js:281-363` đã xử lý token extraction, body GraphQL, và phân loại lỗi `XACT_4010`, `XACT_4290`, `XACT_5000`. Sử dụng trực tiếp cho comment queries.
- `FacebookClient.buildGraphQlBody()` ở `src/scrapers/social/facebook/client.js:236-272` build `application/x-www-form-urlencoded` với `doc_id`, `variables`, tokens. Truyền `variables` chứa `postId`, `after`, `first`, v.v.
- `CommentItem` type ở `src/core/types.js:31-47` yêu cầu `id`, `platform`, `externalId`, `postId`, `authorId`, `authorName`, `content`.

### Comment ID & Namespace

- `Comment.id` (Prisma / internal) = `${platform}:${postExternalId}:${commentExternalId}`.
- `CommentItem.id` nên set giống format này.
- `CommentItem.postId` nên là namespaced `facebook:${postExternalId}` hoặc raw `postExternalId` (PrismaStore cả hai đều chấp nhận).
- `CommentItem.parentCommentId` = `${platform}:${postExternalId}:${parentExternalId}` hoặc raw; `PrismaStore` tự chuẩn hóa.
- `CommentItem.depth` = số nguyên `>= 0`.

### Anti-Bot & Error Handling

- Sử dụng `FacebookPlatformResponseValidator` để phát hiện bot challenge / checkpoint / payload rỗng.
- `FacebookClient.requestGraphQl` tự xoay tài khoản / proxy khi 429/401.
- Đối với `doc_id` comment bị xoay: trả về `PlatformError` `XACT_5000` với `suggestedAction: 'retry_after_delay'`, không throw panic (NFR-7).

### Data Normalization

- `CommentItem.authorId` lấy từ `node.author.id`.
- `CommentItem.authorName` lấy từ `node.author.name`.
- `CommentItem.content` lấy từ `node.text` hoặc `node.message`.
- `CommentItem.likesCount` lấy từ `node.feedback?.like_count` hoặc `node.likes`.
- `CommentItem.subCommentsCount` lấy từ `node.feedback?.comment_count?.total_count` hoặc `node.reply_count`.
- `CommentItem.publishedAt` từ `node.created_time` (unix seconds) chuyển thành `Date`.
- `CommentItem.metadata` có thể chứa `rawId`, `cursor` cho debug.
- NFR-11: strip PII khỏi text/author (nếu có phone, email) trước khi lưu.

### Topological Sort Strategy

- `CommentTreeExtractor` collect toàn bộ comment nodes vào một `Map<string, CommentItem>`.
- Sau khi BFS hoàn tất, chuyển Map.values() thành array và sort theo `depth` tăng dần.
- Truyền array đã sort cho `store.storeCommentBatch(comments, { upsert: true })`.
- `PrismaStore.storeCommentBatch` sẽ group lại theo `depth` và insert từng depth một, mỗi depth theo lô 500.

### Testing Strategy

- **No mocks, no `vi.fn`, no fake HTTP clients.** [Source: `AGENTS.md`, `CLAUDE.md`]
- Cung cấp test seam `baseUrl` trong `FacebookClient` constructor.
- Dùng `http.createServer` trong test để:
  - Trả về HTML home chứa tokens.
  - Trả về JSON GraphQL cho `/api/graphql/` với comment tree shape: `{ data: { node: { comment_rendering_instance: { comments: { edges: [...], page_info: { has_next_page, end_cursor } } } } } }` (hoặc tương đương).
- Test cases:
  - Root comments only (depth 0).
  - 2 cấp replies (depth 1 và 2).
  - `maxDepth: 1` chỉ lấy root + depth 1.
  - `maxComments` dừng khi đạt giới hạn.
  - Cycle: node reply trỏ về chính root → detect và bỏ qua.
  - Topological sort: insert order đảm bảo parent trước con.

## Technical Requirements

- **Language & Runtime:** ESM Node.js >= 18, JSDoc + `npm run typecheck` (`tsc --noEmit`).
- **HTTP Client:** `got-scraping` mặc định (`client: 'got'`) như Story 13.3.
- **Proxy:** `ProxyIpPool` / `StaticProxyProvider`, sticky IP per account.
- **Concurrency:** `p-limit` nếu fetch nhiều reply layers song song (khuyến nghị 2-3 concurrent).
- **Browser / Signer:** Không bắt buộc mở browser. Dùng HTTP-only GraphQL.
- **Cookie serialization:** Sử dụng helper `buildCookieHeader` đã thêm vào `FacebookClient` / `FacebookCrawler` (Story 13.3 patch).

## Architecture Compliance

| AD | Rule | Implementation |
|----|------|----------------|
| AD-2 | Unified Base Interfaces | `CommentTreeExtractor` nhận callback `fetchPage`; `FacebookCrawler` extends `AbstractCrawler` và kế thừa `getComments`. |
| AD-4 | Namespaced PostgreSQL | `CommentItem.id = 'facebook:${postId}:${commentId}'`; lưu `PrismaStore` với `storeCommentBatch`. |
| AD-6 | Hierarchical Comment Tree Normalization & Topological Insertion | BFS theo depth, cycle detection, topological sort trước khi gọi `storeCommentBatch`. |
| AD-8 | Multi-Domain Expansion | File mới trong `src/scrapers/social/`; legacy `src/scrapers/facebook/` không đụng. |
| AD-9 | Anti-Bot Payload Validation | Sử dụng `FacebookPlatformResponseValidator`, xử lý 200 fake / checkpoint. |
| AD-11 | ActionRegistry | Action name `get_comments` (snake_case), `listActions()` trả về `ActionDescriptor`. |
| AD-14 | Error Envelope | Mọi lỗi trả về `PlatformError` với `code`, `type`, `suggestedAction`. |

## Library & Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| `got-scraping` | `^3.2.15` | HTTP client default, proxy, header generator. [Source: `package.json:119`] |
| `undici` | `^7.29.0` | HTTP client fallback. [Source: `package.json:141`] |
| `p-limit` | `^7.2.0` | Giới hạn concurrency khi fetch nhiều reply branches. [Source: `package.json:128`] |
| `vitest` | `^4.0.18` | Test runner. [Source: `package.json`] |

## File Structure Requirements

### CREATE

| File | Description |
|------|-------------|
| `src/scrapers/social/comment-tree.js` | `CommentTreeExtractor` platform-agnostic: BFS, cycle detection, depth assignment, topological sort. |
| `tests/scrapers/social/facebook/crawler-comments.test.js` | Tests `get_comments` với local server, real proxy, cycle, depth, topological ordering. |

### UPDATE

| File | Description |
|------|-------------|
| `src/scrapers/social/facebook/crawler.js` | Thêm `COMMENT_ROOTS`/`COMMENT_REPLIES` doc_id placeholders; register `get_comments`; implement `getComments`. |
| `src/scrapers/social/facebook/index.js` | Export thêm nếu cần (không bắt buộc nếu `FacebookCrawler` đã export). |
| `src/scrapers/social/index.js` | Export `CommentTreeExtractor` để platform khác dùng. |

### NO TOUCH

| File | Reason |
|------|--------|
| `src/scrapers/facebook/*` | Legacy Puppeteer scraper; decommission trong Epic 20. |
| `src/store/prisma-store.js` | Đã hỗ trợ `storeCommentBatch` topological sort; chỉ dùng API, không sửa logic. |
| `src/core/types.js` | `CommentItem` type đã ổn định; chỉ dùng. |

## Testing Requirements

- **Framework:** Vitest, `*.test.js`, `npm test`.
- **No mocks:** Không `vi.fn`, `mock`, `stub`, `fake`.
- **Real HTTP:** Dùng `http.createServer` để phục vụ HTML home + JSON GraphQL comment tree.
- **Real proxy:** Dùng `StaticProxyProvider` hoặc `ProxyIpPool` với proxy local.
- **Coverage tối thiểu:**
  - `CommentTreeExtractor` BFS duyệt đúng depth và phân trang.
  - `CommentTreeExtractor` phát hiện cycle (`parentCommentId` trỏ về tổ tiên hoặc chính nó).
  - `FacebookCrawler.listActions()` trả về `get_comments` descriptor.
  - `FacebookCrawler.start({ action: 'get_comments', ... })` trả về `CommentItem[]` với `id` đúng namespace.
  - Topological sort: parent comment `id` xuất hiện trước con trong batch gửi đến `storeCommentBatch`.
  - Response bot challenge / checkpoint được xử lý qua validator.
  - `cleanup()` không leak.
- **Regression:** Chạy `npm run typecheck` và `npm test -- tests/core/` (157 tests hiện tại phải vẫn pass).

## Previous Story Intelligence

### Story 13.3 — Facebook Hybrid Scraper (Done, sau patch 6eb0b3e)

- `FacebookClient` / `FacebookCrawler` đã hoàn thiện, kế thừa `AbstractApiClient` / `AbstractCrawler`.
- Token cache theo `accountId + cookieHash`, LRU, `fb_dtsg`/`lsd` validation, `__user` không fallback.
- `FacebookClient.requestGraphQl(docId, variables, options)` sẵn sàng để gọi thêm các `doc_id` comment tree.
- `FacebookCrawler` đã đăng ký `group_posts`, `page_posts` với `requiredArgs`/`optionalArgs`/`outputType`.
- `FacebookCrawler.getComments()` hiện throw `XACT_4001` (placeholder), cần thay bằng implementation.
- `FacebookPlatformResponseValidator` đã cứng hóa chống login wall, checkpoint i18n.

### Story 13.2 — Twitter Refactor (ready-for-dev)

- Chưa triển khai.
- `CommentTreeExtractor` nên được thiết kế để `TwitterCrawler` sau này chỉ cần cung cấp `fetchPage` callback khác.

### Git Intelligence

Recent commits (mới nhất trước story này):
- `6eb0b3e fix(facebook): harden hybrid Facebook scraper after code review for Story 13.3`
- `dc093b4 chore: ignore .playwright-mcp artifacts in gitignore`
- `d9969fb docs(story): mark Story 13.3 complete in sprint-status and spec file`
- `91dc28e fix(facebook): harden FacebookClient and FacebookCrawler against adversarial edge cases`
- `48841f9 fix(facebook): permit guest token extraction when lsd is present`

Patterns:
- Commit messages theo format `type(scope): description`.
- Không dùng mock trong tests.
- `FacebookClient` / `FacebookCrawler` vừa được refactor; ưu tiên tái sử dụng và mở rộng.

## Latest Tech Information

- Facebook GraphQL `doc_id` cho comment tree cần tìm qua network inspection; có thể xoay bất kỳ lúc nào. Cần graceful fallback (NFR-7).
- Graph API `/post-id/comments` chính thức của Meta yêu cầu Page/Comment MODERATE permission để lấy `id`, không phù hợp cho scraping với tài khoản cá nhân. [Source: `developers.facebook.com/docs/graph-api/reference/object/comments/`]
- Persisted GraphQL `doc_id` là cơ chế query của Facebook web; dev cần capture từ trình duyệt thật. [Source: deepwiki.com/jdcodes1/facebook-marketplace-mcp]
- `PrismaStore.storeCommentBatch` đã implement topological sort theo `depth` và batch 500 records.

## Project Context Reference

- Epic 14: `_bmad-output/planning-artifacts/epics.md#epic-14-deep-conversation-scraper-mcp-daemon-nowing-event-stream`
- Architecture AD-6: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:172-178`
- Prisma Comment schema: `prisma/schema.prisma:361-387`
- CommentItem type: `src/core/types.js:31-47`
- `PrismaStore` comment batch: `src/store/prisma-store.js:271-298`
- `AbstractCrawler` action registry: `src/core/base-crawler.js:96-115`
- `FacebookClient` GraphQL request: `src/scrapers/social/facebook/client.js:281-363`

## Outstanding Items (Dev Agent Owned)

- Xác định `doc_id` thực tế cho Facebook comment tree (root + replies) qua network inspection; giữ fallback khi doc_id xoay.
- Quyết định chính xác shape của GraphQL response cho comments (có thể khác với `group`/`page` feed). Điều chỉnh `normalizeComment` cho Facebook tương ứng.
- Nếu `TwitterCrawler` (Story 13.2) đã done trước khi bắt đầu story này, mở rộng `CommentTreeExtractor` sang `TwitterCrawler` với callback fetch phù hợp.

## Dev Agent Record

<!-- Dev agent: fill this section during implementation with actual decisions, blockers, and links to commits. -->
