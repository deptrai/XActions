// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * TikTokBrowserBridge — Browser-as-Signer adapter for TikTok Web.
 *
 * TikTok's anti-bot runtime (webmssdk / secsdk) is environment-dependent and
 * minified, making static reverse-engineering impractical. This bridge opens a
 * real TikTok page in a headless browser, lets the platform's own JS warm up,
 * then signs outbound API requests by hooking `fetch` so the runtime appends
 * the live `a_bogus`, `msToken`, and `X-Gnarly` tokens.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { getAdapter } from '../../adapters/index.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Minimal proxy-resolver contract used by the bridge to pick a sticky proxy per account.
 * @typedef {Object} ProxyResolverLike
 * @property {(options?: Record<string, unknown>) => (string | Record<string, unknown> | null)} [getProxy]
 * @property {(accountId: string, requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getStickyProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getNext]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRotatingProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRoundRobinProxy]
 */

/**
 * @typedef {Record<string, any> & { server: string, username?: string, password?: string }} NormalizedPlaywrightProxy
 */

/**
 * Resolve a proxy string into a Playwright-compatible proxy object.
 * @param {string | Record<string, unknown> | null} proxy
 * @returns {NormalizedPlaywrightProxy | null}
 */
function normalizeProxy(proxy) {
  if (!proxy) return null;
  if (typeof proxy === 'string') {
    try {
      const url = new URL(proxy);
      const result = /** @type {NormalizedPlaywrightProxy} */ ({ server: `${url.protocol}//${url.host}` });
      if (url.username) result.username = decodeURIComponent(url.username);
      if (url.password) result.password = decodeURIComponent(url.password);
      return result;
    } catch {
      return /** @type {NormalizedPlaywrightProxy} */ ({ server: proxy });
    }
  }
  if (typeof proxy === 'object') {
    const p = /** @type {Record<string, any>} */ (proxy);
    if (p.server) return /** @type {NormalizedPlaywrightProxy} */ (p);
    if (p.host && p.port) {
      return /** @type {NormalizedPlaywrightProxy} */ ({
        server: `${p.scheme || 'http'}://${p.host}:${p.port}`,
        username: p.username,
        password: p.password,
      });
    }
  }
  return null;
}

/**
 * Script executed inside the TikTok page context to trigger a signed API request.
 * The platform's own fetch hook (webmssdk) rewrites the URL with anti-bot tokens.
 * @param {string} url
 * @param {string} [init]
 * @returns {Promise<string>}
 */
function triggerSignedFetch(url, init) {
  const options = init ? JSON.parse(init) : { credentials: 'include', mode: 'cors' };
  return fetch(url, options).then(
    () => 'ok',
    (err) => String(err?.message || err)
  );
}

/**
 * Extract relevant session cookies from the document context.
 * @returns {{ ttwid: string, msToken: string, deviceId: string }}
 */
function extractTikTokCookiesFromDom() {
  const cookie = document.cookie || '';
  const ttwidMatch = cookie.match(/(?:^|;\s*)ttwid=([^;]+)/);
  const msTokenMatch = cookie.match(/(?:^|;\s*)msToken=([^;]+)/);

  /** @type {any} */
  const win = typeof window !== 'undefined' ? window : {};
  const deviceId =
    win.__tea_sdk_id ||
    win._byted_acrawler?.id ||
    win.__device_id ||
    '';

  return {
    ttwid: ttwidMatch ? decodeURIComponent(ttwidMatch[1]) : '',
    msToken: msTokenMatch ? decodeURIComponent(msTokenMatch[1]) : '',
    deviceId: String(deviceId),
  };
}

export class TikTokBrowserBridge {
  /** @type {string} */
  baseUrl;

  /** @type {import('../../adapters/base.js').BaseAdapter | null} */
  adapter;

  /** @type {string} */
  adapterName;

  /** @type {boolean} */
  headless;

  /** @type {any} */
  proxy;

  /** @type {ProxyResolverLike | null} */
  proxyPool = null;

  /** @type {ProxyResolverLike | null} */
  proxyProvider = null;

  /** @type {any} */
  #browser = null;

  /** @type {Promise<any> | null} */
  #launchPromise = null;

  /** @type {any} */
  #warmedPage = null;

  /** @type {boolean} */
  #isFirstCall = true;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl='https://www.tiktok.com']
   * @param {import('../../adapters/base.js').BaseAdapter} [options.adapter]
   * @param {string} [options.adapterName]
   * @param {boolean} [options.headless=true]
   * @param {any} [options.proxy]
   * @param {ProxyResolverLike | null} [options.proxyPool]
   * @param {ProxyResolverLike | null} [options.proxyProvider]
   * @param {boolean} [options.requiresResidential=false]
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : 'https://www.tiktok.com';
    this.adapterName = options.adapterName || process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright';
    this.adapter = options.adapter || null;
    this.headless = options.headless ?? true;
    this.proxy = options.proxy || null;
    this.proxyPool = options.proxyPool || null;
    this.proxyProvider = options.proxyProvider || null;
    this.requiresResidential = Boolean(options.requiresResidential);
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
   * @returns {Promise<import('../../adapters/base.js').BaseAdapter>}
   */
  async #resolveAdapter() {
    if (this.adapter) return this.adapter;
    this.adapter = await getAdapter(this.adapterName);
    return this.adapter;
  }

  /**
   * @param {string} accountId
   * @returns {string}
   */
  #resolveUserDataDir(accountId) {
    const cleanId = String(accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(process.cwd(), '.data', 'tiktok-profiles', cleanId);
  }

  /**
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
   * @returns {Array<{ name: string, value: string, domain: string, path: string }>}
   */
  #parseCookies(cookies) {
    let hostname = 'tiktok.com';
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
   * @param {string} accountId
   * @param {boolean} [requiresResidential=false]
   * @returns {any}
   */
  #resolveProxy(accountId, requiresResidential = false) {
    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      try {
        const p = this.proxyProvider.getProxy({ accountId, requiresResidential });
        if (p) return normalizeProxy(p);
      } catch {}
    }
    if (this.proxyPool) {
      if (typeof this.proxyPool.getStickyProxy === 'function') {
        try {
          const p = this.proxyPool.getStickyProxy(accountId, requiresResidential);
          if (p) return normalizeProxy(p);
        } catch {}
      } else if (typeof this.proxyPool.getNext === 'function') {
        try {
          const p = this.proxyPool.getNext(requiresResidential);
          if (p) return normalizeProxy(p);
        } catch {}
      } else if (typeof this.proxyPool.getRotatingProxy === 'function') {
        try {
          const p = this.proxyPool.getRotatingProxy(requiresResidential);
          if (p) return normalizeProxy(p);
        } catch {}
      } else if (typeof this.proxyPool.getRoundRobinProxy === 'function') {
        try {
          const p = this.proxyPool.getRoundRobinProxy(requiresResidential);
          if (p) return normalizeProxy(p);
        } catch {}
      }
    }
    return normalizeProxy(this.proxy);
  }

  /**
   * Ensure browser connection is ready with mutex protection against parallel launches.
   * @param {string} accountId
   * @param {boolean} [requiresResidential=false]
   * @returns {Promise<any>}
   */
  async #getBrowser(accountId, requiresResidential = false) {
    if (this.#browser) return this.#browser;
    if (this.#launchPromise) return this.#launchPromise;

    this.#launchPromise = (async () => {
      try {
        const userDataDir = this.#resolveUserDataDir(accountId);
        try {
          fs.mkdirSync(userDataDir, { recursive: true });
        } catch {}

        const adapter = await this.#resolveAdapter();
        const proxy = this.#resolveProxy(accountId, requiresResidential);

        this.#browser = await adapter.launch(/** @type {Record<string, any>} */ ({
          headless: this.headless,
          userDataDir,
          proxy,
          args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
          ],
        }));
        return this.#browser;
      } finally {
        this.#launchPromise = null;
      }
    })();

    return this.#launchPromise;
  }

  /**
   * Open a TikTok page and capture the initial session tokens.
   * @param {string} [accountId='tiktok-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {Promise<{ ttwid: string, msToken: string, deviceId: string }>}
   */
  async extractSession(accountId = 'tiktok-guest', cookies = '') {
    const parsedCookies = this.#parseCookies(cookies);
    const rawTtwid = parsedCookies.find((c) => c.name === 'ttwid')?.value || '';
    const rawMsToken = parsedCookies.find((c) => c.name === 'msToken')?.value || '';

    if (rawTtwid && rawMsToken) {
      return { ttwid: rawTtwid, msToken: rawMsToken, deviceId: '' };
    }

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId, this.requiresResidential);
    const page = await adapter.newPage(browser, { preserveProfile: false });

    try {
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }

      const navTimeout = this.#isFirstCall ? 45000 : 25000;
      await adapter.goto(page, `${this.baseUrl}/foryou`, {
        waitUntil: 'networkidle',
        timeout: navTimeout,
      });
      this.#isFirstCall = false;

      const tokens = /** @type {{ ttwid: string, msToken: string, deviceId: string }} */ (
        await adapter.evaluate(page, extractTikTokCookiesFromDom)
      );

      if (!tokens.ttwid && !tokens.msToken) {
        throw new PlatformError({
          code: 'XACT_4010',
          type: ErrorTypes.AUTH_EXPIRED,
          message: 'TikTok session cookies could not be extracted from the browser. Proxy or IP may be blocked.',
          suggestedAction: SuggestedActions.RELOGIN,
          platform: 'tiktok',
          accountId,
        });
      }

      this.#warmedPage = page;
      return tokens;
    } catch (err) {
      if (page && this.adapter) {
        try {
          await this.adapter.closePage(page);
        } catch {}
      }
      throw err;
    }
  }

  /**
   * Sign a TikTok Web API URL using the live anti-bot runtime in the browser.
   * @param {string} url
   * @param {Object} [options={}]
   * @param {string} [options.userAgent]
   * @param {string | Record<string, string>} [options.cookies]
   * @returns {Promise<{ query: Record<string, string>, cookies: Record<string, string> }>}
   */
  async signUrl(url, options = {}) {
    const { cookies } = options || {};
    const parsedUrl = new URL(url);
    const accountId = 'tiktok-guest';

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId, this.requiresResidential);

    // Reuse a warmed page if available, otherwise create a fresh one.
    let page = this.#warmedPage;
    if (!page) {
      page = await adapter.newPage(browser, { preserveProfile: false });
      const parsedCookies = this.#parseCookies(cookies || '');
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }
      await adapter.goto(page, `${this.baseUrl}/foryou`, {
        waitUntil: 'networkidle',
        timeout: 45000,
      });
      this.#warmedPage = page;
    } else {
      // Ensure the page still has a valid frame.
      try {
        await adapter.evaluate(page, () => document.title);
      } catch {
        this.#warmedPage = null;
        return this.signUrl(url, options);
      }
    }

    // Set up a one-shot listener that captures the signed request URL.
    const nativePage = page._native || page;
    /** @type {string | null} */
    let signedUrl = null;

    const onRequest = (/** @type {any} */ req) => {
      const reqUrl = req.url();
      const reqPath = new URL(reqUrl).pathname;
      if (reqPath === parsedUrl.pathname && reqUrl.includes(parsedUrl.searchParams.get('aid') || '1988')) {
        signedUrl = reqUrl;
      }
    };

    nativePage.on('request', onRequest);

    try {
      // Trigger a fetch so TikTok's webmssdk hook rewrites the URL with tokens.
      const init = JSON.stringify({ credentials: 'include', mode: 'cors' });
      const fetchResult = await adapter.evaluate(page, /** @type {(...args: unknown[]) => unknown} */ (/** @type {unknown} */ (triggerSignedFetch)), url, init);

      // Give the runtime a moment to complete the request and fire the listener.
      const deadline = Date.now() + 3000;
      while (!signedUrl && Date.now() < deadline) {
        await this.#sleep(100);
      }

      if (!signedUrl) {
        if (fetchResult && String(fetchResult).includes('X-Gnarly')) {
          // Some runtimes throw an error whose message contains the signed URL.
          const match = String(fetchResult).match(/(https?:\/\/[^\s"]+)/);
          if (match) signedUrl = match[1];
        }
      }

      if (!signedUrl) {
        throw new PlatformError({
          code: 'XACT_4030',
          type: ErrorTypes.RATE_LIMIT,
          message: 'TikTok anti-bot signature could not be captured from the browser.',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'tiktok',
        });
      }

      const signed = new URL(signedUrl);
      /** @type {Record<string, string>} */
      const query = {};
      signed.searchParams.forEach((value, key) => {
        query[key] = value;
      });

      const cookieHeader = buildCookieHeader(cookies || '');
      const parsedCookies = parseTikTokCookies(cookieHeader);

      return {
        query,
        cookies: {
          ...(parsedCookies.ttwid ? { ttwid: parsedCookies.ttwid } : {}),
          ...(parsedCookies.msToken ? { msToken: parsedCookies.msToken } : {}),
        },
      };
    } finally {
      nativePage.off('request', onRequest);
    }
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Close the bridge and release browser resources.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#warmedPage && this.adapter) {
      try {
        await this.adapter.closePage(this.#warmedPage);
      } catch {}
      this.#warmedPage = null;
    }
    if (this.#browser && this.adapter) {
      try {
        await this.adapter.closeBrowser(this.#browser);
      } catch {}
      this.#browser = null;
    }
  }
}

/**
 * Encode a cookie record to a header string.
 * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
 * @returns {string}
 */
function buildCookieHeader(cookies) {
  if (typeof cookies === 'string') return cookies;
  if (Array.isArray(cookies)) {
    return cookies
      .filter((c) => c && typeof c === 'object' && c.name && c.value !== undefined)
      .map((c) => `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}`)
      .join('; ');
  }
  if (cookies && typeof cookies === 'object') {
    return Object.entries(cookies)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v === undefined || v === null ? '' : String(v))}`)
      .join('; ');
  }
  return '';
}

/**
 * Parse a `ttwid` or `msToken` out of a raw cookie header.
 * @param {string} cookieHeader
 * @returns {{ ttwid: string, msToken: string }}
 */
function parseTikTokCookies(cookieHeader) {
  const ttwidMatch = cookieHeader.match(/(?:^|;\s*)ttwid=([^;]+)/);
  const msTokenMatch = cookieHeader.match(/(?:^|;\s*)msToken=([^;]+)/);
  return {
    ttwid: ttwidMatch ? decodeURIComponent(ttwidMatch[1]) : '',
    msToken: msTokenMatch ? decodeURIComponent(msTokenMatch[1]) : '',
  };
}
