// by nichxbt
// Tests for Story 4.3: warmupScrollFeed (view boost via scroll simulation)
// Browser-free + DB-free: fake page + injected delay/now/createOperation seams.
// No vi.mock per project mandate; no real sleep, no real 300s wait.

import { describe, it, expect } from 'vitest';
import {
  warmupScrollFeed,
  assertFacebookUrl,
  MAX_DURATION_SECONDS,
} from '../../api/services/facebookAutomation.js';

// Fake page records every interaction so we can assert scroll-only + no-DOM-in-dry-run.
function makeFakePage() {
  const calls = { goto: [], evaluate: [], click: [] };
  return {
    calls,
    goto: async (url) => { calls.goto.push(url); },
    evaluate: async (fn, arg) => { calls.evaluate.push(arg); },
    click: async () => { calls.click.push(true); },
  };
}

// Fake clock advanced by the injected delay seam — drives the time-bounded loop
// deterministically so no test ever waits a real second.
function makeClockSeam(stepMs = 1000) {
  let t = 0;
  return {
    now: () => t,
    delay: async () => { t += stepMs; },
  };
}

const URL_OK = 'https://www.facebook.com/somepage/posts/123';

describe('assertFacebookUrl (shared guard)', () => {
  it('accepts a facebook.com https URL', () => {
    expect(() => assertFacebookUrl(URL_OK)).not.toThrow();
    expect(() => assertFacebookUrl('https://facebook.com/x')).not.toThrow();
  });
  it('rejects empty / non-string', () => {
    expect(() => assertFacebookUrl('')).toThrow('non-empty string');
    expect(() => assertFacebookUrl(null)).toThrow('non-empty string');
  });
  it('rejects file:/javascript: (SSRF)', () => {
    expect(() => assertFacebookUrl('file:///etc/passwd')).toThrow(/valid URL|http\(s\) URL|facebook\.com URL/);
    expect(() => assertFacebookUrl('javascript:alert(1)')).toThrow(/valid URL|http\(s\) URL|facebook\.com URL/);
  });
  it('rejects non-facebook host', () => {
    expect(() => assertFacebookUrl('https://evil.com/x')).toThrow('facebook.com URL');
  });
  it('rejects look-alike host (faux suffix)', () => {
    expect(() => assertFacebookUrl('https://notfacebook.com/x')).toThrow('facebook.com URL');
  });
});

describe('warmupScrollFeed', () => {
  it('dry-run: returns preview with clamped duration, calls NO page.* method, creates NO Operation', async () => {
    const page = makeFakePage();
    let opCreated = false;
    const result = await warmupScrollFeed(page, URL_OK, {
      durationSeconds: 120,
      createOperation: async () => { opCreated = true; return { id: 'x' }; },
    });

    expect(result.dryRun).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.preview).toEqual({ targetUrl: URL_OK, durationSeconds: 120, clamped: false });
    expect(page.calls.goto).toHaveLength(0);
    expect(page.calls.evaluate).toHaveLength(0);
    expect(page.calls.click).toHaveLength(0);
    expect(opCreated).toBe(false);
  });

  it('dry-run works with null page (page not touched)', async () => {
    const result = await warmupScrollFeed(null, URL_OK, { durationSeconds: 30 });
    expect(result.dryRun).toBe(true);
    expect(result.preview.durationSeconds).toBe(30);
  });

  it('durationSeconds: 9999 → clamped to 300 (clamped:true)', async () => {
    const result = await warmupScrollFeed(null, URL_OK, { durationSeconds: 9999 });
    expect(result.preview.durationSeconds).toBe(MAX_DURATION_SECONDS);
    expect(result.preview.durationSeconds).toBe(300);
    expect(result.preview.clamped).toBe(true);
  });

  it('default duration applied when omitted', async () => {
    const result = await warmupScrollFeed(null, URL_OK, {});
    expect(result.preview.durationSeconds).toBe(60);
    expect(result.preview.clamped).toBe(false);
  });

  it('durationSeconds: 0 / negative / non-finite → throws', async () => {
    await expect(warmupScrollFeed(null, URL_OK, { durationSeconds: 0 })).rejects.toThrow('positive finite');
    await expect(warmupScrollFeed(null, URL_OK, { durationSeconds: -5 })).rejects.toThrow('positive finite');
    await expect(warmupScrollFeed(null, URL_OK, { durationSeconds: Infinity })).rejects.toThrow('positive finite');
    await expect(warmupScrollFeed(null, URL_OK, { durationSeconds: NaN })).rejects.toThrow('positive finite');
  });

  it('invalid / non-facebook / file: targetUrl → throws before any page.*', async () => {
    const page = makeFakePage();
    await expect(warmupScrollFeed(page, 'file:///etc/passwd', { dryRun: false })).rejects.toThrow(
      /valid URL|http\(s\) URL|facebook\.com URL/,
    );
    await expect(warmupScrollFeed(page, 'https://evil.com', { dryRun: false })).rejects.toThrow('facebook.com URL');
    expect(page.calls.goto).toHaveLength(0);
  });

  it('real run: scrolls more than once, NEVER calls page.click, terminates at clamped duration', async () => {
    const page = makeFakePage();
    const clock = makeClockSeam(1000); // each delay advances 1s

    const result = await warmupScrollFeed(page, URL_OK, {
      dryRun: false,
      durationSeconds: 5,        // → loop ~5 iterations with a 1s step
      delay: clock.delay,
      now: clock.now,
    });

    expect(result.dryRun).toBe(false);
    expect(page.calls.goto).toEqual([URL_OK]);
    expect(result.scrolls).toBeGreaterThan(1);
    expect(page.calls.evaluate.length).toBe(result.scrolls);
    expect(page.calls.click).toHaveLength(0); // scroll-only, never clicks
  });

  it('real run with userId + injected createOperation → Operation created (facebook_view_boost) and completed', async () => {
    const page = makeFakePage();
    const clock = makeClockSeam(1000);
    const opCalls = [];
    const updateCalls = [];
    const createOperation = async (args) => {
      opCalls.push(args);
      return { id: 'op-test-1' };
    };
    const updateOperation = async (id, data) => {
      updateCalls.push({ id, data });
    };

    const result = await warmupScrollFeed(page, URL_OK, {
      dryRun: false,
      durationSeconds: 3,
      userId: 'user-abc',
      delay: clock.delay,
      now: clock.now,
      createOperation,
      updateOperation,
    });

    // create seam invoked with scoped userId + PII-free args
    expect(opCalls).toHaveLength(1);
    expect(opCalls[0].userId).toBe('user-abc');
    expect(opCalls[0].targetUrl).toBe(URL_OK);
    expect(opCalls[0].durationSeconds).toBe(3);
    // completed update fired through the seam (fully DB-free)
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].id).toBe('op-test-1');
    expect(updateCalls[0].data.status).toBe('completed');
    expect(result.operationId).toBe('op-test-1');
  });

  it('real run without userId → no Operation, still scrolls', async () => {
    const page = makeFakePage();
    const clock = makeClockSeam(1000);
    let opCreated = false;

    const result = await warmupScrollFeed(page, URL_OK, {
      dryRun: false,
      durationSeconds: 3,
      delay: clock.delay,
      now: clock.now,
      createOperation: async () => { opCreated = true; return { id: 'x' }; },
    });

    expect(opCreated).toBe(false);
    expect(result.operationId).toBeNull();
    expect(result.scrolls).toBeGreaterThan(0);
  });

  it('dryRun:null stays in dry-run (strict gate)', async () => {
    const page = makeFakePage();
    const result = await warmupScrollFeed(page, URL_OK, { dryRun: null, durationSeconds: 30 });
    expect(result.dryRun).toBe(true);
    expect(page.calls.goto).toHaveLength(0);
  });

  it('busy-spin backstop: no-op delay with default (real) clock terminates at the iteration cap, not infinitely', async () => {
    // Misuse: caller overrides delay to a no-op but forgets to override `now`.
    // The real Date.now() barely advances per iteration, so the wall-clock loop would
    // busy-spin — the iteration backstop must bound it. maxScrolls = ceil(durationMs/800)+1.
    const page = makeFakePage();
    const result = await warmupScrollFeed(page, URL_OK, {
      dryRun: false,
      durationSeconds: 2, // durationMs 2000 → cap = ceil(2000/800)+1 = 4
      delay: async () => {}, // no-op: does NOT advance any clock
      // now intentionally NOT overridden → default Date.now()
    });
    expect(result.scrolls).toBeLessThanOrEqual(4);
    expect(page.calls.click).toHaveLength(0);
  });
});
