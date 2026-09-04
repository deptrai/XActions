---
title: 'Story 13.2.13 — Twitter GraphQL Schema Migration (Hybrid Crawler)'
type: 'refactor'
created: '2026-09-03'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'b8444743bd0e7c8ac13ed11be29eb097ac471dfb'
context:
  - _bmad-output/implementation-artifacts/epic-13-context.md
---

<!-- Target: 900–1300 tokens. Above 1600 = high risk of context rot.
     Cohesive cross-layer stories (DB+BE+UI) stay in ONE file.
     IMPORTANT: Remove all HTML comments when filling this template. -->

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `TwitterClient`/`TwitterCrawler` trong `src/scrapers/social/twitter/` hiện import GraphQL endpoints, query IDs, feature flags, field toggles và variable builders từ `src/scrapers/twitter/http/endpoints.js` — một module legacy dùng chung với scraper cũ. Điều này tạo coupling ngược giữa kiến trúc hybrid và legacy, gây khó khăn khi X/Twitter thay đổi GraphQL bundle và khiến việc bảo trì query IDs rời rạc.

**Approach:** Tạo một module schema riêng trong `src/scrapers/social/twitter/schema.js`, tập trung hóa toàn bộ GraphQL query IDs, features, field toggles và variable builders cho hybrid crawler. Cập nhật query IDs lên bundle x.com 2026-09, refactor `client.js` và `crawler.js` để sử dụng schema mới, và gắn deprecation marker lên `src/scrapers/twitter/http/endpoints.js`.

## Boundaries & Constraints

**Always:**
- Mọi GraphQL query ID/feature/field toggle/variable builder của hybrid crawler phải xuất phát từ `src/scrapers/social/twitter/schema.js`.
- Duy trì backward compatibility: `package.json` exports và public API không thay đổi.
- Không làm break các test đã pass ở `tests/scrapers/social/twitter/`.
- Không log cookie/token trong bất kỳ request nào.

**Ask First:**
- Nếu audit thực tế cho thấy query ID bundle mới cần thay đổi operation name hoặc variables shape đáng kể (không chỉ là ID string).
- Nếu cần thêm/bỏ endpoint so với danh sách hiện có 25 endpoints.

**Never:**
- Không xóa `src/scrapers/twitter/http/endpoints.js` hoặc các file legacy liên quan (chỉ đánh dấu `@deprecated`).
- Không thay đổi contract `CrawlerCommand`, `AbstractCrawler`, `AbstractApiClient`.
- Không viết lại logic normalize/parse — chỉ di chuyển và cập nhật schema metadata.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| HAPPY_PATH | `schema.js` exported and used by `client.js`/`crawler.js` | All hybrid tests still pass; query IDs match x.com 2026-09 bundle | N/A |
| ERROR_CASE | Stale query ID returned by X/Twitter (HTTP 404) | `client.requestGraphQl` already auto-re-resolves via `query-id-resolver.js`; schema module must keep operation name stable for re-resolution | Return original `PlatformError` if re-resolution fails |
| ERROR_CASE | Missing required variable in builder | Throw `PlatformError` with `XACT_4001` and `suggestedAction: USE_ACTIONS_LIST` | N/A |

</frozen-after-approval>

## Code Map

- `src/scrapers/social/twitter/schema.js` -- new canonical GraphQL schema module (query IDs, features, field toggles, variable builders, validate function)
- `src/scrapers/social/twitter/client.js` -- refactor imports from `../../twitter/http/endpoints.js` to `./schema.js`
- `src/scrapers/social/twitter/crawler.js` -- refactor `TWITTER_GRAPHQL_QUERY_IDS` and `GRAPHQL` references to `./schema.js`
- `src/scrapers/twitter/http/endpoints.js` -- add `@deprecated` marker; remains source for legacy scraper
- `tests/scrapers/social/twitter/schema.test.js` -- new unit tests for schema module
- `_bmad-output/implementation-artifacts/twitter-action-audit.md` -- evidence of current working guest actions and auth-required actions
- `src/scrapers/twitter/http/query-id-resolver.js` -- existing resolver used by client for stale query ID fallback

## Tasks & Acceptance

**Execution:**
- [x] `src/scrapers/social/twitter/schema.js` -- create with all GraphQL `queryId`/`operationName` entries, `DEFAULT_FEATURES`, `DEFAULT_FIELD_TOGGLES`, `USER_FEATURES`, `RATE_LIMITS`, `buildGraphQLUrl`, `buildGraphQLVariables`, and `validateEndpoints` ported/copied from `src/scrapers/twitter/http/endpoints.js`
- [x] `src/scrapers/social/twitter/client.js` -- replace `import { BEARER_TOKEN, GRAPHQL, REST, REST_BASE, DEFAULT_FEATURES, DEFAULT_FIELD_TOGGLES } from '../../twitter/http/endpoints.js'` with imports from `./schema.js`; keep `query-id-resolver.js` fallback path intact
- [x] `src/scrapers/social/twitter/crawler.js` -- replace `TWITTER_GRAPHQL_QUERY_IDS` hard-coded object and `GRAPHQL` references with `schema.GRAPHQL`/`schema.TWITTER_GRAPHQL_QUERY_IDS`; update all `requestGraphQl` calls to use schema constants
- [x] `src/scrapers/twitter/http/endpoints.js` -- add file-level and export-level JSDoc `@deprecated` annotations directing to `src/scrapers/social/twitter/schema.js`
- [x] `tests/scrapers/social/twitter/schema.test.js` -- write tests verifying: (a) all expected endpoint keys exist, (b) `buildGraphQLVariables` returns correct shape for `UserByScreenName`, `UserTweets`, `SearchTimeline`, `CreateTweet`, (c) `validateEndpoints` function is exported

**Acceptance Criteria:**
- Given `TwitterCrawler` initialized in hybrid mode, when any supported action is invoked, then the request uses query IDs/features/field toggles from `src/scrapers/social/twitter/schema.js`.
- Given `src/scrapers/social/twitter/schema.js` exists, when `validateEndpoints()` is called, then it returns the same interface as the legacy `endpoints.js` version.
- Given full `vitest run tests/scrapers/social/twitter` is executed, then all existing tests continue to pass.
- Given `src/scrapers/twitter/http/endpoints.js` is inspected, then it carries `@deprecated` annotations and references `src/scrapers/social/twitter/schema.js`.

## Spec Change Log

## Design Notes

- Keeping variable builders in the new schema module preserves the existing `buildGraphQLVariables(type, params)` contract used by legacy code, minimizing risk.
- `client.js` currently has a manual 404 retry with `query-id-resolver.js`. This must continue to work; the resolver uses `operationName` only, so as long as `schema.js` preserves operation names, behavior is unchanged.
- The `USER_FEATURES` object is only used by `UserByScreenName`/`UserByRestId` in legacy profile path. If hybrid `crawler.js` does not currently pass custom user features, we still export it for future parity.

## Verification

**Commands:**
- `vitest run tests/scrapers/social/twitter` -- expected: all 117 tests pass (or current passing count)
- `node --input-type=module -e "import * as schema from './src/scrapers/social/twitter/schema.js'; console.log(Object.keys(schema.GRAPHQL).length);"` -- expected: prints 27

**Manual checks (if no CLI):**
- Open `src/scrapers/social/twitter/client.js` and confirm no `../../twitter/http/endpoints.js` import remains.
- Open `src/scrapers/social/twitter/crawler.js` and confirm `TWITTER_GRAPHQL_QUERY_IDS` is imported from `./schema.js`.
