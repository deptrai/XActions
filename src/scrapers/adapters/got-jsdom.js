// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — Got-Scraping + JSDOM
 *
 * HTTP scraping with browser-like TLS fingerprints + full DOM API emulation.
 *
 * got-scraping: HTTP client that mimics real browser TLS/HTTP2 fingerprints,
 * making requests look identical to Chrome, Firefox, or Safari to bypass
 * bot detection that inspects TLS handshake signatures.
 *
 * JSDOM: Full DOM implementation in Node.js — supports querySelector, innerHTML,
 * textContent, and most DOM APIs. Unlike Cheerio, JSDOM can optionally execute
 * basic JavaScript (inline scripts, timers) for light JS rendering.
 *
 * Best for: bypassing TLS fingerprint detection without a full browser, parsing
 * pages that need basic DOM APIs, server-rendered pages with light JS.
 *
 * Install: npm install got-scraping jsdom
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { BaseAdapter } from './base.js';

/**
 * @typedef {Object} GotJsdomBrowser
 * @property {import('got-scraping').GotScrapingClient} _native
 * @property {string} _adapter
 * @property {import('got-scraping').GotScrapingOptions} _sessionOptions
 * @property {Map<string, string>} _cookies
 * @property {'dangerously' | 'outside-only' | false} _runScripts
 * @property {string} _fingerprint
 */

/**
 * @typedef {Object} GotJsdomPage
 * @property {import('jsdom').JSDOM | null} _native
 * @property {string} _adapter
 * @property {GotJsdomBrowser} _browser
 * @property {import('jsdom').JSDOM | null} _dom
 * @property {Window & { Event: typeof Event } | null} _window
 * @property {Document | null} _document
 * @property {string} _html
 * @property {string} _url
 * @property {Map<string, string>} _cookies
 * @property {Record<string, string>} _headers
 */

export class GotJsdomAdapter extends BaseAdapter {
  name = 'got-jsdom';
  description = 'Got-Scraping + JSDOM — browser TLS fingerprints, full DOM API, optional light JS execution';
  supportsJavaScript = true;
  requiresBrowser = false;

  /** @type {typeof import('got-scraping') | null} */
  #gotScraping = null;

  /** @type {typeof import('jsdom') | null} */
  #jsdom = null;

  async #getGotScraping() {
    if (!this.#gotScraping) {
      this.#gotScraping = await import('got-scraping');
    }
    if (!this.#gotScraping) {
      throw new Error('got-scraping could not be loaded');
    }
    return this.#gotScraping;
  }

  async #getJSDOM() {
    if (!this.#jsdom) {
      this.#jsdom = await import('jsdom');
    }
    if (!this.#jsdom) {
      throw new Error('jsdom could not be loaded');
    }
    return this.#jsdom;
  }

  async checkDependencies() {
    const missing = [];
    try { await import('got-scraping'); } catch { missing.push('got-scraping'); }
    try { await import('jsdom'); } catch { missing.push('jsdom'); }

    if (missing.length) {
      return {
        available: false,
        message: `Install missing packages: npm install ${missing.join(' ')}`,
      };
    }
    return { available: true };
  }

  /**
   * Launch creates a configured HTTP session context.
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async launch(options = {}) {
    const { gotScraping } = await this.#getGotScraping();

    const fingerprint = options.fingerprint || 'chrome';
    const headerGeneratorOptions = {
      browsers: [{ name: fingerprint }],
      ...options.headerGeneratorOptions,
    };

    /** @type {import('got-scraping').GotScrapingOptions} */
    const sessionOptions = {
      headerGeneratorOptions,
    };

    if (options.proxyUrl) {
      sessionOptions.proxyUrl = options.proxyUrl;
    }

    return {
      _native: gotScraping,
      _adapter: this.name,
      _sessionOptions: sessionOptions,
      _cookies: new Map(),
      _runScripts: options.runScripts || false,
      _fingerprint: fingerprint,
    };
  }

  /**
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    const b = /** @type {GotJsdomBrowser} */ (browser);
    return {
      _native: /** @type {import('jsdom').JSDOM | null} */ (null),
      _adapter: this.name,
      _browser: b,
      _dom: /** @type {import('jsdom').JSDOM | null} */ (null),
      _window: /** @type {Window & { Event: typeof Event } | null} */ (null),
      _document: /** @type {Document | null} */ (null),
      _html: '',
      _url: '',
      _cookies: new Map(b._cookies),
      _headers: {
        'User-Agent': options.userAgent ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    };
  }

  /**
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    const p = /** @type {GotJsdomPage} */ (page);
    const { gotScraping } = await this.#getGotScraping();
    const { JSDOM } = await this.#getJSDOM();

    const cookieStr = Array.from(p._cookies.entries())
      .map(([name, val]) => `${name}=${val}`)
      .join('; ');

    /** @type {import('got-scraping').GotScrapingOptions} */
    const requestOptions = {
      ...p._browser._sessionOptions,
      headers: {
        ...p._headers,
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
      timeout: { request: options.timeout || 30000 },
      followRedirect: true,
    };

    if (p._browser._sessionOptions.proxyUrl) {
      requestOptions.proxyUrl = p._browser._sessionOptions.proxyUrl;
    }

    const response = await gotScraping({
      url,
      ...requestOptions,
    });

    p._html = /** @type {string} */ (response.body);
    p._url = url;

    /** @type {{ url: string, contentType: string, pretendToBeVisual: boolean, resources: string, runScripts?: 'dangerously' | 'outside-only' | false }} */
    const jsdomOptions = {
      url,
      contentType: 'text/html',
      pretendToBeVisual: true,
      resources: 'usable',
    };

    if (p._browser._runScripts) {
      jsdomOptions.runScripts = p._browser._runScripts;
    }

    p._dom = new JSDOM(p._html, jsdomOptions);
    p._window = p._dom.window;
    p._document = p._dom.window.document;
    p._native = p._dom;

    const setCookies = response.headers['set-cookie'];
    if (setCookies) {
      const cookieArray = Array.isArray(setCookies) ? setCookies : [setCookies];
      for (const cookie of cookieArray) {
        const [nameValue] = cookie.split(';');
        const [name, ...valueParts] = nameValue.split('=');
        if (name && valueParts.length) {
          p._cookies.set(name.trim(), valueParts.join('=').trim());
        }
      }
    }
  }

  /**
   * Execute JavaScript against the JSDOM window.
   * @param {AdapterPage} page
   * @param {((...args: unknown[]) => unknown)|string} fn
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async evaluate(page, fn, ...args) {
    const p = /** @type {GotJsdomPage} */ (page);
    if (!p._dom || !p._window) {
      throw new Error('No page loaded — call goto() first');
    }

    if (p._browser._runScripts) {
      const fnStr = typeof fn === 'function' ? `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})` : fn;
      return p._dom.window.eval(fnStr);
    }

    if (typeof fn === 'function') {
      const { window } = p._dom;
      const { document } = window;
      const argNames = args.map((_, i) => `__arg${i}`);
      const wrapped = new Function('window', 'document', 'navigator', ...argNames,
        `const result = (${fn.toString()})(${argNames.join(',')});\n         return result;`
      );
      return wrapped(window, document, window.navigator, ...args);
    }

    throw new Error('evaluate() requires a function when runScripts is not enabled');
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {((...args: unknown[]) => unknown)} [mapFn]
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    const p = /** @type {GotJsdomPage} */ (page);
    if (!p._document) {
      throw new Error('No page loaded — call goto() first');
    }

    const elements = p._document.querySelectorAll(selector);

    if (mapFn) {
      return /** @type {unknown[]} */ (mapFn(Array.from(elements), p._document));
    }

    return Array.from(elements);
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    const p = /** @type {GotJsdomPage} */ (page);
    if (p._dom) {
      return p._dom.serialize();
    }
    return p._html;
  }

  /**
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    const p = /** @type {GotJsdomPage} */ (page);
    p._cookies.set(cookie.name, cookie.value);
    p._browser._cookies.set(cookie.name, cookie.value);
  }

  /**
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    const p = /** @type {GotJsdomPage} */ (page);
    if (p._window) {
      const win = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (p._window));
      win.scrollY = options.y || (p._document && p._document.body ? p._document.body.scrollHeight : 0);
      const EventCtor = /** @type {typeof Event} */ (win.Event);
      p._window.dispatchEvent(new EventCtor('scroll'));
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    const p = /** @type {GotJsdomPage} */ (page);
    const html = p._dom ? p._dom.serialize() : p._html;
    if (options.path) {
      const fs = await import('fs/promises');
      await fs.writeFile(options.path.replace(/\.(png|jpg|jpeg)$/, '.html'), html);
    }
    return Buffer.from(html);
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    const p = /** @type {GotJsdomPage} */ (page);
    if (!p._document) {
      throw new Error('No page loaded');
    }

    const el = p._document.querySelector(selector);
    if (!el) {
      throw new Error(`Selector "${selector}" not found in DOM`);
    }
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    const p = /** @type {GotJsdomPage} */ (page);
    if (p._dom) {
      p._dom.window.close();
      p._dom = /** @type {import('jsdom').JSDOM | null} */ (null);
      p._window = /** @type {Window & { Event: typeof Event } | null} */ (null);
      p._document = /** @type {Document | null} */ (null);
    }
    p._html = '';
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    const b = /** @type {GotJsdomBrowser} */ (browser);
    b._cookies.clear();
  }

  /**
   * Got-Scraping specific: Make a raw HTTP request with browser TLS fingerprints.
   * @param {string} url
   * @param {import('got-scraping').GotScrapingOptions} [options]
   * @returns {Promise<import('got-scraping').GotScrapingResponse>}
   */
  async fetch(url, options = {}) {
    const { gotScraping } = await this.#getGotScraping();
    return gotScraping({ url, ...options });
  }

  /**
   * Got-Scraping specific: Make a JSON API request with browser fingerprints.
   * @param {string} url
   * @param {import('got-scraping').GotScrapingOptions} [options]
   * @returns {Promise<unknown>}
   */
  async fetchJSON(url, options = {}) {
    const { gotScraping } = await this.#getGotScraping();
    const response = await gotScraping({
      url,
      responseType: 'json',
      headers: {
        'Accept': 'application/json',
        ...options.headers,
      },
      ...options,
    });
    return response.body;
  }

  /**
   * Got-Scraping specific: Switch the TLS fingerprint being mimicked.
   * @param {AdapterBrowser} browser
   * @param {string} fingerprint
   */
  setFingerprint(browser, fingerprint) {
    const b = /** @type {GotJsdomBrowser} */ (browser);
    b._fingerprint = fingerprint;
    b._sessionOptions.headerGeneratorOptions = { browsers: [{ name: fingerprint }] };
  }

  /**
   * @param {AdapterPage} page
   * @returns {unknown}
   */
  getNativePage(page) {
    return page._native;
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {unknown}
   */
  getNativeBrowser(browser) {
    return browser._native;
  }
}

export default GotJsdomAdapter;
