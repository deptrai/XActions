// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * image-decode.js — Minimal image decoder for avatar perceptual hashing.
 *
 * Decodes PNG, JPEG, and GIF buffers to RGBA pixel data for hashing.
 * Uses zero-dependency pure-JS libraries (pngjs, jpeg-js, omggif).
 * Returns null on any failure — never throws.
 *
 * Limitation: WebP is NOT decoded (returns null → falls back to URL-equality).
 * WebP decode needs a heavier dep (sharp/@jsquash) — out of scope for 41.3.
 *
 * Story 41.3 — Option D: in-memory only, no image content persisted.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import omggif from 'omggif';

/**
 * Detect image format from magic bytes.
 * @param {Buffer} buffer
 * @returns {'png'|'jpeg'|'gif'|null}
 */
function detectFormat(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';
  // GIF: 47 49 46 38 (GIF8)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'gif';
  return null;
}

/**
 * Decode PNG buffer to RGBA.
 * @param {Buffer} buffer
 * @returns {{rgba: Uint8ClampedArray, width: number, height: number} | null}
 */
function decodePng(buffer) {
  try {
    const png = PNG.sync.read(buffer);
    return { rgba: png.data, width: png.width, height: png.height };
  } catch {
    return null;
  }
}

/**
 * Decode JPEG buffer to RGBA.
 * @param {Buffer} buffer
 * @returns {{rgba: Uint8Array, width: number, height: number} | null}
 */
function decodeJpeg(buffer) {
  try {
    const decoded = jpeg.decode(buffer, { useTArray: true });
    return { rgba: decoded.data, width: decoded.width, height: decoded.height };
  } catch {
    return null;
  }
}

/**
 * Decode GIF buffer to RGBA (first frame only).
 * @param {Buffer} buffer
 * @returns {{rgba: Uint8Array, width: number, height: number} | null}
 */
function decodeGif(buffer) {
  try {
    const reader = new omggif.GifReader(buffer);
    if (reader.numFrames() === 0) return null;
    // Use the logical screen size, not the frame rectangle — optimized GIFs can
    // encode a smaller sub-rectangle with x/y offsets, which would hash a crop.
    const rgba = new Uint8Array(reader.width * reader.height * 4);
    reader.decodeAndBlitFrameRGBA(0, rgba);
    return { rgba, width: reader.width, height: reader.height };
  } catch {
    return null;
  }
}

/**
 * Decode an image buffer (PNG/JPEG/GIF) to RGBA pixel data.
 * Returns null on any decode failure or unsupported format.
 *
 * @param {Buffer|Uint8Array} buffer - Image bytes
 * @returns {{rgba: Uint8Array|Uint8ClampedArray, width: number, height: number} | null}
 */
export function decodeImage(buffer) {
  if (!buffer || buffer.length === 0) return null;
  const buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  const format = detectFormat(buf);
  if (format === 'png') return decodePng(buf);
  if (format === 'jpeg') return decodeJpeg(buf);
  if (format === 'gif') return decodeGif(buf);
  return null;
}
