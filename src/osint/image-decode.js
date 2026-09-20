// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
// by nichxbt
/**
 * image-decode.js — Minimal image decoder for avatar perceptual hashing.
 *
 * Decodes PNG, JPEG, GIF, and WebP buffers to RGBA pixel data for hashing.
 * Uses zero-dependency pure-JS libraries (pngjs, jpeg-js, omggif) plus
 * @jsquash/webp (WASM, lazy-instantiated from disk — no fetch).
 * Returns null on any failure — never throws.
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
  // WebP: RIFF....WEBP (52 49 46 46 <4 bytes size> 57 45 42 50)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
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
  // WebP requires async WASM — use decodeImageAsync for that format.
  return null;
}

// --- WebP (WASM via @jsquash/webp) -------------------------------------------
// The library's auto-init uses fetch() which fails under Node ESM, so we compile
// the .wasm file from disk once and inject the module manually.
let _webpDecode = null;
let _webpInitFailed = false;

/**
 * Lazily initialise and return the @jsquash/webp decode function.
 * @returns {Promise<((buf: Buffer|Uint8Array) => Promise<{data: Uint8ClampedArray, width: number, height: number}>) | null>}
 */
async function getWebpDecoder() {
  if (_webpDecode) return _webpDecode;
  if (_webpInitFailed) return null;
  try {
    const [{ readFile }, { createRequire }] = await Promise.all([
      import('node:fs/promises'),
      import('node:module'),
    ]);
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm');
    const wasmModule = await WebAssembly.compile(await readFile(wasmPath));
    const decMod = await import('@jsquash/webp/decode.js');
    await decMod.init(wasmModule);
    _webpDecode = decMod.default;
    return _webpDecode;
  } catch {
    _webpInitFailed = true;
    return null;
  }
}

/**
 * Async variant of decodeImage — additionally supports WebP via WASM.
 * PNG/JPEG/GIF resolve through the same sync decoders.
 *
 * @param {Buffer|Uint8Array} buffer - Image bytes
 * @returns {Promise<{rgba: Uint8Array|Uint8ClampedArray, width: number, height: number} | null>}
 */
export async function decodeImageAsync(buffer) {
  if (!buffer || buffer.length === 0) return null;
  const buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  if (detectFormat(buf) !== 'webp') return decodeImage(buf);
  const decode = await getWebpDecoder();
  if (!decode) return null;
  try {
    const out = await decode(buf);
    return { rgba: out.data, width: out.width, height: out.height };
  } catch {
    return null;
  }
}
