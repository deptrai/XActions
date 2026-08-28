# Architecture Review: Brownfield Reality-Check & Codebase Verification

**Review Target:** `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` (Amended on 2026-08-27: AD-3 rule 3b, AD-11 rule 3)  
**Reference Proposal:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-27.md`  
**Reviewer Lens:** BROWNFIELD REALITY-CHECK — Rigorous factual verification of codebase claims, contracts, execution paths, and dev task sufficiency  
**Date:** 2026-08-27  
**Status:** COMPLETE  
**Verdict:** **PASS WITH FINDINGS (4 Critical/High Brownfield Code Gaps Identified)**

---

## 1. Executive Summary

This review independently verifies all factual claims made in the **Sprint Change Proposal (2026-08-27)** and the amended **Architecture Spine (AD-3 rule 3b, AD-11 rule 3)** regarding the existing XActions brownfield codebase (`src/core/`, `src/scrapers/social/facebook/`, `src/proxy/`).

### Key Reality-Check Takeaways:
1. **Core Diagnosis is 100% Valid:** The existing codebase hardcodes `requiresAuth = true` at both `AbstractCrawler` (`src/core/base-crawler.js:174, 181`) and `FacebookCrawler` (`src/scrapers/social/facebook/crawler.js:262, 288`), causing all Facebook public actions (`marketplace`, `search`, `page_posts`, `profile`) to needlessly drain accounts from `AccountPool` and crash with `XACT_4010` when the pool is empty.
2. **Infrastructure Readiness is Confirmed:** `DynamicTunnelProvider` (`src/proxy/providers.js:578, 880-908`) and `base-client.js:resolveProxy()` already correctly support random session generation per request (`rotatePerRequest = true`) when `accountId` is null.
3. **CRITICAL BROWNFIELD HOLE in Proposal:** The proposal's claim that *"src/core/base-client.js — không cần sửa"* and that Dev Tasks T1–T6 are sufficient is **REFUTED in practice**. Three severe code-level blockers exist in `FacebookClient` and `base-client.js`:
   - **Blocker A (`FacebookClient.requestGraphQl:436`):** Defaults `accountId` to `'default'` when `options.accountId` is null/undefined. This turns every no-auth GraphQL request into a **sticky session for `'default'`**, completely defeating per-request rotating residential proxies!
   - **Blocker B (`base-client.js:486`):** In standalone/test setups without `accountPool` configured, `client.request()` with `accountId: null` still throws `XACT_4010` because `this.requiresAuth` is `true` at the client level.
   - **Blocker C (`FacebookClient.buildGraphQlBody:389-398`):** Unconditionally throws `XACT_4010` if `tokens.c_user` is missing, breaking guest/anonymous GraphQL scraping.

---

## 2. Verification of Claims (C1 – C10)

| Claim ID | Proposal / Spine Claim | Status | Primary File & Line Evidence |
|---|---|---|---|
| **C1** | `ActionDescriptor` in `types.js` does not yet have `requiresAuth` | **CONFIRMED** | `src/core/types.js:93-100` |
| **C2** | `AbstractCrawler.start()` uses `this.requiresAuth` (platform-level) for account resolution | **CONFIRMED** | `src/core/base-crawler.js:174, 181, 194` |
| **C3** | `resolveProxy(accountId)` keys sticky behavior on `accountId` presence; `accountId=null` automatically gets rotating proxy | **CONFIRMED** | `src/core/base-client.js:181-229`, `src/proxy/providers.js:578, 880-908, 1021-1060` |
| **C4** | `base-client.js:486` guard and `FacebookClient` standalone behavior without `accountPool` | **REFUTED (CRITICAL GAP)** | `src/core/base-client.js:486-494`, `src/scrapers/social/facebook/client.js:60, 436, 389-398` |
| **C5** | `DynamicTunnelProvider` `rotatePerRequest` defaults to `true` | **CONFIRMED** | `src/proxy/providers.js:578` |
| **C6** | `governor.recordRequest(accountId \|\| 'noauth')` already handles null `accountId` | **CONFIRMED** | `src/core/base-crawler.js:231`, `src/core/adaptive-governor.js:92-98, 202-218` |
| **C7** | 4 Facebook public actions (`page_posts`, `profile`, `search`, `marketplace`) currently pull accounts from pool | **CONFIRMED** | `src/scrapers/social/facebook/crawler.js:262, 288, 306-420` |
| **C8** | Spine AD-5 rule 4 text vs actual implementation (`ProxyIpPool` vs `DynamicTunnelProvider`) | **PARTIAL (DRIFT NOTED)** | `src/core/base-client.js:185-210`, `src/core/session-manager.js:1-51`, `src/proxy/proxy-pool.js:174-200` |
| **C9** | `listActions()` in `base-crawler.js` currently omits `requiresAuth` (T3 needed) | **CONFIRMED** | `src/core/base-crawler.js:106-114` |
| **C10** | `ActionRegistry` (`action-registry.js`) descriptors & MCP `x_actions_list` resolution | **CONFIRMED & REFINED** | `src/core/base-crawler.js:100-103`, `src/core/action-registry.js:25-50`, `src/mcp/server.js` |

---

## 3. In-Depth Analysis of Individual Claims

### Claim C1: `ActionDescriptor` Typedef in `src/core/types.js`
- **Status:** **CONFIRMED**
- **Evidence:** `src/core/types.js:93-100` defines:
  ```js
  /**
   * @typedef {Object} ActionDescriptor
   * @property {string} action
   * @property {string} [description]
   * @property {string[]} [requiredArgs]
   * @property {string[]} [optionalArgs]
   * @property {Object} [example]
   * @property {string} [outputType]
   */
  ```
- **Finding:** Field `requiresAuth?: boolean` is completely absent from the typedef. Adding `@property {boolean} [requiresAuth]` (Task T1) is required.

---

### Claim C2: Platform-Level Account Resolution in `AbstractCrawler.start()`
- **Status:** **CONFIRMED**
- **Evidence:** `src/core/base-crawler.js:172-195` contains:
  ```js
  // Resolve account ID
  let accountId = command.session?.accountId || command.args?.accountId || null;
  if (this.requiresAuth && !accountId && this.accountPool) {
    const account = this.accountPool.getNextAvailable(this.name);
    if (account) {
      accountId = account;
    }
  }

  if (this.requiresAuth && !accountId) {
    throw new PlatformError({
      type: ErrorTypes.AUTH_EXPIRED,
      code: 'XACT_4010',
      message: `No available account for authenticated crawler on platform ${this.name}`,
      statusCode: 401,
      suggestedAction: SuggestedActions.RELOGIN,
      platform: this.name,
    });
  }
  ```
- **Finding:** `start()` strictly evaluates `this.requiresAuth`. It never inspects `entry.descriptor.requiresAuth`. Task T2 is essential.

---

### Claim C3: `resolveProxy()` and `DynamicTunnelProvider` Rotation
- **Status:** **CONFIRMED**
- **Evidence:**
  1. `src/core/base-client.js:181-229`: When `this.proxyProvider` is present, it calls `this.proxyProvider.getProxy({ accountId: rawAccountId, requiresResidential })`.
  2. `src/proxy/providers.js:880-908` (`#resolveSessionId`):
     ```js
     if (accountId) {
       const bucket = Math.floor(Date.now() / this.sessionDurationMs);
       const seed = this.#sessionSeeds.get(accountId) || 0;
       const input = `${accountId}:${bucket}:${seed}:${this.#globalSeed}:${this.provider}`;
       return hashBase36(input, length);
     }
     if (this.rotatePerRequest) {
       return randomBase36(length);
     }
     ```
  3. `src/proxy/providers.js:1036-1060` (`getProxy`): When `accountId` is null/undefined and `rotatePerRequest` is true, `activeKey` is null, generating a fresh `randomBase36(length)` session ID on every invocation.
  4. If `this.proxyPool` (`ProxyIpPool`) is used: `base-client.js:201` only invokes `getStickyProxy` when `this.requiresAuth && rawAccountId`; otherwise it falls through to `this.proxyPool.getNext()`.

---

### Claim C4 (CRITICAL): `base-client.js:486` Guard & `FacebookClient` Implementation Gaps
- **Status:** **REFUTED (Proposal assumption is false; code fixes are MANDATORY)**
- **Evidence & Breakdown:**
  1. **The Fallacy in Proposal Section 3.4 item 4:** The proposal claimed `base-client.js` does not need changes because *"Guard dòng 486 đã thông thoáng với accountId=null + accountPool tồn tại"*.
  2. **Failure Mode 1 (Standalone Client Execution):** In `src/core/base-client.js:486-494`:
     ```js
     if (this.requiresAuth && !currentAccountId && !this.accountPool) {
       throw new AuthSessionExpiredError({
         code: 'XACT_4010',
         message: `No account or account pool configured for authenticated ${this.platform} request`,
         statusCode: 401,
         suggestedAction: SuggestedActions.RELOGIN,
         platform: this.platform,
       });
     }
     ```
     `FacebookClient` sets `this.requiresAuth = true` (`client.js:60`). When `FacebookCrawler` runs an unauthenticated action (e.g. `marketplace` or `search` SSR fallback at `crawler.js:1689`), `currentAccountId` is `null`/`undefined`. If the crawler or client was instantiated without an `accountPool` (standard for standalone scraping scripts, CLI tools, or microservice workers with proxy-only setup), `AbstractApiClient.request()` **throws `XACT_4010` immediately**.
  3. **Failure Mode 2 (Defaulting `accountId` to `'default'` breaks Rotating Proxies):**
     In `src/scrapers/social/facebook/client.js:436`:
     ```js
     async requestGraphQl(docId, variables = {}, options = {}) {
       const accountId = options.accountId || 'default'; // <--- BUG: converts null/undefined to 'default'!
       const rawCookies = options.cookies || options.headers?.cookie;
       const tokens = await this.ensureTokens(accountId, rawCookies);
       ...
     ```
     When `FacebookCrawler.marketplace()`, `search()`, `pagePosts()`, or `profile()` calls `requestGraphQl` with `accountId: session?.accountId` (`undefined`), `requestGraphQl` converts `accountId` into `'default'`.
     This `'default'` string is forwarded to `client.request()` -> `resolveProxy('default')` -> `DynamicTunnelProvider.getProxy({ accountId: 'default' })`.
     `#resolveSessionId(req, 'default')` hashes `'default'` into a **sticky session**!
     **Result:** The entire rotating residential proxy mechanism is completely bypassed; requests remain stuck to a single sticky IP!
  4. **Failure Mode 3 (`buildGraphQlBody` rejects Guest Requests):**
     In `src/scrapers/social/facebook/client.js:389-398`:
     ```js
     buildGraphQlBody(docId, variables = {}, tokens = {}) {
       const userId = tokens.c_user || tokens.userId;
       if (!userId) {
         throw new PlatformError({
           code: 'XACT_4010',
           type: ErrorTypes.AUTH_EXPIRED,
           message: 'Missing c_user token in GraphQL body',
           suggestedAction: SuggestedActions.RELOGIN,
           platform: 'facebook',
         });
       }
     ```
     Guest Facebook requests (without login cookies) do not have `c_user`. Facebook public GraphQL endpoints accept `__user: '0'` / `av: '0'`. Hard-requiring `c_user` crashes guest GraphQL scraping with `XACT_4010`.

---

### Claim C5: `DynamicTunnelProvider.rotatePerRequest` Default
- **Status:** **CONFIRMED**
- **Evidence:** `src/proxy/providers.js:578`:
  ```js
  this.rotatePerRequest = options.rotatePerRequest !== false;
  ```
  Evaluates to `true` unless explicitly passed as `false`.

---

### Claim C6: Adaptive Governor Handles Null `accountId`
- **Status:** **CONFIRMED**
- **Evidence:**
  1. `src/core/base-crawler.js:231`: `this.governor.recordRequest(accountId || 'noauth', this.name);`
  2. `src/core/adaptive-governor.js:92-98` (`#resolveAccountId`): Converts `'noauth'` + `'facebook'` to key `'facebook:noauth'`.
  3. `src/core/adaptive-governor.js:203-218`: Tracks timestamps under `'facebook:noauth'` and increments `currentReqPerSecond` without error.

---

### Claim C7: Facebook Actions Currently Drain AccountPool
- **Status:** **CONFIRMED**
- **Evidence:**
  1. `src/scrapers/social/facebook/crawler.js:262, 288`: `requiresAuth = true` hardcoded.
  2. `src/scrapers/social/facebook/crawler.js:306-420`: None of the 12 `registerAction` calls provide a `requiresAuth` field.
  3. `AbstractCrawler.start()` (`base-crawler.js:174`): Always attempts `accountPool.getNextAvailable('facebook')` and throws `XACT_4010` if none exists.

---

### Claim C8: Spine AD-5 Rule 4 Text vs Code Implementation
- **Status:** **PARTIAL (DRIFT NOTED)**
- **Evidence:**
  - Spine AD-5 Rule 4 states: *"SessionManager lưu accountId; ProxyIpPool.getStickyProxy(accountId) trả về proxy được gán"*.
  - In code: `SessionManager` (`src/core/session-manager.js:1-51`) is an in-memory session token store that does not invoke proxy methods.
  - In `src/core/base-client.js:185-210`, sticky proxy resolution first routes through `this.proxyProvider.getProxy({ accountId })` (which handles dynamic residential tunnel hash keys), and only uses `ProxyIpPool.getStickyProxy(accountId)` when static `proxyPool` is supplied.
  - *Recommendation:* Update AD-5 rule 4 text to accurately reflect `proxyProvider.getProxy({ accountId })` precedence over static `proxyPool.getStickyProxy(accountId)`.

---

### Claim C9: `listActions()` Omits `requiresAuth`
- **Status:** **CONFIRMED**
- **Evidence:** `src/core/base-crawler.js:106-114`:
  ```js
  listActions() {
    return Array.from(this.#registry.entries()).map(([action, { descriptor }]) => ({
      action,
      description: descriptor.description || `${action} for ${this.name}`,
      requiredArgs: descriptor.requiredArgs || [],
      optionalArgs: descriptor.optionalArgs || [],
      example: descriptor.example || {},
      outputType: descriptor.outputType || 'PostItem[]',
    }));
  }
  ```
  `requiresAuth` is omitted. Task T3 is necessary.

---

### Claim C10: Global Action Registry & MCP `x_actions_list`
- **Status:** **CONFIRMED & REFINED**
- **Evidence:**
  1. `src/core/base-crawler.js:100-103`:
     ```js
     const fullDescriptor = { action: actionName, ...actionDesc };
     this.#registry.set(actionName, { handler: actionHandler.bind(this), descriptor: fullDescriptor });
     globalActionRegistry.registerPlatformActions(this.name, [fullDescriptor]);
     ```
  2. If `actionDesc` relies on default fallback (`undefined`), `fullDescriptor.requiresAuth` is `undefined`.
  3. `registerAction()` must explicitly resolve `requiresAuth: actionDesc.requiresAuth ?? this.requiresAuth` before storing and registering into `globalActionRegistry`.
  4. In `src/mcp/server.js`, `x_actions_list` is scheduled for Epic 14 (Story 14.2). Ensuring `globalActionRegistry` holds resolved descriptors prepares the system seamlessly for MCP tools and CLI discovery (`xactions actions --platform <p>`).

---

## 4. Required Dev Task Adjustments (Remediating T1–T6)

To fully deliver the architectural intent of AD-3 rule 3b and AD-11 rule 3 without production crashes, Dev Tasks T1–T6 in the Sprint Change Proposal must be augmented:

### Augmented Dev Tasks for Developer Agent (Amelia):

1. **T1 (`src/core/types.js`):** Add `@property {boolean} [requiresAuth]` to `ActionDescriptor` typedef.
2. **T2 (`src/core/base-crawler.js`):**
   - In `start()`: resolve `actionRequiresAuth = entry.descriptor.requiresAuth ?? this.requiresAuth`.
   - When `actionRequiresAuth === false`:
     - If caller did NOT pass `accountId`, keep `accountId = null`, skip `AccountPool.getNextAvailable()`, and skip governor account velocity check.
     - If caller DID pass explicit `accountId` (opt-in auth per D1), **MUST** check `governor.canAccountRequest(accountId, this.name)` and throw `XACT_4291` if hibernating.
   - In `registerAction()`: resolve `fullDescriptor = { action: actionName, requiresAuth: actionDesc.requiresAuth ?? this.requiresAuth, ...actionDesc }` so both `#registry` and `globalActionRegistry` store the resolved boolean.
3. **T3 (`src/core/base-crawler.js`):** `listActions()` returns `requiresAuth: descriptor.requiresAuth ?? this.requiresAuth`.
4. **T4 (`src/scrapers/social/facebook/crawler.js`):** Add `requiresAuth: false` to `registerAction` descriptors for `page_posts`, `profile`, `search`, and `marketplace`.
5. **T4b (NEW — `src/core/base-client.js:486`):**
   - Allow `options.requiresAuth?: boolean` in `AbstractApiClient.request(method, url, options)`.
   - Update guard: `const effectiveRequiresAuth = options.requiresAuth ?? (options.accountId ? true : this.requiresAuth);`
   - Only throw `XACT_4010` if `effectiveRequiresAuth && !currentAccountId && !this.accountPool`.
6. **T4c (NEW — `src/scrapers/social/facebook/client.js`):**
   - In `requestGraphQl(docId, variables, options)`: do NOT default `accountId` to `'default'`. Use `const accountId = options.accountId || null;` and pass `accountId` to `resolveProxy` and `request()`.
   - In `ensureTokens(accountId, cookies)`: allow `accountId = null` for guest token ring extraction (`lsd`/`jazoest`).
   - In `buildGraphQlBody(docId, variables, tokens)`: fallback `const userId = tokens.c_user || tokens.userId || '0';` for unauthenticated guest requests.
7. **T5 & T6 (Tests & MCP):** Expand test suite in `tests/core/base-crawler.test.js` and `tests/scrapers/social/facebook/` to verify:
   - Standalone `FacebookCrawler` runs `marketplace` with `AccountPool: null` and succeeds without `XACT_4010`.
   - Guest requests generate rotating session IDs across sequential queries.
   - Explicit `accountId` on `marketplace` enforces sticky proxy and triggers governor hibernation checks.

---

## 5. Gate Verdict & Recommendation

- **Verdict:** **PASS WITH FINDINGS**
- **Summary of Findings:**
  1. *[CRITICAL]* `FacebookClient.requestGraphQl:436` defaults `accountId` to `'default'`, causing rotating residential proxies to become sticky sessions on no-auth actions.
  2. *[HIGH]* `base-client.js:486` crashes standalone/pool-less no-auth requests with `XACT_4010` due to client-level `requiresAuth: true`.
  3. *[HIGH]* `FacebookClient.buildGraphQlBody:389` throws `XACT_4010` if `c_user` is missing, blocking guest GraphQL execution.
  4. *[MEDIUM]* `base-crawler.js:registerAction` must resolve `requiresAuth` into `fullDescriptor` so `globalActionRegistry` remains in sync.
- **Handoff:** Hand off tasks T1–T6 + T4b + T4c to Developer Agent (Amelia) before Story 13.9 begins.

**Reviewer Sign-off:** Reviewer Subagent (Architecture Gate — Brownfield Reality-Check) — 2026-08-27
