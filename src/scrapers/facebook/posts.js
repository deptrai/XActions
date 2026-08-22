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

// Facebook scraper — posts.js
import { randomDelay, FACEBOOK_BASE, MBASIC_BASE, MOBILE_BASE, applyMobileViewport, NON_PROFILE_SEGMENTS, assertFacebookUrlLocal, assertNoCheckpoint, assertNoOnboardingWall } from './core.js';
import { normalizeHandle, normalizePost, normalizeGroupPost } from './normalize.js';
import { extractHydrationJson } from './hydration.js';


/**
 * Scrape posts from a Facebook profile/page via mbasic.facebook.com.
 * mbasic serves plain HTML with article[data-ft] posts and a "See more stories" paginator.
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} handle - Normalized Facebook handle
 * @param {FacebookOptions} options
 * @returns {Promise<Record<string, unknown>[]>} Post array
 */
async function scrapeMbasicPosts(page, handle, options = {}) {
  const { limit = 50, onProgress, delay = randomDelay } = options;

  /** @param {Record<string, unknown>} raw */
  const normalizeMbasicPost = (raw) =>
    normalizePost({
      id: typeof raw.postId === 'string' ? raw.postId : (typeof raw.postUrl === 'string' ? raw.postUrl : (typeof raw.text === 'string' ? raw.text.slice(0, 80) : null)),
      text: raw.text || null,
      timestamp: raw.timestamp || null,
      likes: raw.likes || '0',
      comments: raw.comments || '0',
      postUrl: raw.postUrl || null,
      images: raw.images || [],
      hasVideo: raw.hasVideo || false,
      author: raw.author || null,
    });

  const collectFromPage = async () => {
    const raw = await page.evaluate(() => {
      const articles = document.querySelectorAll('article[data-ft*="top_level_post_id"]');
      return Array.from(articles).map((article) => {
        try {
          const dataFt = article.getAttribute('data-ft');
          let postId = null;
          if (dataFt) {
            const m = dataFt.match(/"top_level_post_id"[:"]"?([\d]+)/);
            if (m) postId = m[1];
          }

          // Author: h3 strong a, a.actor-link, or any strong a inside article
          let author = null;
          let authorUrl = null;
          const authorEls = article.querySelectorAll('h3 a, h3 strong a, a.actor-link, strong a');
          for (const a of authorEls) {
            const txt = a.innerText?.trim();
            if (txt && txt.length < 100) {
              author = txt;
              authorUrl = a.getAttribute('href') || null;
              break;
            }
          }

          // Text container — mbasic wraps the story body in .story_body_container
          const bodyContainer = article.querySelector('.story_body_container');
          let text = '';
          if (bodyContainer) {
            text = bodyContainer.innerText?.trim() || '';
          } else {
            // Fallback: collect meaningful paragraphs
            const ps = article.querySelectorAll('p, div[role="main"] p');
            text = Array.from(ps)
              .map((p) => p.innerText?.trim())
              .filter((t) => t && t.length > 5)
              .join('\n');
          }
          if (!text) {
            text = article.innerText?.trim() || '';
          }
          // Remove trailing action links
          text = text
            .replace(/\n(Like|Comment|Share|Full Story|See more)\s*$/i, '')
            .replace(/\n(Like|Comment|Share|Full Story|See more)\n.*$/i, '')
            .trim()
            .substring(0, 1000);

          // Timestamp — mbasic uses <abbr> with the date
          const abbr = article.querySelector('abbr');
          const timestamp = abbr?.textContent?.trim() || abbr?.getAttribute('title') || null;

          // Post URL — footer link to /story.php or /permalink.php
          let postUrl = null;
          const linkEls = article.querySelectorAll('a[href*="/story.php"], a[href*="/permalink.php"]');
          for (const a of linkEls) {
            const href = a.getAttribute('href');
            if (href) {
              postUrl = href.startsWith('http') ? href : `${window.location.origin}${href}`;
              break;
            }
          }

          // Engagement — look in footer / action text
          const allText = article.innerText || '';
          const likesMatch = allText.match(/([\d,.]+[KkMm]?)\s*(Like|left reaction|others reacted)/i);
          const commentsMatch = allText.match(/([\d,.]+[KkMm]?)\s*comment/i);
          const sharesMatch = allText.match(/([\d,.]+[KkMm]?)\s*Share/i);

          // Images
          const images = Array.from(article.querySelectorAll('img'))
            .map((img) => img.getAttribute('src'))
            .filter((src) => src && !src.includes('static') && !src.includes('emoji') && src.startsWith('http'));

          const hasVideo = !!article.querySelector('video, a[href*="/video/"]');

          return {
            postId,
            author,
            authorUrl,
            text: text || null,
            timestamp,
            likes: likesMatch ? likesMatch[1] : '0',
            comments: commentsMatch ? commentsMatch[1] : '0',
            shares: sharesMatch ? sharesMatch[1] : '0',
            postUrl,
            images,
            hasVideo,
          };
        } catch (err) {
          return null;
        }
      }).filter((p) => p && p.text && p.text.length > 5);
    });
    return /** @type {Record<string, unknown>[]} */ (raw);
  };

  const findNextPage = async () => {
    return page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/profile/timeline/stream/"], a[href*="/page_content?"], a[href*="cursor="]'));
      if (links.length) {
        const href = links[0].getAttribute('href');
        if (!href) return null;
        return href.startsWith('http') ? href : `${window.location.origin}${href}`;
      }
      // Fallback: text-based "See more" / "Show more" links
      const moreLinks = Array.from(document.querySelectorAll('a'));
      for (const a of moreLinks) {
        const text = (a.innerText || '').trim().toLowerCase();
        if (/(see more|show more|xem thêm|tiếp|load more|more stories)/i.test(text)) {
          const href = a.getAttribute('href');
          if (href) return href.startsWith('http') ? href : `${window.location.origin}${href}`;
        }
      }
      return null;
    });
  };

  /** @type {string|null} */
  const mbasicPath = /^\d+$/.test(handle) ? `profile.php?id=${handle}` : handle;
  let targetUrl = /** @type {string|null} */ (`${MBASIC_BASE}/${mbasicPath}${mbasicPath.includes('?') ? '&' : '?'}v=timeline`);
  const posts = new Map();
  let pageCount = 0;
  const maxPages = Math.max(1, Math.ceil(limit / 4)); // mbasic shows ~4 posts per page

  while (targetUrl && posts.size < limit && pageCount < maxPages) {
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await assertNoOnboardingWall(page, 'mbasic posts');
      await delay(1500, 3000);

      // Detect login wall
      const blocked = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        return text.length < 500 && /log\s*in\s*to\s*facebook|create\s*new\s*account/i.test(text);
      });
      if (blocked) break;

      const rawPosts = await collectFromPage();
      for (const raw of rawPosts) {
        const key = typeof raw.postId === 'string' ? raw.postId : (typeof raw.postUrl === 'string' ? raw.postUrl : (typeof raw.text === 'string' ? raw.text.slice(0, 80) : null));
        if (key && !posts.has(key)) {
          posts.set(key, normalizeMbasicPost(raw));
        }
      }

      if (onProgress) onProgress({ scraped: posts.size, limit });

      targetUrl = posts.size < limit ? await findNextPage() : null;
      pageCount++;
    } catch (err) {
      const code = /** @type {Error & Record<string, unknown>} */ (err).code;
      if (code === 'FB_ONBOARDING_WALL') throw err;
      console.warn(`⚠️ mbasic posts page ${pageCount} failed for ${handle}: ${(err instanceof Error ? err.message : String(err))}`);
      break;
    }
  }

  return /** @type {Record<string, unknown>[]} */ (Array.from(posts.values()).slice(0, limit));
}

/**
 * Test whether the page contains a non-empty mbasic timeline.
 * Used by scrapeTweets to decide whether to fall back to desktop.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
async function hasMbasicPosts(page) {
  return page.evaluate(() => {
    const articles = document.querySelectorAll('article[data-ft*="top_level_post_id"]');
    if (articles.length === 0) return false;
    for (const a of articles) {
      const text = a.innerText?.trim() || '';
      if (text.length > 20) return true;
    }
    return false;
  });
}

// ============================================================================
// Posts Scraper
// ============================================================================

/**
 * Scrape recent posts from a Facebook profile or page
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} username - Handle, @handle, or full facebook.com URL
 * @param {FacebookOptions} options
 * @returns {Promise<Record<string, unknown>[]>} Normalized post array
 */
export async function scrapeTweets(page, username, options = {}) {
  const {
    limit = 50,
    onProgress,
    maxRetries = 10,
    // Injectable delay seam — defaults to human-like jitter, override (e.g. () => {})
    // in tests to keep the scroll loop fast and browser-free.
    delay = randomDelay,
    useMbasic = true,
  } = options;

  // Determine target URL: full URLs (groups, permalinks) go directly,
  // handles get normalized to profile URL.
  // Groups use mobile site - desktop doesn't load posts in headless mode.
  const isFullUrl = typeof username === 'string' && (username.startsWith('http://') || username.startsWith('https://'));
  const isGroup = isFullUrl && /\/groups\//.test(username);

  // Profiles/pages: try mbasic first (lightweight HTML, less bot detection).
  if (useMbasic && !isGroup) {
    const handle = isFullUrl ? username.replace(/^https?:\/\/(www\.|m\.|mbasic\.)?facebook\.com\//, '').replace(/\?.*$/, '') : normalizeHandle(username);
    const mbasicResult = await scrapeMbasicPosts(page, handle, { limit, onProgress, delay });
    if (mbasicResult && mbasicResult.length > 0) return mbasicResult;
  }

  let targetUrl;
  let isMobile = false;
  if (isGroup) {
    const cleanUrl = username.replace(/^https?:\/\/(www\.)?facebook\.com/, 'https://m.facebook.com');
    targetUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://m.facebook.com${cleanUrl}`;
    isMobile = true;
  } else {
    // Mobile site is more resilient in headless mode than the JS-heavy desktop site.
    if (isFullUrl) {
      targetUrl = username.replace(/^https?:\/\/(www\.|mbasic\.)?facebook\.com/i, 'https://m.facebook.com');
    } else {
      const handle = normalizeHandle(username);
      const profilePath = /^\d+$/.test(handle) ? `profile.php?id=${handle}` : handle;
      targetUrl = `${MOBILE_BASE}/${profilePath}`;
    }
    isMobile = true;
  }

  // Set mobile user agent whenever we hit the mobile domain - desktop UA gets desktop version even on mobile URL
  if (isMobile) {
    await applyMobileViewport(page);
  }

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await assertNoOnboardingWall(page, 'posts');
  await delay(2000, 4000);

  // Wait for actual post content to load (skip loading skeletons)
  const postSelector = isMobile ? 'div.m.displayed' : '[role="article"]';
  try {
    await page.waitForFunction((selector) => {
      const posts = document.querySelectorAll(selector);
      for (const p of posts) {
        if (p.innerText && p.innerText.length > 20 && !p.querySelector('[aria-label="Loading"]')) {
          return true;
        }
      }
      return posts.length === 0;
    }, { timeout: 15000 }, postSelector);
  } catch (_) {
    // Timeout - proceed anyway
  }

  const posts = new Map();
  let retries = 0;

  while (posts.size < limit && retries < maxRetries) {
    const rawPosts = /** @type {Record<string, unknown>[]} */ (await page.evaluate((useMobile) => {
      // Mobile groups use div.m.displayed, desktop uses [role="article"]
      const allElements = document.querySelectorAll(useMobile ? 'div.m.displayed' : '[role="article"]');
      return Array.from(allElements).map((post) => {
        if (post.querySelector('[aria-label="Loading"]')) return null;

        const fullText = post.innerText?.trim() || '';
        if (fullText.length < 20) return null;

        // Mobile: filter for real posts (have date patterns like "Jul 16", "2h", "3d")
        if (useMobile && !/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+|\d+\s*(min|h|hour|day|week)s?\s*ago/i.test(fullText)) {
          return null;
        }

        // Clean up text: remove trailing action buttons
        let text = fullText
          .replace(/\n(Like|Comment|Share|Send|Follow|See more|See translation|Write a public comment…)\s*$/i, '')
          .replace(/\n(Like|Comment|Share|Send|Follow|See more|See translation|Write a public comment…)\n.*$/i, '')
          .trim();
        text = text.substring(0, 1000);

        // Timestamp - mobile uses abbr with text like "Jul 16"
        const timeEl = post.querySelector('abbr, [aria-label*="ago"], [aria-label*="at"], time');
        const timestamp = timeEl?.textContent?.trim() || timeEl?.getAttribute('aria-label') || null;

        // Post URL - look in parent/sibling for mobile since links may be outside the div
        let linkEls = post.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
        if (useMobile && linkEls.length === 0) {
          // Try parent element for mobile
          const parent = post.parentElement;
          if (parent) linkEls = parent.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]');
        }
        const postLink = linkEls[0]?.getAttribute('href') || null;
        const postUrl = postLink
          ? postLink.startsWith('http') ? postLink : `https://www.facebook.com${postLink}`
          : null;

        // Engagement
        const allText = post.textContent || '';
        const likesMatch = allText.match(/([\d,.]+[KkMm]?)\s*(like|reaction)/i);
        const commentsMatch = allText.match(/([\d,.]+[KkMm]?)\s*comment/i);
        const likes = likesMatch ? likesMatch[1] : '0';
        const comments = commentsMatch ? commentsMatch[1] : '0';

        // Media
        const images = Array.from(post.querySelectorAll('img'))
          .map((img) => img.src)
          .filter((src) => src && !src.includes('static') && !src.includes('emoji') && !src.includes('sprite') && src.startsWith('http'));
        const hasVideo = !!post.querySelector('video');

        const id = postUrl || null;

        return { id, text, timestamp, likes, comments, postUrl, images, hasVideo };
      }).filter((p) => p && p.id);
    }, isMobile));

    const prevSize = posts.size;
    if (rawPosts) {
      for (const raw of rawPosts) {
        if (raw && raw.id && !posts.has(raw.id)) {
          posts.set(raw.id, normalizePost(raw));
        }
      }
    }

    if (onProgress) onProgress({ scraped: posts.size, limit });

    if (posts.size === prevSize) {
      retries++;
    } else {
      retries = 0;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
  }

  return /** @type {Record<string, unknown>[]} */ (Array.from(posts.values()).slice(0, limit));
}

/**
 * Best-effort DOM fallback for group posts on mobile.
 *
 * @param {import('puppeteer').Page} page
 * @param {string[]} _typenames - Passed by extractHydrationJson; ignored
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function extractGroupPostsFromDom(page, _typenames) {
  const raw = await page.evaluate(() => {
    const UI_HEADER_RE = /^(Public group|Join group|Invite|Videos|Announcements|Events|Write something|Photo|Feeling|Poll|Most relevant|SORT|Open app|About this group|Members|Group by)/i;

    // On mobile m.facebook.com, each post is a div.m.displayed (className="m displayed")
    // containing the full post text: "AuthorName\n • \nFollow\n[content]...".
    // We filter by checking for the "Follow" text (post header pattern).
    const allElements = document.querySelectorAll('div.m.displayed');

    /** @type {Record<string, unknown>[]} */
    const posts = [];
    const seen = new Set();

    for (const div of allElements) {
      if (div.querySelector('[aria-label="Loading"]')) continue;

      const fullText = div.innerText?.trim() || '';
      if (fullText.length < 30) continue;
      if (UI_HEADER_RE.test(fullText)) continue;

      // Each post contains "Follow" in its header. Skip non-post divs.
      const lines = fullText.split('\n').map((l) => l.trim()).filter(Boolean);
      const followIdx = lines.findIndex((l) => /^follow$/i.test(l));
      if (followIdx <= 0) continue;

      // Extract author — pattern: "AuthorName\n • \nFollow\n..."
      // "•" is on its own line between author and "Follow".
      // Author is at followIdx - 2 (or followIdx - 1 if no "•" separator).
      let authorLine = '';
      if (followIdx >= 2 && lines[followIdx - 1] === '•') {
        authorLine = lines[followIdx - 2];
      } else if (followIdx >= 1) {
        authorLine = lines[followIdx - 1].replace(/\s*•\s*$/, '').trim();
      }
      if (!authorLine || authorLine.length >= 100 || UI_HEADER_RE.test(authorLine)) continue;

      const author = authorLine;

      // Extract timestamp — line after "Follow" (e.g. "1h")
      let timestamp = null;
      if (followIdx + 1 < lines.length) {
        const tsLine = lines[followIdx + 1];
        const tsMatch = tsLine.match(/(\d+\s*(min|h|hour|day|week|d|w|mo|y)s?|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+)/i);
        if (tsMatch) timestamp = tsMatch[0];
      }

      // Post content starts after timestamp line
      let text = fullText;
      if (followIdx + 2 < lines.length) {
        text = lines.slice(followIdx + 2).join('\n');
      }

      // Clean up text: remove trailing UI buttons and private-use emoji markers.
      text = text
        .replace(/\n(Like|Comment|Share|Send|Follow|See more|See translation|Write a public comment…)\s*$/i, '')
        .replace(/\n(Like|Comment|Share|Send|Follow|See more|See translation|Write a public comment…)\n.*$/i, '')
        .replace(/[\u{F0000}-\u{FFFFF}]/gu, '')
        .trim();
      text = text.substring(0, 1000);

      if (text.length < 10) continue;

      // Dedupe by author + text prefix
      const dedupeKey = `${author}|${text.slice(0, 60)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Post URL - mobile may not have direct post links.
      const linkEls = div.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/permalink.php"], a[href*="story_fbid"], a[href*="/group/posts/"]');
      const postLink = linkEls[0]?.getAttribute('href') || null;
      const postUrl = postLink
        ? postLink.startsWith('http') ? postLink : `https://www.facebook.com${postLink}`
        : null;

      // Engagement
      const allPostText = div.textContent || '';
      const likesMatch = allPostText.match(/([\d,.]+[KkMm]?)\s*(like|reaction)/i);
      const commentsMatch = allPostText.match(/([\d,.]+[KkMm]?)\s*comment/i);
      const likes = likesMatch ? likesMatch[1] : '0';
      const comments = commentsMatch ? commentsMatch[1] : '0';

      // Media
      const images = Array.from(div.querySelectorAll('img'))
        .map((img) => img.src)
        .filter((src) => src && !src.includes('static') && !src.includes('emoji') && !src.includes('sprite') && src.startsWith('http'));
      const hasVideo = !!div.querySelector('video');

      const id = postUrl || dedupeKey;

      posts.push({ id, text, author, timestamp, likes, comments, postUrl, images, hasVideo });
    }

    return posts;
  });
  return /** @type {Record<string, unknown>[]} */ (raw);
}

/**
 * Scrape posts from a Facebook group (FR-59).
 * READ-ONLY scrape — NOT routed through runGuardedBatch.
 *
 * @param {import('puppeteer').Page} page - Puppeteer page (authenticated)
 * @param {string} groupUrl - facebook.com/groups/ URL
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>[] | { note: string, platform: 'facebook' }>}
 */
export async function scrapeFacebookGroupPosts(page, groupUrl, options = {}) {
  const {
    limit = 100,
    maxRetries = 8,
    maxScrolls = 50,
    delay = randomDelay,
    onProgress,
  } = options;

  // AC2: URL validation before navigation.
  assertFacebookUrlLocal(groupUrl, 'scrapeFacebookGroupPosts: groupUrl');

  if (!/facebook\.com\/groups\//i.test(groupUrl)) {
    throw new Error('❌ scrapeFacebookGroupPosts requires a facebook.com/groups/ URL');
  }

  // AC3: Mobile UA and viewport before navigation.
  await applyMobileViewport(page);

  // Groups often redirect to m.facebook.com; force mobile host up front.
  const mobileUrl = groupUrl.replace(/^https?:\/\/(www\.)?facebook\.com/, 'https://m.facebook.com');

  await page.goto(mobileUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await assertNoCheckpoint(page, 'group posts');
  await delay(2000, 4000);

  // Detect whether the group feed is accessible.
  let containerFound = false;
  try {
    await page.waitForSelector('div.m.displayed, [role="article"]', { timeout: 8000 });
    containerFound = true;
  } catch (_) {
    // Feed not accessible → restricted or login required.
  }

  if (!containerFound) {
    return {
      note: 'Facebook group posts are not accessible. The group may be private, membership may be required, or the group content is restricted.',
      platform: /** @type {'facebook'} */ ('facebook'),
    };
  }

  // AC8: Bounded scroll loop with deduplication.
  const posts = new Map();
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

    await assertNoCheckpoint(page, 'group posts');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
    scrolls++;
  }

  return /** @type {Record<string, unknown>[]} */ (Array.from(posts.values()).slice(0, limit));
}

/**
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function extractPostsFromDom(page) {
  const rawResults = await page.evaluate((nonProfile) => {
    const NON_PROFILE = new Set(nonProfile);
    const UI_TEXT_RE = /^(like|comment|share|reply|follow|see more|more|options|·)$/i;
    const articles = document.querySelectorAll('[role="article"]');
    return Array.from(articles).map((article) => {
      const textEls = article.querySelectorAll('[dir="auto"]');
      const texts = Array.from(textEls)
        .map((el) => {
          let t = (el.innerText || el.textContent || '').trim();
          t = t.replace(/\u034F/g, '');
          t = t.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').trim();
          return t;
        })
        .filter((t) => {
          if (!t || t.length < 10) return false;
          // Reject obvious UI chrome.
          if (UI_TEXT_RE.test(t)) return false;
          if (/^(Like|Comment|Share|Reply)\b/.test(t) && t.length < 80) return false;
          return !/[\u00B7\u2022]/.test(t);
        });

      const text = texts.reduce((best, t) => {
        if (!best) return t;
        const bestSpaces = (best.match(/\s+/g) || []).length;
        const tSpaces = (t.match(/\s+/g) || []).length;
        return tSpaces > bestSpaces ? t : best;
      }, '') || null;

      const allLinks = Array.from(article.querySelectorAll('a[href]'));
      let author = null;
      for (const a of allLinks) {
        const href = a.getAttribute('href') || '';
        if (!href.includes('facebook.com/') && !href.startsWith('/')) continue;
        if (href.includes('/posts/') || href.includes('/permalink/') || href.includes('story_fbid') || href.includes('/search/')) continue;
        if (href.includes('l.php') || href.includes('/l/')) continue;
        if (/(settings|help|about|privacy|terms|login|checkpoint|watch|marketplace|events)\b/i.test(href)) continue;
        const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        const idMatch = abs.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
        if (idMatch) { author = idMatch[1]; break; }
        const segMatch = abs.match(/facebook\.com\/([^/?&#]+)/i);
        if (segMatch && !NON_PROFILE.has(segMatch[1].toLowerCase())) { author = segMatch[1]; break; }
      }

      const timeEl = article.querySelector('abbr[data-utime], time[datetime]');
      let timestamp = timeEl?.getAttribute('data-utime') || timeEl?.getAttribute('datetime') || null;
      if (!timestamp) {
        const timeLink = allLinks.find((a) => {
          const text = (a.innerText || a.textContent || '').trim();
          if (!text || text.length > 30) return false;
          // Accept relative-time phrasing: "2h", "5 hrs", "Yesterday", "Jan 5", "1 day".
          return /\d+\s*(h|hr|hrs|hour|hours|d|day|days|w|week|weeks|m|min|mins|minute|minutes)\b|\b(yesterday|today|mon|tue|wed|thu|fri|sat|sun)\b/i.test(text);
        });
        const ariaLabel = timeLink?.getAttribute('aria-label') || timeLink?.querySelector('[aria-label]')?.getAttribute('aria-label');
        timestamp = ariaLabel || timeLink?.textContent?.trim() || null;
      }

      const postLinkEl = allLinks.find((a) => {
        const href = a.getAttribute('href') || '';
        return href.includes('/posts/') || href.includes('/permalink/') || href.includes('story_fbid');
      });
      const postHref = postLinkEl?.getAttribute('href') || null;
      const url = postHref
        ? postHref.startsWith('http') ? postHref : `https://www.facebook.com${postHref}`
        : null;

      const id = url || text?.slice(0, 60) || null;
      return { id, text, author, timestamp, url };
    }).filter((r) => r.id);
  }, NON_PROFILE_SEGMENTS);

  return /** @type {Record<string, unknown>[]} */ (rawResults);
}
