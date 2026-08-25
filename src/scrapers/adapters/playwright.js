// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — Playwright
 *
 * Adapter wrapping Playwright for browser automation.
 * Supports Chromium, Firefox, and WebKit.
 * Better auto-wait, trace recording, and CI support than Puppeteer.
 *
 * Install: npm install playwright
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { BaseAdapter } from './base.js';

export class PlaywrightAdapter extends BaseAdapter {
  name = 'playwright';
  description = 'Playwright — multi-browser (Chromium/Firefox/WebKit), auto-wait, better CI support';
  supportsJavaScript = true;
  requiresBrowser = true;

  /** @type {typeof import('playwright') | null} */
  #playwright = null;

  async #getPlaywright() {
    if (!this.#playwright) {
      this.#playwright = await import('playwright');
    }
    if (!this.#playwright) {
      throw new Error('playwright could not be loaded');
    }
    return this.#playwright;
  }

  async checkDependencies() {
    try {
      await import('playwright');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        message: 'Install playwright: npm install playwright && npx playwright install chromium',
      };
    }
  }

  /**
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async launch(options = {}) {
    const pw = await this.#getPlaywright();
    const pwRecord = /** @type {Record<string, import('playwright').BrowserType | undefined>} */ (/** @type {unknown} */ (pw));
    const browserType = options.browser || 'chromium';
    const launcher = pwRecord[browserType] || pw.chromium;

    const { proxy, ...rest } = options;
    const launchOptions = /** @type {import('playwright').LaunchOptions} */ ({
      headless: options.headless !== false,
      args: [
        '--disable-blink-features=AutomationControlled',
        ...(options.args || []),
      ],
      ...rest,
    });

    if (proxy && typeof proxy === 'object') {
      launchOptions.proxy = {
        server: proxy.server || '',
        username: proxy.username,
        password: proxy.password,
      };
    }

    const browser = await launcher.launch(launchOptions);
    return { _native: browser, _adapter: this.name, _browserType: browserType };
  }

  /**
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    const b = /** @type {AdapterBrowser & { _native: import('playwright').Browser, _preserveProfile?: boolean }} */ (browser);
    const preserveProfile = options.preserveProfile ?? b._preserveProfile ?? false;
    if (preserveProfile) {
      const contexts = b._native.contexts();
      const context = contexts.length > 0 ? contexts[0] : await b._native.newContext();
      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      return { _native: page, _context: context, _adapter: this.name, _preserveProfile: true };
    }

    const width = options.viewport?.width || 1280 + Math.floor(Math.random() * 100);
    const height = options.viewport?.height || 800;

    const contextOptions = {
      viewport: { width, height },
      userAgent: options.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    const context = await b._native.newContext(/** @type {import('playwright').BrowserContextOptions} */ (contextOptions));
    const page = await context.newPage();

    return { _native: page, _context: context, _adapter: this.name };
  }

  /**
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    const waitUntilMap = /** @type {Record<NonNullable<GotoOptions['waitUntil']>, 'load'|'domcontentloaded'|'networkidle'>} */ ({
      load: 'load',
      domcontentloaded: 'domcontentloaded',
      networkidle: 'networkidle',
      networkidle0: 'networkidle',
      networkidle2: 'networkidle',
    });
    const waitUntil = /** @type {'load'|'domcontentloaded'|'networkidle'|'commit'} */ (options.waitUntil ? waitUntilMap[options.waitUntil] : 'networkidle');
    await p._native.goto(url, { waitUntil, timeout: options.timeout || 30000 });
  }

  /**
   * @param {AdapterPage} page
   * @param {((...args: unknown[]) => unknown)|string} fn
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async evaluate(page, fn, ...args) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    const native = /** @type {{ evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown> }} */ (p._native);
    return native.evaluate(fn, ...args);
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {((...args: unknown[]) => unknown)} [mapFn]
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    const native = /** @type {{ $$eval: (selector: string, mapFn: (elements: unknown[]) => unknown) => Promise<unknown>, $$: (selector: string) => Promise<unknown[]> }} */ (p._native);
    if (mapFn) {
      return /** @type {Promise<Array<unknown>>} */ (native.$$eval(selector, /** @type {(elements: unknown[]) => unknown} */ (mapFn)));
    }
    return native.$$(selector);
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    return p._native.content();
  }

  /**
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page, _context?: import('playwright').BrowserContext }} */ (page);
    const context = p._context || p._native.context();
    await context.addCookies([{
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
    }]);
  }

  /**
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    const native = /** @type {{ evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown> }} */ (p._native);
    if (options.y !== undefined) {
      await native.evaluate(/** @param {unknown} y */ (y) => window.scrollBy(0, Number(y)), options.y);
    } else {
      await native.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    return p._native.screenshot(options);
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    await p._native.waitForSelector(selector, { timeout: options.timeout || 30000 });
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page, _context?: import('playwright').BrowserContext, _preserveProfile?: boolean }} */ (page);
    if (p._preserveProfile) {
      if (p._native && typeof p._native.close === 'function') {
        await p._native.close();
      }
      return;
    }
    if (p._context) {
      await p._context.close();
    } else {
      await p._native.close();
    }
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    const b = /** @type {AdapterBrowser & { _native: import('playwright').Browser }} */ (browser);
    await b._native.close();
  }

  /**
   * Start tracing (Playwright-specific — useful for debugging)
   * @param {AdapterPage} page
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<void>}
   */
  async startTracing(page, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page, _context?: import('playwright').BrowserContext }} */ (page);
    const context = p._context || p._native.context();
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      ...options,
    });
  }

  /**
   * Stop tracing and save
   * @param {AdapterPage} page
   * @param {string} [path]
   * @returns {Promise<void>}
   */
  async stopTracing(page, path = 'trace.zip') {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page, _context?: import('playwright').BrowserContext }} */ (page);
    const context = p._context || p._native.context();
    await context.tracing.stop({ path });
  }

  /**
   * Route interception (Playwright-specific)
   * Block images, CSS, fonts to speed up scraping
   * @param {AdapterPage} page
   * @param {string[]} [resourceTypes]
   * @returns {Promise<void>}
   */
  async blockResources(page, resourceTypes = ['image', 'stylesheet', 'font']) {
    const p = /** @type {AdapterPage & { _native: import('playwright').Page }} */ (page);
    await p._native.route('**/*', /** @param {import('playwright').Route} route */ (route) => {
      if (resourceTypes.includes(route.request().resourceType())) {
        route.abort();
      } else {
        route.continue();
      }
    });
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

  /**
   * Connect to an existing Chrome instance via CDP.
   * @param {string} cdpUrl - e.g. 'http://localhost:9222'
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async connect(cdpUrl, options = {}) {
    const pw = await this.#getPlaywright();
    const pwRecord = /** @type {Record<string, import('playwright').BrowserType | undefined>} */ (/** @type {unknown} */ (pw));
    const browserType = options.browserType || options.browser || 'chromium';
    const launcher = pwRecord[browserType] || pw.chromium;
    const connectOptions = /** @type {import('playwright').ConnectOptions} */ ({ ...options });
    const browser = await launcher.connectOverCDP(cdpUrl, connectOptions);
    return {
      _native: browser,
      _adapter: this.name,
      _browserType: browserType,
      _cdp: true,
      _preserveProfile: options.preserveProfile ?? true,
    };
  }
}

export default PlaywrightAdapter;
