// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared Browser Automation & Export Utilities
 *
 * Provides standalone `createBrowser`, `createPage`, `loginWithCookie`,
 * and export utilities (`exportToJSON`, `exportToCSV`) used across scrapers
 * and callers. Extracted from legacy twitter scraper in Story 26.2.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';

puppeteer.use(StealthPlugin());

/**
 * @typedef {Object} LaunchOptions
 * @property {boolean | 'shell'} [headless=true] - Run browser in headless mode
 * @property {'chrome' | 'firefox'} [browser='chrome'] - Which browser to launch
 * @property {string[]} [args] - Additional command line arguments
 * @property {string} [adapter] - Scraping framework adapter
 */

/**
 * @typedef {Object} NewPageOptions
 * @property {boolean} [preserveProfile=false] - When true, preserve the user profile
 */

/**
 * Create a browser instance with stealth settings.
 *
 * Supports adapter mode:
 *   const browser = await createBrowser({ adapter: 'playwright' });
 *   const browser = await createBrowser({ adapter: 'puppeteer' });
 *   const browser = await createBrowser(); // Default Puppeteer
 *
 * @param {LaunchOptions & Record<string, any>} [options]
 * @returns {Promise<import('puppeteer').Browser>} Browser instance
 */
export async function createBrowser(options = {}) {
  if (options.adapter) {
    const { getAdapter } = await import('./adapters/index.js');
    const adapter = await getAdapter(options.adapter);
    const { adapter: _, ...adapterOptions } = options;
    const adapterBrowser = await adapter.launch(adapterOptions);
    const browser = /** @type {import('puppeteer').Browser} */ (adapterBrowser._native);
    browser._adapter = adapterBrowser._adapter;
    browser._native = adapterBrowser._native;
    return browser;
  }

  const {
    headless,
    browser,
    browserType,
    browserPlugin,
    seleniumServer,
    maxPagesPerBrowser,
    retireAfter,
    fingerprint,
    headerGeneratorOptions,
    runScripts,
    cookies,
    headers,
    rateLimitStrategy,
    proxyUrl,
    proxyUrls,
    maxConcurrency,
    maxRequestsPerCrawl,
    userAgent,
    proxy,
    adapter: _,
    ...puppeteerOptions
  } = options;

  return puppeteer.launch({
    headless: headless === 'shell' ? 'shell' : headless !== false ? true : false,
    browser: browser === 'firefox' ? 'firefox' : 'chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    ...puppeteerOptions,
  });
}

/**
 * Create a page with realistic settings.
 * Works with both native Puppeteer browsers and adapter browsers.
 *
 * @param {import('puppeteer').Browser} browser - Browser instance (native or adapter)
 * @param {NewPageOptions} [options]
 * @returns {Promise<import('puppeteer').Page>} Page instance
 */
export async function createPage(browser, options = {}) {
  const bObj = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (browser));
  const isCdp = Boolean(options.preserveProfile || bObj._cdp || bObj._preserveProfile);
  if (bObj._adapter) {
    const { getAdapter } = await import('./adapters/index.js');
    const adapter = await getAdapter(String(bObj._adapter));
    const adapterPage = await adapter.newPage(
      /** @type {any} */ (browser),
      { preserveProfile: isCdp, ...options }
    );
    const page = /** @type {import('puppeteer').Page} */ (adapterPage._native);
    page._adapter = adapterPage._adapter;
    page._native = adapterPage._native;
    return page;
  }

  const page = await browser.newPage();
  if (!isCdp) {
    await page.setViewport({ width: 1280 + Math.floor(Math.random() * 100), height: 800 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
  }
  return page;
}

/**
 * Login with session cookie.
 * Works with both native Puppeteer pages and adapter pages.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} authToken
 * @returns {Promise<import('puppeteer').Page>}
 */
export async function loginWithCookie(page, authToken) {
  if (/** @type {any} */ (page)._adapter) {
    const { getAdapter } = await import('./adapters/index.js');
    const adapter = await getAdapter(/** @type {any} */ (page)._adapter);
    const adapterPage = /** @type {any} */ (page);
    await adapter.setCookie(adapterPage, {
      name: 'auth_token',
      value: authToken,
      domain: '.x.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });
    await adapter.goto(adapterPage, 'https://x.com/home', { waitUntil: 'networkidle' });
    return page;
  }

  await page.setCookie({
    name: 'auth_token',
    value: authToken,
    domain: '.x.com',
    path: '/',
    httpOnly: true,
    secure: true,
  });
  await page.goto('https://x.com/home', { waitUntil: 'networkidle2' });
  return page;
}

/**
 * Export data to JSON file.
 * @param {unknown} data
 * @param {string} filename
 * @returns {Promise<string>}
 */
export async function exportToJSON(data, filename) {
  await fs.writeFile(filename, JSON.stringify(data, null, 2));
  return filename;
}

/**
 * Export data to CSV file.
 * @param {Array<Record<string, unknown>>} data
 * @param {string} filename
 * @returns {Promise<string>}
 */
export async function exportToCSV(data, filename) {
  if (!data || !data.length) return filename;
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((header) => {
        const val = row[header];
        const str = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  await fs.writeFile(filename, csv);
  return filename;
}

export default {
  createBrowser,
  createPage,
  loginWithCookie,
  exportToJSON,
  exportToCSV,
};
