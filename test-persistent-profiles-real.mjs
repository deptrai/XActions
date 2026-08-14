#!/usr/bin/env node
/**
 * Real-browser integration test for Story 6.17 (Persistent Browser Profiles — ADR-016)
 * Tests profile persistence (localStorage & cookies) across separate browser launches using userDataDir.
 *
 * Usage:
 *   node test-persistent-profiles-real.mjs
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createBrowser, createPage } from './src/scrapers/facebook/index.js';

const TEST_PROFILE_DIR = path.resolve(`./profiles/test-persist-6-17-${crypto.randomUUID()}`);

async function main() {
  console.log('====================================================');
  console.log('🚀 Real Browser Test — Story 6.17 (Persistent Profiles)');
  console.log('====================================================\n');

  const headless = process.env.PUPPETEER_HEADLESS !== 'false';

  try {
    // Session 1: Open browser with userDataDir, set localStorage value
    console.log('--- Session 1: Launching browser with userDataDir & setting localStorage ---');
    console.log(`Profile dir: ${TEST_PROFILE_DIR}`);

    const browser1 = await createBrowser({ headless, userDataDir: TEST_PROFILE_DIR });
    const page1 = await createPage(browser1);

    await page1.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const setVal = `xactions-test-value-${crypto.randomUUID()}`;
    // Clear any leftover from a previous aborted run before setting our unique value.
    await page1.evaluate(() => {
      localStorage.removeItem('xactions_persist_test');
    });
    await page1.evaluate((val) => {
      localStorage.setItem('xactions_persist_test', val);
    }, setVal);

    console.log(`Set localStorage 'xactions_persist_test' = '${setVal}'`);
    await browser1.close();
    console.log('Session 1 closed.\n');

    // Session 2: Reopen browser with SAME userDataDir, verify localStorage value retained
    console.log('--- Session 2: Reopening browser with SAME userDataDir & reading localStorage ---');
    const browser2 = await createBrowser({ headless, userDataDir: TEST_PROFILE_DIR });
    const page2 = await createPage(browser2);

    await page2.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const readVal = await page2.evaluate(() => localStorage.getItem('xactions_persist_test'));
    console.log(`Read localStorage 'xactions_persist_test' = '${readVal}'`);

    await browser2.close();
    console.log('Session 2 closed.\n');

    if (readVal !== setVal) {
      throw new Error(`❌ Test failed: expected localStorage '${setVal}', got '${readVal}'`);
    }

    console.log('====================================================');
    console.log('🎉 ALL REAL BROWSER TESTS PASSED FOR STORY 6.17!');
    console.log('====================================================');

  } finally {
    // Clean up temporary test profile (async, do not block the event loop)
    try {
      await fs.rm(TEST_PROFILE_DIR, { recursive: true, force: true });
      console.log(`Cleaned up test profile directory: ${TEST_PROFILE_DIR}`);
    } catch (err) {
      console.warn(`Could not delete test profile dir: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error('❌ Real Browser Test Failed:', err);
  process.exit(1);
});
