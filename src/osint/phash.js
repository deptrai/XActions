// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * phash.js — Perceptual image hashing for avatar matching.
 *
 * Pure-JS implementation of dHash (difference hash) and aHash (average hash)
 * operating on RGBA pixel data. Returns 64-bit BigInt hashes for Hamming
 * distance comparison. No network, no I/O, no PII persistence (Option D).
 *
 * Used by EntityResolver (Story 41.3) to cluster identical avatar images
 * across different CDN URLs.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { decodeImageAsync } from './image-decode.js';

const DEFAULT_AVATAR_PHASH_THRESHOLD = 10;
const DEFAULT_FETCH_TIMEOUT_MS = 3000;

/**
 * Resize RGBA image to target dimensions using area-average (box) downscale,
 * then convert to grayscale (luma formula).
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba - RGBA pixel data (width*height*4 bytes)
 * @param {number} width - Source width
 * @param {number} height - Source height
 * @param {number} targetW - Target width
 * @param {number} targetH - Target height
 * @returns {Float64Array} Grayscale values (targetW * targetH)
 */
function resizeToGrayscale(rgba, width, height, targetW, targetH) {
  const result = new Float64Array(targetW * targetH);
  for (let ty = 0; ty < targetH; ty++) {
    const startY = Math.floor((ty * height) / targetH);
    const endY = Math.max(startY + 1, Math.min(height, Math.ceil(((ty + 1) * height) / targetH)));
    for (let tx = 0; tx < targetW; tx++) {
      const startX = Math.floor((tx * width) / targetW);
      const endX = Math.max(startX + 1, Math.min(width, Math.ceil(((tx + 1) * width) / targetW)));
      let sum = 0;
      let count = 0;
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * width + x) * 4;
          const r = rgba[idx];
          const g = rgba[idx + 1];
          const b = rgba[idx + 2];
          const a = rgba[idx + 3] !== undefined ? rgba[idx + 3] : 255;
          const alpha = a / 255;
          const gray = (0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
          sum += gray;
          count++;
        }
      }
      result[ty * targetW + tx] = count > 0 ? sum / count : 0;
    }
  }
  return result;
}

/**
 * Compute dHash (difference hash) — compares horizontal gradients in a 9×8 grid.
 * Robust to resizing and minor compression artifacts.
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba - RGBA pixel data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {bigint} 64-bit hash
 */
export function computeDHash(rgba, width, height) {
  const gray = resizeToGrayscale(rgba, width, height, 9, 8);
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = gray[y * 9 + x];
      const right = gray[y * 9 + x + 1];
      hash = (hash << 1n) | (left > right ? 1n : 0n);
    }
  }
  return hash;
}

/**
 * Compute aHash (average hash) — compares each pixel to the average in an 8×8 grid.
 * Simple and fast; less robust to resizing than dHash.
 *
 * @param {Uint8Array|Uint8ClampedArray} rgba - RGBA pixel data
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {bigint} 64-bit hash
 */
export function computeAHash(rgba, width, height) {
  const gray = resizeToGrayscale(rgba, width, height, 8, 8);
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += gray[i];
  const avg = sum / 64;
  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    hash = (hash << 1n) | (gray[i] >= avg ? 1n : 0n);
  }
  return hash;
}

/**
 * Hamming distance between two 64-bit hashes.
 * @param {bigint} hashA
 * @param {bigint} hashB
 * @returns {number} 0–64
 */
export function hammingDistance(hashA, hashB) {
  let x = (BigInt(hashA) ^ BigInt(hashB)) & 0xFFFFFFFFFFFFFFFFn;
  let count = 0;
  while (x > 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}

/**
 * Fetch an avatar image and compute its perceptual hash.
 *
 * Fetches bytes via injected httpClient/undici with a timeout, decodes to RGBA
 * via `decodeImageAsync`, and computes dHash. Returns null on any failure (network,
 * timeout, decode error) — never throws.
 *
 * @param {string} url - Avatar image URL (http/https)
 * @param {object} [options]
 * @param {object} [options.httpClient] - HTTP client with .request(url, {signal}) → Promise<{body: Buffer|Uint8Array|ArrayBuffer}>. Defaults to undici.fetch.
 * @param {number} [options.timeoutMs=3000] - Fetch timeout in milliseconds
 * @param {'dhash'|'ahash'} [options.algorithm='dhash'] - Hash algorithm to use
 * @returns {Promise<{hash: bigint, algorithm: string, width: number, height: number} | null>}
 */
export async function fetchAvatarHash(url, options = {}) {
  const { httpClient, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, algorithm = 'dhash' } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const MAX_BYTES = 5 * 1024 * 1024; // 5MB — avatars are small; cap untrusted payloads
    let buffer = null;
    if (httpClient && typeof httpClient.request === 'function') {
      const response = await httpClient.request(url, { signal: controller.signal });
      const body = response?.body ?? response;
      buffer = body instanceof Buffer ? body : Buffer.from(body);
    } else {
      // Default: undici fetch (lazy import, already a dep)
      const { fetch: undiciFetch } = await import('undici');
      const resp = await undiciFetch(url, { signal: controller.signal });
      if (!resp.ok) return null;
      const len = Number(resp.headers.get('content-length'));
      if (Number.isFinite(len) && len > MAX_BYTES) return null;
      const arr = await resp.arrayBuffer();
      if (arr.byteLength > MAX_BYTES) return null;
      buffer = Buffer.from(arr);
    }
    if (!buffer || buffer.length === 0 || buffer.length > MAX_BYTES) return null;
    const decoded = await decodeImageAsync(buffer);
    if (!decoded) return null;
    const { rgba, width, height } = decoded;
    const hash = algorithm === 'ahash'
      ? computeAHash(rgba, width, height)
      : computeDHash(rgba, width, height);
    return { hash, algorithm, width, height };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get the configured Hamming distance threshold for avatar pHash matching.
 * Reads from env var OSINT_AVATAR_PHASH_THRESHOLD (default 10).
 * @returns {number} 0–64
 */
export function getAvatarPHashThreshold() {
  const raw = process.env.OSINT_AVATAR_PHASH_THRESHOLD;
  const n = raw ? parseInt(raw, 10) : DEFAULT_AVATAR_PHASH_THRESHOLD;
  return Number.isFinite(n) ? Math.max(0, Math.min(64, n)) : DEFAULT_AVATAR_PHASH_THRESHOLD;
}

/**
 * Check if avatar pHash fetching is enabled (env var OSINT_AVATAR_PHASH !== '0').
 * @returns {boolean}
 */
export function isAvatarPHashEnabled() {
  return process.env.OSINT_AVATAR_PHASH !== '0';
}
