// tests/scrapers/facebook-fingerprint.test.js
// Story 6.2 + 6.3 + 6.4 — Consistent Session Fingerprint (ADR-013)
// Pure-module tests for src/scrapers/facebook/fingerprint.js
// No Puppeteer required — fingerprint.js is a pure module.
import { describe, it, expect } from 'vitest';
import {
  UA_POOL,
  VIEWPORT_LIST,
  generateFingerprint,
  applyFingerprint,
  applyNavigatorOverrides,
} from '../../src/scrapers/facebook/fingerprint.js';
import { makeFakePage } from '../helpers/fake-page.js';

// ============================================================================
// UA_POOL (AC1, AC8 — Story 6.3)
// ============================================================================

describe('UA_POOL (AC1, AC8 — Story 6.3)', () => {
  it('is a non-empty array with 20+ entries', () => {
    expect(Array.isArray(UA_POOL)).toBe(true);
    expect(UA_POOL.length).toBeGreaterThanOrEqual(20);
  });

  it('contains only Chrome UAs with Mozilla/5.0 prefix', () => {
    for (const ua of UA_POOL) {
      expect(ua).toMatch(/^Mozilla\/5\.0 /);
      expect(ua).toContain('Chrome/');
      expect(ua).toContain('Safari/537.36');
    }
  });

  it('covers all 3 desktop platforms: Windows ≥7, macOS ≥7, Linux ≥7', () => {
    const windows = UA_POOL.filter(ua => ua.includes('Windows'));
    const mac = UA_POOL.filter(ua => ua.includes('Macintosh') || ua.includes('Mac OS X'));
    const linux = UA_POOL.filter(ua => ua.includes('Linux'));
    expect(windows.length).toBeGreaterThanOrEqual(7);
    expect(mac.length).toBeGreaterThanOrEqual(7);
    expect(linux.length).toBeGreaterThanOrEqual(7);
  });

  it('has no duplicate UAs', () => {
    const set = new Set(UA_POOL);
    expect(set.size).toBe(UA_POOL.length);
  });

  it('all Chrome versions are in range [146, 152]', () => {
    for (const ua of UA_POOL) {
      const match = ua.match(/Chrome\/(\d+)\./);
      expect(match).not.toBeNull();
      const ver = parseInt(match[1], 10);
      expect(ver).toBeGreaterThanOrEqual(146);
      expect(ver).toBeLessThanOrEqual(152);
    }
  });

  it('does NOT contain Chrome/120 or any version below 146', () => {
    for (const ua of UA_POOL) {
      expect(ua).not.toContain('Chrome/120');
      const match = ua.match(/Chrome\/(\d+)\./);
      if (match) {
        expect(parseInt(match[1], 10)).toBeGreaterThanOrEqual(146);
      }
    }
  });
});

// ============================================================================
// VIEWPORT_LIST (AC2 — Story 6.3)
// ============================================================================

describe('VIEWPORT_LIST (AC2 — Story 6.3)', () => {
  it('is a non-empty array with 6+ entries', () => {
    expect(Array.isArray(VIEWPORT_LIST)).toBe(true);
    expect(VIEWPORT_LIST.length).toBeGreaterThanOrEqual(6);
  });

  it('contains { width, height } with positive integers', () => {
    for (const vp of VIEWPORT_LIST) {
      expect(typeof vp.width).toBe('number');
      expect(typeof vp.height).toBe('number');
      expect(Number.isInteger(vp.width)).toBe(true);
      expect(Number.isInteger(vp.height)).toBe(true);
      expect(vp.width).toBeGreaterThan(0);
      expect(vp.height).toBeGreaterThan(0);
    }
  });

  it('includes the new 2560x1440 viewport', () => {
    expect(VIEWPORT_LIST).toContainEqual({ width: 2560, height: 1440 });
  });

  it('preserves the 5 existing viewports from Story 6.2 (no regression)', () => {
    expect(VIEWPORT_LIST).toContainEqual({ width: 1920, height: 1080 });
    expect(VIEWPORT_LIST).toContainEqual({ width: 1536, height: 864 });
    expect(VIEWPORT_LIST).toContainEqual({ width: 1440, height: 900 });
    expect(VIEWPORT_LIST).toContainEqual({ width: 1366, height: 768 });
    expect(VIEWPORT_LIST).toContainEqual({ width: 1280, height: 800 });
  });

  it('all viewports are desktop-class (width ≥ 1024, height ≥ 768)', () => {
    for (const vp of VIEWPORT_LIST) {
      expect(vp.width).toBeGreaterThanOrEqual(1024);
      expect(vp.height).toBeGreaterThanOrEqual(768);
    }
  });
});

// ============================================================================
// generateFingerprint (AC2, AC3, AC4, AC6 — Story 6.2 + 6.3)
// ============================================================================

describe('generateFingerprint (AC2, AC4 — Story 6.2 + 6.3)', () => {
  it('returns the exact shape { ua, viewport, deviceScaleFactor, hardwareConcurrency, deviceMemory, platform }', () => {
    const fp = generateFingerprint();
    expect(fp).toEqual(
      expect.objectContaining({
        ua: expect.any(String),
        viewport: expect.objectContaining({
          width: expect.any(Number),
          height: expect.any(Number),
        }),
        deviceScaleFactor: expect.any(Number),
        hardwareConcurrency: expect.any(Number),
        deviceMemory: expect.any(Number),
        platform: expect.any(String),
      })
    );
    // No extra fields
    expect(Object.keys(fp).sort()).toEqual(
      ['ua', 'viewport', 'deviceScaleFactor', 'hardwareConcurrency', 'deviceMemory', 'platform'].sort()
    );
  });

  it('returns ua from UA_POOL', () => {
    for (let i = 0; i < 20; i++) {
      const fp = generateFingerprint();
      expect(UA_POOL).toContain(fp.ua);
    }
  });

  it('returns viewport from VIEWPORT_LIST', () => {
    for (let i = 0; i < 20; i++) {
      const fp = generateFingerprint();
      expect(VIEWPORT_LIST).toContain(fp.viewport);
    }
  });

  it('returns deviceScaleFactor ∈ [1, 2]', () => {
    for (let i = 0; i < 20; i++) {
      const fp = generateFingerprint();
      expect([1, 2]).toContain(fp.deviceScaleFactor);
    }
  });

  it('returns hardwareConcurrency ∈ [4, 6, 8]', () => {
    for (let i = 0; i < 20; i++) {
      const fp = generateFingerprint();
      expect([4, 6, 8]).toContain(fp.hardwareConcurrency);
    }
  });

  it('returns deviceMemory ∈ [2, 4, 8]', () => {
    for (let i = 0; i < 20; i++) {
      const fp = generateFingerprint();
      expect([2, 4, 8]).toContain(fp.deviceMemory);
    }
  });

  it('derives platform correctly: Windows UA → Win32', () => {
    for (let i = 0; i < 50; i++) {
      const fp = generateFingerprint();
      if (fp.ua.includes('Windows')) {
        expect(fp.platform).toBe('Win32');
      }
    }
  });

  it('derives platform correctly: Mac UA → MacIntel', () => {
    for (let i = 0; i < 50; i++) {
      const fp = generateFingerprint();
      if (fp.ua.includes('Mac')) {
        expect(fp.platform).toBe('MacIntel');
      }
    }
  });

  it('derives platform correctly: Linux UA → Linux x86_64', () => {
    for (let i = 0; i < 50; i++) {
      const fp = generateFingerprint();
      if (fp.ua.includes('Linux')) {
        expect(fp.platform).toBe('Linux x86_64');
      }
    }
  });

  it('platform always matches UA platform (invariant)', () => {
    for (let i = 0; i < 100; i++) {
      const fp = generateFingerprint();
      if (fp.ua.includes('Windows')) expect(fp.platform).toBe('Win32');
      else if (fp.ua.includes('Mac')) expect(fp.platform).toBe('MacIntel');
      else if (fp.ua.includes('Linux')) expect(fp.platform).toBe('Linux x86_64');
    }
  });

  it('two consecutive calls differ in at least one field across 20 iterations', () => {
    const uas = new Set();
    for (let i = 0; i < 20; i++) {
      uas.add(generateFingerprint().ua);
    }
    // With 22 UAs and 20 draws, probability of only 1 distinct UA is (1/22)^19 ≈ 0 — assert ≥2
    expect(uas.size).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// deviceScaleFactor platform-aware (AC3 — Story 6.3)
// ============================================================================

describe('deviceScaleFactor platform-aware (AC3 — Story 6.3)', () => {
  it('macOS UA → deviceScaleFactor === 2 (Retina default)', () => {
    for (let i = 0; i < 100; i++) {
      const fp = generateFingerprint();
      if (fp.platform === 'MacIntel') {
        expect(fp.deviceScaleFactor).toBe(2);
      }
    }
  });

  it('Windows UA → deviceScaleFactor === 1 (standard DPI)', () => {
    for (let i = 0; i < 100; i++) {
      const fp = generateFingerprint();
      if (fp.platform === 'Win32') {
        expect(fp.deviceScaleFactor).toBe(1);
      }
    }
  });

  it('Linux UA → deviceScaleFactor === 1 (standard DPI)', () => {
    for (let i = 0; i < 100; i++) {
      const fp = generateFingerprint();
      if (fp.platform === 'Linux x86_64') {
        expect(fp.deviceScaleFactor).toBe(1);
      }
    }
  });

  it('deviceScaleFactor is always consistent with platform (invariant)', () => {
    for (let i = 0; i < 200; i++) {
      const fp = generateFingerprint();
      if (fp.platform === 'MacIntel') {
        expect(fp.deviceScaleFactor).toBe(2);
      } else {
        expect(fp.deviceScaleFactor).toBe(1);
      }
    }
  });
});

// ============================================================================
// UA pool diversity (AC6 — Story 6.3)
// ============================================================================

describe('UA pool diversity (AC6 — Story 6.3)', () => {
  it('100 calls produce ≥10 distinct UAs', () => {
    const uas = new Set();
    for (let i = 0; i < 100; i++) {
      uas.add(generateFingerprint().ua);
    }
    expect(uas.size).toBeGreaterThanOrEqual(10);
  });

  it('100 calls produce ≥2 distinct Chrome versions', () => {
    const versions = new Set();
    for (let i = 0; i < 100; i++) {
      const fp = generateFingerprint();
      const match = fp.ua.match(/Chrome\/(\d+)\./);
      if (match) versions.add(match[1]);
    }
    expect(versions.size).toBeGreaterThanOrEqual(2);
  });

  it('100 calls produce ≥2 distinct platforms', () => {
    const platforms = new Set();
    for (let i = 0; i < 100; i++) {
      platforms.add(generateFingerprint().platform);
    }
    expect(platforms.size).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// applyFingerprint (AC3, AC7 — Story 6.2, unchanged in 6.3)
// ============================================================================

describe('applyFingerprint (AC3, AC7)', () => {
  it('calls page.setUserAgent once with fp.ua', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyFingerprint(page, fp);
    expect(page.calls.setUserAgent).toHaveLength(1);
    expect(page.calls.setUserAgent[0]).toBe(fp.ua);
  });

  it('calls page.setViewport once with { width, height, deviceScaleFactor }', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyFingerprint(page, fp);
    expect(page.calls.setViewport).toHaveLength(1);
    expect(page.calls.setViewport[0]).toEqual({
      width: fp.viewport.width,
      height: fp.viewport.height,
      deviceScaleFactor: fp.deviceScaleFactor,
    });
  });

  it('does NOT call page.evaluateOnNewDocument', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyFingerprint(page, fp);
    expect(page.calls.evaluateOnNewDocument).toHaveLength(0);
  });

  it('does NOT call page.emulateTimezone or page.setGeolocation', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyFingerprint(page, fp);
    expect(page.calls.emulateTimezone).toHaveLength(0);
    expect(page.calls.setGeolocation).toHaveLength(0);
  });

  it('throws generic error (no fingerprint fields leaked) when setUserAgent fails (NFR4)', async () => {
    const page = makeFakePage();
    page.setUserAgent = async () => { throw new Error('boom'); };
    const fp = generateFingerprint();
    await expect(applyFingerprint(page, fp)).rejects.toThrow(/Failed to apply fingerprint/);
    // Ensure the error message does NOT contain the UA or viewport
    try {
      await applyFingerprint(page, fp);
    } catch (err) {
      expect(err.message).not.toContain(fp.ua);
      expect(err.message).not.toContain(String(fp.viewport.width));
    }
  });

  it('preserves original error via cause for debugging (NFR4 + review patch)', async () => {
    const page = makeFakePage();
    const originalErr = new Error('setUserAgent failed');
    page.setUserAgent = async () => { throw originalErr; };
    const fp = generateFingerprint();
    try {
      await applyFingerprint(page, fp);
    } catch (err) {
      expect(err.message).toBe('❌ Failed to apply fingerprint');
      expect(err.cause).toBe(originalErr);
    }
  });
});

// ============================================================================
// applyNavigatorOverrides (AC1-AC5, AC10 — Story 6.4)
// ============================================================================

describe('applyNavigatorOverrides (AC1-AC5, AC10 — Story 6.4)', () => {
  it('is an async function (AC1)', () => {
    expect(typeof applyNavigatorOverrides).toBe('function');
    // Must return a Promise
    const page = makeFakePage();
    const fp = generateFingerprint();
    expect(applyNavigatorOverrides(page, fp)).toBeInstanceOf(Promise);
  });

  it('calls page.evaluateOnNewDocument exactly once (AC1)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    expect(page.calls.evaluateOnNewDocument).toHaveLength(1);
  });

  it('injected script sets navigator.webdriver = undefined (AC2)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    const { fn } = page.calls.evaluateOnNewDocument[0];
    expect(fn).toContain('webdriver');
    expect(fn).toContain('undefined');
    expect(fn).toContain('Object.defineProperty');
  });

  it('injected script sets navigator.hardwareConcurrency to fp.hardwareConcurrency (AC3)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    const { fn, args } = page.calls.evaluateOnNewDocument[0];
    expect(fn).toContain('hardwareConcurrency');
    expect(fn).toContain('fp.hardwareConcurrency');
    // Fingerprint is passed as argument
    expect(args).toHaveLength(1);
    expect(args[0].hardwareConcurrency).toBe(fp.hardwareConcurrency);
    expect([4, 6, 8]).toContain(fp.hardwareConcurrency);
  });

  it('injected script sets navigator.deviceMemory to fp.deviceMemory (AC4)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    const { fn, args } = page.calls.evaluateOnNewDocument[0];
    expect(fn).toContain('deviceMemory');
    expect(fn).toContain('fp.deviceMemory');
    expect(args[0].deviceMemory).toBe(fp.deviceMemory);
    expect([2, 4, 8]).toContain(fp.deviceMemory);
  });

  it('injected script sets navigator.platform to fp.platform (AC5)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    const { fn, args } = page.calls.evaluateOnNewDocument[0];
    expect(fn).toContain('platform');
    expect(fn).toContain('fp.platform');
    expect(args[0].platform).toBe(fp.platform);
    expect(['Win32', 'MacIntel', 'Linux x86_64']).toContain(fp.platform);
  });

  it('uses Object.defineProperty for all 4 navigator properties (not direct assignment)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    const { fn } = page.calls.evaluateOnNewDocument[0];
    // Must use Object.defineProperty 4 times (webdriver, hardwareConcurrency, deviceMemory, platform)
    const definePropertyCount = (fn.match(/Object\.defineProperty/g) || []).length;
    expect(definePropertyCount).toBe(4);
    // Must use get accessor (not direct assignment)
    expect(fn).toContain('get:');
  });

  it('passes fingerprint as argument to evaluateOnNewDocument (not string interpolation)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    const { fn, args } = page.calls.evaluateOnNewDocument[0];
    // The function signature should accept fp as parameter
    expect(fn).toMatch(/\(fp\)/);
    // The fingerprint object should be passed as argument
    expect(args).toHaveLength(1);
    expect(args[0]).toEqual(fp);
  });

  it('does NOT call page.setUserAgent or page.setViewport (not its scope)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    expect(page.calls.setUserAgent).toHaveLength(0);
    expect(page.calls.setViewport).toHaveLength(0);
  });

  it('does NOT call page.emulateTimezone or page.setGeolocation (out of scope)', async () => {
    const page = makeFakePage();
    const fp = generateFingerprint();
    await applyNavigatorOverrides(page, fp);
    expect(page.calls.emulateTimezone).toHaveLength(0);
    expect(page.calls.setGeolocation).toHaveLength(0);
  });

  it('throws generic error when evaluateOnNewDocument fails (AC10)', async () => {
    const page = makeFakePage();
    page.evaluateOnNewDocument = async () => { throw new Error('boom'); };
    const fp = generateFingerprint();
    await expect(applyNavigatorOverrides(page, fp)).rejects.toThrow(/Failed to apply navigator overrides/);
  });

  it('error message does NOT contain fingerprint fields (NFR4)', async () => {
    const page = makeFakePage();
    page.evaluateOnNewDocument = async () => { throw new Error('boom'); };
    const fp = generateFingerprint();
    try {
      await applyNavigatorOverrides(page, fp);
    } catch (err) {
      expect(err.message).not.toContain(fp.ua);
      expect(err.message).not.toContain(fp.platform);
      expect(err.message).not.toContain(String(fp.hardwareConcurrency));
      expect(err.message).not.toContain(String(fp.deviceMemory));
    }
  });

  it('preserves original error via cause for debugging (NFR4)', async () => {
    const page = makeFakePage();
    const originalErr = new Error('evaluateOnNewDocument failed');
    page.evaluateOnNewDocument = async () => { throw originalErr; };
    const fp = generateFingerprint();
    try {
      await applyNavigatorOverrides(page, fp);
    } catch (err) {
      expect(err.message).toBe('❌ Failed to apply navigator overrides');
      expect(err.cause).toBe(originalErr);
    }
  });
});

