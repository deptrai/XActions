// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Scrapers
 * Puppeteer-based scrapers for Facebook (facebook.com)
 *
 * Uses the same Puppeteer stealth approach as Twitter and Threads scrapers.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// Facebook scraper — core.js
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { generateFingerprint, applyFingerprint, applyNavigatorOverrides, applyWebRTCOverride } from './fingerprint.js';


// Configure stealth for all Facebook sessions. Persistent profiles conflict with the
// iframe.contentWindow evasion (ADR-016). Per-call reconfiguration is not reliable with
// puppeteer-extra, so we use the spec-allowed fallback and disable it globally.
const allEvasions = [...StealthPlugin().opts.availableEvasions];
const facebookEvasions = new Set(allEvasions.filter((e) => e !== 'iframe.contentWindow'));
puppeteer.use(StealthPlugin({ enabledEvasions: facebookEvasions }));

// ============================================================================
// Core Utilities
// ============================================================================

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const randomDelay = (min = 1000, max = 3000) => sleep(min + Math.random() * (max - min));

export const FACEBOOK_BASE = 'https://www.facebook.com';
export const MBASIC_BASE = 'https://mbasic.facebook.com';
export const MOBILE_BASE = 'https://m.facebook.com';

// Mobile UA + viewport shared by group scrapers (scrapeFacebookGroupPosts,
// scrapeFacebookGroupSearch). Extracted to avoid duplication.
export const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
export const MOBILE_VIEWPORT = { width: 390, height: 844, isMobile: true };
/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
export async function applyMobileViewport(page) {
  await page.setUserAgent(MOBILE_UA);
  await page.setViewport(MOBILE_VIEWPORT);
}

// Path segments after facebook.com/ that are NOT user/page profile handles.
// Shared by scrapeFollowers and searchTweets author extraction. Passed into
// page.evaluate as an argument (arrays serialize across the bridge; Sets do not).
export const NON_PROFILE_SEGMENTS = [
  'photo', 'photo.php', 'groups', 'watch', 'events', 'marketplace',
  'pages', 'people', 'friends', 'reel', 'reels', 'stories', 'hashtag',
];

/**
 * Create a browser instance for Facebook scraping (Story 6.17 — ADR-016 persistent profile).
 * @param {FacebookOptions} options - Browser launch options
 * @returns {Promise<import('puppeteer').Browser>} Puppeteer browser instance
 */
export async function createBrowser(options = {}) {
  const { args: extraArgs = [], headless, proxy, launchImpl, executablePath, userDataDir, proxyAuth, proxyLocation, fingerprint, skipWarmup, ...rest } = options;
  const stealthArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-webrtc', // Story 6.5 — prevent real IP leak via STUN (defense-in-depth with JS override)
    // Anti-detection / anti-fingerprinting launch flags for headless Facebook scraping
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-site-isolation-trials',
  ];

  let mergedArgs = [...stealthArgs, ...(proxy ? [`--proxy-server=${proxy}`] : []), ...extraArgs];

  // Auto-create profile directory and strip --incognito when persistent profile is used (Story 6.17 — AC2, AC3)
  if (userDataDir != null) {
    if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
      throw new Error('❌ userDataDir must be a non-empty string');
    }

    const resolvedDir = path.resolve(userDataDir);
    const relativeToCwd = path.relative(process.cwd(), resolvedDir);
    if (path.isAbsolute(relativeToCwd) || relativeToCwd.startsWith('..')) {
      throw new Error('❌ userDataDir must be within the current working directory');
    }

    try {
      fs.mkdirSync(resolvedDir, { recursive: true });
    } catch {
      throw new Error('❌ Failed to create profile directory');
    }

    if (mergedArgs.some((a) => /^--incognito(?:=.*)?$/i.test(a))) {
      console.warn('⚠️ Stripping --incognito flag because persistent profile (userDataDir) is enabled');
      mergedArgs = mergedArgs.filter((a) => !/^--incognito(?:=.*)?$/i.test(a));
    }

    console.warn('⚠️ Persistent profile launch uses stealth without iframe.contentWindow evasion (ADR-016 conflict mitigation)');
  }

  // launchImpl seam: tests inject a fake launcher so no real browser spawns.
  const launch = launchImpl ?? puppeteer.launch.bind(puppeteer);

  // Resolve executablePath: explicit option → env var → system Chrome → puppeteer default
  const resolvedExecutablePath = executablePath
    || process.env.PUPPETEER_EXECUTABLE_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  /** @type {Record<string, unknown>} */
  const launchOpts = {
    headless: headless !== undefined ? headless : 'new',
    args: mergedArgs,
    executablePath: resolvedExecutablePath,
    ...rest,
  };

  if (userDataDir != null) {
    launchOpts.userDataDir = userDataDir;
  }

  return /** @type {import('puppeteer').Browser} */ (
    await launch(/** @type {import('puppeteer').LaunchOptions} */ (/** @type {unknown} */ (launchOpts)))
  );
}

/**
 * Apply timezone and geolocation overrides matching proxy location (Story 6.16 — ADR-016).
 *
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {Record<string, unknown>} [proxyLocation] - location descriptor matching proxy
 */
export async function applyProxyLocation(page, proxyLocation) {
  if (!proxyLocation) return;

  const timezone = proxyLocation.timezone;
  const lat = proxyLocation.latitude ?? proxyLocation.lat;
  const lng = proxyLocation.longitude ?? proxyLocation.lng;
  const accuracy = proxyLocation.accuracy;

  const isValidTz = typeof timezone === 'string' && timezone.trim().length > 0;
  const isValidLat = typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const isValidLng = typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;

  if (!isValidTz || !isValidLat || !isValidLng) {
    console.warn('⚠️ Skipped proxy location override: missing or invalid timezone/coordinates');
    return;
  }

  try {
    await page.emulateTimezone(timezone.trim());

    /** @type {{ latitude: number; longitude: number; accuracy?: number }} */
    const geo = { latitude: /** @type {number} */ (lat), longitude: /** @type {number} */ (lng) };
    if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0) {
      geo.accuracy = accuracy;
    }
    await page.setGeolocation(geo);

    await page.browserContext().overridePermissions('https://www.facebook.com', ['geolocation']);
  } catch (err) {
    throw new Error('❌ Failed to apply proxy location', { cause: err });
  }
}

/**
 * Create a new Puppeteer page pre-configured with anti-detection fingerprinting.
 *
 * A fingerprint (UA + viewport + hardware config) is generated once and applied
 * via `applyFingerprint` (UA + viewport), then `applyNavigatorOverrides` (navigator
 * properties via evaluateOnNewDocument), then `applyWebRTCOverride` (WebRTC leak
 * prevention), then `applyProxyLocation` (timezone & geolocation). The fingerprint is
 * attached as `page._fingerprint` so callers can reuse it across tabs via
 * `createPage(browser, { fingerprint })`.
 *
 * @param {import('puppeteer').Browser} browser - Puppeteer browser instance
 * @param {FacebookOptions} [options]
 * @returns {Promise<import('puppeteer').Page>} Puppeteer page instance with `page._fingerprint` set
 */
export async function createPage(browser, options = {}) {
  const page = await browser.newPage();

  // Apply proxy authentication before any navigation so the proxy accepts the browser connection.
  const proxyAuth = options.proxyAuth;
  if (proxyAuth && typeof proxyAuth.username === 'string' && typeof proxyAuth.password === 'string') {
    await page.authenticate({ username: proxyAuth.username, password: proxyAuth.password });
  }

  const fingerprint = /** @type {FacebookFingerprint} */ (
    /** @type {unknown} */ (options.fingerprint ?? generateFingerprint())
  );
  try {
    await applyFingerprint(page, fingerprint);
    await applyNavigatorOverrides(page, fingerprint);
    await applyWebRTCOverride(page);
    await applyProxyLocation(page, options.proxyLocation);
  } catch (err) {
    // Clean up the page on failure — avoid resource leak and partial-fingerprint state.
    await page.close().catch(() => {});
    throw err;
  }
  (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (page)))._fingerprint = fingerprint;
  return page;
}

/**
 * Detect whether the current page indicates unavailable/restricted content.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
export async function isContentUnavailable(page) {
  if (typeof page.evaluate !== 'function') return false;
  try {
    return await page.evaluate(() => {
      if (typeof document === 'undefined' || !document.body) return false;
      const text = (document.body.innerText || document.body.textContent || '').toLowerCase();
      return (
        text.includes("this content isn't available") ||
        text.includes('this page is unavailable') ||
        text.includes('this content is currently unavailable') ||
        text.includes('comments have been turned off') ||
        text.includes('comments are turned off')
      );
    });
  } catch {
    return false;
  }
}

/**
 * @param {string|null} url
 * @returns {boolean}
 */
export function isCheckpointUrl(url) {
  if (typeof url !== 'string') return false;
  return url.includes('/checkpoint/') || url.includes('facebook.com/checkpoint');
}

/**
 * @param {import('puppeteer').Page} page
 * @param {unknown} source
 * @returns {Promise<void>}
 */
export async function assertNoCheckpoint(page, source = 'search') {
  const currentUrl = typeof page.url === 'function' ? page.url() : null;
  if (isCheckpointUrl(currentUrl)) {
    throw new Error(`❌ Facebook ${source} hit a checkpoint. Account may need security review.`);
  }

  // Check the page body for checkpoint/security-check language.
  let hasBodyCheckpoint = false;
  if (typeof page.evaluate === 'function') {
    try {
      hasBodyCheckpoint = await page.evaluate(() => {
        if (typeof document === 'undefined' || !document.body) return false;
        const text = (document.body.innerText || document.body.textContent || '').toLowerCase();
        return text.includes('checkpoint') || text.includes('security check') || text.includes('confirm your identity');
      });
    } catch {
      // If evaluate is not available or throws, do not block the search.
    }
  }
  if (hasBodyCheckpoint === true) {
    throw new Error(`❌ Facebook ${source} hit a checkpoint. Account may need security review.`);
  }
}

// ============================================================================
// Group Members Scraper (Story 4.6 — FR-20, read-only)
// ============================================================================

// assertFacebookUrl duplicated here to avoid a circular dependency:
// api/services/facebookAutomation.js already imports from this file.
// Keep in sync with api/services/facebookAutomation.js#assertFacebookUrl.
/**
 * @param {string} url
 * @param {unknown} [label]
 * @returns {void}
 */
export function assertFacebookUrlLocal(url, label = 'URL') {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error(`❌ ${label} must be a non-empty string`);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new Error(`❌ ${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`❌ ${label} must be an http(s) URL`);
  }
  const host = parsed.hostname.toLowerCase();
  // Faux-suffix guard: 'notfacebook.com'.endsWith('facebook.com') is true, so an
  // exact-match-OR-dot-prefixed check is required to block look-alike hosts (SSRF).
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) {
    throw new Error(`❌ ${label} must be a facebook.com URL`);
  }
}
