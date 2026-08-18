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

### Verification

- `npx prisma validate` passes.
- `npx prisma migrate dev` (or `migrate deploy` on the target migration) applies cleanly.
- `node src/store/index.js` or `node src/core/index.js` does not throw on parse.

---

## Current Implementation State (IMPORTANT)

**This story appears to already have working artifacts in the repository.** The dev agent MUST verify and refine rather than blindly rewrite.

- `prisma/schema.prisma` already contains `Post`, `Comment`, and `CrawlCheckpoint` models (lines 328–406).
- `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql` already creates GIN indexes and expression indexes.
- `src/store/prisma-store.js` already implements `PrismaStore` with 500-record chunking, topological comment insertion, and `upsert` option.
- `src/store/index.js` exports `AbstractStore` and `PrismaStore`.

**What is likely still missing / needs verification:**
1. Unit or integration tests for `PrismaStore` against a real PostgreSQL instance.
2. Verification that `storeCommentBatch` correctly handles missing `parentCommentId` values that refer to a parent in the same depth batch.
3. Validation that `metadata` is forwarded correctly and not double-serialised.
4. Verification that `Post.category` is one of the allowed `CATEGORIES` before Prisma write.
5. Verification that `CrawlCheckpoint` fields are fully wired to `AbstractCrawler` / future checkpoint API.
6. GIN/expression index performance verification on a 1M-row sample (separate NFR benchmark story).

---

## Developer Context

### Architecture Decisions Relevant to This Story

- **AD-4 — Namespaced PostgreSQL Storage via Prisma & JSONB GIN Indexing [ADOPTED]**
  - `Post.id = "${platform}:${externalId}"` with `@@unique([platform, externalId])`
  - `Comment.id = "${platform}:${postExternalId}:${commentExternalId}"` with `@@unique([platform, externalId, postId])`
  - `metadata Json?` must have GIN index; expression indexes on `price`, `phone`, `salary`
  - All batch writes chunked at 500 records; default `createMany` + `skipDuplicates`; `upsert` only after benchmark
  - `Post.mediaUrls` is `String[]` (PostgreSQL native array)

- **AD-6 — Hierarchical Comment Tree Normalization & Topological Insertion [ADOPTED]**
  - `Comment.depth` is mandatory for topological sort
  - Root comments (`parentCommentId = null`, `depth = 0`) are inserted before sub-replies
  - Max depth 3 and max comments 500 are crawler-level constraints

- **AD-10 — 3-Tier Incremental Gap-Filling & Retention Policy [ADOPTED]**
  - Raw `Post`/`Comment` data has a 30-day retention target for XActions
  - `crawledAt` index is required for fast cleanup

- **AD-12 — CrawlCheckpoint State for Idempotent Resume [ADOPTED]**
  - Unique on `[platform, targetType, targetKey]`
  - Status values: `running`, `paused`, `failed`, `completed`, `stalled`

### Files to Read Before Modifying

- `src/core/base-store.js` — `AbstractStore` contract
- `src/core/types.js` — `PostItem` / `CommentItem` typedefs and helper functions
- `src/core/index.js` — core exports
- `src/store/prisma-store.js` — existing implementation
- `src/store/index.js` — store module exports
- `prisma/schema.prisma` — current schema
- `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql` — raw index migration
- `api/lib/prisma.js` — how the shared PrismaClient is instantiated

### Code Conventions

- Pure ESM (`import`/`export`) only.
- License header: `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.`
- JSDoc for public methods and typedefs.
- `src/core/` must remain zero-runtime-dependency.
- `PrismaStore` lives in `src/store/` because it depends on `@prisma/client`.
- Error handling should throw `PlatformError` (not plain `Error`) for consistency with Story 10.1.

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

### Batch Strategy

- Chunk size: 500 records.
- Post default: `prisma.post.createMany({ data: chunk, skipDuplicates: true })`.
- Comment default: group by `depth`, then for each depth group chunk and `createMany`.
- Upsert option: per-record `upsert({ where: { id }, update, create })` inside a transaction chunk. **Do not use 500 parallel `upsert` calls without benchmark.**

### Category Validation

- Validate `category` with `isValidCategory()` from `src/core/types.js` before writing.
- Allowed values: `social`, `ecom`, `realestate`, `recruitment`, `b2b`.

---

## Architecture Compliance

- Hexagonal Architecture: `PrismaStore` is an adapter implementing the `AbstractStore` port.
- `src/core/` remains dependency-free; `PrismaStore` belongs to `src/store/`.
- Namespaced IDs must be generated/verified via `generatePostId()` and `generateCommentId()` helpers.
- `metadata` is opaque at schema level; schema contract validation is Story 10.5.
- Retention cleanup and checkpoint API are future stories; schema must support them.

---

## File Structure Requirements

| File / Path | Purpose |
|---|---|
| `prisma/schema.prisma` | `Post`, `Comment`, `CrawlCheckpoint` models |
| `prisma/migrations/20260818233000_universal_scraping_schema/migration.sql` | GIN and expression indexes (already exists) |
| `src/store/prisma-store.js` | `PrismaStore` implementation (already exists) |
| `src/store/index.js` | Store module barrel export |
| `src/core/types.js` | ID generation helpers and category validation |
| `src/core/base-store.js` | `AbstractStore` interface |
| `tests/store/prisma-store.test.js` (NEW) | Integration tests for `PrismaStore` |

---

## Testing Requirements

- `npx prisma validate` must pass.
- `npx prisma migrate dev` (or `migrate deploy`) must apply cleanly on a fresh database.
- `node src/store/prisma-store.js` must parse without syntax errors.
- Add integration tests for `PrismaStore`:
  - `storeContent` and `storeBatch` write a single `PostItem` and a batch of 500+ `PostItem`s.
  - `storeComment` and `storeCommentBatch` write root and nested comments in correct depth order.
  - Verify `@@unique` constraints work: re-writing the same `platform`/`externalId` with `skipDuplicates` does not error.
  - Verify `upsert` option updates existing records.
  - Verify comment self-referential FK: a child comment whose parent is in the same batch still writes successfully.
- GIN/expression-index performance test is out of scope for this story; belongs to NFR/benchmark story.

**Test environment note:** `PrismaStore` uses `api/lib/prisma.js`. For tests, ensure `DATABASE_URL` points to a real PostgreSQL test database. The `vitest` environment is Node.js. Do not mock Prisma; use a real test DB or transactional cleanup.

---

## Previous Story Intelligence (Story 10.1)

- `AbstractStore` defines `init()`, `storeContent()`, `storeBatch()`, `storeComment()`, `storeCommentBatch()`, `close()`.
- `PostItem` and `CommentItem` shapes are in `src/core/types.js`.
- `AbstractStore` throws `Error('Method not implemented: ...')` for abstract methods; concrete subclasses must override.
- `AbstractCrawler` calls `AbstractStore` methods and must not couple to Prisma directly.
- Error hierarchy: use `PlatformError` with `ErrorTypes` and `SuggestedActions` for business errors.
- Category validation and ID generation helpers are already available.

---

## Git Intelligence (Recent Commits)

Recent commits on `main`:
- `cd425ab` fix(deps): downgrade jsdom to 24.1.3 for Node 18 compatibility
- `e3b943a` refactor(core): patch Story 10.1 review findings
- `3bd598c` feat(core): resolve Story 10.1 remaining items — undici, tests, JSDoc
- `0b0906e` docs(impl): create and validate Story 10.1 core interfaces

Pattern: implementation artifacts live under `_bmad-output/implementation-artifacts/`, schema changes are committed under `prisma/`, and runtime code under `src/core/` / `src/store/`. Commits are atomic and focused on a single story.

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
4. **Comment ID format.** `Comment.id` should be `"${platform}:${postExternalId}:${commentExternalId}"`. If `postId` is already namespaced, extract `postExternalId` before calling `generateCommentId()`.
5. **Category validation.** `Post.category` is a plain `String` in the schema; enforce allowed values before writing.
6. **Upsert performance.** The current implementation upserts one by one. Benchmark before enabling by default for large batches.
7. **No public package export for `./store`.** If consumers need `PrismaStore`, update `package.json` `exports` to include `"./store": "./src/store/index.js"`.

---

## Open Questions for Product/Architect

1. Should `Post`/`Comment` category be a Prisma `enum` instead of `String`?
2. Should `PrismaStore` upsert be the default when metrics like `likesCount` change, or remain `createMany + skipDuplicates`?
3. Is the 1M-row `<10ms` query target part of this story or a separate NFR/benchmark story?
4. Should `package.json` exports include `./store` so external modules can import `PrismaStore`?

---

## Story Completion Status

- **Status:** `ready-for-dev`
- **Context engine analysis completed:** comprehensive developer guide created.
- **Next step:** Dev agent reviews existing `prisma/schema.prisma`, `src/store/prisma-store.js`, and migration; adds tests; verifies ACs.
