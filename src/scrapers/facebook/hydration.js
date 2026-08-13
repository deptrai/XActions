// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Facebook hydration JSON extractor (Story 7.1 — AC3).
 *
 * Facebook embeds structured data inside `<script type="application/json" data-content-len>`
 * tags. These scripts contain a copy of the GraphQL entity tree; by walking the JSON we can
 * extract nodes by `__typename` without brittle CSS selectors.
 *
 * The primary contract is `extractHydrationJson(page, typenames)`. When no (or not enough)
 * hydration data is found, the helper attempts a generic DOM fallback. Callers that need a
 * type-specific DOM extraction can pass an optional `fallbackExtractor`.
 *
 * @author nich (@nichxbt)
 * @license BSL 1.1
 */

/**
 * Recursively walk a JSON value, collecting objects whose `__typename` is in the allow list.
 * @param {any} value
 * @param {Set<string>} typeSet
 * @param {any[]} results
 */
function walkJson(value, typeSet, results, visited) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, typeSet, results, visited);
  } else if (value && typeof value === 'object') {
    if (visited.has(value)) return;
    visited.add(value);
    if (value.__typename && typeSet.has(value.__typename)) {
      results.push(value);
    }
    for (const key of Object.keys(value)) {
      if (key === '__typename') continue;
      walkJson(value[key], typeSet, results, visited);
    }
  }
}

/**
 * Generic DOM fallback. Returns an empty array by default; type-specific fallbacks should
 * be supplied by the caller via `options.fallbackExtractor`.
 * @returns {Promise<any[]>}
 */
async function genericDomFallback() {
  return [];
}

/**
 * Extract all JSON objects matching the requested __typenames from Facebook's hydration
 * scripts. Falls back to DOM extraction when nothing was found.
 *
 * @param {import('puppeteer').Page} page
 * @param {string[]} typenames - e.g. ['Story','Comment','User','Page','Group','MarketplaceListing']
 * @param {{ fallbackExtractor?: (page, typenames) => Promise<any[]> }} [options]
 * @returns {Promise<any[]>}
 */
export async function extractHydrationJson(page, typenames, options = {}) {
  if (!Array.isArray(typenames) || typenames.length === 0) {
    throw new Error('❌ extractHydrationJson requires a non-empty typenames array');
  }

  const results = await page.evaluate((typeNames) => {
    const collected = [];
    const typeSet = new Set(typeNames);

    const scripts = document.querySelectorAll('script[type="application/json"][data-content-len]');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.trim()) continue;
      try {
        const data = JSON.parse(text);
        walkJson(data, typeSet, collected, new WeakSet());
      } catch {
        // Invalid JSON inside a data-content-len script — skip silently
      }
    }

    return collected;
  }, typenames);

  if (results.length === 0) {
    const fallback = options.fallbackExtractor || genericDomFallback;
    return await fallback(page, typenames);
  }

  return results;
}

export default { extractHydrationJson };
