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

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { generateSync as totpGenerateSync } from 'otplib';
import { generateFingerprint, applyFingerprint, applyNavigatorOverrides } from './fingerprint.js';

puppeteer.use(StealthPlugin());

// ============================================================================
// Core Utilities
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = (min = 1000, max = 3000) => sleep(min + Math.random() * (max - min));

const FACEBOOK_BASE = 'https://www.facebook.com';

// Path segments after facebook.com/ that are NOT user/page profile handles.
// Shared by scrapeFollowers and searchTweets author extraction. Passed into
// page.evaluate as an argument (arrays serialize across the bridge; Sets do not).
const NON_PROFILE_SEGMENTS = [
  'photo', 'photo.php', 'groups', 'watch', 'events', 'marketplace',
  'pages', 'people', 'friends', 'reel', 'reels', 'stories', 'hashtag',
];

/**
 * Create a browser instance for Facebook scraping
 * @param {Object} options - Browser launch options
 * @returns {Promise<Browser>} Puppeteer browser instance
 */
export async function createBrowser(options = {}) {
  const { args: extraArgs = [], headless, proxy, launchImpl, executablePath, ...rest } = options;
  const stealthArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
  ];
  // Wire proxy as a Chromium launch arg — the only browser-level way to apply it.
  // Proxy creds (username/password) are NOT handled here; callers must invoke
  // page.authenticate({ username, password }) after createPage, using the fields
  // from rotateProxy's descriptor (see docs/agents/selectors-facebook.md AC4 notes).
  const proxyArgs = proxy ? [`--proxy-server=${proxy}`] : [];
  // launchImpl seam: tests inject a fake launcher so no real browser spawns.
  const launch = launchImpl ?? puppeteer.launch.bind(puppeteer);

  // Resolve executablePath: explicit option → env var → system Chrome → puppeteer default
  const resolvedExecutablePath = executablePath
    || process.env.PUPPETEER_EXECUTABLE_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  return launch({
    headless: headless !== undefined ? headless : 'new',
    // Merge stealth + proxy + caller args; order ensures proxy is visible to Chromium
    args: [...stealthArgs, ...proxyArgs, ...extraArgs],
    executablePath: resolvedExecutablePath,
    ...rest,
  });
}

/**
 * Create a page with a consistent session fingerprint (ADR-013).
 *
 * A fingerprint (UA + viewport + hardware config) is generated once and applied
 * via `applyFingerprint` (UA + viewport) then `applyNavigatorOverrides` (navigator
 * properties via evaluateOnNewDocument). The fingerprint is attached as
 * `page._fingerprint` so callers can reuse it across tabs via
 * `createPage(browser, { fingerprint })`.
 *
 * @param {Browser} browser - Puppeteer browser instance
 * @param {Object} [options]
 * @param {Object} [options.fingerprint] - explicit fingerprint for session reuse
 * @returns {Promise<Page>} Puppeteer page instance with `page._fingerprint` set
 */
export async function createPage(browser, options = {}) {
  const page = await browser.newPage();
  const fingerprint = options.fingerprint ?? generateFingerprint();
  try {
    await applyFingerprint(page, fingerprint);
    await applyNavigatorOverrides(page, fingerprint);
  } catch (err) {
    // Clean up the page on failure — avoid resource leak and partial-fingerprint state.
    await page.close().catch(() => {});
    throw err;
  }
  page._fingerprint = fingerprint;
  return page;
}

// ============================================================================
// Profile Normalizer (pure — testable without Puppeteer)
// ============================================================================

// ============================================================================
// Handle Normalization (shared — used by scrapeProfile and scrapeTweets)
// ============================================================================

/**
 * Normalize a Facebook handle input to a clean handle string.
 * Accepts: handle, @handle, full facebook.com URL.
 * Preserves profile.php?id=<n> identifiers.
 * @param {string} input
 * @returns {string} Normalized handle
 */
export function normalizeHandle(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('❌ Facebook handle is required (handle, @handle, or facebook.com URL)');
  }
  let handle = input;
  if (handle.startsWith('https://') || handle.startsWith('http://')) {
    handle = handle.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').replace(/\/$/, '');
  }
  handle = handle.replace(/^@/, '');
  if (/^profile\.php\?id=\d+/i.test(handle)) {
    // Preserve only the canonical profile.php?id=<digits>, dropping any &trailing params
    const m = handle.match(/^profile\.php\?id=\d+/i);
    handle = m[0];
  } else {
    handle = handle.split('/')[0].split('?')[0];
  }
  return handle;
}

// ============================================================================
// Post Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw post object from page.evaluate into the standard post shape.
 * @param {Object} raw - Raw post fields from page.evaluate
 * @returns {Object} Normalized post
 */
export function normalizePost(raw) {
  const { id, text, timestamp, likes, comments, postUrl, images, hasVideo } = raw;
  return {
    id: id || null,
    text: text || null,
    timestamp: timestamp || null,
    likes: likes || '0',
    comments: comments || '0',
    url: postUrl || null,
    media: {
      images: images || [],
      hasVideo: hasVideo || false,
    },
    platform: 'facebook',
  };
}

/**
 * Normalize raw meta/DOM values into the standard profile shape.
 * @param {Object} raw - Raw values from page.evaluate
 * @param {string} inputHandle - The handle provided by the caller
 * @returns {Object} Normalized profile
 */
export function normalizeProfile(raw, inputHandle) {
  const { ogTitle, ogDescription, ogImage, domFollowers, pageUrl } = raw;

  // Parse name from og:title: "Name | Facebook" or "Name (username) | Facebook"
  let name = null;
  if (ogTitle) {
    name = ogTitle.replace(/\s*[\||\-–—]\s*Facebook.*$/i, '').trim() || null;
  }

  // Parse follower count best-effort.
  // ogDescription is free text → regex-extract the count.
  // domFollowers is already the extracted count (e.g. "1.2M") → use directly.
  let followers = null;
  if (ogDescription) {
    const match = ogDescription.match(/([\d,.]+[KkMmBb]?)\s*(followers?|people follow)/i);
    if (match) followers = match[1];
  }
  if (!followers && domFollowers) {
    followers = domFollowers;
  }

  // Parse bio from og:description — strip leading follower count line
  let bio = null;
  if (ogDescription) {
    bio = ogDescription.replace(/^[\d,.]+[KkMmBb]?\s*(followers?|people follow)[^.]*\.\s*/i, '').trim() || null;
  }

  return {
    name,
    username: inputHandle,
    bio,
    avatar: ogImage || null,
    followers,
    url: pageUrl || `${FACEBOOK_BASE}/${inputHandle}`,
    platform: 'facebook',
  };
}

/**
 * Login to Facebook using c_user and xs cookies
 * @param {Page} page - Puppeteer page instance
 * @param {Object} cookies - Cookie object with c_user and xs
 * @param {string} cookies.c_user - Facebook user ID cookie (numeric, 15-17 digits)
 * @param {string} cookies.xs - Facebook session token cookie
 * @throws {Error} If either cookie is missing or empty
 */
export async function loginWithCookie(page, { c_user, xs, sb, datar, fr, fbl_st, locale, headless = true } = {}) {
  if (!c_user?.trim() || !xs?.trim()) {
    throw new Error('❌ Facebook login requires both c_user and xs cookies');
  }

  // When browser is visible, use longer timeouts and domcontentloaded (faster than networkidle2)
  const navTimeout = headless ? 30000 : 60000;
  const navWaitUntil = headless ? 'networkidle2' : 'domcontentloaded';

  // Step 1: Navigate to Facebook first so browser is on the correct domain.
  // This is required — setCookie before navigation can fail silently for some
  // cookie combinations because the browser has no origin context.
  await page.goto(FACEBOOK_BASE, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  await randomDelay(1000, 2000);

  // Step 2: Build cookie list with all fields needed for full authentication.
  // Facebook requires sameSite: "None" for cross-site cookies to work.
  // httpOnly: false allows JS to read cookies (needed for FB features).
  const fbCookies = [
    { name: 'c_user', value: c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
    { name: 'xs', value: xs, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' },
  ];

  // Optional but important cookies for full session.
  if (sb?.trim()) fbCookies.push({ name: 'sb', value: sb, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' });
  if (datar?.trim()) fbCookies.push({ name: 'datr', value: datar, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' });
  if (fr?.trim()) fbCookies.push({ name: 'fr', value: fr, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' });
  if (fbl_st?.trim()) fbCookies.push({ name: 'fbl_st', value: fbl_st, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' });
  if (locale?.trim()) fbCookies.push({ name: 'locale', value: locale, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None' });

  // Step 3: Set cookies one at a time to avoid ProtocolError from invalid fields.
  let setCount = 0;
  for (const cookie of fbCookies) {
    try {
      await page.setCookie(cookie);
      setCount++;
    } catch (e) {
      // Skip invalid cookies but continue with others.
      console.warn(`⚠️ Skipped invalid cookie ${cookie.name}: ${e.message?.substring(0, 80)}`);
    }
  }

  // Step 4: Navigate again — this sends the cookies to Facebook's server,
  // which responds with an authenticated session.
  await page.goto(FACEBOOK_BASE, { waitUntil: navWaitUntil, timeout: navTimeout });
  await randomDelay(2000, 4000);

  // Step 5: Verify authentication succeeded.
  // Check for: login form (bad cookies) OR security check (anti-bot detection).
  const authCheck = await page.evaluate(() => {
    const bodyText = document.body.innerText;
    const hasLoginForm = !!document.querySelector('form[action*="login"], [data-testid="royal_login_form"]');
    const hasLoginButton = bodyText.includes('Log in') && bodyText.includes('password');
    // Facebook security check / CAPTCHA indicators (multi-language, various phrasings)
    const hasSecurityCheck = bodyText.includes('confirmez que vous êtes une personne') ||
      bodyText.includes('confirm that you are a real person') ||
      bodyText.includes('confirm that you') && bodyText.includes('human') ||
      bodyText.includes('security check') ||
      bodyText.includes('vérification de sécurité') ||
      bodyText.includes('Enter the text from the image') ||
      bodyText.includes('hear this code');
    return { hasLoginForm, hasLoginButton, hasSecurityCheck };
  });

  if (authCheck.hasLoginForm || authCheck.hasLoginButton) {
    throw new Error('❌ Facebook cookie authentication failed — session expired or invalid cookies');
  }

  if (authCheck.hasSecurityCheck) {
    throw new Error('❌ Facebook security check detected — manual verification required (CAPTCHA/anti-bot)');
  }
}

// ============================================================================
// TOTP Helper (Story 5.3 — 2FA injection, AC2)
// ============================================================================

/**
 * Generate a 6-digit TOTP code from a base32 seed using otplib authenticator.
 * Returns null (never throws) for an empty, missing, or invalid seed.
 * NFR3: seed value is never logged.
 *
 * @param {string|null|undefined} seed  32-char base32 TOTP seed
 * @returns {string|null}  6-digit code string, or null on invalid input
 */
export function generateTotp(seed, options = {}) {
  if (!seed || typeof seed !== 'string' || !seed.trim()) return null;
  // C# MNST_DT1.cs lines 78-81: 2FA seed is valid iff length==32 AND not "@" AND not "user="
  if (seed.length !== 32 || seed.includes('@') || seed.includes('user=')) return null;
  try {
    return totpGenerateSync({ secret: seed, ...options });
  } catch {
    // Invalid base32, too-short secret, or other otplib error → null; do not throw, do not log seed
    return null;
  }
}

// ============================================================================
// Password Login (Story 5.3 — AC1, AC2 integration)
// ============================================================================

/**
 * Login to Facebook using uid + password (alternative auth path to loginWithCookie).
 *
 * Flow (ported from SST_TOOL_FB/Main.cs:Post() ~294-490):
 *   1. Inject bait cookie if provided, stripping "c_user" from name (C# line 325)
 *   2. Navigate to /?locale=en_US (NOT /login — C# navigates to root, lets cookie decide UI)
 *   3. Branch A (password field present): fill email + pass, click [aria-label='Log In']
 *      Branch B (no password field — Continue interstitial): click Continue, re-fill pass,
 *      click [aria-label='Log in'] — POST-CONTINUE PASSWORD RE-FILL is critical (C# line 407)
 *   4. Dismiss "Allow all cookies" dialog (3 fallbacks per C# lines 426-453)
 *   5. Post-login dead-session check: if page still shows type="password" → failure signal
 *   6. Detect 2FA challenge; if seed provided → generateTotp → type + submit
 *
 * Returns the authenticated page on apparent success.
 * Returns { page, requires2fa: true } if 2FA required but no seed supplied.
 * Throws a clear emoji-prefixed error on hard failure — no blind retry.
 * NFR3: uid, pass, baitCookie value, and seed are NEVER logged.
 *
 * ⚠️  ALL selectors UNVERIFIED — see docs/agents/selectors-facebook.md "Password Login & 2FA".
 *     C# port references: aria-label='Log In' (capital I, Branch A), aria-label='Log in'
 *     (lowercase i, Branch B), aria-label='Continue' — all from Main.cs Post().
 *
 * @param {import('puppeteer').Page} page
 * @param {object} [creds]
 * @param {string} creds.uid
 * @param {string} creds.pass
 * @param {{ name: string, value: string, domain?: string }|null} [creds.baitCookie]
 * @param {string|null} [creds.seed]  32-char base32 TOTP seed (optional)
 * @returns {Promise<import('puppeteer').Page | { page: import('puppeteer').Page, requires2fa: true }>}
 */
export async function loginWithPassword(page, { uid, pass, baitCookie = null, seed = null } = {}) {
  if (!uid?.trim()) throw new Error('❌ loginWithPassword: uid is required');
  if (!pass?.trim()) throw new Error('❌ loginWithPassword: pass is required');

  // 1. Inject bait cookie.
  //    C# Main.cs line 325 strips "c_user" substring from the cookie string before injecting,
  //    preventing session recognition so Facebook renders the correct UI branch.
  if (baitCookie?.name && baitCookie?.value) {
    await page.setCookie({
      name:     baitCookie.name.replace('c_user', ''),
      value:    baitCookie.value,
      domain:   baitCookie.domain ?? '.facebook.com',
      httpOnly: false,
      secure:   true,
    });
  }

  // 2. Navigate to root with en_US locale — C# navigates here, NOT /login directly.
  //    The bait cookie (c_user stripped) determines which UI branch renders.
  await page.goto(`${FACEBOOK_BASE}/?locale=en_US`, { waitUntil: 'networkidle2', timeout: 30000 });
  await randomDelay(1300, 2000);

  const pageSource = await page.content();

  if (pageSource.includes('type="password"')) {
    // Branch A — standard login form: fill email + pass, click 'Log In' (capital I).
    // C# Main.cs lines 358-374. Selectors UNVERIFIED — see docs/agents/selectors-facebook.md.
    const emailEl = await page.$('input[name="email"]');
    if (!emailEl) throw new Error('❌ loginWithPassword: email/uid field not found — update selectors-facebook.md');
    await emailEl.type(uid, { delay: 80 + Math.floor(Math.random() * 40) });
    await randomDelay(500, 1200);

    const passEl = await page.$('input[name="pass"]');
    if (!passEl) throw new Error('❌ loginWithPassword: password field not found — update selectors-facebook.md');
    await passEl.type(pass, { delay: 80 + Math.floor(Math.random() * 40) });
    await randomDelay(2300, 2800);

    // C# port: aria-label='Log In' (capital I) — Main.cs line 369. UNVERIFIED.
    try { await page.click("[aria-label='Log In']"); }
    catch { await page.keyboard.press('Enter'); }

  } else {
    // Branch B — bait cookie advanced the state (Continue interstitial / partial session).
    // C# Main.cs lines 378-420. Selectors UNVERIFIED — see docs/agents/selectors-facebook.md.
    await randomDelay(1300, 1800);

    // Click Continue — 3 fallbacks matching C# lines 381-405.
    // Port refs: 'Continue', 'Continue Meta Maneger', aria-label*='Continue' + JS click.
    try { await page.click("[aria-label='Continue']"); }
    catch {
      try { await page.click("[aria-label='Continue Meta Maneger']"); }
      catch {
        const btn = await page.$("[aria-label*='Continue']");
        if (btn) await page.evaluate((el) => el.click(), btn);
      }
    }

    // C# line 406: await Task.Delay(2300) after Continue click.
    await randomDelay(2300, 2600);

    // C# line 407: RE-FILL PASSWORD after Continue — this step was missing before.
    // UNVERIFIED selector — see docs/agents/selectors-facebook.md.
    const passEl = await page.$('input[name="pass"]');
    if (passEl) await passEl.type(pass, { delay: 80 + Math.floor(Math.random() * 40) });

    await randomDelay(2300, 2600);

    // C# port: aria-label='Log in' (lowercase i) — Main.cs line 414. UNVERIFIED.
    try { await page.click("[aria-label='Log in']"); }
    catch { await page.keyboard.press('Enter'); }
  }

  // C# line 422: await Task.Delay(8300) — wait for post-login page load.
  await randomDelay(4000, 8500);

  // 3. Dismiss "Allow all cookies" dialog — C# Main.cs lines 426-453 (3 fallbacks).
  //    All selectors UNVERIFIED — see docs/agents/selectors-facebook.md.
  try { await page.click('::-p-text(Allow all cookies)'); }
  catch {
    try { await page.click('text=Allow all cookies'); }
    catch {
      try {
        await page.click('xpath=/html/body/div[4]/div[1]/div/div[2]/div/div/div/div/div[2]/div/div[2]/div[1]/div');
      } catch { /* dialog not present or already dismissed */ }
    }
  }

  // 4. Post-login dead-session check — C# Main.cs lines 454-490.
  //    Password form still visible = login failed. Do NOT silently return page as success.
  const postSource = await page.content();
  if (postSource.includes('type="password"')) {
    // Re-inject bait cookie + reload matching C# lines 458-476, then throw failure.
    if (baitCookie?.name && baitCookie?.value) {
      await page.setCookie({
        name:     baitCookie.name.replace('c_user', ''),
        value:    baitCookie.value,
        domain:   baitCookie.domain ?? '.facebook.com',
        httpOnly: false,
        secure:   true,
      });
      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    }
    throw new Error('❌ loginWithPassword: login failed — password form still present after submit (dead session or wrong credentials)');
  }

  // 5. Detect 2FA challenge. Selectors UNVERIFIED — see docs/agents/selectors-facebook.md.
  const tfaField = await page.$(
    'input[name="approvals_code"], input[id*="approvals_code"], input[autocomplete="one-time-code"]'
  );
  if (tfaField) {
    if (!seed) return { page, requires2fa: true };
    const code = generateTotp(seed);
    if (!code) throw new Error('❌ loginWithPassword: 2FA code generation failed — seed must be exactly 32 chars, no @ or user= (see MNST_DT1.cs)');
    await tfaField.type(code, { delay: 80 + Math.floor(Math.random() * 40) });
    await randomDelay(500, 1000);
    const tfaSubmit = await page.$('#checkpointSubmitButton, button[type="submit"]');
    if (tfaSubmit) { await tfaSubmit.click(); await randomDelay(2000, 3000); }
  }

  return page;
}

// ============================================================================
// Profile Scraper
// ============================================================================

/**
 * Scrape a public Facebook profile or page
 * @param {Page} page - Puppeteer page instance
 * @param {string} username - Handle (zuck), @handle, or full facebook.com URL
 * @returns {Object} Normalized profile data
 */
export async function scrapeProfile(page, username) {
  const handle = normalizeHandle(username);

  const url = `${FACEBOOK_BASE}/${handle}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await randomDelay(2000, 4000);

  const raw = await page.evaluate(() => {
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
  });

  // Detect blocked/non-existent profile — og:title missing or a Facebook login wall.
  const title = raw.ogTitle?.trim() || '';
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
      platform: 'facebook',
      error: 'Profile requires authentication or is blocked',
    };
  }

  return normalizeProfile(raw, handle);
}

// ============================================================================
// Follower Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw follower row into the standard follower shape.
 * @param {Object} raw
 * @returns {{ name, username, url, platform }}
 */
export function normalizeFollower(raw) {
  const { name, username, url } = raw;
  return {
    name: name || null,
    username: username || null,
    url: url || null,
    platform: 'facebook',
  };
}

// ============================================================================
// Followers Scraper
// ============================================================================

/**
 * Scrape followers of a Facebook profile or page.
 * Returns an array when the list is publicly accessible (Pages),
 * or a note object when restricted (personal profiles).
 *
 * @param {Page} page - Puppeteer page instance
 * @param {string} username - Handle, @handle, or full facebook.com URL
 * @param {Object} options
 * @param {number} [options.limit=100] - Max followers to return
 * @param {Function} [options.onProgress] - Called each scroll: ({ scraped, limit })
 * @param {number} [options.maxRetries=10] - Stop after N consecutive empty scrolls
 * @param {Function} [options.delay=randomDelay] - Injectable delay seam (pass `() => {}` in tests)
 * @returns {Promise<Array|Object>} Follower array OR { note, username, platform } if restricted
 */
export async function scrapeFollowers(page, username, options = {}) {
  const { limit = 100, onProgress, maxRetries = 10, delay = randomDelay } = options;
  const handle = normalizeHandle(username);
  // profile.php?id=N takes the followers tab via &sk=followers, not a /followers path
  // (appending /followers to a query string lands inside the query value and breaks).
  const followersUrl = /^profile\.php\?id=\d+/i.test(handle)
    ? `${FACEBOOK_BASE}/${handle}&sk=followers`
    : `${FACEBOOK_BASE}/${handle}/followers`;

  await page.goto(followersUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000, 4000);

  // Deterministic exposure check: a real, public follower list renders follower
  // rows as [role="listitem"]. The mere presence of the word "followers" in page
  // chrome/headings is NOT a signal (it appears on every /followers page, including
  // restricted profiles) — so we rely solely on actual list-item rows.
  const exposedCount = await page.evaluate(
    () => document.querySelectorAll('[role="listitem"]').length
  );

  if (exposedCount === 0) {
    return {
      note: 'Facebook follower list is not publicly exposed for this profile. Only Pages with public follower settings expose individual follower data.',
      username: handle,
      platform: 'facebook',
    };
  }

  const followers = new Map();
  let retries = 0;

  while (followers.size < limit && retries < maxRetries) {
    const rawFollowers = await page.evaluate((nonProfile) => {
      const items = document.querySelectorAll('[role="listitem"]');
      const NON_PROFILE = new Set(nonProfile);
      return Array.from(items).map((item) => {
        const anchors = Array.from(item.querySelectorAll('a[href]'));
        let url = null;
        let username = null;
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          // profile.php?id=N → canonical numeric identifier
          const idMatch = abs.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
          if (idMatch) {
            url = `https://www.facebook.com/profile.php?id=${idMatch[1]}`;
            username = `profile.php?id=${idMatch[1]}`;
            break;
          }
          // vanity handle as first path segment (skip known non-profile segments)
          const segMatch = abs.match(/facebook\.com\/([^/?&#]+)/i);
          if (segMatch && !NON_PROFILE.has(segMatch[1].toLowerCase())) {
            url = abs.split('?')[0];
            username = segMatch[1];
            break;
          }
        }
        const nameEl = item.querySelector('span, strong');
        const name = nameEl?.textContent?.trim() || null;
        const id = url || name;
        return { id, name, username, url };
      }).filter((f) => f.id);
    }, NON_PROFILE_SEGMENTS);

    const prevSize = followers.size;
    rawFollowers.forEach((raw) => {
      if (!followers.has(raw.id)) {
        followers.set(raw.id, normalizeFollower({ name: raw.name, username: raw.username, url: raw.url }));
      }
    });

    if (onProgress) onProgress({ scraped: followers.size, limit });
    if (followers.size === prevSize) { retries++; } else { retries = 0; }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
  }

  return Array.from(followers.values()).slice(0, limit);
}

// ============================================================================
// Posts Scraper
// ============================================================================

/**
 * Scrape recent posts from a Facebook profile or page
 * @param {Page} page - Puppeteer page instance
 * @param {string} username - Handle, @handle, or full facebook.com URL
 * @param {Object} options
 * @param {number} [options.limit=50] - Max posts to return
 * @param {Function} [options.onProgress] - Called each scroll: ({ scraped, limit })
 * @returns {Promise<Array>} Normalized post array
 */
export async function scrapeTweets(page, username, options = {}) {
  const {
    limit = 50,
    onProgress,
    maxRetries = 10,
    // Injectable delay seam — defaults to human-like jitter, override (e.g. () => {})
    // in tests to keep the scroll loop fast and browser-free.
    delay = randomDelay,
  } = options;

  // Determine target URL: full URLs (groups, permalinks) go directly,
  // handles get normalized to profile URL.
  // Groups use mobile site - desktop doesn't load posts in headless mode.
  const isFullUrl = username?.startsWith('http://') || username?.startsWith('https://');
  const isGroup = isFullUrl && /\/groups\//.test(username);
  let targetUrl;
  if (isGroup) {
    const cleanUrl = username.replace(/^https?:\/\/(www\.)?facebook\.com/, 'https://m.facebook.com');
    targetUrl = cleanUrl.startsWith('http') ? cleanUrl : `https://m.facebook.com${cleanUrl}`;
    // Set mobile user agent for groups - desktop UA gets desktop version even on mobile URL
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: 390, height: 844 });
  } else {
    targetUrl = isFullUrl ? username : `${FACEBOOK_BASE}/${normalizeHandle(username)}`;
  }

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(2000, 4000);

  // Wait for actual post content to load (skip loading skeletons)
  const isMobile = isGroup;
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
    const rawPosts = await page.evaluate((useMobile) => {
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

        const id = postUrl || text?.slice(0, 80) || null;

        return { id, text, timestamp, likes, comments, postUrl, images, hasVideo };
      }).filter((p) => p && p.id);
    }, isMobile);

    const prevSize = posts.size;
    if (rawPosts) {
      rawPosts.forEach((raw) => {
        if (!posts.has(raw.id)) {
          posts.set(raw.id, normalizePost(raw));
        }
      });
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

  return Array.from(posts.values()).slice(0, limit);
}

// ============================================================================
// Search Normalizer (pure — testable without Puppeteer)
// ============================================================================

/**
 * Normalize a raw search result into the standard search result shape.
 * @param {Object} raw
 * @returns {{ id, text, author, timestamp, url, platform }}
 */
export function normalizeSearchResult(raw) {
  const { id, text, author, timestamp, url } = raw;
  return {
    id: id || null,
    text: text || null,
    author: author || null,
    timestamp: timestamp || null,
    url: url || null,
    platform: 'facebook',
  };
}

// ============================================================================
// Search Posts
// ============================================================================

/**
 * Search Facebook posts by query
 * @param {Page} page - Puppeteer page instance
 * @param {string} query - Search query string
 * @param {Object} options
 * @param {number} [options.limit=30] - Max results to return
 * @param {Function} [options.onProgress] - Called each scroll: ({ scraped, limit })
 * @param {number} [options.maxRetries=8] - Stop after N consecutive empty scrolls
 * @param {Function} [options.delay=randomDelay] - Injectable delay seam
 * @returns {Promise<Array>} Normalized search result array
 */
export async function searchTweets(page, query, options = {}) {
  const { limit = 30, onProgress, maxRetries = 8, delay = randomDelay } = options;
  const searchUrl = `${FACEBOOK_BASE}/search/posts?q=${encodeURIComponent(query)}`;

  await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(2000, 4000);

  const results = new Map();
  let retries = 0;

  while (results.size < limit && retries < maxRetries) {
    const rawResults = await page.evaluate((nonProfile) => {
      const NON_PROFILE = new Set(nonProfile);
      const articles = document.querySelectorAll('[role="article"]');
      return Array.from(articles).map((article) => {
        // Text content — pick the [dir="auto"] element with real text (not FB anti-scraping garbled text)
        const textEls = article.querySelectorAll('[dir="auto"]');
        const texts = Array.from(textEls)
          .map((el) => {
            let t = el.textContent?.trim() || '';
            // Remove Facebook anti-scraping characters: U+034F (CGJ) inserted between chars
            t = t.replace(/\u034F/g, '');
            // Remove zero-width spaces and other invisible chars
            t = t.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '').trim();
            return t;
          })
          .filter((t) => t && t.length > 10);
        // Pick text with most spaces (real text has words separated by spaces)
        const text = texts.reduce((best, t) => {
          if (!best) return t;
          const bestSpaces = (best.match(/\s+/g) || []).length;
          const tSpaces = (t.match(/\s+/g) || []).length;
          return tSpaces > bestSpaces ? t : best;
        }, '') || null;

        // Author — first real profile link in article (skip permalinks, non-profile segments, l.php redirects)
        const allLinks = Array.from(article.querySelectorAll('a[href]'));
        let author = null;
        for (const a of allLinks) {
          const href = a.getAttribute('href') || '';
          if (!href.includes('facebook.com/') && !href.startsWith('/')) continue;
          if (href.includes('/posts/') || href.includes('/permalink/') || href.includes('story_fbid') || href.includes('/search/')) continue;
          if (href.includes('l.php') || href.includes('/l/')) continue;
          const abs = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          // profile.php?id=N → preserve the canonical numeric identifier
          const idMatch = abs.match(/facebook\.com\/profile\.php\?id=(\d+)/i);
          if (idMatch) { author = `profile.php?id=${idMatch[1]}`; break; }
          const segMatch = abs.match(/facebook\.com\/([^/?&#]+)/i);
          if (segMatch && !NON_PROFILE.has(segMatch[1].toLowerCase())) { author = segMatch[1]; break; }
        }

        // Timestamp — try abbr/time first, then aria-label on links (Facebook 2025+ uses relative spans)
        const timeEl = article.querySelector('abbr[data-utime], time[datetime]');
        let timestamp = timeEl?.getAttribute('data-utime') || timeEl?.getAttribute('datetime') || null;
        if (!timestamp) {
          const timeLink = allLinks.find((a) => a.querySelector('span') && /\d/.test(a.textContent));
          const ariaLabel = timeLink?.getAttribute('aria-label') || timeLink?.querySelector('[aria-label]')?.getAttribute('aria-label');
          timestamp = ariaLabel || timeLink?.textContent?.trim() || null;
        }

        // Post URL — prefer permalink
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

    const prevSize = results.size;
    rawResults.forEach((raw) => {
      if (!results.has(raw.id)) {
        results.set(raw.id, normalizeSearchResult(raw));
      }
    });

    if (onProgress) onProgress({ scraped: results.size, limit });
    if (results.size === prevSize) { retries++; } else { retries = 0; }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
  }

  return Array.from(results.values()).slice(0, limit);
}

// ============================================================================
// Group Members Scraper (Story 4.6 — FR-20, read-only)
// ============================================================================

// assertFacebookUrl duplicated here to avoid a circular dependency:
// api/services/facebookAutomation.js already imports from this file.
// Keep in sync with api/services/facebookAutomation.js#assertFacebookUrl.
function assertFacebookUrlLocal(url, label = 'URL') {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error(`❌ ${label} must be a non-empty string`);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw new Error(`❌ ${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`❌ ${label} must be an http(s) URL`);
  }
  const host = parsed.hostname.toLowerCase();
  // Faux-suffix guard: 'notfacebook.com'.endsWith('facebook.com') is true, so an
  // exact-match-OR-dot-prefixed check is required to block look-alike hosts (SSRF).
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) {
    throw new Error(`❌ ${label} must be a facebook.com URL`);
  }
}

// NFR-11: strip phone numbers and email addresses from any text field.
// Applied at normalizer level — NOT a caller option.
const PII_PHONE_RE = /(\+?\d[\d\s\-().]{7,}\d)/g;
const PII_EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function stripPii(value) {
  if (!value || typeof value !== 'string') return value ?? null;
  const cleaned = value.replace(PII_PHONE_RE, '').replace(PII_EMAIL_RE, '').trim();
  return cleaned || null;
}

/**
 * Normalize a raw group member row into the standard member shape.
 * NFR-11: phone/email stripped at this layer before returning to caller.
 *
 * @param {{ name: string|null, username: string|null, profileUrl: string }} raw
 * @returns {{ name: string|null, username?: string, profileUrl: string, platform: 'facebook' }}
 */
function normalizeGroupMember(raw) {
  const name = stripPii(raw.name);
  const username = raw.username ? stripPii(raw.username) : undefined;
  const result = { name, profileUrl: raw.profileUrl, platform: 'facebook' };
  if (username !== undefined) result.username = username;
  return result;
}

/**
 * Scrape the member list of a Facebook group (Story 4.6 — FR-20).
 * READ-ONLY scrape — NOT routed through runGuardedBatch (NFR-7 lists only writes).
 * No account-risk warning (NFR-8 lists only writes). Standard 1-3s scroll delay (NFR1).
 *
 * Returns an array of normalized members when the list is accessible,
 * or a { note, platform } object when the list is restricted/unavailable.
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string} groupUrl - facebook.com group URL
 * @param {Object} [options]
 * @param {number} [options.limit=100] - Max members to collect
 * @param {number} [options.maxStalls=5] - Stop after N consecutive scrolls with no new members
 * @param {Function} [options.delay] - Injectable delay seam (default: randomDelay 1-3s)
 * @param {Function} [options.onProgress] - Called each scroll: ({ scraped, limit })
 * @returns {Promise<Array|{ note: string, platform: 'facebook' }>}
 */
export async function scrapeGroupMembers(page, groupUrl, options = {}) {
  const {
    limit = 100,
    maxStalls = 5,
    delay = randomDelay,
    onProgress,
  } = options;

  // AC5: URL validation before any navigation (SSRF guard).
  assertFacebookUrlLocal(groupUrl, 'scrapeGroupMembers: groupUrl');

  // Navigate to the group members tab (UNVERIFIED URL pattern — see selectors-facebook.md).
  const membersUrl = groupUrl.replace(/\/$/, '') + '/members';
  await page.goto(membersUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await delay(1000, 3000);

  // Detect member list — look for member links pattern: /groups/{groupId}/user/{userId}/
  // This is the actual Facebook DOM structure (verified August 2026).
  let containerFound = false;
  try {
    // Wait for any member link to appear
    await page.waitForSelector('a[href*="/groups/"][href*="/user/"]', { timeout: 8000 });
    containerFound = true;
  } catch (_) {
    // Member list not accessible → restricted group
  }

  if (!containerFound) {
    return {
      note: 'Facebook group member list is not accessible. The group may be private, membership may be required, or the admin has disabled the member list.',
      platform: 'facebook',
    };
  }

  // AC4: Bounded scroll loop — stall detection + limit cap.
  const members = new Map(); // keyed by profileUrl for deduplication
  let stalls = 0;

  while (members.size < limit && stalls < maxStalls) {
    const prevSize = members.size;

    // Extract member links directly from DOM.
    // Facebook renders members as links: /groups/{groupId}/user/{userId}/
    const rawMembers = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('a[href*="/groups/"][href*="/user/"]').forEach(a => {
        const href = a.getAttribute('href') || '';
        const name = a.textContent.trim();
        if (name && href && name.length > 1 && name.length < 100) {
          const fullUrl = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          results.push({
            name,
            profileUrl: fullUrl.split('?')[0],
            username: href.split('/').filter(Boolean).pop() || null,
          });
        }
      });
      return results;
    });

    for (const raw of rawMembers) {
      if (!members.has(raw.profileUrl)) {
        members.set(raw.profileUrl, normalizeGroupMember(raw));
      }
      if (members.size >= limit) break;
    }

    if (onProgress) onProgress({ scraped: members.size, limit });

    if (members.size === prevSize) {
      stalls++;
    } else {
      stalls = 0;
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1000, 3000);
  }

  return Array.from(members.values()).slice(0, limit);
}

// ============================================================================
// Marketplace Scraper
// ============================================================================

/**
 * Normalize a raw marketplace listing into the standard shape.
 * NFR-11: phone/email stripped at this layer before returning to caller.
 *
 * @param {Object} raw - Raw listing fields from page.evaluate
 * @returns {Object} Normalized marketplace listing
 */
function normalizeMarketplaceListing(raw) {
  const { id, title, price, location, image, listingUrl, seller, sellerUrl, category } = raw;
  return {
    id: id || null,
    title: title || null,
    price: price || null,
    location: location || null,
    image: image || null,
    listingUrl: listingUrl || null,
    seller: stripPii(seller) || null,
    sellerUrl: sellerUrl || null,
    category: category || null,
    platform: 'facebook',
    source: 'marketplace',
  };
}

/**
 * Scrape Facebook Marketplace listings by search query or category.
 *
 * @param {Object} page - Puppeteer page (authenticated)
 * @param {string} query - Search query (e.g. "iphone 15") or category path
 * @param {Object} [options]
 * @param {number} [options.limit=50] - Max listings to return
 * @param {string} [options.location] - Location filter (city name or "near me")
 * @param {number} [options.minPrice] - Minimum price filter
 * @param {number} [options.maxPrice] - Maximum price filter
 * @param {string} [options.category] - Category slug (e.g. "phones", "vehicles", "furniture")
 * @param {Function} [options.onProgress] - Called each scroll: ({ scraped, limit })
 * @param {Function} [options.delay=randomDelay] - Injectable delay seam
 * @returns {Promise<Array>} Array of normalized marketplace listings
 */
export async function scrapeMarketplace(page, query, options = {}) {
  const {
    limit = 50,
    location,
    minPrice,
    maxPrice,
    category,
    onProgress,
    delay = randomDelay,
  } = options;

  if (!query || typeof query !== 'string' || !query.trim()) {
    throw new Error('❌ Marketplace search requires a non-empty query string');
  }

  // Build search URL
  let searchUrl = `${FACEBOOK_BASE}/marketplace/search/?query=${encodeURIComponent(query.trim())}`;
  if (category) {
    searchUrl = `${FACEBOOK_BASE}/marketplace/category/${encodeURIComponent(category)}/?query=${encodeURIComponent(query.trim())}`;
  }
  if (location) {
    searchUrl += `&location=${encodeURIComponent(location)}`;
  }
  if (minPrice) {
    searchUrl += `&minPrice=${minPrice}`;
  }
  if (maxPrice) {
    searchUrl += `&maxPrice=${maxPrice}`;
  }

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await delay(2000, 4000);

  // Wait for listings to load
  try {
    await page.waitForSelector('[role="main"], [data-testid="marketplace_search_results"], div[style*="grid"]', { timeout: 10000 });
  } catch (_) {
    // Proceed anyway - selectors may differ
  }

  const listings = new Map();
  let stalls = 0;
  const maxStalls = 5;

  while (listings.size < limit && stalls < maxStalls) {
    const prevSize = listings.size;

    // Extract listings from the current viewport
    const rawListings = await page.evaluate(() => {
      const results = [];

      // Marketplace listings are anchor links to /marketplace/item/{id}/
      const cards = [...document.querySelectorAll('a[href*="/marketplace/item/"], a[href*="/marketplace/listing/"]')];

      for (const card of cards) {
        const href = card.getAttribute('href') || '';
        if (!href.includes('marketplace/')) continue;

        const listingUrl = href.startsWith('http') ? href.split('?')[0] : `https://www.facebook.com${href.split('?')[0]}`;
        const id = listingUrl.split('/').filter(Boolean).pop() || listingUrl;

      // Facebook Marketplace card text format (verified 2026-08):
      // "{Price}{Title}{Location}" all concatenated without separators.
      // Examples: "$115,000Iphone+15+ProMaxJijiga", "CA$50,000LoveHarar"
      // Price is always first, title follows, location is trailing city/region name.
      const allText = card.textContent?.trim() || '';

      // Extract price — matches currency symbols + digits (e.g. $115,000 | CA$50,000 | ETB28,000)
      let price = null;
      const priceMatch = allText.match(/^([\$€£¥₹A-Z]*\s*[\d,]+(?:\.\d{2})?(?:\s*(?:USD|EUR|VND|ETB))?)/i);
      if (priceMatch) {
        price = priceMatch[1].trim();
      }

      // Extract title and location from remaining text
      let title = null;
      let location = null;
      if (price) {
        const afterPrice = allText.substring(price.length).trim().replace(/\+/g, ' ');

        // Split camelCase boundaries: "Iphone 15 ProMaxJijiga" → "Iphone 15 Pro Max Jijiga"
        // Insert space before uppercase letters that follow lowercase letters/digits
        const expanded = afterPrice.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

        // Location is typically the last 1-2 words that look like a place name
        // (capitalized, not part of product name). Split and analyze.
        const words = expanded.split(/\s+/).filter(Boolean);

        if (words.length >= 2) {
          // Check if last word looks like a location (capitalized, short, common city pattern)
          const lastWord = words[words.length - 1];
          const secondLast = words.length >= 2 ? words[words.length - 2] : null;

          // Location patterns: capitalized word at end, possibly preceded by another capitalized word
          // Common patterns: "Jijiga", "Harar", "Dire Dawa", "Addis Ababa"
          const looksLikeLocation = (w) =>
            /^[A-Z][a-z]+$/.test(w) &&
            !/^(Iphone|Ipad|Macbook|Samsung|Sony|Nike|Adidas|Pro|Max|Plus|Mini|Air|Ultra)/i.test(w);

          if (looksLikeLocation(lastWord)) {
            // Check if second-to-last is also a location word (e.g. "Dire Dawa")
            if (secondLast && looksLikeLocation(secondLast)) {
              location = `${secondLast} ${lastWord}`;
              title = words.slice(0, -2).join(' ');
            } else {
              location = lastWord;
              title = words.slice(0, -1).join(' ');
            }
          } else {
            title = expanded;
          }
        } else if (words.length === 1) {
          title = expanded;
        }
      }

        // Extract image
        const imgEl = card.querySelector('img');
        const image = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;

        if (id && (title || price)) {
          results.push({ id, title, price, location, image, listingUrl });
        }
      }

      return results;
    });

    for (const raw of rawListings) {
      if (!listings.has(raw.id)) {
        listings.set(raw.id, normalizeMarketplaceListing(raw));
      }
      if (listings.size >= limit) break;
    }

    if (onProgress) onProgress({ scraped: listings.size, limit });

    if (listings.size === prevSize) {
      stalls++;
    } else {
      stalls = 0;
    }

    // Scroll to load more listings
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500, 3000);
  }

  return Array.from(listings.values()).slice(0, limit);
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  createBrowser,
  createPage,
  loginWithCookie,
  generateTotp,
  loginWithPassword,
  scrapeProfile,
  scrapeFollowers,
  scrapeTweets,
  searchTweets,
  scrapeGroupMembers,
  scrapeMarketplace,
};
