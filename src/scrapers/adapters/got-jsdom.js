// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — Got + JSDOM
 * Lightweight DOM adapter for testing and lightweight HTML scraping without full Chromium.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { BaseAdapter } from './base.js';
import { JSDOM } from 'jsdom';

export class GotJsdomAdapter extends BaseAdapter {
  name = 'got-jsdom';
  description = 'Lightweight HTTP + JSDOM adapter for fast DOM parsing without a browser binary';
  supportsJavaScript = true;
  requiresBrowser = false;

  async checkDependencies() {
    return { available: true };
  }

  async launch(options = {}) {
    return {
      close: async () => {},
    };
  }

  async newPage(browser, options = {}) {
    const pageCookies = [];

    const pageObj = {
      _cookies: pageCookies,
      _dom: null,
      _url: 'about:blank',

      url() {
        return this._url;
      },

      async goto(url, navOptions = {}) {
        this._url = url;
        const cookieHeader = this._cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        const headers = { ...(navOptions.headers || {}) };
        if (cookieHeader && !headers.cookie && !headers.Cookie) {
          headers.cookie = cookieHeader;
        }

        const res = await fetch(url, { headers });
        const html = await res.text();
        this._dom = new JSDOM(html, { url });
        return {
          ok: () => res.ok,
          status: () => res.status,
        };
      },

      async evaluate(fn, ...args) {
        if (!this._dom) {
          throw new Error('No document loaded. Call goto() first.');
        }
        const { window } = this._dom;
        const previousWindow = globalThis.window;
        const previousDocument = globalThis.document;

        try {
          globalThis.window = window;
          globalThis.document = window.document;
          if (typeof fn === 'function') {
            return await fn(...args);
          }
          if (typeof fn === 'string') {
            return window.eval(fn);
          }
        } finally {
          globalThis.window = previousWindow;
          globalThis.document = previousDocument;
        }
      },

      async content() {
        return this._dom ? this._dom.serialize() : '';
      },

      async title() {
        return this._dom ? this._dom.window.document.title : '';
      },

      async cookies() {
        return [...this._cookies];
      },

      async close() {
        if (this._dom) {
          this._dom.window.close();
          this._dom = null;
        }
      },
    };

    return pageObj;
  }

  async goto(page, url, options = {}) {
    return await page.goto(url, options);
  }

  async scroll(page, options = {}) {
    // In JSDOM, scroll is a no-op
    return;
  }

  async evaluate(page, fn, ...args) {
    return await page.evaluate(fn, ...args);
  }

  async getContent(page) {
    return await page.content();
  }

  async setCookie(page, cookie) {
    if (page && page._cookies && cookie) {
      page._cookies.push(cookie);
    }
  }

  async setCookies(page, cookies) {
    if (Array.isArray(cookies)) {
      for (const c of cookies) {
        await this.setCookie(page, c);
      }
    }
  }

  async closePage(page) {
    if (page && typeof page.close === 'function') {
      await page.close();
    }
  }

  async close(browser) {
    if (browser && typeof browser.close === 'function') {
      await browser.close();
    }
  }

  async createBrowser(options = {}) {
    return await this.launch(options);
  }

  async createPage(browser, options = {}) {
    return await this.newPage(browser, options);
  }
}

export default GotJsdomAdapter;
