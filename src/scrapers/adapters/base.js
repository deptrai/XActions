// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — Base Class
 *
 * Abstract interface that all scraper framework adapters must implement.
 * This enables XActions to work with Puppeteer, Playwright, HTTP/Cheerio,
 * or any other scraping framework.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

export class BaseAdapter {
  /** @type {string} Adapter name */
  name = 'base';

  constructor() {
    if (new.target === BaseAdapter) {
      throw new TypeError('BaseAdapter is abstract; extend it.');
    }
  }

  /** @type {string} Adapter description */
  description = 'Abstract base adapter';

  /** @type {boolean} Whether this adapter supports JavaScript execution */
  supportsJavaScript = false;

  /** @type {boolean} Whether this adapter needs a browser binary */
  requiresBrowser = false;

  /**
   * Check if this adapter's dependencies are available
   * @returns {Promise<{ available: boolean, message?: string }>}
   */
  async checkDependencies() {
    throw new Error(`${this.name}: checkDependencies() not implemented`);
  }

  /**
   * Launch a browser instance (or equivalent context)
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async launch(options = {}) {
    throw new Error(`${this.name}: launch() not implemented`);
  }

  /**
   * Create a new page with realistic settings
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    throw new Error(`${this.name}: newPage() not implemented`);
  }

  /**
   * Navigate to a URL
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    throw new Error(`${this.name}: goto() not implemented`);
  }

  /**
   * Execute JavaScript in page context
   * Only available for browser-based adapters (supportsJavaScript === true)
   * @param {AdapterPage} page
   * @param {((...args: unknown[]) => unknown)|string} fn - Function or string to evaluate
   * @param {...unknown} args - Arguments to pass to the function
   * @returns {Promise<unknown>} Result of evaluation
   */
  async evaluate(page, fn, ...args) {
    throw new Error(`${this.name}: evaluate() not implemented — this adapter does not support JS execution`);
  }

  /**
   * Query all matching elements and extract data
   * Works for both browser and HTTP adapters
   * @param {AdapterPage} page
   * @param {string} selector - CSS selector
   * @param {((...args: unknown[]) => unknown)} [mapFn] - Function to map each element (receives element)
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    throw new Error(`${this.name}: queryAll() not implemented`);
  }

  /**
   * Get the full HTML content of the page
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    throw new Error(`${this.name}: getContent() not implemented`);
  }

  /**
   * Set a single cookie on the page/context
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    throw new Error(`${this.name}: setCookie() not implemented`);
  }

  /**
   * Set multiple cookies on the page/context
   * @param {AdapterPage} page
   * @param {Array<Cookie>} cookies
   * @returns {Promise<void>}
   */
  async setCookies(page, cookies) {
    for (const cookie of cookies) {
      await this.setCookie(page, cookie);
    }
  }

  /**
   * Connect to an existing browser via CDP (Chrome DevTools Protocol)
   * @param {string} cdpUrl - CDP HTTP endpoint, e.g. 'http://localhost:9222'
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async connect(cdpUrl, options = {}) {
    throw new Error(`${this.name}: connect() not implemented`);
  }

  /**
   * Scroll the page
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    throw new Error(`${this.name}: scroll() not implemented`);
  }

  /**
   * Take a screenshot
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    throw new Error(`${this.name}: screenshot() not implemented`);
  }

  /**
   * Wait for a selector to appear
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    throw new Error(`${this.name}: waitForSelector() not implemented`);
  }

  /**
   * Close a page
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    throw new Error(`${this.name}: closePage() not implemented`);
  }

  /**
   * Close a browser instance
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    throw new Error(`${this.name}: closeBrowser() not implemented`);
  }

  /**
   * Get adapter info
   * @returns {{ name: string, description: string, supportsJavaScript: boolean, requiresBrowser: boolean }}
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      supportsJavaScript: this.supportsJavaScript,
      requiresBrowser: this.requiresBrowser,
    };
  }
}

export default BaseAdapter;
