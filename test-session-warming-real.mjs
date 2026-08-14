#!/usr/bin/env node
/**
 * Real-browser integration test for Story 6.15 (Session Warming Sequence — ADR-016)
 * Tests warmSession on a real Puppeteer browser instance.
 *
 * Usage:
 *   node test-session-warming-real.mjs
 */

import { createBrowser, createPage, loginWithCookie } from './src/scrapers/facebook/index.js';
import { warmSession } from './src/scrapers/facebook/warmup.js';

const LIVE_ACCOUNT = {
  c_user: '61590577116318',
  xs: '10:59pMl_22dx8P1g:2:1786466772:-1:-1',
  datr: 'Y0QoanJ71XdGKTvfyt5gbuJz',
};

async function main() {
  console.log('====================================================');
  console.log('🚀 Real Browser Test — Story 6.15 (Session Warming Sequence)');
  console.log('====================================================\n');

  const headless = process.env.PUPPETEER_HEADLESS !== 'false';
  const browser = await createBrowser({ headless });

  try {
    const page = await createPage(browser);

    // Instant delay for test speed, but execute real browser scrolls and mouse movements
    const testDelayFn = async (ms) => new Promise(r => setTimeout(r, Math.min(ms, 100)));

    console.log('--- Test 1: warmSession on Real Browser Page ---');
    const res = await warmSession(page, { delayFn: testDelayFn });

    console.log(`Warming steps executed : ${res.steps.join(' -> ')}`);
    console.log(`Duration               : ${res.durationMs} ms`);

    if (!res.steps.includes('complete') || res.error) {
      throw new Error(`❌ Test 1 failed: warmSession did not complete successfully (${res.error})`);
    }
    console.log('✅ Test 1 PASSED: warmSession executed scroll & mouse moves on real browser\n');

    console.log('--- Test 2: loginWithCookie Automatic Warming ---');
    console.log('Logging in with live account (automatic warming enabled)...');
    await loginWithCookie(page, LIVE_ACCOUNT, { delayFn: testDelayFn });

    const finalUrl = page.url();
    console.log(`Final URL after login + warming: ${finalUrl}`);

    if (finalUrl.includes('login') || finalUrl.includes('checkpoint')) {
      throw new Error(`❌ Test 2 failed: redirected to ${finalUrl}`);
    }
    console.log('✅ Test 2 PASSED: loginWithCookie completed warming & left page on Facebook homepage\n');

    console.log('====================================================');
    console.log('🎉 ALL REAL BROWSER TESTS PASSED FOR STORY 6.15!');
    console.log('====================================================');

  } finally {
    await browser.close();
    console.log('🏁 Browser closed.');
  }
}

main().catch((err) => {
  console.error('❌ Real Browser Test Failed:', err);
  process.exit(1);
});
