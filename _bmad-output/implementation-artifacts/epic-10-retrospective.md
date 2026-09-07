# Epic 10 Retrospective: Data & Platform Foundation for Universal Scraping

Status: done  
Date: 2026-09-08

## Summary

Epic 10 xây dựng **foundation layer** cho universal scraping architecture: core domain interfaces, Prisma schema, AI dataset export, checkpoint API, metadata schema registry, và data retention. Đây là epic prerequisite cho mọi crawler sau này — định nghĩa `PostItem`, `Comment`, `AbstractCrawler`, `AbstractStore`, `CrawlCheckpoint`.

Epic complete across six stories:

| Story | Status | Outcome |
|---|---|---|
| 10.1 Core Domain Interfaces & Error Hierarchy | done | `AbstractCrawler`, `AbstractApiClient`, `AbstractStore`, `AbstractLogin`, `PlatformError` hierarchy |
| 10.2 Prisma Post/Comment Schema Migration | done | `Post`, `Comment` models, GIN indexes, `PrismaStore` |
| 10.3 AI Dataset Export Utility | done | `exportDataset` streaming JSONL/CSV với backpressure |
| 10.4 CrawlCheckpoint Operational API | done | `resume`/`pause`/`retry` API + CLI |
| 10.5 Metadata Schema Contract Registry | done | `MetadataSchemaRegistry`, `/api/schemas`, `x_schema_list`/`x_schema_get` MCP |
| 10.6 Data Retention Cleanup Job | done | `RetentionCleaner`, daily cron, 30-day TTL, admin routes |

Final verification: **~30+ test files** across `src/core/`, `src/store/`, `src/cli/`, `api/routes/`.

**~4000+ lines added** across 8+ commits (`0b0906e2` đến `8593da0d`).

## What Went Well

1. **Architecture-first approach**
   - `AbstractCrawler`/`AbstractApiClient`/`AbstractStore` được định nghĩa trước khi implement.
   - Error hierarchy `PlatformError` → `XACT_*` codes chuẩn hóa mọi error response.
   - `PostItem` contract unified across platforms.

2. **Prisma schema migration clean**
   - `Post` + `Comment` với GIN indexes cho `metadata` JSONB.
   - `PrismaStore` implement `AbstractStore` với validation.

3. **Metadata schema registry**
   - `MetadataSchemaRegistry` load JSON schemas từ disk, cache in-memory.
   - Validate `Post.metadata` by default — bắt lỗi schema drift sớm.
   - Ship pilot schemas cho `twitter:social` và `shopee:ecom`.

4. **Retention cleanup production-ready**
   - 30-day raw crawl TTL, 90-day checkpoint purge.
   - ID-based batch chunking + dry-run + platform filter.
   - Admin routes + CLI + scheduler wired đầy đủ.
   - Review patches: mutex lock, graceful shutdown, batch guard.

## What Was Difficult

1. **Story 10.6 review phát hiện nhiều vấn đề**
   - `PlatformError` constructor calls sai signature.
   - Orphan comment deletion logic không đúng.
   - Thiếu shared mutex giữa scheduler/API/CLI.
   - **Lesson:** Foundation story cần review kỹ nhất.

2. **Schema validation strictness**
   - `Post.metadata` validation reject nhiều existing test fixtures.
   - Phải update fixtures để conform Shopee e-commerce schema.

3. **TypeScript strict mode**
   - `types/index.d.ts` và `types/store.d.ts` cần align với implementation.
   - `types/metadata-schema.d.ts` mới cho registry.

## Key Decisions

1. **`AbstractCrawler`/`AbstractApiClient` là base cho mọi crawler**
   - Mọi scraper mới (Twitter, Facebook, Shopee, v.v.) kế thừa từ đây.
   - `resolveProxy` gate trong `AbstractApiClient` unified proxy logic.

2. **`PostItem` là single output contract**
   - Mọi crawler normalize về `PostItem` — không có platform-specific output.
   - `metadata` field chứa platform-specific data, validated bởi `MetadataSchemaRegistry`.

3. **`CrawlCheckpoint` cho resumable scraping**
   - `resume`/`pause`/`retry` operations.
   - `lastCrawledAt` tracking cho incremental crawl.

4. **Retention cleaner tách riêng**
   - `RetentionCleaner` + `retentionScheduler` — không embed vào crawler.
   - Admin API + CLI cho manual trigger.

## Follow-up Recommendations

1. **Schema registry cần thêm platform schemas**
   - Hiện chỉ có `twitter:social` và `shopee:ecom`.
   - Cần schemas cho Facebook, LinkedIn, VN platforms (Epic 21/22).

2. **Retention policy per-platform**
   - Hiện global 30-day — có thể cần per-platform TTL.

3. **Checkpoint API cho real-time pause**
   - `pause` hiện chỉ set flag — chưa có real-time interrupt.

## Final State

- Epic 10 status: **done**
- All six stories: **done**
- Retrospective: **done**
- Foundation ready cho Epic 11+ crawlers
