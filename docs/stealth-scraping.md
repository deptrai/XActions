# 🕵️ Stealth Scraping & Proxy Rotation

> Anti-detection browser automation with proxy rotation and fingerprint randomization. Competes with **Apify** anti-bot evasion.

---

## Overview

XActions includes a stealth scraping layer that wraps Puppeteer with:

- **Proxy rotation** — round-robin, random selection, health tracking, auto-blacklisting
- **Stealth browser** — puppeteer-extra with stealth plugin + custom fingerprint patches
- **20 real user agents** — rotated per session
- **Human-like interaction** — randomized mouse movement, typing delays
- **WebDriver detection bypass** — navigator flags, plugins, WebGL, permissions

Available via: **Node.js library**.

---

## Quick Start

### Proxy Manager

```javascript
import ProxyManager from 'xactions/src/scraping/proxyManager.js';

const pm = new ProxyManager([
  'http://user:pass@proxy1.example.com:8080',
  'http://user:pass@proxy2.example.com:8080',
  'socks5://proxy3.example.com:1080'
]);

// Or load from file / environment
await pm.loadFromFile('./proxies.txt');
pm.loadFromEnv(); // reads XACTIONS_PROXIES or XACTIONS_PROXY_FILE

// Get next proxy (round-robin)
const proxy = pm.getNext();
// { url: 'http://...', host: 'proxy1.example.com', port: 8080, protocol: 'http', auth: { username: 'user', password: 'pass' } }

// Health tracking
pm.markSuccess(proxy, 250); // 250ms response time
pm.markFailed(proxy);       // 3 consecutive failures → 10min blacklist

// Test all proxies
const results = await pm.testAll();
// [{ proxy: '...', status: 'ok', time: 250 }, { proxy: '...', status: 'failed' }]
```

### Stealth Browser

```javascript
import {
  launchStealthBrowser,
  createStealthPage,
  stealthClick,
  stealthType
} from 'xactions/src/scraping/stealthBrowser.js';

// Launch with proxy
const browser = await launchStealthBrowser({
  proxy: 'http://user:pass@proxy.example.com:8080',
  headless: true
});

// Create a stealth-patched page
const page = await createStealthPage(browser, {
  proxy: 'http://user:pass@proxy.example.com:8080'
});

// Navigate normally
await page.goto('https://x.com');

// Human-like interactions
await stealthClick(page, '[data-testid="loginButton"]');
await stealthType(page, 'input[name="text"]', 'myusername');

await browser.close();
```

### Combined Usage

```javascript
import ProxyManager from 'xactions/src/scraping/proxyManager.js';
import { launchStealthBrowser, createStealthPage } from 'xactions/src/scraping/stealthBrowser.js';

const pm = new ProxyManager();
await pm.loadFromFile('./proxies.txt');

const proxy = pm.getNext();
const browser = await launchStealthBrowser({ proxy: proxy.url });
const page = await createStealthPage(browser, { proxy: proxy.url });

try {
  await page.goto('https://x.com/elonmusk');
  pm.markSuccess(proxy, Date.now() - start);
} catch (err) {
  pm.markFailed(proxy);
  // Retry with next proxy...
}
```

---

## Architecture

```
src/scraping/
├── proxyManager.js    → Proxy pool + health monitoring
├── stealthBrowser.js  → Anti-detection Puppeteer wrapper
└── paginationEngine.js → (see Pagination Engine docs)
```

---

## Proxy Manager Reference

### `new ProxyManager(proxies?)`

| Param | Type | Description |
|---|---|---|
| `proxies` | `Array<string \| object>` | Initial proxy list (URLs or `{ url, host, port, auth }` objects) |

### Methods

| Method | Description |
|---|---|
| `loadFromFile(path)` | Load proxies from text file (one per line) |
| `loadFromEnv()` | Load from `XACTIONS_PROXIES` (comma-separated) or `XACTIONS_PROXY_FILE` |
| `getNext()` | Round-robin selection (skips blacklisted) |
| `getRandom()` | Random selection from healthy proxies |
| `markFailed(proxy)` | Record failure — 3 consecutive → 10min blacklist |
| `markSuccess(proxy, responseTime?)` | Record success, reset failure counter |
| `getHealthy()` | Get all non-blacklisted proxies |
| `getStats()` | Per-proxy stats: successes, failures, avg response time |
| `testAll()` | Concurrently test all proxies against httpbin.org |

### Environment Variables

| Variable | Description |
|---|---|
| `XACTIONS_PROXIES` | Comma-separated proxy URLs |
| `XACTIONS_PROXY_FILE` | Path to proxy file |

---

## Stealth Browser Reference

### `launchStealthBrowser(options)`

| Option | Type | Default | Description |
|---|---|---|---|
| `proxy` | `string` | — | Proxy URL |
| `headless` | `boolean` | `true` | Run headless |
| `userDataDir` | `string` | — | Persistent browser profile |
| `viewport` | `object` | — | Custom viewport `{ width, height }` |
| `userAgent` | `string` | random | Override user agent |

Uses `puppeteer-extra` with `puppeteer-extra-plugin-stealth` if available, falls back to standard Puppeteer.

### `createStealthPage(browser, options)`

Creates a page with anti-detection patches:

- `navigator.webdriver` → `false`
- `navigator.plugins` → realistic plugin array
- `navigator.platform` → randomized
- `WebGLRenderingContext` → spoofed vendor/renderer
- `navigator.permissions.query` → no `denied`
- Random user agent from pool of 20

### `stealthClick(page, selector)`

Human-like click: moves mouse in a curve to element, then clicks with random delay.

### `stealthType(page, selector, text)`

Human-like typing: random inter-key delay (50–150ms), occasional pauses.

---

## User Agent Pool

20 realistic user agents covering:
- Chrome 120–123 (Windows, Mac, Linux)
- Firefox 121–123 (Windows, Mac)
- Safari 17 (Mac)
- Edge 120 (Windows)

---

## FingerprintManager (Story 27.1)

`FingerprintManager` (`src/core/fingerprint-manager.js`) manages a pool of *complete*, internally-consistent browser fingerprints and binds them to a geo-consistent proxy region so platforms cannot fingerprint XActions via TLS/JA4 mismatch, inconsistent timezone/locale, or proxy-UA mismatch.

### `getForAccount(platform, accountId, { proxy })`

Returns a stable `Fingerprint` for `platform:accountId`:

```js
import { globalFingerprintManager } from './src/core/fingerprint-manager.js';

const fp = await globalFingerprintManager.getForAccount('twitter', 'alice', {
  proxy: { region: 'us' },   // or proxy record from ProxyIpPool
});
// → { userAgent, viewport, timezone, locale, colorDepth, platform,
//     webgl: {vendor,renderer}, fonts, hardwareConcurrency, deviceMemory, ... }
```

- **Stable** — repeated calls return the same fingerprint until `rotateForAccount()`.
- **Geo-consistent** — `timezone`/`locale` are derived from the proxy `region`/`country`; when the proxy exposes no region they stay internally consistent with the fingerprint's OS family.
- **Unique per account** — two accounts on the same region get independent fingerprints.
- **Persisted** — when the account is registered in `SocialAccount`, the fingerprint is written to `metadata.fingerprint`; otherwise it lives in-process.

### `rotateForAccount(platform, accountId, { proxy })`

Explicitly generates and persists a new fingerprint. Only subsequent stealth launches pick it up — in-flight pages are unaffected.

### `bindProxyRegion(accountId, region)`

Bind an account to a region so future fingerprints are geo-consistent even without a proxy record.

### Stealth browser integration

`launchStealthBrowser` / `createStealthPage` accept `fingerprint`, `fingerprintManager`, `accountId`, `platform`. When a fingerprint resolves, the page's `navigator.platform`, `languages`, `language`, `hardwareConcurrency`, `deviceMemory`, WebGL vendor/renderer, UA, viewport, and `--lang` flag all come from the fingerprint instead of randomized defaults.

### TlsProfileProvider

`TlsProfileProvider` (`src/core/tls-profile-provider.js`) maps a browser family to a representative TLS handshake profile (`cipherSuites`, `minVersion`, `alpnProtocols`, `sigAlgs`) — a best-effort JA3/JA4 hint. When the transport cannot expose cipher control it is a graceful no-op; the browser fingerprint still applies.

```js
const tls = globalFingerprintManager.tlsProfileFor(fp); // → TlsProfile | null
```

---

## SessionHealthOrchestrator (Story 27.2)

`SessionHealthOrchestrator` (`src/core/session-health-orchestrator.js`) maintains a continuous health score `[0, 100]` per `platform:accountId` from six signals and drives an automatic circuit breaker:

- **Consecutive errors** (−8/each, cap 40)
- **Rate-limit events** (−10/each, cap 30)
- **Bot challenge events** (−15/each, cap 30)
- **Average latency** (>3s −10, >8s −20)
- **Payload completeness** (incomplete −12/each, cap 24)
- **Proxy health** (unhealthy −15)

### Circuit Breaker & Recovery Probe

When an account's score drops below `30`, its circuit breaker **opens**:
1. The account is marked `sick` in `AccountPool` and `AdaptiveRateGovernor`, excluding it from rotation.
2. After a cooldown (`baseCooldownMs` × 2^failures, cap 30m), the breaker enters **`half-open`**.
3. A **recovery probe** runs: callers/admin register a probe per account via `registerProbe(platform, accountId, probeFn)`. The probe performs a cheap, read-only action (e.g. `profile`) through a fresh proxy.
4. If the probe succeeds with a complete payload and no challenge, the breaker **closes**, score resets to `60`, and the account is marked active again. On failure, the breaker re-opens with exponential backoff.

### Operator Dashboard & API

- `dashboard/admin.html` displays a **Health** column in the accounts table:
  - Green: `≥ 70`
  - Yellow: `30 – 69`
  - Red: `< 30` (sick / breaker open)
  - Action button: **🩺 Probe** (triggers manual immediate recovery check)
- `GET /api/admin/accounts` returns `healthScore` and `circuitState` (`closed` | `open` | `half-open`) for every account.
- `POST /api/admin/accounts/probe` triggers an immediate recovery probe.
- `StatusApi.getGovernorStatus()` merges `healthScores` and `circuitBreakerStates`.
