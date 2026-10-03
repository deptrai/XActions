// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Stealth Browser
 * Anti-detection Puppeteer wrapper with fingerprint randomization.
 *
 * Kills: Phantombuster (stealth scraping), Apify
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { globalFingerprintManager } from '../core/fingerprint-manager.js';
import { PlatformError, ErrorTypes } from '../core/error-envelope.js';

// ============================================================================
// Default BrowserPool registry (Story 53.2)
// ============================================================================

/**
 * Per-backend default pools, lazily created on the first `pooled` launch.
 * Keyed by resolved backend ('chrome' | 'obscura') — sharded because the two
 * backends have different lifecycles (child process vs CDP connect; AD-24 r3).
 * @type {Map<string, any>}
 */
const _defaultPools = new Map();

/** Default pool size: `XACTIONS_BROWSER_POOL_SIZE` when > 0, else 4 (explicit opt-in). */
function _defaultPoolSize() {
  const env = parseInt(process.env.XACTIONS_BROWSER_POOL_SIZE || '', 10);
  return Number.isFinite(env) && env > 0 ? env : 4;
}

/**
 * Get (or lazily create) the default BrowserPool for a backend.
 * @param {string} backend — 'chrome' | 'obscura'
 * @param {object} [poolOptions] — forwarded to `new BrowserPool(...)` only when
 *   the pool is first created; ignored on subsequent calls for the same backend.
 * @returns {Promise<import('./browserPool.js').BrowserPool>}
 */
export async function getDefaultPool(backend, poolOptions = {}) {
  const key = backend || 'chrome';
  // Store the in-flight creation promise — two concurrent cold-start launches
  // must not construct two pools (the loser would leak un-registered).
  let pending = _defaultPools.get(key);
  if (!pending) {
    pending = (async () => {
      // Lazy import: browserPool.js statically imports this module (cycle).
      const { BrowserPool } = await import('./browserPool.js');
      return new BrowserPool({ size: _defaultPoolSize(), backend: key, ...poolOptions });
    })();
    _defaultPools.set(key, pending);
    // If construction fails, clear so the next call retries instead of
    // caching a rejected promise forever.
    pending.catch(() => { if (_defaultPools.get(key) === pending) _defaultPools.delete(key); });
  }
  return pending;
}

/** Drain every default pool and clear the registry (tests / shutdown). */
export async function resetDefaultPools() {
  const pending = [..._defaultPools.values()];
  _defaultPools.clear();
  for (const p of pending) {
    try { const pool = await p; await pool.drain(); } catch { /* best-effort */ }
  }
}

/**
 * Wrap a `BrowserPool.acquire()` lease into a browser-shaped pooled handle.
 * Keeps every key existing callers read (`__backend`, `_backend`, `_native`,
 * `_adapter`) so helpers work unmodified; `_pooled`/`_pool`/`_lease` are the
 * escape hatch for teardown (release lease — never the shared browser).
 * `_native` = the lease's isolated BrowserContext, so `native.newPage()` still
 * lands inside the lease context, not the shared browser's default context.
 */
function _pooledHandle(pool, lease, { fingerprint } = {}) {
  const handle = {
    _native: lease.context,
    _pooled: true,
    _pool: pool,
    _lease: lease,
    __backend: lease.backend,
  };
  if (fingerprint) handle.__fingerprint = fingerprint;
  return handle;
}

// ============================================================================
// User-Agent Pool
// ============================================================================

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

// ============================================================================
// Stealth Browser
// ============================================================================

/**
 * Launch a stealth-configured Puppeteer browser
 *
 * Supports pluggable backends via `options.backend` (or env `XACTIONS_BROWSER_BACKEND`):
 *   - 'chrome'  (default) — puppeteer.launch() with bundled/system Chrome
 *   - 'obscura' — puppeteer-core.connect() to an Obscura CDP endpoint
 *               (options.wsEndpoint or env `OBSCURA_WS_ENDPOINT`, default ws://127.0.0.1:9222)
 *
 * Supports automatic fallback via `options.fallbackBackend` (or env `XACTIONS_BROWSER_BACKEND_FALLBACK`, default 'chrome').
 * Enforces post-auth guard (AC-2): requests with `requiresAuth === true` reject 'obscura' and throw PlatformError.
 */
export async function launchStealthBrowser(options = {}) {
  const {
    proxy,
    headless = true,
    userDataDir,
    viewport,
    userAgent,
    fingerprint,
    fingerprintManager,
    accountId,
    platform,
    requiresAuth = false,
    telemetryContext,
  } = options;

  const primaryBackend = options.backend || process.env.XACTIONS_BROWSER_BACKEND || 'chrome';
  const fallbackBackend = options.fallbackBackend !== undefined ? options.fallbackBackend : (process.env.XACTIONS_BROWSER_BACKEND_FALLBACK || 'chrome');
  const wsEndpoint = options.wsEndpoint || process.env.OBSCURA_WS_ENDPOINT || 'ws://127.0.0.1:9222';

  // Guard: post-auth actions cannot use obscura (AC-2)
  if (requiresAuth && primaryBackend === 'obscura') {
    throw new PlatformError({
      type: ErrorTypes.INVALID_ARGS,
      message: 'obscura backend không hỗ trợ post-auth (React hydration chưa mount data-testid)',
      suggestedAction: 'dùng chrome backend',
    });
  }

  // Resolve a stable, geo-consistent fingerprint when requested (Story 27.1).
  let fp = fingerprint && fingerprint.userAgent ? fingerprint : null;
  const fm = fingerprintManager || (accountId ? globalFingerprintManager : null);
  if (!fp && fm && accountId) {
    try {
      fp = await fm.getForAccount(platform || 'default', accountId, { proxy });
    } catch (err) {
      console.warn(`⚠️ [stealth] FingerprintManager.getForAccount failed: ${err?.message || err}`);
    }
  }

  // Pooled path (Story 53.2): acquire a page/context lease from a BrowserPool
  // instead of launching a new browser. Single-backend — no cross-backend
  // fallback (pools are sharded per backend, AD-24 rule 3); acquire errors
  // propagate. The requiresAuth guard above already rejected obscura.
  if (options.pooled) {
    const pool = typeof options.pooled === 'object' && options.pooled !== null
      ? options.pooled
      : await getDefaultPool(primaryBackend, {
          backend: primaryBackend,
          fallbackBackend: 'none',
          wsEndpoint,
          proxy,
          headless,
          userDataDir,
          userAgent,
          fingerprint: fp || undefined,
          fingerprintManager,
          accountId,
          platform,
          requiresAuth,
          telemetryContext,
        });
    const lease = await pool.acquire();
    if (telemetryContext && typeof telemetryContext.setBrowserBackend === 'function') {
      telemetryContext.setBrowserBackend(lease.backend);
    }
    return _pooledHandle(pool, lease, { fingerprint: fp });
  }

  const launchWithBackend = async (backend) => {
    if (requiresAuth && backend === 'obscura') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        message: 'obscura backend không hỗ trợ post-auth (React hydration chưa mount data-testid)',
        suggestedAction: 'dùng chrome backend',
      });
    }

    if (backend === 'obscura') {
      if (userDataDir) {
        process.env.OBSCURA_STORAGE_DIR = userDataDir;
      }
      const puppeteerCore = (await import('puppeteer-core')).default;
      const browser = await puppeteerCore.connect({ browserWSEndpoint: wsEndpoint });
      // Obscura runs its own (non-Chromium) engine — record provenance for callers.
      browser.__backend = 'obscura';
      if (fp) browser.__fingerprint = fp;
      console.log(`🕳️  Connected to Obscura at ${wsEndpoint}`);
      return browser;
    }

    let puppeteer;
    try {
      // Try puppeteer-extra with stealth plugin first
      const puppeteerExtra = await import('puppeteer-extra');
      const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
      puppeteerExtra.default.use(StealthPlugin.default());
      puppeteer = puppeteerExtra.default;
      console.log('🥷 Stealth plugin loaded');
    } catch {
      // Fallback to regular puppeteer
      puppeteer = (await import('puppeteer')).default;
      console.log('⚠️  puppeteer-extra not available, using basic stealth patches');
    }

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      `--lang=${fp ? fp.locale : 'en-US'},${fp ? fp.locale.split('-')[0] : 'en'}`,
    ];

    if (proxy) {
      const proxyUrl = typeof proxy === 'object' ? proxy.url : proxy;
      args.push(`--proxy-server=${proxyUrl}`);
    }

    const vp = viewport || (fp && fp.viewport) || {
      width: randomInt(1280, 1920),
      height: randomInt(720, 1080),
    };

    const launchOptions = {
      headless: headless ? 'new' : false,
      args,
      defaultViewport: vp,
    };

    if (userDataDir) launchOptions.userDataDir = userDataDir;

    const browser = await puppeteer.launch(launchOptions);
    browser.__backend = 'chrome';
    // Attach resolved fingerprint so createStealthPage can reuse it (Story 27.1).
    if (fp) browser.__fingerprint = fp;
    return browser;
  };

  let activeBrowser;
  try {
    activeBrowser = await launchWithBackend(primaryBackend);
  } catch (err) {
    if (err?.type === ErrorTypes.INVALID_ARGS && String(err?.message).includes('obscura backend')) {
      throw err;
    }
    // Fallback logic (AC-2b):
    // obscura -> chrome is always safe; chrome -> obscura only on public-scraping path (!requiresAuth)
    const canFallback = Boolean(fallbackBackend && fallbackBackend !== 'none' && fallbackBackend !== primaryBackend && (!requiresAuth || fallbackBackend !== 'obscura'));
    if (canFallback) {
      console.warn(`⚠️ [stealth] primary backend ${primaryBackend} failed → fallback ${fallbackBackend}`);
      activeBrowser = await launchWithBackend(fallbackBackend);
    } else {
      throw err;
    }
  }

  if (telemetryContext && typeof telemetryContext.setBrowserBackend === 'function') {
    telemetryContext.setBrowserBackend(activeBrowser.__backend);
  }

  return activeBrowser;
}

/**
 * Teardown helper respecting per-backend contract:
 *   - 'obscura'  → browser.disconnect() (preserves shared external obscura serve)
 *   - 'chrome'   → browser.close() (kills child process)
 *
 * @param {any} browser
 */
export async function closeStealthBrowser(browser) {
  if (!browser) return;
  // Pooled handle (Story 53.2): release the lease — closes page + isolated
  // context, never the shared browser. release() is idempotent (WeakMap
  // lease), so a double close is a no-op.
  if (browser._pooled && browser._pool && browser._lease) {
    await browser._pool.release(browser._lease.page);
    return;
  }
  const native = browser._native || browser;
  const backend = browser._backend || native.__backend;
  if (backend === 'obscura' && typeof native.disconnect === 'function') {
    await native.disconnect();
  } else if (typeof native.close === 'function') {
    await native.close();
  }
}

/**
 * Create a stealth-configured page with all patches applied
 */
export async function createStealthPage(browser, options = {}) {
  // Pooled handle (Story 53.2): the lease page was already stealth-patched by
  // BrowserPool.acquire() — return it as-is. Per-call options (userAgent,
  // fingerprint, …) are ignored here; configure them at pool level.
  if (browser && browser._pooled && browser._lease && browser._lease.page) {
    return browser._lease.page;
  }
  const { proxy, userAgent, fingerprint, fingerprintManager, accountId, platform } = options;
  const nativeBrowser = browser?._native || browser;
  const page = await nativeBrowser.newPage();

  const isObscura = browser?._backend === 'obscura' || nativeBrowser?.__backend === 'obscura';
  if (isObscura) {
    page.__backend = 'obscura';
    const origGoto = page.goto.bind(page);
    page.goto = async (url, opts = {}) => {
      let wu = opts && opts.waitUntil;
      if (wu === 'networkidle2' || wu === 'networkidle') {
        wu = 'networkidle0';
      }
      return origGoto(url, { ...opts, ...(wu ? { waitUntil: wu } : {}) });
    };
  }

  // Resolve a stable fingerprint: explicit option → browser-attached → manager (Story 27.1).
  let fp = fingerprint && fingerprint.userAgent ? fingerprint : (browser && browser.__fingerprint) || null;
  const fm = fingerprintManager || (accountId ? globalFingerprintManager : null);
  if (!fp && fm && accountId) {
    try {
      fp = await fm.getForAccount(platform || 'default', accountId, { proxy });
    } catch (err) {
      console.warn(`⚠️ [stealth] FingerprintManager.getForAccount failed: ${err?.message || err}`);
    }
  }

  // Set user agent — fingerprint-stable when available, else random (legacy).
  const ua = userAgent || (fp && fp.userAgent) || USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);

  // Timezone / locale consistency with the fingerprint (Story 27.1).
  if (fp && fp.timezone && typeof page.emulateTimezone === 'function') {
    try { await page.emulateTimezone(fp.timezone); } catch { /* older puppeteer */ }
  }

  // Proxy authentication
  if (proxy && typeof proxy === 'object' && proxy.username && proxy.password) {
    await page.authenticate({ username: proxy.username, password: proxy.password });
  }

  // Anti-detection patches — apply the resolved fingerprint when present so
  // platform/locale/WebGL/hardware stay consistent with the user-agent and
  // proxy region (Story 27.1); otherwise keep the legacy randomized defaults.
  await page.evaluateOnNewDocument((fpData) => {
    const fp = fpData || null;
    const navPlatform = fp && fp.platform ? fp.platform : ['Win32', 'MacIntel', 'Linux x86_64'][Math.floor(Math.random() * 3)];
    const navLanguages = fp && fp.locale ? [fp.locale, fp.locale.split('-')[0]] : ['en-US', 'en'];
    const webglVendor = fp && fp.webgl ? fp.webgl.vendor : 'Intel Inc.';
    const webglRenderer = fp && fp.webgl ? fp.webgl.renderer : 'Intel Iris OpenGL Engine';

    // Override webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Override languages
    Object.defineProperty(navigator, 'languages', { get: () => navLanguages });
    if (fp && fp.locale) {
      Object.defineProperty(navigator, 'language', { get: () => fp.locale });
    }

    // Override plugins length
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });

    // Override platform — fingerprint-stable, not random, when available
    Object.defineProperty(navigator, 'platform', { get: () => navPlatform });

    // Hardware concurrency + device memory consistent with the fingerprint OS
    if (fp && fp.hardwareConcurrency) {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });
    }
    if (fp && fp.deviceMemory) {
      try { Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory }); } catch { /* FF lacks deviceMemory */ }
    }

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // WebGL vendor and renderer — fingerprint-stable
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return webglVendor;
      if (parameter === 37446) return webglRenderer;
      return getParameter.call(this, parameter);
    };

    // Story 27.5: Canvas / WebGL buffer / Audio noise injection (FR-113)
    // Deterministic per-account noise prevents fingerprinting via rendering entropy
    if (fp && fp.noiseSeed) {
      function mulberry32(a) {
        return function() {
          let t = a += 0x6D2B79F5;
          t = Math.imul(t ^ t >>> 15, t | 1);
          t ^= t + Math.imul(t ^ t >>> 7, t | 61);
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }

      // 1. Canvas noise injection
      if (typeof CanvasRenderingContext2D !== 'undefined') {
        const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh, settings) {
          const imgData = origGetImageData.call(this, sx, sy, sw, sh, settings);
          const d = imgData.data;
          const localRng = mulberry32(fp.noiseSeed ^ (sw * 31 + sh));
          for (let i = 0; i < d.length; i += 64) {
            const shift = localRng() > 0.5 ? 1 : -1;
            d[i] = Math.max(0, Math.min(255, d[i] + shift));
          }
          return imgData;
        };

        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(...args) {
          try {
            const ctx = this.getContext('2d');
            if (ctx && this.width > 0 && this.height > 0) {
              const imgData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
              ctx.putImageData(imgData, 0, 0);
            }
          } catch {}
          return origToDataURL.apply(this, args);
        };
      }

      // 2. WebGL buffer readback noise
      function perturbWebGL(glProto) {
        if (!glProto || !glProto.readPixels) return;
        const origReadPixels = glProto.readPixels;
        glProto.readPixels = function(x, y, w, h, format, type, pixels) {
          origReadPixels.call(this, x, y, w, h, format, type, pixels);
          if (pixels && pixels.length > 0) {
            const localRng = mulberry32(fp.noiseSeed ^ 0xDEADBEEF);
            for (let i = 0; i < Math.min(pixels.length, 32); i += 8) {
              pixels[i] = (pixels[i] + (localRng() > 0.5 ? 1 : 255)) & 0xFF;
            }
          }
        };
      }
      if (typeof WebGLRenderingContext !== 'undefined') perturbWebGL(WebGLRenderingContext.prototype);
      if (typeof WebGL2RenderingContext !== 'undefined') perturbWebGL(WebGL2RenderingContext.prototype);

      // 3. AudioContext / AnalyserNode noise injection
      if (typeof AnalyserNode !== 'undefined') {
        const origGetFloatFreq = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = function(array) {
          origGetFloatFreq.call(this, array);
          const localRng = mulberry32(fp.noiseSeed ^ 0xCAFEBABE);
          for (let i = 0; i < array.length; i += 16) {
            array[i] += (localRng() - 0.5) * 0.1;
          }
        };

        const origGetByteFreq = AnalyserNode.prototype.getByteFrequencyData;
        AnalyserNode.prototype.getByteFrequencyData = function(array) {
          origGetByteFreq.call(this, array);
          const localRng = mulberry32(fp.noiseSeed ^ 0xFEEDFACE);
          for (let i = 0; i < array.length; i += 16) {
            array[i] = Math.max(0, Math.min(255, array[i] + (localRng() > 0.5 ? 1 : -1)));
          }
        };
      }
    }
  }, fp || null);

  // Set realistic viewport
  const viewport = page.viewport();
  if (viewport) {
    await page.setViewport({
      ...viewport,
      deviceScaleFactor: Math.random() > 0.5 ? 2 : 1,
    });
  }

  return page;
}

/**
 * Human-like click — moves mouse to element before clicking
 */
export async function stealthClick(page, selector, _options = {}) {
  const element = await page.$(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  const box = await element.boundingBox();
  if (!box) throw new Error(`Element has no bounding box: ${selector}`);

  // Move to element with slight randomization
  const x = box.x + box.width * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);

  await page.mouse.move(x, y, { steps: randomInt(5, 15) });
  await sleep(randomInt(50, 150));
  await page.mouse.click(x, y, { delay: randomInt(50, 150) });
}

/**
 * Human-like typing with random inter-key delays
 */
export async function stealthType(page, selector, text) {
  await stealthClick(page, selector);
  await sleep(randomInt(100, 300));

  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(50, 150) });
  }
}

// ============================================================================
// Helpers
// ============================================================================

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// by nichxbt
