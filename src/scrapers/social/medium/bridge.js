// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * MediumBrowserBridge — Browser-as-source fallback for Medium public pages.
 *
 * Launches a stealth browser, navigates to Medium, and extracts content
 * via `window.__APOLLO_STATE__` or rendered HTML when RSS/JSON endpoints fail.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { getAdapter } from '../../adapters/index.js';
import { asRecord, extractPostId } from './normalizer.js';

/**
 * @typedef {Object} BridgeCookie
 * @property {string} name
 * @property {string} value
 * @property {string} [domain]
 * @property {string} [path]
 */

export class MediumBrowserBridge {
  /** @type {string} */
  name = 'medium-browser-bridge';

  /** @type {string} */
  baseUrl;

  /** @type {string} */
  adapterName;

  /** @type {boolean} */
  headless;

  /** @type {string | Record<string, unknown> | null} */
  proxy;

  /** @type {import('../../../proxy/proxy-pool.js').ProxyIpPool | null} */
  proxyPool;

  /** @type {import('../../../core/base-client.js').ProxyProviderLike | null} */
  proxyProvider;

  /** @type {string | null} */
  userAgent;

  /** @type {(import('../../adapters/base.js').BaseAdapter & Record<string, unknown>) | null} */
  #adapter = null;

  /** @type {unknown} */
  #browser = null;

  /** @type {unknown} */
  #page = null;

  /** @type {BridgeCookie[] | null} */
  #cookies = null;

  /** @type {Promise<this> | null} */
  #startPromise = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl='https://medium.com']
   * @param {string} [options.adapterName='puppeteer']
   * @param {boolean} [options.headless=true]
   * @param {string | Record<string, unknown>} [options.proxy]
   * @param {import('../../../proxy/proxy-pool.js').ProxyIpPool} [options.proxyPool]
   * @param {import('../../../core/base-client.js').ProxyProviderLike} [options.proxyProvider]
   * @param {string} [options.userAgent]
   * @param {import('../../adapters/base.js').BaseAdapter} [options.adapter]
   */
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || 'https://medium.com').replace(/\/+$/, '');
    this.adapterName = options.adapterName || 'puppeteer';
    this.headless = options.headless !== false;
    this.proxy = options.proxy || null;
    this.proxyPool = options.proxyPool || null;
    this.proxyProvider = options.proxyProvider || null;
    this.userAgent = options.userAgent || null;
    this.#adapter = options.adapter
      ? /** @type {import('../../adapters/base.js').BaseAdapter & Record<string, unknown>} */ (options.adapter)
      : null;
  }

  /**
   * Extract the hostname from the configured baseUrl to use as the default
   * cookie domain when the browser does not provide one.
   * @returns {string}
   */
  #baseDomain() {
    try {
      return new URL(this.baseUrl).hostname;
    } catch {
      return 'medium.com';
    }
  }

  /**
   * Resolve scraper adapter instance lazily.
   * @returns {Promise<import('../../adapters/base.js').BaseAdapter & Record<string, unknown>>}
   */
  async #resolveAdapter() {
    if (this.#adapter) return this.#adapter;
    const baseAdapter = await getAdapter(this.adapterName);
    this.#adapter = /** @type {import('../../adapters/base.js').BaseAdapter & Record<string, unknown>} */ (baseAdapter);
    return this.#adapter;
  }

  /**
   * Resolve a proxy using the same precedence as AbstractApiClient.
   * @returns {string | Record<string, unknown> | null}
   */
  #resolveProxy() {
    /** @type {string | Record<string, unknown> | null} */
    let resolved = null;
    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      try {
        resolved = /** @type {string | Record<string, unknown> | null} */ (this.proxyProvider.getProxy({ platform: 'medium', requiresResidential: true }));
      } catch {
        // fallthrough
      }
    }
    if (!resolved && this.proxyPool) {
      if (typeof this.proxyPool.getStickyProxy === 'function') {
        try {
          resolved = /** @type {string | Record<string, unknown> | null} */ (this.proxyPool.getStickyProxy('medium-browser', true));
        } catch {}
      } else if (!resolved && typeof this.proxyPool.getNext === 'function') {
        try {
          resolved = /** @type {string | Record<string, unknown> | null} */ (this.proxyPool.getNext(true));
        } catch {}
      } else if (!resolved && typeof this.proxyPool.getRotatingProxy === 'function') {
        try {
          resolved = /** @type {string | Record<string, unknown> | null} */ (this.proxyPool.getRotatingProxy(true));
        } catch {}
      } else if (!resolved && typeof this.proxyPool.getRoundRobinProxy === 'function') {
        try {
          resolved = /** @type {string | Record<string, unknown> | null} */ (this.proxyPool.getRoundRobinProxy(true));
        } catch {}
      }
    }
    return resolved || this.proxy;
  }

  /**
   * Launch a fresh browser instance, navigate to Medium, and extract cookies.
   * @returns {Promise<this>}
   */
  async start() {
    if (this.isReady) return this;
    if (this.#startPromise) return this.#startPromise;

    this.#startPromise = (async () => {
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        attempts += 1;
        try {
          if (this.#browser) {
            await this.close();
          }

          const adapter = await this.#resolveAdapter();
          const proxy = this.#resolveProxy();

          const launchProxy = typeof proxy === 'string'
            ? proxy
            : typeof proxy === 'object' && proxy !== null
              ? {
                  server: String((/** @type {Record<string, unknown>} */ (proxy)).server || ''),
                  username: typeof (/** @type {Record<string, unknown>} */ (proxy)).username === 'string'
                    ? (/** @type {Record<string, unknown>} */ (proxy)).username
                    : undefined,
                  password: typeof (/** @type {Record<string, unknown>} */ (proxy)).password === 'string'
                    ? (/** @type {Record<string, unknown>} */ (proxy)).password
                    : undefined,
                }
              : undefined;

          this.#browser = await adapter.launch({
            headless: this.headless,
            proxy: launchProxy,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-blink-features=AutomationControlled',
            ],
          });

          const browser = /** @type {AdapterBrowser} */ (this.#browser);

          this.#page = await adapter.newPage(browser, {
            userAgent: this.userAgent || undefined,
          });

          const getNativePage = typeof adapter.getNativePage === 'function'
            ? /** @type {(page: unknown) => unknown} */ (adapter.getNativePage)
            : null;
          const pageRecord = typeof this.#page === 'object' && this.#page !== null
            ? /** @type {Record<string, unknown>} */ (this.#page)
            : null;
          const nativePage = getNativePage ? getNativePage(this.#page) : pageRecord?._native;
          const proxyRecord = typeof proxy === 'object' && proxy !== null
            ? /** @type {Record<string, unknown>} */ (proxy)
            : null;
          const nativeRecord = nativePage && typeof nativePage === 'object'
            ? /** @type {Record<string, unknown>} */ (nativePage)
            : null;
          if (nativeRecord && typeof nativeRecord.authenticate === 'function' && proxyRecord && typeof proxyRecord.username === 'string' && typeof proxyRecord.password === 'string') {
            try {
              await nativeRecord.authenticate({
                username: proxyRecord.username,
                password: proxyRecord.password,
              });
            } catch {
              // best effort proxy authentication
            }
          }

          const page = /** @type {AdapterPage} */ (this.#page);
          await adapter.goto(page, `${this.baseUrl}/`, {
            waitUntil: 'networkidle',
            timeout: 45000,
          });

          // Allow a short settle for JS-rendered state / cookie refresh.
          await new Promise((resolve) => setTimeout(resolve, 1000));

          this.#cookies = await this.#extractCookies(adapter, this.#page);

          if (this.isReady) {
            return this;
          }

          if (attempts < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            continue;
          }

          throw new Error(`MediumBrowserBridge could not extract non-empty cookies from ${this.baseUrl}`);
        } catch (err) {
          await this.close();
          if (attempts >= maxAttempts) throw err;
        }
      }

      throw new Error('MediumBrowserBridge start exhausted all retry attempts');
    })().finally(() => {
      this.#startPromise = null;
    });

    return this.#startPromise;
  }

  /**
   * Extract cookies from the current page.
   * @param {import('../../adapters/base.js').BaseAdapter & Record<string, unknown>} adapter
   * @param {unknown} page
   * @returns {Promise<BridgeCookie[]>}
   */
  async #extractCookies(adapter, page) {
    /** @type {BridgeCookie[]} */
    let rawList = [];
    const getNativePage = typeof adapter.getNativePage === 'function'
      ? /** @type {(p: unknown) => unknown} */ (adapter.getNativePage)
      : null;
    const pageRecord = typeof page === 'object' && page !== null
      ? /** @type {Record<string, unknown>} */ (page)
      : null;
    const nativePage = getNativePage ? getNativePage(page) : pageRecord?._native;
    const nativeRecord = nativePage && typeof nativePage === 'object'
      ? /** @type {Record<string, unknown>} */ (nativePage)
      : null;

    if (nativeRecord && typeof nativeRecord.cookies === 'function') {
      try {
        const cookiesFn = /** @type {(url: string) => unknown} */ (nativeRecord.cookies);
        const rawCookies = await cookiesFn(this.baseUrl);
        if (Array.isArray(rawCookies)) {
          rawList = rawCookies.map((rawC) => {
            const c = /** @type {Record<string, unknown>} */ (rawC);
            return {
              name: String(c.name || '').trim(),
              value: String(c.value || '').trim(),
              domain: String(c.domain || this.#baseDomain()),
              path: String(c.path || '/'),
            };
          });
        }
      } catch {
        // fallthrough to document.cookie fallback
      }
    }

    if (rawList.length === 0 && page) {
      try {
        const adapterPage = /** @type {AdapterPage} */ (page);
        const cookieStr = String(await adapter.evaluate(adapterPage, () => document.cookie) || '');
        rawList = cookieStr
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((pair) => {
            const idx = pair.indexOf('=');
            const name = idx > 0 ? pair.slice(0, idx).trim() : pair.trim();
            const value = idx > 0 ? pair.slice(idx + 1).trim() : '';
            return { name, value, domain: this.#baseDomain(), path: '/' };
          });
      } catch {
        rawList = [];
      }
    }

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
    return cookies
      .map((c) => `${c.name}=${encodeURIComponent(String(c.value || ''))}`)
      .join('; ');
  }

  /**
   * Whether the bridge has successfully extracted cookies.
   * @returns {boolean}
   */
  get isReady() {
    return this.#cookies !== null && this.#cookies.length > 0;
  }

  /**
   * Fetch a user feed through the browser.
   * @param {string} username
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async getUserFeed(username, options = {}) {
    await this.start();
    const user = String(username).replace(/^@/, '').trim();
    const url = `${this.baseUrl}/@${encodeURIComponent(user)}`;
    return this.#scrapeFeed(url, options);
  }

  /**
   * Fetch a publication feed through the browser.
   * @param {string} slug
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async getPublicationFeed(slug, options = {}) {
    await this.start();
    const cleanSlug = String(slug).trim();
    const url = `${this.baseUrl}/${encodeURIComponent(cleanSlug)}`;
    return this.#scrapeFeed(url, options);
  }

  /**
   * Fetch a tag feed through the browser.
   * @param {string} tag
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async getTagFeed(tag, options = {}) {
    await this.start();
    const cleanTag = String(tag).replace(/^#/, '').trim();
    const url = `${this.baseUrl}/tag/${encodeURIComponent(cleanTag)}`;
    return this.#scrapeFeed(url, options);
  }

  /**
   * Fetch a single post through the browser.
   * @param {string} target
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<Record<string, unknown>>}
   */
  async getPost(target, options = {}) {
    await this.start();
    const url = /^https?:\/\//i.test(target) ? target : `${this.baseUrl}/p/${target}`;
    const postId = extractPostId(url) || String(options.postId || target);

    const adapter = this.#adapter;
    const page = /** @type {AdapterPage} */ (this.#page);
    if (!adapter) throw new Error('MediumBrowserBridge adapter not initialized');

    await adapter.goto(page, url, { waitUntil: 'networkidle', timeout: 45000 });

    const apolloState = await this.#extractApolloState(adapter, page);
    if (apolloState && Object.keys(apolloState).length > 0) {
      const posts = Object.values(apolloState).map((v) => asRecord(v));
      const match = posts.find((p) => String(p.id) === postId) || posts[0];
      if (match) return { ...match, __mediumPostId: postId, __namespacedId: `medium:${postId}` };
    }

    // Fallback: parse canonical link and meta from rendered HTML.
    const html = await adapter.getContent(page);
    const titleMatch = html.match(/<meta\s+property\s*=\s*["']og:title["']\s+content\s*=\s*["']([^"']+)["']/i);
    const urlMatch = html.match(/<meta\s+property\s*=\s*["']og:url["']\s+content\s*=\s*["']([^"']+)["']/i);
    return {
      id: postId,
      title: titleMatch ? titleMatch[1] : '',
      mediumUrl: urlMatch ? urlMatch[1] : url,
      content: '',
      __mediumPostId: postId,
      __namespacedId: `medium:${postId}`,
    };
  }

  /**
   * Generic feed scraper via `window.__APOLLO_STATE__` or HTML.
   * @param {string} url
   * @param {Record<string, unknown>} [options={}]
   * @returns {Promise<{ items: Record<string, unknown>[], paging: { next: Record<string, unknown> | null } }>}
   */
  async #scrapeFeed(url, options = {}) {
    const opts = asRecord(options);
    const limit = Number(opts.limit) > 0 ? Math.min(Number(opts.limit), 100) : 10;

    const adapter = this.#adapter;
    const page = /** @type {AdapterPage} */ (this.#page);
    if (!adapter) throw new Error('MediumBrowserBridge adapter not initialized');

    await adapter.goto(page, url, { waitUntil: 'networkidle', timeout: 45000 });

    const apolloState = await this.#extractApolloState(adapter, page);
    /** @type {Record<string, unknown>[]} */
    let items = [];
    if (apolloState && Object.keys(apolloState).length > 0) {
      items = Object.values(apolloState)
        .map((v) => asRecord(v))
        .filter((v) => v.id && (v.title || v.mediumUrl || v.canonicalUrl));
      items.sort((a, b) => (Number(b.firstPublishedAt) || 0) - (Number(a.firstPublishedAt) || 0));
    }

    if (items.length === 0) {
      const html = await adapter.getContent(page);
      const hrefMatches = Array.from(html.matchAll(/href\s*=\s*["'](\/[^"']+\/[a-z0-9-]+-[a-f0-9]{12})["']/gi));
      const seen = new Set();
      for (const match of hrefMatches.slice(0, limit)) {
        const href = match[1];
        const pid = extractPostId(href);
        if (pid && !seen.has(pid)) {
          seen.add(pid);
          items.push({
            id: pid,
            title: '',
            mediumUrl: `${this.baseUrl}${href}`,
            __mediumPostId: pid,
            __namespacedId: `medium:${pid}`,
          });
        }
      }
    }

    return { items: items.slice(0, limit), paging: { next: null } };
  }

  /**
   * Try to read `window.__APOLLO_STATE__` from the current page.
   * @param {import('../../adapters/base.js').BaseAdapter & Record<string, unknown>} adapter
   * @param {AdapterPage} page
   * @returns {Promise<Record<string, unknown> | null>}
   */
  async #extractApolloState(adapter, page) {
    try {
      const raw = await adapter.evaluate(page, 'return (typeof window !== "undefined" && window.__APOLLO_STATE__) ? window.__APOLLO_STATE__ : null;');
      if (raw && typeof raw === 'object') {
        return asRecord(raw);
      }
    } catch {
      // fallthrough
    }
    return null;
  }

  /**
   * Close the browser and clear session state.
   * @returns {Promise<void>}
   */
  async close() {
    const adapterRecord = this.#adapter ? /** @type {Record<string, unknown>} */ (this.#adapter) : null;
    if (adapterRecord && this.#page && typeof adapterRecord.closePage === 'function') {
      try {
        const closePage = /** @type {(page: unknown) => Promise<unknown>} */ (adapterRecord.closePage);
        await closePage(this.#page);
      } catch {}
    }
    if (adapterRecord && this.#browser && typeof adapterRecord.closeBrowser === 'function') {
      try {
        const closeBrowser = /** @type {(browser: unknown) => Promise<unknown>} */ (adapterRecord.closeBrowser);
        await closeBrowser(this.#browser);
      } catch {}
    }
    this.#page = null;
    this.#browser = null;
    this.#cookies = null;
  }
}
