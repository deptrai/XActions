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

// Facebook scraper — comments.js
import { randomDelay, NON_PROFILE_SEGMENTS, assertFacebookUrlLocal, assertNoCheckpoint, isContentUnavailable } from './core.js';
import { normalizeComment } from './normalize.js';
import { extractHydrationJson } from './hydration.js';


// ============================================================================
// Comments & Group Content Scraper (Story 7.3 — FR-58, FR-59, FR-60)
// ============================================================================

/**
 * Best-effort DOM fallback for post comments.
 * Returns raw comment-shaped objects that normalizeComment can process.
 *
 * @param {import('puppeteer').Page} page
 * @param {string[]} _typenames - Passed by extractHydrationJson; ignored
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function extractCommentsFromDom(page, _typenames) {
  const raw = await page.evaluate((nonProfile) => {
    const NON_PROFILE = new Set(nonProfile);

    const allArticles = Array.from(document.querySelectorAll('[role="article"]'));

    // On a post permalink page, the main post is usually the first [role="article"]
    // that contains a post permalink link.
    const postArticle = allArticles.find((a) =>
      a.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]')
    );

    const commentArticles = allArticles.filter((a) => a !== postArticle);

    return commentArticles.map((article) => {
      const textEls = article.querySelectorAll('[dir="auto"]');
      const texts = Array.from(textEls)
        .map((el) => (el.innerText || el.textContent || '').trim())
        .filter(Boolean);

      const text = texts.reduce((best, t) => {
        if (!best) return t;
        const bestSpaces = (best.match(/\s+/g) || []).length;
        const tSpaces = (t.match(/\s+/g) || []).length;
        return tSpaces > bestSpaces ? t : best;
      }, /** @type {string|null} */ (null));

      const links = Array.from(article.querySelectorAll('a[href]'));
      let author = null;
      let authorUrl = null;
      for (const a of links) {
        const href = a.getAttribute('href') || '';
        if (href.includes('/posts/') || href.includes('/permalink/') || href.includes('story_fbid')) continue;
        if (href.includes('l.php') || href.includes('/l/')) continue;
        const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        try {
          const u = new URL(abs);
          if (!u.hostname.toLowerCase().endsWith('facebook.com')) continue;
          const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
          if (parts.length === 0) continue;
          if (NON_PROFILE.has(parts[0].toLowerCase())) continue;
          author = (a.textContent || '').trim() || null;
          authorUrl = abs.split('?')[0];
          break;
        } catch {
          // ignore malformed URLs
        }
      }

      const timeEl = article.querySelector('abbr, [aria-label*="ago"], [aria-label*="at"], time');
      const timestamp = timeEl?.textContent?.trim() || timeEl?.getAttribute('aria-label') || null;

      const allText = article.textContent || '';
      const likesMatch = allText.match(/([\d,.]+[KkMm]?)\s*(like|reaction)/i);
      const likes = likesMatch ? likesMatch[1] : '0';

      return { text, author, authorUrl, timestamp, likes, replies: [] };
    }).filter((c) => c.text || c.author);
  }, NON_PROFILE_SEGMENTS);
  return /** @type {Record<string, unknown>[]} */ (raw);
}

/**
 * Click "All comments" sort option if the sort control is present.
 * Runs inside page.evaluate and swallows errors so a missing sort UI doesn't block scraping.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
async function clickAllCommentsSort(page) {
  try {
    await page.evaluate(() => {
      const sortBtn = Array.from(document.querySelectorAll('[role="button"], button, a, div, span'))
        .find((el) => /Most relevant|Sort by|Sort comments|Top comments/i.test(el.textContent || el.getAttribute('aria-label') || ''));
      if (sortBtn) sortBtn.click();

      const allComments = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], a, button, div, span'))
        .find((el) => /All comments/i.test(el.textContent || el.getAttribute('aria-label') || ''));
      if (allComments) allComments.click();
    });
  } catch {
    // Sort controls are optional; do not fail if they are absent.
  }
}

/**
 * Click "View more comments" / "X replies" expanders to reveal hidden comments.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
async function clickCommentExpanders(page) {
  try {
    await page.evaluate(() => {
      const expanders = Array.from(document.querySelectorAll('a, button, div[role="button"], span[role="button"]'))
        .filter((el) => /View more comments|\d+\s*(more\s+)?replies?/i.test(el.textContent || el.getAttribute('aria-label') || ''));
      for (const el of expanders) {
        try { el.click(); } catch { /* ignore stale/clickable errors */ }
      }
    });
  } catch {
    // Expander controls are optional; do not fail if they are absent.
  }
}

/**
 * Scrape comments from a Facebook post (FR-58).
 * READ-ONLY scrape — NOT routed through runGuardedBatch.
 *
 * @deprecated Replaced by `FacebookCrawler` action `post_comments` (Story 13.7).
 *
 * @param {import('puppeteer').Page} page - Puppeteer page (authenticated)
 * @param {string} postUrl - facebook.com post URL
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>[] | { note: string, platform: 'facebook' }>}
 */
// LEGACY — see docs/deprecation-plan.md
export async function scrapeFacebookComments(page, postUrl, options = {}) {
  const {
    limit = 50,
    includeReplies = false,
    maxRetries = 8,
    maxScrolls = 50,
    delay = randomDelay,
    onProgress,
  } = options;

  // AC2: URL validation before any navigation (SSRF guard).
  assertFacebookUrlLocal(postUrl, 'scrapeFacebookComments: postUrl');

  await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await assertNoCheckpoint(page, 'post comments');
  await delay(2000, 4000);

  // AC4: Switch comment sort to "All comments" if the sort UI is present.
  await clickAllCommentsSort(page);
  await delay(1000, 2000);

  if (await isContentUnavailable(page)) {
    return {
      note: 'Facebook comments are not accessible. The post may be restricted, comments may be disabled, or the content is unavailable.',
      platform: /** @type {'facebook'} */ ('facebook'),
    };
  }

  // AC5: Bounded scroll loop — empty-scroll detection + limit cap.
  const comments = new Map();
  let retries = 0;
  let scrolls = 0;

  while (comments.size < limit && retries < maxRetries && scrolls < maxScrolls) {
    const prevSize = comments.size;

    // Click "View more comments" / "X replies" expanders to reveal hidden threads.
    await clickCommentExpanders(page);
    await delay(500, 1500);

    const hydrated = await extractHydrationJson(page, ['Comment'], {
      limit: limit - comments.size,
      fallbackExtractor: extractCommentsFromDom,
    });

    for (const raw of hydrated) {
      const normalized = normalizeComment(/** @type {Record<string, unknown>} */ (raw));
      if (!normalized || !normalized.id) continue;

      const output = includeReplies
        ? normalized
        : (() => { const { replies, ...rest } = normalized; return rest; })();

      comments.set(normalized.id, output);
    }

    if (onProgress) onProgress({ scraped: comments.size, limit });

    if (comments.size === prevSize) {
      retries++;
    } else {
      retries = 0;
    }

    // Stop immediately once the limit is reached — no wasted scroll + delay.
    if (comments.size >= limit) break;

    await assertNoCheckpoint(page, 'post comments');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
    scrolls++;
  }

  return /** @type {Record<string, unknown>[]} */ (Array.from(comments.values()).slice(0, limit));
}

/**
 * Scrape comments from a post inside a Facebook group (FR-60).
 * Thin wrapper around scrapeFacebookComments; no duplicated extraction logic.
 *
 * @deprecated Replaced by `FacebookCrawler` action `group_comments` (Story 13.7).
 *
 * @param {import('puppeteer').Page} page - Puppeteer page (authenticated)
 * @param {string} groupPostUrl - facebook.com/groups/ post URL
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>[] | { note: string, platform: 'facebook' }>}
 */
// LEGACY — see docs/deprecation-plan.md
export async function scrapeFacebookGroupComments(page, groupPostUrl, options = {}) {
  if (typeof groupPostUrl !== 'string' || !groupPostUrl.includes('/groups/')) {
    throw new Error('❌ scrapeFacebookGroupComments requires a facebook.com/groups/ post URL');
  }
  return scrapeFacebookComments(page, groupPostUrl, options);
}
