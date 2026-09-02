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
 *   - physicsEase(t) : clamped 5th-order smoothstep easing helper
 *   - easeOut(t) : clamped 5th-order ease-out for correction phase
 *
 * Scope:
 *   - Story 6.4: humanMoveMouse (physics-eased Bezier, velocity profile)
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
// Story 6.4: physics-based easing applied to mouse movement (2026-09-01).

// ============================================================================
// Default seams — overridable in tests (NFR3)
// ============================================================================

/** Default delay function — setTimeout-based. Tests inject vi.fn() to skip waiting. */
const defaultDelayFn = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Default RNG — Math.random. Tests inject a seeded RNG for deterministic behavior. */
const defaultRng = Math.random;

/**
 * Clamp a number to the inclusive [min, max] range.
 * Prevents RNG or arithmetic from producing values outside documented bounds.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Wrap an external RNG so its output is always in [0, 1].
 * Hardens against injected RNGs that may return outside the expected range.
 *
 * @param {() => number} rng
 * @returns {() => number}
 */
function wrapRng(rng) {
  return () => clamp(rng(), 0, 1);
}

// ============================================================================
// Curve & easing helpers
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

/**
 * Physics-based easing: 5th-order smoothstep.
 * Produces a natural human velocity profile: slow start (ease-in),
 * fast coast, and slow end (ease-out). This mimics how real muscles
 * accelerate and decelerate a pointer, unlike a raw Bezier parameter.
 *
 * The input is clamped to [0, 1]; non-numeric, NaN, and infinities are
 * handled gracefully (non-numeric or NaN → 0; +Infinity → 1; -Infinity → 0).
 *
 * @param {number} t - parameter (clamped to [0, 1])
 * @returns {number} eased progress in [0, 1]
 */
export function physicsEase(t) {
  if (typeof t !== 'number' || Number.isNaN(t)) return 0;
  const v = clamp(t, 0, 1);
  return v * v * v * (v * (v * 6 - 15) + 10);
}

/**
 * Quintic ease-out for the overshoot correction phase.
 * The pointer is already in motion, so it should decelerate smoothly
 * as it reaches the target rather than ease-in from a dead stop.
 *
 * @param {number} t - parameter (clamped to [0, 1])
 * @returns {number} eased progress in [0, 1]
 */
export function easeOut(t) {
  if (typeof t !== 'number' || Number.isNaN(t)) return 0;
  const v = clamp(t, 0, 1);
  const u = 1 - v;
  return 1 - u * u * u * u * u;
}

// ============================================================================
// humanMoveMouse — Bezier curve mouse movement (Story 6.9, ADR-014)
// ============================================================================

/**
 * Move the mouse to (x, y) via a physics-eased Bezier curve with micro-jitter
 * and optional overshoot + correction. Simulates human-like mouse movement to
 * avoid bot detection (straight-line movement and uniform velocity are bot signals).
 *
 * Behavior:
 *   - 20-35 steps along a cubic Bezier curve (randomized per call)
 *   - Physics-based 5th-order smoothstep easing: slow start → fast coast → slow end
 *   - 2 random control points create a natural arc in screen space
 *   - Micro-jitter ±2px per step (both x and y)
 *   - 15% chance overshoot: mouse moves 5-15% past target, then corrects back
 *   - 15-40ms delay per step (randomized)
 *   - Total time <2s (NFR1)
 *
 * @param {import('puppeteer').Page} page - Puppeteer page with `page.mouse.move`
 * @param {number} x - target x coordinate
 * @param {number} y - target y coordinate
 * @param {FacebookOptions} [options]
 * @returns {Promise<void>}
 */
export async function humanMoveMouse(page, x, y, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
    startX = 0,
    startY = 0,
  } = options;

  // Input validation (Story 6.18 — AC2, NFR4)
  if (!page?.mouse?.move || typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y) || typeof startX !== 'number' || !Number.isFinite(startX) || typeof startY !== 'number' || !Number.isFinite(startY) || typeof delayFn !== 'function' || typeof rng !== 'function') {
    throw new Error('❌ humanMoveMouse: page.mouse.move and finite x, y are required');
  }

  const r = wrapRng(rng);

  // Step count: 17-30 base steps so that with 3-5 correction steps, total moves <= 35
  const rawSteps = 20 + Math.min(15, Math.floor(r() * 16)); // Call 1

  // Control points: offset perpendicular to the line start→target.
  // This creates a natural arc rather than a straight line.
  const dx = x - startX;
  const dy = y - startY;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  // Perpendicular unit vector
  const perpX = -dy / dist;
  const perpY = dx / dist;
  // Random offset magnitude for control points (10-40% of distance)
  const offset1 = (dist * (0.1 + r() * 0.3)) * (r() < 0.5 ? -1 : 1); // Calls 2, 3
  const offset2 = (dist * (0.1 + r() * 0.3)) * (r() < 0.5 ? -1 : 1); // Calls 4, 5

  const cp1x = startX + dx * 0.33 + perpX * offset1;
  const cp1y = startY + dy * 0.33 + perpY * offset1;
  const cp2x = startX + dx * 0.67 + perpX * offset2;
  const cp2y = startY + dy * 0.67 + perpY * offset2;

  // 15% chance: overshoot past target, then correct back
  const willOvershoot = r() < 0.15; // Call 6

  let endX = x;
  let endY = y;
  let overshootX = x;
  let overshootY = y;
  let correctionSteps = 0;

  if (willOvershoot) {
    // Proportional overshoot: 5-15% of movement distance, clamped to [1, 25] pixels (Story 6.18 — AC1)
    const overScalar = clamp(0.05 + r() * 0.10, 0.05, 0.15); // Call 7
    const overDist = clamp(Math.round(dist * overScalar), 1, 25);
    const overDx = (dx / dist) * overDist;
    const overDy = (dy / dist) * overDist;
    overshootX = x + overDx;
    overshootY = y + overDy;
    // The Bezier curve ends at the overshoot point; correction happens after
    endX = overshootX;
    endY = overshootY;
    correctionSteps = 3 + Math.min(2, Math.floor(r() * 3)); // 3..5
  }

  // Ensure total steps (main curve + correction) never exceeds 35 and is at least 20
  const stepCount = willOvershoot ? Math.max(16, Math.min(30, rawSteps - correctionSteps)) : rawSteps;

  if (willOvershoot) {
    // Proportional overshoot: 5-15% of movement distance, clamped to [1, 25] pixels (Story 6.18 — AC1)
    const overScalar = clamp(0.05 + r() * 0.10, 0.05, 0.15);
    const overDist = clamp(Math.round(dist * overScalar), 1, 25);
    const overDx = (dx / dist) * overDist;
    const overDy = (dy / dist) * overDist;
    overshootX = x + overDx;
    overshootY = y + overDy;
    // The Bezier curve ends at the overshoot point; correction happens after
    endX = overshootX;
    endY = overshootY;
  }

  // Move along the Bezier curve with physics-based easing.
  // physicsEase(t) shapes the velocity: small steps at the start and end,
  // larger steps through the middle, mimicking human acceleration/deceleration.
  for (let i = 1; i <= stepCount; i++) {
    const t = i / stepCount;
    const et = physicsEase(t);
    const bx = cubicBezier(et, startX, cp1x, cp2x, endX);
    const by = cubicBezier(et, startY, cp1y, cp2y, endY);
    // On the final step, land exactly on the end point to avoid ±2px jitter drift.
    const isLast = i === stepCount;
    const jx = isLast ? endX : bx + (r() - 0.5) * 4;
    const jy = isLast ? endY : by + (r() - 0.5) * 4;
    await page.mouse.move(jx, jy, { steps: 1 });
    // Delay 15-40ms per step
    await delayFn(clamp(15 + r() * 25, 15, 40));
  }

  // Correction phase: if overshoot, move back to actual target in 3-5 steps.
  // Use a pure ease-out curve because the pointer is already in motion and
  // should decelerate smoothly as it reaches the target.
  if (willOvershoot) {
    const correctionSteps = 3 + Math.min(2, Math.floor(r() * 3)); // 3..5
    for (let i = 1; i <= correctionSteps; i++) {
      const t = i / correctionSteps;
      const et = easeOut(t);
      const cx = overshootX + (x - overshootX) * et;
      const cy = overshootY + (y - overshootY) * et;
      // On the final correction step, snap to the real target for accuracy.
      const isLast = i === correctionSteps;
      const jx = isLast ? x : cx + (r() - 0.5) * 4;
      const jy = isLast ? y : cy + (r() - 0.5) * 4;
      await page.mouse.move(jx, jy, { steps: 1 });
      await delayFn(clamp(15 + r() * 25, 15, 40));
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
 * @param {FacebookOptions} [options]
 * @returns {Promise<void>}
 * @throws {Error} if element has no bounding box (not visible or detached)
 */
export async function humanClick(page, element, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
  } = options;

  // Input validation (Story 6.18 — AC3, NFR4)
  if (!page?.mouse?.down || !page?.mouse?.up || !element || typeof element.boundingBox !== 'function' || typeof delayFn !== 'function' || typeof rng !== 'function') {
    throw new Error('❌ humanClick: page.mouse and element.boundingBox are required');
  }

  const r = wrapRng(rng);

  // Get element bounding box — returns null if element is not visible or detached
  const box = await element.boundingBox();
  if (!box || typeof box.x !== 'number' || !Number.isFinite(box.x) || typeof box.y !== 'number' || !Number.isFinite(box.y) || typeof box.width !== 'number' || !Number.isFinite(box.width) || typeof box.height !== 'number' || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) {
    throw new Error('humanClick: element has no bounding box (not visible or detached)');
  }

  // Calculate element center
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // Move mouse to element center via Bezier curve (reuse Story 6.9)
  await humanMoveMouse(page, centerX, centerY, { delayFn, rng: r });

  // Hover pause 100-400ms before click
  await delayFn(clamp(100 + r() * 300, 100, 400));

  // Mouse down → hold 30-120ms → mouse up (NOT page.mouse.click())
  await page.mouse.down();
  await delayFn(clamp(30 + r() * 90, 30, 120));
  await page.mouse.up();
}

// ============================================================================
// QWERTY adjacent-key map for plausibly wrong typo characters
// ============================================================================

/** @type {Record<string, string[]>} */
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
 *
 * @param {string} char
 * @param {() => number} rng
 * @returns {string}
 */
function getTypoChar(char, rng) {
  const lower = char.toLowerCase();
  const adjacent = QWERTY_ADJACENT[lower];
  if (!adjacent || adjacent.length === 0) return char;
  const idx = Math.max(0, Math.min(adjacent.length - 1, Math.floor(rng() * adjacent.length)));
  const wrongChar = adjacent[idx];
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
 * @param {FacebookOptions} [options]
 * @returns {Promise<void>}
 */
export async function humanType(page, text, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
  } = options;

  // Input validation (Story 6.18 — AC4, NFR4)
  if (!page?.keyboard?.type || !page?.keyboard?.press || typeof text !== 'string' || typeof delayFn !== 'function' || typeof rng !== 'function') {
    throw new Error('❌ humanType: page.keyboard and string text are required');
  }

  const r = wrapRng(rng);

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const isLetter = /[a-zA-Z]/.test(char);

    // 1.5% typo chance, only for alphabet characters
    if (isLetter && r() < 0.015) {
      const wrongChar = getTypoChar(char, r);
      await page.keyboard.type(wrongChar);
      // Realization pause: 100-300ms
      await delayFn(clamp(100 + r() * 200, 100, 300));
      // Backspace to delete wrong char
      await page.keyboard.press('Backspace');
      // Type correct char
      await page.keyboard.type(char);
    } else {
      await page.keyboard.type(char);
    }

    // Delay after character based on what this character is
    if (char === ' ') {
      await delayFn(clamp(100 + r() * 200, 100, 300)); // 100-300ms word pause
    } else if (PUNCTUATION_CHARS.has(char)) {
      await delayFn(clamp(200 + r() * 300, 200, 500)); // 200-500ms punctuation pause
    } else {
      await delayFn(clamp(80 + r() * 40, 80, 120)); // 80-120ms normal char delay
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
 * @param {FacebookOptions} [options]
 * @returns {Promise<void>}
 */
export async function humanScroll(page, distance, options = {}) {
  const {
    delayFn = defaultDelayFn,
    rng = defaultRng,
  } = options;

  // Input validation (Story 6.18 — AC5, NFR4)
  if (!page?.mouse?.wheel || typeof distance !== 'number' || !Number.isFinite(distance) || typeof delayFn !== 'function' || typeof rng !== 'function') {
    throw new Error('❌ humanScroll: page.mouse.wheel and finite distance are required');
  }

  if (distance === 0) return;

  const r = wrapRng(rng);

  // 5-10 chunks, but never more than the absolute distance so that no
  // chunk rounds to 0 for tiny scrolls (e.g. distance = 1 should not produce
  // four 0-px no-op chunks). [Story 6.12 review]
  const desiredChunkCount = 5 + Math.min(5, Math.floor(r() * 6));
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
  const willOvershoot = r() < 0.20;
  let overshootDistance = 0;
  if (willOvershoot) {
    const overshootPercent = clamp(0.05 + r() * 0.10, 0.05, 0.15); // 5-15%
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
      await delayFn(clamp(100 + r() * 300, 100, 400));
    }
  }

  // Overshoot and correction
  if (willOvershoot && overshootDistance !== 0) {
    await page.mouse.wheel({ deltaY: overshootDistance });
    await delayFn(clamp(100 + r() * 300, 100, 400));
    await page.mouse.wheel({ deltaY: -overshootDistance });
  }
}
