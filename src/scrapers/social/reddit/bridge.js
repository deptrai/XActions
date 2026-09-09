// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * RedditBrowserBridge — Browser-as-cookie source for Reddit public .json API.
 *
 * Launches a stealth browser, navigates to Reddit, and extracts cookies so
 * subsequent HTTP requests can present a real browser session and avoid
 * Cloudflare/403 blocks on public .json endpoints.
 *
 * This is a *skeleton*: it can start/close, extract cookies, and inject them
 * into HTTP headers.  Callers use it by setting `transport: 'puppeteer'` on
 * `RedditClient`.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { getAdapter } from '../../adapters/index.js';

/**
 * @typedef {Object} BridgeCookie
 * @property {string} name
 * @property {string} value
 * @property {string} [domain]
 * @property {string} [path]
 */

export class RedditBrowserBridge {
  /** @type {string} */
  name = 'reddit-browser-bridge';

  /** @type {string} */
  baseUrl;

  /** @type {string} */
  adapterName;

  /** @type {boolean} */
  headless;

  /** @type {any} */
  proxy;

  /** @type {import('../../../proxy/proxy-pool.js').ProxyIpPool | null} */
  proxyPool;

  /** @type {import('../../../core/base-client.js').ProxyProviderLike | null} */
  proxyProvider;

  /** @type {string | null} */
  userAgent;

  /** @type {import('../../adapters/base.js').BaseAdapter | null} */
  #adapter = null;

  /** @type {any} */
  #browser = null;

  /** @type {any} */
  #page = null;

  /** @type {BridgeCookie[] | null} */
  #cookies = null;

  /** @type {Promise<this> | null} */
  #startPromise = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl='https://www.reddit.com']
   * @param {string} [options.adapterName='puppeteer']
   * @param {boolean} [options.headless=true]
   * @param {any} [options.proxy]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/base-client.js').ProxyProviderLike} [options.proxyProvider]
   * @param {string} [options.userAgent]
   */
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || 'https://www.reddit.com').replace(/\/+$/, '');
    this.adapterName = options.adapterName || 'puppeteer';
    this.headless = options.headless !== false;
    this.proxy = options.proxy || null;
    this.proxyPool = options.proxyPool || null;
    this.proxyProvider = options.proxyProvider || null;
    this.userAgent = options.userAgent || null;
    this.#adapter = options.adapter || null;
  }

  /**
   * Resolve scraper adapter instance lazily.
   * @returns {Promise<import('../../adapters/base.js').BaseAdapter>}
   */
  async #resolveAdapter() {
    if (this.#adapter) return this.#adapter;
    this.#adapter = await getAdapter(this.adapterName);
    return this.#adapter;
  }

  /**
   * Resolve a proxy using the same precedence as AbstractApiClient.
   * @returns {any}
   */
  #resolveProxy() {
    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      try {
        const p = this.proxyProvider.getProxy({ platform: 'reddit', requiresResidential: true });
        if (p) return p;
      } catch {
        // fallthrough
      }
    }
    if (this.proxyPool) {
      if (typeof this.proxyPool.getStickyProxy === 'function') {
        try {
          const p = this.proxyPool.getStickyProxy('reddit-browser', true);
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getNext === 'function') {
        try {
          const p = this.proxyPool.getNext(true);
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getRotatingProxy === 'function') {
        try {
          const p = this.proxyPool.getRotatingProxy(true);
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getRoundRobinProxy === 'function') {
        try {
          const p = this.proxyPool.getRoundRobinProxy(true);
          if (p) return p;
        } catch {}
      }
    }
    return this.proxy;
  }

  /**
   * Launch a fresh browser instance, navigate to Reddit, and extract cookies.
   * @param {Object} [options]
   * @param {boolean} [options.useHomePage=true] - whether to hit reddit.com/ or the target API path
   * @returns {Promise<this>}
   */
  async start(options = {}) {
    if (this.isReady) return this;
    if (this.#startPromise) return this.#startPromise;

    const safeOptions = options || {};

    this.#startPromise = (async () => {
      try {
        if (this.#browser) {
          await this.close();
        }

        const adapter = await this.#resolveAdapter();
        const proxy = this.#resolveProxy();

        this.#browser = await adapter.launch({
          headless: this.headless,
          proxy,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
          ],
        });

        this.#page = await adapter.newPage(this.#browser, {
          userAgent: this.userAgent || undefined,
        });

        const nativePage = adapter.getNativePage ? adapter.getNativePage(this.#page) : this.#page?._native;
        if (nativePage && typeof nativePage.authenticate === 'function' && proxy?.username && proxy?.password) {
          try {
            await nativePage.authenticate({
              username: String(proxy.username),
              password: String(proxy.password),
            });
          } catch {
            // best effort proxy authentication
          }
        }

        const startUrl = safeOptions.useHomePage === false ? this.baseUrl : `${this.baseUrl}/`;
        await adapter.goto(this.#page, startUrl, {
          waitUntil: 'networkidle',
          timeout: 45000,
        });

        // Allow a short settle for JS-rendered state / cookie refresh.
        await new Promise((resolve) => setTimeout(resolve, 1000));

        this.#cookies = await this.#extractCookies(adapter, this.#page);
        return this;
      } catch (err) {
        await this.close();
        throw err;
      } finally {
        this.#startPromise = null;
      }
    })();

    return this.#startPromise;
  }

  /**
   * Extract cookies from the current page.
   * Uses the native page `cookies()` API when available, otherwise falls back
   * to `document.cookie`. Deduplicates cookies by name.
   *
   * @param {import('../../adapters/base.js').BaseAdapter} adapter
   * @param {any} page
   * @returns {Promise<BridgeCookie[]>}
   */
  async #extractCookies(adapter, page) {
    let rawList = [];
    const nativePage = adapter.getNativePage ? adapter.getNativePage(page) : page?._native;

    if (nativePage && typeof nativePage.cookies === 'function') {
      try {
        const rawCookies = await nativePage.cookies(this.baseUrl);
        if (Array.isArray(rawCookies)) {
          rawList = rawCookies.map((c) => ({
            name: String(c.name || '').trim(),
            value: String(c.value || '').trim(),
            domain: String(c.domain || 'reddit.com'),
            path: String(c.path || '/'),
          }));
        }
      } catch {
        // fallthrough to document.cookie fallback
      }
    }

    if (rawList.length === 0 && page) {
      try {
        const cookieStr = String(await adapter.evaluate(page, () => document.cookie) || '');
        rawList = cookieStr
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((pair) => {
            const idx = pair.indexOf('=');
            const name = idx > 0 ? pair.slice(0, idx).trim() : pair.trim();
            const value = idx > 0 ? pair.slice(idx + 1).trim() : '';
            return { name, value, domain: 'reddit.com', path: '/' };
          });
      } catch {
        rawList = [];
      }
    }

    // Deduplicate cookies by name, keeping the latest non-empty value
    const cookieMap = new Map();
    for (const c of rawList) {
      if (!c.name) continue;
      cookieMap.set(c.name, c);
    }
    return Array.from(cookieMap.values());
  }

  /**
   * Clear cached cookies so the next request forces a fresh extraction.
   * @returns {void}
   */
  clearCookies() {
    this.#cookies = null;
  }

  /**
   * @returns {BridgeCookie[]}
   */
  get cookies() {
    return this.#cookies || [];
  }

  /**
   * Serialize cookies into an HTTP `Cookie` header value.
   * @returns {string}
   */
  get cookieHeader() {
    const cookies = this.cookies;
    if (cookies.length === 0) return '';
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Whether the bridge has successfully extracted cookies.
   * @returns {boolean}
   */
  get isReady() {
    return this.#cookies !== null && this.#cookies.length > 0;
  }

  /**
   * Close the browser and clear session state.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#adapter && this.#page) {
      try {
        await this.#adapter.closePage(this.#page);
      } catch {}
    }
    if (this.#adapter && this.#browser) {
      try {
        await this.#adapter.closeBrowser(this.#browser);
      } catch {}
    }
    this.#page = null;
    this.#browser = null;
    this.#cookies = null;
  }
}
