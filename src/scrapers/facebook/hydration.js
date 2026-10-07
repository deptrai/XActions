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
 * @param {unknown} value
 * @param {Set<string>} typeSet
 * @param {Record<string, unknown>[]} results
 * @param {WeakSet<object>} visited
 */
function walkJson(value, typeSet, results, visited) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, typeSet, results, visited);
  } else if (value && typeof value === 'object') {
    if (visited.has(value)) return;
    visited.add(value);
    const record = /** @type {Record<string, unknown>} */ (value);
    if (typeof record.__typename === 'string' && typeSet.has(record.__typename)) {
      results.push(record);
    }
    for (const key of Object.keys(record)) {
      if (key === '__typename') continue;
      walkJson(record[key], typeSet, results, visited);
    }
  }
}

/**
 * Generic DOM fallback. Returns an empty array by default; type-specific fallbacks should
 * be supplied by the caller via `options.fallbackExtractor`.
 * @returns {Promise<Record<string, unknown>[]>}
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
 * @param {FacebookHydrationOptions} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function extractHydrationJson(page, typenames, options = {}) {
  if (!Array.isArray(typenames) || typenames.length === 0) {
    throw new Error('❌ extractHydrationJson requires a non-empty typenames array');
  }

  const limit = options.limit ? Math.max(1, Math.floor(Number(options.limit))) : 0;

  const rawResults = await page.evaluate((typeNames) => {
    /** @type {Record<string, unknown>[]} */
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

  const results = /** @type {Record<string, unknown>[]} */ (rawResults);

  if (results.length === 0 || (limit && results.length < limit)) {
    const fallback = options.fallbackExtractor || genericDomFallback;
    try {
      const fallbackResults = await fallback(page, typenames);
      return fallbackResults?.length ? [...results, ...fallbackResults] : results;
    } catch {
      // Fallback extractor failed (e.g., page closed, selector changed) —
      // return hydration results collected so far rather than losing them.
      return results;
    }
  }

  return results;
}

export default { extractHydrationJson };
