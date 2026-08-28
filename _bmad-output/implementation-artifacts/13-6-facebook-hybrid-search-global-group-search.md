---
story_id: "13.6"
epic: 13
story_key: "13-6-facebook-hybrid-search-global-group-search"
status: "done"
phase: "Phase 4"
created: 2026-08-28
updated: 2026-08-28
last_updated: 2026-08-28
owner: "DEV"
reviewed: "2026-08-28"
baseline_commit: "4a152d14"
---

# Story 13.6: Facebook Hybrid Search (Global + Group Search)

Status: done

## Story

As a **Facebook Market Researcher**,  
I want **tìm kiếm toàn cục (posts/people/pages/groups) và tìm kiếm trong nhóm bằng kiến trúc hybrid (HTTP GraphQL hoặc CDP signer bridge) mà không cần mở Puppeteer tab mới cho mỗi yêu cầu**,  
so that **tôi có thể thu thập nhiều loại đối tượng với cùng một contract search() nhất quán trên mọi nền tảng và lưu trữ tập trung qua PrismaStore**.

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.6 [dòng 561-572]
- `_bmad-output/planning-artifacts/prd.md` — FR-72 (Facebook Crawler Refactor) [dòng 80]
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-2, AD-3, AD-4, AD-8, AD-9, AD-10, AD-11, AD-12, AD-14, AD-15
- `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md` — FacebookClient, FacebookCrawler, DEFAULT_FB_DOC_IDS, token cache
- `_bmad-output/implementation-artifacts/13-4-facebook-browser-as-signer-bridge.md` — FacebookBrowserBridge, Playwright default, token extraction
- `_bmad-output/implementation-artifacts/13-5-facebook-hybrid-profile-followers-group-members.md` — ProfileItem mapping, saveCheckpoint, resolveCookies, normalizeCount, resolveGroupId
- `src/scrapers/social/facebook/crawler.js` — FacebookCrawler hiện tại, search() throw XACT_4001 [dòng 878-885], DEFAULT_FB_DOC_IDS chưa có search [dòng 191-205], registerAction pattern [dòng 263-328]
- `src/scrapers/social/facebook/client.js` — FacebookClient.requestGraphQl [dòng 435-514], buildGraphQlBody [dòng 388-425], scrapeProfileWithBrowser [dòng 533-544], scrapeGroupMembersWithBrowser [dòng 552-563]
- `src/scrapers/social/facebook/signer-bridge.js` — FacebookBrowserBridge, extractFacebookTokensScript [dòng 47-502], scrapeProfile [dòng 722-799], scrapeGroupMembers [dòng 823-954]
- `src/scrapers/social/facebook/normalize-profile.js` — ProfileItem, profileItemToPostItem, namespacedProfileId
- `src/scrapers/social/threads/crawler.js` — searchPosts() / search() pattern với GraphQL và SSR fallback [dòng 683-812]
- `src/scrapers/facebook/search.js` — legacy searchFacebook, searchByType, SEARCH_TYPENAMES, SEARCH_TYPE_URLS [dòng 1-265]
- `src/scrapers/facebook/group-search.js` — legacy scrapeFacebookGroupSearch, mobile URL pattern [dòng 1-160]
- `src/scrapers/facebook/normalize.js` — VALID_SEARCH_TYPES, SEARCH_TYPE_URLS, buildSearchQuery, normalizeByType [dòng 550-623]
- `src/scrapers/index.js` — platformActionMap.facebook hiện tại [dòng 188-195]
- `src/core/base-crawler.js` — AbstractCrawler.search() contract [dòng 277-281], registerAction / listActions [dòng 72-115]
- `src/core/base-client.js` — AbstractApiClient.request(method, url, options) [dòng 482-540]
- `src/core/metadata-schema-registry.js` — schema validation
- `src/store/prisma-store.js` — storeBatch, saveCheckpoint
- `prisma/schema.prisma` — Post, CrawlCheckpoint [dòng 328-406]
- `schemas/facebook/social.json` — metadata schema hiện tại
- `docs/deprecation-plan.md` — legacy-to-hybrid mapping và status tracker
- `api/routes/facebook.js` — VALID_ACTIONS và input schema cho search / group_search [dòng 270-370]
- `api/services/facebookScrape.js` — runSearchAllParallel [dòng 68-113]
- `src/mcp/server.js` — x_facebook_search tool [dòng 1612-1627]
- `tests/scrapers/social/facebook/crawler-profile.test.js` — mẫu test hybrid với real node:http server
- `tests/scrapers/facebook-search.test.js` / `facebook-group-search.test.js` — legacy search test contract

## Cross-Epic Dependencies

- Depends on Story 13.1 (AbstractCrawler, AbstractApiClient, PreSignedTokenRing, SignerWorkerPagePool)
- Depends on Story 13.3 (FacebookClient, FacebookCrawler, DEFAULT_FB_DOC_IDS, PrismaStore)
- Depends on Story 13.4 (FacebookBrowserBridge, CDP attach/launch, token extraction, Playwright default)
- Depends on Story 13.5 (ProfileItem mapping, profileItemToPostItem, resolveGroupId, saveCheckpoint, group member fallback)
- Unblocks Story 13.7 (Facebook Hybrid Post & Group Comments), Story 13.10 (Integration & Caller Migration)
- Foundation: Epic 10 (interfaces, Prisma, schema), Epic 11 (proxy/governor), Epic 12.2 (CDP launcher)

## Baseline

- baseline_commit: 967fafab — 13.5 done.
- FacebookCrawler đã có group_posts, page_posts, get_comments, profile, followers, following, group_members.
- FacebookCrawler.search() hiện throw PlatformError XACT_4001 [dòng 878-885].
- DEFAULT_FB_DOC_IDS chưa có doc_id cho search hoặc group_search [dòng 191-205]; phải dùng placeholder + capture từ live network hoặc SSR fallback.
- FacebookClient.requestGraphQl, buildGraphQlBody, token cache, signer bridge option đã sẵn sàng.
- Legacy searchFacebook và scrapeFacebookGroupSearch vẫn hoạt động; docs/deprecation-plan.md ghi chúng nằm trong Phase 1 cần @deprecated.

## Acceptance Criteria

### AC-1: Kế thừa AbstractCrawler & Đăng ký Action mới

- Given FacebookCrawler trong src/scrapers/social/facebook/crawler.js
- When khởi tạo
- Then kế thừa AbstractCrawler, requiresAuth = true, name = 'facebook', platform = 'facebook'
- And đăng ký thêm action search và group_search (snake_case) trong constructor với requiredArgs, optionalArgs, example, outputType đúng
- And listActions() trả về cả search và group_search

### AC-2: Global Search (search)

- Given query bắt buộc, type mặc định 'posts', type ∈ ['posts','people','pages','groups','all']
- When gọi crawler.start({ action: 'search', args: { query, type, location, limit, cursor } })
- Then FacebookCrawler.search() xây dựng effective query (append location nếu có), chọn doc_id phù hợp với type hoặc fallback
- And với type !== 'all' trả về PostItem[] kèm pageInfo (theo contract AbstractCrawler.search)
- And với type === 'all' trả về { posts: PostItem[], people: PostItem[], pages: PostItem[], groups: PostItem[], pageInfo?: any }
- And hỗ trợ limit (mặc định 30, tối đa 500) và pagination cursor

### AC-3: Group Search (group_search)

- Given groupUrl hoặc groupId và query bắt buộc
- When gọi crawler.start({ action: 'group_search', args: { groupUrl, query, limit, cursor } })
- Then FacebookCrawler parse groupUrl thành groupId qua resolveGroupId, validate URL bằng assertFacebookUrlLocal (SSRF guard)
- And dispatch GraphQL GROUP_SEARCH doc_id hoặc fallback SSR / browser bridge
- And trả về { posts: PostItem[], pageInfo?: any, note?: string }
- And nếu nhóm private/không có kết quả, trả về note object hoặc PlatformError với suggestedAction: 'relogin'

### AC-4: Facebook GraphQL Dispatcher (DocID/LSD)

- Given FacebookClient.requestGraphQl với DocID + lsd/fb_dtsg
- When thêm search/group_search
- Then sử dụng trực tiếp FacebookClient.requestGraphQl() làm dispatcher; KHÔNG tạo file graphql-dispatcher.js riêng
- And lsd/fb_dtsg/jazoest được lấy từ PreSignedTokenRing hoặc token cache; __user/__a/__comet_req inject đúng như buildGraphQlBody
- And nếu GraphQL trả lỗi, shape không mong đợi, hoặc doc_id null, fallback sang SSR hoặc FacebookBrowserBridge mà không throw panic

### AC-5: Namespaced ID & Normalization

- Given bất kỳ kết quả search (post, people, page, group)
- When normalize
- Then PostItem.id bắt buộc facebook:${externalId}; PostItem.platform = 'facebook'; category = 'social'; publishedAt null với people/page/group
- And metadata chứa isSearchResult: true, searchType, query, resultType ('posts'|'people'|'pages'|'groups'), sourceMethod ('graphql'|'ssr'|'browser')
- And people/page/group được chuẩn hóa qua ProfileItem trung gian, sau đó profileItemToPostItem() để lưu Prisma

### AC-6: Loại Search, Location & Pagination

- Given type hợp lệ
- When search
- Then location (nếu có) được nối vào query theo kiểu "<query> near <location>" trước khi URL-encode, tương thích legacy buildSearchQuery
- And pagination trả về pageInfo với has_next_page và end_cursor từ GraphQL / SSR
- And type: 'all' chạy tuần tự 4 loại (posts → people → pages → groups); tham số parallel được chấp nhận nhưng xử lý ở caller layer (Story 13.10)

### AC-7: Input Validation & SSRF Guard

- Given input không hợp lệ
- When gọi search hoặc group_search
- Then query phải là non-empty string; type phải trong VALID_SEARCH_TYPES; limit positive integer ≤ 500
- And groupUrl phải là facebook.com/groups/ URL hoặc numeric groupId; nếu URL bên ngoài facebook.com thì throw PlatformError XACT_4001

### AC-8: PrismaStore & Checkpoint

- Given FacebookCrawler được cấu hình với store (PrismaStore)
- When hoàn thành một action
- Then toàn bộ kết quả search được lưu dưới dạng PostItem[] qua store.storeBatch(items, { upsert: true }); KHÔNG hardcode chunk 500
- And sau mỗi action gọi saveCheckpoint với targetType: 'search':
  - Global search: targetKey = "<query>:<type>" (dùng ':' làm delimiter)
  - Group search: targetKey = "<groupId>:<query>"
- And emit thin event stream:social:raw_posts cho mỗi item mới

### AC-9: Deprecation Markers

- Given các hàm legacy searchFacebook, searchTweets, scrapeFacebookGroupSearch trong src/scrapers/facebook/
- When triển khai Story 13.6
- Then gắn JSDoc @deprecated với ghi chú "Replaced by FacebookCrawler action search / group_search" trên các hàm trên
- And cập nhật docs/deprecation-plan.md status tracker thành deprecated-marked cho Facebook Search / Group Search legacy
- And thêm dòng searchFacebook / scrapeFacebookGroupSearch → hybrid actions vào bảng "Legacy Facebook Functions → Hybrid Actions"

### AC-10: Metadata Schema Validation

- Given schemas/facebook/social.json hiện tại
- When search result PostItem được validate
- Then metadataSchemaRegistry.validateMetadata('facebook', 'social', postItem.metadata) trả về valid: true cho cả post, people, page, group result
- And schema được mở rộng để chấp nhận các trường tùy chọn: isSearchResult, searchType, query, resultType, privacy, members, likes, pageUrl, groupUrl, groupId, category

### AC-11: Test Coverage

- Given repo có test framework Vitest
- When triển khai
- Then thêm tests/scrapers/social/facebook/crawler-search.test.js với real node:http server, không dùng mock/stub, bao quát P0/P1 tests cho AC-1..AC-10
- And chạy npx vitest run tests/scrapers/social/facebook/crawler-search.test.js và npx tsc --noEmit pass

## Tasks / Subtasks

- [x] 1. Cập nhật DEFAULT_FB_DOC_IDS trong src/scrapers/social/facebook/crawler.js
   - [x] Thêm SEARCH_POSTS, SEARCH_PEOPLE, SEARCH_PAGES, SEARCH_GROUPS, GROUP_SEARCH với placeholder doc_id.
   - [x] Thêm register search và group_search action trong constructor.

- [x] 2. Tạo src/scrapers/social/facebook/normalize-search.js
   - [x] normalizeFacebookSearchPost(raw, query) → PostItem
   - [x] normalizeFacebookSearchProfile(raw, searchType, query) → ProfileItem
   - [x] normalizeFacebookPageSearchResult(raw, query) / normalizeFacebookGroupSearchResult(raw, query) → ProfileItem
   - [x] searchResultToPostItem(item, searchType, query) → PostItem (wrapper over profileItemToPostItem)

- [x] 3. Implement FacebookCrawler.search() và FacebookCrawler.groupSearch() trong crawler.js
   - [x] Phương thức public search(args, session) override AbstractCrawler.search.
   - [x] Phương thức public groupSearch(args, session) (handler của action group_search).
   - [x] Private helpers: #searchByType(type, query, options, session), #searchAllTypes(query, options, session).

- [x] 4. Mở rộng FacebookBrowserBridge trong signer-bridge.js (best-effort)
   - [x] Đảm bảo types và methods không lỗi compile.

- [x] 5. Cập nhật src/scrapers/social/facebook/index.js
   - [x] Export các normalizer search mới.

- [x] 6. Cập nhật schemas/facebook/social.json
   - [x] Thêm nhánh "SearchResultItem Metadata" với các trường tùy chọn: isSearchResult, searchType, query, resultType, privacy, members, likes, category, pageUrl, groupUrl, groupId.

- [x] 7. Đánh dấu legacy @deprecated
   - [x] src/scrapers/facebook/search.js: searchFacebook, searchTweets
   - [x] src/scrapers/facebook/group-search.js: scrapeFacebookGroupSearch
   - [x] docs/deprecation-plan.md: cập nhật status tracker và mapping table.

- [x] 8. Tạo test tests/scrapers/social/facebook/crawler-search.test.js
   - [x] Real http.createServer với token endpoint và /api/graphql mock.
   - [x] Bao quát search posts/people/pages/groups/all, group search, SSRF, validation, Prisma store/checkpoint, schema validation.

- [x] 9. Chạy verification
   - [x] npx vitest run tests/scrapers/social/facebook/crawler-search.test.js
   - [x] npx tsc --noEmit
   - [x] npx vitest run tests/scrapers/social/ (regression)

### Review Findings

- [x] [Review][Patch] Preserve all entity-specific metadata in searchResultToPostItem [src/scrapers/social/facebook/normalize-search.js:254]
- [x] [Review][Patch] Harden null guards for actors and attachments [src/scrapers/social/facebook/normalize-search.js:18-44]
- [x] [Review][Patch] Extract Comet Relay AST content_story node [src/scrapers/social/facebook/normalize-search.js:13]
- [x] [Review][Patch] Add protocol-relative SSRF prevention in groupSearch and resolveGroupId [src/scrapers/social/facebook/crawler.js:180, 1080]
- [x] [Review][Patch] Isolate cursor across entity types in #searchAllTypes [src/scrapers/social/facebook/crawler.js:1038]
- [x] [Review][Patch] Harden isValidPayload search results object check [src/scrapers/social/facebook/validator.js:120]
- [x] [Review][Patch] Add AC-10 metadata schema registry validation test [tests/scrapers/social/facebook/crawler-search.test.js:531]
- [x] [Review][Defer] FacebookBrowserBridge search fallback — deferred, non-blocking for GraphQL/SSR engine

## Dev Notes

### Design Decisions

- Doc ID strategy: DEFAULT_FB_DOC_IDS sẽ dùng placeholder string (vd 'fb_search_posts_doc') cho đến khi team capture được doc_id thật từ Facebook web. Phù hợp pattern đã dùng ở Story 13.3/13.5. Khi capture xong, chỉ cần thay placeholder.
- search() return shape:
  - type !== 'all': trả về PostItem[] (cast any nếu cần) để tương thích AbstractCrawler.search.
  - type === 'all': trả về object 4 keys, tương thích legacy searchFacebook và caller hiện tại.
- group_search là action riêng: giữ search và group_search tách biệt để input schema rõ ràng (groupUrl/groupId + query).
- Fallback priority:
  1. GraphQL requestGraphQl nếu docIds.<TYPE> có giá trị non-null.
  2. HTTP SSR (FacebookClient.request) tới www.facebook.com/search/<type>/?q=... (global) hoặc m.facebook.com/groups/<groupId>/search/?q=... (group), parse HTML bằng jsdom và/hoặc hydration JSON.
  3. FacebookBrowserBridge nếu SSR bị checkpoint/empty.
- Location handling: Nối "<query> near <location>" trước khi encode; phù hợp với legacy buildSearchQuery và api/routes/facebook.js.
- Normalization: people/page/group → ProfileItem → profileItemToPostItem() → PostItem. Post result → PostItem trực tiếp. Tất cả đều có publishedAt: null khi không phải post.
- Checkpoint keys:
  - Global: targetType='search', targetKey='<query>:<type>' hoặc 'all:<query>'.
  - Group: targetType='search', targetKey='<groupId>:<query>'.
- parallel flag: FacebookCrawler xử lý type: 'all' tuần tự để tránh xoay vòng token/proxy trên cùng account. Fan-out 4 loại song song với nhiều account là trách nhiệm của caller layer (Story 13.10).

### Core Code State to Preserve

- Không sửa src/core/base-crawler.js, src/core/base-client.js, src/core/types.js.
- Không xóa legacy src/scrapers/facebook/search.js hoặc group-search.js; chỉ thêm @deprecated.
- Không thay đổi PrismaStore.storeBatch / saveCheckpoint signature.
- Giữ FacebookClient.requestGraphQl là dispatcher duy nhất cho GraphQL.

### Authentication & Token Handling

- search và group_search lấy accountId và cookies từ session qua #resolveCookies.
- FacebookClient.ensureTokens(accountId, cookies) tự động lấy lsd/fb_dtsg từ token cache hoặc signer bridge, cache 5 phút.
- buildGraphQlBody tự động inject __user, __a, __comet_req, __spin_*, jazoest, lsd, fb_dtsg.

### Facebook GraphQL Dispatcher

Thêm vào DEFAULT_FB_DOC_IDS:

```js
SEARCH_POSTS:  'fb_search_posts_doc',
SEARCH_PEOPLE: 'fb_search_people_doc',
SEARCH_PAGES:  'fb_search_pages_doc',
SEARCH_GROUPS: 'fb_search_groups_doc',
GROUP_SEARCH:  'fb_group_search_doc',
```

Variables mẫu (có thể điều chỉnh khi capture thực tế):

- Global search (per type): { query: '<effectiveQuery>', first: count, after: cursor || null }
- Group search: { groupId: '<groupId>', query: '<query>', first: count, after: cursor || null }

Friendly name tham khảo từ scripts/probe-real-facebook-hybrid.mjs:
- CometSearchCometSearchRootResultsQuery cho global search.
- Group search friendly name cần capture (có thể là CometGroupSearchResultsQuery hoặc tương đương).

### Search & Group Search Fallback Strategy

- Global SSR URLs (dựa trên src/scrapers/facebook/normalize.js:552-557):
  - https://www.facebook.com/search/posts/?q=<query>
  - https://www.facebook.com/search/people/?q=<query>
  - https://www.facebook.com/search/pages/?q=<query>
  - https://www.facebook.com/search/groups/?q=<query>
- Group SSR URL (dựa trên src/scrapers/facebook/group-search.js:66-73):
  - https://m.facebook.com/groups/<groupId>/search/?q=<query>
  - Dùng iPhone UA và mobile viewport.
- Có thể tái sử dụng extractHydrationJson / extractListItemsFromDom / extractPostsFromDom từ legacy bằng cách convert thành jsdom evaluate hoặc browser page.evaluate.

### Technical Requirements

- ESM, không require; JSDoc đầy đủ; tsc --noEmit.
- limit mặc định 30, tối đa 500; first trong GraphQL variables dùng giá trị đã clamp.
- Xử lý lỗi AUTH_EXPIRED, RATE_LIMIT, INVALID_ARGS bằng PlatformError + SuggestedActions.
- Không dùng mock/stub trong test; dùng real node:http server.
- Không thêm runtime dependency mới. jsdom đã có trong devDependencies, có thể dùng cho SSR parsing.

### Architecture Compliance

- FacebookCrawler extends AbstractCrawler.
- FacebookClient extends AbstractApiClient.
- Action registry pattern qua registerAction.
- PostItem lưu qua PrismaStore.storeBatch.
- Checkpoint qua #saveCheckpoint với CrawlCheckpoint.
- Namespaced IDs và metadata schema validation.

### Library & Framework Requirements

Các package đã có trong package.json:
- got-scraping / undici cho HTTP.
- playwright cho browser bridge.
- jsdom (dev) cho SSR parsing.
- vitest, supertest cho tests.
- @prisma/client, prisma cho storage.

### File Structure Requirements

```text
src/scrapers/social/facebook/
  crawler.js            ← thêm handlers + docIds
  client.js             ← không thay đổi (trừ khi thêm helper cần thiết)
  signer-bridge.js      ← thêm scrapeSearch / scrapeGroupSearch (optional)
  normalize-search.js   ← mới
  index.js              ← export normalizers mới
  validator.js          ← mở rộng nếu cần validate search payload

src/scrapers/facebook/
  search.js             ← @deprecated
  group-search.js       ← @deprecated
  index.js              ← @deprecated trên re-export nếu cần

schemas/facebook/social.json ← mở rộng metadata
docs/deprecation-plan.md       ← cập nhật
tests/scrapers/social/facebook/crawler-search.test.js ← mới
```

### Testing Requirements

Tạo tests/scrapers/social/facebook/crawler-search.test.js với các test case:

- [P0] search và group_search xuất hiện trong listActions() (AC-1).
- [P0] FacebookClient.requestGraphQl được gọi với đúng doc_id, lsd, fb_dtsg, jazoest và variables (AC-4).
- [P0] search với type: 'posts' trả về PostItem[] có id: 'facebook:<postId>' (AC-2, AC-5).
- [P0] search với type: 'people' trả về PostItem[] từ ProfileItem, metadata resultType: 'people' (AC-5).
- [P0] search với type: 'all' trả về object { posts, people, pages, groups, pageInfo } (AC-2).
- [P0] location được append vào query trước khi gửi (AC-6).
- [P0] group_search với groupUrl parse đúng groupId, trả về posts, checkpoint targetKey đúng (AC-3, AC-8).
- [P0] SSRF guard từ chối https://evil.com/groups/... (AC-7).
- [P0] Invalid type / empty query / limit <= 0 throw PlatformError (AC-7).
- [P0] PrismaStore lưu batch và CrawlCheckpoint được tạo cho global search và group search (AC-8).
- [P1] metadataSchemaRegistry.validateMetadata('facebook','social', ...) valid cho mọi search result (AC-10).
- [P1] Khi docIds.SEARCH_* là null, fallback SSR/browser trả về kết quả (AC-4).

Lệnh kiểm thử:

```bash
npx vitest run tests/scrapers/social/facebook/crawler-search.test.js
npx vitest run tests/scrapers/social/facebook/
npx tsc --noEmit
```

### Previous Story Intelligence

- Story 13.5 đã xây dựng resolveGroupId, assertFacebookUrlLocal, normalizeFacebookProfile/Follower/GroupMember, profileItemToPostItem, #saveCheckpoint, #resolveCookies, #normalizeCount, FacebookBrowserBridge.scrapeProfile/scrapeGroupMembers fallback. Tận dụng toàn bộ cho search handlers.
- Story 13.3/13.4 cung cấp DEFAULT_FB_DOC_IDS override pattern và FacebookClient.requestGraphQl dispatch.
- Story 15.1 ThreadsCrawler.searchPosts / search() là reference tốt nhất cho hybrid search với GraphQL + SSR fallback + checkpoint.

### Project Context Reference

- AGENTS.md / CLAUDE.md: ESM, no mocks, tsc --noEmit, commit as nirholas.
- docs/deprecation-plan.md: cập nhật khi hybrid search hoàn thành.
- _bmad-output/implementation-artifacts/sprint-status.yaml: cập nhật status sang ready-for-dev (hoặc in-progress khi dev bắt đầu).

### Completion Notes

- Khi hoàn thành implementation, chuyển status file này sang done và cập nhật last_updated.
- Chạy lại bmad-check-implementation-readiness nếu có skill.
- Cập nhật docs/deprecation-plan.md sang deprecated-marked cho search/group_search.
