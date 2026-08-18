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
storyId: '10.3'
storyKey: '10-3-ai-dataset-export-utility-streaming-jsonl-csv'
storyFile: '_bmad-output/implementation-artifacts/10-3-ai-dataset-export-utility-streaming-jsonl-csv.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-10-3-ai-dataset-export-utility-streaming-jsonl-csv.md'
generatedTestFiles:
  - 'tests/utils/exporter.test.js'
inputDocuments:
  - '_bmad-output/implementation-artifacts/10-3-ai-dataset-export-utility-streaming-jsonl-csv.md'
  - '_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md'
  - 'src/core/error-envelope.js'
  - 'prisma/schema.prisma'
---

# ATDD Checklist — Story 10.3: AI Dataset Export Utility (Streaming JSONL & CSV)

> **TDD Phase: RED PHASE (Scaffolds Generated)**  
> Acceptance test scaffolds generated with `it.skip()` in `tests/utils/exporter.test.js`.  
> Activated tests will fail until `src/utils/exporter.js` is implemented.

---

## 1. Story & Acceptance Criteria Overview

- **Story ID:** 10.3
- **Story Key:** `10-3-ai-dataset-export-utility-streaming-jsonl-csv`
- **Module Under Test:** `src/utils/exporter.js`
- **Primary Patterns:** Stream Processing (`createWriteStream`, `zlib.createGzip`), Backpressure Handling (`drain` event), Cursor Pagination (`take: 100`, `cursor`), Newline Sanitization (AD-9 Rule 3), RFC 4180 CSV Escaping.

---

## 2. Test Strategy & Levels Matrix

| Test Group | Scope / Target | Priority | Test File |
|---|---|---|---|
| **Input Validation Guard** | `outputPath`, `format`, date order, date validity check | P0 | `tests/utils/exporter.test.js` |
| **JSONL Streaming & Sanitization** | One JSON/line, `type: 'post'/'comment'`, `\r\n` replaced with space | P0 | `tests/utils/exporter.test.js` |
| **Sequential Post ➔ Comment Order** | Emit all posts before comments to ensure stable output | P0 | `tests/utils/exporter.test.js` |
| **CSV Streaming & RFC 4180 Escaping** | Standard header row, quotes/commas escaping, metadata serialization | P1 | `tests/utils/exporter.test.js` |
| **Gzip Stream Compression** | Auto-append `.gz`, valid Gzip stream compression & decompression | P1 | `tests/utils/exporter.test.js` |
| **Filter Query Building** | `platform`, `keyword` (`ILIKE`), `crawledAt` range, `includeComments` | P1 | `tests/utils/exporter.test.js` |

---

## 3. Acceptance Criteria Coverage Mapping

### AC1 — Input Validation Guard
- [x] `throws PlatformError (INVALID_ARGS) when outputPath is missing or empty` (P0)
- [x] `throws PlatformError (INVALID_ARGS) when format is unsupported` (P0)
- [x] `throws PlatformError (INVALID_ARGS) when fromDate is later than toDate` (P0)
- [x] `throws PlatformError (INVALID_ARGS) when fromDate or toDate is an unparseable date` (P0)

### AC2 — JSONL Streaming & Newline Sanitization (AD-9 Rule 3)
- [x] `streams valid JSONL with exactly one JSON object per line and sanitized newlines` (P0)
- [x] `emits Post rows first, then Comment rows sequentially` (P0)

### AC3 — CSV Streaming & RFC 4180 Escaping
- [x] `emits CSV with valid header row and correctly escapes quotes, commas, and metadata JSON` (P1)

### AC4 — Gzip Stream Compression
- [x] `automatically appends .gz extension and produces valid Gzip stream` (P1)

### AC5 — Filter Query Construction
- [x] `constructs platform, keyword (ILIKE), and crawledAt date range filters properly` (P1)
- [x] `skips comment query when includeComments is false` (P1)

---

## 4. Task-by-Task Implementation & Activation Guide

During implementation with `/bmad-dev-story`:

1. **Task 1: Input Validation & Error Envelope**
   - Create `src/utils/exporter.js`.
   - Validate `outputPath`, `format ∈ ['jsonl', 'csv']`, `fromDate`, `toDate`.
   - Remove `.skip` from `Story 10.3: AI Dataset Export Utility — Input Validation Guard` tests.
   - Run `npx vitest run tests/utils/exporter.test.js` to verify green.

2. **Task 2: Streaming JSONL & Cursor Pagination with Backpressure**
   - Implement `fs.createWriteStream`, cursor pagination (`take: 100`), backpressure drain event handler, and newline sanitization `replace(/\r\n|\r|\n/g, ' ')`.
   - Remove `.skip` from `Story 10.3: AI Dataset Export Utility — JSONL Streaming Export & Newline Sanitization` tests.
   - Run tests to verify green.

3. **Task 3: CSV Header & RFC 4180 Escaping**
   - Add standard CSV header generation and field escaping.
   - Remove `.skip` from `Story 10.3: AI Dataset Export Utility — CSV Streaming Export & RFC 4180 Escaping` tests.
   - Run tests to verify green.

4. **Task 4: Gzip Stream Compression Pipeline**
   - Integrate `node:zlib.createGzip()` with auto `.gz` extension appending.
   - Remove `.skip` from `Story 10.3: AI Dataset Export Utility — Gzip Stream Compression` tests.
   - Run tests to verify green.

5. **Task 5: Filter Query Construction**
   - Add `where` builder for `platform`, `keyword` (`contains`, `mode: 'insensitive'`), and date range on `crawledAt`.
   - Remove `.skip` from `Story 10.3: AI Dataset Export Utility — Filter Query Construction` tests.
   - Run full test suite regression: `npx vitest run tests/core tests/store tests/utils`.

---

## 5. Artifact Handoff

- **Story File:** [`_bmad-output/implementation-artifacts/10-3-ai-dataset-export-utility-streaming-jsonl-csv.md`](file:///Users/luisphan/Documents/GitHub/XActions/_bmad-output/implementation-artifacts/10-3-ai-dataset-export-utility-streaming-jsonl-csv.md)
- **Checklist File:** [`_bmad-output/test-artifacts/atdd-checklist-10-3-ai-dataset-export-utility-streaming-jsonl-csv.md`](file:///Users/luisphan/Documents/GitHub/XActions/_bmad-output/test-artifacts/atdd-checklist-10-3-ai-dataset-export-utility-streaming-jsonl-csv.md)
- **Test Scaffolds:** [`tests/utils/exporter.test.js`](file:///Users/luisphan/Documents/GitHub/XActions/tests/utils/exporter.test.js)
