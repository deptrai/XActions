# Architecture Review: Good-Spine Checklist Audit (Rubric Walker)

**Review Target:** `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (Amended on 2026-08-27: Action-Level Granular Authentication & Proxy Strategy)  
**Reference Proposal:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-27.md`  
**Parent Spine:** `../nowing/_bmad-output/planning-artifacts/architecture/architecture-xactions-social-integration-2026-08-15/ARCHITECTURE-SPINE.md`  
**Reviewer Role:** Architecture Reviewer Gate — Rubric Walker Subagent  
**Date:** 2026-08-27  
**Verdict:** **PASS-WITH-FINDINGS**  
**Review Target File:** `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/reviews/review-rubric-walker-2026-08-27.md`

---

## 1. Executive Summary

On 2026-08-27, an architectural amendment was integrated into `ARCHITECTURE-SPINE.md` introducing **"Action-Level Granular Authentication & Proxy Strategy"**:
- **AD-3 Rule 3b:** Added Action-Level Auth Granularity (`ActionDescriptor.requiresAuth` overrides platform-level flag) and the *Invariant điều phối Sticky ↔ Rotating Residential Proxy*.
- **AD-11 Rule 3:** Added resolution precedence `actionRequiresAuth = descriptor.requiresAuth ?? crawler.requiresAuth` within `AbstractCrawler.start()`.
- **AD-8 & AD-14:** Harmonized domain descriptions and pinned the resolved `requiresAuth: boolean` field in the Action Discovery Contract.
- **Section 7 Changelog & Frontmatter:** Recorded 2026-08-27 changes and bumped timestamp.

This review systematically walks the entire **Good-Spine Checklist (Items 1–9)** against the amended spine, verifying codebase ground truth (`src/core/`, `src/scrapers/`, `src/proxy/`), cross-artifact alignment (`epics.md`, `sprint-status.yaml`), and parent spine invariants (`AD-SOC-1` to `AD-SOC-11`).

### Overall Assessment
The strategic direction of the amendment is **exceptional**: it eliminates unnecessary account pool exhaustion on public endpoints (e.g. Facebook Marketplace, search, page posts) and unlocks high-throughput rotating residential proxies. However, because the amendment was applied as a point-fix, it left **critical boundary collisions** and **stale phrasing in adjacent ADs** that must be patched prior to implementing Epic 13 (Story 13.9/13.10).

---

## 2. Good-Spine Checklist Item-by-Item Audit

### 1. Does the spine fix real divergence points for the level below (epics/stories) and miss none?
* **Evaluation:** **PARTIALLY SATISFIED (Findings Identified)**
* **Evidence & Analysis:**
  - **Divergence Point A (Resolution Precedence):** AD-11 Rule 3 (`ARCHITECTURE-SPINE.md:236-240`) explicitly pins `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth`. Two crawler teams implementing `start()` will resolve auth requirements identically. *(Fixed)*
  - **Divergence Point B (Cross-Platform Taxonomy Drift):** While Facebook actions are classified cleanly in the change proposal, AD-8 (`ARCHITECTURE-SPINE.md:201-210`) lists Twitter, Threads, Facebook, TikTok, Shopee under blanket `(requires auth)` tags. Without explicit cross-platform taxonomy rules, Team A (Twitter) will leave `search` without `requiresAuth: false` (locking account & sticky IP), while Team B (Facebook) sets `requiresAuth: false` (rotating proxy). *(Missing rule — see Finding F-08)*.
  - **Divergence Point C (Client Contract Asymmetry):** AD-11 Rule 3 updates `AbstractCrawler.start()`, but `AbstractApiClient.request()` in `src/core/base-client.js:486` still guards by `this.requiresAuth && !currentAccountId && !this.accountPool`. Direct calls to the client bypass crawler resolution and throw `XACT_4010`. *(Missing contract — see Finding F-03)*.
  - **Divergence Point D (Opt-In Auth vs Governor):** AD-3 Rule 3b permits opt-in auth (`command.session.accountId`), but line 155 states `actionRequiresAuth === false` skips `governor.canAccountRequest`. A developer following this text will dispatch hibernating accounts without rate checks. *(Critical divergence — see Finding F-02)*.

---

### 2. Is every AD's Rule enforceable and does it actually prevent its stated divergence?
* **Evaluation:** **PARTIALLY SATISFIED (Enforcement Ambiguities Found)**
* **Evidence & Analysis:**
  - **Enforceability of AD-3 Rule 3b ("Invariant điều phối Sticky ↔ Rotating"):**
    - The invariant states: *"một request thuộc đúng MỘT chế độ; tài khoản đã đăng nhập không bao giờ bị gán IP xoay per-request; request công khai không giữ sticky session; không trộn proxy mode trong cùng một CrawlerCommand."*
    - **Locus of Enforcement:**
      1. `AbstractCrawler.start()` resolves `actionRequiresAuth` and sets `accountId = null` when unauthenticated.
      2. `AbstractApiClient.resolveProxy()` passes `accountId` to `proxyProvider.getProxy({ accountId })`.
      3. `DynamicTunnelProvider.#resolveSessionId` (`src/proxy/providers.js:880-908`) computes `hashBase36` sticky session when `accountId` is present; calls `randomBase36` per request when `accountId` is null and `rotatePerRequest = true`.
    - **Enforcement Fragility:** The invariant is testable via unit tests, but the spine does NOT forbid platform clients from defaulting `options.accountId` to non-null strings. For example, `FacebookClient.requestGraphQl` (`src/scrapers/social/facebook/client.js:436`) defaults `accountId` to `'default'`, inadvertently turning public requests into sticky sessions. The spine must mandate that `accountId` is strictly `null` for unauthenticated requests across all client layers.
    - **Token Contamination Risk:** AD-1 Rule 1 and AD-3 Rule 3b mandate using `PreSignedTokenRing` for `fb_dtsg`. Because `fb_dtsg` is an account-bound CSRF token, pushing it to rotating requests breaks the isolation invariant and leaks credentials. *(See Finding F-01)*.

---

### 3. Is anything under Deferred that could let two units diverge?
* **Evaluation:** **FULLY SATISFIED (PASS)**
* **Evidence & Analysis:**
  - `ARCHITECTURE-SPINE.md:447-453` (Section 5 Deferred & Out-of-Scope):
    - Defers unassigned platforms (Instagram, Amazon, Muaban.net, ITviec, public-procurement B2B) and explicitly forbids creating `src/scrapers/` directories for them.
    - Defers phone context extraction in comments to Nowing NLP, forbidding premature implementation in XActions without a new AD.
    - Defers 8s signer timeout tuning until 100-request benchmark is reached.
  - None of these deferred items allow independent teams in Epics 10–18 to build incompatible solutions.

---

### 4. Named tech is verified-current (Brownfield Reality Check)
* **Evaluation:** **FULLY SATISFIED (PASS)**
* **Evidence & Analysis:**
  - **TLS/JA4 Spoofing:** `got-scraping` and `undici` `ProxyAgent` verified in `src/core/base-client.js:245, 292`.
  - **Dynamic Tunnel & Residential Rotation:** `DynamicTunnelProvider` verified in `src/proxy/providers.js:578` (`rotatePerRequest: true`) and lines 880–908 (`#resolveSessionId`).
  - **Static Sticky Proxy:** `ProxyIpPool` verified in `src/proxy/proxy-pool.js:178` (`getStickyProxy(accountId)` with `#stickyMap`).
  - **QR Login:** `qrcode-terminal` verified in `src/utils/qrcode.js` and `src/core/base-login.js`.
  - **Database & Prisma:** Namespaced IDs (`Post.id`, `Comment.id`) and raw migration GIN index verified in `prisma/schema.prisma` and `src/core/types.js`.
  - **Microservice Daemon & Events:** Fast MCP over HTTP/SSE on port 3001 and Redis Streams `stream:social:raw_posts` verified in `src/mcp/` and `src/api/`.
  - All referenced core files exist and match the architectural paradigm.

---

### 5. Does it ratify rather than contradict the brownfield codebase?
* **Evaluation:** **SATISFIED WITH CODE GAPS IDENTIFIED**
* **Evidence & Analysis:**
  - `src/core/base-crawler.js`: Currently uses `this.requiresAuth` (platform level). The spine's amendment ratifies the approved target contract `actionRequiresAuth = descriptor.requiresAuth ?? this.requiresAuth` (supported by dev tasks T1–T6).
  - `src/proxy/providers.js:570-600 & 875-910`: The codebase already supports `rotatePerRequest` and hashes `accountId` to session IDs. The spine accurately ratifies this existing capability.
  - **Textual Drift in AD-5 Rule 4:** AD-5 Rule 4 (`ARCHITECTURE-SPINE.md:179`) states: *"SessionManager lưu accountId; ProxyIpPool.getStickyProxy(accountId) trả về proxy được gán"*. In reality, `base-client.js:185-210` prioritizes `this.proxyProvider.getProxy({ accountId })` (DynamicTunnelProvider) over static `ProxyIpPool`. AD-5 Rule 4 should be updated to reflect this precedence. *(See Finding F-07)*.

---

### 6. Inherited Invariants Compatibility (Parent Spine AD-SOC)
* **Evaluation:** **FULLY SATISFIED (PASS)**
* **Evidence & Analysis:**
  - `AD-SOC-1` (Scraping Delegation): Fully satisfied via Daemon MCP and Redis Stream (`AD-7`).
  - `AD-SOC-2` (Stealth Anti-Detection & Fingerprint): Delegated to XActions. Action-level rotation strengthens stealth by preventing high-volume public scraping from reusing single account IPs.
  - `AD-SOC-3` (Sticky SOCKS5 & Resilient Proxy Pool): Preserves 5-minute auto-quarantine (`AD-3 Rule 4`) and sticky proxy for authenticated sessions while routing public traffic to rotating residential proxies.
  - `AD-SOC-8` (3-Tier Gap-Filling Protocol): Supported by `AD-10` and `AD-12` (`CrawlCheckpoint`).
  - No new AD weakens or contradicts any inherited parent invariant.

---

### 7. Completeness across Altitude Dimensions (Adjacent Dimension Silence)
* **Evaluation:** **PARTIALLY SATISFIED (Gaps Identified)**
* **Evidence & Analysis:**
  - **Dimension A: Interaction with AD-20 (Dual-Pool Resource Isolation):**
    - AD-20 establishes Realtime Pool (30%) vs Bulk Pool (70%).
    - AD-3 Rule 3b establishes Sticky Residential vs Rotating Residential.
    - **Gap:** The spine is silent on the 2×2 orthogonal allocation matrix. If a bulk background worker crawls 10,000 unauthenticated marketplace posts via the MCP HTTP daemon, does it pull rotating proxies from the 30% Realtime Pool or 70% Bulk Pool? Without an explicit rule, bulk public requests will cannibalize the Realtime Pool. *(See Finding F-04)*.
  - **Dimension B: Checkpoint Resumption Semantics (AD-12 / AD-16):**
    - `CrawlCheckpoint` schema in `AD-12` (`ARCHITECTURE-SPINE.md:409-421`) stores `{ platform, targetType, targetKey, lastCursor, lastTimestamp }`.
    - **Gap:** It does not persist `action`, `authMode`, or `accountId`. If a crawl job running an authenticated search restarts, the recovery process may resume the cursor with an unauthenticated rotating session, causing pagination cursor rejection (`XACT_4001`). *(See Finding F-05)*.

---

### 8. Internal Consistency across Architectural Decisions
* **Evaluation:** **PARTIALLY SATISFIED (Internal Contradictions Found)**
* **Evidence & Analysis:**
  - **AD-5 Rule 4 vs AD-3 Rule 3b:** AD-5 line 179 states: *"Auth-required platforms (Facebook, TikTok, Shopee, X, Threads, LinkedIn, TopCV, VietnamWorks) ... buộc một tài khoản gắn với một proxy cố định trong suốt session"*. This blanket platform-level categorization directly contradicts AD-3 Rule 3b, where Facebook public actions do NOT use sticky proxies. *(See Finding F-07)*.
  - **AD-9 Rule 1 vs AD-3 Rule 3b:** AD-9 lines 216–219 partition WAF/RateLimit validation into 3 rigid platform categories ("No-auth platforms", "Optional-auth platforms", "Auth-required platforms"). If Facebook encounters a 429 on a no-auth action (`marketplace`), following the "Auth-required platforms" branch will attempt to hibernate a null account! It must branch on request auth state (`accountId === null` vs `accountId !== null`). *(See Finding F-06)*.
  - **AD-13 Rule 3/4 vs AD-11 Rule 3:** AD-13 Rule 3 limits velocity "cho auth-required platforms". When opt-in auth is used on a no-auth action, velocity limits must apply to the active `accountId`.

---

### 9. ActionDescriptor Shape Verification
* **Evaluation:** **FULLY SATISFIED IN SPINE (Discrepancy in Epics.md)**
* **Evidence & Analysis:**
  - `ARCHITECTURE-SPINE.md:235` (AD-11 Rule 2): Pinned to `{ action, description, requiredArgs, optionalArgs, example, outputType, requiresAuth }`. *(Verified)*
  - `ARCHITECTURE-SPINE.md:277` (AD-14 Rule 2): Pinned to `{ action, description, requiredArgs, optionalArgs, example, outputType, requiresAuth }`. *(Verified)*
  - Section 6 Open Questions: No stale references to `category`. *(Verified)*
  - Section 7 Changelog (line 512): Accurately documents replacing `category` with `optionalArgs`/`outputType` and pinning resolved `requiresAuth`. *(Verified)*
  - `epics.md:675` (Story 14.2 AC): Retains the old 6-field shape without `requiresAuth`. *(Flagged in Finding F-09)*.

---

## 3. Structured Findings Matrix

| Finding ID | Severity | Impacted Location | Category | Problem Summary |
|---|---|---|---|---|
| **F-01** | **CRITICAL** | `ARCHITECTURE-SPINE.md:129, 155` (AD-1, AD-3 3b) | Security & Credentials | Account-bound `fb_dtsg` CSRF token conflated with anonymous guest tokens in shared `PreSignedTokenRing`. |
| **F-02** | **CRITICAL** | `ARCHITECTURE-SPINE.md:155, 238` (AD-3 3b, AD-11 3) | Account Safety | Opt-in authenticated requests on no-auth actions bypass `governor.canAccountRequest` check. |
| **F-03** | **HIGH** | `ARCHITECTURE-SPINE.md:138, 236` (AD-2 1, AD-11 3) | Contract Asymmetry | `AbstractApiClient.request()` lacks `options.requiresAuth`, throwing `XACT_4010` on direct calls. |
| **F-04** | **HIGH** | `ARCHITECTURE-SPINE.md:155, 261` (AD-3 3b, AD-20) | Resource Isolation | Undefined 2×2 allocation matrix between Dual-Pool Partitioning (AD-20) and Proxy Rotation (AD-3 3b). |
| **F-05** | **HIGH** | `ARCHITECTURE-SPINE.md:244, 409` (AD-12, Schema) | State & Durability | `CrawlCheckpoint` schema does not store `action`, `authMode`, or `accountId`, causing cursor rejection on resume. |
| **F-06** | **HIGH** | `ARCHITECTURE-SPINE.md:216-219` (AD-9 Rule 1) | Error Handling | Anti-Bot validation branches by platform name instead of active request auth state. |
| **F-07** | **MEDIUM** | `ARCHITECTURE-SPINE.md:179` (AD-5 Rule 4) | Internal Consistency | Blanket "Auth-required platforms" phrasing contradicts mixed-action Facebook architecture. |
| **F-08** | **MEDIUM** | `ARCHITECTURE-SPINE.md:201-210` (AD-8) | Domain Taxonomy | Lacks cross-platform action classification standards for public read endpoints (Twitter, Threads). |
| **F-09** | **LOW** | `epics.md:675` (Story 14.2 AC) | Cross-Artifact | Story 14.2 AC omits `requiresAuth` from `ActionDescriptor` discovery shape. |

---

## 4. Detailed Findings & Recommended Spine Patches

### Finding F-01 (CRITICAL): Account-Bound `fb_dtsg` Contamination in Shared Pre-Signed Token Ring
- **Location:** `ARCHITECTURE-SPINE.md:129` (AD-1 Rule 1) & `155` (AD-3 Rule 3b)
- **Problem:** `fb_dtsg` is a user-bound CSRF token tied to `c_user`. Listing `fb_dtsg` under anonymous `PreSignedTokenRing` tokens and fetching it for rotating residential requests spreads user credentials across hundreds of random IPs, triggering instant account checkpoints and bans.
- **Suggested Fix:** Amend AD-1 Rule 1 & AD-3 Rule 3b:
  ```markdown
  Pre-Signed Token Ring chỉ được lưu trữ các token ẩn danh cấp khách (Guest Tokens: `lsd`, `jazoest`, `msToken` public). Các token phiên gắn danh tính tài khoản (`fb_dtsg`, `dtsg_ag`) BẮT BUỘC lưu trữ trong session cache riêng biệt của từng `accountId` và TUYỆT ĐỐI KHÔNG được đẩy vào Token Ring chung hoặc phát tán qua Rotating Residential Proxy.
  ```

---

### Finding F-02 (CRITICAL): Governor Hibernation & Velocity Bypass on Opt-In Authenticated Requests
- **Location:** `ARCHITECTURE-SPINE.md:155` (AD-3 Rule 3b) & `238` (AD-11 Rule 3)
- **Problem:** The text states that when `actionRequiresAuth === false`, the system *"không kiểm tra governor.canAccountRequest"*. When a caller provides an explicit `accountId` (opt-in auth per D1), bypassing the governor allows hibernating or velocity-exhausted accounts to execute requests, violating AD-13 account safety invariants.
- **Suggested Fix:** Amend AD-11 Rule 3 & AD-3 Rule 3b:
  ```markdown
  Khi `actionRequiresAuth === false`: nếu caller KHÔNG truyền `accountId`, chạy với `accountId = null`, bỏ qua `AccountPool` và bỏ qua account velocity check; nếu caller CÓ truyền `accountId` (opt-in auth), BẮT BUỘC kiểm tra `governor.canAccountRequest(accountId, platform)` trước khi thực thi — nếu tài khoản đang hibernation hoặc vượt velocity limit, BẮT BUỘC throw `XACT_4291` (`hibernation`).
  ```

---

### Finding F-03 (HIGH): Client-Level vs Crawler-Level Auth Contract Asymmetry
- **Location:** `ARCHITECTURE-SPINE.md:138` (AD-2 Rule 1) & `src/core/base-client.js:486`
- **Problem:** `AbstractApiClient.request()` retains a platform-level `this.requiresAuth` guard. Direct calls from signer bridges or lightweight workers without an `accountPool` crash with `XACT_4010` even for unauthenticated requests.
- **Suggested Fix:** Amend AD-2 Rule 1:
  ```markdown
  `AbstractApiClient.request(method, url, options)` hỗ trợ `options.requiresAuth?: boolean` (mặc định kế thừa `this.requiresAuth`). Khi `options.requiresAuth === false` hoặc `options.accountId === null`, client bỏ qua kiểm tra bắt buộc `accountPool` và không throw `XACT_4010`.
  ```

---

### Finding F-04 (HIGH): Orthogonal Proxy Dimension Collision (AD-20 vs AD-3 Rule 3b)
- **Location:** `ARCHITECTURE-SPINE.md:257-267` (AD-20) & `152-160` (AD-3 Rule 3b)
- **Problem:** AD-20 partitions proxies by traffic urgency (Realtime 30% vs Bulk 70%), while AD-3 Rule 3b partitions proxies by auth mode (Sticky vs Rotating). Without an explicit allocation matrix, high-volume bulk no-auth crawls arriving via MCP daemon will consume the 30% Realtime Pool.
- **Suggested Fix:** Amend AD-20:
  ```markdown
  Điều phối Proxy tuân theo ma trận 2 chiều độc lập: Phân vùng Pool (`Realtime` 30% vs `Bulk` 70%) được quyết định bởi kênh gọi và độ ưu tiên tác vụ (`command.priority` / `X-Consumer-Priority`); Chế độ Proxy (`Sticky` vs `Rotating`) được quyết định bởi `actionRequiresAuth`. Mọi tác vụ cào hàng loạt (bulk/batch) dù là no-auth hay auth BẮT BUỘC chỉ được rút proxy từ Bulk Pool.
  ```

---

### Finding F-05 (HIGH): State & Proxy Affinity Loss during CrawlCheckpoint Resumption
- **Location:** `ARCHITECTURE-SPINE.md:244, 409-421` (AD-12 & Prisma Schema)
- **Problem:** `CrawlCheckpoint` does not store `action`, `requiresAuth`, or `accountId`. Resuming an authenticated pagination stream under unauthenticated rotating proxies leads to cursor rejection (`XACT_4001`) and stalled checkpoints.
- **Suggested Fix:** Amend AD-12 and `CrawlCheckpoint` model:
  ```markdown
  Thêm trường `action String` và `requiresAuth Boolean` (kèm `accountId String?` tùy chọn) vào model `CrawlCheckpoint`. Khi `resume()` từ checkpoint, crawler BẮT BUỘC tái lập chính xác auth mode và proxy affinity ban đầu.
  ```

---

### Finding F-06 (HIGH): AD-9 Rule 1 Anti-Bot Validation Branches by Platform Name
- **Location:** `ARCHITECTURE-SPINE.md:216-219` (AD-9 Rule 1)
- **Problem:** Classifying Facebook strictly under "Auth-required platforms" causes no-auth actions (`marketplace`) encountering WAF/429 to attempt hibernating a null account instead of rotating the proxy.
- **Suggested Fix:** Update AD-9 Rule 1 to branch by request auth state:
  ```markdown
  - *Request không dùng tài khoản (`accountId === null` / `actionRequiresAuth === false`):* throw `RateLimitError` để xoay IP (rotate proxy) ngay cả khi HTTP status là 200.
  - *Request có tài khoản (`accountId !== null` / `actionRequiresAuth === true`):* nếu lỗi bot challenge/WAF → throw `BotChallengeError`, quarantine proxy, hibernate tài khoản 15–30 phút, và chuyển `AccountPool` sang tài khoản tiếp theo. Không xoay IP liên tục cho cùng một tài khoản.
  ```

---

### Finding F-07 (MEDIUM): AD-5 Rule 4 Blanket Phrasing Contradicts Mixed-Action Reality
- **Location:** `ARCHITECTURE-SPINE.md:179` (AD-5 Rule 4)
- **Problem:** Listing Facebook under blanket "Auth-required platforms" creates conceptual ambiguity.
- **Suggested Fix:** Update AD-5 Rule 4 opening:
  ```markdown
  4. *Sticky IP per Account:* Các request chạy ở chế độ xác thực (platform auth-required, action có requiresAuth hiệu dụng = true, hoặc caller truyền accountId) buộc một tài khoản gắn với một proxy cố định trong suốt session...
  ```

---

### Finding F-08 (MEDIUM): Cross-Platform Public Action Classification Taxonomy Gap
- **Location:** `ARCHITECTURE-SPINE.md:201-210` (AD-8)
- **Problem:** Lacks explicit mandate requiring public read actions across other platforms (Twitter search, Threads profile) to declare `requiresAuth: false` where guest access exists.
- **Suggested Fix:** Clarify in AD-8 that all platform crawlers must explicitly declare `requiresAuth: false` on public read actions supported by guest tokens.

---

### Finding F-09 (LOW): Story 14.2 AC ActionDescriptor Shape Discrepancy
- **Location:** `epics.md:675` (Story 14.2 AC)
- **Problem:** Lists `{ action, description, requiredArgs, optionalArgs, example, outputType }`, omitting `requiresAuth`.
- **Suggested Fix:** Update `epics.md:675` to include `requiresAuth` (resolved boolean per AD-11 Rule 3).

---

## 5. Review Conclusion & Gate Verdict

- **Verdict:** **PASS-WITH-FINDINGS**
- **Readiness:** The architecture spine is sound, verified against brownfield reality, and ready for Epic 13 execution once the 2 CRITICAL (F-01, F-02) and 4 HIGH (F-03, F-04, F-05, F-06) findings are patched into `ARCHITECTURE-SPINE.md`.
- **Handoff:** Dev tasks in `sprint-change-proposal-2026-08-27.md` should be augmented with T4b (`base-client.js:486`) and T4c (`FacebookClient.js:436, 389`) as documented in the Reality-Check review.

**Reviewer Sign-off:** Reviewer Subagent (Architecture Gate — Rubric Walker) — 2026-08-27
