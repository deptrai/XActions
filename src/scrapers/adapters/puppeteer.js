// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — Puppeteer
 *
 * Adapter wrapping puppeteer-extra with stealth plugin.
 * This is the default adapter — matches the original XActions scraper behavior.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { BaseAdapter } from './base.js';

export class PuppeteerAdapter extends BaseAdapter {
  name = 'puppeteer';
  description = 'Puppeteer with stealth plugin — full browser automation, JS execution, best anti-detection';
  supportsJavaScript = true;
  requiresBrowser = true;

  /** @type {import('puppeteer-extra').PuppeteerExtra | null} */
  #puppeteer = null;

  async #getPuppeteer() {
    if (!this.#puppeteer) {
      const puppeteer = await import('puppeteer-extra');
      const { default: StealthPlugin } = await import('puppeteer-extra-plugin-stealth');
      puppeteer.default.use(StealthPlugin());
      this.#puppeteer = /** @type {import('puppeteer-extra').PuppeteerExtra} */ (/** @type {unknown} */ (puppeteer.default));
    }
    if (!this.#puppeteer) {
      throw new Error('puppeteer-extra could not be initialized');
    }
    return this.#puppeteer;
  }

  async checkDependencies() {
    try {
      await import('puppeteer-extra');
      await import('puppeteer-extra-plugin-stealth');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        message: 'Install puppeteer: npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth',
      };
    }
  }

  /**
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async launch(options = {}) {
    const puppeteer = await this.#getPuppeteer();
    const { proxy, ...rest } = options;
    const launchOptions = /** @type {import('puppeteer').LaunchOptions} */ ({
      headless: options.headless !== false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        ...(options.args || []),
        ...(proxy && typeof proxy === 'object' ? [`--proxy-server=${proxy.server}`] : []),
      ],
      ...rest,
    });
    const browser = await puppeteer.launch(launchOptions);
    return { _native: browser, _adapter: this.name };
  }

  /**
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    const nativeBrowser = /** @type {import('puppeteer').Browser} */ (browser._native);
    const page = await nativeBrowser.newPage();
    const width = options.viewport?.width || 1280 + Math.floor(Math.random() * 100);
    const height = options.viewport?.height || 800;
    await page.setViewport({ width, height });

    if (options.userAgent) {
      await page.setUserAgent(options.userAgent);
    } else {
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
    }

    return { _native: page, _adapter: this.name };
  }

  /**
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    const waitUntilMap = /** @type {Record<NonNullable<GotoOptions['waitUntil']>, import('puppeteer').PuppeteerLifeCycleEvent>} */ ({
      load: 'load',
      domcontentloaded: 'domcontentloaded',
      networkidle: 'networkidle2',
      networkidle0: 'networkidle0',
      networkidle2: 'networkidle2',
    });
    const waitUntil = options.waitUntil ? waitUntilMap[options.waitUntil] : 'networkidle2';
    await nativePage.goto(url, { waitUntil, timeout: options.timeout || 30000 });
  }

  /**
   * @param {AdapterPage} page
   * @param {Function|string} fn
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async evaluate(page, fn, ...args) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    return nativePage.evaluate(/** @type {import('puppeteer').EvaluateFunc<unknown[]> | string} */ (fn), ...args);
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {Function} [mapFn]
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    if (mapFn) {
      return /** @type {Promise<Array<unknown>>} */ (nativePage.$$eval(selector, /** @type {(elements: unknown[]) => unknown} */ (mapFn)));
    }
    return nativePage.$$(selector);
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    return nativePage.content();
  }

  /**
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    await nativePage.setCookie(cookie);
  }

  /**
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    if (options.y !== undefined) {
      await nativePage.evaluate((y) => window.scrollBy(0, y), options.y);
    } else {
      await nativePage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    return /** @type {Promise<Buffer>} */ (nativePage.screenshot(options));
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    await nativePage.waitForSelector(selector, { timeout: options.timeout || 30000 });
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    const nativePage = /** @type {import('puppeteer').Page} */ (page._native);
    await nativePage.close();
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    const nativeBrowser = /** @type {import('puppeteer').Browser} */ (browser._native);
    await nativeBrowser.close();
  }

  /**
   * Get the native Puppeteer page for direct access (backward compat / advanced usage)
   * @param {AdapterPage} page
   * @returns {unknown}
   */
  getNativePage(page) {
    return page._native;
  }

  /**
   * Get the native Puppeteer browser for direct access
   * @param {AdapterBrowser} browser
   * @returns {unknown}
   */
  getNativeBrowser(browser) {
    return browser._native;
  }

  /**
   * Connect to an existing Chrome instance via CDP.
   * Fetches the WebSocket debugger URL from /json/version then puppeteer.connects.
   * @param {string} cdpUrl - e.g. 'http://localhost:9222'
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async connect(cdpUrl, options = {}) {
    const url = new URL(cdpUrl);
    const versionUrl = `${url.protocol}//${url.host}/json/version`;

    const response = await fetch(versionUrl);
    if (!response.ok) {
      throw new Error(`[CDP ERROR] Could not connect to Chrome on ${cdpUrl}: ${response.status} ${response.statusText}`);
    }

    const version = await response.json();
    if (!version.webSocketDebuggerUrl) {
      throw new Error('[CDP ERROR] Chrome DevTools endpoint returned empty. Please refresh the browser and retry.');
    }

    const puppeteer = await this.#getPuppeteer();
    const connectOptions = /** @type {import('puppeteer').ConnectOptions} */ ({
      browserWSEndpoint: version.webSocketDebuggerUrl,
      defaultViewport: null,
      ...options,
    });
    const browser = await puppeteer.connect(connectOptions);

    return { _native: browser, _adapter: this.name, _browserType: 'chromium' };
  }
}

export default PuppeteerAdapter;
