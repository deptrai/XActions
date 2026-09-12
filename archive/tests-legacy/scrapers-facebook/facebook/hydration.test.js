// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// Tests for Story 7.1 — Facebook Hydration JSON Extraction
// by nichxbt

import { describe, it, expect } from 'vitest';
import { extractHydrationJson } from '../../../src/scrapers/facebook/hydration.js';

function makeFakePage(html) {
  return {
    evaluate: async (fn, ...args) => {
      if (typeof fn !== 'function') return undefined;
      const prev = globalThis.document;
      globalThis.document = fakeDocument(html);
      try {
        return await fn(...args);
      } finally {
        globalThis.document = prev;
      }
    },
  };
}

function fakeDocument(html) {
  const scripts = [];
  const matches = html.matchAll(/<script[^>]*type="application\/json"[^>]*data-content-len="[^"]*"[^>]*>([\s\S]*?)<\/script>/g);
  for (const match of matches) {
    scripts.push({ textContent: match[1] });
  }
  return { querySelectorAll: (sel) => (sel === 'script[type="application/json"][data-content-len]' ? scripts : []) };
}

describe('extractHydrationJson', () => {
  it('throws when typenames is empty', async () => {
    await expect(extractHydrationJson(makeFakePage(''), [])).rejects.toThrow('non-empty typenames array');
  });

  it('extracts nodes by __typename', async () => {
    const html = `
      <script type="application/json" data-content-len="100">
        {"__typename":"User","id":"123","name":"Alice"}
      </script>
      <script type="application/json" data-content-len="100">
        {"__typename":"Comment","id":"456","text":"hello"}
      </script>
    `;
    const page = makeFakePage(html);
    const result = await extractHydrationJson(page, ['User', 'Comment']);

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ __typename: 'User', id: '123' }),
        expect.objectContaining({ __typename: 'Comment', id: '456' }),
      ])
    );
  });

  it('walks nested JSON and collects deep nodes', async () => {
    const html = `
      <script type="application/json" data-content-len="100">
        {"data":{"node":{"__typename":"Page","id":"789","name":"Zuck"}}}
      </script>
    `;
    const page = makeFakePage(html);
    const result = await extractHydrationJson(page, ['Page']);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ __typename: 'Page', id: '789' });
  });

  it('ignores unrelated __typename values', async () => {
    const html = `
      <script type="application/json" data-content-len="100">
        {"__typename":"SomethingElse","id":"999"}
      </script>
    `;
    const page = makeFakePage(html);
    const result = await extractHydrationJson(page, ['User']);

    expect(result).toHaveLength(0);
  });

  it('falls back to DOM extraction when hydration is empty', async () => {
    const fallback = async (_page, typenames) => [{ fallback: true, typenames }];
    const page = makeFakePage('<html></html>');
    const result = await extractHydrationJson(page, ['User'], { fallbackExtractor: fallback });

    expect(result).toEqual([{ fallback: true, typenames: ['User'] }]);
  });

  it('uses generic DOM fallback when no data and no custom fallback provided', async () => {
    const page = makeFakePage('<html></html>');
    const result = await extractHydrationJson(page, ['User']);

    expect(result).toEqual([]);
  });
});
