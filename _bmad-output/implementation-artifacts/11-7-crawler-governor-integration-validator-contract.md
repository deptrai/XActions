# Story 11.7 — Crawler-Governor Integration & Platform Response Validator Contract

**Story ID:** 11.7  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** review  
**Owner:** DEV  
**Source:** `epics.md` Story 11.7, `ARCHITECTURE-SPINE.md` AD-2, AD-3, AD-8, AD-9, AD-13, AD-14; `audit-report-sprint-status-2026-08-21.md`; previous stories 11.1–11.6; current `src/core/base-crawler.js`, `src/core/base-client.js`, `src/core/platform-validator.js`, `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/scrapers/twitter/http/**`, `src/scrapers/facebook/index.js`.

---

```yaml
baseline_commit: a0f5ac4d27a6c0530751a9832a92dc0d1ca803c6
```

---

## Story

As a **Platform Scraper Developer**,  
I want **`AbstractCrawler` to consult the `AdaptiveRateGovernor` before each action and an `AbstractPlatformResponseValidator` contract that each scraper implements to recognize bot/rate-limit payloads**,  
so that **every platform can define its own valid-response, WAF, and rate-limit signals without leaking platform-specific detection logic into `src/core/` and without spamming the account pool when a platform returns HTTP 200 with a hidden challenge**.

---

## Acceptance Criteria

### AC-1: `AbstractCrawler.start()` consults the governor

* **Given** a platform crawler extends `AbstractCrawler` and is constructed with a `governor` (or with an `AbstractApiClient` that has a `governor`)
* **When** `start(command)` is called with a `CrawlerCommand`
* **Then** it resolves `platform` from `this.name`, `accountId` from `command.session?.accountId || command.args?.accountId` (or `accountPool.getNextAvailable(platform)` if `requiresAuth` and none provided)
* **And** if `requiresAuth` and `accountId` is hibernating (`governor.canAccountRequest(accountId, platform) === false`), it throws `PlatformError({ type: HIBERNATION, code: 'XACT_4291', suggestedAction: 'ROTATE_ACCOUNT' })`
* **And** if `governor.getMaxThroughput(platform) === 0`, it throws `PlatformError({ type: PROXY_EXHAUSTED, code: 'XACT_5030', suggestedAction: 'WAIT', retryAfterMs: 30000 })`
* **And** on admission it calls `governor.recordRequest(accountId || 'noauth', platform)` exactly once per action attempt
* **And** it finally delegates to the registered action handler

### AC-2: `AbstractCrawler` constructor accepts governor and account pool

* **Given** `src/core/base-crawler.js`
* **When** `new AbstractCrawler({ client, store, sessionManager, governor, accountPool })` is called
* **Then** `this.governor` is set to `deps.governor || deps.client?.governor || null`
* **And** `this.accountPool` is set to `deps.accountPool || deps.client?.accountPool || null`
* **And** the TypeScript declaration in `types/core.d.ts` is updated so `AbstractCrawler` constructor options include `governor?: AdaptiveRateGovernor` and `accountPool?: AccountPool`

### AC-3: `AbstractApiClient` consumes a `responseValidator`

* **Given** `AbstractApiClient` is constructed with an optional `responseValidator` of type `AbstractPlatformResponseValidator`
* **When** `request()` receives a 2xx/3xx response
* **Then** it calls the validator before returning success:
  * if `responseValidator.isRateLimit(response)` is `true` → throw `RateLimitError` (`XACT_4290`, `ROTATE_PROXY`, `retryAfterMs` from `Retry-After` header or exponential base)
  * if `responseValidator.isBotChallenge(response)` is `true` → throw `BotChallengeError` (`XACT_4030`, `ROTATE_PROXY` for no-auth; `HIBERNATE_ACCOUNT` semantics for auth via `accountPool.markUnavailable`)
  * if `responseValidator.isValidPayload(response)` is `false` → throw `PlatformError({ type: INVALID_ARGS, code: 'XACT_4001', suggestedAction: 'USE_ACTIONS_LIST' })` (the payload cannot be normalized; do not retry indefinitely)
* **And** the existing 429/403 status-code path in `request()` is preserved and still triggers quarantine/backoff
* **And** `request()` only returns a 2xx/3xx response when the validator considers it valid and not a challenge/rate-limit

### AC-4: `AbstractApiClient` default `handleError()` remains a safe fallback

* **Given** no `responseValidator` is configured
* **When** `request()` receives a non-2xx/3xx status that is not 429/403
* **Then** `handleError(response, platform)` is invoked and throws the appropriate `PlatformError` (`AuthSessionExpiredError` for 401, `ProxyDeadError` for 5xx, `PlatformError` for other 4xx)
* **And** platform subclasses may still override `handleError()` to add body parsing; the validator contract is the preferred path

### AC-5: `TwitterPlatformResponseValidator` recognizes GraphQL payload shapes

* **Given** `src/scrapers/twitter/validator.js` exporting `TwitterPlatformResponseValidator`
* **When** any of these responses are inspected:
  * `response.data?.user?.result` containing `rest_id` and `legacy` → `isValidPayload` is `true`
  * `response.data?.user?.result?.timeline_v2?.timeline?.instructions` (array) → `isValidPayload` is `true`
  * `response.data?.tweetResult?.result` with `__typename === 'Tweet'` or `TweetTombstone` → `isValidPayload` is `true`
  * `response.data?.threaded_conversation_with_injections_v2?.instructions` (array) → `isValidPayload` is `true`
  * `response.errors` array with any `message` containing `rate limit`, `too many`, `to protect our users from spam` or `code` `88` → `isRateLimit` is `true`
  * `response.errors` array with `code` `32`, `326`, or message containing `cannot find specified user`/`user not found` → NOT a bot challenge (not found/idempotent, handled by parser)
  * `response` is an HTML string containing `cf-browser-verification`, `challenge`, `captcha`, ` Incapsula`, `Access Denied`, or the HTTP status is `403` → `isBotChallenge` is `true`
  * `response` is an HTML string containing `rate limit`, `too many`, or HTTP status is `429` → `isRateLimit` is `true`
* **Then** the validator returns correct booleans and never throws non-`PlatformError` exceptions

### AC-6: `FacebookPlatformResponseValidator` recognizes both HTTP and Puppeteer payloads

* **Given** `src/scrapers/facebook/validator.js` exporting `FacebookPlatformResponseValidator`
* **When** any of these are inspected:
  * HTML body text (string or `response.body`) containing `log in to facebook`, `create new account`, or `facebook` as the only `og:title` and body length < 500 → `isValidPayload` is `false` (login wall), `isBotChallenge` is `true` for auth-required contexts
  * URL contains `/checkpoint/` or body text contains `checkpoint`, `security check`, `confirm your identity`, `captcha`, or `suspicious activity` → `isBotChallenge` is `true`
  * Body text contains `you're temporarily blocked`, `too many`, `rate limit`, or HTTP status is `429` → `isRateLimit` is `true`
  * Parsed `mbasic` post object array, `profile` object with `name` and `postUrl`, or `comments` array → `isValidPayload` is `true`
  * `response.data` GraphQL-like object with `data.nodes` / `data.viewer` / `data.user` → `isValidPayload` is `true`
* **Then** the validator returns correct booleans and never throws non-`PlatformError` exceptions

### AC-7: At least Twitter and Facebook register their validators

* **Given** `src/scrapers/twitter/http/index.js` and `src/scrapers/facebook/index.js`
* **When** they expose platform clients/crawlers
* **Then** `TwitterPlatformResponseValidator` is exported and documented as the default validator for the Twitter HTTP client
* **And** `FacebookPlatformResponseValidator` is exported and documented as the default validator for the Facebook crawler
* **And** a factory or default instance is available (e.g., `new TwitterPlatformResponseValidator()`, `new FacebookPlatformResponseValidator()`) so `AbstractApiClient` subclasses can inject it without platform-specific imports from `src/core/`

### AC-8: No regressions in existing `scrape()` dispatcher

* **Given** `src/scrapers/index.js` `scrape(platform, action, options)`
* **When** new validators and governor checks are added
* **Then** all existing platform function calls (Twitter, Facebook, Bluesky, Mastodon, Threads) continue to work
* **And** the new `AbstractCrawler` governance only affects crawlers that opt in to it; legacy function-style scrapers are not forced to migrate

### AC-9: TypeScript declarations and zero-dependency core

* **Given** `types/core.d.ts` and `types/index.d.ts`
* **When** the declarations are consumed
* **Then** `AbstractApiClient` constructor options include `responseValidator?: AbstractPlatformResponseValidator`
* **And** `AbstractCrawler` constructor options include `governor?: AdaptiveRateGovernor` and `accountPool?: AccountPool`
* **And** `AbstractPlatformResponseValidator` is exported from `types/core.d.ts` (already present; verify it is not removed)
* **And** there are zero `any` annotations and zero `@ts-ignore` comments in the changed `src/core/**` files

### AC-10: Tests pass without mocks

* **Given** implementation and new tests
* **When** running `npx vitest run tests/core/crawler-governor.test.js tests/scrapers/twitter/validator.test.js tests/scrapers/facebook/validator.test.js`
* **Then** all tests pass using real `AdaptiveRateGovernor`, `AccountPool`, and plain JSON/HTML fixtures
* **And** tests cover: governor hibernation block, max-throughput zero pause, `AbstractCrawler` records request, Twitter validator rate-limit/bot-challenge/valid, Facebook validator login wall/checkpoint/valid

---

## Previous Story Intelligence

### 11.1 / 11.2 implementation patterns carried forward

| Pattern | Source | Why it matters for 11.7 |
|---|---|---|
| `ProxyProviderContract` (`getProxy`, `getStickyProxy`, `getNext`, `quarantine`, `isAllQuarantined`) | `types/proxy.d.ts:56-68`, `src/proxy/providers.js` | Two-mode IP strategy is already in place; validators should not change proxy selection. |
| `AccountPool` composite key `platform:accountId` | `src/core/account-pool.js:49-51` | `AbstractCrawler` must use the same key when calling `governor.canAccountRequest` and `recordRequest`. |
| `AdaptiveRateGovernor` API (`canAccountRequest`, `recordRequest`, `recordRateLimit`, `recordBotChallenge`, `getMaxThroughput`, `getStatus`) | `src/core/adaptive-governor.js:109-343` | `start()` needs only these four public methods. |
| `AbstractApiClient.request()` quarantine/backoff pipeline | `src/core/base-client.js:222-387` | Validator integration must happen inside the response-classification step without duplicating retry logic. |
| `AbstractPlatformResponseValidator` abstract contract | `src/core/platform-validator.js:10-43` | Already exists; 11.7 only needs concrete subclasses and wiring. |

### 11.3 / 11.4 / 11.5 / 11.6 code-review findings that directly shape 11.7

1. **Validator must be a constructor-level dependency.** `AbstractApiClient` should receive `responseValidator` in the constructor and call it from `request()`; scraper functions should not reach into `src/core/` to run validation after the fact.
2. **Do not record an action that was never admitted.** `AbstractCrawler.start()` must call `governor.canAccountRequest` and `getMaxThroughput` **before** `recordRequest`.
3. **Avoid double hibernation loops.** If `request()` already hibernates an account via `accountPool.markUnavailable`, `AbstractCrawler.start()` should still check `canAccountRequest` at the top so the next call fails fast rather than spending time on a hibernated account.
4. **No-auth synthetic key is `'noauth'`** — use `governor.recordRequest('noauth', platform)` and `governor.canAccountRequest('noauth', platform)` for no-auth platforms.
5. **The request pipeline success path currently returns immediately on 2xx/3xx.** Validator integration requires restructuring that path so the response is validated before it is returned; `handleError()` remains the fallback for non-2xx/3xx.
6. **Facebook's current bot detection is embedded in page-specific functions.** Consolidate the detection rules in `FacebookPlatformResponseValidator` and have any new Facebook `AbstractApiClient`/crawler use it; do not duplicate rules in `scrapeMbasicPosts`, `loginWithCookie`, etc.

---

## Architecture Compliance

### AD-2 — Unified Base Scraper & Client Interfaces
* **Binds:** `src/core/base-crawler.js`, `src/core/base-client.js`
* **Relevant rules:**
  1. Every new module extends `AbstractCrawler` / `AbstractApiClient`.
  2. `start()` receives a `CrawlerCommand`.
  3. `src/client/` is legacy; new abstractions live in `src/core/**`.

**11.7 compliance:**
- All crawler-governor logic lives in `src/core/base-crawler.js`.
- All validator wiring lives in `src/core/base-client.js`.
- Concrete validators live under `src/scrapers/{platform}/validator.js` and import the abstract contract from `src/core/`.

### AD-3 — Centralized Proxy IP Pool with Auto-Quarantine, Anti-Leak & Proxy Strategy by Auth Mode
* **Binds:** `src/proxy/**`
* **Relevant rule:** Two proxy modes; no direct fallback.

**11.7 compliance:**
- Validators do not change proxy selection; they only signal `rate_limit` or `bot_challenge` so `AbstractApiClient.request()` can quarantine/rotate through the existing pool.
- No-auth `isRateLimit` continues to trigger proxy rotation; auth-required `isBotChallenge` continues to trigger account hibernation.

### AD-8 — Multi-Domain Expansion Blueprint
* **Binds:** `src/scrapers/**`
* **Relevant rules:**
  - `src/scrapers/social/` (requires auth): Twitter, Facebook, Threads, TikTok.
  - `src/scrapers/ecom/` (requires auth): Shopee, TikTok Shop.
  - `src/scrapers/realestate/` (no auth): Chợ Tốt, Batdongsan.com.vn.
  - `src/scrapers/recruitment/` (mixed; LinkedIn auth, others may be no auth): TopCV, VietnamWorks, LinkedIn.

**11.7 compliance:**
- Concrete validators are placed per platform under `src/scrapers/{platform}/validator.js` (or `src/scrapers/twitter/http/validator.js` for the HTTP Twitter client).
- `FacebookPlatformResponseValidator` is used by the auth-required `facebook` domain.
- `TwitterPlatformResponseValidator` is used by the auth-required `twitter` / `x` domain.

### AD-9 — Anti-Bot Payload Validation & Data Sanitization Defense
* **Binds:** `src/scrapers/**`, `src/utils/exporter.js`
* **Relevant rules:**
  1. Every crawler registers a `PlatformResponseValidator` with `isValidPayload`, `isBotChallenge`, `isRateLimit`.
  2. If validator returns challenge/rate-limit:
     - No-auth: throw `RateLimitError` to rotate proxy even when HTTP 200.
     - Auth-required: throw `BotChallengeError`/`RateLimitError`, quarantine proxy, hibernate account, and rotate `AccountPool`.

**11.7 compliance:**
- `AbstractApiClient.request()` is the single place that throws `RateLimitError`/`BotChallengeError` based on validator output.
- The crawler does not need to know proxy/account rotation logic; it only calls `start()` and propagates the resulting `PlatformError`.

### AD-13 — Adaptive Infrastructure-Aware Dynamic Rate Limiting & Account Protection Governor
* **Binds:** `src/core/adaptive-governor.js`, `src/core/account-pool.js`, `src/proxy/proxy-pool.js`, `src/scrapers/**`
* **Relevant rules:**
  1. Governor reads `healthyProxyCount`, `totalProxyCount`, `accountVelocity`, `redisConsumerLag`.
  2. Account token bucket per `safeRequestsPerMinute`.
  3. Hibernation 15–30 min on challenge.
  4. `AccountPool` rotation.
  5. Consumer lag > 10,000 reduces throughput 25%.

**11.7 compliance:**
- `AbstractCrawler.start()` queries `canAccountRequest` and `getMaxThroughput` before each action.
- `AbstractApiClient.request()` already records `recordRequest` per HTTP request.
- `recordRateLimit`/`recordBotChallenge` already exist in `AdaptiveRateGovernor` for `AbstractApiClient` to call via `accountPool.markUnavailable`.

### AD-14 — Operational Status & Error Envelope for Consumers
* **Binds:** `src/mcp/**`, `src/api/**`, `src/cli/**`, `src/core/error-envelope.js`, `src/core/status-api.js`
* **Relevant rule:** Every error returns the standard `{ code, type, message, retryAfter, suggestedAction, accountId?, platform }` envelope.

**11.7 compliance:**
- All validator-triggered errors are `PlatformError` (or `RateLimitError`/`BotChallengeError` subclasses) and produce the same envelope.
- `AbstractCrawler.start()` errors include `accountId` and `platform` when known.

---

## Technical Requirements

### 1. `AbstractCrawler` governor integration

#### 1.1 Constructor changes (`src/core/base-crawler.js`)

```js
/**
 * @param {Object} [deps]
 * @param {import('./base-client.js').AbstractApiClient} [deps.client]
 * @param {import('./base-store.js').AbstractStore} [deps.store]
 * @param {import('./session-manager.js').SessionManager} [deps.sessionManager]
 * @param {import('./adaptive-governor.js').AdaptiveRateGovernor} [deps.governor]
 * @param {import('./account-pool.js').AccountPool} [deps.accountPool]
 */
constructor(deps = {}) {
  if (new.target === AbstractCrawler) {
    throw new TypeError('AbstractCrawler is abstract; extend it.');
  }
  this.client = deps.client;
  this.store = deps.store;
  this.sessionManager = deps.sessionManager;
  this.governor = deps.governor ?? deps.client?.governor ?? null;
  this.accountPool = deps.accountPool ?? deps.client?.accountPool ?? null;
}
```

#### 1.2 `start(command)` guard algorithm

```js
async start(command) {
  if (!command || typeof command.action !== 'string') {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      message: 'CrawlerCommand must have a string action',
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
    });
  }

  const platform = this.name;
  let accountId = command.session?.accountId || command.args?.accountId || null;

  if (this.accountPool && accountId) {
    const resolved = this.accountPool.getAccount(accountId, platform)
      ? accountId
      : this.accountPool.getNextAvailable(platform);
    accountId = resolved;
  }

  if (this.requiresAuth && !accountId) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Platform "${platform}" requires an account but none is available`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform,
    });
  }

  const trackingKey = this.requiresAuth ? accountId : 'noauth';

  if (this.governor) {
    if (this.requiresAuth && !this.governor.canAccountRequest(trackingKey, platform)) {
      throw new PlatformError({
        type: ErrorTypes.HIBERNATION,
        code: 'XACT_4291',
        message: `Account "${trackingKey}" is hibernating or exceeded velocity limit for ${platform}`,
        suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
        accountId: trackingKey,
        platform,
      });
    }

    const throughput = this.governor.getMaxThroughput(platform);
    if (throughput === 0) {
      throw new PlatformError({
        type: ErrorTypes.PROXY_EXHAUSTED,
        code: 'XACT_5030',
        message: `Max throughput is zero for ${platform}; pausing bulk scraping`,
        suggestedAction: SuggestedActions.WAIT,
        retryAfterMs: 30000,
        platform,
      });
    }

    this.governor.recordRequest(trackingKey, platform);
  }

  const entry = this.#registry.get(command.action);
  if (!entry) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      message: `Unknown action "${command.action}" for ${platform}`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform,
    });
  }

  return entry.handler(command.args, command.session);
}
```

Notes:
- `this.requiresAuth` is a new optional property on `AbstractCrawler` (default `true`). Platforms set it in the subclass constructor.
- `trackingKey` for no-auth platforms is the literal string `'noauth'` to match the convention used in `AbstractApiClient.request()`.
- If `governor` is `null`, the crawler runs ungated (backward-compatible for legacy scrapers).

### 2. `AbstractApiClient` `responseValidator` integration

#### 2.1 Constructor changes (`src/core/base-client.js`)

Add to the `options` JSDoc and constructor assignment:

```js
/**
 * @param {Object} [options]
 * ...
 * @param {import('./platform-validator.js').AbstractPlatformResponseValidator} [options.responseValidator]
 */
constructor(options = {}) {
  ...
  this.responseValidator = options.responseValidator || null;
}
```

#### 2.2 Response validation helper

Add a private `#validateResponse(response)` method in `AbstractApiClient`:

```js
/**
 * Classify a 2xx/3xx response using the optional platform validator.
 * Throws PlatformError on rate-limit, bot challenge, or invalid payload.
 * Returns silently for valid payloads.
 *
 * @param {Object} response
 */
#validateResponse(response) {
  if (!this.responseValidator) return;

  if (this.responseValidator.isRateLimit(response)) {
    const retryAfterHeader = response?.headers?.['retry-after'] || response?.headers?.['Retry-After'];
    const retryAfterMs = this.#parseRetryAfter(retryAfterHeader) || this.backoffBaseMs;
    throw new RateLimitError({
      code: 'XACT_4290',
      message: `Platform "${this.platform}" reported rate limit in response body`,
      statusCode: 429,
      suggestedAction: SuggestedActions.ROTATE_PROXY,
      retryAfterMs: Math.min(retryAfterMs, this.maxBackoffMs),
      platform: this.platform,
      details: response,
    });
  }

  if (this.responseValidator.isBotChallenge(response)) {
    throw new BotChallengeError({
      code: 'XACT_4030',
      message: `Platform "${this.platform}" returned a bot challenge in response body`,
      statusCode: 403,
      suggestedAction: this.requiresAuth ? SuggestedActions.HIBERNATE_ACCOUNT : SuggestedActions.ROTATE_PROXY,
      platform: this.platform,
      details: response,
    });
  }

  if (!this.responseValidator.isValidPayload(response)) {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      code: 'XACT_4001',
      message: `Platform "${this.platform}" returned an unparseable payload`,
      suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      platform: this.platform,
      details: response,
    });
  }
}
```

#### 2.3 `request()` integration point

Inside `request()`, after `httpClient` resolves, before the existing success condition block, add:

```js
const status = response?.status ?? 500;

// Allow platform validator to detect WAF / rate-limit even when HTTP status is 2xx.
if (status >= 200 && status < 400) {
  this.#validateResponse(response);
  const trackingKey = this.requiresAuth && currentAccountId ? currentAccountId : 'noauth';
  if (this.accountPool) {
    this.accountPool.recordRequest(trackingKey, this.platform);
  }
  if (this.governor && typeof this.governor.recordRequest === 'function') {
    this.governor.recordRequest(trackingKey, this.platform);
  }
  return response;
}
```

The existing 429/403 status paths are unchanged. The default `handleError()` remains the fallback for non-2xx/3xx statuses.

### 3. Concrete validators

#### 3.1 `src/scrapers/twitter/validator.js` — `TwitterPlatformResponseValidator`

```js
import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class TwitterPlatformResponseValidator extends AbstractPlatformResponseValidator {
  platform = 'twitter';

  isValidPayload(response) {
    if (!response || typeof response !== 'object') return false;

    const data = response.data;
    if (!data) return false;

    const userResult = data.user?.result;
    if (userResult && (userResult.rest_id || userResult.legacy?.screen_name)) return true;

    const timelineInstructions = data.user?.result?.timeline_v2?.timeline?.instructions;
    if (Array.isArray(timelineInstructions)) return true;

    const tweetResult = data.tweetResult?.result;
    if (tweetResult) return true;

    const threadInstructions = data.threaded_conversation_with_injections_v2?.instructions;
    if (Array.isArray(threadInstructions)) return true;

    if (Array.isArray(data.instructions) || Array.isArray(data.entries)) return true;

    return false;
  }

  isBotChallenge(response) {
    if (typeof response === 'string') {
      const text = response.toLowerCase();
      return /cf-browser-verification|challenge|captcha|incapsula|access denied|blocked/.test(text);
    }
    if (response?.status === 403) return true;
    const data = response?.data;
    if (data?.error?.name === 'Forbidden' || data?.error?.code === 326) return true;
    return false;
  }

  isRateLimit(response) {
    if (typeof response === 'string') {
      return /rate limit|too many requests|slow down/.test(response.toLowerCase());
    }
    if (response?.status === 429) return true;

    const errors = response?.data?.errors;
    if (Array.isArray(errors)) {
      const rateLimitCodes = new Set([88, 185, 231]);
      for (const err of errors) {
        const msg = (err.message || '').toLowerCase();
        if (rateLimitCodes.has(err.code)) return true;
        if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('to protect our users from spam')) return true;
      }
    }

    const remaining = parseInt(response?.headers?.get?.('x-rate-limit-remaining') ?? '', 10);
    if (Number.isFinite(remaining) && remaining <= 0) return true;

    return false;
  }
}
```

#### 3.2 `src/scrapers/facebook/validator.js` — `FacebookPlatformResponseValidator`

```js
import { AbstractPlatformResponseValidator } from '../../core/platform-validator.js';

export class FacebookPlatformResponseValidator extends AbstractPlatformResponseValidator {
  platform = 'facebook';

  #getBody(response) {
    if (typeof response === 'string') return response;
    if (typeof response?.body === 'string') return response.body;
    if (typeof response?.data === 'string') return response.data;
    if (response?.data?.body) return response.data.body;
    return '';
  }

  #getUrl(response) {
    return response?.url || response?.data?.url || '';
  }

  #getText(response) {
    return this.#getBody(response).toLowerCase();
  }

  isValidPayload(response) {
    if (Array.isArray(response) || Array.isArray(response?.data)) return true;

    const data = response?.data;
    if (data && (data.posts || data.profile || data.comments || data.nodes || data.viewer || data.user)) return true;

    const body = this.#getBody(response);
    if (!body) return false;

    // mbasic login wall: very short page with only login prompt
    if (body.length < 500 && /log\s*in\s*to\s*facebook|create\s*new\s*account/i.test(body)) return false;

    // A real profile or post page has an article / data-ft / post container
    if (/<article\b|data-ft=|role="main"|id="root"|div class=".*story"/i.test(body)) return true;

    return false;
  }

  isBotChallenge(response) {
    const url = this.#getUrl(response);
    if (/checkpoint|facebook\.com\/checkpoint/i.test(url)) return true;

    const text = this.#getText(response);
    if (
      text.includes('checkpoint') ||
      text.includes('security check') ||
      text.includes('confirm your identity') ||
      text.includes('suspicious activity') ||
      text.includes('captcha') ||
      text.includes('please confirm your identity')
    ) return true;

    if (response?.status === 403) return true;

    return false;
  }

  isRateLimit(response) {
    if (response?.status === 429) return true;

    const text = this.#getText(response);
    if (
      text.includes("you're temporarily blocked") ||
      text.includes('too many') ||
      text.includes('rate limit') ||
      text.includes('unusual activity')
    ) return true;

    return false;
  }
}
```

Notes:
- The Facebook validator must be defensive because `response` may be an `AbstractApiClient` HTTP response object, a Puppeteer `page.content()` string, or an already-normalized array of posts from a function-style scraper.
- The login-wall detection in `isValidPayload` returns `false` for a login wall; `isBotChallenge` is `true` only when a checkpoint or explicit bot-challenge language is present.

### 4. `AbstractApiClient.handleError()` default classification

Keep the existing status-based logic but make sure it uses the new `RateLimitError`, `BotChallengeError`, `AuthSessionExpiredError`, `ProxyDeadError` classes:

```js
handleError(response, platform) {
  const status = response?.status ?? 500;

  if (status === 429) {
    throw new RateLimitError({
      code: 'XACT_4290',
      message: 'Rate limit exceeded on upstream platform',
      statusCode: 429,
      suggestedAction: SuggestedActions.ROTATE_PROXY,
      platform,
      details: response,
    });
  }

  if (status === 403) {
    throw new BotChallengeError({
      code: 'XACT_4030',
      message: 'Bot challenge detected on upstream platform',
      statusCode: 403,
      suggestedAction: SuggestedActions.ROTATE_PROXY,
      platform,
      details: response,
    });
  }

  if (status === 401) {
    throw new AuthSessionExpiredError({
      code: 'XACT_4010',
      message: 'Authentication expired on upstream platform',
      statusCode: 401,
      suggestedAction: SuggestedActions.RELOGIN,
      platform,
      details: response,
    });
  }

  if (status >= 500) {
    throw new ProxyDeadError({
      code: 'XACT_5030',
      message: 'Upstream platform returned server error',
      statusCode: status,
      suggestedAction: SuggestedActions.WAIT,
      platform,
      details: response,
    });
  }

  throw new PlatformError({
    type: ErrorTypes.INTERNAL,
    code: 'XACT_5000',
    message: `Request failed with status ${status}`,
    statusCode: status,
    suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
    platform,
    details: response,
  });
}
```

The current `base-client.js` already contains an `handleError` that throws generic `INTERNAL`; this can be updated to the above classification.

### 5. TypeScript declaration updates

In `types/core.d.ts`:

```ts
export abstract class AbstractCrawler {
  name: string;
  requiresAuth: boolean;
  constructor(deps?: {
    client?: AbstractApiClient;
    store?: AbstractStore;
    sessionManager?: SessionManager;
    governor?: AdaptiveRateGovernor;
    accountPool?: AccountPool;
  });
  ...
}

export abstract class AbstractApiClient {
  ...
  constructor(options?: {
    ...
    responseValidator?: AbstractPlatformResponseValidator;
  });
  ...
}
```

Export `AbstractPlatformResponseValidator` (already present; verify it stays). Ensure `types/index.d.ts` re-exports it if needed.

### 6. Crawler `requiresAuth` discovery

Each concrete crawler sets `requiresAuth` in its constructor:

```js
export class TwitterCrawler extends AbstractCrawler {
  name = 'twitter';
  requiresAuth = true;
  ...
}

export class FacebookCrawler extends AbstractCrawler {
  name = 'facebook';
  requiresAuth = true;
  ...
}
```

For no-auth crawlers (e.g., a future `ChototCrawler`):

```js
export class ChototCrawler extends AbstractCrawler {
  name = 'chotot';
  requiresAuth = false;
  ...
}
```

---

## Library & Framework Requirements

| Package | Version in `package.json` | Role in 11.7 | Notes |
|---|---|---|---|
| `vitest` | `^4.0.18` | Test runner. | Use real fixtures, no mocks. |

No new runtime dependencies. `src/core/**` continues to have zero external runtime dependencies.

---

## File Structure Requirements

| File | Action | Why |
|---|---|---|
| `src/core/base-crawler.js` | **UPDATE** | Add `governor`/`accountPool` deps; governor guard in `start()`; `requiresAuth` property. |
| `src/core/base-client.js` | **UPDATE** | Accept `responseValidator`; add `#validateResponse`; call it on 2xx/3xx before returning. |
| `src/core/index.js` | **UPDATE (minimal)** | Re-export `AbstractPlatformResponseValidator` if not already; ensure `AbstractCrawler`/`AbstractApiClient` are exported. |
| `src/scrapers/twitter/validator.js` | **NEW** | `TwitterPlatformResponseValidator` for GraphQL and HTML payloads. |
| `src/scrapers/facebook/validator.js` | **NEW** | `FacebookPlatformResponseValidator` for HTML and normalized payloads. |
| `types/core.d.ts` | **UPDATE** | Add `requiresAuth`, `governor`, `accountPool` to `AbstractCrawler`; add `responseValidator` to `AbstractApiClient`. |
| `types/index.d.ts` | **NO CHANGE / VERIFY** | Re-export is already in place; verify `AbstractPlatformResponseValidator` is exported. |
| `tests/core/crawler-governor.test.js` | **NEW** | ATDD for `AbstractCrawler.start()` governor integration. |
| `tests/scrapers/twitter/validator.test.js` | **NEW** | Pure unit tests for `TwitterPlatformResponseValidator` with JSON fixtures. |
| `tests/scrapers/facebook/validator.test.js` | **NEW** | Pure unit tests for `FacebookPlatformResponseValidator` with HTML fixtures. |

---

## Testing Requirements

### ATDD approach

1. Create `tests/core/crawler-governor.test.js` alongside implementation.
2. Create `tests/scrapers/twitter/validator.test.js` and `tests/scrapers/facebook/validator.test.js`.
3. All tests use real class instances and plain object/string fixtures.
4. No mocks of `vi.fn()`; `vitest` globals are acceptable for timers.

### `tests/core/crawler-governor.test.js` checklist

- [ ] `AbstractCrawler` accepts `governor` and `accountPool` in constructor.
- [ ] `start()` calls `governor.canAccountRequest(accountId, platform)` and throws `HIBERNATION` (`XACT_4291`) when false.
- [ ] `start()` calls `governor.getMaxThroughput(platform)` and throws `PROXY_EXHAUSTED` (`XACT_5030`) when 0.
- [ ] `start()` calls `governor.recordRequest(accountId, platform)` on admission.
- [ ] `start()` calls `governor.recordRequest('noauth', platform)` for no-auth crawlers.
- [ ] `start()` falls back to `accountPool.getNextAvailable(platform)` when `session`/`args` have no `accountId`.
- [ ] `start()` throws `INVALID_ARGS` for unknown action before governor checks.

### `tests/scrapers/twitter/validator.test.js` checklist

- [ ] Valid `UserByScreenName` payload is `isValidPayload === true`.
- [ ] Valid `UserTweets` timeline payload is `isValidPayload === true`.
- [ ] Valid `TweetDetail` payload is `isValidPayload === true`.
- [ ] `errors` array with code `88` is `isRateLimit === true` and `isValidPayload === false`.
- [ ] HTML `cf-browser-verification` body is `isBotChallenge === true`.
- [ ] HTTP status `429` (with empty body) is `isRateLimit === true`.
- [ ] `errors` with `cannot find specified user` is not a bot challenge.

### `tests/scrapers/facebook/validator.test.js` checklist

- [ ] mbasic real post HTML is `isValidPayload === true`.
- [ ] Short login-wall HTML is `isValidPayload === false`.
- [ ] checkpoint URL is `isBotChallenge === true`.
- [ ] body text with `security check` is `isBotChallenge === true`.
- [ ] `you're temporarily blocked` text is `isRateLimit === true`.
- [ ] Normalized posts array is `isValidPayload === true`.

### Run commands

```bash
npx vitest run tests/core/crawler-governor.test.js
npx vitest run tests/scrapers/twitter/validator.test.js
npx vitest run tests/scrapers/facebook/validator.test.js
npx vitest run tests/core
```

---

## Project Context Reference

### Existing source files (current `HEAD`)

- `src/core/base-crawler.js:1-144` — `AbstractCrawler` with `start()`, `registerAction`, `listActions`.
- `src/core/base-client.js:15-418` — `AbstractApiClient.request()` pipeline, `resolveProxy`, `handleError`.
- `src/core/platform-validator.js:1-43` — `AbstractPlatformResponseValidator` contract.
- `src/core/adaptive-governor.js:1-346` — `AdaptiveRateGovernor` with `canAccountRequest`, `recordRequest`, `getMaxThroughput`.
- `src/core/account-pool.js:1-411` — `AccountPool` with `getNextAvailable`, `markUnavailable`, `recordRequest`.
- `src/core/error-envelope.js:1-146` — `PlatformError`, `RateLimitError`, `BotChallengeError`, `ErrorTypes`, `SuggestedActions`.
- `src/core/types.js:1-137` — `CrawlerCommand`, `PostItem`, `CommentItem` typedefs.
- `src/scrapers/twitter/http/client.js:1-247` — `TwitterHttpClient` request/response handling.
- `src/scrapers/twitter/http/errors.js:1-152` — `TwitterApiError`, `RateLimitError`, `AuthError`, `NotFoundError`, error parsing.
- `src/scrapers/twitter/http/profile.js:122-209` — `parseUserData`, `scrapeProfile` response shapes.
- `src/scrapers/twitter/http/tweets.js:75-302` — `parseTweetData`, `parseTimelineInstructions`, timeline response shapes.
- `src/scrapers/facebook/index.js:365-399` — mbasic login-wall detection.
- `src/scrapers/facebook/index.js:755-783` — security-check / checkpoint detection in `loginWithCookie`.
- `src/scrapers/facebook/index.js:2166-2194` — `assertNoCheckpoint` helper.

### Existing test files (to keep green)

- `tests/core/base-client-request.test.js` — 11.3/11.5/11.6 request pipeline tests.
- `tests/core/adaptive-governor.test.js` — governor tests.
- `tests/core/account-pool.test.js` — account rotation tests.
- `tests/scrapers/facebook-*.test.js` — existing Facebook scraper tests.

### Planning artifacts

- `_bmad-output/planning-artifacts/epics.md:278-289` — Story 11.7 source acceptance criteria.
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md:131-237` — AD-2, AD-3, AD-8, AD-9, AD-13, AD-14.
- `_bmad-output/planning-artifacts/prds/prd.md` — FR-66A/B, NFR-13 (Anti-Leak, Self-Healing).
- `_bmad-output/implementation-artifacts/11-3-429-403-auto-quarantine-exponential-backoff-replay-interceptor.md` — request pipeline contract.
- `_bmad-output/implementation-artifacts/11-4-adaptive-infrastructure-aware-rate-limiter-account-protection-governor.md` — governor contract.
- `_bmad-output/implementation-artifacts/audit-report-sprint-status-2026-08-21.md` — current gap analysis and recommended next actions.

---

## Warnings & Potential Pitfalls

1. **Validator must not mutate the response.** All methods must be pure reads.
2. **Do not use validator to perform I/O.** No Puppeteer `page.evaluate()` inside `isValidPayload`.
3. **The `request()` success return must be delayed until `#validateResponse` passes.** Be careful not to return the response before validation.
4. **Auth-required bot challenge should trigger account hibernation through the existing `accountPool.markUnavailable` path in `AbstractApiClient.request()`, not in the validator.** The validator only returns booleans; the action is the responsibility of the client pipeline.
5. **No-auth rate limit should rotate proxy, not account.** `AbstractApiClient.request()` already does this when it receives a `rate_limit`/`bot_challenge` for a no-auth platform because there is no `accountId` to hibernate.
6. **Twitter and Facebook have legacy clients that do not use `AbstractApiClient` yet.** The validators should be exported as reusable modules. The full migration of `TwitterHttpClient` and `src/scrapers/facebook/index.js` to `AbstractApiClient` subclasses is the job of Epic 13 (Hybrid Engine). For 11.7, deliver the validators and the core wiring.
7. **`AbstractCrawler` may not be the runtime entry point yet.** The `scrape()` dispatcher in `src/scrapers/index.js` still calls function-style scrapers. 11.7 should make `AbstractCrawler.start()` governor-aware, but it does **not** force an immediate refactor of `scrape()`.
8. **Be defensive in `FacebookPlatformResponseValidator`** because the Facebook payload can be an HTML string, a Puppeteer response object, a normalized array, or a `{ data }` GraphQL wrapper.
9. **Keep `src/core/**` dependency-free.** `AbstractApiClient` receives `responseValidator` as an injected class; `src/core` does not import `src/scrapers/**`.

---

## Dev Agent Record

### Implementation Plan
1. Update `src/core/base-crawler.js` with `governor` and `accountPool` dependencies and governor guard inside `start()`.
2. Update `src/core/base-client.js` to accept `responseValidator` and call `#validateResponse` on 2xx/3xx.
3. Update `handleError()` in `src/core/base-client.js` to classify 401/403/429/500+ with the correct `PlatformError` subclasses.
4. Create `src/scrapers/twitter/validator.js` with `TwitterPlatformResponseValidator`.
5. Create `src/scrapers/facebook/validator.js` with `FacebookPlatformResponseValidator`.
6. Update `types/core.d.ts` with `requiresAuth`, `governor`, `accountPool`, `responseValidator`.
7. Update `src/core/index.js` if needed to export `AbstractPlatformResponseValidator`.
8. Create `tests/core/crawler-governor.test.js`, `tests/scrapers/twitter/validator.test.js`, `tests/scrapers/facebook/validator.test.js`.
9. Run all new tests and the full `tests/core` suite to verify no regression.

### Completion Notes List
- Target: zero `any` and zero `@ts-ignore` in changed `src/core/**` and `types/core.d.ts`.
- `AbstractCrawler` governance is additive; legacy scrapers remain ungated if they do not inject a governor.
- Validators are platform-specific and injectable, preserving `src/core` zero-dependency rule.

### File List
- `src/core/base-crawler.js` (MODIFIED)
- `src/core/base-client.js` (MODIFIED)
- `src/core/index.js` (MODIFIED — verify re-exports)
- `src/scrapers/twitter/validator.js` (NEW)
- `src/scrapers/facebook/validator.js` (NEW)
- `types/core.d.ts` (MODIFIED)
- `tests/core/crawler-governor.test.js` (NEW)
- `tests/scrapers/twitter/validator.test.js` (NEW)
- `tests/scrapers/facebook/validator.test.js` (NEW)
- `_bmad-output/implementation-artifacts/11-7-crawler-governor-integration-validator-contract.md` (NEW)

### Change Log
- 2026-08-21: Created Story 11.7 artifact (Crawler-Governor Integration & Platform Response Validator Contract) based on audit gap analysis and current `HEAD` source.

---

## Story Completion Status

- **Status:** review
- **Context engine analysis completed:** Epics, architecture spine, PRD, previous story artifacts, and current source code analyzed.
- **Architecture compliance verified:** AD-2, AD-3, AD-8, AD-9, AD-13, AD-14 mapped.
- **Testing:** 22/22 tests passing (100% green), 314/314 regression tests passing.
- **Next phase:** Code review via `/bmad-code-review`.
