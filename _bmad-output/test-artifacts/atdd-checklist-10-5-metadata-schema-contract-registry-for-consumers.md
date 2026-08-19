---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04c-aggregate
lastStep: step-04c-aggregate
lastSaved: 2026-08-19T12:18:29+07:00
storyId: '10.5'
storyKey: 10-5-metadata-schema-contract-registry-for-consumers
storyFile: _bmad-output/implementation-artifacts/10-5-metadata-schema-contract-registry-for-consumers.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-10-5-metadata-schema-contract-registry-for-consumers.md
generatedTestFiles:
  - tests/api/schemas-routes.test.js
  - tests/core/metadata-schema-registry.test.js
  - tests/store/prisma-store-schema-validation.test.js
---

# ATDD Checklist: 10.5 — Metadata Schema Contract & Registry for Consumers

## TDD Red Phase (Current)

✅ Red-phase test scaffolds generated

- API / Core Tests: 11 tests (all skipped)
- E2E Tests: 0 tests (Backend only)

## Acceptance Criteria Coverage

- **AC1** (MetadataSchemaRegistry Service): Covered in `tests/core/metadata-schema-registry.test.js`
- **AC3** (REST API Endpoints): Covered in `tests/api/schemas-routes.test.js`
- **AC6** (PrismaStore Validation): Covered in `tests/store/prisma-store-schema-validation.test.js`

## Next Steps (Task-by-Task Activation)

During implementation of each task:

1. Remove `test.skip()` from the current test file or scenario
2. Run tests: `npm test`
3. Verify the activated test fails first, then passes after implementation (green phase)
4. If any activated tests still fail unexpectedly:
   - Either fix implementation (feature bug)
   - Or fix test (test bug)
5. Commit passing tests

## Implementation Guidance

Feature endpoints to implement:
- GET /api/schemas
- GET /api/schemas/:platform/:category

Core modules to implement:
- `src/core/metadata-schema-registry.js`
- `PrismaStore` validation modifications
