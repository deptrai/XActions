# ATDD Red-Phase Checklist — Story 13.8

Story 13.8: Facebook Hybrid Marketplace (Search, Categories & Item Details)

Artifact: `_bmad-output/implementation-artifacts/13-8-facebook-hybrid-marketplace.md`
Baseline: `c45d770f`

## Red-phase test scaffolding rules

- Tất cả test viết trước khi chạm vào implementation.
- Test phải dựa trên `PostItem`, `FacebookCrawler`, `FacebookClient`, real `node:http` server, không dùng `vi.fn`/stub/mock.
- Mỗi test phải `expect` thất bại trên baseline (màu đỏ) vì `marketplace` chưa được đăng ký hoặc chưa ánh xạ đúng.
- Sau khi chạy `npx vitest run` lần đầu, thu thập danh sách test đỏ để dev-agent theo dõi.

## AC → Red test mapping

### AC-1: Action `marketplace` được đăng ký trong ActionRegistry

- [ ] Red test: `FacebookCrawler.listActions()` contains descriptor with `action: 'marketplace'`, `requiredArgs: ['query']`.
- [ ] Red test: `FacebookCrawler.listActions()` descriptor contains optionalArgs `['location', 'category', 'categoryId', 'minPrice', 'maxPrice', 'limit', 'cursor']`.
- [ ] Red test: `crawler.start({ action: 'marketplace' })` does not throw `Unknown action`.

### AC-2: `marketplace()` handler

- [ ] Red test: `marketplace` with a real local server returning GraphQL marketplace feed returns `posts` array of `PostItem` with `id` matching `facebook:<listingId>`.
- [ ] Red test: `marketplace` variables include `COMMERCE_MKTPLACE_WWW`, `filter_price_lower_bound/upper_bound` in cents, and `radiusKm`.
- [ ] Red test: `marketplace` returns `pageInfo.has_next_page` and `pageInfo.end_cursor`.

### AC-3: Chuẩn hóa listing thành `PostItem`

- [ ] Red test: returned `PostItem.category` equals `'ecom'`.
- [ ] Red test: returned `PostItem.metadata.isMarketplace` is `true`.
- [ ] Red test: returned `PostItem.content` strips PII phone numbers and email addresses.
- [ ] Red test: `PostItem.metadata.sourceMethod` is defined (`'graphql'` or `'browser'`).

### AC-4: `location`, `minPrice`/`maxPrice`, `limit`, `cursor` mapping & `dryRun`

- [ ] Red test: `marketplace({ query, dryRun: true })` returns `{ dryRun: true, searchUrl }` without calling network.
- [ ] Red test: `marketplace({ query, cursor: 'cursor_mkt_page_1' })` passes pagination cursor to GraphQL variables.
- [ ] Red test: `marketplace({ query, limit: 10 })` respects limit and bounds.

### AC-5: Fallback khi GraphQL thất bại

- [ ] Red test: fallback chain attempts browser bridge or HTTP SSR when GraphQL doc_id is unconfigured or rotated without unhandled panic.

### AC-6: Phân trang và checkpoint

- [ ] Red test: `marketplace` saves crawl checkpoint with `targetType: 'marketplace'` and `targetKey` containing search query.
- [ ] Red test: `marketplace` persists listings batch via `store.storeBatch` with `{ upsert: true }`.

### AC-7: Input validation & SSRF guard

- [ ] Red test: `marketplace({ query: '' })` throws `PlatformError` `XACT_4001`.
- [ ] Red test: `marketplace({ query: 'car', minPrice: -10 })` throws `PlatformError` `XACT_4001`.
- [ ] Red test: `marketplace({ query: 'car', minPrice: 1000, maxPrice: 500 })` throws `PlatformError` `XACT_4001`.
- [ ] Red test: `marketplace({ query: 'car', category: '../../etc/passwd' })` throws `PlatformError` `XACT_4001`.

### AC-8: API Route & Caller Migration

- [ ] Red test: `api/routes/facebook.js` accepts `marketplace` in `VALID_ACTIONS` and passes `location`, `minPrice`, `maxPrice`, `category` in `scrapeArgs`.

### AC-9: Deprecation markers

- [ ] Red test: `src/scrapers/facebook/marketplace.js` contains `@deprecated` JSDoc on `scrapeMarketplace`.
- [ ] Red test: `docs/deprecation-plan.md` contains mapping row `scrapeMarketplace -> facebook:marketplace`.

### AC-10: Test coverage & quality

- [ ] Red test suite created at `tests/scrapers/social/facebook/crawler-marketplace.test.js`.
- [ ] All new tests fail on baseline with clear, actionable assertion messages.
- [ ] 0 mocks, 0 stubs (`vi.fn` is not used).

## Developer runbook

1. Copy baseline commit: `git -c advice.detachedHead=false checkout c45d770f`.
2. Create or extend test file based on this checklist.
3. Run `npx vitest run tests/scrapers/social/facebook/crawler-marketplace.test.js` and capture red list.
4. Hand off to implementation phase with this checklist pinned.

## Completion criteria

- [x] 100% red tests are present and fail on baseline.
- [x] Checklist linked in sprint status.
- [x] Implementation artifact 13.8 status set to `ready-for-dev`.
