// by nichxbt
// Coverage expansion (TEA automate) — Story 4.3 warmupScrollFeed.
// Boundary/error paths + Operation-seam behaviors not covered by facebook-view-boost.test.js.
// Browser-free + DB-free: fake page + injected delay/now/createOperation/updateOperation seams.
// No vi.mock; no real sleep, no real 300s wait.

import { describe, it, expect } from 'vitest';
import {
  warmupScrollFeed,
  MAX_DURATION_SECONDS,
} from '../../api/services/facebookAutomation.js';

function makeFakePage({ gotoThrows = null } = {}) {
  const calls = { goto: [], evaluate: [] };
  return {
    calls,
    goto: async (url) => {
      calls.goto.push(url);
      if (gotoThrows) throw gotoThrows;
    },
    evaluate: async (fn, arg) => { calls.evaluate.push(arg); },
  };
}

// Fake clock advanced by the injected delay seam — drives the time loop deterministically.
function makeClockSeam(stepMs = 1000) {
  let t = 0;
  const delayCalls = [];
  return {
    now: () => t,
    delay: async (min, max) => { delayCalls.push([min, max]); t += stepMs; },
    delayCalls,
  };
}

const URL_OK = 'https://www.facebook.com/somepage/posts/123';

describe('warmupScrollFeed — duration boundaries', () => {
  it('durationSeconds exactly MAX (300) is NOT clamped', async () => {
    const result = await warmupScrollFeed(makeFakePage(), URL_OK, { durationSeconds: MAX_DURATION_SECONDS });
    expect(result.preview).toEqual({ targetUrl: URL_OK, durationSeconds: 300, clamped: false });
  });

  it('durationSeconds one over MAX (301) is clamped to 300', async () => {
    const result = await warmupScrollFeed(makeFakePage(), URL_OK, { durationSeconds: 301 });
    expect(result.preview.durationSeconds).toBe(300);
    expect(result.preview.clamped).toBe(true);
  });

  it('durationSeconds:null falls back to the 60s default', async () => {
    const result = await warmupScrollFeed(makeFakePage(), URL_OK, { durationSeconds: null });
    expect(result.preview.durationSeconds).toBe(60);
    expect(result.preview.clamped).toBe(false);
  });

  it('durationSeconds as a string → throws (positive finite number required)', async () => {
    await expect(
      warmupScrollFeed(makeFakePage(), URL_OK, { durationSeconds: '120' }),
    ).rejects.toThrow('durationSeconds must be a positive finite number');
  });

  it('durationSeconds <= 0 → throws', async () => {
    await expect(warmupScrollFeed(makeFakePage(), URL_OK, { durationSeconds: 0 })).rejects.toThrow('positive finite');
    await expect(warmupScrollFeed(makeFakePage(), URL_OK, { durationSeconds: -5 })).rejects.toThrow('positive finite');
  });
});

describe('warmupScrollFeed — URL guard', () => {
  it('missing targetUrl → throws before browser', async () => {
    const page = makeFakePage();
    await expect(warmupScrollFeed(page, undefined, { dryRun: false })).rejects.toThrow('non-empty string');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('accepts an http (non-TLS) subdomain facebook URL', async () => {
    const result = await warmupScrollFeed(makeFakePage(), 'http://m.facebook.com/p/1', { durationSeconds: 30 });
    expect(result.preview.targetUrl).toBe('http://m.facebook.com/p/1');
  });
});

describe('warmupScrollFeed — real run seams', () => {
  it('dryRun:null stays dry-run (no goto, no Operation)', async () => {
    const page = makeFakePage();
    let opCreated = false;
    const result = await warmupScrollFeed(page, URL_OK, {
      dryRun: null, durationSeconds: 30, createOperation: async () => { opCreated = true; return { id: 'x' }; },
    });
    expect(result.dryRun).toBe(true);
    expect(page.calls.goto).toHaveLength(0);
    expect(opCreated).toBe(false);
  });

  it('real run passes (800,2500) to the delay seam between scrolls', async () => {
    const clock = makeClockSeam(1000);
    await warmupScrollFeed(makeFakePage(), URL_OK, {
      dryRun: false, durationSeconds: 3, now: clock.now, delay: clock.delay,
    });
    expect(clock.delayCalls.length).toBeGreaterThan(0);
    for (const [min, max] of clock.delayCalls) {
      expect(min).toBe(800);
      expect(max).toBe(2500);
    }
  });

  it('real run returns the run summary shape (targetUrl, durationSeconds, scrolls, operationId)', async () => {
    const clock = makeClockSeam(1000);
    const result = await warmupScrollFeed(makeFakePage(), URL_OK, {
      dryRun: false, durationSeconds: 3, now: clock.now, delay: clock.delay,
    });
    expect(result.dryRun).toBe(false);
    expect(result.targetUrl).toBe(URL_OK);
    expect(result.durationSeconds).toBe(3);
    expect(result.scrolls).toBeGreaterThan(0);
    expect(result.operationId).toBeNull(); // no userId → no Operation
  });

  it('with userId: completes the Operation via updateOperation (status completed)', async () => {
    const clock = makeClockSeam(1000);
    const updates = [];
    const result = await warmupScrollFeed(makeFakePage(), URL_OK, {
      dryRun: false, durationSeconds: 2, userId: 'u1', now: clock.now, delay: clock.delay,
      createOperation: async ({ userId, targetUrl }) => ({ id: 'op-1', userId, targetUrl }),
      updateOperation: async (id, data) => { updates.push({ id, data }); },
    });
    expect(result.operationId).toBe('op-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('op-1');
    expect(updates[0].data.status).toBe('completed');
  });

  it('page.goto throws → Operation marked failed (PII-bounded, <=200 chars) AND error re-thrown', async () => {
    const clock = makeClockSeam(1000);
    const updates = [];
    const longMsg = 'Navigation timeout exceeded ' + 'x'.repeat(500);
    const err = new Error(longMsg);
    await expect(
      warmupScrollFeed(makeFakePage({ gotoThrows: err }), URL_OK, {
        dryRun: false, durationSeconds: 5, userId: 'u1', now: clock.now, delay: clock.delay,
        createOperation: async () => ({ id: 'op-2' }),
        updateOperation: async (id, data) => { updates.push({ id, data }); },
      }),
    ).rejects.toThrow(/Navigation timeout/);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('failed');
    expect(updates[0].data.error.length).toBeLessThanOrEqual(200);
  });

  it('page.goto throws with an err.code → code is preserved in the persisted error', async () => {
    const clock = makeClockSeam(1000);
    const updates = [];
    const err = new Error('socket hang up'); err.code = 'ECONNRESET';
    await expect(
      warmupScrollFeed(makeFakePage({ gotoThrows: err }), URL_OK, {
        dryRun: false, durationSeconds: 5, userId: 'u1', now: clock.now, delay: clock.delay,
        createOperation: async () => ({ id: 'op-3' }),
        updateOperation: async (id, data) => { updates.push({ id, data }); },
      }),
    ).rejects.toThrow('socket hang up');
    expect(updates[0].data.error).toContain('ECONNRESET');
  });

  it('a throwing updateOperation on the failure path does not mask the original error', async () => {
    const clock = makeClockSeam(1000);
    const err = new Error('original nav failure');
    await expect(
      warmupScrollFeed(makeFakePage({ gotoThrows: err }), URL_OK, {
        dryRun: false, durationSeconds: 5, userId: 'u1', now: clock.now, delay: clock.delay,
        createOperation: async () => ({ id: 'op-4' }),
        updateOperation: async () => { throw new Error('DB write also failed'); },
      }),
    ).rejects.toThrow('original nav failure'); // original error wins, not the updateOperation throw
  });

  it('createOperation throws → error propagates before any goto', async () => {
    const page = makeFakePage();
    await expect(
      warmupScrollFeed(page, URL_OK, {
        dryRun: false, durationSeconds: 5, userId: 'u1',
        now: makeClockSeam().now, delay: makeClockSeam().delay,
        createOperation: async () => { throw new Error('cannot create Operation'); },
      }),
    ).rejects.toThrow('cannot create Operation');
    expect(page.calls.goto).toHaveLength(0);
  });
});
