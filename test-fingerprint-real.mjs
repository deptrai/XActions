#!/usr/bin/env node
/**
 * Real-cookie integration test for Story 6.2 + 6.3 — Fingerprint + UA Pool.
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
 *
 * Usage:
 *   node test-fingerprint-real.mjs
 *
 * Cookies sourced from fb-share.mjs (8 working accounts).
 * @author nichxbt
 */

import { createBrowser, createPage, loginWithCookie } from './src/scrapers/facebook/index.js';
import { UA_POOL, VIEWPORT_LIST, generateFingerprint } from './src/scrapers/facebook/fingerprint.js';

// First account from fb-share.mjs
const ACCOUNT = {
  c_user: '61551532654077',
  xs: '36:S-jWTjZkyhJFPA:2:1786256246:-1:-1',
  datr: 'hvlpaq9byAlvhl67oieOPTwH',
};

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
  console.log('=== Story 6.2 + 6.3 Real-Cookie Fingerprint Test ===\n');

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

    // ── Test 2: loginWithCookie succeeds with fingerprint ────────────────
    console.log('\n[2] loginWithCookie() succeeds with applied fingerprint');
    try {
      await loginWithCookie(page, ACCOUNT);
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 200) || '');
      log(!/log in|sign up/i.test(title),
        `Login succeeded — page title: "${title}"`);
      log(!/log in to facebook|sign up/i.test(bodyText),
        `Not on login wall — body starts: "${bodyText.slice(0, 80)}..."`);
    } catch (err) {
      log(false, `loginWithCookie failed: ${err.message}`);
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
    console.log('✅ Story 6.2 + 6.3 fingerprint works with real Facebook cookies!');
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
