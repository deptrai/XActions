// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookBrowserBridge — Browser-as-Signer adapter for Facebook.
 * Extracts live tokens (lsd, fb_dtsg, jazoest, spin, hsi, c_user) from a real Chrome browser
 * via CDP attach (Playwright by default) or auto-launched Chrome profile.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { getAdapter } from '../../adapters/index.js';
import { launchBrowserWithCdp, launchChrome } from '../../../core/cdp-launcher.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { assertFacebookUrlLocal, NON_PROFILE_SEGMENTS } from '../../facebook/core.js';
import { normalizeProfile, normalizeGroupMember, normalizeHandle } from '../../facebook/normalize.js';
import { normalizeFacebookProfile, normalizeFacebookGroupMember } from './normalize-profile.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Minimal proxy-resolver contract used by the bridge to pick a sticky proxy per account.
 * @typedef {Object} ProxyResolverLike
 * @property {(options?: Record<string, unknown>) => (string | Record<string, unknown> | null)} [getProxy]
 * @property {(accountId: string) => (string | Record<string, unknown> | null)} [getStickyProxy]
 * @property {() => (string | Record<string, unknown> | null)} [getNext]
 * @property {() => (string | Record<string, unknown> | null)} [getRotatingProxy]
 * @property {() => (string | Record<string, unknown> | null)} [getRoundRobinProxy]
 */

/**
 * Decode a cookie value when it may be URL-encoded.
 * @param {string} value
 * @returns {string}
 */
function safeDecodeCookie(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Script executed inside the browser page context to extract Facebook security tokens.
 * @returns {Record<string, any>}
 */
export function extractFacebookTokensScript() {
  /** @type {Record<string, any>} */
  const result = {};
  const html = document.documentElement ? document.documentElement.innerHTML : '';
  const win = /** @type {any} */ (typeof window !== 'undefined' ? window : {});

  // 1. lsd
  const lsdInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="lsd"]'));
  let lsd = lsdInput?.value || '';
  if (!lsd) {
    const lsdMatch =
      html.match(/\["LSD",\[\],\{"token":"([^"]+)"/) ||
      html.match(/"LSD",\[\],\{"token":"([^"]+)"/) ||
      html.match(/LSD\.token\s*=\s*"([^"]+)"/) ||
      html.match(/"token":"([^"]+)","type":"LSD"/) ||
      html.match(/name="lsd"\s+value="([^"]+)"/);
    lsd = lsdMatch ? lsdMatch[1] : '';
  }
  result.lsd = lsd;

  // 2. jazoest
  const jazoestInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="jazoest"]'));
  result.jazoest = jazoestInput?.value || '2953';

  // 3. fb_dtsg / dtsg
  const windowDtsg = win.DTSGInitialData?.token || win.DTSGInitData?.token || '';
  const dtsgMatch =
    html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
    html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
    html.match(/d\.token\s*=\s*"([^"]+)"/) ||
    html.match(/"DTSGInitialData".*?"token":"([^"]+)"/s);
  result.fb_dtsg = windowDtsg || (dtsgMatch ? dtsgMatch[1] : '');
  result.dtsg = result.fb_dtsg;

  // 4. spin_r / __spin_r
  const windowSpinR = win.__spin_r !== undefined ? Number(win.__spin_r) : null;
  const spinRMatch =
    html.match(/"__spin_r":(\d+)/) ||
    html.match(/window\.__spin_r\s*=\s*["']?(\d+)["']?/) ||
    html.match(/"site_data":\{"__spin_r":(\d+)/);
  result.spin_r = windowSpinR !== null && !Number.isNaN(windowSpinR) ? windowSpinR : (spinRMatch ? Number(spinRMatch[1]) : 1016839210);

  // 5. spin_t / __spin_t
  const windowSpinT = win.__spin_t !== undefined ? Number(win.__spin_t) : null;
  const spinTMatch =
    html.match(/"__spin_t":(\d+)/) ||
    html.match(/window\.__spin_t\s*=\s*["']?(\d+)["']?/);
  result.spin_t = windowSpinT !== null && !Number.isNaN(windowSpinT) ? windowSpinT : (spinTMatch ? Number(spinTMatch[1]) : Math.floor(Date.now() / 1000));

  // 6. hsi / __hsi
  const windowHsi = win.__hsi ? String(win.__hsi) : '';
  const hsiMatch =
    html.match(/"__hsi":"([^"]+)"/) ||
    html.match(/window\.__hsi\s*=\s*["']([^"']+)["']/);
  result.hsi = windowHsi || (hsiMatch ? hsiMatch[1] : '');

  // 7. __rev
  const windowRev = win.__rev ? String(win.__rev) : '';
  const revMatch =
    html.match(/window\.__rev\s*=\s*["']([^"']+)["']/) ||
    html.match(/"__rev":(\d+)/) ||
    html.match(/window\.__rev\s*=\s*(\d+)/) ||
    html.match(/"server_revision":(\d+)/);
  result.__rev = windowRev || (revMatch ? revMatch[1] : '1016839210');

  // 8. c_user / __user
  const cookieUserMatch = document.cookie ? document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/) : null;
  const scriptUserMatch =
    html.match(/["']?USER_ID["']?\s*:\s*(?:"(\d+)"|(\d+))/) ||
    html.match(/["']?actor_id["']?\s*:\s*(?:"(\d+)"|(\d+))/) ||
    html.match(/["']?ACCOUNT_ID["']?\s*:\s*(?:"(\d+)"|(\d+))/);
  result.c_user = cookieUserMatch ? cookieUserMatch[1] : (scriptUserMatch ? (scriptUserMatch[1] || scriptUserMatch[2]) : '');

  return result;
}

/**
 * Parse a human-readable count (e.g. "12.5K", "3M", "1,234") into a number.
 * @param {unknown} input
 * @returns {number}
 */
function parseHumanCount(input) {
  if (input == null) return 0;
  if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  const str = String(input).trim();
  if (!str) return 0;
  const m = str.match(/^([\d,.]+)\s*([KkMmBb])?$/);
  if (!m) return 0;
  let value = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(value)) return 0;
  const suffix = m[2]?.toUpperCase();
  if (suffix === 'K') value *= 1_000;
  if (suffix === 'M') value *= 1_000_000;
  if (suffix === 'B') value *= 1_000_000_000;
  return Math.max(0, Math.floor(value));
}

/**
 * Resolve a Facebook handle input to a clean handle/path suitable for mbasic.
 * @param {string} input
 * @returns {string}
 */
function resolveProfileHandle(input) {
  if (/^\d+$/.test(input)) return input;
  return normalizeHandle(input);
}

/**
 * Extract profile fields from a loaded mbasic/desktop page.
 * This is a standalone function so it can be passed to adapter.evaluate().
 * @param {string} handle
 * @returns {Record<string, any> | null}
 */
function extractMbasicProfileFromDom(handle) {
  const body = document.body;
  if (!body) return null;

  const bodyText = (body.textContent || body.innerText || '').trim();
  const pageTitle = (document.title || '').trim();

  const getMeta = (/** @type {string} */ prop) => {
    const el = document.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
    return el?.getAttribute('content') || null;
  };

  const isGibberishName = (/** @type {string | null | undefined} */ n) => {
    if (!n) return true;
    const trimmed = n.trim();
    if (!trimmed) return true;
    if (/^[\d,.$\s]+$/.test(trimmed)) return true;
    if (/\d+\s*(friends?|followers?|likes?)/i.test(trimmed)) return true;
    if (/^(facebook|log\s*in|home|search|messages?|notifications?|menu|find friends|add friends|friend requests|suggested for you|people you may know|add friend|edit profile|this browser isn\'t supported|add to story)$/i.test(trimmed)) return true;
    return false;
  };

  // Detect a login wall before extracting content.
  const hasLoginForm = !!document.querySelector('form[action*="login"], [data-testid="royal_login_form"]');
  const hasLoginIndicators = /log\s*in\s*(?:to\s*(?:view|facebook))?/i.test(bodyText) &&
    (/forgot(?:ten)?\s*(?:account|password)/i.test(bodyText) ||
     /create\s*new\s*account/i.test(bodyText) ||
     /password/i.test(bodyText));
  if (hasLoginForm || hasLoginIndicators || /^log\s*in\s*to\s*view/i.test(bodyText)) {
    return null;
  }

  // Name: prefer document.title, then og:title, then h1, then other headings.
  let name = null;
  const ogTitle = getMeta('og:title');
  for (const candidate of [pageTitle, ogTitle]) {
    if (typeof candidate !== 'string') continue;
    const stripped = candidate
      .replace(/\s*[-\u00b7\u2014\u2013]\s*\d[\d,.]*\s*(?:friends?|followers?|likes?)\s*$/i, '')
      .replace(/\s*\d[\d,.]*\s*(?:friends?|followers?|likes?)\s*$/i, '')
      .replace(/\s*\|\s*Facebook\s*$/i, '')
      .replace(/\s*-\s*Facebook\s*$/i, '')
      .trim();
    if (stripped && !isGibberishName(stripped)) {
      name = stripped;
      break;
    }
  }

  if (isGibberishName(name)) {
    const h1 = document.querySelector('h1');
    const h1Text = h1?.textContent?.trim() || h1?.innerText?.trim() || null;
    if (h1Text && !isGibberishName(h1Text)) name = h1Text;
  }

  if (isGibberishName(name)) {
    const candidates = document.querySelectorAll('h2, strong, div[role="main"] h3, div#root h3, .actor, a[href*="/profile.php"]');
    for (const el of candidates) {
      const txt = el.textContent?.trim() || el.innerText?.trim();
      if (txt && !isGibberishName(txt)) {
        name = txt;
        break;
      }
    }
  }

  // Avatar from Open Graph first, then DOM img fallbacks.
  let avatar = getMeta('og:image');
  if (!avatar) {
    const avatarImg = document.querySelector('img[alt*="profile"], img[src*="scontent"], a[href*="photo.php"] img, img.profPic');
    if (avatarImg) {
      avatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || null;
    }
  }

  // Followers / likes / friends counts from body text.
  let followers = null;
  const followerMatch = bodyText.match(/([\d,.]+[KkMmBb]?)\s*(followers?|people\s+follow|likes?|friends?)/i);
  if (followerMatch) followers = followerMatch[1];

  // Bio from og:description (strip counts) or first paragraph.
  let bio = null;
  const ogDescription = getMeta('og:description');
  if (typeof ogDescription === 'string') {
    bio = ogDescription.replace(/^[\d,.]+[KkMmBb]?\s*(followers?|friends?|people\s+follow|likes?)\b[^.]*[.\u00b7]/i, '').trim() || null;
  }
  if (!bio) {
    const paragraphs = document.querySelectorAll('div[role="main"] p, div#root p, p');
    for (const p of paragraphs) {
      const txt = p.textContent?.trim() || p.innerText?.trim();
      if (txt && txt !== name && !/\b(followers?|likes?)\b/i.test(txt)) {
        bio = txt;
        break;
      }
    }
  }

  // Numeric user id from the final URL for profile.php?id= inputs.
  const pageUrl = window.location.href;
  let userId = null;
  const idMatch = pageUrl.match(/[?&]id=(\d+)/);
  if (idMatch) userId = idMatch[1];

  // Return raw meta/DOM fields so the legacy normalizeProfile can parse them.
  return {
    ogTitle: name || pageTitle,
    ogDescription: typeof ogDescription === 'string' ? ogDescription : (bio || ''),
    ogImage: avatar,
    domFollowers: followers,
    pageUrl,
    userId,
  };
}

/**
 * Extract group member links from a loaded group /members page.
 * This is a standalone function so it can be passed to adapter.evaluate().
 * @returns {Record<string, any>[]}
 */
function extractGroupMembersFromDom() {
  /** @type {Record<string, any>[]} */
  const results = [];
  const seen = new Set();
  const links = document.querySelectorAll('a[href*="/groups/"][href*="/user/"]');
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const name = a.textContent?.trim() || a.innerText?.trim() || '';
    if (!name || name.length <= 1 || name.length >= 100) continue;
    let fullUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href;
    fullUrl = fullUrl.split('?')[0].replace(/\/$/, '');
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    const parts = fullUrl.split('/').filter(Boolean);
    const userId = parts[parts.length - 1] || '';
    results.push({
      id: userId,
      name,
      username: userId,
      profileUrl: fullUrl,
      platform: 'facebook',
    });
  }
  return results;
}

export class FacebookBrowserBridge {
  /** @type {string} */
  baseUrl;

  /** @type {import('../../adapters/base.js').BaseAdapter | null} */
  adapter;

  /** @type {string | null} */
  cdpUrl;

  /** @type {boolean} */
  launchChrome;

  /** @type {string} */
  adapterName;

  /** @type {boolean} */
  headless;

  /** @type {string | null} */
  userDataDir;

  /** @type {string | null} */
  profileDir;

  /** @type {any} */
  proxy;

  /** @type {ProxyResolverLike | null} */
  proxyPool = null;

  /** @type {ProxyResolverLike | null} */
  proxyProvider = null;

  /** @type {string[]} */
  extraArgs = [];

  /** @type {any} */
  #browser = null;

  /** @type {Function | null} */
  #chromeKiller = null;

  /** @type {boolean} */
  #isFirstCall = true;

  /** @type {Promise<any> | null} */
  #launchPromise = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl='https://www.facebook.com']
   * @param {import('../../adapters/base.js').BaseAdapter} [options.adapter]
   * @param {string} [options.cdpUrl]
   * @param {boolean} [options.launchChrome=false]
   * @param {string} [options.adapterName]
   * @param {boolean} [options.headless=true]
   * @param {string} [options.userDataDir]
   * @param {string} [options.profileDir]
   * @param {any} [options.proxy]
   * @param {ProxyResolverLike | null} [options.proxyPool]
   * @param {ProxyResolverLike | null} [options.proxyProvider]
   * @param {string[]} [options.extraArgs]
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : 'https://www.facebook.com';
    this.adapterName = options.adapterName || process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright';
    this.adapter = options.adapter || null;
    this.cdpUrl = options.cdpUrl || null;
    this.launchChrome = Boolean(options.launchChrome);
    this.headless = options.headless ?? true;
    this.userDataDir = options.userDataDir || null;
    this.profileDir = options.profileDir || null;
    this.proxy = options.proxy || null;
    this.proxyPool = options.proxyPool || null;
    this.proxyProvider = options.proxyProvider || null;
    this.extraArgs = options.extraArgs || [];
  }

  /**
   * Initialize bridge and resolve adapter.
   * @returns {Promise<this>}
   */
  async init() {
    await this.#resolveAdapter();
    return this;
  }

  /**
   * Resolve adapter instance lazily.
   * @returns {Promise<import('../../adapters/base.js').BaseAdapter>}
   */
  async #resolveAdapter() {
    if (this.adapter) return this.adapter;
    this.adapter = await getAdapter(this.adapterName);
    return this.adapter;
  }

  /**
   * Deterministic user data dir per accountId / c_user.
   * @param {string} accountId
   * @returns {string}
   */
  #resolveUserDataDir(accountId) {
    if (this.userDataDir) return this.userDataDir;
    if (this.profileDir) return this.profileDir;
    const cleanId = String(accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(process.cwd(), '.data', 'facebook-profiles', cleanId);
  }

  /**
   * Parse raw cookie string or record array into standard adapter cookies format.
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
   * @returns {Array<{ name: string, value: string, domain: string, path: string }>}
   */
  #parseCookies(cookies) {
    let hostname = 'facebook.com';
    try {
      hostname = new URL(this.baseUrl).hostname;
    } catch {}

    const result = [];
    if (typeof cookies === 'string') {
      const pairs = cookies.split(';');
      for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx !== -1) {
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          if (name) {
            result.push({ name, value, domain: hostname, path: '/' });
          }
        }
      }
    } else if (Array.isArray(cookies)) {
      for (const c of cookies) {
        if (!c || typeof c !== 'object') continue;
        const item = /** @type {any} */ (c);
        result.push({
          name: item.name,
          value: item.value,
          domain: item.domain || hostname,
          path: item.path || '/',
        });
      }
    } else if (cookies && typeof cookies === 'object') {
      for (const [k, v] of Object.entries(cookies)) {
        result.push({ name: k, value: String(v), domain: hostname, path: '/' });
      }
    }
    return result;
  }

  /**
   * Resolve the sticky proxy for an account using proxyProvider/proxyPool if present,
   * falling back to the explicit `proxy` option.
   * @param {string} accountId
   * @returns {any}
   */
  #resolveProxy(accountId) {
    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      try {
        const p = this.proxyProvider.getProxy({ accountId });
        if (p) return p;
      } catch {
        // fallthrough
      }
    }
    if (this.proxyPool) {
      if (typeof this.proxyPool.getStickyProxy === 'function') {
        try {
          const p = this.proxyPool.getStickyProxy(accountId);
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getNext === 'function') {
        try {
          const p = this.proxyPool.getNext();
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getRotatingProxy === 'function') {
        try {
          const p = this.proxyPool.getRotatingProxy();
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getRoundRobinProxy === 'function') {
        try {
          const p = this.proxyPool.getRoundRobinProxy();
          if (p) return p;
        } catch {}
      }
    }
    return this.proxy;
  }

  /**
   * Ensure browser connection is ready with mutex protection against parallel launches.
   * @param {string} accountId
   * @returns {Promise<any>}
   */
  async #getBrowser(accountId) {
    if (this.#browser) {
      return this.#browser;
    }
    if (this.#launchPromise) {
      return this.#launchPromise;
    }

    this.#launchPromise = (async () => {
      try {
        const effectiveUserDataDir = this.#resolveUserDataDir(accountId);
        try {
          fs.mkdirSync(effectiveUserDataDir, { recursive: true });
        } catch {}
        const adapter = await this.#resolveAdapter();
        const proxy = this.#resolveProxy(accountId);

        if (this.cdpUrl) {
          this.#browser = await launchBrowserWithCdp(this.cdpUrl, {
            adapter,
            preserveProfile: true,
          });
          return this.#browser;
        }

        if (this.launchChrome) {
          const launched = await launchChrome({
            userDataDir: effectiveUserDataDir,
            headless: this.headless,
            proxy,
            extraArgs: this.extraArgs,
          });
          this.#chromeKiller = launched.kill;
          this.#browser = await launchBrowserWithCdp(launched.cdpUrl, {
            adapter,
            preserveProfile: true,
          });
          return this.#browser;
        }

        // Default: launch fresh browser instance via adapter
        this.#browser = await adapter.launch(/** @type {any} */ ({
          headless: this.headless,
          userDataDir: effectiveUserDataDir,
          proxy,
          extraArgs: this.extraArgs,
        }));
        return this.#browser;
      } finally {
        this.#launchPromise = null;
      }
    })();

    return this.#launchPromise;
  }

  /**
   * Extract Facebook tokens from the live page context.
   * Creates a fresh BrowserContext per call (Playwright) so different accounts never share
   * cookies. Callers using `XACTIONS_SCRAPER_ADAPTER=puppeteer` must use one bridge per account
   * because the current PuppeteerAdapter does not create incognito contexts.
   * @param {string} [accountId='fb-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async extractTokens(accountId = 'fb-guest', cookies = '') {
    const parsedCookies = this.#parseCookies(cookies);
    const rawCUser = parsedCookies.find((c) => c.name === 'c_user')?.value || '';
    const parsedCUser = safeDecodeCookie(rawCUser);
    const effectiveAccountId = parsedCUser || accountId;

    let attempt = 0;
    const maxAttempts = 2;
    let lastError = null;

    while (attempt < maxAttempts) {
      attempt++;
      let page = null;
      let timeoutId = null;
      try {
        const adapter = await this.#resolveAdapter();
        const browser = await this.#getBrowser(effectiveAccountId);
        // Use a fresh context per extraction to prevent account cookie sharing (AC-6).
        page = await adapter.newPage(browser, { preserveProfile: false });

        if (parsedCookies.length > 0) {
          await adapter.setCookies(page, parsedCookies);
        }

        const navTimeout = this.#isFirstCall ? 30000 : 15000;
        await adapter.goto(page, `${this.baseUrl}/`, {
          waitUntil: 'networkidle',
          timeout: navTimeout,
        });

        const evalTimeout = this.#isFirstCall ? 8000 : 3000;
        this.#isFirstCall = false;

        const evalPromise = adapter.evaluate(page, extractFacebookTokensScript);
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Token extraction evaluate timed out')), evalTimeout);
        });

        const rawTokens = /** @type {Record<string, any>} */ (await Promise.race([evalPromise, timeoutPromise]));

        if (!rawTokens.c_user && parsedCUser) {
          rawTokens.c_user = parsedCUser;
        }

        if (rawTokens.c_user) {
          rawTokens.c_user = safeDecodeCookie(String(rawTokens.c_user));
        }

        if (!rawTokens.lsd && !rawTokens.fb_dtsg) {
          throw new PlatformError({
            code: 'XACT_5030',
            type: ErrorTypes.INTERNAL,
            message: 'Failed to extract Facebook tokens via browser bridge. Session or IP may be checkpointed.',
            suggestedAction: SuggestedActions.RELOGIN,
            platform: 'facebook',
            accountId: effectiveAccountId,
          });
        }

        return rawTokens;
      } catch (err) {
        lastError = err;
        if (page && this.adapter) {
          try {
            await this.adapter.closePage(page);
          } catch {}
          page = null;
        }
        if (attempt >= maxAttempts) {
          break;
        }
        // Reset browser on failure before retry
        await this.close();
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (page && this.adapter) {
          try {
            await this.adapter.closePage(page);
          } catch {}
        }
      }
    }

    if (lastError instanceof PlatformError) {
      throw lastError;
    }

    throw new PlatformError({
      code: 'XACT_5030',
      type: ErrorTypes.INTERNAL,
      message: `Facebook browser token extraction failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      suggestedAction: SuggestedActions.RELOGIN,
      platform: 'facebook',
      accountId: effectiveAccountId,
      cause: lastError,
    });
  }

  /**
   * Resolve a base URL for profile fallback. Defaults to mbasic because it is
   * lighter and less bot-sensitive, but honors test/local overrides.
   * @param {string} [baseUrl]
   * @returns {string}
   */
  #resolveProfileBaseUrl(baseUrl) {
    const input = (baseUrl || this.baseUrl || 'https://mbasic.facebook.com').replace(/\/+$/, '');
    if (input === 'https://www.facebook.com' || input === 'http://www.facebook.com') {
      return 'https://mbasic.facebook.com';
    }
    return input;
  }

  /**
   * Small delay helper used between scroll/extraction iterations.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll the DOM for a selector using repeated adapter.evaluate() calls.
   * @param {import('../../adapters/base.js').BaseAdapter} adapter
   * @param {any} page
   * @param {string} selector
   * @param {number} timeout
   * @returns {Promise<boolean>}
   */
  async #pollForSelector(adapter, page, selector, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = /** @type {boolean} */ (await adapter.evaluate(page, (/** @type {any} */ sel) => {
        return document.querySelector(sel) !== null;
      }, selector));
      if (found) return true;
      await this.#sleep(500);
    }
    return false;
  }

  /**
   * Scrape a Facebook profile via the browser bridge (mbasic-first).
   * @param {string} username
   * @param {Object} [options={}]
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies]
   * @param {string} [options.accountId]
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout]
   * @returns {Promise<import('../../../core/types.js').ProfileItem>}
   */
  async scrapeProfile(username, options = {}) {
    if (!username || typeof username !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Profile username is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = options.accountId || 'fb-guest';
    const baseUrl = this.#resolveProfileBaseUrl(options.baseUrl);
    const handle = resolveProfileHandle(username);
    const isNumeric = /^\d+$/.test(handle);
    const profilePath = isNumeric ? 'profile.php?id=' + handle : handle;
    const profileUrl = baseUrl + '/' + profilePath + (profilePath.includes('?') ? '&' : '?') + 'v=timeline';
    const timeout = options.timeout || 30000;

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId);
    let page = null;
    try {
      page = await adapter.newPage(browser, { preserveProfile: false });

      const parsedCookies = this.#parseCookies(options.cookies || '');
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }

      await adapter.goto(page, profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const raw = /** @type {Record<string, any> | null} */ (await adapter.evaluate(page, /** @type {any} */ (extractMbasicProfileFromDom), handle));

      if (!raw || (!raw.ogTitle && !raw.ogDescription && !raw.ogImage)) {
        throw new PlatformError({
          code: 'XACT_4004',
          type: ErrorTypes.INVALID_ARGS,
          message: 'Profile not found via browser fallback',
          suggestedAction: SuggestedActions.RELOGIN,
          platform: 'facebook',
          accountId,
        });
      }

      const legacy = normalizeProfile(raw, handle);
      if (!legacy.name && !legacy.bio && !legacy.avatar && !legacy.followers) {
        throw new PlatformError({
          code: 'XACT_4004',
          type: ErrorTypes.INVALID_ARGS,
          message: 'Profile not found via browser fallback',
          suggestedAction: SuggestedActions.RELOGIN,
          platform: 'facebook',
          accountId,
        });
      }

      const externalId = raw.userId || handle;
      const rawForProfile = {
        id: externalId,
        name: legacy.name,
        username: legacy.username,
        bio_text: { text: legacy.bio || '' },
        profile_picture: { uri: legacy.avatar || '' },
        profile_url: legacy.url || profileUrl,
        follower_count: parseHumanCount(legacy.followers),
      };
      const profile = normalizeFacebookProfile(rawForProfile, 'browser');
      if (!profile) {
        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Failed to normalize profile from browser fallback',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'facebook',
          accountId,
        });
      }
      return profile;
    } finally {
      if (page && this.adapter) {
        try {
          await this.adapter.closePage(page);
        } catch {}
      }
    }
  }

  /**
   * Scrape the members of a Facebook group via the browser bridge.
   * @param {string} groupUrl - Full group URL or group id/slug
   * @param {Object} [options={}]
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies]
   * @param {string} [options.accountId]
   * @param {number} [options.limit]
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout]
   * @returns {Promise<{ members: import('../../../core/types.js').ProfileItem[], note?: string, pageInfo?: any }>}
   */
  async scrapeGroupMembers(groupUrl, options = {}) {
    if (!groupUrl || typeof groupUrl !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Group URL or groupId is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = options.accountId || 'fb-guest';
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(Math.floor(options.limit), 1000)
      : 100;
    const timeout = options.timeout || 30000;
    const baseUrl = (options.baseUrl || this.baseUrl || 'https://www.facebook.com').replace(/\/+$/, '');

    let resolvedGroupUrl = groupUrl.trim();
    if (!/^https?:\/\//i.test(resolvedGroupUrl)) {
      resolvedGroupUrl = baseUrl + '/groups/' + resolvedGroupUrl.replace(/^\/+/, '');
    } else {
      assertFacebookUrlLocal(resolvedGroupUrl, 'groupUrl');
    }
    const membersUrl = resolvedGroupUrl.replace(/\/$/, '') + '/members';
    const groupMatch = resolvedGroupUrl.match(/\/groups\/([^/?#]+)/);
    const groupId = groupMatch ? groupMatch[1] : groupUrl;

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId);
    let page = null;
    try {
      page = await adapter.newPage(browser, { preserveProfile: false });

      const parsedCookies = this.#parseCookies(options.cookies || '');
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }

      await adapter.goto(page, membersUrl, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const memberSelector = 'a[href*="/groups/"][href*="/user/"]';
      const hasMembers = await this.#pollForSelector(adapter, page, memberSelector, 10000);

      if (!hasMembers) {
        return {
          members: [],
          note: 'Group is private or members list is restricted. Please retry with relogin if you are a member.',
          pageInfo: null,
        };
      }

      const members = new Map();
      let stalls = 0;
      const maxStalls = 5;

      while (members.size < limit && stalls < maxStalls) {
        const prevSize = members.size;
        const rawMembers = /** @type {Record<string, any>[]} */ (await adapter.evaluate(page, extractGroupMembersFromDom));

        for (const raw of rawMembers) {
          if (members.has(raw.profileUrl)) continue;
          const legacy = normalizeGroupMember(/** @type {any} */ (raw));
          const externalId = raw.id || legacy.username || '';
          if (!externalId) continue;
          const rawForMember = {
            id: externalId,
            name: legacy.name,
            username: legacy.username,
            profile_url: legacy.profileUrl,
          };
          const member = normalizeFacebookGroupMember(rawForMember, groupId, 'browser');
          if (!member) continue;
          members.set(raw.profileUrl, member);
          if (members.size >= limit) break;
        }

        if (members.size === prevSize) {
          stalls++;
        } else {
          stalls = 0;
        }

        if (members.size >= limit) break;

        await adapter.scroll(page, { y: 1000 });
        await this.#sleep(1000 + Math.floor(Math.random() * 1000));
      }

      const results = Array.from(members.values());
      if (results.length === 0) {
        return {
          members: [],
          note: 'Group is private or members list is restricted. Please retry with relogin if you are a member.',
          pageInfo: null,
        };
      }

      return {
        members: results,
        pageInfo: { has_next_page: false, end_cursor: null },
      };
    } finally {
      if (page && this.adapter) {
        try {
          await this.adapter.closePage(page);
        } catch {}
      }
    }
  }

  /**
   * Execute an operation inside a browser page context with cookie setup and cleanup.
   * @template T
   * @param {(page: any) => Promise<T>} fn
   * @param {Object} [options={}]
   * @param {string} [options.accountId='fb-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies='']
   * @returns {Promise<T>}
   */
  async withPage(fn, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const { accountId = 'fb-guest', cookies = '' } = opts;
    const parsedCookies = this.#parseCookies(cookies);
    const rawCUser = parsedCookies.find((c) => c.name === 'c_user')?.value || '';
    const parsedCUser = safeDecodeCookie(rawCUser);
    const effectiveAccountId = parsedCUser || accountId;

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(effectiveAccountId);
    const page = await adapter.newPage(browser, { preserveProfile: false });

    try {
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }
      const nativePage = page?._native || page;
      return await fn(nativePage);
    } catch (err) {
      if (this.#browser && typeof this.#browser.isConnected === 'function' && !this.#browser.isConnected()) {
        await this.close();
      }
      throw err;
    } finally {
      try {
        await adapter.closePage(page);
      } catch {}
    }
  }

  /**
   * Close any open browser sessions and kill auto-launched Chrome processes.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#browser && this.adapter) {
      try {
        await this.adapter.closeBrowser(this.#browser);
      } catch {}
      this.#browser = null;
    }
    if (this.#chromeKiller) {
      try {
        await this.#chromeKiller();
      } catch {}
      this.#chromeKiller = null;
    }
  }
}
