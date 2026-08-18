# 10.2 — Prisma Post & Comment Schema with Namespaced ID, JSONB GIN & Batch Chunking

| | |
|---|---|
| **Story ID** | 10.2 |
| **Story Key** | `10-2-prisma-post-comment-relational-schema-migration` |
| **Epic** | 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces |
| **Status** | ready-for-dev |
| **Author** | nich (@nichxbt) |

---

## User Story

**As a** Backend & Platform Engineer,
**I want** to extend `prisma/schema.prisma` with model `Post` and `Comment` (supporting Namespaced ID `${platform}:${externalId}`, column `metadata Json?`), and implement `PrismaStore`,
**So that** all multi-industry scraped data is stored centrally, no ID collision occurs, and Nowing can query price/phone/salary quickly using GIN/expression indexes.

---

## Business Context

- Epic 10 unifies 100% scraped data into PostgreSQL via Prisma ORM.
- `Post` and `Comment` are the canonical raw-data lake tables for every platform/category.
- Namespaced IDs prevent cross-platform collision (e.g. `twitter:123` vs `facebook:123`).
- JSONB `metadata` supports per-industry flexible fields (price, phone, salary, etc.) while GIN/expression indexes keep lead-filter queries fast.
- `CrawlCheckpoint` enables 3-tier incremental gap-filling and idempotent resume.
- `PrismaStore` is the first concrete implementation of `AbstractStore` from Story 10.1.

---

## Acceptance Criteria

### Post model

- **Given** file `prisma/schema.prisma`
- **When** model `Post` is defined with fields:
  - `id` (String `@id`, format `${platform}:${externalId}`)
  - `platform` (String)
  - `externalId` (String)
  - `category` (String)
  - `authorId`, `authorName` (String)
  - `authorAvatar`, `authorUrl`, `postUrl` (String?)
  - `content` (String `@db.Text`)
  - `mediaUrls` (String[])
  - `likesCount`, `repostsCount`, `repliesCount`, `viewsCount` (Int @default(0))
  - `metadata` (Json?)
  - `publishedAt` (DateTime?)
  - `crawledAt` (DateTime @default(now()))
- **Then** `@@unique([platform, externalId])` exists and `npx prisma validate` passes.

### Comment model

- **Given** model `Post` exists
- **When** model `Comment` is defined with fields:
  - `id` (String `@id`, format `${platform}:${postExternalId}:${commentExternalId}`)
  - `platform`, `externalId`, `postId` (String)
  - `parentCommentId` (String?)
  - `depth` (Int @default(0))
  - `authorId`, `authorName` (String)
  - `authorAvatar` (String?)
  - `content` (String `@db.Text`)
  - `likesCount`, `subCommentsCount` (Int @default(0))
  - `metadata` (Json?)
  - `publishedAt` (DateTime?)
  - `crawledAt` (DateTime @default(now()))
  - self-referential relation `@relation("CommentReplies")` with `parentComment` / `subReplies`
- **Then** `@@unique([platform, externalId, postId])` exists and migration is valid.

**Decision note:** The three-part `Comment.id` format is kept intentionally. The `postExternalId` segment makes it possible to look up `parentCommentId` directly from a namespaced parent ID and keeps comment IDs globally unique across posts and platforms. `@@unique([platform, externalId, postId])` additionally prevents collisions.

### Indexes

- **Given** migration is generated
- **When** raw SQL migration runs
- **Then**:
  - GIN index on `Post.metadata`
  - GIN index on `Comment.metadata`
  - Expression indexes on `Post` for `metadata->>'price'`, `metadata->>'phone'`, `metadata->>'salary'`
  - B-tree indexes on `Post.crawledAt` and `Comment.crawledAt` for retention cleanup

### CrawlCheckpoint model

- **Given** `Post` and `Comment` exist
- **When** model `CrawlCheckpoint` is defined with:
  - `id` (String `@id @default(cuid())`)
  - `platform`, `targetType`, `targetKey` (String)
  - `status` (String @default("running"))
  - `lastCursor` (String?)
  - `lastTimestamp` (DateTime?)
  - `lastCrawledAt` (DateTime?)
  - `nextScheduledAt` (DateTime?)
  - `errorCount` (Int @default(0))
  - `createdAt`, `updatedAt` (DateTime)
- **Then** `@@unique([platform, targetType, targetKey])` exists and migration is valid.

### PrismaStore batch writer

- **Given** models `Post` and `Comment` exist
- **When** `src/store/prisma-store.js` is implemented extending `AbstractStore`
- **Then** it:
  - implements `init()`, `storeContent()`, `storeBatch()`, `storeComment()`, `storeCommentBatch()`, `close()`
  - chunks writes by 500 records
  - default uses `createMany` with `skipDuplicates: true`
  - supports `upsert` via option `{ upsert: true }`
  - inserts comments by `depth` level (topological order) to avoid self-referencing FK violation
  - uses `generatePostId()` / `generateCommentId()` helpers for missing IDs
  - stores metadata as-is and maps `PostItem` / `CommentItem` fields to Prisma model fields

### Category validation in store

- **Given** `PrismaStore.storeBatch()` receives posts
- **When** a post has an invalid `category`
- **Then** `PrismaStore` throws `PlatformError` with `ErrorTypes.INVALID_ARGS` and `SuggestedActions.USE_ACTIONS_LIST` **before** any Prisma write.

### Package exports

- **Given** external modules need `PrismaStore`
- **When** package.json exports are updated
- **Then** add `"./store": "./src/store/index.js"` to `package.json` `exports`.

### Verification

- `npx prisma validate` passes.
- `npx prisma migrate dev` (or `migrate deploy`) applies cleanly.
- `node src/store/index.js` or `node src/core/index.js` does not throw on parse.

---

## Current Implementation State

**This story already has working artifacts in the repository. The dev agent must verify and refine, not rewrite from scratch.**

Existing artifacts:
- `prisma/schema.prisma` lines 328–406 — `Post`, `Comment`, `CrawlCheckpoint` models
- `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql` — GIN and expression indexes
- `src/store/prisma-store.js` — `PrismaStore` with 500-record chunking, topological comment insertion, `upsert` option
- `src/store/index.js` — exports `AbstractStore` and `PrismaStore`

**What still needs verification or completion:**
1. Integration tests for `PrismaStore` against a real PostgreSQL instance.
2. `storeCommentBatch` behavior when a parent and child comment appear in the same input batch.
3. `metadata` is forwarded as plain JS object, not double-serialized.
4. `Post.category` is validated with `isValidCategory()` before Prisma writes.
5. `package.json` exports includes `./store` if other modules need `PrismaStore`.

---

## Developer Context

### Architecture Decisions Relevant to This Story

- **AD-4 — Namespaced PostgreSQL Storage via Prisma & JSONB GIN Indexing** (`ARCHITECTURE-SPINE.md`)
  - `Post.id = "${platform}:${externalId}"` with `@@unique([platform, externalId])`
  - `metadata Json?` with GIN index; expression indexes on `price`, `phone`, `salary`
  - batch writes chunked at 500 records; default `createMany` + `skipDuplicates`
- **AD-6 — Hierarchical Comment Tree Normalization & Topological Insertion**
  - `Comment.depth` is mandatory; root comments inserted before sub-replies
- **AD-10 — 3-Tier Incremental Gap-Filling & Retention Policy**
  - Raw `Post`/`Comment` data has 30-day retention target; `crawledAt` index for cleanup
- **AD-12 — CrawlCheckpoint State for Idempotent Resume**
  - Unique on `[platform, targetType, targetKey]`

### Epic Review Resolution Status

Several Epic 10 review issues are already resolved in the current schema and migration:

| Review issue | Status | Evidence |
|---|---|---|
| P0.4 `CrawlCheckpoint` missing status fields | Resolved | `prisma/schema.prisma` lines 394–398 include `status`, `errorCount`, `lastCrawledAt`, `nextScheduledAt` |
| P1.7 `Comment.onDelete: Cascade` data loss risk | Resolved | `prisma/schema.prisma` line 380 uses `onDelete: SetNull` for `parentComment` |
| P2.4 `crawledAt` index for cleanup missing | Resolved | `prisma/schema.prisma` lines 357, 385; migration.sql lines 11–12 add B-tree indexes on `crawledAt` |

### Files to Read Before Modifying

1. `src/core/base-store.js` — `AbstractStore` contract
2. `src/core/types.js` — `PostItem` / `CommentItem` typedefs, `isValidCategory()`, `generatePostId()`, `generateCommentId()`
3. `src/core/error-envelope.js` — `PlatformError` shape and `ErrorTypes` / `SuggestedActions`
4. `src/store/prisma-store.js` — existing PrismaStore implementation
5. `prisma/schema.prisma` — current schema
6. `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql` — raw index migration
7. `api/lib/prisma.js` — shared `PrismaClient` instantiation
8. `package.json` — exports and dependencies

### Code Conventions

- Pure ESM (`import`/`export`) only.
- License header: `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.`
- JSDoc for public methods and typedefs.
- `src/core/` must remain zero-runtime-dependency.
- `PrismaStore` lives in `src/store/` because it depends on `@prisma/client`.
- Throw `PlatformError` (not plain `Error`) for business-level errors.

---

## Technical Requirements

### Stack & Versions

- `@prisma/client@^5.7.1`
- `prisma@^5.7.1`
- PostgreSQL (production)
- Node.js `>=18.0.0`

### Prisma/PostgreSQL Specifics

- Prisma 5.x does **not** natively support `USING gin`.
- Raw SQL migration must be placed under `prisma/migrations/<name>/migration.sql` and applied with `npx prisma migrate deploy`.
- Do **not** run `prisma db pull` after applying raw-GIN migrations; it will drop the `USING gin` clause.
- `String[]` maps to PostgreSQL native `text[]`.
- `Json?` maps to PostgreSQL `jsonb`.

### Data Mapping

| `PostItem` field | `Post` model field |
|---|---|
| `id` | `id` |
| `platform` | `platform` |
| `externalId` | `externalId` |
| `category` | `category` |
| `authorId` | `authorId` |
| `authorName` | `authorName` |
| `authorAvatar` | `authorAvatar` |
| `authorUrl` | `authorUrl` |
| `postUrl` | `postUrl` |
| `content` | `content` |
| `mediaUrls` | `mediaUrls` |
| `likesCount` | `likesCount` |
| `repostsCount` | `repostsCount` |
| `repliesCount` | `repliesCount` |
| `viewsCount` | `viewsCount` |
| `metadata` | `metadata` |
| `publishedAt` | `publishedAt` |
| `crawledAt` | `crawledAt` |

| `CommentItem` field | `Comment` model field |
|---|---|
| `id` | `id` |
| `platform` | `platform` |
| `externalId` | `externalId` |
| `postId` | `postId` |
| `parentCommentId` | `parentCommentId` |
| `depth` | `depth` |
| `authorId` | `authorId` |
| `authorName` | `authorName` |
| `authorAvatar` | `authorAvatar` |
| `content` | `content` |
| `likesCount` | `likesCount` |
| `subCommentsCount` | `subCommentsCount` |
| `metadata` | `metadata` |
| `publishedAt` | `publishedAt` |
| `crawledAt` | `crawledAt` |

### Category Constants Mapping

| `src/core/types.js` constant | Schema value |
|---|---|
| `CATEGORIES.SOCIAL` | `social` |
| `CATEGORIES.ECOMMERCE` | `ecom` |
| `CATEGORIES.REAL_ESTATE` | `realestate` |
| `CATEGORIES.RECRUITMENT` | `recruitment` |
| `CATEGORIES.B2B` | `b2b` |

### Batch Strategy

- Chunk size: 500 records.
- Post default: `prisma.post.createMany({ data: chunk, skipDuplicates: true })`.
- Comment default: group by `depth`, then for each depth group chunk and `createMany`.
- Upsert option: sequential per-record `upsert({ where: { id }, update, create })` inside a transaction chunk.

### Upsert Performance Trade-offs

- Current `PrismaStore` uses sequential upsert to avoid race conditions and duplicate-key conflicts.
- Alternative: batch upsert via `createMany` + `updateMany` is more complex and not benchmarked.
- Before making `upsert` the default for large batches, benchmark with 500, 1,000, and 5,000 records and measure records/second and Prisma connection pool usage.

### Category Validation

- Validate `category` with `isValidCategory()` from `src/core/types.js` before writing.
- Allowed schema values: `social`, `ecom`, `realestate`, `recruitment`, `b2b`.

---

## Architecture Compliance

- Hexagonal Architecture: `PrismaStore` is an adapter implementing the `AbstractStore` port.
- `src/core/` remains dependency-free; `PrismaStore` belongs to `src/store/`.
- Namespaced IDs must be generated/verified via `generatePostId()` and `generateCommentId()` helpers.
- `metadata` is opaque at schema level; schema contract validation is Story 10.5.
- Retention cleanup and checkpoint API are future stories; schema must support them.

---

## File Structure & Reading Order

| File / Path | Purpose |
|---|---|
| `prisma/schema.prisma` | `Post`, `Comment`, `CrawlCheckpoint` models |
| `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql` | GIN and expression indexes (already exists) |
| `src/store/prisma-store.js` | `PrismaStore` implementation (already exists) |
| `src/store/index.js` | Store module barrel export |
| `src/core/types.js` | ID generation helpers, category constants, validation |
| `src/core/base-store.js` | `AbstractStore` interface |
| `src/core/error-envelope.js` | Error hierarchy and `toEnvelope()` |
| `package.json` | exports and dependency versions |
| `tests/store/prisma-store.test.js` (NEW) | Integration tests for `PrismaStore` |

---

## Testing Requirements

### Environment Setup

- `PrismaStore` loads `PrismaClient` from `api/lib/prisma.js`.
- For tests, set `DATABASE_URL` to a real PostgreSQL test database.
- Before running tests, apply schema to the test DB: `npx prisma migrate deploy`.
- Clean test data between tests with a transaction rollback or a truncate script.
- Do **not** mock `PrismaClient`; use real DB calls.

### Test Cases

- `npx prisma validate` passes.
- `npx prisma migrate dev` (or `migrate deploy`) applies cleanly on a fresh database.
- `node src/store/index.js` parses without syntax errors.
- `PrismaStore` integration tests:
  - `storeContent` and `storeBatch` write a single `PostItem` and a batch of 500+ `PostItem`s.
  - `storeComment` and `storeCommentBatch` write root and nested comments in correct depth order.
  - Verify `@@unique` constraints: re-writing the same `platform`/`externalId` with `skipDuplicates` does not error.
  - Verify `upsert` option updates existing records.
  - Verify comment self-referential FK: a child comment whose parent is in the same batch still writes successfully.
  - Verify invalid `category` throws `PlatformError` before any Prisma write.
- GIN/expression-index performance test is out of scope for this story; belongs to NFR/benchmark story.

### Verification of Topological Comment Insertion

- Review `src/store/prisma-store.js` lines 116–141.
- Confirm comments are grouped by `depth` before any `createMany`.
- Write an integration test with this data:
  - 1 root comment (`depth = 0`, `parentCommentId = null`)
  - 1 sub-reply (`depth = 1`, `parentCommentId = root.id`)
  - 1 sub-sub-reply (`depth = 2`, `parentCommentId = sub-reply.id`)
  - All in the same `storeCommentBatch` call
- Assert no `Foreign Key Violation` error and final row count is 3.

---

## Previous Story Intelligence (Story 10.1)

- `AbstractStore` defines `init()`, `storeContent()`, `storeBatch()`, `storeComment()`, `storeCommentBatch()`, `close()`.
- `PostItem` and `CommentItem` shapes are in `src/core/types.js`.
- `AbstractStore` throws `Error('Method not implemented: ...')` for abstract methods; concrete subclasses must override.
- `AbstractCrawler` calls `AbstractStore` methods and must not couple to Prisma directly.
- `ErrorTypes` and `SuggestedActions` constants are defined in `src/core/error-envelope.js`.
- **PlatformError envelope contract (current code):** `toEnvelope()` returns `{ code, type, message, retryAfter, suggestedAction, accountId, platform }`. Use these fields when surfacing errors from `PrismaStore` to callers.

---

## Git Intelligence (Recent Commits)

Recent commits on `main`:
- `cd425ab` fix(deps): downgrade jsdom to 24.1.3 for Node 18 compatibility
- `e3b943a` refactor(core): patch Story 10.1 review findings
- `3bd598c` feat(core): resolve Story 10.1 remaining items — undici, tests, JSDoc
- `0b0906e` docs(impl): create and validate Story 10.1 core interfaces

Pattern: implementation artifacts live under `_bmad-output/implementation-artifacts/`, schema changes are committed under `prisma/`, runtime code under `src/core/` / `src/store/`. Commits are atomic and focused on a single story.

---

## Latest Tech Information

- Prisma 5.7.x does not generate GIN indexes from schema. Raw SQL migrations are required.
- `createMany` with `skipDuplicates: true` requires a unique constraint on the model; here `@@unique([platform, externalId])` for `Post` and `@@unique([platform, externalId, postId])` for `Comment` satisfy that.
- PostgreSQL `jsonb` GIN index is most efficient for `?`, `?&`, `?|`, `@>`, `@@` JSON operators.
- Expression indexes (`metadata->>'price'`) allow fast equality/range queries on scalar JSON paths.
- `onDelete: SetNull` on `Comment.parentComment` is the safer default to avoid cascade-deleting sub-replies.

---

## Project Context Reference

- Project: XActions
- Project key: XACT
- Repository: https://github.com/nirholas/XActions
- Tech: Node.js ESM, Prisma, PostgreSQL, Vitest
- `package.json` engines: `node >=18.0.0`
- `package.json` dev/test: `vitest`, `supertest`
- Architecture: Hexagonal + Tiered Hybrid Signer + Adaptive Rate Limiter

---

## Warnings & Potential Pitfalls

1. **Existing implementation may be incomplete.** Do not assume it is fully done; verify each AC.
2. **Raw GIN migration.** Never run `prisma db pull` after applying `USING gin` migrations.
3. **Topological comment insertion.** `createMany` in the same depth group is safe, but never mix different depths in the same `createMany` call.
4. **Comment ID format.** `Comment.id` uses `"${platform}:${postExternalId}:${commentExternalId}"`. If `postId` is already namespaced, extract `postExternalId` before calling `generateCommentId()`.
5. **Category validation.** `Post.category` is a plain `String` in the schema; enforce allowed values before writing.
6. **Upsert performance.** The current implementation upserts one by one. Benchmark before enabling by default for large batches.
7. **No public package export for `./store`.** If consumers need `PrismaStore`, update `package.json` `exports`.

---

## Open Questions for Product/Architect

1. Should `Post`/`Comment` `category` become a Prisma `enum` instead of `String`?
2. Should `PrismaStore` use `upsert` as default when metrics like `likesCount` change, or remain `createMany + skipDuplicates`?
3. Should `package.json` exports include `./store` so external modules can import `PrismaStore`?

---

## Story Completion Status

- **Status:** `ready-for-dev`
- **Context engine analysis completed:** comprehensive developer guide created and validated.
- **Next step:** Dev agent reviews existing `prisma/schema.prisma`, `src/store/prisma-store.js`, and migration; adds tests; verifies ACs.
