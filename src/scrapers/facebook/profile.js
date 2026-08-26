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
import { randomDelay, MBASIC_BASE, FACEBOOK_BASE, assertNoOnboardingWall } from './core.js';
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
  // mbasic.facebook.com with a desktop UA usually redirects to the lightweight
  // www.facebook.com profile, where title / og:title contain the real name
  // and og:image contains the avatar after the page JS settles.
  const profilePath = /^\d+$/.test(handle) ? `profile.php?id=${handle}` : handle;
  const profileUrl = `${MBASIC_BASE}/${profilePath}${profilePath.includes('?') ? '&' : '?'}v=timeline`;

  try {
    // The login handshake already set a desktop UA; keep it so mbasic -> www.
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await assertNoOnboardingWall(page, 'mbasic profile');

    // Wait for the JS-rendered title / og:title to settle (max 15s).
    await page.waitForFunction(() => {
      const t = document.title?.trim() || '';
      const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const isGeneric = (/** @type {string} */ s) => /^\s*facebook\s*$/i.test(s) || /^\s*log\s*in/i.test(s) || /facebook\s*[-–—]?\s*log\s*in/i.test(s);
      return (!isGeneric(t) && t.length > 0) || (!isGeneric(og) && og.length > 0);
    }, { timeout: 15000 }).catch(() => {});

    await randomDelay(2000, 4000);

    // Detect login wall early (desktop 18+ interstitial, mobile login, etc.)
    const isLoginWall = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const hasLoginForm = !!document.querySelector('form[action*="login"], [data-testid="royal_login_form"]');
      const hasLoginIndicators = /log\s*in\s*(?:to\s*(?:view|facebook))?/i.test(text) &&
        (/forgot(?:ten)?\s*(?:account|password)/i.test(text) ||
         /create\s*new\s*account/i.test(text) ||
         /password/i.test(text));
      const isLoginInterstitial = /log\s*in\s*to\s*view/i.test(text) ||
        (text.length < 1500 && hasLoginIndicators);
      return hasLoginForm || isLoginInterstitial;
    });
    if (isLoginWall) return null;

    const raw = /** @type {Record<string, unknown>} */ (await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const pageTitle = document.title?.trim() || '';

      /** @param {string} prop */
      const getMeta = (prop) => {
        const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
        return el?.getAttribute('content') || null;
      };

      const isGibberishName = (/** @type {string | null} */ n) => {
        if (!n) return true;
        const trimmed = n.trim();
        if (!trimmed) return true;
        if (/^[\d,.$\s]+$/.test(trimmed)) return true; // pure number/count
        if (/\d+\s*(friends?|followers?|likes?)/i.test(trimmed)) return true; // counts
        if (/^(facebook|log\s*in|home|search|messages?|notifications?|menu|find friends|add friends|friend requests|suggested for you|people you may know|add friend|edit profile|this browser isn't supported|add to story)$/i.test(trimmed)) return true;
        return false;
      };

      // Name: prefer document.title, then og:title (if not generic).
      let name = null;
      const ogTitle = getMeta('og:title');
      for (const candidate of [pageTitle, ogTitle]) {
        if (typeof candidate !== 'string') continue;
        const stripped = candidate
          .replace(/\s*[-·—–]\s*\d[\d,.]*\s*(?:friends?|followers?|likes?)\s*$/i, '')
          .replace(/\s*\d[\d,.]*\s*(?:friends?|followers?|likes?)\s*$/i, '')
          .replace(/\s*\|\s*Facebook\s*$/i, '')
          .replace(/\s*-\s*Facebook\s*$/i, '')
          .trim();
        if (stripped && !isGibberishName(stripped)) {
          name = stripped;
          break;
        }
      }

      // h1 fallback
      if (isGibberishName(name)) {
        const h1 = document.querySelector('h1');
        const h1Text = h1?.innerText?.trim() || null;
        if (h1Text && !isGibberishName(h1Text)) name = h1Text;
      }

      // Main-content candidate fallback
      if (isGibberishName(name)) {
        const candidates = document.querySelectorAll('h2, strong, div[role="main"] h3, div#root h3, .actor, a[href*="/profile.php"]');
        for (const el of candidates) {
          const txt = el.innerText?.trim();
          if (txt && !isGibberishName(txt)) {
            name = txt;
            break;
          }
        }
      }

      // Avatar from Open Graph first, then DOM img.
      let avatar = getMeta('og:image');
      if (!avatar) {
        const avatarImg = document.querySelector('img[alt*="profile"], img[src*="scontent"], a[href*="photo.php"] img, img.profPic');
        if (avatarImg) avatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || null;
      }

      // Followers / likes / friends counts
      let followers = null;
      const followerMatch = bodyText.match(/([\d,.]+[KkMmBb]?)\s*(followers?|people\s+follow|likes?|friends?)/i);
      if (followerMatch) followers = followerMatch[1];

      // Bio from og:description (strip counts) or first paragraph
      let bio = null;
      const ogDescription = getMeta('og:description');
      if (typeof ogDescription === 'string') {
        bio = ogDescription.replace(/^[\d,.]+[KkMmBb]?\s*(followers?|friends?|people\s+follow|likes?)\b[^.]*[.·]/i, '').trim() || null;
      }
      if (!bio) {
        const paragraphs = document.querySelectorAll('div[role="main"] p, div#root p, p');
        for (const p of paragraphs) {
          const txt = p.innerText?.trim();
          if (txt && txt !== name && !/\b(followers?|likes?)\b/i.test(txt)) {
            bio = txt;
            break;
          }
        }
      }

      return { name, avatar, followers, bio, pageUrl: window.location.href };
    }));

    if (!raw.name && !raw.followers && !raw.bio && !raw.avatar) return null;

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
 * @deprecated Use `FacebookCrawler.start({ action: 'profile', args: { username } })` from `src/scrapers/social/facebook/crawler.js` instead.
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {string} username - Handle (zuck), @handle, or full facebook.com URL
 * @param {FacebookOptions} [options]
 * @returns {Promise<Record<string, unknown>>} Normalized profile data
 */
export async function scrapeProfile(page, username, options = {}) {
  const { useMbasic = true } = options;
  const handle = normalizeHandle(username);
  const profilePath = /^\d+$/.test(handle) ? `profile.php?id=${handle}` : handle;

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

  // Fallback to the desktop profile page and wait for the JS-rendered title.
  const fallbackUrl = `${FACEBOOK_BASE}/${profilePath}`;
  await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await assertNoOnboardingWall(page, 'desktop profile');

  try {
    await page.waitForFunction(() => {
      const t = document.title?.trim() || '';
      const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const isGeneric = (/** @type {string} */ s) => /^\s*facebook\s*$/i.test(s) || /^\s*log\s*in/i.test(s) || /facebook\s*[-–—]?\s*log\s*in/i.test(s);
      return (!isGeneric(t) && t.length > 0) || (!isGeneric(og) && og.length > 0);
    }, { timeout: 15000 });
  } catch { /* proceed with whatever we have */ }

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
    const followerMatch = allText.match(/([\d,.]+[KkMmBb]?)\s*(followers?|friends?)/i);
    if (followerMatch) domFollowers = followerMatch[1];

    let ogTitle = getMeta('og:title');
    const pageTitle = document.title?.trim() || '';
    const isGenericTitle = (/** @type {string} */ s) => /^\s*facebook\s*$/i.test(s) || /^\s*log\s*in/i.test(s) || /facebook\s*[-–—]?\s*log\s*in/i.test(s) || /^\s*edit\s*profile\s*$/i.test(s);
    if (isGenericTitle(/** @type {string} */ (ogTitle)) && !isGenericTitle(pageTitle) && pageTitle.length > 0) {
      ogTitle = pageTitle;
    }

    return {
      ogTitle,
      ogDescription: getMeta('og:description'),
      ogImage: getMeta('og:image'),
      domFollowers,
      pageUrl: window.location.href,
    };
  }));

  // Detect blocked/non-existent profile — og:title missing or a Facebook login wall.
  const title = typeof raw.ogTitle === 'string' ? raw.ogTitle.trim() : '';
  const isLoginWall = !title
    || /^\s*facebook\s*$/i.test(title)
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
