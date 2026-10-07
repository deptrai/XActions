# Adversarial Architecture Review: Action-Level Granular Authentication & Proxy Strategy

**Review Target:** `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (as amended on 2026-08-27)  
**Reference Proposal:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-27.md`  
**Reviewer Lens:** ADVERSARIAL — Systematic Failure Mode & Multi-Unit Incompatibility Analysis  
**Date:** 2026-08-27  
**Status:** COMPLETE  
**Verdict:** **PASS WITH FINDINGS (6 Findings: 2 CRITICAL, 3 HIGH, 1 MEDIUM)**

---

## Executive Summary

The amendment on 2026-08-27 introduced **Action-Level Granular Authentication & Proxy Strategy** into the architecture spine (AD-3 rule 3b, AD-11 rule 3, AD-8, AD-14). The core concept—decoupling authentication requirements from the platform level down to individual action descriptors to enable rotating residential proxies and prevent account pool depletion on public endpoints—is strategically sound and directly supports FR-88 (proxy cost optimization).

However, an adversarial analysis across layer boundaries (Core vs Client vs Crawler vs Proxy vs Storage vs Observability) reveals **critical architectural holes**. When two independent engineering teams (or concurrent runtime paths) implement and execute their components strictly obeying the written AD rules to the letter, several concrete failure modes emerge:
1. **Account-bound token contamination** across rotating guest requests leading to instant account bans.
2. **Governor hibernation check bypass** on opt-in authenticated actions leading to burned accounts.
3. **Client vs Crawler contract asymmetry** causing spurious `XACT_4010` errors when calling `AbstractApiClient` directly.
4. **Proxy pool starvation** from undefined interaction between AD-3 3b proxy rotation and AD-20 dual-pool isolation.
5. **Session/cursor invalidation** when resuming checkpoints across different auth modes in AD-12.
6. **Cross-platform action classification drift** between Facebook and other platforms (Twitter, Threads).

These findings must be resolved in the spine text before implementing Story 13.9/13.10 to prevent production outages and account destruction.

---

## Detailed Attack Vectors & Incompatibility Scenarios

---

### Attack Vector 1 (CRITICAL): Account-Bound Credential Leakage via Shared Pre-Signed Token Ring

#### Concrete Scenario
In the daemon microservice (`src/mcp/server.js`, port 3001), a single `FacebookCrawler` and `FacebookClient` instance serve concurrent requests for Nowing and MCP consumers.
- **Worker A** executes `group_posts` (Auth-required action, account `fb:alice`). It calls `FacebookClient.ensureTokens('fb:alice', cookieHeader)`, extracting live tokens (`lsd`, and Alice's account-bound `fb_dtsg`). Per AD-1 Rule 1, these session tokens are pushed into the shared `PreSignedTokenRing` via `tokenRing.refill([tokens.lsd])` (or token ring holding `fb_dtsg`).
- **Worker B** executes `marketplace` (No-auth action, `requiresAuth: false`, `accountId: null`). Per AD-3 Rule 3b, it allocates a rotating residential proxy (`DynamicTunnelProvider` generates a random session per request) and fetches tokens from the `PreSignedTokenRing`.
- **Worker B** receives Alice's account-bound `fb_dtsg` or session-tied token from the ring and transmits it in a public GraphQL request over a random, rotating residential IP in Germany without Alice's cookies.
- Meta's WAF / anti-fraud system detects Alice's account-bound `fb_dtsg` signature originating from 50 different IP addresses within seconds.

#### Direct AD Rule Quotes
- **AD-1 Rule 1:** *"Tier 1 (Pre-Signed Token Ring): Các token phiên (`lsd`, `fb_dtsg`, `msToken`) được sinh trước vào mảng đệm (50 tokens) và cấp phát O(1) trong <0.1ms cho HTTP Fetcher."*
- **AD-3 Rule 3b:** *"`actionRequiresAuth === false`: ... Guest tokens (`lsd`/`jazoest`/`fb_dtsg`) lấy từ Pre-Signed Token Ring."*

#### The Incompatibility & Failure
`fb_dtsg` is **not an anonymous guest token**—it is a cryptographic CSRF token strictly bound to an authenticated user identity (`c_user`). The spine conflates guest CSRF tokens (`lsd`) with authenticated user session tokens (`fb_dtsg`) and mandates storing both in a monolithic `PreSignedTokenRing`. When no-auth actions pull from this shared ring over rotating residential proxies, they leak account credentials over random IPs, triggering **instant security checkpoints and permanent account bans**.

#### Spine Status
**HOLE (CRITICAL)** — The spine fails to partition guest tokens from account-bound session tokens.

#### Minimal AD Fix (Spine Patch)
> **Amend AD-1 Rule 1 & AD-3 Rule 3b:**  
> *"Pre-Signed Token Ring chỉ được lưu trữ các token ẩn danh cấp khách (Guest Tokens: `lsd`, `jazoest`, `msToken` public). Các token phiên gắn danh tính tài khoản (`fb_dtsg`, `dtsg_ag`) BẮT BUỘC lưu trữ trong session cache riêng biệt của từng `accountId` và TUYỆT ĐỐI KHÔNG được đẩy vào Token Ring chung hoặc phát tán qua Rotating Residential Proxy."*

---

### Attack Vector 2 (CRITICAL): Governor Hibernation & Velocity Limit Bypass on Opt-In Authenticated Requests

#### Concrete Scenario
A caller wants to perform an authenticated search on Facebook Marketplace within their logged-in account context to see personalized/member listings.
- Caller passes `command = { action: 'marketplace', args: { query: 'laptop' }, session: { accountId: 'fb:user_99' } }`.
- Account `fb:user_99` recently hit a Facebook rate-limit challenge and was placed into **15-minute HIBERNATION** by `AdaptiveRateGovernor`.
- **Team A (Crawler Dev)** implements `AbstractCrawler.start()` strictly per AD-11 Rule 3: `actionRequiresAuth` is `false` (from `marketplace` descriptor). Following the rule *"bỏ qua AccountPool và governor account check"*, the crawler bypasses `governor.canAccountRequest(accountId)`.
- The crawler proceeds to execute the search using `fb:user_99`'s session cookies.
- Facebook immediately flags the hibernating account making requests during a cooling-off period, escalating the temporary challenge into a **permanent account ban**.

#### Direct AD Rule Quotes
- **AD-11 Rule 3:** *"`actionRequiresAuth === false` và caller không truyền `accountId` ➔ chạy với `accountId = null`, bỏ qua `AccountPool` và governor account check; proxy xoay per-request (Rotating Residential, xem AD-3 rule 3b)."*
- **AD-3 Rule 3b:** *"`actionRequiresAuth === false`: không rút `AccountPool`, không kiểm tra `governor.canAccountRequest`; `accountId = null` ... Caller truyền `accountId` rõ ràng vẫn được tôn trọng (opt-in auth, sticky theo accountId)."*
- **AD-13 Rule 3:** *"Mỗi tài khoản có token bucket theo `platform.safeRequestsPerMinute`. Nếu gặp challenge/Captcha/WAF, đưa tài khoản vào hibernation 15–30 phút và rotate proxy."*

#### The Incompatibility & Failure
AD-3 Rule 3b and Design Decision D1 allow "opt-in auth" on `requiresAuth: false` actions by honoring caller-passed `accountId`. However, both AD-3 Rule 3b and AD-11 Rule 3 state that when `actionRequiresAuth === false`, the system *"không kiểm tra governor.canAccountRequest"*. There is a direct clash between opt-in auth and account protection: if the governor check is skipped because the action is nominally `requiresAuth: false`, hibernating or velocity-exhausted accounts will be sent into live scraping, destroying account safety invariants established in AD-13.

#### Spine Status
**HOLE (CRITICAL)** — The spine does not explicitly require `governor.canAccountRequest(accountId)` when an explicit `accountId` is provided on a `requiresAuth: false` action.

#### Minimal AD Fix (Spine Patch)
> **Amend AD-11 Rule 3 & AD-3 Rule 3b:**  
> *"Khi `actionRequiresAuth === false`: nếu caller KHÔNG truyền `accountId`, chạy với `accountId = null`, bỏ qua `AccountPool` và bỏ qua account velocity check; nếu caller CÓ truyền `accountId` (opt-in auth), BẮT BUỘC kiểm tra `governor.canAccountRequest(accountId, platform)` trước khi thực thi — nếu tài khoản đang hibernation hoặc vượt velocity limit, BẮT BUỘC throw `XACT_4291` (`hibernation`)."*

---

### Attack Vector 3 (HIGH): Client-Level vs Crawler-Level Auth Contract Asymmetry & Bypassed Bridge Isolation

#### Concrete Scenario
In Epic 13, two sub-systems interact with Facebook endpoints:
- Sub-system 1 (`FacebookCrawler.start()`): Resolves `actionRequiresAuth = false` for `search` and sets `accountId = null`.
- Sub-system 2 (`FacebookBrowserBridge` / Story 13.4 Signer Bridge / Direct MCP Handler): Interacts directly with `FacebookClient` (inheriting from `AbstractApiClient`) without invoking `AbstractCrawler.start()`.
- `FacebookClient` inherits from `AbstractApiClient`, where `this.requiresAuth = true` is hardcoded at the client class level (`src/core/base-client.js:51`).
- When a lightweight component (or unit test) instantiates `FacebookClient` without an `accountPool` and calls `client.request('GET', '/search', { accountId: null })`, `AbstractApiClient.request()` (line 486) executes:
  ```js
  if (this.requiresAuth && !currentAccountId && !this.accountPool) {
    throw new AuthSessionExpiredError({ code: 'XACT_4010', ... });
  }
  ```
- The request immediately crashes with `XACT_4010` (`AUTH_EXPIRED`), even though the caller intended to execute a purely public, unauthenticated request.

#### Direct AD Rule Quotes
- **AD-2 Rule 1:** *"Mọi module nền tảng mới bắt buộc phải kế thừa `AbstractCrawler` ... và `AbstractApiClient` (`request()`, `sign()`, `updateCookies()`)."*
- **AD-11 Rule 3:** *"Action-Level Auth Resolution trong `start()`: `AbstractCrawler.start(command)` tính `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth`..."*
- (Silent on `AbstractApiClient.request()` signature and auth options).

#### The Incompatibility & Failure
The 2026-08-27 amendment updated `AbstractCrawler.start()` but left `AbstractApiClient` unaware of action-level auth resolution. Because `AbstractApiClient.requiresAuth` remains a platform-level boolean flag, any caller invoking `client.request()` directly without an active `accountPool` (e.g. signer bridge, public HTTP probing, or direct MCP tools) will be blocked by `XACT_4010`.

#### Spine Status
**HOLE (HIGH)** — Contract gap in `AbstractApiClient.request()` options and resolution hierarchy.

#### Minimal AD Fix (Spine Patch)
> **Amend AD-2 Rule 1 & AD-11 Rule 3:**  
> *"`AbstractApiClient.request(method, url, options)` phải nhận tham số `options.requiresAuth?: boolean` (mặc định kế thừa `this.requiresAuth`). Khi `options.requiresAuth === false` hoặc `options.accountId === null` được truyền rõ, client BỎ QUA kiểm tra bắt buộc `accountPool` và không throw `XACT_4010`."*

---

### Attack Vector 4 (HIGH): Orthogonal Proxy Dimension Collision — Dual-Pool Partitioning (AD-20) vs Action-Level Proxy Rotation (AD-3 3b)

#### Concrete Scenario
A background batch worker in Nowing triggers a mass crawl of 5,000 Facebook Marketplace listings (`requiresAuth: false`) by calling the XActions MCP HTTP daemon (`http://xactions:3001/mcp`).
- **Team A (Proxy Pool Dev)** implements AD-20 Rule 1: *"Realtime Pool (30% proxy capacity) dành cho MCP on-demand queries từ Nowing và ChainLens."* Because the request arrived via the MCP daemon endpoint, Team A routes all proxy allocations into the **Realtime Pool**.
- **Team B (Facebook Scraper Dev)** implements AD-3 Rule 3b: `marketplace` has `actionRequiresAuth === false`, so it requests a **Rotating Residential Proxy** per request (`rotatePerRequest = true`).
- The 5,000-listing background scrape fires rotating requests through the 30% Realtime Pool, instantly exhausting all healthy realtime proxies.
- Concurrently, an operator or ChainLens-Research sends a critical on-demand query (`x_facebook_group_posts`). It fails immediately with `XACT_5030` (`PROXY_EXHAUSTED`), violating the core isolation guarantee of AD-20.

#### Direct AD Rule Quotes
- **AD-20 Rule 1 & 2:** *"Realtime Pool (30% proxy capacity): Dành cho MCP on-demand queries... Bulk Pool (70% proxy capacity): Dành cho background crawl."*
- **AD-3 Rule 3b:** *"`actionRequiresAuth === false`: ... API client truyền `accountId: null` khiến `DynamicTunnelProvider` sinh session ngẫu nhiên và xoay IP dân cư trên từng request (`rotatePerRequest`)."*

#### The Incompatibility & Failure
The spine defines two orthogonal proxy dimensions without specifying their interaction matrix:
1. **Traffic Partition (AD-20):** Realtime (30%) vs Bulk (70%).
2. **Auth Mode (AD-3 3b):** Sticky Residential (Auth) vs Rotating Residential (No-Auth).
Without explicit rules, high-throughput no-auth scrapers arriving through microservice interfaces will cannibalize the Realtime Pool, creating priority inversion and proxy starvation.

#### Spine Status
**HOLE (HIGH)** — Missing the 2×2 allocation matrix between AD-3 3b and AD-20.

#### Minimal AD Fix (Spine Patch)
> **Amend AD-20:**  
> *"Điều phối Proxy tuân theo ma trận 2 chiều độc lập: Phân vùng Pool (`Realtime` 30% vs `Bulk` 70%) được quyết định bởi kênh gọi và độ ưu tiên tác vụ (`command.priority` / `X-Consumer-Priority`); Chế độ Proxy (`Sticky` vs `Rotating`) được quyết định bởi `actionRequiresAuth`. Mọi tác vụ cào hàng loạt (bulk/batch) dù là no-auth hay auth BẮT BUỘC chỉ được rút proxy từ Bulk Pool."*

---

### Attack Vector 5 (HIGH): State Serialization Drift in CrawlCheckpoint on Auth Mode Resumption

#### Concrete Scenario
A long-running crawl job starts an opt-in authenticated search on Facebook Marketplace (`action: 'marketplace'`, `accountId: 'fb:alice'`, `requiresAuth: false`, running with sticky proxy per D1).
- The crawler records progress in `CrawlCheckpoint`: `{ platform: 'facebook', targetType: 'marketplace', targetKey: 'vietnam_cars', lastCursor: 'cur_abc123' }`.
- The worker container crashes and restarts.
- The recovery process reads `CrawlCheckpoint` per AD-16 / AD-12.
- Because `CrawlCheckpoint` does not store `action`, `authMode`, or `accountId`, the recovery worker reconstructs the command using the default descriptor for targetType `marketplace` (`requiresAuth: false`, `accountId: null`).
- The crawler resumes scraping from `lastCursor: 'cur_abc123'` using **Rotating Residential Proxies** with no account session.
- Facebook's GraphQL API rejects the pagination cursor because cursor `'cur_abc123'` was cryptographically tied to Alice's authenticated session, throwing `XACT_4001` (`INVALID_ARGS`) and stalling the checkpoint indefinitely.

#### Direct AD Rule Quotes
- **AD-12:** *"model CrawlCheckpoint { id, platform, targetType, targetKey, lastCursor, lastTimestamp, createdAt, updatedAt } với `@@unique([platform, targetType, targetKey])`."*
- **AD-3 Rule 3b:** *"Invariant điều phối Sticky ↔ Rotating: một request thuộc đúng MỘT chế độ; tài khoản đã đăng nhập không bao giờ bị gán IP xoay per-request..."*

#### The Incompatibility & Failure
`CrawlCheckpoint` lacks fields to persist the execution authentication mode (`authMode`, `action`, `accountId`). Resuming an authenticated pagination stream under unauthenticated rotating proxies (or vice versa) results in cursor rejection, state corruption, or account security flags.

#### Spine Status
**HOLE (HIGH)** — `CrawlCheckpoint` schema and resume protocol do not preserve auth state.

#### Minimal AD Fix (Spine Patch)
> **Amend AD-12 & Prisma Schema:**  
> *"Thêm trường `action String` và `requiresAuth Boolean` (kèm `accountId String?` tùy chọn) vào model `CrawlCheckpoint`. Khi `resume()` từ checkpoint, crawler BẮT BUỘC tái lập chính xác auth mode và proxy affinity ban đầu."*

---

### Attack Vector 6 (MEDIUM): Multi-Platform Action Classification Taxonomy Drift

#### Concrete Scenario
- In Epic 13 (Facebook), the team classifies `marketplace`, `search`, `page_posts`, `profile` as `requiresAuth: false`, while `group_posts` is `requiresAuth: true`.
- In Epic 10 / Story 13.2 (Twitter / X), `TwitterCrawler` has `requiresAuth = true` at the platform level. The Twitter team implements `search` and `profile` without declaring `requiresAuth: false` in their `ActionDescriptors`.
- Per AD-11 Rule 3, Twitter actions fall back to `this.requiresAuth` (`true`).
- When ChainLens-Research (AD-20 Rule 5) invokes `x_facebook_search`, it runs smoothly with rotating residential proxies and zero account consumption.
- When ChainLens-Research invokes `x_twitter_search`, it pulls an account from Twitter `AccountPool`, locks a sticky residential proxy, and consumes rate-governor account velocity. When the Twitter pool runs out of accounts, `x_twitter_search` fails with `XACT_4010` even though Twitter public search supports guest syndication tokens.

#### Direct AD Rule Quotes
- **AD-8:** *"Mỗi crawler khai báo `requiresAuth` mặc định ở cấp platform; từng action có thể override qua `ActionDescriptor.requiresAuth`..."*
- **AD-11 Rule 3:** *"Action không khai báo `requiresAuth` ➔ fallback crawler-level (backward compatibility 100% cho các platform chưa phân loại action)."*

#### The Incompatibility & Failure
The spine establishes action-level granularity but fails to mandate a standardized action classification taxonomy across platforms. Public read actions on one platform (Facebook) operate with rotating IPs while equivalent public actions on another (Twitter/Threads) unnecessarily lock accounts and sticky IPs, creating unpredictable system behavior and operational friction for AI consumers.

#### Spine Status
**HOLE (MEDIUM)** — Lack of cross-platform action classification standards.

#### Minimal AD Fix (Spine Patch)
> **Amend AD-8:**  
> *"Mọi platform crawler (Twitter, Facebook, Threads, Shopee, LinkedIn) BẮT BUỘC chuẩn hóa phân loại action: các action đọc dữ liệu công khai (`search`, `public_profile`, `hashtag`, `trending`, `public_feed`) PHẢI khai báo `requiresAuth: false` nếu platform hỗ trợ guest/public access; chỉ giữ `requiresAuth: true` cho private/group context và write actions."*

---

## Summary of Findings & Action Items

| ID | Title | Severity | Impacted ADs | Required Spine Action |
|---|---|---|---|---|
| **F-01** | Account-Bound `fb_dtsg` Contamination in Shared Pre-Signed Token Ring | **CRITICAL** | AD-1, AD-3 (3b) | Partition token ring into Guest Ring vs Account Session Cache; ban account-bound tokens from rotating requests. |
| **F-02** | Governor Hibernation & Velocity Bypass on Opt-In Authenticated Requests | **CRITICAL** | AD-11 (3), AD-3 (3b), AD-13 | Explicitly mandate `governor.canAccountRequest` check on opt-in `accountId` before dispatching `requiresAuth: false` actions. |
| **F-03** | Client vs Crawler `requiresAuth` Contract Asymmetry & False `XACT_4010` | **HIGH** | AD-2 (1), AD-11 (3) | Update `AbstractApiClient.request()` to accept `options.requiresAuth` and suppress account pool requirement when false/null. |
| **F-04** | Orthogonal Proxy Dimension Collision (Realtime/Bulk vs Sticky/Rotating) | **HIGH** | AD-20, AD-3 (3b) | Establish 2×2 matrix: Traffic Partition (Realtime/Bulk) by consumer priority × Proxy Mode (Sticky/Rotating) by action auth. |
| **F-05** | Auth Mode & Proxy Affinity Loss during `CrawlCheckpoint` Resumption | **HIGH** | AD-12, AD-16 | Add `action`, `requiresAuth`, and `accountId` to `CrawlCheckpoint` schema and restore them upon resume. |
| **F-06** | Cross-Platform Action Classification Taxonomy Drift | **MEDIUM** | AD-8, AD-11 (3) | Define universal classification rule requiring public read actions across all platforms to declare `requiresAuth: false`. |

---

## Conclusion & Gate Recommendation

The architecture amendment for Action-Level Granular Authentication is **approved with findings**. The proposed design direction is necessary and effective, but the 6 identified gaps must be incorporated into `ARCHITECTURE-SPINE.md` as minimal text patches prior to starting Story 13.9.

**Sign-off:** Adversarial Reviewer Subagent (Architecture Gate) — 2026-08-27
