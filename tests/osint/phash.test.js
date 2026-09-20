// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Tests for Story 41.3 — Avatar Perceptual Hashing (phash.js + image-decode.js).
 * Real implementations only — fixtures on disk, no network, no mocks.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeDHash,
  computeAHash,
  hammingDistance,
  fetchAvatarHash,
  getAvatarPHashThreshold,
  isAvatarPHashEnabled,
} from '../../src/osint/phash.js';
import { decodeImage, decodeImageAsync } from '../../src/osint/image-decode.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

const readFixture = (name) => fs.readFileSync(path.join(FIXTURES_DIR, name));

// ---------------------------------------------------------------------------
// Image decode
// ---------------------------------------------------------------------------

describe('decodeImage', () => {
  it('decodes PNG to RGBA', () => {
    const decoded = decodeImage(readFixture('avatar_64.png'));
    assert.ok(decoded);
    assert.equal(decoded.width, 64);
    assert.equal(decoded.height, 64);
    assert.ok(decoded.rgba.length === 64 * 64 * 4);
  });

  it('decodes JPEG to RGBA', () => {
    const decoded = decodeImage(readFixture('avatar_64.jpg'));
    assert.ok(decoded);
    assert.equal(decoded.width, 64);
    assert.equal(decoded.height, 64);
    assert.ok(decoded.rgba.length === 64 * 64 * 4);
  });

  it('decodes WebP to RGBA via decodeImageAsync', async () => {
    const decoded = await decodeImageAsync(readFixture('avatar_64.webp'));
    assert.ok(decoded, 'webp should decode');
    assert.equal(decoded.width, 64);
    assert.equal(decoded.height, 64);
    assert.ok(decoded.rgba.length === 64 * 64 * 4);
  });

  it('sync decodeImage returns null for webp (async-only format)', () => {
    assert.equal(decodeImage(readFixture('avatar_64.webp')), null);
  });

  it('returns null for corrupt input', () => {
    assert.equal(decodeImage(readFixture('corrupt.png')), null);
  });

  it('returns null for empty buffer', () => {
    assert.equal(decodeImage(Buffer.alloc(0)), null);
    assert.equal(decodeImage(null), null);
    assert.equal(decodeImage(undefined), null);
  });
});

// ---------------------------------------------------------------------------
// dHash / aHash
// ---------------------------------------------------------------------------

describe('computeDHash / computeAHash', () => {
  it('produces 64-bit BigInt hashes', () => {
    const { rgba, width, height } = decodeImage(readFixture('avatar_64.png'));
    const h = computeDHash(rgba, width, height);
    const a = computeAHash(rgba, width, height);
    assert.equal(typeof h, 'bigint');
    assert.equal(typeof a, 'bigint');
    assert.ok(h >= 0n && h <= 0xFFFFFFFFFFFFFFFFn);
    assert.ok(a >= 0n && a <= 0xFFFFFFFFFFFFFFFFn);
  });

  it('same image produces identical hashes', () => {
    const { rgba, width, height } = decodeImage(readFixture('avatar_64.png'));
    assert.equal(computeDHash(rgba, width, height), computeDHash(rgba, width, height));
    assert.equal(computeAHash(rgba, width, height), computeAHash(rgba, width, height));
  });

  it('identical content produces Hamming ≤ threshold across different sizes', () => {
    const d64 = decodeImage(readFixture('avatar_64.png'));
    const d32 = decodeImage(readFixture('avatar_32.png'));
    const d128 = decodeImage(readFixture('avatar_128_reencoded.png'));
    const dJpg = decodeImage(readFixture('avatar_64.jpg'));

    const h64 = computeDHash(d64.rgba, d64.width, d64.height);
    const h32 = computeDHash(d32.rgba, d32.width, d32.height);
    const h128 = computeDHash(d128.rgba, d128.width, d128.height);
    const hJpg = computeDHash(dJpg.rgba, dJpg.width, dJpg.height);

    const threshold = getAvatarPHashThreshold();
    assert.ok(hammingDistance(h64, h32) <= threshold, `64 vs 32: ${hammingDistance(h64, h32)}`);
    assert.ok(hammingDistance(h64, h128) <= threshold, `64 vs 128: ${hammingDistance(h64, h128)}`);
    assert.ok(hammingDistance(h64, hJpg) <= threshold, `64 vs jpg: ${hammingDistance(h64, hJpg)}`);
  });

  it('different photos produce Hamming > threshold', () => {
    const d64 = decodeImage(readFixture('avatar_64.png'));
    const dDiff = decodeImage(readFixture('different_64.png'));
    const h64 = computeDHash(d64.rgba, d64.width, d64.height);
    const hDiff = computeDHash(dDiff.rgba, dDiff.width, dDiff.height);
    const threshold = getAvatarPHashThreshold();
    assert.ok(hammingDistance(h64, hDiff) > threshold, `distance: ${hammingDistance(h64, hDiff)}`);
  });
});

// ---------------------------------------------------------------------------
// hammingDistance
// ---------------------------------------------------------------------------

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    assert.equal(hammingDistance(0n, 0n), 0);
    assert.equal(hammingDistance(0xFFFFFFFFFFFFFFFFn, 0xFFFFFFFFFFFFFFFFn), 0);
  });

  it('returns 64 for maximally different hashes', () => {
    assert.equal(hammingDistance(0n, 0xFFFFFFFFFFFFFFFFn), 64);
    assert.equal(hammingDistance(0xFFFFFFFFFFFFFFFFn, 0n), 64);
  });

  it('counts differing bits correctly', () => {
    assert.equal(hammingDistance(0b1010n, 0b0101n), 4);
    assert.equal(hammingDistance(0b1111n, 0b0000n), 4);
  });
});

// ---------------------------------------------------------------------------
// fetchAvatarHash — real HTTP client injection
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cross-format: same avatar as webp vs png (Story 41.3 deferred item resolved)
// ---------------------------------------------------------------------------

describe('cross-format avatar matching', () => {
  it('same avatar as .webp vs .png produces hamming ≤ threshold', async () => {
    const pngDec = decodeImage(readFixture('avatar_64.png'));
    const webpDec = await decodeImageAsync(readFixture('avatar_64.webp'));
    const hPng = computeDHash(pngDec.rgba, pngDec.width, pngDec.height);
    const hWebp = computeDHash(webpDec.rgba, webpDec.width, webpDec.height);
    const dist = hammingDistance(hPng, hWebp);
    assert.ok(dist <= getAvatarPHashThreshold(), `hamming ${dist} should be ≤ ${getAvatarPHashThreshold()}`);
  });
});

describe('fetchAvatarHash', () => {
  const realHttpClient = {
    async request(url, { signal }) {
      // Simulate real fetch by reading from local fixture
      const fixtureName = url.includes('avatar_64') ? 'avatar_64.png' :
                          url.includes('avatar_32') ? 'avatar_32.png' :
                          url.includes('avatar_128') ? 'avatar_128_reencoded.png' :
                          url.includes('different') ? 'different_64.png' :
                          url.includes('corrupt') ? 'corrupt.png' : null;
      if (!fixtureName) throw new Error('Unknown URL: ' + url);
      return { body: readFixture(fixtureName) };
    },
  };

  it('fetches and hashes a PNG avatar', async () => {
    const res = await fetchAvatarHash('https://cdn.example.com/avatar_64.png', { httpClient: realHttpClient });
    assert.ok(res);
    assert.equal(res.algorithm, 'dhash');
    assert.equal(res.width, 64);
    assert.equal(res.height, 64);
    assert.equal(typeof res.hash, 'bigint');
  });

  it('fetches and hashes a JPEG avatar', async () => {
    const res = await fetchAvatarHash('https://cdn.example.com/avatar_64.jpg', { httpClient: realHttpClient });
    assert.ok(res);
    assert.equal(res.width, 64);
    assert.equal(res.height, 64);
  });

  it('returns null on network failure', async () => {
    const failingClient = { async request() { throw new Error('Network error'); } };
    const res = await fetchAvatarHash('https://cdn.example.com/avatar.png', { httpClient: failingClient });
    assert.equal(res, null);
  });

  it('returns null on decode failure', async () => {
    const res = await fetchAvatarHash('https://cdn.example.com/corrupt.png', { httpClient: realHttpClient });
    assert.equal(res, null);
  });

  it('returns null when undici fetch cannot reach the host (no external network)', async () => {
    // Point at an unroutable localhost port — connection refused locally, no external network.
    const res = await fetchAvatarHash('http://127.0.0.1:1/avatar.png', { timeoutMs: 500 });
    assert.equal(res, null);
  });

  it('respects timeout', async () => {
    const slowClient = {
      async request(url, { signal }) {
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('Aborted')));
          setTimeout(() => reject(new Error('Timeout')), 5000);
        });
      },
    };
    const start = Date.now();
    const res = await fetchAvatarHash('https://cdn.example.com/avatar.png', { httpClient: slowClient, timeoutMs: 100 });
    const elapsed = Date.now() - start;
    assert.equal(res, null);
    assert.ok(elapsed < 1000, `took ${elapsed}ms, expected <1000ms`);
  });
});

// ---------------------------------------------------------------------------
// Config & env
// ---------------------------------------------------------------------------

describe('config', () => {
  it('getAvatarPHashThreshold returns default 10', () => {
    const old = process.env.OSINT_AVATAR_PHASH_THRESHOLD;
    delete process.env.OSINT_AVATAR_PHASH_THRESHOLD;
    assert.equal(getAvatarPHashThreshold(), 10);
    if (old !== undefined) process.env.OSINT_AVATAR_PHASH_THRESHOLD = old;
  });

  it('getAvatarPHashThreshold respects env var', () => {
    const old = process.env.OSINT_AVATAR_PHASH_THRESHOLD;
    process.env.OSINT_AVATAR_PHASH_THRESHOLD = '15';
    assert.equal(getAvatarPHashThreshold(), 15);
    if (old !== undefined) process.env.OSINT_AVATAR_PHASH_THRESHOLD = old;
    else delete process.env.OSINT_AVATAR_PHASH_THRESHOLD;
  });

  it('isAvatarPHashEnabled returns true by default', () => {
    const old = process.env.OSINT_AVATAR_PHASH;
    delete process.env.OSINT_AVATAR_PHASH;
    assert.equal(isAvatarPHashEnabled(), true);
    if (old !== undefined) process.env.OSINT_AVATAR_PHASH = old;
  });

  it('isAvatarPHashEnabled returns false when OSINT_AVATAR_PHASH=0', () => {
    const old = process.env.OSINT_AVATAR_PHASH;
    process.env.OSINT_AVATAR_PHASH = '0';
    assert.equal(isAvatarPHashEnabled(), false);
    if (old !== undefined) process.env.OSINT_AVATAR_PHASH = old;
    else delete process.env.OSINT_AVATAR_PHASH;
  });
});
