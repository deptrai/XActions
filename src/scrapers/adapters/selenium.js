// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Scraper Adapter — Selenium WebDriver
 *
 * Adapter wrapping Selenium WebDriver for browser automation.
 * Selenium is the original browser automation framework — mature, cross-language,
 * widely used in enterprise and testing environments.
 *
 * Supports: Chrome (via chromedriver), Firefox (via geckodriver), Edge, Safari.
 *
 * Best for: teams already using Selenium, enterprise environments, cross-language
 * automation suites, when you need to reuse existing Selenium infrastructure.
 *
 * Install: npm install selenium-webdriver
 * Plus a driver: npm install chromedriver  (or geckodriver for Firefox)
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

import { BaseAdapter } from './base.js';

export class SeleniumAdapter extends BaseAdapter {
  name = 'selenium';
  description = 'Selenium WebDriver — classic browser automation, cross-browser, enterprise-grade, cross-language ecosystem';
  supportsJavaScript = true;
  requiresBrowser = true;

  /** @type {typeof import('selenium-webdriver') | null} */
  #selenium = null;

  async #getSelenium() {
    if (!this.#selenium) {
      this.#selenium = await import('selenium-webdriver');
    }
    if (!this.#selenium) {
      throw new Error('selenium-webdriver could not be loaded');
    }
    return this.#selenium;
  }

  async checkDependencies() {
    try {
      await import('selenium-webdriver');
      return { available: true };
    } catch (e) {
      return {
        available: false,
        message: 'Install selenium: npm install selenium-webdriver chromedriver',
      };
    }
  }

  /**
   * Launch a Selenium WebDriver browser.
   * @param {LaunchOptions} [options]
   * @returns {Promise<AdapterBrowser>}
   */
  async launch(options = {}) {
    const selenium = await this.#getSelenium();
    const { Builder } = selenium;
    const browserName = options.browser || 'chrome';

    let builder = new Builder().forBrowser(browserName);

    if (options.seleniumServer) {
      builder = builder.usingServer(options.seleniumServer);
    }

    if (browserName === 'chrome') {
      try {
        const chrome = await import('selenium-webdriver/chrome.js');
        const chromeOptions = new chrome.Options();

        if (options.headless !== false) {
          chromeOptions.addArguments('--headless=new');
        }
        chromeOptions.addArguments(
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          ...(options.args || []),
        );

        if (options.proxy) {
          const proxyServer = typeof options.proxy === 'object' ? options.proxy.server : options.proxy;
          if (proxyServer) chromeOptions.addArguments(`--proxy-server=${proxyServer}`);
        }

        chromeOptions.excludeSwitches('enable-automation');
        chromeOptions.addArguments('--disable-infobars');

        builder = builder.setChromeOptions(chromeOptions);
      } catch {
        // chromedriver not available, try basic config
      }
    } else if (browserName === 'firefox') {
      try {
        const firefox = await import('selenium-webdriver/firefox.js');
        const firefoxOptions = new firefox.Options();

        if (options.headless !== false) {
          firefoxOptions.addArguments('--headless');
        }
        if (options.proxy) {
          const proxyServer = typeof options.proxy === 'object' ? options.proxy.server : options.proxy;
          firefoxOptions.setPreference('network.proxy.type', 1);
          if (proxyServer) firefoxOptions.setPreference('network.proxy.http', proxyServer);
        }

        builder = builder.setFirefoxOptions(firefoxOptions);
      } catch {
        // geckodriver not available
      }
    }

    const driver = await builder.build();

    return {
      _native: driver,
      _adapter: this.name,
      _browserName: browserName,
    };
  }

  /**
   * @param {AdapterBrowser} browser
   * @param {NewPageOptions} [options]
   * @returns {Promise<AdapterPage>}
   */
  async newPage(browser, options = {}) {
    const b = /** @type {AdapterBrowser & { _native: import('selenium-webdriver').WebDriver }} */ (browser);
    const driver = b._native;

    const width = options.viewport?.width || 1280 + Math.floor(Math.random() * 100);
    const height = options.viewport?.height || 800;
    await driver.manage().window().setRect({ width, height });

    return {
      _native: driver,
      _adapter: this.name,
      _windowHandle: await driver.getWindowHandle(),
      _isNewWindow: false,
    };
  }

  /**
   * @param {AdapterPage} page
   * @param {string} url
   * @param {GotoOptions} [options]
   * @returns {Promise<void>}
   */
  async goto(page, url, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;

    await driver.switchTo().window(p._windowHandle);
    await driver.get(url);

    const waitUntil = options.waitUntil || 'networkidle';
    const timeout = options.timeout || 30000;

    if (waitUntil === 'load' || waitUntil === 'networkidle' || waitUntil === 'networkidle2') {
      await driver.wait(async () => {
        const state = await driver.executeScript('return document.readyState');
        return /** @type {string} */ (state) === 'complete';
      }, timeout);
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {((...args: unknown[]) => unknown)|string} fn
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async evaluate(page, fn, ...args) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);

    if (typeof fn === 'function') {
      const script = `return (${fn.toString()}).apply(null, arguments);`;
      return driver.executeScript(script, ...args);
    }
    return driver.executeScript(fn, ...args);
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {((...args: unknown[]) => unknown)} [mapFn]
   * @returns {Promise<Array<unknown>>}
   */
  async queryAll(page, selector, mapFn) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);

    const selenium = await this.#getSelenium();
    const { By } = selenium;

    if (mapFn) {
      const script = `
        const elements = document.querySelectorAll(arguments[0]);
        const fn = ${mapFn.toString()};
        return fn(Array.from(elements));
      `;
      return /** @type {unknown[]} */ (await driver.executeScript(script, selector));
    }

    return driver.findElements(By.css(selector));
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<string>}
   */
  async getContent(page) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);
    return driver.getPageSource();
  }

  /**
   * @param {AdapterPage} page
   * @param {Cookie} cookie
   * @returns {Promise<void>}
   */
  async setCookie(page, cookie) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);

    await driver.manage().addCookie({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
    });
  }

  /**
   * @param {AdapterPage} page
   * @param {ScrollOptions} [options]
   * @returns {Promise<void>}
   */
  async scroll(page, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);

    if (options.y !== undefined) {
      await driver.executeScript(`window.scrollBy(0, ${options.y})`);
    } else {
      await driver.executeScript('window.scrollTo(0, document.body.scrollHeight)');
    }
  }

  /**
   * @param {AdapterPage} page
   * @param {ScreenshotOptions} [options]
   * @returns {Promise<Buffer>}
   */
  async screenshot(page, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);

    const base64 = await driver.takeScreenshot();
    const buffer = Buffer.from(/** @type {string} */ (base64), 'base64');

    if (options.path) {
      const fs = await import('fs/promises');
      await fs.writeFile(options.path, buffer);
    }
    return buffer;
  }

  /**
   * @param {AdapterPage} page
   * @param {string} selector
   * @param {WaitForSelectorOptions} [options]
   * @returns {Promise<void>}
   */
  async waitForSelector(page, selector, options = {}) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);

    const selenium = await this.#getSelenium();
    const { By, until } = selenium;

    await driver.wait(
      until.elementLocated(By.css(selector)),
      options.timeout || 30000
    );
  }

  /**
   * @param {AdapterPage} page
   * @returns {Promise<void>}
   */
  async closePage(page) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string, _isNewWindow: boolean }} */ (page);
    if (p._isNewWindow) {
      const driver = p._native;
      await driver.switchTo().window(p._windowHandle);
      await driver.close();
    }
  }

  /**
   * @param {AdapterBrowser} browser
   * @returns {Promise<void>}
   */
  async closeBrowser(browser) {
    const b = /** @type {AdapterBrowser & { _native: import('selenium-webdriver').WebDriver }} */ (browser);
    await b._native.quit();
  }

  /**
   * Selenium-specific: Open a new tab/window and return a page for it.
   * @param {AdapterBrowser} browser
   * @returns {Promise<AdapterPage>}
   */
  async newTab(browser) {
    const b = /** @type {AdapterBrowser & { _native: import('selenium-webdriver').WebDriver }} */ (browser);
    const driver = b._native;
    const selenium = await this.#getSelenium();

    await driver.switchTo().newWindow('tab');
    const handle = await driver.getWindowHandle();

    return {
      _native: driver,
      _adapter: this.name,
      _windowHandle: handle,
      _isNewWindow: true,
    };
  }

  /**
   * Selenium-specific: Get all window handles.
   * @param {AdapterBrowser} browser
   * @returns {Promise<string[]>}
   */
  async getWindowHandles(browser) {
    const b = /** @type {AdapterBrowser & { _native: import('selenium-webdriver').WebDriver }} */ (browser);
    return b._native.getAllWindowHandles();
  }

  /**
   * Selenium-specific: Execute async script (for scripts that use callbacks).
   * @param {AdapterPage} page
   * @param {string} script
   * @param {...unknown} args
   * @returns {Promise<unknown>}
   */
  async executeAsyncScript(page, script, ...args) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);
    return driver.executeAsyncScript(script, ...args);
  }

  /**
   * Selenium-specific: Wait for a custom condition.
   * @param {AdapterPage} page
   * @param {import('selenium-webdriver').Condition<unknown>} conditionFn
   * @param {number} [timeout]
   * @returns {Promise<void>}
   */
  async waitFor(page, conditionFn, timeout = 30000) {
    const p = /** @type {AdapterPage & { _native: import('selenium-webdriver').WebDriver, _windowHandle: string }} */ (page);
    const driver = p._native;
    await driver.switchTo().window(p._windowHandle);
    await driver.wait(conditionFn, timeout);
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

export default SeleniumAdapter;
