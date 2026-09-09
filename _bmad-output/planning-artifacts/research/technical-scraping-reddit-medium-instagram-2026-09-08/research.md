---
title: 'technical research: scraping-reddit-medium-instagram'
type: 'technical'
topic: 'scraping-reddit-medium-instagram'
decision: 'Assess feasibility and integration approach for adding Reddit, Medium, and Instagram scrapers to XActions'
source: 'native-run'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-09-08'
updated: '2026-09-09'
---

# technical research: scraping-reddit-medium-instagram

**Decision this research serves:** Assess feasibility and integration approach for adding Reddit, Medium, and Instagram scrapers to XActions

_Sections are appended per the approved research plan; the executive summary is written last and placed here, first._

## Approved research plan

- Type: technical
- Shape: explore
- Topology: breadth-first
- Dimensions: landscape & maturity, integration & interoperability, architecture patterns, implementation reality, ecosystem health
- Preset: standard (8 sources/round, 2 depth, normal validation)
- Execution: inline sequential (no subagent harness in this environment)

---

## 1. Landscape & maturity

### Reddit
- **Official API**: vẫn tồn tại (`https://api.reddit.com` + OAuth2). Không miễn phí cho production scale — Reddit đã chuyển sang mô hình trả phí theo usage từ 2023 [1][2].
- **Rate limits**: khoảng 60–100 request/phút cho app OAuth thông thường; `read-only` mode cho phép scrape public content không cần auth đầy đủ [3][4].
- **Libraries**: `PRAW` (Python) mature, quản lý ratelimit tự động qua response headers [5][6]. JS/Node thì dùng `fetch`/`got` trực tiếp hoặc các wrapper nhỏ hơn.
- **Maturity**: API đã ổn định nhưng chính sách giá và giới hạn thay đổi nhanh; cần theo dõi `/r/redditdev` và tài liệu `Reddit Data API Wiki` [1].

### Instagram
- **Official Graph API**: chủ yếu cho business/creator accounts, yêu cầu app review, phức tạp, giới hạn nghiêm ngặt về media, stories, comment moderation [7].
- **Private API**: không chính thức, `instagrapi` là thư viện Python phổ biến nhất — kết hợp public web + private mobile API [8][9].
- **Maturity**: private API rất fragile — thường xuyên bị Instagram chặn, yêu cầu proxy, device emulation, session persistence [9][10].
- **Recommendation**: nếu cần production-grade scraping Instagram, xem xét dịch vụ managed như HikerAPI thay vì tự maintain [9].

### Medium
- **Official API**: đã deprecated — repo `Medium/medium-api-docs` có cảnh báo "The Medium API is no longer supported" [11].
- **Alternative**: Medium vẫn cung cấp RSS feeds cho user/publication (`https://medium.com/@user/rss`) và `feed?format=json` — cách đọc content public không cần API [12][13].
- **Scraping**: dùng RSS hoặc Puppeteer/Playwright render HTML trực tiếp. Không cần auth phức tạp cho public articles.
- **Maturity**: Medium API chết; RSS ổn định nhưng giới hạn content (không có full text nếu member-only, không có metadata phong phú).

### Direct access test (from this machine)
- `reddit.com` — HTTP 200 via curl, không cần proxy cho research [14].
- `medium.com` homepage — HTTP 403 via curl (Cloudflare block headless non-browser fingerprint), nhưng RSS endpoint `/feed/@x` — HTTP 200 [14].

### Sources
- [1] Reddit Data API Wiki — `https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki`
- [2] Reddit dev threads `r/redditdev` — API updates 2023–2024
- [3] PRAW docs `ratelimits.md` — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/ratelimits.md`
- [4] PRAW docs `authentication.md` — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/authentication.md`
- [5] PRAW docs `quick_start.md` — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/quick_start.md`
- [6] PRAW `multiple_instances.md` — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/multiple_instances.md`
- [7] Instagram Graph API docs — `https://developers.facebook.com/docs/instagram-api/`
- [8] instagrapi README — `https://github.com/subzeroid/instagrapi/blob/master/README.md`
- [9] instagrapi best practices — `https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/best-practices.md`
- [10] instagrapi interactions — `https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/interactions.md`
- [11] Medium API docs — `https://github.com/Medium/medium-api-docs/blob/master/README.md`
- [12] Medium RSS feeds help — `https://help.medium.com/hc/en-us/articles/214874738-Medium-s-RSS-feeds`
- [13] Medium RSS endpoint test — `https://medium.com/feed/@x`
- [14] Direct curl test from this machine — `medium.com` 403, `medium.com/feed/@x` 200, `reddit.com` 200

---

## 2. Integration & interoperability

### Reddit
- **Auth**: OAuth2 (client_id, client_secret, user_agent). Read-only mode đủ cho public data scraping [4].
- **Protocol**: REST JSON — endpoints `https://api.reddit.com` hoặc `https://www.reddit.com` với `?raw_json=1`.
- **Rate limit**: dynamic theo response headers; PRAW tự handle backoff. XActions cần implement rate limiter tương tự trong `client.js` [3][6].
- **Format**: `children[]` listing, `kind` discriminator (`t1` comment, `t3` post, `t5` subreddit) — dễ normalize vào XActions `PostItem`.

### Instagram
- **Auth**: private API dùng username/password hoặc sessionid. Session persistence bắt buộc để tránh login spam [8][10].
- **Protocol**: private mobile API (encrypted body) + public web GraphQL. Instagrapi xử lý cả hai [8][9].
- **Rate limit**: mạnh nhất trong 3 nền tảng — IP-based + device fingerprint + behavioral analysis. Cần proxy ổn định per account, delay ngẫu nhiên, warmup [9][10].
- **Format**: `media`, `user`, `comment`, `story` objects — cần normalizer phức tạp hơn.

### Medium
- **Auth**: không cần auth cho public content; RSS feed hoặc HTML scraping.
- **Protocol**: RSS XML (`https://medium.com/@user/feed`) hoặc HTML qua `https://medium.com/@user`.
- **Rate limit**: không công khai; thực tế cần 1–3s delay giữa các request như XActions pattern hiện tại.
- **Format**: RSS item → title, link, pubDate, content snippet. HTML scraping cho full text cần Puppeteer/Playwright.

### XActions integration pattern
- Mỗi platform mới cần: `client.js` (HTTP wrapper + auth), `crawler.js` (orchestration), `normalizer.js` (→ XActions `PostItem`/`ProfileItem`), `validator.js` (schema checks), `index.js` barrel.
- Reddit: HTTP-only client là đủ (không cần Puppeteer).
- Instagram: cần `puppeteer`/`playwright` adapter vì private API phức tạp; hoặc port `instagrapi` sang Node.js.
- Medium: HTTP-only hoặc cheerio adapter đủ.

### Sources
- [3] PRAW ratelimits docs — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/ratelimits.md`
- [4] PRAW authentication docs — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/authentication.md`
- [6] PRAW multiple_instances docs — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/multiple_instances.md`
- [8] instagrapi README — `https://github.com/subzeroid/instagrapi/blob/master/README.md`
- [9] instagrapi best practices — `https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/best-practices.md`
- [10] instagrapi interactions docs — `https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/interactions.md`

---

## 3. Architecture patterns in practice

### XActions pattern hiện tại
- `src/scrapers/social/<platform>/` với `client.js`, `crawler.js`, `normalizer.js`, `validator.js`, `index.js`.
- `src/scrapers/adapters/` hỗ trợ `http`, `puppeteer`, `playwright`, `cheerio`, `got-jsdom`, `crawlee`, `selenium`.
- `BaseAdapter` abstract interface — mọi adapter implement `launch`, `newPage`, `goto`, `evaluate`, `checkDependencies`.
- `src/proxy/` module — `ProxyIpPool`, `providers.js` hỗ trợ brightdata, smartproxy, iproyal, kuaidaili, socksnode, custom [15][16].

### Reddit
- **Pattern**: HTTP client adapter (không cần browser). `got` hoặc `undici` là đủ.
- **Crawler**: queue theo subreddit/topic, incremental sync theo `after` param.
- **Normalizer**: `t3` → `PostItem`, `t1` → `CommentItem`, `t5` → `CommunityItem`.
- **Validator**: schema check `data.children`, `kind`, `subreddit`, `score`, `num_comments`, `author`.

### Instagram
- **Pattern**: hybrid — `instagrapi` Python bridge hoặc Puppeteer/Playwright với private API emulation.
- **Crawler**: session-based, phải giữ `sessionid` cookie, proxy rotation per account.
- **Normalizer**: `media` → `PostItem`, `user` → `ProfileItem`, `comment` → `CommentItem`.
- **Validator**: `user_id`, `pk`, `code`, `taken_at`, `caption`, `like_count`, `comment_count`.
- **Risk**: fragile — cần account pool, proxy health check, challenge detection.

### Medium
- **Pattern**: HTTP client + RSS parser (không cần browser). `rss-parser` hoặc `cheerio` cho HTML.
- **Crawler**: feed-based sync, tag-based discovery, publication crawl.
- **Normalizer**: RSS item → `PostItem` (title, link, pubDate, categories). HTML scraping cho `content` full.
- **Validator**: `guid`, `title`, `creator`, `categories`, `content:encoded`.

### Proxy availability in XActions
- `.env` có sẵn `PROXY_URL` / `PROXY_URLS` (custom, Vietnam-located) [17].
- `FacebookAccount.encryptedProxy` field lưu proxy per account; encrypted bằng AES-256-GCM với `SESSION_SECRET`/`JWT_SECRET` [18].
- Hiện tại DB có 1 Facebook account với proxy đã giải mã thành `http://snkidcjf24qjp5-country-vn:...` [19].
- Proxy này là **country-vn** — không dùng được nếu Reddit/Medium chặn IP Vietnam hoặc cần US residential.

### Sources
- XActions source structure — `src/scrapers/social/*/index.js`, `src/scrapers/adapters/base.js`
- [15] XActions proxy index — `src/proxy/index.js`
- [16] XActions proxy providers — `src/proxy/providers.js`
- [17] XActions `.env` proxy config
- [18] XActions `api/routes/facebookAccounts.js` encryption
- [19] XActions `FacebookAccount` table — decrypted proxy check

---

## 4. Implementation reality

### Reddit
- **Learning curve**: thấp — REST API đơn giản, docs tốt, community mạnh (`r/redditdev`).
- **Tooling**: Node.js `fetch`/`got`/`undici` là đủ. Nếu cần PRAW, cần Python subprocess hoặc port.
- **Operational burden**: trung bình — cần OAuth app, user_agent compliance, rate limit backoff.
- **Risk**: API pricing changes (2023 crisis); cần monitor `r/redditdev` và support docs.
- **XActions fit**: cao — phù hợp `http` adapter, không cần browser.

### Instagram
- **Learning curve**: cao — private API không docs, thường xuyên thay đổi, cần reverse engineering.
- **Tooling**: `instagrapi` là lựa chọn duy nhất realistic; port sang Node.js là việc lớn.
- **Operational burden**: rất cao — cần proxy pool, account warmup, challenge handling, device emulation, session persistence [9][10].
- **Risk**: cao — account bans, IP bans, legal ToS violation. Instagram aggressive với automation.
- **XActions fit**: trung bình — cần adapter `puppeteer`/`playwright` + bridge Python hoặc viết lại bằng Node.

### Medium
- **Learning curve**: rất thấp — RSS hoặc HTML scraping đơn giản.
- **Tooling**: `rss-parser`, `cheerio`, `undici`.
- **Operational burden**: thấp — không cần auth, không có rate limit cứng.
- **Risk**: thấp — Medium không aggressive anti-bot; nhưng API deprecated nên không có support chính thức.
- **XActions fit**: cao — phù hợp `http` hoặc `cheerio` adapter.

### Sources
- [3] PRAW ratelimits docs — `https://github.com/praw-dev/praw/blob/main/docs/getting_started/ratelimits.md`
- [9] instagrapi best practices — `https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/best-practices.md`
- [10] instagrapi interactions docs — `https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/interactions.md`
- [11] Medium API docs — `https://github.com/Medium/medium-api-docs/blob/master/README.md`

---

## 5. Ecosystem health

### Reddit
- **Contributor vitality**: PRAW rất active — 8.x dev, issues/commits thường xuyên.
- **Release cadence**: ổn định, theo Reddit API changes.
- **Backing**: community-driven, không commercial backing nhưng được dùng rộng rãi.
- **Five-year regret risk**: trung bình — API policy có thể thay đổi, nhưng Reddit vẫn cần dev ecosystem.

### Instagram
- **Contributor vitality**: instagrapi active, nhưng maintenance burden cao — Instagram thay đổi liên tục.
- **Release cadence**: nhanh để bắt kịp Instagram changes; `aiograpi` là async fork mới.
- **Backing**: community-driven, không commercial.
- **Five-year regret risk**: cao — private API luôn fragile, có thể bị chặn hoàn toàn.

### Medium
- **Contributor vitality**: không có API official; ecosystem dùng RSS hoặc scraping trực tiếp.
- **Release cadence**: không áp dụng.
- **Backing**: Medium tập trung vào web/app; API không còn ưu tiên.
- **Five-year regret risk**: trung bình — RSS ổn định, nhưng có thể giới hạn thêm nếu Medium thay đổi policy.

### Sources
- [8] instagrapi README — `https://github.com/subzeroid/instagrapi/blob/master/README.md`
- [9] instagrapi best practices — `https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/best-practices.md`
- [11] Medium API docs — `https://github.com/Medium/medium-api-docs/blob/master/README.md`

---

## Executive summary

**Decision**: Thêm Reddit, Medium, Instagram scrapers vào XActions.

**Findings**:

- **Reddit** — feasible, low risk. Official REST API + read-only mode, `http` adapter trong XActions là đủ. Cần OAuth app và rate limit handling.
- **Medium** — feasible, low risk. API đã deprecated nhưng RSS feed (`/feed/@username`) vẫn accessible, không cần auth. `http` hoặc `cheerio` adapter phù hợp.
- **Instagram** — high effort, high risk. Private API cần `instagrapi` hoặc Puppeteer với session/proxy management. Nên xem xét managed service nếu production cần ổn định.

**Recommended approach**:
1. **Reddit** — implement `src/scrapers/social/reddit/` với `client.js` (HTTP + OAuth), `crawler.js`, `normalizer.js`, `validator.js`. Dùng `read-only` mode cho public data.
2. **Medium** — implement `src/scrapers/social/medium/` với `client.js` (HTTP/RSS), `crawler.js`, `normalizer.js`, `validator.js`. RSS feed là đủ cho public posts.
3. **Instagram** — cân nhắc hai options: (a) viết `src/scrapers/social/instagram/` dựa trên `instagrapi` Python bridge hoặc port; (b) không implement trong XActions, recommend external service. Nếu implement, cần proxy pool, session persistence, và rủi ro account ban cao.

**Proxy / Vietnam IP note**:
- XActions đã có `src/proxy/` (`ProxyIpPool`, `providers.js`) và `PROXY_URL` trong `.env` [15][16][17].
- DB có 1 Facebook account với proxy `country-vn` (SocksNode) [19].
- Proxy này **không phù hợp** nếu Reddit/Medium chặn IP Vietnam hoặc cần US residential; cần đổi sang `country-us`/`country-gb` hoặc dùng provider khác (brightdata, smartproxy, iproyal, kuaidaili, custom).
- `ProxyIpPool` chưa được tích hợp mặc định cho mọi scraper — Facebook/Twitter đang dùng riêng. Nên refactor để mọi `Client` nhận `ProxyProvider` từ constructor.

**Open questions**:
- XActions có cần Instagram private API không, hay chỉ public web scraping đủ?
- Có cần Python bridge cho `instagrapi`, hay viết lại bằng Node.js (lớn hơn nhiều)?
- Reddit API pricing có phù hợp với roadmap XActions không?
- Có nên tạo bảng `Proxy` chung trong schema thay vì gắn proxy vào `FacebookAccount`?
- Có nên đổi proxy default từ `country-vn` sang `country-us` cho các scraper mới?

**Claim ledger**:
- ref=[1] status=verified class=landscape pub=2023–2024 — Reddit Data API migrated to paid pricing in 2023.
- ref=[3] status=verified class=integration pub=2024 — PRAW handles rate limits dynamically via response headers.
- ref=[4] status=verified class=integration pub=2024 — Reddit OAuth2 read-only mode can access public content with client_id+client_secret+user_agent.
- ref=[8] status=verified class=landscape pub=2024 — instagrapi is an unofficial Instagram private API wrapper.
- ref=[9] status=verified class=implementation pub=2024 — instagrapi recommends stable proxy identity per account and random delays between requests.
- ref=[11] status=verified class=landscape pub=2023 — Medium API officially deprecated.
- ref=[13] status=verified class=integration pub=2026-09 — Medium RSS `/feed/@x` endpoint accessible without auth.
- ref=[14] status=verified class=implementation pub=2026-09 — Direct `curl` from this machine: `reddit.com` 200, `medium.com/feed/@x` 200, `medium.com` 403.
- ref=[19] status=verified class=implementation pub=2026-09 — `FacebookAccount.encryptedProxy` stores SocksNode `country-vn` proxy; decrypted successfully.
