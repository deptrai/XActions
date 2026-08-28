---
story_id: "13.4"
epic: 13
story_key: "13-4-facebook-browser-as-signer-bridge"
status: "ready-for-dev"
phase: "Phase 4"
created: "2026-08-26"
updated: "2026-08-26"
owner: "DEV"
reviewed: "Pending"
baseline_commit: "e710906"
---

# Story 13.4: Facebook Browser-as-Signer Integration

<!-- Validation: manual review patches applied; `npm run typecheck` and `npx vitest run` pass. -->

## Story

As a **Facebook Scraper Operator**,  
I want **`FacebookClient` to extract `lsd`, `fb_dtsg`, `jazoest`, and `spin` tokens from a real Chrome browser instead of only HTML regex**,  
so that **token extraction is resilient to Facebook DOM/script changes, supports authenticated user profiles, and falls back to the existing HTTP path when no browser signer is configured.**

## Sources

- `_bmad-output/planning-artifacts/epics.md` — Epic 13, Story 13.3 context and dependencies
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1 (Tiered Hybrid Signer), AD-3 (Sticky IP / Proxy Anti-Leak), AD-5 (CDP Attach), AD-8 (Multi-Domain Expansion), AD-14 (Error Envelope)
- `_bmad-output/implementation-artifacts/13-1-tiered-signer-architecture-token-ring-worker-pool.md` — `PreSignedTokenRing`, `SignerWorkerPagePool`, `requestWithSign`
- `_bmad-output/implementation-artifacts/13-3-refactor-facebook-scraper-to-hybrid-architecture.md` — `FacebookClient`, `FacebookCrawler`, token cache
- `/Users/luisphan/Documents/GitHub/MediaCrawler/requirements.txt` and `base/base_crawler.py`, `tools/cdp_browser.py`, `media_platform/xhs/core.py`, `media_platform/douyin/help.py` — MediaCrawler browser engine analysis
- `src/scrapers/social/facebook/client.js`, `src/scrapers/social/facebook/crawler.js`, `src/scrapers/social/facebook/validator.js`
- `src/core/base-client.js`, `src/core/signer-pool.js`, `src/core/cdp-launcher.js`, `src/core/base-crawler.js`
- `src/scrapers/adapters/index.js`, `src/scrapers/adapters/playwright.js`, `src/scrapers/adapters/puppeteer.js`
- `src/proxy/proxy-pool.js`, `src/proxy/providers.js`

## Cross-Epic Dependencies

- **Depends on** `13.1` (`PreSignedTokenRing`, `SignerWorkerPagePool`, `requestWithSign` are already implemented and exported from `src/core/signer-pool.js` and `src/core/base-client.js`).
- **Depends on** `12.2` (`launchBrowserWithCdp`, `launchChrome`, `getDefaultUserDataDir`, adapter `connect()` contracts in `src/core/cdp-launcher.js`).
- **Builds on** `13.3` (`FacebookClient.ensureTokens`, `requestGraphQl`, `FacebookCrawler` action registry and normalization in `src/scrapers/social/facebook/`).
- **Unblocks** Epic 15.2 (TikTok `a_bogus` / `msToken` signer bridge patterns) and Epic 18.3 (LinkedIn CDP attach).

---

## Acceptance Criteria

### AC-1: `FacebookClient` accepts browser bridge and tiered signer dependencies

- **Given** `FacebookClient` in `src/scrapers/social/facebook/client.js` [Source: `src/scrapers/social/facebook/client.js:45-104`]
- **When** the constructor is called with `tokenRing`, `signerPool`, `browserBridge`, `cdpUrl`, `launchChrome`, `adapterName`, `headless`, `userDataDir`, or `profileDir`
- **Then** it passes `tokenRing` and `signerPool` through to `AbstractApiClient` (`src/core/base-client.js:125-126`) and keeps `client = 'got'` and `requiresAuth = true` unchanged (`client.js:53-56`)
- **And** it stores `browserBridge`, `cdpUrl`, `launchChrome`, `adapterName`, `headless`, `userDataDir`, and `profileDir` as instance state
- **And** it exposes a `close()` method that closes any browser bridge the client created (not one passed from a caller) and clears the token cache

### AC-2: Browser token extraction via `FacebookBrowserBridge`

- **Given** `FacebookClient` is configured with `cdpUrl`, `launchChrome: true`, or a `browserBridge`
- **When** `ensureTokens(accountId, cookies)` is called
- **Then** it obtains a `FacebookBrowserBridge` (creating one from `cdpUrl`/`launchChrome` settings if none was passed) that uses `PlaywrightAdapter` by default and `PuppeteerAdapter` when `XACTIONS_SCRAPER_ADAPTER=puppeteer`
- **And** the bridge parses the `cookies` value into `{name, value, domain, path}` records using the hostname of `this.baseUrl` as the domain, calls `adapter.setCookies(page, cookies)` (or `context.addCookies`) before navigation, and never logs raw `c_user`/`xs` values
- **And** the bridge navigates to `this.baseUrl` with `waitUntil: 'networkidle'` and a `page.goto` timeout of 30 s (8 s for cold-start warmup)
- **And** it extracts the following tokens from the live page context via `adapter.evaluate(page, extractFacebookTokens)` with a 3 s `Promise.race` timeout (8 s on first call) and one retry on page death/crash:
  - `lsd` (from `input[name="lsd"]`, `requireLazy(["LSD"]...`, `LSD.token`, or the `LSD` JSON payload in `innerHTML`)
  - `jazoest` (from `input[name="jazoest"]` or the default value `2953`)
  - `fb_dtsg` / `dtsg` (from `DTSGInitialData`, `d.token = "..."`, or the `DTSGInitialData` JSON payload)
  - `spin_r` (from `__spin_r` or `window.__spin_r`)
  - `spin_t` (from `__spin_t` or `window.__spin_t`, default `Math.floor(Date.now()/1000)`)
  - `hsi` (from `__hsi` or `window.__hsi`)
  - `__rev` (from `__rev` or `window.__rev`)
  - `c_user` (from `document.cookie` or the passed cookie header)
- **And** it caches tokens with the same compound key (`accountId:cookieHash`) and 5-minute TTL used today (`client.js:64-71`, `client.js:223-226`)

### AC-3: `requestGraphQl()` uses tokens from the browser bridge

- **Given** a call to `FacebookClient.requestGraphQl(docId, variables, options)`
- **When** it calls `await this.ensureTokens(accountId, rawCookies)`
- **Then** it receives tokens produced by the browser path when a browser bridge is configured
- **And** `buildGraphQlBody()` continues to produce an `application/x-www-form-urlencoded` body with `lsd`, `fb_dtsg`, `jazoest`, `__spin_r`, `__spin_t`, `__hsi`, `__rev`, and `__user` from those tokens (`client.js:238-274`)

### AC-4: CDP attach / launch mode

- **Given** `cdpUrl` (e.g. `http://127.0.0.1:9222`) or `launchChrome: true`
- **When** the browser path initializes
- **Then** it reuses an existing Chrome via CDP when one is available
- **And** it can launch a new headful/headless Chrome with `--remote-debugging-port` and `--user-data-dir=<profile>` when none is available (`src/core/cdp-launcher.js:256-354`)
- **And** it connects through the adapter's `connect()` method:
  - `PlaywrightAdapter.connect(cdpUrl, { preserveProfile: true })` — `connectOverCDP` (`src/scrapers/adapters/playwright.js:316-330`)
  - `PuppeteerAdapter.connect(cdpUrl, { preserveProfile: true })` — `browserWSEndpoint` (`src/scrapers/adapters/puppeteer.js:243-275`)

### AC-5: Playwright is the default browser engine for CDP attach

- **Given** the environment variable `XACTIONS_SCRAPER_ADAPTER` is unset or `playwright`
- **When** `FacebookClient` (or `FacebookBrowserBridge`) needs a browser
- **Then** it calls `getAdapter(process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright')` and uses `PlaywrightAdapter`
- **And** if `XACTIONS_SCRAPER_ADAPTER=puppeteer`, it uses `PuppeteerAdapter`
- **And** it does **not** rely on the global default returned by `getAdapter()` without arguments, because `src/scrapers/adapters/index.js:42` sets `defaultAdapterName = process.env.XACTIONS_SCRAPER_ADAPTER || 'puppeteer'` for backward compatibility
- **And** the story file documents the decision: **Playwright is the default for CDP attach** because:
  1. `MediaCrawler` uses Playwright (`requirements.txt` line 3; `base/base_crawler.py` imports `playwright.async_api`)
  2. XActions architecture explicitly wires CDP attach for real Chrome profiles (AD-5)
  3. Playwright's `connectOverCDP` is purpose-built for attaching to existing Chromium/CDP instances and preserves the default browser context, which is exactly what we need for `.data/facebook-profiles/<c_user>` (`src/scrapers/adapters/playwright.js:316-330`)
  4. Puppeteer with `puppeteer-extra-plugin-stealth` remains better for launching a *fresh* hidden browser (legacy `src/scrapers/facebook/`), not for attaching to a logged-in Chrome profile (`src/scrapers/adapters/puppeteer.js:243-275`)

### AC-6: Per-account profile and sticky-proxy isolation

- **Given** an authenticated account with `c_user` and `xs`
- **When** Chrome is launched for token extraction
- **Then** the user data directory is deterministic per `c_user`: `.data/facebook-profiles/<c_user>` (reuse pattern from `api/services/facebookAccountPool.js:40-48`)
- **And** the browser is launched with the sticky proxy for that account (`ProxyIpPool.getStickyProxy(accountId)` or `proxyProvider.getProxy({ accountId })`)
- **And** the launch args include anti-leak flags from `ProxyIpPool.getBrowserArgs()` / `getBrowserArgs()`:
  - `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `--proxy-server=<server>`
  - `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE <host>`
  - `--disable-features=WebRtcHideLocalIpsWithMdns`
  [Source: `src/proxy/proxy-pool.js:310`, `src/proxy/providers.js:1163-1168`]
- **And** two different accounts never share the same browser context

### AC-7: HTTP extraction fallback

- **Given** `FacebookClient` without a configured `browserBridge`, `cdpUrl`, or `launchChrome`
- **When** `ensureTokens()` is called
- **Then** it falls back to the existing HTTP-only `#fetchTokens()` that parses home-page HTML with regex (`client.js:143-229`)
- **And** if the browser path throws `XACT_5030`/`XACT_5000` and `httpFallback: true` (default `true`), it retries once with HTTP extraction
- **And** no real credentials are logged in either path

### AC-8: Token refresh before expiry

- **Given** tokens cached with `expiresAt`
- **When** `ensureTokens()` is called
- **Then** it returns cached tokens if `expiresAt > Date.now() + 30_000` (30 s refresh window)
- **And** it refreshes via the browser bridge or HTTP fallback when within 30 s of expiry or cache miss
- **And** concurrent calls for the same `accountId:cookieHash` are still de-duplicated (`client.js:124-135`)

### AC-9: `PreSignedTokenRing` integration

- **Given** a `tokenRing` is supplied to `FacebookClient`
- **When** browser token extraction succeeds
- **Then** `this.tokenRing.refill([tokens.lsd])` is called with the extracted `lsd` as a string (never the full token object) so `tokenRing.next()` can return it in O(1) (`src/core/signer-pool.js:43-52`)
- **And** `buildGraphQlBody()` uses `this.tokenRing.next()` for the `lsd` field when the ring is non-empty, otherwise it uses the cached `tokens.lsd` directly
- **And** `requestGraphQl` still works even when `tokenRing` is not configured
- **And** `requestGraphQl` continues to call `this.request()` directly (not `requestWithSign()`) because `AbstractApiClient.requestWithSign()` does not merge `signResult.body` into the form-urlencoded GraphQL body (`src/core/base-client.js:361-471`)

### AC-10: Preserve `FacebookCrawler` actions and normalization

- **Given** `FacebookCrawler` in `src/scrapers/social/facebook/crawler.js`
- **When** it runs `group_posts`, `page_posts`, or `get_comments`
- **Then** it continues to use `client.requestGraphQl()` and the existing `#normalizePostItem()` / `#normalizeComment()` functions unchanged (`crawler.js:139-202`, `crawler.js:254-323`)
- **And** `FacebookCrawler.cleanup()` calls `client.close()` if it owns the client (i.e., no `client` was passed in), which in turn closes the lazily-created `FacebookBrowserBridge` and clears the token cache (`crawler.js:829-832`)

### AC-11: `cdp-launcher.js` proxy support

- **Given** `src/core/cdp-launcher.js`
- **When** `launchChrome()` and `buildChromeArgs()` are invoked for the Facebook browser bridge
- **Then** they accept a `proxy` option (a normalized proxy record or string) and an `extraArgs` array and append anti-leak args by calling `ProxyIpPool.getBrowserArgs(proxy)` or the provider's `getBrowserArgs(proxy)` from `src/proxy/providers.js:1163-1168`
- **And** they accept a `userDataDir` option that overrides the default `~/.xactions/chrome-profile`
- **And** `launchBrowserWithCdp()` passes the selected `adapter` and `preserveProfile: true` (`cdp-launcher.js:365-392`)

### AC-12: Tests

- **Given** `vitest` and the no-mock policy (`AGENTS.md`, `CLAUDE.md`)
- **When** `npm test` runs
- **Then** `tests/scrapers/social/facebook/client.test.js` is updated to cover:
  - `ensureTokens` still falls back to HTTP extraction when no `browserBridge`, `cdpUrl`, or `launchChrome` is configured
  - `tokenRing` refill after token extraction
  - token refresh before expiry (short TTL + second call)
- **And** a new `tests/scrapers/social/facebook/client-signer.test.js` covers:
  - Browser signer bridge token extraction using a real `PlaywrightAdapter` and a local HTTP server that serves Facebook-like HTML
  - CDP attach mode: `launchChrome({ headless: true })` + `launchBrowserWithCdp(...)` + `page.evaluate()`
  - Fallback to HTTP extraction when browser path is disabled
  - Error envelope (`XACT_5030` / `suggestedAction: 'relogin'`) when CDP is unreachable
- **And** `npm run typecheck` passes

### AC-13: Deprecation documentation

- **Given** `docs/deprecation-plan.md`
- **When** the browser-as-signer bridge is implemented
- **Then** the status tracker is updated to mark the HTTP-only token extraction path (`FacebookClient.#fetchTokens`) as `deprecated-planned`
- **And** it notes the fallback remains available until Epic 20 parity is confirmed

---

## Tasks / Subtasks

- [x] T1: Extend `FacebookClient` constructor for browser bridge and tiered signer configuration (AC-1)
  - [x] T1.1: Add `tokenRing`, `signerPool`, `browserBridge`, `cdpUrl`, `launchChrome`, `adapterName`, `headless`, `userDataDir`, `profileDir`, `httpFallback` to constructor JSDoc and instance state
  - [x] T1.2: Pass `tokenRing` / `signerPool` through to `AbstractApiClient` super
  - [x] T1.3: Add `close()` method that clears `#tokenCache` and closes an owned `FacebookBrowserBridge`
- [x] T2: Implement browser token extraction in `FacebookClient` / `FacebookBrowserBridge` (AC-2)
  - [x] T2.1: Create `src/scrapers/social/facebook/signer-bridge.js` (`FacebookBrowserBridge`) that lazily connects/launches, sets cookies, navigates, evaluates, and closes
  - [x] T2.2: Add `FacebookClient.#ensureTokensFromBrowser(accountId, cookieHeader)` that calls `this.browserBridge.extractTokens(accountId, cookieHeader)`
  - [x] T2.3: Define `extractFacebookTokens` `page.evaluate()` script with LSD / `DTSGInitialData` / `__spin_*` / `__hsi` / `__rev` / `c_user` fallbacks
  - [x] T2.4: Cache the extracted tokens using the existing `#tokenCache` with 5-minute TTL
  - [x] T2.5: Wrap `page.goto` and `page.evaluate()` in `Promise.race` with 3 s evaluate timeout (8 s on first call) and one retry on page death/crash
- [x] T3: Wire `ensureTokens()` to choose browser or HTTP path (AC-7, AC-8)
  - [x] T3.1: Refactor `ensureTokens()` to prefer the browser path when `this.browserBridge`, `this.cdpUrl`, or `this.launchChrome` is configured
  - [x] T3.2: Keep existing HTTP fallback via `#fetchTokens()` when no browser bridge is configured or when `httpFallback: true`
  - [x] T3.3: Implement 30 s pre-expiry refresh window
  - [x] T3.4: Preserve in-flight de-duplication (`#pendingTokenFetches`)
- [x] T4: Integrate `PreSignedTokenRing` (AC-9)
  - [x] T4.1: Refill `tokenRing` with the `lsd` **string** after successful browser extraction
  - [x] T4.2: Update `buildGraphQlBody` to use `this.tokenRing.next()` for `lsd` when the ring is non-empty, otherwise fall back to the cached token object
- [x] T5: CDP attach / launch support (AC-4, AC-5)
  - [x] T5.1: In `FacebookBrowserBridge`, call `getAdapter(process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright')`; do **not** call `getAdapter()` without arguments
  - [x] T5.2: Support `cdpUrl` attach via `launchBrowserWithCdp`
  - [x] T5.3: Support auto-launch via `launchChrome({ userDataDir, headless, proxy, extraArgs })`
- [x] T6: Per-account profile and proxy isolation (AC-6)
  - [x] T6.1: Build deterministic user data dir from `c_user` via `buildUserDataDir` pattern (`api/services/facebookAccountPool.js:40-48`)
  - [x] T6.2: Resolve sticky proxy via `this.proxyPool.getStickyProxy(accountId)` or `this.proxyProvider.getProxy({ accountId })`
  - [x] T6.3: Merge anti-leak browser args from `getBrowserArgs(proxy)` / `ProxyIpPool.getBrowserArgs(proxy)`
- [x] T7: Update `cdp-launcher.js` (AC-11)
  - [x] T7.1: Add `proxy` (normalized proxy) and `extraArgs` options to `buildChromeArgs()` and `launchChrome()`
  - [x] T7.2: Accept `userDataDir` override in `buildChromeArgs()`
  - [x] T7.3: Ensure `launchBrowserWithCdp` preserves profile context
- [x] T8: Update `FacebookCrawler` cleanup (AC-10)
  - [x] T8.1: Accept `cdpUrl` in constructor and pass to `AbstractCrawler`
  - [x] T8.2: Call `client.close()` inside `cleanup()` when `FacebookCrawler` created the client
- [x] T9: Add/update tests (AC-12)
  - [x] T9.1: Update `tests/scrapers/social/facebook/client.test.js`
  - [x] T9.2: Create `tests/scrapers/social/facebook/client-signer.test.js`
  - [x] T9.3: Ensure `npm test -- tests/scrapers/social/facebook/` and `npm run typecheck` pass
- [x] T10: Update `docs/deprecation-plan.md` (AC-13)
  - [x] T10.1: Verify the status tracker already marks `FacebookClient.#fetchTokens` as `deprecated-planned`; add/update note if needed
  - [x] T10.2: Note that HTTP fallback remains available until Epic 20.2

---

## Dev Notes

### Project Structure Notes

- **Target folder:** `src/scrapers/social/facebook/` (the new hybrid Facebook scraper). Do not modify legacy `src/scrapers/facebook/` files.
- **Legacy dispatcher:** `src/scrapers/index.js` remains untouched to preserve backward compatibility.
- **Core contracts:** `src/core/base-client.js`, `src/core/signer-pool.js`, `src/core/base-crawler.js`, and `src/core/cdp-launcher.js` should be *extended*, not rewritten.
- **No `any` / `@ts-ignore`:** Every new public property must be JSDoc-typed. Use `/** @type {...} */` casts for adapter objects, not `any`.
- **No real credentials in logs or files:** Token values must never appear in error messages, test names, or console output.

### Browser Engine Decision — Playwright vs Puppeteer

**Decision: Use Playwright as the default adapter for the Facebook CDP signer bridge. Both Playwright and Puppeteer remain selectable via `XACTIONS_SCRAPER_ADAPTER`.**

| Criterion | Playwright | Puppeteer (`puppeteer-extra` + stealth) | Winner |
|---|---|---|---|
| MediaCrawler reference pattern | `requirements.txt:3` uses `playwright>=1.61.0`; `base/base_crawler.py:23` imports `playwright.async_api` | not in `requirements.txt`; no first-class CDP helper | **Playwright** |
| CDP attach to existing Chrome | `connectOverCDP(cdpUrl)` is native (`src/scrapers/adapters/playwright.js:322`) | must fetch `/json/version` and use `browserWSEndpoint` (`src/scrapers/adapters/puppeteer.js:260-267`) | **Playwright** |
| Preserving default browser context | `connectOverCDP` keeps the existing profile context; `_preserveProfile: true` reuses it | connect can reuse default context but with extra indirection | **Playwright** |
| Profile-per-account (`.data/facebook-profiles/<c_user>`) | natural with `launchChrome` + `connectOverCDP` | possible but more manual | **Playwright** |
| Launching a fresh hidden/stealth browser | supported but stealth is not the primary goal here | `puppeteer-extra-plugin-stealth` is stronger for anti-detection on a fresh launch | **Puppeteer** (for future fresh-browser stories) |
| Multi-browser support | Chromium, Firefox, WebKit | Chromium only | **Playwright** |

Therefore:
- `FacebookClient` calls `getAdapter(process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright')`.
- `XACTIONS_SCRAPER_ADAPTER=puppeteer` is honored for operators who need stealth on a fresh launch.
- CDP attach mode defaults to Playwright because it aligns with MediaCrawler and the XActions architecture (AD-5: attach to real Chrome on port 9222).

### Architecture Compliance

| AD | Rule | Implementation |
|---|---|---|
| AD-1 | Tiered Hybrid Signer | `FacebookBrowserBridge` performs live `page.evaluate()` token extraction; `FacebookClient` refills `tokenRing` with `lsd` for fast allocation in `buildGraphQlBody`. |
| AD-3 | Sticky IP per account + anti-leak | Chrome launched with `ProxyIpPool.getStickyProxy(accountId)` and `getBrowserArgs(proxy)` flags. No direct connection. |
| AD-5 | CDP attach to real Chrome | `cdp-launcher.js` + `PlaywrightAdapter.connectOverCDP` / `PuppeteerAdapter.connect` with `preserveProfile: true`. |
| AD-8 | Multi-Domain Expansion | All changes stay in `src/scrapers/social/facebook/` and `src/core/cdp-launcher.js`. |
| AD-9 | Anti-bot payload validation | `FacebookPlatformResponseValidator` unchanged; token extraction failures throw `PlatformError` with `suggestedAction`. |
| AD-14 | Error envelope | Browser/CDP errors become `PlatformError` with `code`, `type`, `suggestedAction` (`relogin` / `retry_after_delay`). |

### Token Extraction Script Specification

The `page.evaluate()` function should return the following shape and be safe to run on both real Facebook and the local test server:

```js
() => {
  const result = {};
  const html = document.documentElement ? document.documentElement.innerHTML : '';

  // lsd — try the form input, the LSD requireLazy module, LSD.token, and the raw JSON payload
  const lsdInput = document.querySelector('input[name="lsd"]');
  let lsd = lsdInput?.value || '';
  if (!lsd) {
    const lsdMatch =
      html.match(/\["LSD",\[\],\{"token":"([^"]+)"/) ||
      html.match(/"LSD",\[\],\{"token":"([^"]+)"/) ||
      html.match(/LSD\.token\s*=\s*"([^"]+)"/) ||
      html.match(/"token":"([^"]+)","type":"LSD"/) ||
      html.match(/name="lsd" value="([^"]+)"/);
    lsd = lsdMatch ? lsdMatch[1] : '';
  }
  result.lsd = lsd;

  // jazoest
  const jazoestInput = document.querySelector('input[name="jazoest"]');
  result.jazoest = jazoestInput?.value || '2953';

  // fb_dtsg from DTSGInitialData in scripts
  const dtsgMatch =
    html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
    html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
    html.match(/d\.token\s*=\s*"([^"]+)"/) ||
    html.match(/"DTSGInitialData".*?"token":"([^"]+)"/s);
  result.dtsg = dtsgMatch ? dtsgMatch[1] : '';

  // spin
  const spinRMatch =
    html.match(/"__spin_r":(\d+)/) ||
    html.match(/"__spin_r":"(\d+)"/) ||
    html.match(/window\.__spin_r\s*=\s*(\d+)/);
  result.spin_r = spinRMatch ? Number(spinRMatch[1]) : 1016839210;
  const spinTMatch =
    html.match(/"__spin_t":(\d+)/) ||
    html.match(/"__spin_t":"(\d+)"/) ||
    html.match(/window\.__spin_t\s*=\s*(\d+)/);
  result.spin_t = spinTMatch ? Number(spinTMatch[1]) : Math.floor(Date.now() / 1000);

  // hsi
  const hsiMatch =
    html.match(/"__hsi":"([^"]+)"/) ||
    html.match(/window\.__hsi\s*=\s*"([^"]+)"/);
  result.hsi = hsiMatch ? hsiMatch[1] : '';

  // rev
  const revMatch =
    html.match(/"__rev":"([^"]+)"/) ||
    html.match(/window\.__rev\s*=\s*"([^"]+)"/);
  result.__rev = revMatch ? revMatch[1] : '';

  // c_user from cookie
  const cUserMatch = document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/);
  result.c_user = cUserMatch ? decodeURIComponent(cUserMatch[1]) : '';

  return result;
}
```

This mirrors and extends the existing HTTP regexes (`client.js:164-184`) but runs in a real browser DOM, so it survives script obfuscation and `innerHTML` differences. The bridge must still set cookies before navigation when the caller provides a `c_user`/`xs` cookie string.

### `FacebookBrowserBridge` Responsibilities

- Constructor options: `{ cdpUrl, launchChrome, adapterName, headless, userDataDir, profileDir, baseUrl, proxy, proxyProvider, proxyPool, accountId, cookies }`. `profileDir` is treated as an alias for `userDataDir`; if both are provided, `userDataDir` wins.
- `async init()` — lazily select adapter via `getAdapter(...)`, connect to `cdpUrl` or call `launchChrome(...)`, and create one page with `preserveProfile: true`.
- `async setCookies(cookies)` — parse a cookie string or record into `{name, value, domain, path}` and call `adapter.setCookies(page, ...)` (or `context.addCookies`) using `new URL(this.baseUrl).hostname` as domain.
- `async extractTokens()` — `goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 })`, then `adapter.evaluate(page, extractFacebookTokens)` with a `Promise.race` timeout; retry once on page death/crash.
- `async close()` — close the page, browser context (if created by the bridge), and browser; do **not** delete the user data directory.
- Error handling — CDP/launch failures and dead pages throw `PlatformError` with `XACT_5030`/`XACT_5000` and `suggestedAction` (`relogin` / `retry_after_delay`).

### Core Code State to Preserve

- `AbstractApiClient.requestWithSign()` does **not** merge `signResult.body` into `mergedOptions.body` (`base-client.js:361-471`). Therefore `FacebookClient.requestGraphQl` must continue to build the form-urlencoded body string itself and pass it as `options.body`.
- `AbstractApiClient.#normalizeRequestBody()` only stringifies body when `content-type` contains `json` (`base-client.js:750-761`). For form-urlencoded, keep passing a string.
- `AbstractApiClient.request()` has a ternary that allows a direct connection when no `provider` and `!opts.requiresResidential` (`base-client.js:536-538`). `FacebookClient.requiresAuth = true` and Facebook is an auth-required platform, so always provide `proxyPool` / `proxyProvider`.
- `FacebookCrawler` cleanup only clears the token cache today (`crawler.js:829-832`). Extend it to call `client.close()` when `FacebookCrawler` created the client, which closes the owned `FacebookBrowserBridge`.

### Previous Story Intelligence

#### Story 13.1 — Tiered Signer Architecture

- `PreSignedTokenRing` holds string tokens and `next()` is O(1). Refill it with the extracted `lsd` string only.
- `SignerWorkerPagePool` spawns 4–8 pages, routes by least-connections, wraps `page.evaluate()` in `Promise.race` with 3 s / 8 s warmup timeout, and retries once on dead pages. It does **not** support `goto` or per-call cookie injection, so the Facebook browser bridge must manage its own browser/page and cannot delegate extraction to `SignerWorkerPagePool`.
- `AbstractApiClient` exposes `tokenRing` and `signerPool`; `requestWithSign` dispatches to ring/pool/subclass `sign()`. `FacebookClient.requestGraphQl` should continue using `this.request()` directly, not `requestWithSign`, because `requestWithSign` does not merge body.

#### Story 13.3 — Facebook Hybrid Scraper

- `FacebookClient` uses `client = 'got'`, `requiresAuth = true`.
- `ensureTokens()` extracts tokens from a `GET /` HTML response using regex and caches with a 5-minute TTL.
- `requestGraphQl()` builds the GraphQL body manually and uses `this.request()`.
- `FacebookCrawler` registers `group_posts`, `page_posts`, `get_comments` and normalizes to `PostItem` / `CommentItem`.
- `FacebookCrawler.cleanup()` currently only calls `client.clearTokenCache()`.

#### Story 12.2 — CDP Attach

- `launchChrome()` launches Chrome with `--remote-debugging-port` and returns `{ cdpUrl, kill }`.
- `launchBrowserWithCdp()` fetches the adapter and calls `adapter.connect(cdpUrl, { preserveProfile: true })`.
- `PlaywrightAdapter.connect` uses `connectOverCDP`.
- `PuppeteerAdapter.connect` uses `browserWSEndpoint`.

### Library & Framework Requirements

| Package | Version | Purpose |
|---|---|---|
| `playwright` | `^1.62.1` (`package.json:129`) | Default browser engine for CDP attach and signer worker pages. |
| `puppeteer` | `^24.34.0` (`package.json:132`) | Optional adapter when `XACTIONS_SCRAPER_ADAPTER=puppeteer`. |
| `puppeteer-extra` + `puppeteer-extra-plugin-stealth` | existing | Only used if Puppeteer is selected; not imported by the Playwright path. |
| `got-scraping` | `^3.2.15` (`package.json:119`) | Default HTTP client for `FacebookClient.request()` and fallback extraction. |
| `undici` | `^7.29.0` (`package.json:141`) | Alternative HTTP client. |
| `p-limit` | `^7.2.0` (`package.json:128`) | Concurrency limits inside `SignerWorkerPagePool` (already in place). |
| `vitest` | `^4.0.18` (`package.json:161`) | Test runner. |
| `typescript` | `^5.9.3` (`package.json:160`) | `npm run typecheck`. |

### File Structure Requirements

#### UPDATE

| File | Description |
|---|---|
| `src/scrapers/social/facebook/client.js` | Extend constructor to accept `browserBridge`/`cdpUrl`/`launchChrome`/tiered signer deps; add `#ensureTokensFromBrowser`; refill `tokenRing` with `lsd`; add `close()`. |
| `src/scrapers/social/facebook/signer-bridge.js` | **Create** `FacebookBrowserBridge`: adapter selection, CDP attach/launch, cookie parsing/injection, `goto`, `extractTokens`, `close`. |
| `src/scrapers/social/facebook/crawler.js` | Accept `cdpUrl`, pass to `AbstractCrawler`, update `cleanup()` to close owned browser bridge. |
| `src/core/cdp-launcher.js` | Add `proxy` (normalized proxy) and `extraArgs` options to `buildChromeArgs()` and `launchChrome()`. |
| `tests/scrapers/social/facebook/client.test.js` | Add HTTP fallback, token ring refill, and refresh tests. |
| `tests/scrapers/social/facebook/client-signer.test.js` | **Create** browser/CDP signer bridge tests. |
| `docs/deprecation-plan.md` | Verify HTTP-only token extraction is already marked `deprecated-planned`; add note if missing. |
| `types/core.d.ts` or `types/index.d.ts` | Add `FacebookBrowserBridge` constructor options and `FacebookClient` browser-bridge options if not covered by `AbstractApiClient`. |


#### NO TOUCH

| File | Reason |
|---|---|
| `src/core/base-client.js` | Already implements `tokenRing`, `signerPool`, `requestWithSign`, and the request pipeline. Only consume the API. |
| `src/core/signer-pool.js` | Already implements `PreSignedTokenRing` and `SignerWorkerPagePool`. Reuse as-is. |
| `src/core/base-crawler.js` | Already supports `cdpUrl` and `launchBrowserWithCdp`. Just pass `cdpUrl` through. |
| `src/scrapers/facebook/*` | Legacy Puppeteer scraper; decommissioned in Epic 20. |
| `src/scrapers/index.js` | Legacy dispatcher; keep untouched. |

### Testing Requirements

- **No mocks / no `vi.fn` / no fake HTTP clients.** Use real `http.createServer`, real `PlaywrightAdapter`, and real `launchChrome` for browser tests.
- **Local server:** serve Facebook-like HTML with hidden `lsd`, `jazoest`, `DTSGInitialData`, `__spin_r`, `__spin_t`, `__hsi` values and a `/api/graphql/` endpoint.
- **Browser test environment:** `npx playwright install chromium` (and `install-deps` if needed) must be available. Tests should skip gracefully with a clear message if Chromium cannot be found, but must not fake the browser.
- **CDP attach test:** launch headless Chrome on a free port, connect with `launchBrowserWithCdp`, navigate to the local server, and assert extracted tokens.
- **Fallback test:** `FacebookClient` with `browserBridge: null`, `cdpUrl: null`, `launchChrome: false` must still pass `client.test.js` expectations.
- **Refresh test:** set a short TTL (e.g., `100 ms`), call `ensureTokens` twice within TTL and verify only one browser navigation; call again after expiry and verify a refresh.
- **Proxy / anti-leak args test:** assert `buildChromeArgs({ proxy, extraArgs })` includes `--proxy-server`, `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`, `--host-resolver-rules`, and `--disable-features=WebRtcHideLocalIpsWithMdns`.
- **Cookie injection test:** assert the bridge sets `c_user` and `xs` cookies with the correct domain before `goto`.
- **Error envelope test:** assert CDP launch/attach failures and browser page crashes produce `PlatformError` with `XACT_5030` and `suggestedAction: 'relogin'` or `XACT_5000` and `suggestedAction: 'retry_after_delay'`.
- **Type check:** `npm run typecheck` must pass.

### Security & NFR Notes

- **NFR-4 (Zero-Credential Security):** never log `c_user`, `xs`, `lsd`, `fb_dtsg`, or full cookie strings.
- **NFR-7 (Graceful fallback):** browser extraction failures must not panic; fallback to HTTP or throw an actionable `PlatformError`.
- **AD-3 (No direct IP leak):** every Chrome launch for Facebook must include the sticky proxy and anti-leak flags.
- **AD-5 (Profile preservation):** do not delete user data directories or clear cookies when attaching to an existing Chrome; only close contexts/pages the client itself created.

### Open Questions / Decisions

1. **Should the browser bridge be a separate `FacebookBrowserBridge` class or inline in `FacebookClient`?**  
   *Recommendation:* Create `src/scrapers/social/facebook/signer-bridge.js` with a `FacebookBrowserBridge` class. It keeps the client file focused, makes the bridge testable, and avoids mixing page-management code with GraphQL request logic. The bridge is **required** for this story.
2. **How does `FacebookClient` relate to `SignerWorkerPagePool`?**  
   *Recommendation:* `FacebookClient` accepts an optional `signerPool` and passes it to `AbstractApiClient` for future `requestWithSign` use, but it does **not** use `SignerWorkerPagePool` for token extraction because that pool has no `goto`/cookie-injection support. Token extraction is done by the dedicated `FacebookBrowserBridge`.
3. **What is the `timeoutMs` for navigation?**  
   *Recommendation:* `page.goto` timeout 30 s, `page.evaluate` timeout 3 s default / 8 s on first navigation (`warmup: true`).
4. **Should the HTTP fallback be removed in a later epic?**  
   *Recommendation:* Keep it as a fallback until Epic 20 shadow-run parity ≥ 99% is confirmed; then mark it `deprecated-planned` and eventually remove.

---

## References

- `src/scrapers/social/facebook/client.js` — `FacebookClient.ensureTokens`, `#fetchTokens`, `buildGraphQlBody`, `requestGraphQl`
- `src/scrapers/social/facebook/crawler.js` — `FacebookCrawler` actions, normalization, `cleanup()`
- `src/core/base-client.js` — `AbstractApiClient.tokenRing`, `signerPool`, `requestWithSign`, `request`
- `src/core/signer-pool.js` — `PreSignedTokenRing`, `SignerWorkerPagePool`
- `src/core/cdp-launcher.js` — `launchChrome`, `buildChromeArgs`, `launchBrowserWithCdp`
- `src/core/base-crawler.js` — `AbstractCrawler.cdpUrl`, `launchBrowserWithCdp`, `delayWithJitter`
- `src/scrapers/adapters/playwright.js` — `PlaywrightAdapter.connect` (`connectOverCDP`)
- `src/scrapers/adapters/puppeteer.js` — `PuppeteerAdapter.connect` (`browserWSEndpoint`)
- `src/scrapers/adapters/index.js:42` — `defaultAdapterName = process.env.XACTIONS_SCRAPER_ADAPTER || 'puppeteer'`; `getAdapter` honors this default unless a name is passed
- `src/proxy/proxy-pool.js` — `ProxyIpPool.getBrowserArgs`
- `src/proxy/providers.js` — `getBrowserArgs` anti-leak flags
- `package.json` — dependency versions for `playwright`, `puppeteer`, `got-scraping`, `undici`
- `/Users/luisphan/Documents/GitHub/MediaCrawler/requirements.txt` — `playwright>=1.61.0`
- `/Users/luisphan/Documents/GitHub/MediaCrawler/base/base_crawler.py` — `playwright.async_api` imports
- `/Users/luisphan/Documents/GitHub/MediaCrawler/tools/cdp_browser.py` — `connect_over_cdp` pattern
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` — AD-1, AD-3, AD-5, AD-8, AD-14
- `docs/deprecation-plan.md` — legacy status tracker

---

## Dev Agent Record

### Agent Model Used

`bmad-create-story` skill — manual analysis using `vibervn-context-engine` MCP, `Read`, `grep`, and `find_file_by_name` tools.

### Debug Log References

- MediaCrawler source reviewed to confirm Playwright as the real browser engine (`requirements.txt`, `base/base_crawler.py`, `tools/cdp_browser.py`).
- XActions `src/scrapers/adapters/playwright.js` and `puppeteer.js` compared for CDP attach behavior.
- XActions `src/proxy/proxy-pool.js` and `src/proxy/providers.js` reviewed for anti-leak browser args.

### Completion Notes

- Story 13.4 derives from Epic 13 and builds directly on the `FacebookClient` / `FacebookCrawler` work completed in Story 13.3 and the signer engine from Story 13.1.
- Implemented `FacebookBrowserBridge` with live browser page evaluate token extraction (`extractFacebookTokensScript`), cookie injection, deterministic user data dir, and timeout/retry handling.
- Updated `FacebookClient` to support `browserBridge`, `cdpUrl`, `launchChrome`, `adapterName`, `headless`, `userDataDir`, `profileDir`, `tokenTtlMs`, and `close()`, with 30s pre-expiry window and `tokenRing` refill.
- Updated `FacebookCrawler` with `cdpUrl` and client cleanup on `cleanup()`.
- Updated `cdp-launcher.js` with `proxy` anti-leak flags and `extraArgs`.
- 100% tests passing in `tests/scrapers/social/facebook/` (35/35) and full regression (233/233 across 22 test files).

### File List

- `src/core/cdp-launcher.js`
- `src/scrapers/social/facebook/signer-bridge.js`
- `src/scrapers/social/facebook/client.js`
- `src/scrapers/social/facebook/crawler.js`
- `src/scrapers/social/facebook/index.js`
- `tests/scrapers/social/facebook/client-signer.test.js`
- `_bmad-output/test-artifacts/atdd-checklist-13-4-facebook-browser-as-signer-bridge.md`
- `_bmad-output/implementation-artifacts/13-4-facebook-browser-as-signer-bridge.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/deprecation-plan.md`

### Review Findings

> **Review note:** The parallel review subagents (Blind Hunter, Edge Case Hunter, Acceptance Auditor) could not be launched because the Devin weekly usage quota was exhausted. The findings below were produced by a manual, adversarial review of the same diff.

#### Decision resolved

I chose **option 3** for Playwright (the default adapter): `FacebookBrowserBridge` will call `adapter.newPage(browser, { preserveProfile: false })` for each `extractTokens` invocation. For Playwright this creates a fresh `BrowserContext` per call, and `PlaywrightAdapter.closePage` closes the context, so different accounts never share cookies. For Puppeteer, which does not expose per-context cookie isolation through the current adapter, the contract remains "one `FacebookClient` per account"; this will be documented in the bridge JSDoc.


#### Patch

- [x] [Review][Patch] Use a fresh `BrowserContext` per `extractTokens` call to prevent account context sharing [src/scrapers/social/facebook/signer-bridge.js:311]

Per the decision above, change `adapter.newPage(browser, { preserveProfile: true })` to `adapter.newPage(browser, { preserveProfile: false })`. For Playwright this creates a new `BrowserContext` per account call; `PlaywrightAdapter.closePage` will close the context. Add a JSDoc note that callers using `XACTIONS_SCRAPER_ADAPTER=puppeteer` must use one `FacebookClient` per account because the current `PuppeteerAdapter` does not create incognito contexts.

- [x] [Review][Patch] `buildCookieHeader` in `client.js` no longer percent-encodes cookie values [src/scrapers/social/facebook/client.js:24-37]

The baseline implementation percent-encoded characters `; , " \` with `encodeCookieValue`. The current implementation in `client.js` builds `${k}=${v}` without encoding, so cookie values containing those characters produce a malformed `Cookie` header. This affects `ensureTokens`, `requestGraphQl`, and the HTTP fallback path. Fix: restore the `encodeCookieValue` helper and use it for both object and array forms.

- [x] [Review][Patch] Browser path does not resolve the sticky proxy from `proxyPool`/`proxyProvider` [src/scrapers/social/facebook/client.js:157-169]

`FacebookClient.#getLazyBrowserBridge()` passes `proxy: this.proxy` to `FacebookBrowserBridge`, but `this.proxy` is only set when an explicit `deps.proxy` is provided. `AbstractApiClient` already has `resolveProxy(accountId)` which uses `this.proxyPool.getStickyProxy(accountId)` or `this.proxyProvider.getProxy({ accountId })`. The browser bridge should use the same sticky proxy as the HTTP path. AC-6 requires the launched Chrome to be bound to the account's sticky proxy.

- [x] [Review][Patch] `FacebookBrowserBridge` constructor does not accept `proxyProvider`, `proxyPool`, or `extraArgs` [src/scrapers/social/facebook/signer-bridge.js:96-158]

The spec's responsibility list includes constructor options for `proxyProvider`, `proxyPool`, and `extraArgs`. They are not wired, which blocks sticky-proxy resolution and custom Chrome launch flags. Fix: add the options and pass them through to `launchChrome`/`#getBrowser`.

- [x] [Review][Patch] `buildChromeArgs` manually builds anti-leak proxy flags instead of using `ProxyIpPool.getBrowserArgs` / provider `getBrowserArgs` [src/core/cdp-launcher.js:173-191]

`cdp-launcher.buildChromeArgs` duplicates the logic already in `src/proxy/proxy-pool.js:309-329` and `src/proxy/providers.js:1150-1168`. This is a maintenance risk and may drift from provider-specific normalization. Fix: call `ProxyIpPool.getBrowserArgs(proxy)` (or the resolved provider's `getBrowserArgs`) when `proxy` is set, or extract the shared normalization helper.

- [x] [Review][Patch] Token extraction failure throws `XACT_4010` / `ROTATE_ACCOUNT` instead of `XACT_5030`/`XACT_5000` with `relogin`/`retry_after_delay` [src/scrapers/social/facebook/signer-bridge.js:338-345]

When the page loads but `lsd`/`fb_dtsg` are both empty, the bridge throws a `PlatformError` with `XACT_4010` and `SuggestedActions.ROTATE_ACCOUNT`. AC-2 and AD-14 expect `XACT_5030`/`XACT_5000` and `relogin` or `retry_after_delay`. The final `catch` block already wraps unknown errors as `XACT_5030` / `RELOGIN`, so the explicit "no tokens" branch should align with the spec.

- [x] [Review][Patch] `FacebookClient.#getLazyBrowserBridge()` is not safe for concurrent calls [src/scrapers/social/facebook/client.js:157-169]

Two parallel `ensureTokens()` calls can both see `this.#ownedBrowserBridge === null` and instantiate separate `FacebookBrowserBridge` objects. Use a promise mutex (`this.#bridgePromise`) to deduplicate bridge creation.

- [x] [Review][Patch] Custom `userDataDir` may not exist before Chrome launch [src/scrapers/social/facebook/signer-bridge.js:184-189]

`#resolveUserDataDir` returns `path.join(process.cwd(), '.data', 'facebook-profiles', cleanId)`. Chrome may fail to launch if the parent directory does not exist. `getDefaultUserDataDir()` handles this for the default path, but a per-account custom path should also be created. Fix: `fs.mkdirSync(effectiveUserDataDir, { recursive: true })` before launch.

- [x] [Review][Patch] `FacebookBrowserBridge.#parseCookies` does not URL-decode cookie values [src/scrapers/social/facebook/signer-bridge.js:196-232]

The bridge extracts `c_user` from a cookie string with a raw regex and uses it as the account ID for the user-data-dir and for `rawTokens.c_user`. If the incoming `cookies` string is URL-encoded (e.g. `c_user=1000%40foo`), the encoded form is used everywhere. `FacebookClient.#fetchTokens` decodes the cookie before extracting `parsedUserId`; the bridge should do the same.

#### Deferred

- [x] [Review][Defer] HTTP fallback `#fetchTokens` does not extract `__rev` [src/scrapers/social/facebook/client.js:319-337] — pre-existing, browser path covers AC-2

The new browser `extractFacebookTokensScript` extracts `__rev`, and `buildGraphQlBody` includes it when present. The legacy HTTP-only `#fetchTokens()` does not extract `__rev` — this behavior is unchanged from the baseline and is acceptable for the HTTP fallback path.

### Post-Patch Validation

- `npm run typecheck` passes.
- `npx vitest run` passes: **194 test files passed** (3 skipped), **4121 tests passed** (54 skipped).
- `npx vitest run tests/scrapers/social/facebook/client-signer.test.js` passes.
- `npx vitest run tests/proxy/providers-tunnel.test.js tests/proxy/socksnode-provider.test.js` passes.
