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

// Facebook scraper — auth.js
import { MBASIC_BASE, FACEBOOK_BASE, randomDelay } from './core.js';
import { warmSession } from './warmup.js';
import { generateSync as totpGenerateSync } from 'otplib';


/**
 * Login to Facebook using c_user and xs cookies
 * @param {import('puppeteer').Page} page - Puppeteer page instance
 * @param {FacebookLoginCookieOptions} cookies - Cookie object with c_user and xs
 * @param {FacebookOptions} [options]
 * @throws {Error} If either cookie is missing or empty
 */
export async function loginWithCookie(page, cookies = {}, options = {}) {
  const combined = /** @type {Record<string, unknown> & FacebookLoginCookieOptions} */ ({ ...cookies, ...options });
  const { c_user, xs, sb, datar, fr, fbl_st, locale, headless = true, skipWarmup = false } = combined;
  if (!c_user?.trim() || !xs?.trim()) {
    throw new Error('❌ Facebook login requires both c_user and xs cookies');
  }

  // Use longer timeouts when visible, but always use domcontentloaded on mbasic (faster than networkidle2)
  const navTimeout = headless ? 30000 : 60000;

  // Step 1: Navigate to Facebook first so browser is on the correct domain.
  // Use mbasic (lightweight HTML, less bot detection) for the login handshake.
  await page.goto(MBASIC_BASE, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  await randomDelay(1000, 2000);

  // Step 2: Build cookie list with all fields needed for full authentication.
  // Facebook requires sameSite: "None" for cross-site cookies to work.
  // httpOnly: false allows JS to read cookies (needed for FB features).
  // expires is set far in the future so cookies are written to disk when persistent
  // profiles are used (Story 6.17 — AC2). Values are not echoed (NFR3).
  const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  /** @type {import('puppeteer').CookieParam[]} */
  const fbCookies = [
    { name: 'c_user', value: /** @type {string} */ (c_user), domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry },
    { name: 'xs', value: /** @type {string} */ (xs), domain: '.facebook.com', path: '/', httpOnly: false, secure: true, sameSite: 'None', expires: futureExpiry },
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
      console.warn(`⚠️ Skipped invalid cookie ${cookie.name}: ${(e instanceof Error ? e.message : String(e))?.substring(0, 80)}`);
    }
  }

  // Step 4: Navigate again — this sends the cookies to Facebook's server,
  // which responds with an authenticated session. Stay on mbasic for stability.
  await page.goto(MBASIC_BASE, { waitUntil: 'domcontentloaded', timeout: navTimeout });
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
    throw Object.assign(new Error('❌ Facebook cookie authentication failed — session expired or invalid cookies'), { code: 'FB_INVALID_COOKIE' });
  }

  if (authCheck.hasSecurityCheck || currentUrl.includes('/checkpoint/')) {
    throw Object.assign(new Error('❌ Facebook security check detected — manual verification required (CAPTCHA/anti-bot)'), { code: 'FB_CHECKPOINT' });
  }

  // Store account ID on page context for downstream age/velocity lookup (Story 6.14 — AC5)
  (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (page)))._fbAccountId = c_user;

  // Step 6: Session warming sequence (Story 6.15 — ADR-016, AC3, AC4)
  // Skip condition per ADR-016: skip when headless === false AND skipWarmup === true (debug mode)
  const isDebugSkip = headless === false && skipWarmup === true;
  if (!isDebugSkip) {
    try {
      const warmupOpts = { ...options, skipWarmup };
      await warmSession(page, warmupOpts);
    } catch (err) {
      console.warn(`⚠️ loginWithCookie: session warming warning — ${(err instanceof Error ? err.message : String(err)) ?? String(err)}`);
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
 * @param {FacebookPasswordCreds} [creds]
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
