# Deferred Work

## Deferred from: code review of 13-9-facebook-hybrid-social-actions-write-messenger re-review (2026-08-28)

- [x] [Review][Defer] `DEFAULT_FB_DOC_IDS` write mutation placeholders không phải doc_id thật — by design, cần capture từ live session [src/scrapers/social/facebook/crawler.js:225-231; actions.js:275-280]
- [x] [Review][Defer] `FacebookActionVelocityTracker` lưu in-memory, không chia sẻ across workers/restarts — vượt phạm vi AC-14 [src/scrapers/social/facebook/batch-runner.js:47-48]
- [x] [Review][Defer] `shareLinkByUid` legacy campaign vẫn dùng plain loop không batch safety — file đã deprecated, thuộc Epic 20.2 cleanup [src/scrapers/facebook/shareLinkByUid.js:208-232]

## Deferred from: code review of 13-9-facebook-hybrid-social-actions-write-messenger (2026-08-28)

- [x] [Review][Defer] `DEFAULT_FB_DOC_IDS` write mutation placeholders chưa tham chiếu trong action code hay tests — by design, cần capture live doc_id từ real Facebook session trước khi dùng [src/scrapers/social/facebook/crawler.js:224-230]

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

## Deferred from: code review of 15-1-threads-scraper-adapter-meta-internal-graphql (2026-08-26)

- [ ] [Review][P1][Defer] CommentTreeExtractor exits on empty/null `end_cursor` even when `has_next_page` is true — `fetchLayerPaginated` stops on an empty cursor. [src/scrapers/social/comment-tree.js:155-158]
- [ ] [Review][P2][Defer] Comments with `subCommentsCount` missing or `0` are never expanded — only parents with positive counts are fetched. [src/scrapers/social/comment-tree.js:167-169]
- [ ] [Review][P1][Defer] Cycle detector can re-attach to an existing cycle — `#wouldCreateCycle` returns false on already-visited IDs. [src/scrapers/social/comment-tree.js:190-201]
- [ ] [Review][P2][Defer] Orphan comments are not re-parented when the parent later arrives — no second-pass re-parenting. [src/scrapers/social/comment-tree.js:113-121]
- [ ] [Review][P2][Defer] Shared `byId`/`seen`/`total` state is mutated under `pLimit` without atomic guards — BFS state accessed concurrently. [src/scrapers/social/comment-tree.js:67-79,134-176]
- [ ] [Review][P2][Defer] Single child `fetchLayer` failure rejects the entire comment tree — `Promise.all` has no per-parent error isolation. [src/scrapers/social/comment-tree.js:172-176]
- [ ] [Review][P2][Defer] No `comment-tree.test.js` for cycles, duplicate IDs, orphan re-parenting, or `subCommentsCount=0` — missing test file. [tests/scrapers/social/comment-tree.test.js missing]
- [ ] [Review][P2][Defer] No concurrency / `p-limit` / shared-state race tests for `CommentTreeExtractor` — missing test file. [tests/scrapers/social/comment-tree.test.js missing]
- [ ] [Review][P2][Defer] Legacy Puppeteer `scrapeTweets` / `searchTweets` still use post text fragment as fallback ID and lack proxy/cookie rotation and retry — only `@deprecated` markers were required for this story; defer to Epic 20.2. [src/scrapers/threads/index.js:196-213,245-316]

## Deferred from: code review of 13-4-facebook-browser-as-signer-bridge (2026-08-26)

- [ ] [Review][P2][Defer] HTTP fallback `#fetchTokens` does not extract `__rev` — pre-existing behavior, browser path covers AC-2. [src/scrapers/social/facebook/client.js:319-337]

## Deferred from: code review of 13-5-facebook-hybrid-profile-followers-group-members (2026-08-27)

- [x] [Review][Defer] `#resolveCookies` branch `session.account.credentials.cookies` is not reachable from normal `AbstractCrawler.start` flow; requires `AccountPool`/`base-crawler` changes outside Story 13.5 scope. [src/scrapers/social/facebook/crawler.js:642-646, src/core/base-crawler.js:236]
- [x] [Review][Defer] Content fallback for `profile` and `group_members` using `FacebookBrowserBridge` is not feasible here: 13.4 bridge is a signer token bridge (`extractTokens`), not a content scraper. Adding a real browser fallback needs a dedicated story to port legacy `scrapeProfile`/`scrapeGroupMembers` to the BaseAdapter or implement evaluate scripts. [src/scrapers/social/facebook/crawler.js:1058-1072, 1266-1338, src/scrapers/social/facebook/signer-bridge.js]

## Deferred from: code review of 13-7-facebook-hybrid-post-group-comments (2026-08-27)

- [ ] [Review][P2][Defer] `CommentTreeExtractor` racy shared state under `p-limit` — pre-existing concurrency issue already deferred from 15-1. [src/scrapers/social/comment-tree.js:175-179]
- [ ] [Review][P2][Defer] Orphaned replies re-attached to depth 0 never have children fetched — pre-existing `CommentTreeExtractor` behavior already deferred from 15-1. [src/scrapers/social/comment-tree.js:116-123]
- [ ] [Review][P2][Defer] Group-specific `doc_id` placeholders are unverified — implementation acknowledges this; needs live Facebook capture. [src/scrapers/social/facebook/crawler.js:218-219]

## Deferred from: code review of 13-8-facebook-hybrid-marketplace (2026-08-27)

- [x] [Review][Defer] `DEFAULT_FB_DOC_IDS.MARKETPLACE_SEARCH` là placeholder — by design, cần capture live doc_id. [src/scrapers/social/facebook/crawler.js:192-196]
- [x] [Review][Defer] Migration hoàn chỉnh `src/scrapers/index.js`, `api/services/facebookScrape.js`, `src/mcp/server.js` sang `FacebookCrawler` — thuộc Story 13.10. [src/scrapers/index.js:188-196, src/mcp/server.js:3151-3200]
