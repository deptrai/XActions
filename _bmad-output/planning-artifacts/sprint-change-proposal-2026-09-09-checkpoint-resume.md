# Sprint Change Proposal — Universal Checkpoint Resume & Early Termination

**Date:** 2026-09-09  
**Skill:** bmad-correct-course  
**Author:** Winston (System Architect)  
**Trigger:** Luisphan yêu cầu implement Hướng 2 (Auto Checkpoint Lookup + Early Termination Universal) sau khi architect review kiến trúc.

---

## 1. Issue Summary

### Triggering Story
- Không thuộc một story cụ thể đang backlog. Được phát hiện trong quá trình **Epic 34 Scraper Benchmark & Reliability Suite** khi kiểm tra dashboard benchmark trên production.
- Nowing gọi `POST /api/platform/:platform/scrape` mà không truyền `cursor`/`after` thì XActions cào lại từ đầu, dù đã có `CrawlCheckpoint` trong PostgreSQL.

### Core Problem
- **CrawlCheckpoint** (`CrawlCheckpoint` model, `PrismaStore.saveCheckpoint()` / `getCheckpoint()`) đã tồn tại nhưng **chưa được tự động sử dụng** để nạp `lastCursor` khi caller không truyền cursor.
- `AbstractCrawler.start()` hiện tại gọi thẳng `entry.handler(args, session)` mà không resolve checkpoint.
- Các crawler con gọi `storeBatch()` với `skipDuplicates: true` nhưng không trả về metadata, nên không thể quyết định dừng sớm khi toàn bộ page đã tồn tại.
- Kết quả: lãng phí proxy request, tốn thời gian, và vi phạm nguyên tắc **3-Tier Incremental Gap-Filling (FR-88)** trong PRD.

### Evidence
- `src/core/base-crawler.js:220-380` — `start()` không gọi `store.getCheckpoint()`.
- `src/store/prisma-store.js:190-280` — `storeBatch()` trả về `undefined` dù Prisma `createMany` trả về `count`.
- `api/routes/platform.js:308-342` — `POST /:platform/scrape` chỉ truyền `req.body` vào `scrape()`.
- Architecture review chi tiết: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/AUTO-CHECKPOINT-LOOKUP-ARCHITECTURE-REVIEW.md`.

---

## 2. Impact Analysis

### 2.1. Epic Impact

| Epic | Status | Impact |
|------|--------|--------|
| **Epic 10: Data & Platform Foundation** | done | AD-10 và AD-12 đã khai báo 3-Tier Gap-Filling và CrawlCheckpoint, nhưng **chưa hoàn thiện tự động resume** ở `AbstractCrawler`. Cần bổ sung story mới hoặc mở lại AC của Story 10.1 / 10.4. |
| **Epic 25: Unified Dispatcher** | backlog | Story 25.1 (Universal `scrape()` Dispatcher) là nơi hợp lý nhất để tích hợp checkpoint resolution. Dispatcher cần hỗ trợ `resume` option và delegate ACL cho `AbstractCrawler`. |
| **Epic 20: Nowing Cutover** | backlog | Tính năng này là **enabler quan trọng** cho Nowing — giảm duplicate scraping, tiết kiệm proxy. Có thể tăng priority của Epic 20.1 nếu cần test shadow-run với checkpoint resume. |
| **Epic 34: Scraper Benchmark** | done | Không thay đổi scope Epic 34. Chỉ thêm `resumeFromCheckpoint` flag vào telemetry payload. Không regression benchmark nếu implement đúng. |

### 2.2. Story Impact

#### Existing stories cần cập nhật
- **Story 10.1 Core Domain Interfaces:** Bổ sung AC yêu cầu `AbstractCrawler` tự động resolve `CrawlCheckpoint` trước khi gọi handler. Thêm `ActionDescriptor.checkpointResolver`.
- **Story 10.2 PrismaStore:** Bổ sung AC yêu cầu `storeBatch()` trả về `{ insertedCount, duplicateCount, totalCount, schemaValid }`.
- **Story 10.4 CrawlCheckpoint Operational API:** Có thể giữ nguyên vì API `/checkpoints` đã tồn tại, không xung đột.
- **Story 25.1 Universal `scrape()` Dispatcher:** Cập nhật AC để hỗ trợ `resume: boolean` và đảm bảo `cursor` từ caller được ưu tiên.

#### New stories cần thêm
- **Story 25.5 (hoặc 10.6): Core Checkpoint Resume Engine** — implement ACL và ET helper ở `AbstractCrawler` + `PrismaStore`.
- **Story 25.6: Checkpoint Resolvers for Top Platforms** — đăng ký resolver cho Facebook, Twitter, TikTok, Threads, Shopee, Batdongsan.
- **Story 25.7: Early Termination in Crawler Pagination Loops** — sửa vòng lặp các crawler chính để dừng sớm khi page toàn bài đã có.

### 2.3. Artifact Conflicts

#### PRD (`prd.md`)
- **Không xung đột.** FR-88 (3-Tier Incremental Gap-Filling) và FR-87 (Data Retention) được củng cố.
- **Cần cập nhật:** Ghi rõ `lastCursor` được tự động nạp khi `resume` không bị tắt.

#### Architecture Spine (`architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md`)
- **Không xung đột.** AD-10, AD-12, AD-16 đã có sẵn. Chỉ cần cập nhật AD-11 (CrawlerCommand & ActionRegistry) để thêm `checkpointResolver` vào `ActionDescriptor`.
- **Cần cập nhật:** Sequence diagram cho `AbstractCrawler.start()` thêm bước resolve checkpoint.

#### Sprint Status (`_bmad-output/implementation-artifacts/sprint-status.yaml`)
- **Cần cập nhật:** Thêm stories mới vào Epic 25 hoặc Epic 10.

---

## 3. Recommended Approach

### Selected Path: **Option 1 — Direct Adjustment** (thêm stories vào Epic 25 + cập nhật AC Epic 10)

**Rationale:**
- Kiến trúc `AbstractCrawler`, `PrismaStore`, `CrawlCheckpoint` đã có sẵn.
- Không cần rollback bất kỳ story nào.
- PRD và Architecture đã dự đoán tính năng này (FR-88, AD-10, AD-12).
- Triển khai theo từng phase giảm rủi ro: ACL trước, ET sau.

### Phân loại scope
- **Scope:** Moderate — yêu cầu thêm stories, cập nhật AC, và developer implementation.
- **Effort estimate:** 2–3 sprints (3 stories, 1 refactor cleanup).
- **Risk level:** Medium — rủi ro chính là `targetKey` mismatch và checkpoint stale.

---

## 4. Detailed Change Proposals

### 4.1. Story 10.1 — Update Acceptance Criteria

**OLD AC (liên quan):**
```
- `AbstractCrawler`: `init()`, `start()`, `search()`, `getPostDetail()`, `getComments()`, `cleanup()`
- `ActionDescriptor` hỗ trợ trường tùy chọn `requiresAuth?: boolean`
```

**NEW AC (bổ sung):**
```
- `AbstractCrawler.start(command)` kiểm tra `ActionDescriptor.checkpointResolver` và tự động gọi `store.getCheckpoint(platform, targetType, targetKey)` khi caller không truyền `cursor`/`after`/`max_id`.
- `ActionDescriptor` hỗ trợ thêm tùy chọn `checkpointResolver?: (args) => { targetType, targetKey, cursorField, fallbackCursorFields }`.
- `AbstractCrawler.start()` đảm bảo cursor từ caller luôn được ưu tiên (không ghi đè).
- `AbstractCrawler` cung cấp `shouldStopPagination(items): Promise<boolean>` helper để crawler con dừng sớm khi tất cả items đã tồn tại.
```

**Rationale:** Đưa auto checkpoint lookup vào core contract, đảm bảo universal cho mọi crawler kế thừa.

### 4.2. Story 10.2 — Update Acceptance Criteria

**NEW AC (bổ sung):**
```
- `PrismaStore.storeBatch(posts, opts)` trả về object `{ insertedCount, duplicateCount, totalCount, schemaValid }`.
- `PrismaStore` implement `findExistingIds(ids): Promise<string[]>` dùng indexed `id IN (...)` query.
- `AbstractStore` cập nhật abstract signature cho `storeBatch` và thêm `findExistingIds`.
```

**Rationale:** Cần metadata để Early Termination hoạt động.

### 4.3. Story 25.1 — Update Acceptance Criteria

**NEW AC (bổ sung):**
```
- Dispatcher `scrape(platform, action, args)` truyền `args` trực tiếp; `AbstractCrawler.start()` xử lý resume. Không cần dispatcher tự đọc checkpoint.
- Dispatcher hỗ trợ `args.resume: false` để caller có thể tắt auto checkpoint lookup.
- `options.cursor` từ caller được ưu tiên so với checkpoint (backward compatible).
```

**Rationale:** Giữ dispatcher thin; logic resume nằm trong `AbstractCrawler`.

### 4.4. New Story 25.5 — Core Checkpoint Resume Engine

**Title:** Universal Auto Checkpoint Lookup & Early Termination Core

**User Story:**
As a **Nowing Integrator**,  
I want **`AbstractCrawler` to automatically resume scraping from the last saved checkpoint and stop early when all page items already exist in DB**,  
So that **we save proxy cost and avoid duplicate full re-crawls on every scheduled run**.

**Acceptance Criteria:**
- Given `CrawlCheckpoint` table exists with `(platform, targetType, targetKey, lastCursor)`
- When `AbstractCrawler.start({ action, args: { groupId: '123' } })` is called without `cursor`
- Then it looks up checkpoint by `checkpointResolver` and injects `lastCursor` into `args` before calling handler
- And if checkpoint is missing, it starts from the beginning without error
- And `storeBatch()` returns insertion metadata
- And `shouldStopPagination()` returns true when all items in a batch are duplicates

**Files to modify:**
- `src/core/base-crawler.js`
- `src/core/base-store.js`
- `src/store/prisma-store.js`
- `src/store/index.js`
- `src/core/types.js` / `types/xactions.d.ts`

**Estimate:** 1 sprint

### 4.5. New Story 25.6 — Checkpoint Resolvers for Top Platforms

**Title:** Register Checkpoint Resolvers for Facebook, Twitter, TikTok, Threads, Shopee, Batdongsan

**User Story:**
As a **Platform Engineer**,  
I want **each major platform crawler to define a stable `checkpointResolver` for its paginated actions**,  
So that **auto resume works correctly and consistently across platforms**.

**Acceptance Criteria:**
- Facebook: resolvers for `group_posts`, `page_posts`, `search`, `group_search`, `marketplace`, `post_comments`, `group_comments`, `group_members`, `followers`, `following`.
- Twitter: resolvers for `search`, `hashtag`, `followers`, `following`, `likes`, `bookmarks`, `media`, `list_members`.
- TikTok: resolvers for `search`, `hashtag_feed`, `get_post_comments`.
- Threads: resolvers for `search`, `get_user_feed`, `get_post_comments`.
- Shopee: resolver for `search_products`.
- Batdongsan: resolver for `search_listings`.
- All resolvers produce stable `targetKey` by sorting key-value pairs alphabetically, trimming and lowercasing identifiers, excluding pagination params.

**Files to modify:**
- `src/scrapers/social/facebook/crawler.js`
- `src/scrapers/social/twitter/crawler.js`
- `src/scrapers/social/tiktok/crawler.js`
- `src/scrapers/social/threads/crawler.js`
- `src/scrapers/ecom/shopee/crawler.js`
- `src/scrapers/realestate/batdongsan/crawler.js`

**Estimate:** 1 sprint

### 4.6. New Story 25.7 — Early Termination in Pagination Loops

**Title:** Early Termination in Crawler Pagination Loops

**User Story:**
As a **Reliability Engineer**,  
I want **crawler pagination loops to stop as soon as a full page of already-stored items is detected**,  
So that **scheduled re-scrapes do not waste proxy requests on data we already have**.

**Acceptance Criteria:**
- Facebook `groupPosts`, `pagePosts`, `search`, `marketplace`, `groupSearch` stop when `shouldStopPagination()` returns true.
- Twitter `search`, `hashtag`, `followers`, `following`, `likes` stop when page contains only duplicates.
- TikTok `search`, `hashtag_feed` stop when page contains only duplicates.
- At least 3 crawlers covered in first implementation; remaining crawlers tracked as follow-up.
- No regression in existing behavior when `storeBatch()` metadata unavailable.

**Files to modify:**
- `src/scrapers/social/facebook/crawler.js`
- `src/scrapers/social/twitter/crawler.js`
- `src/scrapers/social/tiktok/crawler.js`

**Estimate:** 0.5–1 sprint

---

## 5. Implementation Handoff

### Scope Classification
- **Moderate** — requires backlog reorganization (thêm stories) and developer implementation.

### Handoff Recipients
1. **Product Owner / Luisphan:** Approve story placement (Epic 25 vs Epic 10) và update `sprint-status.yaml`.
2. **Developer Agent (bmad-dev-story):** Implement Story 25.5 → 25.6 → 25.7 theo thứ tự.
3. **QA/Testing:** Viết integration tests cho checkpoint resume và early termination.

### Success Criteria
- `POST /api/platform/facebook/scrape` lần 2 với cùng `groupId` tự động nạp `lastCursor` từ checkpoint.
- `storeBatch()` trả về metadata `insertedCount` / `duplicateCount`.
- 3+ crawler chính dừng sớm khi page toàn duplicates.
- `npm test` pass; không regression ở benchmark telemetry.

---

## 6. Checklist Completion

| Section | Status | Notes |
|---------|--------|-------|
| 1.1 Triggering story | [x] Done | Phát hiện trong Epic 34 benchmark; liên quan FR-88, AD-10, AD-12. |
| 1.2 Core problem | [x] Done | Missing auto checkpoint resume in `AbstractCrawler.start()` and `storeBatch()` metadata. |
| 1.3 Evidence | [x] Done | Code inspection of `base-crawler.js`, `prisma-store.js`, `platform.js`. |
| 2.1 Current epic | [!] Action-needed | Epic 34 done; story mới nên vào Epic 25 hoặc Epic 10. |
| 2.2 Epic changes | [x] Done | Add 2–3 new stories; update AC for 10.1, 10.2, 25.1. |
| 2.3 Future epics | [x] Done | Epic 20 (Nowing cutover) benefit directly; no other future epic invalidated. |
| 2.4 Obsolescence | [x] Done | No epics become obsolete. |
| 2.5 Resequencing | [x] Done | Epic 25 stories may start earlier if prioritized; Epic 20 test shadow-run can use new feature. |
| 3.1 PRD conflicts | [x] Done | No conflicts; FR-88 reinforced. |
| 3.2 Architecture conflicts | [x] Done | AD-10, AD-12, AD-16 already cover this; AD-11 needs small update. |
| 3.3 UI/UX conflicts | [N/A] | No UI/UX impact. |
| 3.4 Other artifacts | [!] Action-needed | `sprint-status.yaml` needs update. |
| 4.1 Direct Adjustment | [x] Viable | Best option. |
| 4.2 Rollback | [x] Not viable | No completed work to roll back. |
| 4.3 MVP Review | [x] Not viable | MVP achievable; no scope reduction needed. |
| 4.4 Selected approach | [x] Done | Direct Adjustment with Epic 25 placement. |
| 5.1 Issue summary | [x] Done | See Section 1. |
| 5.2 Epic/artifact impact | [x] Done | See Section 2. |
| 5.3 Path forward | [x] Done | See Section 3. |
| 5.4 MVP impact | [x] Done | No negative impact. |
| 5.5 Handoff plan | [x] Done | See Section 5. |
| 6.1 Review checklist | [x] Done | All applicable sections addressed. |
| 6.2 Proposal accuracy | [x] Done | Consistent with PRD/Architecture. |
| 6.3 User approval | [x] Done | Luisphan approved. |
| 6.4 Sprint status update | [x] Done | Added 25.5, 25.6, 25.7 to sprint-status.yaml. |
| 6.5 Next steps | [x] Done | Ready to route to bmad-dev-story. |

---

## 7. Approval & Next Steps

**Do you approve this Sprint Change Proposal?**

- [ ] **Yes** — Tôi sẽ cập nhật `sprint-status.yaml`, `epics.md`, và `architecture-spine.md` sau đó handoff cho `bmad-dev-story`.
- [ ] **No** — Cần điều chỉnh gì?
- [ ] **Revise** — Tôi cần thêm thông tin hoặc thay đổi scope.

**Mặc định nếu approve:**
1. Thêm 3 stories mới vào Epic 25 (`25-5`, `25-6`, `25-7`).
2. Cập nhật AC của Story 10.1, 10.2, 25.1.
3. Cập nhật `sprint-status.yaml` với trạng thái `backlog`.
4. Tạo story files đầy đủ trong `_bmad-output/implementation-artifacts/stories/`.
5. Chuyển sang `bmad-dev-story` để implement.
