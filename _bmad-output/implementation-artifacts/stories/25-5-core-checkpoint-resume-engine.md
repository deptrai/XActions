---
title: 'Story 25.5: Core Checkpoint Resume & Early Termination Engine'
type: 'feature'
created: '2026-09-09'
baseline_commit: 'fc038311c16ea77d3df5f5fa7f055eb88950c0c8'
status: 'done'
review_loop_iteration: 0
context:
  - src/core/base-crawler.js
  - src/core/base-store.js
  - src/store/prisma-store.js
  - src/store/index.js
  - src/core/types.js
  - types/index.d.ts
  - src/types/xactions.d.ts
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Khi Nowing hoặc CLI gọi `scrape(platform, action, args)` mà không truyền `cursor`/`after`/`max_id`, XActions không tự động nạp `lastCursor` từ `CrawlCheckpoint` trong PostgreSQL. Kết quả là các crawler cào lại từ đầu, lãng phí proxy request và thời gian, dù `skipDuplicates` ở tầng DB đã chống trùng.

**Approach:**
1. Thêm `checkpointResolver` optional vào `ActionDescriptor` trong `src/core/base-crawler.js` / `src/core/types.js`.
2. Sửa `AbstractCrawler.start()` để tự động gọi `store.getCheckpoint(platform, targetType, targetKey)` và inject `lastCursor` vào `args` khi caller không truyền cursor.
3. Sửa `AbstractStore` / `PrismaStore` để `storeBatch()` trả về `{ insertedCount, duplicateCount, totalCount, schemaValid }` và implement `findExistingIds(ids)`.
4. Thêm helper `shouldStopPagination(items)` vào `AbstractCrawler` để các crawler con có thể dừng pagination khi page toàn duplicate.

## Boundaries & Constraints

**Always:**
- Chỉ sửa `src/core/base-crawler.js`, `src/core/base-store.js`, `src/store/prisma-store.js`, `src/store/index.js`, `src/core/types.js`, `types/xactions.d.ts`.
- `checkpointResolver` phải là optional; nếu không đăng ký thì behavior hiện tại không thay đổi.
- Caller-supplied `cursor`/`after`/`max_id` luôn được ưu tiên hơn checkpoint.
- `args.resume === false` phải tắt auto checkpoint lookup.
- Không làm hỏng Epic 34 benchmark telemetry hoặc các test hiện có.
- Giữ backward compatibility với `AbstractStore` interface.

**Ask First:**
- Nếu cần thay đổi `CrawlCheckpoint` schema.
- Nếu cần thêm field mới vào `Post` / `Comment`.

**Never:**
- Không override `cursor` khi caller đã truyền.
- Không sửa các crawler con ở story này (chỉ core).
- Không thay đổi `saveCheckpoint()` behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Auto resume group_posts | `start({ action: 'group_posts', args: { groupId: '123' } })` + checkpoint có `lastCursor` | `args.cursor = lastCursor` trước khi gọi handler | Không throw nếu checkpoint missing |
| Caller override | `args: { groupId: '123', cursor: 'abc' }` | `cursor` giữ nguyên 'abc' | Không gọi `getCheckpoint` |
| No resolver | Action không có `checkpointResolver` | Không lookup checkpoint | Silent no-op |
| Disabled resume | `args.resume: false` | Không lookup checkpoint | Silent no-op |
| Empty page duplicates | `storeBatch()` trả `insertedCount: 0` | `shouldStopPagination()` trả `true` | Không crash |
| Non-paginated action | `action: 'profile'` | `checkpointResolver` không áp dụng | Không ảnh hưởng |
| Stale checkpoint | `lastCrawledAt` > 30 ngày | Tùy chọn ignore hoặc vẫn dùng | Configurable |

## Code Map

- `src/core/base-crawler.js` — `AbstractCrawler.start()`, `resolveCheckpoint()`, `shouldStopPagination()`.
- `src/core/base-store.js` — abstract `findExistingIds()`, `storeBatch()` return signature.
- `src/store/prisma-store.js` — implement `findExistingIds()`, `storeBatch()` return `StoreBatchResult`.
- `src/store/index.js` — `defaultStore` delegate đúng các method mới.
- `src/core/types.js` — `ActionDescriptor` typedef với `checkpointResolver`.
- `types/xactions.d.ts` — public type exports.

## Tasks & Acceptance

**Execution:**
- [x] Cập nhật `src/core/types.js` — thêm `checkpointResolver` typedef vào `ActionDescriptor`.
- [x] Cập nhật `src/core/base-store.js` — abstract `findExistingIds(ids)` và cập nhật `storeBatch` signature.
- [x] Cập nhật `src/store/prisma-store.js` — `storeBatch()` trả về metadata, implement `findExistingIds()`.
- [x] Cập nhật `src/store/index.js` — delegate `findExistingIds` nếu cần.
- [x] Cập nhật `src/core/base-crawler.js` — thêm `resolveCheckpoint()` và `shouldStopPagination()` helper; sửa `start()` để auto-inject cursor.
- [x] Cập nhật `types/core.d.ts` và `types/store.d.ts` — export type mới.
- [x] `tests/core/base-crawler.checkpoint.test.js` — unit tests cho ACL.
- [x] `tests/store/prisma-store.checkpoint.test.js` — unit tests cho `findExistingIds` và `storeBatch` metadata.
- [x] Chạy `npx vitest run tests/core/base-crawler.checkpoint.test.js tests/store/prisma-store.checkpoint.test.js` để đảm bảo pass.
- [x] Chạy targeted regression (`tests/core`, `tests/store`, `tests/benchmark`) — pass; một test cũ fail do `CATEGORIES` đã thêm `video` và đã được fix.

**Acceptance Criteria:**
- Given `CrawlCheckpoint` table tồn tại và `ActionDescriptor.checkpointResolver` được đăng ký, when `start()` được gọi không có `cursor`, then `lastCursor` được inject vào `args` trước khi gọi handler.
- Given `storeBatch()` được gọi, then nó trả về `{ insertedCount, duplicateCount, totalCount, schemaValid }`.
- Given `shouldStopPagination(items)` được gọi với items toàn duplicates, then trả `true`.
- Given caller truyền `cursor` hoặc `resume: false`, then không ghi đè bằng checkpoint.
- Given test suite, when chạy `npm test`, then không có regression.

## Spec Change Log

- 2026-09-09 — Tạo story từ sprint-change-proposal-2026-09-09-checkpoint-resume.md; phê duyệt kiến trúc bởi Luisphan.
- 2026-09-09 — Applied code review patches: cursorField inclusion, resume string coercion, StoreBatchResult-based `shouldStopPagination`, upsert metadata fix, `findExistingIds` ID filtering, type exports, and JSDoc alignment.

### Review Findings (from bmad-code-review)

- [x] [Review][Patch] Custom `cursorField` overwritten by checkpoint — fixed by including `cursorField` in `hasCallerCursor` check.
- [x] [Review][Patch] `fallbackCursorFields` non-array crash — fixed with `Array.isArray` guard.
- [x] [Review][Patch] Numeric/empty `lastCursor` ignored — fixed with explicit `!== undefined/null/''` check.
- [x] [Review][Patch] In-page duplicate IDs break early termination — fixed with `Set` deduplication.
- [x] [Review][Patch] `shouldStopPagination` false-positive on items missing `id` — fixed with stricter ID filtering.
- [x] [Review][Patch] `resolveCheckpoint` skipped when `args` undefined — fixed by normalizing `args || {}`.
- [x] [Review][Patch] `storeContent` JSDoc return type mismatch — fixed to `StoreBatchResult`.
- [x] [Review][Patch] `upsert` mode inflated `insertedCount` — fixed by checking `findExistingIds` before upsert.
- [x] [Review][Patch] `args.resume` string `'false'` not handled — fixed with multi-format check.
- [x] [Review][Patch] Missing `StoreBatchResult`/`CheckpointResolution` exports — added to `types/index.d.ts`.
- [x] [Review][Patch] Silent catch hides resolver errors — added `console.warn` logging.
- [x] [Review][Patch] `findExistingIds` missing from contract test — added assertion.
- [x] [Review][Defer] `findExistingIds` hardcoded to `Post` table only — deferred, pre-existing; Story 25.7 will handle comment pagination.
- [x] [Review][Defer] `findExistingIds` lacks chunking — deferred; Prisma handles `IN` clauses fine up to ~10k IDs; add chunking if profiling shows need.
- [x] [Review][Defer] Numeric cursor type coercion — deferred; platform-specific resolvers should normalize cursor types.
- [x] [Review][Dismiss] Test files omitted from diff — they were created and tracked; diff generation used stale path list.

## Design Notes

- `checkpointResolver` giúp chuẩn hóa `targetKey` cho từng action mà không hardcode trong `AbstractCrawler`.
- `storeBatch()` metadata được dùng bởi `shouldStopPagination()` và telemetry nâng cao.
- `findExistingIds()` dùng `id IN (...)` với index PK, hiệu quả với batch ≤ 500.

## Verification

**Commands:**
- `npx vitest run tests/core/base-crawler.checkpoint.test.js tests/store/prisma-store.checkpoint.test.js` — ✅ 16/16 pass
- `npx vitest run tests/core/base-crawler.test.js tests/store/prisma-store.test.js` — ✅ 38/38 pass
- `npx vitest run tests/benchmark` — ✅ pass (no regression in Epic 34)

---

## Validation Report (2026-09-09)

| Check | Result | Notes |
|-------|--------|-------|
| Story file exists | ✅ | `stories/25-5-core-checkpoint-resume-engine.md` |
| Sprint status updated | ⚠️ | `sprint-status.yaml` still `backlog`; will update to `ready-for-dev` after validation. |
| Epics.md alignment | ✅ | Story 25.5 in Epic 25; AC of Story 10.1 / 10.2 / 25.1 already updated. |
| Architecture spine alignment | ✅ | AD-11 and AD-12 already updated with `checkpointResolver` and `getCheckpoint`/`storeBatch` metadata. |
| Codebase analysis | ✅ | `AbstractCrawler.start()` does not auto-checkpoint; `PrismaStore.storeBatch()` returns `undefined`; `findExistingIds` not implemented. |
| Code map files exist | ✅ | `src/core/base-crawler.js`, `src/core/base-store.js`, `src/store/prisma-store.js`, `src/store/index.js`, `src/core/types.js` all present. |
| `types/xactions.d.ts` | ⚠️ | File does not exist in repo; will create if needed. |
| Test files | ⚠️ | `tests/core/base-crawler.checkpoint.test.js` and `tests/store/prisma-store.checkpoint.test.js` do not exist yet; will create during implementation. |
| Regression risk | ✅ | Changes are additive to core contracts; no breaking changes to existing callers. |

**Validation Verdict:** Story 25.5 is well-formed and ready for implementation. The only gaps are the missing test files and `types/xactions.d.ts` if not already generated. The story now has sufficient context for `bmad-dev-story` to implement without guesswork.
