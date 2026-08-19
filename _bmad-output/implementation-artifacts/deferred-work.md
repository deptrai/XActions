# Deferred Work

## Deferred from: code review of 10-3-ai-dataset-export-utility-streaming-jsonl-csv (2026-08-19)

- [ ] [Review][P2][Defer] `outputPath` has no path traversal or directory/symlink validation; out of scope for current AC [src/utils/exporter.js:256-266]
- [ ] [Review][P2][Defer] Empty result set and exact-multiple-of-100 pagination edge cases are not explicitly tested [tests/utils/exporter.test.js]

## Deferred from: code review of 10-4-crawlcheckpoint-operational-api-resume-pause-retry (2026-08-19)

- [ ] [Review][P2][Defer] CLI tests file `tests/cli/checkpoints-cli.test.js` is recommended but optional per the spec. The CLI commands are currently untested; defer to a follow-up if not required for this story. [src/cli/index.js `checkpoints` command group, tests/cli/checkpoints-cli.test.js missing]
- [ ] [Review][P2][Defer] Concurrent updates to the same checkpoint have no optimistic locking. Adding a `version` field and `updatedAt` guard is out of scope for this story. [src/store/checkpoint-manager.js:171-245]
- [ ] [Review][P2][Defer] `prisma.$disconnect()` errors in CLI `finally` blocks are silently swallowed. Project pattern in other CLI commands; logging a warning is a nice-to-have. [src/cli/index.js]
- [ ] [Review][P2][Defer] Test JWT secret hardcoded in `tests/api/checkpoints-routes.test.js`. Pre-existing test pattern; not a production secret. [tests/api/checkpoints-routes.test.js:20-21]
- [ ] [Review][P2][Defer] No enum validation for `platform` and `targetType` values — the Prisma schema stores them as free strings. Platform discovery/validation belongs to later epics. [src/store/checkpoint-manager.js:67-68]

## Deferred from: code review 10-5-metadata-schema-contract-registry-for-consumers.md (2026-08-19)
- Synchronous Validation in 500-item Loop [src/store/prisma-store.js] - Could marginally stall event loop
