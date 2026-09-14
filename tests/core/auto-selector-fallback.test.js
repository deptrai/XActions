// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 28.3 — AutoSelectorFallback: Assisted Selector Re-Discovery.
 * Uses real test harnesses (no vi.mock) with dependency injection and real DOM parsing via JSDOM.
 * Tests candidate generation, priority heuristic, confidence scoring, hash class rejection,
 * browser/page lifecycle cleanup guarantees, error handling, and CLI command integration.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { Command } from 'commander';
import {
  AutoSelectorFallback,
  globalAutoSelectorFallback,
  FIELD_SHAPES,
  suggestSelectors,
} from '../../src/core/auto-selector-fallback.js';
import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';
import { registerToolsCommand } from '../../src/cli/commands/tools.js';

/**
 * Real DOM page harness using JSDOM for non-mock DOM tree execution.
 */
function makeDomPageHarness(html, options = {}) {
  const dom = new JSDOM(html);
  let closed = false;
  let visitedUrl = null;

  return {
    async goto(url) {
      if (options.throwOnGoto) {
        throw new Error(`Navigation failed: ${url}`);
      }
      visitedUrl = url;
    },
    async evaluate(fn, arg) {
      const prevDoc = globalThis.document;
      const prevWin = globalThis.window;
      const prevCSS = globalThis.CSS;
      try {
        globalThis.document = dom.window.document;
        globalThis.window = dom.window;
        globalThis.CSS = dom.window.CSS || {
          escape: (s) => String(s).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1'),
        };
        return fn(arg);
      } finally {
        globalThis.document = prevDoc;
        globalThis.window = prevWin;
        globalThis.CSS = prevCSS;
      }
    },
    async close() {
      if (options.throwOnClose) {
        throw new Error('Page close error');
      }
      closed = true;
    },
    get isClosed() {
      return closed;
    },
    get visitedUrl() {
      return visitedUrl;
    },
  };
}

/**
 * Real browser harness tracking lifecycle and page creation.
 */
function makeBrowserHarness(pageResolver, options = {}) {
  const pages = [];
  let closed = false;

  return {
    pages,
    async newPage() {
      const page = typeof pageResolver === 'function' ? pageResolver() : makeDomPageHarness('<html><body></body></html>');
      pages.push(page);
      return page;
    },
    async close() {
      if (options.throwOnClose) {
        throw new Error('Browser close error');
      }
      closed = true;
    },
    get isClosed() {
      return closed;
    },
  };
}

describe('Story 28.3 — AutoSelectorFallback: Assisted Selector Re-Discovery', () => {
  it('[AC-1] HAPPY_PATH: data-testid element yields data-testid strategy candidate with score >= 0.9 first', async () => {
    const html = `
      <html><body>
        <main>
          <div data-testid="tweetText">Hello from Twitter</div>
        </main>
      </body></html>
    `;
    let pageHarness = null;
    const browser = makeBrowserHarness(() => {
      pageHarness = makeDomPageHarness(html);
      return pageHarness;
    });

    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('twitter', 'https://x.com/nasa', {
      attributes: { 'data-testid': 'tweetText' },
    });

    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const first = candidates[0];
    expect(first.selector).toBe('[data-testid="tweetText"]');
    expect(first.strategy).toBe('data-testid');
    expect(first.confidenceScore).toBeGreaterThanOrEqual(0.9);
    expect(first.matchedOn).toBe('data-testid');
    expect(first.snippet).toContain('data-testid="tweetText"');

    expect(pageHarness.isClosed).toBe(true);
    expect(browser.isClosed).toBe(true);
    // No leaked pages — every page allocated on the harness must be closed
    expect(browser.pages.every((p) => p.isClosed)).toBe(true);
  });

  it('[AC-2] TESTID_PREFERRED: element with both data-testid and role ranks data-testid above role', async () => {
    const html = `
      <html><body>
        <div data-testid="tweetText" role="article">Tweet text content</div>
      </body></html>
    `;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('twitter', 'https://x.com/nasa', {
      attributes: { 'data-testid': 'tweetText' },
    });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const testIdIdx = candidates.findIndex((c) => c.strategy === 'data-testid');
    const ariaIdx = candidates.findIndex((c) => c.strategy === 'aria');

    expect(testIdIdx).toBeGreaterThanOrEqual(0);
    expect(ariaIdx).toBeGreaterThanOrEqual(0);
    expect(testIdIdx).toBeLessThan(ariaIdx);
    expect(candidates[testIdIdx].confidenceScore).toBeGreaterThan(candidates[ariaIdx].confidenceScore);
  });

  it('[AC-3] ARIA_STRATEGY: element matching role or aria-* yields aria strategy candidate with base score ~0.80', async () => {
    const html = `
      <html><body>
        <main role="main" aria-label="Main Feed">
          <section aria-describedby="feed-desc">Feed items</section>
        </main>
      </body></html>
    `;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('facebook', 'https://facebook.com/meta', {
      attributes: { role: 'main' },
    });

    const roleCandidate = candidates.find((c) => c.selector === '[role="main"]');
    expect(roleCandidate).toBeDefined();
    expect(roleCandidate.strategy).toBe('aria');
    expect(roleCandidate.confidenceScore).toBe(0.8);
    expect(roleCandidate.matchedOn).toBe('role');

    const ariaLabelCandidate = candidates.find((c) => c.selector === '[aria-label="Main Feed"]');
    expect(ariaLabelCandidate).toBeDefined();
    expect(ariaLabelCandidate.strategy).toBe('aria');
    expect(ariaLabelCandidate.confidenceScore).toBe(0.8);
  });

  it('[AC-4] ID_STRATEGY: element with stable non-hash id produces id strategy candidate with base score ~0.75', async () => {
    const html = `
      <html><body>
        <div id="channel-header">YouTube Channel Info</div>
      </body></html>
    `;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('youtube', 'https://youtube.com/@nasa', {
      attributes: { id: 'channel-header' },
    });

    const idCandidate = candidates.find((c) => c.selector === '#channel-header');
    expect(idCandidate).toBeDefined();
    expect(idCandidate.strategy).toBe('id');
    expect(idCandidate.confidenceScore).toBe(0.75);
    expect(idCandidate.matchedOn).toBe('id');
  });

  it('[AC-5] SEMANTIC_STRATEGY: element matching semantic tag produces semantic candidate with base score ~0.60', async () => {
    const html = `
      <html><body>
        <article>
          <h1>Profile Title</h1>
          <div>Paragraph 1</div>
          <div>Paragraph 2</div>
        </article>
      </body></html>
    `;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('facebook', 'https://facebook.com/meta', {
      tagName: 'h1',
    });

    const h1Candidate = candidates.find((c) => c.selector === 'h1');
    expect(h1Candidate).toBeDefined();
    expect(h1Candidate.strategy).toBe('semantic');
    expect(h1Candidate.confidenceScore).toBe(0.6);
  });

  it('[AC-6] HASH_CLASS_REJECTED: candidate only identifiable by obfuscated hash class yields NO candidate', async () => {
    const html = `
      <html><body>
        <div class="css-1x2y3z4">Obfuscated only</div>
        <div class="css-987abc">Another hash</div>
      </body></html>
    `;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('twitter', 'https://x.com/nasa', {
      attributes: { class: 'css-1x2y3z4' },
    });

    expect(candidates).toEqual([]);
  });

  it('[AC-7] NO_MATCH: returns empty array [] without throwing when no elements match', async () => {
    const html = `<html><body><div>Normal content</div></body></html>`;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('twitter', 'https://x.com/nasa', {
      attributes: { 'data-testid': 'nonExistentTestId' },
    });

    expect(candidates).toEqual([]);
  });

  it('[AC-8] BROWSER_FAILS: browser factory rejection propagates error and triggers browser cleanup', async () => {
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => {
        throw new Error('Chromium launch failed: ENOENT');
      },
      delayMs: 0,
    });

    await expect(
      fallback.investigate('twitter', 'https://x.com/nasa', {
        attributes: { 'data-testid': 'tweetText' },
      })
    ).rejects.toThrow('Chromium launch failed: ENOENT');
  });

  it('[AC-9] PAGE_GOTO_FAILS: page.goto failure cleans up both page and browser before propagating error', async () => {
    let createdPage = null;
    const browser = makeBrowserHarness(() => {
      createdPage = makeDomPageHarness('<html></html>', { throwOnGoto: true });
      return createdPage;
    });

    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    await expect(
      fallback.investigate('twitter', 'https://x.com/nasa', {
        attributes: { 'data-testid': 'tweetText' },
      })
    ).rejects.toThrow(/Navigation failed/);

    expect(createdPage.isClosed).toBe(true);
    expect(browser.isClosed).toBe(true);
    expect(browser.pages.every((p) => p.isClosed)).toBe(true);
  });

  it('[AC-10] PAGE_CLOSE_FAILS: throw during page.close() does not prevent browser cleanup', async () => {
    const browser = makeBrowserHarness(() => {
      return makeDomPageHarness('<html><body><div data-testid="t">Text</div></body></html>', {
        throwOnClose: true,
      });
    });

    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('twitter', 'https://x.com/nasa', {
      attributes: { 'data-testid': 't' },
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(browser.isClosed).toBe(true);
  });

  it('[AC-11] INVALID_SHAPE: rejects empty {}, null, or non-object shape synchronously before browser launch', async () => {
    let factoryCalled = false;
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => {
        factoryCalled = true;
        return makeBrowserHarness();
      },
      delayMs: 0,
    });

    await expect(fallback.investigate('twitter', 'https://x.com/nasa', {})).rejects.toThrow(PlatformError);
    await expect(fallback.investigate('twitter', 'https://x.com/nasa', null)).rejects.toThrow(PlatformError);
    await expect(fallback.investigate('twitter', 'https://x.com/nasa', 'invalid')).rejects.toThrow(PlatformError);
    expect(factoryCalled).toBe(false);
  });

  it('[AC-12] INVALID_PLATFORM_OR_URL: rejects invalid platform or URL synchronously before browser launch', async () => {
    let factoryCalled = false;
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => {
        factoryCalled = true;
        return makeBrowserHarness();
      },
      delayMs: 0,
    });

    await expect(fallback.investigate('', 'https://x.com/nasa', { tagName: 'h1' })).rejects.toThrow(PlatformError);
    await expect(fallback.investigate('twitter', '', { tagName: 'h1' })).rejects.toThrow(PlatformError);
    await expect(fallback.investigate('twitter', 'not-a-valid-url', { tagName: 'h1' })).rejects.toThrow(PlatformError);
    expect(factoryCalled).toBe(false);
  });

  it('[AC-13] MULTI_PREDICATE_FILTER: matches against text, attributes, minChildren, childSelectors, and tagName', async () => {
    const html = `
      <html><body>
        <article class="feed-item" data-testid="post" role="article">
          <header><h3>Header Title</h3></header>
          <div class="content"><p>Some body text</p></div>
          <footer><span>Actions</span></footer>
        </article>
      </body></html>
    `;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    // 1. All predicates satisfied: tagName, minChildren, childSelectors, text (regex), attributes
    const matched = await fallback.investigate('twitter', 'https://x.com/nasa', {
      tagName: 'article',
      minChildren: 2,
      childSelectors: ['header', 'footer'],
      text: /body text/i,
      attributes: { 'data-testid': 'post' },
    });

    expect(matched.length).toBeGreaterThan(0);
    const top = matched[0];
    expect(top.strategy).toBe('data-testid');
    // base (0.95) - loose penalty for regex (-0.05) + childSelectors corroboration (+0.03) = 0.93
    expect(top.confidenceScore).toBe(0.93);

    // 2. Element rejected if childSelectors not satisfied
    const rejectedByChild = await fallback.investigate('twitter', 'https://x.com/nasa', {
      tagName: 'article',
      childSelectors: ['non-existent-child'],
    });
    expect(rejectedByChild).toEqual([]);

    // 3. Element rejected if minChildren not met
    const rejectedByMinChildren = await fallback.investigate('twitter', 'https://x.com/nasa', {
      tagName: 'article',
      minChildren: 10,
    });
    expect(rejectedByMinChildren).toEqual([]);
  });

  it('[AC-14] DEDUPE_AND_CAP_10: caps results at 10 candidates, deduplicated and sorted by score descending', async () => {
    const items = Array.from({ length: 15 }, (_, i) => `<div data-testid="item-${i}">Item ${i}</div>`).join('\n');
    const html = `<html><body><main>${items}</main></body></html>`;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));
    const fallback = new AutoSelectorFallback({
      browserFactory: async () => browser,
      delayMs: 0,
    });

    const candidates = await fallback.investigate('twitter', 'https://x.com/nasa', {
      text: /Item/,
    });

    expect(candidates.length).toBeLessThanOrEqual(10);
    const selectors = candidates.map((c) => c.selector);
    const uniqueSelectors = new Set(selectors);
    expect(selectors.length).toBe(uniqueSelectors.size);

    for (let i = 0; i < candidates.length - 1; i++) {
      expect(candidates[i].confidenceScore).toBeGreaterThanOrEqual(candidates[i + 1].confidenceScore);
    }
  });

  it('[AC-15] FIELD_SHAPES_RESOLUTION: resolves known platform field names or falls back to literal testid', async () => {
    expect(FIELD_SHAPES.twitter.tweet_text).toEqual({ attributes: { 'data-testid': 'tweetText' } });
    expect(FIELD_SHAPES.facebook.profile_name).toEqual({ tagName: 'h1' });
    expect(FIELD_SHAPES.youtube.channel_name).toEqual({ tagName: 'ytd-channel-name' });
    expect(FIELD_SHAPES.threads.header).toEqual({ tagName: 'header' });
  });

  it('[AC-16] SUGGEST_SELECTORS_WRAPPER: delegates to globalAutoSelectorFallback with resolved field shape', async () => {
    const html = `<html><body><div data-testid="tweetText">Tweet text</div></body></html>`;
    const browser = makeBrowserHarness(() => makeDomPageHarness(html));

    const candidates = await suggestSelectors('twitter', 'https://x.com/nasa', 'tweet_text', {
      browserFactory: async () => browser,
      delayMs: 0,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].selector).toBe('[data-testid="tweetText"]');
    expect(candidates[0].strategy).toBe('data-testid');

    // Unknown field name falls back to literal data-testid
    const htmlCustom = `<html><body><div data-testid="custom_badge">Custom</div></body></html>`;
    const browserCustom = makeBrowserHarness(() => makeDomPageHarness(htmlCustom));

    const candidatesCustom = await suggestSelectors('unknown_platform', 'https://example.com', 'custom_badge', {
      browserFactory: async () => browserCustom,
      delayMs: 0,
    });

    expect(candidatesCustom.length).toBeGreaterThan(0);
    expect(candidatesCustom[0].selector).toBe('[data-testid="custom_badge"]');
  });

  it('[AC-17] CLI: registerToolsCommand registers tools suggest-selector command', () => {
    const program = new Command();
    registerToolsCommand(program);

    const toolsCmd = program.commands.find((c) => c.name() === 'tools');
    expect(toolsCmd).toBeDefined();

    const suggestCmd = toolsCmd.commands.find((c) => c.name() === 'suggest-selector');
    expect(suggestCmd).toBeDefined();

    const optionNames = suggestCmd.options.map((o) => o.attributeName());
    expect(optionNames).toContain('platform');
    expect(optionNames).toContain('url');
    expect(optionNames).toContain('field');
    expect(optionNames).toContain('backend');
    expect(optionNames).toContain('json');
  });

  it('[AC-18] CLI: suggest-selector enforces required options', () => {
    const program = new Command();
    registerToolsCommand(program);
    program.exitOverride();

    // Missing --platform, --url, --field triggers commander missing required option error
    expect(() => {
      program.parse(['node', 'test', 'tools', 'suggest-selector']);
    }).toThrow();
  });
});
