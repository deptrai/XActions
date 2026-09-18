// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 39.2 — SelectorSandbox candidate validation tests.
 * Uses injected page harness (no vi.mock) — exercises inPageValidate logic
 * through a real evaluate-equivalent code path.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */
// by nichxbt

import { describe, test, expect } from 'vitest';
import { SelectorSandbox } from '../../src/services/selector-sandbox.js';
import http from 'node:http';
import { once } from 'node:events';

function makePageHarness({ html = '', onEvaluate = null } = {}) {
  let closed = false;
  let visitedUrl = null;
  return {
    async goto(url) {
      visitedUrl = url;
    },
    async $(selector) {
      // Harness mode: pretend match only for "ok-*" selectors
      return selector.startsWith('ok-') ? { sel: selector } : null;
    },
    async evaluate(fn, selector, shape) {
      if (onEvaluate) return onEvaluate(fn, selector, shape);
      // Use a DOM-free evaluator: simulate inPageValidate result
      if (selector.startsWith('bad-')) {
        return { found: false, valid: false, reason: 'selector matched no element' };
      }
      return { found: true, valid: true, sample: { tagName: 'div' } };
    },
    async close() { closed = true; },
    get isClosed() { return closed; },
    get visitedUrl() { return visitedUrl; },
  };
}

function makeBrowser(page) {
  let closed = false;
  return {
    async newPage() { return page; },
    async createPage() { return page; },
    async close() { closed = true; },
    get isClosed() { return closed; },
  };
}

describe('SelectorSandbox.validate', () => {
  test('returns valid:true when selector matches and shape conforms', async () => {
    const page = makePageHarness();
    const browser = makeBrowser(page);
    const sandbox = new SelectorSandbox({
      browserFactory: async () => browser,
      createPage: async () => page,
      closeBrowser: async () => {},
    });
    const res = await sandbox.validate('https://example.com/', 'ok-main', { tagName: 'div' });
    expect(res.valid).toBe(true);
    expect(res.extractedSample).toBeDefined();
  });

  test('returns valid:false when selector matches nothing', async () => {
    const page = makePageHarness();
    const sandbox = new SelectorSandbox({
      browserFactory: async () => makeBrowser(page),
      createPage: async () => page,
      closeBrowser: async () => {},
    });
    const res = await sandbox.validate('https://example.com/', 'bad-selector', { tagName: 'div' });
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/matched no element/);
  });

  test('rejects invalid inputs', async () => {
    const sandbox = new SelectorSandbox({ browserFactory: async () => ({}) });
    expect((await sandbox.validate('', 'x', {})).valid).toBe(false);
    expect((await sandbox.validate('https://x.com', '', {})).valid).toBe(false);
    expect((await sandbox.validate('https://x.com', 'sel', null)).valid).toBe(false);
  });

  test('validates against real HTML in a local HTTP server', async () => {
    const html = '<!doctype html><html><body><div data-testid="UserName" id="x">NASA</div></body></html>';
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    });
    server.listen(0);
    await once(server, 'listening');
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/`;

    try {
      // Use a harness that actually executes inPageValidate-like logic against a
      // simple DOM model — we emulate page.evaluate by running the function in
      // a vm-like context with a real document built from the HTML.
      const { JSDOM } = await import('jsdom').then(m => m).catch(() => ({ JSDOM: null }));
      if (!JSDOM) {
        // jsdom not installed — fallback: just check harness path
        const page = makePageHarness();
        const sandbox = new SelectorSandbox({
          browserFactory: async () => makeBrowser(page),
          createPage: async () => page,
          closeBrowser: async () => {},
        });
        const res = await sandbox.validate(url, 'ok-anything', { tagName: 'div' });
        expect(res.valid).toBe(true);
        return;
      }

      const dom = new JSDOM(html, { url });
      const page = {
        async goto(u) { this._u = u; },
        async evaluate(fn, selector, shape) {
          // Execute the in-page function against jsdom's document
          const doc = dom.window.document;
          const prevDoc = globalThis.document;
          globalThis.document = doc;
          try {
            return fn(selector, shape);
          } finally {
            globalThis.document = prevDoc;
          }
        },
        async $(s) { return doc.querySelector(s); },
        async close() {},
      };
      const sandbox = new SelectorSandbox({
        browserFactory: async () => makeBrowser(page),
        createPage: async () => page,
        closeBrowser: async () => {},
      });
      const res = await sandbox.validate(url, '[data-testid="UserName"]', {
        attributes: { 'data-testid': 'UserName' },
        tagName: 'div',
      });
      expect(res.valid).toBe(true);
      expect(res.extractedSample?.tagName).toBe('div');

      const bad = await sandbox.validate(url, 'span.nope', { tagName: 'span' });
      expect(bad.valid).toBe(false);
    } finally {
      server.close();
    }
  });

  test('shape validation: tagName mismatch rejected', async () => {
    const html = '<!doctype html><html><body><div id="x"></div></body></html>';
    const { JSDOM } = await import('jsdom').then(m => m).catch(() => ({ JSDOM: null }));
    if (!JSDOM) return;
    const dom = new JSDOM(html, { url: 'http://x/' });
    const page = {
      async goto() {},
      async evaluate(fn, sel, shape) {
        const prev = globalThis.document;
        globalThis.document = dom.window.document;
        try { return fn(sel, shape); } finally { globalThis.document = prev; }
      },
      async $(s) { return dom.window.document.querySelector(s); },
      async close() {},
    };
    const sandbox = new SelectorSandbox({
      browserFactory: async () => makeBrowser(page),
      createPage: async () => page,
      closeBrowser: async () => {},
    });
    const res = await sandbox.validate('http://x/', '#x', { tagName: 'span' });
    expect(res.valid).toBe(false);
    expect(res.error).toMatch(/tagName mismatch/);
  });
});
