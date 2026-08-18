---
story_id: 10.3
story_key: 10-3-ai-dataset-export-utility-streaming-jsonl-csv
epic: 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces
status: ready-for-dev
---

# 10.3 — AI Dataset Export Utility (Streaming JSONL & CSV with Sanitization)

|||
|---|---|
| **Story ID** | 10.3 |
| **Story Key** | `10-3-ai-dataset-export-utility-streaming-jsonl-csv` |
| **Epic** | 10 — Unified PostgreSQL Storage (Prisma) & Core Interfaces |
| **Status** | ready-for-dev |
| **Author** | nich (@nichxbt) |

---

## User Story

**As an** AI Engineer / Data Scientist,
**I want** a utility that exports data from PostgreSQL into streaming JSON Lines (`.jsonl`) and CSV formats with backpressure handling and newline sanitization,
**so that** I can extract datasets filtered by `platform`, `keyword`, and `dateRange` for LLM training or Vector DB RAG without format errors or RAM overflow.

---

## Business Context

- Epic 10 stores 100% of scraped raw data (`Post` and `Comment`) in PostgreSQL/Prisma.
- Nowing AI/RAG pipelines need periodic bulk extracts of text content + metadata for fine-tuning, embedding, and analytics.
- The 30-day raw retention policy (AD-10) means exports may be run on large tables; streaming is mandatory to keep RAM bounded.
- Story 10.2 already provides `Post`/`Comment` schema, `PrismaStore`, and real-DB integration tests; Story 10.3 builds a read-side utility on top of that schema.

---

## Acceptance Criteria

### Functional contract

- **Given** a PostgreSQL database with `Post` and `Comment` data
- **When** calling `exportDataset({ platform, keyword, fromDate, toDate, format, outputPath, compress, includeComments })` in `src/utils/exporter.js`
- **Then** the function:
  - Accepts `format: 'jsonl' | 'csv'`.
  - Accepts `outputPath` (absolute or relative path) and writes the file there.
  - Accepts `compress: boolean` (default `false`). When `true`, writes a Gzip-compressed `.jsonl.gz` / `.csv.gz` stream and, if the path does not already end in `.gz`, appends `.gz`.
  - Filters by `platform` (exact match, optional).
  - Filters by `keyword` using case-insensitive `ILIKE` on both `Post.content` and `Comment.content` (optional; when omitted, exports all rows).
  - Filters by `fromDate` and `toDate` on `crawledAt` (both optional, ISO-8601 strings or `Date` objects).
  - By default queries **both** `Post` and `Comment` (controlled by `includeComments`, default `true`).
  - Emits all matched `Post` rows first (ordered by `crawledAt`), then all matched `Comment` rows (ordered by `crawledAt`). This keeps the CSV header stable and avoids interleaving complexity.
  - Reads data sequentially via Prisma cursor pagination in small chunks (default ≤ 100 rows per read) to keep memory < 50 MB.
  - Writes through `fs.createWriteStream` and respects backpressure by listening for the `'drain'` event.
  - Sanitizes newline characters (`\r\n`, `\n`, `\r`) in the `content` field to a single space before writing each row.
  - For JSONL, emits one valid JSON object per line.
  - For CSV, emits a header row and correctly escapes commas, quotes, and embedded newlines (RFC 4180-style).
  - Returns a summary object `{ rowCount, outputPath, compressed }` so callers and tests can verify the result.

### Output schema

- **Given** `format: 'jsonl'`
- **When** rows are written
- **Then** each line is an object containing:
  - `type: 'post' | 'comment'`
  - all scalar fields from the source model (`id`, `platform`, `externalId`, `authorId`, `authorName`, `content`, `likesCount`, `publishedAt`, `crawledAt`, ...)
  - `metadata` as a nested JSON object (do **not** double-stringify)
  - For `comment`: `postId`, `parentCommentId`, `depth`, `subCommentsCount`
  - For `post`: `repostsCount`, `repliesCount`, `viewsCount`, `mediaUrls`

- **Given** `format: 'csv'`
- **When** rows are written
- **Then** a common header row is written once at the top, missing columns are left empty, `metadata` and `mediaUrls` are serialized as JSON strings inside their cells, and values are CSV-escaped.

### Input validation

- **Given** an invalid `format`, missing `outputPath`, or an unparseable date
- **When** `exportDataset()` is called
- **Then** it throws `PlatformError` with `type: 'invalid_args'`, `code: 'XACT_4001'`, `suggestedAction: 'use_x_actions_list'` **before** touching the database or file system.

```js
import { PlatformError, ErrorTypes, SuggestedActions } from '../core/error-envelope.js';

throw new PlatformError({
  type: ErrorTypes.INVALID_ARGS,
  code: 'XACT_4001',
  message: `Invalid export format: ${format}`,
  statusCode: 400,
  suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
});
```

### End-to-end verification

- **Given** real `Post`/`Comment` rows exist in the test database
- **When** exporting to `.jsonl`, `.jsonl.gz`, `.csv`, and `.csv.gz`
- **Then** all files parse correctly, contain the expected row count, and no line contains unescaped newline characters in `content`.

---

## Tasks / Subtasks

- [ ] **Task 1: Input validation & query building (AC: Functional contract)**
  - [ ] Implement `exportDataset` in `src/utils/exporter.js`.
  - [ ] Validate `format ∈ ['jsonl', 'csv']` and `outputPath` is a non-empty string.
  - [ ] Build `where` clause for `platform`, `keyword` (`mode: 'insensitive'`), `crawledAt` range.
  - [ ] Throw standard `PlatformError` (`INVALID_ARGS`, `XACT_4001`, `USE_ACTIONS_LIST`) for invalid arguments.

- [ ] **Task 2: Streaming JSONL/CSV export with backpressure (AC: Functional contract)**
  - [ ] Resolve the final `outputPath`; append `.gz` when `compress` is true and the path does not already end with `.gz`.
  - [ ] Open `fs.createWriteStream` and, when `compress` is true, create a `zlib.createGzip()` stream and pipe it to the file stream.
  - [ ] Read `Post` rows with Prisma cursor pagination (`take: 100`, `skip: 1`, `cursor: { id: lastId }`, `orderBy: [{ crawledAt: 'asc' }, { id: 'asc' }]`). For the first page, omit `cursor` and `skip`.
  - [ ] After `Post` rows are exhausted, repeat the same cursor pagination for `Comment` rows.
  - [ ] Default `includeComments` to `true`; when `false`, skip the `Comment` pass.
  - [ ] Sanitize `content` newlines to spaces; leave other fields intact.
  - [ ] For JSONL, write `JSON.stringify(row) + '\n'`; for CSV, write the header once and then one escaped CSV line per row.
  - [ ] Handle backpressure via the `'drain'` event on the sink (gzip stream or file stream).
  - [ ] Keep chunk size small enough that Node RSS stays < 50 MB.
  - [ ] Return `{ rowCount, outputPath, compressed }`.

- [ ] **Task 3: CSV export with escaping (AC: Output schema)**
  - [ ] Generate a common CSV header: `type,id,platform,externalId,postId,parentCommentId,depth,authorId,authorName,authorAvatar,content,likesCount,repostsCount,repliesCount,viewsCount,subCommentsCount,mediaUrls,metadata,publishedAt,crawledAt`.
  - [ ] Serialize each row to CSV, escaping quotes as `""` and quoting cells that contain `,`, `"`, or newline.
  - [ ] Serialize `metadata` and `mediaUrls` with `JSON.stringify(...)` before CSV-escaping.

- [ ] **Task 4: CLI integration (optional but recommended)**
  - [ ] Add `xactions dataset export-db` command in `src/cli/index.js` under the existing `dataset` command group.
  - [ ] Options: `--platform`, `--keyword`, `--from`, `--to`, `--format`, `--output`, `--compress`, `--include-comments`.

- [ ] **Task 5: Tests (AC: End-to-end verification)**
  - [ ] Create `tests/utils/exporter.test.js` using the real Prisma test client (`tests/store/test-prisma-client.js`).
  - [ ] Seed 5–10 posts and 3–5 comments with multiline `content`.
  - [ ] Export to `.jsonl`, `.csv`, `.jsonl.gz`, `.csv.gz` and assert row counts and sanitized content.
  - [ ] Verify that `exportDataset` rejects invalid formats before DB access.

---

## Current Implementation State

- No `src/utils/exporter.js` exists for the PostgreSQL dataset use case.
- A legacy `src/portability/exporter.js` exists for Twitter account export (profile/tweets/followers). **Do not reuse** for this story; it is not Prisma-based and does not stream correctly.
- `src/store/prisma-store.js`, `prisma/schema.prisma`, and `tests/store/test-prisma-client.js` from Story 10.2 provide the read model and test DB setup.
- `src/core/error-envelope.js` provides the standard `PlatformError` shape.
- `src/core/types.js` defines `CATEGORIES` and helpers.

---

## Developer Context

### Architecture Decisions Relevant to This Story

- **AD-4 — Namespaced PostgreSQL Storage via Prisma & JSONB GIN Indexing** (`ARCHITECTURE-SPINE.md`)
  - `Post.id` and `Comment.id` use namespaced strings.
  - `metadata` is opaque `Json?`; export it as-is, do not flatten by default.
  - `crawledAt` is indexed on both `Post` and `Comment` for date-range queries.
- **AD-9 — Anti-Bot Payload Validation & Data Sanitization Defense** (`ARCHITECTURE-SPINE.md`)
  - Rule 3: "JSONL Exporter: Tự động sanitize ký tự xuống dòng (`\r\n`) trong `content` trước khi ghi stream." [Source: `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` line 200]
- **AD-10 — 3-Tier Incremental Gap-Filling & Retention Policy**
  - Raw `Post`/`Comment` data is retained for 30 days; exports must not hold entire tables in memory.

### Files to Read Before Modifying

1. `src/core/types.js` — `PostItem` / `CommentItem` typedefs and category helpers.
2. `src/core/error-envelope.js` — `PlatformError`, `ErrorTypes`, `SuggestedActions`.
3. `src/store/prisma-store.js` — how Prisma is used in `src/store/` (use `api/lib/prisma.js` or create a shared client).
4. `api/lib/prisma.js` — existing `PrismaClient` instance.
5. `prisma/schema.prisma` — `Post` and `Comment` models (lines 328–387).
6. `src/portability/exporter.js` — anti-pattern; read to understand what NOT to copy (no streaming, no backpressure).
7. `src/cli/index.js` — existing `dataset` command group (lines 3188–3221).

### Code Conventions

- Pure ESM (`import`/`export`) only.
- License header: `// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.`
- JSDoc for public functions and typedefs.
- `src/core/` must remain zero-runtime-dependency; `src/utils/exporter.js` can depend on `@prisma/client` because it reads from PostgreSQL.
- Throw `PlatformError` (not plain `Error`) for business-level errors.
- Do not mock `PrismaClient` in tests; use the real `xactions_test` PostgreSQL database.

---

## Technical Requirements

### Stack & Versions

- Node.js `>=18.0.0`
- `@prisma/client@^5.7.1`
- PostgreSQL 14+
- Built-in modules: `node:fs`, `node:stream`, `node:zlib` (`zlib.createGzip`), `node:events` (`once` helper)

### Prisma Query Strategy

Use cursor-based pagination, **not** offset-based pagination, to avoid degrading on large tables.
The `id` field is the `@id` and therefore unique, so it is the correct cursor. `crawledAt` is not unique, so it cannot be used alone; add it as a secondary sort key.

```js
// First page
const rows = await prisma.post.findMany({
  where,
  take: 100,
  orderBy: [{ crawledAt: 'asc' }, { id: 'asc' }],
});

// Subsequent pages
const nextRows = await prisma.post.findMany({
  where,
  take: 100,
  skip: 1,
  cursor: { id: lastId },
  orderBy: [{ crawledAt: 'asc' }, { id: 'asc' }],
});
```

`lastId` is the `id` of the last row returned by the previous page. The `skip: 1` tells Prisma to start **after** the cursor row.

### Keyword Filtering

Prisma `contains` with `mode: 'insensitive'` maps to PostgreSQL `ILIKE`:

```js
{ content: { contains: keyword, mode: 'insensitive' } }
```

For `Comment`, join is unnecessary; query `Comment` directly with the same `platform`, `content`, and `crawledAt` filters. The date filter applies to `crawledAt` (ingestion time) because it is present on every row and indexed.

### Backpressure Handling

```js
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

const fileStream = createWriteStream(outputPath);
const sink = compress ? createGzip() : fileStream;
if (compress) sink.pipe(fileStream);

function awaitDrain() {
  return new Promise((resolve) => sink.once('drain', resolve));
}

for (const row of chunk) {
  const line = JSON.stringify(row) + '\n';
  if (!sink.write(line)) {
    await awaitDrain();
  }
}
```

**Caution:** Do not use `sink.writeSync()` or accumulate all lines in a string. The `'drain'` event is the acceptance-criteria-mandated mechanism.

### Newline Sanitization

Apply to `content` only:

```js
function sanitizeNewlines(text) {
  return String(text ?? '').replace(/\r\n|\r|\n/g, ' ');
}
```

Do not strip `\r\n` from binary or metadata; only `content` is required by AD-9.

### CSV Escaping

- Header row written once before data.
- Cells containing `,`, `"`, `\n`, or `\r` wrapped in `"`.
- Double quotes inside cells escaped as `""`.
- `metadata` serialized with `JSON.stringify(metadata)` and then CSV-escaped.

### Gzip Compression

When `compress: true`:
- Append `.gz` to `outputPath` if it does not already end with `.gz` (e.g. `dataset.jsonl` → `dataset.jsonl.gz`).
- Use `node:zlib.createGzip({ level: 6 })` (default) and pipe it to `fs.createWriteStream`.
- Wait for both the gzip and file streams to finish/close before returning the summary.

---

## Architecture Compliance

- Hexagonal Architecture: `src/utils/exporter.js` is a read-side utility, not a `core` dependency. It may live in `src/utils/` or `src/store/`. The AC explicitly says `src/utils/exporter.js`.
- The utility must not leak `PrismaClient` details into `src/core/`.
- `metadata` must not be modified or schema-validated in this story (that belongs to Story 10.5).

---

## File Structure & Reading Order

| File / Path | Purpose |
|---|---|
| `src/utils/exporter.js` | **New** — `exportDataset` implementation |
| `tests/utils/exporter.test.js` | **New** — integration tests with real DB |
| `src/cli/index.js` | Optional — add `dataset export-db` command |
| `types/index.d.ts` | Optional — export `ExporterOptions` typedef |
| `prisma/schema.prisma` | `Post` / `Comment` models |
| `api/lib/prisma.js` | Shared `PrismaClient` instance |
| `tests/store/test-prisma-client.js` | Shared test client for real PostgreSQL |
| `src/core/error-envelope.js` | `PlatformError` shape |
| `src/core/types.js` | `PostItem` / `CommentItem` typedefs |

---

## Testing Requirements

### Environment

- Use the same test database setup as Story 10.2 (`DATABASE_URL_TEST=postgresql://postgres:postgres@localhost:5434/xactions_test` or `DATABASE_URL`).
- Run `npx prisma migrate deploy` before tests if the test DB is fresh.
- Clean seeded rows between tests with `TRUNCATE TABLE IF EXISTS "Post" CASCADE;` (CrawlCheckpoint and Comment rows are cascade-deleted because of FK relations) or transactional cleanup.

### Test Cases

- `exportDataset` throws `PlatformError` for:
  - missing or empty `outputPath`
  - unsupported `format`
  - invalid `fromDate` / `toDate` types
  - `fromDate` later than `toDate`
- JSONL export:
  - creates one valid JSON object per physical line
  - line count equals matched row count
  - `content` with `\r\n` is sanitized to a single-line string
- CSV export:
  - first row is the header
  - `content` with commas/quotes/newlines is correctly escaped
  - `metadata` is present as valid JSON in the cell
- Gzip export:
  - output file is a valid gzip stream (decompresses without error)
- Filter behavior:
  - `platform` filter reduces row count
  - `keyword` filter matches `content` case-insensitively for both Post and Comment
  - `fromDate` / `toDate` filter by `crawledAt`
- Memory / streaming:
  - export 500+ rows and confirm the process does not crash with `JavaScript heap out of memory` (use `--max-old-space-size=128` in CI if possible).

### Verification Commands

```bash
npx vitest run tests/utils/exporter.test.js
npx vitest run tests/store tests/utils   # regression with 10.2
```

---

## Previous Story Intelligence (Story 10.2)

- `PrismaStore` implements `AbstractStore` and writes `Post`/`Comment` via `prisma.post.createMany` / `prisma.comment.createMany`.
- Namespaced `Post.id` = `${platform}:${externalId}`; `Comment.id` = `${platform}:${postExternalId}:${commentExternalId}`.
- `Comment` has `depth` and `parentCommentId` for topological insertion.
- `Post.metadata` and `Comment.metadata` are stored as plain JS objects (not JSON strings).
- Tests use a real PostgreSQL test client in `tests/store/test-prisma-client.js`; do not mock Prisma.
- Project rule: "Never mock, stub, or fake anything. Real implementations only." [Source: `AGENTS.md` / `CLAUDE.md`]

---

## Git Intelligence (Recent Commits)

- `72cbb71` fix(tests): replace mock Prisma clients with real PostgreSQL integration tests
- `7597f44` (and earlier) Story 10.2 implementation: `PrismaStore`, schema, migrations, types
- Pattern: atomic commits focused on a single story; implementation artifacts live in `_bmad-output/implementation-artifacts/`; runtime code under `src/`; tests under `tests/`.

---

## Latest Tech Information

- Node.js `fs.createWriteStream` highWaterMark defaults to 16 KB. Writing larger chunks than this can cause `write()` to return `false` and require awaiting `'drain'`.
- `zlib.createGzip()` is a `Transform` stream. Pipe it to `fs.createWriteStream` and write rows into the gzip stream; backpressure propagates correctly.
- Prisma 5.x does not support raw `COPY ... TO STDOUT` directly, but cursor pagination with `findMany({ cursor, take, skip: 1 })` is the idiomatic streaming approach.
- PostgreSQL `ILIKE` requires `mode: 'insensitive'` in Prisma; this is the correct cross-platform way to get case-insensitive `LIKE`.
- JSONL best practice: one JSON object per line, no trailing comma, no pretty-printing, UTF-8 encoding.

---

## Project Context Reference

- Project: XActions
- Project key: XACT
- Repository: https://github.com/nirholas/XActions
- Tech: Node.js ESM, Prisma, PostgreSQL, Vitest
- `package.json` engines: `node >=18.0.0`
- Architecture: Hexagonal + Tiered Hybrid Signer + Adaptive Rate Limiter

---

## Warnings & Potential Pitfalls

1. **Do not reuse `src/portability/exporter.js`**. It is for Twitter account export, uses `fs/promises.writeFile` (no streaming), and has no backpressure. [Source: `src/portability/exporter.js`]
2. **Cursor pagination vs offset**: Offset (`skip` without `cursor`) degrades on large tables. Always use `cursor: { id: lastId }` with `orderBy: [{ crawledAt: 'asc' }, { id: 'asc' }]`.
3. **`crawledAt` is not unique**: Many rows may share the same `crawledAt`. Use `id` as the unique cursor and `crawledAt` as the sort key, not the cursor itself.
4. **Do not double-stringify `metadata` in JSONL**: It is a JSON object, so `JSON.stringify(row)` handles it naturally.
5. **CSV `metadata` and `mediaUrls` cells**: must be JSON strings within the cell; escape them as part of the normal CSV escaping rules.
6. **Backpressure with Gzip**: `gzip.write(line)` can return `false`; wait for `drain` on the gzip stream, not the file stream, and let `gzip.pipe(file)` propagate backpressure.
7. **No mocks in tests**: Use the real `xactions_test` database; import `prisma` and `cleanupTestDatabase` from `tests/store/test-prisma-client.js`.
8. **Scope boundary**: JSON Schema validation of `metadata` is Story 10.5; this story should not implement it.

---

## Decisions Record

- `includeComments` defaults to `true` to match the AC ("Post and Comment").
- Output order is `Post` rows first, then `Comment` rows, both sorted by `crawledAt` ascending, to keep CSV header stable.
- `compress: true` appends `.gz` to `outputPath` if not present.
- `dateRange` filters `crawledAt` (ingestion time) because it is indexed and non-null.
- CLI command is `xactions dataset export-db` under the existing `dataset` group.
- Return value is `{ rowCount: number, outputPath: string, compressed: boolean }`.

---

## Story Completion Status

- **Status:** `ready-for-dev`
- **Context engine analysis completed:** comprehensive developer guide created and validated.

---

## Dev Agent Record

### Agent Model Used

- DeepMind Antigravity Coding Agent (Pair Programmer) / `bmad-agent-dev`
- Story context engine: `bmad-create-story`

### Completion Notes List

- Story 10.3 extracted from `epics.md` Epic 10.
- Architecture `ARCHITECTURE-SPINE.md` AD-9 Rule 3 explicitly mandates JSONL newline sanitization.
- Previous Story 10.2 artifacts (`PrismaStore`, schema, real-DB test client) are the foundation.
- Output location: `_bmad-output/implementation-artifacts/10-3-ai-dataset-export-utility-streaming-jsonl-csv.md`.

### File List

- `_bmad-output/implementation-artifacts/10-3-ai-dataset-export-utility-streaming-jsonl-csv.md` (New: this story file)

### Change Log

- **2026-08-19:** Created comprehensive story context for Story 10.3, ready-for-dev.
- **2026-08-19:** Validated and refined cursor pagination strategy, error-envelope example, CSV header, backpressure code, and default `includeComments` behavior.
