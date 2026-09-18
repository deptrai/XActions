// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Shared Vietnamese phone number normalization.
 *
 * Single source of truth for VN phone detection/normalization before dispatching
 * to Vietnam-specific platforms (Chợ Tốt, Zalo, Masothue, healthcare, automotive).
 *
 * Normalizes to the canonical 10-digit `0xxxxxxxxx` mobile form.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license Apache-2.0
 */

/**
 * Canonical Vietnamese mobile regex (10 digits, `0` prefix).
 * Covers Viettel (032-039,086,096-098), Mobifone (070-079,089,090,093),
 * Vinaphone (081-085,088,091,094), Vietnamobile (052,056,058,092),
 * Gmobile/Itelecom/Wintel (055,059,087).
 * Uses the broad `5[25689]` prefix class so valid 052/055 numbers are detected.
 * @type {RegExp}
 */
export const VN_PHONE_RE = /^0(3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-9])\d{7}$/;

/**
 * Broader VN phone regex used by healthcare schema (mobile + landline + 1800/1900 hotline).
 * Kept for backward compatibility with parseVnPhone callers that accept non-mobile numbers.
 * @type {RegExp}
 */
export const VN_PHONE_BROAD_RE = /^(?:02[0-9]{9}|1[89]00[0-9]{4,6}|(?:\+84|84|0)(?:3[2-9]|5[689]|7[06-9]|8[1-9]|9[0-9])[0-9]{7})$/;

/** @type {RegExp} */
const MASKED_PHONE_RE = /[*xX]{2,}|\.{3,}|không hiển thị|ẩn|liên hệ/i;

/**
 * Strip formatting characters and normalize a raw VN phone to `0xxxxxxxxx` form.
 * Handles `+84…`, `84…`, `0…`, and whitespace/punctuation variants.
 * Returns the normalized digits-only string, or null when the input is not a
 * recognizable VN mobile number.
 *
 * @param {string | null | undefined} raw
 * @returns {string | null} normalized `0xxxxxxxxx` or null
 */
export function normalizeVnPhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  // Test masked markers on the RAW string before stripping '.' — otherwise the
  // `\.{3,}` masked pattern can never match (dots are removed first).
  if (MASKED_PHONE_RE.test(raw)) return null;
  const cleaned = raw.replace(/[\s().\-]/g, '').trim();
  if (!cleaned) return null;
  const normalized = cleaned.startsWith('+84')
    ? '0' + cleaned.slice(3)
    : cleaned.startsWith('84') && cleaned.length >= 11
      ? '0' + cleaned.slice(2)
      : cleaned;
  return VN_PHONE_RE.test(normalized) ? normalized : null;
}

/**
 * Returns true when `raw` is a recognizable VN mobile number (any input format).
 * @param {string | null | undefined} raw
 * @returns {boolean}
 */
export function isVnPhone(raw) {
  return normalizeVnPhone(raw) !== null;
}

/**
 * Backward-compatible parser matching the original `parseVnPhone` shape used by
 * healthcare / automotive schema. Returns `{ phone, phoneMasked }`.
 * Accepts the broader number set (mobile + landline + hotline) for those callers.
 *
 * @param {string | null | undefined} rawPhone
 * @returns {{ phone: string | null, phoneMasked: boolean }}
 */
export function parseVnPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { phone: null, phoneMasked: false };
  }
  // Test masked markers on the RAW string before stripping '.', for the same
  // reason as normalizeVnPhone — `\.{3,}` cannot match once dots are removed.
  if (MASKED_PHONE_RE.test(rawPhone)) {
    return { phone: null, phoneMasked: true };
  }
  const cleaned = rawPhone.replace(/[\s().\-]/g, '').trim();
  const normalized = cleaned.startsWith('+84')
    ? '0' + cleaned.slice(3)
    : cleaned.startsWith('84') && cleaned.length >= 11
      ? '0' + cleaned.slice(2)
      : cleaned;
  if (VN_PHONE_BROAD_RE.test(normalized)) {
    return { phone: normalized, phoneMasked: false };
  }
  return { phone: null, phoneMasked: false };
}
