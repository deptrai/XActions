// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — Crawlee
 *
 * Adapter wrapping Crawlee (by Apify) — the best-in-class Node.js crawling framework.
 * Adds smart request queuing, automatic retries, proxy rotation, session management,
 * and anti-blocking measures on top of Puppeteer or Playwright.
 *
 * Best for: production-scale scraping, rotating proxies, managing large crawl jobs,
 * automatic retry/error handling, respecting rate limits.
 *
 * Crawlee can use either Puppeteer or Playwright as its underlying browser.
 *
 * Install: npm install crawlee
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { BaseAdapter } from './base.js';

export class CrawleeAdapter extends BaseAdapter {
  name = 'crawlee';
  description = 'Crawlee (Apify) — smart crawling with auto-retry, proxy rotation, session management, request queuing';
  supportsJavaScript = true;
  requiresBrowser = true;

  /** @type {import('crawlee') | null} */
  #crawlee = null;

  async #getCrawlee() {
    if (!this.#crawlee) {
      this.#crawlee = await import('crawlee');
    }
    if (!this.#crawlee) {
      throw new Error('crawlee could not be loaded');
    }
    return this.#crawlee;
  }

  async checkDependencies() {
    try {
      await import('crawlee');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        message: 'Install crawlee: npm install crawlee',
      };
    }
  }

  /**
   * Launch a Crawlee browser pool.
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async launch(options = {}) {
    const crawlee = await this.#getCrawlee();
    const browserPlugin = options.browserPlugin || 'puppeteer';

    const launchOptions = {
      headless: options.headless !== false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        ...(options.args || []),
      ],
    };

    const launchContext = { launchOptions };

    /** @type {import('crawlee').CrawleeBrowserPool | null} */
    let browserPool = null;

    try {
      const bp = await import('@crawlee/browser-pool');
      const BrowserPool = bp.BrowserPool;
      const PuppeteerPlugin = bp.PuppeteerPlugin;
      const PlaywrightPlugin = bp.PlaywrightPlugin;

      /** @type {import('crawlee').CrawleePlugin} */
      let plugin;
      if (browserPlugin === 'playwright') {
        const pw = await import('playwright');
        plugin = new PlaywrightPlugin(pw.chromium, launchContext);
      } else {
        const pptr = await import('puppeteer');
        plugin = new PuppeteerPlugin(pptr.default, launchContext);
      }

      browserPool = new BrowserPool({
        browserPlugins: [plugin],
        maxOpenPagesPerBrowser: options.maxPagesPerBrowser || 3,
        retireBrowserAfterPageCount: options.retireAfter || 20,
      });
    } catch (e) {
      throw new Error(`Crawlee browser pool could not be created: ${e instanceof Error ? e.message : String(e)}`);
    }

    let proxyConfiguration = null;
    if (options.proxyUrls?.length) {
      proxyConfiguration = new crawlee.ProxyConfiguration({
        proxyUrls: options.proxyUrls,
      });
    }

    return {
      _native: browserPool,
      _adapter: this.name,
      _browserPlugin: browserPlugin,
      _proxyConfiguration: proxyConfiguration,
      _crawlee: crawlee,
    };
  }

  /**
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    const b = /** @type {AdapterBrowser & { _native: import('crawlee').CrawleeBrowserPool, _browserPlugin: string }} */ (browser);
    const page = await b._native.newPage();

    try {
      const width = options.viewport?.width || 1280 + Math.floor(Math.random() * 100);
      const height = options.viewport?.height || 800;
      await page.setViewport({ width, height });
      await page.setUserAgent(
        options.userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );
    } catch {
      // BrowserPool page may not support these directly
    }

    return {
      _native: page,
      _adapter: this.name,
      _browserPool: b._native,
    };
  }

  /**
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    const waitUntilMap = /** @type {Record<NonNullable<GotoOptions['waitUntil']>, string>} */ ({
      load: 'load',
      domcontentloaded: 'domcontentloaded',
      networkidle: 'networkidle2',
      networkidle0: 'networkidle0',
      networkidle2: 'networkidle2',
    });
    const waitUntil = options.waitUntil ? waitUntilMap[options.waitUntil] : 'networkidle2';
    await p._native.goto(url, { waitUntil, timeout: options.timeout || 30000 });
  }

  /**
   * @param {AdapterPage} page
   * @param {((...args: unknown[]) => unknown)|string} fn
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async evaluate(page, fn, ...args) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    return p._native.evaluate(fn, ...args);
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {((...args: unknown[]) => unknown)} [mapFn]
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    if (mapFn) {
      return /** @type {Promise<Array<unknown>>} */ (p._native.$$eval(selector, /** @type {(elements: unknown[]) => unknown} */ (mapFn)));
    }
    return p._native.$$(selector);
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    return p._native.content();
  }

  /**
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    if (typeof p._native.setCookie === 'function') {
      await p._native.setCookie(cookie);
    } else if (p._native.context) {
      const context = p._native.context();
      await context.addCookies([{
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path || '/',
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure || false,
      }]);
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    if (options.y !== undefined) {
      await p._native.evaluate((y) => window.scrollBy(0, Number(y)), options.y);
    } else {
      await p._native.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    return /** @type {Promise<Buffer>} */ (p._native.screenshot(options));
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage }} */ (page);
    await p._native.waitForSelector(selector, { timeout: options.timeout || 30000 });
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    const p = /** @type {AdapterPage & { _native: import('crawlee').CrawleePage, _browserPool: import('crawlee').CrawleeBrowserPool }} */ (page);
    try {
      await p._native.close();
    } catch {
      // Page may already be closed
    }
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    const b = /** @type {AdapterBrowser & { _native: import('crawlee').CrawleeBrowserPool }} */ (browser);
    await b._native.destroy();
  }

  /**
   * Crawlee-specific: Create a full PuppeteerCrawler or PlaywrightCrawler
   * @param {CreateCrawlerOptions} [options]
   * @returns {Promise<{ run: () => Promise<unknown> }>}
   */
  async createCrawler(options = {}) {
    const crawlee = await this.#getCrawlee();
    const { PuppeteerCrawler, ProxyConfiguration } = crawlee;

    /** @type {import('crawlee').CrawlerOptions} */
    const crawlerOptions = {
      requestHandler: options.requestHandler,
      maxRequestsPerCrawl: options.maxRequestsPerCrawl || 100,
      maxConcurrency: options.maxConcurrency || 1,
      launchContext: {
        launchOptions: {
          headless: options.headless !== false,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      },
    };

    if (options.proxyUrls?.length) {
      crawlerOptions.proxyConfiguration = new ProxyConfiguration({
        proxyUrls: options.proxyUrls,
      });
    }

    const crawler = new PuppeteerCrawler(crawlerOptions);
    return crawler;
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

export default CrawleeAdapter;
