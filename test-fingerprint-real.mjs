#!/usr/bin/env node
/**
 * Real-cookie integration test for Story 6.2 + 6.3 + 6.4 — Fingerprint + UA Pool + Navigator Override.
 *
 * Verifies with a REAL Facebook account:
 *   1. createPage() applies a generated fingerprint (UA + viewport)
 *   2. loginWithCookie() succeeds with the applied fingerprint
 *   3. page._fingerprint matches the UA actually seen by Facebook
 *   4. Two pages with the SAME fingerprint reuse produce identical UA
 *   5. The fingerprint UA is one of UA_POOL entries (not the old hardcoded Chrome/120)
 *   6. Story 6.3: UA is from the expanded pool (Chrome 146-152, 21 UAs)
 *   7. Story 6.3: deviceScaleFactor is platform-aware (macOS=2, Win/Linux=1)
 *   8. Story 6.3: viewport is from the expanded list (includes 2560x1440)
 *   9. Story 6.4: navigator overrides (webdriver, hardwareConcurrency, deviceMemory, platform, plugins)
 *
 * Usage:
 *   node test-fingerprint-real.mjs
 *
 * Cookies sourced from fb-share.mjs (8 working accounts).
 * @author nichxbt
 */

import { createBrowser, createPage, loginWithCookie } from './src/scrapers/facebook/index.js';
import { UA_POOL, VIEWPORT_LIST, generateFingerprint } from './src/scrapers/facebook/fingerprint.js';

// Accounts from fb-share.mjs (8 working accounts) — try in order, skip checkpointed ones
const ACCOUNTS = [
  { c_user: '61559519003000', xs: '7:f00TTOqNez43kg:2:1786256248:-1:-1', datr: 'GQlqai3ZP7-MkMTu3znEldj-' },
  { c_user: '61559273867716', xs: '13:73GhLVcs3NEbJA:2:1786256252:-1:-1', datr: '-N9sasfkoPrPvpAeUirHjnrs' },
  { c_user: '100095166129041', xs: '3:NAqbw5r9kOlO2Q:2:1786256260:-1:-1', datr: 'YPlpaq-Z7sNJ52j2_GubP0YL' },
  { c_user: '100054352380630', xs: '33:N-KiJnf77Qefmg:2:1786256260:-1:-1', datr: 'fPppaojcU4_IT4cfmpppcqw0' },
  { c_user: '100092936258699', xs: '38:PUjxlddGC97T_A:2:1786256263:-1:-1', datr: 'CvhpasVo2Zh6WmU9pRbNw0UX' },
  { c_user: '100085428323192', xs: '42:Gh_mwDFDlwgBQQ:2:1786256280:-1:-1', datr: 'MRlqauJ4fYjZYosAOTyZEL44' },
  { c_user: '100093227282603', xs: '11:Jhk6jlWHYh5Zfg:2:1786256282:-1:-1', datr: 'nRdqamM1O7tLeZT_WY_h2t13' },
  { c_user: '61551532654077', xs: '36:S-jWTjZkyhJFPA:2:1786256246:-1:-1', datr: 'hvlpaq9byAlvhl67oieOPTwH' }, // checkpointed — last resort
];

const results = [];
const log = (ok, msg) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  results.push({ ok, msg });
};

// Story 6.3 helpers
const extractChromeVersion = (ua) => {
  const m = ua.match(/Chrome\/(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
};

const derivePlatformFromUa = (ua) => {
  if (ua.includes('Windows')) return 'Win32';
  if (ua.includes('Macintosh') || ua.includes('Mac OS X')) return 'MacIntel';
  if (ua.includes('Linux')) return 'Linux x86_64';
  return 'unknown';
};

const expectedDsf = (platform) => platform === 'MacIntel' ? 2 : 1;

async function main() {
  console.log('=== Story 6.2 + 6.3 + 6.4 Real-Cookie Fingerprint Test ===\n');

  // ── Test 1: createPage applies fingerprint ──────────────────────────────
  console.log('[1] createPage() applies fingerprint (UA + viewport)');
  const browser = await createBrowser({ headless: false });
  try {
    const page = await createPage(browser);

    const appliedUa = await page.evaluate(() => navigator.userAgent);
    const appliedVp = await page.viewport();

    log(typeof page._fingerprint === 'object' && page._fingerprint !== null,
      `page._fingerprint is set: ${JSON.stringify(page._fingerprint?.ua?.slice(0, 60))}...`);
    log(appliedUa === page._fingerprint.ua,
      `Browser UA matches fingerprint.ua`);
    log(appliedVp.width === page._fingerprint.viewport.width &&
        appliedVp.height === page._fingerprint.viewport.height,
      `Browser viewport matches fingerprint.viewport (${appliedVp.width}x${appliedVp.height})`);
    log(UA_POOL.includes(page._fingerprint.ua),
      `UA is from UA_POOL (not hardcoded Chrome/120)`);
    log(!page._fingerprint.ua.includes('Chrome/120'),
      `Old hardcoded Chrome/120 UA is gone`);

    // ── Test 6: Story 6.3 — UA from expanded pool (Chrome 146-152, 21 UAs) ─
    console.log('\n[6] Story 6.3: UA from expanded pool (Chrome 146-152, 21 UAs)');
    const chromeVer = extractChromeVersion(page._fingerprint.ua);
    log(UA_POOL.length >= 20,
      `UA_POOL has ${UA_POOL.length} entries (≥20 required)`);
    log(chromeVer !== null && chromeVer >= 146 && chromeVer <= 152,
      `Chrome version ${chromeVer} is in range [146, 152]`);
    log(new Set(UA_POOL).size === UA_POOL.length,
      `UA_POOL has no duplicates (${UA_POOL.length} unique)`);

    // ── Test 7: Story 6.3 — deviceScaleFactor is platform-aware ──────────
    console.log('\n[7] Story 6.3: deviceScaleFactor is platform-aware');
    const fp = page._fingerprint;
    const expectedPlatform = derivePlatformFromUa(fp.ua);
    log(fp.platform === expectedPlatform,
      `platform "${fp.platform}" matches UA platform "${expectedPlatform}"`);
    log(fp.deviceScaleFactor === expectedDsf(fp.platform),
      `deviceScaleFactor ${fp.deviceScaleFactor} matches expected for ${fp.platform} (expected ${expectedDsf(fp.platform)})`);
    log(appliedVp.deviceScaleFactor === fp.deviceScaleFactor,
      `Browser deviceScaleFactor ${appliedVp.deviceScaleFactor} matches fingerprint`);

    // ── Test 8: Story 6.3 — viewport from expanded list (includes 2560x1440) ─
    console.log('\n[8] Story 6.3: viewport from expanded list (6 viewports, includes 2560x1440)');
    log(VIEWPORT_LIST.length >= 6,
      `VIEWPORT_LIST has ${VIEWPORT_LIST.length} entries (≥6 required)`);
    log(VIEWPORT_LIST.some(v => v.width === 2560 && v.height === 1440),
      `VIEWPORT_LIST includes 2560x1440`);
    log(VIEWPORT_LIST.some(v => v.width === fp.viewport.width && v.height === fp.viewport.height),
      `fingerprint viewport ${fp.viewport.width}x${fp.viewport.height} is from VIEWPORT_LIST`);

    // ── Test 9: Story 6.4 — navigator overrides via evaluateOnNewDocument ──
    console.log('\n[9] Story 6.4: navigator overrides (webdriver, hardwareConcurrency, deviceMemory, platform)');
    // Navigate to about:blank first so evaluateOnNewDocument takes effect
    await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
    const navProps = await page.evaluate(() => ({
      webdriver: navigator.webdriver,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      platform: navigator.platform,
      pluginsLength: navigator.plugins.length,
    }));
    log(navProps.webdriver === undefined || navProps.webdriver === false,
      `navigator.webdriver is ${navProps.webdriver} (undefined or false — not true)`);
    log(navProps.hardwareConcurrency === fp.hardwareConcurrency,
      `navigator.hardwareConcurrency ${navProps.hardwareConcurrency} === fp.hardwareConcurrency ${fp.hardwareConcurrency}`);
    log(navProps.deviceMemory === fp.deviceMemory,
      `navigator.deviceMemory ${navProps.deviceMemory} === fp.deviceMemory ${fp.deviceMemory}`);
    log(navProps.platform === fp.platform,
      `navigator.platform "${navProps.platform}" === fp.platform "${fp.platform}"`);
    log(navProps.pluginsLength > 0,
      `navigator.plugins.length ${navProps.pluginsLength} > 0 (stealth plugin active)`);

    // ── Test 2: loginWithCookie succeeds with fingerprint ────────────────
    console.log('\n[2] loginWithCookie() succeeds with applied fingerprint');
    let loginOk = false;
    let usedAccount = null;
    for (const account of ACCOUNTS) {
      try {
        await loginWithCookie(page, account);
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));
        const title = await page.title();
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || '');
        const isCheckpoint = /confirm this is your account|we locked your account/i.test(bodyText);
        const isLoginWall = /log in|sign up/i.test(title) || /log in to facebook|sign up/i.test(bodyText);
        if (!isLoginWall && !isCheckpoint) {
          loginOk = true;
          usedAccount = account;
          log(true, `Login succeeded — account ${account.c_user} — page title: "${title}"`);
          log(true, `Not on login wall — body starts: "${bodyText.slice(0, 80)}..."`);
          break;
        } else {
          console.log(`  ⚠️ Account ${account.c_user} is checkpointed/login wall — trying next...`);
        }
      } catch (err) {
        console.log(`  ⚠️ Account ${account.c_user} failed: ${err.message} — trying next...`);
      }
    }
    if (!loginOk) {
      log(false, `All ${ACCOUNTS.length} accounts failed or checkpointed`);
    }

    // ── Test 3: navigator.userAgent matches fingerprint in-page ──────────
    console.log('\n[3] navigator.userAgent in-page matches fingerprint');
    const inPageUa = await page.evaluate(() => navigator.userAgent);
    log(inPageUa === page._fingerprint.ua,
      `In-page UA === page._fingerprint.ua`);

    // ── Test 4: Second page with SAME fingerprint reuses UA ──────────────
    console.log('\n[4] Second page with same fingerprint reuses UA');
    const page2 = await createPage(browser, { fingerprint: page._fingerprint });
    const ua2 = await page2.evaluate(() => navigator.userAgent);
    log(ua2 === page._fingerprint.ua,
      `Page 2 UA matches page 1 fingerprint`);
    log(page2._fingerprint === page._fingerprint,
      `page2._fingerprint is the same object reference`);
    await page2.close();

    // ── Test 5: Third page with NEW fingerprint differs ──────────────────
    console.log('\n[5] Third page with new fingerprint differs');
    const page3 = await createPage(browser);
    const ua3 = await page3.evaluate(() => navigator.userAgent);
    log(page3._fingerprint !== page._fingerprint,
      `page3 has a different fingerprint object`);
    log(UA_POOL.includes(page3._fingerprint.ua),
      `page3 UA is also from UA_POOL`);
    // Story 6.3: verify page3 also has platform-aware deviceScaleFactor
    const fp3 = page3._fingerprint;
    log(fp3.deviceScaleFactor === expectedDsf(fp3.platform),
      `page3 deviceScaleFactor ${fp3.deviceScaleFactor} matches platform ${fp3.platform}`);
    await page3.close();

    await page.close();
  } finally {
    await browser.close();
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\n=== Results: ${passed}/${total} passed ===`);
  if (passed === total) {
    console.log('✅ Story 6.2 + 6.3 + 6.4 fingerprint works with real Facebook cookies!');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed — see above.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
