---
title: 'Story 25.1: Universal scrape() Dispatcher'
type: 'refactor'
created: '2026-09-12'
status: 'ready-for-dev'
epic: 25
context:
  - src/scrapers/index.js
  - src/core/base-crawler.js
  - src/scrapers/social/index.js
  - src/scrapers/deprecation-proxy.js
  - api/services/facebookScrape.js
  - tests/scrapers/facebook-exports.test.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Story

As a **XActions Platform Engineer**,
I want **`src/scrapers/index.js` trở thành một thin dispatcher duy nhất cho mọi platform**,
so that **không còn logic scraper nào nằm ngoài `<platform>/` module dirs và `scrape(platform, action, args)` là entry point duy nhất**.

## Intent

**Problem:** `src/scrapers/index.js` là một monolith ~2,895 dòng. `scrape()` (~line 530–2625) chứa ~20 khối `if (platformName === ...)` gần-như-giống-hệt-nhau, mỗi khối tự map action → normalize args → `new XxxClient(...)` → `new XxxCrawler({...})` → `crawler.start(...)`. Logic scraper bị trùng lặp trong dispatcher thay vì nằm trong từng platform module — vi phạm Epic 25 ("`scrape(platform, action, args)` là entry point duy nhất") và NFR18 ("zero legacy imports").

**Approach:** Biến `scrape()` thành thin dispatcher data-driven: mỗi platform khai báo một **descriptor** (aliases + actionMap + mapArgs + client/crawler factories) co-located trong platform dir; `scrape()` chỉ còn resolve descriptor → map args → build client/crawler → `.start({ action, args, session })` → autoClose. Toàn bộ per-platform arg-mapping và option-forwarding phải được **chuyển nguyên vẹn** — đây là refactor thuần, zero behavior change.

## Boundaries & Constraints

**Always:**
- `scrape(platform, action, options)` public signature giữ nguyên; toàn bộ alias hiện có (`x`, `fb`, `bsky`, `masto`, `rdt`, `md`, `ig`, `insta`, `bds`, `mst`, `oto_vn`, `bonbanh`, `chotot_xe`, `pasgo`, `foody`, `riviu`, `medpro`, `youmed`, `nhathuoclongchau`, `thuocsi`, `zalo_oa`, `zalo_official_account`, `yt`, `youtube_vn`, `ipvietnam`, `ip_legal`, `legal`, `hosocongty`, `muasamcong`, `top_cv`, `vietnam_works`, `vnw`, `cho_tot`, `maso_thue`, `tiktok_shop`, `medium_com`, `youtube_vn`) phải resolve đúng platform.
- Mọi platform block hiện có trong `scrape()` phải có descriptor tương ứng — **không được drop platform nào**: twitter, facebook, threads, bluesky, mastodon, tiktok, reddit, medium, instagram, shopee, tiktokshop, topcv, vietnamworks, linkedin, chotot, batdongsan, masothue, automotive, fnb, healthcare, zalo, youtube, ipLegal, b2b_registry_extended.
- `options.client instanceof XClient` → reuse caller-provided client (DI hiện có, giữ nguyên per-platform).
- `store = options.store || defaultStore`; forward `session`, `resume`, `dryRun`, `cursor`, `after` qua mappedArgs — `args.resume:false` do `AbstractCrawler.start()` xử lý (Story 25.5, KHÔNG reimplement).
- `options.cursor`/`options.after` từ caller luôn thắng checkpoint cursor — behavior này đã nằm trong `AbstractCrawler.start()` (base-crawler.js:235+), dispatcher chỉ cần forward args nguyên vẹn.
- `options.autoClose !== false` → `crawler.cleanup()` trong `finally` như hiện tại.
- `dispatchFacebookHybrid(action, options)` vẫn là named export hoạt động — `api/services/facebookScrape.js` import trực tiếp (lines 18, 89, 126, 157).
- `npm run typecheck` pass; `vitest run tests/scrapers tests/api` pass.

**Ask First:**
- Nếu muốn đổi `platforms.<name>` sang trỏ social barrels thay vì legacy modules — `tests/scrapers/facebook-exports.test.js` assert `platforms.facebook === facebook` (legacy module có `createBrowser`/`loginWithCookie`) và `api/routes/facebook.js` còn dùng legacy fns. Repoint = behavior change thuộc phạm vi 25.3/25.4.
- Nếu muốn xoá thư mục legacy (`src/scrapers/twitter/`, `facebook/`, `threads/`, `bluesky/`, `mastodon/`) — thuộc Epic 26, tuyệt đối không xoá trong story này.

**Never:**
- Không đổi `package.json` exports (Story 25.2).
- Không migrate callers trong `src/mcp/`, `src/cli/`, `api/` (Story 25.3).
- Không thêm `ErrorTypes.DEPRECATED` mapping (Story 25.4).
- Không đổi output shape của bất kỳ action nào; không đổi `AbstractCrawler`, `AbstractApiClient`, crawler con nào.
- Không reimplement checkpoint/resume/`shouldStopPagination` trong dispatcher — đã có trong `AbstractCrawler.start()` (Stories 25.5–25.7).
- Không drop Facebook `options.page` Puppeteer path (Story 13.10 — vẫn được api/ + tests dùng).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | `scrape('reddit','search',{query:'x'})` | Descriptor resolve → RedditCrawler.start | — |
| Alias | `scrape('rdt','search',...)` | Resolve cùng descriptor reddit | — |
| Unknown platform | `scrape('myspace',...)` | `Unknown platform "myspace". Available: ...` (không list alias ngắn `x`/`fb`/`bsky`/`masto` — giữ behavior `getPlatform` hiện tại) | Error, không statusCode |
| Unknown action | `scrape('reddit','bogus')` | `actionNotAvailable` → err.statusCode=400, code=`XACT_4001`, message list available actions | 400-level |
| DI injection | `options.client` là `XClient` instance | Reuse, không `new` | — |
| DI injection | `options.store/governor/accountPool/proxyPool/proxyProvider/sessionManager` | Forward vào crawler ctor đúng như block hiện tại | — |
| Resume off | `args.resume:false` | AbstractCrawler skip checkpoint lookup | — |
| Cursor priority | `options.cursor` + checkpoint tồn tại | Caller cursor thắng | — |
| Facebook + page | `scrape('facebook', action, {page, authCookie})` | Legacy page path: `getPlatform('facebook')` → module fns (`scrapeProfile`...), `loginWithCookie(page, authCookie, browserOptions)`, noTargetActions (`scrapeBookmarks`/`scrapeNotifications`/`scrapeTrending`) gọi `fn(page, options)` | giữ nguyên |
| autoClose | `options.autoClose === false` | Không gọi `crawler.cleanup()` | — |
| Legacy tail | bất kỳ platform nào | **Dead code** — mọi platform trong `platforms` map đều có block → tail `needsPuppeteer` (~line 2490–2625) unreachable → xoá | — |

## Code Map

### File bị refactor (UPDATE)

- **`src/scrapers/index.js`** — 2,895 dòng → mục tiêu **< ~500 dòng**. Cấu trúc hiện tại:
  - L40–42: legacy imports `twitter`/`threads`/`facebook` ← **phải xoá khỏi file này** (AC).
  - L45–150: imports crawler/client/validator của ~20 platforms (giữ — đây là kiến trúc mới).
  - L211–285: `platforms` registry + `getPlatform()` — public API, **di chuyển nguyên vẹn** sang `platforms.js` (xem dưới).
  - L295+: `actionNotAvailable()`, `dispatchFacebookHybrid()`, per-action helpers (zalo arg-shaping L480+...).
  - L530–2625: `scrape()` monolith — ~20 if-blocks, mỗi block = `X_ACTION_MAP` → `mappedArgs` normalization → `options.client instanceof XClient ? reuse : new XClient({...15 options})` → `new XxxCrawler({client, store, governor, accountPool, proxyPool, proxyProvider, sessionManager, requiresAuth, requiresProxy, transport, redisPublisher})` → `crawler.start({action: mappedAction, args: mappedArgs, session: options.session})` → `finally { autoClose cleanup }`.
  - L2445–2497: Facebook block — `options.page` → legacy path qua `getPlatform()`; else `dispatchFacebookHybrid`.
  - L2490–2625: legacy generic tail (`needsPuppeteer` + global actionMap + auto-browser/proxyAuth/login) — **dead code**, xoá.
  - L2640–2895: export surface — `getPluginScraper`, `exportToJSON/CSV`, `createXxxClient`/`createXxxCrawler` factories (mọi platform), class re-exports, `scrapeXxx` helpers, default export object — **giữ nguyên 100%**.

### Files mới (NEW)

- **`src/scrapers/platforms.js`** — module-registry chứa `platforms` map + `getPlatform()` + legacy imports (`./twitter/index.js`, `./threads/index.js`, `./facebook/index.js`) + các proxy entries (`blueskyProxy`, `mastodonProxy`, `redditProxy`, `mediumProxy`, `instagramProxy` từ `deprecation-proxy.js`). `index.js` re-export `{ platforms, getPlatform }` → public API không đổi, `index.js` hết legacy imports (thoả AC "legacy import bị xoá trong index.js").
- **Per-platform `descriptor.js`** co-located trong platform dir (convention giống `crawler.js`/`client.js`/`validator.js`):
  - `src/scrapers/social/{twitter,facebook,threads,bluesky,mastodon,tiktok,reddit,medium,instagram}/descriptor.js`
  - `src/scrapers/ecom/{shopee,tiktok-shop}/descriptor.js`
  - `src/scrapers/recruitment/{topcv,vietnamworks,linkedin}/descriptor.js`
  - `src/scrapers/realestate/{chotot,batdongsan}/descriptor.js`
  - `src/scrapers/procurement/{masothue,b2b-registry-extended}/descriptor.js`
  - `src/scrapers/vehicles/automotive/descriptor.js`
  - `src/scrapers/{fnb,healthcare,zalo,youtube,legal/ip-trademark}/descriptor.js`

### Descriptor contract (đề xuất — dev theo mẫu này)

```js
// src/scrapers/social/reddit/descriptor.js
export default {
  aliases: ['reddit', 'rdt'],
  actionMap: { subreddit: 'subreddit', posts: 'subreddit', feed: 'subreddit', /* ...nguyên REDDIT_ACTION_MAP... */ },
  mapArgs(options) { /* ...nguyên khối mappedArgs của reddit, kể cả URL→postId/subreddit extraction... */ },
  createClient(options) { /* ...nguyên khối new RedditClient({...}) + instanceof check... */ },
  createCrawler({ client, store, options }) { /* ...nguyên khối new RedditCrawler({...})... */ },
  // optional: dispatch(platformName, action, options) — override cho special paths (facebook page-path)
};
```

`scrape()` sau refactor (~40 dòng):

```js
export async function scrape(platform, action, options = {}) {
  const platformName = platform.toLowerCase();
  const descriptor = DESCRIPTORS[platformName];
  // Mọi key trong `platforms` map đều có descriptor → miss ở đây = unknown platform.
  if (!descriptor) {
    getPlatform(platform); // throws "Unknown platform ..." — giữ nguyên error shape
    throw new Error(`No dispatcher descriptor registered for platform "${platformName}"`); // defensive, unreachable
  }
  if (descriptor.dispatch) return descriptor.dispatch(platformName, action, options); // facebook page-path
  const mappedAction = descriptor.actionMap[action] || action;
  const mappedArgs = descriptor.mapArgs(options);
  const store = options.store !== undefined ? options.store : defaultStore;
  const client = descriptor.createClient(options);
  const crawler = descriptor.createCrawler({ client, store, options });
  try {
    return await crawler.start({ action: mappedAction, args: mappedArgs, session: options.session });
  } finally {
    if (options.autoClose !== false) await crawler.cleanup().catch(() => {});
  }
}
```

### Existing code PHẢI reuse (không reinvent)

- `src/core/base-crawler.js` — `AbstractCrawler.start(command)` từ L235: validate action (`XACT_4001`), checkpoint lookup qua `checkpointResolver`, `resume:false`, cursor precedence. Dispatcher KHÔNG đụng vào.
- `src/scrapers/social/index.js` — đã export đủ social crawlers/clients/validators (kể cả reddit/medium/instagram từ Epic 35). Thêm `export * as <platform>Descriptor` nếu muốn expose descriptors.
- `src/scrapers/deprecation-proxy.js` — pattern warn-once Proxy cho `blueskyProxy`/`mastodonProxy`/`redditProxy`/`mediumProxy`/`instagramProxy` — chuyển import sang `platforms.js`, không viết lại.
- `actionNotAvailable(platform, action, available)` — giữ nguyên, tái sử dụng cho unknown-action error.
- `dispatchFacebookHybrid` — giữ nguyên + export.

## Tasks & Acceptance

**Execution:**

- [ ] Tạo `src/scrapers/platforms.js`: move `platforms` map + `getPlatform()` + 3 legacy imports + proxy entries. `index.js` re-export.
- [ ] Tạo `descriptor.js` cho 24 platform dirs theo contract trên — **copy nguyên vẹn** actionMap/mappedArgs/client-ctor/crawler-ctor từ block tương ứng trong `scrape()` (reddit L950–1045 là mẫu điển hình).
- [ ] Facebook descriptor: `dispatch()` override chứa `options.page` legacy path + fallback `dispatchFacebookHybrid` (L2445–2497).
- [ ] Rewrite `scrape()` thành thin dispatcher; xoá 20 if-blocks + legacy tail (L2490–2625, dead code).
- [ ] Giữ nguyên toàn bộ export surface cuối file + `src/scrapers/index.d.ts` cập nhật nếu cần.
- [ ] `src/scrapers/social/index.js`: export descriptors cho social platforms (AC: "export all platform crawlers/clients/validators" — đã có, chỉ thêm descriptors).
- [ ] Test mới `tests/scrapers/dispatcher.test.js`: alias resolution cho ít nhất 1 alias/platform, DI injection (client/store/proxyPool forward), `resume:false` + `cursor` forwarding (spy vào `crawler.start` args), unknown platform error, `autoClose:false`, facebook page-path smoke.
- [ ] `vitest run tests/scrapers tests/api` — toàn bộ dispatch/dispatcher/caller-migration/facebook-* tests phải xanh **không sửa test** (trừ khi test assert chính xác dead-code đã xoá).
- [ ] `npm run typecheck` pass.

**Acceptance (BDD từ epic + mở rộng):**

- [ ] **AC1:** `scrape('twitter'|'facebook'|'threads'|'bluesky'|'mastodon', action, args)` → resolve `AbstractCrawler` instance → `.start({action, args})` — và tương tự cho mọi platform trong registry.
- [ ] **AC2:** DI: `options.{client,store,governor,accountPool,proxyPool,proxyProvider,sessionManager}` được forward đúng.
- [ ] **AC3:** `import twitter from './twitter/index.js'` (+ threads, facebook) không còn trong `src/scrapers/index.js`.
- [ ] **AC4:** `src/scrapers/social/index.js` export all platform crawlers/clients/validators (+ descriptors).
- [ ] **AC5:** `args.resume:false` tắt auto checkpoint lookup; `options.cursor` luôn thắng checkpoint (qua `AbstractCrawler.start()`, không code mới).
- [ ] **AC6 (regression):** Toàn bộ tests hiện có pass — đặc biệt `tests/scrapers/**/dispatch*.test.js`, `caller-migration.test.js`, `facebook-*.test.js`, `tests/api/`.
- [ ] **AC7 (NFR18):** `npm run typecheck` pass; không còn dead legacy tail.

## Dev Notes

### Regression risks đã identify (đừng tái phạm)

1. **`platforms.facebook === facebook` (legacy module)** được assert trong `facebook-exports.test.js` + `api/routes/facebook.js` + `api/services/facebookScrape.js` dùng legacy fns → `platforms` map phải giữ legacy entries (trong `platforms.js`), KHÔNG repoint sang social barrels trong story này.
2. **Per-platform arg-mapping là phần fragile nhất** — vd. reddit parse `options.url` → `postId` (`/comments/(id)/`) + `subreddit` (`/r/(name)/`), tiktok `cursor→after`, healthcare/fnb/b2b có `targetPlatform`/`platform` sub-dispatch, twitter `unretweet→undo_retweet`. Copy nguyên vẹn, không "cleanup" khi move.
3. **`options.client instanceof XClient` per-platform** — generic `instanceof` check không đủ vì mỗi platform một Client class khác nhau → phải nằm trong `createClient` của từng descriptor.
4. **`options.store !== undefined` vs `||`** — một số block dùng `options.store || defaultStore`, số khác dùng `!== undefined` (khác nhau khi `store:null` có nghĩa "tắt persistence"). **Preserve đúng từng block's semantic** — đưa vào descriptor's `createCrawler`, không normalize.
5. **Zalo arg-shaping** (~L460–500): `message/content`, `recipientUids/recipients` array coercion, `postUrl/postUrls[0]`, `share_link_uid` → `recipientUid` — move vào zalo `mapArgs`.
6. **`getPluginScraper`, `exportToJSON/CSV`, default export** — public surface, giữ nguyên.
7. `src/scrapers/index.d.ts` tồn tại — nếu signature nào đổi thì cập nhật; scrape/getPlatform signatures KHÔNG đổi.

### Previous Story Intelligence

- **25.5/25.6/25.7 (done):** checkpoint engine + resolvers + early-termination đã nằm TRONG `AbstractCrawler`/crawler con. Story này chỉ cần `crawler.start({action, args, session})` — mọi resume/ET tự chạy. `resume`/`dryRun` forwarding đã được thêm vào scrape() ở commit `800d1070` — mappedArgs của tiktok phải giữ forward 2 key này.
- **Epic 35 retro:** `base-client` giờ tự xử lý dead-proxy→direct retry cho mọi platform — dispatcher không cần biết.
- **Story 13.10:** Facebook `options.page` legacy path là deliberate bridge — preserve.
- **Story 15.2 caller-migration test:** `tests/scrapers/social/tiktok/caller-migration.test.js` spin local HTTP server verify dispatcher wiring end-to-end — regression test tốt nhất cho refactor này.

### Git Intelligence

- `800d1070` — resume/dryRun forwarding + count default (TikTok hardening, đã merge).
- `a1a8d351` — dead-proxy retry lift vào base-client (không liên quan trực tiếp nhưng cho thấy pattern "lift shared logic vào base/registry").
- `64a0b8fa` — scheduler dashboard gọi `scrape()` qua api routes — consumer thật cần giữ behavior.
- Baseline tests hiện tại: **xanh** (417+ pass ở run gần nhất) — mọi failure sau refactor là do story này.

### Testing Standards

- Vitest 4.x; `vitest run tests/scrapers tests/api` cho scope này, full suite trước khi done.
- Không mock/stub trong test mới — spy trên prototype hoặc local HTTP server như caller-migration test.

### References

- [Epic 25 + AC gốc: `_bmad-output/planning-artifacts/epics.md` §Epic 25, Story 25.1]
- [`src/scrapers/index.js` — monolith hiện tại]
- [`src/core/base-crawler.js` — `AbstractCrawler.start()` L235+]
- [`src/scrapers/social/index.js` — social barrel]
- [`src/scrapers/deprecation-proxy.js` — warn-once proxy pattern]
- [`api/services/facebookScrape.js` — `dispatchFacebookHybrid` consumer]
- [`tests/scrapers/facebook-exports.test.js` — platforms-map contract]
- [Stories 25-5/6/7 trong `_bmad-output/implementation-artifacts/stories/`]

## Dev Agent Record

### Agent Model Used

SWE-2 Max (story creation)

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Phân tích toàn bộ 2,895 dòng `src/scrapers/index.js`: 24 platform blocks, 1 facebook page-path, 1 dead legacy tail
- Identified critical regression risk: `platforms` map phải giữ legacy entries → giải pháp `platforms.js` extraction thoả AC "xoá legacy imports khỏi index.js" mà không phá public API
- Descriptor contract đề xuất co-located `descriptor.js` theo convention `crawler.js`/`client.js`/`validator.js` hiện có

### File List

_Để dev agent điền khi implement._
