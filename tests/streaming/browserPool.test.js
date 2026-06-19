// by nichxbt
import { describe, it, expect } from 'vitest';
import { getPoolStatus, releaseBrowser } from '../../src/streaming/browserPool.js';

/**
 * Pure-logic tests for browserPool.js
 *
 * acquireBrowser / acquirePage / closeAll all require a live Puppeteer
 * process — untestable without a real browser binary.
 *
 * We test the two pure / stateless-read exported functions:
 *   1. getPoolStatus  — reads the in-memory pool array, no side effects
 *   2. releaseBrowser — decrements page count, injectable via the real pool
 *
 * The pool starts empty in a fresh test process, so getPoolStatus gives us
 * a deterministic baseline. releaseBrowser is tested by verifying it is
 * a no-op when called with an unknown browser reference (safe guard).
 */

// ---------------------------------------------------------------------------
// getPoolStatus — empty pool baseline
// ---------------------------------------------------------------------------
describe('getPoolStatus (empty pool)', () => {
  it('returns an object with the expected shape', () => {
    const status = getPoolStatus();
    expect(status).toHaveProperty('browsers');
    expect(status).toHaveProperty('maxBrowsers');
    expect(status).toHaveProperty('maxPagesPerBrowser');
    expect(status).toHaveProperty('totalActivePages');
    expect(status).toHaveProperty('details');
  });

  it('reports zero browsers in a fresh process', () => {
    const status = getPoolStatus();
    expect(status.browsers).toBe(0);
  });

  it('reports zero active pages when pool is empty', () => {
    const status = getPoolStatus();
    expect(status.totalActivePages).toBe(0);
  });

  it('details is an empty array when pool is empty', () => {
    const status = getPoolStatus();
    expect(Array.isArray(status.details)).toBe(true);
    expect(status.details).toHaveLength(0);
  });

  it('maxBrowsers is a positive integer', () => {
    const status = getPoolStatus();
    expect(typeof status.maxBrowsers).toBe('number');
    expect(status.maxBrowsers).toBeGreaterThan(0);
  });

  it('maxPagesPerBrowser is a positive integer', () => {
    const status = getPoolStatus();
    expect(typeof status.maxPagesPerBrowser).toBe('number');
    expect(status.maxPagesPerBrowser).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// releaseBrowser — no-op safety for unknown browser reference
// ---------------------------------------------------------------------------
describe('releaseBrowser', () => {
  it('does not throw when called with an unknown browser reference', () => {
    // Pool is empty — passing any object should be a silent no-op
    expect(() => releaseBrowser({})).not.toThrow();
  });

  it('does not throw when called with null', () => {
    expect(() => releaseBrowser(null)).not.toThrow();
  });

  it('does not throw when called with undefined', () => {
    expect(() => releaseBrowser(undefined)).not.toThrow();
  });

  it('does not alter pool size when browser is not found', () => {
    const before = getPoolStatus().browsers;
    releaseBrowser({ id: 'phantom' });
    const after = getPoolStatus().browsers;
    expect(after).toBe(before);
  });
});
