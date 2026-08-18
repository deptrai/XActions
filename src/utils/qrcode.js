// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * QR code utilities for terminal login.
 * @author nich (@nichxbt)
 * @license MIT
 */

/**
 * Render a QR code to terminal text.
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.small=true]
 * @returns {Promise<string>}
 */
export async function renderTerminalQr(text, options = {}) {
  try {
    const qrcode = await import('qrcode-terminal');
    return new Promise((resolve, reject) => {
      qrcode.generate(text, { small: options.small !== false }, (output) => {
        resolve(output);
      });
    });
  } catch (err) {
    throw new Error(`qrcode-terminal not available: ${err.message}`);
  }
}

/**
 * Check if the current process is a TTY.
 * @returns {boolean}
 */
export function isTty() {
  return Boolean(process.stdout.isTTY);
}
