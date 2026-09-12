// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Twitter GraphQL Query-ID Runtime Resolver
 *
 * Twitter rotates its internal GraphQL query IDs frequently; a stale ID
 * yields HTTP 404 "query not found". This resolver downloads the current
 * x.com web-app bundles and extracts the live query IDs for any operation,
 * so scraping keeps working without manual ID updates.
 *
 * Results are cached in-memory with a TTL (default 1 hour).
 *
 * @author nich (@nichxbt)
 * @license MIT
 */

/** @type {Map<string, string>} */
const cache = new Map();

/** @type {number | null} */
let cacheRefreshedAt = null;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch a URL using the provided transport (defaults to got-scraping).
 * @param {string} url
 * @param {string | null} proxyUrl
 * @returns {Promise<string>}
 */
async function fetchText(url, proxyUrl) {
  const { gotScraping } = await import('got-scraping');
  const res = await gotScraping({
    url,
    proxyUrl: proxyUrl || undefined,
    throwHttpErrors: false,
    timeout: { request: 30000 },
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  });
  return String(res.body || '');
}

/**
 * Extract all queryId/operationName pairs from a JS bundle body.
 * @param {string} body
 * @returns {Record<string, string>}
 */
function extractQueryIds(body) {
  /** @type {Record<string, string>} */
  const found = {};
  const re = /queryId:"([A-Za-z0-9_-]+)",[^{}]{0,120}?operationName:"([A-Za-z0-9_]+)"/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    const [, queryId, operationName] = match;
    if (operationName && queryId && !found[operationName]) {
      found[operationName] = queryId;
    }
  }
  return found;
}

/**
 * Force-refresh the live query-ID cache from x.com bundles.
 * @param {string | null} [proxyUrl] - Optional proxy URL for outbound requests.
 * @returns {Promise<Map<string, string>>}
 */
export async function refreshQueryIds(proxyUrl = null) {
  const home = await fetchText('https://x.com/home', proxyUrl);
  const bundleUrls = [
    ...new Set(
      [...home.matchAll(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/[^"']+\.js/gi)].map((m) => m[0])
    ),
  ];

  // main.* bundle is most likely to contain the GraphQL API table; prefer it.
  bundleUrls.sort((a, b) => Number(b.includes('/main.')) - Number(a.includes('/main.')));

  for (const bundleUrl of bundleUrls.slice(0, 8)) {
    try {
      const body = await fetchText(bundleUrl, proxyUrl);
      const ids = extractQueryIds(body);
      for (const [op, id] of Object.entries(ids)) {
        if (!cache.has(op)) cache.set(op, id);
      }
      if (cache.size > 0 && cacheRefreshedAt === null) {
        // First bundle that yields IDs marks the cache fresh.
        cacheRefreshedAt = Date.now();
      }
      if (cache.size >= 40) break;
    } catch {
      // Skip unreachable bundles; resolver is best-effort.
    }
  }

  cacheRefreshedAt = Date.now();
  return cache;
}

/**
 * Resolve the live query ID for a GraphQL operation.
 * @param {string} operationName
 * @param {string} [fallbackId] - Known static ID used before a refresh succeeds.
 * @param {string | null} [proxyUrl]
 * @returns {Promise<string>}
 */
export async function resolveQueryId(operationName, fallbackId = '', proxyUrl = null) {
  const expired = cacheRefreshedAt === null || Date.now() - cacheRefreshedAt > CACHE_TTL_MS;
  if (expired && !cache.has(operationName)) {
    await refreshQueryIds(proxyUrl).catch(() => {});
  }
  return cache.get(operationName) || fallbackId;
}

/**
 * Test-only helper: clear the resolver cache.
 */
export function resetQueryIdCache() {
  cache.clear();
  cacheRefreshedAt = null;
}
