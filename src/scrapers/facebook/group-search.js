// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * XActions Facebook Scrapers
 * Puppeteer-based scrapers for Facebook (facebook.com)
 *
 * Uses the same Puppeteer stealth approach as Twitter and Threads scrapers.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// Facebook scraper — group-search.js
import { randomDelay, assertFacebookUrlLocal, applyMobileViewport, assertNoCheckpoint, isContentUnavailable } from './core.js';
import { extractGroupPostsFromDom } from './posts.js';
import { normalizeGroupPost } from './normalize.js';
import { extractHydrationJson } from './hydration.js';


/**
 * Search for posts **within** a specific Facebook group by keyword (FR-61b).
 *
 * Facebook exposes a native group search endpoint:
 *   https://www.facebook.com/groups/<groupId>/search/?q=<keyword>
 *   https://m.facebook.com/groups/<groupId>/search/?q=<keyword>
 *
 * This is far more efficient than scraping the full group feed and filtering
 * client-side, because Facebook performs the keyword match server-side and
 * returns only matching posts.
 *
 * READ-ONLY scrape — NOT routed through runGuardedBatch.
 *
 * @deprecated Replaced by `FacebookCrawler` action `group_search` (Story 13.6). Use `FacebookCrawler.start({ action: 'group_search', ... })` instead.
 * @param {import('puppeteer').Page} page - Puppeteer page (authenticated)
 * @param {string} groupUrl - facebook.com/groups/<id> URL
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>[] | { note: string, platform: 'facebook' }>}
 */
export async function scrapeFacebookGroupSearch(page, groupUrl, options = {}) {
  const {
    query,
    limit = 50,
    maxRetries = 8,
    maxScrolls = 50,
    delay = randomDelay,
    onProgress,
  } = options;

  // AC1: Validate groupUrl (SSRF guard) before any navigation.
  assertFacebookUrlLocal(groupUrl, 'scrapeFacebookGroupSearch: groupUrl');
  if (!/facebook\.com\/groups\//i.test(groupUrl)) {
    throw new Error('❌ scrapeFacebookGroupSearch requires a facebook.com/groups/ URL');
  }

  // AC2: Validate query is a non-empty string.
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('❌ scrapeFacebookGroupSearch requires a non-empty options.query string');
  }

  // AC3: Mobile UA and viewport before navigation (matches scrapeFacebookGroupPosts).
  await applyMobileViewport(page);

  // AC4: Build group search URL — force mobile host for consistent DOM.
  // Use URL API to handle existing query params/fragments in the group URL correctly.
  const searchUrlObj = new URL(groupUrl);
  searchUrlObj.hostname = 'm.facebook.com';
  searchUrlObj.port = ''; // clear any non-default port from original URL
  searchUrlObj.search = ''; // strip existing query params
  searchUrlObj.hash = ''; // strip fragments
  searchUrlObj.pathname = searchUrlObj.pathname.replace(/\/$/, '') + '/search/';
  searchUrlObj.searchParams.set('q', query.trim());
  const searchUrl = searchUrlObj.toString();

  await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await assertNoCheckpoint(page, 'group search');
  await delay(2000, 4000);

  // AC5: Detect whether the group search is accessible.
  let containerFound = false;
  try {
    await page.waitForSelector('div.m.displayed, [role="article"]', { timeout: 8000 });
    containerFound = true;
  } catch (_) {
    // Search not accessible → restricted or login required.
  }

  if (!containerFound) {
    return {
      note: 'Facebook group search is not accessible. The group may be private, membership may be required, or the search returned no results.',
      platform: 'facebook',
    };
  }

  // AC6: Check for "no results" indicator.
  if (await isContentUnavailable(page)) {
    return {
      note: 'Facebook group search returned no results or the content is unavailable.',
      platform: 'facebook',
    };
  }

  // AC7: Bounded scroll loop with deduplication.
  const posts = new Map(); // keyed by id for deduplication
  let retries = 0;
  let scrolls = 0;

  while (posts.size < limit && retries < maxRetries && scrolls < maxScrolls) {
    const prevSize = posts.size;

    const hydrated = await extractHydrationJson(page, ['Story'], {
      limit: limit - posts.size,
      fallbackExtractor: extractGroupPostsFromDom,
    });

    for (const raw of hydrated) {
      const normalized = normalizeGroupPost(raw);
      if (!normalized || !normalized.id) continue;
      posts.set(normalized.id, normalized);
    }

    if (onProgress) onProgress({ scraped: posts.size, limit });

    if (posts.size === prevSize) {
      retries++;
    } else {
      retries = 0;
    }

    // Stop immediately once the limit is reached.
    if (posts.size >= limit) break;

    await assertNoCheckpoint(page, 'group search');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
    scrolls++;
  }

  return Array.from(posts.values()).slice(0, limit);
}
