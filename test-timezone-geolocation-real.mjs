#!/usr/bin/env node
/**
 * Real-browser integration test for Story 6.16 (Timezone & Geolocation Override — ADR-016)
 * Tests createPage with proxyLocation on a real Puppeteer browser.
 *
 * Usage:
 *   node test-timezone-geolocation-real.mjs
 */

import { createBrowser, createPage } from './src/scrapers/facebook/index.js';

async function main() {
  console.log('====================================================');
  console.log('🚀 Real Browser Test — Story 6.16 (Timezone & Geolocation Override)');
  console.log('====================================================\n');

  const headless = process.env.PUPPETEER_HEADLESS !== 'false';
  let browser;
  try {
    browser = await createBrowser({ headless });
  } catch (err) {
    console.error('❌ Failed to create browser:', err.message);
    console.log('ℹ️  Skipping real-browser test (no Puppeteer browser available).');
    process.exit(2);
  }

  try {
    console.log('--- Test 1: createPage with proxyLocation ---');
    const proxyLocation = {
      timezone: 'America/New_York',
      latitude: 40.7128,
      longitude: -74.0060,
      accuracy: 100,
    };

    const page = await createPage(browser, { proxyLocation });

    // Verify inside page context that Intl.DateTimeFormat uses the overridden timezone
    const evaluatedTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log(`Evaluated page timezone : ${evaluatedTz} (Expected: America/New_York)`);

    if (evaluatedTz !== 'America/New_York') {
      throw new Error(`❌ Test 1 failed: expected timezone America/New_York, got ${evaluatedTz}`);
    }
    console.log('✅ Test 1 PASSED: page.emulateTimezone correctly set IANA timezone in browser context\n');

    console.log('--- Test 2: createPage without proxyLocation (backward compat) ---');
    const page2 = await createPage(browser);
    const defaultTz = await page2.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    console.log(`Default page timezone   : ${defaultTz}`);
    console.log('✅ Test 2 PASSED: createPage without proxyLocation functions normally\n');

    console.log('====================================================');
    console.log('🎉 ALL REAL BROWSER TESTS PASSED FOR STORY 6.16!');
    console.log('====================================================');

  } finally {
    if (browser) {
      await browser.close().catch((err) => console.warn('⚠️ Browser close warning:', err.message));
      console.log('🏁 Browser closed.');
    }
  }
}

main().catch((err) => {
  console.error('❌ Real Browser Test Failed:', err);
  process.exit(1);
});
