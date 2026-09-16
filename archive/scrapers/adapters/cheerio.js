// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — HTTP/Cheerio
 *
 * Lightweight adapter using HTTP requests + Cheerio for HTML parsing.
 * No browser required — much faster and uses far less memory.
 *
 * Best for: scraping public pages that don't need JS, quick data extraction,
 * CI/CD environments without browser binaries.
 *
 * Limitation: Cannot execute JavaScript in page context. Pages that require
 * client-side JS rendering (most of x.com) need a browser adapter instead.
 * This adapter is ideal for pre-rendered pages, APIs, or cached/static content.
 *
 * Install: npm install cheerio
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { BaseAdapter } from './base.js';

/**
 * @typedef {Object} CheerioBrowser
 * @property {import('cheerio').CheerioAPI | null} _native
 * @property {string} _adapter
 * @property {{ headers: Record<string, string>, proxy: unknown, timeout: number }} _options
 * @property {Map<string, string>} _cookies
 */

/**
 * @typedef {Object} CheerioPage
 * @property {import('cheerio').CheerioAPI | null} _native
 * @property {string} _adapter
 * @property {CheerioBrowser} _browser
 * @property {string} _html
 * @property {string} _url
 * @property {Map<string, string>} _cookies
 * @property {Record<string, string>} _headers
 * @property {import('cheerio').CheerioAPI | null} _cheerio
 */

export class CheerioAdapter extends BaseAdapter {
  name = 'cheerio';
  description = 'HTTP + Cheerio — lightweight HTML parsing, no browser needed, fast but no JS execution';
  supportsJavaScript = false;
  requiresBrowser = false;

  /** @type {import('cheerio') | null} */
  #cheerio = null;

  async #getCheerio() {
    if (!this.#cheerio) {
      this.#cheerio = await import('cheerio');
    }
    if (!this.#cheerio) {
      throw new Error('cheerio could not be loaded');
    }
    return this.#cheerio;
  }

  async checkDependencies() {
    try {
      await import('cheerio');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        message: 'Install cheerio: npm install cheerio',
      };
    }
  }

  /**
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async launch(options = {}) {
    return {
      _native: null,
      _adapter: this.name,
      _options: {
        headers: {
          'User-Agent': options.userAgent ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          ...options.headers,
        },
        proxy: options.proxy || null,
        timeout: options.timeout || 30000,
      },
      _cookies: new Map(),
    };
  }

  /**
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    const cheerio = await this.#getCheerio();
    const b = /** @type {CheerioBrowser} */ (browser);
    return {
      _native: null,
      _adapter: this.name,
      _browser: b,
      _html: '',
      _url: '',
      _cookies: new Map(b._cookies),
      _headers: { ...b._options.headers },
      _cheerio: /** @type {import('cheerio').CheerioAPI | null} */ (cheerio.default),
    };
  }

  /**
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    const p = /** @type {CheerioPage} */ (page);
    const cookieStr = Array.from(p._cookies.entries())
      .map(([name, val]) => `${name}=${val}`)
      .join('; ');

    const headers = { ...p._headers };
    if (cookieStr) headers['Cookie'] = cookieStr;

    const fetchOptions = /** @type {RequestInit} */ ({
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(p._browser._options.timeout),
    });

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} — ${url}`);
    }

    p._html = await response.text();
    p._url = url;
    const cheerio = await this.#getCheerio();
    p._native = cheerio.load(p._html);
  }

  /**
   * @param {AdapterPage} page
   * @param {((...args: unknown[]) => unknown)|string} fn
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async evaluate(page, fn, ...args) {
    throw new Error(
      'CheerioAdapter does not support evaluate() — use queryAll() or getContent() instead, ' +
      'or switch to a browser adapter (puppeteer/playwright) for JS-heavy pages.'
    );
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {((...args: unknown[]) => unknown)} [mapFn]
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    const p = /** @type {CheerioPage} */ (page);
    if (!p._native) {
      throw new Error('No page loaded — call goto() first');
    }
    const $ = p._native;
    const elements = $(selector);

    if (mapFn) {
      return /** @type {unknown[]} */ (mapFn(elements, $));
    }

    const results = /** @type {string[]} */ ([]);
    elements.each(/** @param {number} _ @param {unknown} el */ (_, el) => {
      results.push($.html(el));
    });
    return results;
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    return /** @type {CheerioPage} */ (page)._html;
  }

  /**
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    const p = /** @type {CheerioPage} */ (page);
    p._cookies.set(cookie.name, cookie.value);
    p._browser._cookies.set(cookie.name, cookie.value);
  }

  /**
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    // No-op for HTTP adapter — pages are fetched fully
  }

  /**
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    const p = /** @type {CheerioPage} */ (page);
    if (options.path) {
      const fs = await import('fs/promises');
      await fs.writeFile(options.path.replace(/\.(png|jpg)$/, '.html'), p._html);
    }
    return Buffer.from(p._html);
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    const p = /** @type {CheerioPage} */ (page);
    if (!p._native) {
      throw new Error('No page loaded');
    }
    const $ = p._native;
    if ($(selector).length === 0) {
      throw new Error(`Selector "${selector}" not found in static HTML`);
    }
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    const p = /** @type {CheerioPage} */ (page);
    p._native = null;
    p._html = '';
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    const b = /** @type {CheerioBrowser} */ (browser);
    b._cookies.clear();
  }

  /**
   * Cheerio-specific: Parse arbitrary HTML string
   * @param {string} html
   * @returns {Promise<import('cheerio').CheerioAPI>}
   */
  async parseHTML(html) {
    const cheerio = await this.#getCheerio();
    return cheerio.load(html);
  }

  /**
   * Make a raw HTTP request (useful for APIs, JSON endpoints)
   * @param {string} url
   * @param {RequestInit} [options] - fetch() options
   * @returns {Promise<unknown>} Parsed JSON or text
   */
  async fetchJSON(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'XActions/3.0 (https://xactions.app)',
        ...options.headers,
      },
      ...options,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }
}

export default CheerioAdapter;
