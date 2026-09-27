// by nichxbt — Story 27.5: Canvas / WebGL / Audio Fingerprint Spoofing (FR-113)
import { describe, it, expect } from 'vitest';
import { FingerprintManager, hashSeed } from '../../src/core/fingerprint-manager.js';

describe('Story 27.5 — Advanced Fingerprint Spoofing (Canvas/WebGL/Audio)', () => {
  it('hashSeed produces deterministic 32-bit unsigned integer', () => {
    const s1 = hashSeed('twitter:acct1');
    const s2 = hashSeed('twitter:acct1');
    const s3 = hashSeed('twitter:acct2');

    expect(typeof s1).toBe('number');
    expect(s1).toBeGreaterThanOrEqual(0);
    expect(s1).toBeLessThanOrEqual(0xFFFFFFFF);
    expect(s1).toBe(s2); // deterministic
    expect(s1).not.toBe(s3); // distinct accounts get distinct seeds
  });

  it('FingerprintManager attaches noiseSeed to generated fingerprints', async () => {
    const fpm = new FingerprintManager();
    const fp1 = await fpm.getForAccount('twitter', 'alice');
    const fp2 = await fpm.getForAccount('twitter', 'alice');
    const fp3 = await fpm.getForAccount('twitter', 'bob');

    expect(fp1.noiseSeed).toBeDefined();
    expect(typeof fp1.noiseSeed).toBe('number');
    // Same account gets same seed (stable across calls)
    expect(fp1.noiseSeed).toBe(fp2.noiseSeed);
    // Different accounts get different seeds
    expect(fp1.noiseSeed).not.toBe(fp3.noiseSeed);
  });

  it('noiseSeed is preserved when loading persisted fingerprints', async () => {
    const mockStore = {
      async get(key) {
        return {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
          webgl: { vendor: 'Google Inc.', renderer: 'ANGLE' },
          fonts: ['Arial'],
        };
      },
      async set() {},
    };

    const fpm = new FingerprintManager({ store: mockStore });
    const fp = await fpm.getForAccount('instagram', 'persisted_user');

    expect(fp.noiseSeed).toBeDefined();
    expect(typeof fp.noiseSeed).toBe('number');
    expect(fp.noiseSeed).toBe(hashSeed('instagram:persisted_user'));
  });

  it('mulberry32 PRNG produces stable sequence from same seed', () => {
    function mulberry32(a) {
      return function() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    const seed = hashSeed('test:account');
    const rng1 = mulberry32(seed);
    const rng2 = mulberry32(seed);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).toEqual(seq2);
    // All numbers in [0, 1)
    for (const n of seq1) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('evaluates noise injection in a simulated DOM environment', () => {
    // Simulate what happens inside page.evaluateOnNewDocument
    const fp = {
      noiseSeed: hashSeed('twitter:carol'),
    };

    function mulberry32(a) {
      return function() {
        let t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    // Mock CanvasRenderingContext2D
    const dummyData = new Uint8ClampedArray(256);
    for (let i = 0; i < dummyData.length; i++) dummyData[i] = 128; // mid-gray

    const mockCtx = {
      getImageData: (sx, sy, sw, sh) => ({ data: new Uint8ClampedArray(dummyData) }),
    };

    // Apply the patch logic
    const origGetImageData = mockCtx.getImageData;
    mockCtx.getImageData = function(sx, sy, sw, sh) {
      const imgData = origGetImageData.call(this, sx, sy, sw, sh);
      const d = imgData.data;
      const localRng = mulberry32(fp.noiseSeed ^ (sw * 31 + sh));
      for (let i = 0; i < d.length; i += 64) {
        const shift = localRng() > 0.5 ? 1 : -1;
        d[i] = Math.max(0, Math.min(255, d[i] + shift));
      }
      return imgData;
    };

    const res1 = mockCtx.getImageData(0, 0, 16, 16);
    const res2 = mockCtx.getImageData(0, 0, 16, 16);

    // Deterministic: multiple reads yield exact same perturbed data
    expect(Array.from(res1.data)).toEqual(Array.from(res2.data));
    // Perturbed: at least some values differ from original 128
    const modified = Array.from(res1.data).filter(v => v !== 128);
    expect(modified.length).toBeGreaterThan(0);
    // Noise is bounded: ±1 LSB
    for (const val of modified) {
      expect(Math.abs(val - 128)).toBe(1);
    }
  });
});
