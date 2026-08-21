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

// Facebook scraper — profile.js
import { randomDelay, FACEBOOK_BASE, MBASIC_BASE } from './core.js';
import { normalizeHandle, normalizeProfile } from './normalize.js';


// ============================================================================
// Profile Scraper
// ============================================================================

/**
 * Scrape a Facebook profile or page via mbasic (lightweight HTML, less bot detection).
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} handle - Normalized handle
 * @returns {Promise<Record<string, unknown>|null>} Normalized profile, or null if mbasic is blocked/unusable
 */
async function scrapeMbasicProfile(page, handle) {
  const mbasicUrl = `${MBASIC_BASE}/${handle}?v=timeline`;

  try {
    await page.goto(mbasicUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1500, 3000);

    // mbasic sometimes returns a script/jsonp response or a login wall. Detect early.
    const ready = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const hasArticle = !!document.querySelector('article, div[role="main"], #root');
      const isLoginWall = /log\s*in\s*to\s*facebook|create\s*new\s*account/i.test(text) && text.length < 500;
      return { hasArticle, isLoginWall, text };
    });
    if (!ready.hasArticle || ready.isLoginWall) return null;

    const raw = /** @type {Record<string, unknown>} */ (await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const title = document.title?.trim() || '';

      // Name candidates: h1, first strong in main content, title minus "| Facebook"
      let name = null;
      const h1 = document.querySelector('h1');
      if (h1) name = h1.innerText?.trim() || null;
      if (!name) {
        const strong = document.querySelector('strong, div[role="main"] h3, div#root h3');
        if (strong) name = strong.innerText?.trim() || null;
      }
      if (!name && title) {
        name = title.replace(/\s*\|\s*Facebook\s*$/i, '').trim() || null;
      }

      // Avatar — mbasic profile picture is usually the first large img
      let avatar = null;
      const avatarImg = document.querySelector('img[alt*="profile"], img[src*="scontent"], a[href*="photo.php"] img, img.profPic');
      if (avatarImg) avatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || null;

      // Followers / likes
      let followers = null;
      const followerMatch = bodyText.match(/([\d,.]+[KkMmBb]?)\s*(followers?|people\s+follow|likes?)/i);
      if (followerMatch) followers = followerMatch[1];

      // Bio — paragraph in main area that isn't the name/followers
      let bio = null;
      const paragraphs = document.querySelectorAll('div[role="main"] p, div#root p, p');
      for (const p of paragraphs) {
        const txt = p.innerText?.trim();
        if (txt && txt !== name && !/\b(followers?|likes?)\b/i.test(txt)) {
          bio = txt;
          break;
        }
      }

      return { name, avatar, followers, bio, pageUrl: window.location.href };
    }));

    if (!raw.name && !raw.followers && !raw.bio) return null;

    return {
      name: raw.name || handle,
      username: handle,
      bio: raw.bio || null,
      followers: raw.followers || null,
      following: null,
      posts: null,
      profileUrl: raw.pageUrl,
      avatar: raw.avatar || null,
      platform: /** @type {'facebook'} */ ('facebook'),
    };
  } catch (err) {
    console.warn(`⚠️ mbasic profile failed for ${handle}: ${(err instanceof Error ? err.message : String(err))}`);
    return null;
  }
}

/**
 * Scrape a public Facebook profile or page
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} username - Handle (zuck), @handle, or full facebook.com URL
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>>} Normalized profile data
 */
export async function scrapeProfile(page, username, options = {}) {
  const { useMbasic = true } = options;
  const handle = normalizeHandle(username);

  // Try mbasic first — less bot detection, plain HTML.
  if (useMbasic) {
    const mbasicResult = await scrapeMbasicProfile(page, handle);
    if (mbasicResult) return mbasicResult;
  }

  // Fallback to desktop / m.facebook.com.
  const url = `${FACEBOOK_BASE}/${handle}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await randomDelay(2000, 4000);

  const raw = /** @type {Record<string, unknown>} */ (await page.evaluate(() => {
    /** @param {string} prop */
    const getMeta = (prop) => {
      const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
      return el?.getAttribute('content') || null;
    };

    // DOM fallback for followers — capture just the count (group 1), not the full match
    let domFollowers = null;
    const allText = document.body?.innerText || '';
    const followerMatch = allText.match(/([\d,.]+[KkMmBb]?)\s*followers?/i);
    if (followerMatch) domFollowers = followerMatch[1];

    return {
      ogTitle: getMeta('og:title'),
      ogDescription: getMeta('og:description'),
      ogImage: getMeta('og:image'),
      domFollowers,
      pageUrl: window.location.href,
    };
  }));

  // Detect blocked/non-existent profile — og:title missing or a Facebook login wall.
  const title = typeof raw.ogTitle === 'string' ? raw.ogTitle.trim() : '';
  const isLoginWall = !title
    || /^facebook$/i.test(title)
    || /^log\s+in\s+(to\s+)?facebook/i.test(title)
    || /^log\s*into\s+facebook/i.test(title)
    || /^facebook[\s–—-]+log/i.test(title);

  // Return partial data instead of throwing if we have some info
  if (isLoginWall) {
    return {
      name: handle,
      username: handle,
      bio: null,
      followers: raw.domFollowers || null,
      following: null,
      posts: null,
      profileUrl: url,
      platform: /** @type {'facebook'} */ ('facebook'),
      error: 'Profile requires authentication or is blocked',
    };
  }

  return normalizeProfile(raw, handle);
}
