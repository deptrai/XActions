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
import { randomDelay, FACEBOOK_BASE, MBASIC_BASE, MOBILE_BASE, applyMobileViewport, assertNoOnboardingWall } from './core.js';
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
    await assertNoOnboardingWall(page, 'mbasic profile');
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
      const isGibberishName = (/** @type {string | null} */ n) => {
        if (!n) return true;
        const trimmed = n.trim();
        if (!trimmed) return true;
        if (/^[\d,.$\s]+$/.test(trimmed)) return true; // pure number/count
        if (/^(facebook|log\s*in|home|search|messages?|notifications?|menu|find friends|add friends|friend requests|suggested for you|people you may know|add friend)$/i.test(trimmed)) return true;
        return false;
      };

      let name = null;

      // 1. Title "Name | Facebook" is the most reliable on mbasic.
      const titleMatch = title.match(/^(.+?)\s*\|\s*Facebook\s*$/i);
      if (titleMatch && !isGibberishName(titleMatch[1])) {
        name = titleMatch[1].trim();
      }

      // 2. h1 (excluding generic labels)
      if (isGibberishName(name)) {
        const h1 = document.querySelector('h1');
        const h1Text = h1?.innerText?.trim() || null;
        if (h1Text && !isGibberishName(h1Text)) name = h1Text;
      }

      // 3. First meaningful strong/h3 in main content
      if (isGibberishName(name)) {
        const candidates = document.querySelectorAll('strong, div[role="main"] h3, div#root h3, .actor, a[href*="/profile.php"], a[href^="/"]');
        for (const el of candidates) {
          const txt = el.innerText?.trim();
          if (txt && !isGibberishName(txt)) {
            name = txt;
            break;
          }
        }
      }

      // 4. Fallback: strip "Facebook" from title (even if no pipe)
      if (isGibberishName(name) && title) {
        const stripped = title.replace(/\s*\|\s*Facebook\s*$/i, '').replace(/\s*-\s*Facebook\s*$/i, '').trim();
        if (!isGibberishName(stripped)) name = stripped;
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
    try {
      const mbasicResult = await scrapeMbasicProfile(page, handle);
      if (mbasicResult) return mbasicResult;
    } catch (err) {
      const code = /** @type {Error & Record<string, unknown>} */ (err).code;
      if (code === 'FB_ONBOARDING_WALL') throw err;
      console.warn(`⚠️ mbasic profile failed for ${handle}: ${(err instanceof Error ? err.message : String(err))}`);
    }
  }

  // Fallback to mobile facebook.com (lighter HTML, less bot detection than desktop).
  const url = `${MOBILE_BASE}/${handle}`;
  await applyMobileViewport(page);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await assertNoOnboardingWall(page, 'mobile profile');
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

  // A login wall on the authenticated fallback means the session is not usable for this view.
  if (isLoginWall) {
    throw Object.assign(
      new Error('❌ Facebook profile is blocked by a login wall. The account may be restricted, new, or stuck on the Find friends onboarding screen.'),
      { code: 'FB_ONBOARDING_WALL' }
    );
  }

  return normalizeProfile(raw, handle);
}
