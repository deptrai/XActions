// by nichxbt
// Tests for Story 4.9: warmupAccount (FR-23, Cluster-2, dry-run default)
// Browser-free: fake page + injected delay/now/reactFn seams. No vi.mock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  warmupAccount,
  MAX_WARMUP_DURATION_SECONDS,
  DEFAULT_WARMUP_DURATION_SECONDS,
} from '../../api/services/facebookAutomation.js';

function makeDelaySpy() {
  const calls = [];
  const spy = async (min, max) => { calls.push([min, max]); };
  spy.calls = calls;
  return spy;
}

// Fake clock: first call returns 0 (loop start), then advances by `step` each subsequent call.
function makeFakeClock(step = 10000) {
  let t = -step;
  return () => (t += step);
}

function makeReactSpy() {
  const calls = [];
  const spy = async (page) => { calls.push(page); };
  spy.calls = calls;
  return spy;
}

function makeFakePage() {
  const calls = { goto: [], evaluate: [], click: [] };
  return {
    calls,
    goto: async (url, opts) => { calls.goto.push({ url, opts }); },
    evaluate: async (fn, ...args) => { calls.evaluate.push(args); },
    click: async (selector) => { calls.click.push(selector); },
  };
}

describe('warmupAccount — dry-run (default)', () => {
  it('returns preview without calling any seam or page.*, page may be null', async () => {
    const delay = makeDelaySpy();
    const reactFn = makeReactSpy();
    const now = vi.fn();

    const result = await warmupAccount(null, { delay, now, reactFn });

    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.preview).toMatchObject({
      durationSeconds: DEFAULT_WARMUP_DURATION_SECONDS,
      clamped: false,
      allowReactions: false,
      reactProbability: 0.05,
      reactProbabilityClamped: false,
    });
    expect(delay.calls).toHaveLength(0);
    expect(reactFn.calls).toHaveLength(0);
    expect(now).not.toHaveBeenCalled();
  });

  it('dry-run with explicit dryRun:true — still no seam calls', async () => {
    const delay = makeDelaySpy();
    const result = await warmupAccount(null, { dryRun: true, delay });
    expect(result.dryRun).toBe(true);
    expect(delay.calls).toHaveLength(0);
  });

  it('does NOT emit the mandatory warning on dry-run', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await warmupAccount(null, {});
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('warmupAccount — real run requires a page', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('throws a clear error when page is null on a real run', async () => {
    await expect(
      warmupAccount(null, { dryRun: false, durationSeconds: 60, now: makeFakeClock(30000) }),
    ).rejects.toThrow('page is required');
  });
});

describe('warmupAccount — duration clamp', () => {
  it('clamps 9999 to 600', async () => {
    const result = await warmupAccount(null, { durationSeconds: 9999 });
    expect(result.preview.durationSeconds).toBe(600);
    expect(result.preview.clamped).toBe(true);
  });

  it('missing durationSeconds defaults to 120 (exact)', async () => {
    const result = await warmupAccount(null, {});
    expect(result.preview.durationSeconds).toBe(DEFAULT_WARMUP_DURATION_SECONDS);
    expect(result.preview.durationSeconds).toBe(120);
    expect(result.preview.clamped).toBe(false);
  });

  it('null durationSeconds defaults to 120', async () => {
    const result = await warmupAccount(null, { durationSeconds: null });
    expect(result.preview.durationSeconds).toBe(120);
  });

  it('throws on 0', async () => {
    await expect(warmupAccount(null, { durationSeconds: 0 })).rejects.toThrow('durationSeconds');
  });

  it('throws on negative', async () => {
    await expect(warmupAccount(null, { durationSeconds: -5 })).rejects.toThrow('durationSeconds');
  });

  it('throws on NaN', async () => {
    await expect(warmupAccount(null, { durationSeconds: NaN })).rejects.toThrow('durationSeconds');
  });

  it('throws on non-number string', async () => {
    await expect(warmupAccount(null, { durationSeconds: 'long' })).rejects.toThrow('durationSeconds');
  });

  it('throws on Infinity', async () => {
    await expect(warmupAccount(null, { durationSeconds: Infinity })).rejects.toThrow('durationSeconds');
  });
});

describe('warmupAccount — reactProbability normalization (dry-run)', () => {
  it('0.9 → clamped to 0.2, reactProbabilityClamped=true', async () => {
    const result = await warmupAccount(null, { reactProbability: 0.9 });
    expect(result.preview.reactProbability).toBe(0.2);
    expect(result.preview.reactProbabilityClamped).toBe(true);
  });

  it('0.05 → unchanged, reactProbabilityClamped=false', async () => {
    const result = await warmupAccount(null, { reactProbability: 0.05 });
    expect(result.preview.reactProbability).toBe(0.05);
    expect(result.preview.reactProbabilityClamped).toBe(false);
  });

  it('0 → normalized to 0, not clamped', async () => {
    const result = await warmupAccount(null, { reactProbability: 0 });
    expect(result.preview.reactProbability).toBe(0);
    expect(result.preview.reactProbabilityClamped).toBe(false);
  });

  it('negative → normalized to 0', async () => {
    const result = await warmupAccount(null, { reactProbability: -0.1 });
    expect(result.preview.reactProbability).toBe(0);
  });

  it('NaN → normalized to 0', async () => {
    const result = await warmupAccount(null, { reactProbability: NaN });
    expect(result.preview.reactProbability).toBe(0);
  });

  it('non-number → normalized to 0', async () => {
    const result = await warmupAccount(null, { reactProbability: 'high' });
    expect(result.preview.reactProbability).toBe(0);
  });

  it('Infinity → normalized to 0 AND reactProbabilityClamped false (not "clamped to 0.2")', async () => {
    const result = await warmupAccount(null, { reactProbability: Infinity });
    expect(result.preview.reactProbability).toBe(0);
    expect(result.preview.reactProbabilityClamped).toBe(false);
  });

  it('exactly 0.2 → unchanged, not clamped', async () => {
    const result = await warmupAccount(null, { reactProbability: 0.2 });
    expect(result.preview.reactProbability).toBe(0.2);
    expect(result.preview.reactProbabilityClamped).toBe(false);
  });
});

describe('warmupAccount — real run: scroll-only (allowReactions false, default)', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('scrolls without calling reactFn, only goto+evaluate', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    const reactFn = makeReactSpy();
    const now = makeFakeClock(1000); // 1s steps → 60 iterations before 60s expires

    await warmupAccount(page, {
      dryRun: false,
      durationSeconds: 60,
      allowReactions: false,
      reactFn,
      delay,
      now,
    });

    expect(page.calls.goto.length).toBe(1);
    expect(page.calls.goto[0].url).toBe('https://www.facebook.com/');
    expect(page.calls.evaluate.length).toBeGreaterThan(0);
    expect(reactFn.calls).toHaveLength(0);
    expect(page.calls.click).toHaveLength(0);
  });

  it('emits mandatory warning BEFORE the first scroll (ordering guard)', async () => {
    const events = [];
    const warnLocalSpy = vi.spyOn(console, 'warn').mockImplementation(() => { events.push('warn'); });
    // Page that records goto/evaluate into the shared ordered event log.
    const page = {
      goto: async () => { events.push('goto'); },
      evaluate: async () => { events.push('scroll'); },
    };
    const delay = makeDelaySpy();
    const now = makeFakeClock(30000);

    await warmupAccount(page, { dryRun: false, durationSeconds: 60, delay, now });

    // Presence:
    expect(warnLocalSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Account warming does not guarantee avoiding checkpoint/),
    );
    // Ordering: warn fires before goto, and before any scroll. A code reorder
    // that moved the warning after the first scroll would fail here.
    const warnIdx = events.indexOf('warn');
    const firstScrollIdx = events.indexOf('scroll');
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(warnIdx).toBeLessThan(events.indexOf('goto'));
    expect(warnIdx).toBeLessThan(firstScrollIdx);
    warnLocalSpy.mockRestore();
  });
});

describe('warmupAccount — real run: reactions enabled (allowReactions true)', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('reactProbability 1.0 (clamped to 0.2): reactFn fires probabilistically across iterations', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    const reactFn = makeReactSpy();
    const now = makeFakeClock(1000); // 1s steps → 60 iterations before 60s expires

    const result = await warmupAccount(page, {
      dryRun: false,
      durationSeconds: 60,
      allowReactions: true,
      reactProbability: 1.0,
      reactFn,
      delay,
      now,
    });

    // 1.0 > 0.2, so it is clamped to 0.2 (AC3.7). Math.random() < 0.2 is NOT
    // deterministic, so "every iteration" is impossible to assert. Over ~60
    // iterations, P(zero reactions) = 0.8^60 ≈ 1.5e-6 — so "at least one fires"
    // is effectively certain. We assert the gate is REACHED (reactFn called when
    // allowReactions+probability>0), not an exact count.
    expect(result.scrolls).toBeGreaterThan(0);
    expect(reactFn.calls.length).toBeGreaterThan(0);
  });

  it('reactProbability 0: reactFn NEVER called even with allowReactions true', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    const reactFn = makeReactSpy();
    const now = makeFakeClock(30000);

    await warmupAccount(page, {
      dryRun: false,
      durationSeconds: 60,
      allowReactions: true,
      reactProbability: 0,
      reactFn,
      delay,
      now,
    });

    expect(reactFn.calls).toHaveLength(0);
  });

  it('negative reactProbability normalized to 0: reactFn NEVER called', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    const reactFn = makeReactSpy();
    const now = makeFakeClock(30000);

    await warmupAccount(page, {
      dryRun: false,
      durationSeconds: 60,
      allowReactions: true,
      reactProbability: -0.5,
      reactFn,
      delay,
      now,
    });

    expect(reactFn.calls).toHaveLength(0);
  });

  it('NaN reactProbability normalized to 0: reactFn NEVER called', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    const reactFn = makeReactSpy();
    const now = makeFakeClock(30000);

    await warmupAccount(page, {
      dryRun: false,
      durationSeconds: 60,
      allowReactions: true,
      reactProbability: NaN,
      reactFn,
      delay,
      now,
    });

    expect(reactFn.calls).toHaveLength(0);
  });
});

describe('warmupAccount — real run: ≥5s pause every 3 iterations', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('delay spy records [5000,8000] on every 3rd iteration, [800,2500] otherwise', async () => {
    const page = makeFakePage();
    const delay = makeDelaySpy();
    // First call returns 0 (start), then advances 5s each call — gives ~6 scrolls before 30s expires
    const now = makeFakeClock(5000);

    await warmupAccount(page, {
      dryRun: false,
      durationSeconds: 30,
      allowReactions: false,
      delay,
      now,
    });

    // Verify pattern: iterations 3, 6, 9... get long pause; others get short pause
    delay.calls.forEach((call, idx) => {
      const iteration = idx + 1; // 1-based
      if (iteration % 3 === 0) {
        expect(call).toEqual([5000, 8000]);
      } else {
        expect(call).toEqual([800, 2500]);
      }
    });
    // Sanity: at least one long pause happened
    const longPauses = delay.calls.filter(c => c[0] === 5000);
    expect(longPauses.length).toBeGreaterThan(0);
  });
});

describe('warmupAccount — real run: NO follow/friend/comment guard', () => {
  let warnSpy;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { warnSpy.mockRestore(); });

  it('only calls goto(home) + evaluate(scrollBy), no other page methods', async () => {
    // Structural guard: fake page exposes extra spies for social actions
    const socialCalls = { follow: [], addFriend: [], comment: [], click: [] };
    const page = {
      calls: { goto: [], evaluate: [] },
      goto: async (url, opts) => { page.calls.goto.push(url); },
      evaluate: async (fn, ...args) => { page.calls.evaluate.push(args); },
      // Social-action spies — should never be called
      follow: async (...a) => { socialCalls.follow.push(a); },
      addFriend: async (...a) => { socialCalls.addFriend.push(a); },
      comment: async (...a) => { socialCalls.comment.push(a); },
      click: async (...a) => { socialCalls.click.push(a); },
    };
    const delay = makeDelaySpy();
    const now = makeFakeClock(1000); // 1s steps → loop runs before 30s expires

    await warmupAccount(page, {
      dryRun: false,
      durationSeconds: 30,
      allowReactions: false,
      delay,
      now,
    });

    expect(page.calls.goto).toHaveLength(1);
    expect(page.calls.goto[0]).toBe('https://www.facebook.com/');
    expect(page.calls.evaluate.length).toBeGreaterThan(0);
    // Structural guard (not proof of absence — see AC7.14)
    expect(socialCalls.follow).toHaveLength(0);
    expect(socialCalls.addFriend).toHaveLength(0);
    expect(socialCalls.comment).toHaveLength(0);
    expect(socialCalls.click).toHaveLength(0);
  });
});

describe('warmupAccount — constants', () => {
  it('MAX_WARMUP_DURATION_SECONDS is 600', () => {
    expect(MAX_WARMUP_DURATION_SECONDS).toBe(600);
  });

  it('DEFAULT_WARMUP_DURATION_SECONDS is 120', () => {
    expect(DEFAULT_WARMUP_DURATION_SECONDS).toBe(120);
  });
});
