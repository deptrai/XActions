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
 *   - humanClick(page, element, { delayFn, rng }) : Human-like click with hover + down/up
 *   - humanType(page, text, { delayFn, rng }) : Human-like typing with variable speed and typos
 *   - humanScroll(page, distance, { delayFn, rng }) : Human-like scroll with sin-curve chunks
 *
 * Scope:
 *   - Story 6.9: humanMoveMouse (cubic Bezier, 20-35 steps, jitter, overshoot)
 *   - Story 6.10: humanClick (hover pause, mouse down/up)
 *   - Story 6.11: humanType (variable speed, typos)
 *   - Story 6.12: humanScroll (sin curve, chunks)
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
      // Micro-jitter ±2px (AC3 — same as main Bezier loop)
      const jx = cx + (rng() - 0.5) * 4;
      const jy = cy + (rng() - 0.5) * 4;
      await page.mouse.move(jx, jy, { steps: 1 });
      await delayFn(15 + rng() * 25);
    }
  }
}

// ============================================================================
// humanClick — Human-like click with hover pause (Story 6.10, ADR-014)
// ============================================================================

/**
 * Click an element with human-like behavior: Bezier mouse movement to element
 * center, hover pause, then separate mouse down → hold → mouse up.
 *
 * Behavior:
 *   - Gets element bounding box and calculates center coordinates
 *   - Moves mouse to center via `humanMoveMouse` (Bezier curve, Story 6.9)
 *   - Hover pause 100-400ms (randomized) before clicking
 *   - Mouse down → hold 30-120ms (randomized) → mouse up
 *   - Does NOT use `page.mouse.click()` — separate down/up with hold delay
 *   - Total click time (hover + hold) <1s (NFR1)
 *
 * @param {import('puppeteer').Page} page - Puppeteer page with `page.mouse`
 * @param {import('puppeteer').ElementHandle} element - Element handle to click
 * @param {Object} [options]
 * @param {Function} [options.delayFn] - delay function (default: setTimeout-based)
 * @param {Function} [options.rng] - random number generator (default: Math.random)
 * @returns {Promise<void>}
 * @throws {Error} if element has no bounding box (not visible or detached)
 */
export async function humanClick(page, element, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
  } = options;

  // Get element bounding box — returns null if element is not visible or detached
  const box = await element.boundingBox();
  if (!box) {
    throw new Error('humanClick: element has no bounding box (not visible or detached)');
  }

  // Calculate element center
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // Move mouse to element center via Bezier curve (reuse Story 6.9)
  await humanMoveMouse(page, centerX, centerY, { delayFn, rng });

  // Hover pause 100-400ms before click
  await delayFn(100 + rng() * 300);

  // Mouse down → hold 30-120ms → mouse up (NOT page.mouse.click())
  await page.mouse.down();
  await delayFn(30 + rng() * 90);
  await page.mouse.up();
}

// ============================================================================
// QWERTY adjacent-key map for plausibly wrong typo characters
// ============================================================================

const QWERTY_ADJACENT = {
  a: ['q', 'w', 's', 'z'],
  b: ['v', 'g', 'h', 'n'],
  c: ['x', 'd', 'f', 'v'],
  d: ['s', 'e', 'r', 'f', 'c', 'x'],
  e: ['w', 'r', 'd', 's'],
  f: ['d', 'r', 'g', 'v', 'c'],
  g: ['f', 't', 'h', 'b', 'v'],
  h: ['g', 'y', 'j', 'n', 'b'],
  i: ['u', 'o', 'k', 'j'],
  j: ['h', 'u', 'k', 'm', 'n'],
  k: ['j', 'i', 'l', ',', 'm'],
  l: ['k', 'o', 'p', ';', '.'],
  m: ['n', 'j', 'k', ','],
  n: ['b', 'h', 'j', 'm'],
  o: ['i', 'p', 'l', 'k'],
  p: ['o', 'l', ';'],
  q: ['w', 'a'],
  r: ['e', 't', 'f', 'd'],
  s: ['a', 'w', 'e', 'd', 'z', 'x'],
  t: ['r', 'y', 'g', 'f'],
  u: ['y', 'i', 'j', 'h'],
  v: ['c', 'f', 'g', 'b'],
  w: ['q', 'e', 's', 'a'],
  x: ['z', 's', 'd', 'c'],
  y: ['t', 'u', 'h', 'g'],
  z: ['a', 's', 'x'],
};

const PUNCTUATION_CHARS = new Set(['.', ',', '!', '?', ';', ':']);

/**
 * Pick a plausible typo for an alphabet character: a random adjacent QWERTY key.
 * Preserves the original case.
 */
function getTypoChar(char, rng) {
  const lower = char.toLowerCase();
  const adjacent = QWERTY_ADJACENT[lower];
  if (!adjacent || adjacent.length === 0) return char;
  const wrongChar = adjacent[Math.floor(rng() * adjacent.length)];
  return char === char.toUpperCase() ? wrongChar.toUpperCase() : wrongChar;
}

// ============================================================================
// humanType — Human-like typing with variable speed and typos (Story 6.11)
// ============================================================================

/**
 * Type text with human-like behavior: variable per-character delays, occasional
 * QWERTY-adjacent typos with correction, and natural pauses between words and
 * after punctuation.
 *
 * Behavior:
 *   - Each character is typed via `page.keyboard.type(char)` one at a time
 *   - Normal delay 80-120ms after each character (randomized)
 *   - Typos (1.5% chance) only for alphabet characters [a-zA-Z]:
 *     - Type wrong adjacent QWERTY key
 *     - Pause 100-300ms (realization)
 *     - Press Backspace
 *     - Type correct character
 *   - Word pause 100-300ms after a space (replaces normal delay)
 *   - Punctuation pause 200-500ms after [.,!?;:] (replaces normal delay)
 *   - Total time is proportional to text length (NFR1)
 *
 * @param {import('puppeteer').Page} page - Puppeteer page with `page.keyboard`
 * @param {string} text - Text to type
 * @param {Object} [options]
 * @param {Function} [options.delayFn] - delay function (default: setTimeout-based)
 * @param {Function} [options.rng] - random number generator (default: Math.random)
 * @returns {Promise<void>}
 */
export async function humanType(page, text, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
  } = options;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isLetter = /[a-zA-Z]/.test(char);

    // 1.5% typo chance, only for alphabet characters
    if (isLetter && rng() < 0.015) {
      const wrongChar = getTypoChar(char, rng);
      await page.keyboard.type(wrongChar);
      // Realization pause: 100-300ms
      await delayFn(100 + rng() * 200);
      // Backspace to delete wrong char
      await page.keyboard.press('Backspace');
      // Type correct char
      await page.keyboard.type(char);
    } else {
      await page.keyboard.type(char);
    }

    // Delay after character based on what this character is
    if (char === ' ') {
      await delayFn(100 + rng() * 200); // 100-300ms word pause
    } else if (PUNCTUATION_CHARS.has(char)) {
      await delayFn(200 + rng() * 300); // 200-500ms punctuation pause
    } else {
      await delayFn(80 + rng() * 40); // 80-120ms normal char delay
    }
  }
}

// ============================================================================
// humanScroll — Human-like scroll with sin-curve chunks (Story 6.12)
// ============================================================================

/**
 * Scroll by `distance` pixels with human-like behavior: the scroll is split into
 * 5-10 chunks whose sizes follow a sine curve (slow → fast → slow), with a 20%
 * chance of overshoot + correction and 100-400ms delays between chunks.
 *
 * Behavior:
 *   - Chunk count 5-10 (randomized)
 *   - Per-chunk distance follows sin curve over chunk index
 *   - 20% chance overshoot: scroll 5-15% past target, then correct back
 *   - 100-400ms delay between chunks
 *   - Calls `page.mouse.wheel({ deltaY: chunkDistance })` for each chunk
 *   - Total time reasonable (NFR1)
 *
 * @param {import('puppeteer').Page} page - Puppeteer page with `page.mouse.wheel`
 * @param {number} distance - scroll distance in pixels (positive = down, negative = up)
 * @param {Object} [options]
 * @param {Function} [options.delayFn] - delay function (default: setTimeout-based)
 * @param {Function} [options.rng] - random number generator (default: Math.random)
 * @returns {Promise<void>}
 */
export async function humanScroll(page, distance, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
  } = options;

  if (distance === 0) return;

  // 5-10 chunks, but never more than the absolute distance so that no
  // chunk rounds to 0 for tiny scrolls (e.g. distance = 1 should not produce
  // four 0-px no-op chunks). [Story 6.12 review]
  const desiredChunkCount = 5 + Math.floor(rng() * 6);
  const chunkCount = Math.max(1, Math.min(Math.abs(distance), desiredChunkCount));

  // Compute sin-curve weights: slow start, fast middle, slow end
  const weights = [];
  for (let i = 0; i < chunkCount; i++) {
    const t = (i + 0.5) / chunkCount;
    const w = 0.5 + 0.5 * Math.sin(t * Math.PI);
    weights.push(w);
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Raw chunk distances (proportional to weight, preserving sign)
  const rawDistances = weights.map(w => (w / totalWeight) * distance);

  // Round to integers and adjust last chunk so sum exactly equals distance
  const chunks = rawDistances.map(d => Math.round(d));
  const currentSum = chunks.reduce((a, b) => a + b, 0);
  const adjustment = distance - currentSum;
  if (chunks.length > 0) {
    chunks[chunks.length - 1] += adjustment;
  }

  // 20% chance overshoot: scroll 5-15% past target, then correct back
  const willOvershoot = rng() < 0.20;
  let overshootDistance = 0;
  if (willOvershoot) {
    const overshootPercent = 0.05 + rng() * 0.10; // 5-15%
    overshootDistance = Math.round(distance * overshootPercent);
    // If overshoot rounds to 0 but distance is non-zero, use at least 1px
    if (overshootDistance === 0 && distance !== 0) {
      overshootDistance = distance > 0 ? 1 : -1;
    }
  }

  // Execute base chunks
  for (let i = 0; i < chunks.length; i++) {
    await page.mouse.wheel({ deltaY: chunks[i] });
    // Delay between chunks (not after final chunk unless overshoot follows)
    if (i < chunks.length - 1 || willOvershoot) {
      await delayFn(100 + rng() * 300);
    }
  }

  // Overshoot and correction
  if (willOvershoot && overshootDistance !== 0) {
    await page.mouse.wheel({ deltaY: overshootDistance });
    await delayFn(100 + rng() * 300);
    await page.mouse.wheel({ deltaY: -overshootDistance });
  }
}
