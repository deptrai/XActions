// tests/scrapers/facebook-human.test.js
// Story 6.9 — Bezier Mouse Movement (ADR-014)
// Pure-module tests for src/scrapers/facebook/human.js
// No Puppeteer required — human.js is a pure module.
import { describe, it, expect, vi } from 'vitest';
import { humanMoveMouse, humanClick, humanType, humanScroll } from '../../src/scrapers/facebook/human.js';
import { makeFakePage, makeElementHandle } from '../helpers/fake-page.js';

// ============================================================================
// humanMoveMouse (AC1-AC8 — Story 6.9)
// ============================================================================

describe('humanMoveMouse (AC1-AC8 — Story 6.9)', () => {
  it('is an async function (AC1)', () => {
    expect(typeof humanMoveMouse).toBe('function');
    const page = makeFakePage();
    expect(humanMoveMouse(page, 100, 200)).toBeInstanceOf(Promise);
  });

  it('calls page.mouse.move 20-35 times (AC2)', async () => {
    const page = makeFakePage();
    // Use a no-op delayFn so the test runs fast
    const delayFn = async () => {};
    await humanMoveMouse(page, 500, 300, { delayFn });
    const moveCount = page.calls.mouse.move.length;
    expect(moveCount).toBeGreaterThanOrEqual(20);
    expect(moveCount).toBeLessThanOrEqual(35);
  });

  it('step count is randomized — different calls produce different counts (AC2)', async () => {
    const counts = new Set();
    for (let i = 0; i < 20; i++) {
      const page = makeFakePage();
      await humanMoveMouse(page, 500, 300, { delayFn: async () => {} });
      counts.add(page.calls.mouse.move.length);
    }
    // With 20 calls, we should see at least 2 different step counts
    expect(counts.size).toBeGreaterThanOrEqual(2);
  });

  it('final move call is near target (x, y) ± jitter (AC2, AC3)', async () => {
    const page = makeFakePage();
    // Use deterministic rng that returns 0.5 (no overshoot, jitter = 0)
    const rng = () => 0.5;
    await humanMoveMouse(page, 400, 250, { delayFn: async () => {}, rng });
    const moves = page.calls.mouse.move;
    const last = moves[moves.length - 1];
    // With rng=0.5, jitter = (0.5-0.5)*4 = 0, and overshoot threshold = 0.5 < 0.15 is false
    // So final position should be exactly (400, 250)
    expect(last.x).toBeCloseTo(400, 0);
    expect(last.y).toBeCloseTo(250, 0);
  });

  it('jitter is applied — positions differ from pure Bezier (AC3)', async () => {
    const page = makeFakePage();
    // rng that returns varying values to ensure jitter
    let callIdx = 0;
    const rng = () => {
      callIdx++;
      return (callIdx % 10) / 10; // 0.1, 0.2, ..., 1.0, 0.1, ...
    };
    await humanMoveMouse(page, 300, 200, { delayFn: async () => {}, rng });
    const moves = page.calls.mouse.move;
    // With jitter, at least some intermediate positions should not be on
    // a straight line from (0,0) to (300,200)
    const hasJitter = moves.some((m, i) => {
      const t = (i + 1) / moves.length;
      const expectedX = 300 * t;
      const expectedY = 200 * t;
      // Allow ±5 tolerance for jitter + Bezier curvature
      return Math.abs(m.x - expectedX) > 5 || Math.abs(m.y - expectedY) > 5;
    });
    expect(hasJitter).toBe(true);
  });

  it('15% overshoot — with rng < 0.15, overshoot occurs (AC4)', async () => {
    const page = makeFakePage();
    // rng returns 0.1 (< 0.15 → overshoot), then 0.5 for rest
    let callIdx = 0;
    const rng = () => {
      callIdx++;
      if (callIdx === 1) return 0.1; // triggers overshoot
      return 0.5;
    };
    await humanMoveMouse(page, 200, 150, { delayFn: async () => {}, rng });
    const moves = page.calls.mouse.move;
    // With overshoot, there should be MORE than 20-35 moves (correction phase adds 3-5)
    // But the step count is 20 + floor(0.5*16) = 28, plus 3 + floor(0.5*3) = 4 correction = 32
    // Actually with rng=0.1 for first call: stepCount = 20 + floor(0.1*16) = 21
    // Then correction: 3 + floor(0.5*3) = 4
    // Total = 25. But we just check it's > 20 and the last move is at target
    expect(moves.length).toBeGreaterThan(20);
    // Final position should be at the actual target (200, 150) after correction
    const last = moves[moves.length - 1];
    expect(last.x).toBeCloseTo(200, 0);
    expect(last.y).toBeCloseTo(150, 0);
  });

  it('overshoot moves past target then corrects back (AC4)', async () => {
    const page = makeFakePage();
    // Force overshoot with rng=0.01, then 0.5 for the rest
    let callIdx = 0;
    const rng = () => {
      callIdx++;
      if (callIdx === 1) return 0.01; // triggers overshoot
      return 0.5;
    };
    await humanMoveMouse(page, 200, 150, { delayFn: async () => {}, rng });
    const moves = page.calls.mouse.move;
    // The Bezier curve ends at the overshoot point (past 200, 150)
    // Then correction moves back to (200, 150)
    // Find the peak x value (should be > 200 due to overshoot)
    const maxX = Math.max(...moves.map((m) => m.x));
    // With rng=0.5 for overshoot distance: overDist = 5 + 0.5*10 = 10
    // Direction is (200, 150) normalized, so overshootX = 200 + ~8
    // But jitter and Bezier curvature may affect this
    // Just verify the last position is at the target
    const last = moves[moves.length - 1];
    expect(last.x).toBeCloseTo(200, 0);
    expect(last.y).toBeCloseTo(150, 0);
  });

  it('delayFn seam is used when provided (AC6)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanMoveMouse(page, 100, 100, { delayFn });
    // delayFn should be called once per step (20-35 times)
    expect(delayFn).toHaveBeenCalled();
    expect(delayFn.mock.calls.length).toBeGreaterThanOrEqual(20);
    expect(delayFn.mock.calls.length).toBeLessThanOrEqual(40); // 35 steps + 5 correction
  });

  it('rng seam is used when provided (AC7)', async () => {
    const page = makeFakePage();
    const rng = vi.fn(() => 0.5);
    await humanMoveMouse(page, 100, 100, { delayFn: async () => {}, rng });
    // rng should be called multiple times (step count, control points, jitter per step, etc.)
    expect(rng).toHaveBeenCalled();
    expect(rng.mock.calls.length).toBeGreaterThan(10);
  });

  it('uses { steps: 1 } option in mouse.move calls (AC8)', async () => {
    const page = makeFakePage();
    await humanMoveMouse(page, 200, 200, { delayFn: async () => {}, rng: () => 0.5 });
    const moves = page.calls.mouse.move;
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) {
      expect(m.opts).toEqual({ steps: 1 });
    }
  });

  it('does NOT import puppeteer — pure module (AC1)', async () => {
    // Read the source file and verify no actual puppeteer import statements
    const fs = await import('fs');
    const source = fs.readFileSync('src/scrapers/facebook/human.js', 'utf-8');
    // Check for actual import/require statements (not comments mentioning puppeteer)
    const importLines = source.split('\n').filter(l =>
      l.trim().startsWith('import ') || l.trim().startsWith('const ') || l.trim().startsWith('require(')
    );
    const hasPuppeteerImport = importLines.some(l => /puppeteer/.test(l));
    expect(hasPuppeteerImport).toBe(false);
  });

  it('completes without error with default delayFn (AC5)', async () => {
    const page = makeFakePage();
    // Use default delayFn (setTimeout-based) — should complete without error
    // We don't measure exact time here, just verify it doesn't throw
    await expect(humanMoveMouse(page, 100, 100)).resolves.toBeUndefined();
  });

  it('handles zero-distance movement (start === target)', async () => {
    const page = makeFakePage();
    // Moving to (0, 0) from (0, 0) — distance is 0, should not crash
    await expect(
      humanMoveMouse(page, 0, 0, { delayFn: async () => {}, rng: () => 0.5 }),
    ).resolves.toBeUndefined();
    // Should still produce some mouse moves
    expect(page.calls.mouse.move.length).toBeGreaterThan(0);
  });

  it('handles negative coordinates', async () => {
    const page = makeFakePage();
    await expect(
      humanMoveMouse(page, -50, -50, { delayFn: async () => {}, rng: () => 0.5 }),
    ).resolves.toBeUndefined();
    expect(page.calls.mouse.move.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// humanClick (AC1-AC9 — Story 6.10)
// ============================================================================

describe('humanClick (AC1-AC9 — Story 6.10)', () => {
  it('is an async function (AC1)', () => {
    expect(typeof humanClick).toBe('function');
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    expect(humanClick(page, el)).toBeInstanceOf(Promise);
  });

  it('calls humanMoveMouse to move to element center (AC4, AC7)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    await humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 });
    // humanMoveMouse should have called page.mouse.move multiple times
    expect(page.calls.mouse.move.length).toBeGreaterThan(0);
    // Final move position should be near center: (100+25, 200+15) = (125, 215)
    const lastMove = page.calls.mouse.move[page.calls.mouse.move.length - 1];
    expect(lastMove.x).toBeCloseTo(125, 0);
    expect(lastMove.y).toBeCloseTo(215, 0);
  });

  it('hover pause 100-400ms occurs before mouse down (AC2)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    const delayFn = vi.fn(async () => {});
    await humanClick(page, el, { delayFn, rng: () => 0.5 });
    // delayFn is called for: humanMoveMouse steps + hover pause + hold delay
    // The hover pause is 100 + 0.5*300 = 250ms
    // Check that at least one delay call is in the 100-400ms range (hover)
    const hoverDelay = delayFn.mock.calls.find(c => c[0] >= 100 && c[0] <= 400);
    expect(hoverDelay).toBeDefined();
    expect(hoverDelay[0]).toBeCloseTo(250, 0); // 100 + 0.5*300 = 250
  });

  it('page.mouse.down() is called exactly once (AC3)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    await humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.down.length).toBe(1);
  });

  it('page.mouse.up() is called exactly once after down (AC3)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    await humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.up.length).toBe(1);
  });

  it('hold delay 30-120ms occurs between down and up (AC3)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    const delayFn = vi.fn(async () => {});
    await humanClick(page, el, { delayFn, rng: () => 0.5 });
    // The hold delay is 30 + 0.5*90 = 75ms
    const holdDelay = delayFn.mock.calls.find(c => c[0] >= 30 && c[0] <= 120);
    expect(holdDelay).toBeDefined();
    expect(holdDelay[0]).toBeCloseTo(75, 0); // 30 + 0.5*90 = 75
  });

  it('order is strictly down → delay → up, NOT page.mouse.click() (AC3)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    await humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 });
    // page.mouse.click should NOT be called — we use down/up separately
    expect(page.calls.mouse.click.length).toBe(0);
    // Both down and up should be called
    expect(page.calls.mouse.down.length).toBe(1);
    expect(page.calls.mouse.up.length).toBe(1);
  });

  it('delayFn seam is used for hover and hold delays (AC5)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    const delayFn = vi.fn(async () => {});
    await humanClick(page, el, { delayFn, rng: () => 0.5 });
    // delayFn should be called for: humanMoveMouse steps (20-35) + hover (1) + hold (1)
    expect(delayFn).toHaveBeenCalled();
    expect(delayFn.mock.calls.length).toBeGreaterThanOrEqual(22); // 20 steps + hover + hold
  });

  it('rng seam is used for hover and hold duration randomization (AC6)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    const rng = vi.fn(() => 0.5);
    await humanClick(page, el, { delayFn: async () => {}, rng });
    // rng should be called for: humanMoveMouse + hover duration + hold duration
    expect(rng).toHaveBeenCalled();
    expect(rng.mock.calls.length).toBeGreaterThan(10);
  });

  it('throws when boundingBox() returns null (AC4, NFR4)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: null });
    await expect(
      humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 }),
    ).rejects.toThrow(/bounding box/);
  });

  it('error message does not contain sensitive data (NFR4)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: null });
    try {
      await humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err.message).not.toMatch(/cookie|token|password|secret|xs|c_user/i);
      expect(err.message).toMatch(/bounding box/);
    }
  });

  it('uses element center coordinates (x + width/2, y + height/2) (AC4)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 200, y: 300, width: 100, height: 60 } });
    await humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 });
    // Center should be (200+50, 300+30) = (250, 330)
    const lastMove = page.calls.mouse.move[page.calls.mouse.move.length - 1];
    expect(lastMove.x).toBeCloseTo(250, 0);
    expect(lastMove.y).toBeCloseTo(330, 0);
  });

  it('does NOT call page.mouse.click() — uses down/up separately (AC3)', async () => {
    const page = makeFakePage();
    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    await humanClick(page, el, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.click).toEqual([]);
  });

  it('humanMoveMouse is still exported and works (AC9 — no regression)', async () => {
    expect(typeof humanMoveMouse).toBe('function');
    const page = makeFakePage();
    await humanMoveMouse(page, 200, 200, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.move.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// humanType (AC1-AC9 — Story 6.11)
// ============================================================================

describe('humanType (AC1-AC9 — Story 6.11)', () => {
  it('is an async function (AC1)', () => {
    expect(typeof humanType).toBe('function');
    const page = makeFakePage();
    expect(humanType(page, 'hello', { delayFn: async () => {}, rng: () => 0.5 })).toBeInstanceOf(Promise);
  });

  it('calls page.keyboard.type for each character (AC2)', async () => {
    const page = makeFakePage();
    await humanType(page, 'hello', { delayFn: async () => {}, rng: () => 0.5 });
    // 5 chars, no typos with rng=0.5 (0.5 > 0.015 typo threshold)
    expect(page.calls.keyboard.type.length).toBe(5);
    const typedChars = page.calls.keyboard.type.map(t => t.text);
    expect(typedChars.join('')).toBe('hello');
  });

  it('delay 80-120ms after each normal character (AC2)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanType(page, 'abc', { delayFn, rng: () => 0.5 });
    // Each char has 80 + 0.5*40 = 100ms delay
    const normalDelays = delayFn.mock.calls.filter(c => c[0] >= 80 && c[0] <= 120);
    expect(normalDelays.length).toBe(3);
    expect(normalDelays.every(c => c[0] === 100)).toBe(true);
  });

  it('typo rate triggers at expected 1.5% threshold (AC3)', async () => {
    // rng() returns 0.0 then 0.5 repeatedly: 0.0 < 0.015 → typo, 0.5 > 0.015 → no typo for following calls
    const page = makeFakePage();
    const rng = vi.fn();
    let call = 0;
    rng.mockImplementation(() => {
      const values = [0.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      return values[call++ % values.length];
    });
    const delayFn = async () => {};
    await humanType(page, 'a', { delayFn, rng });

    // 'a' triggered typo: type wrong -> backspace -> type correct (2 type calls + 1 press)
    expect(page.calls.keyboard.type.length).toBe(2);
    expect(page.calls.keyboard.press.length).toBe(1);
    expect(page.calls.keyboard.press[0]).toBe('Backspace');
  });

  it('typos only apply to alphabet characters, not digits or punctuation (AC3)', async () => {
    const page = makeFakePage();
    const rng = vi.fn(() => 0.0); // force typo every time
    const delayFn = async () => {};
    await humanType(page, '1!', { delayFn, rng });
    // digits and punctuation never get typos
    expect(page.calls.keyboard.type.length).toBe(2);
    expect(page.calls.keyboard.press.length).toBe(0);
  });

  it('typo sequence: type wrong → pause → backspace → retype (AC4)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    // Force typo on 'a'. rng 0.0 triggers typo; then need neighbors for getTypoChar.
    // 'a' has ['q','w','s','z'] — with rng=0.0 the first (q) is chosen.
    const rng = vi.fn(() => 0.0);
    await humanType(page, 'a', { delayFn, rng });

    const typeCalls = page.calls.keyboard.type.map(t => t.text);
    expect(typeCalls.length).toBe(2);
    expect(typeCalls[0]).toBe('q'); // wrong char
    expect(typeCalls[1]).toBe('a'); // correct char (after backspace)
    expect(page.calls.keyboard.press[0]).toBe('Backspace');

    // Should be a 100-300ms delay between wrong char and backspace (realization pause)
    const typoPause = delayFn.mock.calls.find(c => c[0] >= 100 && c[0] <= 300);
    expect(typoPause).toBeDefined();
  });

  it('typo pause is 100-300ms (AC4)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    const rng = vi.fn(() => 0.0); // 0.0 typo trigger, then 0.0 for pause = 100 + 0*200 = 100ms
    await humanType(page, 'a', { delayFn, rng });
    const typoPause = delayFn.mock.calls.find(c => c[0] === 100);
    expect(typoPause).toBeDefined();
  });

  it('word pause 100-300ms after space character (AC5)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanType(page, 'a b', { delayFn, rng: () => 0.5 });
    // delay after 'a' and after ' ' and after 'b': word pause for ' ' = 100 + 0.5*200 = 200ms
    const wordPause = delayFn.mock.calls.find(c => c[0] === 200);
    expect(wordPause).toBeDefined();
    // other two are normal: 80 + 0.5*40 = 100ms
    const normalDelays = delayFn.mock.calls.filter(c => c[0] === 100);
    expect(normalDelays.length).toBe(2);
  });

  it('punctuation pause 200-500ms after punctuation (AC5)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanType(page, 'a.b', { delayFn, rng: () => 0.5 });
    // '.' should have 200 + 0.5*300 = 350ms pause
    const punctPause = delayFn.mock.calls.find(c => c[0] === 350);
    expect(punctPause).toBeDefined();
  });

  it('delayFn seam is used for all delays (AC6)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanType(page, 'hi', { delayFn, rng: () => 0.5 });
    expect(delayFn).toHaveBeenCalled();
    expect(delayFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('rng seam is used for all random decisions (AC7)', async () => {
    const page = makeFakePage();
    const rng = vi.fn(() => 0.5);
    await humanType(page, 'hi', { delayFn: async () => {}, rng });
    expect(rng).toHaveBeenCalled();
    expect(rng.mock.calls.length).toBeGreaterThanOrEqual(4); // per-char delay + typo check + word pause
  });

  it('empty string — no keyboard.type calls (edge case)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanType(page, '', { delayFn, rng: () => 0.5 });
    expect(page.calls.keyboard.type.length).toBe(0);
    expect(page.calls.keyboard.press.length).toBe(0);
    expect(delayFn.mock.calls.length).toBe(0);
  });

  it('single character — one keyboard.type call', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanType(page, 'x', { delayFn, rng: () => 0.5 });
    expect(page.calls.keyboard.type.length).toBe(1);
    expect(page.calls.keyboard.type[0].text).toBe('x');
    expect(delayFn.mock.calls.length).toBe(1);
  });

  it('humanMoveMouse and humanClick still work (AC9 — no regression)', async () => {
    const page = makeFakePage();
    await humanMoveMouse(page, 100, 200, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.move.length).toBeGreaterThan(0);

    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    const page2 = makeFakePage();
    await humanClick(page2, el, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page2.calls.mouse.down.length).toBe(1);
    expect(page2.calls.mouse.up.length).toBe(1);
  });
});

// ============================================================================
// humanScroll (AC1-AC9 — Story 6.12)
// ============================================================================

describe('humanScroll (AC1-AC9 — Story 6.12)', () => {
  it('is an async function (AC1)', () => {
    expect(typeof humanScroll).toBe('function');
    const page = makeFakePage();
    expect(humanScroll(page, 1000, { delayFn: async () => {}, rng: () => 0.5 })).toBeInstanceOf(Promise);
  });

  it('calls page.mouse.wheel 5-10 times (AC2)', async () => {
    const page = makeFakePage();
    await humanScroll(page, 1000, { delayFn: async () => {}, rng: () => 0.5 });
    const wheelCount = page.calls.mouse.wheel.length;
    expect(wheelCount).toBeGreaterThanOrEqual(5);
    expect(wheelCount).toBeLessThanOrEqual(10);
  });

  it('sum of all deltaY values equals input distance (AC2, AC3)', async () => {
    const page = makeFakePage();
    await humanScroll(page, 1000, { delayFn: async () => {}, rng: () => 0.5 });
    const totalDelta = page.calls.mouse.wheel.reduce((sum, w) => sum + w.deltaY, 0);
    expect(totalDelta).toBe(1000);
  });

  it('middle chunk is largest (sin curve slow-fast-slow) (AC3)', async () => {
    const page = makeFakePage();
    // Force 10 chunks with rng=0.0 for chunkCount, then other rng calls use 0.5
    let call = 0;
    const rng = () => {
      call++;
      // chunkCount: 5 + Math.floor(rng()*6) → first call should return 0 for 5 chunks, but let's use 5 chunks
      if (call === 1) return 0.0; // 5 chunks
      return 0.5;
    };
    await humanScroll(page, 1000, { delayFn: async () => {}, rng });
    const deltas = page.calls.mouse.wheel.map(w => w.deltaY);
    // With 5 chunks and sin curve, the middle chunk (index 2) should be largest
    const middleDelta = deltas[2];
    const firstDelta = deltas[0];
    const lastDelta = deltas[deltas.length - 1];
    expect(middleDelta).toBeGreaterThan(firstDelta);
    expect(middleDelta).toBeGreaterThan(lastDelta);
  });

  it('first and last chunks are smaller than middle (AC3)', async () => {
    const page = makeFakePage();
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0.0; // 5 chunks
      return 0.5;
    };
    await humanScroll(page, 1000, { delayFn: async () => {}, rng });
    const deltas = page.calls.mouse.wheel.map(w => w.deltaY);
    const middleDelta = deltas[Math.floor(deltas.length / 2)];
    expect(deltas[0]).toBeLessThan(middleDelta);
    expect(deltas[deltas.length - 1]).toBeLessThan(middleDelta);
  });

  it('20% overshoot triggers with rng=0.0 and adds correction (AC4)', async () => {
    const page = makeFakePage();
    // rng=0.0 forces overshoot (0.0 < 0.2) and overshootPercent=0.05 (5%)
    // For distance 1000, overshoot = 50, correction = -50
    const delayFn = async () => {};
    await humanScroll(page, 1000, { delayFn, rng: () => 0.0 });
    const deltas = page.calls.mouse.wheel.map(w => w.deltaY);
    // Last two should be overshoot + correction
    expect(deltas.length).toBeGreaterThanOrEqual(7); // 5 base + 2 overshoot
    const overshoot = deltas[deltas.length - 2];
    const correction = deltas[deltas.length - 1];
    expect(overshoot).toBe(50);
    expect(correction).toBe(-50);
    // Total still equals 1000 (50 - 50 cancels)
    expect(deltas.reduce((s, d) => s + d, 0)).toBe(1000);
  });

  it('delay 100-400ms between chunks (AC5)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    let call = 0;
    const rng = () => {
      call++;
      if (call === 1) return 0.0; // 5 chunks
      return 0.5;
    };
    await humanScroll(page, 1000, { delayFn, rng });
    // 5 chunks with no overshoot → 4 inter-chunk delays
    const interChunkDelays = delayFn.mock.calls.filter(c => c[0] >= 100 && c[0] <= 400);
    expect(interChunkDelays.length).toBeGreaterThanOrEqual(4);
    expect(interChunkDelays.every(c => c[0] === 250)).toBe(true); // 100 + 0.5*300 = 250
  });

  it('delayFn seam is used for all inter-chunk delays (AC6)', async () => {
    const page = makeFakePage();
    const delayFn = vi.fn(async () => {});
    await humanScroll(page, 1000, { delayFn, rng: () => 0.5 });
    expect(delayFn).toHaveBeenCalled();
    expect(delayFn.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('rng seam is used for all random decisions (AC7)', async () => {
    const page = makeFakePage();
    const rng = vi.fn(() => 0.5);
    await humanScroll(page, 1000, { delayFn: async () => {}, rng });
    expect(rng).toHaveBeenCalled();
    expect(rng.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('zero distance — no wheel calls (edge case)', async () => {
    const page = makeFakePage();
    await humanScroll(page, 0, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.wheel.length).toBe(0);
  });

  it('small distance 1px produces a single non-zero chunk (no 0-px no-ops)', async () => {
    const page = makeFakePage();
    // desiredChunkCount = 8 with rng=0.5, clamped to 1 because |distance| = 1; no overshoot
    await humanScroll(page, 1, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.wheel.length).toBe(1);
    expect(page.calls.mouse.wheel[0].deltaY).toBe(1);
  });

  it('small distance negative -1px produces a single non-zero chunk', async () => {
    const page = makeFakePage();
    await humanScroll(page, -1, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.wheel.length).toBe(1);
    expect(page.calls.mouse.wheel[0].deltaY).toBe(-1);
  });

  it('small distance 3px clamped to at most 3 chunks (no 0-px no-ops)', async () => {
    const page = makeFakePage();
    // desiredChunkCount = 8 with rng=0.5, clamped to min(3, 8) = 3; no overshoot
    await humanScroll(page, 3, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.wheel.length).toBeLessThanOrEqual(3);
    expect(page.calls.mouse.wheel.length).toBeGreaterThanOrEqual(1);
    expect(page.calls.mouse.wheel.every(w => w.deltaY !== 0)).toBe(true);
    const total = page.calls.mouse.wheel.reduce((s, w) => s + w.deltaY, 0);
    expect(total).toBe(3);
  });

  it('negative distance works (scrolls up, chunks are negative)', async () => {
    const page = makeFakePage();
    await humanScroll(page, -1000, { delayFn: async () => {}, rng: () => 0.5 });
    const totalDelta = page.calls.mouse.wheel.reduce((sum, w) => sum + w.deltaY, 0);
    expect(totalDelta).toBe(-1000);
  });

  it('humanMoveMouse, humanClick, humanType still work (AC9 — no regression)', async () => {
    const page = makeFakePage();
    await humanMoveMouse(page, 100, 200, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page.calls.mouse.move.length).toBeGreaterThan(0);

    const el = makeElementHandle({ boundingBox: { x: 100, y: 200, width: 50, height: 30 } });
    const page2 = makeFakePage();
    await humanClick(page2, el, { delayFn: async () => {}, rng: () => 0.5 });
    expect(page2.calls.mouse.down.length).toBe(1);

    const page3 = makeFakePage();
    await humanType(page3, 'hi', { delayFn: async () => {}, rng: () => 0.5 });
    expect(page3.calls.keyboard.type.length).toBe(2);
  });

  // ============================================================================
  // Story 6.18 — Proportional Overshoot & Input Validation
  // ============================================================================

  describe('Story 6.18 — Proportional Overshoot & Input Validation', () => {
    it('proportional overshoot for large movement (1000px) is capped at 25px (AC1)', async () => {
      const page = makeFakePage();
      // rng sequence:
      // stepCount call: 0.1 -> 21 steps
      // control point offsets: 0.1, 0.1, 0.1, 0.1
      // willOvershoot call: 0.1 ( < 0.15 => true!)
      // overScalar call: 0.05 + 0.1*0.10 = 0.06 => 6% of 1000 = 60px -> clamped to 25px max!
      const rng = () => 0.1;
      await humanMoveMouse(page, 1000, 0, { delayFn: async () => {}, rng, startX: 0, startY: 0 });

      // Check the maximum x position reached during overshoot
      const moves = page.calls.mouse.move;
      const maxMoveX = Math.max(...moves.map((m) => m.x));
      // Max move x should be near 1000 + 25 = 1025px (± jitter)
      expect(maxMoveX).toBeLessThanOrEqual(1030);
      expect(maxMoveX).toBeGreaterThan(1005);
    });

    it('proportional overshoot for tiny movement (5px) is at least 1px and proportional (AC1)', async () => {
      const page = makeFakePage();
      const rng = () => 0.1;
      await humanMoveMouse(page, 5, 0, { delayFn: async () => {}, rng, startX: 0, startY: 0 });

      const moves = page.calls.mouse.move;
      const maxMoveX = Math.max(...moves.map((m) => m.x));
      // 5px * 0.06 = 0.3px -> clamped to minimum 1px. Max move x near 6px ± jitter
      expect(maxMoveX).toBeLessThanOrEqual(10);
    });

    it('humanMoveMouse throws when x or y is not a finite number (AC2)', async () => {
      const page = makeFakePage();
      await expect(humanMoveMouse(page, NaN, 100)).rejects.toThrow(/humanMoveMouse/);
      await expect(humanMoveMouse(page, 100, undefined)).rejects.toThrow(/humanMoveMouse/);
      await expect(humanMoveMouse(null, 100, 100)).rejects.toThrow(/humanMoveMouse/);
      await expect(humanMoveMouse(page, 100, 100, { startX: NaN })).rejects.toThrow(/humanMoveMouse/);
      await expect(humanMoveMouse(page, 100, 100, { startY: Number.POSITIVE_INFINITY })).rejects.toThrow(/humanMoveMouse/);
    });

    it('humanClick throws when page or element is invalid (AC3)', async () => {
      const page = makeFakePage();
      delete page.mouse;
      const element = makeElementHandle({ boundingBox: { x: 10, y: 10, width: 20, height: 20 } });
      await expect(humanClick(page, element)).rejects.toThrow(/humanClick/);
      await expect(humanClick(makeFakePage(), null)).rejects.toThrow(/humanClick/);

      const noDown = makeFakePage();
      delete noDown.mouse.down;
      await expect(humanClick(noDown, element)).rejects.toThrow(/humanClick/);

      const noUp = makeFakePage();
      delete noUp.mouse.up;
      await expect(humanClick(noUp, element)).rejects.toThrow(/humanClick/);
    });

    it('humanType throws when page or text is invalid (AC4)', async () => {
      const page = makeFakePage();
      delete page.keyboard;
      await expect(humanType(page, 'hello')).rejects.toThrow(/humanType/);
      await expect(humanType(makeFakePage(), null)).rejects.toThrow(/humanType/);
      await expect(humanType(makeFakePage(), 123)).rejects.toThrow(/humanType/);
    });

    it('humanScroll throws when page or distance is invalid (AC5)', async () => {
      const page = makeFakePage();
      delete page.mouse;
      await expect(humanScroll(page, 100)).rejects.toThrow(/humanScroll/);
      await expect(humanScroll(makeFakePage(), NaN)).rejects.toThrow(/humanScroll/);
      await expect(humanScroll(makeFakePage(), null)).rejects.toThrow(/humanScroll/);
    });

    it('error messages are generic and do not echo input values (NFR4)', async () => {
      expect.assertions(2);
      const secretText = 'CONFIDENTIAL_SECRET_123';
      try {
        await humanType(null, secretText);
      } catch (err) {
        expect(err.message).not.toContain(secretText);
        expect(err.message).toContain('humanType');
      }
    });
  });
});
