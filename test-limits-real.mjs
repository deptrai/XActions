#!/usr/bin/env node
/**
 * Real-browser / real-environment test for Story 6.13 — Action Velocity Limiting
 *
 * Tests `limits.js` in a real Node + browser-launched context.
 * Verifies:
 *   1. LIMITS and ACCOUNT_AGE_TIERS are deeply frozen (hard floors)
 *   2. getActionLimit returns correct scaled limits
 *   3. enforceDelay with real setTimeout waits 5-15s
 *   4. No puppeteer import in limits.js
 *
 * Usage: node test-limits-real.mjs
 */

import { performance } from 'perf_hooks';
import { createBrowser, createPage } from './src/scrapers/facebook/index.js';
import {
  LIMITS,
  ACCOUNT_AGE_TIERS,
  getActionLimit,
  enforceDelay,
} from './src/scrapers/facebook/limits.js';

const results = [];
const log = (ok, msg) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  results.push(ok);
};

async function main() {
  console.log('=== Story 6.13 Real-Environment Limits Test ===\n');

  // ── Test 1: LIMITS and ACCOUNT_AGE_TIERS are deeply frozen ──────
  console.log('[1] LIMITS and ACCOUNT_AGE_TIERS are deeply frozen');
  log(Object.isFrozen(LIMITS), 'LIMITS is frozen');
  log(Object.isFrozen(LIMITS.like), 'LIMITS.like is frozen');
  log(Object.isFrozen(LIMITS.comment), 'LIMITS.comment is frozen');
  log(Object.isFrozen(LIMITS.friendRequest), 'LIMITS.friendRequest is frozen');
  log(Object.isFrozen(LIMITS.message), 'LIMITS.message is frozen');
  log(Object.isFrozen(ACCOUNT_AGE_TIERS), 'ACCOUNT_AGE_TIERS is frozen');
  log(Object.isFrozen(ACCOUNT_AGE_TIERS[0]), 'ACCOUNT_AGE_TIERS[0] is frozen');

  // ── Test 2: getActionLimit returns correct limits ───────────────
  console.log('\n[2] getActionLimit returns correct limits');
  log(JSON.stringify(getActionLimit('like')) === JSON.stringify({ perHour: 30 }), 'like mature = 30/hour');
  log(JSON.stringify(getActionLimit('comment')) === JSON.stringify({ perHour: 10 }), 'comment mature = 10/hour');
  log(JSON.stringify(getActionLimit('friendRequest')) === JSON.stringify({ perDay: 20 }), 'friendRequest mature = 20/day');
  log(JSON.stringify(getActionLimit('message')) === JSON.stringify({ perHour: 20 }), 'message mature = 20/hour');
  log(JSON.stringify(getActionLimit('like', 5)) === JSON.stringify({ perHour: 15 }), 'like <7d = 15/hour (50%)');
  log(JSON.stringify(getActionLimit('like', 14)) === JSON.stringify({ perHour: 24 }), 'like 1-4w = 24/hour (80%)');
  log(JSON.stringify(getActionLimit('like', 100)) === JSON.stringify({ perHour: 30 }), 'like >3mo = 30/hour (100%)');
  log(getActionLimit('unknown') === null, 'unknown action returns null');
  log(JSON.stringify(getActionLimit('like', null)) === JSON.stringify({ perHour: 30 }), 'null age → mature (full limits)');

  // ── Test 3: enforceDelay with real setTimeout waits ~5s ─────────
  console.log('\n[3] enforceDelay with real setTimeout (rng=0.0 → 5000ms)');
  const browser = await createBrowser({ headless: true });
  try {
    const page = await createPage(browser);

    const t0 = performance.now();
    await enforceDelay('like', 30, { rng: () => 0.0 }); // real setTimeout, 5000ms
    const elapsed = performance.now() - t0;
    log(elapsed >= 4900, `real delay elapsed ${elapsed.toFixed(0)}ms (>=4900ms)`);
    log(elapsed <= 6000, `real delay elapsed ${elapsed.toFixed(0)}ms (<=6000ms)`);

    const t1 = performance.now();
    await enforceDelay('like', 30, { rng: () => 1.0 }); // real setTimeout, 15000ms
    const elapsed2 = performance.now() - t1;
    log(elapsed2 >= 14900, `real delay elapsed ${elapsed2.toFixed(0)}ms (>=14900ms)`);
    log(elapsed2 <= 16000, `real delay elapsed ${elapsed2.toFixed(0)}ms (<=16000ms)`);

    await page.close();
  } finally {
    await browser.close();
  }

  // ── Test 4: limits.js does not import puppeteer ─────────────────
  console.log('\n[4] limits.js is a pure module (no puppeteer)');
  const fs = await import('fs');
  const source = fs.readFileSync('./src/scrapers/facebook/limits.js', 'utf8');
  const importLines = source.split('\n').filter(line => /^\s*import\s+/.test(line));
  const hasBrowserImport = importLines.some(line => /puppeteer|createBrowser|createPage/.test(line));
  log(!hasBrowserImport, `limits.js has ${importLines.length} import line(s), none import puppeteer/browser`);

  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`\n=== Results: ${passed}/${total} passed ===`);
  if (passed === total) {
    console.log('✅ Story 6.13 limits work in real environment!');
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
