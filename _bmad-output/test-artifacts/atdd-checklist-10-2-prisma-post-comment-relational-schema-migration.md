---
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-04c-aggregate'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-19'
storyId: '10.2'
storyKey: '10-2-prisma-post-comment-relational-schema-migration'
storyFile: '_bmad-output/implementation-artifacts/10-2-prisma-post-comment-relational-schema-migration.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-10-2-prisma-post-comment-relational-schema-migration.md'
generatedTestFiles:
  - 'tests/store/prisma-store.test.js'
inputDocuments:
  - '_bmad-output/implementation-artifacts/10-2-prisma-post-comment-relational-schema-migration.md'
  - '_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md'
  - 'prisma/schema.prisma'
  - 'prisma/migrations/20260818233000_universal_scraping_schema/migration.sql'
---

# ATDD Checklist — Story 10.2: Prisma Post & Comment Relational Schema Migration

> **TDD Phase: RED PHASE (Scaffolds Generated)**  
> Acceptance test scaffolds generated with `it.skip()` in `tests/store/prisma-store.test.js`.  
> Activated tests will fail until implementation tasks are completed.

---

## 1. Story & Acceptance Criteria Overview

- **Story ID:** 10.2
- **Story Key:** `10-2-prisma-post-comment-relational-schema-migration`
- **Module Under Test:** `prisma/schema.prisma`, `src/store/prisma-store.js`, `src/store/index.js`, `package.json`
- **Primary Pattern:** Hexagonal Persistence Adapter (`PrismaStore` implementing `AbstractStore`), JSONB GIN Indexes, Topological Comment Tree Insertion.

---

## 2. Test Strategy & Levels Matrix

| Test Level | Scope / Target | Priority | Test File |
|---|---|---|---|
| **Contract / Unit** | `PrismaStore` inherits `AbstractStore`, implements methods, accepts DI | P0 | `tests/store/prisma-store.test.js` |
| **Domain Validation** | Category validation throws `PlatformError` (`INVALID_ARGS`) before write | P0 | `tests/store/prisma-store.test.js` |
| **Integration (Batch)** | `storeBatch` chunks 500 records, `skipDuplicates`, `upsert` mode, JSONB metadata | P0 | `tests/store/prisma-store.test.js` |
| **Integration (Tree)** | `storeCommentBatch` topological sort by depth (no FK violation), 3-part ID | P0 | `tests/store/prisma-store.test.js` |
| **Schema & SQL** | Prisma model constraints (`Post`, `Comment`, `CrawlCheckpoint`), GIN / B-Tree migration | P1 | `tests/store/prisma-store.test.js` |
| **Package Export** | `package.json` exports `./store` | P2 | `tests/store/prisma-store.test.js` |

---

## 3. Acceptance Criteria Coverage Mapping

### AC1 — Post Model & ID Normalization
- [ ] `normalizes post with namespaced ID \${platform}:\${externalId} when ID is omitted` (P0)
- [ ] `stores a single post via storeContent() delegating to storeBatch()` (P1)
- [ ] `writes posts in chunks of 500 records with skipDuplicates: true by default` (P0)
- [ ] `supports upsert mode ({ upsert: true }) to update existing posts without duplicate key collision` (P1)
- [ ] `stores rich metadata JSON as plain object without double JSON-stringification` (P1)

### AC2 — Comment Model & Topological Tree Insertion (AD-6)
- [ ] `normalizes comment id with 3-part format \${platform}:\${postExternalId}:\${commentExternalId}` (P0)
- [ ] `correctly extracts postExternalId even if postId is already namespaced` (P0)
- [ ] `sorts comments by depth ascending before insertion to satisfy foreign key constraints` (P0)
- [ ] `supports upsert mode ({ upsert: true }) for comment updates` (P1)

### AC3 — Category Validation Guard (Store Level)
- [ ] `throws PlatformError (INVALID_ARGS) before Prisma write when post has invalid category` (P0)
- [ ] `accepts all standard categories defined in CATEGORIES constant` (P1)

### AC4 — Schema Constraints & Migration Integrity
- [ ] `schema.prisma defines Post with unique constraint @@unique([platform, externalId])` (P0)
- [ ] `schema.prisma defines Comment with self-referencing relation CommentReplies` (P0)
- [ ] `schema.prisma defines CrawlCheckpoint with unique constraint @@unique([platform, targetType, targetKey])` (P0)
- [ ] `migration.sql contains GIN and expression indexes for metadata fields` (P1)

### AC5 — Module Packaging & Exports
- [ ] `PrismaStore extends AbstractStore and implements all abstract methods` (P0)
- [ ] `allows configuration of custom chunkSize and PrismaClient dependency injection` (P1)
- [ ] `package.json exports "./store" pointing to "./src/store/index.js"` (P2)

---

## 4. Task-by-Task Implementation & Activation Guide

During implementation with `/bmad-dev-story`:

1. **Task 1: Package Exports & Core Contracts**
   - Update `package.json` to add `"./store": "./src/store/index.js"` under `exports`.
   - Remove `.skip` from `Story 10.2: PrismaStore — Class Architecture & Contract Compliance` tests.
   - Run `npx vitest run tests/store/prisma-store.test.js` to verify green.

2. **Task 2: Category Validation Guard**
   - In `src/store/prisma-store.js`, import `isValidCategory` from `../core/types.js` and `PlatformError`, `ErrorTypes`, `SuggestedActions` from `../core/error-envelope.js`.
   - Add pre-write validation in `storeBatch()` checking each post's `category`.
   - Remove `.skip` from `Story 10.2: PrismaStore — Category Validation Guard` tests.
   - Run tests to verify green.

3. **Task 3: Post Model & 500-Record Chunking**
   - Verify `prisma/schema.prisma` and `src/store/prisma-store.js` post batching and upsert logic.
   - Remove `.skip` from `Story 10.2: PrismaStore — Post Batch Storage & 500-Record Chunking` tests.
   - Run tests to verify green.

4. **Task 4: Topological Comment Insertion & Self-Referencing Relations**
   - Verify `normalizeComment` logic and depth grouping in `storeCommentBatch()`.
   - Remove `.skip` from `Story 10.2: PrismaStore — Topological Comment Insertion & Tree Hierarchy` tests.
   - Run tests to verify green.

5. **Task 5: Schema & Migration SQL Verification**
   - Remove `.skip` from `Story 10.2: Prisma Schema & Migration Integrity` tests.
   - Run `npx prisma validate` and full test suite `npx vitest run tests/store`.

---

## 5. Artifact Handoff

- **Story File:** [`_bmad-output/implementation-artifacts/10-2-prisma-post-comment-relational-schema-migration.md`](file:///Users/luisphan/Documents/GitHub/XActions/_bmad-output/implementation-artifacts/10-2-prisma-post-comment-relational-schema-migration.md)
- **Checklist File:** [`_bmad-output/test-artifacts/atdd-checklist-10-2-prisma-post-comment-relational-schema-migration.md`](file:///Users/luisphan/Documents/GitHub/XActions/_bmad-output/test-artifacts/atdd-checklist-10-2-prisma-post-comment-relational-schema-migration.md)
- **Test Scaffolds:** [`tests/store/prisma-store.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/tests/store/prisma-store.test.js)
