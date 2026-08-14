---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/research/technical-facebook-bot-detection-countermeasures-research-2026-08-12.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
  - _bmad-output/implementation-artifacts/1-1-facebook-adapter-scaffold.md
  - _bmad-output/implementation-artifacts/5-6-marketplace-headless-share-v2.md
  - src/scrapers/facebook/index.js
  - src/scrapers/facebook/shareLinkByUid.js
  - api/services/facebookAutomation.js
  - api/routes/facebook.js
project_name: XActions
date: 2026-08-12
status: comprehensive
---

# XActions — Facebook Platform Complete Epic & Story Catalog

## Overview

Comprehensive epic and story breakdown for ALL Facebook features in XActions — covering 7 epics and 48 stories. Epics 1-5 were implemented first and spec'd retroactively from code + story files. Epic 5b covers features added without formal spec (marketplace, share-link-uid v2, headless, Chrome path). Epic 6 covers anti-detection countermeasures planned from research report.

## Requirements Inventory

### Functional Requirements

#### Epic 1-3: Facebook Data Reading & Multi-Surface

**FR1:** Hệ thống phải có Facebook adapter module (`src/scrapers/facebook/index.js`) với exports: `createBrowser`, `createPage`, `loginWithCookie`, `default` export object.

**FR2:** `loginWithCookie(page, { c_user, xs })` phải nhận object (không phải string), set cả 2 cookies trên `.facebook.com` domain với `httpOnly`/`secure` flags.

**FR3:** Module phải được đăng ký trong dispatcher `src/scrapers/index.js` với `facebook` + alias `fb` trong `platforms` object và `needsPuppeteer` array.

**FR4:** `scrapeProfile(page, username)` phải trả normalized shape: `{ name, username, bio, avatar, followers, url, platform: 'facebook' }`.

**FR5:** `scrapeTweets`/`scrapePosts(page, username, options)` phải trả post array: `{ id, text, timestamp, likes, comments, url, media, platform }`.

**FR6:** `scrapeFollowers(page, username, options)` phải scroll-load followers, trả array of normalized follower objects.

**FR7:** `searchTweets(page, query, options)` phải search Facebook posts by keyword, trả normalized results.

**FR8:** CLI phải hỗ trợ `--platform facebook` cho scrape commands.

**FR9:** MCP server phải expose Facebook tools (scrape profile/posts/followers/search).

**FR10:** REST API phải có `POST /api/facebook/scrape` endpoint accepting `action` + `query`/`username`.

**FR11:** Operations phải persist vào Prisma `Operation` model, scoped by `userId`.

#### Epic 4: Facebook Growth Automation

**FR12:** `createFacebookPost(page, content)` phải post status update, dry-run mặc định (ADR-007).

**FR13:** `likeFacebookPosts(page, postUrls)` phải like posts qua `runGuardedBatch`, delay 1-3s.

**FR14:** `commentOnFacebookPosts(page, postUrls, commentText)` phải comment trên posts.

**FR15:** `scheduleFacebookPost` phải tạo `Schedule` record + worker execute tại `scheduledAt`.

**FR16:** `shareFacebookPosts(page, postUrls)` phải share posts qua `runGuardedBatch`.

**FR17:** `warmupScrollFeed(page, targetUrl)` phải scroll newsfeed để warm account.

**FR18:** `joinFacebookGroups` phải join groups, batch ≤20, delay 60-180s (ADR-010).

**FR19:** `postToFacebookGroups` phải batch post to multiple groups.

**FR20:** `scrapeGroupMembers(page, groupUrl)` phải scrape member list from groups.

**FR21:** `sendFriendRequests` phải send requests, batch ≤20, delay bảo thủ (ADR-010).

**FR22:** `cancelPendingFriendRequests` phải cancel sent requests.

#### Epic 5: Messenger Port

**FR23:** GraphQL HTTP layer (`src/scrapers/facebook/graphql.js`) phải check Messenger CTA + page list via internal GraphQL.

**FR24:** `shareLinkByUid` (v1) phải share post via Messenger share dialog.

**FR25:** Auth proxy phải hỗ trợ `--proxy-server=` launch arg + `page.authenticate()`.

**FR26:** Input queue surfaces (CLI/MCP/API) phải accept share campaign params.

**FR27:** Session/campaign UI phải manage share campaigns.

#### Epic 5b: Marketplace, Share-Link-UID V2, Headless, Chrome Path

**FR28:** `scrapeMarketplace(page, query, options)` phải scrape Marketplace listings, trả `{ id, title, price, location, image, listingUrl, platform, source }`.

**FR29:** Marketplace phải parse giá đa tiền tệ: `$`, `CA$`, `ETB`, `₹`.

**FR30:** Marketplace phải extract title từ concatenated text (camelCase splitting).

**FR31:** Marketplace phải extract location (trailing capitalized word heuristics).

**FR32:** `shareLinkByUid` v2 phải navigate `messages/t/{uid}` → paste URL via clipboard → Enter.

**FR33:** Share-link-uid v2 phải accept `recipientUid` hoặc `recipientUids[]`.

**FR34:** Share-link-uid v2 phải trả per-recipient results: `{ uid, ok, sharesSent, method }`.

**FR35:** Tất cả Facebook endpoints phải accept `headless` boolean parameter.

**FR36:** `headless: true` (default) — invisible browser, `networkidle2`, 30s timeout.

**FR37:** `headless: false` — visible browser, `domcontentloaded`, 60s timeout, longer delays.

**FR38:** Response phải include `headless: true/false` confirming mode used.

**FR39:** `createBrowser()` phải auto-resolve Chrome executablePath: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system Chrome path.

#### Epic 6: Anti-Detection & Bot Countermeasures

**FR40:** Hệ thống phải có User-Agent pool 20+ real Chrome UAs, random per session, consistent within session.

**FR41:** Hệ thống phải randomize viewport match UA platform.

**FR42:** Hệ thống phải prevent WebRTC leak (disable/override RTCPeerConnection).

**FR43:** Hệ thống phải override `navigator.webdriver`, `hardwareConcurrency`, `deviceMemory`, `platform`.

**FR44:** Hệ thống phải có Bezier curve mouse movement với micro-jitter và overshoot+correction.

**FR45:** Hệ thống phải có human click simulation với hover pause 100-400ms.

**FR46:** Hệ thống phải có typing simulation với typo rate 1-2%, variable speed.

**FR47:** Hệ thống phải có natural scrolling với variable speed, momentum, overshoot.

**FR48:** Hệ thống phải có session warming: homepage → scroll → mouse → actions.

**FR49:** Hệ thống phải hỗ trợ timezone override khớp proxy location.

**FR50:** Hệ thống phải hỗ trợ geolocation override khớp proxy location.

**FR51:** Hệ thống phải support persistent browser profiles (`userDataDir`).

**FR52:** Fingerprint phải consistent per session, không change mid-session.

**FR53:** Hệ thống phải có velocity limits: likes ≤30/hr, comments ≤10/hr, friend requests ≤20/day.

**FR54:** Hệ thống phải có account age awareness: <7 days = 50% limits, 1-4 weeks = 80%.

### Non-Functional Requirements

**NFR1:** Bezel mouse movement phải hoàn thành trong <2s.

**NFR2:** Fingerprint config phải centralized trong một module, dễ update.

**NFR3:** Behavioral functions phải có injectable delay seam để test không chờ thật.

**NFR4:** Không log cookie values trong error messages hoặc API responses.

**NFR5:** Facebook automation phải có delay floor cao hơn Twitter (ADR-012).

**NFR6:** Mọi mutate action phải có dry-run default (ADR-007).

**NFR7:** `doc_id` GraphQL hardcoded phải có fallback graceful, không throw.

**NFR8:** Messenger mass-share phải dùng delay bảo thủ hơn default like/comment.

**NFR9:** Scheduler throughput cap ≤5 posts/giờ/user.

**NFR10:** Friend request delay hardcode 60-180s, không override được.

### Additional Requirements (from Architecture)

- **AR1:** Stealth plugin (puppeteer-extra-plugin-stealth) tái dùng cho Facebook.
- **AR2:** Facebook cần delay rộng hơn Twitter cho mutating actions.
- **AR3:** Batch size ≤ 20/session cho friend requests.
- **AR4:** Proxy rotation infrastructure đã có (proxyfb, tmproxy, shoplike).
- **AR5:** `createBrowser()` phải support proxy via `--proxy-server=` launch arg.
- **AR6:** `page.authenticate()` phải được gọi trước `page.goto` đầu tiên.
- **AR7:** Checkpoint detection: `bodyText.includes('confirm that you') && bodyText.includes('human')`.
- **AR8:** Facebook scraper phải clone structure từ `threads/index.js`.
- **AR9:** GraphQL layer đặt riêng tại `graphql.js`, không trộn vào adapter DOM.
- **AR10:** Fingerprint module tại `fingerprint.js`, behavioral tại `human.js`, limits tại `limits.js`.

### Additional Requirements from Post-Completion Testing (2026-08-14)

Nguồn: `sprint-change-proposal-2026-08-14.md` — phát hiện từ full regression test + real-user MCP/API testing.

- **PCR1:** `x_facebook_cancel_friend_requests` dry-run không được chạy delay thật 63s → short-circuit trước batch loop.
- **PCR2:** `new PrismaClient()` per route module gây connection-pool fragmentation → singleton refactor cross-cutting.
- **PCR3:** `post_comments`/`group_comments` cần verify live selectors vì hiện trả note "not accessible" trên mọi post.
- **PCR4:** `group_posts`/`group_search` cần verify với public/joined group vì hiện trả 0 results.
- **PCR5:** `loginWithCookie` cần injectable `delayFn` seam để test nhanh và tránh timeout flaky.
- **PCR6:** `executeTool` cần trả MCP error result (không throw) khi `localTools` null hoặc tool unknown.
- **PCR7:** Auth middleware cần chấp nhận cả `decoded.userId` và `decoded.id` để tránh token mismatch.

### UX Design Requirements

N/A — Technical infrastructure, no UX spec needed.

### FR Coverage Map

| FR/PCR | Epic 1 | Epic 2 | Epic 3 | Epic 4 | Epic 5 | Epic 5b | Epic 6 | Epic 7 | Epic 8 | Epic 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| FR1-3 | ✅ | | | | | | | | | |
| FR4-7 | ✅ | | | | | | | | | |
| FR8 | | | ✅ | | | | | | | |
| FR9-11 | | | ✅ | | | | | | | |
| FR12-14 | | ✅ | | | | | | | | |
| FR15-22 | | | | ✅ | | | | | | |
| FR23-27 | | | | | ✅ | | | | | |
| FR28-39 | | | | | | ✅ | | | | |
| FR40-54 | | | | | | | ✅ | | | |
| FR55-63 | | | | | | | | ✅ | | |
| PCR1 | | | | | | | | | | ✅ |
| PCR2 | | | | | | | | | ✅ | |
| PCR3 | | | | | | | | | | ✅ |
| PCR4 | | | | | | | | | | ✅ |
| PCR5 | | | | | | | | | | ✅ |
| PCR6 | | | | | | | | | ✅ | |
| PCR7 | | | | | | | | | ✅ | |

## Epic List

### Epic 1: Facebook Data Reading
**Goal:** Scrape Facebook profiles, posts, followers, search — rủi ro thấp, đọc-only.
**FRs:** FR1-FR7
**Status:** ✅ Done (5 stories)

### Epic 2: Facebook Automation
**Goal:** Post, like, comment trên Facebook — mutating actions với dry-run mặc định.
**FRs:** FR12-FR14
**Status:** ✅ Done (4 stories)

### Epic 3: Facebook Multi-Surface & Persistence
**Goal:** Expose Facebook qua CLI, MCP, REST API + persist operations.
**FRs:** FR8-FR11
**Status:** ✅ Done (4 stories)

### Epic 4: Facebook Growth Automation
**Goal:** Scheduling, group automation, friend management, account warming.
**FRs:** FR15-FR22
**Status:** ✅ Done (9 stories)

### Epic 5: Facebook Messenger Port
**Goal:** Port SST_TOOL_FB C# — GraphQL layer, Messenger share, auth proxy, campaign UI.
**FRs:** FR23-FR27
**Status:** ✅ Done (5 stories)

### Epic 5b: Marketplace & Infrastructure Enhancements
**Goal:** Marketplace scraper, share-link-uid v2 (direct Messenger URL), headless mode, Chrome path auto-resolution.
**FRs:** FR28-FR39
**Status:** ✅ Done (4 stories, retroactive spec)

### Epic 6: Facebook Anti-Detection & Bot Countermeasures
**Goal:** Fingerprint randomization, behavioral simulation, session hygiene, velocity controls.
**FRs:** FR40-FR54
**Status:** 🔄 4 done (Chrome path, headless, timeouts, share delays), 13 backlog

### Epic 7: Facebook Advanced Scraping & Multi-Account Parallel Execution
**Goal:** Multi-type search, post/group comments, account health filtering, and parallel execution using account pool.
**FRs:** FR55-FR61, FR63 (FR62 deferred to Phase 3)
**Status:** ✅ Done (4 stories)

### Epic 8: Facebook Backend Reliability
**Goal:** Harden backend infrastructure: database connection pooling, MCP error contract, auth token handling.
**FRs/PCRs:** PCR2, PCR6, PCR7
**Status:** 🆕 backlog

### Epic 9: Facebook Live Data & Behavioral Hardening
**Goal:** Harden runtime Facebook behavior: dry-run short-circuit, live DOM selectors, testable delay seams.
**FRs/PCRs:** PCR1, PCR3, PCR4, PCR5
**Status:** 🆕 backlog

---

## Epic 1: Facebook Data Reading

**Status:** ✅ Done

### Story 1.1: Facebook Adapter Scaffold + Login + Dispatcher Registration

As a developer using XActions,
I want a Facebook adapter module registered in the platform dispatcher with login support,
So that I have a working foundation to build scrape functions on.

**Acceptance Criteria:**

**Given** `src/scrapers/facebook/index.js` is created
**When** module is imported
**Then** exports: `createBrowser`, `createPage`, `loginWithCookie`, `default` export object
**And** module follows Puppeteer + Stealth pattern from `threads/index.js`
**And** `loginWithCookie(page, { c_user, xs })` accepts object, sets both cookies on `.facebook.com`
**And** missing `c_user` or `xs` throws clear error without retrying
**And** cookie values never appear in logs (NFR4)
**And** `src/scrapers/index.js` registers `facebook` + `fb` in `platforms` and `needsPuppeteer`

### Story 1.2: Scrape Profile

As a developer,
I want to scrape a Facebook user's profile,
So that I can get name, bio, avatar, follower count.

**Acceptance Criteria:**

**Given** a logged-in page and a username
**When** `scrapeProfile(page, username)` is called
**Then** returns `{ name, username, bio, avatar, followers, url, platform: 'facebook' }`
**And** handles private/restricted profiles with `note` field instead of throwing

### Story 1.3: Scrape Posts

As a developer,
I want to scrape a Facebook user's posts,
So that I can analyze their content.

**Acceptance Criteria:**

**Given** a logged-in page and username
**When** `scrapeTweets(page, username, options)` is called
**Then** returns array of `{ id, text, timestamp, likes, comments, url, media, platform }`
**And** supports pagination via scroll
**And** `scrapePosts` alias exists

### Story 1.4: Scrape Followers

As a developer,
I want to scrape a Facebook user's followers,
So that I can build follower lists.

**Acceptance Criteria:**

**Given** a logged-in page and username
**When** `scrapeFollowers(page, username, options)` is called
**Then** returns array of normalized follower objects
**And** scroll-loads additional followers
**And** handles restricted follower lists with `note` field

### Story 1.5: Search Posts

As a developer,
I want to search Facebook posts by keyword,
So that I can find relevant content.

**Acceptance Criteria:**

**Given** a logged-in page and query
**When** `searchTweets(page, query, options)` is called
**Then** returns array of normalized search results
**And** supports pagination

---

## Epic 2: Facebook Automation

**Status:** ✅ Done

### Story 2.1: Automation Scaffold

As a developer,
I want `api/services/facebookAutomation.js` with `runGuardedBatch`,
So that all mutating actions go through guarded batch with dry-run, delays, bounded retries.

**Acceptance Criteria:**

**Given** `facebookAutomation.js` is created
**When** `runGuardedBatch(items, actionFn, options)` is called
**Then** dry-run is default (`dryRun: true`)
**And** delay 1-3s between actions
**And** bounded batch size, bounded retries, stop condition
**And** all actions logged via `Operation` model scoped by `userId`

### Story 2.2: Auto-Like

As a growth marketer,
I want to auto-like Facebook posts,
So that I can increase engagement.

**Acceptance Criteria:**

**Given** a list of post URLs
**When** `likeFacebookPosts(page, postUrls, options)` is called
**Then** likes each post via `runGuardedBatch`
**And** delay 1-3s between likes
**And** dry-run default returns preview without executing

### Story 2.3: Auto-Comment

As a growth marketer,
I want to auto-comment on Facebook posts,
So that I can drive conversation.

**Acceptance Criteria:**

**Given** a list of post URLs and comment text
**When** `commentOnFacebookPosts(page, postUrls, commentText, options)` is called
**Then** comments on each post via `runGuardedBatch`
**And** delay 1-3s between comments
**And** dry-run default

### Story 2.4: Create Post

As a growth marketer,
I want to create a Facebook post,
So that I can publish content.

**Acceptance Criteria:**

**Given** content text
**When** `createFacebookPost(page, content, options)` is called
**Then** posts status update
**And** dry-run default returns preview
**And** handles post composer selector detection

---

## Epic 3: Facebook Multi-Surface & Persistence

**Status:** ✅ Done

### Story 3.1: CLI Platform Support

As a CLI user,
I want `--platform facebook` for scrape commands,
So that I can scrape Facebook from terminal.

**Acceptance Criteria:**

**Given** CLI command with `--platform facebook`
**When** executed
**Then** dispatcher routes to Facebook adapter
**And** output formatted via `smartOutput` (JSON/CSV/XLSX)

### Story 3.2: MCP Facebook Tools

As an AI agent,
I want MCP tools for Facebook,
So that I can call Facebook operations via MCP.

**Acceptance Criteria:**

**Given** MCP server is running
**When** Facebook tools are registered
**Then** tools for scrape profile/posts/followers/search are available
**And** tool schemas are public contracts (additive only)

### Story 3.3: REST API

As an API consumer,
I want `POST /api/facebook/scrape` and `POST /api/facebook/automate`,
So that I can trigger Facebook operations via HTTP.

**Acceptance Criteria:**

**Given** API server running
**When** `POST /api/facebook/scrape` with `action` + `query`
**Then** returns scraped data
**And** `POST /api/facebook/automate` with `action` + params
**Then** executes automation with dry-run default
**And** rate-limited, auth-required

### Story 3.4: Operation Persistence

As a developer,
I want Facebook operations persisted to Prisma,
So that I can track long-running actions.

**Acceptance Criteria:**

**Given** an automation operation starts
**When** `Operation` record is created
**Then** scoped by `userId`
**And** progress updated via `updateOperation`
**And** Socket.IO emits updates for dashboard

---

## Epic 4: Facebook Growth Automation

**Status:** ✅ Done

### Story 4.1: Schedule Post

As a growth marketer,
I want to schedule Facebook posts,
So that content publishes at optimal times.

**Acceptance Criteria:**

**Given** content + `scheduledAt`
**When** `scheduleFacebookPost` is called
**Then** `Schedule` record created with `type: 'facebook_post'`
**And** worker executes at `scheduledAt` via `createFacebookPost`
**And** throughput cap ≤5 posts/giờ/user (NFR9)

### Story 4.2: Auto-Share Post

As a growth marketer,
I want to auto-share posts,
So that I can amplify content reach.

**Acceptance Criteria:**

**Given** list of post URLs
**When** `shareFacebookPosts(page, postUrls, options)` is called
**Then** shares each post via `runGuardedBatch`
**And** delay bảo thủ hơn like/comment (NFR8)

### Story 4.3: View Boost

As a growth marketer,
I want to warmup scroll feed,
So that account appears active.

**Acceptance Criteria:**

**Given** a logged-in page
**When** `warmupScrollFeed(page, targetUrl, options)` is called
**Then** scrolls newsfeed naturally
**And** random delays between scrolls

### Story 4.4: Join Groups

As a growth marketer,
I want to join Facebook groups,
So that I can participate in communities.

**Acceptance Criteria:**

**Given** list of group URLs
**When** `joinFacebookGroups` is called
**Then** joins each group via `runGuardedBatch`
**And** batch ≤20, delay 60-180s (AR3, NFR10)

### Story 4.5: Batch Post to Groups

As a growth marketer,
I want to batch post to multiple groups,
So that I can distribute content efficiently.

**Acceptance Criteria:**

**Given** content + list of group URLs
**When** `postToFacebookGroups` is called
**Then** posts to each group via `runGuardedBatch`
**And** dry-run default

### Story 4.6: Scrape Group Members

As a growth marketer,
I want to scrape group member lists,
So that I can identify potential connections.

**Acceptance Criteria:**

**Given** a group URL
**When** `scrapeGroupMembers(page, groupUrl, options)` is called
**Then** returns array of member objects
**And** scroll-loads additional members

### Story 4.7: Send Friend Requests

As a growth marketer,
I want to send friend requests,
So that I can grow my network.

**Acceptance Criteria:**

**Given** list of user IDs/URLs
**When** `sendFriendRequests` is called
**Then** sends requests via `runGuardedBatch`
**And** batch ≤20, delay 60-180s hardcoded (NFR10)
**And** `force` flag cannot exceed hard floor

### Story 4.8: Cancel Friend Requests

As a growth marketer,
I want to cancel pending friend requests,
So that I can clean up unanswered requests.

**Acceptance Criteria:**

**Given** list of pending requests
**When** `cancelPendingFriendRequests` is called
**Then** cancels each via `runGuardedBatch`

### Story 4.9: Newsfeed Farming

As a growth marketer,
I want to farm newsfeed,
So that my account appears organic.

**Acceptance Criteria:**

**Given** a logged-in page
**When** newsfeed farming runs
**Then** scrolls, reacts, interacts naturally
**And** delay 5-15s between interactions

---

## Epic 5: Facebook Messenger Port

**Status:** ✅ Done

### Story 5.1: GraphQL Layer

As a developer,
I want internal GraphQL HTTP layer,
So that I can check Messenger CTA + page list without DOM scraping.

**Acceptance Criteria:**

**Given** `src/scrapers/facebook/graphql.js` is created
**When** GraphQL functions are called
**Then** uses `fb_dtsg`/`lsd`/`jazoest`/`doc_id` tokens
**And** `doc_id` is named constant with fallback graceful (NFR7)
**And** `fetchImpl` seam for testing
**And** no new HTTP dependency (reuse axios/fetch)

### Story 5.2: Messenger Share (v1)

As a growth marketer,
I want to share posts via Messenger,
So that I can distribute content to contacts.

**Acceptance Criteria:**

**Given** a post URL + recipient
**When** `shareLinkByUid` (v1) is called
**Then** shares via Messenger share dialog
**And** delay bảo thủ (NFR8)
**And** dry-run default

### Story 5.3: Auth Proxy

As a developer,
I want proxy support for Facebook automation,
So that I can rotate IPs.

**Acceptance Criteria:**

**Given** proxy config
**When** `createBrowser({ proxy })` is called
**Then** `--proxy-server=` launch arg added
**And** `page.authenticate()` called before first `page.goto` (AR6)

### Story 5.4: Input Queue Surfaces

As a user,
I want to submit share campaigns via CLI/MCP/API,
So that I can trigger mass-share from any surface.

**Acceptance Criteria:**

**Given** campaign params
**When** submitted via CLI/MCP/API
**Then** campaign queued and executed via `runGuardedBatch`

### Story 5.5: Session/Campaign UI

As a user,
I want to manage share campaigns,
So that I can track progress and results.

**Acceptance Criteria:**

**Given** campaign dashboard
**When** user views campaigns
**Then** shows status, progress, results
**And** Socket.IO real-time updates

---

## Epic 5b: Marketplace & Infrastructure Enhancements

**Status:** ✅ Done (retroactive spec)

### Story 5b.1: Marketplace Scraper

As a growth marketer,
I want to scrape Facebook Marketplace listings,
So that I can research products and prices.

**Acceptance Criteria:**

**Given** a logged-in page and search query
**When** `scrapeMarketplace(page, query, options)` is called
**Then** returns array of `{ id, title, price, location, image, listingUrl, platform, source }`
**And** parses multi-currency prices: `$`, `CA$`, `ETB`, `₹`
**And** extracts title from concatenated text (camelCase splitting)
**And** extracts location (trailing capitalized word heuristics)
**And** supports pagination via scroll with stall detection
**And** `marketplace` registered in action map + valid actions in API route

### Story 5b.2: Share-Link-UID V2 (Direct Messenger URL)

As a growth marketer,
I want to share posts via direct Messenger URL,
So that I can send to recipients by UID without display names.

**Acceptance Criteria:**

**Given** a post URL + `recipientUid` or `recipientUids[]`
**When** `shareLinkByUid(page, target, options)` is called (v2)
**Then** navigates to `messages/t/{uid}` → paste URL via clipboard → Enter
**And** works without display names (UID-based)
**And** doesn't require recipients in share dialog's friend list
**And** returns per-recipient results: `{ uid, ok, sharesSent, method }`
**And** `shareLinkByUidCampaign` supports multiple recipients

### Story 5b.3: Headless Mode Parameter

As a developer,
I want `headless` parameter for all Facebook endpoints,
So that I can debug with visible browser or run production headless.

**Acceptance Criteria:**

**Given** `headless: false`
**When** browser launches
**Then** browser window visible, `domcontentloaded` wait, 60s timeout, longer delays (8-12s)
**And** response includes `headless: false`

**Given** `headless: true` (default)
**When** browser launches
**Then** browser invisible, `networkidle2` wait, 30s timeout, shorter delays (5-8s)
**And** response includes `headless: true`

### Story 5b.4: Chrome executablePath Auto-Resolution

As a developer,
I want `createBrowser()` to auto-resolve Chrome path,
So that automation works without puppeteer bundled Chrome.

**Acceptance Criteria:**

**Given** Chrome installed at system path
**When** `createBrowser()` called without `executablePath`
**Then** resolves: explicit option → `PUPPETEER_EXECUTABLE_PATH` env → system Chrome
**And** no "Could not find Chrome" error

---

## Epic 6: Facebook Anti-Detection & Bot Countermeasures

**Status:** 🔄 In Progress (4 done, 13 backlog)

### Story 6.1: Chrome executablePath Auto-Resolution
**Status:** ✅ Done (implemented in Story 5b.4)

### Story 6.2: Consistent Session Fingerprint

As a developer,
I want each session to generate ONE fingerprint and reuse throughout,
So that Facebook doesn't detect fingerprint changes mid-session.

**Acceptance Criteria:**

**Given** a new automation session
**When** `createBrowser()` + `createPage()` are called
**Then** a fingerprint object is generated (UA + viewport + hardware config)
**And** fingerprint stored in session context
**And** all navigation uses same fingerprint
**And** fingerprint does NOT change mid-session

### Story 6.3: User-Agent Pool & Viewport Randomization

As a developer,
I want UA pool with 20+ real Chrome UAs and viewport randomization,
So that each session has unique but realistic fingerprint.

**Acceptance Criteria:**

**Given** a new session with fingerprint
**When** `createPage()` is called
**Then** UA set via `page.setUserAgent()` from pool
**And** viewport set via `page.setViewport()` from predefined list
**And** deviceScaleFactor matches UA platform

### Story 6.4: Navigator Properties Override

As a developer,
I want to override navigator automation indicators,
So that Facebook doesn't detect `navigator.webdriver` inconsistencies.

**Acceptance Criteria:**

**Given** browser launched with stealth plugin
**When** `createPage()` runs
**Then** `navigator.webdriver` returns `undefined`
**And** `navigator.hardwareConcurrency` random [4, 6, 8]
**And** `navigator.deviceMemory` random [2, 4, 8]
**And** `navigator.platform` matches UA platform
**And** `navigator.plugins.length` > 0

### Story 6.5: WebRTC Leak Prevention

As a developer,
I want WebRTC disabled or overridden,
So that real IP doesn't leak via STUN servers.

**Acceptance Criteria:**

**Given** browser with proxy configured
**When** a Facebook page loads
**Then** `RTCPeerConnection` overridden or disabled
**And** `--disable-webrtc` launch arg added
**And** no STUN requests outside proxy

### Story 6.6: Headless Mode Parameter
**Status:** ✅ Done (implemented in Story 5b.3)

### Story 6.7: Headless-Aware Timeouts
**Status:** ✅ Done (implemented in Story 5b.3)

### Story 6.8: Behavioral Delays in Share-Link-UID
**Status:** ✅ Done (implemented in Story 5b.2)

### Story 6.9: Bezier Mouse Movement

As a developer,
I want mouse movement via Bezier curve with micro-jitter,
So that Facebook doesn't detect straight-line bot movement.

**Acceptance Criteria:**

**Given** need to click at (x, y)
**When** `humanMoveMouse(page, x, y)` is called
**Then** mouse moves via cubic Bezier curve (20-35 steps)
**And** micro-jitter ±2px per step
**And** 15% chance overshoot + correction
**And** completes in <2s (NFR1)

### Story 6.10: Human Click with Hover

As a developer,
I want click simulation with hover pause,
So that Facebook doesn't detect instant clicks.

**Acceptance Criteria:**

**Given** moved to target position
**When** `humanClick(page, element)` is called
**Then** hover pause 100-400ms before click
**And** mouse down → hold 30-120ms → mouse up
**And** uses element handle, not coordinates

### Story 6.11: Typing with Typos

As a developer,
I want typing simulation with variable speed and typos,
So that Facebook doesn't detect mechanical typing.

**Acceptance Criteria:**

**Given** need to type text into input
**When** `humanType(page, text)` is called
**Then** each character has variable delay 80-120ms
**And** typo rate 1-2% for alphabet characters
**And** typo: type wrong → pause → backspace → retype
**And** pause 100-300ms between words, 200-500ms after punctuation

### Story 6.12: Natural Scrolling

As a developer,
I want scrolling with variable speed and momentum,
So that Facebook doesn't detect fixed-distance scrolls.

**Acceptance Criteria:**

**Given** need to scroll distance pixels
**When** `humanScroll(page, distance)` is called
**Then** scroll divided into 5-10 chunks with variable speed
**And** speed follows sin curve (slow → fast → slow)
**And** 20% chance overshoot + correction
**And** delay 100-400ms between chunks

### Story 6.13: Action Velocity Limiting

As a developer,
I want built-in rate limiting for Facebook actions,
So that automation doesn't exceed human-possible speeds.

**Acceptance Criteria:**

**Given** automation session running
**When** actions execute continuously
**Then** likes ≤ 30/hour, comments ≤ 10/hour, friend requests ≤ 20/day, messages ≤ 20/hour
**And** delay floor 5-15s between actions (NFR5)

### Story 6.14: Account Age Awareness

As a developer,
I want account age to limit activity,
So that new accounts don't get flagged.

**Acceptance Criteria:**

**Given** account with creationDate
**When** automation starts
**Then** accounts <7 days limited to 50% action limits
**And** accounts 1-4 weeks limited to 80%
**And** accounts >3 months get full limits

### Story 6.15: Session Warming Sequence

As a developer,
I want automatic warm-up before actions,
So that Facebook doesn't detect cold-session-immediate-action.

**Acceptance Criteria:**

**Given** logged in successfully
**When** session warming triggers
**Then** visit homepage → wait 3-8s → scroll 300-800px → wait 2-6s → scroll 200-500px → wait 1-4s → random mouse 3x → wait 0.5-2s each
**And** only then safe to perform actions

### Story 6.16: Timezone & Geolocation Override

As a developer,
I want timezone and geolocation matching proxy location,
So that Facebook doesn't detect IP-timezone-geo mismatch.

**Acceptance Criteria:**

**Given** proxy in US-East
**When** session initializes
**Then** `page.emulateTimezone('America/New_York')` called
**And** `page.setGeolocation({ lat, lng })` matches proxy
**And** permissions granted for geolocation API
**And** skip if proxy doesn't return location (no guessing)

### Story 6.17: Persistent Browser Profiles

As a developer,
I want persistent browser profiles via userDataDir,
So that browser retains history, cookies, localStorage across sessions.

**Acceptance Criteria:**

**Given** profile directory specified
**When** `createBrowser({ userDataDir })` is called
**Then** browser retains cookies and localStorage after close
**And** next session restores previous state
**And** profile directory auto-created if not exists
**And** profile path format: `./profiles/fb-{c_user}/`

---

## Epic 3 Extension: MCP Facebook Tool Surface

**Goal:** Extend Epic 3 Story 3.2 by exposing additional Facebook capabilities that are already implemented in scrapers/automation but not yet available as MCP tools.

**Status:** backlog

**Motivation:** The original Story 3.2 registered the first set of Facebook MCP tools (profile/posts/followers/search). Subsequent implementation work added `scrapeGroupMembers`, `scrapeMarketplace`, and `FacebookAccount` persistence, but these are not yet reachable through the MCP tool surface.

### Story 3.2.1: MCP Facebook Tool Surface Extension

As an AI agent,
I want additional Facebook MCP tools for group members, marketplace search, and account listing,
So that I can reach all Facebook capabilities already implemented in the codebase.

**Acceptance Criteria:**

**Given** a valid `groupUrl`
**When** I call `x_facebook_group_members` with `authCookie.accountId`
**Then** the tool resolves `accountId` via `resolveMcpFacebookAuth`
**And** logs in and navigates to the group members page
**And** returns a bounded list of `{ name, username?, profileUrl, platform: 'facebook' }`
**And** returns a `note` instead of throwing when members are private or restricted
**And** cookie values are never logged

**Given** a `query` string
**When** I call `x_facebook_marketplace` with `authCookie.accountId`
**Then** the tool resolves `accountId` via `resolveMcpFacebookAuth`
**And** logs in and searches `facebook.com/marketplace/search`
**And** returns listings with `{ id, title, price, location, image, listingUrl }`
**And** PII (seller phone/email) is stripped before returning
**And** dry-run mode previews the search URL and filters without launching a browser
**And** cookie values are never logged

**Given** a valid user context
**When** I call `x_facebook_list_accounts`
**Then** it returns `{ id, label, userId }` for each `FacebookAccount`
**And** never returns `c_user`, `xs`, or `encryptedCookie`
**And** no cookie or session data is logged

---

## Epic 7: Facebook Advanced Scraping & Multi-Account Parallel Execution

**Status:** 🆕 backlog
**Architecture:** `_bmad-output/architecture-artifacts/epic7-2026-08-14/ARCHITECTURE-SPINE.md`
**Stories:** `_bmad-output/architecture-artifacts/epic7-2026-08-14/STORIES.md`

**Goal:** Expand Facebook scraping to support multi-type search, post/group comments scraping, account health filtering, and parallel execution using a pool of live Facebook accounts.

**FRs:** FR55-FR61, FR63 (FR62 deferred to Phase 3)

**NFRs:** NFR10-NFR15

**Additional Requirements relevant:** ADR-006 (adapter pattern), ADR-011 (GraphQL HTTP layer) — chỉ áp dụng nếu Phase 3 (GraphQL replay) được lên lịch, Epic 6 anti-detection infrastructure.

### Story 7.1: Foundation — Health, Pool, Hydration & Schema

As a user running multi-account Facebook scraping,
I want the system to validate account health, run a bounded parallel pool, extract embedded hydration JSON, and store the necessary account/proxy schema,
So that all advanced Facebook scrape actions are reliable, safe, and consistent.

**Prerequisites:** None (Epic 6 anti-detection infrastructure is assumed).

**Acceptance Criteria:**

**Given** a `FacebookAccount` with encrypted cookie
**When** `checkAccountHealth(account)` is called
**Then** it fetches `https://www.facebook.com/` via HTTP with the account's cookie
**And** parses `fb_dtsg` from the HTML
**And** validates `c_user` and `xs` are present in the response cookie jar
**And** returns `{ status: 'active' | 'checkpoint' | 'dead', reason?, lastCheckAt }`
**And** status is `checkpoint` if the body contains `/checkpoint/` or `confirm you're human`
**And** status is `dead` if `fb_dtsg` is missing or the response cookie jar lacks `c_user`/`xs`
**And** caches the result with a 5-minute TTL in the `FacebookAccountHealth` table
**And** cookie values are never logged

**Given** an array of `tasks` and eligible `accountIds`
**When** `FacebookAccountPool.runBatch(tasks, { maxConcurrency, delayBetweenLaunches })` is called
**Then** it filters only `active` accounts from the health cache
**And** honors `FacebookAccount.proxy` if set
**And** assigns each task to a live account with matching proxy using round-robin / LRU
**And** uses `p-limit` with `maxConcurrency` default 4 and maximum 8
**And** waits `delayBetweenLaunches` (default 3-8s) between browser launches
**And** builds `userDataDir` per `c_user`
**And** retries a task on another live account if the current one hits checkpoint
**And** returns `results[]` and an `accountUsage` report

**Given** a loaded Facebook page
**When** `extractHydrationJson(page, typenames)` is called
**Then** it collects all `<script type="application/json" data-content-len>` tags
**And** recursively walks JSON for objects with matching `__typename`
**And** supports `Story`, `Comment`, `User`, `Page`, `Group`, and `MarketplaceListing`
**And** falls back to DOM extraction if hydration data is insufficient

**Given** the `FacebookAccount` model
**When** migrations run
**Then** they create the `FacebookAccountHealth` model with `accountId` unique and `FacebookAccountHealthStatus` enum
**And** add `encryptedProxy` to `FacebookAccount`
**And** the `POST /api/facebook/accounts` endpoint accepts a plaintext `proxy` string and stores it as `encryptedProxy`

### Story 7.2: Multi-Type Facebook Search

As a market researcher,
I want to search Facebook by posts, people, pages, or groups,
So that I can find leads across all public surfaces.

**Prerequisites:** Story 7.1

**Acceptance Criteria:**

**Given** a `query` and `type` (`posts`, `people`, `pages`, `groups`, `all`)
**When** `searchFacebook({ page, query, type, location, limit, authCookie, parallel })` is called
**Then** it navigates to the correct `/search/{type}?q=...` URL
**And** `type: 'posts'` returns `Array<{ id, text, author, timestamp, url, platform: 'facebook' }>`
**And** `type: 'people'` returns `Array<{ id, name, username, profileUrl, image, platform: 'facebook' }>`
**And** `type: 'pages'` returns `Array<{ id, name, category, likes, pageUrl, image, platform: 'facebook' }>`
**And** `type: 'groups'` returns `Array<{ id, name, members, privacy, groupUrl, image, platform: 'facebook' }>`
**And** `type: 'all'` returns `{ posts, people, pages, groups }` with each key an array of the corresponding shape above
**And** `type: 'all'` defaults to sequential on 1 account
**And** `type: 'all'` with `parallel: true` fans out 4 tasks to 4 live accounts
**And** supports pagination via scroll (max 50 scrolls/task, delay 1-3s)

### Story 7.3: Comments & Group Content

As a growth marketer and community analyst,
I want to scrape comments on a post, posts inside a group, and comments on a group post,
So that I can understand audience sentiment and monitor group activity.

**Prerequisites:** Story 7.1

**Acceptance Criteria:**

**Given** a `postUrl` and `limit`
**When** `scrapeFacebookComments(page, postUrl, { limit, includeReplies })` is called
**Then** it opens the post permalink
**And** switches sort from "Most relevant" to "All comments" if possible
**And** scrolls to load more comments
**And** returns `{ id, authorName, authorUrl, text, timestamp, likes, replies[], parentId }`
**And** `replies[]` only present when `includeReplies: true`

**Given** a `groupUrl` and `limit`
**When** `scrapeFacebookGroupPosts(page, groupUrl, { limit })` is called
**Then** it verifies `groupUrl` contains `facebook.com/groups/`
**And** uses mobile UA (390x844)
**And** returns posts with the standard post shape
**And** returns a `note` if the group is private/restricted and the account is not a member

**Given** a group `postUrl` and `limit`
**When** `scrapeFacebookGroupComments(page, postUrl, { limit, includeReplies })` is called
**Then** it verifies `postUrl` contains `facebook.com/groups/`
**And** calls `scrapeFacebookComments({ page, postUrl, limit, includeReplies })`
**And** returns the same comment shape
**And** returns a `note` if the group is private and the account is not a member
**And** returns a `note` if comments are restricted

### Story 7.4: API + MCP Surface Unification

As an AI agent,
I want new Facebook scrape tools exposed via MCP that call the same service as the REST API,
So that the surface is consistent and maintainable.

**Prerequisites:** Story 7.1, Story 7.2, Story 7.3

**Acceptance Criteria:**

**Given** `api/services/facebookScrape.js` is created with `run(action, args)` and `runBatch(tasks, options)`
**When** `facebookScrapeService.run(...)` or `runBatch(...)` is called
**Then** it resolves `authCookie` through `FacebookAuthResolver`
**And** calls `scrape('facebook', action, args)` from `src/scrapers/index.js`
**And** passes `browserOptions.userDataDir`, `browserOptions.proxy`, and `browserOptions.proxyAuth`
**And** `scrape()` calls `page.authenticate(options.proxyAuth)` after `createPage` and before `loginWithCookie`
**And** no scraper logic is duplicated in `src/mcp/server.js`

**Given** `authCookie` as `{ c_user, xs }` or `{ accountId }`
**When** `FacebookAuthResolver.resolve(args, userId)` is called
**Then** it returns `{ c_user, xs }` for the requested account
**And** validates `account.userId === userId` when `accountId` is provided
**And** MCP tools pass `userId` from client context when using `accountId`
**And** cookie values are never logged

**Given** `api/routes/facebook.js` `POST /scrape`
**When** called with `{ action, ...args, authCookie }`
**Then** it calls `facebookScrapeService.run`
**And** valid actions include `profile`, `posts`, `followers`, `search`, `group-members`, `marketplace`, `post_comments`, `group_posts`, `group_comments`
**And** it returns `{ ok: true, action, result }`

**Given** `src/mcp/server.js` is running
**When** tools `x_facebook_search`, `x_facebook_posts`, `x_facebook_post_comments`, `x_facebook_group_posts`, `x_facebook_group_comments` are exposed
**Then** they all route through `facebookScrapeService`
**And** each tool has contract tests in `tests/mcp/`.

---

## Epic 8: Facebook Backend Reliability

**Status:** 🆕 backlog

**Epic Goal:** Harden backend infrastructure: database connection pooling, MCP error contract, auth token handling.

**FRs/PCRs covered:** PCR2, PCR6, PCR7

### Story 8.1: PrismaClient Singleton Refactor

As a system operator,
I want a single `PrismaClient` instance shared across the API,
So that database connection pool is not fragmented and performance remains stable.

**Acceptance Criteria:**

**Given** any API route, service, MCP server, CLI command, or workflow module needs database access
**When** it runs in the same Node process
**Then** it imports `prisma` from `api/lib/prisma.js`
**And** it uses the singleton instance
**And** the number of live `PrismaClient` instances does not scale with route count

**Given** the singleton module
**When** it is first imported
**Then** it creates one `PrismaClient` instance
**And** subsequent imports reuse the same instance
**And** `$disconnect` is handled gracefully on process exit

### Story 8.2: Graceful executeTool Unknown Tool Handling

As an MCP client,
I want `executeTool` to return a proper MCP error result instead of throwing,
So that my client does not crash on unknown tools or uninitialized `localTools`.

**Acceptance Criteria:**

**Given** `localTools` is `null` or `undefined`
**When** `executeTool` is called
**Then** it returns `{ isError: true, content: [{ type: 'text', text: '...' }] }`
**And** it does not throw `Cannot read properties of null`

**Given** a tool name that does not exist in `localTools`
**When** `executeTool` is called
**Then** it returns `{ isError: true, content: [{ type: 'text', text: 'Unknown tool: <name>' }] }`
**And** it does not throw `Error("Unknown tool")`

### Story 8.3: Standardize JWT Token Key

As a developer,
I want auth middleware to accept both `decoded.id` and `decoded.userId`,
So that existing tokens and test fixtures work consistently without 500 errors.

**Acceptance Criteria:**

**Given** a JWT token with payload `{ id: "..." }`
**When** the request hits `authMiddleware`
**Then** the user is resolved correctly

**Given** a JWT token with payload `{ userId: "..." }`
**When** the request hits `authMiddleware`
**Then** the user is resolved correctly

**Given** a token with both `id` and `userId`
**When** the request hits `authMiddleware`
**Then** it prefers one consistently (document the choice)

---

## Epic 9: Facebook Live Data & Behavioral Hardening

**Status:** 🆕 backlog

**Epic Goal:** Harden runtime Facebook behavior: dry-run short-circuit, live DOM selectors, testable delay seams.

**FRs/PCRs covered:** PCR1, PCR3, PCR4, PCR5

### Story 9.1: Fix cancel_friend_requests Dry-Run Delay

As an MCP user,
I want `x_facebook_cancel_friend_requests` dry-run to return immediately,
So that I can preview the action without waiting 63 seconds.

**Acceptance Criteria:**

**Given** `x_facebook_cancel_friend_requests` is called with `dryRun: true`
**When** the tool executes
**Then** it returns in less than 1 second
**And** it does not launch a browser
**And** it does not call `runGuardedBatch` or any delay loop
**And** it returns a preview with the list of requests that would be canceled

### Story 9.2: Verify Live Facebook Comments Selectors

As a data analyst,
I want to scrape comments from public posts with comments enabled,
So that I can analyze engagement and replies.

**Acceptance Criteria:**

**Given** a public post with comments enabled
**When** `x_facebook_post_comments` runs with `includeReplies: true`
**Then** it returns an array of comments
**And** each comment has `author`, `text`, `timestamp`, `likes`, and `replies`

**Given** a public group post with comments
**When** `x_facebook_group_comments` runs
**Then** it returns the same comment shape
**And** it returns a `note` if comments are restricted or not accessible

### Story 9.3: Verify Live Group Posts and Group Search

As a community manager,
I want to scrape posts from public or joined groups,
So that I can monitor group activity and search group content.

**Acceptance Criteria:**

**Given** a public or joined group
**When** `x_facebook_group_posts` runs
**Then** it returns a non-empty array of posts
**And** each post has `id`, `text`, `timestamp`, `likes`, `comments`, `url`, `media`, `platform`

**Given** a public or joined group
**When** `x_facebook_group_search` runs with a query
**Then** it returns a non-empty array of matching posts
**And** it returns a clear note explaining access restriction if the group is private and not joined

### Story 9.4: Injectable delayFn for loginWithCookie

As a developer,
I want `loginWithCookie` to accept an injectable `delayFn`,
So that tests run fast and avoid flaky timeouts in parallel suites.

**Acceptance Criteria:**

**Given** `loginWithCookie(page, cookies, { delayFn: async () => {} })`
**When** the function runs
**Then** all internal random delays use the provided `delayFn`
**And** the default behavior remains unchanged when `delayFn` is not provided

**Given** a test passes `delayFn: async () => {}`
**When** `loginWithCookie` is called
**Then** the test completes without real `setTimeout` delays