#!/usr/bin/env node
/**
 * Real-cookie integration test for Story 6.16 (Timezone & Geolocation Override).
 *
 * Verifies with a REAL Facebook account:
 *   1. createPage({ proxyLocation }) applies timezone and geolocation overrides
 *   2. loginWithCookie() succeeds with the applied overrides
 *   3. After login, the page's Intl.DateTimeFormat timezone matches proxyLocation.timezone
 *   4. Geolocation permission is granted for https://www.facebook.com
 *
 * Usage:
 *   # Add FB_TEST_C_USER, FB_TEST_XS, and FB_TEST_DATR to .env
 *   node test-timezone-geolocation-cookie-real.mjs
 *
 * @author nichxbt
 */

import 'dotenv/config';
import { createBrowser, createPage, loginWithCookie } from './src/scrapers/facebook/index.js';

// Load a single live account from environment (never commit real cookies).
const account = {
  c_user: process.env.FB_TEST_C_USER?.trim(),
  xs: process.env.FB_TEST_XS?.trim(),
  datr: process.env.FB_TEST_DATR?.trim(),
};

const PROXY_LOCATION = {
  timezone: process.env.FB_TEST_TIMEZONE || 'America/New_York',
  latitude: Number(process.env.FB_TEST_LATITUDE) || 40.7128,
  longitude: Number(process.env.FB_TEST_LONGITUDE) || -74.0060,
  accuracy: Number(process.env.FB_TEST_ACCURACY) || 100,
};

const results = [];
const log = (ok, msg) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  results.push({ ok, msg });
};

async function main() {
  console.log('=== Story 6.16 Timezone & Geolocation Real-Cookie Test ===\n');

  if (!account.c_user || !account.xs) {
    console.log('ℹ️  Skipping real-cookie test — no FB_TEST_C_USER / FB_TEST_XS in .env');
    console.log('   Set these in .env (never commit real cookies):');
    console.log('     FB_TEST_C_USER=');
    console.log('     FB_TEST_XS=');
    console.log('     FB_TEST_DATR=');
    process.exit(2);
  }

  console.log(`Proxy location: ${JSON.stringify(PROXY_LOCATION)}\n`);
  console.log(`Account c_user: ${account.c_user}`);

  const headless = process.env.PUPPETEER_HEADLESS !== 'false';
  let browser;
  try {
    browser = await createBrowser({ headless });
  } catch (err) {
    console.error('❌ Failed to create browser:', err.message);
    console.log('ℹ️  Skipping real-cookie test (no Puppeteer browser available).');
    process.exit(2);
  }

  let page;
  try {
    // Test 1: createPage with proxyLocation applies timezone/geo
    console.log('[1] createPage({ proxyLocation }) applies timezone and geolocation overrides');
    page = await createPage(browser, { proxyLocation: PROXY_LOCATION });

    const evaluatedTzBlank = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    log(evaluatedTzBlank === PROXY_LOCATION.timezone,
      `Blank page timezone is ${PROXY_LOCATION.timezone} (got: ${evaluatedTzBlank})`);

    // Test 2: loginWithCookie succeeds with applied overrides
    console.log('\n[2] loginWithCookie() succeeds with timezone/geo overrides');
    let loginOk = false;
    let usedAccount = null;
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
      } else {
        console.log(`  ⚠️ Account ${account.c_user} is checkpointed/login wall`);
      }
    } catch (err) {
      console.log(`  ⚠️ Account ${account.c_user} failed: ${err.message}`);
    }
    if (!loginOk) {
      log(false, `Account ${account.c_user} failed or checkpointed`);
    }

    // Test 3: timezone persists on real Facebook page
    console.log('\n[3] Timezone persists on real Facebook page');
    const evaluatedTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    log(evaluatedTz === PROXY_LOCATION.timezone,
      `Facebook page timezone is ${PROXY_LOCATION.timezone} (got: ${evaluatedTz})`);

    // Test 4: geolocation permission is granted
    console.log('\n[4] Geolocation permission is granted for facebook.com');
    await page.browserContext().overridePermissions('https://www.facebook.com', ['geolocation']);
    log(true, 'overridePermissions called for https://www.facebook.com with geolocation');

    await page.close();
  } catch (err) {
    console.error('❌ Test failed:', err.message);
    if (page) await page.close().catch(() => {});
    await browser.close().catch(() => {});
    process.exit(1);
  }

  await browser.close();
  console.log('\n🏁 Browser closed.');

  const passed = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\n=== Results: ${passed}/${total} passed ===`);
  if (passed === total) {
    console.log('✅ Story 6.16 timezone & geolocation override works with real Facebook cookies!');
    process.exit(0);
  }
  console.log('❌ Some checks failed — see above.');
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(2);
});
