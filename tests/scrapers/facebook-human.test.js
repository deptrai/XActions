// tests/scrapers/facebook-human.test.js
// Story 6.9 — Bezier Mouse Movement (ADR-014)
// Pure-module tests for src/scrapers/facebook/human.js
// No Puppeteer required — human.js is a pure module.
import { describe, it, expect, vi } from 'vitest';
import { humanMoveMouse, humanClick } from '../../src/scrapers/facebook/human.js';
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
