// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
// by nichxbt
/**
 * Facebook session warming sequence (Story 6.15 — ADR-016).
 *
 * Pure module — does NOT import puppeteer or any browser library directly.
 * Receives `page` as a parameter and uses injectable seams (`delayFn`, `rng`).
 *
 * Prevents "cold-session-immediate-action" bot detection flags by simulating
 * organic homepage reading behavior before automated actions execute.
 *
 * Exports:
 *   - warmSession(page, options) : perform homepage warming sequence
 *
 * NFR2: centralized config.
 * NFR3: delayFn and rng seams for testing.
 * NFR4: no cookie/token/account metadata logged.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 */

import { humanScroll, humanMoveMouse } from './human.js';

// ============================================================================
// Default seams — overridable in tests (NFR3)
// ============================================================================

const defaultDelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultRng = Math.random;

const FACEBOOK_HOME = 'https://www.facebook.com/';

// ============================================================================
// warmSession — Story 6.15
// ============================================================================

/**
 * Execute session warming sequence on Facebook homepage.
 *
 * Sequence:
 *   1. Visit homepage (https://www.facebook.com/)
 *   2. Wait 3-8s (reading top feed)
 *   3. Scroll 300-800px (human scroll)
 *   4. Wait 2-6s
 *   5. Scroll 200-500px (human scroll)
 *   6. Wait 1-4s
 *   7. Random mouse movements 3 times (with 0.5-2s wait after each)
 *
 * Warming is best-effort: errors are caught & logged as warnings without aborting session.
 *
 * @param {Object} page - Puppeteer page instance
 * @param {Object} [options]
 * @param {Function} [options.delayFn] - delay function seam (default: setTimeout)
 * @param {Function} [options.rng] - random number generator seam (default: Math.random)
 * @param {boolean} [options.skipWarmup=false] - if true, skips warming immediately
 * @returns {Promise<Object>} { steps: string[], durationMs: number, error?: string }
 */
export async function warmSession(page, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
    skipWarmup = false,
  } = options;

  if (skipWarmup) {
    return { steps: ['skip'], durationMs: 0 };
  }

  const startTime = Date.now();
  const steps = [];

  try {
    // 1. Visit homepage
    steps.push('goto_home');
    if (typeof page.goto === 'function') {
      await page.goto(FACEBOOK_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // 2. Wait 3-8s
    steps.push('wait_1');
    const wait1 = 3000 + Math.max(0, Math.min(1, rng())) * 5000;
    await delayFn(wait1);

    // 3. Scroll 300-800px
    steps.push('scroll_1');
    const scroll1 = 300 + Math.max(0, Math.min(1, rng())) * 500;
    await humanScroll(page, scroll1, { delayFn, rng });

    // 4. Wait 2-6s
    steps.push('wait_2');
    const wait2 = 2000 + Math.max(0, Math.min(1, rng())) * 4000;
    await delayFn(wait2);

    // 5. Scroll 200-500px
    steps.push('scroll_2');
    const scroll2 = 200 + Math.max(0, Math.min(1, rng())) * 300;
    await humanScroll(page, scroll2, { delayFn, rng });

    // 6. Wait 1-4s
    steps.push('wait_3');
    const wait3 = 1000 + Math.max(0, Math.min(1, rng())) * 3000;
    await delayFn(wait3);

    // 7. Random mouse movements 3 times
    steps.push('mouse_moves');
    const viewport = (typeof page.viewportSize === 'function' && page.viewportSize()) || { width: 1280, height: 720 };
    const safeWidth = Math.max(0, viewport.width - 1);
    const safeHeight = Math.max(0, viewport.height - 1);
    const minMargin = 100;
    const maxX = Math.max(minMargin, safeWidth - minMargin);
    const maxY = Math.max(minMargin, safeHeight - minMargin);
    for (let i = 0; i < 3; i++) {
      const rX = Math.max(0, Math.min(1, rng()));
      const rY = Math.max(0, Math.min(1, rng()));
      const x = Math.floor(minMargin + rX * (maxX - minMargin)); // 100..viewport.width-100
      const y = Math.floor(minMargin + rY * (maxY - minMargin)); // 100..viewport.height-100

      await humanMoveMouse(page, x, y, { delayFn, rng });

      const mouseWait = 500 + Math.max(0, Math.min(1, rng())) * 1500; // 0.5-2s
      await delayFn(mouseWait);
    }

    steps.push('complete');
    return {
      steps,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMsg = err?.message ?? String(err);
    console.warn(`⚠️ warmSession: warming sequence hit error — ${errorMsg}`);
    steps.push('error');
    return {
      steps,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}
