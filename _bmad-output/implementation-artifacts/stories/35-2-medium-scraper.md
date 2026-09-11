---
title: 'Story 35.2: Medium Scraper (Client + Crawler + Validator + Tests)'
type: 'feature'
created: '2026-09-09'
updated: '2026-09-11'
status: 'done'
epic: 35
story_number: 35.2
phase: 'Epic 35 — Reddit, Medium & Instagram Scraper Expansion'
priority: 'high'
baseline_commit: '98c2c930'
context:
  - _bmad-output/planning-artifacts/epics.md#epic-35
  - _bmad-output/planning-artifacts/prd.md#fr-99
  - _bmad-output/planning-artifacts/architecture/xactions-epic35-reddit-medium-instagram/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/research/technical-scraping-reddit-medium-instagram-2026-09-08/research.md
  - src/core/base-client.js
  - src/core/base-crawler.js
  - src/core/platform-validator.js
  - src/core/types.js
  - src/scrapers/social/mastodon/client.js
  - src/scrapers/social/mastodon/crawler.js
  - src/scrapers/social/reddit/client.js
  - src/scrapers/social/reddit/crawler.js
  - src/scrapers/social/reddit/normalizer.js
  - src/scrapers/social/reddit/validator.js
  - src/scrapers/social/index.js
  - src/scrapers/index.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nowing AI Lead Hub cần cào dữ liệu từ **Medium** — nguồn long-form content / thought-leadership phương Tây — để mở rộng lead generation, sentiment analysis và market intelligence. XActions hiện thiếu adapter cho Medium trong `src/scrapers/social/`.

Medium được phân loại **low complexity, low risk** trong research: official API đã deprecated, nhưng các RSS feed công khai (`/feed/@username`, `/feed/{publication}`, `/feed/tag/{tag}`) vẫn trả HTTP 200, không cần auth, chứa full HTML bài viết public trong `content:encoded`. Khi RSS bị chặn hoặc thiếu metadata, có thể fallback sang `?format=json` hoặc HTML/Puppeteer.

**Approach:**

1. Tạo `MediumClient` tại `src/scrapers/social/medium/client.js` kế thừa `AbstractApiClient`, dùng **RSS-first** (`fast-xml-parser`) với **fallback `?format=json`** (public, no auth, cần strip XSSI prefix `])}while(1);</x>`) và **Puppeteer/Playwright stealth** nếu cả hai đều bị Cloudflare chặn.
2. Tạo `MediumCrawler` tại `src/scrapers/social/medium/crawler.js` kế thừa `AbstractCrawler`, đăng ký actions: `user` (profile/author feed), `publication`, `tag`, `post` (single article lookup).
3. Tạo `normalizer.js` chuyển RSS `<item>` / JSON `payload.references.Post` / GraphQL `postResult` → `PostItem` với `id = medium:${postId}`, `platform: 'medium'`, `category: 'social'`.
4. Tạo `validator.js` (`MediumPlatformResponseValidator`) kiểm tra RSS well-formed, JSON/XSSI, 403/429/Cloudflare, paywall markers (`isSubscriptionLocked`, `isLocked`), và reject HTML challenge pages.
5. Tích hợp `ProxyProvider` (optional) với default `country-us` hoặc residential cho US platform; fallback `PROXY_URL` env.
6. Tự động lưu qua `PrismaStore` và phát `ThinEvent` tới Redis Stream `stream:social:raw_posts` (mirror Reddit/Mastodon pattern).
7. Đăng ký trong `src/scrapers/social/index.js`, `src/scrapers/social/actions-list.js` và unified dispatcher `src/scrapers/index.js`.

## Boundaries & Constraints

**Always:**
- **RSS-first** cho mọi feed: `https://medium.com/feed/@username`, `https://medium.com/feed/{publication}`, `https://medium.com/feed/tag/{tag}`, `https://medium.com/feed/{publication}/tagged/{tag}`.
- **No auth mặc định**: Medium public feed không cần API key, cookie hay token.
- `User-Agent` bắt buộc là realistic browser UA (`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ... Chrome/120.0.0.0 Safari/537.36` hoặc `xactions/1.0` fallback), đặc biệt khi gọi `?format=json` hoặc GraphQL.
- Force **HTTP/1.1** trên `undici`/`got-scraping` cho direct Medium requests để tránh Cloudflare TLS fingerprint reset.
- Rate limiting: 1–3s giữa các request; 429 → exponential backoff với jitter; quarantine proxy khi gặp 403/429.
- Tất cả items phải qua `this.validateItem(item)` trước khi trả về hoặc lưu.
- Kế thừa `AbstractCrawler` và `AbstractApiClient` — không tạo API surface riêng.
- Proxy là optional nhưng **recommend** `country-us` hoặc `residential` khi chạy từ datacenter/cloud IP.
- Sử dụng `Record<string, unknown>` + JSDoc `@typedef` cho raw payloads; **không dùng `Record<string, any>` hay `@ts-ignore`**.

**Ask First:**
- Nếu cần cào member-only / paywalled full content (cần login cookie `sid`/`uid`).
- Nếu cần publishing, clap, comment, follow (write actions).
- Nếu cần dùng third-party wrapper (`medium-api`, `medium-sdk-ts`) thay vì public endpoints.
- Nếu cần full archive thay vì ~10 latest items mặc định của RSS.

**Never:**
- Không dùng **official Medium API (`api.medium.com/v1`)** — đã deprecated và không cấp token mới.
- Không hardcode cookie/session trong source; lấy từ env/CLI/`SocialAccount` nếu auth được bật trong story sau.
- Không cào member-only content bằng public scraper (chỉ trả preview/snippet).
- Không để `transport` hoặc `category` thành `undefined`/`CATEGORIES.POST` (lỗi đã xảy ra ở 35.1).
- Không dùng `cheerio` nếu chưa thêm vào `dependencies` (hoặc dùng `CheerioAdapter` với runtime check và hướng dẫn install).
- Không mock trong tests — dùng real `node:http` server hoặc conditional live tests (`MEDIUM_INTEGRATION=1`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| User feed (RSS) | `{ action: 'user', args: { username: 'karpathy', limit: 25 } }` | `{ posts: PostItem[], pageInfo: { end_cursor: null, has_next_page: false } }` | 403/empty → fallback `?format=json`; nếu vẫn fail → `BotChallengeError` hoặc dùng `transport: 'puppeteer'` |
| Publication feed (RSS) | `{ action: 'publication', args: { slug: 'towards-data-science', limit: 25 } }` | `{ posts: PostItem[], pageInfo }` | Same fallback chain. Custom-domain publication dùng `https://{domain}/feed` |
| Tag feed (RSS) | `{ action: 'tag', args: { tag: 'programming', limit: 25 } }` | `{ posts: PostItem[], pageInfo }` | RSS `https://medium.com/feed/tag/programming` ưu tiên; HTML/GraphQL fallback nếu RSS trống |
| Single post (JSON) | `{ action: 'post', args: { postId: 'a64152b37c35' } }` hoặc `{ url: '...' }` | `{ post: PostItem }` | Strip XSSI prefix; parse `payload.value` / `payload.references`; 404 → `PlatformError` `NOT_FOUND` |
| JSON profile + posts | `?format=json` on `https://medium.com/@karpathy` | `payload.references.Post` map thành `PostItem[]` với `clapCount`, `wordCount`, `readingTime` trong metadata | `payload.paging.next` dùng làm `pageInfo.end_cursor` |
| GraphQL user lookup | `POST /_/graphql` `ViewerQuery` | `data.user` → `ProfileItem` (nếu action `profile` được thêm) | 400 invalid field → `PlatformError` `INVALID_ARGS` |
| Rate limit / Cloudflare | 4+ nhanh requests từ cùng IP | 1–3s delay + exponential backoff; proxy rotate nếu có proxy pool | `RateLimitError` / `BotChallengeError` với `suggestedAction: ROTATE_PROXY` |
| Member-only post | `content:encoded` chỉ có teaser hoặc `value.isSubscriptionLocked: true` | Trả `PostItem` với `content` = teaser, `metadata.isLocked: true`; **không** tìm cách unlock | Không throw, ghi nhận `metadata.paywall: true` |
| Empty feed | User không có bài hoặc publication ẩn | `{ posts: [], pageInfo: { has_next_page: false } }` | `PlatformError` `NOT_FOUND` nếu 404; ngược lại trả mảng rỗng |
| Malformed XML / JSON | Non-XML body hoặc JSON missing XSSI strip | `isValidPayload` → `false` | `PlatformError` `INVALID_ARGS` hoặc `BotChallengeError` nếu là Cloudflare HTML |

## Code Map

- `src/core/base-client.js` — `AbstractApiClient` pipeline: `resolveProxy()`, `request()`, exponential backoff, proxy quarantine, telemetry.
- `src/core/base-crawler.js` — `AbstractCrawler`, `registerAction`, `resolveCheckpoint`, `shouldStopPagination`, `validateItem`, `delayWithJitter`.
- `src/core/platform-validator.js` — `AbstractPlatformResponseValidator` contract.
- `src/core/types.js` — `PostItem`, `ProfileItem`, `CommentItem`, `CATEGORIES`.
- `src/scrapers/social/mastodon/client.js` — reference HTTP-only client với `sign()` no-op, `buildUrl()`, `get()`.
- `src/scrapers/social/mastodon/crawler.js` — reference `AbstractCrawler` actions + pagination (`max_id`).
- `src/scrapers/social/reddit/client.js` — reference `transport: 'http' | 'puppeteer' | 'rss'`, RSS fallback, rate-limit header parse.
- `src/scrapers/social/reddit/crawler.js` — reference `checkpointResolver`, `#emitCheckpointAndStream`, `storeBatch` + `redisPublisher`.
- `src/scrapers/social/reddit/normalizer.js` — reference `asRecord()` helper, JSDoc `typedef`s, namespaced IDs.
- `src/scrapers/social/reddit/validator.js` — reference `isBotChallenge`, `isLoginWall`, `isValidPayload`.
- `src/scrapers/social/index.js` — add `export * as medium from './medium/index.js';` và named exports.
- `src/scrapers/index.js` — register `medium`/`md` in dispatcher, model Reddit dispatch block.
- `src/scrapers/social/actions-list.js` — add `MediumCrawler` to crawler list.
- `src/scrapers/adapters/cheerio.js` — optional HTML fallback adapter (requires `cheerio` package).
- `src/scrapers/adapters/puppeteer.js` / `playwright.js` — last-resort browser fallback.
- `src/utils/gaussian-delay.js` — `gaussianDelay(min, max)` for inter-request throttle.

</frozen-after-approval>

## Tasks & Acceptance

### Execution

- [x] `src/scrapers/social/medium/client.js` — `MediumClient` kế thừa `AbstractApiClient`:
  - `name = 'medium'`, `platform = 'medium'`, `requiresAuth = false`, `client = 'undici'`, `requiresProxy = false`, `requiresResidential = true`.
  - `baseUrl = 'https://medium.com'`.
  - `userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'`.
  - `transport = 'rss'` (class field), normalized from `options.transport || process.env.MEDIUM_TRANSPORT || 'rss'` case-insensitive. Allowed values: `'rss' | 'http' | 'graphql' | 'puppeteer'`.
  - `delayMin = 1000`, `delayMax = 3000` (class fields; set `0` in tests to disable throttle).
  - `#lastRequestAt = 0` (private field for inter-request throttle).
  - `constructor(options)`: 
    - `MediumClient` imports `MediumPlatformResponseValidator` and `gaussianDelay` at top of file.
    - Tạo `const responseValidator = options.responseValidator || new MediumPlatformResponseValidator();`
    - Gọi `super({ ...options, platform: 'medium', responseValidator, requiresAuth: options.requiresAuth ?? false, requiresProxy: options.requiresProxy ?? false });`
    - Lưu `this.baseUrl`, `this.transport`, `this.userAgent`, `this.delayMin`, `this.delayMax`, `this.bridge = null`.
  - `transport` default = `process.env.MEDIUM_TRANSPORT || options.transport || 'rss'`; normalize case-insensitive.
  - `sign(payload)` no-op (public endpoints).
  - `init(session)` no-op unless future auth cookie provided.
  - `buildUrl(path, params)` build Medium URLs with query string; strip trailing slashes.
  - `#resolveFeedUrl({ action, username, slug, tag, publicationTag })`: map to RSS endpoint; dùng `encodeURIComponent` cho các dynamic segment.
    - user: `https://medium.com/feed/@{encodeURIComponent(username)}` (preferred) hoặc `https://{encodeURIComponent(username)}.medium.com/feed`.
    - publication: `https://medium.com/feed/{encodeURIComponent(slug)}`; custom domain: `https://{domain}/feed`.
    - tag: `https://medium.com/feed/tag/{encodeURIComponent(tag)}`; old alias `/feed/topic/{tag}` optional.
    - publication+tag: `https://medium.com/feed/{encodeURIComponent(slug)}/tagged/{encodeURIComponent(tag)}`.
  - Override `request(method, url, options)`:
    - Apply 1–3s inter-request throttle: lưu `this.#lastRequestAt`; nếu `this.delayMax > 0` và thời gian kể từ request cuối < `this.delayMin` thì `await gaussianDelay(this.delayMin, this.delayMax)`; cập nhật `#lastRequestAt` sau request. Cách này tránh double-sleep khi `AbstractApiClient` retry nội bộ.
    - Set `User-Agent` realistic nếu chưa có (`headers['user-agent'] || this.userAgent`).
    - Không ép `Accept` tại đây; mỗi helper tự set `Accept` phù hợp.
    - Gọi `super.request(method, url, options)`.
  - `getRssFeed(url)`: call `this.request('GET', url, { skipResponseValidation: true, headers: { 'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9', 'User-Agent': this.userAgent } })`; lấy `const xml = typeof res.data === 'string' ? res.data : res.data?.toString?.() || ''` rồi parse với `fast-xml-parser`.
  - `getJsonPage(url)`: append `?format=json` (và `limit`, `to`, `page` nếu có) bằng `buildUrl`; call `this.request('GET', url, { skipResponseValidation: true, headers: { 'Accept': 'application/json', 'User-Agent': this.userAgent } })`;
    - Nếu `res.data` là object → trả luôn.
    - Nếu là string → strip XSSI prefix `])}while(1);</x>` rồi `JSON.parse`; trả `payload`.
  - `getGraphql(query, variables)`: `POST https://medium.com/_/graphql` với `Content-Type: application/json`; realistic UA; parse JSON (`skipResponseValidation: true`); validate response shape (`data` hoặc `data.postResult`). Support batched array `[{ operationName, variables, query }]`.
  - `getUserFeed(username, options)` → RSS first; nếu RSS fail/empty thì `getJsonPage`; nếu `transport === 'graphql'` và operations đã verify thì dùng `getGraphql`; nếu vẫn fail thì Puppeteer.
  - `getPublicationFeed(slug, options)` → nếu `options.tag` tồn tại thì dùng `publication+tag` RSS (`/feed/{slug}/tagged/{tag}`), nếu RSS fail thì fallback sang `getTagFeed(tag)` hoặc Puppeteer; nếu không có `tag` thì dùng publication RSS, rồi `getJsonPage`; GraphQL chỉ khi `transport === 'graphql'` và đã verify.
  - `getTagFeed(tag, options)` → RSS first; `?format=json` cho tag thường bị 403/broken nên fallback sang Puppeteer/Playwright. GraphQL (ví dụ `TopicLatestStorieQuery`) chỉ dùng nếu operation đã được verify trực tiếp hoặc `transport === 'graphql'`.
  - `getPost(postIdOrUrl, options)` → resolve URL theo thứ tự:
    - Nếu `postIdOrUrl` bắt đầu `medium:`, strip prefix.
    - Nếu `postIdOrUrl` bắt đầu bằng `http` hoặc chứa `medium.com/`, extract `postId` qua regex và set `options.url = postIdOrUrl`.
    1. Nếu `options.url` được cung cấp: dùng `buildUrl(options.url, { format: 'json' })`. Đây là đường dẫn ổn định nhất vì `url` đã chứa slug+postId.
    2. Mặc định: `buildUrl('https://medium.com/p/' + postId, { format: 'json' })`; Medium thường redirect về canonical URL (`/@user/slug-{postId}`) nên `getPost` nên theo redirect rồi append `?format=json` trên canonical URL.
    - strip XSSI; return `payload.value`; parse `postId` từ URL fallback nếu chưa có.
  - Transport semantics:
    - `transport: 'rss'` (default): RSS first; nếu RSS fail/empty/rate-limit thì fallback `?format=json`; nếu JSON cũng fail thì Puppeteer.
    - `transport: 'http'`: bỏ qua RSS, dùng `?format=json`.
    - `transport: 'graphql'`: bỏ qua RSS/JSON, dùng `/_/graphql` (chỉ nên dùng khi operation đã verify).
    - `transport: 'puppeteer'`: bỏ qua HTTP/GraphQL, dùng `MediumBrowserBridge` hoặc `src/scrapers/adapters/puppeteer.js`/`playwright.js`.
  - Fallback chain chung cho feed/post:
    1. RSS nếu `transport` cho phép (`rss` default).
    2. `?format=json` nếu RSS fail (403/empty/not-full) và `transport` không phải `puppeteer`/`graphql`.
    3. `/_/graphql` chỉ khi `transport === 'graphql'` và operation đã verify.
    4. Puppeteer/Playwright nếu `transport === 'puppeteer'` hoặc tất cả HTTP/JSON paths fail.
  - `close()`: dọn browser bridge (`await this.bridge?.close()`), dừng in-flight requests; `AbstractApiClient` hiện không có `close()` base nên chỉ cần cleanup local resources.
  - Rate limit: override `request` thêm 1–3s giữa các request qua `gaussianDelay(this.delayMin, this.delayMax)` (default 1000–3000ms; tắt trong test với `delayMin=0, delayMax=0`); 429/403 → `AbstractApiClient` backoff + proxy quarantine.
  - Proxy: override `resolveProxy(accountId, requiresResidential, requiresAuth, options)` để merge `country: 'us'`, `isp: 'residential'` vào `options` trước khi gọi `super.resolveProxy(...)`; không force khi không có proxy provider/pool.

- [x] `src/scrapers/social/medium/crawler.js` — `MediumCrawler` kế thừa `AbstractCrawler`:
  - `name = 'medium'`, `platform = 'medium'`, `requiresAuth = false`, `category = 'social'`.
  - `constructor(deps)`: tạo `MediumClient` nếu chưa có; gọi `super({ ...deps, client, requiresAuth: deps.requiresAuth ?? false })`; lưu `this.client = client`; lưu `this.redisPublisher = deps.redisPublisher || null`; đăng ký actions.
  - Implement `cleanup()`: `await this.client.close().catch(() => {});`.
  - Không cần implement `init()`/`search()`/`getPostDetail()`/`getComments()` trừ khi có action gọi chúng; `AbstractCrawler` ném `Method not implemented` nếu gọi.
  - Actions (with aliases), mỗi action được đăng ký với `ActionDescriptor` đầy đủ (`description`, `example`, `category`, `requiresAuth`, `requiredArgs`, `optionalArgs`, `outputType`, `checkpointResolver`):
    - `user` — aliases: `author`, `posts`, `tweets`, `feed` — requiredArgs: `['username']`, optionalArgs: `['limit', 'transport', 'cursor']`, outputType: `'{ posts: PostItem[], pageInfo: { end_cursor: string|null, has_next_page: boolean } }'`, category: `'social'`, requiresAuth: `false`, example: `{ username: 'karpathy', limit: 10 }`.
    - `publication` — aliases: `pub`, `magazine` — requiredArgs: `['slug']`, optionalArgs: `['tag', 'limit', 'transport', 'cursor']`, example: `{ slug: 'towards-data-science', limit: 10 }`.
    - `tag` — aliases: `hashtag`, `topic` — requiredArgs: `['tag']`, optionalArgs: `['limit', 'transport', 'cursor']`, example: `{ tag: 'programming', limit: 10 }`.
    - `post` — aliases: `post_detail`, `article` — requiredArgs: `['postId']` (nếu không có `url`), optionalArgs: `['url', 'transport']`, outputType: `'{ post: PostItem }'`, example: `{ postId: 'a64152b37c35' }`:
      - Nếu `postId` bắt đầu `medium:`, strip prefix.
      - Nếu `url` được cung cấp, extract postId qua regex `/-([a-f0-9]{12})(?:\?|$)/` hoặc `/p/([a-f0-9]{12})`.
      - Nếu vẫn thiếu cả `postId` và `url` → throw `PlatformError` `XACT_4001`.
      - Gọi `client.getPost(postId, { url, transport })`.
  - `checkpointResolver` cho `user`, `publication`, `tag` với `cursorField: 'cursor'`, `fallbackCursorFields: ['after', 'to']`.
    - `targetType`/`targetKey`:
      - `user` → `('user', username.toLowerCase())`
      - `publication` → nếu `args.tag` tồn tại: `('publication_tag', `${slug.toLowerCase()}:${tag.toLowerCase()}`); ngược lại `('publication', slug.toLowerCase())`.
      - `tag` → `('tag', tag.toLowerCase())`.
    - Lưu ý RSS không có cursor; khi dùng JSON `paging.next` là object, serialize thành string JSON hoặc lưu `to`/`page`.
  - `pageInfo` shape:
    - RSS: `{ end_cursor: null, has_next_page: false }` (vì RSS trả ~10 items và không paginate).
    - JSON: `{ end_cursor: JSON.stringify(paging.next) || null, has_next_page: Boolean(paging.next) }`.
  - Mỗi handler gọi `client.getUserFeed` / `getPublicationFeed` / `getTagFeed` / `getPost`, normalize từng item, `this.validateItem(item)`, `this.store.storeBatch(posts)` (nếu có store), emit thin event qua `redisPublisher`.
  - `#emitCheckpointAndStream({ targetType, targetKey, cursor, items, hasMore })` mirror Reddit pattern.
  - `shouldStopPagination` kiểm tra tất cả items đã tồn tại trong DB (dùng `store.findExistingIds`) để dừng sớm.
  - `limit` clamping: RSS trả tối đa ~10 items; nếu `limit > 10` và `transport === 'rss'`, tự chuyển `transport: 'http'` hoặc trả về ít hơn `limit` với `has_next_page: true`.
  - `cleanup()`: delegate to `this.client.close()` / `this.client.cleanup()`.

- [x] `src/scrapers/social/medium/normalizer.js`:
  - Định nghĩa JSDoc `@typedef`s: `RawMediumRssItem`, `RawMediumPost`, `RawMediumUser`, `RawMediumCollection`.
  - `asRecord(value)` helper:
    ```js
    /** @param {unknown} value */
    function asRecord(value) {
      return /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (value));
    }
    ```
  - `namespacedMediumId(externalId)` → `medium:${externalId}`.
  - `#extractPostId(guidOrUrl)` từ `https://medium.com/p/{12-hex}` hoặc `/-([a-f0-9]{12})(?:\?|$)/` trong URL.
  - `#stripTrackingParams(url)` remove `?source=rss-...`.
  - `#extractFirstImage(html)` lấy `src` của `<img>` đầu tiên từ `content:encoded`, bỏ qua tracking pixel (kích thước `1x1`, `data:image`, hoặc `medium.com/_/stat`).
  - `#isPaywalledRss(content, link)` trả `true` nếu `content` chỉ là teaser (ngắn, chứa "Continue reading on Medium", "Get unlimited access", "member-only") hoặc link trỏ đến `/p/{id}?source=...` với `content` thiếu body.
  - `normalizeMediumRssItem(item)` → `PostItem`:
    - `id`: `medium:${postId}` (`postId` từ `guid` hoặc `link`).
    - `platform`: `'medium'`.
    - `externalId`: 12-char post id hoặc full `guid` nếu không parse được.
    - `category`: `'social'` (use `CATEGORIES` constant lookup if available; never leave `undefined`).
    - `title`: `title.__cdata` / `title['#text']`.
    - `authorName`: `dc:creator.__cdata`.
    - `authorId`: optional, derive from URL or `@username` if present.
    - `postUrl`: `link` with tracking params stripped.
    - `content`: `content:encoded.__cdata` (HTML). Nếu member-only (teaser), vẫn lưu nguyên HTML preview.
    - `mediaUrls`: image URLs extracted from `content:encoded`.
    - `publishedAt`: parse `pubDate` RFC-822; `const d = new Date(pubDate);` nếu `isNaN(d.getTime())` thì `null`, ngược lại `d`.
    - `crawledAt`: `new Date()`.
    - `metadata`: `{ tags: category[], primaryTag: firstCategory, guid, creator, atomUpdated, feedUrl, isLocked: #isPaywalledRss(...) }`.
  - `normalizeMediumJsonPost(post, references = {})` → `PostItem` từ `payload.references.Post[id]`:
    - `id`: `medium:${post.id}` (post.id is 12-hex).
    - `platform`: `'medium'`.
    - `externalId`: `post.id`.
    - `category`: `'social'`.
    - `title`: `post.title`.
    - `authorName`: `post.creator.name` hoặc `references.User[post.creatorId].name`.
    - `authorId`: `post.creatorId` or `post.creator.id`.
    - `postUrl`: `post.mediumUrl` or `post.canonicalUrl` or `post.url` (strip tracking).
    - `content`: `post.content.subtitle` + `post.content.bodyModel.paragraphs` (nếu có) hoặc `virtuals.previewImage` caption; hoặc ghép paragraphs thành HTML.
    - `mediaUrls`: `post.virtuals.previewImage.imageId` or first image from `content`.
    - `likesCount`: `Number(post.virtuals.totalClapCount) || Number(GraphQL clapCount) || 0`.
    - `repliesCount`: `Number(post.virtuals.responsesCreatedCount) || 0`.
    - `viewsCount`: `Number(post.virtuals.reads) || 0`.
    - `publishedAt`: `const d = new Date(post.firstPublishedAt || post.latestPublishedAt);` nếu `isNaN(d.getTime())` thì `null`, ngược lại `d` (ms since epoch).
    - `crawledAt`: `new Date()`.
    - `metadata`: `{ wordCount, readingTime, isSubscriptionLocked, visibility, tags: post.virtuals.tags }`.
  - `normalizeMediumGraphqlPost(post)` → `PostItem` từ GraphQL `postResult` (map `id`, `title`, `mediumUrl`, `creator`, `clapCount`, `firstPublishedAt`/`latestPublishedAt`; `category: 'social'`).

- [x] `src/scrapers/social/medium/validator.js`:
  - `MediumPlatformResponseValidator extends AbstractPlatformResponseValidator`:
    - `platform = 'medium'`.
    - `isRateLimit(response)`: status 429, hoặc `Retry-After` header, hoặc body chứa `rate limit`.
    - `isBotChallenge(response)`: status 403/451, body chứa Cloudflare markers (`__cf_chl_jschl_tk__`, `cf-browser-verification`, `checking your browser`, `just a moment...`), hoặc connection reset / TLS handshake fail.
    - `isLoginWall(response)`: body chứa actual sign-in wall (`sign in to continue`, `/signin`, `Sign in with Google`, sign-in modal). **Do NOT** treat paywall/member-only as login wall; paywall chỉ đánh dấu `metadata.isLocked`.
    - `isValidPayload(response)`: với RSS check `rss.channel.item` là mảng; với JSON check `payload` object có `value` hoặc `references.Post`; reject HTML challenge / empty object; accept `isSubscriptionLocked: true` as valid (metadata flag).
  - `validateMediumPost(raw)` plain function: throw `PlatformError({ type: ErrorTypes.INVALID_ARGS, code: 'XACT_4001', ... })` nếu `raw` thiếu `guid` (hoặc `postId`), `title`, hoặc `link` (hoặc `postUrl`); return `true` nếu hợp lệ. Không có class `ValidationError` trong codebase.

- [x] `src/scrapers/social/medium/index.js` — barrel:
  - `export { MediumClient, createMediumClient } from './client.js';`
  - `export { MediumCrawler, createMediumCrawler } from './crawler.js';`
  - `export { MediumPlatformResponseValidator } from './validator.js';`
  - `export { namespacedMediumId, normalizeMediumRssItem, normalizeMediumJsonPost } from './normalizer.js';`

- [x] `src/scrapers/social/medium/bridge.js` *(optional, only if Puppeteer fallback needed)*:
  - `MediumBrowserBridge` mirror `RedditBrowserBridge`: launch browser (puppeteer-extra-plugin-stealth), new page, goto URL, evaluate `window.__APOLLO_STATE__` hoặc fetch `/_/graphql` từ page context.
  - `clearCookies()`, `close()` cleanup.

- [x] `src/scrapers/social/index.js` — add:
  ```js
  export * as medium from './medium/index.js';
  export {
    MediumClient,
    MediumCrawler,
    MediumPlatformResponseValidator,
  } from './medium/index.js';
  ```

- [x] `src/scrapers/index.js` — register `medium`/`md` platform alias and dispatch block:
  - Import `MediumClient`, `MediumCrawler`, `mediumModule`.
  - Add `medium: mediumProxy, md: mediumProxy` to `platforms` map.
  - Add `MEDIUM_ACTION_MAP` mapping:
    - `user`/`author`/`posts`/`tweets`/`feed` → `user`
    - `publication`/`pub`/`magazine` → `publication`
    - `tag`/`hashtag`/`topic` → `tag`
    - `post`/`post_detail`/`article` → `post`.
  - Normalize args: `options.username`/`options.user`/`options.handle` → `username`; `options.slug`/`options.publication` → `slug`; `options.tag`/`options.topic` → `tag`; `options.postId`/`options.post_id`/`options.id`/`options.url` → `postId` (nếu `url` thì extract bằng regex trước).
  - Build `MediumClient` with all client options (`transport`, `userAgent`, `proxy`, `timeout`, `responseValidator`, `governor`, etc.).
  - Build `MediumCrawler` with `client`, `store`, `redisPublisher`, `governor`, `accountPool`.
  - Dispatch pattern: `try { return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session }); } finally { if (options.autoClose !== false) await crawler.cleanup(); }`.
  - Add `createMediumClient` and `createMediumCrawler` exports.

- [x] `src/scrapers/social/actions-list.js` — add `MediumCrawler` to `crawlers` array.

- [x] `.env.example` — add `MEDIUM_TRANSPORT`, `MEDIUM_USER_AGENT`, `MEDIUM_INTEGRATION`.

- [x] `tests/scrapers/social/medium/client.test.js`:
  - Khởi tạo `MediumClient` đúng `platform`, `name`, `requiresAuth`.
  - `getRssFeed` parse real `node:http` server trả RSS sample (dùng `fast-xml-parser`).
  - `getJsonPage` strip XSSI prefix.
  - `#resolveFeedUrl` build đúng user/publication/tag URLs.
  - 403/empty RSS → fallback `?format=json` hoặc throw `BotChallengeError`.
  - Proxy `resolveProxy` được gọi khi `requiresProxy` hoặc `proxyProvider` có.
  - Rate limit: 429 → `RateLimitError`.
  - `getPost` follows redirect 301/302 và append `?format=json` trên canonical URL.

- [x] `tests/scrapers/social/medium/crawler.test.js`:
  - `MediumCrawler` khởi tạo đúng `name`, `platform`, `category`.
  - `listActions()` có `user`, `publication`, `tag`, `post`.
  - `user` action trả `{ posts, pageInfo }` với `PostItem` đúng schema.
  - `publication` và `tag` trả `{ posts, pageInfo }`.
  - `post` action trả `{ post: PostItem }` từ XSSI JSON.
  - `resolveCheckpoint` inject `cursor` vào args.
  - `shouldStopPagination` trả `true` khi all items already exist.
  - `cleanup()` delegate to `client.close()`.

- [x] `tests/scrapers/social/medium/normalizer.test.js`:
  - `normalizeMediumRssItem` map đúng `<item>` → `PostItem`.
  - `normalizeMediumJsonPost` map `payload.references.Post` → `PostItem`.
  - `namespacedMediumId` and `#extractPostId`.
  - Tracking params stripped.
  - First image extracted from `content:encoded`.

- [x] `tests/scrapers/social/medium/validator.test.js`:
  - `isRateLimit` detect 429.
  - `isBotChallenge` detect Cloudflare HTML / 403.
  - `isValidPayload` accept RSS and JSON; reject HTML / empty.
  - Paywall marker not treated as invalid payload.

### Acceptance Criteria

- **AC-1:** Given public username `@username`, when `scrape('medium', 'user', { username: 'username', limit: 25 })` (or `crawler.start({ action: 'user', args: { username: 'username', limit: 25 } })`), then it fetches `https://medium.com/feed/@username` and returns `PostItem[]` with `id`, `platform: 'medium'`, `title`, `link`, `pubDate`, `creator`, `categories`.
- **AC-2:** Given Medium RSS feed returns 403 or empty, when it falls back to JSON mode, then it fetches `https://medium.com/@username?format=json`, strips the XSSI prefix, and returns `PostItem[]` with title, link, and full metadata.
- **AC-3:** Given publication slug `publication-name`, when `scrape('medium', 'publication', { slug: 'publication-name', limit: 25 })`, then it fetches `https://medium.com/feed/publication-name` (or JSON/Puppeteer fallback) and returns `PostItem[]`.
- **AC-4:** Given tag `tag-name`, when `scrape('medium', 'tag', { tag: 'tag-name', limit: 25 })`, then it fetches `https://medium.com/feed/tag/tag-name` and returns `PostItem[]`.
- **AC-5:** Given an RSS `<item>` with `guid`, `title`, `link`, `pubDate`, `dc:creator`, `category[]`, `content:encoded`, when `normalizeMediumRssItem(item)` is called, then it returns `PostItem` with `id = medium:${postId}` and `content` extracted from `content:encoded`.
- **AC-6:** Given a raw Medium post or RSS item, when `validateMediumPost(raw)` is called, then it throws `PlatformError` (`XACT_4001`) if `guid`/`postId`, `title`, or `link`/`postUrl` is missing; and returns `true` for valid items. `MediumPlatformResponseValidator.isValidPayload` returns `true` for well-formed RSS/JSON and `false` for HTML challenge / empty payload.
- **AC-7:** Given a sequence of Medium requests, when multiple requests are made, then each request is spaced 1–3s apart and `429` responses trigger exponential backoff.
- **AC-8:** Given no mocks or stubs, when `npx vitest run tests/scrapers/social/medium` is executed, then all client, crawler, normalizer, and validator tests pass.

## Dev Agent Record

**Implementation Plan:**
*(To be filled by the dev agent after implementation starts.)*
- [x] Bootstrap `src/scrapers/social/medium/` module.
- [x] Implement `MediumClient` with RSS + JSON + optional Puppeteer fallback.
- [x] Implement `MediumNormalizer` with RSS and JSON paths.
- [x] Implement `MediumPlatformResponseValidator`.
- [x] Implement `MediumCrawler` with actions, checkpoint resolvers, store/Redis emission.
- [x] Wire dispatcher, social barrel, actions-list, `.env.example`.
- [x] Write tests with real `node:http` fixtures.
- [x] Run `npx vitest run tests/scrapers/social/medium` and `npx tsc --noEmit | grep src/scrapers/social/medium` until clean.

**Debug Log:**
- Fixed `MediumClient` JSDoc types: `Object` → `Record<string, unknown>` in bridge, client private methods, and `#scrapeFeed`.
- Fixed `#resolveFeedUrl` to use `this.buildUrl()` so RSS endpoints respect `baseUrl` in tests instead of always hitting `https://medium.com`.
- Fixed `#fetchJsonWithRedirect` to call `this.request()` directly and parse the HTTP response envelope; previously it tried to read `status`/`headers` from the parsed JSON payload, so 301/302 redirects were not followed.
- Fixed `#jsonPost` to unwrap `root.payload` and attach `creator` from `references.User` so `normalizeMediumJsonPost` can resolve `authorName`/`authorId`.
- Fixed `getPublicationFeed` tag option: pass `publicationTag` (not `tag`) to `#resolveFeedUrl` to generate `/feed/{slug}/tagged/{tag}`.
- Fixed `normalizeMediumRssItem`, `normalizeMediumJsonPost`, and `normalizeMediumGraphqlPost` to include `title` in the returned `PostItem`.
- Fixed `extractFirstImage` to iterate over all `<img>` tags and skip tracking pixels / data URIs.
- Fixed `namespacedMediumId` to handle `0` as a valid numeric id (`externalId ?? ''` instead of `externalId || ''`).
- Fixed `MediumPlatformResponseValidator.isValidPayload` to treat string `record.data` containing `<rss` or `<feed` as a valid RSS payload.
- Fixed `src/scrapers/index.js` Medium dispatch block: replaced undefined `args` spread with explicit argument mapping from `options`, added missing `session` variable, and exported `createMediumClient`/`createMediumCrawler`.
- Fixed `getTagFeed` to use a real `#jsonTagFeed` JSON fallback for `transport: 'http'` and for the default RSS → JSON → Puppeteer chain, instead of jumping directly to Puppeteer.
- Fixed `MediumBrowserBridge.#extractApolloState` to pass an arrow function (not a `return ...` string) to Puppeteer `evaluate`, and added conditional `MEDIUM_E2E=1` real Chromium tests.
- Fixed `src/store/retention-cleaner.js` pre-existing TS errors: readonly array types, `unknown` parameters, `INVALID_ARGS`/`USE_ACTIONS_LIST` enums, missing `batchesExecuted` in returns.
- Fixed `src/utils/redis-stream-publisher.js` pre-existing TS errors: typed `publish` args, extracted `scraperId` safely from `Record<string, unknown>`.

**Completion Notes:**
- All 71 new Medium tests pass with real `node:http` fixtures (client, crawler, normalizer, validator, dispatcher integration). The 2 new Puppeteer bridge E2E tests pass when `MEDIUM_E2E=1`.
- Social scraper regression suite passes: 825 tests across `tests/scrapers/social/`.
- `npx tsc --noEmit | grep medium` returns no Medium-specific diagnostics.
- `npx tsc --noEmit | grep src/store/retention-cleaner\.js` and `.../redis-stream-publisher\.js` return no diagnostics for those two files.
- Full repo still has 768 pre-existing TypeScript errors across 69 files (not introduced by Story 35.2); they need a dedicated pass.
- Story status moved to `review`; sprint status updated to `35-2-medium-scraper-client-crawler-validator-tests: review`.

### Pre-Flight Checklist for Dev (auto-validate before claiming done)

- [x] `npx vitest run tests/scrapers/social/medium` passes.
- [x] `npx tsc --noEmit | grep src/scrapers/social/medium` returns no Medium-specific diagnostics.
- [x] `node -e "import('./src/scrapers/index.js').then(({ scrape }) => scrape('medium', 'user', { username: 'medium', limit: 3 })).then(r => console.log(r.posts.length))"` returns posts when network available (or unit tests cover offline path).
- [x] `node -e "import('src/scrapers/social/medium/index.js').then(m => console.log(Object.keys(m)))"` lists `MediumClient`, `MediumCrawler`, `MediumPlatformResponseValidator`.
- [x] No `Record<string, any>` or `@ts-ignore` introduced.
- [x] No new dependency added without updating `package.json` and running `npm install`.
- [x] `.env.example` updated.
- [x] `src/scrapers/social/index.js` and `src/scrapers/index.js` updated.
- [x] `src/scrapers/social/actions-list.js` updated.

### Review Follow-ups from 35.1 to apply

- [x] Use `"social"` literal as `category`, không dùng `CATEGORIES.POST`.
- [x] Gọi `this.validateItem(item)` trên mọi item trước khi trả về / lưu.
- [x] Mỗi paginated action có `checkpointResolver` với `cursorField` + `fallbackCursorFields`.
- [x] Phát `defaultRedisStreamPublisher` nếu `redisPublisher` không được cấp.
- [x] Forward tất cả client config options (`baseUrl`, `userAgent`, `transport`, `timeout`, `proxyProvider`, etc.) từ dispatcher.
- [x] `MediumClient.resolveProxy()` chỉ force `country-us` / residential khi proxy pool/provider được cấu hình.
- [x] Parse rate-limit headers nếu Medium trả (ít gặp), nếu không thì dùng 1–3s delay mặc định.
- [x] Case-insensitive `transport` handling.
- [x] Browser bridge (nếu có) dùng mutex `#startPromise` / `#bridgePromise` để tránh duplicate Chromium và zombie process.
- [x] `close()` / `cleanup()` đóng browser/http client đúng cách.
- [x] `limit` args được parse `Number` và guard `NaN`.

## File List

**Create:**
- `src/scrapers/social/medium/client.js`
- `src/scrapers/social/medium/crawler.js`
- `src/scrapers/social/medium/normalizer.js`
- `src/scrapers/social/medium/validator.js`
- `src/scrapers/social/medium/index.js`
- `tests/scrapers/social/medium/client.test.js`
- `tests/scrapers/social/medium/crawler.test.js`
- `tests/scrapers/social/medium/normalizer.test.js`
- `tests/scrapers/social/medium/validator.test.js`
- `tests/scrapers/social/medium/integration.test.js` *(conditional, gated by `MEDIUM_INTEGRATION=1`)*

**Modify:**
- `src/scrapers/social/index.js` — add `medium` barrel export.
- `src/scrapers/index.js` — add `medium`/`md` platform + dispatch block + `createMediumClient`/`createMediumCrawler`.
- `src/scrapers/social/actions-list.js` — add `MediumCrawler`.
- `.env.example` — add `MEDIUM_TRANSPORT`, `MEDIUM_USER_AGENT`, `MEDIUM_INTEGRATION`.

**Optional / if Epic 35.4 or later expands scope (not required for 35.2 acceptance):**
- `src/mcp/server.js` — route `platform: 'medium'` to `scrape('medium', ...)`.
- `api/routes/platform.js` — add `/platform/medium/scrape`.
- `dashboard/platform.html` — add Medium to `validPlatforms` and `PLATFORM_CONFIG`.

## Change Log

- 2026-09-09 — Story 35.2 created from template; status `draft`.
- 2026-09-10 — Context engine analysis completed; expanded with latest live Medium research (RSS, `?format=json`, GraphQL, paywall/Cloudflare notes); set status `ready-for-dev`.
- 2026-09-11 — Implementation completed; RSS-first client, JSON fallback, crawler, normalizer, validator, bridge, dispatcher integration, and real `node:http` fixture tests pass; status `review`.

## Design Notes

### Medium public endpoints (verified live 2026-09-10)

1. **RSS/Atom feeds (primary, no auth):**
   - User: `https://medium.com/feed/@username` or `https://username.medium.com/feed`
   - Publication: `https://medium.com/feed/{publication-slug}` or `https://customdomain.com/feed`
   - Tag: `https://medium.com/feed/tag/{tag-name}` (old alias `/feed/topic/{tag}`)
   - Publication+tag: `https://medium.com/feed/{publication}/tagged/{tag}`
   - Feed returns ~10 latest `<item>`; no pagination.
   - XML namespaces: default RSS 2.0, `xmlns:dc`, `xmlns:content`, `xmlns:atom`. Fields: `title` (CDATA), `link`, `guid` (`isPermaLink="false"`), `category` (multiple, CDATA), `dc:creator` (CDATA), `pubDate` (RFC-822), `atom:updated` (ISO 8601), `content:encoded` (CDATA, full HTML for public posts, teaser for member-only).

2. **JSON endpoint `?format=json` (fallback, no auth):**
   - User + posts: `https://medium.com/@username?format=json` → `payload.user`, `payload.references.Post`, `payload.paging.next`.
   - Post: `https://medium.com/@username/slug-{postId}?format=json` → `payload.value`, `payload.references`.
   - Publication: `https://medium.com/{publication}?format=json` → `payload.collection`.
   - Response body bắt đầu bằng `])}while(1);</x>` — phải strip trước `JSON.parse`.

3. **GraphQL `/_/graphql` (surgical / experimental fallback, no auth for reads, disabled by default):**
   - POST JSON array `[{ operationName, variables, query }]` hoặc single object.
   - Candidate operation names from research: `PostDetailQuery`, `ViewerQuery`, `TopicLatestStorieQuery`.
   - **Rule:** GraphQL chỉ được sử dụng khi `transport === 'graphql'` được set hoặc dev đã verify operation/query trực tiếp với live Medium. Mặc định fallback dừng ở `?format=json` rồi Puppeteer.
   - Cần realistic browser `User-Agent`; invalid fields trả 400.

4. **HTML / Puppeteer (last resort):**
   - Khi Cloudflare block direct HTTP, dùng `puppeteer-extra-plugin-stealth` hoặc `playwright`.
   - Có thể đọc `window.__APOLLO_STATE__` hoặc evaluate `fetch` tới `/_/graphql` trong page context.

### Parsing configuration

```js
import { XMLParser } from 'fast-xml-parser';
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  preserveOrder: false,
});
```

Access paths:
- `rss.channel.item` array.
- `item.title.__cdata` or `item.title['#text']`.
- `item.guid['#text']` / `item.guid['@_isPermaLink']`.
- `item['content:encoded'].__cdata`.
- `item['dc:creator'].__cdata`.
- `item.category` may be string or array; if array, entries may be objects with `__cdata` or `'#text'`.

### HTML fallback decision

- Ưu tiên dùng `src/scrapers/adapters/puppeteer.js` hoặc `src/scrapers/adapters/playwright.js` (đã có trong dependencies) cho HTML fallback thay vì thêm `cheerio`/`jsdom` mới.
- Nếu team quyết định dùng `CheerioAdapter` hoặc `GotJsdomAdapter`, phải `npm add cheerio` hoặc `npm add jsdom` vào `dependencies` (không phải `devDependencies`) và cập nhật `package.json`.

### ID extraction

- `guid` thường là `https://medium.com/p/{12-hex}`.
- `link` chứa tracking params và slug kèm post id: `/-([a-f0-9]{12})(?:\?|$)/`.
- `externalId` của `PostItem` là 12 ký tự hex `postId` được extract từ `guid` hoặc `link`.
- `PostItem.id = medium:${externalId}` (đồng bộ với `generatePostId('medium', externalId)` của `src/core/types.js`).
- `metadata.guid` lưu full `guid` gốc; nếu không extract được `postId` thì fallback `externalId = guid` đầy đủ.
- `findExistingIds` hoạt động trên `externalId` nên `postId` 12-hex đảm bảo stable matching.

### Paywall / member-only detection

- RSS `content:encoded` chỉ chứa teaser + "Continue reading on Medium" → `metadata.isLocked: true`.
- JSON `value.isSubscriptionLocked: true`, `value.visibility: 2` → `metadata.isLocked: true`.
- GraphQL `postResult.isLocked: true` hoặc `visibility: "LOCKED"`.
- Không throw; vẫn trả `PostItem` với `content` = teaser/preview.

### Rate limiting & anti-bot

- Medium không trả public `X-RateLimit-*` headers.
- Cloudflare TLS/bot management có thể reset connection từ datacenter IP.
- Mitigation: HTTP/1.1, realistic Chrome UA, 1–3s delays, proxy rotation (`country-us` / residential), exponential backoff on 429/connection errors.

### Storage / Events

- Posts lưu qua `store.storeBatch(posts)`.
- Thin event phát qua `redisPublisher.publish(...)` với stream key `stream:social:raw_posts`, consumer group `nowing_nlp_workers`.
- Checkpoint dùng `(platform='medium', targetType, targetKey)` qua `store.saveCheckpoint`.

## Verification

**Commands:**
- `npx vitest run tests/scrapers/social/medium/client.test.js`
- `npx vitest run tests/scrapers/social/medium/crawler.test.js`
- `npx vitest run tests/scrapers/social/medium/normalizer.test.js`
- `npx vitest run tests/scrapers/social/medium/validator.test.js`
- `npx vitest run tests/scrapers/social/medium/` — all tests pass
- `npx tsc --noEmit | grep src/scrapers/social/medium` — no Medium-specific diagnostics
- `node --input-type=module -e "import('./src/scrapers/index.js').then(({ scrape }) => scrape('medium', 'user', { username: 'medium', limit: 3 })).then(r => console.log(r.posts.length)))"` — live probe
- `node -e "import('src/scrapers/social/medium/index.js').then(m => console.log(Object.keys(m)))"` — verify exports

**Optional E2E (cần env):**
- `MEDIUM_INTEGRATION=1 npx vitest run tests/scrapers/social/medium/integration.test.js`
- Dashboard: gọi `scrape('medium', 'user', { username: 'towards-data-science' })` qua universal dispatcher.

---

## Latest Technical Information (2026-09-10)

- Medium RSS feed `https://medium.com/feed/@karpathy` returns 8 items; first item title "Software 2.0", creator "Andrej Karpathy", 5 categories, `content:encoded` > 5,000 chars.
- `https://medium.com/@karpathy?format=json` returns 200 với XSSI prefix; `payload.user.username === 'karpathy'` và `payload.references.Post` chứa posts với `virtuals.totalClapCount`.
- Direct `curl`/`node` tới `medium.com` từ test environment bị `ECONNRESET` hoặc 403 với generic UA; HTTP/1.1 + Chrome UA + delays là cần thiết.
- `fast-xml-parser` đã có trong `package.json` (used by Reddit RSS fallback) — **không thêm parser RSS mới**.
- `cheerio` **chưa có** trong `package.json`; nếu dùng `CheerioAdapter` thì phải `npm add cheerio` (hoặc dùng `puppeteer`/`playwright`/`got-jsdom` đã có).
- `undici`, `got-scraping`, `puppeteer`, `playwright` đã có sẵn trong dependencies.
- Member-only / paywalled content bị giới hạn ở teaser; full text cần `sid`/`uid` cookies (out of scope).

## Ultimate context engine analysis completed - comprehensive developer guide created