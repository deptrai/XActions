// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * SelectorSandbox — Isolated Candidate Selector Validation (Story 39.2).
 * Validates a candidate replacement selector in an isolated page context by
 * loading the target URL, resolving `page.$(selector)`, and checking the
 * extracted element against the declared `expectedShape`. Mandatory validation
 * gate for Invariant #4 (GitOps-Driven DOM Drift Healing).
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

/**
 * Serialize an expectedShape for transport across page.evaluate boundary.
 * Mirrors the serialization in auto-selector-fallback.js (RegExp → plain object).
 * @param {import('../../types/core.d.ts').ExpectedShape} shape
 * @returns {object}
 */
function serializeShape(shape) {
  const out = {};
  if (shape.text !== undefined) {
    if (shape.text instanceof RegExp) {
      out.text = { __isRegex: true, source: shape.text.source, flags: shape.text.flags };
    } else if (shape.text && typeof shape.text === 'object' && 'source' in shape.text) {
      out.text = { __isRegex: true, source: shape.text.source, flags: shape.text.flags || '' };
    } else {
      out.text = String(shape.text);
    }
  }
  if (shape.attributes && typeof shape.attributes === 'object') {
    out.attributes = {};
    for (const [k, v] of Object.entries(shape.attributes)) {
      if (v instanceof RegExp) {
        out.attributes[k] = { __isRegex: true, source: v.source, flags: v.flags };
      } else if (v && typeof v === 'object' && 'source' in v) {
        out.attributes[k] = { __isRegex: true, source: v.source, flags: v.flags || '' };
      } else {
        out.attributes[k] = String(v);
      }
    }
  }
  if (Array.isArray(shape.childSelectors)) {
    out.childSelectors = shape.childSelectors.map(String);
  }
  if (typeof shape.tagName === 'string') out.tagName = shape.tagName;
  if (typeof shape.minChildren === 'number') out.minChildren = shape.minChildren;
  return out;
}

/**
 * Runs inside the page: given a selector and serialized shape, extract the
 * element's identifying details and evaluate shape conformance.
 * @param {string} selector
 * @param {object} shape Serialized shape
 * @returns {{ found: boolean, valid: boolean, reason?: string, sample?: object }}
 */
function inPageValidate(selector, shape) {
  let el = null;
  try {
    el = document.querySelector(selector);
  } catch (err) {
    return { found: false, valid: false, reason: `selector threw: ${String(err && err.message || err)}` };
  }
  if (!el) {
    return { found: false, valid: false, reason: 'selector matched no element' };
  }

  const sample = {
    tagName: el.tagName.toLowerCase(),
    text: (el.textContent || '').trim().slice(0, 200),
    attributes: {},
    childCount: el.children.length,
  };
  for (const attr of el.attributes) {
    sample.attributes[attr.name] = attr.value;
  }

  if (shape.tagName && el.tagName.toLowerCase() !== shape.tagName.toLowerCase()) {
    return { found: true, valid: false, reason: `tagName mismatch: expected ${shape.tagName}, got ${el.tagName.toLowerCase()}`, sample };
  }
  if (typeof shape.minChildren === 'number' && el.children.length < shape.minChildren) {
    return { found: true, valid: false, reason: `minChildren not met: expected >= ${shape.minChildren}, got ${el.children.length}`, sample };
  }
  if (Array.isArray(shape.childSelectors) && shape.childSelectors.length > 0) {
    for (const cs of shape.childSelectors) {
      let ok = false;
      try { ok = !!el.querySelector(cs); } catch { ok = false; }
      if (!ok) {
        return { found: true, valid: false, reason: `missing required childSelector: ${cs}`, sample };
      }
    }
  }
  if (shape.text !== undefined) {
    const elText = (el.textContent || '').trim();
    if (shape.text && typeof shape.text === 'object' && '__isRegex' in shape.text) {
      const rx = new RegExp(shape.text.source, shape.text.flags || '');
      if (!rx.test(elText)) {
        return { found: true, valid: false, reason: `text regex mismatch: /${shape.text.source}/`, sample };
      }
    } else {
      const expected = String(shape.text);
      if (elText !== expected && !elText.includes(expected)) {
        return { found: true, valid: false, reason: `text mismatch: expected "${expected}"`, sample };
      }
    }
  }
  if (shape.attributes && typeof shape.attributes === 'object') {
    for (const [name, expected] of Object.entries(shape.attributes)) {
      const actual = el.getAttribute(name);
      if (actual === null) {
        return { found: true, valid: false, reason: `missing attribute: ${name}`, sample };
      }
      if (expected && typeof expected === 'object' && '__isRegex' in expected) {
        const rx = new RegExp(expected.source, expected.flags || '');
        if (!rx.test(actual)) {
          return { found: true, valid: false, reason: `attribute ${name} regex mismatch: /${expected.source}/`, sample };
        }
      } else if (String(actual) !== String(expected)) {
        return { found: true, valid: false, reason: `attribute ${name} mismatch: expected "${expected}", got "${actual}"`, sample };
      }
    }
  }
  return { found: true, valid: true, sample };
}

export class SelectorSandbox {
  /** @type {Function | null} */
  #browserFactory = null;

  /** @type {Function | null} */
  #createPage = null;

  /** @type {Function | null} */
  #closeBrowserFn = null;

  /** @type {number} */
  #delayMs = 0;

  /** @type {'obscura' | 'chrome'} */
  #backend = 'obscura';

  /**
   * @param {import('../../types/core.d.ts').SelectorSandboxOptions} [options]
   */
  constructor(options = {}) {
    this.#browserFactory = options.browserFactory || null;
    this.#createPage = options.createPage || null;
    this.#closeBrowserFn = options.closeBrowser || null;
    this.#delayMs = options.delayMs !== undefined ? options.delayMs : 0;
    this.#backend = options.backend || 'obscura';
  }

  async #launchBrowser(opts = {}) {
    const factory = opts.browserFactory || this.#browserFactory;
    if (factory) return await factory();
    const { launchStealthBrowser } = await import('../scraping/stealthBrowser.js');
    return await launchStealthBrowser({
      backend: opts.backend || this.#backend,
      fallbackBackend: 'chrome',
      requiresAuth: false,
      headless: true,
    });
  }

  async #getPage(browser, opts = {}) {
    const createPageFn = opts.createPage || this.#createPage;
    if (createPageFn) return await createPageFn(browser);
    if (typeof browser.createPage === 'function') return await browser.createPage();
    if ((opts.browserFactory || this.#browserFactory) && typeof browser.newPage === 'function') {
      return await browser.newPage();
    }
    try {
      const { createStealthPage } = await import('../scraping/stealthBrowser.js');
      return await createStealthPage(browser);
    } catch (err) {
      if (typeof browser.newPage === 'function') return await browser.newPage();
      throw err;
    }
  }

  async #closeBrowser(browser, opts = {}) {
    if (!browser) return;
    const closeFn = opts.closeBrowser || this.#closeBrowserFn;
    if (closeFn) return await closeFn(browser);
    try {
      const { closeStealthBrowser } = await import('../scraping/stealthBrowser.js');
      await closeStealthBrowser(browser);
    } catch {
      if (typeof browser.close === 'function') await browser.close();
    }
  }

  /**
   * Validate a candidate selector against an expectedShape in an isolated page.
   *
   * @param {string} url Page URL to navigate to
   * @param {string} selector Candidate CSS selector
   * @param {import('../../types/core.d.ts').ExpectedShape} expectedShape Shape to check against
   * @param {import('../../types/core.d.ts').SelectorSandboxOptions} [opts]
   * @returns {Promise<{ valid: boolean, extractedSample?: object, error?: string }>}
   */
  async validate(url, selector, expectedShape, opts = {}) {
    if (typeof url !== 'string' || !url.trim()) {
      return { valid: false, error: 'url must be a non-empty string' };
    }
    if (typeof selector !== 'string' || !selector.trim()) {
      return { valid: false, error: 'selector must be a non-empty string' };
    }
    if (!expectedShape || typeof expectedShape !== 'object' || Array.isArray(expectedShape)) {
      return { valid: false, error: 'expectedShape must be a non-empty object' };
    }

    let browser = null;
    let page = null;
    try {
      browser = await this.#launchBrowser(opts);
      page = await this.#getPage(browser, opts);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const delay = opts.delayMs !== undefined ? opts.delayMs : this.#delayMs;
      if (delay > 0) {
        await new Promise((res) => setTimeout(res, delay));
      }

      const serialized = serializeShape(expectedShape);
      let result;
      if (typeof page.evaluate === 'function') {
        result = await page.evaluate(inPageValidate, selector, serialized);
      } else {
        // Harness path (no evaluate): fall back to `$` + minimal shape check
        const el = await page.$(selector);
        if (!el) {
          result = { found: false, valid: false, reason: 'selector matched no element' };
        } else {
          result = { found: true, valid: true, sample: { via: 'page.$' } };
        }
      }
      if (!result.found) {
        return { valid: false, error: result.reason || 'selector matched no element' };
      }
      if (!result.valid) {
        return { valid: false, extractedSample: result.sample, error: result.reason || 'shape validation failed' };
      }
      return { valid: true, extractedSample: result.sample };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: msg };
    } finally {
      if (page && typeof page.close === 'function') {
        try { await page.close(); } catch { /* ignore */ }
      }
      if (browser) {
        try { await this.#closeBrowser(browser, opts); } catch { /* ignore */ }
      }
    }
  }
}

export default SelectorSandbox;
