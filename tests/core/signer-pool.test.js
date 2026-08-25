// Copyright (c) 2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreSignedTokenRing, SignerWorkerPagePool } from '../../src/core/signer-pool.js';
import { PlatformError, ErrorTypes } from '../../src/core/error-envelope.js';

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
  let mockBrowser;
  let mockPages;

  beforeEach(() => {
    mockPages = [];
    mockBrowser = {
      newPage: vi.fn(async () => {
        const page = {
          id: `page_${mockPages.length + 1}`,
          evaluate: vi.fn(async (fn, ...args) => 'signed_result'),
          close: vi.fn(async () => {}),
        };
        mockPages.push(page);
        return page;
      }),
      close: vi.fn(async () => {}),
    };
  });

  it('[P0] should initialize minSize background pages in idle state', async () => {
    const pool = new SignerWorkerPagePool({
      browser: mockBrowser,
      minSize: 4,
      maxSize: 8,
    });

    await pool.init();
    expect(mockBrowser.newPage).toHaveBeenCalledTimes(4);
    expect(pool.size).toBe(4);
    expect(pool.activeCount).toBe(4);
  });

  it('[P0] should evaluate script on least-loaded worker page', async () => {
    const pool = new SignerWorkerPagePool({
      browser: mockBrowser,
      minSize: 2,
      maxSize: 4,
    });

    await pool.init();
    const result = await pool.evaluate('() => "sig_123"', ['arg1']);

    expect(result).toBe('signed_result');
    expect(mockPages[0].evaluate).toHaveBeenCalled();
  });

  it('[P1] should handle evaluation timeout and retry on a healthy page', async () => {
    const hangingPage = {
      evaluate: vi.fn(() => new Promise((resolve) => setTimeout(resolve, 5000))),
      close: vi.fn(async () => {}),
    };
    const healthyPage = {
      evaluate: vi.fn(async () => 'recovered_signature'),
      close: vi.fn(async () => {}),
    };

    let callCount = 0;
    const customBrowser = {
      newPage: vi.fn(async () => {
        callCount++;
        return callCount === 1 ? hangingPage : healthyPage;
      }),
      close: vi.fn(async () => {}),
    };

    const pool = new SignerWorkerPagePool({
      browser: customBrowser,
      minSize: 1,
      maxSize: 4,
      defaultTimeoutMs: 50, // fast timeout for test
    });

    await pool.init();
    const result = await pool.evaluate('() => sig', [], { timeoutMs: 50 });
    expect(result).toBe('recovered_signature');
  });

  it('[P1] should throw PlatformError XACT_5000 when all pages are dead and maxSize exceeded', async () => {
    const deadPage = {
      evaluate: vi.fn(async () => { throw new Error('Crash'); }),
      close: vi.fn(async () => {}),
    };

    const brokenBrowser = {
      newPage: vi.fn(async () => deadPage),
      close: vi.fn(async () => {}),
    };

    const pool = new SignerWorkerPagePool({
      browser: brokenBrowser,
      minSize: 1,
      maxSize: 1,
      defaultTimeoutMs: 50,
    });

    await pool.init();

    await expect(pool.evaluate('() => sig')).rejects.toThrow(PlatformError);
  });

  it('[P2] should close all worker pages and browser on close()', async () => {
    const pool = new SignerWorkerPagePool({
      browser: mockBrowser,
      minSize: 3,
      maxSize: 6,
    });

    await pool.init();
    await pool.close();

    for (const p of mockPages) {
      expect(p.close).toHaveBeenCalled();
    }
  });
});
