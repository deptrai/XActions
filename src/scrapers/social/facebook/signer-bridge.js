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
import path from 'node:path';

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
    html.match(/"USER_ID":"(\d+)"/) ||
    html.match(/"actor_id":"(\d+)"/) ||
    html.match(/"ACCOUNT_ID":"(\d+)"/);
  result.c_user = cookieUserMatch ? cookieUserMatch[1] : (scriptUserMatch ? scriptUserMatch[1] : '');

  return result;
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

  /** @type {any} */
  #browser = null;

  /** @type {Function | null} */
  #chromeKiller = null;

  /** @type {boolean} */
  #isFirstCall = true;

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
   * Ensure browser connection is ready.
   * @param {string} accountId
   * @returns {Promise<any>}
   */
  async #getBrowser(accountId) {
    if (this.#browser) {
      return this.#browser;
    }

    const effectiveUserDataDir = this.#resolveUserDataDir(accountId);
    const adapter = await this.#resolveAdapter();

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
        proxy: this.proxy,
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
      proxy: this.proxy,
    }));
    return this.#browser;
  }

  /**
   * Extract Facebook tokens from the live page context.
   * @param {string} [accountId='fb-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async extractTokens(accountId = 'fb-guest', cookies = '') {
    const parsedCookies = this.#parseCookies(cookies);
    const parsedCUser = parsedCookies.find((c) => c.name === 'c_user')?.value || '';
    const effectiveAccountId = parsedCUser || accountId;

    let attempt = 0;
    const maxAttempts = 2;
    let lastError = null;

    while (attempt < maxAttempts) {
      attempt++;
      let page = null;
      try {
        const adapter = await this.#resolveAdapter();
        const browser = await this.#getBrowser(effectiveAccountId);
        page = await adapter.newPage(browser, { preserveProfile: true });

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
          setTimeout(() => reject(new Error('Token extraction evaluate timed out')), evalTimeout);
        });

        const rawTokens = /** @type {Record<string, any>} */ (await Promise.race([evalPromise, timeoutPromise]));

        if (!rawTokens.c_user && parsedCUser) {
          rawTokens.c_user = parsedCUser;
        }

        if (!rawTokens.lsd && !rawTokens.fb_dtsg) {
          throw new PlatformError({
            code: 'XACT_4010',
            type: ErrorTypes.AUTH_EXPIRED,
            message: 'Failed to extract Facebook tokens via browser bridge. Session or IP may be checkpointed.',
            suggestedAction: SuggestedActions.ROTATE_ACCOUNT,
            platform: 'facebook',
            accountId: effectiveAccountId,
          });
        }

        return rawTokens;
      } catch (err) {
        lastError = err;
        if (attempt >= maxAttempts) {
          break;
        }
        // Reset browser on failure before retry
        await this.close();
      } finally {
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
