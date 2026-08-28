// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Scrapers
 * Puppeteer-based scrapers for Facebook (facebook.com)
 *
 * Uses the same Puppeteer stealth approach as Twitter and Threads scrapers.
 *
 * @deprecated Use `src/scrapers/social/facebook/index.js` (`FacebookCrawler`, `FacebookClient`) instead. See docs/deprecation-plan.md.
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// Facebook scraper — search.js
import { randomDelay, FACEBOOK_BASE, assertNoCheckpoint, assertNoOnboardingWall } from './core.js';
import { SEARCH_TYPE_URLS, SEARCH_TYPENAMES, normalizeByType, validateSearchQuery, validateSearchType, validateSearchLimit, buildSearchQuery } from './normalize.js';
import { extractPostsFromDom } from './posts.js';
import { extractHydrationJson } from './hydration.js';

/**
 * @param {import('puppeteer').Page} page
 * @param {string} type
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function extractListItemsFromDom(page, type) {
  const rawResults = await page.evaluate((searchType) => {
    const NON_ENTITY_ROOTS = new Set([
      'search', 'watch', 'marketplace', 'events', 'friends', 'photo', 'photo.php',
      'reel', 'reels', 'stories', 'hashtag', 'l.php', 'l', 'settings', 'help',
      'about', 'privacy', 'terms', 'login', 'checkpoint',
    ]);

    /** @param {string|null|undefined} href */
    function normalizeEntityUrl(href) {
      if (!href) return null;
      const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
      try {
        const u = new URL(abs);
        const host = u.hostname.toLowerCase();
        if (!host.endsWith('facebook.com')) return null;
        return { href: abs, pathname: u.pathname, search: u.search };
      } catch {
        return null;
      }
    }

    /** @param {{ href: string, pathname: string, search: string }|null} entityUrl */
    function extractIdFromEntityUrl(entityUrl) {
      if (!entityUrl) return null;
      const { href, pathname, search } = entityUrl;

      // Numeric profile: /profile.php?id=123
      const idMatch = search.match(/[?&]id=(\d+)/);
      if (idMatch) return idMatch[1];

      const parts = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
      if (parts.length === 0) return null;

      // Use the last path segment as the stable identifier for people/pages/groups.
      // Works for /groups/xyz, /pages/Name/123, /people/Name/123, and /username.
      return parts.at(-1);
    }

    /** @param {{ href: string, pathname: string, search: string }|null} entityUrl @param {string} searchType */
    function isEntityLink(entityUrl, searchType) {
      if (!entityUrl) return false;
      const parts = entityUrl.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
      if (parts.length === 0) return false;
      const first = parts[0].toLowerCase();
      if (NON_ENTITY_ROOTS.has(first)) return false;

      if (searchType === 'groups') {
        return entityUrl.pathname.includes('/groups/');
      }
      if (searchType === 'people') {
        // People search should not return group/page links.
        if (entityUrl.pathname.includes('/groups/') || entityUrl.pathname.includes('/pages/')) return false;
        return true;
      }
      if (searchType === 'pages') {
        // Page search should not return group links.
        if (entityUrl.pathname.includes('/groups/')) return false;
        return true;
      }
      return true;
    }

    /** @param {Element} item @param {string} searchType */
    function pickBestLink(item, searchType) {
      const links = Array.from(item.querySelectorAll('a[href]'));
      for (const a of links) {
        const entityUrl = normalizeEntityUrl(a.getAttribute('href'));
        if (isEntityLink(entityUrl, searchType)) {
          return { a, entityUrl };
        }
      }
      return null;
    }

    /** @param {Element} item */
    function getUniqueLines(item) {
      const text = item.innerText || item.textContent || '';
      return Array.from(new Set(text.split('\n').map((t) => t.trim()).filter(Boolean)));
    }

    const items = document.querySelectorAll('[role="listitem"], [role="article"]');
    return Array.from(items).map((item) => {
      const picked = pickBestLink(item, searchType);
      if (!picked || !picked.entityUrl) return null;

      const { a, entityUrl } = picked;
      const abs = entityUrl.href;
      const id = extractIdFromEntityUrl(entityUrl);
      if (!id) return null;

      // Prefer the link text as the entity name; fall back to the first non-empty line.
      const linkText = (a.innerText || a.textContent || '').trim();
      const allLines = getUniqueLines(item);
      const name = (linkText && linkText.length <= 80 ? linkText : allLines[0]) || null;

      const img = Array.from(item.querySelectorAll('img')).find((i) => {
        const src = i.getAttribute('src') || '';
        return src.startsWith('http') && !src.includes('emoji') && !src.includes('fbcdn.net/images');
      });
      const image = img?.getAttribute('src') || null;

      // Parse counts from lines.
      const counts = /** @type {RegExpMatchArray[]} */ (
        allLines
          .map((t) => t.match(/([\d,.]+[KkMm]?\+?)\s*(members?|people|likes?)/i))
          .filter(Boolean)
      );
      const members = counts.find((m) => /members?|people/i.test(/** @type {RegExpMatchArray} */ (m)[0]))?.[1] || null;
      const likes = counts.find((m) => /likes?/i.test(/** @type {RegExpMatchArray} */ (m)[0]))?.[1] || null;

      // Whole-word privacy matching to avoid "publication" or "secretary".
      const privacy = allLines.find((t) => /\b(public|private|closed|secret)\b/i.test(t)) || null;

      // Category is the first remaining line that is not the name, a count, privacy, or a UI string.
      const category = allLines.find((t) => {
        if (t === name) return false;
        if (t === members || t === likes || t === privacy) return false;
        if (/[\d,.]+[KkMm]?\+?\s*(members?|people|likes?)/i.test(t)) return false;
        if (/\b(public|private|closed|secret)\b/i.test(t)) return false;
        if (/^(like|follow|message|join|invite|see all|more|options|share|comment)$/i.test(t)) return false;
        return true;
      }) || null;

      const base = { id, name, url: abs, image };

      if (searchType === 'people') {
        return { ...base, profileUrl: abs };
      }
      if (searchType === 'pages') {
        return { ...base, category, likes, pageUrl: abs };
      }
      if (searchType === 'groups') {
        return { ...base, members, privacy, groupUrl: abs };
      }
      return base;
    }).filter(Boolean);
  }, type);

  return /** @type {Record<string, unknown>[]} */ (rawResults);
}

/**
 * @param {import('puppeteer').Page} page
 * @param {string} query
 * @param {string} type
 * @param {FacebookOptions} [options]
 * @returns {Promise<(FacebookPostSearchResult | FacebookPeopleSearchResult | FacebookPageSearchResult | FacebookGroupSearchResult)[]>}
 */
async function searchByType(page, query, type, options = {}) {
  const limit = Math.max(1, Math.floor(Number(options.limit) || 30));
  const onProgress = options.onProgress;
  const maxRetries = Math.max(1, Math.floor(Number(options.maxRetries) || 8));
  const maxScrolls = Math.max(1, Math.floor(Number(options.maxScrolls) || 50));
  const delay = options.delay || randomDelay;

  const typePath = SEARCH_TYPE_URLS[type];
  if (!typePath) {
    throw new Error(`❌ searchByType: unknown search type "${type}"`);
  }

  const searchUrl = `${FACEBOOK_BASE}${typePath}?q=${encodeURIComponent(query)}`;

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await assertNoOnboardingWall(page, `${type} search`);
  await assertNoCheckpoint(page, `${type} search`);
  await delay(2000, 4000);

  const results = new Map();
  let retries = 0;
  let scrolls = 0;

  while (results.size < limit && retries < maxRetries && scrolls < maxScrolls) {
    const prevSize = results.size;

    const typeNames = SEARCH_TYPENAMES[type] || [];
    const hydrated = await extractHydrationJson(page, typeNames, {
      limit,
      fallbackExtractor: async (_page, _typenames) => {
        return /** @type {Record<string, unknown>[]} */ (type === 'posts'
          ? await extractPostsFromDom(page)
          : await extractListItemsFromDom(page, type));
      },
    });

    for (const raw of hydrated) {
      const normalized = normalizeByType(raw, type);
      if (normalized && normalized.id) {
        results.set(normalized.id, normalized);
      }
    }

    if (onProgress) onProgress({ scraped: results.size, limit });

    if (results.size === prevSize) {
      retries++;
    } else {
      retries = 0;
    }

    // Stop immediately once the limit is reached — no wasted scroll + delay.
    if (results.size >= limit) break;

    await assertNoCheckpoint(page, `${type} search`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
    scrolls++;
  }

  return /** @type {(FacebookPostSearchResult | FacebookPeopleSearchResult | FacebookPageSearchResult | FacebookGroupSearchResult)[]} */ (Array.from(results.values()).slice(0, limit));
}

/**
 * Search Facebook by multiple types (posts, people, pages, groups) or all.
 * @deprecated Replaced by `FacebookCrawler` action `search` (Story 13.6). Use `FacebookCrawler.search()` instead.
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} query - Search query string
 * @param {FacebookOptions} options
 * @returns {Promise<Record<string, unknown[]> | (FacebookPostSearchResult | FacebookPeopleSearchResult | FacebookPageSearchResult | FacebookGroupSearchResult)[]>} Normalized results (array for single type, object for 'all')
 */
export async function searchFacebook(page, query, options = {}) {
  const { type = 'posts', location, limit = 30 } = options;

  validateSearchQuery(query);
  validateSearchType(type);
  validateSearchLimit(limit);

  const effectiveQuery = buildSearchQuery(query, location);

  // Do not pass the top-level type ('all') down to per-type searches;
  // coerce limit to a number so downstream comparisons are safe.
  const perTypeOptions = { ...options, limit: Number(limit) };
  delete perTypeOptions.type;

  if (type === 'all') {
    const posts = await searchByType(page, effectiveQuery, 'posts', perTypeOptions);
    const people = await searchByType(page, effectiveQuery, 'people', perTypeOptions);
    const pages = await searchByType(page, effectiveQuery, 'pages', perTypeOptions);
    const groups = await searchByType(page, effectiveQuery, 'groups', perTypeOptions);
    return { posts, people, pages, groups };
  }

  return searchByType(page, effectiveQuery, type, perTypeOptions);
}

/**
 * Backward-compatible thin wrapper around searchFacebook for existing callers.
 * @deprecated Replaced by `FacebookCrawler` action `search` (Story 13.6).
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} query - Search query string
 * @param {FacebookOptions} options
 * @returns {Promise<(FacebookPostSearchResult | FacebookPeopleSearchResult | FacebookPageSearchResult | FacebookGroupSearchResult)[]>} Normalized post search result array
 */
export async function searchTweets(page, query, options = {}) {
  return /** @type {Promise<(FacebookPostSearchResult | FacebookPeopleSearchResult | FacebookPageSearchResult | FacebookGroupSearchResult)[]>} */ (searchFacebook(page, query, { ...options, type: 'posts' }));
}
