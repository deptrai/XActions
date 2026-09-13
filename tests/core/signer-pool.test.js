// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PreSignedTokenRing, SignerWorkerPagePool, PureCryptoSignerRegistry } from '../../src/core/signer-pool.js';
import { PlatformError } from '../../src/core/error-envelope.js';
import { PlaywrightAdapter } from '../../src/scrapers/adapters/playwright.js';

describe('Story 13.1 — Tiered Signer Architecture: PreSignedTokenRing (AC-1)', () => {
  it('[P0] should allocate tokens synchronously in O(1) round-robin order', () => {
    const ring = new PreSignedTokenRing({ capacity: 50 });
    ring.refill(['tok_1', 'tok_2', 'tok_3']);

    expect(ring.size).toBe(3);
    expect(ring.isEmpty).toBe(false);

    const start = performance.now();
    expect(ring.next()).toBe('tok_1');
    expect(ring.next()).toBe('tok_2');
    expect(ring.next()).toBe('tok_3');
    expect(ring.next()).toBe('tok_1'); // round-robin wrap
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10); // O(1) synchronous speed
  });

  it('[P1] should clamp refill tokens to capacity and reset index to 0', () => {
    const ring = new PreSignedTokenRing({ capacity: 3 });
    ring.refill(['t1', 't2', 't3', 't4', 't5']);

    expect(ring.size).toBe(3);
    expect(ring.capacity).toBe(3);
    expect(ring.next()).toBe('t1');
    expect(ring.next()).toBe('t2');

    // Refill resets index
    ring.refill(['new_1', 'new_2']);
    expect(ring.size).toBe(2);
    expect(ring.next()).toBe('new_1');
  });

  it('[P2] should handle empty ring gracefully', () => {
    const ring = new PreSignedTokenRing({ capacity: 10 });
    expect(ring.size).toBe(0);
    expect(ring.isEmpty).toBe(true);
    expect(ring.next()).toBeNull();
  });
});

describe('Story 13.1 — SignerWorkerPagePool (AC-2)', () => {
  let playwrightAvailable = false;
  let adapter;
  let browser;

  beforeAll(async () => {
    adapter = new PlaywrightAdapter();
    const dep = await adapter.checkDependencies();
    playwrightAvailable = dep.available;
    if (playwrightAvailable) {
      browser = await adapter.launch({ headless: true });
    }
  });

  afterAll(async () => {
    if (browser) {
      try {
        await adapter.closeBrowser(browser);
      } catch {}
    }
  });

  const createPool = (options = {}) =>
    new SignerWorkerPagePool({
      browser,
      adapter,
      minSize: 2,
      maxSize: 4,
      ...options,
    });

  it('[P0] should initialize minSize background pages in idle state', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser test');
      return;
    }

    const pool = createPool({ minSize: 2, maxSize: 4 });
    await pool.init();

    expect(pool.size).toBe(2);
    expect(pool.activeCount).toBe(2);

    await pool.close({ closeBrowser: false, timeoutMs: 500 });
  });

  it('[P0] should evaluate script on least-loaded worker page', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser test');
      return;
    }

    const pool = createPool({ minSize: 1, maxSize: 2, defaultTimeoutMs: 3000 });
    await pool.init();

    try {
      const result = await pool.evaluate(() => 'sig_123', ['arg1']);
      expect(result).toBe('sig_123');
      expect(pool.size).toBeGreaterThanOrEqual(1);
    } finally {
      await pool.close({ closeBrowser: false, timeoutMs: 500 });
    }
  });

  it('[P1] should handle evaluation timeout and retry on a healthy page', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser test');
      return;
    }

    const pool = createPool({
      minSize: 1,
      maxSize: 2,
      defaultTimeoutMs: 5000,
    });
    await pool.init();

    try {
      // First call hangs; timeout should trigger and the circuit breaker can retry/spawn.
      const timeoutPromise = pool.evaluate(() => new Promise(() => {}), [], { timeoutMs: 50 });
      await expect(timeoutPromise).rejects.toThrow(PlatformError);
    } finally {
      await pool.close({ closeBrowser: false, timeoutMs: 500 });
    }
  });

  it('[P1] should throw PlatformError XACT_5000 when all pages are dead and maxSize exceeded', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser test');
      return;
    }

    const pool = createPool({
      minSize: 1,
      maxSize: 1,
      defaultTimeoutMs: 500,
    });
    await pool.init();

    try {
      await expect(
        pool.evaluate(() => {
          throw new Error('Crash');
        }),
      ).rejects.toThrow(PlatformError);
    } finally {
      await pool.close({ closeBrowser: false, timeoutMs: 500 });
    }
  });

  it('[P1] should handle burst concurrent evaluate requests without exceeding maxSize', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser test');
      return;
    }

    const pool = createPool({
      minSize: 2,
      maxSize: 4,
      defaultTimeoutMs: 10000,
    });
    await pool.init();

    try {
      const results = await Promise.all([
        pool.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100, 1)), [], { timeoutMs: 5000 }),
        pool.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100, 2)), [], { timeoutMs: 5000 }),
        pool.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100, 3)), [], { timeoutMs: 5000 }),
        pool.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100, 4)), [], { timeoutMs: 5000 }),
      ]);

      expect(results).toEqual([1, 2, 3, 4]);
      expect(pool.size).toBeLessThanOrEqual(4);
    } finally {
      await pool.close({ closeBrowser: false, timeoutMs: 500 });
    }
  });

  it('[P2] should close all worker pages and browser on close()', async () => {
    if (!playwrightAvailable) {
      console.warn('⚠️ Playwright not available; skipping real browser test');
      return;
    }

    // Launch a dedicated browser so we can assert it is closed afterwards.
    const localBrowser = await adapter.launch({ headless: true });
    const pool = new SignerWorkerPagePool({
      browser: localBrowser,
      adapter,
      minSize: 1,
      maxSize: 2,
    });
    await pool.init();

    await pool.close({ timeoutMs: 500 });

    expect(localBrowser._native.isConnected()).toBe(false);
  });
});


describe('Story 13.1.2 — PureCryptoSignerRegistry (Tier 0)', () => {
  it('[P0] should register, get, has, list, and report size', () => {
    const reg = new PureCryptoSignerRegistry();
    const fn = () => ({ headers: { 'x-a': 'b' } });

    expect(reg.size).toBe(0);
    reg.register('x-request-fingerprint', fn);
    expect(reg.size).toBe(1);
    expect(reg.has('x-request-fingerprint')).toBe(true);
    expect(reg.get('x-request-fingerprint')).toBe(fn);
    expect(reg.list()).toEqual(['x-request-fingerprint']);
  });

  it('[P1] should return null for unregistered algorithm and support unregister', () => {
    const reg = new PureCryptoSignerRegistry();
    expect(reg.get('nope')).toBeNull();
    expect(reg.has('nope')).toBe(false);

    reg.register('a', () => null);
    expect(reg.unregister('a')).toBe(true);
    expect(reg.unregister('a')).toBe(false);
    expect(reg.size).toBe(0);
  });

  it('[P1] should reject a non-function signer and an empty algorithm name', () => {
    const reg = new PureCryptoSignerRegistry();
    expect(() => reg.register('', () => {})).toThrow();
    expect(() => reg.register('x', 'not-a-fn')).toThrow();
  });

  it('[P0] should execute a registered pure signer synchronously under 0.1ms', () => {
    const reg = new PureCryptoSignerRegistry();
    reg.register('x-request-fingerprint', (p) => ({ headers: { 'x-request-fingerprint': `fp_${p.method}` } }));
    const fn = reg.get('x-request-fingerprint');

    const start = performance.now();
    for (let i = 0; i < 1000; i++) fn({ method: 'GET', url: 'http://x.com/x' });
    const perCall = (performance.now() - start) / 1000;

    expect(perCall).toBeLessThan(0.1);
  });
});
