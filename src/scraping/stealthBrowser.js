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
 */
export async function launchStealthBrowser(options = {}) {
  const { proxy, headless = true, userDataDir, viewport, userAgent, fingerprint, fingerprintManager, accountId, platform } = options;

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
  // Attach resolved fingerprint so createStealthPage can reuse it (Story 27.1).
  if (fp) browser.__fingerprint = fp;
  return browser;
}

/**
 * Create a stealth-configured page with all patches applied
 */
export async function createStealthPage(browser, options = {}) {
  const { proxy, userAgent, fingerprint, fingerprintManager, accountId, platform } = options;
  const page = await browser.newPage();

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
export async function stealthClick(page, selector, options = {}) {
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
