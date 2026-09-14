// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * FacebookBrowserBridge — Browser-as-Signer adapter for Facebook.
 * Extracts live tokens (lsd, fb_dtsg, jazoest, spin, hsi, c_user) from a real Chrome browser
 * via CDP attach (Playwright by default) or auto-launched Chrome profile.
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { getAdapter } from '../../adapters/index.js';
import { launchBrowserWithCdp, launchChrome } from '../../../core/cdp-launcher.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../../core/error-envelope.js';
import { assertFacebookUrlLocal, NON_PROFILE_SEGMENTS } from './actions.js';
import { normalizeProfile, normalizeGroupMember, normalizeHandle } from './normalize.js';
import { normalizeFacebookProfile, normalizeFacebookGroupMember } from './normalize-profile.js';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Minimal proxy-resolver contract used by the bridge to pick a sticky proxy per account.
 * @typedef {Object} ProxyResolverLike
 * @property {(options?: Record<string, unknown>) => (string | Record<string, unknown> | null)} [getProxy]
 * @property {(accountId: string, requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getStickyProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getNext]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRotatingProxy]
 * @property {(requiresResidential?: boolean) => (string | Record<string, unknown> | null)} [getRoundRobinProxy]
 */

/**
 * Decode a cookie value when it may be URL-encoded.
 * @param {string} value
 * @returns {string}
 */
function safeDecodeCookie(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Script executed inside the browser page context to extract Facebook security tokens.
 * @returns {Record<string, any>}
 */
export function extractFacebookTokensScript() {
  /** @type {Record<string, any>} */
  const result = {};
  const html = document.documentElement ? document.documentElement.innerHTML : '';
  const win = /** @type {any} */ (typeof window !== 'undefined' ? window : {});

  // 1. lsd
  const lsdInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="lsd"]'));
  let lsd = lsdInput?.value || '';
  if (!lsd) {
    const lsdMatch =
      html.match(/\["LSD",\[\],\{"token":"([^"]+)"/) ||
      html.match(/"LSD",\[\],\{"token":"([^"]+)"/) ||
      html.match(/LSD\.token\s*=\s*"([^"]+)"/) ||
      html.match(/"token":"([^"]+)","type":"LSD"/) ||
      html.match(/name="lsd"\s+value="([^"]+)"/);
    lsd = lsdMatch ? lsdMatch[1] : '';
  }
  result.lsd = lsd;

  // 2. jazoest
  const jazoestInput = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="jazoest"]'));
  result.jazoest = jazoestInput?.value || '2953';

  // 3. fb_dtsg / dtsg
  const windowDtsg = win.DTSGInitialData?.token || win.DTSGInitData?.token || '';
  const dtsgMatch =
    html.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
    html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) ||
    html.match(/d\.token\s*=\s*"([^"]+)"/) ||
    html.match(/"DTSGInitialData".*?"token":"([^"]+)"/s);
  result.fb_dtsg = windowDtsg || (dtsgMatch ? dtsgMatch[1] : '');
  result.dtsg = result.fb_dtsg;

  // 4. spin_r / __spin_r
  const windowSpinR = win.__spin_r !== undefined ? Number(win.__spin_r) : null;
  const spinRMatch =
    html.match(/"__spin_r":(\d+)/) ||
    html.match(/window\.__spin_r\s*=\s*["']?(\d+)["']?/) ||
    html.match(/"site_data":\{"__spin_r":(\d+)/);
  result.spin_r = windowSpinR !== null && !Number.isNaN(windowSpinR) ? windowSpinR : (spinRMatch ? Number(spinRMatch[1]) : 1016839210);

  // 5. spin_t / __spin_t
  const windowSpinT = win.__spin_t !== undefined ? Number(win.__spin_t) : null;
  const spinTMatch =
    html.match(/"__spin_t":(\d+)/) ||
    html.match(/window\.__spin_t\s*=\s*["']?(\d+)["']?/);
  result.spin_t = windowSpinT !== null && !Number.isNaN(windowSpinT) ? windowSpinT : (spinTMatch ? Number(spinTMatch[1]) : Math.floor(Date.now() / 1000));

  // 6. hsi / __hsi
  const windowHsi = win.__hsi ? String(win.__hsi) : '';
  const hsiMatch =
    html.match(/"__hsi":"([^"]+)"/) ||
    html.match(/window\.__hsi\s*=\s*["']([^"']+)["']/);
  result.hsi = windowHsi || (hsiMatch ? hsiMatch[1] : '');

  // 7. __rev
  const windowRev = win.__rev ? String(win.__rev) : '';
  const revMatch =
    html.match(/window\.__rev\s*=\s*["']([^"']+)["']/) ||
    html.match(/"__rev":(\d+)/) ||
    html.match(/window\.__rev\s*=\s*(\d+)/) ||
    html.match(/"server_revision":(\d+)/);
  result.__rev = windowRev || (revMatch ? revMatch[1] : '1016839210');

  // 8. c_user / __user
  const cookieUserMatch = document.cookie ? document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/) : null;
  const scriptUserMatch =
    html.match(/["']?USER_ID["']?\s*:\s*(?:"(\d+)"|(\d+))/) ||
    html.match(/["']?actor_id["']?\s*:\s*(?:"(\d+)"|(\d+))/) ||
    html.match(/["']?ACCOUNT_ID["']?\s*:\s*(?:"(\d+)"|(\d+))/);
  result.c_user = cookieUserMatch ? cookieUserMatch[1] : (scriptUserMatch ? (scriptUserMatch[1] || scriptUserMatch[2]) : '');

  // 9. Anti-bot/anti-abuse fields when exposed on window or in HTML.
  result.__dyn = win.__dyn || (html.match(/"__dyn":"([^"]+)"/)?.[1] || '');
  result.__csr = win.__csr || (html.match(/"__csr":"([^"]+)"/)?.[1] || '');
  result.__hs = win.__hs || (html.match(/"__hs":"([^"]+)"/)?.[1] || '');
  result.__hsdp = win.__hsdp || (html.match(/"__hsdp":"([^"]+)"/)?.[1] || '');
  result.__hblp = win.__hblp || (html.match(/"__hblp":"([^"]+)"/)?.[1] || '');
  result.__s = win.__s || (html.match(/"__s":"([^"]+)"/)?.[1] || '');
  result.dpr = typeof win.devicePixelRatio === 'number' ? String(win.devicePixelRatio) : (html.match(/"dpr":(\d+(?:\.\d+)?)/)?.[1] || '1');
  result.x_fb_lsd = result.lsd;
  result.fb_api_req_friendly_name = win.fb_api_req_friendly_name || (html.match(/"fb_api_req_friendly_name":"([^"]+)"/)?.[1] || '');

  return result;
}

/**
 * Parse a human-readable count (e.g. "12.5K", "3M", "1,234") into a number.
 * @param {unknown} input
 * @returns {number}
 */
function parseHumanCount(input) {
  if (input == null) return 0;
  if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  const str = String(input).trim();
  if (!str) return 0;
  const m = str.match(/^([\d,.]+)\s*([KkMmBb])?$/);
  if (!m) return 0;
  let value = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(value)) return 0;
  const suffix = m[2]?.toUpperCase();
  if (suffix === 'K') value *= 1_000;
  if (suffix === 'M') value *= 1_000_000;
  if (suffix === 'B') value *= 1_000_000_000;
  return Math.max(0, Math.floor(value));
}

/**
 * Resolve a Facebook handle input to a clean handle/path suitable for mbasic.
 * @param {string} input
 * @returns {string}
 */
function resolveProfileHandle(input) {
  if (/^\d+$/.test(input)) return input;
  return normalizeHandle(input);
}

/**
 * Extract profile fields from a loaded mbasic/desktop page.
 * This is a standalone function so it can be passed to adapter.evaluate().
 * @param {string} handle
 * @returns {Record<string, any> | null}
 */
function extractMbasicProfileFromDom(handle) {
  const body = document.body;
  if (!body) return null;

  const bodyText = (body.textContent || body.innerText || '').trim();
  const pageTitle = (document.title || '').trim();

  const getMeta = (/** @type {string} */ prop) => {
    const el = document.querySelector('meta[property="' + prop + '"], meta[name="' + prop + '"]');
    return el?.getAttribute('content') || null;
  };

  const isGibberishName = (/** @type {string | null | undefined} */ n) => {
    if (!n) return true;
    const trimmed = n.trim();
    if (!trimmed) return true;
    if (/^[\d,.$\s]+$/.test(trimmed)) return true;
    if (/\d+\s*(friends?|followers?|likes?)/i.test(trimmed)) return true;
    if (/^(facebook|log\s*in|home|search|messages?|notifications?|menu|find friends|add friends|friend requests|suggested for you|people you may know|add friend|edit profile|this browser isn\'t supported|add to story)$/i.test(trimmed)) return true;
    return false;
  };

  // Detect a login wall before extracting content.
  const hasLoginForm = !!document.querySelector('form[action*="login"], [data-testid="royal_login_form"]');
  const hasLoginIndicators = /log\s*in\s*(?:to\s*(?:view|facebook))?/i.test(bodyText) &&
    (/forgot(?:ten)?\s*(?:account|password)/i.test(bodyText) ||
     /create\s*new\s*account/i.test(bodyText) ||
     /password/i.test(bodyText));
  if (hasLoginForm || hasLoginIndicators || /^log\s*in\s*to\s*view/i.test(bodyText)) {
    // On a clean/residential IP, Facebook renders public profile content
    // alongside a passive login banner (og:title/og:description still present).
    // Only bail when the wall actually suppresses content — no usable og:title.
    const ogTitleProbe = document.querySelector('meta[property="og:title"], meta[name="og:title"]')?.getAttribute('content') || null;
    // Strip the Facebook brand suffix before checking — "Mark Zuckerberg | Facebook"
    // is a valid title, but "Facebook" or "Log in to Facebook" alone is not.
    const strippedOgTitle = typeof ogTitleProbe === 'string'
      ? ogTitleProbe.replace(/\s*[|\-–—]\s*Facebook\s*$/i, '').replace(/\s*Facebook\s*$/i, '').trim()
      : '';
    const hasUsableOg = Boolean(strippedOgTitle) && !/^(log\s*in|sign\s*up)/i.test(strippedOgTitle);
    if (!hasUsableOg) {
      return null;
    }
  }

  // Name: prefer document.title, then og:title, then h1, then other headings.
  let name = null;
  const ogTitle = getMeta('og:title');
  for (const candidate of [pageTitle, ogTitle]) {
    if (typeof candidate !== 'string') continue;
    const stripped = candidate
      .replace(/\s*[-\u00b7\u2014\u2013]\s*\d[\d,.]*\s*(?:friends?|followers?|likes?)\s*$/i, '')
      .replace(/\s*\d[\d,.]*\s*(?:friends?|followers?|likes?)\s*$/i, '')
      .replace(/\s*\|\s*Facebook\s*$/i, '')
      .replace(/\s*-\s*Facebook\s*$/i, '')
      .trim();
    if (stripped && !isGibberishName(stripped)) {
      name = stripped;
      break;
    }
  }

  if (isGibberishName(name)) {
    const h1 = document.querySelector('h1');
    const h1Text = h1?.textContent?.trim() || h1?.innerText?.trim() || null;
    if (h1Text && !isGibberishName(h1Text)) name = h1Text;
  }

  if (isGibberishName(name)) {
    const candidates = document.querySelectorAll('h2, strong, div[role="main"] h3, div#root h3, .actor, a[href*="/profile.php"]');
    for (const el of candidates) {
      const txt = el.textContent?.trim() || el.innerText?.trim();
      if (txt && !isGibberishName(txt)) {
        name = txt;
        break;
      }
    }
  }

  // Avatar from Open Graph first, then DOM img fallbacks.
  let avatar = getMeta('og:image');
  if (!avatar) {
    const avatarImg = document.querySelector('img[alt*="profile"], img[src*="scontent"], a[href*="photo.php"] img, img.profPic');
    if (avatarImg) {
      avatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || null;
    }
  }

  // Followers / likes / friends counts from body text.
  let followers = null;
  const followerMatch = bodyText.match(/([\d,.]+[KkMmBb]?)\s*(followers?|people\s+follow|likes?|friends?)/i);
  if (followerMatch) followers = followerMatch[1];

  // Bio from og:description (strip counts) or first paragraph.
  let bio = null;
  const ogDescription = getMeta('og:description');
  if (typeof ogDescription === 'string') {
    bio = ogDescription.replace(/^[\d,.]+[KkMmBb]?\s*(followers?|friends?|people\s+follow|likes?)\b[^.]*[.\u00b7]/i, '').trim() || null;
  }
  if (!bio) {
    const paragraphs = document.querySelectorAll('div[role="main"] p, div#root p, p');
    for (const p of paragraphs) {
      const txt = p.textContent?.trim() || p.innerText?.trim();
      if (txt && txt !== name && !/\b(followers?|likes?)\b/i.test(txt)) {
        bio = txt;
        break;
      }
    }
  }

  // Numeric user id from the final URL for profile.php?id= inputs.
  const pageUrl = window.location.href;
  let userId = null;
  const idMatch = pageUrl.match(/[?&]id=(\d+)/);
  if (idMatch) userId = idMatch[1];

  // Return raw meta/DOM fields so the legacy normalizeProfile can parse them.
  return {
    ogTitle: name || pageTitle,
    ogDescription: typeof ogDescription === 'string' ? ogDescription : (bio || ''),
    ogImage: avatar,
    domFollowers: followers,
    pageUrl,
    userId,
  };
}

/**
 * Extract public page/timeline posts from a loaded desktop page.
 * Renders `div[role="article"]` feed units on a public page/profile for guests on
 * clean IPs. This is a standalone function so it can be passed to adapter.evaluate().
 * @param {string} pageId
 * @param {number} [limit=20]
 * @returns {Record<string, any>[]}
 */
function extractPagePostsFromDom(pageId, limit = 20) {
  const results = [];
  const seen = new Set();
  const articles = document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="ProfileTimeline"]');

  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

  for (const art of articles) {
    if (results.length >= limit) break;
    // Pull the dominant text block; drop nav/buttons noise.
    const textEl = art.querySelector('div[data-ad-preview="message"], div[dir="auto"], span[dir="auto"]') || art;
    const text = clean(textEl.innerText || textEl.textContent).slice(0, 2000);
    if (!text || text.length < 10) continue;
    // Skip pure-UI fragments (Like/Comment/Share rails, headers).
    if (/^(like|comment|share|follow|see more|write a comment)\b/i.test(text) && text.length < 60) continue;

    // Permalink for the post (numeric id / pfbid / story_fbid).
    let postUrl = null;
    const links = art.querySelectorAll('a[href]');
    for (const a of links) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/(\/posts\/[0-9]+|\/permalink\/[0-9]+|pfbid[A-Za-z0-9_-]+|story_fbid=[0-9]+|\/videos\/[0-9]+|\/photo[^"'\s]*fbid=[0-9]+)/);
      if (m) { postUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href; break; }
    }
    const externalId = postUrl
      ? (postUrl.match(/pfbid[A-Za-z0-9_-]+|[0-9]{6,}/)?.[0] || `${pageId}_${results.length}`)
      : `${pageId}_${results.length}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    // Author from the first profile link in the article header.
    let authorName = pageId;
    const authorLink = art.querySelector('a[href*="/"][role="link"] strong, h3 a, h4 a, a[aria-hidden="false"] strong');
    if (authorLink) authorName = clean(authorLink.textContent) || pageId;

    results.push({
      externalId,
      content: text,
      authorName,
      authorId: pageId,
      postUrl: postUrl || ('https://www.facebook.com/' + pageId),
    });
  }
  return results;
}

/**
 * Extract comments from a loaded post permalink page (desktop guest view).
 * Reads top-level comment list items. Standalone for adapter.evaluate().
 * @param {number} [limit=50]
 * @returns {Record<string, any>[]}
 */
function extractCommentsFromDom(limit = 50) {
  const results = [];
  const seen = new Set();
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const isNoise = (t) => /^(like|reply|share|view all|view more|most relevant|write a comment|top comments|all reactions|see more|follow|comments?|log in|forgotten account)\b/i.test(t) ||
    /^\d+[wsmhd]\s*$/i.test(t) || /^(like|comment|share)\.?$/i.test(t);

  // On a public permalink, each comment is a nested role="article" inside the
  // post's comment list — distinct from the single top-level post article.
  // Instead of blindly skipping articles[0], skip articles that contain a
  // large body of text (the post itself typically has more than 200 chars of
  // primary content) or that have no profile anchor — heuristics that hold
  // whether or not the post is rendered as the first article.
  const articles = [...document.querySelectorAll('div[role="article"]')];
  const commentArts = articles.filter((art, idx) => {
    if (idx === 0) {
      // Heuristic: the post article usually contains a large text block AND
      // no nested comment-like structure. If it's small and has a profile
      // link it might actually be a comment — don't skip it blindly.
      const blocks = art.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      const hasLargeBody = [...blocks].some(b => (b.innerText || b.textContent || '').trim().length > 200);
      const hasProfileLink = Boolean(art.querySelector('a[href*="facebook.com/"]:not([href*="photo"]):not([href*="/posts/"])'));
      return !(hasLargeBody && !hasProfileLink);
    }
    return true;
  });

  for (const art of commentArts) {
    if (results.length >= limit) break;
    // Author: first profile anchor (to /user/ or a vanity profile, not photo/post links).
    let authorName = null;
    const authorLink = art.querySelector('a[href*="/user/"], a[href*="facebook.com/"]:not([href*="photo"]):not([href*="/posts/"])');
    if (authorLink) {
      const cand = clean(authorLink.textContent);
      if (cand && !isNoise(cand) && cand.length < 80 && !/^\d+[wsmhd]/.test(cand)) authorName = cand;
    }

    // Body: longest meaningful text block that isn't the author or an action rail.
    let bodyText = '';
    const blocks = art.querySelectorAll('div[dir="auto"], span[dir="auto"], div[lang]');
    for (const b of blocks) {
      const t = clean(b.innerText || b.textContent);
      if (!t || t.length < 3 || isNoise(t) || t === authorName) continue;
      if (/^\d+[wsmhd]\b/.test(t) && t.length < 30) continue;
      if (t.length > bodyText.length) bodyText = t;
    }
    if (!bodyText || bodyText.length < 3) continue;

    const key = (authorName || 'anon') + '|' + bodyText.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);

    // Stable ID from content hash so re-scrapes produce the same comment ids
    // (idempotent upserts). Falls back to index if hash is unavailable.
    const hashInput = (authorName || '') + '|' + bodyText.slice(0, 120);
    let stableId = 'c_' + results.length;
    try {
      let h = 0;
      for (let i = 0; i < hashInput.length; i++) { h = (Math.imul(31, h) + hashInput.charCodeAt(i)) | 0; }
      stableId = 'c_' + Math.abs(h).toString(36);
    } catch {}
    results.push({
      externalId: stableId,
      content: bodyText.slice(0, 2000),
      authorName: authorName || 'Facebook user',
      authorId: null,
    });
  }
  return results;
}

/**
 * Extract public group feed posts from a loaded group page (desktop guest view).
 * Public groups render Discussion posts for guests on clean IPs.
 * @param {string} groupId
 * @param {number} [limit=20]
 * @returns {Record<string, any>[]}
 */
function extractGroupPostsFromDom(groupId, limit = 20) {
  const results = [];
  const seen = new Set();
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const articles = document.querySelectorAll('div[role="article"], div[data-pagelet*="GroupInlineFeed"], div[data-pagelet*="FeedUnit"]');

  for (const art of articles) {
    if (results.length >= limit) break;
    const textEl = art.querySelector('div[data-ad-preview="message"], div[dir="auto"], span[dir="auto"]') || art;
    const text = clean(textEl.innerText || textEl.textContent).slice(0, 2000);
    if (!text || text.length < 10) continue;
    if (/^(like|comment|share|join group|write something|see more|about this group|public group|featured|recent media)\b/i.test(text) && text.length < 80) continue;

    let postUrl = null;
    for (const a of art.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (/(\/posts\/[0-9]+|\/permalink\/[0-9]+|pfbid[A-Za-z0-9_-]+|story_fbid=[0-9]+|groups\/[^/]+\/permalink)/.test(href)) {
        postUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href; break;
      }
    }
    const externalId = postUrl ? (postUrl.match(/pfbid[A-Za-z0-9_-]+|[0-9]{6,}/)?.[0] || `${groupId}_${results.length}`) : `${groupId}_${results.length}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    let authorName = 'Group member';
    const authorEl = art.querySelector('h3 a, h4 a, a[role="link"] strong, strong a');
    if (authorEl) authorName = clean(authorEl.textContent) || authorName;

    results.push({ externalId, content: text, authorName, authorId: null, postUrl: postUrl || `https://www.facebook.com/groups/${groupId}` });
  }
  return results;
}

/**
 * Extract Marketplace listings from a loaded marketplace search page (desktop guest view).
 * Marketplace renders listings for guests on clean IPs.
 * @param {number} [limit=50]
 * @returns {Record<string, any>[]}
 */
function extractMarketplaceFromDom(limit = 50) {
  const results = [];
  const seen = new Set();
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  // Listings are links to /marketplace/item/<id> with price + title + location.
  const cards = document.querySelectorAll('a[href*="/marketplace/item/"]');
  for (const card of cards) {
    if (results.length >= limit) break;
    const href = card.getAttribute('href') || '';
    const idM = href.match(/item\/(\d+)/);
    const externalId = idM ? idM[1] : `mk_${results.length}`;
    if (seen.has(externalId)) continue;
    const text = clean(card.innerText || card.textContent);
    if (!text) continue;
    // Split into lines: [price, title, location] typically.
    const lines = text.split(/\s{2,}|\n/).map(clean).filter(Boolean);
    const price = lines.find(l => /^[₫$€£]|^\d[\d,.]*\s*(₫|vnd|đ|USD)/i.test(l)) || null;
    const title = lines.find(l => l !== price && !/^\d+\s*km|km away|·/.test(l) && l.length > 3) || null;
    const location = lines.find(l => /,|\d+\s*km|Ho Chi Minh|Hanoi|Vietnam/i.test(l) && l !== title) || null;
    if (!title && !price) continue;
    seen.add(externalId);
    results.push({
      externalId,
      content: [price, title, location].filter(Boolean).join(' — ') || text.slice(0, 200),
      title: title || '',
      price: price || '',
      location: location || '',
      postUrl: href.startsWith('http') ? href : 'https://www.facebook.com' + href,
    });
  }
  return results;
}

/**
 * Extract follower/following names from a loaded /followers or /following page.
 * Guests on clean IPs see a name list for public profiles.
 * @param {string} ownerHandle
 * @param {number} [limit=50]
 * @returns {Record<string, any>[]}
 */
function extractFollowListFromDom(ownerHandle, limit = 50) {
  const results = [];
  const seen = new Set();
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  // Follower entries are list items / anchors to profile paths.
  const links = document.querySelectorAll('a[href]');
  for (const a of links) {
    if (results.length >= limit) break;
    const href = a.getAttribute('href') || '';
    if (!/^https?:\/\/(www\.)?facebook\.com\/|^\/[A-Za-z0-9.]+\/?$/.test(href)) continue;
    if (/followers|following|friends|photo|posts|videos|reels|about|more|login|signup|help|privacy|terms|recover|watch|marketplace|groups|pages|events|gaming|settings|bookmarks/i.test(href)) continue;
    const name = clean(a.textContent);
    if (!name || name.length < 2 || name.length > 80) continue;
    if (/^(followers?|following|more|see all|log in|sign up|friends?|posts?|about|reels?|photos?|videos?|forgotten account|forgot account|create new account|find friends|help centre|help center)$/i.test(name)) continue;
    const handle = href.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').replace(/^\/+|\/+$/g, '').split('?')[0] || null;
    if (!handle || /^(login|recover|help|signup|watch|marketplace|groups|pages|events|gaming|settings|bookmarks|privacy|terms|policies)/i.test(handle)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    results.push({ externalId: handle || `u_${results.length}`, authorName: name, handle, postUrl: href.startsWith('http') ? href : 'https://www.facebook.com' + href });
  }
  return results;
}

/**
 * Extract group member links from a loaded group /members page.
 * This is a standalone function so it can be passed to adapter.evaluate().
 * @returns {Record<string, any>[]}
 */
function extractGroupMembersFromDom() {
  /** @type {Record<string, any>[]} */
  const results = [];
  const seen = new Set();
  const links = document.querySelectorAll('a[href*="/groups/"][href*="/user/"]');
  for (const a of links) {
    const href = a.getAttribute('href') || '';
    const name = a.textContent?.trim() || a.innerText?.trim() || '';
    if (!name || name.length <= 1 || name.length >= 100) continue;
    let fullUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href;
    fullUrl = fullUrl.split('?')[0].replace(/\/$/, '');
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    const parts = fullUrl.split('/').filter(Boolean);
    const userId = parts[parts.length - 1] || '';
    results.push({
      id: userId,
      name,
      username: userId,
      profileUrl: fullUrl,
      platform: 'facebook',
    });
  }
  return results;
}

export class FacebookBrowserBridge {
  /** @type {string} */
  baseUrl;

  /** @type {import('../../adapters/base.js').BaseAdapter | null} */
  adapter;

  /** @type {string | null} */
  cdpUrl;

  /** @type {boolean} */
  launchChrome;

  /** @type {string} */
  adapterName;

  /** @type {boolean} */
  headless;

  /** @type {string | null} */
  userDataDir;

  /** @type {string | null} */
  profileDir;

  /** @type {any} */
  proxy;

  /** @type {ProxyResolverLike | null} */
  proxyPool = null;

  /** @type {ProxyResolverLike | null} */
  proxyProvider = null;

  /** @type {string[]} */
  extraArgs = [];

  /** @type {any} */
  #browser = null;

  /** @type {Function | null} */
  #chromeKiller = null;

  /** @type {boolean} */
  #isFirstCall = true;

  /** @type {Promise<any> | null} */
  #launchPromise = null;

  /**
   * @param {Object} [options={}]
   * @param {string} [options.baseUrl='https://www.facebook.com']
   * @param {import('../../adapters/base.js').BaseAdapter} [options.adapter]
   * @param {string} [options.cdpUrl]
   * @param {boolean} [options.launchChrome=false]
   * @param {string} [options.adapterName]
   * @param {boolean} [options.headless=true]
   * @param {string} [options.userDataDir]
   * @param {string} [options.profileDir]
   * @param {any} [options.proxy]
   * @param {ProxyResolverLike | null} [options.proxyPool]
   * @param {ProxyResolverLike | null} [options.proxyProvider]
   * @param {string[]} [options.extraArgs]
   * @param {boolean} [options.requiresResidential=false]
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : 'https://www.facebook.com';
    this.adapterName = options.adapterName || process.env.XACTIONS_SCRAPER_ADAPTER || 'playwright';
    this.adapter = options.adapter || null;
    this.cdpUrl = options.cdpUrl || null;
    this.launchChrome = Boolean(options.launchChrome);
    this.headless = options.headless ?? true;
    this.userDataDir = options.userDataDir || null;
    this.profileDir = options.profileDir || null;
    this.proxy = options.proxy || null;
    this.proxyPool = options.proxyPool || null;
    this.proxyProvider = options.proxyProvider || null;
    this.extraArgs = options.extraArgs || [];
    this.requiresResidential = Boolean(options.requiresResidential);
  }

  /**
   * Initialize bridge and resolve adapter.
   * @returns {Promise<this>}
   */
  async init() {
    await this.#resolveAdapter();
    return this;
  }

  /**
   * Resolve adapter instance lazily.
   * @returns {Promise<import('../../adapters/base.js').BaseAdapter>}
   */
  async #resolveAdapter() {
    if (this.adapter) return this.adapter;
    this.adapter = await getAdapter(this.adapterName);
    return this.adapter;
  }

  /**
   * Deterministic user data dir per accountId / c_user.
   * @param {string} accountId
   * @returns {string}
   */
  #resolveUserDataDir(accountId) {
    if (this.userDataDir) return this.userDataDir;
    if (this.profileDir) return this.profileDir;
    const cleanId = String(accountId || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(process.cwd(), '.data', 'facebook-profiles', cleanId);
  }

  /**
   * Parse raw cookie string or record array into standard adapter cookies format.
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} cookies
   * @returns {Array<{ name: string, value: string, domain: string, path: string }>}
   */
  #parseCookies(cookies) {
    let hostname = 'facebook.com';
    try {
      hostname = new URL(this.baseUrl).hostname;
    } catch {}

    const result = [];
    if (typeof cookies === 'string') {
      const pairs = cookies.split(';');
      for (const pair of pairs) {
        const idx = pair.indexOf('=');
        if (idx !== -1) {
          const name = pair.slice(0, idx).trim();
          const value = pair.slice(idx + 1).trim();
          if (name) {
            result.push({ name, value, domain: hostname, path: '/' });
          }
        }
      }
    } else if (Array.isArray(cookies)) {
      for (const c of cookies) {
        if (!c || typeof c !== 'object') continue;
        const item = /** @type {any} */ (c);
        result.push({
          name: item.name,
          value: item.value,
          domain: item.domain || hostname,
          path: item.path || '/',
        });
      }
    } else if (cookies && typeof cookies === 'object') {
      for (const [k, v] of Object.entries(cookies)) {
        result.push({ name: k, value: String(v), domain: hostname, path: '/' });
      }
    }
    return result;
  }

  /**
   * Resolve the sticky proxy for an account using proxyProvider/proxyPool if present,
   * falling back to the explicit `proxy` option.
   * @param {string} accountId
   * @param {boolean} [requiresResidential=false]
   * @returns {any}
   */
  #resolveProxy(accountId, requiresResidential = false) {
    if (this.proxyProvider && typeof this.proxyProvider.getProxy === 'function') {
      try {
        const p = this.proxyProvider.getProxy({ accountId, requiresResidential });
        if (p) return p;
      } catch {
        // fallthrough
      }
    }
    if (this.proxyPool) {
      if (typeof this.proxyPool.getStickyProxy === 'function') {
        try {
          const p = this.proxyPool.getStickyProxy(accountId, requiresResidential);
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getNext === 'function') {
        try {
          const p = this.proxyPool.getNext(requiresResidential);
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getRotatingProxy === 'function') {
        try {
          const p = this.proxyPool.getRotatingProxy(requiresResidential);
          if (p) return p;
        } catch {}
      } else if (typeof this.proxyPool.getRoundRobinProxy === 'function') {
        try {
          const p = this.proxyPool.getRoundRobinProxy(requiresResidential);
          if (p) return p;
        } catch {}
      }
    }
    return this.proxy;
  }

  /**
   * Ensure browser connection is ready with mutex protection against parallel launches.
   * @param {string} accountId
   * @param {boolean} [requiresResidential=false]
   * @returns {Promise<any>}
   */
  async #getBrowser(accountId, requiresResidential = false) {
    if (this.#browser) {
      return this.#browser;
    }
    if (this.#launchPromise) {
      return this.#launchPromise;
    }

    this.#launchPromise = (async () => {
      try {
        const effectiveUserDataDir = this.#resolveUserDataDir(accountId);
        try {
          fs.mkdirSync(effectiveUserDataDir, { recursive: true });
        } catch {}
        const adapter = await this.#resolveAdapter();
        const proxy = this.#resolveProxy(accountId, requiresResidential);

        if (this.cdpUrl) {
          this.#browser = await launchBrowserWithCdp(this.cdpUrl, {
            adapter,
            preserveProfile: true,
          });
          return this.#browser;
        }

        if (this.launchChrome) {
          const launched = await launchChrome({
            userDataDir: effectiveUserDataDir,
            headless: this.headless,
            proxy,
            extraArgs: this.extraArgs,
          });
          this.#chromeKiller = launched.kill;
          this.#browser = await launchBrowserWithCdp(launched.cdpUrl, {
            adapter,
            preserveProfile: true,
          });
          return this.#browser;
        }

        // Default: launch fresh browser instance via adapter
        this.#browser = await adapter.launch(/** @type {any} */ ({
          headless: this.headless,
          userDataDir: effectiveUserDataDir,
          proxy,
          extraArgs: this.extraArgs,
        }));
        return this.#browser;
      } finally {
        this.#launchPromise = null;
      }
    })();

    return this.#launchPromise;
  }

  /**
   * Extract Facebook tokens from the live page context.
   * Creates a fresh BrowserContext per call (Playwright) so different accounts never share
   * cookies. Callers using `XACTIONS_SCRAPER_ADAPTER=puppeteer` must use one bridge per account
   * because the current PuppeteerAdapter does not create incognito contexts.
   * @param {string} [accountId='fb-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [cookies='']
   * @returns {Promise<Record<string, any>>}
   */
  async extractTokens(accountId = 'fb-guest', cookies = '') {
    const parsedCookies = this.#parseCookies(cookies);
    const rawCUser = parsedCookies.find((c) => c.name === 'c_user')?.value || '';
    const parsedCUser = safeDecodeCookie(rawCUser);
    const effectiveAccountId = parsedCUser || accountId;

    let attempt = 0;
    const maxAttempts = 2;
    let lastError = null;

    while (attempt < maxAttempts) {
      attempt++;
      let page = null;
      let timeoutId = null;
      try {
        const adapter = await this.#resolveAdapter();
        const browser = await this.#getBrowser(effectiveAccountId);
        // Use a fresh context per extraction to prevent account cookie sharing (AC-6).
        page = await adapter.newPage(browser, { preserveProfile: false });

        if (parsedCookies.length > 0) {
          await adapter.setCookies(page, parsedCookies);
        }

        const navTimeout = this.#isFirstCall ? 30000 : 15000;
        await adapter.goto(page, `${this.baseUrl}/`, {
          waitUntil: 'networkidle',
          timeout: navTimeout,
        });

        const evalTimeout = this.#isFirstCall ? 8000 : 3000;
        this.#isFirstCall = false;

        const evalPromise = adapter.evaluate(page, extractFacebookTokensScript);
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Token extraction evaluate timed out')), evalTimeout);
        });

        const rawTokens = /** @type {Record<string, any>} */ (await Promise.race([evalPromise, timeoutPromise]));

        if (!rawTokens.c_user && parsedCUser) {
          rawTokens.c_user = parsedCUser;
        }

        if (rawTokens.c_user) {
          rawTokens.c_user = safeDecodeCookie(String(rawTokens.c_user));
        }

        if (!rawTokens.lsd && !rawTokens.fb_dtsg) {
          throw new PlatformError({
            code: 'XACT_5030',
            type: ErrorTypes.INTERNAL,
            message: 'Failed to extract Facebook tokens via browser bridge. Session or IP may be checkpointed.',
            suggestedAction: SuggestedActions.RELOGIN,
            platform: 'facebook',
            accountId: effectiveAccountId,
          });
        }

        return rawTokens;
      } catch (err) {
        lastError = err;
        if (page && this.adapter) {
          try {
            await this.adapter.closePage(page);
          } catch {}
          page = null;
        }
        if (attempt >= maxAttempts) {
          break;
        }
        // Reset browser on failure before retry
        await this.close();
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (page && this.adapter) {
          try {
            await this.adapter.closePage(page);
          } catch {}
        }
      }
    }

    if (lastError instanceof PlatformError) {
      throw lastError;
    }

    throw new PlatformError({
      code: 'XACT_5030',
      type: ErrorTypes.INTERNAL,
      message: `Facebook browser token extraction failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      suggestedAction: SuggestedActions.RELOGIN,
      platform: 'facebook',
      accountId: effectiveAccountId,
      cause: lastError,
    });
  }

  /**
   * Resolve a base URL for profile fallback. Defaults to mbasic because it is
   * lighter and less bot-sensitive, but honors test/local overrides.
   * @param {string} [baseUrl]
   * @returns {string}
   */
  #resolveProfileBaseUrl(baseUrl) {
    const input = (baseUrl || this.baseUrl || 'https://mbasic.facebook.com').replace(/\/+$/, '');
    // When attached to a real (headed) Chrome via CDP, prefer the desktop site —
    // mbasic redirects guests to a login interstitial on residential IPs, whereas
    // the desktop page renders public profile content behind a passive banner.
    // Prefer desktop for any real browser adapter (CDP or stealth Puppeteer) —
    // mbasic lacks the DOM elements queried by extractPagePostsFromDom and siblings.
    // Only use mbasic for the lightweight http adapter or when no adapter is set.
    const preferDesktop = this.adapterName !== 'http';
    if (input === 'https://www.facebook.com' || input === 'http://www.facebook.com') {
      return preferDesktop ? 'https://www.facebook.com' : 'https://mbasic.facebook.com';
    }
    return input;
  }

  /**
   * Small delay helper used between scroll/extraction iterations.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Poll the DOM for a selector using repeated adapter.evaluate() calls.
   * @param {import('../../adapters/base.js').BaseAdapter} adapter
   * @param {any} page
   * @param {string} selector
   * @param {number} timeout
   * @returns {Promise<boolean>}
   */
  async #pollForSelector(adapter, page, selector, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = /** @type {boolean} */ (await adapter.evaluate(page, (/** @type {any} */ sel) => {
        return document.querySelector(sel) !== null;
      }, selector));
      if (found) return true;
      await this.#sleep(500);
    }
    return false;
  }

  /**
   * Scrape a Facebook profile via the browser bridge (mbasic-first).
   * @param {string} username
   * @param {Object} [options={}]
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies]
   * @param {string} [options.accountId]
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout]
   * @returns {Promise<import('../../../core/types.js').ProfileItem>}
   */
  async scrapeProfile(username, options = {}) {
    if (!username || typeof username !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Profile username is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = options.accountId || 'fb-guest';
    const baseUrl = this.#resolveProfileBaseUrl(options.baseUrl);
    const handle = resolveProfileHandle(username);
    const isNumeric = /^\d+$/.test(handle);
    const profilePath = isNumeric ? 'profile.php?id=' + handle : handle;
    const profileUrl = baseUrl + '/' + profilePath + (profilePath.includes('?') ? '&' : '?') + 'v=timeline';
    const timeout = options.timeout || 30000;

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId);
    let page = null;
    try {
      page = await adapter.newPage(browser, { preserveProfile: false });

      const parsedCookies = this.#parseCookies(options.cookies || '');
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }

      await adapter.goto(page, profileUrl, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const raw = /** @type {Record<string, any> | null} */ (await adapter.evaluate(page, /** @type {any} */ (extractMbasicProfileFromDom), handle));

      if (!raw || (!raw.ogTitle && !raw.ogDescription && !raw.ogImage)) {
        throw new PlatformError({
          code: 'XACT_4004',
          type: ErrorTypes.INVALID_ARGS,
          message: 'Profile not found via browser fallback',
          suggestedAction: SuggestedActions.RELOGIN,
          platform: 'facebook',
          accountId,
        });
      }

      const legacy = normalizeProfile(raw, handle);
      if (!legacy.name && !legacy.bio && !legacy.avatar && !legacy.followers) {
        throw new PlatformError({
          code: 'XACT_4004',
          type: ErrorTypes.INVALID_ARGS,
          message: 'Profile not found via browser fallback',
          suggestedAction: SuggestedActions.RELOGIN,
          platform: 'facebook',
          accountId,
        });
      }

      const externalId = raw.userId || handle;
      const rawForProfile = {
        id: externalId,
        name: legacy.name,
        username: legacy.username,
        bio_text: { text: legacy.bio || '' },
        profile_picture: { uri: legacy.avatar || '' },
        profile_url: legacy.url || profileUrl,
        follower_count: parseHumanCount(legacy.followers),
      };
      const profile = normalizeFacebookProfile(rawForProfile, 'browser');
      if (!profile) {
        throw new PlatformError({
          code: 'XACT_5000',
          type: ErrorTypes.INTERNAL,
          message: 'Failed to normalize profile from browser fallback',
          suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
          platform: 'facebook',
          accountId,
        });
      }
      return profile;
    } finally {
      if (page && this.adapter) {
        try {
          await this.adapter.closePage(page);
        } catch {}
      }
    }
  }

  /**
   * Scrape the members of a Facebook group via the browser bridge.
   * @param {string} groupUrl - Full group URL or group id/slug
   * @param {Object} [options={}]
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies]
   * @param {string} [options.accountId]
   * @param {number} [options.limit]
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout]
   * @returns {Promise<{ members: import('../../../core/types.js').ProfileItem[], note?: string, pageInfo?: any }>}
   */
  async scrapeGroupMembers(groupUrl, options = {}) {
    if (!groupUrl || typeof groupUrl !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'Group URL or groupId is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }

    const accountId = options.accountId || 'fb-guest';
    const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? Math.min(Math.floor(options.limit), 1000)
      : 100;
    const timeout = options.timeout || 30000;
    const baseUrl = (options.baseUrl || this.baseUrl || 'https://www.facebook.com').replace(/\/+$/, '');

    let resolvedGroupUrl = groupUrl.trim();
    if (!/^https?:\/\//i.test(resolvedGroupUrl)) {
      resolvedGroupUrl = baseUrl + '/groups/' + resolvedGroupUrl.replace(/^\/+/, '');
    } else {
      assertFacebookUrlLocal(resolvedGroupUrl, 'groupUrl');
    }
    const membersUrl = resolvedGroupUrl.replace(/\/$/, '') + '/members';
    const groupMatch = resolvedGroupUrl.match(/\/groups\/([^/?#]+)/);
    const groupId = groupMatch ? groupMatch[1] : groupUrl;

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId);
    let page = null;
    try {
      page = await adapter.newPage(browser, { preserveProfile: false });

      const parsedCookies = this.#parseCookies(options.cookies || '');
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }

      await adapter.goto(page, membersUrl, {
        waitUntil: 'domcontentloaded',
        timeout,
      });

      const memberSelector = 'a[href*="/groups/"][href*="/user/"]';
      const hasMembers = await this.#pollForSelector(adapter, page, memberSelector, 10000);

      if (!hasMembers) {
        return {
          members: [],
          note: 'Group is private or members list is restricted. Please retry with relogin if you are a member.',
          pageInfo: null,
        };
      }

      const members = new Map();
      let stalls = 0;
      const maxStalls = 5;

      while (members.size < limit && stalls < maxStalls) {
        const prevSize = members.size;
        const rawMembers = /** @type {Record<string, any>[]} */ (await adapter.evaluate(page, extractGroupMembersFromDom));

        for (const raw of rawMembers) {
          if (members.has(raw.profileUrl)) continue;
          const legacy = normalizeGroupMember(/** @type {any} */ (raw));
          const externalId = raw.id || legacy.username || '';
          if (!externalId) continue;
          const rawForMember = {
            id: externalId,
            name: legacy.name,
            username: legacy.username,
            profile_url: legacy.profileUrl,
          };
          const member = normalizeFacebookGroupMember(rawForMember, groupId, 'browser');
          if (!member) continue;
          members.set(raw.profileUrl, member);
          if (members.size >= limit) break;
        }

        if (members.size === prevSize) {
          stalls++;
        } else {
          stalls = 0;
        }

        if (members.size >= limit) break;

        await adapter.scroll(page, { y: 1000 });
        await this.#sleep(1000 + Math.floor(Math.random() * 1000));
      }

      const results = Array.from(members.values());
      if (results.length === 0) {
        return {
          members: [],
          note: 'Group is private or members list is restricted. Please retry with relogin if you are a member.',
          pageInfo: null,
        };
      }

      return {
        members: results,
        pageInfo: { has_next_page: false, end_cursor: null },
      };
    } finally {
      if (page && this.adapter) {
        try {
          await this.adapter.closePage(page);
        } catch {}
      }
    }
  }

  /**
   * Scrape public page/profile timeline posts via the browser bridge (desktop DOM).
   * Used as a no-auth fallback when GraphQL returns nothing for a guest session.
   * @param {string} pageId - Page handle or profile id
   * @param {Object} [options={}]
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies]
   * @param {string} [options.accountId]
   * @param {number} [options.limit=20]
   * @param {number} [options.timeout]
   * @returns {Promise<{ posts: Record<string, any>[], pageInfo?: any, note?: string }>}
   */
  async scrapePagePosts(pageId, options = {}) {
    if (!pageId || typeof pageId !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'pageId is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const accountId = options.accountId || 'fb-guest';
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(Math.floor(options.limit), 200) : 20;
    const timeout = options.timeout || 30000;
    const baseUrl = (this.#resolveProfileBaseUrl(options.baseUrl));
    const targetUrl = `${baseUrl}/${String(pageId).replace(/^\/+/, '')}`;

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId);
    let page = null;
    try {
      page = await adapter.newPage(browser, { preserveProfile: false });
      const parsedCookies = this.#parseCookies(options.cookies || '');
      if (parsedCookies.length > 0) await adapter.setCookies(page, parsedCookies);

      await adapter.goto(page, targetUrl, { waitUntil: 'domcontentloaded', timeout });
      // Wait briefly for feed units then scroll once to lazy-load more.
      await this.#pollForSelector(adapter, page, 'div[role="article"], div[data-pagelet*="FeedUnit"], div[data-pagelet*="ProfileTimeline"]', 8000);
      await adapter.scroll(page, { y: 1200 }).catch(() => {});
      await this.#sleep(1500);

      const raw = /** @type {Record<string, any>[]} */ (await adapter.evaluate(page, extractPagePostsFromDom, String(pageId), limit));
      const posts = Array.isArray(raw) ? raw : [];
      return {
        posts,
        pageInfo: { has_next_page: false, end_cursor: null },
        note: posts.length === 0 ? 'No public posts rendered for guest session' : undefined,
      };
    } finally {
      if (page && this.adapter) { try { await this.adapter.closePage(page); } catch {} }
    }
  }

  /**
   * Scrape comments from a post permalink via the browser bridge (desktop DOM).
   * @param {string} postUrl - Full post permalink URL
   * @param {Object} [options={}]
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies]
   * @param {string} [options.accountId]
   * @param {number} [options.limit=50]
   * @param {number} [options.timeout]
   * @returns {Promise<{ comments: Record<string, any>[], pageInfo?: any, note?: string }>}
   */
  async scrapePostComments(postUrl, options = {}) {
    if (!postUrl || typeof postUrl !== 'string') {
      throw new PlatformError({
        code: 'XACT_4001',
        type: ErrorTypes.INVALID_ARGS,
        message: 'postUrl is required',
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST,
      });
    }
    const accountId = options.accountId || 'fb-guest';
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(Math.floor(options.limit), 2000) : 50;
    const timeout = options.timeout || 30000;
    let targetUrl = postUrl.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      const baseUrl = this.#resolveProfileBaseUrl(options.baseUrl);
      targetUrl = `${baseUrl}/${targetUrl.replace(/^\/+/, '')}`;
    }

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId);
    let page = null;
    try {
      page = await adapter.newPage(browser, { preserveProfile: false });
      const parsedCookies = this.#parseCookies(options.cookies || '');
      if (parsedCookies.length > 0) await adapter.setCookies(page, parsedCookies);

      await adapter.goto(page, targetUrl, { waitUntil: 'domcontentloaded', timeout });
      await this.#sleep(1500);
      await adapter.scroll(page, { y: 800 }).catch(() => {});
      await this.#sleep(1000);

      const raw = /** @type {Record<string, any>[]} */ (await adapter.evaluate(page, extractCommentsFromDom, limit));
      const comments = Array.isArray(raw) ? raw : [];
      return {
        comments,
        pageInfo: { has_next_page: false, end_cursor: null },
        note: comments.length === 0 ? 'No public comments rendered for guest session' : undefined,
      };
    } finally {
      if (page && this.adapter) { try { await this.adapter.closePage(page); } catch {} }
    }
  }

  /**
   * Shared DOM-list scraper: open a URL, wait, scroll, run an extractor, return items.
   * @param {string} targetUrl
   * @param {(…args:any[])=>Record<string,any>[]} extractorFn
   * @param {any[]} extractorArgs
   * @param {string} itemKey - result field name (posts|listings|members)
   * @param {Object} [options]
   * @returns {Promise<Record<string, any>>}
   */
  async #scrapeDomList(targetUrl, extractorFn, extractorArgs, itemKey, options = {}) {
    const accountId = options.accountId || 'fb-guest';
    const timeout = options.timeout || 30000;
    const scrollY = options.scrollY ?? 1200;
    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(accountId);
    let page = null;
    try {
      page = await adapter.newPage(browser, { preserveProfile: false });
      const parsedCookies = this.#parseCookies(options.cookies || '');
      if (parsedCookies.length > 0) await adapter.setCookies(page, parsedCookies);
      await adapter.goto(page, targetUrl, { waitUntil: 'domcontentloaded', timeout });
      await this.#sleep(2000);
      await adapter.scroll(page, { y: scrollY }).catch(() => {});
      await this.#sleep(1500);
      const raw = /** @type {Record<string, any>[]} */ (await adapter.evaluate(page, extractorFn, ...extractorArgs));
      const items = Array.isArray(raw) ? raw : [];
      return { [itemKey]: items, pageInfo: { has_next_page: false, end_cursor: null }, note: items.length === 0 ? `No public ${itemKey} rendered for guest session` : undefined };
    } finally {
      if (page && this.adapter) { try { await this.adapter.closePage(page); } catch {} }
    }
  }

  /**
   * Scrape a public group's feed via the browser bridge.
   * @param {string} groupId
   * @param {Object} [options]
   * @returns {Promise<{ posts: Record<string, any>[], pageInfo?: any, note?: string }>}
   */
  async scrapeGroupPosts(groupId, options = {}) {
    if (!groupId) {
      throw new PlatformError({ code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS, message: 'groupId is required', suggestedAction: SuggestedActions.USE_ACTIONS_LIST });
    }
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(Math.floor(options.limit), 200) : 20;
    const baseUrl = this.#resolveProfileBaseUrl(options.baseUrl);
    const targetUrl = `${baseUrl}/groups/${String(groupId).replace(/^\/+|\/+$/g, '')}`;
    return this.#scrapeDomList(targetUrl, extractGroupPostsFromDom, [String(groupId), limit], 'posts', options);
  }

  /**
   * Scrape Marketplace search results via the browser bridge.
   * @param {string} query
   * @param {Object} [options]
   * @param {string} [options.location]
   * @returns {Promise<{ listings: Record<string, any>[], pageInfo?: any, note?: string }>}
   */
  async scrapeMarketplaceListings(query, options = {}) {
    if (!query) {
      throw new PlatformError({ code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS, message: 'query is required', suggestedAction: SuggestedActions.USE_ACTIONS_LIST });
    }
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(Math.floor(options.limit), 200) : 50;
    const baseUrl = this.#resolveProfileBaseUrl(options.baseUrl);
    const loc = (options.location || 'Ho Chi Minh City').toLowerCase().replace(/\s+/g, '');
    const targetUrl = `${baseUrl}/marketplace/${encodeURIComponent(loc)}/search?query=${encodeURIComponent(query)}`;
    return this.#scrapeDomList(targetUrl, extractMarketplaceFromDom, [limit], 'listings', { ...options, scrollY: 1500 });
  }

  /**
   * Scrape a public profile's followers list via the browser bridge.
   * @param {string} handle
   * @param {Object} [options]
   * @returns {Promise<{ members: Record<string, any>[], pageInfo?: any, note?: string }>}
   */
  async scrapeFollowList(handle, kind, options = {}) {
    if (!handle) {
      throw new PlatformError({ code: 'XACT_4001', type: ErrorTypes.INVALID_ARGS, message: 'handle is required', suggestedAction: SuggestedActions.USE_ACTIONS_LIST });
    }
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.min(Math.floor(options.limit), 500) : 50;
    const baseUrl = this.#resolveProfileBaseUrl(options.baseUrl);
    const seg = kind === 'following' ? 'following' : 'followers';
    // For numeric-ID profiles (profile.php?id=N), use ?sk=followers/following
    // since /profile.php?id=N/followers is not a valid Facebook URL.
    const cleanHandle = String(handle).replace(/^\/+|\/+$/g, '');
    const targetUrl = cleanHandle.startsWith('profile.php')
      ? `${baseUrl}/${cleanHandle}&sk=${seg === 'followers' ? 'followers' : 'following'}`
      : `${baseUrl}/${cleanHandle}/${seg}`;
    return this.#scrapeDomList(targetUrl, extractFollowListFromDom, [cleanHandle, limit], 'members', { ...options, scrollY: 1500 });
  }

  /**
   * Execute an operation inside a browser page context with cookie setup and cleanup.
   * @template T
   * @param {(page: any) => Promise<T>} fn
   * @param {Object} [options={}]
   * @param {string} [options.accountId='fb-guest']
   * @param {string | Record<string, string> | Array<{ name: string, value: string }>} [options.cookies='']
   * @param {boolean} [options.requiresResidential]
   * @returns {Promise<T>}
   */
  async withPage(fn, options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const { accountId = 'fb-guest', cookies = '' } = opts;
    const requiresResidential = opts.requiresResidential ?? this.requiresResidential;
    const parsedCookies = this.#parseCookies(cookies);
    const rawCUser = parsedCookies.find((c) => c.name === 'c_user')?.value || '';
    const parsedCUser = safeDecodeCookie(rawCUser);
    const effectiveAccountId = parsedCUser || accountId;

    const adapter = await this.#resolveAdapter();
    const browser = await this.#getBrowser(effectiveAccountId, requiresResidential);
    const page = await adapter.newPage(browser, { preserveProfile: false });

    try {
      if (parsedCookies.length > 0) {
        await adapter.setCookies(page, parsedCookies);
      }
      const nativePage = page?._native || page;
      return await fn(nativePage);
    } catch (err) {
      if (this.#browser && typeof this.#browser.isConnected === 'function' && !this.#browser.isConnected()) {
        await this.close();
      }
      throw err;
    } finally {
      try {
        await adapter.closePage(page);
      } catch {}
    }
  }

  /**
   * Public DOM-evaluation seam: a thin wrapper around `withPage`.
   * @template T
   * @param {(page: any) => Promise<T>} fn
   * @param {Object} [options={}]
   * @returns {Promise<T>}
   */
  async evaluateDom(fn, options = {}) {
    return this.withPage(fn, options);
  }

  /**
   * Close any open browser sessions and kill auto-launched Chrome processes.
   * @returns {Promise<void>}
   */
  async close() {
    if (this.#browser && this.adapter) {
      try {
        await this.adapter.closeBrowser(this.#browser);
      } catch {}
      this.#browser = null;
    }
    if (this.#chromeKiller) {
      try {
        await this.#chromeKiller();
      } catch {}
      this.#chromeKiller = null;
    }
  }
}
