// Copyright (c) 2024-2026 nich (@nichxbt). Business Source License 1.1.
/**
 * Facebook behavioral simulation utilities (Story 6.9 — ADR-014).
 *
 * Pure module — does NOT import puppeteer or any browser library.
 * Receives `page` as a parameter. This makes it unit-testable without a real
 * browser (NFR2: centralized config, NFR3: injectable delay seam).
 *
 * Exports:
 *   - humanMoveMouse(page, x, y, { delayFn, rng }) : Bezier curve mouse movement
 *
 * Scope:
 *   - Story 6.9: humanMoveMouse (cubic Bezier, 20-35 steps, jitter, overshoot)
 *   - Story 6.10 (future): humanClick (hover pause, mouse down/up)
 *   - Story 6.11 (future): humanType (variable speed, typos)
 *   - Story 6.12 (future): humanScroll (sin curve, chunks)
 *
 * NFR1: total movement time <2s.
 * NFR3: delayFn seam for testing (default setTimeout, inject vi.fn()).
 * NFR4: no fingerprint/cookie/token logged in errors.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @see https://xactions.app
 * @license BSL 1.1
 */

// by nichxbt

// ============================================================================
// Default seams — overridable in tests (NFR3)
// ============================================================================

/** Default delay function — setTimeout-based. Tests inject vi.fn() to skip waiting. */
const defaultDelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Default RNG — Math.random. Tests inject a seeded RNG for deterministic behavior. */
const defaultRng = Math.random;

// ============================================================================
// Cubic Bezier helpers
// ============================================================================

/**
 * Evaluate a cubic Bezier curve at parameter t.
 * B(t) = (1-t)³·P0 + 3(1-t)²·t·P1 + 3(1-t)·t²·P2 + t³·P3
 *
 * @param {number} t - parameter in [0, 1]
 * @param {number} p0 - start point
 * @param {number} p1 - control point 1
 * @param {number} p2 - control point 2
 * @param {number} p3 - end point
 * @returns {number} Bezier value at t
 */
function cubicBezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

// ============================================================================
// humanMoveMouse — Bezier curve mouse movement (Story 6.9, ADR-014)
// ============================================================================

/**
 * Move the mouse to (x, y) via a cubic Bezier curve with micro-jitter and
 * optional overshoot + correction. Simulates human-like mouse movement to
 * avoid bot detection (straight-line movement is a strong bot signal).
 *
 * Behavior:
 *   - 20-35 steps along a cubic Bezier curve (randomized per call)
 *   - 2 random control points create a natural arc
 *   - Micro-jitter ±2px per step (both x and y)
 *   - 15% chance overshoot: mouse moves 5-15px past target, then corrects back
 *   - 15-40ms delay per step (randomized)
 *   - Total time <2s (NFR1)
 *
 * @param {import('puppeteer').Page} page - Puppeteer page with `page.mouse.move`
 * @param {number} x - target x coordinate
 * @param {number} y - target y coordinate
 * @param {Object} [options]
 * @param {Function} [options.delayFn] - delay function (default: setTimeout-based)
 * @param {Function} [options.rng] - random number generator (default: Math.random)
 * @param {number} [options.startX=0] - starting x position (default: 0)
 * @param {number} [options.startY=0] - starting y position (default: 0)
 * @returns {Promise<void>}
 */
export async function humanMoveMouse(page, x, y, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
    startX = 0,
    startY = 0,
  } = options;

  // Step count: 20-35 (randomized)
  const stepCount = 20 + Math.floor(rng() * 16); // 20..35 inclusive

  // Control points: offset perpendicular to the line start→target.
  // This creates a natural arc rather than a straight line.
  const dx = x - startX;
  const dy = y - startY;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  // Perpendicular unit vector
  const perpX = -dy / dist;
  const perpY = dx / dist;
  // Random offset magnitude for control points (10-40% of distance)
  const offset1 = (dist * (0.1 + rng() * 0.3)) * (rng() < 0.5 ? -1 : 1);
  const offset2 = (dist * (0.1 + rng() * 0.3)) * (rng() < 0.5 ? -1 : 1);

  const cp1x = startX + dx * 0.33 + perpX * offset1;
  const cp1y = startY + dy * 0.33 + perpY * offset1;
  const cp2x = startX + dx * 0.67 + perpX * offset2;
  const cp2y = startY + dy * 0.67 + perpY * offset2;

  // 15% chance: overshoot past target, then correct back
  const willOvershoot = rng() < 0.15;

  let endX = x;
  let endY = y;
  let overshootX = x;
  let overshootY = y;

  if (willOvershoot) {
    // Overshoot 5-15px beyond target in the direction of movement
    const overDist = 5 + rng() * 10;
    const overDx = (dx / dist) * overDist;
    const overDy = (dy / dist) * overDist;
    overshootX = x + overDx;
    overshootY = y + overDy;
    // The Bezier curve ends at the overshoot point; correction happens after
    endX = overshootX;
    endY = overshootY;
  }

  // Move along the Bezier curve
  for (let i = 1; i <= stepCount; i++) {
    const t = i / stepCount;
    const bx = cubicBezier(t, startX, cp1x, cp2x, endX);
    const by = cubicBezier(t, startY, cp1y, cp2y, endY);
    // Micro-jitter ±2px
    const jx = bx + (rng() - 0.5) * 4;
    const jy = by + (rng() - 0.5) * 4;
    await page.mouse.move(jx, jy, { steps: 1 });
    // Delay 15-40ms per step
    await delayFn(15 + rng() * 25);
  }

  // Correction phase: if overshoot, move back to actual target in 3-5 steps
  if (willOvershoot) {
    const correctionSteps = 3 + Math.floor(rng() * 3); // 3..5
    for (let i = 1; i <= correctionSteps; i++) {
      const t = i / correctionSteps;
      const cx = overshootX + (x - overshootX) * t;
      const cy = overshootY + (y - overshootY) * t;
      // Small jitter on correction too
      const jx = cx + (rng() - 0.5) * 2;
      const jy = cy + (rng() - 0.5) * 2;
      await page.mouse.move(jx, jy, { steps: 1 });
      await delayFn(15 + rng() * 25);
    }
  }
}
