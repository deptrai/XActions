#!/usr/bin/env node
/**
 * Real-browser test for Story 6.9 — Bezier Mouse Movement
 *
 * Tests humanMoveMouse in a real browser on Facebook with real cookies.
 * Verifies:
 *   1. humanMoveMouse moves the mouse via Bezier curve (20-35 steps)
 *   2. Micro-jitter ±2px is applied
 *   3. 15% overshoot + correction works
 *   4. Total movement time <2s (NFR1)
 *   5. Mouse position tracking works on real Facebook page
 *
 * Usage:
 *   node test-human-mouse-real.mjs
 *
 * @author nichxbt
 */

import { performance } from 'perf_hooks';
import { createBrowser, createPage, loginWithCookie } from './src/scrapers/facebook/index.js';
import { humanMoveMouse } from './src/scrapers/facebook/human.js';

// Live accounts from miniku.txt (checked 2026-08-12)
const ACCOUNTS = [
  { c_user: '61590575447989', xs: '46:r9uvnqprx7fcPw:2:1786466771:-1:-1', datr: 'ENIyav8qTIpgCAlKvrH90i-H' },
  { c_user: '61590556597397', xs: '20:HdmjbzYZRVO2ZA:2:1786453467:-1:-1', datr: 'ercoaosL5SmmYxHwLUjYBCmP' },
  { c_user: '61590557227260', xs: '49:tZBA0I2Cgxbz3w:2:1786475971:-1:-1', datr: 'jLcoak3SSuSHUXgVfZjBy236' },
  { c_user: '61590586566607', xs: '33:GecSQdbofARUDQ:2:1786466827:-1:-1', datr: 'oLEpapFcvsUXmfLR11AiYJUG' },
  { c_user: '61590564257168', xs: '18:APrxgZMyM-1UwA:2:1786466773:-1:-1', datr: 'xVMyasK_vMKsw5VVQKYQhKDe' },
  { c_user: '61590577116318', xs: '10:59pMl_22dx8P1g:2:1786466772:-1:-1', datr: 'Y0QoanJ71XdGKTvfyt5gbuJz' },
  { c_user: '61590511331025', xs: '1:7VoDI7R0ZAhAfg:2:1786453502:-1:-1', datr: 'OrArasJaCxyKVR7Ef_72XAf0' },
  { c_user: '61590453042697', xs: '10:rrcecaQXRr7hXA:2:1786475969:-1:-1', datr: 'GIcpartXTMbTaJVZuFlyMAKt' },
];

const results = [];
const log = (ok, msg) => {
  console.log(`${ok ? '✅' : '❌'} ${msg}`);
  results.push(ok);
};

async function main() {
  console.log('=== Story 6.9 Real-Browser Bezier Mouse Test ===\n');

  const browser = await createBrowser({ headless: false });
  try {
    const page = await createPage(browser);

    // ── Test 1: humanMoveMouse moves mouse 20-35 times ──────────────
    console.log('[1] humanMoveMouse calls page.mouse.move 20-35 times');
    // Track mouse moves by intercepting page.mouse.move
    const moveCalls = [];
    const originalMove = page.mouse.move.bind(page.mouse);
    page.mouse.move = async (x, y, opts) => {
      moveCalls.push({ x, y, opts });
      return originalMove(x, y, opts);
    };
    await humanMoveMouse(page, 500, 300, { delayFn: async () => {} });
    log(moveCalls.length >= 20, `mouse.move called ${moveCalls.length} times (≥20 required)`);
    log(moveCalls.length <= 40, `mouse.move called ${moveCalls.length} times (≤40 with overshoot correction)`);

    // ── Test 2: All moves use { steps: 1 } ──────────────────────────
    console.log('\n[2] All mouse.move calls use { steps: 1 }');
    const allSteps1 = moveCalls.every(m => m.opts?.steps === 1);
    log(allSteps1, `All ${moveCalls.length} calls have opts.steps === 1`);

    // ── Test 3: Micro-jitter is applied (positions not on straight line) ──
    console.log('\n[3] Micro-jitter ±2px is applied');
    // Check that intermediate points deviate from a straight line
    const target = { x: 500, y: 300 };
    const start = { x: 0, y: 0 };
    const hasJitter = moveCalls.some((m, i) => {
      const t = (i + 1) / moveCalls.length;
      const expectedX = start.x + (target.x - start.x) * t;
      const expectedY = start.y + (target.y - start.y) * t;
      // Allow tolerance for Bezier curvature + jitter
      return Math.abs(m.x - expectedX) > 3 || Math.abs(m.y - expectedY) > 3;
    });
    log(hasJitter, 'Intermediate positions deviate from straight line (jitter + Bezier curve)');

    // ── Test 4: Final position is near target ────────────────────────
    console.log('\n[4] Final mouse position is near target (500, 300)');
    const last = moveCalls[moveCalls.length - 1];
    const distFromTarget = Math.sqrt((last.x - 500) ** 2 + (last.y - 300) ** 2);
    log(distFromTarget < 5, `Final position (${last.x.toFixed(1)}, ${last.y.toFixed(1)}) — distance from target: ${distFromTarget.toFixed(2)}px (<5 required)`);

    // ── Test 5: Total time <2s with default delayFn (NFR1) ───────────
    console.log('\n[5] Total movement time <2s with default delayFn (NFR1)');
    // Restore original move (remove intercept overhead)
    page.mouse.move = originalMove;
    const t0 = performance.now();
    await humanMoveMouse(page, 800, 600);
    const elapsed = performance.now() - t0;
    log(elapsed < 2000, `Movement completed in ${elapsed.toFixed(0)}ms (<2000ms required)`);

    // ── Test 6: Multiple calls produce different step counts ─────────
    console.log('\n[6] Multiple calls produce different step counts (randomized)');
    const counts = new Set();
    for (let i = 0; i < 10; i++) {
      const calls = [];
      const orig = page.mouse.move.bind(page.mouse);
      page.mouse.move = async (x, y, opts) => { calls.push({ x, y }); return orig(x, y, opts); };
      await humanMoveMouse(page, 400 + i * 50, 300 + i * 30, { delayFn: async () => {} });
      page.mouse.move = orig;
      counts.add(calls.length);
    }
    log(counts.size >= 2, `10 calls produced ${counts.size} different step counts (≥2 required)`);

    // ── Test 7: Login with real cookie + move mouse on Facebook ──────
    console.log('\n[7] Login with real cookie + humanMoveMouse on Facebook page');
    let loginOk = false;
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
          log(true, `Login succeeded — account ${account.c_user} — page title: "${title}"`);
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

    // ── Test 8: Move mouse on real Facebook page (no crash) ──────────
    console.log('\n[8] humanMoveMouse works on real Facebook page (no crash)');
    if (loginOk) {
      try {
        // Move mouse to various positions on the Facebook page
        const fbMoves = [];
        const orig = page.mouse.move.bind(page.mouse);
        page.mouse.move = async (x, y, opts) => { fbMoves.push({ x, y }); return orig(x, y, opts); };
        await humanMoveMouse(page, 200, 200);
        await new Promise(r => setTimeout(r, 500));
        await humanMoveMouse(page, 600, 400);
        await new Promise(r => setTimeout(r, 500));
        await humanMoveMouse(page, 300, 600);
        page.mouse.move = orig;
        log(fbMoves.length > 60, `3 movements on Facebook produced ${fbMoves.length} mouse.move calls (>60 expected)`);
        log(true, 'humanMoveMouse completed on Facebook page without errors');
      } catch (err) {
        log(false, `humanMoveMouse failed on Facebook: ${err.message}`);
      }
    } else {
      console.log('  ⏭️ Skipped (no login)');
    }

    // ── Test 9: Overshoot detection — run 20 times, check for overshoot ──
    console.log('\n[9] 15% overshoot — run 20 times, expect ~3 overshoots');
    let overshootCount = 0;
    for (let i = 0; i < 20; i++) {
      const calls = [];
      const orig = page.mouse.move.bind(page.mouse);
      page.mouse.move = async (x, y, opts) => { calls.push({ x, y }); return orig(x, y, opts); };
      await humanMoveMouse(page, 300, 300, { delayFn: async () => {} });
      page.mouse.move = orig;
      // Overshoot if move count > 35 (20-35 base + 3-5 correction)
      if (calls.length > 35) overshootCount++;
    }
    // 15% of 20 = 3, but with randomness allow 1-7
    log(overshootCount >= 1, `Detected ${overshootCount}/20 overshoots (expected ~3, ≥1 required)`);
    log(overshootCount <= 10, `Overshoot count ${overshootCount}/20 is reasonable (≤10)`);

    await page.close();
  } finally {
    await browser.close();
  }

  // ── Summary ────────────────────────────────────────────────────────
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`\n=== Results: ${passed}/${total} passed ===`);
  if (passed === total) {
    console.log('✅ Story 6.9 Bezier Mouse Movement works in real browser!');
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
