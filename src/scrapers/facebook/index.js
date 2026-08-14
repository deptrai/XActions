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

import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { generateSync as totpGenerateSync } from 'otplib';
import { generateFingerprint, applyFingerprint, applyNavigatorOverrides, applyWebRTCOverride } from './fingerprint.js';
import { warmSession } from './warmup.js';
import { extractHydrationJson } from './hydration.js';

export { warmSession };

// Configure stealth for all Facebook sessions. Persistent profiles conflict with the
// iframe.contentWindow evasion (ADR-016). Per-call reconfiguration is not reliable with
// puppeteer-extra, so we use the spec-allowed fallback and disable it globally.
const allEvasions = [...StealthPlugin().opts.availableEvasions];
const facebookEvasions = new Set(allEvasions.filter((e) => e !== 'iframe.contentWindow'));
puppeteer.use(StealthPlugin({ enabledEvasions: facebookEvasions }));

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
 * Create a browser instance for Facebook scraping (Story 6.17 — ADR-016 persistent profile).
 * @param {Object} options - Browser launch options
 * @param {string} [options.userDataDir] - Profile directory path (auto-created if missing)
 * @returns {Promise<Browser>} Puppeteer browser instance
 */
export async function createBrowser(options = {}) {
  const { args: extraArgs = [], headless, proxy, launchImpl, executablePath, userDataDir, proxyAuth, proxyLocation, fingerprint, skipWarmup, ...rest } = options;
  const stealthArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-webrtc', // Story 6.5 — prevent real IP leak via STUN (defense-in-depth with JS override)
  ];

  let mergedArgs = [...stealthArgs, ...(proxy ? [`--proxy-server=${proxy}`] : []), ...extraArgs];

  // Auto-create profile directory and strip --incognito when persistent profile is used (Story 6.17 — AC2, AC3)
  if (userDataDir != null) {
    if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
      throw new Error('❌ userDataDir must be a non-empty string');
    }

    const resolvedDir = path.resolve(userDataDir);
    const relativeToCwd = path.relative(process.cwd(), resolvedDir);
    if (path.isAbsolute(relativeToCwd) || relativeToCwd.startsWith('..')) {
      throw new Error('❌ userDataDir must be within the current working directory');
    }

    try {
      fs.mkdirSync(resolvedDir, { recursive: true });
    } catch {
      throw new Error('❌ Failed to create profile directory');
    }

    if (mergedArgs.some((a) => /^--incognito(?:=.*)?$/i.test(a))) {
      console.warn('⚠️ Stripping --incognito flag because persistent profile (userDataDir) is enabled');
      mergedArgs = mergedArgs.filter((a) => !/^--incognito(?:=.*)?$/i.test(a));
    }

    console.warn('⚠️ Persistent profile launch uses stealth without iframe.contentWindow evasion (ADR-016 conflict mitigation)');
  }

  // launchImpl seam: tests inject a fake launcher so no real browser spawns.
  const launch = launchImpl ?? puppeteer.launch.bind(puppeteer);

  // Resolve executablePath: explicit option → env var → system Chrome → puppeteer default
  const resolvedExecutablePath = executablePath
    || process.env.PUPPETEER_EXECUTABLE_PATH
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  const launchOpts = {
    headless: headless !== undefined ? headless : 'new',
    args: mergedArgs,
    executablePath: resolvedExecutablePath,
    ...rest,
  };

  if (userDataDir != null) {
    launchOpts.userDataDir = userDataDir;
  }

  return launch(launchOpts);
}

/**
 * Apply timezone and geolocation overrides matching proxy location (Story 6.16 — ADR-016).
 *
 * @param {Page} page - Puppeteer page instance
 * @param {Object} [proxyLocation] - location descriptor matching proxy
 * @param {string} [proxyLocation.timezone] - IANA timezone (e.g. 'America/New_York')
 * @param {number} [proxyLocation.latitude] - latitude (-90..90)
 * @param {number} [proxyLocation.longitude] - longitude (-180..180)
 * @param {number} [proxyLocation.lat] - latitude alias
 * @param {number} [proxyLocation.lng] - longitude alias
 * @param {number} [proxyLocation.accuracy] - optional geolocation accuracy in meters
 */
export async function applyProxyLocation(page, proxyLocation) {
  if (!proxyLocation) return;

  const timezone = proxyLocation.timezone;
  const lat = proxyLocation.latitude ?? proxyLocation.lat;
  const lng = proxyLocation.longitude ?? proxyLocation.lng;
  const accuracy = proxyLocation.accuracy;

  const isValidTz = typeof timezone === 'string' && timezone.trim().length > 0;
  const isValidLat = typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const isValidLng = typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;

  if (!isValidTz || !isValidLat || !isValidLng) {
    console.warn('⚠️ Skipped proxy location override: missing or invalid timezone/coordinates');
    return;
  }

  try {
    await page.emulateTimezone(timezone.trim());

    const geo = { latitude: lat, longitude: lng };
    if (typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0) {
      geo.accuracy = accuracy;
    }
    await page.setGeolocation(geo);

    await page.browserContext().overridePermissions('https://www.facebook.com', ['geolocation']);
  } catch (err) {
    throw new Error('❌ Failed to apply proxy location', { cause: err });
  }
}

/**
 * Create a new Puppeteer page pre-configured with anti-detection fingerprinting.
 *
 * A fingerprint (UA + viewport + hardware config) is generated once and applied
 * via `applyFingerprint` (UA + viewport), then `applyNavigatorOverrides` (navigator
 * properties via evaluateOnNewDocument), then `applyWebRTCOverride` (WebRTC leak
 * prevention), then `applyProxyLocation` (timezone & geolocation). The fingerprint is
 * attached as `page._fingerprint` so callers can reuse it across tabs via
 * `createPage(browser, { fingerprint })`.
 *
 * @param {Browser} browser - Puppeteer browser instance
 * @param {Object} [options]
 * @param {Object} [options.fingerprint] - explicit fingerprint for session reuse
 * @param {Object} [options.proxyLocation] - proxy location descriptor { timezone, latitude, longitude }
 * @returns {Promise<Page>} Puppeteer page instance with `page._fingerprint` set
 */
export async function createPage(browser, options = {}) {
  const page = await browser.newPage();

  // Apply proxy authentication before any navigation so the proxy accepts the browser connection.
  const proxyAuth = options.proxyAuth;
  if (proxyAuth && typeof proxyAuth.username === 'string' && typeof proxyAuth.password === 'string') {
    await page.authenticate({ username: proxyAuth.username, password: proxyAuth.password });
  }

  const fingerprint = options.fingerprint ?? generateFingerprint();
  try {
    await applyFingerprint(page, fingerprint);
    await applyNavigatorOverrides(page, fingerprint);
    await applyWebRTCOverride(page);
    await applyProxyLocation(page, options.proxyLocation);
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
export async function loginWithCookie(page, cookies = {}, options = {}) {
  const combined = { ...cookies, ...options };
  const { c_user, xs, sb, datar, fr, fbl_st, locale, headless = true, skipWarmup = false } = combined;
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
  // expires is set far in the future so cookies are written to disk when persistent
  // profiles are used (Story 6.17 — AC2). Values are not echoed (NFR3).
  const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const fbCookies = [
    { name: 'c_user', value: c_user, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry },
    { name: 'xs', value: xs, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry },
  ];

  // Optional but important cookies for full session.
  if (sb?.trim()) fbCookies.push({ name: 'sb', value: sb, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });
  if (datar?.trim()) fbCookies.push({ name: 'datr', value: datar, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });
  if (fr?.trim()) fbCookies.push({ name: 'fr', value: fr, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });
  if (fbl_st?.trim()) fbCookies.push({ name: 'fbl_st', value: fbl_st, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });
  if (locale?.trim()) fbCookies.push({ name: 'locale', value: locale, domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry });

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
  const currentUrl = page.url();
  const authCheck = (await page.evaluate(() => {
    const bodyText = document.body?.innerText || '';
    const hasLoginForm = !!document.querySelector?.('form[action*="login"], [data-testid="royal_login_form"]');
    const hasLoginButton = bodyText.includes('Log in') && bodyText.includes('password');
    // Facebook security check / CAPTCHA indicators (multi-language, various phrasings)
    const hasSecurityCheck = bodyText.includes('confirmez que vous êtes une personne') ||
      bodyText.includes('confirm that you are a real person') ||
      (bodyText.includes('confirm that you') && bodyText.includes('human')) ||
      bodyText.includes("confirm you're human") ||
      bodyText.includes('Confirm you') ||
      bodyText.includes("you're human") ||
      bodyText.includes('Enter the text from the image') ||
      bodyText.includes('hear this code');
    return { hasLoginForm, hasLoginButton, hasSecurityCheck };
  })) || {};

  if (authCheck.hasLoginForm || authCheck.hasLoginButton) {
    throw new Error('❌ Facebook cookie authentication failed — session expired or invalid cookies');
  }

  if (authCheck.hasSecurityCheck || currentUrl.includes('/checkpoint/')) {
    throw new Error('❌ Facebook security check detected — manual verification required (CAPTCHA/anti-bot)');
  }

  // Store account ID on page context for downstream age/velocity lookup (Story 6.14 — AC5)
  page._fbAccountId = c_user;

  // Step 6: Session warming sequence (Story 6.15 — ADR-016, AC3, AC4)
  // Skip condition per ADR-016: skip when headless === false AND skipWarmup === true (debug mode)
  const isDebugSkip = headless === false && skipWarmup === true;
  if (!isDebugSkip) {
    try {
      const warmupOpts = { ...options, skipWarmup };
      await warmSession(page, warmupOpts);
    } catch (err) {
      console.warn(`⚠️ loginWithCookie: session warming warning — ${err?.message ?? err}`);
    }
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
// Multi-Type Search Normalizers (pure — testable without Puppeteer)
// ============================================================================

function extractHandleFromUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  try {
    const u = new URL(input);

    // Numeric profile URLs: facebook.com/profile.php?id=123
    const idMatch = u.search.match(/[?&]id=(\d+)/);
    if (idMatch) return idMatch[1];

    const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) return null;

    // For pages that use the /pages/<name>/<id> path, the last segment is the id.
    // For groups /groups/<id>, the last segment is the id.
    // For people /people/<name>/<id> or /<username>, the last usable segment is the id/handle.
    return parts.at(-1);
  } catch {
    return null;
  }
}

export function normalizePostSearchResult(raw) {
  const {
    id,
    text,
    message,
    message_text,
    messageText,
    author,
    actor,
    timestamp,
    published_time,
    publishedTime,
    url,
    postUrl,
  } = raw || {};

  const resolvedText = text || message || message_text || messageText || null;
  const resolvedUrl = url || postUrl || null;
  const resolvedId = id || resolvedUrl || resolvedText?.slice(0, 60) || null;

  return {
    id: resolvedId,
    text: resolvedText,
    author: author || actor?.name || actor?.id || null,
    timestamp: timestamp || published_time || publishedTime || null,
    url: resolvedUrl,
    platform: 'facebook',
  };
}

export function normalizePeopleSearchResult(raw) {
  const {
    id,
    name,
    username,
    url,
    profileUrl,
    profile_picture,
    image,
  } = raw || {};

  const resolvedUrl = url || profileUrl || (id && /^\d+$/.test(String(id)) ? `${FACEBOOK_BASE}/profile.php?id=${id}` : null);
  const derivedUsername = extractHandleFromUrl(resolvedUrl);
  const resolvedUsername = (
    typeof username === 'string' &&
    username.trim() &&
    !/facebook\.com|[?&#]|^https?:|^\s*$/i.test(username.trim())
  ) ? username.trim() : derivedUsername;
  const resolvedId = id || resolvedUsername || resolvedUrl || null;

  return {
    id: resolvedId,
    name: name || null,
    username: resolvedUsername,
    profileUrl: resolvedUrl,
    image: profile_picture || image || null,
    platform: 'facebook',
  };
}

export function normalizePageSearchResult(raw) {
  const {
    id,
    name,
    category,
    category_name,
    categoryName,
    likes,
    fan_count,
    fanCount,
    url,
    pageUrl,
    profile_picture,
    image,
  } = raw || {};

  const resolvedUrl = url || pageUrl || (id && /^\d+$/.test(String(id)) ? `${FACEBOOK_BASE}/pages/${id}` : null);
  const resolvedId = id || resolvedUrl || null;

  return {
    id: resolvedId,
    name: name || null,
    category: category || category_name || categoryName || null,
    likes: likes || fan_count || fanCount || null,
    pageUrl: resolvedUrl,
    image: profile_picture || image || null,
    platform: 'facebook',
  };
}

export function normalizeGroupSearchResult(raw) {
  const {
    id,
    name,
    members,
    member_count,
    memberCount,
    privacy,
    url,
    groupUrl,
    profile_picture,
    image,
  } = raw || {};

  const resolvedUrl = url || groupUrl || (id && /^\d+$/.test(String(id)) ? `${FACEBOOK_BASE}/groups/${id}` : null);
  const resolvedId = id || resolvedUrl || null;

  return {
    id: resolvedId,
    name: name || null,
    members: members || member_count || memberCount || null,
    privacy: privacy || null,
    groupUrl: resolvedUrl,
    image: profile_picture || image || null,
    platform: 'facebook',
  };
}

// ============================================================================
// Multi-Type Search
// ============================================================================

const VALID_SEARCH_TYPES = new Set(['posts', 'people', 'pages', 'groups', 'all']);

const SEARCH_TYPE_URLS = {
  posts: '/search/posts/',
  people: '/search/people/',
  pages: '/search/pages/',
  groups: '/search/groups/',
};

const SEARCH_TYPENAMES = {
  posts: ['Story'],
  people: ['User'],
  pages: ['Page'],
  groups: ['Group'],
};

function normalizeByType(raw, type) {
  switch (type) {
    case 'posts': return normalizePostSearchResult(raw);
    case 'people': return normalizePeopleSearchResult(raw);
    case 'pages': return normalizePageSearchResult(raw);
    case 'groups': return normalizeGroupSearchResult(raw);
    default: return null;
  }
}

function isCheckpointUrl(url) {
  if (typeof url !== 'string') return false;
  return url.includes('/checkpoint/') || url.includes('facebook.com/checkpoint');
}

async function assertNoCheckpoint(page, source = 'search') {
  const currentUrl = typeof page.url === 'function' ? page.url() : null;
  if (isCheckpointUrl(currentUrl)) {
    throw new Error(`❌ Facebook ${source} hit a checkpoint. Account may need security review.`);
  }

  // Check the page body for checkpoint/security-check language.
  let hasBodyCheckpoint = false;
  if (typeof page.evaluate === 'function') {
    try {
      hasBodyCheckpoint = await page.evaluate(() => {
        if (typeof document === 'undefined' || !document.body) return false;
        const text = (document.body.innerText || document.body.textContent || '').toLowerCase();
        return text.includes('checkpoint') || text.includes('security check') || text.includes('confirm your identity');
      });
    } catch {
      // If evaluate is not available or throws, do not block the search.
    }
  }
  if (hasBodyCheckpoint === true) {
    throw new Error(`❌ Facebook ${source} hit a checkpoint. Account may need security review.`);
  }
}

function validateSearchType(type) {
  if (!type || !VALID_SEARCH_TYPES.has(type)) {
    throw new Error(`❌ search type must be one of: ${Array.from(VALID_SEARCH_TYPES).join(', ')}`);
  }
}

function validateSearchQuery(query) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('❌ search query must be a non-empty string');
  }
}

function validateSearchLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error('❌ search limit must be a positive integer');
  }
}

function buildSearchQuery(query, location) {
  let q = query.trim();
  if (typeof location === 'string' && location.trim()) {
    q = `${q} near ${location.trim()}`;
  }
  return q;
}

async function extractPostsFromDom(page) {
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
        if (/\/(settings|help|about|privacy|terms|login|checkpoint|watch|marketplace|events)\b/i.test(href)) continue;
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

  return rawResults;
}

async function extractListItemsFromDom(page, type) {
  const rawResults = await page.evaluate((searchType) => {
    const NON_ENTITY_ROOTS = new Set([
      'search', 'watch', 'marketplace', 'events', 'friends', 'photo', 'photo.php',
      'reel', 'reels', 'stories', 'hashtag', 'l.php', 'l', 'settings', 'help',
      'about', 'privacy', 'terms', 'login', 'checkpoint',
    ]);

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

    function getUniqueLines(item) {
      const text = item.innerText || item.textContent || '';
      return Array.from(new Set(text.split('\n').map((t) => t.trim()).filter(Boolean)));
    }

    const items = document.querySelectorAll('[role="listitem"], [role="article"]');
    return Array.from(items).map((item) => {
      const picked = pickBestLink(item, searchType);
      if (!picked) return null;

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
      const counts = allLines
        .map((t) => t.match(/([\d,.]+[KkMm]?\+?)\s*(members?|people|likes?)/i))
        .filter(Boolean);
      const members = counts.find((m) => /members?|people/i.test(m[0]))?.[1] || null;
      const likes = counts.find((m) => /likes?/i.test(m[0]))?.[1] || null;

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

  return rawResults;
}

async function searchByType(page, query, type, options = {}) {
  const limit = Math.max(1, Math.floor(Number(options.limit) || 30));
  const onProgress = options.onProgress;
  const maxRetries = Math.max(1, Math.floor(Number(options.maxRetries) || 8));
  const maxScrolls = Math.max(1, Math.floor(Number(options.maxScrolls) || 50));
  const delay = options.delay || randomDelay;

  const searchUrl = `${FACEBOOK_BASE}${SEARCH_TYPE_URLS[type]}?q=${encodeURIComponent(query)}`;

  await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await assertNoCheckpoint(page, `${type} search`);
  await delay(2000, 4000);

  const results = new Map();
  let retries = 0;
  let scrolls = 0;

  while (results.size < limit && retries < maxRetries && scrolls < maxScrolls) {
    const prevSize = results.size;

    const hydrated = await extractHydrationJson(page, SEARCH_TYPENAMES[type], {
      limit,
      fallbackExtractor: async () => {
        return type === 'posts'
          ? await extractPostsFromDom(page)
          : await extractListItemsFromDom(page, type);
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

  return Array.from(results.values()).slice(0, limit);
}

/**
 * Search Facebook by multiple types (posts, people, pages, groups) or all.
 * @param {Page} page - Puppeteer page instance
 * @param {string} query - Search query string
 * @param {Object} options
 * @param {string} [options.type='posts'] - 'posts' | 'people' | 'pages' | 'groups' | 'all'
 * @param {string} [options.location] - Optional location hint, appended to query
 * @param {number} [options.limit=30] - Max results per type
 * @param {boolean} [options.parallel=false] - Accepted for future multi-account fan-out; currently ignored
 * @param {Object} [options.authCookie] - { c_user, xs } passed by the dispatcher for login
 * @param {Function} [options.onProgress] - Called each scroll: ({ scraped, limit })
 * @param {number} [options.maxRetries=8] - Stop after N consecutive empty scrolls
 * @param {number} [options.maxScrolls=50] - Max scroll attempts per task
 * @param {Function} [options.delay=randomDelay] - Injectable delay seam
 * @returns {Promise<Object|Array>} Normalized results (array for single type, object for 'all')
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
 * @param {Page} page - Puppeteer page instance
 * @param {string} query - Search query string
 * @param {Object} options
 * @returns {Promise<Array>} Normalized post search result array
 */
export async function searchTweets(page, query, options = {}) {
  return searchFacebook(page, query, { ...options, type: 'posts' });
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

// Marketplace location helpers — map free-form city names to Facebook Marketplace slugs or numeric IDs.
// Slugs are discovered from https://www.facebook.com/marketplace/directory/{country}/
const MARKETPLACE_KNOWN_LOCATIONS = new Map([
  ['hochiminhcity', 'hochiminhcity'],
  ['hochiminh', 'hochiminhcity'],
  ['hcm', 'hochiminhcity'],
  ['hcmc', 'hochiminhcity'],
  ['saigon', 'hochiminhcity'],
  ['hanoi', '106388046062960'],
  ['danang', '111711568847056'],
]);

export function resolveMarketplaceLocation(input) {
  if (!input || typeof input !== 'string') return null;
  const key = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapped = MARKETPLACE_KNOWN_LOCATIONS.get(key);
  if (mapped) return mapped;
  const trimmed = input.trim().toLowerCase();
  if (/^[a-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

export function buildMarketplaceSearchUrl(query, options = {}) {
  const { location, category, minPrice, maxPrice } = options;
  const locationSlug = resolveMarketplaceLocation(location);
  let basePath = `${FACEBOOK_BASE}/marketplace`;
  if (locationSlug) {
    basePath += `/${locationSlug}`;
  }
  if (category) {
    basePath += `/category/${encodeURIComponent(category)}`;
  }
  const params = [`query=${encodeURIComponent(query.trim())}`];
  if (minPrice != null) params.push(`minPrice=${minPrice}`);
  if (maxPrice != null) params.push(`maxPrice=${maxPrice}`);
  if (location && !locationSlug) {
    params.push(`location=${encodeURIComponent(location)}`);
  }
  return `${basePath}/search/?${params.join('&')}`;
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

  const searchUrl = buildMarketplaceSearchUrl(query, { location, category, minPrice, maxPrice });

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await delay(3000, 5000);

  const finalUrl = page.url();
  if (finalUrl.includes('/checkpoint/')) {
    throw new Error('❌ Facebook checkpoint detected — manual verification required. Log in to the account via a real browser, complete the security check, then retry.');
  }

  try {
    await page.waitForFunction(
      () => document.querySelectorAll('a[href*="/marketplace/item/"], a[href*="/marketplace/listing/"]').length > 0,
      { timeout: 20000 },
    );
  } catch (_) {
    // Proceed — may still extract if cards load late or page has none.
  }

  const listings = new Map();
  let stalls = 0;
  const maxStalls = 8;

  while (listings.size < limit && stalls < maxStalls) {
    const prevSize = listings.size;

    const rawListings = await page.evaluate((evalLimit) => {
      const results = [];
      const cards = [...document.querySelectorAll('a[href*="/marketplace/item/"], a[href*="/marketplace/listing/"]')];

      for (const card of cards) {
        const href = card.getAttribute('href') || '';
        if (!href.includes('marketplace/')) continue;

        const cleanHref = href.split('?')[0];
        const id = cleanHref.split('/').filter(Boolean).pop() || '';
        if (!id || /[^0-9]/.test(id)) continue;

        const listingUrl = cleanHref.startsWith('http') ? cleanHref : `https://www.facebook.com${cleanHref}`;

        const imgEl = card.querySelector('img');
        const image = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || null;

        let title = null;
        let price = null;
        let cardLocation = null;

        const ariaLabel = card.getAttribute('aria-label')?.trim() || '';
        if (ariaLabel) {
          const m = ariaLabel.match(/^(.*),\s*(Free|(?:[A-Z]{0,3}[₫$€£¥₹₩]\s*[\d,\.]+(?:\s*(?:USD|EUR|VND|ETB|VNĐ))?)|(?:[A-Z]{2,5}\s*[\d,\.]+(?:\s*(?:USD|EUR|VND|ETB|VNĐ))?))\s*,\s*(.+?)\s*,\s*listing\s+(\d+)$/is);
          if (m) {
            title = m[1].trim().replace(/\s+/g, ' ');
            price = m[2].trim().replace(/\s+/g, ' ');
            cardLocation = m[3].trim().replace(/\s+/g, ' ');
          }
        }

        if (!title) {
          const allText = card.textContent?.trim() || '';
          const priceMatch = allText.match(/^(?:\s*Free\s*|[\$€£¥₹₫₩A-Z]*\s*[\d,]+(?:\.\d{2})?(?:\s*(?:USD|EUR|VND|ETB|VNĐ))?)/i);
          if (priceMatch) {
            price = priceMatch[0].trim().replace(/\s+/g, ' ');
            const after = allText.substring(priceMatch[0].length).trim().replace(/\+/g, ' ').replace(/\s+/g, ' ');
            const locationMatch = after.match(/(.+?)(?:\s*,\s*)?(Ho Chi Minh City(?:, Vietnam)?|Hanoi(?:, Vietnam)?|Da Nang(?:, Vietnam)?)$/i);
            if (locationMatch) {
              title = locationMatch[1].trim();
              cardLocation = locationMatch[2].trim();
            } else {
              title = after;
            }
          } else {
            title = allText;
          }
        }

        if (title || price) {
          results.push({ id, title, price, location: cardLocation, image, listingUrl });
          if (results.length >= evalLimit) break;
        }
      }

      return results;
    }, limit);

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
  searchFacebook,
  scrapeGroupMembers,
  scrapeMarketplace,
};
