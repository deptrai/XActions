// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * QR code utilities for terminal login with TTY auto-scaling and Non-TTY fallback.
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * Check if the current process is a TTY.
 * @returns {boolean}
 */
export function isTty() {
  return Boolean(process.stdout?.isTTY);
}

/**
 * Display or render a QR code to terminal text with TTY detection and responsive sizing.
 * @param {string} data - URL or string to encode
 * @param {Object} [options]
 * @param {boolean} [options.small=true]
 * @param {boolean} [options.showUrl=false]
 * @param {string} [options.shortCode]
 * @returns {Promise<string>}
 */
export async function displayTerminalQrCode(data, options = {}) {
  if (!data || typeof data !== 'string' || data.trim() === '') {
    throw new Error('[QR INVALID] QR code data must not be empty or invalid');
  }

  // Non-TTY environment: return clean fallback text without cursor escapes
  if (!isTty()) {
    let fallbackText = `\nOpen this URL on your phone: ${data}\n`;
    if (options.shortCode) {
      fallbackText += `Short code: ${options.shortCode}\n`;
    }
    return fallbackText;
  }

  // TTY environment: render ASCII QR matrix
  const isNarrow = typeof process.stdout?.columns === 'number' && process.stdout.columns < 80;
  const useSmall = isNarrow || options.small !== false;

  try {
    const qrcode = await import('qrcode-terminal');
    return new Promise((resolve) => {
      qrcode.generate(data, { small: useSmall }, (output) => {
        let result = output;
        if (options.showUrl) {
          result += `\n${data}`;
        }
        resolve(result);
      });
    });
  } catch (err) {
    throw new Error(`[QR INVALID] qrcode-terminal rendering failed: ${err.message}`);
  }
}

/**
 * Backward-compatible helper for legacy callers.
 * @param {string} text
 * @param {Object} [options]
 * @returns {Promise<string>}
 */
export async function renderTerminalQr(text, options = {}) {
  return displayTerminalQrCode(text, options);
}
