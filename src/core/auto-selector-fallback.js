// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * AutoSelectorFallback — Assisted Selector Re-Discovery (Story 28.3).
 * Inspects live pages with a stealth browser, matches DOM elements against declared
 * expected shapes, ranks candidate replacement selectors by stability heuristic,
 * and rejects obfuscated / hash-only class names.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import { PlatformError, ErrorTypes } from './error-envelope.js';

/**
 * Built-in starter field shape definitions per platform.
 * Used by CLI --field resolution and suggestSelectors wrapper.
 */
export const FIELD_SHAPES = Object.freeze({
  twitter: Object.freeze({
    tweet_text: Object.freeze({ attributes: { 'data-testid': 'tweetText' } }),
    user_name: Object.freeze({ attributes: { 'data-testid': 'UserName' } }),
    like_button: Object.freeze({ attributes: { 'data-testid': 'like' } }),
  }),
  facebook: Object.freeze({
    profile_name: Object.freeze({ tagName: 'h1' }),
    main: Object.freeze({ attributes: { role: 'main' } }),
  }),
  youtube: Object.freeze({
    channel_name: Object.freeze({ tagName: 'ytd-channel-name' }),
    channel_header: Object.freeze({ attributes: { id: 'channel-header' } }),
  }),
  threads: Object.freeze({
    main: Object.freeze({ attributes: { role: 'main' } }),
    header: Object.freeze({ tagName: 'header' }),
  }),
});

/**
 * @typedef {Object} SerializedRegex
 * @property {boolean} __isRegex
 * @property {string} source
 * @property {string} [flags]
 */

/**
 * @typedef {Object} SerializedExpectedShape
 * @property {string | SerializedRegex} [text]
 * @property {Record<string, string | SerializedRegex>} [attributes]
 * @property {string[]} [childSelectors]
 * @property {string} [tagName]
 * @property {number} [minChildren]
 */

/**
 * Serialize expectedShape for transfer across page.evaluate boundary.
 * Serializes RegExp instances to { __isRegex: true, source, flags } plain objects.
 *
 * @param {import('../../types/core.d.ts').ExpectedShape} shape
 * @returns {SerializedExpectedShape}
 */
function serializeExpectedShape(shape) {
  /** @type {SerializedExpectedShape} */
  const serialized = {};
  if (shape.text !== undefined) {
    if (shape.text instanceof RegExp) {
      serialized.text = { __isRegex: true, source: shape.text.source, flags: shape.text.flags };
    } else if (shape.text && typeof shape.text === 'object' && 'source' in shape.text) {
      serialized.text = { __isRegex: true, source: shape.text.source, flags: shape.text.flags || '' };
    } else {
      serialized.text = String(shape.text);
    }
  }
  if (shape.attributes && typeof shape.attributes === 'object') {
    serialized.attributes = {};
    for (const [k, v] of Object.entries(shape.attributes)) {
      if (v instanceof RegExp) {
        serialized.attributes[k] = { __isRegex: true, source: v.source, flags: v.flags };
      } else if (v && typeof v === 'object' && 'source' in v) {
        serialized.attributes[k] = { __isRegex: true, source: v.source, flags: v.flags || '' };
      } else {
        serialized.attributes[k] = String(v);
      }
    }
  }
  if (Array.isArray(shape.childSelectors)) {
    serialized.childSelectors = shape.childSelectors.map(String);
  }
  if (typeof shape.tagName === 'string') {
    serialized.tagName = shape.tagName;
  }
  if (typeof shape.minChildren === 'number') {
    serialized.minChildren = shape.minChildren;
  }
  return serialized;
}

/**
 * Evaluated inside browser page context to walk DOM and extract candidate selectors.
 *
 * @param {SerializedExpectedShape} shape Serialized shape predicates
 * @returns {Array<import('../../types/core.d.ts').SelectorCandidate>}
 */
function inPageDomWalk(shape) {
  /**
   * @param {string} str
   * @returns {string}
   */
  function cssEscape(str) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(str);
    }
    return String(str).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }

  /**
   * @param {string} token
   * @returns {boolean}
   */
  function isHashToken(token) {
    if (!token || typeof token !== 'string') return false;
    // Regex matches css- prefix or alphanumeric with >= 1 digit and >= 5 chars
    const hashRegex = /^(?:css-|_?[a-z0-9]*[0-9][a-z0-9]{4,}(?:_[a-z0-9]+)*$)/i;
    if (hashRegex.test(token)) {
      return true;
    }
    // Or class length >= 8 with no vowels / [a-z]{3,} word boundary
    if (token.length >= 8) {
      const hasVowels = /[aeiou]/i.test(token);
      const hasWordBoundary = /[a-z]{3,}/i.test(token);
      if (!hasVowels || !hasWordBoundary) {
        return true;
      }
    }
    return false;
  }

  const allElements = document.querySelectorAll('*');
  /** @type {Array<import('../../types/core.d.ts').SelectorCandidate>} */
  const rawCandidates = [];

  for (let eIdx = 0; eIdx < allElements.length; eIdx++) {
    const el = /** @type {Element} */ (allElements[eIdx]);
    if (!el || el.nodeType !== 1) continue;

    // Predicate 1: tagName (case-insensitive)
    if (shape.tagName) {
      if (el.tagName.toLowerCase() !== shape.tagName.toLowerCase()) {
        continue;
      }
    }

    // Predicate 2: minChildren
    if (typeof shape.minChildren === 'number') {
      if (el.children.length < shape.minChildren) {
        continue;
      }
    }

    // Predicate 3: childSelectors (mandatory filter AND corroboration boost)
    let childCorroborated = false;
    if (Array.isArray(shape.childSelectors) && shape.childSelectors.length > 0) {
      let allChildrenMatch = true;
      for (let c = 0; c < shape.childSelectors.length; c++) {
        try {
          if (!el.querySelector(shape.childSelectors[c])) {
            allChildrenMatch = false;
            break;
          }
        } catch {
          allChildrenMatch = false;
          break;
        }
      }
      if (!allChildrenMatch) {
        continue;
      }
      childCorroborated = true;
    }

    // Predicate 4: text
    let looseCount = 0;
    if (shape.text !== undefined) {
      const elText = (el.textContent || '').trim();
      if (shape.text && typeof shape.text === 'object' && '__isRegex' in shape.text) {
        const rx = new RegExp(shape.text.source, shape.text.flags || '');
        if (!rx.test(elText)) {
          continue;
        }
        looseCount++;
      } else {
        const expectedText = String(shape.text);
        if (elText === expectedText) {
          // Exact match - no penalty
        } else if (elText.includes(expectedText)) {
          looseCount++;
        } else {
          continue;
        }
      }
    }

    // Predicate 5: attributes
    let attrMatched = true;
    if (shape.attributes && typeof shape.attributes === 'object' && !Array.isArray(shape.attributes)) {
      const attrEntries = Object.entries(shape.attributes);
      for (let a = 0; a < attrEntries.length; a++) {
        const [attrName, expectedVal] = attrEntries[a];
        if (!el.hasAttribute(attrName)) {
          attrMatched = false;
          break;
        }
        const actualVal = el.getAttribute(attrName) || '';
        if (expectedVal && typeof expectedVal === 'object' && '__isRegex' in expectedVal) {
          const rx = new RegExp(expectedVal.source, expectedVal.flags || '');
          if (!rx.test(actualVal)) {
            attrMatched = false;
            break;
          }
          looseCount++;
        } else {
          const expStr = String(expectedVal);
          if (actualVal === expStr) {
            // Exact match
          } else if (actualVal.includes(expStr)) {
            looseCount++;
          } else {
            attrMatched = false;
            break;
          }
        }
      }
    }
    if (!attrMatched) {
      continue;
    }

    // Passed all predicates! Evaluate candidate selectors for this element.
    const tag = el.tagName.toLowerCase();
    const classAttr = el.getAttribute('class') || '';
    const classTokens = classAttr.split(/\s+/).filter(Boolean);
    const allClassTokensAreHash = classTokens.length > 0 && classTokens.every(isHashToken);

    const hasTestId = el.hasAttribute('data-testid') && (el.getAttribute('data-testid') || '').trim() !== '';
    const hasRole = el.hasAttribute('role') && (el.getAttribute('role') || '').trim() !== '';
    const hasAria = Array.from(el.attributes || []).some(
      (a) => (a.name === 'aria-label' || a.name.startsWith('aria-')) && a.value.trim() !== ''
    );
    const hasId = el.hasAttribute('id') && (el.getAttribute('id') || '').trim() !== '' && !isHashToken(el.getAttribute('id') || '');

    const isGenericTag = ['div', 'span'].includes(tag);

    // If candidate element's only discriminator is a hash class, skip element entirely
    if (allClassTokensAreHash && !hasTestId && !hasRole && !hasAria && !hasId && isGenericTag) {
      continue;
    }

    const snippet = (el.outerHTML || '').slice(0, 200);

    /**
     * @param {string} selector
     * @param {import('../../types/core.d.ts').SelectorStrategy} strategy
     * @param {string} matchedOn
     * @param {number} baseScore
     */
    function addCandidate(selector, strategy, matchedOn, baseScore) {
      // Reject any selector containing an obfuscated / hash-only class or id
      // Split on all CSS combinators + tag/class/id boundaries so `div.css-1a2b3c` is caught
      const parts = selector.split(/[\s>+~:]+/);
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        if (part.startsWith('.') && isHashToken(part.slice(1))) return;
        if (part.startsWith('#') && isHashToken(part.slice(1))) return;
        // Also check class/id segments embedded in compound selectors like `div.css-1a2b3c`
        const segments = part.split(/[.#]/);
        for (let s = 1; s < segments.length; s++) {
          if (segments[s] && isHashToken(segments[s])) return;
        }
      }
      let score = baseScore - looseCount * 0.05;
      if (childCorroborated) {
        score += 0.03;
      }
      score = Math.max(0, Math.min(1, Number(score.toFixed(4))));
      rawCandidates.push({
        selector,
        confidenceScore: score,
        strategy,
        matchedOn,
        snippet,
      });
    }

    // 1. data-testid="..." exact attribute
    if (hasTestId) {
      const testId = (el.getAttribute('data-testid') || '').trim();
      // data-testid is a stable attribute — never reject as hash
      addCandidate(`[data-testid="${cssEscape(testId)}"]`, 'data-testid', 'data-testid', 0.95);
    }

    // 2. role="..." or aria-label="..." / aria-* attribute
    if (hasRole) {
      const role = (el.getAttribute('role') || '').trim();
      if (!isHashToken(role)) {
        addCandidate(`[role="${cssEscape(role)}"]`, 'aria', 'role', 0.80);
      }
    }
    if (el.hasAttribute('aria-label')) {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (label && !isHashToken(label)) {
        addCandidate(`[aria-label="${cssEscape(label)}"]`, 'aria', 'aria-label', 0.80);
      }
    }
    if (el.attributes) {
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        if (attr.name.startsWith('aria-') && attr.name !== 'aria-label') {
          const val = attr.value.trim();
          if (val && !isHashToken(val)) {
            addCandidate(`[${attr.name}="${cssEscape(val)}"]`, 'aria', attr.name, 0.80);
          }
        }
      }
    }

    // 2b. id="..." attribute (stable non-hash ids only)
    if (hasId) {
      const id = (el.getAttribute('id') || '').trim();
      if (!isHashToken(id)) {
        addCandidate(`#${cssEscape(id)}`, 'id', 'id', 0.75);
      }
    }

    // 3. Semantic tag + stable structural hint
    const isSemanticTag = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'header', 'footer', 'nav', 'main', 'article', 'section', 'aside',
      'button', 'form', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'ul', 'ol', 'li', 'a', 'p', 'input', 'textarea', 'select'
    ].includes(tag) || tag.includes('-');

    if (isSemanticTag) {
      addCandidate(tag, 'semantic', 'tagName', 0.60);
    }

    // Semantic (non-hash) class candidates
    for (let c = 0; c < classTokens.length; c++) {
      const cls = classTokens[c];
      if (!isHashToken(cls)) {
        addCandidate(`.${cssEscape(cls)}`, 'semantic', 'class', 0.60);
      }
    }

    // Structural hint with parent / ancestors (guarding element.parentElement === null)
    if (el.parentElement !== null) {
      /** @type {Element | null} */
      let ancestor = el.parentElement;
      let landmark = null;
      while (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        const aTag = ancestor.tagName.toLowerCase();
        if (ancestor.hasAttribute('role') && !isHashToken(ancestor.getAttribute('role') || '')) {
          const r = (ancestor.getAttribute('role') || '').trim();
          landmark = `${aTag}[role="${cssEscape(r)}"]`;
          break;
        }
        if (['main', 'article', 'header', 'nav', 'section'].includes(aTag)) {
          landmark = aTag;
          break;
        }
        ancestor = ancestor.parentElement;
      }

      let nth = 1;
      let sib = el.previousElementSibling;
      while (sib) {
        if (sib.tagName === el.tagName) nth++;
        sib = sib.previousElementSibling;
      }

      const pTag = el.parentElement.tagName.toLowerCase();
      if (['article', 'main', 'header', 'nav', 'section'].includes(pTag)) {
        addCandidate(`${pTag} > ${tag}:nth-of-type(${nth})`, 'semantic', 'structure', 0.60);
      }
      if (landmark && landmark !== pTag) {
        addCandidate(`${landmark} ${tag}`, 'semantic', 'structure', 0.60);
      }
    }
  }

  return rawCandidates;
}

/**
 * Deduplicate, sort descending by confidenceScore, and cap at 10 candidates.
 *
 * @param {Array<import('../../types/core.d.ts').SelectorCandidate>} rawCandidates
 * @returns {Array<import('../../types/core.d.ts').SelectorCandidate>}
 */
function postProcessCandidates(rawCandidates) {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return [];
  }
  /** @type {Record<import('../../types/core.d.ts').SelectorStrategy, number>} */
  const strategyOrder = {
    'data-testid': 1,
    'aria': 2,
    'id': 3,
    'semantic': 4,
  };

  rawCandidates.sort((a, b) => {
    if (b.confidenceScore !== a.confidenceScore) {
      return b.confidenceScore - a.confidenceScore;
    }
    const orderA = strategyOrder[a.strategy] || 99;
    const orderB = strategyOrder[b.strategy] || 99;
    return orderA - orderB;
  });

  const seenSelectors = new Set();
  /** @type {Array<import('../../types/core.d.ts').SelectorCandidate>} */
  const deduped = [];

  for (let i = 0; i < rawCandidates.length; i++) {
    const candidate = rawCandidates[i];
    if (!candidate || !candidate.selector) continue;
    if (!seenSelectors.has(candidate.selector)) {
      seenSelectors.add(candidate.selector);
      deduped.push(candidate);
      if (deduped.length >= 10) {
        break;
      }
    }
  }

  return deduped;
}

export class AutoSelectorFallback {
  /** @type {Function | null} */
  #browserFactory = null;

  /** @type {Function | null} */
  #createPage = null;

  /** @type {Function | null} */
  #closeBrowserFn = null;

  /** @type {number} */
  #delayMs = 1000;

  /** @type {'obscura' | 'chrome'} */
  #backend = 'obscura';

  /**
   * @param {import('../../types/core.d.ts').AutoSelectorFallbackOptions} [options]
   */
  constructor(options) {
    options = options || {};
    this.#browserFactory = options.browserFactory || null;
    this.#createPage = options.createPage || null;
    this.#closeBrowserFn = options.closeBrowser || null;
    this.#delayMs = options.delayMs !== undefined ? options.delayMs : 1000;
    this.#backend = options.backend || 'obscura';
  }

  /**
   * Launch stealth browser or invoke injected factory.
   * @param {import('../../types/core.d.ts').AutoSelectorFallbackOptions} [opts]
   */
  async #launchBrowser(opts = {}) {
    const factory = opts.browserFactory || this.#browserFactory;
    if (factory) {
      return await factory();
    }
    const { launchStealthBrowser } = await import('../scraping/stealthBrowser.js');
    return await launchStealthBrowser({
      backend: opts.backend || this.#backend,
      fallbackBackend: 'chrome',
      requiresAuth: false,
      headless: true,
    });
  }

  /**
   * Create stealth page or invoke injected page factory.
   * @param {any} browser
   * @param {import('../../types/core.d.ts').AutoSelectorFallbackOptions} [opts]
   */
  async #getPage(browser, opts = {}) {
    const createPageFn = opts.createPage || this.#createPage;
    if (createPageFn) {
      return await createPageFn(browser);
    }
    if (typeof browser.createPage === 'function') {
      return await browser.createPage();
    }
    // Injected harness → use raw newPage so a partially-failed createStealthPage
    // cannot leak an unclosed page before falling back (mirrors SelectorCanary:152).
    if ((opts.browserFactory || this.#browserFactory) && typeof browser.newPage === 'function') {
      return await browser.newPage();
    }
    try {
      const { createStealthPage } = await import('../scraping/stealthBrowser.js');
      return await createStealthPage(browser);
    } catch (err) {
      if (typeof browser.newPage === 'function') {
        return await browser.newPage();
      }
      throw err;
    }
  }

  /**
   * Safely teardown stealth browser instance.
   * @param {any} browser
   * @param {import('../../types/core.d.ts').AutoSelectorFallbackOptions} [opts]
   */
  async #closeBrowser(browser, opts = {}) {
    if (!browser) return;
    const closeFn = opts.closeBrowser || this.#closeBrowserFn;
    if (closeFn) {
      return await closeFn(browser);
    }
    try {
      const { closeStealthBrowser } = await import('../scraping/stealthBrowser.js');
      await closeStealthBrowser(browser);
    } catch {
      if (typeof browser.close === 'function') {
        await browser.close();
      }
    }
  }

  /**
   * Investigate a live page and suggest ranked replacement selectors.
   *
   * @param {string} platform
   * @param {string} pageUrl
   * @param {import('../../types/core.d.ts').ExpectedShape} expectedShape
   * @param {import('../../types/core.d.ts').AutoSelectorFallbackOptions} [opts]
   * @returns {Promise<Array<import('../../types/core.d.ts').SelectorCandidate>>}
   */
  async investigate(platform, pageUrl, expectedShape, opts = {}) {
    // Early synchronous validation before any browser launch
    if (typeof platform !== 'string' || !platform.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4001',
        message: 'platform must be a non-empty string',
      });
    }

    if (typeof pageUrl !== 'string' || !pageUrl.trim()) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4002',
        message: 'pageUrl must be a non-empty string',
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(pageUrl);
    } catch {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4003',
        message: `pageUrl must be a valid parseable URL: ${pageUrl}`,
      });
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4003',
        message: `pageUrl must use http or https protocol, got: ${parsedUrl.protocol}`,
      });
    }

    if (
      !expectedShape ||
      typeof expectedShape !== 'object' ||
      Array.isArray(expectedShape) ||
      Object.keys(expectedShape).length === 0
    ) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4004',
        message: 'expectedShape must be a non-empty object',
      });
    }

    const hasPredicate = Boolean(
      (typeof expectedShape.tagName === 'string' && expectedShape.tagName.trim() !== '') ||
      (typeof expectedShape.text !== 'undefined' && expectedShape.text !== null) ||
      (expectedShape.attributes && typeof expectedShape.attributes === 'object' && !Array.isArray(expectedShape.attributes) && Object.keys(expectedShape.attributes).length > 0) ||
      (Array.isArray(expectedShape.childSelectors) && expectedShape.childSelectors.length > 0) ||
      typeof expectedShape.minChildren === 'number'
    );
    if (!hasPredicate) {
      throw new PlatformError({
        type: ErrorTypes.INVALID_ARGS,
        code: 'XACT_4005',
        message: 'expectedShape must contain at least one recognized predicate (tagName, text, attributes, childSelectors, minChildren)',
      });
    }

    /** @type {any} */
    let browser = null;
    /** @type {any} */
    let page = null;

    try {
      browser = await this.#launchBrowser(opts);
      try {
        page = await this.#getPage(browser, opts);
        await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        const delay = opts.delayMs !== undefined ? opts.delayMs : this.#delayMs;
        if (delay > 0) {
          await new Promise((res) => setTimeout(res, delay));
        }

        const serializedShape = serializeExpectedShape(expectedShape);
        const rawCandidates = await page.evaluate(inPageDomWalk, serializedShape);
        return postProcessCandidates(rawCandidates);
      } finally {
        if (page && typeof page.close === 'function') {
          try {
            await page.close();
          } catch {
            // Page close error caught so browser cleanup is guaranteed
          }
        }
      }
    } finally {
      if (browser) {
        try {
          await this.#closeBrowser(browser, opts);
        } catch {
          // Browser close error caught
        }
      }
    }
  }
}

export const globalAutoSelectorFallback = new AutoSelectorFallback();

/**
 * Convenience wrapper: resolves a string shapeOrFieldName via FIELD_SHAPES[platform]
 * (or literal data-testid fallback), then delegates to globalAutoSelectorFallback.investigate().
 *
 * @param {string} platform
 * @param {string} pageUrl
 * @param {string | import('../../types/core.d.ts').ExpectedShape} shapeOrFieldName
 * @param {import('../../types/core.d.ts').AutoSelectorFallbackOptions} [opts]
 * @returns {Promise<Array<import('../../types/core.d.ts').SelectorCandidate>>}
 */
export async function suggestSelectors(platform, pageUrl, shapeOrFieldName, opts = {}) {
  /** @type {any} */
  let shape;
  if (typeof shapeOrFieldName === 'string') {
    const platformMap = /** @type {Record<string, Record<string, import('../../types/core.d.ts').ExpectedShape>>} */ (FIELD_SHAPES);
    const platformShapes = platformMap[platform];
    if (platformShapes && platformShapes[shapeOrFieldName]) {
      shape = platformShapes[shapeOrFieldName];
    } else {
      shape = { attributes: { 'data-testid': shapeOrFieldName } };
    }
  } else if (shapeOrFieldName && typeof shapeOrFieldName === 'object') {
    shape = shapeOrFieldName;
  } else {
    // If shapeOrFieldName is invalid, pass through so investigate throws PlatformError(ErrorTypes.INVALID_ARGS)
    shape = shapeOrFieldName;
  }

  return await globalAutoSelectorFallback.investigate(platform, pageUrl, shape, opts);
}
