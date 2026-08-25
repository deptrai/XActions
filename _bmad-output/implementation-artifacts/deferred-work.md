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

## Deferred from: code review of 11-1-proxyippool-accountpool-sticky-round-robin.md (2026-08-19)

- [ ] [Review][P2][Defer] `hibernation` and `quarantine` depend on `Date.now()` and are sensitive to clock skew; monotonic timing is out of scope for Story 11.1 [src/core/account-pool.js:87, src/proxy/proxy-pool.js:161]
- [ ] [Review][P2][Defer] No transaction / checkout between proxy selection and actual request use; checkout/checkin belongs to the request pipeline (Story 11.5/11.7) [src/proxy/proxy-pool.js:111-140]

## Deferred from: code review of 11-2-static-dynamic-residential-tunnel-proxy-providers (2026-08-20)

- [ ] [Review][P2][Defer] Session time-bucket and quarantine expirations depend on `Date.now()` and are sensitive to clock skew; monotonic clock is out of scope for Story 11.2 [src/proxy/providers.js:429, src/proxy/providers.js:529]
- [ ] [Review][P2][Defer] No checkout/checkin between dynamic proxy session selection and the actual HTTP request; request-pipeline transaction belongs to Story 11.5/11.7 [src/proxy/providers.js:520-551]

## Deferred from: code review of 13-1-tiered-signer-architecture-token-ring-worker-pool (2026-08-25)

- [ ] [Review][P2][Defer] Không dùng `p-limit` cho `init()` / spawn — spec đề xuất nhưng không phải AC; tác động thấp với `minSize=4`. [src/core/signer-pool.js:203-210]
- [ ] [Review][P2][Defer] Không tách `http-client-factory.js` riêng — default factory được inline trong `#getDefaultHttpClient()`. Spec đề xuất file riêng nhưng implementation hợp lệ. [src/core/base-client.js:241-309]
- [ ] [Review][P2][Defer] Default httpClient closure được tạo lại mỗi `request()` — hiệu suất kém nhẹ, không ảnh hưởng chức năng. [src/core/base-client.js:489-492]
