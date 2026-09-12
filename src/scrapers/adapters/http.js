// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — HTTP (GraphQL)
 *
 * Adapter that wraps the Twitter HTTP/GraphQL scraper into the adapter
 * interface, so users can switch between Puppeteer and HTTP with a single
 * config change: `createBrowser({ adapter: 'http' })`.
 *
 * No browser binary required. 10x faster. Works in serverless/edge.
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { BaseAdapter } from './base.js';

export class HttpAdapter extends BaseAdapter {
  name = 'http';
  description = 'Direct HTTP/GraphQL — no browser needed, 10x faster, works in serverless/edge';
  supportsJavaScript = false;
  requiresBrowser = false;

  async checkDependencies() {
    try {
      await import('../social/twitter/client.js');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        message: 'Twitter client module not found. Ensure src/scrapers/social/twitter/ is present.',
      };
    }
  }

  /**
   * "Launch" for HTTP means creating a client instance (no browser to spawn).
   * @param {Record<string, any>} [options]
   * @returns {Promise<any>}
   */
  async launch(options = {}) {
    const { TwitterClient } = await import('../social/twitter/client.js');
    const client = new TwitterClient(options);
    return {
      _native: client,
      _adapter: this.name,
      _scraper: client,
      ...client,
    };
  }

  /**
   * HTTP doesn't have pages — return the scraper itself as the "page".
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    const b = /** @type {AdapterBrowser & { _scraper: any }} */ (browser);
    return {
      _native: b._scraper,
      _adapter: this.name,
      ...b._scraper,
    };
  }

  /**
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    // HTTP adapter doesn't navigate — scraping is done via direct API calls.
  }

  /**
   * @param {AdapterPage} page
   * @param {((...args: unknown[]) => unknown)|string} fn
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async evaluate(page, fn, ...args) {
    throw new Error('HttpAdapter: evaluate() is not supported — HTTP adapter does not run JavaScript in a page context');
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {((...args: unknown[]) => unknown)} [mapFn]
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    throw new Error('HttpAdapter: queryAll() is not supported — use scraper methods (scrapeProfile, scrapeTweets, etc.) instead');
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    throw new Error('HttpAdapter: getContent() is not supported — use scraper methods instead');
  }

  /**
   * Set a cookie on the HTTP client.
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    const p = /** @type {AdapterPage & any} */ (page);
    const client = p.client;
    if (client && typeof client.setCookies === 'function') {
      client.setCookies(`${cookie.name}=${cookie.value}`);
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    // No-op — HTTP adapter doesn't have a viewport to scroll
  }

  /**
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    throw new Error('HttpAdapter: screenshot() is not supported — HTTP adapter has no visual output');
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    // No-op — HTTP adapter doesn't render DOM
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    // No-op — nothing to close
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    // No-op — no browser process to terminate
  }

  /**
   * Get the underlying HTTP scraper object for direct access.
   * @param {AdapterBrowser} browser
   * @returns {any}
   */
  getScraper(browser) {
    const b = /** @type {AdapterBrowser & { _scraper: any }} */ (browser);
    return b._scraper;
  }
}

export default HttpAdapter;
